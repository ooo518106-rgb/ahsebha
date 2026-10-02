import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBooks, defaultAccounts, defaultSettings, trialBalance, balances, validateDoc, incomeStatement, salesAnalysis,
  payrollRates, gosiFor, payLine, payrollTotals, eosAward, employeeAdvances, reconItems, reconSummary,
} from '../js/core.js';
import { parseStatement, matchStatement, parseDate } from '../js/imports.js';

let seq = 0;
const doc = (o) => ({ id: 'd' + (++seq), createdAt: `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`, ...o });
function makeDb(extra = {}) {
  return { settings: defaultSettings({ name: 'تجربة', country: 'SA', startDate: '2026-01-01', vat: false, vatRate: 0 }), accounts: defaultAccounts(), parties: [], products: [], docs: [], employees: [], warehouses: [], centers: [], ...extra };
}
const bal = (B, id, o) => (balances(B, o).get(id) || { close: 0 }).close;
const balanced = (db, B) => { const t = trialBalance(db, B, {}).totals; return Math.abs(t.dr - t.cr) < 0.005 && !B.issues.length; };

test('التأمينات الاجتماعية: السعودي والوافد والحد الأعلى', () => {
  const r = payrollRates({ country: 'SA' });
  assert.deepEqual(gosiFor({ nationality: 'citizen', basic: 8000, housing: 2000, transport: 500 }, r), { gosiEmp: 975, gosiCo: 1175 });
  assert.deepEqual(gosiFor({ nationality: 'expat', basic: 4000, housing: 1000 }, r), { gosiEmp: 0, gosiCo: 100 });
  assert.deepEqual(gosiFor({ nationality: 'citizen', basic: 50000, housing: 10000 }, r), { gosiEmp: 4387.5, gosiCo: 5287.5 }, 'الحد الأعلى 45000');
  assert.deepEqual(gosiFor({ nationality: 'citizen', basic: 5000, gosi: false }, r), { gosiEmp: 0, gosiCo: 0 });
  const jo = payrollRates({ country: 'JO' });
  assert.deepEqual(gosiFor({ nationality: 'citizen', basic: 600, housing: 100, transport: 50, other: 50 }, jo, 3), { gosiEmp: 60, gosiCo: 114 });
  assert.equal(payrollRates({ country: 'SA', payroll: { expatCo: 3 } }).expatCo, 3, 'النسب قابلة للتعديل');
});

test('مسير الرواتب: القيد والصافي والسلف', () => {
  seq = 0;
  const db = makeDb();
  db.accounts.find((a) => a.id === 'bank').opening = 50000;
  db.centers.push({ id: 'b1', name: 'فرع الرياض' });
  db.employees.push({ id: 'e1', name: 'سالم', nationality: 'citizen', basic: 8000, housing: 2000, transport: 500, cc: 'b1' }, { id: 'e2', name: 'رامي', nationality: 'expat', basic: 4000, housing: 1000 });
  db.docs.push(doc({ type: 'payment', date: '2026-01-10', account: 'adv', employee: 'e2', amount: 1500, money: 'bank', method: 'cash' }));
  const pr = doc({ type: 'payroll', date: '2026-01-31', period: '2026-01', money: 'bank', lines: [
    { employee: 'e1', name: 'سالم', basic: 8000, housing: 2000, transport: 500, other: 0, additions: 300, absence: 0, advance: 0, gosiEmp: 975, gosiCo: 1175 },
    { employee: 'e2', name: 'رامي', basic: 4000, housing: 1000, transport: 0, other: 0, additions: 0, absence: 200, advance: 500, gosiEmp: 0, gosiCo: 100 },
  ] });
  db.docs.push(pr);
  assert.deepEqual(validateDoc(db, pr), {});
  const P = payrollTotals(pr);
  assert.equal(P.gross, 10800 + 4800);
  assert.equal(P.net, 10800 - 975 + 4800 - 500);
  assert.deepEqual(payLine(pr.lines[1]), { gross: 4800, deductions: 500, net: 4300, gosiEmp: 0, gosiCo: 100, advance: 500 });
  const B = buildBooks(db, { today: '2026-02-01' });
  assert.equal(bal(B, 'e_sal'), 15600);
  assert.equal(bal(B, 'e_gosi'), 1275);
  assert.equal(bal(B, 'gosi_pay'), -(975 + 1275));
  assert.equal(bal(B, 'adv'), 1000, 'السلفة 1500 استُرد منها 500');
  assert.equal(bal(B, 'bank'), 50000 - 1500 - P.net);
  assert.ok(balanced(db, B));
  // مركز التكلفة: رواتب سالم فقط على فرع الرياض
  assert.equal(incomeStatement(db, B, { cc: 'b1' }).totalExpenses, 10800 + 1175);
  assert.equal(employeeAdvances(db).get('e2'), 1000);
  // مسير غير مدفوع: الصافي إلى الرواتب المستحقة
  const pr2 = doc({ ...pr, id: 'pr2', date: '2026-02-28', period: '2026-02', money: '' });
  db.docs.push(pr2);
  const B2 = buildBooks(db, { today: '2026-03-01' });
  assert.equal(bal(B2, 'wages'), -payrollTotals(pr2).net);
  const bad = validateDoc(db, { ...pr, lines: [{ ...pr.lines[1], advance: 99999 }] });
  assert.match(bad.line0, /سالب/);
  assert.ok(validateDoc(db, { ...pr, period: '' }).period);
});

