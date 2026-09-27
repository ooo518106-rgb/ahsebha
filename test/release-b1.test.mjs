import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBooks, defaultAccounts, defaultSettings, trialBalance, balances, validateDoc, assetSchedule, assetAccum,
  zakatEstimate, docAmount, isLockedDate, lineFactor, partyStatement, balanceSheet, nextAccountCode,
} from '../js/core.js';

let seq = 0;
const doc = (o) => ({ id: 'd' + (++seq), createdAt: `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`, ...o });
function makeDb(docs = [], extra = {}) {
  return { settings: defaultSettings({ name: 'تجربة', startDate: '2026-01-01', vat: false, vatRate: 0 }), accounts: defaultAccounts(), parties: [], products: [], docs, ...extra };
}
const bal = (B, id, o) => (balances(B, o).get(id) || { close: 0 }).close;
const balanced = (db, B) => { const t = trialBalance(db, B, {}).totals; return Math.abs(t.dr - t.cr) < 0.005 && Math.abs(t.closeDr - t.closeCr) < 0.005; };

test('الوحدات المتعددة: المخزون بالوحدة الأساسية والتكلفة لكل حبة', () => {
  seq = 0;
  const db = makeDb();
  db.products.push({ id: 'p', name: 'ماء', type: 'stock', price: 2, cost: 1, openQty: 0, units: [{ name: 'كرتون', factor: 12, price: 20 }] });
  db.docs.push(doc({ type: 'purchase', date: '2026-01-02', party: null, vatRate: 0, lines: [{ product: 'p', qty: 10, price: 12, unit: 'كرتون', factor: 12 }], paid: 120, payAcc: 'cash' }));
  db.docs.push(doc({ type: 'sale', date: '2026-01-03', party: null, vatRate: 0, lines: [{ product: 'p', qty: 2, price: 20, unit: 'كرتون', factor: 12 }, { product: 'p', qty: 5, price: 2 }], paid: 50, payAcc: 'cash' }));
  const B = buildBooks(db, { today: '2026-02-01' });
  const s = B.stock.get('p');
  assert.equal(s.qty, 120 - 24 - 5);
  assert.equal(s.value, 91);
  const c = B.lineCosts.get(db.docs[1].id);
  assert.equal(c[0].cost, 24);
  assert.equal(c[1].cost, 5);
  assert.equal(lineFactor({}), 1);
  assert.ok(balanced(db, B));
  const bad = validateDoc(db, { type: 'sale', date: '2026-01-05', vatRate: 0, lines: [{ product: 'p', qty: 1, price: 1, factor: -2 }], paid: 1, payAcc: 'cash' });
  assert.ok(bad.qty0);
});

test('الشيكات المؤجلة: تحت التحصيل ثم تحصيل أو ارتجاع', () => {
  seq = 0;
  const db = makeDb();
  db.parties.push({ id: 'c', kind: 'customer', name: 'عميل', opening: 0 }, { id: 's', kind: 'supplier', name: 'مورد', opening: 0 });
  const inv = doc({ type: 'sale', date: '2026-01-02', party: 'c', vatRate: 0, lines: [{ desc: 'خدمة', qty: 1, price: 1000 }], paid: 0, payAcc: null });
  const r1 = doc({ type: 'receipt', date: '2026-01-05', party: 'c', amount: 600, money: 'bank', method: 'cheque', chequeNo: '111', pdc: true, chequeDue: '2026-02-01' });
  const r2 = doc({ type: 'receipt', date: '2026-01-06', party: 'c', amount: 400, money: 'bank', method: 'cheque', chequeNo: '222', pdc: true, chequeDue: '2026-02-10' });
  const pay = doc({ type: 'payment', date: '2026-01-07', party: 's', amount: 300, money: 'bank', method: 'cheque', chequeNo: '9', pdc: true, chequeDue: '2026-03-01' });
  db.docs.push(inv, r1, r2, pay);
  let B = buildBooks(db, { today: '2026-01-31' });
  assert.equal(bal(B, 'chq_in'), 1000);
  assert.equal(bal(B, 'bank'), 0);
  assert.equal(bal(B, 'chq_out'), -300);
  assert.equal(B.status.get(inv.id).state, 'paid', 'الفاتورة مسددة بالشيكات');
  assert.equal(validateDoc(db, { ...r1, chequeDue: '' }).chequeDue, 'اكتب تاريخ استحقاق الشيك');
  // تحصيل الأول، وارتجاع الثاني، وصرف شيكنا
  r1.cleared = '2026-02-01';
  r2.bounced = '2026-02-11';
  pay.cleared = '2026-03-02';
  B = buildBooks(db, { today: '2026-03-31' });
  assert.equal(bal(B, 'chq_in'), 0);
  assert.equal(bal(B, 'chq_out'), 0);
  assert.equal(bal(B, 'bank'), 600 - 300);
  assert.equal(bal(B, 'bank', { to: '2026-01-31' }), 0, 'البنك لا يتأثر قبل التحصيل');
  assert.equal(B.partyBalance.get('c'), 400, 'الشيك المرتجع يعود ديناً على العميل');
  const st = partyStatement(db, B, 'c');
  assert.equal(st.closing, 400);
  assert.ok(st.rows.some((r) => /مرتجع/.test(r.memo)));
  assert.ok(B.entries.get(r1.id + ':clr'));
  assert.ok(balanced(db, B));
  assert.ok(validateDoc(db, { ...r1, cleared: '2026-01-01' }).chequeDue, 'تاريخ التحصيل لا يسبق السند');
});

