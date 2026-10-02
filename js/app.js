// ═══ برنامج محاسبة احسبها: الهيكل والتنقل ═══
import * as store from './store.js';
import { html, setSettings, toast, confirmBox } from './ui.js';
import { SEG, parseHash, guard, setTitle, go } from './nav.js';
import * as auth from './auth.js';
import * as home from './views/home.js';
import * as docs from './views/docs.js';
import * as money from './views/money.js';
import * as ledger from './views/ledger.js';
import * as products from './views/products.js';
import * as parties from './views/parties.js';
import * as reports from './views/reports.js';
import * as settings from './views/settings.js';
import * as pos from './views/pos.js';
import * as importer from './views/importer.js';
import * as collections from './views/collections.js';
import * as users from './views/users.js';
import * as assets from './views/assets.js';
import * as cheques from './views/cheques.js';
import * as recurring from './views/recurring.js';
import * as auditView from './views/audit.js';
import * as payroll from './views/payroll.js';
import * as stockViews from './views/stock.js';
import * as reconcile from './views/reconcile.js';

// ─── المسارات ───
const routes = [];
const on = (pattern, fn) => routes.push({ parts: pattern.split('/').filter(Boolean), fn });

on('', home.dashboard);
on('welcome', home.welcome);
const MODULE = { sale: docs, quote: docs, sreturn: docs, purchase: docs, preturn: docs, sorder: docs, porder: docs, expense: money, receipt: money, payment: money, transfer: money, journal: ledger, adjust: products, payroll, stransfer: stockViews };
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
on('pos', pos.pos);
on('pos/closing', pos.closing);
on('labels', products.labels);
on('import', importer.view);
on('collections', collections.view);
on('users', users.view);
on('assets', assets.list);
on('assets/new', assets.form);
on('assets/:id/edit', assets.form);
on('assets/:id', assets.show);
on('cheques', cheques.view);
on('recurring', recurring.view);
on('audit', auditView.view);
on('employees', payroll.employees);
on('employees/new', payroll.employeeForm);
on('employees/:id/edit', payroll.employeeForm);
on('employees/:id', payroll.employeeShow);
on('reconcile', reconcile.view);

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
  { ic: '🖥️', t: 'الكاشير (نقطة البيع)', h: 'pos' },
  { sec: 'المبيعات' },
  { ic: '🧾', t: 'فواتير المبيعات', h: 'sales' },
  { ic: '📝', t: 'عروض الأسعار', h: 'quotes' },
  { ic: '📋', t: 'أوامر البيع', h: 'sales-orders' },
  { ic: '↩️', t: 'مرتجعات المبيعات', h: 'sales-returns' },
  { ic: '👥', t: 'العملاء', h: 'customers' },
  { ic: '📞', t: 'التحصيل والتذكير', h: 'collections' },
  { sec: 'المشتريات والمصروفات' },
  { ic: '🛒', t: 'فواتير المشتريات', h: 'purchases' },
  { ic: '📋', t: 'أوامر الشراء', h: 'purchase-orders' },
  { ic: '↪️', t: 'مرتجعات المشتريات', h: 'purchase-returns' },
  { ic: '🏭', t: 'الموردون', h: 'suppliers' },
  { ic: '💸', t: 'المصروفات', h: 'expenses' },
  { sec: 'النقدية' },
  { ic: '📥', t: 'سندات القبض', h: 'receipts' },
  { ic: '📤', t: 'سندات الصرف', h: 'payments' },
  { ic: '🔁', t: 'التحويلات', h: 'transfers' },
  { ic: '🧾', t: 'الشيكات', h: 'cheques' },
  { ic: '🏦', t: 'مطابقة البنك', h: 'reconcile' },
  { sec: 'المخزون' },
  { ic: '📦', t: 'المنتجات والخدمات', h: 'products' },
  { ic: '🏷️', t: 'ملصقات الباركود', h: 'labels' },
  { ic: '⚖️', t: 'تسويات المخزون', h: 'adjustments' },
  { ic: '🚚', t: 'التحويلات المخزنية', h: 'stock-transfers', need: 'wh' },
  { sec: 'الموظفون والرواتب' },
  { ic: '👷', t: 'الموظفون', h: 'employees' },
  { ic: '💼', t: 'مسيرات الرواتب', h: 'payroll' },
  { sec: 'المحاسبة والتقارير' },
  { ic: '📒', t: 'قيود اليومية', h: 'journal' },
  { ic: '🗂️', t: 'دليل الحسابات', h: 'accounts' },
  { ic: '🏢', t: 'الأصول الثابتة', h: 'assets' },
  { ic: '♻️', t: 'المستندات المتكررة', h: 'recurring' },
  { ic: '📊', t: 'التقارير', h: 'reports' },
  { ic: '🕘', t: 'سجل التعديلات', h: 'audit' },
  { sec: 'الإدارة' },
  { ic: '📥', t: 'الاستيراد من Excel', h: 'import' },
  { ic: '👤', t: 'المستخدمون', h: 'users' },
  { ic: '⚙️', t: 'الإعدادات', h: 'settings' },
];

// عناصر القائمة المسموحة للمستخدم الحالي، بدون عناوين أقسام فارغة
function navItems() {
  const db = store.getDb();
  const xs = NAV.filter((n) => n.sec || (auth.can(auth.routePerm(n.h)) && (n.need !== 'wh' || (db && db.warehouses.length))));
  return xs.filter((n, i) => !n.sec || (xs[i + 1] && !xs[i + 1].sec));
}

// تثبيت البرنامج كتطبيق (أندرويد والكمبيوتر): المتصفح يعطينا حدثاً نستخدمه عند الضغط على الزر
let installEvt = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (store.getDb()) renderShell(); });
  window.addEventListener('appinstalled', () => { installEvt = null; renderShell(); toast('تم تثبيت البرنامج ✓ تلاقيه بين تطبيقاتك'); });
}

