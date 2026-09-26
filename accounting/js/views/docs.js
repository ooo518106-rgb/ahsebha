// ═══ مستندات البنود: فواتير المبيعات، عروض الأسعار، المرتجعات، فواتير المشتريات ═══
import * as store from '../store.js';
import { calcDoc, docNo, DOC_TYPES, validateDoc, num, round, addDays } from '../core.js';
import { html, raw, money, fmtDate, toast, confirmBox, combo, showErrors, badge, empty, norm, $, $$, exportTable, moneyText, field } from '../ui.js';
import { go, guard, setTitle, docHref, SEG } from '../nav.js';
import {
  head, bindRows, today, S, dec, taxLabel, partyName, docStatus, periodOf, periodBar, bindPeriod, inPeriod,
  moneyList, partyItems, productItems, quickParty, quickProduct, taxOptions, docPaper, printPaper, entryTable, waLink, csvName,
} from './common.js';

const CFG = {
  sale: { icon: '🧾', kind: 'customer', priceKey: 'price', newLabel: 'فاتورة جديدة', payLabel: 'طريقة الدفع', credit: 'آجل على العميل', paidLabel: 'المبلغ المدفوع' },
  quote: { icon: '📝', kind: 'customer', priceKey: 'price', newLabel: 'عرض سعر جديد' },
  sreturn: { icon: '↩️', kind: 'customer', priceKey: 'price', newLabel: 'مرتجع جديد', payLabel: 'طريقة الاسترداد', credit: 'رصيد للعميل (بدون رد نقدي)', paidLabel: 'المبلغ المردود', ref: 'sale' },
  purchase: { icon: '🛒', kind: 'supplier', priceKey: 'cost', newLabel: 'فاتورة مشتريات جديدة', payLabel: 'طريقة الدفع', credit: 'آجل على المورد', paidLabel: 'المبلغ المدفوع' },
  preturn: { icon: '↪️', kind: 'supplier', priceKey: 'cost', newLabel: 'مرتجع جديد', payLabel: 'طريقة الاسترداد', credit: 'خصم من رصيد المورد', paidLabel: 'المبلغ المسترد', ref: 'purchase' },
};
const kindName = (k) => (k === 'customer' ? 'العميل' : 'المورد');
const clone = (x) => JSON.parse(JSON.stringify(x));

