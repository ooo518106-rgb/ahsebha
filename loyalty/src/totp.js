// 🔐 التحقق بخطوتين (TOTP، RFC 6238): نفس الرموز اللي بيطلّعها Google Authenticator أو «كلمات السر» بالآيفون.
// السر 20 بايت بـ base32، الرمز 6 أرقام بيتغيّر كل 30 ثانية، ومنقبل الرمز اللي قبله واللي بعده (فرق ساعة الجوال).
import { randomToken, sha256Hex } from './util.js';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SEC = 30;

export function base32(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function unbase32(text) {
  const s = String(text || '').toUpperCase().replace(/[\s=-]/g, '');
  const out = [];
  let bits = 0;
  let value = 0;
  for (const ch of s) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('base32 غلط');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export const newSecret = () => base32(crypto.getRandomValues(new Uint8Array(20)));

export async function codeAt(secret, step) {
  const key = await crypto.subtle.importKey('raw', unbase32(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new Uint8Array(8);
  let n = step;
  for (let i = 7; i >= 0; i--) { msg[i] = n & 255; n = Math.floor(n / 256); }
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[19] & 15;
  const bin = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 1e6).padStart(6, '0');
}

export const stepOf = (now = Date.now()) => Math.floor(now / 1000 / STEP_SEC);

// بيرجّع رقم الخطوة إذا الرمز صح (وأحدث من آخر رمز انستعمل، عشان ما ينعاد نفس الرمز)، وإلا 0
export async function verify(secret, code, now = Date.now(), lastStep = 0) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6 || !secret) return 0;
  const cur = stepOf(now);
  for (const s of [cur, cur - 1, cur + 1]) {
    if (s <= lastStep) continue;
    const want = await codeAt(secret, s);
    let diff = 0;
    for (let i = 0; i < 6; i++) diff |= want.charCodeAt(i) ^ c.charCodeAt(i);
    if (!diff) return s;
  }
  return 0;
}

// الرابط اللي بيفتح «أضف رمز تحقق» على الجوال (أو بينمسح كـ QR)
export const otpauthUri = (secret, account, issuer = 'Nuqatak') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SEC}`;

// رموز احتياطية لمرة وحدة (إذا ضاع الجوال): 10 حروف، بتنكتب xxxxx-xxxxx
export const RECOVERY_COUNT = 8;
export const normRecovery = (v) => String(v || '').toLowerCase().replace(/[^a-z2-9]/g, '');
export async function newRecoveryCodes() {
  const codes = Array.from({ length: RECOVERY_COUNT }, () => randomToken(10));
  return { codes: codes.map((c) => `${c.slice(0, 5)}-${c.slice(5)}`), hashes: await Promise.all(codes.map((c) => sha256Hex(`mfa:${c}`))) };
}
export const recoveryHash = (v) => sha256Hex(`mfa:${normRecovery(v)}`);
