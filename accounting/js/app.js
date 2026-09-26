// ═══ برنامج محاسبة احسبها: الهيكل والتنقل ═══
import * as store from './store.js';
import { html, setSettings, toast, confirmBox } from './ui.js';
import { SEG, parseHash, guard, setTitle } from './nav.js';
import * as home from './views/home.js';
import * as docs from './views/docs.js';
import * as money from './views/money.js';
import * as ledger from './views/ledger.js';
import * as products from './views/products.js';
import * as parties from './views/parties.js';
import * as reports from './views/reports.js';
import * as settings from './views/settings.js';

// ─── المسارات ───
const routes = [];
const on = (pattern, fn) => routes.push({ parts: pattern.split('/').filter(Boolean), fn });

on('', home.dashboard);
on('welcome', home.welcome);
const MODULE = { sale: docs, quote: docs, sreturn: docs, purchase: docs, preturn: docs, expense: money, receipt: money, payment: money, transfer: money, journal: ledger, adjust: products };
for (const [type, seg] of Object.entries(SEG)) {
  const m = MODULE[type];
  on(seg, (c) => m.list(type, c));
  on(seg + '/new', (c) => m.form(type, c));
  on(seg + '/:id/edit', (c) => m.form(type, c));
  on(seg + '/:id', (c) => m.show(type, c));
}
for (const [seg, kind] of [['customers', 'customer'], ['suppliers', 'supplier']]) {
  on(seg, (c) => parties.list(kind, c));
  on(seg + '/new', (c) => parties.form(kind, c));
  on(seg + '/:id/edit', (c) => parties.form(kind, c));
  on(seg + '/:id', (c) => parties.show(kind, c));
}
on('products', products.productList);
on('products/new', products.productForm);
on('products/:id/edit', products.productForm);
on('products/:id', products.productShow);
on('accounts', ledger.accounts);
on('accounts/:id', ledger.accountShow);
on('daybook', ledger.daybook);
on('reports', reports.index);
on('reports/:name', reports.report);
on('settings', settings.view);

function match(path) {
  const parts = path.split('/').filter(Boolean);
  for (const r of routes) {
    if (r.parts.length !== parts.length) continue;
    const params = {};
    if (r.parts.every((p, i) => (p.startsWith(':') ? (params[p.slice(1)] = parts[i], true) : p === parts[i]))) return { fn: r.fn, params };
  }
  return null;
}

// ─── القائمة الجانبية ───
const NAV = [
  { ic: '🏠', t: 'الرئيسية', h: '' },
  { sec: 'المبيعات' },
  { ic: '🧾', t: 'فواتير المبيعات', h: 'sales' },
  { ic: '📝', t: 'عروض الأسعار', h: 'quotes' },
  { ic: '↩️', t: 'مرتجعات المبيعات', h: 'sales-returns' },
  { ic: '👥', t: 'العملاء', h: 'customers' },
  { sec: 'المشتريات والمصروفات' },
  { ic: '🛒', t: 'فواتير المشتريات', h: 'purchases' },
  { ic: '↪️', t: 'مرتجعات المشتريات', h: 'purchase-returns' },
  { ic: '🏭', t: 'الموردون', h: 'suppliers' },
  { ic: '💸', t: 'المصروفات', h: 'expenses' },
  { sec: 'النقدية' },
  { ic: '📥', t: 'سندات القبض', h: 'receipts' },
  { ic: '📤', t: 'سندات الصرف', h: 'payments' },
  { ic: '🔁', t: 'التحويلات', h: 'transfers' },
  { sec: 'المخزون' },
  { ic: '📦', t: 'المنتجات والخدمات', h: 'products' },
  { ic: '⚖️', t: 'تسويات المخزون', h: 'adjustments' },
  { sec: 'المحاسبة والتقارير' },
  { ic: '📒', t: 'قيود اليومية', h: 'journal' },
  { ic: '🗂️', t: 'دليل الحسابات', h: 'accounts' },
  { ic: '📊', t: 'التقارير', h: 'reports' },
  { ic: '⚙️', t: 'الإعدادات', h: 'settings' },
];

