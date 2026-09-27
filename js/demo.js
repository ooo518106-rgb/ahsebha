// ═══ بيانات تجريبية واقعية: متجر إلكترونيات صغير لآخر خمسة أشهر ═══
// مولّد ثابت (نفس النتيجة لنفس التاريخ) حتى تكون التجربة قابلة للتكرار.
import { defaultAccounts, defaultSettings, addDays, addMonths, monthStart, monthEnd, calcDoc, expenseAsDoc } from './core.js';

export function demoData(today) {
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const start = addMonths(monthStart(today), -4);

  const settings = defaultSettings({
    country: 'SA', name: 'مؤسسة النخبة للإلكترونيات', vatNo: '310123456700003', crNo: '1010654321',
    address: 'الرياض — حي العليا، طريق الملك فهد', phone: '0501234567', email: 'sales@example.com',
    startDate: start, inclusive: true,
    invoiceNote: 'شكراً لتسوقكم معنا. الاستبدال خلال 7 أيام بالفاتورة والتغليف الأصلي.',
  });

  const accounts = defaultAccounts();
  const opening = { cash: 8000, bank: 45000, furn: 15000, equip: 9500 };
  for (const [k, v] of Object.entries(opening)) accounts.find((a) => a.id === k).opening = v;
  accounts.push({ id: 'wallet', code: '1107', name: 'مدى وتابي (تسويات البطاقات)', type: 'asset', parent: 'g11', group: false, money: true });

  const parties = [
    { id: 'c1', kind: 'customer', name: 'شركة الأفق للمقاولات', vatNo: '300987654300003', crNo: '1010111222', phone: '0112345678', address: 'الرياض — حي الملقا', opening: 0 },
    { id: 'c2', kind: 'customer', name: 'مؤسسة ركن الهدايا', vatNo: '310456789100003', phone: '0559876543', address: 'جدة — حي الروضة', opening: 0 },
    { id: 'c3', kind: 'customer', name: 'فهد العتيبي', phone: '0541112233', opening: 0 },
    { id: 'c4', kind: 'customer', name: 'متجر لمسة أونلاين', phone: '0567778899', opening: 1200 },
    { id: 's1', kind: 'supplier', name: 'شركة التقنية الحديثة للتوزيع', vatNo: '300111222300003', phone: '0114445566', opening: 6500 },
    { id: 's2', kind: 'supplier', name: 'مصنع الوفاء للإكسسوارات', vatNo: '310222333400003', phone: '0126667788', opening: 0 },
    { id: 's3', kind: 'supplier', name: 'شركة الشحن السريع', vatNo: '300333444500003', phone: '920001234', opening: 0 },
  ];
  for (const p of parties) p.createdAt = start + 'T08:00:00.000Z';

  const P = (id, name, sku, price, cost, openQty, reorder, supplier) => ({ id, name, sku, type: 'stock', unit: 'حبة', price, cost, tax: 'S', openQty, openCost: cost, reorder, active: true, supplier });
  const products = [
    P('p1', 'سماعة بلوتوث لاسلكية', 'HP-100', 149, 70, 60, 20, 's1'),
    P('p2', 'شاحن سريع 25 واط', 'CH-25', 79, 31, 90, 25, 's1'),
    P('p3', 'كيبل USB-C متين 1م', 'CB-01', 29, 8, 200, 50, 's2'),
    P('p4', 'باور بانك 10000 mAh', 'PB-10', 119, 52, 50, 15, 's1'),
    P('p5', 'حافظة جوال مقاومة للصدمات', 'CS-02', 45, 12, 120, 30, 's2'),
    P('p6', 'ساعة ذكية رياضية', 'SW-07', 299, 160, 20, 6, 's1'),
    { id: 'p7', name: 'خدمة تعريف وبرمجة الأجهزة', sku: 'SRV-1', type: 'service', unit: 'خدمة', price: 50, cost: 0, tax: 'S', openQty: 0, openCost: 0, reorder: 0, active: true },
    { id: 'p8', name: 'توصيل داخل المدينة', sku: 'DLV', type: 'service', unit: 'مشوار', price: 25, cost: 0, tax: 'S', openQty: 0, openCost: 0, reorder: 0, active: true },
  ];
  const target = { p1: 130, p2: 170, p3: 340, p4: 110, p5: 240, p6: 50 };
  const stock = Object.fromEntries(products.map((p) => [p.id, p.openQty]));
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  const goods = products.filter((p) => p.type === 'stock');

  const docs = [];
  const no = {};
  let tick = 0;
  const bal = { cash: opening.cash, wallet: 0 };
  const total = (d) => calcDoc(d, 2).total;
  const add = (d) => {
    no[d.type] = (no[d.type] || 0) + 1;
    tick++;
    const t = `${String(9 + (tick % 11)).padStart(2, '0')}:${String((tick * 7) % 60).padStart(2, '0')}:00`;
    const doc = { id: 'demo' + tick.toString(36).padStart(4, '0'), no: no[d.type], createdAt: `${d.date}T${t}.${String(tick % 1000).padStart(3, '0')}Z`, time: t, ...d };
    docs.push(doc);
    return doc;
  };
  const expense = (date, account, amount, o = {}) => {
    if (!date) return null;
    const d = { type: 'expense', date, account, amount, tax: o.tax || 'S', inclusive: o.inclusive ?? true, vatRate: 15, party: o.party || null, payee: o.payee || '', ref: '', notes: o.notes || '' };
    const t = calcDoc(expenseAsDoc(d), 2).total;
    const payAcc = o.party && o.credit ? null : (o.from || 'bank');
    if (payAcc === 'cash' || payAcc === 'wallet') bal[payAcc] -= t;
    return add({ ...d, paid: payAcc ? t : 0, payAcc });
  };
  const restock = (supplier, date, paid) => {
    if (!date) return null;
    const lines = goods.filter((p) => p.supplier === supplier && stock[p.id] < target[p.id] * 0.6)
      .map((p) => { const q = target[p.id] - stock[p.id]; stock[p.id] += q; return { product: p.id, desc: p.name, qty: q, price: p.cost, disc: 0, tax: 'S' }; });
    if (!lines.length) return null;
    const d = { type: 'purchase', date, party: supplier, ref: 'F-' + between(10000, 99999), vatRate: 15, inclusive: false, lines, dueDate: addDays(date, 30), notes: '' };
    return add({ ...d, paid: paid ? total(d) : 0, payAcc: paid ? 'bank' : null });
  };
  const unpaidPurchases = [];
  const receivable = [];
  const creditShipping = [];

  for (let m = 0; m < 5; m++) {
    const ms = addMonths(start, m);
    if (ms > today) break;
    const last = monthEnd(ms) < today ? monthEnd(ms) : today;
    // الشهر الحالي لا يتجاوز اليوم: ما بعده لم يحدث بعد
    const day = (n) => { const d = addDays(ms, n - 1); return d > last ? null : d; };

    expense(day(1), 'e_rent', 3450, { payee: 'مكتب العقار', notes: 'إيجار المعرض الشهري' });

    // سداد مشتريات ومصاريف الشهر السابق للموردين
    if (day(4)) for (const pu of unpaidPurchases.splice(0)) add({ type: 'payment', date: day(4), party: pu.party, amount: total(pu), money: 'bank', method: 'transfer', link: pu.id, notes: 'سداد فاتورة ' + pu.ref });
    if (day(6)) for (const e of creditShipping.splice(0)) add({ type: 'payment', date: day(6), party: e.party, amount: calcDoc(expenseAsDoc(e), 2).total, money: 'bank', method: 'transfer', link: e.id, notes: 'سداد فاتورة الشحن' });

    // تحصيل فواتير الشركات من الشهر السابق
    const due = receivable.splice(0);
    for (const r of due) {
      const when = day(between(8, 18));
      if (r.inv.date >= ms || !when) { receivable.push(r); continue; }
      const full = rnd() < 0.75;
      const amount = full ? r.left : Math.round(r.left / 2);
      add({ type: 'receipt', date: when, party: r.inv.party, amount, money: 'bank', method: 'transfer', link: r.inv.id, notes: 'تحويل بنكي' });
      if (!full) receivable.push({ inv: r.inv, left: Math.round((r.left - amount) * 100) / 100 });
    }

    for (const n of [2, 15]) {
      const pu = restock('s1', day(n), false);
      if (pu) unpaidPurchases.push(pu);
      restock('s2', day(n + 1), true);
    }

    // مبيعات التجزئة بأسعار شاملة الضريبة
    const retail = between(26, 34);
    for (let i = 0; i < retail; i++) {
      const date = day(between(2, 28));
      if (!date) continue;
      const lines = [];
      for (let k = between(1, 3); k > 0; k--) {
        const p = pick(goods);
        const q = between(1, 2);
        if (stock[p.id] < q || lines.some((l) => l.product === p.id)) continue;
        stock[p.id] -= q;
        lines.push({ product: p.id, desc: p.name, qty: q, price: p.price, disc: 0, tax: 'S' });
      }
      if (rnd() < 0.12) lines.push({ product: 'p7', desc: byId.p7.name, qty: 1, price: 50, disc: 0, tax: 'S' });
      if (!lines.length) continue;
      const d = { type: 'sale', date, party: rnd() < 0.15 ? 'c3' : null, vatRate: 15, inclusive: true, lines, notes: '' };
      const t = total(d);
      const payAcc = rnd() < 0.55 ? 'wallet' : 'cash';
      bal[payAcc] += t;
      add({ ...d, paid: t, payAcc });
    }

    // فواتير الشركات الآجلة: أسعار غير شاملة مع خصم كمية
    for (const [c, count] of [['c1', 4], ['c2', 3], ['c4', 2]]) {
      for (let i = 0; i < count; i++) {
        const date = day(between(5, 26));
        if (!date) continue;
        const lines = [];
        for (let k = between(2, 3); k > 0; k--) {
          const p = pick(goods);
          const q = between(8, 20);
          if (stock[p.id] < q || lines.some((l) => l.product === p.id)) continue;
          stock[p.id] -= q;
          lines.push({ product: p.id, desc: p.name, qty: q, price: Math.round(p.price / 1.15), disc: 5, tax: 'S' });
        }
        if (!lines.length) continue;
        if (rnd() < 0.5) lines.push({ product: 'p8', desc: byId.p8.name, qty: 1, price: 25, disc: 0, tax: 'S' });
        const d = { type: 'sale', date, party: c, vatRate: 15, inclusive: false, lines, dueDate: addDays(date, 30), notes: 'السداد خلال 30 يوماً من تاريخ الفاتورة' };
        const inv = add({ ...d, paid: 0, payAcc: null });
        receivable.push({ inv, left: total(d) });
      }
    }

    // مصروفات الشهر
    expense(day(10), 'e_util', between(420, 760), { payee: 'الشركة السعودية للكهرباء', notes: 'فاتورة الكهرباء' });
    expense(day(12), 'e_tel', 345, { payee: 'مزود الإنترنت', notes: 'باقة الإنترنت والهاتف' });
    expense(day(15), 'e_mkt', between(8, 15) * 100, { payee: 'إعلانات سناب شات', notes: 'حملة إعلانية' });
    const ship = expense(day(20), 'e_ship', between(5, 9) * 100, { party: 's3', credit: true, inclusive: false, notes: 'شحنات الشهر' });
    if (ship) creditShipping.push(ship);
    expense(day(25), 'e_fees', between(150, 260), { payee: 'مدى وتابي', from: 'wallet', notes: 'رسوم عمليات البطاقات' });
    expense(day(27), 'e_sal', 5500, { tax: 'O', inclusive: false, payee: 'رواتب الموظفين', notes: 'رواتب الشهر' });
    expense(day(22), 'e_office', between(80, 180), { payee: 'مكتبة جرير', from: 'cash', notes: 'مستلزمات مكتبية' });

    // إيداع النقدية وتسوية البطاقات في البنك
    const cashDeposit = Math.floor((bal.cash - 2500) / 100) * 100;
    if (cashDeposit > 0) { bal.cash -= cashDeposit; add({ type: 'transfer', date: day(28) || last, from: 'cash', to: 'bank', amount: cashDeposit, notes: 'إيداع نقدية المبيعات' }); }
    const settle = Math.floor((bal.wallet * 0.9) / 100) * 100;
    if (settle > 0) { bal.wallet -= settle; add({ type: 'transfer', date: day(28) || last, from: 'wallet', to: 'bank', amount: settle, notes: 'تسوية مدى وتابي' }); }
  }

  // مستندات متنوعة للتجربة
  const lastSale = docs.filter((d) => d.type === 'sale' && !d.party && d.date < today).pop();
  if (lastSale) {
    const d = { type: 'sreturn', date: addDays(lastSale.date, 1), party: null, refId: lastSale.id, vatRate: 15, inclusive: true, lines: [{ ...lastSale.lines[0], qty: 1 }], notes: 'استرجاع منتج بحالته الأصلية' };
    add({ ...d, paid: total(d), payAcc: 'cash' });
  }
  add({ type: 'adjust', date: addDays(today, -3) < start ? start : addDays(today, -3), account: 'adj', notes: 'حافظات تالفة أثناء العرض', lines: [{ product: 'p5', qty: -2, cost: '' }] });
  add({ type: 'payment', date: addDays(today, -6) < start ? start : addDays(today, -6), party: null, account: 'draw', amount: 2000, money: 'cash', method: 'cash', notes: 'مسحوبات شخصية للمالك' });
  add({ type: 'quote', date: addDays(today, -1) < start ? start : addDays(today, -1), party: 'c1', vatRate: 15, inclusive: false, validUntil: addDays(today, 14),
    lines: [{ product: 'p6', desc: byId.p6.name, qty: 10, price: 250, disc: 7, tax: 'S' }, { product: 'p1', desc: byId.p1.name, qty: 15, price: 125, disc: 5, tax: 'S' }], notes: 'الأسعار تشمل التوصيل داخل الرياض' });

  for (const p of products) delete p.supplier;
  // ترقيم تسلسلي حسب التاريخ كما يحدث في الاستخدام الفعلي
  docs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const seq = {};
  for (const d of docs) d.no = seq[d.type] = (seq[d.type] || 0) + 1;
  return { settings, accounts, parties, products, docs };
}