// ═══ القائمة ═══
export function list(type, { root, query, path }) {
  const T = DOC_TYPES[type], C = CFG[type];
  setTitle(T.plural);
  const db = store.getDb();
  const B = store.getBooks();
  const s = S();
  const per = periodOf(query, 'all');
  const hasPay = type === 'sale' || type === 'purchase';
  let limit = 200;
  const state = { q: query.q || '', st: query.st || '' };

  const all = db.docs.filter((d) => d.type === type && inPeriod(d, per))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.no || 0) - (a.no || 0));

  root.innerHTML = String(html`
    ${head(T.plural, { sub: `${all.length} مستند`, actions: html`<a class="btn btn-primary" href="#/${SEG[type]}/new">➕ ${C.newLabel}</a>` })}
    <div class="toolbar">
      <input class="inp grow" type="search" data-q placeholder="بحث بالرقم أو ${kindName(C.kind)} أو الملاحظات" value="${state.q}">
      ${hasPay ? html`<select class="inp" data-st><option value="">كل الحالات</option><option value="unpaid">غير مدفوعة</option><option value="partial">مدفوعة جزئياً</option><option value="overdue">متأخرة</option><option value="paid">مدفوعة</option></select>` : ''}
      ${type === 'quote' ? html`<select class="inp" data-st><option value="">كل العروض</option><option value="open">مفتوحة</option><option value="converted">تحوّلت لفواتير</option></select>` : ''}
      ${periodBar(per)}
      <button class="btn btn-ghost btn-sm" data-csv>⬇️ Excel</button>
    </div>
    <div data-out></div>`);
  if (state.st) $('[data-st]', root).value = state.st;

  function rowsFor() {
    const q = norm(state.q.trim());
    return all.filter((d) => {
      if (q && !norm(`${docNo(d, s)} ${partyName(d.party)} ${d.ref || ''} ${d.notes || ''}`).includes(q)) return false;
      if (!state.st) return true;
      if (type === 'quote') return state.st === (d.convertedTo ? 'converted' : 'open');
      const st = docStatus(d, B);
      return st && (state.st === 'unpaid' ? st.state === 'unpaid' || st.state === 'overdue' : st.state === state.st);
    });
  }

  function draw() {
    const rows = rowsFor();
    const out = $('[data-out]', root);
    if (!all.length) {
      out.innerHTML = String(empty(C.icon, `لا توجد ${T.plural} ${per.p === 'all' ? '' : 'في هذه الفترة'}`, type === 'sale' ? 'أنشئ أول فاتورة، وسيُسجَّل القيد والمخزون والضريبة تلقائياً.' : '', html`<a class="btn btn-primary" href="#/${SEG[type]}/new">➕ ${C.newLabel}</a>`));
      return;
    }
    let total = 0, paid = 0, due = 0;
    const body = rows.slice(0, limit).map((d) => {
      const t = B.totals.get(d.id) || calcDoc(d, dec());
      const st = docStatus(d, B);
      total += t.total;
      if (st && hasPay) { paid += st.paid; due += st.due; }
      const ref = d.refId ? store.findDoc(d.refId) : null;
      return html`<tr data-href="${docHref(d)}">
        <td class="nowrap"><b dir="ltr">${docNo(d, s)}</b></td>
        <td class="nowrap">${fmtDate(d.date)}</td>
        <td>${partyName(d.party, C.kind === 'customer' ? 'عميل نقدي' : 'مورد نقدي')}</td>
        ${type === 'purchase' ? html`<td class="hide-sm">${d.ref || ''}</td>` : ''}
        ${C.ref ? html`<td class="hide-sm nowrap" dir="ltr">${ref ? docNo(ref, s) : '—'}</td>` : ''}
        <td class="num">${money(t.total)}</td>
        ${hasPay ? html`<td class="num hide-sm">${money(st.paid)}</td><td class="num">${st.due ? money(st.due) : '—'}</td><td>${badge(st.state)}</td>` : ''}
        ${C.ref ? html`<td class="num hide-sm">${num(d.paid) ? money(d.paid) : '—'}</td>` : ''}
        ${type === 'quote' ? html`<td class="hide-sm">${d.validUntil ? fmtDate(d.validUntil) : ''}</td><td>${badge(d.convertedTo ? 'converted' : d.validUntil && d.validUntil < today() ? 'expired' : 'open')}</td>` : ''}
      </tr>`;
    });
    // الإجماليات على كل النتائج وليس المعروضة فقط
    if (rows.length > limit) {
      total = 0; paid = 0; due = 0;
      for (const d of rows) { const t = B.totals.get(d.id) || calcDoc(d, dec()); total += t.total; const st = docStatus(d, B); if (st && hasPay) { paid += st.paid; due += st.due; } }
    }
    out.innerHTML = String(html`
      <div class="sum-bar"><span>العدد: <b>${rows.length}</b></span><span>الإجمالي: <b>${money(total, { sym: true })}</b></span>
        ${hasPay ? html`<span>المدفوع: <b>${money(paid, { sym: true })}</b></span><span>المتبقي: <b>${money(due, { sym: true })}</b></span>` : ''}</div>
      ${rows.length ? html`<div class="tbl-wrap"><table class="tbl" data-table><thead><tr>
        <th>الرقم</th><th>التاريخ</th><th>${kindName(C.kind)}</th>
        ${type === 'purchase' ? html`<th class="hide-sm">فاتورة المورد</th>` : ''}
        ${C.ref ? html`<th class="hide-sm">الفاتورة الأصلية</th>` : ''}
        <th class="num">الإجمالي</th>
        ${hasPay ? html`<th class="num hide-sm">المدفوع</th><th class="num">المتبقي</th><th>الحالة</th>` : ''}
        ${C.ref ? html`<th class="num hide-sm">المردود نقداً</th>` : ''}
        ${type === 'quote' ? html`<th class="hide-sm">صالح حتى</th><th>الحالة</th>` : ''}
      </tr></thead><tbody>${body}</tbody></table></div>
      ${rows.length > limit ? html`<p style="text-align:center;margin-top:12px"><button class="btn btn-ghost" data-more>عرض المزيد (${rows.length - limit})</button></p>` : ''}`
      : html`<div class="empty"><p>لا توجد نتائج مطابقة.</p></div>`}`);
  }
  draw();
  bindRows(root);
  bindPeriod(root, path, query);
  const sync = () => history.replaceState(null, '', '#/' + path + '?' + new URLSearchParams({ ...query, q: state.q, st: state.st }).toString());
  $('[data-q]', root).oninput = (e) => { state.q = e.target.value; draw(); sync(); };
  const stSel = $('[data-st]', root);
  if (stSel) stSel.onchange = () => { state.st = stSel.value; draw(); sync(); };
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) { limit += 200; draw(); }
    if (e.target.closest('[data-csv]')) { const t = $('[data-table]', root); if (t) exportTable(t, csvName(T.plural)); }
  });
}

