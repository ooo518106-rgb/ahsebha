import test from 'node:test';
import assert from 'node:assert/strict';
import {
  num, round, calcDoc, buildBooks, defaultAccounts, defaultSettings, trialBalance, balanceSheet, incomeStatement,
  vatReport, partyStatement, ledger, aging, stockReport, salesAnalysis, cashReport, dashboard, matchItems,
  zatcaTLV, zatcaInvoiceQR, base64, tafqeet, numberToWords, validateDoc, addMonths, monthEnd, fiscalYearStart,
  nextAccountCode, sortedAccounts, docNo, validSaudiVat,
} from '../js/core.js';

let seq = 0;
const doc = (o) => ({ id: 'd' + (++seq), createdAt: `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`, ...o });

function makeDb(docs = [], extra = {}) {
  const accounts = defaultAccounts();
  return {
    settings: defaultSettings({ name: 'متجر التجربة', vatNo: '310122393500003', startDate: '2026-01-01' }),
    accounts, parties: [], products: [], docs, ...extra,
  };
}

test('num() يقبل الأرقام العربية والفواصل', () => {
  assert.equal(num('١٢٣٫٥'), 123.5);
  assert.equal(num('۱۰'), 10);
  assert.equal(num('1,234.50'), 1234.5);
  assert.equal(num(''), 0);
  assert.equal(num('abc'), 0);
  assert.equal(num(null), 0);
});

test('round() يقرّب بدقة', () => {
  assert.equal(round(1.005, 2), 1.01);
  assert.equal(round(-1.005, 2), -1.01);
  assert.equal(round(2.675, 2), 2.68);
  assert.equal(round(0.1 + 0.2, 2), 0.3);
  assert.equal(round(1.0005, 3), 1.001);
  assert.equal(Object.is(round(-0.001, 2), 0), true);
});

test('calcDoc: خصم وضريبة وأسعار شاملة وفئات', () => {
  const T = calcDoc({ vatRate: 15, lines: [{ qty: 5, price: 50, disc: 10, tax: 'S' }, { qty: 1, price: 100, tax: 'Z' }, { qty: 2, price: 10, tax: 'E' }] });
  assert.deepEqual([T.lines[0].gross, T.lines[0].discount, T.lines[0].net, T.lines[0].vat, T.lines[0].total], [250, 25, 225, 33.75, 258.75]);
  assert.equal(T.net, 345);
  assert.equal(T.vat, 33.75);
  assert.equal(T.total, 378.75);
  assert.deepEqual(T.byCat, { S: { net: 225, vat: 33.75 }, Z: { net: 100, vat: 0 }, E: { net: 20, vat: 0 }, O: { net: 0, vat: 0 } });
  const I = calcDoc({ vatRate: 15, inclusive: true, lines: [{ qty: 2, price: 57.5, tax: 'S' }] });
  assert.deepEqual([I.net, I.vat, I.total], [100, 15, 115]);
  // السعر الشامل يبقى كما هو حتى مع كسور
  const J = calcDoc({ vatRate: 15, inclusive: true, lines: [{ qty: 3, price: 9.99, tax: 'S' }] });
  assert.equal(J.total, 29.97);
  assert.equal(round(J.net + J.vat, 2), 29.97);
});

