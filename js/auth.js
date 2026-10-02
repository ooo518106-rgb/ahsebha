// ═══ المستخدمون والصلاحيات وقفل الشاشة برمز PIN ═══
// بدون مستخدمين يعمل البرنامج مفتوحاً كما هو. بعد إضافة المالك يُطلب رمز الدخول،
// ولكل مستخدم دور يحدد الشاشات المسموحة. الرمز يُحفظ مجزّأً (PBKDF2) وليس كنص.
// تنبيه: القفل يمنع الاستخدام غير المصرّح به من الواجهة، ولا يشفّر البيانات على الجهاز.
import * as store from './store.js';
import { html } from './ui.js';

export const ROLES = {
  owner: { name: 'المالك', desc: 'كل الصلاحيات، وإدارة المستخدمين والنسخ الاحتياطية' },
  accountant: { name: 'محاسب', desc: 'كل العمليات والتقارير والإعدادات، بدون إدارة المستخدمين أو حذف البيانات' },
  cashier: { name: 'كاشير', desc: 'الكاشير وفواتير البيع والقبض فقط، بدون تعديل أو حذف أو تقارير' },
};
const PERMS = {
  owner: new Set(['*']),
  accountant: new Set(['pos', 'sell', 'buy', 'edit', 'products', 'reports', 'settings']),
  cashier: new Set(['pos', 'sell']),
};

// الصلاحية المطلوبة لكل مسار
const SEG_PERM = {
  pos: 'pos', sales: 'sell', quotes: 'sell', 'sales-returns': 'sell', receipts: 'sell', customers: 'sell',
  purchases: 'buy', 'purchase-returns': 'buy', suppliers: 'buy', expenses: 'buy', payments: 'buy', transfers: 'buy',
  journal: 'buy', daybook: 'buy', adjustments: 'buy', 'sales-orders': 'sell', 'purchase-orders': 'buy',
  assets: 'buy', cheques: 'buy', recurring: 'buy', audit: 'reports',
  employees: 'buy', payroll: 'buy', 'stock-transfers': 'buy', reconcile: 'buy',
  products: 'products', labels: 'products', import: 'products',
  accounts: 'reports', reports: 'reports', collections: 'reports', '': 'reports',
  settings: 'settings', users: 'admin', welcome: null,
};
export function routePerm(path) {
  const parts = String(path || '').replace(/^#?\/?/, '').split('?')[0].split('/').filter(Boolean);
  if (parts[parts.length - 1] === 'edit') return 'edit';
  const seg = parts[0] || '';
  return seg in SEG_PERM ? SEG_PERM[seg] : 'reports';
}

let current = null;
const SESSION = 'ahsebha-session';
const ITER = 150000;

export const usersEnabled = () => !!(store.getDb() && store.getDb().users.length);
export const currentUser = () => (usersEnabled() ? current : null);
export const isLocked = () => usersEnabled() && !current;

export function can(perm) {
  if (!perm) return true;
  if (!usersEnabled()) return true;
  if (!current) return false;
  const p = PERMS[current.role] || PERMS.cashier;
  return p.has('*') || p.has(perm);
}
// الصفحة الأولى المسموحة للمستخدم
export const homePath = () => (can('reports') ? '#/' : can('pos') ? '#/pos' : '#/sales');

// ─── التجزئة ───
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function derive(secret, salt, iter) {
  if (!globalThis.crypto || !crypto.subtle) throw new Error('المتصفح لا يدعم التشفير هنا. افتح البرنامج من رابط آمن (https)');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}
export async function makeSecret(secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: b64(salt), hash: b64(await derive(String(secret), salt, ITER)), iter: ITER };
}
export async function checkSecret(secret, sec) {
  if (!sec || !sec.salt || !sec.hash) return false;
  const got = await derive(String(secret), unb64(sec.salt), Number(sec.iter) || ITER);
  const want = unb64(sec.hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}
export const validPin = (pin) => /^\d{4,8}$/.test(String(pin || ''));

// رمز الاسترجاع: 12 حرفاً سهلة القراءة، يُستخدم إذا نسي المالك رمزه
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeRecoveryCode() {
  const a = crypto.getRandomValues(new Uint8Array(12));
  const s = Array.from(a, (b) => ALPHA[b % ALPHA.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
export const cleanRecovery = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// ─── الجلسة ───
function saveSession() {
  try {
    if (current) sessionStorage.setItem(SESSION, JSON.stringify({ id: current.id, at: Date.now() }));
    else sessionStorage.removeItem(SESSION);
  } catch (e) { /* الجلسة للصفحة الحالية فقط */ }
}
function readSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION) || 'null'); } catch (e) { return null; }
}
const lockMinutes = () => Number(store.getDb()?.settings.lockMinutes ?? 10) || 0;