test('الأصول الثابتة: إهلاك شهري بالقسط الثابت واستبعاد بربح', () => {
  seq = 0;
  const db = makeDb();
  db.accounts.find((a) => a.id === 'cash').opening = 50000;
  const a = { id: 'a1', name: 'سيارة توصيل', account: 'cars', date: '2026-01-10', cost: 36000, salvage: 0, life: 36 };
  db.assets = [a];
  db.docs.push(doc({ type: 'expense', date: '2026-01-10', account: 'cars', amount: 36000, tax: 'O', vatRate: 0, paid: 36000, payAcc: 'cash' }));
  const sc = assetSchedule(a, { startDate: '2026-01-01' });
  assert.equal(sc.rows.length, 36);
  assert.equal(sc.monthly, 1000);
  assert.equal(sc.rows[35].acc, 36000);
  let B = buildBooks(db, { today: '2026-06-15' });
  assert.equal(bal(B, 'accdep'), -5000, '5 أشهر مكتملة حتى نهاية مايو');
  assert.equal(bal(B, 'e_dep'), 5000);
  assert.ok(B.entries.get('dep:2026-05'));
  assert.equal(B.entries.get('dep:2026-06'), undefined, 'شهر يونيو لم ينتهِ بعد');
  assert.ok(balanced(db, B));
  // بيع السيارة بـ 32000 في 20 يونيو: القيمة الدفترية 31000 → ربح 1000
  a.disposed = { date: '2026-06-20', proceeds: 32000, money: 'cash' };
  B = buildBooks(db, { today: '2026-12-31' });
  assert.equal(bal(B, 'cars'), 0);
  assert.equal(bal(B, 'accdep'), 0);
  assert.equal(bal(B, 'assetgl'), -1000, 'ربح الاستبعاد إيراد (دائن)');
  assert.equal(bal(B, 'e_dep'), 5000, 'لا إهلاك بعد الاستبعاد');
  assert.equal(assetAccum(a, sc, '2026-12-31'), 5000);
  assert.ok(balanced(db, B));
});

test('أصل قائم قبل بداية التشغيل يدخل القيد الافتتاحي ويكمل عمره', () => {
  seq = 0;
  const db = makeDb();
  const a = { id: 'a2', name: 'أثاث المعرض', account: 'furn', date: '2025-01-01', cost: 12000, salvage: 0, life: 60, priorDep: 2400 };
  db.assets = [a];
  const sc = assetSchedule(a, { startDate: '2026-01-01' });
  assert.equal(sc.preStart, true);
  assert.equal(sc.rows.length, 48);
  assert.equal(sc.monthly, 200);
  const B = buildBooks(db, { today: '2026-03-31' });
  assert.equal(bal(B, 'furn'), 12000);
  assert.equal(bal(B, 'accdep'), -(2400 + 600));
  const bs = balanceSheet(db, B, { to: '2026-03-31' });
  assert.equal(bs.balanced, true, 'الميزانية متوازنة');
  assert.equal(bs.totals.asset, 12000 - 3000, 'صافي الأصول الثابتة');
});

test('قفل الفترة يمنع التواريخ المقفلة', () => {
  const db = makeDb();
  db.settings.lockDate = '2026-03-31';
  assert.equal(isLockedDate(db.settings, '2026-03-31'), true);
  assert.equal(isLockedDate(db.settings, '2026-04-01'), false);
  assert.equal(isLockedDate({}, '2020-01-01'), false);
  const e = validateDoc(db, { type: 'transfer', date: '2026-02-01', from: 'cash', to: 'bank', amount: 5 });
  assert.match(e.date, /مقفلة/);
  assert.deepEqual(validateDoc(db, { type: 'transfer', date: '2026-04-01', from: 'cash', to: 'bank', amount: 5 }), {});
});