// سيناريو كامل: أرصدة افتتاحية، شراء آجل، بيع آجل ونقدي، قبض، مرتجع، مصروف، سداد مورد
function scenario() {
  seq = 0;
  const db = makeDb();
  db.accounts.find((a) => a.id === 'cash').opening = 10000;
  db.parties.push({ id: 'cA', kind: 'customer', name: 'عميل أ', opening: 500 });
  db.parties.push({ id: 'sX', kind: 'supplier', name: 'مورد س', opening: 1000 });
  db.products.push({ id: 'P', name: 'منتج', type: 'stock', price: 50, cost: 20, openQty: 10, openCost: 20, reorder: 15 });
  db.products.push({ id: 'SV', name: 'خدمة', type: 'service', price: 100 });
  const pur = doc({ type: 'purchase', no: 1, date: '2026-01-05', party: 'sX', vatRate: 15, lines: [{ product: 'P', qty: 10, price: 26, tax: 'S' }], paid: 0 });
  const sale = doc({ type: 'sale', no: 1, date: '2026-01-10', dueDate: '2026-01-20', party: 'cA', vatRate: 15, lines: [{ product: 'P', qty: 5, price: 50, disc: 10, tax: 'S' }], paid: 0 });
  const cashSale = doc({ type: 'sale', no: 2, date: '2026-01-11', vatRate: 15, inclusive: true, lines: [{ product: 'P', qty: 2, price: 57.5, tax: 'S' }], paid: 115, payAcc: 'cash' });
  const rcpt = doc({ type: 'receipt', no: 1, date: '2026-01-15', party: 'cA', amount: 600, money: 'cash' });
  const ret = doc({ type: 'sreturn', no: 1, date: '2026-01-16', party: 'cA', refId: sale.id, vatRate: 15, lines: [{ product: 'P', qty: 1, price: 50, disc: 10, tax: 'S' }], paid: 0 });
  const exp = doc({ type: 'expense', no: 1, date: '2026-01-20', account: 'e_rent', amount: 1150, inclusive: true, tax: 'S', vatRate: 15, paid: 1150, payAcc: 'cash' });
  const pay = doc({ type: 'payment', no: 1, date: '2026-01-25', party: 'sX', amount: 1000, money: 'cash', link: pur.id });
  const quote = doc({ type: 'quote', no: 1, date: '2026-01-26', party: 'cA', vatRate: 15, lines: [{ product: 'P', qty: 100, price: 50, tax: 'S' }] });
  db.docs.push(pur, sale, cashSale, rcpt, ret, exp, pay, quote);
  return { db, pur, sale, cashSale, rcpt, ret, exp, pay };
}

test('القيود متوازنة وميزان المراجعة والميزانية متطابقان', () => {
  const { db } = scenario();
  const B = buildBooks(db);
  assert.deepEqual(B.issues, []);
  for (const e of B.entries.values()) assert.equal(e.dr, e.cr, 'قيد غير متوازن: ' + e.doc.type);
  const tb = trialBalance(db, B, { from: '2026-01-01', to: '2026-12-31' });
  assert.equal(tb.balanced, true);
  const bs = balanceSheet(db, B, { to: '2026-12-31' });
  assert.equal(bs.balanced, true);
  // رأس المال الافتتاحي = نقد 10000 + عميل 500 + مخزون 200 − مورد 1000
  const cap = bs.sections.equity.find((r) => r.account.id === 'cap');
  assert.equal(cap.amount, 9700);
});

test('المخزون بالتكلفة المتوسطة وتكلفة المبيعات', () => {
  const { db, sale, cashSale, ret } = scenario();
  const B = buildBooks(db);
  // (10×20 + 10×26) ÷ 20 = 23
  assert.equal(B.lineCosts.get(sale.id)[0].cost, 115);
  assert.equal(B.lineCosts.get(cashSale.id)[0].cost, 46);
  assert.equal(B.lineCosts.get(ret.id)[0].cost, 23);
  const s = B.stock.get('P');
  assert.equal(s.qty, 14);
  assert.equal(s.value, 322);
  const inv = ledger(db, B, 'inv', {});
  assert.equal(inv.closing, 322, 'رصيد حساب المخزون = قيمة المخزون');
  const sr = stockReport(db, B);
  assert.equal(sr.value, 322);
  assert.equal(sr.rows[0].low, true);
});

