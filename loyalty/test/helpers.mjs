import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { handle } from '../src/app.js';
import { openDb } from '../src/server.js';
import { b64url } from '../src/util.js';

export async function setup(env = {}) {
  env = { PLATFORM_SETUP_CODE: 'test-only-platform-setup-code-000000000', ...env };
  const db = await openDb(':memory:');
  return { db, env, client: (ip) => client(db, env, ip) };
}

// عميل HTTP وهمي بيحتفظ بالكوكي، والطلبات بتروح مباشرة لـ handle؛ كل عميل إله IP مختلف
export function client(db, env, ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`) {
  let cookie = '';
  const management = new Map();
  const pending = [];
  const ctx = {
    db,
    env,
    ip,
    asset: async (p) => (p.endsWith('.html') ? new Response(`<html>${p}</html>`, { headers: { 'content-type': 'text/html' } }) : new Response('nf', { status: 404 })),
    waitUntil: (p) => pending.push(p),
  };
  async function req(method, path, body, headers = {}) {
    const init = { method, headers: { ...(cookie ? { cookie } : {}), ...headers } };
    const card = path.match(/^\/api\/cards\/([a-z2-9]{20})\/(?:gift|delete)$/);
    if (card && management.has(card[1]) && !Object.hasOwn(headers, 'x-card-management-key')) init.headers['x-card-management-key'] = management.get(card[1]);
    if (body !== undefined) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
      if (!init.headers['content-type']) init.headers['content-type'] = 'application/json';
    }
    const res = await handle(new Request(`https://loyalty.test${path}`, init), ctx);
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : (ct.startsWith('image/') || ct.includes('pkpass') || ct.startsWith('text/csv') || ct.includes('pdf') || ct.includes('gzip')) ? new Uint8Array(await res.arrayBuffer()) : await res.text();
    if (data?.managementKey && data?.token) management.set(data.token, data.managementKey);
    if (data?.cardUrl?.includes('#manage=')) management.set(data.member.token, data.cardUrl.split('#manage=')[1]);
    if (data?.url?.includes('#manage=')) management.set(data.url.match(/\/c\/([a-z2-9]{20})/)[1], data.url.split('#manage=')[1]);
    return { status: res.status, data, headers: res.headers };
  }
  return {
    bootstrap: () => req('POST', '/api/platform/bootstrap', { code: env.PLATFORM_SETUP_CODE }),
    req,
    get: (p) => req('GET', p),
    post: (p, b = {}) => req('POST', p, b),
    put: (p, b = {}) => req('PUT', p, b),
    del: (p) => req('DELETE', p),
    flush: async () => { await Promise.all(pending.splice(0)); },
  };
}

export async function signup(c, over = {}) {
  const body = { shopName: 'Mocha Coffee House', email: `owner${Math.random().toString(36).slice(2)}@test.com`, password: 'secret-pass-1', ...over };
  const r = await c.post('/api/auth/signup', body);
  if (r.status !== 201) throw new Error(JSON.stringify(r.data));
  const before = await c.get('/api/me');
  if (before.data.canBootstrap) assert.equal((await c.bootstrap()).status, 200);
  const me = await c.get('/api/me');
  return { ...body, shop: me.data.shop };
}

export function rsaKey() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { pem: privateKey.export({ type: 'pkcs8', format: 'pem' }), publicKey };
}

// Google وهمي: بيسجّل كل الطلبات وبيرد حسب جدول
export function fakeGoogle(routes = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const body = init.body && init.headers['content-type'] === 'application/json' ? JSON.parse(init.body) : init.body;
    calls.push({ url: String(url), method: init.method || 'GET', body });
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'tok', expires_in: 3600 });
    for (const [key, handler] of Object.entries(routes)) {
      const [m, pattern] = key.split(' ');
      if (m === (init.method || 'GET') && String(url).includes(pattern)) {
        const out = handler(body, calls);
        return Response.json(out.body || {}, { status: out.status || 200 });
      }
    }
    return Response.json({}, { status: 200 });
  };
  return { fetch, calls };
}

// جهاز وهمي: مفتاح ECDH وسر auth، وبيفك التشفير حسب RFC 8291
export async function fakeDevice() {
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
