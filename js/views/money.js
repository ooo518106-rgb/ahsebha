// ═══ المصروفات، سندات القبض والصرف، والتحويلات بين الصندوق والبنوك ═══
import * as store from '../store.js';
import { calcDoc, expenseAsDoc, docNo, DOC_TYPES, validateDoc, num, round, nextAccountCode, tafqeet } from '../core.js';
import { html, raw, money, fmtDate, toast, confirmBox, combo, showErrors, empty, norm, $, $$, exportTable, moneyText, field } from '../ui.js';
import { go, guard, setTitle, docHref, partyHref, SEG } from '../nav.js';
import {
  head, bindRows, today, S, dec, taxLabel, partyName, accName, periodOf, periodBar, bindPeriod, inPeriod,
  moneyList, moneyOptions, partyItems, accountItems, quickParty, taxOptions, voucherPaper, printPaper, entryTable, waLink, csvName, METHODS,
} from './common.js';

const NEW = { expense: 'مصروف جديد', receipt: 'سند قبض جديد', payment: 'سند صرف جديد', transfer: 'تحويل جديد' };
const ICON = { expense: '💸', receipt: '📥', payment: '📤', transfer: '🔁' };
const clone = (x) => JSON.parse(JSON.stringify(x));

const expenseAccount = (a) => (a.type === 'expense' || a.type === 'asset') && !a.money && !['ar', 'ap', 'inv', 'vin', 'cogs'].includes(a.id);
const otherAccount = (a) => !a.money && !['ar', 'ap', 'inv'].includes(a.id);

function amountOf(d, B) {
  if (d.type === 'expense') return (B.totals.get(d.id) || calcDoc(expenseAsDoc(d), dec())).total;
  return num(d.amount);
}
function counterName(d) {
  if (d.type === 'transfer') return `${accName(d.from)} ← ${accName(d.to)}`;
  if (d.party) return partyName(d.party);
  if (d.type === 'expense') return d.payee || '';
  return accName(d.account);
}