test('قائمة الدخل والضريبة والنقدية', () => {
  const { db } = scenario();
  const B = buildBooks(db);
  const is = incomeStatement(db, B, { from: '2026-01-01', to: '2026-01-31' });
  assert.equal(is.totalRevenue, 280);   // 225 + 100 − 45
  assert.equal(is.totalCogs, 138);      // 115 + 46 − 23
  assert.equal(is.gross, 142);
  assert.equal(is.totalExpenses, 1000);
  assert.equal(is.net, -858);
  const v = vatReport(db, B, { from: '2026-01-01', to: '2026-01-31' });
  assert.equal(v.output, 42);           // 33.75 + 15 − 6.75
  assert.equal(v.input, 189);           // 39 + 150
  assert.equal(v.net, -147);
  assert.equal(v.sales.S.net, 280);
  // الرواتب خارج نطاق الضريبة لا تظهر في الإقرار
  db.docs.push(doc({ type: 'expense', no: 2, date: '2026-01-27', account: 'e_sal', amount: 5000, tax: 'O', vatRate: 15, paid: 5000, payAcc: 'cash' }));
  const v2 = vatReport(db, buildBooks(db), { from: '2026-01-01', to: '2026-01-31' });
  assert.equal(v2.input, 189);
  assert.equal(v2.purchases.E.net, 0);
  const cash = cashReport(db, B, { from: '2026-01-01', to: '2026-01-31' });
  const c = cash.rows.find((r) => r.account.id === 'cash');
  assert.equal(c.close, 8565);          // 10000 + 115 + 600 − 1150 − 1000
});

test('مطابقة الدفعات: الرصيد الافتتاحي أولاً ثم الفواتير، والمرتجع يخفض فاتورته', () => {
  const { db, sale, cashSale, pur } = scenario();
  const B = buildBooks(db);
  assert.equal(B.partyBalance.get('cA'), 107);  // 500 + 258.75 − 600 − 51.75
  const st = B.status.get(sale.id);
  assert.equal(st.total, 258.75);
  assert.equal(st.due, 107);
  assert.equal(st.state, 'partial');
  assert.equal(B.status.get(cashSale.id).state, 'paid');
  // سداد المورد مربوط بالفاتورة: يغطيها كاملة والباقي للرصيد الافتتاحي
  assert.equal(B.status.get(pur.id).state, 'paid');
  assert.equal(B.partyBalance.get('sX'), 299);
  const stmt = partyStatement(db, B, 'cA', { from: '2026-01-12', to: '2026-12-31' });
  assert.equal(stmt.opening, 758.75);
  assert.equal(stmt.closing, 107);
  const ag = aging(db, B, 'customer', '2026-02-25');
  assert.equal(ag.totals.total, 107);
  assert.equal(ag.totals.d60, 107);     // مستحقة 2026-01-20 ومتأخرة 36 يوماً
});

test('تحليل المبيعات ولوحة التحكم', () => {
  const { db } = scenario();
  const B = buildBooks(db);
  const a = salesAnalysis(db, B, { from: '2026-01-01', to: '2026-01-31' });
  assert.equal(a.net, 280);
  assert.equal(a.cost, 138);
  assert.equal(a.profit, 142);
  assert.equal(a.products[0].qty, 6);
  const d = dashboard(db, B, '2026-01-28');
  assert.equal(d.revenue, 280);
  assert.equal(d.cash, 8565);
  assert.equal(d.receivable, 107);
  assert.equal(d.payable, 299);
  assert.equal(d.vatDue, -147);         // ضريبة المدخلات أكبر: رصيد مسترد
  assert.equal(d.series.at(-1).revenue, 280);
  assert.equal(d.low.length, 1);
});

test('البيع قبل تسجيل الشراء: فرق التكلفة يذهب لتكلفة المبيعات', () => {
  seq = 0;
  const db = makeDb();
  db.products.push({ id: 'P', name: 'منتج', type: 'stock', price: 20, cost: 10 });
  const s1 = doc({ type: 'sale', no: 1, date: '2026-02-01', vatRate: 0, lines: [{ product: 'P', qty: 10, price: 20, tax: 'S' }], paid: 200, payAcc: 'cash' });
  const p1 = doc({ type: 'purchase', no: 1, date: '2026-02-02', vatRate: 0, lines: [{ product: 'P', qty: 10, price: 12, tax: 'S' }], paid: 120, payAcc: 'cash' });
  db.docs.push(s1, p1);
  const B = buildBooks(db);
  assert.equal(B.lineCosts.get(s1.id)[0].cost, 100);  // مؤقتاً بسعر التكلفة المسجل
  const s = B.stock.get('P');
  assert.equal(s.qty, 0);
  assert.equal(s.value, 0);
  const is = incomeStatement(db, B, {});
  assert.equal(is.totalCogs, 120, 'التكلفة الحقيقية 10 × 12');
  assert.equal(ledger(db, B, 'inv', {}).closing, 0);
  assert.ok(B.issues.some((i) => i.msg.includes('سالباً')));
});

