import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { authTokenFor, generateKeyAndCsr, zip } from '../src/apple.js';
import { setup, signup } from './helpers.mjs';

// سلسلة شهادات تجريبية بتشبه تبعت Apple: جذر ← وسيطة (WWDR) ← شهادة Pass Type ID
let dir;
let opensslOk = true;
const sh = (...args) => execFileSync('openssl', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'nuqatak-apple-'));
  try {
    writeFileSync(path.join(dir, 'ext.cnf'), '[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n[leaf]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n');
    sh('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'root.key', '-out', 'root.pem', '-days', '2', '-subj', '/CN=Test Root', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign');
    sh('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'wwdr.key', '-out', 'wwdr.csr', '-subj', '/CN=Test WWDR/OU=G4/O=Test');
    sh('x509', '-req', '-in', 'wwdr.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial', '-out', 'wwdr.pem', '-days', '2', '-extfile', 'ext.cnf', '-extensions', 'ca');
  } catch {
    opensslOk = false;
  }
});

function issue(csrPem, name) {
  writeFileSync(path.join(dir, `${name}.csr`), csrPem);
  sh('x509', '-req', '-in', `${name}.csr`, '-CA', 'wwdr.pem', '-CAkey', 'wwdr.key', '-CAcreateserial', '-days', '2', '-extfile', 'ext.cnf', '-extensions', 'leaf',
    '-subj', '/UID=pass.com.nuqatak.test/CN=Pass Type ID: pass.com.nuqatak.test/OU=ABCDE12345/O=Test Dev/C=US', '-outform', 'DER', '-out', `${name}.cer`);
  return readFileSync(path.join(dir, `${name}.cer`)).toString('base64');
}

function unzipAll(bytes) {
  writeFileSync(path.join(dir, 'card.pkpass'), bytes);
  const out = execFileSync('python3', ['-c', 'import zipfile,sys,json,base64;z=zipfile.ZipFile(sys.argv[1]);print(json.dumps({n:base64.b64encode(z.read(n)).decode() for n in z.namelist()}))', path.join(dir, 'card.pkpass')]);
  return Object.fromEntries(Object.entries(JSON.parse(out)).map(([k, v]) => [k, Buffer.from(v, 'base64')]));
}

test('ملف ZIP بدون ضغط بينقرا', () => {
  if (!opensslOk) return;
  const z = zip([{ name: 'a.txt', data: new TextEncoder().encode('hello') }, { name: 'b/c.json', data: new TextEncoder().encode('{}') }]);
  const files = unzipAll(z);
  assert.equal(files['a.txt'].toString(), 'hello');
  assert.equal(files['b/c.json'].toString(), '{}');
});

