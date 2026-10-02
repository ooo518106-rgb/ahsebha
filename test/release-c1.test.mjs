import test from 'node:test';
import assert from 'node:assert/strict';
import { zatcaTLV, base64, defaultAccounts, defaultSettings } from '../js/core.js';
import { parseZatcaQR, extractReceipt, findDate, normDigits, matchSupplier, lastExpenseFrom, findDuplicate, scanMeta } from '../js/receipt.js';

const today = '2026-10-02';

test('رمز QR الضريبي: قراءة الحقول الخمسة مع اسم عربي', () => {
  const q = zatcaTLV(['مطعم البيك', '310122393500003', '2026-09-28T14:32:00Z', '54.00', '7.04']);
  const r = parseZatcaQR(q, { today });
  assert.deepEqual({ ...r }, { kind: 'qr', seller: 'مطعم البيك', vat: '310122393500003', ts: '2026-09-28T14:32:00Z', date: '2026-09-28', time: '14:32', total: 54, tax: 7.04, signed: false });
  assert.deepEqual(parseZatcaQR(q.slice(0, 20) + '\n' + q.slice(20), { today }).total, 54, 'يتجاهل الأسطر والمسافات');
  assert.equal(parseZatcaQR(q.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), { today }).seller, 'مطعم البيك', 'Base64 للروابط وبدون =');
  // وقت بدون Z وبمسافة، والتاريخ القديم يبقى مقبولاً من الرمز
  assert.equal(parseZatcaQR(zatcaTLV(['X Co', '300000000000003', '2019-01-05 09:15:00', '10', '1.30']), { today }).date, '2019-01-05');
});

test('رمز QR: المرحلة الثانية (حقول التوقيع) والرموز غير الضريبية', () => {
  const enc = new TextEncoder();
  const bytes = [];
  ['شركة التوريد', '311111111100003', '2026-09-30T10:00:00', '1150.00', '150.00'].forEach((v, i) => { const b = enc.encode(v); bytes.push(i + 1, b.length, ...b); });
  for (const [tag, len] of [[6, 44], [7, 96], [8, 88], [9, 72]]) bytes.push(tag, len, ...new Array(len).fill(65));
  const r = parseZatcaQR(base64(bytes), { today });
  assert.equal(r.signed, true);
  assert.equal(r.total, 1150);
  assert.equal(parseZatcaQR('https://example.com/invoice/123', { today }), null, 'رابط');
  assert.equal(parseZatcaQR('6281234567890', { today }), null, 'باركود منتج');
  assert.equal(parseZatcaQR(base64([1, 5, 65, 66]), { today }), null, 'TLV مقطوع');
  assert.equal(parseZatcaQR(zatcaTLV(['بائع', '12', '2026-09-30T10:00:00', '10', '1']), { today }), null, 'رقم ضريبي غير صالح');
  assert.equal(parseZatcaQR(zatcaTLV(['بائع', '310122393500003', 'أمس', '10', '1']), { today }), null, 'تاريخ غير صالح');
  assert.equal(parseZatcaQR(zatcaTLV(['بائع', '310122393500003', '2026-09-30T10:00:00', 'abc', '1']), { today }), null, 'مبلغ غير صالح');
});

test('التواريخ في نص الإيصال', () => {
  assert.equal(findDate('التاريخ: 2026/09/28 14:32', today), '2026-09-28');
  assert.equal(findDate('Date: 28/09/2026', today), '2026-09-28');
  assert.equal(findDate('09/28/2026', today), '2026-09-28', 'شهر/يوم عند الحاجة');
  assert.equal(findDate('28.09.26', today), '2026-09-28', 'سنة برقمين');
  assert.equal(findDate('٢٨-٠٩-٢٠٢٦', today), '2026-09-28', 'أرقام هندية');
  assert.equal(findDate('28 سبتمبر 2026', today), '2026-09-28');
  assert.equal(findDate('28 أيلول 2026', today), '2026-09-28');
  assert.equal(findDate('Sep 28, 2026', today), '2026-09-28');
  assert.equal(findDate('28 Sep 2026', today), '2026-09-28');
  assert.equal(findDate('2026-12-01', today), '', 'تاريخ مستقبلي بعيد');
  assert.equal(findDate('31/02/2026', today), '', 'تاريخ غير موجود');
  assert.equal(findDate('السعر 23.00 46.00', today), '', 'المبالغ ليست تواريخ');
  assert.equal(normDigits('‏١٢٣٫٥٠‎'), '123.50');
});

