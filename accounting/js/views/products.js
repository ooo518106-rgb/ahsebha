// ═══ المنتجات والخدمات، بطاقة الصنف، وتسويات المخزون (الجرد) ═══
import * as store from '../store.js';
import { docNo, DOC_TYPES, num, round, validateDoc } from '../core.js';
import { html, raw, money, qty, fmtDate, toast, confirmBox, combo, showErrors, empty, norm, $, $$, exportTable, field, attr } from '../ui.js';
import { go, guard, setTitle, docHref } from '../nav.js';
import { head, bindRows, today, S, dec, taxLabel, taxOptions, productItems, periodOf, periodBar, bindPeriod, inPeriod, entryTable, csvName, printPaper } from './common.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const stockOf = (id) => store.getBooks().stock.get(id) || { qty: 0, value: 0 };
const avgCost = (p) => { const s = stockOf(p.id); return s.qty > 0 ? s.value / s.qty : num(p.cost); };

// ═══ قائمة المنتجات ═══
export function productList({ root, query }) {
  setTitle('المنتجات والخدمات');
  const db = store.getDb();
  const state = { q: query.q || '', f: query.f || '' };
  const all = db.products.slice().sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  root.innerHTML = String(html`
    ${head('المنتجات والخدمات', { sub: `${all.length} صنف`, actions: html`<a class="btn btn-ghost" href="#/adjustments/new">⚖️ جرد / تسوية</a><a class="btn btn-primary" href="#/products/new">➕ منتج جديد</a>` })}
    <div class="toolbar"><input class="inp grow" type="search" data-q placeholder="بحث بالاسم أو الرمز" value="${state.q}">
      <select class="inp" data-f><option value="">كل الأصناف</option><option value="stock">المنتجات المخزنية</option><option value="service">الخدمات</option><option value="low">قاربت على النفاد</option><option value="off">الموقوفة</option></select>
      <button class="btn btn-ghost btn-sm" data-csv>⬇️ Excel</button></div>
    <div data-out></div>`);
  $('[data-f]', root).value = state.f;
  function draw() {
    const q = norm(state.q.trim());
    const rows = all.filter((p) => {
      if (q && !norm(`${p.name} ${p.sku || ''} ${p.barcode || ''}`).includes(q)) return false;
      const s = stockOf(p.id);
      if (state.f === 'stock') return p.type === 'stock';
      if (state.f === 'service') return p.type === 'service';
      if (state.f === 'low') return p.type === 'stock' && num(p.reorder) > 0 && s.qty <= num(p.reorder);
      if (state.f === 'off') return p.active === false;
      return true;
    });
    const out = $('[data-out]', root);
    if (!all.length) {
      out.innerHTML = String(empty('📦', 'لا توجد منتجات بعد', 'أضف منتجاتك مع أسعارها وكمياتها الحالية، ويتابع البرنامج المخزون وتكلفته وأرباحه تلقائياً.', html`<a class="btn btn-primary" href="#/products/new">➕ منتج جديد</a>`));
      return;
    }
    const value = rows.reduce((t, p) => t + (p.type === 'stock' ? stockOf(p.id).value : 0), 0);
    out.innerHTML = String(html`<div class="sum-bar"><span>العدد: <b>${rows.length}</b></span><span>قيمة المخزون بالتكلفة: <b>${money(value, { sym: true })}</b></span></div>
      ${rows.length ? html`<div class="tbl-wrap"><table class="tbl" data-table><thead><tr><th>الصنف</th><th class="hide-sm">الرمز</th><th class="num">سعر البيع</th><th class="num hide-sm">متوسط التكلفة</th><th class="num">الكمية</th><th class="num hide-sm">القيمة</th></tr></thead>
      <tbody>${rows.map((p) => { const s = stockOf(p.id); const low = p.type === 'stock' && num(p.reorder) > 0 && s.qty <= num(p.reorder);
        return html`<tr data-href="#/products/${p.id}"><td><b>${p.name}</b>${p.type === 'service' ? html` <span class="badge badge-info">خدمة</span>` : ''}${p.active === false ? html` <span class="badge badge-muted">موقوف</span>` : ''}</td>
          <td class="hide-sm code">${p.sku || ''}</td><td class="num">${money(p.price)}</td><td class="num hide-sm">${p.type === 'stock' ? money(avgCost(p)) : '—'}</td>
          <td class="num">${p.type === 'stock' ? html`<span class="${s.qty < 0 ? 'neg' : low ? 'neg' : ''}">${qty(s.qty)}</span>${low ? html` <span class="badge badge-bad">نفاد</span>` : ''}` : '—'}</td>
          <td class="num hide-sm">${p.type === 'stock' ? money(s.value) : '—'}</td></tr>`; })}</tbody></table></div>`
      : html`<div class="empty"><p>لا توجد نتائج مطابقة.</p></div>`}`);
  }
  draw();
  bindRows(root);
  const sync = () => history.replaceState(null, '', '#/products?' + new URLSearchParams({ q: state.q, f: state.f }).toString());
  $('[data-q]', root).oninput = (e) => { state.q = e.target.value; draw(); sync(); };
  $('[data-f]', root).onchange = (e) => { state.f = e.target.value; draw(); sync(); };
  $('[data-csv]', root).onclick = () => { const t = $('[data-table]', root); if (t) exportTable(t, csvName('المنتجات')); };
}