// ═══ القائمة ═══
export function list(type, { root, query, path }) {
  const T = DOC_TYPES[type];
  setTitle(T.plural);
  const db = store.getDb();
  const B = store.getBooks();
  const s = S();
  const per = periodOf(query, 'all');
  const state = { q: query.q || '', cat: query.cat || '' };
  let limit = 200;
  const all = db.docs.filter((d) => d.type === type && inPeriod(d, per)).sort((a, b) => b.date.localeCompare(a.date) || (b.no || 0) - (a.no || 0));
  const cats = type === 'expense' ? [...new Set(all.map((d) => d.account))] : [];

  root.innerHTML = String(html`
    ${head(T.plural, { sub: `${all.length} مستند`, actions: html`<a class="btn btn-primary" href="#/${SEG[type]}/new">➕ ${NEW[type]}</a>` })}
    <div class="toolbar">
      <input class="inp grow" type="search" data-q placeholder="بحث بالرقم أو الطرف أو البيان" value="${state.q}">
      ${type === 'expense' ? html`<select class="inp" data-cat><option value="">كل البنود</option>${cats.map((c) => html`<option value="${c}">${accName(c)}</option>`)}</select>` : ''}
      ${periodBar(per)}
      <button class="btn btn-ghost btn-sm" data-csv>⬇️ Excel</button>
    </div>
    <div data-out></div>`);
  if (state.cat) $('[data-cat]', root).value = state.cat;

  function draw() {
    const q = norm(state.q.trim());
    const rows = all.filter((d) => (!state.cat || d.account === state.cat)
      && (!q || norm(`${docNo(d, s)} ${counterName(d)} ${d.notes || ''} ${d.ref || ''} ${type === 'expense' ? accName(d.account) : ''}`).includes(q)));
    const out = $('[data-out]', root);
    if (!all.length) {
      out.innerHTML = String(empty(ICON[type], `لا توجد ${T.plural}`, type === 'expense' ? 'سجّل الإيجار والرواتب والكهرباء وعمولات الدفع، وتظهر مباشرة في قائمة الدخل والإقرار الضريبي.' : '', html`<a class="btn btn-primary" href="#/${SEG[type]}/new">➕ ${NEW[type]}</a>`));
      return;
    }
    let total = 0, vat = 0;
    for (const d of rows) { total += amountOf(d, B); if (type === 'expense') vat += (B.totals.get(d.id) || { vat: 0 }).vat; }
    out.innerHTML = String(html`
      <div class="sum-bar"><span>العدد: <b>${rows.length}</b></span><span>الإجمالي: <b>${money(total, { sym: true })}</b></span>${type === 'expense' && vat ? html`<span>${taxLabel()}: <b>${money(vat, { sym: true })}</b></span>` : ''}</div>
      ${rows.length ? html`<div class="tbl-wrap"><table class="tbl" data-table><thead><tr>
        <th>الرقم</th><th>التاريخ</th>
        ${type === 'expense' ? html`<th>البند</th><th class="hide-sm">الجهة</th>` : type === 'transfer' ? html`<th>من</th><th>إلى</th>` : html`<th>${type === 'receipt' ? 'من' : 'إلى'}</th><th class="hide-sm">${type === 'receipt' ? 'أودع في' : 'صُرف من'}</th>`}
        <th class="hide-sm">البيان</th><th class="num">المبلغ</th>${type === 'expense' ? html`<th>الدفع</th>` : ''}
      </tr></thead><tbody>${rows.slice(0, limit).map((d) => html`<tr data-href="${docHref(d)}">
        <td class="nowrap"><b dir="ltr">${docNo(d, s)}</b></td><td class="nowrap">${fmtDate(d.date)}</td>
        ${type === 'expense' ? html`<td>${accName(d.account)}</td><td class="hide-sm">${counterName(d)}</td>`
          : type === 'transfer' ? html`<td>${accName(d.from)}</td><td>${accName(d.to)}</td>`
          : html`<td>${counterName(d)}</td><td class="hide-sm">${accName(d.money)}</td>`}
        <td class="hide-sm muted">${d.notes || ''}</td><td class="num">${money(amountOf(d, B))}</td>
        ${type === 'expense' ? html`<td>${num(d.paid) > 0 ? html`<span class="badge badge-ok">${accName(d.payAcc)}</span>` : html`<span class="badge badge-warn">آجل</span>`}</td>` : ''}
      </tr>`)}</tbody></table></div>
      ${rows.length > limit ? html`<p style="text-align:center;margin-top:12px"><button class="btn btn-ghost" data-more>عرض المزيد (${rows.length - limit})</button></p>` : ''}`
      : html`<div class="empty"><p>لا توجد نتائج مطابقة.</p></div>`}`);
  }
  draw();
  bindRows(root);
  bindPeriod(root, path, query);
  const sync = () => history.replaceState(null, '', '#/' + path + '?' + new URLSearchParams({ ...query, q: state.q, cat: state.cat }).toString());
  $('[data-q]', root).oninput = (e) => { state.q = e.target.value; draw(); sync(); };
  const cat = $('[data-cat]', root);
  if (cat) cat.onchange = () => { state.cat = cat.value; draw(); sync(); };
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) { limit += 200; draw(); }
    if (e.target.closest('[data-csv]')) { const t = $('[data-table]', root); if (t) exportTable(t, csvName(T.plural)); }
  });
}

// ═══ النماذج ═══
export function form(type, ctx) {
  const { root, params } = ctx;
  const existing = params.id ? store.findDoc(params.id) : null;
  if (params.id && (!existing || existing.type !== type)) { root.innerHTML = String(empty('🔎', 'المستند غير موجود')); return; }
  const title = existing ? `تعديل ${DOC_TYPES[type].name} ${docNo(existing, S())}` : NEW[type];
  setTitle(title);
  if (type === 'expense') return expenseForm(ctx, existing, title);
  if (type === 'transfer') return transferForm(ctx, existing, title);
  return voucherForm(type, ctx, existing, title);
}

function formShell(title, back, body) {
  return html`${head(title, { actions: html`<a class="btn btn-ghost" href="${back}">إلغاء</a>` })}
    <form novalidate data-form>${body}
      <div class="form-actions sticky-actions"><button class="btn btn-primary" data-save="view">💾 حفظ</button>
      <button type="button" class="btn btn-ghost" data-save="print">🖨️ حفظ وطباعة</button>
      <button type="button" class="btn btn-ghost" data-save="new">حفظ وإنشاء جديد</button></div></form>`;
}

function finish(type, doc, after) {
  guard.dirty = false;
  toast('تم الحفظ ✓');
  if (after === 'new') go(`#/${SEG[type]}/new`);
  else go(docHref(doc) + (after === 'print' ? '?print=1' : ''));
}

