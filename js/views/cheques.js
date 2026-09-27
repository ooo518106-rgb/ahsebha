// ═══ الشيكات المؤجلة: الواردة تحت التحصيل والصادرة المستحقة، وتحصيلها أو ارتجاعها ═══
import * as store from '../store.js';
import { docNo, isPdc, isLockedDate, isDate, daysBetween, addDays } from '../core.js';
import { html, money, fmtDate, toast, modal, $, field, empty, showErrors, exportTable } from '../ui.js';
import { go, setTitle, docHref, withQuery } from '../nav.js';
import { head, S, today, partyName, accName, csvName } from './common.js';

const STATE = { pending: ['تحت التحصيل', 'warn'], cleared: ['محصّل', 'ok'], bounced: ['مرتجع', 'bad'] };
const stateOf = (d) => (isDate(d.cleared) ? 'cleared' : isDate(d.bounced) ? 'bounced' : 'pending');

export function view({ root, query, path }) {
  setTitle('الشيكات');
  const db = store.getDb();
  const s = S();
  const t = today();
  const tab = query.tab === 'out' ? 'out' : 'in';
  const f = ['pending', 'cleared', 'bounced', 'all'].includes(query.f) ? query.f : 'pending';
  const all = db.docs.filter((d) => isPdc(d) && d.type === (tab === 'in' ? 'receipt' : 'payment'));
  const pending = all.filter((d) => stateOf(d) === 'pending');
  const soon = pending.filter((d) => d.chequeDue <= addDays(t, 7));
  const late = pending.filter((d) => d.chequeDue < t);
  const rows = all.filter((d) => f === 'all' || stateOf(d) === f)
    .sort((a, b) => (f === 'pending' ? a.chequeDue.localeCompare(b.chequeDue) : String(b.cleared || b.bounced || b.chequeDue).localeCompare(String(a.cleared || a.bounced || a.chequeDue))));
  const sum = (xs) => xs.reduce((x, d) => x + Number(d.amount || 0), 0);
  const dueBadge = (d) => {
    if (stateOf(d) !== 'pending') return '';
    const n = daysBetween(t, d.chequeDue);
    return n < 0 ? html`<span class="badge badge-bad">متأخر ${-n} يوم</span>` : n === 0 ? html`<span class="badge badge-warn">اليوم</span>` : n <= 7 ? html`<span class="badge badge-warn">بعد ${n} يوم</span>` : '';
  };
  root.innerHTML = String(html`${head('الشيكات', { sub: 'الشيكات المؤجلة لا تدخل البنك حتى تحصيلها', actions: html`<a class="btn btn-primary" href="#/${tab === 'in' ? 'receipts' : 'payments'}/new">➕ ${tab === 'in' ? 'سند قبض بشيك' : 'سند صرف بشيك'}</a>` })}
    <div class="tabs">${[['in', '📥 شيكات واردة (من العملاء)'], ['out', '📤 شيكات صادرة (للموردين)']].map(([k, l]) => html`<a href="${withQuery(path, { tab: k === 'in' ? '' : k, f })}" class="${k === tab ? 'on' : ''}">${l}</a>`)}</div>
    <div class="grid g4" style="margin-bottom:14px">
      <div class="kpi"><span class="kpi-l">${tab === 'in' ? 'تحت التحصيل' : 'مستحقة الدفع'}</span><span class="kpi-v">${money(sum(pending), { sym: true })}</span><span class="kpi-s">${pending.length} شيك</span></div>
      <div class="kpi"><span class="kpi-l">تستحق خلال أسبوع</span><span class="kpi-v">${money(sum(soon), { sym: true })}</span><span class="kpi-s">${soon.length} شيك</span></div>
      <div class="kpi"><span class="kpi-l">متأخرة عن تاريخها</span><span class="kpi-v ${late.length ? 'neg' : ''}">${money(sum(late), { sym: true })}</span><span class="kpi-s">${late.length} شيك</span></div>
      <div class="kpi"><span class="kpi-l">مرتجعة</span><span class="kpi-v">${all.filter((d) => stateOf(d) === 'bounced').length}</span></div>
    </div>
    <div class="toolbar"><div class="seg">${[['pending', 'المعلّقة'], ['cleared', 'المحصّلة'], ['bounced', 'المرتجعة'], ['all', 'الكل']].map(([k, l]) => html`<a class="btn btn-sm ${k === f ? 'btn-primary' : 'btn-ghost'}" href="${withQuery(path, { tab: tab === 'in' ? '' : tab, f: k === 'pending' ? '' : k })}">${l}</a>`)}</div><span class="grow"></span><button class="btn btn-ghost btn-sm" data-csv>⬇️ Excel</button></div>
    ${rows.length ? html`<div class="tbl-wrap"><table class="tbl" data-table><thead><tr><th>رقم الشيك</th><th class="hide-sm">البنك</th><th>${tab === 'in' ? 'من' : 'إلى'}</th><th class="num">المبلغ</th><th>الاستحقاق</th><th class="hide-sm">السند</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${rows.map((d) => { const [lbl, k] = STATE[stateOf(d)]; return html`<tr><td dir="ltr" class="nowrap"><b>${d.chequeNo || '—'}</b></td><td class="hide-sm">${d.chequeBank || ''}</td>
        <td>${d.party ? partyName(d.party) : accName(d.account)}</td><td class="num">${money(d.amount)}</td>
        <td class="nowrap">${fmtDate(d.chequeDue)} ${dueBadge(d)}</td><td class="hide-sm"><a href="${docHref(d)}" dir="ltr">${docNo(d, s)}</a></td>
        <td><span class="badge badge-${k}">${lbl}</span>${d.cleared ? html`<div class="muted small">${fmtDate(d.cleared)} · ${accName(d.money)}</div>` : ''}${d.bounced ? html`<div class="muted small">${fmtDate(d.bounced)}</div>` : ''}</td>
        <td class="num"><span class="inline" style="justify-content:flex-end">${stateOf(d) === 'pending'
          ? html`<button class="btn btn-ghost btn-sm" data-clear="${d.id}">✅ ${tab === 'in' ? 'تحصيل' : 'صُرف'}</button><button class="btn btn-ghost btn-sm" data-bounce="${d.id}">↩️ مرتجع</button>`
          : html`<button class="btn btn-ghost btn-sm" data-undo="${d.id}">↶ تراجع</button>`}</span></td></tr>`; })}
    </tbody></table></div>`
    : empty('🧾', f === 'pending' ? 'لا توجد شيكات معلّقة' : 'لا توجد شيكات', 'عند تسجيل سند قبض أو صرف اختر «شيك» واكتب تاريخ استحقاقه، فيبقى هنا حتى تحصيله.')}`);

  const act = (id, kind) => {
    const d = store.findDoc(id);
    const title = kind === 'clear' ? (tab === 'in' ? 'تحصيل الشيك' : 'صرف الشيك من البنك') : kind === 'bounce' ? 'ارتجاع الشيك' : '';
    modal({
      title: `${title} ${d.chequeNo || ''}`,
      body: html`<form class="form-grid" novalidate>
        <div>${field(kind === 'clear' ? 'تاريخ التحصيل' : 'تاريخ الارتجاع', html`<input class="inp" type="date" name="date" data-f="date" value="${t < d.date ? d.date : t}">`)}<small class="fld-e" data-err="date" hidden></small></div>
        ${kind === 'clear' ? html`<p class="muted small span-all">يُسجَّل المبلغ ${money(d.amount, { sym: true })} في ${accName(d.money)} بهذا التاريخ.</p>`
          : html`<p class="muted small span-all">${d.party ? `يعود المبلغ ديناً ${tab === 'in' ? 'على' : 'لـ'} ${partyName(d.party)}` : 'يُعكس المبلغ على الحساب المقابل'} ويظهر في كشف الحساب كشيك مرتجع.</p>`}
        <div class="dlg-actions span-all"><button class="btn btn-primary">تأكيد</button><button type="button" class="btn btn-ghost" data-no>إلغاء</button></div></form>`,
      onMount: (dlg, done) => {
        const fm = $('form', dlg);
        $('[data-no]', dlg).onclick = () => done(null);
        fm.onsubmit = (e) => {
          e.preventDefault();
          const date = fm.date.value;
          const err = !isDate(date) ? 'اختر التاريخ' : date < d.date ? 'التاريخ قبل تاريخ السند' : isLockedDate(s, date) ? `الفترة مقفلة حتى ${fmtDate(s.lockDate)}` : '';
          if (!showErrors(fm, err ? { date: err } : {})) return;
          store.patchDoc(d.id, kind === 'clear' ? { cleared: date, bounced: '' } : { bounced: date, cleared: '' }, { log: true });
          done(true);
        };
      },
    }).then((ok) => { if (ok) { toast('تم ✓'); go(location.hash); } });
  };
  root.addEventListener('click', (e) => {
    const c = e.target.closest('[data-clear]'), b = e.target.closest('[data-bounce]'), u = e.target.closest('[data-undo]');
    if (c) act(c.dataset.clear, 'clear');
    else if (b) act(b.dataset.bounce, 'bounce');
    else if (u) {
      const d = store.findDoc(u.dataset.undo);
      const when = d.cleared || d.bounced;
      if (isLockedDate(s, when)) { toast(`الفترة مقفلة حتى ${fmtDate(s.lockDate)}`, 'err'); return; }
      store.patchDoc(d.id, { cleared: '', bounced: '' }, { log: true });
      toast('أُعيد الشيك إلى المعلّقة');
      go(location.hash);
    } else if (e.target.closest('[data-csv]')) { const tb = $('[data-table]', root); if (tb) exportTable(tb, csvName('الشيكات')); }
  });
}