test('نص إيصال عربي (من قراءة الصورة)', () => {
  const text = ['مطعم البيك', 'فاتورة ضريبية مبسطة', '‎Simplified Tax Invoice‏', 'الرقم الضريبي: 310122393500003', 'رقم الفاتورة: 45821',
    'التاريخ: 2026/09/28 14:32', 'وجبة دجاج 2 x 23.00 46.00', 'الإجمالي قبل الضريبة 46.96', 'ضريبة القيمة المضافة %15 7.04',
    'الإجمالي شامل الضريبة 54.00', 'نقداً 100.00', 'الباقي 46.00'].join('\n');
  assert.deepEqual(extractReceipt(text, { today }), {
    kind: 'ocr', seller: 'مطعم البيك', vat: '310122393500003', ref: '45821', date: '2026-09-28', total: 54, tax: 7.04, sure: { total: true, tax: true },
  });
});

test('نص إيصال إنجليزي: الإجمالي غير النقد والباقي، ورقم ضريبي بمسافات', () => {
  const text = `CARREFOUR HYPERMARKET
Riyadh Park Branch
VAT No: 300 1234 5670 0003
Date: 28/09/2026 14:32   Invoice No: INV-2026-0045
Milk 2L        12.50
Subtotal       86.96
VAT 15%        13.04
TOTAL         100.00
CASH          200.00
CHANGE        100.00`;
  const r = extractReceipt(text, { today });
  assert.equal(r.seller, 'CARREFOUR HYPERMARKET');
  assert.equal(r.vat, '300123456700003');
  assert.equal(r.ref, 'INV-2026-0045');
  assert.equal(r.total, 100);
  assert.equal(r.tax, 13.04);
  assert.equal(r.date, '2026-09-28');
});

test('نص إيصال: قيمة بسطر لحالها، فاصلة عشرية، وأولوية «شامل الضريبة»', () => {
  const r = extractReceipt('صيدلية النهدي\nالإجمالي\n١٢٣٫٥٠\nضريبة\n١٦٫١١', { today });
  assert.equal(r.total, 123.5);
  assert.equal(r.tax, 16.11);
  assert.equal(extractReceipt('Shop\nTotal 54,00\nVAT 7,04', {}).total, 54, 'فاصلة عشرية أوروبية');
  assert.equal(extractReceipt('Net Amount 90.00\nVAT 13.50\nTotal Amount Due 103.50\nGrand Total 100', {}).total, 103.5);
  assert.equal(extractReceipt('الاجمالي 100.00\nالإجمالي شامل الضريبة 115.00', {}).total, 115, 'شامل الضريبة أولاً');
  const loose = extractReceipt('Some Shop\nItems 3\n12.00\n55.30\nCash 100.00', {});
  assert.equal(loose.total, 55.3, 'بدون كلمة «إجمالي»: أكبر مبلغ عدا النقد');
  assert.equal(loose.sure.total, false);
  const odd = extractReceipt('X\nTotal 100.00\nVAT 3.00', {});
  assert.equal(odd.tax, 3);
  assert.equal(odd.sure.tax, false, 'نسبة غير معتادة');
});