// ═══ نموذج المنتج ═══
export function productForm({ root, params }) {
  const s = S();
  const existing = params.id ? store.findProduct(params.id) : null;
  if (params.id && !existing) { root.innerHTML = String(empty('🔎', 'المنتج غير موجود')); return; }
  const p = existing ? { ...existing } : { name: '', sku: '', type: 'stock', unit: '', price: '', cost: '', tax: 'S', openQty: '', openCost: '', reorder: '', notes: '', active: true };
  const title = existing ? `تعديل: ${existing.name}` : 'منتج أو خدمة جديدة';
  setTitle(title);
  const inp = (k, attrs = '') => html`<input class="inp" data-k="${k}" data-f="${k}" ${raw(attrs)} value="${p[k] ?? ''}">`;
  const numAttrs = 'type="text" inputmode="decimal" data-num autocomplete="off"';
  root.innerHTML = String(html`${head(title, { actions: html`<a class="btn btn-ghost" href="${existing ? '#/products/' + existing.id : '#/products'}">إلغاء</a>` })}
    <form novalidate data-form>
      <div class="card"><div class="form-grid">
        <div class="span2">${field('الاسم', inp('name', 'autofocus'))}<small class="fld-e" data-err="name" hidden></small></div>
        ${field('النوع', html`<select class="inp" data-k="type"><option value="stock" ${p.type === 'stock' ? raw('selected') : ''}>منتج مخزني (تُتابع كميته)</option><option value="service" ${p.type === 'service' ? raw('selected') : ''}>خدمة (بدون مخزون)</option></select>`)}
        ${field('الرمز / الباركود', inp('sku', 'dir="ltr"'))}
        ${field('وحدة القياس', inp('unit', 'placeholder="حبة، كرتون، كيلو…"'))}
        ${field('سعر البيع', inp('price', numAttrs), { hint: s.inclusive ? `شامل ${taxLabel()} حسب الإعدادات` : '' })}
        ${field('سعر الشراء (التكلفة)', inp('cost', numAttrs), { hint: 'يُقترح في فواتير الشراء' })}
        ${s.vat ? field(taxLabel(), html`<select class="inp" data-k="tax">${taxOptions(p.tax || 'S')}</select>`) : ''}
      </div></div>
      <div class="card" data-stock-box><div class="card-h"><h3>المخزون</h3></div><div class="form-grid">
        ${field('الكمية الافتتاحية', inp('openQty', 'type="text" inputmode="decimal" data-num autocomplete="off"'), { hint: `الموجودة عندك في ${s.startDate ? fmtDate(s.startDate) : 'بداية التشغيل'}` })}
        ${field('تكلفة الوحدة الافتتاحية', inp('openCost', numAttrs))}
        ${field('حد إعادة الطلب', inp('reorder', numAttrs), { hint: 'تنبيه عندما تصل الكمية لهذا الحد' })}
      </div>${existing ? html`<p class="muted small" style="margin-top:10px">الكمية الحالية تُحسب من الحركات. لتصحيح الكمية بعد الجرد استخدم <a href="#/adjustments/new?product=${existing.id}">تسوية المخزون</a>.</p>` : ''}</div>
      <div class="card"><label class="check"><input type="checkbox" data-k="active" ${p.active !== false ? raw('checked') : ''}> نشط (يظهر في الفواتير)</label>
        <div style="margin-top:10px">${field('ملاحظات', html`<textarea class="inp" data-k="notes" rows="2">${p.notes || ''}</textarea>`)}</div></div>
      <div class="form-actions sticky-actions"><button class="btn btn-primary">💾 حفظ</button>${existing ? '' : html`<button type="button" class="btn btn-ghost" data-again>حفظ وإضافة آخر</button>`}</div>
    </form>`);
  const toggleStock = () => { $('[data-stock-box]', root).hidden = p.type !== 'stock'; };
  toggleStock();
  root.addEventListener('input', (e) => { const k = e.target.dataset.k; if (k && k !== 'active') { p[k] = e.target.value; guard.dirty = true; } });
  root.addEventListener('change', (e) => {
    const k = e.target.dataset.k;
    if (k === 'active') p.active = e.target.checked;
    else if (k) p[k] = e.target.value;
    if (k === 'type') toggleStock();
    if (k === 'cost' && !num(p.openCost) && num(p.openQty)) { p.openCost = p.cost; const oc = $('[data-k="openCost"]', root); if (oc) oc.value = p.cost; }
    guard.dirty = true;
  });
  const save = (again) => {
    p.name = String(p.name || '').trim();
    const errs = {};
    if (!p.name) errs.name = 'اكتب اسم المنتج';
    else if (store.getDb().products.some((x) => x.id !== p.id && norm(x.name) === norm(p.name))) errs.name = 'يوجد منتج بنفس الاسم';
    if (num(p.openQty) && !num(p.openCost) && !num(p.cost)) errs.openCost = 'اكتب تكلفة الوحدة للكمية الافتتاحية';
    if (!showErrors(root, errs)) return;
    const out = { ...p, price: num(p.price), cost: num(p.cost), openQty: p.type === 'stock' ? num(p.openQty) : 0, openCost: num(p.openCost) || num(p.cost), reorder: num(p.reorder), sku: String(p.sku || '').trim(), unit: String(p.unit || '').trim(), notes: String(p.notes || '').trim(), tax: p.tax || 'S' };
    const saved = store.saveProduct(out);
    guard.dirty = false;
    toast('تم الحفظ ✓');
    go(again ? '#/products/new' : '#/products/' + saved.id);
  };
  $('[data-form]', root).onsubmit = (e) => { e.preventDefault(); save(false); };
  const ag = $('[data-again]', root);
  if (ag) ag.onclick = () => save(true);
}

