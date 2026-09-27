// ═══ التحصيل: العملاء المدينون، المتأخرات، وتذكير واتساب ═══
import * as store from '../store.js';
import { docNo, daysBetween, DOC_TYPES } from '../core.js';
import { html, money, moneyText, fmtDate, toast, modal, $, norm, empty } from '../ui.js';
import { setTitle } from '../nav.js';
import { head, S, today, waLink } from './common.js';

export const DEFAULT_REMINDER = 'مرحباً {الاسم}،\nنودّ تذكيركم بأن الرصيد المستحق لدى {المنشأة} هو {المبلغ}{المتأخر}.\n{الفواتير}\nشاكرين تعاونكم، ويسعدنا إرسال كشف الحساب عند الطلب.';
const TAGS = ['{الاسم}', '{المبلغ}', '{المتأخر}', '{الفواتير}', '{المنشأة}'];

// صفوف العملاء المدينين مع المتأخر وأقدم استحقاق
export function receivables(db, B, asOf) {
  const docs = new Map(db.docs.map((d) => [d.id, d]));
  const rows = [];
  for (const p of db.parties) {
    if (p.kind !== 'customer') continue;
    const total = B.partyBalance.get(p.id) || 0;
    if (!(total > 0)) continue;
    let overdue = 0;
    let oldest = '';
    const items = [];
    for (const it of B.openItems.get(p.id) || []) {
      if (it.side === 's') continue;
      const d = docs.get(it.doc);
      const due = (d && d.dueDate) || it.date;
      if (due < asOf) overdue += it.open;
      if (!oldest || due < oldest) oldest = due;
      items.push({ doc: d, date: it.date, due, open: it.open });
    }
    overdue = Math.min(total, Math.round(overdue * 1000) / 1000);
    rows.push({ party: p, total, overdue, oldest, days: oldest ? Math.max(0, daysBetween(oldest, asOf)) : 0, items });
  }
  return rows.sort((a, b) => b.overdue - a.overdue || b.total - a.total);
}

export function reminderText(r, s, template) {
  const list = r.items.slice(0, 10).map((it) => (it.doc ? `• ${DOC_TYPES[it.doc.type]?.name || ''} ${docNo(it.doc, s)} بتاريخ ${fmtDate(it.date)}: المتبقي ${moneyText(it.open)}` : `• رصيد سابق: ${moneyText(it.open)}`)).join('\n');
  const vals = {
    '{الاسم}': r.party.name, '{المبلغ}': moneyText(r.total), '{المنشأة}': s.name || '',
    '{المتأخر}': r.overdue > 0 && r.overdue < r.total ? `، منها ${moneyText(r.overdue)} متأخرة السداد` : r.overdue > 0 ? ' (متأخر السداد)' : '',
    '{الفواتير}': list ? `التفاصيل:\n${list}` : '',
  };
  return String(template || DEFAULT_REMINDER).replace(/\{[^{}]+\}/g, (m) => (m in vals ? vals[m] : m)).replace(/\n{3,}/g, '\n\n').trim();
}

