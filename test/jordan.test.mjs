import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBooks, validateDoc, trialBalance, incomeStatement, defaultAccounts, eosAward, employeeAdvances, currencyInfo } from '../js/core.js';
import { demoData } from '../js/demo.js';

const threeDec = (v) => typeof v !== 'number' || Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6;

test('البيانات التجريبية أردنية: الدينار وضريبة المبيعات 16% والضمان الاجتماعي', () => {
  const d = demoData('2026-10-26');
  assert.equal(d.settings.country, 'JO');
  assert.equal(d.settings.currency, 'JOD');
  assert.equal(currencyInfo(d.settings.currency).dec, 3);
  assert.equal(d.settings.vatRate, 16);
  assert.equal(d.settings.taxLabel, 'ضريبة المبيعات');
  assert.match(d.settings.address, /عمّان/);
  assert.ok(d.parties.every((p) => !p.phone || /^0(7[789]\d{7}|[2-6]\d{7})$/.test(p.phone)), 'أرقام هواتف أردنية');
  assert.ok(d.docs.filter((x) => x.vatRate != null).every((x) => x.vatRate === 16));
  assert.deepEqual(d.centers.map((c) => c.name), ['فرع عمّان', 'فرع إربد']);
  const acc = (id) => d.accounts.find((a) => a.id === id).name;
  assert.equal(acc('gosi_pay'), 'اشتراكات الضمان الاجتماعي المستحقة');
  assert.equal(acc('e_gosi'), 'الضمان الاجتماعي (حصة المنشأة)');
  assert.equal(acc('vdue'), 'ضريبة مبيعات مستحقة للدائرة');
  assert.ok(d.employees.every((e) => /^JO\d{2}[A-Z]{4}\d{22}$/.test(e.iban)), 'آيبان أردني');
});

test('البيانات التجريبية متوازنة وصالحة بأي تاريخ', () => {
  for (const today of ['2026-10-02', '2026-10-26', '2026-03-15', '2026-12-31']) {
    const d = demoData(today);
    const db = { ...d, seq: {} };
    const B = buildBooks(db, { today });
    const bad = db.docs.filter((x) => Object.keys(validateDoc(db, x)).length);
    assert.equal(bad.length, 0, `${today}: مستندات غير صالحة`);
    assert.equal(B.issues.length, 0, `${today}: ملاحظات القيود`);
    const t = trialBalance(db, B, {}).totals;
    assert.ok(Math.abs(t.dr - t.cr) < 0.0005, `${today}: ميزان المراجعة`);
    assert.ok([...B.stock.values()].every((s) => s.qty >= 0), `${today}: مخزون سالب`);
    for (const [, m] of B.whQty) for (const [, q] of m) assert.ok(q > -1e-9, `${today}: مخزون مستودع سالب`);
    assert.ok(db.docs.every((x) => [x.amount, x.paid, x.tendered, x.change, ...(x.lines || []).map((l) => l.price), ...(x.payments || []).map((p) => p.amount)].every(threeDec)), `${today}: أكثر من 3 خانات عشرية`);
  }
});

test('البيانات التجريبية: كل شهر كامل رابح', () => {
  const d = demoData('2026-12-31');
  const db = { ...d, seq: {} };
  const B = buildBooks(db, { today: '2026-12-31' });
  for (const m of ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12']) {
    assert.ok(incomeStatement(db, B, { from: m + '-01', to: m + '-31' }).net > 0, m);
  }
});

test('مكافأة نهاية الخدمة في الأردن (قانون العمل، المادة 32)', () => {
  const emp = { joinDate: '2023-01-01', basic: 500, transport: 50, gosi: true };
  const covered = eosAward(emp, { to: '2026-01-01', country: 'JO', dec: 3 });
  assert.equal(covered.amount, 0, 'المشمول بالضمان لا يستحق من صاحب العمل');
  assert.equal(covered.covered, true);
  const out = eosAward({ ...emp, gosi: false }, { to: '2026-01-01', reason: 'resign', country: 'JO', dec: 3 });
  assert.equal(out.wage, 550);
  assert.equal(out.amount, Math.round(550 * (1096 / 365) * 1000) / 1000, 'أجر شهر عن كل سنة وكسورها، حتى مع الاستقالة');
  assert.equal(eosAward({ ...emp, gosi: false }, { to: '2026-01-01', country: 'SA', dec: 2 }).amount > 0, true, 'السعودية بقاعدتها');
});

test('دليل الحسابات حسب الدولة، والسلف بخانات العملة', () => {
  assert.equal(defaultAccounts().find((a) => a.id === 'gosi_pay').name, 'التأمينات الاجتماعية المستحقة');
  assert.equal(defaultAccounts('JO').find((a) => a.id === 'gosi_pay').name, 'اشتراكات الضمان الاجتماعي المستحقة');
  assert.deepEqual(defaultAccounts('JO').map((a) => a.id), defaultAccounts('SA').map((a) => a.id), 'نفس الحسابات والرموز');
  const db = { settings: { currency: 'JOD' }, docs: [
    { type: 'payment', account: 'adv', employee: 'e1', amount: 100.125 },
    { type: 'payroll', lines: [{ employee: 'e1', advance: 25.06 }] },
  ] };
  assert.equal(employeeAdvances(db).get('e1'), 75.065);
});
