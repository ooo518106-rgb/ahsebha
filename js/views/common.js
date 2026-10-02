// ═══ عناصر مشتركة بين الشاشات: الفترات، الإضافة السريعة، أوراق الطباعة، القيود ═══
import * as store from '../store.js';
import {
  docNo, calcDoc, expenseAsDoc, moneyAccounts, currencyInfo, num, ymd, monthStart, monthEnd, addMonths, addDays,
  quarterStart, fiscalYearStart, zatcaInvoiceQR, tafqeet, sortedAccounts, paymentList, TAX_CATS, DOC_TYPES, NO_POSTING, isPdc,
} from '../core.js';
import { html, raw, money, qty, fmtDate, hijri, modal, showErrors, $, printHTML, qrSVG, moneyText, field } from '../ui.js';
import { go, withQuery, docHref as docHrefOf } from '../nav.js';

export const today = () => ymd(new Date());
export const S = () => store.getDb().settings;
export const dec = () => currencyInfo(S().currency).dec;
export const taxLabel = () => S().taxLabel || 'الضريبة';

export function head(title, { sub, actions } = {}) {
  return html`<div class="page-head"><div><h2>${title}</h2>${sub ? html`<div class="sub">${sub}</div>` : ''}</div>${actions ? html`<div class="actions">${actions}</div>` : ''}</div>`;
}

// النقر على صف في جدول يفتح رابطه
export function bindRows(root) {
  root.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-href]');
    if (!tr || e.target.closest('a, button, input, select, label, summary')) return;
    go(tr.dataset.href);
  });
}

// مستند القيد: مستند محفوظ، أو قيد يولّده البرنامج (افتتاحي، إهلاك، تحصيل شيك)
export const docOf = (id, B = store.getBooks()) => store.findDoc(id) || B.entries.get(id)?.doc || null;

// الفترة المقفلة: ملاحظة بدل أزرار التعديل والحذف
export const docLocked = (d) => store.isLockedDoc(d);
export const lockedNote = (d) => html`<p class="note note-warn" style="margin-bottom:12px">🔒 هذا المستند في فترة مقفلة (حتى ${fmtDate(S().lockDate)})، فلا يمكن تعديله أو حذفه. للتصحيح سجّل مستنداً بتاريخ لاحق${d.type === 'sale' ? ' مثل إشعار دائن' : ''}.</p>`;
export const lockedPage = (d) => html`<div class="empty"><div class="empty-ic">🔒</div><h3>المستند في فترة مقفلة</h3><p>الفترة مقفلة حتى ${fmtDate(S().lockDate)}. يمكن للمالك تغيير تاريخ القفل من الإعدادات.</p><p><a class="btn btn-ghost" href="${docHrefOf(d)}">العودة للمستند</a></p></div>`;

export const partyName = (id, fallback = '') => store.findParty(id)?.name || fallback;