export function view({ root, query }) {
  setTitle('التحصيل والتذكير');
  const db = store.getDb();
  const s = S();
  const B = store.getBooks();
  const t = today();
  const all = receivables(db, B, t);
  const state = { f: query.f || '', q: '' };
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const reminded = (r) => r.party.lastReminderAt && r.party.lastReminderAt >= weekAgo;
  const sum = (xs, k) => xs.reduce((a, r) => a + r[k], 0);

  root.innerHTML = String(html`${head('التحصيل والتذكير', { sub: 'العملاء المدينون مرتبين حسب المتأخر، مع تذكير جاهز عبر واتساب', actions: html`<a class="btn btn-ghost" href="#/reports/aging-ar">📊 أعمار الديون</a><a class="btn btn-primary" href="#/receipts/new">📥 سند قبض</a>` })}
    ${all.length ? html`<div class="grid g4" style="margin-bottom:14px">
      <div class="kpi"><span class="kpi-l">إجمالي المستحق</span><span class="kpi-v">${money(sum(all, 'total'), { sym: true })}</span><span class="kpi-s">${all.length} عميل</span></div>
      <div class="kpi"><span class="kpi-l">المتأخر</span><span class="kpi-v neg">${money(sum(all, 'overdue'), { sym: true })}</span><span class="kpi-s">${all.filter((r) => r.overdue > 0).length} عميل</span></div>
      <div class="kpi"><span class="kpi-l">ذُكّروا هذا الأسبوع</span><span class="kpi-v">${all.filter(reminded).length}</span></div>
      <div class="kpi"><span class="kpi-l">بدون رقم جوال</span><span class="kpi-v">${all.filter((r) => !r.party.phone).length}</span></div></div>
    <div class="toolbar"><input class="inp grow" type="search" data-q placeholder="بحث باسم العميل أو الجوال">
      <div class="seg">${[['', 'الكل'], ['late', 'المتأخرون'], ['todo', 'لم يُذكَّروا هذا الأسبوع']].map(([k, l]) => html`<button type="button" data-f="${k}" class="${state.f === k ? 'on' : ''}">${l}</button>`)}</div></div>
    <div data-out></div>` : empty('🎉', 'لا توجد مستحقات على العملاء', 'كل العملاء مسددون. الفواتير الآجلة ستظهر هنا عند استحقاقها.')}
    <details class="card" style="margin-top:14px" data-tpl-box><summary style="cursor:pointer;font-weight:800">✏️ نص رسالة التذكير</summary>
      <p class="muted small" style="margin:10px 0 8px">يمكنك استخدام: ${TAGS.map((x, i) => html`${i ? '، ' : ''}<code>${x}</code>`)}</p>
      <textarea class="inp" rows="6" data-tpl>${s.reminderTemplate || DEFAULT_REMINDER}</textarea>
      <div class="actions" style="margin-top:10px"><button class="btn btn-primary btn-sm" data-tpl-save>حفظ النص</button><button class="btn btn-ghost btn-sm" data-tpl-reset>النص الافتراضي</button></div></details>`);

  function draw() {
    const out = $('[data-out]', root);
    if (!out) return;
    const q = norm(state.q.trim());
    const rows = all.filter((r) => (!q || norm(`${r.party.name} ${r.party.phone || ''}`).includes(q))
      && (state.f !== 'late' || r.overdue > 0) && (state.f !== 'todo' || !reminded(r)));
    out.innerHTML = rows.length ? String(html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>العميل</th><th class="num">المستحق</th><th class="num">المتأخر</th><th class="hide-sm">أقدم استحقاق</th><th class="hide-sm">آخر تذكير</th><th></th></tr></thead><tbody>
      ${rows.map((r) => html`<tr><td><a href="#/customers/${r.party.id}"><b>${r.party.name}</b></a>${r.party.phone ? html`<div class="muted small" dir="ltr" style="text-align:end">${r.party.phone}</div>` : ''}</td>
        <td class="num">${money(r.total)}</td><td class="num ${r.overdue > 0 ? 'neg' : ''}">${r.overdue > 0 ? money(r.overdue) : '—'}</td>
        <td class="hide-sm">${r.oldest ? html`${fmtDate(r.oldest)}${r.days > 0 ? html` <span class="badge ${r.days > 60 ? 'badge-bad' : r.days > 30 ? 'badge-warn' : 'badge-muted'}">${r.days} يوم</span>` : ''}` : '—'}</td>
        <td class="hide-sm">${r.party.lastReminderAt ? fmtDate(r.party.lastReminderAt.slice(0, 10)) : html`<span class="muted">—</span>`}</td>
        <td class="num"><span class="inline" style="justify-content:flex-end"><button class="btn btn-ghost btn-sm" data-remind="${r.party.id}">💬 تذكير</button><a class="btn btn-ghost btn-sm" href="#/receipts/new?party=${r.party.id}&amount=${r.total}">💵 قبض</a></span></td></tr>`)}
    </tbody></table></div>`) : String(html`<div class="empty"><p>لا توجد نتائج مطابقة.</p></div>`);
  }

  function remind(r) {
    const text = reminderText(r, s, S().reminderTemplate);
    modal({
      title: `تذكير: ${r.party.name}`,
      body: html`<textarea class="inp" rows="9" data-msg>${text}</textarea>
        ${r.party.phone ? '' : html`<p class="note note-warn" style="margin-top:10px">لا يوجد رقم جوال لهذا العميل. <a href="#/customers/${r.party.id}/edit">أضف الرقم</a> أو انسخ الرسالة.</p>`}
        <div class="dlg-actions">${r.party.phone ? html`<button type="button" class="btn btn-primary" data-send>💬 إرسال عبر واتساب</button>` : ''}<button type="button" class="btn btn-ghost" data-copy>📋 نسخ النص</button></div>`,
      onMount: (dlg, done) => {
        const mark = () => { store.saveParty({ id: r.party.id, lastReminderAt: new Date().toISOString() }); r.party = store.findParty(r.party.id); };
        const send = $('[data-send]', dlg);
        if (send) send.onclick = () => { window.open(waLink(r.party.phone, $('[data-msg]', dlg).value), '_blank', 'noopener'); mark(); done(true); };
        $('[data-copy]', dlg).onclick = () => navigator.clipboard?.writeText($('[data-msg]', dlg).value).then(() => { toast('تم نسخ النص'); mark(); done(true); }, () => toast('تعذّر النسخ', 'err'));
      },
    }).then((ok) => { if (ok) draw(); });
  }

  root.addEventListener('click', (e) => {
    const f = e.target.closest('[data-f]');
    if (f) { state.f = f.dataset.f; root.querySelectorAll('[data-f]').forEach((b) => b.classList.toggle('on', b === f)); draw(); history.replaceState(null, '', '#/collections' + (state.f ? '?f=' + state.f : '')); return; }
    const r = e.target.closest('[data-remind]');
    if (r) { const row = all.find((x) => x.party.id === r.dataset.remind); if (row) remind(row); }
  });
  const qi = $('[data-q]', root);
  if (qi) qi.oninput = () => { state.q = qi.value; draw(); };
  $('[data-tpl-save]', root).onclick = () => { store.saveSettings({ reminderTemplate: $('[data-tpl]', root).value.trim() }); toast('تم حفظ النص ✓'); };
  $('[data-tpl-reset]', root).onclick = () => { $('[data-tpl]', root).value = DEFAULT_REMINDER; store.saveSettings({ reminderTemplate: '' }); toast('تمت الاستعادة'); };
  draw();
}