test('Apple Wallet من الإعداد للبطاقة الموقّعة وخدمة التحديث', async (t) => {
  if (!opensslOk) { t.skip('openssl مش موجود'); return; }
  const { db, client } = await setup({ APPLE_WWDR_PEM: readFileSync(path.join(dir, 'wwdr.pem'), 'utf8') });
  const admin = client();
  const { shop } = await signup(admin, { shopName: 'Mocha Coffee' });
  const other = client();
  await signup(other, { shopName: 'Other Shop' });

  assert.equal((await admin.get('/api/admin/apple')).data.configured, false);
  const b64 = (u8) => Buffer.from(u8).toString('base64');
  const keys = await generateKeyAndCsr();
  const keyBody = { privateKey: b64(keys.pkcs8), publicKey: b64(keys.spki) };
  assert.equal((await other.post('/api/admin/apple/key', keyBody)).status, 403, 'صاحب محل عادي ما بيعدّل إعداد Apple');
  assert.equal((await admin.put('/api/admin/apple/cert', { cert: 'x' })).status, 400, 'لازم CSR أول');

  // 1) طلب الشهادة 2) Apple (هون: شهادتنا التجريبية) 3) رفع الشهادة
  // مفتاح عام مش من نفس الزوج مرفوض
  const strangerKeys = await generateKeyAndCsr();
  assert.equal((await admin.post('/api/admin/apple/key', { ...keyBody, publicKey: b64(strangerKeys.spki) })).status, 400);
  assert.equal((await admin.post('/api/admin/apple/key', keyBody)).data.hasKey, true);
  const csr = keys.csrPem;
  assert.match(csr, /^-----BEGIN CERTIFICATE REQUEST-----/);
  writeFileSync(path.join(dir, 'check.csr'), csr);
  sh('req', '-in', 'check.csr', '-noout', '-verify');
  // شهادة من مفتاح تاني مرفوضة
  sh('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'stranger.key', '-out', 'stranger.csr', '-subj', '/CN=x');
  const stranger = issue(readFileSync(path.join(dir, 'stranger.csr'), 'utf8'), 'stranger');
  assert.equal((await admin.put('/api/admin/apple/cert', { cert: stranger })).status, 400);
  let r = await admin.put('/api/admin/apple/cert', { cert: issue(csr, 'pass') });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.configured, r.data.passTypeId, r.data.teamId], [true, 'pass.com.nuqatak.test', 'ABCDE12345']);
  assert.equal((await admin.post('/api/admin/apple/key', keyBody)).status, 409, 'ما بنكسر إعداد شغّال بالغلط');

  // محل فيه فرع ورسالة ترحيب، وزبون
  await admin.put('/api/shop', { name: 'موكا كوفي هاوس', welcomeText: 'موكا كوفي هاوس ترحب بكم ☕', locations: [{ name: 'الفرع', lat: 31.7167, lng: 35.7939 }] });
  const guest = client();
  const join = await guest.post(`/api/shops/${shop.slug}/join`, { name: 'أحمد', phone: '0791234567' });
  const token = join.data.token;
  assert.equal((await guest.get(`/api/cards/${token}`)).data.apple, true);

  const res = await guest.get(`/c/${token}/apple`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/vnd.apple.pkpass');
  const files = unzipAll(Buffer.from(res.data));
  for (const f of ['pass.json', 'manifest.json', 'signature', 'icon.png', 'icon@2x.png', 'logo.png', 'strip.png', 'strip@2x.png', 'strip@3x.png']) assert.ok(files[f], f);
  assert.deepEqual([...files['strip@3x.png'].subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'صورة الدواير PNG');
  assert.equal(files['strip@3x.png'].readUInt32BE(16), 1125, 'عرضها 3x');
  assert.equal(files['strip@3x.png'].readUInt32BE(20), 432, 'طولها 144 نقطة (مكان الشريط بالبطاقة اللي عليها QR)');
  assert.ok((await db.get('SELECT k FROM strip_cache')).k.startsWith('s2|'), 'الصورة انحفظت عشان ما تنرسم كل مرة');
  const pass = JSON.parse(files['pass.json']);
  assert.equal(pass.passTypeIdentifier, 'pass.com.nuqatak.test');
  assert.equal(pass.teamIdentifier, 'ABCDE12345');
  assert.equal(pass.serialNumber, token);
  assert.equal(pass.organizationName, 'موكا كوفي هاوس');
  assert.equal(pass.webServiceURL, 'https://loyalty.test/apple');
  assert.deepEqual(pass.barcodes[0], { format: 'PKBarcodeFormatQR', message: token, messageEncoding: 'iso-8859-1', altText: pass.storeCard.backFields.find((f) => f.key === 'card').value });
  assert.equal(pass.logoText, 'موكا كوفي هاوس', 'بدون شعار مرفوع: الاسم مكتوب');
  assert.equal(pass.storeCard.primaryFields, undefined, 'مكان الحقل الكبير للدواير');
  assert.deepEqual(pass.storeCard.secondaryFields.map((f) => [f.label, f.value, f.textAlignment]), [['🎁', 'مشروب مجاني', 'PKTextAlignmentLeft'], ['⏳', 'باقي 100 نقطة', 'PKTextAlignmentRight']], 'من اليمين: شو باقي ← المكافأة');
  assert.deepEqual(pass.locations, [{ latitude: 31.7167, longitude: 35.7939, relevantText: 'موكا كوفي هاوس ترحب بكم ☕' }]);
  assert.equal(pass.storeCard.headerFields[0].value, 0);
  // manifest = SHA-1 لكل ملف، والتوقيع صحيح بالسلسلة
  const manifest = JSON.parse(files['manifest.json']);
  for (const [name, hash] of Object.entries(manifest)) assert.equal(createHash('sha1').update(files[name]).digest('hex'), hash, name);
  writeFileSync(path.join(dir, 'manifest.json'), files['manifest.json']);
  writeFileSync(path.join(dir, 'signature'), files.signature);
  sh('cms', '-verify', '-binary', '-inform', 'DER', '-in', 'signature', '-content', 'manifest.json', '-CAfile', 'root.pem', '-purpose', 'any', '-out', path.join(dir, 'verified'));

  // خدمة التحديث
  const secret = (await db.get('SELECT auth_secret FROM apple_config WHERE id = 1')).auth_secret;
  const auth = { authorization: `ApplePass ${await authTokenFor(secret, token)}` };
  assert.equal(pass.authenticationToken, auth.authorization.slice('ApplePass '.length));
  const reg = `/apple/v1/devices/device123/registrations/pass.com.nuqatak.test/${token}`;
  assert.equal((await guest.req('POST', reg, { pushToken: 'abc' })).status, 401);
  assert.equal((await guest.req('POST', reg, { pushToken: 'abc' }, auth)).status, 201);
  assert.equal((await guest.req('POST', reg, { pushToken: 'abc' }, auth)).status, 200);
  r = await guest.get('/apple/v1/devices/device123/registrations/pass.com.nuqatak.test?passesUpdatedSince=0');
  assert.deepEqual(r.data.serialNumbers, [token]);
  const tag = r.data.lastUpdated;
  assert.equal((await guest.get(`/apple/v1/devices/device123/registrations/pass.com.nuqatak.test?passesUpdatedSince=${tag}`)).status, 204);

  await new Promise((ok) => setTimeout(ok, 5));
  const memberId = (await admin.get(`/api/members/lookup?code=${token}`)).data.member.id;
  await admin.post(`/api/members/${memberId}/earn`, { amount: 25 });
  r = await guest.get(`/apple/v1/devices/device123/registrations/pass.com.nuqatak.test?passesUpdatedSince=${tag}`);
  assert.deepEqual(r.data.serialNumbers, [token], 'البطاقة تغيّرت بعد إضافة النقاط');

  assert.equal((await guest.req('GET', `/apple/v1/passes/pass.com.nuqatak.test/${token}`)).status, 401);
  const latest = await guest.req('GET', `/apple/v1/passes/pass.com.nuqatak.test/${token}`, undefined, auth);
  assert.equal(latest.status, 200);
  const updated = JSON.parse(unzipAll(Buffer.from(latest.data))['pass.json']);
  assert.equal(updated.storeCard.headerFields[0].value, 25);
  const lm = latest.headers.get('last-modified');
  assert.equal((await guest.req('GET', `/apple/v1/passes/pass.com.nuqatak.test/${token}`, undefined, { ...auth, 'if-modified-since': lm })).status, 304);
  assert.equal((await guest.req('POST', '/apple/v1/log', { logs: ['test'] })).status, 200);

  // حذف البطاقة بيشيل التسجيل
  assert.equal((await guest.req('DELETE', reg, undefined, auth)).status, 200);
  await guest.req('POST', reg, { pushToken: 'abc' }, auth);
  await guest.post(`/api/cards/${token}/delete`, { phone: '0791234567' });
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM apple_regs')).n, 0);
});

test('بدون إعداد Apple: الرابط بيرجع للبطاقة', async () => {
  const { client } = await setup();
  const c = client();
  const { shop } = await signup(c);
  const join = await client().post(`/api/shops/${shop.slug}/join`, { name: 'سارة', phone: '0790001111' });
  const r = await client().get(`/c/${join.data.token}/apple`);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), `/c/${join.data.token}?apple=off`);
  assert.equal((await client().get(`/api/cards/${join.data.token}`)).data.apple, false);
  assert.equal((await client().get('/apple/v1/passes/x/y')).status, 404);
});