// العدد مع المعدود بالعربي: سنة، سنتان، 3 سنوات، 11 سنة
export const countAr = (n, [one, two, few, many]) => (n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`);
export const YEARS = ['سنة', 'سنتان', 'سنوات', 'سنة'];
export const MONTHS_N = ['شهر', 'شهران', 'أشهر', 'شهراً'];

// ─── المستودعات والفروع في النماذج (تظهر فقط عند تعريفها) ───
export const defaultWh = () => { const w = store.getDb().warehouses; return w.length ? (w.some((x) => x.id === S().defaultWh) ? S().defaultWh : w[0].id) : ''; };
export const whLabel = (id) => store.getDb().warehouses.find((w) => w.id === id)?.name || '';
export const ccLabel = (id) => store.getDb().centers.find((c) => c.id === id)?.name || '';
export function whField(d) {
  const whs = store.getDb().warehouses;
  if (!whs.length) return '';
  const cur = d.wh || defaultWh();
  return field('المستودع', html`<select class="inp" data-k="wh" data-f="wh">${whs.map((w) => html`<option value="${w.id}" ${w.id === cur ? raw('selected') : ''}>${w.name}</option>`)}</select>`);
}
export function ccField(d) {
  const cs = store.getDb().centers;
  if (!cs.length) return '';
  return field('الفرع / مركز التكلفة', html`<select class="inp" data-k="cc" data-f="cc"><option value="">— بدون —</option>${cs.map((c) => html`<option value="${c.id}" ${c.id === d.cc ? raw('selected') : ''}>${c.name}</option>`)}</select>`);
}
export const accName = (id) => store.findAccount(id)?.name || 'حساب محذوف';
export const productName = (id) => store.findProduct(id)?.name || '';

// حالة السداد مع التأخير
export function docStatus(d, B = store.getBooks()) {
  const st = B.status.get(d.id);
  if (!st) return null;
  const late = st.state !== 'paid' && d.dueDate && d.dueDate < today();
  return { ...st, state: late ? 'overdue' : st.state };
}

// ─── الفترات ───
export const PERIODS = [
  ['month', 'هذا الشهر'], ['lastmonth', 'الشهر الماضي'], ['quarter', 'هذا الربع'], ['lastquarter', 'الربع الماضي'],
  ['year', 'السنة المالية الحالية'], ['lastyear', 'السنة المالية الماضية'], ['all', 'كل الفترات'], ['custom', 'فترة مخصصة'],
];
export function periodRange(p) {
  const t = today();
  const fm = num(S().fiscalStartMonth) || 1;
  if (p === 'month') return [monthStart(t), monthEnd(t)];
  if (p === 'lastmonth') { const m = addMonths(monthStart(t), -1); return [m, monthEnd(m)]; }
  if (p === 'quarter') { const q = quarterStart(t); return [q, monthEnd(addMonths(q, 2))]; }
  if (p === 'lastquarter') { const q = addMonths(quarterStart(t), -3); return [q, monthEnd(addMonths(q, 2))]; }
  if (p === 'year') { const y = fiscalYearStart(t, fm); return [y, addDays(addMonths(y, 12), -1)]; }
  if (p === 'lastyear') { const y = addMonths(fiscalYearStart(t, fm), -12); return [y, addDays(addMonths(y, 12), -1)]; }
  return ['', ''];
}
export function periodOf(query, def = 'month') {
  if (query.from || query.to) return { p: 'custom', from: query.from || '', to: query.to || '' };
  const p = PERIODS.some(([k]) => k === query.p) ? query.p : def;
  const [from, to] = periodRange(p);
  return { p, from, to };
}
export const inPeriod = (d, per) => (!per.from || d.date >= per.from) && (!per.to || d.date <= per.to);
export const periodLabel = (per) => (per.from || per.to ? `من ${per.from ? fmtDate(per.from) : 'البداية'} إلى ${per.to ? fmtDate(per.to) : 'اليوم'}` : 'كل الفترات');

export function periodBar(per) {
  const custom = per.p === 'custom';
  return html`<select class="inp" data-period aria-label="الفترة">${PERIODS.map(([k, t]) => html`<option value="${k}" ${k === per.p ? raw('selected') : ''}>${t}</option>`)}</select>
    <input class="inp" type="date" data-from value="${per.from}" aria-label="من تاريخ" ${custom ? '' : raw('hidden')}>
    <input class="inp" type="date" data-to value="${per.to}" aria-label="إلى تاريخ" ${custom ? '' : raw('hidden')}>`;
}
export function bindPeriod(root, path, query) {
  const sel = $('[data-period]', root);
  if (!sel) return;
  const f = $('[data-from]', root), t = $('[data-to]', root);
  const apply = (q) => go(withQuery(path, { ...query, p: '', from: '', to: '', ...q }));
  sel.onchange = () => {
    if (sel.value !== 'custom') return apply({ p: sel.value });
    const [a, b] = periodRange('month');
    apply({ from: f.value || a, to: t.value || b });
  };
  f.onchange = () => apply({ from: f.value, to: t.value });
  t.onchange = f.onchange;
}

// ─── الصندوق والبنوك ───
export const moneyList = () => moneyAccounts(store.getDb());
export function moneyOptions(selected, { blank } = {}) {
  return html`${blank ? html`<option value="">${blank}</option>` : ''}${moneyList().map((a) => html`<option value="${a.id}" ${a.id === selected ? raw('selected') : ''}>${a.name}</option>`)}`;
}

// ─── عناصر القوائم المنسدلة ───
export const partyItems = (kind) => () => store.getDb().parties.filter((p) => p.kind === kind)
  .map((p) => ({ value: p.id, label: p.name, sub: p.phone || p.vatNo || '', search: `${p.phone || ''} ${p.vatNo || ''}` }));

export function productItems(priceKey = 'price') {
  return () => {
    const B = store.getBooks();
    return store.getDb().products.filter((p) => p.active !== false).map((p) => {
      const s = B.stock.get(p.id);
      const stock = p.type === 'stock' ? ` · متوفر ${Number((s ? s.qty : 0).toFixed(3))}` : ' · خدمة';
      return { value: p.id, label: p.name, sub: moneyText(p[priceKey] || 0, { sym: false }) + stock, search: `${p.sku || ''} ${p.barcode || ''} ${(p.units || []).map((u) => u.barcode || '').join(' ')}` };
    });
  };
}

export const accountItems = (filter) => () => sortedAccounts(store.getDb()).filter((a) => !a.group && filter(a))
  .map((a) => ({ value: a.id, label: a.name, sub: a.code, search: a.code }));

// ─── إضافة سريعة من داخل النماذج ───
export function quickParty(kind, name = '') {
  const t = kind === 'customer' ? 'عميل جديد' : 'مورد جديد';
  return modal({
    title: t,
    body: html`<form class="form-grid" novalidate>
      ${field('الاسم', html`<input class="inp" name="name" data-f="name" value="${name}" autofocus>`)}
      <small class="fld-e span-all" data-err="name" hidden></small>
      ${field('الجوال', html`<input class="inp" name="phone" inputmode="tel" dir="ltr">`)}
      ${S().vat ? field('الرقم الضريبي (للمنشآت)', html`<input class="inp" name="vatNo" inputmode="numeric" dir="ltr">`) : ''}
      <div class="dlg-actions span-all"><button class="btn btn-primary">حفظ</button><button type="button" class="btn btn-ghost" data-no>إلغاء</button></div>
    </form>`,
    onMount: (dlg, done) => {
      const f = $('form', dlg);
      $('[data-no]', dlg).onclick = () => done(null);
      f.onsubmit = (e) => {
        e.preventDefault();
        const v = Object.fromEntries(new FormData(f));
        if (!String(v.name || '').trim()) return showErrors(f, { name: 'اكتب الاسم' });
        const p = store.saveParty({ kind, name: v.name.trim(), phone: (v.phone || '').trim(), vatNo: (v.vatNo || '').trim(), opening: 0 });
        done({ value: p.id, label: p.name, sub: p.phone });
      };
    },
  });
}

export function quickProduct(name = '') {
  const vat = S().vat;
  return modal({
    title: 'منتج أو خدمة جديدة',
    body: html`<form class="form-grid" novalidate>
      <div class="span-all">${field('الاسم', html`<input class="inp" name="name" data-f="name" value="${name}" autofocus>`)}<small class="fld-e" data-err="name" hidden></small></div>
      ${field('النوع', html`<select class="inp" name="type"><option value="stock">منتج مخزني</option><option value="service">خدمة (بدون مخزون)</option></select>`)}
      ${field('سعر البيع', html`<input class="inp" name="price" type="text" inputmode="decimal" data-num autocomplete="off">`)}
      ${field('تكلفة الشراء', html`<input class="inp" name="cost" type="text" inputmode="decimal" data-num autocomplete="off">`)}
      ${vat ? field('الضريبة', html`<select class="inp" name="tax">${taxOptions('S')}</select>`) : ''}
      <div class="dlg-actions span-all"><button class="btn btn-primary">حفظ</button><button type="button" class="btn btn-ghost" data-no>إلغاء</button></div>
    </form>`,
    onMount: (dlg, done) => {
      const f = $('form', dlg);
      $('[data-no]', dlg).onclick = () => done(null);
      f.onsubmit = (e) => {
        e.preventDefault();
        const v = Object.fromEntries(new FormData(f));
        if (!String(v.name || '').trim()) return showErrors(f, { name: 'اكتب الاسم' });
        const p = store.saveProduct({ name: v.name.trim(), type: v.type, unit: '', price: num(v.price), cost: num(v.cost), tax: v.tax || 'S', openQty: 0, openCost: num(v.cost), reorder: 0, sku: '', active: true });
        done({ value: p.id, label: p.name });
      };
    },
  });
}

export function taxOptions(sel) {
  const rate = num(S().vatRate);
  const names = { S: `${rate}%`, Z: '0% صفرية', E: 'معفاة', O: 'خارج النطاق' };
  return html`${Object.keys(TAX_CATS).map((k) => html`<option value="${k}" ${k === sel ? raw('selected') : ''}>${names[k]}</option>`)}`;
}

// ─── أوراق الطباعة ───
// عنوان بالعربي، ومعه الإنجليزي تحته في الفاتورة ثنائية اللغة
const bilingual = (s = S()) => s.invoiceLang === 'bi';
const lbl = (ar, en, bi) => (bi && en ? html`${ar}<i class="pp-en"><span dir="ltr">${en}</span></i>` : ar);
// «الرقم الضريبي · VAT No.» مع عزل الإنجليزي حتى لا تنقلب النقطة
const lbl2 = (ar, en, bi) => (bi ? html`${ar} · <span dir="ltr">${en}</span>` : ar);

function coBlock(s, bi = false) {
  const contact = [s.phone && 'هاتف: ' + s.phone, s.email].filter(Boolean).join(' · ');
  return html`<div class="pp-co">${s.logo ? html`<img src="${s.logo}" alt="">` : ''}<div>
    <h2>${s.name || 'منشأتي'}</h2>
    ${bi && s.nameEn ? html`<div class="pp-en-name"><span dir="ltr">${s.nameEn}</span></div>` : ''}
    ${s.address ? html`<div>${s.address}</div>` : ''}
    ${bi && s.addressEn ? html`<div class="muted"><span dir="ltr">${s.addressEn}</span></div>` : ''}
    ${contact ? html`<div class="muted">${contact}</div>` : ''}
    ${s.vat && s.vatNo ? html`<div>${lbl2('الرقم الضريبي', 'VAT No.', bi)}: <b dir="ltr">${s.vatNo}</b></div>` : ''}
    ${s.crNo ? html`<div>${lbl2('السجل التجاري', 'CR No.', bi)}: <b dir="ltr">${s.crNo}</b></div>` : ''}
  </div></div>`;
}

export function paperTitle(d, party, s = S()) {
  const tax = !!s.vat || num(d.vatRate) > 0;
  const b2b = !!(party && party.vatNo);
  if (d.type === 'sale') return tax ? (b2b ? ['فاتورة ضريبية', 'Tax Invoice'] : ['فاتورة ضريبية مبسطة', 'Simplified Tax Invoice']) : ['فاتورة', 'Invoice'];
  if (d.type === 'sreturn') return tax ? [b2b ? 'إشعار دائن' : 'إشعار دائن مبسط', 'Credit Note'] : ['إشعار مرتجع مبيعات', 'Sales Return'];
  if (d.type === 'quote') return ['عرض سعر', 'Quotation'];
  if (d.type === 'sorder') return ['أمر بيع', 'Sales Order'];
  if (d.type === 'porder') return ['أمر شراء', 'Purchase Order'];
  if (d.type === 'purchase') return ['فاتورة مشتريات', 'Purchase Invoice'];
  if (d.type === 'preturn') return ['إشعار مدين — مرتجع مشتريات', 'Debit Note'];
  return [DOC_TYPES[d.type]?.name || '', ''];
}

const meta = (label, value) => html`<div><span>${label}</span><b>${value}</b></div>`;

// ورقة فاتورة/عرض سعر/مرتجع
export function docPaper(d, { size = 'a4' } = {}) {
  const s = S();
  const T = calcDoc(d, dec());
  const party = store.findParty(d.party);
  const [title, en] = paperTitle(d, party, s);
  const tax = !!s.vat || num(d.vatRate) > 0;
  const small = size === 'receipt';
  const bi = bilingual(s);
  const L = (ar, enLabel) => lbl(ar, enLabel, bi);
  const anyDisc = T.lines.some((l) => l.discount);
  const isSale = d.type === 'sale' || d.type === 'sreturn' || d.type === 'quote' || d.type === 'sorder';
  const st = NO_POSTING.includes(d.type) ? null : store.getBooks().status.get(d.id);
  const ref = d.refId ? store.findDoc(d.refId) : null;
  const qr = s.country === 'SA' && s.vat && (d.type === 'sale' || d.type === 'sreturn') && d.no ? qrSVG(zatcaInvoiceQR(s, d, T), 120) : '';
  const partyLabel = { sale: ['العميل', 'Customer'], quote: ['مقدم إلى', 'Quoted to'], sreturn: ['العميل', 'Customer'], purchase: ['المورد', 'Supplier'], preturn: ['المورد', 'Supplier'], sorder: ['العميل', 'Customer'], porder: ['إلى المورد', 'Supplier'] }[d.type];
  const partyBox = party ? html`<div><h4>${L(...partyLabel)}</h4><div class="nm">${party.name}</div>
      ${bi && party.nameEn ? html`<div class="pp-en-name"><span dir="ltr">${party.nameEn}</span></div>` : ''}
      ${party.vatNo ? html`<div>${lbl2('الرقم الضريبي', 'VAT No.', bi)}: <b dir="ltr">${party.vatNo}</b></div>` : ''}
      ${party.crNo ? html`<div>${lbl2('السجل التجاري', 'CR No.', bi)}: <span dir="ltr">${party.crNo}</span></div>` : ''}
      ${party.address ? html`<div>${party.address}</div>` : ''}
      ${party.phone ? html`<div class="muted"><span dir="ltr">${party.phone}</span></div>` : ''}</div>`
    : html`<div><h4>${L(...partyLabel)}</h4><div class="nm">${isSale ? L('عميل نقدي', 'Cash customer') : L('مورد نقدي', 'Cash supplier')}</div></div>`;

  const lineRows = (d.lines || []).map((l, i) => {
    const X = T.lines[i];
    const p = l.product ? store.findProduct(l.product) : null;
    const nm = l.desc || (p && p.name) || 'بند';
    const name = bi && p && p.nameEn && p.nameEn !== nm ? html`${nm}<i class="pp-en"><span dir="ltr">${p.nameEn}</span></i>` : nm;
    const q = html`${qty(X.qty)}${l.unit ? html` <small class="muted">${l.unit}</small>` : ''}`;
    if (small) return html`<tr><td>${name}</td><td class="num">${q}</td><td class="num">${money(X.price)}</td><td class="num">${money(X.total)}</td></tr>`;
    return html`<tr><td class="c-n">${i + 1}</td><td>${name}</td><td class="num">${q}</td><td class="num">${money(X.price)}</td>
      ${anyDisc ? html`<td class="num">${X.discount ? money(X.discount) : '—'}</td>` : ''}
      ${tax ? html`<td class="num c-net">${money(X.net)}</td><td class="num">${money(X.vat)} <small class="muted rate">${X.cat === 'S' ? X.rate + '%' : TAX_CATS[X.cat]}</small></td>` : ''}
      <td class="num">${money(X.total)}</td></tr>`;
  });
  const headRow = small
    ? html`<tr><th>${L('البيان', 'Item')}</th><th class="num">${L('الكمية', 'Qty')}</th><th class="num">${L('السعر', 'Price')}</th><th class="num">${L('الإجمالي', 'Total')}</th></tr>`
    : html`<tr><th class="c-n">#</th><th>${L('البيان', 'Description')}</th><th class="num">${L('الكمية', 'Qty')}</th><th class="num">${L('سعر الوحدة', 'Unit price')}</th>${anyDisc ? html`<th class="num">${L('الخصم', 'Discount')}</th>` : ''}${tax ? html`<th class="num c-net">${L('الخاضع للضريبة', 'Taxable amount')}</th><th class="num">${L('الضريبة', 'VAT')}</th>` : ''}<th class="num">${L('الإجمالي', 'Total')}</th></tr>`;

  // الدفع من الكاشير: طرق الدفع والمبلغ المستلم والباقي، واسم الكاشير
  const pays = paymentList(d).filter((p) => num(p.amount) > 0);
  const showPays = d.type === 'sale' && (d.pos || pays.length > 1);
  const cashier = d.pos && d.by ? store.findUser(d.by) : null;

  const note = [d.notes, isSale ? s.invoiceNote : ''].filter(Boolean).join('\n');
  return html`<div class="paper ${small ? 'receipt' : ''} ${bi ? 'bi' : ''}">
    <div class="pp-head">${coBlock(s, bi)}<div class="pp-title"><h1>${title}</h1><div class="en">${en}</div></div></div>
    <div class="pp-meta">
      ${meta(L('الرقم', 'No.'), html`<span dir="ltr">${d.no ? docNo(d, s) : 'مسودة'}</span>`)}
      ${meta(L('التاريخ', 'Date'), html`${fmtDate(d.date)}${d.time && d.type !== 'purchase' && d.type !== 'preturn' ? html` <span class="muted" dir="ltr">${d.time.slice(0, 5)}</span>` : ''}`)}
      ${s.showHijri && !small ? meta('التاريخ الهجري', hijri(d.date)) : ''}
      ${d.dueDate && st && st.due > 0 ? meta(L('تاريخ الاستحقاق', 'Due date'), fmtDate(d.dueDate)) : ''}
      ${d.validUntil ? meta(L('صالح حتى', 'Valid until'), fmtDate(d.validUntil)) : ''}
      ${d.deliveryDate ? meta(L('تاريخ التسليم', 'Delivery date'), fmtDate(d.deliveryDate)) : ''}
      ${d.ref ? meta(d.type === 'purchase' ? L('رقم فاتورة المورد', 'Supplier invoice') : L('المرجع', 'Reference'), d.ref) : ''}
      ${ref ? meta(L('مرجع الفاتورة الأصلية', 'Original invoice'), html`<span dir="ltr">${docNo(ref, s)}</span> — ${fmtDate(ref.date)}`) : ''}
      ${cashier ? meta(L('الكاشير', 'Cashier'), cashier.name) : ''}
    </div>
    <div class="pp-party">${partyBox}</div>
    <table class="pp-lines"><thead>${headRow}</thead><tbody>${lineRows}</tbody></table>
    <div class="pp-bottom">
      <div>${qr ? html`<div class="pp-qr">${raw(qr)}<div class="muted small">رمز الاستجابة السريعة للفاتورة وفق متطلبات هيئة الزكاة والضريبة والجمارك</div></div>` : ''}
        ${note ? html`<div class="pp-note">${note}</div>` : ''}</div>
      <div><div class="pp-totals">
        ${anyDisc ? html`<div><span>${L('المجموع قبل الخصم', 'Subtotal')}</span>${money(T.gross)}</div><div><span>${L('الخصم', 'Discount')}</span>${money(T.discount)}</div>` : ''}
        ${tax ? html`<div><span>${L('الإجمالي غير شامل الضريبة', 'Total excl. VAT')}</span>${money(T.net)}</div><div><span>${L(`${s.taxLabel || 'الضريبة'}${num(d.vatRate) ? ` (${num(d.vatRate)}%)` : ''}`, `VAT${num(d.vatRate) ? ` (${num(d.vatRate)}%)` : ''}`)}</span>${money(T.vat)}</div>` : ''}
        <div class="grand"><span>${tax ? L('الإجمالي شامل الضريبة', 'Total incl. VAT') : L('الإجمالي', 'Total')}</span><span>${money(T.total)} ${currencyInfo(s.currency).sym}</span></div>
        ${showPays ? html`${pays.map((p) => html`<div><span>${accName(p.acc)}</span>${money(p.amount)}</div>`)}
          ${num(d.tendered) > 0 ? html`<div><span>${L('المبلغ المستلم', 'Tendered')}</span>${money(d.tendered)}</div><div><span>${L('الباقي للعميل', 'Change')}</span>${money(d.change || 0)}</div>` : ''}` : ''}
        ${st && st.paid > 0 && st.due > 0 ? html`<div><span>${L('المدفوع', 'Paid')}</span>${money(st.paid)}</div><div><span>${L('المتبقي', 'Balance due')}</span>${money(st.due)}</div>` : ''}
      </div>
      <div class="pp-words">${tafqeet(T.total, s.currency)}</div></div>
    </div>
    <div class="pp-foot"><span>${s.name || ''}</span><span>${small ? (bi ? 'شكراً لزيارتكم · Thank you' : 'شكراً لزيارتكم') : 'صادر من برنامج محاسبة احسبها'}</span></div>
  </div>`;
}