// ── المصروف ──
function expenseForm({ root, query }, existing, title) {
  const s = S();
  const db = store.getDb();
  const d = existing ? clone(existing) : {
    type: 'expense', date: today(), account: query.account || '', amount: '', tax: 'S', inclusive: true,
    vatRate: s.vat ? num(s.vatRate) : 0, party: query.party || null, payee: '', paid: 0, payAcc: 'cash', ref: '', notes: '',
  };
  const showTax = !!s.vat || num(d.vatRate) > 0;
  if (!showTax) d.vatRate = 0;
  let pay = existing ? (num(existing.paid) > 0 ? existing.payAcc : '') : (moneyList()[0]?.id || '');

  root.innerHTML = String(formShell(title, existing ? docHref(existing) : '#/expenses', html`
    <div class="card"><div class="form-grid">
      ${field('التاريخ', html`<input class="inp" type="date" data-f="date" data-k="date" value="${d.date}">`)}
      <div class="fld span2"><span class="fld-l">بند المصروف</span><input class="inp" data-f="account" data-acc placeholder="مثال: إيجار، رواتب، كهرباء…" value="${d.account ? accName(d.account) : ''}"><small class="fld-e" data-err="account" hidden></small></div>
      <div class="fld"><span class="fld-l">المبلغ</span><input class="inp" type="text" inputmode="decimal" data-num autocomplete="off" data-f="amount" data-k="amount" value="${d.amount}"><small class="fld-e" data-err="amount" hidden></small></div>
      ${showTax ? html`${field(taxLabel(), html`<select class="inp" data-k="tax">${taxOptions(d.tax || 'S')}</select>`)}
        <label class="check" style="align-self:end;min-height:40px"><input type="checkbox" data-k="inclusive" ${d.inclusive ? raw('checked') : ''}> المبلغ شامل ${taxLabel()}</label>` : ''}
    </div></div>
    <div class="card"><div class="fld"><span class="fld-l">طريقة الدفع</span><div class="seg" data-pay></div><small class="fld-e" data-err="payAcc" hidden></small></div>
      <div class="form-grid" style="margin-top:12px">
        <div class="fld span2"><span class="fld-l">المورد <small class="muted" data-sup-hint></small></span><input class="inp" data-f="party" data-party placeholder="اختياري — مطلوب للمصروف الآجل" value="${partyName(d.party)}"><small class="fld-e" data-err="party" hidden></small></div>
        ${field('الجهة المستفيدة', html`<input class="inp" data-k="payee" value="${d.payee || ''}" placeholder="مثال: شركة الكهرباء">`, { hint: 'إن لم تكن مسجلة كمورد' })}
        ${field('رقم الفاتورة / الإيصال', html`<input class="inp" data-k="ref" value="${d.ref || ''}">`)}
        <div class="span-all">${field('البيان', html`<textarea class="inp" data-k="notes" rows="2">${d.notes || ''}</textarea>`)}</div>
      </div></div>
    <div class="card" data-sum></div>`));

  const calc = () => calcDoc(expenseAsDoc(d), dec());
  const dirty = () => { guard.dirty = true; };
  function drawSum() {
    const t = calc();
    $('[data-sum]', root).innerHTML = String(html`<div class="totals">
      ${showTax ? html`<div class="row"><span>المبلغ قبل الضريبة</span>${money(t.net)}</div><div class="row"><span>${taxLabel()} القابلة للخصم</span>${money(t.vat)}</div>` : ''}
      <div class="row grand"><span>الإجمالي</span><span>${money(t.total, { sym: true })}</span></div></div>`);
    const seg = $('[data-pay]', root);
    seg.innerHTML = String(html`${[...moneyList().map((a) => [a.id, (a.id === 'cash' ? '💵 ' : '🏦 ') + a.name]), ['', '⏳ آجل على المورد']].map(([v, t2]) => html`<button type="button" data-pay-v="${v}" class="${v === pay ? 'on' : ''}">${t2}</button>`)}`);
    $('[data-sup-hint]', root).textContent = pay ? '(اختياري)' : '(مطلوب)';
  }
  combo($('[data-acc]', root), {
    items: accountItems(expenseAccount),
    onType: () => { d.account = ''; dirty(); },
    onPick: (it) => { d.account = it.value; $('[data-acc]', root).value = it.label; dirty(); },
    onCreate: async (text) => {
      const a = store.saveAccount({ code: nextAccountCode(db, 'g52'), name: text, type: 'expense', parent: 'g52', group: false });
      toast('أُضيف بند جديد لدليل الحسابات');
      return { value: a.id, label: a.name };
    },
    createLabel: 'بند مصروف جديد',
  });
  combo($('[data-party]', root), {
    items: partyItems('supplier'),
    onType: () => { d.party = null; dirty(); },
    onPick: (it) => { d.party = it.value; $('[data-party]', root).value = it.label; dirty(); },
    onCreate: (text) => quickParty('supplier', text),
    createLabel: 'مورد جديد',
  });
  root.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k || k === 'inclusive') return;
    d[k] = e.target.value; dirty();
    if (k === 'amount') drawSum();
  });
  root.addEventListener('change', (e) => {
    const k = e.target.dataset.k;
    if (k === 'inclusive') { d.inclusive = e.target.checked; dirty(); drawSum(); }
    if (k === 'tax') { d.tax = e.target.value; dirty(); drawSum(); }
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pay-v]');
    if (b) { pay = b.dataset.payV; dirty(); drawSum(); return; }
    const sv = e.target.closest('[data-save]');
    if (sv) { e.preventDefault(); save(sv.dataset.save); }
  });
  $('[data-form]', root).onsubmit = (e) => { e.preventDefault(); save('view'); };
  function save(after) {
    const doc = { ...d, amount: num(d.amount), vatRate: showTax ? num(d.vatRate) : 0, tax: showTax ? d.tax : 'S', payee: String(d.payee || '').trim(), notes: String(d.notes || '').trim() };
    const total = calcDoc(expenseAsDoc(doc), dec()).total;
    doc.paid = pay ? total : 0;
    doc.payAcc = pay || null;
    if (!showErrors(root, validateDoc(store.getDb(), doc))) { toast('راجع الحقول المظللة', 'err'); return; }
    store.saveDoc(doc);
    finish('expense', doc, after);
  }
  drawSum();
}