export function renderShell() {
  const db = store.getDb();
  setSettings(db && db.settings);
  const side = document.getElementById('side');
  const brand = html`<a class="side-brand" href="#/"><span class="brand-badge">📒</span><span>احسبها<span class="brand-sub">برنامج المحاسبة</span></span></a>`;
  const foot = html`<div class="side-foot">${installEvt ? html`<button type="button" class="btn btn-primary btn-sm side-install" data-install>📲 ثبّت البرنامج على جهازك</button>` : ''}<p class="muted small" style="padding:0 12px">🔒 بياناتك محفوظة على هذا الجهاز فقط. نزّل نسخة احتياطية من <a href="#/settings">الإعدادات</a> بشكل دوري. <a href="privacy.html">سياسة الخصوصية</a></p></div>`;
  side.innerHTML = String(db
    ? html`${brand}<div class="side-co" title="${db.settings.name}">🏢 ${db.settings.name || 'منشأتي'}</div>
      <nav>${navItems().map((n) => (n.sec ? html`<div class="nav-sec">${n.sec}</div>` : html`<a class="nav-a" data-h="${n.h}" href="#/${n.h}"><span class="ic">${n.ic}</span>${n.t}</a>`))}</nav>${foot}`
    : html`${brand}<nav><a class="nav-a on" href="#/welcome"><span class="ic">👋</span>ابدأ هنا</a></nav>${foot}`);
  const quick = document.getElementById('quick');
  quick.querySelectorAll('.quick-menu a').forEach((a) => { a.hidden = !auth.can(auth.routePerm(a.getAttribute('href'))); });
  quick.hidden = !db || !quick.querySelector('.quick-menu a:not([hidden])');
  const u = auth.currentUser();
  const lockBtn = document.getElementById('lock-btn');
  lockBtn.hidden = !auth.usersEnabled();
  lockBtn.innerHTML = String(html`🔒<span class="hide-sm">${u ? ' ' + u.name : ''}</span>`);
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
let stale = false;
async function render() {
  if (skipNext) { skipNext = false; return; }
  // البرنامج مقفل: لا تُعرض أي صفحة حتى يُدخل الرمز، وتبقى الصفحة الحالية كما هي تحت القفل
  if (auth.isLocked()) { stale = true; return; }
  const { path, query } = parseHash();
  if (guard.dirty && location.hash !== lastHash) {
    const leave = await confirmBox('في تعديلات غير محفوظة على هذه الصفحة. تريد تركها؟', { ok: 'اترك التعديلات', danger: true, title: 'تعديلات غير محفوظة' });
    if (!leave) { skipNext = true; location.hash = lastHash; return; }
  }
  guard.dirty = false;
  lastHash = location.hash;
  document.querySelectorAll('dialog[open]:not(#lock)').forEach((dlg) => dlg.close());
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
  if (db && r && !auth.can(auth.routePerm(path))) {
    if (!path) { go(auth.homePath()); return; }
    setTitle('غير مسموح');
    root.innerHTML = String(html`<div class="empty"><div class="empty-ic">🔒</div><h3>لا تملك صلاحية لهذه الصفحة</h3><p>اطلب من المالك تعديل صلاحياتك من صفحة المستخدمين.</p><p><a href="${auth.homePath()}">العودة</a></p></div>`);
    return;
  }
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

// ─── الوضع الداكن (القيمة الأولى تُضبط في رأس الصفحة) ───
function themeButton() {
  const btn = document.querySelector('.theme-toggle');
  if (btn) btn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️ فاتح' : '🌙 داكن';
}
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('theme', next); } catch (e) { /* يبقى للجلسة الحالية فقط */ }
  themeButton();
}

// المستندات المتكررة المستحقة تُنشأ عند فتح البرنامج
function generateRecurring() {
  if (!store.getDb()) return;
  try {
    const res = store.runRecurring();
    if (res.created.length) toast(`تم إنشاء ${res.created.length} مستند متكرر مستحق ♻️`);
    if (res.errors.length) toast(`تعذّر إنشاء مستند متكرر: ${res.errors[0].msg}`, 'warn');
  } catch (e) { console.error(e); }
}

async function boot() {
  themeButton();
  document.querySelector('.theme-toggle').onclick = toggleTheme;
  document.getElementById('lock-btn').onclick = () => auth.lock();
  await store.load();
  auth.init({
    onChange: (kind) => {
      if (kind === 'lock') return;
      renderShell();
      if (kind === 'switch' || stale) { stale = false; guard.dirty = false; rerender(); }
    },
  });
  renderShell();
  generateRecurring();
  store.gcFiles().catch(() => {});
  window.addEventListener('hashchange', render);
  window.addEventListener('beforeunload', (e) => { if (guard.dirty) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('acc:shell', () => { auth.init(); renderShell(); });
  window.addEventListener('acc:save-failed', () => toast('تعذّر الحفظ على هذا الجهاز. صدّر نسخة احتياطية من الإعدادات فوراً', 'err'));
  store.onExternalChange(() => { auth.init(); renderShell(); if (!guard.dirty) rerender(); toast('تحدّثت البيانات من نافذة أخرى', 'warn'); });
  document.getElementById('menu-btn').onclick = () => document.getElementById('app').classList.toggle('nav-open');
  document.getElementById('side').addEventListener('click', async (e) => {
    if (!e.target.closest('[data-install]') || !installEvt) return;
    const evt = installEvt;
    evt.prompt();
    await evt.userChoice.catch(() => null);
    installEvt = null;
    renderShell();
  });
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
