import test from 'node:test';
import assert from 'node:assert/strict';
import { guessMapping, buildRecords, templateRows, normKey } from '../js/imports.js';
import { makeSecret, checkSecret, validPin, makeRecoveryCode, cleanRecovery, routePerm } from '../js/auth.js';
import { defaultSettings, defaultAccounts } from '../js/core.js';

const db = () => ({
  settings: defaultSettings({ country: 'SA' }),
  accounts: defaultAccounts(),
  parties: [
    { id: 'c1', kind: 'customer', name: 'مؤسسة الأفق', phone: '0551234567', vatNo: '' },
    { id: 's1', kind: 'supplier', name: 'مؤسسة الأفق', phone: '0110000000' },
  ],
  products: [
    { id: 'p1', name: 'شاحن سريع', barcode: '6291041500213', sku: 'CH-1', price: 40, cost: 20, openQty: 5, type: 'stock' },
    { id: 'p2', name: 'كيبل', sku: 'CB-1', price: 10, cost: 4, openQty: 0, type: 'stock' },
  ],
  docs: [],
});

test('التعرّف على أعمدة Excel بالعربي والإنجليزي', () => {
  const m = guessMapping(['اسم المنتج', 'Barcode', 'سعر البيع', 'التكلفة', 'الكمية', 'التصنيف', 'SKU', 'ملاحظة'], 'products');
  assert.deepEqual(m, { name: 0, barcode: 1, price: 2, cost: 3, openQty: 4, category: 5, sku: 6 });
  const e = guessMapping(['Item Name', 'Selling Price', 'Qty on hand', 'Code'], 'products');
  assert.equal(e.name, 0); assert.equal(e.price, 1); assert.equal(e.openQty, 2); assert.equal(e.sku, 3);
  const c = guessMapping(['الاسم', 'رقم الجوال', 'الرقم الضريبي', 'الرصيد الافتتاحي'], 'customers');
  assert.deepEqual(c, { name: 0, phone: 1, vatNo: 2, opening: 3 });
  assert.equal(normKey('  الكمية_الافتتاحية '), normKey('كمية افتتاحية'));
});

test('استيراد المنتجات: جديد وتحديث وأخطاء وتكرار', () => {
  const rows = [
    ['شاحن سريع', '6291041500213', '45', '', '', 'إكسسوارات'],           // تحديث بالباركود
    ['كيبل USB', '', '12', '5', '30', ''],                                  // جديد
    ['', '123', '1', '', '', ''],                                           // خطأ: بدون اسم
    ['كيبل USB', '', '12', '5', '30', ''],                                  // تكرار في الملف
    ['سماعة', 'باركود', '99', '50', '3', ''],                               // باركود غير صالح
    ['CB-1 renamed', '', '-5', '', '', ''],                                 // سعر سالب
    ['', '', '', '', '', ''],                                               // فارغ يُتجاهل
    ['خدمة تركيب', '', '50', '', '', '', 'خدمة'],
  ];
  const map = { name: 0, barcode: 1, price: 2, cost: 3, openQty: 4, category: 5, type: 6 };
  const out = buildRecords(rows, map, 'products', db());
  assert.equal(out.length, 7);
  assert.equal(out[0].action, 'update');
  assert.equal(out[0].rec.id, 'p1');
  assert.equal(out[0].rec.price, 45);
  assert.equal(out[0].rec.category, 'إكسسوارات');
  assert.equal('cost' in out[0].rec, false, 'الحقول الفارغة لا تمسح القيم الموجودة');
  assert.equal(out[1].action, 'new');
  assert.equal(out[1].rec.openQty, 30);
  assert.equal(out[1].rec.openCost, 5);
  assert.equal(out[1].rec.type, 'stock');
  assert.equal(out[2].action, 'error');
  assert.equal(out[3].action, 'error');
  assert.match(out[3].errors[0], /مكرر/);
  assert.equal(out[4].action, 'error');
  assert.equal(out[5].action, 'error');
  assert.equal(out[6].rec.type, 'service');
  assert.equal(out[6].rec.openQty, 0);
  assert.equal(out[6].row, 9, 'رقم السطر في الملف (مع صف العناوين)');
});

test('استيراد العملاء: المطابقة بالجوال وإرجاع الصفر الأول', () => {
  const rows = [['عميل جديد', 551234567, 100], ['آخر', 562223333, ''], ['ثالث', '+966 50 111 2222', '']];
  const out = buildRecords(rows, { name: 0, phone: 1, opening: 2 }, 'customers', db());
  assert.equal(out[0].action, 'update', 'نفس الجوال = نفس العميل');
  assert.equal(out[0].rec.id, 'c1');
  assert.equal(out[1].action, 'new');
  assert.equal(out[1].rec.phone, '0562223333');
  assert.equal(out[1].rec.kind, 'customer');
  assert.equal(out[1].rec.opening, 0);
  assert.equal(out[2].rec.phone, '+966 50 111 2222');
  // المورد بنفس الاسم لا يُطابَق مع العميل
  const sup = buildRecords([['مؤسسة الأفق', '', '']], { name: 0, phone: 1 }, 'suppliers', db());
  assert.equal(sup[0].rec.id, 's1');
});

test('قالب الاستيراد يُقرأ بنفس الأعمدة', () => {
  for (const t of ['products', 'customers', 'suppliers']) {
    const [head, ex] = templateRows(t);
    const m = guessMapping(head, t);
    assert.equal(Object.keys(m).length, head.length, t);
    assert.equal(buildRecords([ex], m, t, db())[0].action, 'new');
  }
});

test('رمز الدخول: تجزئة وتحقق', async () => {
  const sec = await makeSecret('1234');
  assert.notEqual(sec.hash, '1234');
  assert.equal(await checkSecret('1234', sec), true);
  assert.equal(await checkSecret('1235', sec), false);
  assert.equal(await checkSecret('1234', null), false);
  const sec2 = await makeSecret('1234');
  assert.notEqual(sec.salt, sec2.salt, 'ملح عشوائي لكل رمز');
  assert.equal(validPin('123'), false);
  assert.equal(validPin('1234'), true);
  assert.equal(validPin('12a4'), false);
  const code = makeRecoveryCode();
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(cleanRecovery(code.toLowerCase().replace(/-/g, ' ')), code.replace(/-/g, ''));
});

test('الصلاحية المطلوبة لكل صفحة', () => {
  assert.equal(routePerm(''), 'reports');
  assert.equal(routePerm('pos'), 'pos');
  assert.equal(routePerm('pos/closing'), 'pos');
  assert.equal(routePerm('#/sales/new'), 'sell');
  assert.equal(routePerm('sales/abc/edit'), 'edit');
  assert.equal(routePerm('purchases'), 'buy');
  assert.equal(routePerm('users'), 'admin');
  assert.equal(routePerm('#/products/new?barcode=1'), 'products');
  assert.equal(routePerm('welcome'), null);
  assert.equal(routePerm('unknown-page'), 'reports');
});