test('بطاقة Apple: رابط المنيو على ضهر البطاقة إذا في منيو', async () => {
  const { buildPassJson } = await import('../src/apple.js');
  const shop = { id: 1, name: 'موكا', color: '#3b2418', program_type: 'stamps', stamps_required: 8, reward_name: 'قهوة مجانية', locations: '[]' };
  const member = { token: 'abcdefghijkmnpqrstuv', card_no: '12345678', name: 'سارة', balance: 3 };
  const opts = { passTypeId: 'pass.x', teamId: 'T', origin: 'https://x.test', authToken: 'a'.repeat(32) };
  assert.equal(buildPassJson(shop, member, opts).storeCard.backFields.some((f) => f.key === 'menu'), false);
  const menu = buildPassJson(shop, member, { ...opts, menuUrl: 'https://x.test/m/mocha' }).storeCard.backFields.find((f) => f.key === 'menu');
  assert.equal(menu.value, 'https://x.test/m/mocha');
  assert.match(menu.attributedValue, /<a href="https:\/\/x\.test\/m\/mocha">/);
  // المنيو أول إشي على الضهر، وبعده التقييم وروابط المحل. وعلى الوجه سطر بيقول وين المنيو
  const full = buildPassJson({ ...shop, review_on: 1, links: JSON.stringify({ instagram: 'https://instagram.com/mocha.jo', whatsapp: 'https://wa.me/962791234567', website: 'javascript:alert(1)' }) }, member, { ...opts, menuUrl: 'https://x.test/m/mocha' }).storeCard;
  assert.deepEqual(full.backFields.map((f) => f.key).slice(0, 4), ['menu', 'rate', 'link-instagram', 'link-whatsapp']);
  assert.ok(!full.backFields.some((f) => f.key === 'link-website'), 'بس روابط https');
  assert.match(full.backFields[1].attributedValue, /#rate">⭐ قيّم زيارتك</);
  assert.match(full.backFields[2].attributedValue, />@mocha\.jo</);
  assert.deepEqual(full.secondaryFields.map((f) => f.key), ['menuHint', 'reward', 'status'], 'المنيو عالشمال، وشو باقي عاليمين');
});

test('📍 مسافة الترحيب: المحل بيصغّرها (maxDistance) أو بيطفّيها، والافتراضي اللي بيقرره الآيفون', async () => {
  const { buildPassJson } = await import('../src/apple.js');
  const shop = { id: 1, name: 'موكا', color: '#3b2418', program_type: 'stamps', stamps_required: 8, reward_name: 'قهوة', welcome_text: 'موكا ترحب بكم', locations: JSON.stringify([{ lat: 31.717, lng: 35.794 }]) };
  const member = { token: 'abcdefghijkmnpqrstuv', card_no: '12345678', name: 'سارة', balance: 3 };
  const opts = { passTypeId: 'pass.x', teamId: 'T', origin: 'https://x.test', authToken: 'a'.repeat(32) };
  assert.deepEqual(buildPassJson(shop, member, opts).locations, [{ latitude: 31.717, longitude: 35.794, relevantText: 'موكا ترحب بكم' }]);
  assert.equal(buildPassJson({ ...shop, welcome_distance: 30 }, member, opts).locations[0].maxDistance, 30);
  assert.equal(buildPassJson({ ...shop, welcome_distance: -1 }, member, opts).locations, undefined, 'مطفي: ما بتطلع على شاشة القفل');

  const { client } = await setup();
  const owner = client();
  await signup(owner);
  assert.equal((await owner.get('/api/me')).data.shop.welcomeDistance, 0);
  assert.equal((await owner.put('/api/shop', { welcomeDistance: 500 })).status, 400, 'Apple ما بتسمح بأبعد');
  assert.equal((await owner.put('/api/shop', { welcomeDistance: '30' })).data.shop.welcomeDistance, 30);
  assert.equal((await owner.put('/api/shop', { welcomeDistance: -1 })).data.shop.welcomeDistance, -1);
});

test('صورة الدواير على بطاقة الآيفون: كم دايرة وكم مليانة', async () => {
  const { stripState } = await import('../src/strip.js');
  const pts = { program_type: 'points', reward_threshold: 10, points_per_unit: 1 };
  assert.deepEqual(stripState(pts, 4), { slots: 10, filled: 4, ready: false });
  assert.deepEqual(stripState(pts, 9), { slots: 10, filled: 9, ready: false });
  assert.deepEqual(stripState(pts, 12), { slots: 10, filled: 10, ready: true }, 'جاهزة: كله مليان والهدية ذهبية');
  assert.deepEqual(stripState({ ...pts, reward_threshold: 100 }, 45), { slots: 10, filled: 4, ready: false }, 'نقاط كتير: 10 دواير = نسبة');
  assert.deepEqual(stripState({ program_type: 'stamps', stamps_required: 8 }, 3), { slots: 8, filled: 3, ready: false });
});

test('🔔 تحديث بطاقات الآيفون لحالها: مفتاح APNs، وإشعار للجهاز لما الرصيد يتغيّر', async (t) => {
  if (!opensslOk) { t.skip('openssl مش موجود'); return; }
  const pushes = [];
  let reply = (url) => (url.endsWith('/' + '0'.repeat(64)) ? { status: 400, body: { reason: 'BadDeviceToken' } } : { status: 200 });
  const fetch = async (url, init = {}) => {
    const u = String(url);
    if (!u.startsWith('https://api.push.apple.com/')) return new Response(null, { status: 201 });
    pushes.push({ url: u, headers: new Headers(init.headers), body: init.body });
    const r = reply(u);
    return new Response(r.body ? JSON.stringify(r.body) : null, { status: r.status });
  };
  const { db, client } = await setup({ APPLE_WWDR_PEM: readFileSync(path.join(dir, 'wwdr.pem'), 'utf8'), fetch });
  const admin = client();
  const { shop } = await signup(admin, { shopName: 'Mocha Coffee' });
  const b64 = (u8) => Buffer.from(u8).toString('base64');
  const keys = await generateKeyAndCsr();
  await admin.post('/api/admin/apple/key', { privateKey: b64(keys.pkcs8), publicKey: b64(keys.spki) });
  assert.equal((await admin.put('/api/admin/apple/cert', { cert: issue(keys.csrPem, 'pass2') })).status, 200);
  const guest = client();
  const token = (await guest.post(`/api/shops/${shop.slug}/join`, { name: 'أحمد', phone: '0791234567' })).data.token;
  const secret = (await db.get('SELECT auth_secret FROM apple_config WHERE id = 1')).auth_secret;
  const auth = { authorization: `ApplePass ${await authTokenFor(secret, token)}` };
  assert.equal((await guest.req('POST', `/apple/v1/devices/dev1/registrations/pass.com.nuqatak.test/${token}`, { pushToken: 'aa11' }, auth)).status, 201);

  // بدون مفتاح: ما في إشعارات
  const memberId = (await admin.get(`/api/members/lookup?code=${token}`)).data.member.id;
  await admin.post(`/api/members/${memberId}/earn`, { amount: 5 });
  await admin.flush();
  assert.equal(pushes.length, 0);

  // مفتاح P-256 متل ملف .p8 تبع Apple
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const p8 = `-----BEGIN PRIVATE KEY-----\n${b64(new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))).match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  assert.equal((await admin.put('/api/admin/apple/apns', { key: p8, keyId: 'short' })).status, 400);
  assert.equal((await admin.put('/api/admin/apple/apns', { key: 'nope', keyId: 'ABC123DEFG' })).status, 400);
  reply = () => ({ status: 403, body: { reason: 'InvalidProviderToken' } });
  const bad = await admin.put('/api/admin/apple/apns', { key: p8, keyId: 'ABC123DEFG' });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /InvalidProviderToken/);
  reply = (url) => (url.endsWith('/' + '0'.repeat(64)) ? { status: 400, body: { reason: 'BadDeviceToken' } } : { status: 200 });
  pushes.length = 0;
  const ok = await admin.put('/api/admin/apple/apns', { key: p8, keyId: 'abc123defg' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.deepEqual([ok.data.apns.configured, ok.data.apns.keyId], [true, 'ABC123DEFG']);
  await admin.flush();
  assert.ok(pushes.some((p) => p.url.endsWith('/3/device/aa11')), 'كل البطاقات المضافة بتتحدّث بعد ما ينحفظ المفتاح');

  // الكاشير ضاف نقاط ← إشعار للجهاز، بالموضوع والتوكن الصح
  pushes.length = 0;
  await admin.post(`/api/members/${memberId}/earn`, { amount: 3 });
  await admin.flush();
  assert.equal(pushes.length, 1);
  const p = pushes[0];
  assert.equal(p.url, 'https://api.push.apple.com/3/device/aa11');
  assert.equal(p.headers.get('apns-topic'), 'pass.com.nuqatak.test');
  assert.equal(p.body, '{}');
  const [h, c, sig] = p.headers.get('authorization').replace(/^bearer /, '').split('.');
  const dec = (s) => JSON.parse(Buffer.from(s, 'base64url').toString());
  assert.deepEqual(dec(h), { alg: 'ES256', kid: 'ABC123DEFG' });
  assert.equal(dec(c).iss, 'ABCDE12345');
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, Buffer.from(sig, 'base64url'), new TextEncoder().encode(`${h}.${c}`)), 'التوقيع صحيح');
  assert.equal((await admin.get('/api/admin/apple')).data.apns.last.sent, 1);

  // تغيير بالمحل (الاسم) ← كل بطاقاته بتتحدّث
  pushes.length = 0;
  await admin.put('/api/shop', { name: 'موكا' });
  await admin.flush();
  assert.equal(pushes.length, 1);

  // 📣 رسالة لكل الزبائن: بتنكتب على ضهر بطاقة الآيفون (مع إشعار)، والجهاز بيوصله «تحدّثت» من الدور
  pushes.length = 0;
  const bc = await admin.post('/api/broadcast', { body: 'خصم 20% اليوم على كل المشروبات' });
  assert.equal(bc.status, 200);
  assert.equal(bc.data.apple, 1);
  await admin.flush();
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].url, 'https://api.push.apple.com/3/device/aa11');
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM apple_queue')).n, 0, 'الدور فضي');
  const changed = await guest.req('GET', `/apple/v1/devices/dev1/registrations/pass.com.nuqatak.test?passesUpdatedSince=${Date.now() - 60e3}`);
  assert.deepEqual(changed.data.serialNumbers, [token]);
  const fresh = await guest.req('GET', `/apple/v1/passes/pass.com.nuqatak.test/${token}`, undefined, auth);
  assert.equal(fresh.status, 200);
  const passJson = JSON.parse(unzipAll(fresh.data)['pass.json'].toString());
  const news = passJson.storeCard.backFields[0];
  assert.deepEqual([news.key, news.value, news.changeMessage], ['news', 'خصم 20% اليوم على كل المشروبات', '%@']);
  assert.match(news.label, /موكا/);

  // الجهاز شال البطاقة (410): منشيل التسجيل
  reply = () => ({ status: 410, body: { reason: 'Unregistered' } });
  await admin.post(`/api/members/${memberId}/earn`, { amount: 3 });
  await admin.flush();
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM apple_regs')).n, 0);
  assert.equal((await admin.get('/api/admin/apple')).data.apns.last.reason, 'Unregistered');
});
