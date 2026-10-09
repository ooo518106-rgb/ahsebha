import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVerify } from 'node:crypto';
import { buildClass, buildObject, googleConfig, SAVE_URL } from '../src/gwallet.js';
import { fakeGoogle, rsaKey, setup, signup } from './helpers.mjs';

const key = rsaKey();
const serviceAccount = JSON.stringify({ client_email: 'wallet@proj.iam.gserviceaccount.com', private_key: key.pem });

function decodeJwt(jwt) {
  const [h, p, s] = jwt.split('.');
  const verify = createVerify('RSA-SHA256');
  verify.update(`${h}.${p}`);
  return {
    header: JSON.parse(Buffer.from(h, 'base64url')),
    payload: JSON.parse(Buffer.from(p, 'base64url')),
    valid: verify.verify(key.publicKey, Buffer.from(s, 'base64url')),
  };
}

test('الإعداد: لازم رقم المُصدِر وملف حساب الخدمة', () => {
  assert.equal(googleConfig({}), null);
  assert.equal(googleConfig({ GOOGLE_ISSUER_ID: '1', GOOGLE_SERVICE_ACCOUNT: 'not json' }), null);
  const cfg = googleConfig({ GOOGLE_ISSUER_ID: ' 3388 ', GOOGLE_SERVICE_ACCOUNT: serviceAccount });
  assert.equal(cfg.issuerId, '3388');
  assert.equal(cfg.prefix, 'loy');
});

test('شكل الفئة والبطاقة', () => {
  const cfg = googleConfig({ GOOGLE_ISSUER_ID: '3388', GOOGLE_SERVICE_ACCOUNT: serviceAccount });
  const shop = { id: 7, name: 'موكا', color: '#6b3e26', country: 'JO', currency: 'JOD', logo_version: 2, program_type: 'stamps', stamps_required: 9, reward_threshold: 100, points_per_unit: 1, reward_name: 'قهوة مجانية', locations: JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ name: `f${i}`, lat: 31 + i / 100, lng: 35.9 }))) };
  const cls = buildClass(cfg, shop, 'https://x.test');
  assert.equal(cls.id, '3388.loy_s7');
  assert.equal(cls.programLogo.sourceUri.uri, 'https://x.test/media/logo/7.png?v=2');
  assert.equal(cls.merchantLocations.length, 10, 'Google بتقبل لحد 10 مواقع');
  assert.deepEqual(cls.merchantLocations[0], { latitude: 31, longitude: 35.9 });
  assert.equal(cls.reviewStatus, 'UNDER_REVIEW');

  const obj = buildObject(cfg, shop, { id: 42, card_no: '12345678', name: 'أحمد', token: 'abcdefghijkmnpqrstuv', balance: 4 }, 'https://x.test');
  assert.equal(obj.id, '3388.loy_m42');
  assert.equal(obj.classId, '3388.loy_s7');
  assert.deepEqual(obj.barcode, { type: 'QR_CODE', value: 'abcdefghijkmnpqrstuv', alternateText: '12345678' });
  assert.deepEqual(obj.loyaltyPoints, { label: 'الأختام', balance: { string: '4/9' } });
  assert.deepEqual(obj.secondaryLoyaltyPoints, { label: 'باقي للمكافأة', balance: { int: 5 } });
  assert.equal(obj.textModulesData[0].body, '●●●●○○○○○');
  assert.equal(obj.linksModuleData.uris[0].uri, 'https://x.test/c/abcdefghijkmnpqrstuv');
  assert.match(obj.heroImage.sourceUri.uri, /^https:\/\/x\.test\/img\/hero\/g3-[0-9a-f]{6}-[a-z]+-9-4-0\.png$/, 'نفس حلقة الآيفون: 9 أختام، 4 مليانين');
  assert.match(obj.heroImage.contentDescription.defaultValue.value, /^باقي 5 أختام/);
});

