// ═══ دليل الحسابات، دفتر الأستاذ، قيود اليومية ═══
import * as store from '../store.js';
import {
  docNo, DOC_TYPES, num, round, validateDoc, sortedAccounts, balances, rollup, ledger, isDebitNature,
  nextAccountCode, ACCOUNT_TYPES, BALANCE_SHEET_TYPES, CONTROL_ACCOUNTS,
} from '../core.js';
import { html, raw, money, fmtDate, toast, confirmBox, combo, showErrors, empty, $, $$, exportTable, modal, field, attr } from '../ui.js';
import { go, guard, setTitle, docHref, refresh } from '../nav.js';
import {
  head, bindRows, today, S, dec, partyName, accName, periodOf, periodBar, bindPeriod, periodLabel, inPeriod,
  accountItems, partyItems, entryTable, printReport, printPaper, csvName,
} from './common.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const natural = (a, v) => (a && !isDebitNature(a.type) ? -v : v);

// ═══ دليل الحسابات ═══
export function accounts({ root }) {
  setTitle('دليل الحسابات');
  const db = store.getDb();
  const B = store.getBooks();
  const all = rollup(db, balances(B, { to: today() }), B.dec);
  const rows = sortedAccounts(db);
  root.innerHTML = String(html`
    ${head('دليل الحسابات', { sub: 'الأرصدة حتى اليوم. اضغط على أي حساب لعرض دفتر الأستاذ.', actions: html`<button class="btn btn-ghost" data-csv>⬇️ Excel</button><button class="btn btn-primary" data-new>➕ حساب جديد</button>` })}
    <div class="tbl-wrap"><table class="tbl" data-table><thead><tr><th>الرمز</th><th>اسم الحساب</th><th class="hide-sm">النوع</th><th class="num">الرصيد</th><th></th></tr></thead><tbody>
      ${rows.map((a) => {
        const b = all.get(a.id);
        const v = b ? natural(a, b.close) : 0;
        return html`<tr class="${a.group ? 'grp' : ''}" data-href="#/accounts/${a.id}">
          <td class="code">${a.code}</td><td class="ind-${Math.min(a.depth, 3)}">${a.name}${a.money ? html` <span class="badge badge-info">نقدية</span>` : ''}</td>
          <td class="hide-sm muted small">${ACCOUNT_TYPES[a.type]}</td><td class="num">${v ? money(v) : html`<span class="muted">—</span>`}</td>
          <td style="text-align:end"><button class="icon-btn" data-edit="${a.id}" aria-label="تعديل ${a.name}">✏️</button></td></tr>`;
      })}
    </tbody></table></div>
    <p class="tbl-note">الأرصدة بطبيعتها: الأصول والمصروفات مدينة، والخصوم وحقوق الملكية والإيرادات دائنة. حسابات العملاء والموردين والمخزون تُدار تلقائياً من المستندات.</p>`);
  bindRows(root);
  root.addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) { e.stopPropagation(); accountDialog(store.findAccount(ed.dataset.edit)); return; }
    if (e.target.closest('[data-new]')) accountDialog(null);
    if (e.target.closest('[data-csv]')) exportTable($('[data-table]', root), csvName('دليل الحسابات'));
  });
}

