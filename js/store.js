// ═══ التخزين: كل البيانات على جهاز المستخدم (IndexedDB، وبديله localStorage) ═══
import { SCHEMA, defaultAccounts, defaultSettings, buildBooks, validateDoc, isLockedDate, docAmount, currencyInfo, ymd, addDays, addMonths, monthStart, monthEnd, daysBetween, isDate } from './core.js';

const APP_ID = 'ahsebha-accounting';
const IDB_NAME = 'ahsebha-accounting';
const IDB_STORE = 'kv';
const LS_KEY = 'ahsebha-accounting';

let db = null;
let rev = 0;
let cache = { rev: -1, day: '', books: null };
let timer = null;
let backend = 'idb';
let failed = false;
const listeners = new Set();
const tabId = newId();
const channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(APP_ID) : null;

export function newId() {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Date.now().toString(36) + Array.from(a, (b) => (b % 36).toString(36)).join('');
}
const now = () => new Date().toISOString();
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
// المعرّفات تدخل في الروابط، فنقبل فقط الحروف اللاتينية والأرقام و _ : -
const okId = (x) => typeof x.id === 'string' && /^[\w:-]{1,80}$/.test(x.id);
const arr = (x) => (Array.isArray(x) ? x.filter((y) => isObj(y) && okId(y)) : []);

export const getDb = () => db;
export function getBooks() {
  const day = ymd(new Date());
  if (cache.rev !== rev || cache.day !== day) cache = { rev, day, books: buildBooks(db, { today: day }) };
  return cache.books;
}
export const onExternalChange = (fn) => listeners.add(fn);

// ─── IndexedDB ───
let idbPromise = null;
function idb() {
  if (!idbPromise) {
    idbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('indexedDB unavailable'));
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('blocked'));
    });
  }
  return idbPromise;
}
async function idbOp(mode, fn) {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(IDB_STORE, mode);
    const req = fn(tx.objectStore(IDB_STORE));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function load() {
  let data = null;
  try { data = await idbOp('readonly', (s) => s.get('db')); backend = 'idb'; } catch (e) { backend = 'ls'; }
  if (!data) {
    try { const s = localStorage.getItem(LS_KEY); if (s) data = JSON.parse(s); } catch (e) { /* لا شيء محفوظ */ }
  }
  db = data ? normalize(data) : null;
  rev++;
  return db;
}

async function write() {
  timer = null;
  if (!db) return;
  try {
    if (backend === 'idb') await idbOp('readwrite', (s) => s.put(db, 'db'));
    else localStorage.setItem(LS_KEY, JSON.stringify(db));
    failed = false;
    if (channel) channel.postMessage({ type: 'saved', from: tabId });
  } catch (e) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(db));
      backend = 'ls';
      failed = false;
    } catch (e2) {
      failed = true;
      window.dispatchEvent(new CustomEvent('acc:save-failed'));
    }
  }
}
function schedule() {
  if (typeof window === 'undefined') return; // الاختبارات في Node: بلا حفظ
  clearTimeout(timer);
  timer = setTimeout(write, 200);
}
export function flush() {
  if (timer) { clearTimeout(timer); return write(); }
  return Promise.resolve();
}
export const saveFailed = () => failed;

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}
if (channel) {
  channel.onmessage = async (e) => {
    if (!e.data || e.data.from === tabId) return;
    if (timer) await flush();
    await load();
    listeners.forEach((fn) => fn());
  };
}

function requestPersist() {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* اختياري */ }
}

