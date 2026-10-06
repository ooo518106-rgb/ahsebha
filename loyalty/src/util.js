// أدوات مشتركة بين السيرفر والاختبارات — بتشتغل على Cloudflare Workers و Node (Web Crypto + Response)

export class HttpError extends Error {
  constructor(status, message, extra = null) { super(message); this.status = status; this.extra = extra; }
}
export function fail(status, message, extra = null) { throw new HttpError(status, message, extra); }

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

// حروف بدون الأشكال المتشابهة (0/o و 1/l)، والتوكن 20 حرف ≈ 100 بت عشوائية
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
export function randomToken(len = 20) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}
export function randomDigits(len) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = String(1 + (bytes[0] % 9));
  for (let i = 1; i < len; i++) out += String(bytes[i] % 10);
  return out;
}

export function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export const b64url = (bytes) => bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const b64urlText = (text) => b64url(new TextEncoder().encode(text));

export async function sha256Hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// نص من المستخدم: بدون رموز تحكم، مسافات موحّدة، وطول أقصى
export function clean(v, max = 120) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// الأرقام العربية والفارسية بتتحوّل لإنجليزية، وبنشيل أي شي غير الأرقام (و 00 الدولية)
export function normPhone(v) {
  const d = String(v ?? '')
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, '');
  return d.replace(/^00/, '');
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const isUniqueError = (e) => /UNIQUE constraint failed/i.test(String(e && e.message));