test('مرتجع المشتريات وتسوية المخزون والقيد اليدوي والتحويل', () => {
  seq = 0;
  const db = makeDb();
  db.parties.push({ id: 'sX', kind: 'supplier', name: 'مورد' });
  db.products.push({ id: 'P', name: 'منتج', type: 'stock', price: 20, cost: 10 });
  const p1 = doc({ type: 'purchase', no: 1, date: '2026-03-01', party: 'sX', vatRate: 15, lines: [{ product: 'P', qty: 10, price: 10, tax: 'S' }], paid: 0 });
  const r1 = doc({ type: 'preturn', no: 1, date: '2026-03-02', party: 'sX', refId: p1.id, vatRate: 15, lines: [{ product: 'P', qty: 2, price: 10, tax: 'S' }], paid: 0 });
  const a1 = doc({ type: 'adjust', no: 1, date: '2026-03-03', account: 'adj', lines: [{ product: 'P', qty: -3 }, { product: 'P', qty: 1, cost: 10 }] });
  const j1 = doc({ type: 'journal', no: 1, date: '2026-03-04', lines: [{ account: 'bank', dr: 5000 }, { account: 'loans', cr: 5000 }] });
  const t1 = doc({ type: 'transfer', no: 1, date: '2026-03-05', from: 'bank', to: 'cash', amount: 700 });
  db.docs.push(p1, r1, a1, j1, t1);
  const B = buildBooks(db);
  assert.deepEqual(B.issues, []);
  assert.equal(B.partyBalance.get('sX'), 92);  // 115 − 23
  assert.equal(B.status.get(p1.id).due, 92);
  const s = B.stock.get('P');
  assert.equal(s.qty, 6);
  assert.equal(s.value, 60);
  assert.equal(ledger(db, B, 'inv', {}).closing, 60);
  assert.equal(ledger(db, B, 'adj', {}).closing, 20);
  const bal = cashReport(db, B, {});
  assert.equal(bal.rows.find((r) => r.account.id === 'bank').close, 4300);
  assert.equal(bal.rows.find((r) => r.account.id === 'cash').close, 700);
  assert.equal(balanceSheet(db, B, { to: '2026-12-31' }).balanced, true);
});

test('matchItems: الربط الصريح قبل الأقدم فالأقدم', () => {
  const items = [
    { key: 'i1', side: 'c', amount: 100, date: '2026-01-01' },
    { key: 'i2', side: 'c', amount: 50, date: '2026-01-02' },
    { key: 'p2', side: 's', amount: 50, date: '2026-01-02', link: 'i2' },
    { key: 'r1', side: 's', amount: 30, date: '2026-01-03' },
  ];
  const { rem, apps } = matchItems(items);
  assert.equal(rem.get('i1'), 70);
  assert.equal(rem.get('i2'), 0);
  assert.equal(rem.get('r1'), 0);
  assert.equal(apps.length, 2);
});

test('رمز QR لهيئة الزكاة (TLV + Base64)', () => {
  const qr = zatcaTLV(['Bobs Records', '310122393500003', '2022-04-25T15:30:00Z', '1000.00', '150.00']);
  const bytes = Buffer.from(qr, 'base64');
  assert.equal(bytes[0], 1);
  assert.equal(bytes[1], 12);
  assert.equal(bytes.subarray(2, 14).toString(), 'Bobs Records');
  assert.equal(qr, 'AQxCb2JzIFJlY29yZHMCDzMxMDEyMjM5MzUwMDAwMwMUMjAyMi0wNC0yNVQxNTozMDowMFoEBzEwMDAuMDAFBjE1MC4wMA==');
  // الأسماء العربية تُرمَّز UTF-8 والطول بالبايت
  const ar = Buffer.from(zatcaTLV(['متجر', '3', 't', '1', '0']), 'base64');
  assert.equal(ar[1], Buffer.byteLength('متجر'));
  for (const n of [0, 1, 2, 3, 4, 5, 100]) {
    const b = Array.from({ length: n }, (_, i) => (i * 37) % 256);
    assert.equal(base64(b), Buffer.from(b).toString('base64'));
  }
  const q = zatcaInvoiceQR({ name: 'م', vatNo: '300000000000003' }, { date: '2026-09-26', time: '10:15:30' }, { total: 115, vat: 15 });
  const decoded = Buffer.from(q, 'base64');
  assert.ok(decoded.toString().includes('115.00'));
  assert.ok(decoded.toString().includes('15.00'));
});