// ─── ضبط شكل البيانات (للنسخ القديمة والملفات المستوردة) ───
export function normalize(d) {
  const out = {
    app: APP_ID,
    schema: SCHEMA,
    createdAt: d.createdAt || now(),
    updatedAt: d.updatedAt || now(),
    settings: defaultSettings(isObj(d.settings) ? d.settings : {}),
    accounts: arr(d.accounts).length ? arr(d.accounts) : defaultAccounts(),
    parties: arr(d.parties),
    products: arr(d.products),
    docs: arr(d.docs).filter((x) => typeof x.type === 'string'),
    seq: isObj(d.seq) ? { ...d.seq } : {},
    users: arr(d.users).filter((u) => typeof u.name === 'string' && isObj(u.pin)),
    recovery: isObj(d.recovery) ? d.recovery : null,
    assets: arr(d.assets).filter((a) => typeof a.name === 'string'),
    employees: arr(d.employees).filter((x) => typeof x.name === 'string'),
    warehouses: arr(d.warehouses).filter((x) => typeof x.name === 'string'),
    centers: arr(d.centers).filter((x) => typeof x.name === 'string'),
    recons: arr(d.recons).filter((x) => typeof x.account === 'string'),
    recurring: arr(d.recurring).filter((r) => isObj(r.src) && typeof r.src.type === 'string'),
    audit: arr(d.audit).slice(-AUDIT_MAX),
  };
  if (d.demo) out.demo = true;
  const byId = new Map(out.accounts.map((a) => [a.id, a]));
  // حسابات النظام الجديدة تُضاف للدليل القديم، والموجود منها يصير أساسياً لا يُحذف
  for (const a of defaultAccounts()) {
    if (!a.sys) continue;
    if (!byId.has(a.id)) out.accounts.push(a);
    else byId.get(a.id).sys = true;
  }
  for (const x of out.docs) {
    const n = Number(x.no) || 0;
    if ((out.seq[x.type] || 1) <= n) out.seq[x.type] = n + 1;
    if (x.files != null) x.files = cleanFiles(x.files);
  }
  if (out.settings.logo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(out.settings.logo)) out.settings.logo = '';
  return out;
}

// وصف المرفقات على المستند: معرّف آمن واسم ونوع وحجم فقط
export const cleanFiles = (xs) => (Array.isArray(xs) ? xs : [])
  .filter((f) => isObj(f) && typeof f.id === 'string' && /^[\w-]{1,40}$/.test(f.id))
  .map((f) => ({ id: f.id, name: String(f.name || 'مرفق').slice(0, 120), type: /^[\w.+-]+\/[\w.+-]+$/.test(f.type || '') ? f.type : 'application/octet-stream', size: Number(f.size) || 0 }))
  .slice(0, 30);

function mutate(fn) {
  fn(db);
  db.updatedAt = now();
  rev++;
  schedule();
}

// ─── الشركة ───
export function createCompany(settings, extra = {}) {
  db = normalize({ settings: defaultSettings(settings), accounts: defaultAccounts(), ...extra });
  rev++;
  schedule();
  requestPersist();
  return db;
}
export function replaceDb(data) {
  db = normalize(data);
  rev++;
  schedule();
  requestPersist();
}
export async function wipe() {
  clearTimeout(timer);
  timer = null;
  db = null;
  rev++;
  try { await idbOp('readwrite', (s) => s.delete('db')); } catch (e) { /* قد لا يكون موجوداً */ }
  try { await deleteFiles(await fileIds()); } catch (e) { /* لا مرفقات */ }
  try { localStorage.removeItem(LS_KEY); } catch (e) { /* قد لا يكون موجوداً */ }
  if (channel) channel.postMessage({ type: 'saved', from: tabId });
}
export function saveSettings(patch) { mutate((d) => Object.assign(d.settings, patch)); }
// قفل الفترات يُسجَّل في سجل التعديلات (من قفل ومن فتح)
export function setLockDate(date) {
  mutate((d) => {
    const before = d.settings.lockDate || '';
    d.settings.lockDate = date || '';
    d.audit.push({ id: newId(), at: now(), by: actor, act: 'lock', type: 'settings', doc: '', no: 0, date: date || '', amount: 0, from: before });
    if (d.audit.length > AUDIT_MAX) d.audit.splice(0, d.audit.length - AUDIT_MAX);
  });
}

// ─── سجل التعديلات: من أضاف أو عدّل أو حذف، ومتى، ونسخة المستند قبل التغيير ───
const AUDIT_MAX = 1500;
function audit(d, act, doc, before) {
  const dec = currencyInfo(d.settings.currency).dec;
  d.audit.push({ id: newId(), at: now(), by: actor, act, type: doc.type, doc: doc.id, no: doc.no, date: doc.date, amount: docAmount(doc, dec), ...(before ? { before } : {}) });
  if (d.audit.length > AUDIT_MAX) d.audit.splice(0, d.audit.length - AUDIT_MAX);
}
const snapshot = (x) => JSON.parse(JSON.stringify(x));