// ── سند القبض والصرف ──
function voucherForm(type, { root, query }, existing, title) {
  const s = S();
  const B = store.getBooks();
  const isR = type === 'receipt';
  const d = existing ? clone(existing) : {
    type, date: today(), party: query.party || null, account: query.account || '', amount: query.amount ? num(query.amount) : '',
    money: moneyList()[0]?.id || 'cash', method: 'cash', chequeNo: '', link: query.link || null, notes: '',
  };
  const qp = store.findParty(d.party);
  let mode = d.party ? (qp ? qp.kind : (isR ? 'customer' : 'supplier')) : d.account ? 'account' : (isR ? 'customer' : 'supplier');

  root.innerHTML = String(formShell(title, existing ? docHref(existing) : `#/${SEG[type]}`, html`
    <div class="card"><div class="form-grid">
      ${field('التاريخ', html`<input class="inp" type="date" data-f="date" data-k="date" value="${d.date}">`)}
      <div class="fld span2"><span class="fld-l">${isR ? 'استلمنا من' : 'صرفنا إلى'}</span>
        <div class="seg" data-mode>${[['customer', '👤 عميل'], ['supplier', '🏭 مورد'], ['account', '🗂️ حساب آخر']].map(([v, t]) => html`<button type="button" data-mode-v="${v}" class="${v === mode ? 'on' : ''}">${t}</button>`)}</div></div>
      <div class="fld span2" data-party-box><span class="fld-l" data-party-l></span><input class="inp" data-f="party" data-party value="${partyName(d.party)}" placeholder="ابحث بالاسم"><small class="fld-e" data-err="party" hidden></small><small class="fld-h" data-bal></small></div>
      <div class="fld span2" data-acc-box><span class="fld-l">الحساب</span><input class="inp" data-f="account" data-acc value="${d.account ? accName(d.account) : ''}" placeholder="${isR ? 'مثال: رأس المال، إيرادات أخرى، قرض' : 'مثال: جاري المالك، أصل ثابت، قرض'}"><small class="fld-e" data-err="account" hidden></small></div>
      <label class="fld span2" data-link-box><span class="fld-l">مقابل</span><select class="inp" data-link></select><small class="fld-h">اختر فاتورة محددة، أو اتركه تلقائياً ليُخصم من الأقدم فالأقدم</small></label>
      <div class="fld"><span class="fld-l">المبلغ</span><input class="inp" type="text" inputmode="decimal" data-num autocomplete="off" data-f="amount" data-k="amount" value="${d.amount}"><small class="fld-e" data-err="amount" hidden></small></div>
      <label class="fld"><span class="fld-l">${isR ? 'أودع في' : 'صُرف من'}</span><select class="inp" data-f="money" data-k="money">${moneyOptions(d.money)}</select><small class="fld-e" data-err="money" hidden></small></label>
      <label class="fld"><span class="fld-l">طريقة الدفع</span><select class="inp" data-k="method">${Object.entries(METHODS).map(([k, v]) => html`<option value="${k}" ${k === d.method ? raw('selected') : ''}>${v}</option>`)}</select></label>
      ${field('رقم الشيك / المرجع', html`<input class="inp" data-k="chequeNo" value="${d.chequeNo || ''}" dir="auto">`)}
      <div class="span-all">${field('البيان', html`<textarea class="inp" data-k="notes" rows="2" placeholder="${isR ? 'مثال: دفعة من حساب فاتورة…' : 'مثال: سداد فاتورة…'}">${d.notes || ''}</textarea>`)}</div>
      <div class="span-all muted small" data-words></div>
    </div></div>`));

  const dirty = () => { guard.dirty = true; };
  // الجهة المطلوبة للربط: القبض من عميل يسدد فواتيره، والصرف لعميل يرد مرتجعاته… إلخ
  function linkOptions() {
    const sel = $('[data-link]', root);
    const box = $('[data-link-box]', root);
    const p = store.findParty(d.party);
    if (!p) { box.hidden = true; d.link = null; return; }
    const want = isR === (p.kind === 'customer') ? 'c' : 's';
    const items = (B.openItems.get(p.id) || []).filter((it) => it.side === want && store.findDoc(it.doc) && it.doc !== d.id && !it.key.endsWith(':p'));
    if (d.link && !items.some((it) => it.doc === d.link)) {
      const x = store.findDoc(d.link);
      if (x) items.unshift({ doc: x.id, open: null, date: x.date });
    }
    box.hidden = !items.length;
    sel.innerHTML = String(html`<option value="">تلقائي (الأقدم أولاً)</option>${items.map((it) => {
      const x = store.findDoc(it.doc);
      return html`<option value="${x.id}" ${x.id === d.link ? raw('selected') : ''}>${DOC_TYPES[x.type].name} ${docNo(x, s)} — ${fmtDate(x.date)}${it.open != null ? ` — المتبقي ${moneyText(it.open)}` : ''}</option>`;
    })}`);
  }
  function drawMode() {
    $$('[data-mode-v]', root).forEach((b) => b.classList.toggle('on', b.dataset.modeV === mode));
    $('[data-party-box]', root).hidden = mode === 'account';
    $('[data-acc-box]', root).hidden = mode !== 'account';
    $('[data-party-l]', root).textContent = mode === 'customer' ? 'العميل' : 'المورد';
    if (mode === 'account') { d.party = null; }
    else if (d.party && store.findParty(d.party)?.kind !== mode) { d.party = null; $('[data-party]', root).value = ''; }
    if (mode !== 'account') d.account = '';
    bal();
    linkOptions();
  }
  function bal() {
    const p = store.findParty(d.party);
    const el = $('[data-bal]', root);
    if (!p) { el.textContent = ''; return; }
    const b = store.getBooks().partyBalance.get(p.id) || 0;
    el.innerHTML = String(html`الرصيد: ${money(b, { sym: true })} ${b > 0 ? (p.kind === 'customer' ? '(مستحق لكم)' : '(مستحق للمورد)') : b < 0 ? '(رصيد دائن)' : ''}`);
  }
  function words() { $('[data-words]', root).textContent = num(d.amount) > 0 ? tafqeetText(d.amount) : ''; }
  const partyCombo = combo($('[data-party]', root), {
    items: () => partyItems(mode === 'account' ? 'customer' : mode)(),
    onType: () => { d.party = null; bal(); linkOptions(); dirty(); },
    onPick: (it) => { d.party = it.value; $('[data-party]', root).value = it.label; d.link = null; bal(); linkOptions(); dirty(); },
    onCreate: (text) => quickParty(mode, text),
    createLabel: 'إضافة',
  });
  combo($('[data-acc]', root), {
    items: accountItems(otherAccount),
    onType: () => { d.account = ''; dirty(); },
    onPick: (it) => { d.account = it.value; $('[data-acc]', root).value = it.label; dirty(); },
  });
  root.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    d[k] = e.target.value; dirty();
    if (k === 'amount') words();
  });
  root.addEventListener('change', (e) => {
    const k = e.target.dataset.k;
    if (k) { d[k] = e.target.value; dirty(); }
    if (e.target.matches('[data-link]')) {
      d.link = e.target.value || null; dirty();
      const it = (B.openItems.get(d.party) || []).find((x) => x.doc === d.link);
      if (it && !num(d.amount)) { d.amount = it.open; $('[data-k="amount"]', root).value = it.open; words(); }
    }
  });
  root.addEventListener('click', (e) => {
    const m = e.target.closest('[data-mode-v]');
    if (m) { mode = m.dataset.modeV; dirty(); drawMode(); partyCombo.close(); return; }
    const sv = e.target.closest('[data-save]');
    if (sv) { e.preventDefault(); save(sv.dataset.save); }
  });
  $('[data-form]', root).onsubmit = (e) => { e.preventDefault(); save('view'); };
  function save(after) {
    const doc = { ...d, amount: round(num(d.amount), dec()), notes: String(d.notes || '').trim(), party: mode === 'account' ? null : d.party, account: mode === 'account' ? d.account : '' };
    if (mode !== 'account' && !doc.party) { showErrors(root, { party: mode === 'customer' ? 'اختر العميل' : 'اختر المورد' }); toast('راجع الحقول المظللة', 'err'); return; }
    if (!doc.party) doc.link = null;
    if (!showErrors(root, validateDoc(store.getDb(), doc))) { toast('راجع الحقول المظللة', 'err'); return; }
    store.saveDoc(doc);
    finish(type, doc, after);
  }
  drawMode();
  words();
}

