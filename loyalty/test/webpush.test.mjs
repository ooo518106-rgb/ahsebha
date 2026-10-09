import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptPayload, fromB64url, sendPush, validEndpoint, generateVapidKeys } from '../src/webpush.js';
import { fakeDevice, setup, signup } from './helpers.mjs';
import { runScheduled } from '../src/app.js';

test('التشفير بينفك عند الجهاز بنفس النص', async () => {
  const d = await fakeDevice();
  const body = await encryptPayload('{"title":"موكا","body":"انضافلك 10 نقاط"}', d.p256dh, d.auth);
  assert.equal(await d.decrypt(body), '{"title":"موكا","body":"انضافلك 10 نقاط"}');
});

test('عناوين خدمات الإشعارات المسموحة بس', () => {
  assert.ok(validEndpoint('https://web.push.apple.com/QGuT8...'));
  assert.ok(validEndpoint('https://fcm.googleapis.com/fcm/send/abc'));
  assert.ok(validEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'));
  assert.equal(validEndpoint('http://fcm.googleapis.com/x'), false);
  assert.equal(validEndpoint('https://evil.example/push'), false);
  assert.equal(validEndpoint('https://push.apple.com.evil.example/x'), false);
  assert.equal(validEndpoint('not a url'), false);
});

test('توقيع VAPID صحيح، والاشتراك المنتهي بينعرف', async () => {
  const vapid = await generateVapidKeys();
  const d = await fakeDevice();
  let seen;
  const fetchImpl = async (url, init) => { seen = init; return new Response(null, { status: 201 }); };
  const r = await sendPush({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', ...d }, { title: 'x' }, { vapid, subject: 'https://loyalty.test', fetchImpl });
  assert.equal(r.result, 'ok');
  assert.equal(seen.headers['content-encoding'], 'aes128gcm');
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(seen.headers.authorization);
  const [h, p, s] = m[1].split('.');
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(p)));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'https://loyalty.test');
  const pub = await crypto.subtle.importKey('raw', fromB64url(m[2]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, fromB64url(s), new TextEncoder().encode(`${h}.${p}`)));
  assert.deepEqual(JSON.parse(await d.decrypt(new Uint8Array(seen.body))), { title: 'x' });
  const gone = await sendPush({ endpoint: 'https://fcm.googleapis.com/x', ...d }, { title: 'x' }, { vapid, subject: 's', fetchImpl: async () => new Response(null, { status: 410 }) });
  assert.equal(gone.result, 'gone');
  // سبب الرفض من Apple بيرجع مقروء
  const bad = await sendPush({ endpoint: 'https://web.push.apple.com/x', ...d }, { title: 'x' }, { vapid, subject: 's', fetchImpl: async () => Response.json({ reason: 'BadJwtToken' }, { status: 403 }) });
  assert.deepEqual(bad, { result: 'error', code: 403, reason: '403 BadJwtToken' });
  const down = await sendPush({ endpoint: 'https://web.push.apple.com/x', ...d }, { title: 'x' }, { vapid, subject: 's', fetchImpl: async () => { throw new Error('network down'); } });
  assert.deepEqual(down, { result: 'error', code: null, reason: 'network down' });
});