// الفترة المقفلة: الحماية الأخيرة بعد التحقق في الشاشات
function assertOpen(doc) {
  if (doc && isLockedDate(db.settings, doc.date)) throw new Error(`الفترة مقفلة حتى ${db.settings.lockDate}. لا يمكن إضافة أو تعديل أو حذف مستند بتاريخ ${doc.date}`);
}
export const isLockedDoc = (doc) => !!(db && doc && isLockedDate(db.settings, doc.date));

// ─── المستندات ───
const pad2 = (n) => String(n).padStart(2, '0');
const timeNow = () => { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };

// المستخدم الحالي يُسجَّل على المستندات (من أنشأها ومن عدّلها)
let actor = null;
export const setActor = (id) => { actor = id || null; };

export function saveDoc(doc) {
  const old = doc.id ? db.docs.find((x) => x.id === doc.id) : null;
  assertOpen(old);
  assertOpen(doc);
  mutate((d) => {
    const i = doc.id ? d.docs.findIndex((x) => x.id === doc.id) : -1;
    if (i >= 0) {
      doc.updatedAt = now();
      if (actor) doc.editedBy = actor;
      audit(d, 'update', doc, snapshot(d.docs[i]));
      d.docs[i] = doc;
      return;
    }
    doc.id = doc.id || newId();
    doc.createdAt = now();
    if (actor) doc.by = actor;
    doc.no = d.seq[doc.type] || 1;
    d.seq[doc.type] = doc.no + 1;
    if (!doc.time) doc.time = timeNow();
    d.docs.push(doc);
    audit(d, 'create', doc);
  });
  return doc;
}

export function deleteDoc(id) {
  const gone = db.docs.find((x) => x.id === id);
  assertOpen(gone);
  if (gone && gone.files && gone.files.length) deleteFiles(gone.files.map((f) => f.id)).catch(() => {});
  mutate((d) => {
    const doc = d.docs.find((x) => x.id === id);
    if (doc) audit(d, 'delete', doc, snapshot(doc));
    d.docs = d.docs.filter((x) => x.id !== id);
    if (doc && d.seq[doc.type] === doc.no + 1) d.seq[doc.type] = doc.no;
    for (const x of d.docs) {
      if (x.refId === id) x.refId = null;
      if (x.link === id) x.link = null;
      if (x.convertedTo === id) x.convertedTo = null;
      if (x.fromQuote === id) x.fromQuote = null;
    }
  });
}

export function patchDoc(id, patch, { log = false } = {}) {
  mutate((d) => {
    const x = d.docs.find((y) => y.id === id);
    if (!x) return;
    const before = log ? snapshot(x) : null;
    Object.assign(x, patch);
    if (log) audit(d, 'update', x, before);
  });
}

export const findDoc = (id) => (db ? db.docs.find((x) => x.id === id) : null);

// ─── العملاء والموردون ───
export const findParty = (id) => (db ? db.parties.find((x) => x.id === id) : null);
export function saveParty(p) {
  mutate((d) => {
    const i = p.id ? d.parties.findIndex((x) => x.id === p.id) : -1;
    if (i >= 0) d.parties[i] = { ...d.parties[i], ...p };
    else { p.id = p.id || newId(); p.createdAt = now(); d.parties.push(p); }
  });
  return p;
}
export const partyUsage = (id) => db.docs.filter((x) => x.party === id || (x.lines || []).some((l) => l.party === id)).length;
export function deleteParty(id) {
  if (partyUsage(id)) throw new Error('لا يمكن الحذف: توجد مستندات مسجلة لهذا الطرف');
  mutate((d) => { d.parties = d.parties.filter((x) => x.id !== id); });
}

// ─── المنتجات ───
export const findProduct = (id) => (db ? db.products.find((x) => x.id === id) : null);
export function saveProduct(p) {
  mutate((d) => {
    const i = p.id ? d.products.findIndex((x) => x.id === p.id) : -1;
    if (i >= 0) d.products[i] = { ...d.products[i], ...p };
    else { p.id = p.id || newId(); p.createdAt = now(); d.products.push(p); }
  });
  return p;
}
export const productUsage = (id) => db.docs.filter((x) => (x.lines || []).some((l) => l.product === id)).length;
export function deleteProduct(id) {
  if (productUsage(id)) throw new Error('لا يمكن الحذف: المنتج مستخدم في مستندات. يمكنك إيقافه بدلاً من ذلك');
  mutate((d) => { d.products = d.products.filter((x) => x.id !== id); });
}

