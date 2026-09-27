// ═══ العملاء والموردون: القائمة، البطاقة، كشف الحساب ═══
import * as store from '../store.js';
import { docNo, DOC_TYPES, num, partyStatement, validSaudiVat, daysBetween, calcDoc } from '../core.js';
import { html, raw, money, fmtDate, toast, confirmBox, showErrors, empty, norm, $, exportTable, moneyText, field, badge, attr } from '../ui.js';
import { go, guard, setTitle, docHref, withQuery } from '../nav.js';
import { head, bindRows, today, S, dec, periodOf, periodBar, bindPeriod, periodLabel, printReport, waLink, csvName, docStatus } from './common.js';

const WORDS = {
  customer: { one: 'عميل', plural: 'العملاء', seg: 'customers', icon: '👥', newDoc: ['#/sales/new', '🧾 فاتورة مبيعات'], voucher: ['#/receipts/new', '📥 سند قبض'], balance: 'مستحق من العميل' },
  supplier: { one: 'مورد', plural: 'الموردون', seg: 'suppliers', icon: '🏭', newDoc: ['#/purchases/new', '🛒 فاتورة مشتريات'], voucher: ['#/payments/new', '📤 سند صرف'], balance: 'مستحق للمورد' },
};

export function list(kind, { root, query }) {
  const W = WORDS[kind];
  setTitle(W.plural);
  const db = store.getDb();
  const B = store.getBooks();
  const all = db.parties.filter((p) => p.kind === kind).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  const state = { q: query.q || '', only: query.only || '' };
  const overdueOf = (p) => (B.openItems.get(p.id) || []).filter((it) => it.side === 'c').reduce((t, it) => {
    const d = store.findDoc(it.doc);
    return d && d.dueDate && d.dueDate < today() ? t + it.open : t;
  }, 0);

  root.innerHTML = String(html`
    ${head(W.plural, { sub: `${all.length} ${W.one}`, actions: html`<a class="btn btn-primary" href="#/${W.seg}/new">➕ ${W.one} جديد</a>` })}
    <div class="toolbar"><input class="inp grow" type="search" data-q placeholder="بحث بالاسم أو الجوال أو الرقم الضريبي" value="${state.q}">
      <select class="inp" data-only><option value="">الكل</option><option value="bal">عليهم رصيد</option><option value="late">متأخرون</option></select>
      <button class="btn btn-ghost btn-sm" data-csv>⬇️ Excel</button></div>
    <div data-out></div>`);
  $('[data-only]', root).value = state.only;

  function draw() {
    const q = norm(state.q.trim());
    const rows = all.map((p) => ({ p, bal: B.partyBalance.get(p.id) || 0, late: overdueOf(p) }))
      .filter((r) => (!q || norm(`${r.p.name} ${r.p.phone || ''} ${r.p.vatNo || ''}`).includes(q))
        && (state.only !== 'bal' || r.bal > 0) && (state.only !== 'late' || r.late > 0));
    const out = $('[data-out]', root);
    if (!all.length) {
      out.innerHTML = String(empty(W.icon, `لا يوجد ${W.plural} بعد`, kind === 'customer' ? 'أضف عملاءك لتتابع أرصدتهم وكشوف حساباتهم، أو بِع نقداً بدون عميل.' : 'أضف مورديك لتسجيل المشتريات الآجلة ومتابعة ما عليك.', html`<a class="btn btn-primary" href="#/${W.seg}/new">➕ ${W.one} جديد</a>`));
      return;
    }
    const total = rows.reduce((t, r) => t + r.bal, 0);
    out.innerHTML = String(html`<div class="sum-bar"><span>العدد: <b>${rows.length}</b></span><span>إجمالي الأرصدة: <b>${money(total, { sym: true })}</b></span></div>
      ${rows.length ? html`<div class="tbl-wrap"><table class="tbl" data-table><thead><tr><th>الاسم</th><th>الجوال</th><th class="hide-sm">الرقم الضريبي</th><th class="num">الرصيد</th><th class="num hide-sm">متأخر</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr data-href="#/${W.seg}/${r.p.id}"><td><b>${r.p.name}</b></td><td dir="ltr" class="nowrap">${r.p.phone || ''}</td><td class="hide-sm" dir="ltr">${r.p.vatNo || ''}</td>
        <td class="num">${money(r.bal)}</td><td class="num hide-sm">${r.late ? html`<span class="neg">${money(r.late)}</span>` : '—'}</td></tr>`)}</tbody></table></div>`
      : html`<div class="empty"><p>لا توجد نتائج مطابقة.</p></div>`}`);
  }
  draw();
  bindRows(root);
  const sync = () => history.replaceState(null, '', '#/' + W.seg + '?' + new URLSearchParams({ q: state.q, only: state.only }).toString());
  $('[data-q]', root).oninput = (e) => { state.q = e.target.value; draw(); sync(); };
  $('[data-only]', root).onchange = (e) => { state.only = e.target.value; draw(); sync(); };
  $('[data-csv]', root).onclick = () => { const t = $('[data-table]', root); if (t) exportTable(t, csvName(W.plural)); };
}

export function form(kind, { root, params }) {
  const W = WORDS[kind];
  const s = S();
  const existing = params.id ? store.findParty(params.id) : null;
  if (params.id && (!existing || existing.kind !== kind)) { root.innerHTML = String(empty('🔎', `${W.one} غير موجود`)); return; }
  const p = existing ? { ...existing } : { kind, name: '', phone: '', email: '', vatNo: '', crNo: '', address: '', notes: '', opening: 0 };
  const title = existing ? `تعديل: ${existing.name}` : `${W.one} جديد`;
  setTitle(title);
  const f = (label, k, attrs = '', opts = {}) => field(label, html`<input class="inp" data-k="${k}" data-f="${k}" ${raw(attrs)} value="${p[k] ?? ''}">`, opts);

  root.innerHTML = String(html`${head(title, { actions: html`<a class="btn btn-ghost" href="${existing ? '#/' + W.seg + '/' + existing.id : '#/' + W.seg}">إلغاء</a>` })}
    <form novalidate data-form><div class="card"><div class="form-grid">
      <div class="span2">${f('الاسم', 'name', 'autofocus')}<small class="fld-e" data-err="name" hidden></small></div>
      ${f('الجوال', 'phone', 'inputmode="tel" dir="ltr"', { hint: 'للتواصل وإرسال الفواتير عبر واتساب' })}
      ${f('البريد الإلكتروني', 'email', 'type="email" dir="ltr"')}
      <div>${f('الرقم الضريبي', 'vatNo', 'inputmode="numeric" dir="ltr"', { hint: kind === 'customer' ? 'وجوده يجعل الفاتورة «فاتورة ضريبية» بدل «مبسطة»' : '' })}<small class="fld-e" data-err="vatNo" hidden></small></div>
      ${f('السجل التجاري', 'crNo', 'dir="ltr"')}
      <div class="span2">${f('العنوان', 'address')}</div>
      <div>${f(kind === 'customer' ? 'الرصيد الافتتاحي (عليه لكم)' : 'الرصيد الافتتاحي (له عليكم)', 'opening', 'type="text" inputmode="decimal" data-num autocomplete="off"', { hint: `الرصيد في ${s.startDate ? fmtDate(s.startDate) : 'تاريخ بداية التشغيل'}. اكتبه بالسالب إذا كان العكس.` })}</div>
      <div class="span-all">${field('ملاحظات', html`<textarea class="inp" data-k="notes" rows="2">${p.notes || ''}</textarea>`)}</div>
    </div></div>
    <div class="form-actions sticky-actions"><button class="btn btn-primary">💾 حفظ</button></div></form>`);

  root.addEventListener('input', (e) => { const k = e.target.dataset.k; if (k) { p[k] = e.target.value; guard.dirty = true; } });
  $('[data-form]', root).onsubmit = (e) => {
    e.preventDefault();
    const errs = {};
    p.name = String(p.name || '').trim();
    p.vatNo = String(p.vatNo || '').replace(/\s/g, '');
    if (!p.name) errs.name = 'اكتب الاسم';
    else if (store.getDb().parties.some((x) => x.kind === kind && x.id !== p.id && norm(x.name) === norm(p.name))) errs.name = `يوجد ${W.one} بنفس الاسم`;
    if (p.vatNo && s.country === 'SA' && !validSaudiVat(p.vatNo)) errs.vatNo = 'الرقم الضريبي السعودي 15 رقماً يبدأ وينتهي بالرقم 3';
    if (!showErrors(root, errs)) return;
    p.opening = num(p.opening);
    for (const k of ['phone', 'email', 'crNo', 'address', 'notes']) p[k] = String(p[k] || '').trim();
    const saved = store.saveParty(p);
    guard.dirty = false;
    toast('تم الحفظ ✓');
    go(`#/${W.seg}/${saved.id}`);
  };
}

