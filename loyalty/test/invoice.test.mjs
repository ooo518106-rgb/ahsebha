import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signup } from './helpers.mjs';
import { parseReceipt, parseTlv, receiptRef } from '../public/js/receipt.js';

const tlv = (fields) => {
  const parts = [];
  for (const [tag, value] of fields) {
    const v = Buffer.from(value, 'utf8');
    parts.push(Buffer.from([tag, v.length]), v);
  }
  return Buffer.concat(parts).toString('base64');
};

test('🧾 قراءة QR الفاتورة: TLV الضريبي، رابط، JSON، نص، وبطاقة زبون مش فاتورة', () => {
  const zatca = tlv([[1, 'موكا كوفي'], [2, '310122393500003'], [3, '2026-10-09T15:30:00Z'], [4, '12.50'], [5, '1.63']]);
  assert.deepEqual(parseTlv(zatca)[1], 'موكا كوفي');
  const r = parseReceipt(zatca);
  assert.equal(r.amount, 12.5);
  assert.equal(r.seller, 'موكا كوفي');
  assert.match(r.invoice, /^qr-[a-z0-9]+$/);
  assert.equal(parseReceipt(zatca).invoice, r.invoice, 'نفس الفاتورة = نفس البصمة');
  assert.notEqual(parseReceipt(tlv([[1, 'موكا كوفي'], [2, '310122393500003'], [3, '2026-10-09T15:31:00Z'], [4, '12.50']])).invoice, r.invoice);
  assert.deepEqual(parseReceipt('https://pos.example/r?total=7.250&invoice=INV-1001'), { amount: 7.25, invoice: 'INV-1001', source: 'url' });
  assert.deepEqual(parseReceipt('{"InvoiceNo":"A-77","Total":"3,5"}'), { amount: 3.5, invoice: 'A-77', source: 'json' });
  const t = parseReceipt('Mocha Cafe\nInvoice No: 5521\nTOTAL: 9.750 JOD');
  assert.deepEqual([t.amount, t.invoice], [9.75, '5521']);
  const ar = parseReceipt('فاتورة رقم 889 الإجمالي ١٥٫٥');
  assert.deepEqual([ar.amount, ar.invoice], [15.5, '889'], 'أرقام عربية وفاصلة عربية');
  assert.equal(parseReceipt('مجهول بلا أرقام').amount, null);
  assert.match(parseReceipt('مجهول بلا أرقام').invoice, /^qr-/);
  assert.deepEqual(parseReceipt('abcdefghijkmnpqrstuv'), { card: true });
  assert.deepEqual(parseReceipt('https://nuqatak.com/c/abcdefghijkmnpqrstuv'), { card: true });
  assert.equal(parseReceipt('https://pos.example/r?total=999999').amount, null, 'مبلغ مش منطقي');
  assert.equal(parseReceipt(''), null);
  assert.equal(receiptRef('x'), receiptRef('x'));
});

test('🧾 رقم الفاتورة مع النقاط: ما بتاخد نقاط مرتين، وإجباري للكاشير إذا المالك بده', async () => {
  const { client } = await setup();
  const owner = client();
  await signup(owner);
  await owner.put('/api/shop', { pointsPerUnit: 1, rewardThreshold: 100 });
  await owner.post('/api/staff', { name: 'كاشير', email: 'inv-cashier@test.com', password: 'cashier-pass' });
  const staff = client();
  await staff.post('/api/auth/login', { email: 'inv-cashier@test.com', password: 'cashier-pass' });
  const a = (await owner.post('/api/members', { name: 'سارة', phone: '0790000101' })).data.member.id;
  const b = (await owner.post('/api/members', { name: 'خالد', phone: '0790000102' })).data.member.id;

  assert.equal((await staff.post(`/api/members/${a}/earn`, { amount: 10, invoice: ' INV-1 ' })).status, 200);
  const dup = await staff.post(`/api/members/${b}/earn`, { amount: 10, invoice: 'INV-1' });
  assert.equal(dup.status, 409);
  assert.match(dup.data.error, /سارة/);
  assert.equal((await staff.post(`/api/members/${b}/earn`, { amount: 10 })).status, 200, 'بدون رقم: عادي (اختياري)');
  const d = (await owner.get(`/api/members/${a}`)).data;
  assert.equal(d.txns[0].invoice, 'INV-1');

  assert.equal((await owner.put('/api/shop/perks', { invoiceMode: 'nope' })).status, 400);
  assert.equal((await owner.put('/api/shop/perks', { invoiceMode: 'required' })).data.shop.perks.invoiceMode, 'required');
  assert.equal((await staff.post(`/api/members/${b}/earn`, { amount: 5, key: 'k-req-1' })).status, 400, 'الكاشير لازم يكتب رقم');
  assert.equal((await owner.post(`/api/members/${b}/earn`, { amount: 5 })).status, 200, 'المالك مستثنى');
  await owner.put('/api/shop/perks', { invoiceMode: 'off' });
  const c3 = (await owner.post('/api/members', { name: 'رنا', phone: '0790000103' })).data.member.id;
  assert.equal((await staff.post(`/api/members/${c3}/earn`, { amount: 5, invoice: 'INV-1' })).status, 200, 'مخفي: الرقم ما بينحفظ');
});