// ─── الحسابات ───
export const findAccount = (id) => (db ? db.accounts.find((x) => x.id === id) : null);
export function saveAccount(a) {
  mutate((d) => {
    const i = a.id ? d.accounts.findIndex((x) => x.id === a.id) : -1;
    if (i >= 0) d.accounts[i] = { ...d.accounts[i], ...a };
    else { a.id = a.id || 'a' + newId(); d.accounts.push(a); }
  });
  return a;
}
export function accountUsage(id) {
  const used = (x) => x.account === id || x.payAcc === id || x.money === id || x.from === id || x.to === id
    || (x.lines || []).some((l) => l.account === id) || (x.payments || []).some((p) => p.acc === id);
  return db.docs.filter(used).length;
}
export function deleteAccount(id) {
  const a = findAccount(id);
  if (!a) return;
  if (a.sys) throw new Error('هذا حساب أساسي في البرنامج ولا يمكن حذفه');
  if (db.accounts.some((x) => x.parent === id)) throw new Error('احذف الحسابات الفرعية أولاً');
  if (accountUsage(id)) throw new Error('لا يمكن الحذف: الحساب مستخدم في مستندات');
  if (db.assets.some((x) => x.account === id || (x.disposed && x.disposed.money === id))) throw new Error('لا يمكن الحذف: الحساب مستخدم في سجل الأصول');
  mutate((d) => { d.accounts = d.accounts.filter((x) => x.id !== id); });
}

// ─── الاستيراد: إضافة وتحديث دفعة واحدة ───
// items: [{ id?, ...الحقول }]؛ بوجود id يُحدَّث السجل، وإلا يُضاف جديداً
export function importRecords(kind, items) {
  const key = kind === 'products' ? 'products' : 'parties';
  let added = 0, updated = 0;
  mutate((d) => {
    const index = new Map(d[key].map((x, i) => [x.id, i]));
    for (const it of items) {
      if (it.id && index.has(it.id)) { const i = index.get(it.id); d[key][i] = { ...d[key][i], ...it }; updated++; }
      else { const x = { ...it, id: newId(), createdAt: now() }; index.set(x.id, d[key].push(x) - 1); added++; }
    }
  });
  return { added, updated };
}

// ─── الأصول الثابتة ───
export const findAsset = (id) => (db ? db.assets.find((x) => x.id === id) : null);
export function saveAsset(a) {
  mutate((d) => {
    const i = a.id ? d.assets.findIndex((x) => x.id === a.id) : -1;
    if (i >= 0) d.assets[i] = { ...d.assets[i], ...a };
    else { a.id = a.id || 'as' + newId(); a.createdAt = now(); a.no = d.assets.reduce((m, x) => Math.max(m, x.no || 0), 0) + 1; d.assets.push(a); }
  });
  return a;
}
export function deleteAsset(id) { mutate((d) => { d.assets = d.assets.filter((x) => x.id !== id); }); }

// ─── المستندات المتكررة ───
// r: { name, src (قالب المستند), freq: week|month|quarter|year, next, until, day, dueDays, active, count, last }
export function nextRun(date, freq, day) {
  if (freq === 'week') return addDays(date, 7);
  const months = freq === 'quarter' ? 3 : freq === 'year' ? 12 : 1;
  const m = addMonths(monthStart(date), months);
  const last = Number(monthEnd(m).slice(8));
  return m.slice(0, 8) + String(Math.min(Number(day) || Number(date.slice(8)), last)).padStart(2, '0');
}
const DROP = ['id', 'no', 'createdAt', 'updatedAt', 'time', 'by', 'editedBy', 'convertedTo', 'fromQuote', 'refId', 'link', 'tendered', 'change', 'pos', 'recurring', 'cleared', 'bounced', 'files', 'scan'];
export function templateOf(doc) {
  const t = snapshot(doc);
  for (const k of DROP) delete t[k];
  return t;
}
export const findRecurring = (id) => (db ? db.recurring.find((x) => x.id === id) : null);
export function saveRecurring(r) {
  mutate((d) => {
    const i = r.id ? d.recurring.findIndex((x) => x.id === r.id) : -1;
    if (i >= 0) d.recurring[i] = { ...d.recurring[i], ...r };
    else { r.id = 'rc' + newId(); r.createdAt = now(); r.count = 0; d.recurring.push(r); }
  });
  return r;
}
export function deleteRecurring(id) { mutate((d) => { d.recurring = d.recurring.filter((x) => x.id !== id); }); }
// تعديل في مكانه (نفس الكائن) حتى تبقى الحلقة تقرأ القيم الجديدة
function patchRecurring(r, patch) { mutate(() => { Object.assign(r, patch); }); }

