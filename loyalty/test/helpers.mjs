import { generateKeyPairSync } from 'node:crypto';
import { handle } from '../src/app.js';
import { openDb } from '../src/server.js';

export async function setup(env = {}) {
  const db = await openDb(':memory:');
  return { db, env, client: (ip) => client(db, env, ip) };
}

// عميل HTTP وهمي بيحتفظ بالكوكي، والطلبات بتروح مباشرة لـ handle؛ كل عميل إله IP مختلف
export function client(db, env, ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`) {
  let cookie = '';
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
    if (body !== undefined) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
      if (!init.headers['content-type']) init.headers['content-type'] = 'application/json';
    }
    const res = await handle(new Request(`https://loyalty.test${path}`, init), ctx);
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : (ct.startsWith('image/') || ct.includes('pkpass')) ? new Uint8Array(await res.arrayBuffer()) : await res.text();
    return { status: res.status, data, headers: res.headers };
  }
  return {
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