// ═══ بطاقة الصنف ═══
export function productShow({ root, params, query, path }) {
  const p = store.findProduct(params.id);
  if (!p) { setTitle('المنتجات'); root.innerHTML = String(empty('🔎', 'المنتج غير موجود', '', html`<a class="btn btn-ghost" href="#/products">العودة</a>`)); return; }
  setTitle(p.name);
  const s = S();
  const B = store.getBooks();
  const st = stockOf(p.id);
  const per = periodOf(query, 'all');
  const moves = B.moves.filter((m) => m.product === p.id);
  const inRange = moves.filter((m) => inPeriod(m, per));
  const before = moves.filter((m) => per.from && m.date < per.from);
  const openQ = before.length ? before[before.length - 1].qtyAfter : 0;
  const openV = before.length ? before[before.length - 1].valueAfter : 0;
  // مبيعات الفترة وأرباحها
  let soldQ = 0, soldNet = 0, soldCost = 0;
  for (const d of store.getDb().docs) {
    if ((d.type !== 'sale' && d.type !== 'sreturn') || !inPeriod(d, per)) continue;
    const T = B.totals.get(d.id);
    const costs = B.lineCosts.get(d.id) || [];
    const sg = d.type === 'sale' ? 1 : -1;
    (d.lines || []).forEach((l, i) => { if (l.product !== p.id) return; soldQ += sg * T.lines[i].qty; soldNet += sg * T.lines[i].net; soldCost += sg * (costs[i] ? costs[i].cost : 0); });
  }
  const margin = soldNet ? ((soldNet - soldCost) / soldNet) * 100 : 0;
  const moveName = (m) => (m.type === 'opening' ? 'رصيد أول المدة' : DOC_TYPES[m.type]?.name || '');

  root.innerHTML = String(html`
    ${head(p.name, { sub: [p.type === 'stock' ? 'منتج مخزني' : 'خدمة', p.sku, p.unit].filter(Boolean).join(' · '),
      actions: html`<a class="btn btn-primary" href="#/sales/new?product=${p.id}">🧾 بيع</a>
        ${p.type === 'stock' ? html`<a class="btn btn-ghost" href="#/purchases/new?product=${p.id}">🛒 شراء</a><a class="btn btn-ghost" href="#/adjustments/new?product=${p.id}">⚖️ تسوية</a>` : ''}
        <a class="btn btn-ghost" href="#/products/${p.id}/edit">✏️ تعديل</a><button class="btn btn-text-danger" data-del>🗑️ حذف</button>` })}
    <div class="grid g4" style="margin-bottom:14px">
      ${p.type === 'stock' ? html`<div class="kpi"><span class="kpi-l">الكمية المتوفرة</span><span class="kpi-v ${st.qty < 0 || (num(p.reorder) && st.qty <= num(p.reorder)) ? 'neg' : ''}">${qty(st.qty)} <small class="cur">${p.unit || ''}</small></span>${num(p.reorder) ? html`<span class="kpi-s">حد الطلب ${num(p.reorder)}</span>` : ''}</div>
        <div class="kpi"><span class="kpi-l">متوسط التكلفة</span><span class="kpi-v">${money(avgCost(p), { sym: true })}</span></div>
        <div class="kpi"><span class="kpi-l">قيمة المخزون</span><span class="kpi-v">${money(st.value, { sym: true })}</span></div>` : ''}
      <div class="kpi"><span class="kpi-l">سعر البيع</span><span class="kpi-v">${money(p.price, { sym: true })}</span>${p.type === 'stock' && num(p.price) ? html`<span class="kpi-s">هامش متوقع ${Math.round(((num(p.price) - avgCost(p)) / num(p.price)) * 100)}%</span>` : ''}</div>
    </div>
    <div class="card"><div class="card-h"><h3>المبيعات والأرباح</h3><div class="toolbar" style="margin:0">${periodBar(per)}</div></div>
      <div class="grid g4"><div><div class="kpi-l">الكمية المباعة</div><div class="kpi-v">${qty(soldQ)}</div></div>
        <div><div class="kpi-l">صافي المبيعات</div><div class="kpi-v">${money(soldNet)}</div></div>
        <div><div class="kpi-l">التكلفة</div><div class="kpi-v">${money(soldCost)}</div></div>
        <div><div class="kpi-l">الربح (${Math.round(margin)}%)</div><div class="kpi-v ${soldNet - soldCost < 0 ? 'neg' : 'pos'}">${money(soldNet - soldCost)}</div></div></div></div>
    ${p.type === 'stock' ? html`<div class="card"><div class="card-h"><h3>بطاقة الصنف (حركة المخزون)</h3><button class="btn btn-ghost btn-sm" data-csv>⬇️ Excel</button></div>
      ${inRange.length || openQ ? html`<div class="tbl-wrap"><table class="tbl" data-table><thead><tr><th>التاريخ</th><th>المستند</th><th class="num">وارد</th><th class="num">صادر</th><th class="num">القيمة</th><th class="num">الرصيد</th><th class="num hide-sm">قيمة الرصيد</th></tr></thead><tbody>
        ${per.from ? html`<tr class="grp"><td colspan="5">رصيد ما قبل الفترة</td><td class="num">${qty(openQ)}</td><td class="num hide-sm">${money(openV)}</td></tr>` : ''}
        ${inRange.map((m) => { const d = store.findDoc(m.doc); return html`<tr ${d ? attr('data-href', docHref(d)) : ''}><td class="nowrap">${fmtDate(m.date)}</td><td>${moveName(m)} ${d ? html`<span class="muted" dir="ltr">${docNo(d, s)}</span>` : ''}</td>
          <td class="num">${m.qty > 0 ? qty(m.qty) : ''}</td><td class="num">${m.qty < 0 ? qty(-m.qty) : ''}</td><td class="num">${money(m.value)}</td><td class="num"><b>${qty(m.qtyAfter)}</b></td><td class="num hide-sm">${money(m.valueAfter)}</td></tr>`; })}
      </tbody></table></div>` : html`<p class="muted">لا توجد حركات في هذه الفترة.</p>`}</div>` : ''}`);
  bindRows(root);
  bindPeriod(root, path, query);
  const csv = $('[data-csv]', root);
  if (csv) csv.onclick = () => { const t = $('[data-table]', root); if (t) exportTable(t, csvName('بطاقة صنف ' + p.name)); };
  $('[data-del]', root).onclick = async () => {
    if (!(await confirmBox(`حذف «${p.name}»؟`, { ok: 'حذف', danger: true }))) return;
    try { store.deleteProduct(p.id); toast('تم الحذف'); go('#/products'); }
    catch (e) {
      if (await confirmBox(e.message + '. تريد إيقافه ليختفي من الفواتير الجديدة؟', { ok: 'إيقاف المنتج' })) { store.saveProduct({ id: p.id, active: false }); toast('تم إيقاف المنتج'); go('#/products'); }
    }
  };
}