test('أوامر البيع والشراء بلا قيود، والعميل مطلوب', () => {
  seq = 0;
  const db = makeDb();
  db.parties.push({ id: 'c', kind: 'customer', name: 'عميل' });
  const so = doc({ type: 'sorder', date: '2026-01-02', party: 'c', vatRate: 0, lines: [{ desc: 'بند', qty: 2, price: 50 }] });
  db.docs.push(so);
  const B = buildBooks(db, { today: '2026-01-31' });
  assert.equal(B.entries.size, 0);
  assert.equal(docAmount(so), 100);
  assert.equal(validateDoc(db, { ...so, party: null }).party, 'اختر العميل');
  assert.deepEqual(validateDoc(db, so), {});
});

test('تقدير الزكاة بطريقة صافي الأصول المتداولة', () => {
  seq = 0;
  const db = makeDb();
  db.accounts.find((a) => a.id === 'cash').opening = 20000;
  db.parties.push({ id: 's', kind: 'supplier', name: 'مورد', opening: 5000 });
  db.products.push({ id: 'p', name: 'بضاعة', type: 'stock', openQty: 100, openCost: 100, price: 150 });
  const B = buildBooks(db, { today: '2026-12-31' });
  const z = zakatEstimate(db, B, { to: '2026-12-31', calendar: 'hijri' });
  assert.equal(z.totalAssets, 30000);
  assert.equal(z.totalLiabilities, 5000);
  assert.equal(z.base, 25000);
  assert.equal(z.zakat, 625);
  const g = zakatEstimate(db, B, { to: '2026-12-31', calendar: 'gregorian' });
  assert.equal(g.zakat, 644.4);
});

test('رمز الحساب التالي لا يقفز بسبب حسابات النظام', () => {
  const db = makeDb();
  assert.equal(nextAccountCode(db, 'g11'), '1107');
  assert.equal(nextAccountCode(db, 'g12'), '1204');
});

test('المستندات المتكررة: تاريخ التكرار التالي', async () => {
  const { nextRun } = await import('../js/store.js');
  assert.equal(nextRun('2026-01-31', 'month', 31), '2026-02-28');
  assert.equal(nextRun('2026-02-28', 'month', 31), '2026-03-31');
  assert.equal(nextRun('2026-01-15', 'quarter'), '2026-04-15');
  assert.equal(nextRun('2026-01-15', 'week'), '2026-01-22');
  assert.equal(nextRun('2024-02-29', 'year', 29), '2025-02-28');
});

test('المستندات المتكررة: إنشاء المستحق مرة واحدة وحفظ سجل التعديلات', async () => {
  const store = await import('../js/store.js');
  store.replaceDb({ app: 'ahsebha-accounting', settings: defaultSettings({ name: 'x', startDate: '2026-01-01', vat: false }), accounts: defaultAccounts(), parties: [], products: [], docs: [] });
  const src = { type: 'expense', date: '2026-01-05', account: 'e_rent', amount: 1000, tax: 'O', vatRate: 0, paid: 1000, payAcc: 'cash', notes: 'إيجار' };
  store.saveRecurring({ name: 'الإيجار', src, freq: 'month', day: 5, next: '2026-01-05', until: '', active: true });
  const res = store.runRecurring('2026-03-10');
  assert.equal(res.created.length, 3);
  assert.deepEqual(res.created.map((d) => d.date), ['2026-01-05', '2026-02-05', '2026-03-05']);
  assert.equal(store.runRecurring('2026-03-10').created.length, 0, 'لا تكرار عند الفتح مرة ثانية');
  const r = store.getDb().recurring[0];
  assert.equal(r.next, '2026-04-05');
  assert.equal(r.count, 3);
  const db = store.getDb();
  assert.equal(db.audit.filter((a) => a.act === 'create').length, 3);
  // قفل الفترة يوقف التكرار ويُظهر السبب، ويمنع الحذف
  store.saveSettings({ lockDate: '2026-12-31' });
  const res2 = store.runRecurring('2026-05-10');
  assert.equal(res2.created.length, 0);
  assert.match(res2.errors[0].msg, /مقفلة/);
  assert.throws(() => store.deleteDoc(db.docs[0].id), /مقفلة/);
  store.saveSettings({ lockDate: '' });
  const doc0 = { ...db.docs[0], amount: 1100 };
  store.saveDoc(doc0);
  const up = store.getDb().audit.filter((a) => a.act === 'update').pop();
  assert.equal(up.before.amount, 1000);
  assert.equal(up.amount, 1100);
  store.deleteDoc(doc0.id);
  assert.equal(store.getDb().audit.pop().act, 'delete');
  const B = store.getBooks();
  assert.ok(B);
});
