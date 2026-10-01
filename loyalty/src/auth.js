// كلمات السر والجلسات. PBKDF2 بـ 100 ألف تكرار (الحد الأعلى المسموح على Cloudflare Workers).
import { b64ToBytes, bytesToB64, fail, parseCookies, randomToken, sha256Hex } from './util.js';

const ITERATIONS = 100000;
const SESSION_DAYS = 30;
export const COOKIE = 'loy_s';
const MAX_FAILED = 8;
const LOCK_MS = 15 * 60 * 1000;

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${bytesToB64(salt)}$${bytesToB64(await derive(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password, stored) {
  const [kind, iter, salt, hash] = String(stored).split('$');
  if (kind !== 'pbkdf2') return false;
  const got = await derive(password, b64ToBytes(salt), Number(iter));
  const want = b64ToBytes(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

export function checkPasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 8) fail(400, 'كلمة السر لازم تكون 8 حروف على الأقل');
  if (password.length > 200) fail(400, 'كلمة السر طويلة كتير');
}

export async function createSession(db, userId) {
  const token = randomToken(32);
  const now = Date.now();
  await db.run('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?', userId, now);
  await db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', await sha256Hex(token), userId, now + SESSION_DAYS * 864e5);
  return token;
}

export function sessionCookie(token, request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  if (!token) return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

export async function currentUser(db, request) {
  const token = parseCookies(request.headers.get('cookie'))[COOKIE];
  if (!token) return null;
  return db.get(
    `SELECT u.id, u.shop_id, u.email, u.name, u.role, u.branch_id FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
    await sha256Hex(token), Date.now(),
  );
}

export async function endSession(db, request) {
  const token = parseCookies(request.headers.get('cookie'))[COOKIE];
  if (token) await db.run('DELETE FROM sessions WHERE token_hash = ?', await sha256Hex(token));
}

// تسجيل الدخول مع قفل مؤقت بعد محاولات فاشلة كتير
export async function login(db, email, password) {
  const user = await db.get('SELECT * FROM users WHERE email = ?', String(email || '').trim().toLowerCase());
  const now = Date.now();
  if (user && user.locked_until > now) fail(429, 'محاولات كتير. جرّب بعد ربع ساعة');
  const ok = user ? await verifyPassword(String(password || ''), user.pw_hash) : (await hashPassword('x'), false);
  if (!ok) {
    if (user) {
      const failed = user.failed + 1;
      await db.run('UPDATE users SET failed = ?, locked_until = ? WHERE id = ?', failed >= MAX_FAILED ? 0 : failed, failed >= MAX_FAILED ? now + LOCK_MS : 0, user.id);
    }
    fail(401, 'الإيميل أو كلمة السر غلط');
  }
  if (user.failed) await db.run('UPDATE users SET failed = 0, locked_until = 0 WHERE id = ?', user.id);
  return user;
}