test('مكافأة نهاية الخدمة: السعودية (إنهاء واستقالة) والإمارات', () => {
  const e = { joinDate: '2016-01-01', basic: 6000, housing: 1500, transport: 500 };
  const end = eosAward(e, { to: '2026-01-01' });
  assert.ok(Math.abs(end.years - 10.0055) < 0.01);
  assert.equal(end.wage, 8000);
  assert.equal(Math.round(end.full), Math.round(8000 / 2 * 5 + 8000 * (end.years - 5)));
  const r3 = eosAward({ ...e, joinDate: '2023-01-01' }, { to: '2026-01-01', reason: 'resign' });
  assert.equal(r3.share, 1 / 3);
  assert.equal(r3.amount, Math.round(r3.full / 3 * 100) / 100);
  assert.equal(eosAward({ ...e, joinDate: '2025-01-01' }, { to: '2026-01-01', reason: 'resign' }).amount, 0, 'أقل من سنتين: لا شيء');
  const ae = eosAward({ joinDate: '2020-01-01', basic: 9000 }, { to: '2026-01-01', country: 'AE' });
  const y = ae.years;
  assert.equal(Math.round(ae.amount), Math.round(300 * (21 * 5 + 30 * (y - 5))));
  assert.equal(eosAward({ joinDate: '2025-06-01', basic: 9000 }, { to: '2026-01-01', country: 'AE' }).amount, 0);
});

test('المستودعات: الكميات حسب المستودع والتحويل بينها', () => {
  seq = 0;
  const db = makeDb();
  db.warehouses.push({ id: 'w1', name: 'الرئيسي' }, { id: 'w2', name: 'فرع جدة' });
  db.products.push({ id: 'p', name: 'شاحن', type: 'stock', cost: 10, price: 20, openQty: 0 });
  db.docs.push(doc({ type: 'purchase', date: '2026-01-02', wh: 'w1', vatRate: 0, lines: [{ product: 'p', qty: 100, price: 10 }], paid: 1000, payAcc: 'cash' }));
  const tr = doc({ type: 'stransfer', date: '2026-01-03', from: 'w1', to: 'w2', lines: [{ product: 'p', qty: 30 }] });
  db.docs.push(tr);
  db.docs.push(doc({ type: 'sale', date: '2026-01-04', wh: 'w2', vatRate: 0, lines: [{ product: 'p', qty: 5, price: 20 }], paid: 100, payAcc: 'cash' }));
  const B = buildBooks(db, { today: '2026-02-01' });
  assert.equal(B.stock.get('p').qty, 95);
  assert.equal(B.whQty.get('p').get('w1'), 70);
  assert.equal(B.whQty.get('p').get('w2'), 25);
  assert.equal(B.entries.get(tr.id), undefined, 'التحويل المخزني بلا قيد');
  assert.ok(balanced(db, B));
  assert.ok(validateDoc(db, { ...tr, to: 'w1' }).to);
  assert.ok(validateDoc(db, { type: 'sale', date: '2026-01-05', wh: 'zz', vatRate: 0, lines: [{ desc: 'x', qty: 1, price: 1 }], paid: 1, payAcc: 'cash' }).wh);
});

