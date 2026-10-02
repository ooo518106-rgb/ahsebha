// ═══ بيانات تجريبية واقعية: متجر إلكترونيات صغير في عمّان لآخر خمسة أشهر ═══
// الدينار الأردني (3 خانات)، ضريبة المبيعات 16%، والضمان الاجتماعي.
// مولّد ثابت (نفس النتيجة لنفس التاريخ) حتى تكون التجربة قابلة للتكرار.
import { defaultAccounts, defaultSettings, addDays, addMonths, monthStart, monthEnd, calcDoc, expenseAsDoc, gosiFor, payrollRates, payrollTotals } from './core.js';
import { eanCheckDigit } from './barcode.js';

export function demoData(today) {
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const start = addMonths(monthStart(today), -4);
  const DEC = 3;
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const TAX = 16;

  const settings = defaultSettings({
    country: 'JO', name: 'مؤسسة النخبة للإلكترونيات', vatNo: '12345678', crNo: '204587',
    address: 'عمّان — شارع مكة، مجمع النخبة التجاري', phone: '0791234567', email: 'sales@example.com',
    startDate: start, inclusive: true,
    invoiceNote: 'شكراً لتسوقكم معنا. الاستبدال خلال 7 أيام بالفاتورة والتغليف الأصلي.',
    nameEn: 'Al Nukhba Electronics Est.', addressEn: 'Mecca Street, Amman', invoiceLang: 'bi', posCard: 'wallet',
  });

  const accounts = defaultAccounts('JO');
  // الأثاث والأجهزة القديمة تدخل من سجل الأصول (بتكلفتها ومجمع إهلاكها) وليس كرصيد افتتاحي للحساب
  const opening = { cash: 1500, bank: 9000 };
  for (const [k, v] of Object.entries(opening)) accounts.find((a) => a.id === k).opening = v;
  accounts.push({ id: 'wallet', code: '1107', name: 'البطاقات وكليك (تسويات)', type: 'asset', parent: 'g11', group: false, money: true });

  const parties = [
    { id: 'c1', kind: 'customer', name: 'شركة الأفق للمقاولات', vatNo: '10234567', crNo: '154321', phone: '065512345', address: 'عمّان — الشميساني', opening: 0 },
    { id: 'c2', kind: 'customer', name: 'مؤسسة ركن الهدايا', vatNo: '10345678', phone: '0795551234', address: 'إربد — شارع الجامعة', opening: 0 },
    { id: 'c3', kind: 'customer', name: 'خالد الزعبي', phone: '0786543210', opening: 0 },
    { id: 'c4', kind: 'customer', name: 'متجر لمسة أونلاين', phone: '0779876543', opening: 230 },
    { id: 's1', kind: 'supplier', name: 'شركة التقنية الحديثة للتوزيع', vatNo: '10456789', phone: '065533221', opening: 1250 },
    { id: 's2', kind: 'supplier', name: 'مستودعات الوفاء للإكسسوارات', vatNo: '10567890', phone: '053651234', opening: 0 },
    { id: 's3', kind: 'supplier', name: 'شركة التوصيل السريع', vatNo: '10678901', phone: '065000123', opening: 0 },
  ];
  for (const p of parties) p.createdAt = start + 'T08:00:00.000Z';

  const P = (id, name, sku, price, cost, openQty, reorder, supplier) => ({ id, name, sku, type: 'stock', unit: 'حبة', price, cost, tax: 'S', openQty, openCost: cost, reorder, active: true, supplier });
  const products = [
    P('p1', 'سماعة بلوتوث لاسلكية', 'HP-100', 25, 10.5, 60, 20, 's1'),
    P('p2', 'شاحن سريع 25 واط', 'CH-25', 12.5, 4.2, 90, 25, 's1'),
    P('p3', 'كيبل USB-C متين 1م', 'CB-01', 4.5, 1.1, 200, 50, 's2'),
    P('p4', 'باور بانك 10000 mAh', 'PB-10', 19, 7.5, 50, 15, 's1'),
    P('p5', 'حافظة جوال مقاومة للصدمات', 'CS-02', 7.5, 1.8, 120, 30, 's2'),
    P('p6', 'ساعة ذكية رياضية', 'SW-07', 49, 24, 20, 6, 's1'),
    { id: 'p7', name: 'خدمة تعريف وبرمجة الأجهزة', sku: 'SRV-1', type: 'service', unit: 'خدمة', price: 7, cost: 0, tax: 'S', openQty: 0, openCost: 0, reorder: 0, active: true },
    { id: 'p8', name: 'توصيل داخل عمّان', sku: 'DLV', type: 'service', unit: 'مشوار', price: 2.5, cost: 0, tax: 'S', openQty: 0, openCost: 0, reorder: 0, active: true },
  ];
  // الاسم الإنجليزي والتصنيف والباركود الداخلي (يبدأ بـ 20) لتجربة الكاشير والملصقات
  const EXTRA = {
    p1: ['Wireless Bluetooth Headphones', 'صوتيات'], p2: ['25W Fast Charger', 'شواحن وكيابل'], p3: ['Durable USB-C Cable 1m', 'شواحن وكيابل'],
    p4: ['Power Bank 10000 mAh', 'شواحن وكيابل'], p5: ['Shockproof Phone Case', 'إكسسوارات'], p6: ['Sports Smart Watch', 'ساعات'],
    p7: ['Device Setup Service', 'خدمات'], p8: ['Delivery within Amman', 'خدمات'],
  };
  products.forEach((p, i) => {
    [p.nameEn, p.category] = EXTRA[p.id];
    if (p.type === 'stock') { const d12 = '2000000000' + String(i + 1).padStart(2, '0'); p.barcode = d12 + eanCheckDigit(d12); }
  });
  // الكيبل يُباع بالحبة أو بالعلبة (10 حبات)
  products.find((p) => p.id === 'p3').units = [{ name: 'علبة', factor: 10, price: 40, barcode: '200000000099' + eanCheckDigit('200000000099') }];
  const target = { p1: 130, p2: 170, p3: 340, p4: 110, p5: 240, p6: 50 };
  const stock = Object.fromEntries(products.map((p) => [p.id, p.openQty]));
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  const goods = products.filter((p) => p.type === 'stock');

  // الموظفون والفروع والمستودعات
  const employees = [
    { id: 'em1', no: 1, name: 'أحمد العبادي', nationality: 'citizen', nationalId: '9861012345', job: 'مسؤول مبيعات', joinDate: addMonths(start, -30), basic: 550, housing: 0, transport: 50, other: 0, gosi: true, cc: 'amman', bank: 'البنك العربي', iban: 'JO94CBJO0010000000000131000302', active: true },
    { id: 'em2', no: 2, name: 'محمود السيد', nationality: 'expat', nationalId: 'A1234567', job: 'فني صيانة', joinDate: addMonths(start, -14), basic: 360, housing: 0, transport: 30, other: 0, gosi: true, cc: 'irbid', bank: 'بنك الإسكان', iban: 'JO96HBHO0120000000000012345678', active: true },
  ];
  const centers = [{ id: 'amman', name: 'فرع عمّان' }, { id: 'irbid', name: 'فرع إربد' }];
  const warehouses = [{ id: 'main', name: 'المستودع الرئيسي — عمّان' }, { id: 'wh2', name: 'مستودع فرع إربد' }];
  const rates = payrollRates(settings);

  const docs = [];
  const no = {};
  let tick = 0;
  const bal = { cash: opening.cash, wallet: 0 };
  const total = (d) => calcDoc(d, DEC).total;
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
    const d = { type: 'expense', date, account, amount, tax: o.tax || 'S', inclusive: o.inclusive ?? true, vatRate: TAX, party: o.party || null, payee: o.payee || '', ref: '', notes: o.notes || '', ...(o.cc ? { cc: o.cc } : {}) };
    const t = calcDoc(expenseAsDoc(d), DEC).total;
    const payAcc = o.party && o.credit ? null : (o.from || 'bank');
    if (payAcc === 'cash' || payAcc === 'wallet') bal[payAcc] -= t;
    return add({ ...d, paid: payAcc ? t : 0, payAcc });
  };
  const restock = (supplier, date, paid) => {
    if (!date) return null;
    const lines = goods.filter((p) => p.supplier === supplier && stock[p.id] < target[p.id] * 0.6)
      .map((p) => { const q = target[p.id] - stock[p.id]; stock[p.id] += q; return { product: p.id, desc: p.name, qty: q, price: p.cost, disc: 0, tax: 'S' }; });
    if (!lines.length) return null;
    const d = { type: 'purchase', date, party: supplier, ref: 'F-' + between(10000, 99999), vatRate: TAX, inclusive: false, lines, dueDate: addDays(date, 30), notes: '' };
    return add({ ...d, paid: paid ? total(d) : 0, payAcc: paid ? 'bank' : null });
  };
  let lastGosi = 0;
  let advLeft = 0;
  const unpaidPurchases = [];
  const receivable = [];
  const creditShipping = [];

  for (let m = 0; m < 5; m++) {
    const ms = addMonths(start, m);
    if (ms > today) break;
    const last = monthEnd(ms) < today ? monthEnd(ms) : today;
    // الشهر الحالي لا يتجاوز اليوم: ما بعده لم يحدث بعد
    const day = (n) => { const d = addDays(ms, n - 1); return d > last ? null : d; };

    // الإيجار معفى من ضريبة المبيعات
    expense(day(1), 'e_rent', 500, { payee: 'مالك العقار', notes: 'إيجار المعرض الشهري', cc: 'amman', tax: 'E' });

    // سداد مشتريات ومصاريف الشهر السابق للموردين
    if (day(4)) for (const pu of unpaidPurchases.splice(0)) add({ type: 'payment', date: day(4), party: pu.party, amount: total(pu), money: 'bank', method: 'transfer', link: pu.id, notes: 'سداد فاتورة ' + pu.ref });
    if (day(6)) for (const e of creditShipping.splice(0)) add({ type: 'payment', date: day(6), party: e.party, amount: calcDoc(expenseAsDoc(e), DEC).total, money: 'bank', method: 'transfer', link: e.id, notes: 'سداد فاتورة التوصيل' });

    // تحصيل فواتير الشركات من الشهر السابق
    const due = receivable.splice(0);
    for (const r of due) {
      const when = day(between(8, 18));
      if (r.inv.date >= ms || !when) { receivable.push(r); continue; }
      const full = rnd() < 0.75;
      const amount = full ? r.left : Math.round(r.left / 2);
      add({ type: 'receipt', date: when, party: r.inv.party, amount, money: 'bank', method: 'transfer', link: r.inv.id, notes: 'تحويل بنكي' });
      if (!full) receivable.push({ inv: r.inv, left: r3(r.left - amount) });
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
      if (rnd() < 0.12) lines.push({ product: 'p7', desc: byId.p7.name, qty: 1, price: 7, disc: 0, tax: 'S' });
      if (!lines.length) continue;
      const d = { type: 'sale', date, party: rnd() < 0.15 ? 'c3' : null, vatRate: TAX, inclusive: true, lines, notes: '', cc: 'amman', wh: 'main' };
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
          lines.push({ product: p.id, desc: p.name, qty: q, price: Math.round((p.price / 1.16) * 20) / 20, disc: 5, tax: 'S' });
        }
        if (!lines.length) continue;
        if (rnd() < 0.5) lines.push({ product: 'p8', desc: byId.p8.name, qty: 1, price: 2.5, disc: 0, tax: 'S' });
        const d = { type: 'sale', date, party: c, vatRate: TAX, inclusive: false, lines, dueDate: addDays(date, 30), notes: 'السداد خلال 30 يوماً من تاريخ الفاتورة', cc: c === 'c2' ? 'irbid' : 'amman', wh: 'main' };
        const inv = add({ ...d, paid: 0, payAcc: null });
        receivable.push({ inv, left: total(d) });
      }
    }

    // مصروفات الشهر
    expense(day(10), 'e_util', between(70, 130), { payee: 'شركة الكهرباء الأردنية', notes: 'فاتورة الكهرباء', tax: 'E' });
    expense(day(11), 'e_util', 14 + m * 1.5, { payee: 'مياهنا', notes: 'فاتورة المياه', tax: 'E' });
    expense(day(12), 'e_tel', 35, { payee: 'أورنج الأردن', notes: 'إنترنت الألياف وخط الهاتف' });
    expense(day(15), 'e_mkt', between(8, 15) * 10, { payee: 'وكالة الإبداع للتسويق', notes: 'حملة إعلانات فيسبوك وإنستغرام' });
    const ship = expense(day(20), 'e_ship', between(5, 9) * 12, { party: 's3', credit: true, inclusive: false, notes: 'طلبات توصيل الشهر' });
    if (ship) creditShipping.push(ship);
    expense(day(25), 'e_fees', between(15, 30), { payee: 'البنك العربي', from: 'wallet', notes: 'عمولات أجهزة الدفع وكليك', tax: 'E' });
    // مسير رواتب الشهر، وسداد اشتراكات الضمان الاجتماعي عن الشهر السابق
    if (day(12) && lastGosi) { add({ type: 'payment', date: day(12), party: null, account: 'gosi_pay', amount: lastGosi, money: 'bank', method: 'transfer', notes: 'سداد اشتراكات الضمان الاجتماعي' }); lastGosi = 0; }
    if (m === 2 && day(6)) { add({ type: 'payment', date: day(6), party: null, account: 'adv', employee: 'em2', amount: 150, money: 'cash', method: 'cash', notes: 'سلفة للموظف محمود السيد' }); bal.cash -= 150; advLeft = 150; }
    if (day(27)) {
      const lines = employees.map((e) => ({ employee: e.id, name: e.name, basic: e.basic, housing: e.housing, transport: e.transport, other: 0, additions: e.id === 'em1' ? between(0, 4) * 20 : 0, absence: 0, advance: e.id === 'em2' && advLeft ? 75 : 0, ...gosiFor(e, rates, DEC) }));
      advLeft = Math.max(0, advLeft - (lines[1].advance || 0));
      const pr = add({ type: 'payroll', date: day(27), period: day(27).slice(0, 7), money: 'bank', lines, notes: '' });
      const P = payrollTotals(pr, DEC);
      lastGosi = r3(P.gosiEmp + P.gosiCo);
    }
    expense(day(22), 'e_office', between(10, 25), { payee: 'مكتبة المعرفة', from: 'cash', notes: 'مستلزمات مكتبية' });

    // إيداع النقدية وتسوية البطاقات وكليك في البنك
    const cashDeposit = Math.floor((bal.cash - 600) / 50) * 50;
    if (cashDeposit > 0) { bal.cash -= cashDeposit; add({ type: 'transfer', date: day(28) || last, from: 'cash', to: 'bank', amount: cashDeposit, notes: 'إيداع نقدية المبيعات' }); }
    const settle = Math.floor((bal.wallet * 0.9) / 50) * 50;
    if (settle > 0) { bal.wallet -= settle; add({ type: 'transfer', date: day(28) || last, from: 'wallet', to: 'bank', amount: settle, notes: 'تسوية البطاقات وكليك' }); }
  }

  // مستندات متنوعة للتجربة
  const lastSale = docs.filter((d) => d.type === 'sale' && !d.party && d.date < today).pop();
  if (lastSale) {
    const d = { type: 'sreturn', date: addDays(lastSale.date, 1), party: null, refId: lastSale.id, vatRate: TAX, inclusive: true, lines: [{ ...lastSale.lines[0], qty: 1 }], notes: 'استرجاع منتج بحالته الأصلية' };
    add({ ...d, paid: total(d), payAcc: 'cash' });
  }
  add({ type: 'adjust', date: addDays(today, -3) < start ? start : addDays(today, -3), account: 'adj', notes: 'حافظات تالفة أثناء العرض', lines: [{ product: 'p5', qty: -2, cost: '' }] });
  add({ type: 'payment', date: addDays(today, -6) < start ? start : addDays(today, -6), party: null, account: 'draw', amount: 400, money: 'cash', method: 'cash', notes: 'مسحوبات شخصية للمالك' });
  add({ type: 'quote', date: addDays(today, -1) < start ? start : addDays(today, -1), party: 'c1', vatRate: TAX, inclusive: false, validUntil: addDays(today, 14),
    lines: [{ product: 'p6', desc: byId.p6.name, qty: 10, price: 42, disc: 7, tax: 'S' }, { product: 'p1', desc: byId.p1.name, qty: 15, price: 21, disc: 5, tax: 'S' }], notes: 'الأسعار تشمل التوصيل داخل عمّان' });

  // مبيعات الكاشير اليوم: نقداً مع الباقي، وبطاقة، ومقسّمة (لتجربة تقفيل الصندوق)
  for (let i = 0; i < 6; i++) {
    const lines = [];
    for (let k = between(1, 3); k > 0; k--) {
      const p = pick(goods);
      if (stock[p.id] < 1 || lines.some((l) => l.product === p.id)) continue;
      stock[p.id] -= 1;
      lines.push({ product: p.id, desc: p.name, qty: 1, price: p.price, disc: 0, tax: 'S' });
    }
    if (!lines.length) continue;
    const d = { type: 'sale', date: today, party: null, vatRate: TAX, inclusive: true, lines, notes: '', pos: true };
    const t = total(d);
    if (i % 3 === 0) { const got = Math.ceil(t / 5) * 5; add({ ...d, payments: [{ acc: 'cash', amount: t }], tendered: got, change: r3(got - t) }); }
    else if (i % 3 === 1) add({ ...d, payments: [{ acc: 'wallet', amount: t }] });
    else { const c = Math.round(t / 2); add({ ...d, payments: [{ acc: 'cash', amount: c }, { acc: 'wallet', amount: r3(t - c) }] }); }
  }

  // شيكات مؤجلة: واحد حُصّل، وواحد تحت التحصيل يستحق قريباً
  const chqDate = (n) => { const d = addDays(today, n); return d < start ? start : d; };
  add({ type: 'receipt', date: chqDate(-40), party: 'c2', amount: 500, money: 'bank', method: 'cheque', chequeNo: '104521', chequeBank: 'البنك العربي', pdc: true, chequeDue: chqDate(-20), cleared: chqDate(-19), notes: 'شيك مؤجل' });
  add({ type: 'receipt', date: chqDate(-3), party: 'c1', amount: 750, money: 'bank', method: 'cheque', chequeNo: '778810', chequeBank: 'بنك القاهرة عمّان', pdc: true, chequeDue: addDays(today, 5), notes: 'شيك مؤجل الدفع' });
  // تغذية مستودع إربد
  add({ type: 'stransfer', date: chqDate(-8), from: 'main', to: 'wh2', lines: [{ product: 'p2', qty: 10 }, { product: 'p3', qty: 40 }, { product: 'p5', qty: 20 }], notes: 'تغذية فرع إربد' });
  // أمر بيع مفتوح وأمر شراء مفتوح
  add({ type: 'sorder', date: chqDate(-2), party: 'c2', vatRate: TAX, inclusive: false, deliveryDate: addDays(today, 4), lines: [{ product: 'p5', desc: byId.p5.name, qty: 12, price: 6.5, disc: 0, tax: 'S' }, { product: 'p3', desc: byId.p3.name, qty: 5, price: 38, disc: 0, tax: 'S', unit: 'علبة', factor: 10 }], notes: 'التسليم لفرع إربد' });
  add({ type: 'porder', date: chqDate(-1), party: 's2', vatRate: TAX, inclusive: false, deliveryDate: addDays(today, 10), lines: [{ product: 'p5', desc: byId.p5.name, qty: 100, price: 1.8, disc: 0, tax: 'S' }, { product: 'p3', desc: byId.p3.name, qty: 150, price: 1.1, disc: 0, tax: 'S' }], notes: '' });
  // جهاز جديد اشتُري خلال الفترة ويُهلك على 3 سنوات
  const buyDate = addDays(addMonths(start, 2), 4) <= today ? addDays(addMonths(start, 2), 4) : start;
  const printer = add({ type: 'expense', date: buyDate, account: 'equip', amount: 350, tax: 'S', inclusive: false, vatRate: TAX, party: null, payee: 'معرض الحاسوب الحديث', paid: 406, payAcc: 'bank', ref: '', notes: 'طابعة ملصقات وقارئ باركود' });
  const assets = [
    { id: 'as1', no: 1, name: 'ديكور وأثاث المعرض', account: 'furn', date: addMonths(start, -14), cost: 4200, salvage: 0, life: 84, priorDep: 700, notes: '' },
    { id: 'as2', no: 2, name: 'أجهزة كمبيوتر ونقاط بيع', account: 'equip', date: addMonths(start, -6), cost: 2400, salvage: 120, life: 48, priorDep: 285, notes: '' },
    { id: 'as3', no: 3, name: 'طابعة ملصقات وقارئ باركود', account: 'equip', date: printer.date, cost: 350, salvage: 0, life: 36, priorDep: 0, notes: '' },
  ];
  // الإيجار الشهري يتكرر تلقائياً من الشهر القادم
  const rent = docs.filter((d) => d.type === 'expense' && d.account === 'e_rent').pop();
  const nextMonth = addMonths(monthStart(today), 1);
  const recurring = rent ? [{ id: 'rc1', name: 'إيجار المعرض الشهري', src: { type: 'expense', account: 'e_rent', amount: rent.amount, tax: rent.tax, inclusive: rent.inclusive, vatRate: rent.vatRate, party: null, payee: rent.payee, paid: rent.paid, payAcc: rent.payAcc, ref: '', notes: rent.notes }, freq: 'month', day: 1, next: nextMonth, until: '', active: true, count: 0 }] : [];

  for (const p of products) delete p.supplier;
  // ترقيم تسلسلي حسب التاريخ كما يحدث في الاستخدام الفعلي
  docs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const seq = {};
  for (const d of docs) d.no = seq[d.type] = (seq[d.type] || 0) + 1;
  return { settings, accounts, parties, products, docs, assets, recurring, employees, centers, warehouses };
}
