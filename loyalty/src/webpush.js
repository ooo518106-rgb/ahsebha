// إشعارات الويب (Web Push): بتوصل لبطاقة الزبون المضافة للشاشة الرئيسية (آيفون iOS 16.4+) أو بالمتصفح (أندرويد).
// - مفاتيح VAPID (P-256) بتنعمل مرة وحدة وبتنحفظ بقاعدة البيانات.
// - الرسالة مشفّرة حسب RFC 8291 (aes128gcm)، والتوقيع JWT بـ ES256 (RFC 8292). كله Web Crypto بدون مكتبات.
import { b64url, b64ToBytes, bytesToB64 } from './util.js';

const enc = new TextEncoder();
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
export const fromB64url = (s) => b64ToBytes(String(s).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (String(s).length % 4)) % 4));

// خدمات الإشعارات المعروفة بس (عشان السيرفر ما يبعت طلبات لأي عنوان بيعطيه حدا)
const PUSH_HOSTS = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];
export function validEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname)) && endpoint.length <= 1024;
  } catch {
    return false;
  }
}

export async function generateVapidKeys() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  const privateKey = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
  return { publicKey: b64url(publicKey), privateKey: bytesToB64(privateKey) };
}

async function vapidAuth(endpoint, vapid, subject) {
  const aud = new URL(endpoint).origin;
  const head = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('pkcs8', b64ToBytes(vapid.privateKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // Web Crypto بيرجّع التوقيع r||s (64 بايت)، وهاد الشكل اللي بدّه JWT
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${claims}`)));
  return `vapid t=${head}.${claims}.${b64url(sig)}, k=${vapid.publicKey}`;
}

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

// RFC 8291: تشفير الرسالة بمفتاح جهاز الزبون (p256dh) وسرّه (auth)
export async function encryptPayload(plaintext, p256dh, auth) {
  const uaPublic = fromB64url(p256dh);
  const authSecret = fromB64url(auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const record = concat(typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext, Uint8Array.of(2)); // 2 = آخر سجل
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

// بيرجّع { result: 'ok' | 'gone' (الاشتراك انتهى، احذفه) | 'error', code, reason } — السبب من رد خدمة الإشعارات (Apple بترجّع {"reason": "..."})
// cache (اختياري): Map بنفس الدفعة، عشان ما نوقّع JWT جديد لكل جهاز على نفس الخدمة
export async function sendPush(sub, message, { vapid, subject, fetchImpl = fetch, ttl = 86400, cache = null }) {
  try {
    const body = await encryptPayload(JSON.stringify(message), sub.p256dh, sub.auth);
    const aud = new URL(sub.endpoint).origin;
    let authorization = cache && cache.get(aud);
    if (!authorization) {
      authorization = await vapidAuth(sub.endpoint, vapid, subject);
      if (cache) cache.set(aud, authorization);
    }
    const res = await fetchImpl(sub.endpoint, {
      method: 'POST',
      headers: {
        authorization,
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(ttl),
        urgency: 'normal',
      },
      body,
    });
    if (res.ok) return { result: 'ok', code: res.status, reason: null };
    let reason = (await res.text().catch(() => '')).trim();
    try { reason = JSON.parse(reason).reason || reason; } catch { /* نص عادي */ }
    reason = `${res.status}${reason ? ` ${String(reason).slice(0, 100)}` : ''}`;
    return { result: res.status === 404 || res.status === 410 ? 'gone' : 'error', code: res.status, reason };
  } catch (e) {
    return { result: 'error', code: null, reason: String(e && e.message || e).slice(0, 100) };
  }
}