// ── التحويل ──
function transferForm({ root }, existing, title) {
  const accs = moneyList();
  const d = existing ? clone(existing) : { type: 'transfer', date: today(), from: accs[0]?.id || 'cash', to: accs[1]?.id || 'bank', amount: '', notes: '' };
  root.innerHTML = String(formShell(title, existing ? docHref(existing) : '#/transfers', html`
    <div class="card"><div class="form-grid">
      ${field('التاريخ', html`<input class="inp" type="date" data-f="date" data-k="date" value="${d.date}">`)}
      <label class="fld"><span class="fld-l">من</span><select class="inp" data-f="from" data-k="from">${moneyOptions(d.from)}</select><small class="fld-e" data-err="from" hidden></small></label>
      <label class="fld"><span class="fld-l">إلى</span><select class="inp" data-f="to" data-k="to">${moneyOptions(d.to)}</select><small class="fld-e" data-err="to" hidden></small></label>
      <div class="fld"><span class="fld-l">المبلغ</span><input class="inp" type="text" inputmode="decimal" data-num autocomplete="off" data-f="amount" data-k="amount" value="${d.amount}"><small class="fld-e" data-err="amount" hidden></small></div>
      <div class="span-all">${field('البيان', html`<input class="inp" data-k="notes" value="${d.notes || ''}" placeholder="مثال: إيداع مبيعات اليوم في البنك">`)}</div>
    </div>${accs.length < 2 ? html`<p class="note note-info" style="margin-top:12px">لإضافة حساب بنكي أو محفظة أخرى: <a href="#/accounts">دليل الحسابات</a> ← إضافة حساب تحت «الأصول المتداولة» مع تفعيل «صندوق أو بنك».</p>` : ''}</div>`));
  root.addEventListener('input', (e) => { const k = e.target.dataset.k; if (k) { d[k] = e.target.value; guard.dirty = true; } });
  root.addEventListener('change', (e) => { const k = e.target.dataset.k; if (k) { d[k] = e.target.value; guard.dirty = true; } });
  root.addEventListener('click', (e) => { const sv = e.target.closest('[data-save]'); if (sv) { e.preventDefault(); save(sv.dataset.save); } });
  $('[data-form]', root).onsubmit = (e) => { e.preventDefault(); save('view'); };
  function save(after) {
    const doc = { ...d, amount: round(num(d.amount), dec()), notes: String(d.notes || '').trim() };
    if (!showErrors(root, validateDoc(store.getDb(), doc))) { toast('راجع الحقول المظللة', 'err'); return; }
    store.saveDoc(doc);
    finish('transfer', doc, after);
  }
}