// سند تسليم: الأصناف والكميات بدون أسعار، مع توقيع المستلم
export function deliveryPaper(d) {
  const s = S();
  const bi = bilingual(s);
  const L = (ar, en) => lbl(ar, en, bi);
  const party = store.findParty(d.party);
  return html`<div class="paper">
    <div class="pp-head">${coBlock(s, bi)}<div class="pp-title"><h1>سند تسليم</h1><div class="en">Delivery Note</div></div></div>
    <div class="pp-meta">
      ${meta(L('المرجع', 'Reference'), html`<span dir="ltr">${d.no ? docNo(d, s) : 'مسودة'}</span>`)}
      ${meta(L('التاريخ', 'Date'), fmtDate(d.deliveryDate || d.date))}
    </div>
    <div class="pp-party"><div><h4>${L('العميل', 'Customer')}</h4><div class="nm">${party ? party.name : 'عميل نقدي'}</div>
      ${party && party.address ? html`<div>${party.address}</div>` : ''}${party && party.phone ? html`<div class="muted"><span dir="ltr">${party.phone}</span></div>` : ''}</div></div>
    <table class="pp-lines"><thead><tr><th class="c-n">#</th><th>${L('الصنف', 'Item')}</th><th class="num">${L('الكمية', 'Qty')}</th><th>${L('ملاحظات', 'Notes')}</th></tr></thead>
      <tbody>${(d.lines || []).map((l, i) => html`<tr><td class="c-n">${i + 1}</td><td>${l.desc || productName(l.product) || 'بند'}</td><td class="num">${qty(l.qty)}${l.unit ? ' ' + l.unit : ''}</td><td></td></tr>`)}</tbody></table>
    ${d.notes ? html`<div class="pp-note">${d.notes}</div>` : ''}
    <div class="pp-sign"><div>${L('المُسلِّم', 'Delivered by')}</div><div>${L('اسم المستلم', 'Received by')}</div><div>${L('التوقيع والتاريخ', 'Signature & date')}</div></div>
    <div class="pp-foot"><span>${s.name || ''}</span><span>استلمت البضاعة أعلاه بحالة سليمة</span></div>
  </div>`;
}