// ينشئ المستندات المستحقة حتى اليوم (عند فتح البرنامج)؛ يتوقف القالب عند أول خطأ ويُظهره
export function runRecurring(today = ymd(new Date()), { only } = {}) {
  const out = { created: [], errors: [] };
  if (!db) return out;
  for (const r of db.recurring) {
    if (r.active === false || (only && r.id !== only)) continue;
    let n = 0;
    while (isDate(r.next) && r.next <= today && (!r.until || r.next <= r.until) && n++ < 60) {
      const doc = { ...snapshot(r.src), date: r.next, recurring: r.id };
      if (r.dueDays != null && r.dueDays !== '') doc.dueDate = addDays(r.next, Number(r.dueDays));
      if (doc.validUntil) doc.validUntil = addDays(r.next, 15);
      const errs = validateDoc(db, doc);
      const msg = Object.values(errs)[0];
      if (msg) { patchRecurring(r, { error: msg }); out.errors.push({ r, msg }); break; }
      saveDoc(doc);
      out.created.push(doc);
      patchRecurring(r, { count: (r.count || 0) + 1, last: r.next, next: nextRun(r.next, r.freq, r.day), error: '' });
    }
    if (r.until && isDate(r.next) && r.next > r.until && r.active !== false) patchRecurring(r, { active: false });
  }
  return out;
}
export const recurringDue = (today = ymd(new Date())) => (db ? db.recurring.filter((r) => r.active !== false && isDate(r.next) && r.next <= today).length : 0);
export const daysUntil = (date) => daysBetween(ymd(new Date()), date);

// ─── الموظفون ───
export const findEmployee = (id) => (db ? db.employees.find((x) => x.id === id) : null);
export function saveEmployee(e) {
  mutate((d) => {
    const i = e.id ? d.employees.findIndex((x) => x.id === e.id) : -1;
    if (i >= 0) d.employees[i] = { ...d.employees[i], ...e };
    else { e.id = 'em' + newId(); e.createdAt = now(); e.no = d.employees.reduce((m, x) => Math.max(m, x.no || 0), 0) + 1; d.employees.push(e); }
  });
  return e;
}
export const employeeUsage = (id) => db.docs.filter((x) => x.employee === id || (x.type === 'payroll' && (x.lines || []).some((l) => l.employee === id))).length;
export function deleteEmployee(id) {
  if (employeeUsage(id)) throw new Error('لا يمكن الحذف: للموظف مسيرات أو سلف مسجلة. يمكنك إيقافه بدلاً من ذلك');
  mutate((d) => { d.employees = d.employees.filter((x) => x.id !== id); });
}

// ─── المستودعات والفروع (مراكز التكلفة) ───
// kind: warehouses | centers
export function saveListItem(kind, item) {
  mutate((d) => {
    const i = item.id ? d[kind].findIndex((x) => x.id === item.id) : -1;
    if (i >= 0) d[kind][i] = { ...d[kind][i], ...item };
    else { item.id = (kind === 'warehouses' ? 'wh' : 'cc') + newId(); d[kind].push(item); }
  });
  return item;
}
export function listItemUsage(kind, id) {
  if (kind === 'warehouses') return db.docs.filter((x) => x.wh === id || x.from === id || x.to === id).length;
  return db.docs.filter((x) => x.cc === id || (x.lines || []).some((l) => l.cc === id)).length + db.employees.filter((x) => x.cc === id).length + db.assets.filter((x) => x.cc === id).length;
}
export function deleteListItem(kind, id) {
  if (listItemUsage(kind, id)) throw new Error('لا يمكن الحذف: مستخدم في مستندات. يمكنك إعادة تسميته');
  mutate((d) => { d[kind] = d[kind].filter((x) => x.id !== id); });
}