const tafqeetText = (v) => tafqeet(v, S().currency);

// ═══ العرض ═══
export function show(type, { root, params, query }) {
  const T = DOC_TYPES[type];
  const d = store.findDoc(params.id);
  if (!d || d.type !== type) { setTitle(T.name); root.innerHTML = String(empty('🔎', 'المستند غير موجود', '', html`<a class="btn btn-ghost" href="#/${SEG[type]}">العودة للقائمة</a>`)); return; }
  const s = S();
  const B = store.getBooks();
  const no = docNo(d, s);
  setTitle(`${T.name} ${no}`);
  const party = store.findParty(d.party);
  const apps = B.applications.get(d.id) || [];
  const st = B.status.get(d.id);
  const amount = amountOf(d, B);

  root.innerHTML = String(html`
    ${head(`${T.name} ${no}`, {
      sub: html`${fmtDate(d.date)} · ${counterName(d)}`,
      actions: html`<button class="btn btn-primary" data-print>🖨️ طباعة / PDF</button>
        ${type === 'receipt' && party ? html`<button class="btn btn-ghost" data-wa>💬 واتساب</button>` : ''}
        ${party ? html`<a class="btn btn-ghost" href="${partyHref(party)}">👤 كشف الحساب</a>` : ''}
        <a class="btn btn-ghost" href="#/${SEG[type]}/${d.id}/edit">✏️ تعديل</a>
        <button class="btn btn-text-danger" data-del>🗑️ حذف</button>`,
    })}
    ${type === 'expense' && st && st.due > 0 ? html`<p class="note note-warn" style="margin-bottom:12px">مصروف آجل: المتبقي للمورد ${money(st.due, { sym: true })}. <a href="#/payments/new?party=${d.party}&link=${d.id}&amount=${st.due}">سجّل السداد</a></p>` : ''}
    <div class="paper-wrap">${voucherPaper(d)}</div>
    ${apps.length ? html`<div class="card" style="margin-top:14px"><div class="card-h"><h3>${type === 'expense' ? 'التسديدات' : 'خُصم من'}</h3>${st && st.open ? html`<span class="muted small">غير مخصص: ${money(st.open, { sym: true })}</span>` : ''}</div><div class="list-mini">
      ${apps.map((a) => {
        const x = store.findDoc(a.doc);
        const self = a.doc === d.id;
        const label = self ? 'دفعة عند التسجيل' : x ? `${DOC_TYPES[x.type].name} ${docNo(x, s)}` : 'الرصيد الافتتاحي';
        const inner = html`<span>${label} <span class="meta">${fmtDate(a.date)}</span></span><b>${money(a.amount)}</b>`;
        return x && !self ? html`<a href="${docHref(x)}">${inner}</a>` : html`<div class="it">${inner}</div>`;
      })}</div></div>` : ''}
    <details class="card" style="margin-top:14px"><summary style="cursor:pointer;font-weight:800">📒 القيد المحاسبي</summary><div style="margin-top:12px">${entryTable(B.entries.get(d.id))}</div></details>`);

  const doPrint = () => printPaper(voucherPaper(d), { title: `${no} - ${s.name || ''}` });
  $('[data-print]', root).onclick = doPrint;
  if (query.print) setTimeout(doPrint, 300);
  const wa = $('[data-wa]', root);
  if (wa) wa.onclick = () => {
    const bal = B.partyBalance.get(party.id) || 0;
    const text = [`سند قبض رقم ${no}`, `التاريخ: ${fmtDate(d.date)}`, `استلمنا من: ${party.name}`, `المبلغ: ${moneyText(amount)}`, `الرصيد المتبقي عليكم: ${moneyText(bal)}`, '', `مع تحيات ${s.name || ''}`].join('\n');
    window.open(waLink(party.phone, text), '_blank', 'noopener');
  };
  $('[data-del]', root).onclick = async () => {
    if (!(await confirmBox(`سيتم حذف ${T.name} ${no} نهائياً مع قيده.`, { ok: 'حذف نهائي', danger: true, title: 'حذف المستند' }))) return;
    store.deleteDoc(d.id);
    toast('تم الحذف');
    go('#/' + SEG[type]);
  };
}