test('زر «جرّب إشعار»: بيحفظ الاشتراك وبيرجّع النتيجة، وصاحب المحل بيشوف حالة آخر إشعار', async () => {
  const sent = [];
  const devices = new Map();
  let reply = () => new Response(null, { status: 201 });
  const fetchImpl = async (url, init) => {
    const d = devices.get(url);
    sent.push({ url, msg: d ? JSON.parse(await d.decrypt(new Uint8Array(init.body))) : null });
    return reply(url);
  };
  const { client } = await setup({ fetch: fetchImpl });
  const owner = client();
  const { shop } = await signup(owner, { shopName: 'Mocha' });
  const guest = client();
  const token = (await guest.post(`/api/shops/${shop.slug}/join`, { name: 'سارة', phone: '0791110000' })).data.token;
  const id = (await owner.get(`/api/members/lookup?code=${token}`)).data.member.id;
  assert.deepEqual((await owner.get(`/api/members/${id}`)).data.push, { devices: 0, lastAt: null, lastError: null });
  assert.deepEqual((await owner.post(`/api/members/${id}/earn`, { amount: 1 })).data.push, { devices: 0 }, 'زبون بدون إشعارات');

  const d = await fakeDevice();
  const endpoint = 'https://web.push.apple.com/device-1';
  devices.set(endpoint, d);
  const sub = { endpoint, keys: { p256dh: d.p256dh, auth: d.auth } };
  let r = await guest.post(`/api/cards/${token}/push/test`, sub);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { result: 'ok', reason: null });
  assert.equal(sent[0].msg.title, 'Mocha');
  assert.match(sent[0].msg.body, /الإشعارات شغّالة/);
  let p = (await owner.get(`/api/members/${id}`)).data.push;
  assert.equal(p.devices, 1, 'الاشتراك انحفظ');
  assert.ok(p.lastAt);
  assert.equal(p.lastError, null);

  // Apple رفض ← السبب بيطلع للزبون ولصاحب المحل
  reply = () => Response.json({ reason: 'BadJwtToken' }, { status: 403 });
  r = await guest.post(`/api/cards/${token}/push/test`, sub);
  assert.deepEqual(r.data, { result: 'error', reason: '403 BadJwtToken' });
  const e = await owner.post(`/api/members/${id}/earn`, { amount: 5 });
  assert.deepEqual(e.data.push, { devices: 1, sent: 0, reason: '403 BadJwtToken' }, 'الكاشير بيشوف سبب الرفض');
  p = (await owner.get(`/api/members/${id}`)).data.push;
  assert.equal(p.lastError, '403 BadJwtToken');

  // الجهاز ألغى الاشتراك ← بينحذف وبترجع 'gone' عشان البطاقة تعمل اشتراك جديد
  reply = () => new Response(null, { status: 410 });
  r = await guest.post(`/api/cards/${token}/push/test`, sub);
  assert.equal(r.data.result, 'gone');
  assert.equal((await owner.get(`/api/members/${id}`)).data.push.devices, 0);

  // اشتراك مش صالح، وحد للتجارب
  assert.equal((await guest.post(`/api/cards/${token}/push/test`, { endpoint: 'https://evil.example/x', keys: sub.keys })).status, 400);
  reply = () => new Response(null, { status: 201 });
  let last;
  for (let i = 0; i < 8; i++) last = await guest.post(`/api/cards/${token}/push/test`, sub);
  assert.equal(last.status, 429);
});