// ─── مطابقة البنك ───
export const findRecon = (id) => (db ? db.recons.find((x) => x.id === id) : null);
export function saveRecon(r) {
  mutate((d) => {
    const i = r.id ? d.recons.findIndex((x) => x.id === r.id) : -1;
    if (i >= 0) d.recons[i] = { ...d.recons[i], ...r };
    else { r.id = 'rn' + newId(); r.createdAt = now(); r.by = actor; d.recons.push(r); }
  });
  return r;
}
export function deleteRecon(id) { mutate((d) => { d.recons = d.recons.filter((x) => x.id !== id); }); }

// ─── المستخدمون ───
export const findUser = (id) => (db && id ? db.users.find((x) => x.id === id) : null);
export function saveUser(u) {
  mutate((d) => {
    const i = u.id ? d.users.findIndex((x) => x.id === u.id) : -1;
    if (i >= 0) d.users[i] = { ...d.users[i], ...u };
    else { u.id = u.id || 'u' + newId(); u.createdAt = now(); d.users.push(u); }
  });
  return u;
}
export function deleteUser(id) { mutate((d) => { d.users = d.users.filter((x) => x.id !== id); }); }
export function setRecovery(secret) { mutate((d) => { d.recovery = secret; }); }
export function clearUsers() { mutate((d) => { d.users = []; d.recovery = null; }); }

// ─── المرفقات: صور الإيصالات والفواتير وملفات PDF ───
// تُحفظ في IndexedDB بجانب البيانات (المفتاح file:<id>) والمستند يحمل وصفها فقط: files: [{ id, name, type, size }]
export const filesSupported = () => typeof indexedDB !== 'undefined' && backend === 'idb';
export async function putFile(meta, blob) {
  const rec = { ...meta, data: await blob.arrayBuffer() };
  await idbOp('readwrite', (s) => s.put(rec, 'file:' + meta.id));
  return meta;
}
export async function getFile(id) {
  const rec = await idbOp('readonly', (s) => s.get('file:' + id));
  return rec ? new Blob([rec.data], { type: rec.type || 'application/octet-stream' }) : null;
}
export async function deleteFiles(ids) {
  if (!ids.length || typeof indexedDB === 'undefined') return;
  await idbOp('readwrite', (s) => { ids.forEach((id) => s.delete('file:' + id)); });
}
export async function fileIds() {
  if (typeof indexedDB === 'undefined') return [];
  const keys = await idbOp('readonly', (s) => s.getAllKeys());
  return (keys || []).filter((k) => typeof k === 'string' && k.startsWith('file:')).map((k) => k.slice(5));
}
export const usedFileIds = () => new Set((db ? db.docs : []).flatMap((d) => (d.files || []).map((f) => f.id)));
// يحذف الملفات التي لا يشير إليها أي مستند (نموذج أُلغي، أو مرفق أُزيل) بعد يوم من رفعها
export async function gcFiles() {
  if (!db || !filesSupported()) return 0;
  const used = usedFileIds();
  const old = Date.now() - 864e5;
  const orphans = (await fileIds()).filter((id) => !used.has(id) && !(parseInt(id.slice(0, 8), 36) > old));
  await deleteFiles(orphans);
  return orphans.length;
}

// الملفات المشتركة من تطبيق آخر (مشاركة صورة إيصال إلى البرنامج): يضعها عامل الخدمة هنا
export async function takeShared() {
  if (typeof indexedDB === 'undefined') return [];
  const rec = await idbOp('readonly', (s) => s.get('shared'));
  if (!rec) return [];
  await idbOp('readwrite', (s) => s.delete('shared'));
  return (rec.files || []).map((f) => new File([f.data], f.name || 'receipt.jpg', { type: f.type || 'image/jpeg' }));
}

// ─── النسخ الاحتياطي ───
export function backupJSON() {
  saveSettings({ lastBackupAt: now() });
  return JSON.stringify({ ...db, exportedAt: now() });
}
export function parseBackup(text) {
  let d;
  try { d = JSON.parse(text); } catch (e) { throw new Error('الملف ليس نسخة احتياطية صالحة'); }
  if (!isObj(d) || d.app !== APP_ID || !Array.isArray(d.docs)) throw new Error('هذا الملف ليس نسخة احتياطية من برنامج محاسبة احسبها');
  if ((Number(d.schema) || 1) > SCHEMA) throw new Error('النسخة من إصدار أحدث. حدّث الصفحة ثم حاول مجدداً');
  return normalize(d);
}