export async function accountDialog(existing, { parent } = {}) {
  const db = store.getDb();
  const s = S();
  const groups = sortedAccounts(db).filter((a) => a.group && (!existing || a.id !== existing.id));
  const a = existing ? { ...existing } : { parent: parent || 'g11', group: false, name: '', code: '', money: false, opening: '' };
  if (!existing) a.code = nextAccountCode(db, a.parent);
  const sys = !!(existing && existing.sys);
  const hasKids = !!(existing && db.accounts.some((x) => x.parent === existing.id));
  const typeOf = (pid) => store.findAccount(pid)?.type || existing?.type;
  const canOpen = () => !a.group && BALANCE_SHEET_TYPES.includes(typeOf(a.parent)) && !CONTROL_ACCOUNTS.includes(a.id) && a.id !== 'cap';
  const pathName = (g) => {
    const parts = [];
    const seen = new Set();
    for (let cur = g; cur && !seen.has(cur.id); cur = store.findAccount(cur.parent)) { seen.add(cur.id); parts.unshift(cur.name); }
    return parts.join(' › ');
  };
  await modal({
    title: existing ? `تعديل حساب: ${existing.name}` : 'حساب جديد',
    body: html`<form class="form-grid" novalidate>
      ${sys || hasKids ? '' : html`<label class="fld span-all"><span class="fld-l">تحت المجموعة</span><select class="inp" name="parent">${groups.map((g) => html`<option value="${g.id}" ${g.id === a.parent ? raw('selected') : ''}>${g.code} — ${pathName(g)}</option>`)}</select></label>`}
      <div class="span2">${field('اسم الحساب', html`<input class="inp" name="name" data-f="name" value="${a.name}" autofocus>`)}<small class="fld-e" data-err="name" hidden></small></div>
      <div>${field('الرمز', html`<input class="inp" name="code" data-f="code" value="${a.code}" dir="ltr" inputmode="numeric" ${sys ? raw('readonly') : ''}>`)}<small class="fld-e" data-err="code" hidden></small></div>
      ${existing ? '' : html`<label class="check span-all"><input type="checkbox" name="group"> مجموعة (تحتوي حسابات فرعية)</label>`}
      <label class="check span-all" data-money-row><input type="checkbox" name="money" ${a.money ? raw('checked') : ''} ${sys ? raw('disabled') : ''}> صندوق أو بنك أو محفظة (يظهر في طرق الدفع والقبض)</label>
      <div class="span-all" data-open-row>${field('الرصيد الافتتاحي', html`<input class="inp" name="opening" type="text" inputmode="decimal" data-num autocomplete="off" value="${a.opening ?? ''}">`, { hint: `في ${s.startDate ? fmtDate(s.startDate) : 'تاريخ بداية التشغيل'}، بطبيعة الحساب (الأصول مدينة، الخصوم دائنة). الفرق يذهب لرأس المال تلقائياً.` })}</div>
      ${a.id === 'cap' ? html`<p class="note note-info span-all">رصيد رأس المال الافتتاحي يُحسب تلقائياً = الأصول − الخصوم الافتتاحية.</p>` : ''}
      ${CONTROL_ACCOUNTS.includes(a.id) ? html`<p class="note note-info span-all">أرصدة هذا الحساب الافتتاحية تأتي من ${a.id === 'inv' ? 'الكميات الافتتاحية للمنتجات' : a.id === 'ar' ? 'أرصدة العملاء' : 'أرصدة الموردين'}.</p>` : ''}
      <div class="dlg-actions span-all"><button class="btn btn-primary">حفظ</button>${existing && !sys ? html`<button type="button" class="btn btn-text-danger" data-delete>حذف الحساب</button>` : ''}<button type="button" class="btn btn-ghost" data-no>إلغاء</button></div>
    </form>`,
    onMount: (dlg, done) => {
      const f = $('form', dlg);
      const sync = () => {
        if (f.parent) a.parent = f.parent.value;
        if (f.group) a.group = f.group.checked;
        $('[data-money-row]', dlg).hidden = a.group || typeOf(a.parent) !== 'asset';
        $('[data-open-row]', dlg).hidden = !canOpen();
      };
      if (f.parent) f.parent.onchange = () => { sync(); if (!existing) f.code.value = nextAccountCode(db, a.parent); };
      if (f.group) f.group.onchange = sync;
      sync();
      $('[data-no]', dlg).onclick = () => done(null);
      const del = $('[data-delete]', dlg);
      if (del) del.onclick = () => {
        try { store.deleteAccount(existing.id); toast('تم حذف الحساب'); done(true); go('#/accounts'); } catch (e) { toast(e.message, 'err'); }
      };
      f.onsubmit = (e) => {
        e.preventDefault();
        const name = f.name.value.trim();
        const code = f.code.value.trim();
        const errs = {};
        if (!name) errs.name = 'اكتب اسم الحساب';
        if (!/^\d+$/.test(code)) errs.code = 'الرمز أرقام فقط';
        else if (db.accounts.some((x) => x.code === code && x.id !== a.id)) errs.code = 'الرمز مستخدم لحساب آخر';
        if (!showErrors(f, errs)) return;
        const type = typeOf(a.parent);
        const out = sys ? { id: existing.id, name } : { ...(existing ? { id: existing.id } : { group: a.group }), name, code, parent: a.parent, type };
        if (!sys && !a.group) out.money = type === 'asset' && f.money.checked;
        if (canOpen()) out.opening = num(f.opening.value);
        store.saveAccount(out);
        toast('تم الحفظ ✓');
        done(true);
        refresh();
      };
    },
  });
}