test('من البطاقة للإشعار: اشتراك، إشعار نقاط، رسالة جماعية على دفعات، وحذف المنتهي', async () => {
  const sent = [];
  const devices = new Map();
  const fetchImpl = async (url, init) => {
    const d = devices.get(url);
    sent.push({ url, msg: d ? JSON.parse(await d.decrypt(new Uint8Array(init.body))) : null });
    return new Response(null, { status: url.endsWith('/dead') ? 410 : 201 });
  };
  const { db, client } = await setup({ fetch: fetchImpl });
  const owner = client();
  const { shop } = await signup(owner, { shopName: 'Mocha' });
  await owner.put('/api/shop', { rewardThreshold: 30 });
  const guest = client();
  const token = (await guest.post(`/api/shops/${shop.slug}/join`, { name: 'سارة', phone: '0791110000' })).data.token;

  const key = (await guest.get('/api/push/key')).data.publicKey;
  assert.equal(fromB64url(key).length, 65);
  assert.equal((await guest.get('/api/push/key')).data.publicKey, key, 'نفس المفتاح كل مرة');

  const d = await fakeDevice();
  const endpoint = 'https://web.push.apple.com/device-1';
  devices.set(endpoint, d);
  assert.equal((await guest.post(`/api/cards/${token}/push`, { endpoint: 'https://evil.example/x', keys: { p256dh: d.p256dh, auth: d.auth } })).status, 400);
  assert.equal((await guest.post(`/api/cards/${token}/push`, { endpoint, keys: { p256dh: 'bad', auth: d.auth } })).status, 400);
  assert.equal((await guest.post(`/api/cards/${token}/push`, { endpoint, keys: { p256dh: d.p256dh, auth: d.auth } })).status, 201);
  assert.equal((await guest.post(`/api/cards/${token}/push`, { endpoint, keys: { p256dh: d.p256dh, auth: d.auth } })).status, 201, 'نفس الجهاز ما بيتكرر');
  assert.equal((await owner.get('/api/me')).data.pushCount, 1);

  // إضافة نقاط ← إشعار للزبون
  const id = (await owner.get(`/api/members/lookup?code=${token}`)).data.member.id;
  const e1 = await owner.post(`/api/members/${id}/earn`, { amount: 10 });
  assert.deepEqual(e1.data.push, { devices: 1, sent: 1, reason: null }, 'الكاشير بيعرف إنه الإشعار انبعت');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].msg.title, 'Mocha');
  assert.match(sent[0].msg.body, /انضافلك 10 نقاط.*رصيدك صار 10.*باقي 20/);
  assert.equal(sent[0].msg.url, `https://loyalty.test/c/${token}`);
  // لما تجهز المكافأة
  await owner.post(`/api/members/${id}/earn`, { amount: 25 });
  await owner.flush();
  assert.match(sent[1].msg.body, /🎁 مكافأتك جاهزة/);

  // رسالة جماعية: 45 زبون مشتركين → 5 دفعات
  for (let i = 0; i < 44; i++) {
    const t = (await client().post(`/api/shops/${shop.slug}/join`, { name: `زبون ${i}`, phone: `07922${String(i).padStart(5, '0')}` })).data.token;
    const dev = await fakeDevice();
    const ep = i === 0 ? 'https://web.push.apple.com/dead' : `https://web.push.apple.com/d${i}`;
    devices.set(ep, dev);
    await client().post(`/api/cards/${t}/push`, { endpoint: ep, keys: { p256dh: dev.p256dh, auth: dev.auth } });
  }
  sent.length = 0;
  let r = await owner.post('/api/broadcast', { body: 'خصم 20% اليوم ☕' });
  assert.equal(r.status, 200);
  assert.equal(r.data.google, null, 'Google مش مفعّل بهالاختبار');
  // دفعات من 10، والواجهة بتكمّل لحد ما يخلصوا
  const sizes = [r.data.push.sent + r.data.push.failed];
  let next = r.data.push.next;
  while (next) {
    const x = await owner.post(`/api/broadcast/${r.data.id}/continue`, { cursor: next });
    sizes.push(x.data.push.sent + x.data.push.failed);
    next = x.data.push.next;
  }
  assert.deepEqual(sizes, [10, 10, 10, 10, 5]);
  assert.equal(sent.length, 45);
  assert.ok(sent.filter((x) => x.msg).every((x) => x.msg.body === 'خصم 20% اليوم ☕' && x.msg.title === 'Mocha'));
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM push_subs WHERE endpoint LIKE '%/dead'")).n, 0, 'الاشتراك المنتهي انحذف');
  // ما في حد يومي للرسائل
  await owner.post('/api/broadcast', { body: 'تانية' });
  await owner.post('/api/broadcast', { body: 'تالتة' });
  assert.equal((await owner.post('/api/broadcast', { body: 'رابعة' })).status, 200);

  // إيقاف الإشعارات، وحذف البطاقة بيحذف الاشتراك
  assert.equal((await guest.req('DELETE', `/api/cards/${token}/push`, { endpoint })).status, 200);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM push_subs WHERE member_id = ?', id)).n, 0);
  await guest.post(`/api/cards/${token}/push`, { endpoint, keys: { p256dh: d.p256dh, auth: d.auth } });
  await guest.post(`/api/cards/${token}/delete`, { phone: '0791110000' });
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM push_subs WHERE member_id = ?', id)).n, 0);

  // ملف التطبيق للشاشة الرئيسية
  const t2 = (await client().post(`/api/shops/${shop.slug}/join`, { name: 'جديد', phone: '0793334444' })).data.token;
  const man = await client().get(`/c/${t2}/manifest.webmanifest`);
  const mj = man.data;
  assert.equal(mj.start_url, `/c/${t2}`);
  assert.equal(mj.display, 'standalone');
});

test('توقيع VAPID واحد لكل خدمة بالدفعة، حتى لو الأجهزة انبعتت سوا', async () => {
  const vapid = await generateVapidKeys();
  const auths = [];
  const fetchImpl = async (url, init) => { auths.push(init.headers.authorization); return new Response(null, { status: 201 }); };
  const cache = new Map();
  const devices = await Promise.all(Array.from({ length: 5 }, () => fakeDevice()));
  await Promise.all(devices.map((d, i) => sendPush({ endpoint: `https://web.push.apple.com/d${i}`, ...d }, { title: 'x' }, { vapid, subject: 's', fetchImpl, cache })));
  assert.equal(auths.length, 5);
  assert.equal(new Set(auths).size, 1, 'نفس التوقيع للخمسة (توقيع ECDSA عشوائي، فلو انعمل 5 مرات كانوا اختلفوا)');
});