// ورقة سند قبض / صرف / مصروف / تحويل
export function voucherPaper(d) {
  const s = S();
  const party = store.findParty(d.party);
  const c = currencyInfo(s.currency);
  let title = DOC_TYPES[d.type]?.name || '';
  let amount = num(d.amount);
  const rows = [];
  if (d.type === 'receipt' || d.type === 'payment') {
    rows.push([d.type === 'receipt' ? 'استلمنا من' : 'صرفنا إلى', party ? party.name : accName(d.account)]);
    const link = d.link ? store.findDoc(d.link) : null;
    if (link) rows.push(['وذلك عن', `${DOC_TYPES[link.type].name} رقم ${docNo(link, s)}`]);
    if (d.notes) rows.push(['البيان', d.notes]);
    rows.push([d.type === 'receipt' ? 'أودع في' : 'صُرف من', accName(d.money)]);
    if (d.method) rows.push(['طريقة الدفع', METHODS[d.method] || d.method]);
    if (d.chequeNo) rows.push(['رقم الشيك / المرجع', d.chequeNo]);
    if (d.chequeBank) rows.push(['البنك المسحوب عليه', d.chequeBank]);
    if (isPdc(d)) rows.push(['تاريخ استحقاق الشيك', fmtDate(d.chequeDue)]);
  } else if (d.type === 'expense') {
    title = 'سند صرف مصروف';
    const T = calcDoc(expenseAsDoc(d), dec());
    amount = T.total;
    rows.push(['بند المصروف', accName(d.account)]);
    if (party || d.payee) rows.push(['الجهة', party ? party.name : d.payee]);
    if (d.notes) rows.push(['البيان', d.notes]);
    if (T.vat) rows.push(['المبلغ قبل الضريبة', moneyText(T.net)], [s.taxLabel || 'الضريبة', moneyText(T.vat)]);
    rows.push(['طريقة الدفع', num(d.paid) > 0 ? accName(d.payAcc) : 'آجل على المورد']);
    if (d.ref) rows.push(['رقم فاتورة المورد', d.ref]);
  } else if (d.type === 'transfer') {
    rows.push(['من حساب', accName(d.from)], ['إلى حساب', accName(d.to)]);
    if (d.notes) rows.push(['البيان', d.notes]);
  }
  return html`<div class="paper">
    <div class="pp-head">${coBlock(s)}<div class="pp-title"><h1>${title}</h1><div class="en" dir="ltr">${docNo(d, s)}</div></div></div>
    <div class="pp-meta">${meta('الرقم', html`<span dir="ltr">${docNo(d, s)}</span>`)}${meta('التاريخ', fmtDate(d.date))}${s.showHijri ? meta('التاريخ الهجري', hijri(d.date)) : ''}</div>
    <div class="pp-box" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <span>المبلغ</span><span class="pp-amount">${money(amount)} ${c.sym}</span></div>
    <div class="pp-words">${tafqeet(amount, s.currency)}</div>
    <table class="pp-lines" style="margin-top:14px"><tbody>${rows.map(([k, v]) => html`<tr><td style="width:34%;color:#6b7280">${k}</td><td><b>${v}</b></td></tr>`)}</tbody></table>
    <div class="pp-sign"><div>${d.type === 'receipt' ? 'المستلم' : 'المستلم / الجهة'}</div><div>المحاسب</div><div>المدير</div></div>
    <div class="pp-foot"><span>${s.name || ''}</span><span>صادر من برنامج محاسبة احسبها</span></div>
  </div>`;
}

