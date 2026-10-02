// ═══ التحويلات المخزنية بين المستودعات (كميات فقط، التكلفة واحدة للمنشأة) ═══
import * as store from '../store.js';
import { docNo, num, round, validateDoc, MAIN_WH } from '../core.js';
import { html, raw, qty, fmtDate, toast, confirmBox, combo, $, $$, field, empty, showErrors } from '../ui.js';
import { go, guard, setTitle, docHref } from '../nav.js';
import { head, bindRows, S, today, productItems, printPaper, docLocked, lockedNote, lockedPage } from './common.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
export const whName = (id) => store.getDb().warehouses.find((w) => w.id === id)?.name || (id === MAIN_WH ? 'المستودع الرئيسي' : '—');
export const whQtyOf = (pid, wh) => store.getBooks().whQty.get(pid)?.get(wh) || 0;

export function list(type, { root }) {
  setTitle('التحويلات المخزنية');
  const s = S();
  const rows = store.getDb().docs.filter((d) => d.type === 'stransfer').sort((a, b) => b.date.localeCompare(a.date) || b.no - a.no);
  root.innerHTML = String(html`${head('التحويلات المخزنية', { sub: 'نقل البضاعة بين المستودعات والفروع', actions: html`<a class="btn btn-primary" href="#/stock-transfers/new">➕ تحويل جديد</a>` })}
    ${store.getDb().warehouses.length < 2 ? html`<p class="note note-info" style="margin-bottom:12px">أضف مستودعين على الأقل من <a href="#/settings">الإعدادات</a> ← المستودعات والفروع.</p>` : ''}
    ${rows.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>الرقم</th><th>التاريخ</th><th>من</th><th>إلى</th><th class="num">الأصناف</th></tr></thead><tbody>
      ${rows.map((d) => html`<tr data-href="${docHref(d)}"><td dir="ltr" class="nowrap"><b>${docNo(d, s)}</b></td><td>${fmtDate(d.date)}</td><td>${whName(d.from)}</td><td>${whName(d.to)}</td><td class="num">${d.lines.length}</td></tr>`)}
    </tbody></table></div>` : empty('🚚', 'لا توجد تحويلات', 'حوّل الكميات من مستودع لآخر، ويتابع البرنامج رصيد كل مستودع.', html`<a class="btn btn-primary" href="#/stock-transfers/new">➕ تحويل جديد</a>`)}`);
  bindRows(root);
}

export function form(type, { root, params, query }) {
  const db = store.getDb();
  const existing = params.id ? store.findDoc(params.id) : null;
  if (params.id && (!existing || existing.type !== 'stransfer')) { root.innerHTML = String(empty('🔎', 'المستند غير موجود')); return; }
  if (existing && docLocked(existing)) { setTitle('تحويل مخزني'); root.innerHTML = String(lockedPage(existing)); return; }
  const whs = db.warehouses;
  const d = existing ? clone(existing) : { type: 'stransfer', date: today(), from: whs[0]?.id || '', to: whs[1]?.id || '', notes: '', lines: [{ product: null, qty: '' }] };
  if (!existing && query.product) d.lines = [{ product: query.product, qty: '' }];
  const title = existing ? `تعديل تحويل ${docNo(existing, S())}` : 'تحويل مخزني جديد';
  setTitle(title);
  const opts = (sel) => html`${whs.map((w) => html`<option value="${w.id}" ${w.id === sel ? raw('selected') : ''}>${w.name}</option>`)}`;
  root.innerHTML = String(html`${head(title, { actions: html`<a class="btn btn-ghost" href="${existing ? docHref(existing) : '#/stock-transfers'}">إلغاء</a>` })}
    <form novalidate data-form><div class="card"><div class="form-grid">
      ${field('التاريخ', html`<input class="inp" type="date" data-f="date" data-k="date" value="${d.date}">`)}
      ${field('من مستودع', html`<select class="inp" data-f="from" data-k="from">${opts(d.from)}</select>`)}
      ${field('إلى مستودع', html`<select class="inp" data-f="to" data-k="to">${opts(d.to)}</select>`)}
      <div class="span-all">${field('ملاحظات', html`<input class="inp" data-k="notes" value="${d.notes || ''}" placeholder="مثال: تغذية فرع جدة">`)}</div>
    </div></div>
    <div class="card" style="margin-top:14px"><div class="card-h"><h3>الأصناف</h3></div><div data-lines></div><small class="fld-e" data-err="lines" hidden></small>
      <button type="button" class="btn btn-ghost btn-sm" data-add style="margin-top:10px">➕ صنف آخر</button></div>
    <div class="form-actions sticky-actions"><button class="btn btn-primary">💾 حفظ التحويل</button></div></form>`);
  const box = $('[data-lines]', root);
  const avail = (pid) => round(whQtyOf(pid, d.from) + (existing && existing.from === d.from ? existing.lines.filter((l) => l.product === pid).reduce((t, l) => t + num(l.qty), 0) : 0), 3);
  function draw() {
    box.innerHTML = String(html`<div class="lines">${d.lines.map((l, i) => { const p = store.findProduct(l.product);
      return html`<div class="adj-line tr-line" data-i="${i}">
        <div class="a-p" data-label="الصنف"><input class="inp" data-p data-f="product${i}" value="${p ? p.name : ''}" placeholder="اختر المنتج"><small class="fld-e" data-err="product${i}" hidden></small></div>
        <div class="a-cur" data-label="المتوفر في المصدر"><b>${p ? qty(avail(p.id)) : '—'}</b></div>
        <div class="a-act" data-label="الكمية"><input class="inp" type="text" inputmode="decimal" data-num data-f="qty${i}" data-q value="${l.qty}"><small class="fld-e" data-err="qty${i}" hidden></small></div>
        <div class="a-del"><button type="button" class="icon-btn" data-del aria-label="حذف">✕</button></div></div>`; })}</div>`);
    $$('.tr-line', box).forEach((row) => {
      const i = Number(row.dataset.i);
      combo($('[data-p]', row), {
        items: () => productItems('cost')().filter((it) => store.findProduct(it.value)?.type === 'stock'),
        onType: () => { d.lines[i].product = null; },
        onPick: (it) => { d.lines[i].product = it.value; guard.dirty = true; draw(); $(`.tr-line[data-i="${i}"] [data-q]`, box)?.focus(); },
      });
    });
  }
  box.addEventListener('input', (e) => { const row = e.target.closest('.tr-line'); if (row && e.target.matches('[data-q]')) { d.lines[Number(row.dataset.i)].qty = e.target.value; guard.dirty = true; } });
  root.addEventListener('change', (e) => { const k = e.target.dataset.k; if (k) { d[k] = e.target.value; guard.dirty = true; if (k === 'from') draw(); } });
  root.addEventListener('input', (e) => { if (e.target.dataset.k === 'notes') d.notes = e.target.value; });
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-add]')) { d.lines.push({ product: null, qty: '' }); draw(); }
    const del = e.target.closest('[data-del]');
    if (del) { d.lines.splice(Number(del.closest('.tr-line').dataset.i), 1); if (!d.lines.length) d.lines.push({ product: null, qty: '' }); draw(); }
  });
  $('[data-form]', root).onsubmit = async (e) => {
    e.preventDefault();
    const doc = { ...d, notes: String(d.notes || '').trim(), lines: d.lines.filter((l) => l.product || l.qty !== '').map((l) => ({ product: l.product, qty: num(l.qty) })) };
    if (!showErrors(root, validateDoc(store.getDb(), doc))) { toast('راجع الحقول المظللة', 'err'); return; }
    const short = doc.lines.filter((l) => l.qty > avail(l.product));
    if (short.length && !(await confirmBox(`الكمية المحوّلة أكبر من المتوفر في ${whName(doc.from)} لـ ${short.length} صنف. متابعة؟`, { ok: 'حفظ على أي حال' }))) return;
    store.saveDoc(doc);
    guard.dirty = false;
    toast('تم حفظ التحويل ✓');
    go(docHref(doc));
  };
  draw();
}

export function show(type, { root, params }) {
  const d = store.findDoc(params.id);
  if (!d || d.type !== 'stransfer') { setTitle('تحويل مخزني'); root.innerHTML = String(empty('🔎', 'المستند غير موجود')); return; }
  const s = S();
  const no = docNo(d, s);
  setTitle('تحويل مخزني ' + no);
  const locked = docLocked(d);
  const table = html`<table class="tbl" data-table><thead><tr><th>الصنف</th><th class="num">الكمية</th></tr></thead><tbody>
    ${d.lines.map((l) => html`<tr><td>${store.findProduct(l.product)?.name || ''}</td><td class="num">${qty(l.qty)} ${store.findProduct(l.product)?.unit || ''}</td></tr>`)}</tbody></table>`;
  root.innerHTML = String(html`${head('تحويل مخزني ' + no, { sub: `${fmtDate(d.date)} · من ${whName(d.from)} إلى ${whName(d.to)}`,
    actions: html`<button class="btn btn-primary" data-print>🖨️ طباعة</button>${locked ? '' : html`<a class="btn btn-ghost" href="#/stock-transfers/${d.id}/edit">✏️ تعديل</a><button class="btn btn-text-danger" data-del>🗑️ حذف</button>`}` })}
    ${locked ? lockedNote(d) : ''}${d.notes ? html`<p class="muted" style="margin-bottom:10px">${d.notes}</p>` : ''}
    <div class="tbl-wrap">${table}</div>`);
  $('[data-print]', root).onclick = () => printPaper(html`<div class="paper pp-report"><div class="pp-head"><div><h2 style="font-size:18px;font-weight:900">${s.name || ''}</h2></div><div class="pp-title"><h1>سند تحويل مخزني</h1><div class="en" dir="ltr">${no}</div></div></div>
    <div class="pp-meta"><div><span>التاريخ</span><b>${fmtDate(d.date)}</b></div><div><span>من</span><b>${whName(d.from)}</b></div><div><span>إلى</span><b>${whName(d.to)}</b></div></div>
    <div style="margin-top:10px">${table}</div><div class="pp-sign"><div>المُسلِّم</div><div>المستلم</div><div>أمين المخزن</div></div></div>`, { title: no });
  const del = $('[data-del]', root);
  if (del) del.onclick = async () => {
    if (!(await confirmBox(`حذف التحويل ${no}؟ تعود الكميات لمستودعها الأصلي.`, { ok: 'حذف', danger: true }))) return;
    store.deleteDoc(d.id); toast('تم الحذف'); go('#/stock-transfers');
  };
}