test('التفقيط', () => {
  assert.equal(numberToWords(0), 'صفر');
  assert.equal(numberToWords(21), 'واحد وعشرون');
  assert.equal(numberToWords(1250), 'ألف ومائتان وخمسون');
  assert.equal(numberToWords(2000), 'ألفان');
  assert.equal(numberToWords(3000), 'ثلاثة آلاف');
  assert.equal(numberToWords(15000), 'خمسة عشر ألفاً');
  assert.equal(numberToWords(100000), 'مائة ألف');
  assert.equal(numberToWords(2500000), 'مليونان وخمسمائة ألف');
  assert.equal(tafqeet(1250.5, 'SAR'), 'فقط ألف ومائتان وخمسون ريال سعودي و50 هللة لا غير');
  assert.equal(tafqeet(12.5, 'JOD'), 'فقط اثنا عشر دينار أردني و500 فلس لا غير');
});

test('التحقق من المستندات', () => {
  const db = makeDb();
  db.parties.push({ id: 'c1', kind: 'customer', name: 'ع' });
  const base = { type: 'sale', date: '2026-01-01', vatRate: 15, lines: [{ desc: 'بند', qty: 1, price: 100, tax: 'S' }] };
  assert.ok(validateDoc(db, { ...base, paid: 0 }).party, 'البيع الآجل يحتاج عميلاً');
  assert.deepEqual(validateDoc(db, { ...base, paid: 115, payAcc: 'cash' }), {});
  assert.deepEqual(validateDoc(db, { ...base, party: 'c1', paid: 0 }), {});
  assert.ok(validateDoc(db, { ...base, party: 'c1', paid: 200, payAcc: 'cash' }).paid);
  assert.ok(validateDoc(db, { ...base, party: 'c1', paid: 50, payAcc: 'sales' }).payAcc);
  assert.ok(validateDoc(db, { ...base, lines: [{ qty: 0, price: 1 }] }).qty0);
  assert.ok(validateDoc(db, { type: 'journal', date: '2026-01-01', lines: [{ account: 'cash', dr: 10 }, { account: 'cap', cr: 9 }] }).lines);
  assert.ok(validateDoc(db, { type: 'journal', date: '2026-01-01', lines: [{ account: 'ar', dr: 10 }, { account: 'cap', cr: 10 }] }).party0);
  assert.deepEqual(validateDoc(db, { type: 'journal', date: '2026-01-01', lines: [{ account: 'ar', party: 'c1', dr: 10 }, { account: 'cap', cr: 10 }] }), {});
  assert.ok(validateDoc(db, { type: 'receipt', date: '2026-01-01', amount: 5, money: 'cash', account: 'ar' }).account);
  assert.ok(validateDoc(db, { type: 'transfer', date: '2026-01-01', amount: 5, from: 'cash', to: 'cash' }).to);
});

test('أدوات مساعدة', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-03-15', -5), '2025-10-15');
  assert.equal(monthEnd('2024-02-10'), '2024-02-29');
  assert.equal(fiscalYearStart('2026-03-10', 4), '2025-04-01');
  const db = makeDb();
  assert.equal(nextAccountCode(db, 'g11'), '1107');
  assert.equal(nextAccountCode(db, 'g1'), '13');
  assert.equal(sortedAccounts(db)[0].id, 'g1');
  assert.equal(docNo({ type: 'sale', no: 7 }, { salePrefix: 'INV-' }), 'INV-0007');
  assert.equal(validSaudiVat('310122393500003'), true);
  assert.equal(validSaudiVat('210122393500003'), false);
});