test('↩️ استرجاع فاتورة: كاملة أو جزئية، مرة وحدة، وإذا صرف المكافأة بنشيل الموجود بس', async () => {
  const { client } = await setup();
  const owner = client();
  await signup(owner);
  await owner.put('/api/shop', { pointsPerUnit: 1, rewardThreshold: 30 });
  const id = (await owner.post('/api/members', { name: 'ليلى', phone: '0790000201' })).data.member.id;
  await owner.post(`/api/members/${id}/earn`, { amount: 20, invoice: 'R-20' });
  await owner.post(`/api/members/${id}/earn`, { amount: 10, invoice: 'R-10' });

  assert.equal((await owner.get('/api/invoices?invoice=nope')).status, 404);
  const found = (await owner.get('/api/invoices?invoice=R-20')).data.txn;
  assert.deepEqual([found.delta, found.amount, found.refunded, found.name], [20, 20, 0, 'ليلى']);
  assert.equal((await client().get('/api/invoices?invoice=R-20')).status, 401);

  // جزئي: رجع 5 من 20 ← 5 نقاط
  assert.equal((await owner.post(`/api/txns/${found.id}/refund`, { amount: 25 })).status, 400, 'أكتر من الفاتورة');
  let r = await owner.post(`/api/txns/${found.id}/refund`, { amount: 5 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.refunded, r.data.removed, r.data.member.balance], [5, 5, 25]);
  // الباقي كامل
  r = await owner.post(`/api/txns/${found.id}/refund`, {});
  assert.deepEqual([r.data.refunded, r.data.member.balance], [15, 10]);
  assert.equal((await owner.post(`/api/txns/${found.id}/refund`, {})).status, 409, 'انسترجعت كاملة');
  const txns = (await owner.get(`/api/members/${id}`)).data.txns;
  assert.equal(txns.find((t) => t.id === found.id).refunded, 20);
  assert.equal(txns.filter((t) => t.refundOf === found.id).length, 2);
  assert.match(txns.find((t) => t.refundOf === found.id).note, /استرجاع فاتورة #R-20/);

  // صرف المكافأة قبل الاسترجاع: الرصيد ما بينزل تحت الصفر
  await owner.post(`/api/members/${id}/earn`, { amount: 25, invoice: 'R-25' });
  assert.equal((await owner.post(`/api/members/${id}/redeem`, {})).status, 200);
  const bal = (await owner.get(`/api/members/${id}`)).data.member.balance;
  const big = (await owner.get('/api/invoices?invoice=R-25')).data.txn;
  r = await owner.post(`/api/txns/${big.id}/refund`, {});
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.refunded, r.data.removed, r.data.member.balance], [25, bal, 0]);
  assert.match((await owner.get(`/api/members/${id}`)).data.txns[0].note, /الباقي كان انصرف/);
  // حركة مش إضافة نقاط أو من محل تاني: لأ
  const other = client();
  await signup(other);
  assert.equal((await other.post(`/api/txns/${big.id}/refund`, {})).status, 404);
});