export const METHODS = { cash: 'نقداً', transfer: 'تحويل بنكي', card: 'بطاقة / مدى', cheque: 'شيك', wallet: 'محفظة إلكترونية', other: 'أخرى' };

export function printPaper(content, { size = 'a4', title, page } = {}) { printHTML(content, { size, title, page }); }

// طباعة تقرير بجدول
export function printReport(title, sub, table) {
  const s = S();
  printHTML(html`<div class="paper pp-report">
    <div class="pp-head">${coBlock(s)}<div class="pp-title"><h1>${title}</h1><div class="muted">${sub || ''}</div></div></div>
    <div style="margin-top:12px">${raw(table.outerHTML)}</div>
    <div class="pp-foot"><span>طُبع بتاريخ ${fmtDate(today())}</span><span>برنامج محاسبة احسبها</span></div></div>`, { title });
}

// ─── القيد المحاسبي للمستند ───
export function entryTable(entry) {
  if (!entry) return html`<p class="muted small">لا يولّد هذا المستند قيداً محاسبياً.</p>`;
  return html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>الحساب</th><th class="num">مدين</th><th class="num">دائن</th></tr></thead><tbody>
    ${entry.lines.map((l) => html`<tr><td><a href="#/accounts/${l.acc}">${accName(l.acc)}</a>${l.party ? html` <span class="muted small">— ${partyName(l.party)}</span>` : ''}${l.memo ? html` <span class="muted small">(${l.memo})</span>` : ''}</td>
      <td class="num">${l.dr ? money(l.dr) : ''}</td><td class="num">${l.cr ? money(l.cr) : ''}</td></tr>`)}
    </tbody><tfoot><tr><td>المجموع</td><td class="num">${money(entry.dr)}</td><td class="num">${money(entry.cr)}</td></tr></tfoot></table></div>`;
}

// ─── واتساب ───
const DIAL = { SA: '966', AE: '971', JO: '962', KW: '965', QA: '974', BH: '973', OM: '968', EG: '20', IQ: '964' };
export function waLink(phone, text) {
  let p = String(phone || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  else if (p.startsWith('00')) p = p.slice(2);
  else if (p.startsWith('0') && DIAL[S().country]) p = DIAL[S().country] + p.slice(1);
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}

export const csvName = (title) => `${title} - ${S().name || 'احسبها'} - ${today()}`;

// ─── مسح الباركود بالكاميرا: onCode يرجّع true لإغلاق النافذة بعد أول رمز ───
export function cameraDialog(onCode, { title = 'مسح الباركود بالكاميرا' } = {}) {
  let stop = null;
  return modal({
    title,
    body: html`<div class="cam-box"><video playsinline muted></video><div class="cam-line"></div></div>
      <p class="muted small" data-cam-msg style="margin-top:10px">وجّه الكاميرا نحو الباركود…</p>
      <div class="dlg-actions"><button type="button" class="btn btn-ghost" data-no>إغلاق</button></div>`,
    onMount: async (dlg, done) => {
      const msg = $('[data-cam-msg]', dlg);
      const finish = (v) => { if (stop) stop(); stop = null; done(v); };
      $('[data-no]', dlg).onclick = () => finish(null);
      dlg.addEventListener('close', () => { if (stop) stop(); stop = null; });
      if (!navigator.mediaDevices || !window.isSecureContext) { msg.textContent = 'الكاميرا تعمل فقط على رابط آمن (https).'; return; }
      try {
        const { startCameraScan } = await import('../barcode.js');
        stop = await startCameraScan($('video', dlg), (code) => {
          msg.textContent = '✓ ' + code;
          if (onCode(code) === true) finish(code);
        });
      } catch (e) {
        msg.textContent = e && e.name === 'NotAllowedError' ? 'اسمح للمتصفح باستخدام الكاميرا ثم أعد المحاولة.' : 'تعذّر تشغيل الكاميرا: ' + (e.message || e);
      }
    },
  });
}