export function show(kind, { root, params, query, path }) {
  const W = WORDS[kind];
  const p = store.findParty(params.id);
  if (!p || p.kind !== kind) { setTitle(W.plural); root.innerHTML = String(empty('🔎', `${W.one} غير موجود`, '', html`<a class="btn btn-ghost" href="#/${W.seg}">العودة</a>`)); return; }
  setTitle(p.name);
  const s = S();
  const db = store.getDb();
  const B = store.getBooks();
  const tab = query.tab || 'statement';
  const per = periodOf(query, 'all');
  const bal = B.partyBalance.get(p.id) || 0;
  const docs = db.docs.filter((d) => d.party === p.id).sort((a, b) => b.date.localeCompare(a.date));
  const open = (B.openItems.get(p.id) || []).filter((it) => it.side === 'c');
  const late = open.reduce((t, it) => { const d = store.findDoc(it.doc); return d && d.dueDate && d.dueDate < today() ? t + it.open : t; }, 0);
  const salesType = kind === 'customer' ? 'sale' : 'purchase';
  const yearStart = today().slice(0, 4) + '-01-01';
  const volume = docs.filter((d) => d.type === salesType && d.date >= yearStart).reduce((t, d) => t + (B.totals.get(d.id)?.total || 0), 0);

  root.innerHTML = String(html`
    ${head(p.name, {
      sub: html`${[p.phone, p.vatNo ? 'ضريبي ' + p.vatNo : '', p.address].filter(Boolean).join(' · ') || W.one}`,
      actions: html`<a class="btn btn-primary" href="${W.newDoc[0]}?party=${p.id}">${W.newDoc[1]}</a>
        <a class="btn btn-ghost" href="${W.voucher[0]}?party=${p.id}">${W.voucher[1]}</a>
        ${p.phone ? html`<button class="btn btn-ghost" data-wa>💬 واتساب</button>` : ''}
        <a class="btn btn-ghost" href="#/${W.seg}/${p.id}/edit">✏️ تعديل</a>
        <button class="btn btn-text-danger" data-del>🗑️ حذف</button>`,
    })}
    <div class="grid g4" style="margin-bottom:14px">
      <div class="kpi"><span class="kpi-l">الرصيد الحالي</span><span class="kpi-v ${bal > 0 ? '' : 'pos'}">${money(bal, { sym: true })}</span><span class="kpi-s">${bal > 0 ? W.balance : bal < 0 ? 'رصيد دائن لصالح ' + (kind === 'customer' ? 'العميل' : 'كم') : 'لا يوجد رصيد'}</span></div>
      <div class="kpi"><span class="kpi-l">متأخر السداد</span><span class="kpi-v ${late > 0 ? 'neg' : ''}">${money(late, { sym: true })}</span></div>
      <div class="kpi"><span class="kpi-l">${kind === 'customer' ? 'مبيعات' : 'مشتريات'} هذه السنة</span><span class="kpi-v">${money(volume, { sym: true })}</span></div>
      <div class="kpi"><span class="kpi-l">عدد المستندات</span><span class="kpi-v">${docs.length}</span></div>
    </div>
    <div class="tabs">${[['statement', '📄 كشف الحساب'], ['open', `🧾 غير المسددة (${open.length})`], ['docs', '🗂️ كل المستندات']].map(([k, t]) => html`<a href="${withQuery(path, { ...query, tab: k })}" class="${k === tab ? 'on' : ''}">${t}</a>`)}</div>
    <div data-tab></div>`);

  const box = $('[data-tab]', root);
  if (tab === 'statement') {
    const st = partyStatement(db, B, p.id, per);
    const desc = (r) => {
      const d = store.findDoc(r.doc);
      if (r.doc === 'opening') return 'رصيد افتتاحي';
      if (!d) return r.memo || '';
      if (r.key && r.key.endsWith(':p')) return d.type === 'sale' || d.type === 'purchase' || d.type === 'expense' ? `دفعة على ${DOC_TYPES[d.type].name}` : 'رد نقدي للمرتجع';
      return [DOC_TYPES[d.type].name, d.type === 'expense' ? '' : d.ref, d.notes].filter(Boolean).join(' — ');
    };
    box.innerHTML = String(html`<div class="toolbar">${periodBar(per)}<span class="grow"></span>
        <button class="btn btn-ghost btn-sm" data-print>🖨️ طباعة الكشف</button><button class="btn btn-ghost btn-sm" data-csv>⬇️ Excel</button></div>
      <div class="tbl-wrap"><table class="tbl" data-table><thead><tr><th>التاريخ</th><th>المستند</th><th class="hide-sm">البيان</th><th class="num">مدين</th><th class="num">دائن</th><th class="num">الرصيد</th></tr></thead>
      <tbody><tr class="grp"><td colspan="3">الرصيد السابق</td><td></td><td></td><td class="num">${money(st.opening)}</td></tr>
      ${st.rows.map((r) => { const d = store.findDoc(r.doc); return html`<tr ${d ? attr('data-href', docHref(d)) : ''}><td class="nowrap">${fmtDate(r.date)}</td><td class="nowrap" dir="ltr">${d ? docNo(d, s) : 'افتتاحي'}</td><td class="hide-sm">${desc(r)}</td>
        <td class="num">${r.dr ? money(r.dr) : ''}</td><td class="num">${r.cr ? money(r.cr) : ''}</td><td class="num"><b>${money(r.balance)}</b></td></tr>`; })}
      </tbody><tfoot><tr><td colspan="3">الإجمالي والرصيد الختامي</td><td class="num">${money(st.dr)}</td><td class="num">${money(st.cr)}</td><td class="num">${money(st.closing)}</td></tr></tfoot></table></div>
      <p class="tbl-note">${kind === 'customer' ? 'المدين: فواتير عليه. الدائن: دفعات ومرتجعات. الرصيد الموجب مستحق لكم.' : 'الدائن: فواتير له. المدين: دفعات ومرتجعات. الرصيد الموجب مستحق له.'}</p>`);
    bindPeriod(root, path, { ...query, tab });
    $('[data-print]', box).onclick = () => printReport(`كشف حساب ${W.one}: ${p.name}`, periodLabel(per), $('[data-table]', box));
    $('[data-csv]', box).onclick = () => exportTable($('[data-table]', box), csvName('كشف حساب ' + p.name));
  } else if (tab === 'open') {
    box.innerHTML = String(open.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>المستند</th><th>التاريخ</th><th>الاستحقاق</th><th class="num">المتبقي</th><th>التأخير</th></tr></thead><tbody>
      ${open.map((it) => { const d = store.findDoc(it.doc); const dueOn = (d && d.dueDate) || it.date; const lateDays = daysBetween(dueOn, today());
        return html`<tr ${d ? attr('data-href', docHref(d)) : ''}><td dir="ltr" class="nowrap">${d ? docNo(d, s) : 'رصيد افتتاحي'}</td><td>${fmtDate(it.date)}</td><td>${d && d.dueDate ? fmtDate(d.dueDate) : '—'}</td><td class="num"><b>${money(it.open)}</b></td>
          <td>${lateDays > 0 && d && d.dueDate ? html`<span class="badge badge-bad">${lateDays} يوم</span>` : html`<span class="badge badge-muted">غير متأخر</span>`}</td></tr>`; })}
      </tbody></table></div>` : empty('✅', 'لا توجد مبالغ غير مسددة'));
  } else {
    box.innerHTML = String(docs.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>النوع</th><th>الرقم</th><th>التاريخ</th><th class="num">المبلغ</th><th>الحالة</th></tr></thead><tbody>
      ${docs.map((d) => { const t = d.lines ? calcDoc(d, dec()).total : B.totals.get(d.id)?.total ?? num(d.amount); const st = docStatus(d, B);
        return html`<tr data-href="${docHref(d)}"><td>${DOC_TYPES[d.type].name}</td><td dir="ltr" class="nowrap">${docNo(d, s)}</td><td>${fmtDate(d.date)}</td><td class="num">${money(t)}</td><td>${st && st.state ? badge(st.state) : ''}</td></tr>`; })}
      </tbody></table></div>` : empty('🗂️', 'لا توجد مستندات'));
  }
  bindRows(root);

  const wa = $('[data-wa]', root);
  if (wa) wa.onclick = () => {
    const lines = [`السادة ${p.name}`, `رصيد حسابكم لدى ${s.name || 'منشأتنا'} بتاريخ ${fmtDate(today())}:`, moneyText(bal)];
    if (late > 0) lines.push(`منها متأخر السداد: ${moneyText(late)}`);
    lines.push('', 'شاكرين تعاونكم');
    const text = lines.join('\n');
    window.open(waLink(p.phone, text), '_blank', 'noopener');
  };
  $('[data-del]', root).onclick = async () => {
    if (!(await confirmBox(`حذف ${p.name}؟`, { ok: 'حذف', danger: true }))) return;
    try { store.deleteParty(p.id); toast('تم الحذف'); go('#/' + W.seg); } catch (e) { toast(e.message, 'err'); }
  };
}