test('⏰ رسائل مجدولة: بتنبعت لحالها بوقتها على دفعات، لمجموعة أو للكل، والأسبوعية بترجع تنجدول، والملغية ما بتنبعت', async () => {
  const sent = [];
  const devices = new Map();
  const fetchImpl = async (url, init) => {
    const d = devices.get(url);
    sent.push({ url, msg: d ? JSON.parse(await d.decrypt(new Uint8Array(init.body))) : null });
    return new Response(null, { status: 201 });
  };
  const { db, env, client } = await setup({ fetch: fetchImpl, PUBLIC_URL: 'https://nuqatak.test' });
  const owner = client();
  const { shop } = await signup(owner, { shopName: 'Mocha' });
  for (let i = 0; i < 14; i++) {
    const t = (await client().post(`/api/shops/${shop.slug}/join`, { name: `زبون ${i}`, phone: `07933${String(i).padStart(5, '0')}` })).data.token;
    const dev = await fakeDevice();
    devices.set(`https://web.push.apple.com/c${i}`, dev);
    await client().post(`/api/cards/${t}/push`, { endpoint: `https://web.push.apple.com/c${i}`, keys: { p256dh: dev.p256dh, auth: dev.auth } });
  }
  // وقت المحل (عمّان +3)
  const local = (ms) => new Date(ms + 3 * 3600e3).toISOString().slice(0, 16);
  const at = Math.floor((Date.now() + 2 * 86400e3) / 60000) * 60000;
  const bad = (b) => owner.post('/api/campaigns', { body: 'عرض الجمعة ☕', segment: 'all', at: local(at), ...b });
  assert.equal((await bad({ at: local(Date.now() - 60e3) })).status, 400, 'وقت فات');
  assert.equal((await bad({ at: local(Date.now() + 100 * 86400e3) })).status, 400, 'بعيد كتير');
  assert.equal((await bad({ at: '2026-13-40T99:00' })).status, 400);
  assert.equal((await bad({ segment: 'everyone' })).status, 400);
  assert.equal((await bad({ body: ' ' })).status, 400);
  const weekly = await owner.post('/api/campaigns', { header: 'عرض الجمعة', body: 'القهوة التانية ببلاش ☕', segment: 'all', at: local(at), repeat: 'weekly' });
  assert.equal(weekly.status, 200, JSON.stringify(weekly.data));
  assert.equal(weekly.data.campaigns[0].sendAt, at, 'بتوقيت المحل');
  await owner.post('/api/campaigns', { body: 'اشتقنالك', segment: 'absent', at: local(at) });
  const canceled = (await owner.post('/api/campaigns', { body: 'ملغية', segment: 'all', at: local(at) })).data.campaigns.find((k) => k.body === 'ملغية');
  assert.equal((await owner.del(`/api/campaigns/${canceled.id}`)).status, 200);
  assert.equal((await client().get('/api/campaigns')).status, 401);

  const cron = (now) => runScheduled({ db, env, waitUntil: (x) => x }, now);
  assert.equal((await cron(at - 60e3)).campaigns, 0, 'لسا ما إجا وقتها');
  assert.equal(sent.length, 0);
  await cron(at + 60e3);
  assert.equal(sent.length, 10, '10 إشعارات بالتشغيلة (حد الخطة المجانية)');
  assert.equal((await owner.get('/api/campaigns')).data.campaigns.find((k) => k.body === 'القهوة التانية ببلاش ☕').status, 'sending');
  await cron(at + 6 * 60e3);
  assert.equal(sent.length, 14, 'كمّلت بالتشغيلة الجاية');
  assert.ok(sent.every((x) => x.msg.title === 'عرض الجمعة' && x.msg.body === 'القهوة التانية ببلاش ☕'));
  const list = (await owner.get('/api/campaigns')).data.campaigns;
  const w = list.find((k) => k.repeat === 'weekly');
  assert.deepEqual([w.status, w.sendAt, w.runs, w.sent], ['scheduled', at + 7 * 86400e3, 1, 14], 'الأسبوعية رجعت للأسبوع الجاي');
  const absent = list.find((k) => k.body === 'اشتقنالك');
  assert.deepEqual([absent.status, absent.sent], ['sent', 0], 'ما في حدا غايب: ما انبعتت لحدا');
  assert.equal(list.find((k) => k.body === 'ملغية').status, 'canceled');
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM broadcasts WHERE shop_id = ?', shop.id)).n, 2, 'بتبيّن بسجل الرسائل');
  // الأسبوع الجاي بتنبعت مرة تانية
  await cron(at + 7 * 86400e3 + 60e3);
  await cron(at + 7 * 86400e3 + 6 * 60e3);
  assert.equal(sent.length, 28);
  assert.equal((await owner.get('/api/campaigns')).data.campaigns.find((k) => k.repeat === 'weekly').runs, 2);
});