export function renderShell() {
  const db = store.getDb();
  setSettings(db && db.settings);
  const side = document.getElementById('side');
  const brand = html`<a class="side-brand" href="#/"><span class="brand-badge">📒</span><span>احسبها<span class="brand-sub">برنامج المحاسبة</span></span></a>`;
  const foot = html`<div class="side-foot"><a class="nav-a" href="../index.html"><span class="ic">🧮</span>أدوات احسبها المجانية</a></div>`;
  side.innerHTML = String(db
    ? html`${brand}<div class="side-co" title="${db.settings.name}">🏢 ${db.settings.name || 'منشأتي'}</div>
      <nav>${NAV.map((n) => (n.sec ? html`<div class="nav-sec">${n.sec}</div>` : html`<a class="nav-a" data-h="${n.h}" href="#/${n.h}"><span class="ic">${n.ic}</span>${n.t}</a>`))}</nav>${foot}`
    : html`${brand}<nav><a class="nav-a on" href="#/welcome"><span class="ic">👋</span>ابدأ هنا</a></nav>${foot}`);
  document.getElementById('quick').hidden = !db;
  markNav();
}

function markNav() {
  const first = parseHash().path.split('/')[0];
  const seg = first === 'daybook' ? 'journal' : first;
  document.querySelectorAll('.nav-a[data-h]').forEach((a) => a.classList.toggle('on', a.dataset.h === seg));
}

const closeNav = () => document.getElementById('app').classList.remove('nav-open');

// ─── العرض ───
let skipNext = false;
let lastHash = location.hash;
async function render() {
  if (skipNext) { skipNext = false; return; }
  const { path, query } = parseHash();
  if (guard.dirty && location.hash !== lastHash) {
    const leave = await confirmBox('في تعديلات غير محفوظة على هذه الصفحة. تريد تركها؟', { ok: 'اترك التعديلات', danger: true, title: 'تعديلات غير محفوظة' });
    if (!leave) { skipNext = true; location.hash = lastHash; return; }
  }
  guard.dirty = false;
  lastHash = location.hash;
  document.querySelectorAll('dialog[open]').forEach((dlg) => dlg.close());
  document.getElementById('quick').open = false;
  closeNav();

  const view = document.getElementById('view');
  const root = document.createElement('div');
  root.className = 'page';
  view.replaceChildren(root);
  window.scrollTo(0, 0);
  markNav();

  const db = store.getDb();
  let r = match(path);
  if (!db && path !== 'welcome') r = { fn: home.welcome, params: {} };
  if (!r) {
    setTitle('الصفحة غير موجودة');
    root.innerHTML = String(html`<div class="empty"><div class="empty-ic">🧭</div><h3>الصفحة غير موجودة</h3><p><a href="#/">العودة للرئيسية</a></p></div>`);
    return;
  }
  try {
    await r.fn({ root, params: r.params, query, path });
  } catch (e) {
    console.error(e);
    root.innerHTML = String(html`<div class="empty"><div class="empty-ic">⚠️</div><h3>حدث خطأ غير متوقع</h3><p>${e.message || ''}</p><p><a href="#/">العودة للرئيسية</a></p></div>`);
  }
}
export const rerender = () => { lastHash = location.hash; render(); };

async function boot() {
  await store.load();
  renderShell();
  window.addEventListener('hashchange', render);
  window.addEventListener('beforeunload', (e) => { if (guard.dirty) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('acc:shell', renderShell);
  window.addEventListener('acc:save-failed', () => toast('تعذّر الحفظ على هذا الجهاز. صدّر نسخة احتياطية من الإعدادات فوراً', 'err'));
  store.onExternalChange(() => { renderShell(); if (!guard.dirty) rerender(); toast('تحدّثت البيانات من نافذة أخرى', 'warn'); });
  document.getElementById('menu-btn').onclick = () => document.getElementById('app').classList.toggle('nav-open');
  document.getElementById('scrim').onclick = closeNav;
  document.addEventListener('click', (e) => {
    const q = document.getElementById('quick');
    if (q.open && !q.contains(e.target)) q.open = false;
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNav(); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  render();
}

boot();