// onChange(kind): 'lock' عند القفل، 'resume' عند فتحه لنفس المستخدم، 'switch' لمستخدم آخر
let hooks = { onChange: () => {} };
let lastActive = Date.now();
let idleTimer = null;
let lastUserId = null;

function applyUser(u) {
  current = u || null;
  if (current) lastUserId = current.id;
  store.setActor(current ? current.id : null);
  document.documentElement.dataset.role = current ? current.role : 'owner';
  saveSession();
}

// يُستدعى بعد تحميل البيانات أو تغيّرها
export function init(opts) {
  if (opts) hooks = { ...hooks, ...opts };
  if (!usersEnabled()) { applyUser(null); hideLock(); stopIdle(); return; }
  const fresh = current && store.findUser(current.id);
  if (fresh && fresh.active !== false) { applyUser(fresh); startIdle(); return; }
  const sess = readSession();
  const u = sess && store.findUser(sess.id);
  const mins = lockMinutes();
  if (u && u.active !== false && (!mins || Date.now() - sess.at < mins * 60000)) { applyUser(u); startIdle(); return; }
  lock();
}

export function signIn(u) {
  const kind = lastUserId === u.id ? 'resume' : 'switch';
  applyUser(u);
  store.saveUser({ id: u.id, lastLoginAt: new Date().toISOString() });
  lastActive = Date.now();
  hideLock();
  startIdle();
  hooks.onChange(kind);
}

// القفل يغطي الصفحة فقط دون مسحها، فلا يضيع نموذج لم يُحفظ بعد
export function lock() {
  if (!usersEnabled()) return;
  if (!current && document.getElementById('lock')) return;
  applyUser(null);
  showLock();
  hooks.onChange('lock');
}

// ─── القفل التلقائي عند عدم الاستخدام ───
const touch = () => {
  lastActive = Date.now();
  if (current) {
    try { sessionStorage.setItem(SESSION, JSON.stringify({ id: current.id, at: lastActive })); } catch (e) { /* اختياري */ }
  }
};
function startIdle() {
  if (idleTimer) return;
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => window.addEventListener(ev, touch, { passive: true }));
  idleTimer = setInterval(() => {
    const mins = lockMinutes();
    if (current && mins && Date.now() - lastActive > mins * 60000) lock();
  }, 15000);
}
function stopIdle() {
  if (!idleTimer) return;
  clearInterval(idleTimer);
  idleTimer = null;
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => window.removeEventListener(ev, touch));
}

// ─── شاشة القفل ───
let fails = 0;
let waitUntil = 0;

function hideLock() {
  const el = document.getElementById('lock');
  if (!el) return;
  el.dataset.unlocking = '1';
  if (el.open) el.close();
  el.remove();
}

