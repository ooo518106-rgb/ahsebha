// ═══ التخزين: كل البيانات على جهاز المستخدم (IndexedDB، وبديله localStorage) ═══
import { SCHEMA, defaultAccounts, defaultSettings, buildBooks } from './core.js';

const APP_ID = 'ahsebha-accounting';
const IDB_NAME = 'ahsebha-accounting';
const IDB_STORE = 'kv';
const LS_KEY = 'ahsebha-accounting';

let db = null;
let rev = 0;
let cache = { rev: -1, books: null };
let timer = null;
let backend = 'idb';
let failed = false;
const listeners = new Set();
const tabId = newId();
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(APP_ID) : null;

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
  if (cache.rev !== rev) cache = { rev, books: buildBooks(db) };
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
  };
  if (d.demo) out.demo = true;
  const ids = new Set(out.accounts.map((a) => a.id));
  for (const a of defaultAccounts()) if (a.sys && !ids.has(a.id)) out.accounts.push(a);
  for (const x of out.docs) {
    const n = Number(x.no) || 0;
    if ((out.seq[x.type] || 1) <= n) out.seq[x.type] = n + 1;
  }
  if (out.settings.logo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(out.settings.logo)) out.settings.logo = '';
  return out;
}

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
  try { localStorage.removeItem(LS_KEY); } catch (e) { /* قد لا يكون موجوداً */ }
  if (channel) channel.postMessage({ type: 'saved', from: tabId });
}
export function saveSettings(patch) { mutate((d) => Object.assign(d.settings, patch)); }

// ─── المستندات ───
const pad2 = (n) => String(n).padStart(2, '0');
const timeNow = () => { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };

export function saveDoc(doc) {
  mutate((d) => {
    const i = doc.id ? d.docs.findIndex((x) => x.id === doc.id) : -1;
    if (i >= 0) {
      doc.updatedAt = now();
      d.docs[i] = doc;
      return;
    }
    doc.id = doc.id || newId();
    doc.createdAt = now();
    doc.no = d.seq[doc.type] || 1;
    d.seq[doc.type] = doc.no + 1;
    if (!doc.time) doc.time = timeNow();
    d.docs.push(doc);
  });
  return doc;
}

export function deleteDoc(id) {
  mutate((d) => {
    const doc = d.docs.find((x) => x.id === id);
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

export function patchDoc(id, patch) {
  mutate((d) => { const x = d.docs.find((y) => y.id === id); if (x) Object.assign(x, patch); });
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
    || (x.lines || []).some((l) => l.account === id);
  return db.docs.filter(used).length;
}
export function deleteAccount(id) {
  const a = findAccount(id);
  if (!a) return;
  if (a.sys) throw new Error('هذا حساب أساسي في البرنامج ولا يمكن حذفه');
  if (db.accounts.some((x) => x.parent === id)) throw new Error('احذف الحسابات الفرعية أولاً');
  if (accountUsage(id)) throw new Error('لا يمكن الحذف: الحساب مستخدم في مستندات');
  mutate((d) => { d.accounts = d.accounts.filter((x) => x.id !== id); });
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