test('ربط الإيصال بالمورد وآخر بند مصروف وكشف التكرار', () => {
  const db = {
    settings: defaultSettings({ name: 'x', country: 'SA', vat: true, vatRate: 15 }), accounts: defaultAccounts(),
    parties: [{ id: 's1', kind: 'supplier', name: 'مطعم البيك', vatNo: '310122393500003' }, { id: 's2', kind: 'supplier', name: 'شركة الكهرباء' }, { id: 'c1', kind: 'customer', name: 'عميل', vatNo: '300000000000003' }],
    docs: [
      { id: 'e1', type: 'expense', no: 1, date: '2026-09-01', party: 's1', account: 'e_misc', payAcc: 'bank', amount: 20 },
      { id: 'e2', type: 'expense', no: 2, date: '2026-09-10', payee: 'مقهى', payeeVat: '399999999900003', account: 'e_rent', payAcc: 'cash', amount: 15,
        scan: { kind: 'qr', vat: '399999999900003', ts: '2026-09-10T08:00:00Z', total: 15, tax: 1.96 } },
    ],
  };
  assert.equal(matchSupplier(db, { vat: '310122393500003', seller: 'غير مهم' }).id, 's1', 'بالرقم الضريبي');
  assert.equal(matchSupplier(db, { vat: '', seller: 'شركة  الكهرباء' }).id, 's2', 'بالاسم');
  assert.equal(matchSupplier(db, { vat: '300000000000003', seller: 'عميل' }), null, 'العملاء لا يُطابَقون');
  assert.equal(lastExpenseFrom(db, { party: 's1' }).account, 'e_misc');
  assert.equal(lastExpenseFrom(db, { vat: '399999999900003' }).id, 'e2');
  assert.equal(lastExpenseFrom(db, { payee: 'مقهى' }).payAcc, 'cash');
  const again = { kind: 'qr', vat: '399999999900003', ts: '2026-09-10T08:00:00Z', total: 15, date: '2026-09-10' };
  assert.equal(findDuplicate(db, again).id, 'e2', 'نفس رمز QR');
  assert.equal(findDuplicate(db, { ...again, ts: '2026-09-10T09:00:00Z' }), null, 'وقت مختلف');
  assert.equal(findDuplicate(db, { kind: 'ocr', vat: '399999999900003', date: '2026-09-10', total: 15 }).id, 'e2', 'من النص: نفس المورد والتاريخ والمبلغ');
  assert.equal(findDuplicate(db, again, { except: 'e2' }), null, 'المستند نفسه أثناء التعديل');
  assert.deepEqual(scanMeta({ kind: 'qr', seller: 'س', vat: '3 1 0', ts: 't', total: 5, tax: 1, extra: 1 }), { kind: 'qr', seller: 'س', vat: '310', ts: 't', total: 5, tax: 1 });
});

test('المرفقات: تنظيف وصف الملفات، ولا تنتقل للمستندات المتكررة', async () => {
  const store = await import('../js/store.js');
  assert.deepEqual(store.cleanFiles([{ id: 'abc_1', name: 'إيصال.jpg', type: 'image/jpeg', size: 1200 }, { id: '../x', name: 'a' }, { id: 'ok', type: 'text/html"><script>', size: 'x' }, 'nope']),
    [{ id: 'abc_1', name: 'إيصال.jpg', type: 'image/jpeg', size: 1200 }, { id: 'ok', name: 'مرفق', type: 'application/octet-stream', size: 0 }]);
  const n = store.normalize({ app: 'ahsebha-accounting', settings: {}, docs: [{ id: 'd1', type: 'expense', no: 1, date: '2026-01-01', files: [{ id: 'f1', name: 'a.pdf', type: 'application/pdf', size: 10 }, { id: 'bad id' }] }] });
  assert.deepEqual(n.docs[0].files.map((f) => f.id), ['f1']);
  const t = store.templateOf({ id: 'x', type: 'expense', no: 3, amount: 10, files: [{ id: 'f1' }], scan: { kind: 'qr' }, payeeVat: '3' });
  assert.equal(t.files, undefined);
  assert.equal(t.scan, undefined);
  assert.equal(t.payeeVat, '3');
});