// شاشة القفل نافذة حوار فوق كل شيء (حتى فوق النوافذ المفتوحة)، ولا تُغلق بزر Esc
function showLock() {
  const db = store.getDb();
  const users = db.users.filter((u) => u.active !== false);
  if (!users.length) users.push(...db.users.filter((u) => u.role === 'owner'));
  let el = document.getElementById('lock');
  if (!el) {
    el = document.createElement('dialog');
    el.id = 'lock';
    el.className = 'lock';
    el.setAttribute('aria-label', 'تسجيل الدخول');
    el.addEventListener('cancel', (e) => e.preventDefault());
    el.addEventListener('close', () => { if (!el.dataset.unlocking && el.isConnected && isLocked()) el.showModal(); });
    document.body.append(el);
  }
  if (!el.open) el.showModal();
  let sel = users.length === 1 ? users[0] : null;
  const initials = (n) => String(n).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('');

  function draw(mode = 'pin') {
    el.innerHTML = String(html`<div class="lock-box" aria-label="تسجيل الدخول">
      <div class="lock-brand"><span class="brand-badge">📒</span><div><b>${db.settings.name || 'احسبها'}</b><small>برنامج المحاسبة</small></div></div>
      ${mode === 'recover' ? html`
        <h2>استرجاع دخول المالك</h2>
        <p class="muted small">اكتب رمز الاسترجاع الذي ظهر لك عند تفعيل المستخدمين (مثل ABCD-EFGH-JKLM).</p>
        <form data-rec novalidate><input class="inp lock-code" name="code" dir="ltr" autocomplete="off" autocapitalize="characters" placeholder="XXXX-XXXX-XXXX" autofocus>
          <div class="lock-actions"><button class="btn btn-primary">دخول</button><button type="button" class="btn btn-ghost" data-back>رجوع</button></div></form>`
      : html`
        ${sel ? '' : html`<h2>اختر المستخدم</h2>`}
        <div class="lock-users">${users.map((u) => html`<button type="button" class="lock-user ${sel && sel.id === u.id ? 'on' : ''}" data-u="${u.id}"><span class="av">${initials(u.name)}</span><span>${u.name}<small>${ROLES[u.role]?.name || ''}</small></span></button>`)}</div>
        ${sel ? html`<form data-pin novalidate>
          <label class="lock-l" for="lock-pin">رمز الدخول لـ ${sel.name}</label>
          <input class="inp lock-pin" id="lock-pin" name="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8" dir="ltr">
          <div class="pad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => html`<button type="button" data-k="${k}">${k}</button>`)}</div>
          <div class="lock-actions"><button class="btn btn-primary">🔓 دخول</button></div></form>` : ''}
        <button type="button" class="lock-forgot" data-forgot>نسيت الرمز؟</button>`}
      <p class="fld-e lock-msg" data-msg role="alert"></p>
    </div>`);
    const pin = el.querySelector('#lock-pin');
    if (pin) setTimeout(() => pin.focus(), 30);
    const code = el.querySelector('.lock-code');
    if (code) setTimeout(() => code.focus(), 30);
  }

  const msg = (t) => { const m = el.querySelector('[data-msg]'); if (m) m.textContent = t; };
  el.onclick = (e) => {
    const u = e.target.closest('[data-u]');
    if (u) { sel = users.find((x) => x.id === u.dataset.u); draw(); return; }
    const k = e.target.closest('[data-k]');
    if (k) {
      const pin = el.querySelector('#lock-pin');
      if (k.dataset.k === 'C') pin.value = '';
      else if (k.dataset.k === '⌫') pin.value = pin.value.slice(0, -1);
      else if (pin.value.length < 8) pin.value += k.dataset.k;
      pin.focus();
      return;
    }
    if (e.target.closest('[data-forgot]')) {
      if (!store.getDb().recovery || (sel && sel.role !== 'owner')) { msg('اطلب من المالك الدخول وتغيير رمزك من صفحة المستخدمين.'); return; }
      draw('recover');
      return;
    }
    if (e.target.closest('[data-back]')) draw();
  };
  el.onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    if (Date.now() < waitUntil) { msg(`محاولات كثيرة. انتظر ${Math.ceil((waitUntil - Date.now()) / 1000)} ثانية`); return; }
    const btn = f.querySelector('.btn-primary');
    btn.disabled = true;
    try {
      if (f.matches('[data-pin]')) {
        const ok = await checkSecret(f.pin.value, sel.pin);
        if (ok) { fails = 0; signIn(store.findUser(sel.id)); return; }
        f.pin.value = '';
      } else {
        const ok = await checkSecret(cleanRecovery(f.code.value), store.getDb().recovery);
        const owner = store.getDb().users.find((u) => u.role === 'owner' && u.active !== false) || store.getDb().users.find((u) => u.role === 'owner');
        if (ok && owner) {
          fails = 0;
          if (owner.active === false) store.saveUser({ id: owner.id, active: true });
          signIn(store.findUser(owner.id));
          location.hash = '#/users?reset=1';
          return;
        }
      }
      fails++;
      if (fails >= 5) { waitUntil = Date.now() + 30000; fails = 0; msg('محاولات خاطئة كثيرة. انتظر 30 ثانية ثم حاول مجدداً'); }
      else msg(f.matches('[data-pin]') ? 'الرمز غير صحيح' : 'رمز الاسترجاع غير صحيح');
    } catch (err) { msg(err.message || String(err)); }
    finally { btn.disabled = false; }
  };
  draw();
}
