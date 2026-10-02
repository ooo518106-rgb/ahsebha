// ═══ مطابقة البنك: مقارنة حركات الدفاتر بكشف حساب البنك، مع استيراد الكشف والمطابقة التلقائية ═══
import * as store from '../store.js';
import { DOC_TYPES, docNo, num, round, isDate, reconItems, reconSummary, monthEnd, addMonths } from '../core.js';
import { html, raw, money, fmtDate, toast, confirmBox, modal, $, field, empty, showErrors } from '../ui.js';
import { go, setTitle, docHref, withQuery } from '../nav.js';
import { head, S, dec, today, moneyList, partyName, docOf } from './common.js';

const recHref = (q) => withQuery('reconcile', q);

export function view({ root, query }) {
  setTitle('مطابقة البنك');
  const db = store.getDb();
  const s = S();
  const accs = moneyList();
  const acc = accs.find((a) => a.id === query.acc) || accs.find((a) => a.id === 'bank') || accs[0];
  if (!acc) { root.innerHTML = String(empty('🏦', 'لا يوجد حساب بنكي')); return; }
  const recs = db.recons.filter((r) => r.account === acc.id).sort((a, b) => b.date.localeCompare(a.date));
  const draft = recs.find((r) => !r.done);
  const cur = query.id ? store.findRecon(query.id) : query.new ? null : draft || null;
  const B = store.getBooks();
  const picker = html`<select class="inp" data-acc>${accs.map((a) => html`<option value="${a.id}" ${a.id === acc.id ? raw('selected') : ''}>${a.name}</option>`)}</select>`;

  if (!cur) {
    const last = recs.find((r) => r.done);
    const next = last ? monthEnd(addMonths(last.date.slice(0, 8) + '01', 1)) : monthEnd(addMonths(today().slice(0, 8) + '01', -1));
    root.innerHTML = String(html`${head('مطابقة البنك', { sub: 'طابق حركات دفاترك مع كشف حساب البنك، واكتشف الرسوم والحركات الناقصة' })}
      <div class="toolbar">${picker}</div>
      <form class="card" data-new novalidate><div class="card-h"><h3>مطابقة جديدة لـ ${acc.name}</h3></div><div class="form-grid">
        <div>${field('تاريخ نهاية الكشف', html`<input class="inp" type="date" name="date" data-f="date" value="${next > today() ? today() : next}">`)}</div>
        <div>${field('الرصيد في آخر الكشف', html`<input class="inp" name="balance" data-f="balance" type="text" inputmode="decimal" data-num placeholder="كما يظهر في كشف البنك">`)}</div>
      </div><div class="form-actions"><button class="btn btn-primary">بدء المطابقة</button></div></form>
      ${recs.length ? html`<div class="card"><div class="card-h"><h3>المطابقات السابقة</h3></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>تاريخ الكشف</th><th class="num">رصيد الكشف</th><th class="num">الحركات المطابقة</th><th>الحالة</th></tr></thead><tbody>
        ${recs.map((r) => html`<tr data-href="${recHref({ acc: acc.id, id: r.id })}"><td>${fmtDate(r.date)}</td><td class="num">${money(r.balance)}</td><td class="num">${r.keys.length}</td><td>${r.done ? html`<span class="badge badge-ok">مكتملة</span>` : html`<span class="badge badge-warn">مسودة</span>`}</td></tr>`)}
      </tbody></table></div></div>` : ''}`);
    $('[data-acc]', root).onchange = (e) => go(recHref({ acc: e.target.value }));
    root.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-href]'); if (tr) go(tr.dataset.href); });
    const f = $('[data-new]', root);
    f.onsubmit = (e) => {
      e.preventDefault();
      const errs = {};
      if (!isDate(f.date.value)) errs.date = 'اختر التاريخ';
      else if (last && f.date.value <= last.date) errs.date = `بعد آخر مطابقة (${fmtDate(last.date)})`;
      if (f.balance.value.trim() === '') errs.balance = 'اكتب الرصيد من كشف البنك';
      if (!showErrors(f, errs)) return;
      const r = store.saveRecon({ account: acc.id, date: f.date.value, balance: round(num(f.balance.value), dec()), keys: [], stmt: [], done: false });
      go(recHref({ acc: acc.id, id: r.id }));
    };
    return;
  }

  // ── مطابقة مفتوحة أو مكتملة ──
  const prevKeys = new Set(recs.filter((r) => r.done && r.id !== cur.id && r.date <= cur.date).flatMap((r) => r.keys));
  const all = reconItems(B, acc.id, { to: cur.date });
  const opening = all.filter((x) => x.doc === 'opening').map((x) => x.pk);
  const mine = new Set(cur.keys);
  const cleared = new Set([...prevKeys, ...opening, ...mine]);
  const shown = all.filter((x) => x.doc !== 'opening' && !prevKeys.has(x.pk));
  const sum = reconSummary(all, cleared, cur.balance, dec());
  const desc = (x) => {
    const d = docOf(x.doc, B);
    return [DOC_TYPES[x.type]?.name, x.party ? partyName(x.party) : d && d.party ? partyName(d.party) : '', d && d.notes ? d.notes : x.memo].filter(Boolean).join(' — ');
  };
  const stmt = cur.stmt || [];
  const unmatched = stmt.filter((r) => !r.pk || !all.some((x) => x.pk === r.pk));
  root.innerHTML = String(html`${head(`مطابقة ${acc.name} — ${fmtDate(cur.date)}`, { sub: cur.done ? 'مطابقة مكتملة' : 'حدد الحركات الظاهرة في كشف البنك حتى يصير الفرق صفراً',
    actions: html`<a class="btn btn-ghost" href="${recHref({ acc: acc.id, new: 1 })}">🏦 كل المطابقات</a>${cur.done ? '' : html`<label class="btn btn-ghost">📥 استيراد كشف البنك<input type="file" accept=".xlsx,.csv,.txt" data-file hidden></label>`}<button class="btn btn-text-danger" data-del>🗑️ حذف</button>` })}
    <div class="grid g4" style="margin-bottom:14px">
      <div class="kpi"><span class="kpi-l">رصيد الكشف</span><span class="kpi-v">${money(cur.balance, { sym: true })}</span>${cur.done ? '' : html`<button class="btn btn-ghost btn-sm" data-edit-bal style="margin-top:4px">تعديل</button>`}</div>
      <div class="kpi"><span class="kpi-l">الرصيد المطابق في الدفاتر</span><span class="kpi-v">${money(sum.cleared, { sym: true })}</span></div>
      <div class="kpi"><span class="kpi-l">الفرق</span><span class="kpi-v ${sum.diff ? 'neg' : 'pos'}">${money(sum.diff, { sym: true })}</span><span class="kpi-s">${sum.diff ? 'حدد الحركات أو سجّل الناقص' : '✓ مطابق'}</span></div>
      <div class="kpi"><span class="kpi-l">رصيد الدفاتر في التاريخ</span><span class="kpi-v">${money(sum.book, { sym: true })}</span><span class="kpi-s">إيداعات معلّقة ${money(sum.deposits)} · مدفوعات معلّقة ${money(sum.payments)}</span></div></div>
    ${unmatched.length && !cur.done ? html`<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>في الكشف وليست في الدفاتر (${unmatched.length})</h3><span class="muted small">غالباً رسوم بنكية أو حوالات لم تُسجَّل</span></div><div class="list-mini">
      ${unmatched.map((r) => html`<div class="it"><span>${fmtDate(r.date)} · ${r.desc || '—'}</span><span class="inline"><b class="${r.amount < 0 ? 'neg' : 'pos'}">${money(r.amount)}</b>
        <a class="btn btn-ghost btn-sm" href="${r.amount < 0 ? withQuery('expenses/new', { account: 'e_fees', amount: -r.amount, notes: r.desc, pay: acc.id, date: r.date, inc: 1 }) : withQuery('receipts/new', { account: 'oinc', amount: r.amount, money: acc.id, date: r.date, notes: r.desc })}">➕ تسجيل</a></span></div>`)}</div></div>` : ''}
    <div class="toolbar">${cur.done ? '' : html`<button class="btn btn-ghost btn-sm" data-all>تحديد الكل</button><button class="btn btn-ghost btn-sm" data-none>إلغاء التحديد</button>`}<span class="grow"></span>
      ${cur.done ? html`<span class="badge badge-ok">✓ مكتملة</span><button class="btn btn-ghost btn-sm" data-reopen>إعادة فتح</button>` : html`<button class="btn btn-primary" data-finish ${sum.diff ? raw('disabled') : ''}>✅ إنهاء المطابقة</button>`}</div>
    ${shown.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:40px"></th><th>التاريخ</th><th>المستند</th><th class="hide-sm">البيان</th><th class="num">إيداع</th><th class="num">سحب</th></tr></thead><tbody>
      ${shown.map((x) => { const d = docOf(x.doc, B); return html`<tr class="${mine.has(x.pk) ? '' : 'sub-row'}"><td><input type="checkbox" data-pk="${x.pk}" ${mine.has(x.pk) ? raw('checked') : ''} ${cur.done ? raw('disabled') : ''} aria-label="مطابقة"></td>
        <td class="nowrap">${fmtDate(x.date)}</td><td class="nowrap">${d ? html`<a href="${docHref(d)}" dir="ltr">${docNo(d, s)}</a>` : ''}</td><td class="hide-sm">${desc(x)}</td>
        <td class="num">${x.amount > 0 ? money(x.amount) : ''}</td><td class="num">${x.amount < 0 ? money(-x.amount) : ''}</td></tr>`; })}
    </tbody></table></div>` : empty('✅', 'لا توجد حركات غير مطابقة حتى هذا التاريخ')}`);

  const save = (patch) => { store.saveRecon({ id: cur.id, ...patch }); go(recHref({ acc: acc.id, id: cur.id })); };
  root.addEventListener('change', (e) => {
    const c = e.target.closest('[data-pk]');
    if (!c) return;
    const keys = new Set(cur.keys);
    if (c.checked) keys.add(c.dataset.pk); else keys.delete(c.dataset.pk);
    save({ keys: [...keys] });
  });
  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-all]')) save({ keys: [...new Set([...cur.keys, ...shown.map((x) => x.pk)])] });
    else if (e.target.closest('[data-none]')) save({ keys: [] });
    else if (e.target.closest('[data-finish]')) { store.saveRecon({ id: cur.id, done: true, doneAt: new Date().toISOString() }); toast('اكتملت المطابقة ✓'); go(recHref({ acc: acc.id, id: cur.id })); }
    else if (e.target.closest('[data-reopen]')) {
      if (recs.some((r) => r.done && r.date > cur.date)) { toast('توجد مطابقة مكتملة بعدها؛ أعد فتح الأحدث أولاً', 'err'); return; }
      save({ done: false });
    } else if (e.target.closest('[data-del]')) {
      if (!(await confirmBox('حذف هذه المطابقة؟ لا تتأثر المستندات.', { ok: 'حذف', danger: true }))) return;
      store.deleteRecon(cur.id); go(recHref({ acc: acc.id, new: 1 }));
    } else if (e.target.closest('[data-edit-bal]')) {
      const v = await modal({
        title: 'رصيد آخر كشف البنك',
        body: html`<form novalidate>${field('الرصيد', html`<input class="inp" name="b" type="text" inputmode="decimal" data-num value="${cur.balance}" autofocus>`)}<div class="dlg-actions"><button class="btn btn-primary">حفظ</button></div></form>`,
        onMount: (dlg, done) => { const f = $('form', dlg); f.onsubmit = (ev) => { ev.preventDefault(); done(f.b.value.trim()); }; },
      });
      if (v) save({ balance: round(num(v), dec()) });
    }
  });
  const file = $('[data-file]', root);
  if (file) file.onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const [{ readTable }, { parseStatement, matchStatement }] = await Promise.all([import('../xlsx.js'), import('../imports.js')]);
      const st = parseStatement(await readTable(f));
      if (st.error) { toast(st.error, 'err'); return; }
      const rows = st.rows.filter((r) => r.date <= cur.date);
      const m = matchStatement(rows, shown);
      const keys = new Set(cur.keys);
      rows.forEach((r, i) => { if (m.matches.has(i)) { r.pk = m.matches.get(i); keys.add(r.pk); } });
      toast(`قُرئ ${rows.length} حركة: طابقنا ${m.matches.size}، وبقي ${m.unmatched.length} غير موجودة في الدفاتر`, m.unmatched.length ? 'warn' : 'ok');
      save({ keys: [...keys], stmt: rows });
    } catch (err) { toast(err.message || 'تعذّر قراءة الملف', 'err'); }
  };
}