test('مراكز التكلفة: المبيعات والمصروفات حسب الفرع', () => {
  seq = 0;
  const db = makeDb();
  db.centers.push({ id: 'r', name: 'الرياض' }, { id: 'j', name: 'جدة' });
  db.docs.push(doc({ type: 'sale', date: '2026-01-02', cc: 'r', vatRate: 0, lines: [{ desc: 'خدمة', qty: 1, price: 1000 }], paid: 1000, payAcc: 'cash' }));
  db.docs.push(doc({ type: 'sale', date: '2026-01-02', cc: 'j', vatRate: 0, lines: [{ desc: 'خدمة', qty: 1, price: 400 }], paid: 400, payAcc: 'cash' }));
  db.docs.push(doc({ type: 'expense', date: '2026-01-03', cc: 'j', account: 'e_rent', amount: 300, tax: 'O', vatRate: 0, paid: 300, payAcc: 'cash' }));
  db.docs.push(doc({ type: 'journal', date: '2026-01-04', lines: [{ account: 'e_misc', dr: 50, cr: 0, cc: 'r' }, { account: 'cash', dr: 0, cr: 50 }] }));
  const B = buildBooks(db, { today: '2026-02-01' });
  assert.equal(incomeStatement(db, B, { cc: 'r' }).net, 950);
  assert.equal(incomeStatement(db, B, { cc: 'j' }).net, 100);
  assert.equal(incomeStatement(db, B, {}).net, 1050);
  assert.equal(salesAnalysis(db, B, { cc: 'j' }).net, 400);
  assert.ok(validateDoc(db, { type: 'transfer', date: '2026-01-05', from: 'cash', to: 'bank', amount: 1, cc: 'x' }).cc);
});

test('مطابقة البنك: قراءة الكشف والمطابقة التلقائية والفرق', () => {
  seq = 0;
  const db = makeDb();
  db.accounts.find((a) => a.id === 'bank').opening = 1000;
  db.parties.push({ id: 'c', kind: 'customer', name: 'عميل' });
  db.docs.push(doc({ type: 'receipt', date: '2026-01-05', party: 'c', amount: 500, money: 'bank', method: 'transfer' }));
  db.docs.push(doc({ type: 'expense', date: '2026-01-07', account: 'e_fees', amount: 25, tax: 'O', vatRate: 0, paid: 25, payAcc: 'bank' }));
  db.docs.push(doc({ type: 'payment', date: '2026-01-20', account: 'e_misc', amount: 300, money: 'bank', method: 'cheque' }));
  const B = buildBooks(db, { today: '2026-02-01' });
  const items = reconItems(B, 'bank', { to: '2026-01-31' });
  assert.equal(items.length, 4);
  assert.ok(items.every((x) => x.pk));
  assert.equal(new Set(items.map((x) => x.pk)).size, 4, 'مفاتيح فريدة');
  const rows = [['كشف حساب'], ['التاريخ', 'البيان', 'مدين', 'دائن', 'الرصيد'], ['06/01/2026', 'تحويل وارد', '', '500.00', ''], ['2026-01-08', 'رسوم', '25', '', ''], ['2026-01-09', 'رسوم خدمة', '10', '', '']];
  const st = parseStatement(rows);
  assert.equal(st.error, '');
  assert.deepEqual(st.rows.map((r) => [r.date, r.amount]), [['2026-01-06', 500], ['2026-01-08', -25], ['2026-01-09', -10]]);
  const m = matchStatement(st.rows, items.filter((x) => x.doc !== 'opening'));
  assert.equal(m.matches.size, 2);
  assert.deepEqual(m.unmatched, [2], 'رسوم 10 غير مسجلة في الدفاتر');
  const cleared = new Set([...items.filter((x) => x.doc === 'opening').map((x) => x.pk), ...m.matches.values()]);
  const sum = reconSummary(items, cleared, 1465);
  assert.equal(sum.cleared, 1475);
  assert.equal(sum.diff, -10, 'الفرق = الرسوم غير المسجلة');
  assert.equal(sum.payments, 300, 'شيك لم يُصرف بعد');
  assert.equal(parseDate(46023), '2026-01-01', 'تاريخ Excel التسلسلي');
  assert.equal(parseStatement([['a', 'b']]).rows.length, 0);
});