// ═══ دفتر الأستاذ لحساب ═══
export function accountShow({ root, params, query, path }) {
  const db = store.getDb();
  const a = store.findAccount(params.id);
  if (!a) { setTitle('دليل الحسابات'); root.innerHTML = String(empty('🔎', 'الحساب غير موجود', '', html`<a class="btn btn-ghost" href="#/accounts">العودة</a>`)); return; }
  setTitle(`${a.code} — ${a.name}`);
  const s = S();
  const B = store.getBooks();
  const per = periodOf(query, 'year');
  const L = ledger(db, B, a.id, per);
  let limit = 500;
  const desc = (r) => {
    const d = store.findDoc(r.doc);
    const parts = [r.doc === 'opening' ? 'قيد افتتاحي' : DOC_TYPES[r.type]?.name, r.party ? partyName(r.party) : '', r.memo, d && d.type !== 'journal' ? d.notes : ''];
    return parts.filter(Boolean).join(' — ');
  };
  root.innerHTML = String(html`
    ${head(`${a.name}`, { sub: html`<span class="code">${a.code}</span> · ${ACCOUNT_TYPES[a.type]}${a.group ? ' · مجموعة' : ''}`,
      actions: html`<button class="btn btn-ghost" data-edit>✏️ تعديل الحساب</button><a class="btn btn-ghost" href="#/accounts">🗂️ الدليل</a>` })}
    <div class="toolbar">${periodBar(per)}<span class="grow"></span><button class="btn btn-ghost btn-sm" data-print>🖨️ طباعة</button><button class="btn btn-ghost btn-sm" data-csv>⬇️ Excel</button></div>
    <div class="grid g4" style="margin-bottom:14px">
      <div class="kpi"><span class="kpi-l">رصيد أول الفترة</span><span class="kpi-v">${money(L.opening)}</span></div>
      <div class="kpi"><span class="kpi-l">مدين</span><span class="kpi-v">${money(L.dr)}</span></div>
      <div class="kpi"><span class="kpi-l">دائن</span><span class="kpi-v">${money(L.cr)}</span></div>
      <div class="kpi"><span class="kpi-l">رصيد آخر الفترة</span><span class="kpi-v">${money(L.closing, { sym: true })}</span></div>
    </div>
    <div data-out></div>`);
  function draw() {
    $('[data-out]', root).innerHTML = String(L.rows.length || L.opening ? html`<div class="tbl-wrap"><table class="tbl" data-table><thead><tr><th>التاريخ</th><th>المستند</th><th class="hide-sm">البيان</th><th class="num">مدين</th><th class="num">دائن</th><th class="num">الرصيد</th></tr></thead><tbody>
      <tr class="grp"><td colspan="3">رصيد أول الفترة</td><td></td><td></td><td class="num">${money(L.opening)}</td></tr>
      ${L.rows.slice(0, limit).map((r) => { const d = store.findDoc(r.doc); return html`<tr ${d ? attr('data-href', docHref(d)) : ''}><td class="nowrap">${fmtDate(r.date)}</td><td class="nowrap" dir="ltr">${d ? docNo(d, s) : 'افتتاحي'}</td>
        <td class="hide-sm">${desc(r)}${a.group ? html` <span class="muted small">(${accName(r.acc)})</span>` : ''}</td><td class="num">${r.dr ? money(r.dr) : ''}</td><td class="num">${r.cr ? money(r.cr) : ''}</td><td class="num"><b>${money(r.balance)}</b></td></tr>`; })}
    </tbody><tfoot><tr><td colspan="3">المجموع والرصيد الختامي</td><td class="num">${money(L.dr)}</td><td class="num">${money(L.cr)}</td><td class="num">${money(L.closing)}</td></tr></tfoot></table></div>
    ${L.rows.length > limit ? html`<p style="text-align:center;margin-top:12px"><button class="btn btn-ghost" data-more>عرض المزيد (${L.rows.length - limit})</button></p>` : ''}`
      : html`<div class="empty"><p>لا توجد حركات على هذا الحساب في هذه الفترة.</p></div>`);
  }
  draw();
  bindRows(root);
  bindPeriod(root, path, query);
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) { limit += 500; draw(); }
    if (e.target.closest('[data-edit]')) accountDialog(a);
    if (e.target.closest('[data-print]')) { const t = $('[data-table]', root); if (t) printReport(`دفتر الأستاذ: ${a.code} — ${a.name}`, periodLabel(per), t); }
    if (e.target.closest('[data-csv]')) { const t = $('[data-table]', root); if (t) exportTable(t, csvName('دفتر أستاذ ' + a.name)); }
  });
}