// ═══ النموذج ═══
const emptyLine = () => ({ product: null, desc: '', qty: 1, price: '', disc: '', tax: 'S' });

export function form(type, { root, params, query }) {
  const T = DOC_TYPES[type], C = CFG[type];
  const db = store.getDb();
  const s = S();
  const existing = params.id ? store.findDoc(params.id) : null;
  if (params.id && (!existing || existing.type !== type)) { root.innerHTML = String(empty('🔎', 'المستند غير موجود')); return; }

  // ── الحالة الابتدائية ──
  let d;
  if (existing) d = clone(existing);
  else {
    d = { type, date: today(), party: query.party || null, dueDate: '', vatRate: s.vat ? num(s.vatRate) : 0, inclusive: !!s.inclusive, lines: [emptyLine()], notes: '', ref: '' };
    if (type === 'quote') d.validUntil = addDays(d.date, 15);
    const src = store.findDoc(query.from || query.copy);
    if (src && src.lines) {
      d.party = src.party; d.lines = clone(src.lines); d.inclusive = !!src.inclusive; d.notes = src.notes || '';
      if (query.from && src.type === 'quote') d.fromQuote = src.id;
    }
    const refDoc = store.findDoc(query.ref);
    if (refDoc && C.ref && refDoc.type === C.ref) {
      d.refId = refDoc.id; d.party = refDoc.party; d.lines = clone(refDoc.lines); d.inclusive = !!refDoc.inclusive; d.vatRate = num(refDoc.vatRate);
    }
    if (query.product) { const p = store.findProduct(query.product); if (p) d.lines = [lineFromProduct(p)]; }
  }
  const showTax = !!s.vat || num(d.vatRate) > 0;
  if (!showTax) d.vatRate = 0;

  // الدفع: حساب نقدي أو آجل، والمبلغ يتبع الإجمالي حتى يعدّله المستخدم
  const hasPay = type !== 'quote';
  let pay = '';
  let paidAuto = true;
  if (hasPay) {
    if (existing) {
      pay = num(existing.paid) > 0 ? existing.payAcc : '';
      paidAuto = round(num(existing.paid), dec()) === calcDoc(existing, dec()).total;
    } else if (type === 'sale') pay = 'cash';
    else if (type === 'purchase') pay = d.party ? '' : 'cash';
    else if (C.ref) {
      const st = d.refId ? store.getBooks().status.get(d.refId) : null;
      pay = !d.party || (st && st.due <= 0) ? 'cash' : '';
    }
    if (!existing && pay && !moneyList().some((a) => a.id === pay)) pay = moneyList()[0]?.id || '';
    d.paid = existing ? num(existing.paid) : 0;
  }

  function lineFromProduct(p) {
    return { product: p.id, desc: p.name, qty: 1, price: num(p[C.priceKey]) || '', disc: '', tax: showTax ? (p.tax || 'S') : 'S' };
  }
  const calc = () => calcDoc(d, dec());

  const title = existing ? `تعديل ${T.name} ${docNo(existing, s)}` : C.newLabel;
  setTitle(title);

  const refOptions = () => {
    if (!C.ref) return '';
    const docs = db.docs.filter((x) => x.type === C.ref && (!d.party || x.party === d.party)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 300);
    return html`<option value="">— بدون —</option>${docs.map((x) => html`<option value="${x.id}" ${x.id === d.refId ? raw('selected') : ''}>${docNo(x, s)} — ${fmtDate(x.date)} — ${moneyText(calcDoc(x, dec()).total)}</option>`)}`;
  };

  root.innerHTML = String(html`
    ${head(title, { actions: html`<a class="btn btn-ghost" href="${existing ? docHref(existing) : '#/' + SEG[type]}">إلغاء</a>` })}
    ${existing && (type === 'sale' || type === 'sreturn') && s.vat ? html`<p class="note note-warn" style="margin-bottom:12px">تنبيه: تعديل فاتورة صادرة يخالف قواعد الفوترة الإلكترونية. الأسلم إصدار ${type === 'sale' ? 'إشعار دائن (مرتجع)' : 'فاتورة جديدة'} لتصحيحها.</p>` : ''}
    <form novalidate data-form>
      <div class="card"><div class="form-grid">
        <div class="fld span2"><span class="fld-l">${kindName(C.kind)}${hasPay ? html` <small class="muted">(اختياري عند الدفع الكامل)</small>` : ''}</span>
          <input class="inp" data-f="party" data-party placeholder="ابحث بالاسم أو الجوال، أو أضف جديداً" value="${partyName(d.party)}">
          <small class="fld-e" data-err="party" hidden></small><small class="fld-h" data-party-info></small></div>
        ${field('التاريخ', html`<input class="inp" type="date" data-f="date" data-k="date" value="${d.date}">`, { err: '' })}
        ${type === 'sale' || type === 'purchase' ? field('تاريخ الاستحقاق', html`<input class="inp" type="date" data-k="dueDate" value="${d.dueDate || ''}">`, { hint: 'للبيع أو الشراء الآجل' }) : ''}
        ${type === 'quote' ? field('صالح حتى', html`<input class="inp" type="date" data-k="validUntil" value="${d.validUntil || ''}">`) : ''}
        ${type === 'purchase' ? field('رقم فاتورة المورد', html`<input class="inp" data-k="ref" value="${d.ref || ''}" dir="auto">`) : ''}
        ${C.ref ? html`<label class="fld span2"><span class="fld-l">الفاتورة الأصلية</span>
          <div class="inline"><select class="inp" data-ref>${refOptions()}</select><button type="button" class="btn btn-ghost btn-sm" data-copy-ref ${d.refId ? '' : raw('hidden')}>📋 نسخ بنودها</button></div>
          <small class="fld-h">${type === 'sreturn' ? 'مطلوبة في الإشعار الدائن الضريبي' : 'اختيارية'}</small></label>` : ''}
        ${showTax ? html`<label class="check span-all"><input type="checkbox" data-k="inclusive" ${d.inclusive ? raw('checked') : ''}> الأسعار شاملة ${taxLabel()}</label>` : ''}
      </div></div>

      <div style="margin-top:14px" data-lines></div>
      <small class="fld-e" data-err="lines" hidden></small>

      <div class="doc-bottom">
        <div class="stack">
          ${hasPay ? html`<div class="card"><div class="fld"><span class="fld-l">${C.payLabel}</span><div class="seg" data-pay></div><small class="fld-e" data-err="payAcc" hidden></small></div>
            <div class="form-grid" style="margin-top:10px" data-paid-box><label class="fld"><span class="fld-l">${C.paidLabel}</span>
              <input class="inp" type="text" inputmode="decimal" data-num autocomplete="off" data-f="paid" data-paid></label>
              <div class="fld"><span class="fld-l">المتبقي</span><div class="kpi-v" style="font-size:1.1rem" data-rest></div></div></div>
            <small class="fld-e" data-err="paid" hidden></small></div>` : ''}
          <div class="card">${field('ملاحظات تظهر في المستند', html`<textarea class="inp" data-k="notes" rows="2">${d.notes || ''}</textarea>`)}</div>
        </div>
        <div class="card" data-totals></div>
      </div>

      <div class="form-actions sticky-actions">
        <button class="btn btn-primary" data-save="view">💾 حفظ</button>
        <button type="button" class="btn btn-ghost" data-save="print">🖨️ حفظ وطباعة</button>
        ${existing ? '' : html`<button type="button" class="btn btn-ghost" data-save="new">حفظ وإنشاء جديد</button>`}
      </div>
    </form>`);

  const linesBox = $('[data-lines]', root);
  const totalsBox = $('[data-totals]', root);
  const stock = () => store.getBooks().stock;

  function stockHint(l) {
    const p = store.findProduct(l.product);
    if (!p || p.type !== 'stock' || !(type === 'sale' || type === 'preturn')) return '';
    const have = stock().get(p.id)?.qty || 0;
    const mine = existing ? (existing.lines || []).filter((x) => x.product === p.id).reduce((t, x) => t + num(x.qty), 0) : 0;
    const avail = round(have + mine, 3);
    const want = d.lines.filter((x) => x.product === p.id).reduce((t, x) => t + num(x.qty), 0);
    return html`<small class="c-sub ${want > avail ? 'neg' : ''}">المتوفر: ${avail}${want > avail ? ' — الكمية أكبر من المتوفر' : ''}</small>`;
  }

  function lineHTML(l, i, L) {
    const n = (k, v, ph = '') => html`<input class="inp" type="text" inputmode="decimal" data-num autocomplete="off" data-k="${k}" data-f="${k}${i}" value="${v ?? ''}" placeholder="${ph}">`;
    return html`<div class="line" data-i="${i}">
      <span class="c-idx">${i + 1}</span>
      <div class="c-desc" data-label="المنتج / البيان"><input class="inp" data-k="desc" data-f="desc${i}" value="${l.desc || ''}" placeholder="ابحث عن منتج أو اكتب بياناً">${stockHint(l)}<small class="fld-e" data-err="desc${i}" hidden></small></div>
      <div class="c-qty" data-label="الكمية">${n('qty', l.qty)}</div>
      <div class="c-price" data-label="السعر">${n('price', l.price)}</div>
      <div class="c-disc" data-label="خصم %">${n('disc', l.disc, '0')}</div>
      <div class="c-tax" data-label="${taxLabel()}"><select class="inp" data-k="tax">${taxOptions(l.tax || 'S')}</select></div>
      <div class="c-tot" data-label="الإجمالي"><span data-tot>${money(L ? L.total : 0)}</span></div>
      <div class="c-del"><button type="button" class="icon-btn" data-del aria-label="حذف البند">✕</button></div>
    </div>`;
  }

  function drawLines(focusIndex) {
    const t = calc();
    linesBox.innerHTML = String(html`<div class="lines ${showTax ? '' : 'no-tax'}">
      <div class="line line-h"><span class="c-idx">#</span><span>المنتج / البيان</span><span>الكمية</span><span>السعر${d.inclusive ? ' (شامل)' : ''}</span><span>خصم %</span><span class="c-tax">${taxLabel()}</span><span class="c-tot">الإجمالي</span><span></span></div>
      ${d.lines.map((l, i) => lineHTML(l, i, t.lines[i]))}
      <div class="lines-foot"><button type="button" class="btn btn-ghost btn-sm" data-add>➕ إضافة بند</button>
        <small class="muted">اكتب اسم المنتج واختره من القائمة، أو اكتب بياناً حراً لخدمة أو بند لا يُتابع مخزونه.</small></div>
    </div>`);
    $$('.line[data-i]', linesBox).forEach((row) => {
      const i = Number(row.dataset.i);
      combo($('[data-k="desc"]', row), {
        items: productItems(C.priceKey),
        onType: (text) => { d.lines[i].desc = text; d.lines[i].product = null; },
        onPick: (it) => {
          const p = store.findProduct(it.value);
          if (!p) return;
          const keepQty = num(d.lines[i].qty) > 0 ? d.lines[i].qty : 1;
          d.lines[i] = { ...lineFromProduct(p), qty: keepQty, disc: d.lines[i].disc };
          dirty();
          drawLines(i);
          const q = $(`.line[data-i="${i}"] [data-k="qty"]`, linesBox);
          if (q) { q.focus(); q.select(); }
        },
        onCreate: (text) => quickProduct(text),
        createLabel: 'منتج جديد',
      });
    });
    if (focusIndex != null && focusIndex === 'last') $(`.line[data-i="${d.lines.length - 1}"] [data-k="desc"]`, linesBox)?.focus();
    drawTotals();
  }

  function drawTotals() {
    const t = calc();
    $$('.line[data-i]', linesBox).forEach((row) => { const L = t.lines[Number(row.dataset.i)]; const el = $('[data-tot]', row); if (el && L) el.innerHTML = String(money(L.total)); });
    totalsBox.innerHTML = String(html`<div class="totals">
      ${t.discount ? html`<div class="row"><span>المجموع قبل الخصم</span>${money(t.gross)}</div><div class="row"><span>الخصم</span>${money(-t.discount)}</div>` : ''}
      ${showTax ? html`<div class="row"><span>الإجمالي قبل الضريبة</span>${money(t.net)}</div><div class="row"><span>${taxLabel()} (${num(d.vatRate)}%)</span>${money(t.vat)}</div>` : ''}
      <div class="row grand"><span>الإجمالي</span><span>${money(t.total, { sym: true })}</span></div>
    </div>`);
    if (hasPay) drawPay(t.total);
  }

  function drawPay(total) {
    const seg = $('[data-pay]', root);
    const opts = [...moneyList().map((a) => [a.id, (a.id === 'cash' ? '💵 ' : '🏦 ') + a.name]), ['', '⏳ ' + C.credit]];
    seg.innerHTML = String(html`${opts.map(([v, t]) => html`<button type="button" data-pay-v="${v}" class="${v === pay ? 'on' : ''}">${t}</button>`)}`);
    const box = $('[data-paid-box]', root);
    box.hidden = !pay;
    const inp = $('[data-paid]', root);
    if (paidAuto) d.paid = pay ? total : 0;
    if (document.activeElement !== inp) inp.value = pay ? d.paid : '';
    const rest = round(total - (pay ? num(d.paid) : 0), dec());
    $('[data-rest]', root).innerHTML = String(money(rest, { sym: true }));
  }

  function partyInfo() {
    const box = $('[data-party-info]', root);
    if (!box) return;
    const p = store.findParty(d.party);
    if (!p) { box.textContent = ''; return; }
    const bal = store.getBooks().partyBalance.get(p.id) || 0;
    box.innerHTML = String(html`الرصيد الحالي: ${money(bal, { sym: true })}${p.vatNo ? html` · ضريبي: <span dir="ltr">${p.vatNo}</span>` : ''}`);
  }

  const dirty = () => { guard.dirty = true; };

  // ── ربط الأحداث ──
  combo($('[data-party]', root), {
    items: partyItems(C.kind),
    onType: () => { d.party = null; partyInfo(); dirty(); },
    onPick: (it) => {
      d.party = it.value;
      $('[data-party]', root).value = it.label;
      if (type === 'purchase' && !existing && pay === 'cash' && paidAuto) pay = '';
      partyInfo(); dirty(); drawTotals();
      if (C.ref) $('[data-ref]', root).innerHTML = String(refOptions());
    },
    onCreate: (text) => quickParty(C.kind, text),
    createLabel: C.kind === 'customer' ? 'عميل جديد' : 'مورد جديد',
  });

  root.addEventListener('input', (e) => {
    const el = e.target;
    const k = el.dataset.k;
    if (el.matches('[data-paid]')) { d.paid = el.value; paidAuto = false; dirty(); drawPay(calc().total); return; }
    if (!k) return;
    const row = el.closest('.line[data-i]');
    if (row) {
      const i = Number(row.dataset.i);
      if (k === 'desc') return;
      d.lines[i][k] = el.value;
      dirty();
      if (k === 'qty' && store.findProduct(d.lines[i].product)) {
        const hint = $('.c-sub', row);
        if (hint) hint.outerHTML = String(stockHint(d.lines[i]));
      }
      drawTotals();
      return;
    }
    if (k === 'inclusive') return;
    d[k] = el.value;
    dirty();
  });
  root.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.k === 'tax') { d.lines[Number(el.closest('.line').dataset.i)].tax = el.value; dirty(); drawTotals(); }
    if (el.dataset.k === 'inclusive') { d.inclusive = el.checked; dirty(); drawLines(); }
    if (el.matches('[data-ref]')) {
      d.refId = el.value || null;
      dirty();
      const btn = $('[data-copy-ref]', root);
      btn.hidden = !d.refId;
      const blank = d.lines.every((l) => !l.product && !String(l.desc || '').trim());
      if (d.refId && blank) copyRef();
    }
  });
  function copyRef() {
    const r = store.findDoc(d.refId);
    if (!r) return;
    d.lines = clone(r.lines); d.inclusive = !!r.inclusive; d.vatRate = num(r.vatRate);
    if (!d.party) { d.party = r.party; $('[data-party]', root).value = partyName(r.party); partyInfo(); }
    const inc = $('[data-k="inclusive"]', root);
    if (inc) inc.checked = d.inclusive;
    dirty();
    drawLines();
  }
  root.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-add]')) { d.lines.push(emptyLine()); dirty(); drawLines('last'); }
    else if (t.closest('[data-del]')) {
      const i = Number(t.closest('.line').dataset.i);
      d.lines.splice(i, 1);
      if (!d.lines.length) d.lines.push(emptyLine());
      dirty(); drawLines();
    } else if (t.closest('[data-pay-v]')) {
      pay = t.closest('[data-pay-v]').dataset.payV;
      paidAuto = true; dirty(); drawPay(calc().total);
    } else if (t.closest('[data-copy-ref]')) copyRef();
    else if (t.closest('[data-save]')) { e.preventDefault(); save(t.closest('[data-save]').dataset.save); }
  });
  $('[data-form]', root).addEventListener('submit', (e) => { e.preventDefault(); save('view'); });
  // Enter داخل البنود ينتقل للحقل التالي بدل حفظ الفاتورة، وفي آخر بند يضيف بنداً جديداً
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing) return;
    const row = e.target.closest('.line[data-i]');
    if (!row) return;
    e.preventDefault();
    const fields = $$('input, select', row);
    const k = fields.indexOf(e.target);
    if (k >= 0 && k < fields.length - 1) { fields[k + 1].focus(); return; }
    const i = Number(row.dataset.i);
    if (i === d.lines.length - 1) { d.lines.push(emptyLine()); dirty(); drawLines('last'); }
    else $(`.line[data-i="${i + 1}"] [data-k="desc"]`, linesBox)?.focus();
  });

  function save(after) {
    // تنظيف البنود الفارغة
    const lines = d.lines.filter((l) => l.product || String(l.desc || '').trim() || num(l.price));
    const doc = {
      ...d,
      lines: (lines.length ? lines : d.lines).map((l) => ({
        product: l.product || null, desc: String(l.desc || '').trim(), qty: num(l.qty), price: num(l.price), disc: num(l.disc), tax: showTax ? (l.tax || 'S') : 'S',
      })),
      vatRate: showTax ? num(d.vatRate) : 0,
      notes: String(d.notes || '').trim(),
    };
    if (hasPay) {
      const total = calcDoc(doc, dec()).total;
      doc.paid = pay ? (paidAuto ? total : round(num(d.paid), dec())) : 0;
      doc.payAcc = pay || null;
    }
    const errs = validateDoc(db, doc);
    if (!showErrors(root, errs)) { toast('راجع الحقول المظللة باللون الأحمر', 'err'); return; }
    store.saveDoc(doc);
    if (doc.fromQuote) store.patchDoc(doc.fromQuote, { convertedTo: doc.id });
    guard.dirty = false;
    toast('تم الحفظ ✓');
    if (after === 'new') go(`#/${SEG[type]}/new`);
    else go(docHref(doc) + (after === 'print' ? '?print=1' : ''));
  }

  drawLines();
  partyInfo();
  if (!existing && !d.party) setTimeout(() => $('[data-party]', root)?.blur(), 0);
}