// ═══ تسويات المخزون ═══
export function list(type, { root, query, path }) {
  setTitle('تسويات المخزون');
  const s = S();
  const B = store.getBooks();
  const per = periodOf(query, 'all');
  const rows = store.getDb().docs.filter((d) => d.type === 'adjust' && inPeriod(d, per)).sort((a, b) => b.date.localeCompare(a.date) || b.no - a.no);
  const valueOf = (d) => (B.lineCosts.get(d.id) || []).reduce((t, c, i) => t + (c ? Math.sign(num(d.lines[i].qty)) * c.cost : 0), 0);
  root.innerHTML = String(html`
    ${head('تسويات المخزون', { sub: 'لتصحيح الكميات بعد الجرد أو تسجيل التالف والهدايا', actions: html`<a class="btn btn-primary" href="#/adjustments/new">➕ تسوية جديدة</a>` })}
    <div class="toolbar">${periodBar(per)}</div>
    ${rows.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>الرقم</th><th>التاريخ</th><th>السبب</th><th class="num">عدد الأصناف</th><th class="num">أثر القيمة</th></tr></thead><tbody>
      ${rows.map((d) => html`<tr data-href="${docHref(d)}"><td dir="ltr" class="nowrap"><b>${docNo(d, s)}</b></td><td>${fmtDate(d.date)}</td><td>${d.notes || ''}</td><td class="num">${(d.lines || []).length}</td><td class="num">${money(valueOf(d))}</td></tr>`)}
    </tbody></table></div>` : empty('⚖️', 'لا توجد تسويات', 'بعد الجرد اكتب الكمية الفعلية لكل صنف، ويسجّل البرنامج الفرق وقيده تلقائياً.', html`<a class="btn btn-primary" href="#/adjustments/new">➕ تسوية جديدة</a>`)}`);
  bindRows(root);
  bindPeriod(root, path, query);
}

export function form(type, { root, params, query }) {
  const s = S();
  const existing = params.id ? store.findDoc(params.id) : null;
  if (params.id && (!existing || existing.type !== 'adjust')) { root.innerHTML = String(empty('🔎', 'المستند غير موجود')); return; }
  const d = existing ? clone(existing) : { type: 'adjust', date: today(), account: 'adj', notes: '', lines: [] };
  if (!existing && query.product) { const p = store.findProduct(query.product); if (p) d.lines.push({ product: p.id, qty: '', cost: '' }); }
  if (!d.lines.length) d.lines.push({ product: null, qty: '', cost: '' });
  const title = existing ? `تعديل تسوية ${docNo(existing, s)}` : 'تسوية مخزون جديدة';
  setTitle(title);
  // الكمية الحالية قبل هذه التسوية (بإلغاء أثرها إن كانت قديمة)
  const current = (pid) => {
    const base = stockOf(pid).qty;
    const mine = existing ? existing.lines.filter((l) => l.product === pid).reduce((t, l) => t + num(l.qty), 0) : 0;
    return round(base - mine, 3);
  };
  root.innerHTML = String(html`${head(title, { actions: html`<a class="btn btn-ghost" href="${existing ? docHref(existing) : '#/adjustments'}">إلغاء</a>` })}
    <form novalidate data-form>
      <div class="card"><div class="form-grid">
        ${field('التاريخ', html`<input class="inp" type="date" data-f="date" data-k="date" value="${d.date}">`)}
        ${field('الحساب المقابل', html`<select class="inp" data-k="account">${store.getDb().accounts.filter((a) => !a.group && a.type === 'expense').map((a) => html`<option value="${a.id}" ${a.id === d.account ? raw('selected') : ''}>${a.name}</option>`)}</select>`, { hint: 'فروقات الجرد والتالف افتراضياً' })}
        <div class="span2">${field('السبب', html`<input class="inp" data-k="notes" value="${d.notes || ''}" placeholder="مثال: جرد نهاية الشهر، تالف، عينات مجانية">`)}</div>
      </div></div>
      <div class="card" style="margin-top:14px"><div class="card-h"><h3>الأصناف</h3><span class="muted small">اكتب الكمية الفعلية بعد العد، أو الفرق مباشرة</span></div>
        <div data-lines></div><small class="fld-e" data-err="lines" hidden></small>
        <button type="button" class="btn btn-ghost btn-sm" data-add style="margin-top:10px">➕ صنف آخر</button></div>
      <div class="form-actions sticky-actions"><button class="btn btn-primary">💾 حفظ التسوية</button></div>
    </form>`);
  const box = $('[data-lines]', root);
  function draw() {
    box.innerHTML = String(html`<div class="lines">
      <div class="adj-line line-h"><span>الصنف</span><span>المسجّل</span><span>الفعلي بعد العد</span><span>الفرق</span><span>تكلفة الوحدة</span><span></span></div>
      ${d.lines.map((l, i) => { const p = store.findProduct(l.product); const cur = p ? current(p.id) : 0;
        return html`<div class="adj-line" data-i="${i}">
          <div class="a-p" data-label="الصنف"><input class="inp" data-p data-f="product${i}" value="${p ? p.name : ''}" placeholder="اختر المنتج"><small class="fld-e" data-err="product${i}" hidden></small></div>
          <div class="a-cur" data-label="المسجّل"><b>${p ? qty(cur) : '—'}</b></div>
          <div class="a-act" data-label="الفعلي بعد العد"><input class="inp" type="text" inputmode="decimal" data-num autocomplete="off" data-actual value="${p && l.qty !== '' ? round(cur + num(l.qty), 3) : ''}"></div>
          <div class="a-delta" data-label="الفرق (+ زيادة / − نقص)"><input class="inp" type="text" inputmode="decimal" data-num autocomplete="off" data-f="qty${i}" data-delta value="${l.qty}"></div>
          <div class="a-cost" data-label="تكلفة الوحدة (للزيادة)"><input class="inp" type="text" inputmode="decimal" data-num autocomplete="off" data-cost value="${l.cost ?? ''}" placeholder="${p ? round(avgCost(p), dec()) : ''}"></div>
          <div class="a-del"><button type="button" class="icon-btn" data-del aria-label="حذف">✕</button></div></div>`; })}
    </div>`);
    $$('.adj-line[data-i]', box).forEach((row) => {
      const i = Number(row.dataset.i);
      combo($('[data-p]', row), {
        items: () => productItems('cost')().filter((it) => store.findProduct(it.value)?.type === 'stock'),
        onType: () => { d.lines[i].product = null; },
        onPick: (it) => { d.lines[i].product = it.value; guard.dirty = true; draw(); $(`.adj-line[data-i="${i}"] [data-actual]`, box)?.focus(); },
      });
    });
  }
  box.addEventListener('input', (e) => {
    const tr = e.target.closest('.adj-line[data-i]');
    if (!tr) return;
    const i = Number(tr.dataset.i);
    const l = d.lines[i];
    guard.dirty = true;
    if (e.target.matches('[data-actual]')) {
      const cur = l.product ? current(l.product) : 0;
      l.qty = e.target.value === '' ? '' : round(num(e.target.value) - cur, 3);
      $('[data-delta]', tr).value = l.qty;
    } else if (e.target.matches('[data-delta]')) {
      l.qty = e.target.value;
      const cur = l.product ? current(l.product) : 0;
      $('[data-actual]', tr).value = e.target.value === '' ? '' : round(cur + num(e.target.value), 3);
    } else if (e.target.matches('[data-cost]')) l.cost = e.target.value;
  });
  root.addEventListener('input', (e) => { const k = e.target.dataset.k; if (k) { d[k] = e.target.value; guard.dirty = true; } });
  root.addEventListener('change', (e) => { const k = e.target.dataset.k; if (k) { d[k] = e.target.value; guard.dirty = true; } });
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-add]')) { d.lines.push({ product: null, qty: '', cost: '' }); draw(); }
    const del = e.target.closest('[data-del]');
    if (del) { d.lines.splice(Number(del.closest('.adj-line').dataset.i), 1); if (!d.lines.length) d.lines.push({ product: null, qty: '', cost: '' }); draw(); }
  });
  $('[data-form]', root).onsubmit = (e) => {
    e.preventDefault();
    const doc = { ...d, notes: String(d.notes || '').trim(), lines: d.lines.filter((l) => l.product || l.qty !== '').map((l) => ({ product: l.product, qty: num(l.qty), cost: l.cost === '' || l.cost == null ? '' : num(l.cost) })) };
    if (!showErrors(root, validateDoc(store.getDb(), doc))) { toast('راجع الحقول المظللة', 'err'); return; }
    store.saveDoc(doc);
    guard.dirty = false;
    toast('تم حفظ التسوية ✓');
    go(docHref(doc));
  };
  draw();
}

export function show(type, { root, params }) {
  const d = store.findDoc(params.id);
  if (!d || d.type !== 'adjust') { setTitle('تسوية مخزون'); root.innerHTML = String(empty('🔎', 'المستند غير موجود')); return; }
  const s = S();
  const B = store.getBooks();
  const no = docNo(d, s);
  setTitle('تسوية مخزون ' + no);
  const costs = B.lineCosts.get(d.id) || [];
  const table = html`<table class="tbl" data-table><thead><tr><th>الصنف</th><th class="num">الفرق</th><th class="num">تكلفة الوحدة</th><th class="num">القيمة</th></tr></thead><tbody>
    ${(d.lines || []).map((l, i) => html`<tr><td>${store.findProduct(l.product)?.name || ''}</td><td class="num">${qty(l.qty)}</td><td class="num">${costs[i] ? money(costs[i].unit) : ''}</td><td class="num">${costs[i] ? money(Math.sign(num(l.qty)) * costs[i].cost) : ''}</td></tr>`)}
  </tbody></table>`;
  root.innerHTML = String(html`
    ${head('تسوية مخزون ' + no, { sub: `${fmtDate(d.date)}${d.notes ? ' · ' + d.notes : ''}`, actions: html`<button class="btn btn-ghost" data-print>🖨️ طباعة</button><a class="btn btn-ghost" href="#/adjustments/${d.id}/edit">✏️ تعديل</a><button class="btn btn-text-danger" data-del>🗑️ حذف</button>` })}
    <div class="tbl-wrap">${table}</div>
    <div class="card" style="margin-top:14px"><div class="card-h"><h3>📒 القيد المحاسبي</h3></div>${entryTable(B.entries.get(d.id))}</div>`);
  $('[data-print]', root).onclick = () => printPaper(html`<div class="paper pp-report"><h1 style="font-size:18px;margin-bottom:6px">تسوية مخزون ${no}</h1><p class="muted">${fmtDate(d.date)} — ${d.notes || ''}</p><div style="margin-top:10px">${table}</div><div class="pp-sign"><div>أمين المخزن</div><div>المحاسب</div><div>المدير</div></div></div>`, { title: no });
  $('[data-del]', root).onclick = async () => {
    if (!(await confirmBox(`حذف التسوية ${no}؟ ستعود الكميات كما كانت.`, { ok: 'حذف', danger: true }))) return;
    store.deleteDoc(d.id);
    toast('تم الحذف');
    go('#/adjustments');
  };
}