// ═══ قيود اليومية ═══
export function list(type, { root, query, path }) {
  setTitle('قيود اليومية');
  const s = S();
  const per = periodOf(query, 'all');
  const rows = store.getDb().docs.filter((d) => d.type === 'journal' && inPeriod(d, per)).sort((a, b) => b.date.localeCompare(a.date) || b.no - a.no);
  const amount = (d) => round((d.lines || []).reduce((t, l) => t + num(l.dr), 0), dec());
  root.innerHTML = String(html`
    ${head('قيود اليومية', { sub: 'أغلب القيود تُسجَّل تلقائياً من الفواتير والسندات. استخدم القيد اليدوي للتسويات الخاصة فقط.', actions: html`<a class="btn btn-ghost" href="#/daybook">📖 دفتر اليومية الكامل</a><a class="btn btn-primary" href="#/journal/new">➕ قيد يدوي</a>` })}
    <div class="toolbar">${periodBar(per)}</div>
    ${rows.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>الرقم</th><th>التاريخ</th><th>البيان</th><th class="num">المبلغ</th></tr></thead><tbody>
      ${rows.map((d) => html`<tr data-href="${docHref(d)}"><td dir="ltr" class="nowrap"><b>${docNo(d, s)}</b></td><td>${fmtDate(d.date)}</td><td>${d.notes || ''}</td><td class="num">${money(amount(d))}</td></tr>`)}
    </tbody></table></div>` : empty('📒', 'لا توجد قيود يدوية', 'مثال استخدامها: إثبات إهلاك، تسوية رصيد، أو تصحيح قيد. كل قيد يجب أن يتساوى فيه المدين والدائن.', html`<a class="btn btn-primary" href="#/journal/new">➕ قيد يدوي</a>`)}`);
  bindRows(root);
  bindPeriod(root, path, query);
}

const emptyLine = () => ({ account: '', party: null, dr: '', cr: '', memo: '' });

export function form(type, { root, params }) {
  const s = S();
  const existing = params.id ? store.findDoc(params.id) : null;
  if (params.id && (!existing || existing.type !== 'journal')) { root.innerHTML = String(empty('🔎', 'المستند غير موجود')); return; }
  const d = existing ? clone(existing) : { type: 'journal', date: today(), notes: '', lines: [emptyLine(), emptyLine()] };
  const title = existing ? `تعديل قيد ${docNo(existing, s)}` : 'قيد يومية يدوي';
  setTitle(title);
  root.innerHTML = String(html`${head(title, { actions: html`<a class="btn btn-ghost" href="${existing ? docHref(existing) : '#/journal'}">إلغاء</a>` })}
    <form novalidate data-form>
      <div class="card"><div class="form-grid">
        ${field('التاريخ', html`<input class="inp" type="date" data-f="date" data-k="date" value="${d.date}">`)}
        <div class="span2">${field('البيان', html`<input class="inp" data-k="notes" value="${d.notes || ''}" placeholder="مثال: إثبات إهلاك الأجهزة لشهر سبتمبر">`)}</div>
      </div></div>
      <div class="card" style="margin-top:14px"><div data-lines></div><small class="fld-e" data-err="lines" hidden></small>
        <div class="lines-foot" style="padding:10px 0 0"><button type="button" class="btn btn-ghost btn-sm" data-add>➕ سطر</button><div data-sum></div></div></div>
      <div class="form-actions sticky-actions"><button class="btn btn-primary">💾 حفظ القيد</button></div>
    </form>`);
  const box = $('[data-lines]', root);
  const isCtl = (id) => id === 'ar' || id === 'ap';
  function draw() {
    box.innerHTML = String(html`<div class="lines">
      <div class="jl-line line-h"><span>الحساب</span><span>مدين</span><span>دائن</span><span>بيان السطر</span><span></span></div>
      ${d.lines.map((l, i) => html`<div class="jl-line" data-i="${i}">
        <div class="j-acc" data-label="الحساب"><input class="inp" data-acc data-f="account${i}" value="${l.account ? accName(l.account) : ''}" placeholder="اختر الحساب">
          <div data-party-wrap ${isCtl(l.account) ? '' : raw('hidden')} style="margin-top:6px"><input class="inp" data-party data-f="party${i}" value="${partyName(l.party)}" placeholder="${l.account === 'ar' ? 'اختر العميل' : 'اختر المورد'}"></div>
          <small class="fld-e" data-err="account${i}" hidden></small><small class="fld-e" data-err="party${i}" hidden></small><small class="fld-e" data-err="amount${i}" hidden></small></div>
        <div class="j-dr" data-label="مدين"><input class="inp" type="text" inputmode="decimal" data-num autocomplete="off" data-k="dr" value="${l.dr}"></div>
        <div class="j-cr" data-label="دائن"><input class="inp" type="text" inputmode="decimal" data-num autocomplete="off" data-k="cr" value="${l.cr}"></div>
        <div class="j-memo" data-label="بيان السطر"><input class="inp" data-k="memo" value="${l.memo || ''}"></div>
        <div class="j-del"><button type="button" class="icon-btn" data-del aria-label="حذف السطر">✕</button></div></div>`)}
    </div>`);
    $$('.jl-line[data-i]', box).forEach((row) => {
      const i = Number(row.dataset.i);
      combo($('[data-acc]', row), {
        items: accountItems((a) => a.id !== 'inv'),
        onType: () => { d.lines[i].account = ''; },
        onPick: (it) => { d.lines[i].account = it.value; if (!isCtl(it.value)) d.lines[i].party = null; guard.dirty = true; draw(); },
      });
      const pi = $('[data-party]', row);
      combo(pi, {
        items: () => partyItems(d.lines[i].account === 'ar' ? 'customer' : 'supplier')(),
        onType: () => { d.lines[i].party = null; },
        onPick: (it) => { d.lines[i].party = it.value; pi.value = it.label; guard.dirty = true; },
      });
    });
    sum();
  }
  function sum() {
    const dr = round(d.lines.reduce((t, l) => t + num(l.dr), 0), dec());
    const cr = round(d.lines.reduce((t, l) => t + num(l.cr), 0), dec());
    const diff = round(dr - cr, dec());
    $('[data-sum]', root).innerHTML = String(html`<span class="inline small"><span>مدين: <b>${money(dr)}</b></span><span>دائن: <b>${money(cr)}</b></span>
      ${diff ? html`<span class="badge badge-bad">الفرق ${money(diff)}</span>` : dr ? html`<span class="badge badge-ok">متوازن ✓</span>` : ''}</span>`);
  }
  box.addEventListener('input', (e) => {
    const row = e.target.closest('.jl-line[data-i]');
    const k = e.target.dataset.k;
    if (!row || !k) return;
    const l = d.lines[Number(row.dataset.i)];
    l[k] = e.target.value;
    // المبلغ في جهة واحدة فقط
    if (k === 'dr' && num(l.dr)) { l.cr = ''; $('[data-k="cr"]', row).value = ''; }
    if (k === 'cr' && num(l.cr)) { l.dr = ''; $('[data-k="dr"]', row).value = ''; }
    guard.dirty = true;
    sum();
  });
  root.addEventListener('input', (e) => { const k = e.target.dataset.k; if ((k === 'date' || k === 'notes') && !e.target.closest('.jl-line')) { d[k] = e.target.value; guard.dirty = true; } });
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-add]')) { d.lines.push(emptyLine()); draw(); }
    const del = e.target.closest('[data-del]');
    if (del) { d.lines.splice(Number(del.closest('.jl-line').dataset.i), 1); while (d.lines.length < 2) d.lines.push(emptyLine()); draw(); }
  });
  $('[data-form]', root).onsubmit = (e) => {
    e.preventDefault();
    const doc = { ...d, notes: String(d.notes || '').trim(), lines: d.lines.filter((l) => l.account || num(l.dr) || num(l.cr)).map((l) => ({ account: l.account, party: isCtl(l.account) ? l.party : null, dr: num(l.dr), cr: num(l.cr), memo: String(l.memo || '').trim() })) };
    if (!showErrors(root, validateDoc(store.getDb(), doc))) { toast('راجع القيد: كل سطر يحتاج حساباً ومبلغاً، والمدين يساوي الدائن', 'err'); return; }
    store.saveDoc(doc);
    guard.dirty = false;
    toast('تم حفظ القيد ✓');
    go(docHref(doc));
  };
  draw();
}

export function show(type, { root, params, query }) {
  const d = store.findDoc(params.id);
  if (!d || d.type !== 'journal') { setTitle('قيد يومية'); root.innerHTML = String(empty('🔎', 'القيد غير موجود')); return; }
  const s = S();
  const B = store.getBooks();
  const no = docNo(d, s);
  setTitle('قيد يومية ' + no);
  const entry = B.entries.get(d.id);
  root.innerHTML = String(html`
    ${head('قيد يومية ' + no, { sub: `${fmtDate(d.date)}${d.notes ? ' · ' + d.notes : ''}`, actions: html`<button class="btn btn-primary" data-print>🖨️ طباعة</button><a class="btn btn-ghost" href="#/journal/${d.id}/edit">✏️ تعديل</a><a class="btn btn-ghost" href="#/journal/new">➕ قيد جديد</a><button class="btn btn-text-danger" data-del>🗑️ حذف</button>` })}
    <div data-entry>${entryTable(entry)}</div>`);
  const doPrint = () => printPaper(html`<div class="paper pp-report"><div class="pp-head"><div><h2 style="font-size:18px;font-weight:900">${s.name || ''}</h2></div><div class="pp-title"><h1>قيد يومية</h1><div class="en" dir="ltr">${no}</div></div></div>
    <div class="pp-meta"><div><span>التاريخ</span><b>${fmtDate(d.date)}</b></div><div><span>البيان</span><b>${d.notes || '—'}</b></div></div>${raw($('[data-entry]', root).innerHTML)}
    <div class="pp-sign"><div>أعدّه</div><div>راجعه</div><div>اعتمده</div></div></div>`, { title: no });
  $('[data-print]', root).onclick = doPrint;
  if (query.print) setTimeout(doPrint, 300);
  $('[data-del]', root).onclick = async () => {
    if (!(await confirmBox(`حذف القيد ${no}؟`, { ok: 'حذف', danger: true }))) return;
    store.deleteDoc(d.id);
    toast('تم الحذف');
    go('#/journal');
  };
}

// ═══ دفتر اليومية: كل القيود بالتسلسل ═══
export function daybook({ root, query, path }) {
  setTitle('دفتر اليومية');
  const s = S();
  const B = store.getBooks();
  const per = periodOf(query, 'month');
  const entries = [...B.entries.values()].filter((e) => inPeriod(e, per)).sort((a, b) => a.date.localeCompare(b.date));
  let limit = 150;
  let dr = 0;
  for (const e of entries) dr += e.dr;
  root.innerHTML = String(html`
    ${head('دفتر اليومية', { sub: 'كل القيود المحاسبية بالتسلسل الزمني، التلقائية واليدوية', actions: html`<a class="btn btn-ghost" href="#/journal">📒 القيود اليدوية</a>` })}
    <div class="toolbar">${periodBar(per)}<span class="grow"></span><button class="btn btn-ghost btn-sm" data-print>🖨️ طباعة</button><button class="btn btn-ghost btn-sm" data-csv>⬇️ Excel</button></div>
    <div class="sum-bar"><span>عدد القيود: <b>${entries.length}</b></span><span>إجمالي الحركة: <b>${money(dr, { sym: true })}</b></span></div>
    <div data-out></div>`);
  function draw() {
    $('[data-out]', root).innerHTML = String(entries.length ? html`<div class="tbl-wrap"><table class="tbl" data-table><thead><tr><th>التاريخ</th><th>المستند</th><th>الحساب</th><th class="num">مدين</th><th class="num">دائن</th></tr></thead><tbody>
      ${entries.slice(0, limit).map((e) => { const d = e.doc; const href = d.type === 'opening' ? '#/accounts' : docHref(d);
        return html`<tr class="grp" data-href="${href}"><td class="nowrap">${fmtDate(e.date)}</td><td colspan="4">${d.type === 'opening' ? 'القيد الافتتاحي' : `${DOC_TYPES[d.type].name} ${docNo(d, s)}`}${d.party ? ' — ' + partyName(d.party) : ''}${d.notes ? ' — ' + d.notes : ''}</td></tr>
          ${e.lines.map((l) => html`<tr class="sub-row"><td></td><td></td><td class="${l.cr ? 'ind-1' : ''}">${l.cr ? 'إلى ' : 'من '}${accName(l.acc)}${l.party ? ' — ' + partyName(l.party) : ''}</td><td class="num">${l.dr ? money(l.dr) : ''}</td><td class="num">${l.cr ? money(l.cr) : ''}</td></tr>`)}`; })}
    </tbody></table></div>${entries.length > limit ? html`<p style="text-align:center;margin-top:12px"><button class="btn btn-ghost" data-more>عرض المزيد (${entries.length - limit})</button></p>` : ''}`
      : empty('📖', 'لا توجد قيود في هذه الفترة'));
  }
  draw();
  bindRows(root);
  bindPeriod(root, path, query);
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) { limit += 150; draw(); }
    if (e.target.closest('[data-print]')) { const t = $('[data-table]', root); if (t) printReport('دفتر اليومية', periodLabel(per), t); }
    if (e.target.closest('[data-csv]')) { const t = $('[data-table]', root); if (t) exportTable(t, csvName('دفتر اليومية')); }
  });
}