// ═══ عرض المستند ═══
export function show(type, { root, params, query }) {
  const T = DOC_TYPES[type], C = CFG[type];
  const d = store.findDoc(params.id);
  if (!d || d.type !== type) { setTitle(T.name); root.innerHTML = String(empty('🔎', 'المستند غير موجود', '', html`<a class="btn btn-ghost" href="#/${SEG[type]}">العودة للقائمة</a>`)); return; }
  const s = S();
  const B = store.getBooks();
  const no = docNo(d, s);
  setTitle(`${T.name} ${no}`);
  const party = store.findParty(d.party);
  const t = B.totals.get(d.id) || calcDoc(d, dec());
  const st = docStatus(d, B);
  const size = s.printSize === 'receipt' && (type === 'sale' || type === 'sreturn') ? 'receipt' : 'a4';

  const returns = store.getDb().docs.filter((x) => x.refId === d.id);
  const apps = B.applications.get(d.id) || [];
  const ref = d.refId ? store.findDoc(d.refId) : null;
  const quote = d.fromQuote ? store.findDoc(d.fromQuote) : null;
  const conv = d.convertedTo ? store.findDoc(d.convertedTo) : null;

  const payHref = type === 'sale' ? `#/receipts/new?party=${d.party}&link=${d.id}&amount=${st ? st.due : ''}`
    : type === 'purchase' ? `#/payments/new?party=${d.party}&link=${d.id}&amount=${st ? st.due : ''}` : '';
  const retHref = type === 'sale' ? `#/sales-returns/new?ref=${d.id}` : type === 'purchase' ? `#/purchase-returns/new?ref=${d.id}` : '';

  root.innerHTML = String(html`
    ${head(`${T.name} ${no}`, {
      sub: html`${fmtDate(d.date)} · ${partyName(d.party, C.kind === 'customer' ? 'عميل نقدي' : 'مورد نقدي')}`,
      actions: html`
        <button class="btn btn-primary" data-print>🖨️ طباعة / PDF</button>
        ${st && st.due > 0 && party ? html`<a class="btn btn-ghost" href="${payHref}">💵 ${type === 'sale' ? 'تسجيل دفعة' : 'تسجيل سداد'}</a>` : ''}
        ${type === 'quote' && !conv ? html`<a class="btn btn-ghost" href="#/sales/new?from=${d.id}">✅ تحويل إلى فاتورة</a>` : ''}
        ${retHref ? html`<a class="btn btn-ghost" href="${retHref}">${type === 'sale' ? '↩️' : '↪️'} مرتجع</a>` : ''}
        ${C.kind === 'customer' ? html`<button class="btn btn-ghost" data-wa>💬 واتساب</button>` : ''}
        <a class="btn btn-ghost" href="#/${SEG[type]}/new?copy=${d.id}">📄 نسخ</a>
        <a class="btn btn-ghost" href="#/${SEG[type]}/${d.id}/edit">✏️ تعديل</a>
        <button class="btn btn-text-danger" data-del>🗑️ حذف</button>`,
    })}
    <div class="grid g4" style="margin-bottom:14px">
      <div class="kpi"><span class="kpi-l">الإجمالي</span><span class="kpi-v">${money(t.total, { sym: true })}</span>${t.vat ? html`<span class="kpi-s">منها ${taxLabel()} ${money(t.vat)}</span>` : ''}</div>
      ${st && st.state ? html`
        <div class="kpi"><span class="kpi-l">المدفوع</span><span class="kpi-v">${money(st.paid, { sym: true })}</span></div>
        <div class="kpi"><span class="kpi-l">المتبقي</span><span class="kpi-v ${st.due > 0 ? 'neg' : ''}">${money(st.due, { sym: true })}</span>${d.dueDate && st.due > 0 ? html`<span class="kpi-s">يستحق ${fmtDate(d.dueDate)}</span>` : ''}</div>
        <div class="kpi"><span class="kpi-l">الحالة</span><span class="kpi-v">${badge(st.state)}</span></div>` : ''}
      ${C.ref ? html`<div class="kpi"><span class="kpi-l">${C.paidLabel}</span><span class="kpi-v">${money(num(d.paid), { sym: true })}</span></div>
        <div class="kpi"><span class="kpi-l">المتبقي كرصيد</span><span class="kpi-v">${money(st ? st.open : 0, { sym: true })}</span><span class="kpi-s">يُخصم من الفواتير القادمة</span></div>` : ''}
      ${type === 'quote' ? html`<div class="kpi"><span class="kpi-l">الحالة</span><span class="kpi-v">${badge(conv ? 'converted' : d.validUntil && d.validUntil < today() ? 'expired' : 'open')}</span>${conv ? html`<a class="kpi-s" href="${docHref(conv)}">الفاتورة ${docNo(conv, s)}</a>` : ''}</div>` : ''}
    </div>
    ${ref ? html`<p class="note note-info" style="margin-bottom:12px">مرتبط بالفاتورة الأصلية <a href="${docHref(ref)}">${docNo(ref, s)}</a></p>` : ''}
    ${quote ? html`<p class="note note-info" style="margin-bottom:12px">محوّلة من عرض السعر <a href="${docHref(quote)}">${docNo(quote, s)}</a></p>` : ''}
    ${returns.length ? html`<p class="note note-warn" style="margin-bottom:12px">عليها مرتجعات: ${returns.map((r, i) => html`${i ? '، ' : ''}<a href="${docHref(r)}">${docNo(r, s)}</a>`)}</p>` : ''}
    <div class="paper-wrap">${docPaper(d, { size })}</div>
    ${apps.length ? html`<div class="card" style="margin-top:14px"><div class="card-h"><h3>التسديدات المرتبطة</h3></div><div class="list-mini">
      ${apps.map((a) => {
        const x = store.findDoc(a.doc);
        const self = a.doc === d.id;
        const label = self ? (type === 'sale' || type === 'purchase' ? 'دفعة عند الإصدار' : 'رد نقدي عند الإصدار') : x ? `${DOC_TYPES[x.type].name} ${docNo(x, s)}` : 'رصيد افتتاحي';
        const inner = html`<span>${label} <span class="meta">${fmtDate(a.date)}</span></span><b>${money(a.amount)}</b>`;
        return self || !x ? html`<div class="it">${inner}</div>` : html`<a href="${docHref(x)}">${inner}</a>`;
      })}
    </div></div>` : ''}
    ${type === 'quote' ? '' : html`<details class="card" style="margin-top:14px"><summary style="cursor:pointer;font-weight:800">📒 القيد المحاسبي</summary><div style="margin-top:12px">${entryTable(B.entries.get(d.id))}</div></details>`}`);

  const doPrint = () => printPaper(docPaper(d, { size }), { size, title: `${no} - ${s.name || ''}` });
  $('[data-print]', root).onclick = doPrint;
  if (query.print) setTimeout(doPrint, 300);
  const wa = $('[data-wa]', root);
  if (wa) wa.onclick = () => {
    const lines = [`${T.name} رقم ${no}`, `التاريخ: ${fmtDate(d.date)}`, party ? `${kindName(C.kind)}: ${party.name}` : '', `الإجمالي: ${moneyText(t.total)}`];
    if (st && st.due > 0) lines.push(`المتبقي: ${moneyText(st.due)}`);
    lines.push('', `مع تحيات ${s.name || ''}`);
    window.open(waLink(party && party.phone, lines.filter((x) => x !== '').join('\n')), '_blank', 'noopener');
  };
  $('[data-del]', root).onclick = async () => {
    const linked = returns.length || apps.some((a) => a.doc !== d.id);
    const msg = `سيتم حذف ${T.name} ${no} نهائياً مع قيدها وأثرها على المخزون.${linked ? ' المرتجعات والسندات المرتبطة بها ستبقى لكن بدون ربط.' : ''}${s.vat && (type === 'sale' || type === 'sreturn') ? ' ملاحظة: الأسلم ضريبياً إصدار إشعار دائن بدلاً من الحذف.' : ''}`;
    if (!(await confirmBox(msg, { ok: 'حذف نهائي', danger: true, title: 'حذف المستند' }))) return;
    store.deleteDoc(d.id);
    toast('تم الحذف');
    go('#/' + SEG[type]);
  };
}
