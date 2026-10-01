import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptPayload, fromB64url, sendPush, validEndpoint, generateVapidKeys } from '../src/webpush.js';
import { b64url } from '../src/util.js';
import { setup, signup } from './helpers.mjs';

// جهاز وهمي: مفتاح ECDH وسر auth، وبيفك التشفير حسب RFC 8291
async function fakeDevice() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const hkdf = async (salt, ikm, info, n) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
  const te = new TextEncoder();
  async function decrypt(body) {
    const salt = body.subarray(0, 16);
    const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
    const idlen = body[20];
    const asPublic = body.subarray(21, 21 + idlen);
    const cipher = body.subarray(21 + idlen);
    const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, keys.privateKey, 256));
    const info = new Uint8Array([...te.encode('WebPush: info\0'), ...pub, ...asPublic]);
    const ikm = await hkdf(auth, shared, info, 32);
    const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), cipher));
    assert.equal(rs, 4096);
    assert.equal(plain[plain.length - 1], 2, 'آخر سجل');
    return new TextDecoder().decode(plain.subarray(0, -1));
  }
  return { p256dh: b64url(pub), auth: b64url(auth), decrypt };
}

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
  assert.equal(r, 'ok');
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
  assert.equal(gone, 'gone');
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
  await owner.post(`/api/members/${id}/earn`, { amount: 10 });
  await owner.flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].msg.title, 'Mocha');
  assert.match(sent[0].msg.body, /انضافلك 10 نقطة.*رصيدك صار 10.*باقي 20/);
  assert.equal(sent[0].msg.url, `https://loyalty.test/c/${token}`);
  // لما تجهز المكافأة
  await owner.post(`/api/members/${id}/earn`, { amount: 25 });
  await owner.flush();
  assert.match(sent[1].msg.body, /🎁 مكافأتك جاهزة/);

  // رسالة جماعية: 45 زبون مشتركين → دفعتين
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
  assert.equal(r.data.push.sent + r.data.push.failed, 40);
  assert.ok(r.data.push.next);
  const r2 = await owner.post(`/api/broadcast/${r.data.id}/continue`, { cursor: r.data.push.next });
  assert.equal(r2.data.push.sent + r2.data.push.failed, 5);
  assert.equal(r2.data.push.next, null);
  assert.equal(sent.length, 45);
  assert.ok(sent.filter((x) => x.msg).every((x) => x.msg.body === 'خصم 20% اليوم ☕' && x.msg.title === 'Mocha'));
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM push_subs WHERE endpoint LIKE '%/dead'")).n, 0, 'الاشتراك المنتهي انحذف');
  // 3 رسائل باليوم
  await owner.post('/api/broadcast', { body: 'تانية' });
  await owner.post('/api/broadcast', { body: 'تالتة' });
  assert.equal((await owner.post('/api/broadcast', { body: 'رابعة' })).status, 429);

  // إيقاف الإشعارات، وحذف البطاقة بيحذف الاشتراك
  assert.equal((await guest.req('DELETE', `/api/cards/${token}/push`, { endpoint })).status, 200);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM push_subs WHERE member_id = ?', id)).n, 0);
  await guest.post(`/api/cards/${token}/push`, { endpoint, keys: { p256dh: d.p256dh, auth: d.auth } });
  await guest.post(`/api/cards/${token}/delete`, {});
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM push_subs WHERE member_id = ?', id)).n, 0);

  // ملف التطبيق للشاشة الرئيسية
  const t2 = (await client().post(`/api/shops/${shop.slug}/join`, { name: 'جديد', phone: '0793334444' })).data.token;
  const man = await client().get(`/c/${t2}/manifest.webmanifest`);
  const mj = man.data;
  assert.equal(mj.start_url, `/c/${t2}`);
  assert.equal(mj.display, 'standalone');
});