test('صورة بطاقة Google: بتنرسم لألوان المحلات الموجودة بس، وبتنحفظ', async () => {
  const { db, client } = await setup();
  const admin = client();
  const { shop } = await signup(admin, { shopName: 'Mocha Coffee' });
  const color = (await db.get('SELECT color FROM shops WHERE id = ?', shop.id)).color.slice(1).toLowerCase();
  const res = await client().req('GET', `/img/hero/g3-${color}-cup-10-4-0.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.match(res.headers.get('cache-control'), /immutable/);
  assert.equal(Buffer.from(res.data).readUInt32BE(16), 1032, 'عرضها 1032');
  assert.equal(Buffer.from(res.data).readUInt32BE(20), 336, 'طولها 336');
  assert.ok(await db.get("SELECT 1 AS x FROM strip_cache WHERE k = ?", `g3|#${color}|cup|10|4|0`));
  assert.equal((await client().req('GET', '/img/hero/g3-123456-cup-10-4-0.png')).status, 404, 'لون مش لمحل');
  assert.equal((await client().req('GET', `/img/hero/g3-${color}-cup-10-11-0.png`)).status, 404, 'أرقام مش منطقية');
  assert.equal((await client().req('GET', `/img/hero/s3-${color}-cup-10-4-0.png`)).status, 404, 'بس صور Google من هون');
  assert.equal((await client().req('GET', `/img/hero/g1-${color}-cup-10-4-0.png`)).status, 404, 'رسمة قديمة');
});

test('من البداية للنهاية: مزامنة الفئة، رابط الحفظ، وتحديث النقاط بالمحفظة', async () => {
  const google = fakeGoogle({
    'POST /loyaltyClass': () => ({ status: 200 }),
    'POST /loyaltyObject': () => ({ status: 409 }), // موجود من قبل → PATCH
    'PATCH /loyaltyObject/': () => ({ status: 200 }),
  });
  const { client } = await setup({ GOOGLE_ISSUER_ID: '3388', GOOGLE_SERVICE_ACCOUNT: serviceAccount, fetch: google.fetch });
  const c = client();
  const { shop } = await signup(c);

  let r = await c.put('/api/shop', { locations: [{ name: 'الفرع', lat: 31.95, lng: 35.91 }] });
  assert.equal(r.data.google.enabled, true);
  assert.equal(r.data.google.lastSync.ok, true);
  const classCall = google.calls.find((x) => x.method === 'POST' && x.url.endsWith('/loyaltyClass'));
  assert.deepEqual(classCall.body.merchantLocations, [{ latitude: 31.95, longitude: 35.91 }]);
  assert.equal(classCall.body.issuerName, 'Mocha Coffee House');

  const join = await client().post(`/api/shops/${shop.slug}/join`, { name: 'أحمد', phone: '0791234567' });
  const card = await client().get(`/api/cards/${join.data.token}`);
  assert.equal(card.data.google, true);

  // قبل ما يحفظ البطاقة ما في تحديثات لـ Google
  const member = (await c.get(`/api/members/lookup?code=${join.data.token}`)).data.member;
  await c.post(`/api/members/${member.id}/earn`, { amount: 5 });
  await c.flush();
  assert.equal(google.calls.filter((x) => x.method === 'PATCH').length, 0);

  const save = await client().get(`/c/${join.data.token}/google`);
  assert.equal(save.status, 302);
  const loc = save.headers.get('location');
  assert.ok(loc.startsWith(SAVE_URL));
  const jwt = decodeJwt(loc.slice(SAVE_URL.length));
  assert.equal(jwt.valid, true, 'التوقيع صحيح بمفتاح حساب الخدمة');
  assert.equal(jwt.header.alg, 'RS256');
  assert.equal(jwt.payload.iss, 'wallet@proj.iam.gserviceaccount.com');
  assert.equal(jwt.payload.aud, 'google');
  assert.equal(jwt.payload.typ, 'savetowallet');
  assert.deepEqual(jwt.payload.origins, ['https://loyalty.test']);
  assert.deepEqual(jwt.payload.payload.loyaltyObjects, [{ id: `3388.loy_m${member.id}`, classId: `3388.loy_s${shop.id}` }], 'JWT قصير لأن البطاقة انضافت بالـ API');
  const patchOnSave = google.calls.find((x) => x.method === 'PATCH' && x.url.includes('/loyaltyObject/'));
  assert.equal(patchOnSave.body.loyaltyPoints.balance.int, 5, 'البطاقة بتنحفظ بالرصيد الحالي');

  // بعد الحفظ: كل حركة بتحدّث المحفظة
  const before = google.calls.length;
  r = await c.post(`/api/members/${member.id}/earn`, { amount: 20 });
  await c.flush();
  const patch = google.calls.slice(before).find((x) => x.method === 'PATCH');
  assert.ok(patch.url.endsWith(encodeURIComponent(`3388.loy_m${member.id}`)));
  assert.deepEqual(patch.body.loyaltyPoints, { label: 'النقاط', balance: { int: 25 } });
  assert.deepEqual(patch.body.secondaryLoyaltyPoints, { label: 'باقي للمكافأة', balance: { int: 75 } });

  // حذف البطاقة بيوقفها بالمحفظة
  const guest = client();
  const other = await guest.post(`/api/shops/${shop.slug}/join`, { name: 'مؤقت', phone: '0799990000' });
  await guest.get(`/c/${other.data.token}/google`);
  const otherId = (await c.get(`/api/members/lookup?code=${other.data.token}`)).data.member.id;
  const beforeDelete = google.calls.length;
  await guest.post(`/api/cards/${other.data.token}/delete`, { phone: '0799990000' });
  await guest.flush();
  const deactivate = google.calls.slice(beforeDelete).find((x) => x.method === 'PATCH');
  assert.ok(deactivate.url.endsWith(encodeURIComponent(`3388.loy_m${otherId}`)));
  assert.deepEqual(deactivate.body, { id: `3388.loy_m${otherId}`, state: 'INACTIVE' });

  // رسالة لكل الزبائن
  r = await c.post('/api/broadcast', { body: 'خصم 20% اليوم على كل المشروبات' });
  assert.equal(r.status, 200);
  const msg = google.calls.find((x) => x.url.includes('/addMessage'));
  assert.ok(msg.url.includes(encodeURIComponent(`3388.loy_s${shop.id}`)));
  assert.equal(msg.body.message.messageType, 'TEXT_AND_NOTIFY');
  assert.equal(msg.body.message.header, 'Mocha Coffee House');
});

test('لو Google رفضت: الخطأ بيبيّن بالإعدادات، ورابط الحفظ بيشتغل بالبيانات كاملة', async () => {
  const google = fakeGoogle({
    'POST /loyaltyClass': () => ({ status: 400, body: { error: { message: 'Invalid logo' } } }),
  });
  const { client } = await setup({ GOOGLE_ISSUER_ID: '3388', GOOGLE_SERVICE_ACCOUNT: serviceAccount, fetch: google.fetch });
  const c = client();
  const { shop } = await signup(c);
  const r = await c.post('/api/shop/sync', {});
  assert.equal(r.data.google.lastSync.ok, false);
  assert.match(r.data.google.error, /Invalid logo/);
  assert.match((await c.get('/api/me')).data.google.error, /Invalid logo/);

  const join = await client().post(`/api/shops/${shop.slug}/join`, { name: 'سارة', phone: '0791234568' });
  const save = await client().get(`/c/${join.data.token}/google`);
  const jwt = decodeJwt(save.headers.get('location').slice(SAVE_URL.length));
  assert.equal(jwt.valid, true);
  assert.equal(jwt.payload.payload.loyaltyClasses[0].id, `3388.loy_s${shop.id}`);
  assert.equal(jwt.payload.payload.loyaltyObjects[0].accountName, 'سارة');

  // الرسالة بتضل تنبعت لإشعارات الويب، وخطأ Google بيرجع بالرد
  const bc = await c.post('/api/broadcast', { body: 'مرحبا' });
  assert.equal(bc.status, 200);
  assert.match(bc.data.google, /Invalid logo/);
});

test('رابط المنيو بالمحفظة: بيطلع أول ما يصير في منيو، وبينشال لما يفضى', async () => {
  const google = fakeGoogle({ 'POST /loyaltyClass': () => ({ status: 200 }) });
  const { client } = await setup({ GOOGLE_ISSUER_ID: '3388', GOOGLE_SERVICE_ACCOUNT: serviceAccount, fetch: google.fetch });
  const c = client();
  const { shop } = await signup(c);
  const classCalls = () => google.calls.filter((x) => x.method === 'POST' && x.url.endsWith('/loyaltyClass'));
  await c.post('/api/shop/sync', {});
  assert.deepEqual(classCalls().at(-1).body.linksModuleData, { uris: [] }, 'بدون منيو ما في رابط');
  const join = await client().post(`/api/shops/${shop.slug}/join`, { name: 'ليلى', phone: '0791234569' });
  assert.equal((await client().get(`/api/cards/${join.data.token}`)).data.menuUrl, null);

  // أول صنف: الفئة بتتحدّث برابط المنيو، والصنف التاني ما بيعيدها
  let r = await c.post('/api/menu', { name: 'لاتيه', price: 2.75 });
  await c.flush();
  assert.equal(classCalls().length, 2);
  assert.deepEqual(classCalls().at(-1).body.linksModuleData.uris, [{ id: 'menu', uri: `https://loyalty.test/m/${shop.slug}`, description: '📋 المنيو' }]);
  r = await c.post('/api/menu', { name: 'موكا', price: 3 });
  await c.flush();
  assert.equal(classCalls().length, 2);
  assert.equal((await client().get(`/api/cards/${join.data.token}`)).data.menuUrl, `https://loyalty.test/m/${shop.slug}`);

  // لما كل الأصناف تخلص (مش متوفرة) الرابط بينشال
  for (const it of r.data.items) await c.put(`/api/menu/${it.id}`, { available: false });
  await c.flush();
  assert.equal(classCalls().length, 3);
  assert.deepEqual(classCalls().at(-1).body.linksModuleData, { uris: [] });
  assert.equal((await client().get(`/api/cards/${join.data.token}`)).data.menuUrl, null);

  // ورابط الحفظ الكامل (لو الـ API فشل) بيحمل الرابط كمان
  const cls = buildClass({ issuerId: '3388' }, { id: 7, name: 'x', color: '#000000', logo_version: 1, country: 'JO', program_type: 'points', points_per_unit: 1, reward_threshold: 100, reward_name: 'قهوة' }, 'https://x.test', { menuUrl: 'https://x.test/m/x' });
  assert.equal(cls.linksModuleData.uris[0].uri, 'https://x.test/m/x');
});
