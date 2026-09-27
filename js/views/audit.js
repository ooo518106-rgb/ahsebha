// ═══ سجل التعديلات: كل إضافة وتعديل وحذف للمستندات، ومن قام به، ونسخة المستند قبل التغيير ═══
import * as store from '../store.js';
import { DOC_TYPES, docNo, calcDoc, expenseAsDoc, num } from '../core.js';
import { html, money, fmtDate, modal, $, empty, exportTable } from '../ui.js';
import { setTitle, docHref, withQuery } from '../nav.js';
import { head, S, dec, partyName, accName, csvName } from './common.js';

const ACT = { create: ['إضافة', 'ok'], update: ['تعديل', 'info'], delete: ['حذف', 'bad'], lock: ['قفل الفترات', 'warn'] };
const who = (id) => (id ? store.findUser(id)?.name || 'مستخدم محذوف' : '—');
const when = (iso) => { const d = new Date(iso); return `${fmtDate(iso.slice(0, 10))} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

// الحقول المختلفة بين نسختين من المستند، بكلمات مفهومة
const LABELS = { date: 'التاريخ', party: 'الطرف', amount: 'المبلغ', notes: 'الملاحظات', dueDate: 'الاستحقاق', account: 'الحساب', money: 'الصندوق/البنك', paid: 'المدفوع', payAcc: 'طريقة الدفع', payments: 'الدفعات', lines: 'البنود', vatRate: 'نسبة الضريبة', inclusive: 'شامل الضريبة', ref: 'المرجع', from: 'من', to: 'إلى', method: 'طريقة الدفع', chequeNo: 'رقم الشيك', cleared: 'تحصيل الشيك', bounced: 'ارتجاع الشيك', link: 'الربط بفاتورة' };
const show = (k, v) => {
  if (v == null || v === '') return '—';
  if (k === 'party') return partyName(v, v);
  if (k === 'account' || k === 'money' || k === 'payAcc' || k === 'from' || k === 'to') return accName(v);
  if (k === 'lines') return `${v.length} بند`;
  if (k === 'payments') return v.map((p) => `${accName(p.acc)} ${p.amount}`).join('، ');
  if (typeof v === 'boolean') return v ? 'نعم' : 'لا';
  return String(v);
};
function diff(before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const out = [];
  for (const k of keys) {
    if (['updatedAt', 'editedBy', 'createdAt', 'by', 'time', 'no', 'id', 'type'].includes(k)) continue;
    if (JSON.stringify(before?.[k] ?? null) === JSON.stringify(after?.[k] ?? null)) continue;
    out.push({ k, label: LABELS[k] || k, a: show(k, before?.[k]), b: show(k, after?.[k]) });
  }
  return out;
}
const totalOf = (d) => (d ? (DOC_TYPES[d.type]?.lines ? calcDoc(d, dec()).total : d.type === 'expense' ? calcDoc(expenseAsDoc(d), dec()).total : num(d.amount)) : 0);

export function view({ root, query, path }) {
  setTitle('سجل التعديلات');
  const db = store.getDb();
  const s = S();
  const f = { act: query.act || '', by: query.by || '' };
  const rows = db.audit.slice().reverse().filter((x) => (!f.act || x.act === f.act) && (!f.by || x.by === f.by));
  const users = [...new Set(db.audit.map((x) => x.by).filter(Boolean))];
  let limit = 200;
  root.innerHTML = String(html`${head('سجل التعديلات', { sub: 'آخر 1500 عملية على المستندات: من أضاف أو عدّل أو حذف، ومتى' })}
    <div class="toolbar"><select class="inp" data-act><option value="">كل العمليات</option>${Object.entries(ACT).map(([k, v]) => html`<option value="${k}" ${k === f.act ? 'selected' : ''}>${v[0]}</option>`)}</select>
      ${users.length ? html`<select class="inp" data-by><option value="">كل المستخدمين</option>${users.map((u) => html`<option value="${u}" ${u === f.by ? 'selected' : ''}>${who(u)}</option>`)}</select>` : ''}
      <span class="grow"></span><button class="btn btn-ghost btn-sm" data-csv>⬇️ Excel</button></div>
    <div data-out></div>`);
  const draw = () => {
    $('[data-out]', root).innerHTML = String(rows.length ? html`<div class="tbl-wrap"><table class="tbl" data-table><thead><tr><th>الوقت</th><th>العملية</th><th>المستند</th><th class="hide-sm">تاريخه</th><th class="num">المبلغ</th><th class="hide-sm">المستخدم</th><th></th></tr></thead><tbody>
      ${rows.slice(0, limit).map((x) => { const [t, k] = ACT[x.act] || [x.act, 'muted']; const d = store.findDoc(x.doc);
        return html`<tr><td class="nowrap">${when(x.at)}</td><td><span class="badge badge-${k}">${t}</span></td>
          <td class="nowrap">${x.act === 'lock' ? (x.date ? `قفل حتى ${fmtDate(x.date)}` : 'فتح كل الفترات') + (x.from ? ` (كان ${fmtDate(x.from)})` : '') : d ? html`<a href="${docHref(d)}">${DOC_TYPES[x.type]?.name || ''} <span dir="ltr">${docNo(d, s)}</span></a>` : html`${DOC_TYPES[x.type]?.name || ''} <span dir="ltr">${docNo({ type: x.type, no: x.no }, s)}</span>`}</td>
          <td class="hide-sm">${x.date && x.act !== 'lock' ? fmtDate(x.date) : ''}</td><td class="num">${money(x.amount || 0)}</td><td class="hide-sm">${who(x.by)}</td>
          <td class="num">${x.before ? html`<button class="btn btn-ghost btn-sm" data-diff="${x.id}">عرض التغيير</button>` : ''}</td></tr>`; })}
    </tbody></table></div>${rows.length > limit ? html`<p style="text-align:center;margin-top:12px"><button class="btn btn-ghost" data-more>عرض المزيد (${rows.length - limit})</button></p>` : ''}`
      : empty('🕘', 'لا توجد عمليات مسجلة بعد', 'كل إضافة أو تعديل أو حذف لمستند من الآن فصاعداً تُسجَّل هنا.'));
  };
  draw();
  const go2 = (q) => { location.hash = withQuery(path, { ...f, ...q }); };
  $('[data-act]', root).onchange = (e) => go2({ act: e.target.value });
  const by = $('[data-by]', root);
  if (by) by.onchange = (e) => go2({ by: e.target.value });
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) { limit += 200; draw(); }
    if (e.target.closest('[data-csv]')) { const t = $('[data-table]', root); if (t) exportTable(t, csvName('سجل التعديلات')); }
    const b = e.target.closest('[data-diff]');
    if (!b) return;
    const x = db.audit.find((y) => y.id === b.dataset.diff);
    const after = x.act === 'delete' ? null : (() => {
      // النسخة التي تلت هذا التعديل: التعديل التالي لنفس المستند، أو المستند الحالي
      const i = db.audit.indexOf(x);
      const next = db.audit.slice(i + 1).find((y) => y.doc === x.doc && y.before);
      return next ? next.before : store.findDoc(x.doc);
    })();
    const changes = x.act === 'delete' ? [] : diff(x.before, after);
    modal({
      title: `${ACT[x.act][0]}: ${DOC_TYPES[x.type]?.name || ''} ${docNo({ type: x.type, no: x.no }, s)}`,
      wide: true,
      body: html`<p class="muted small" style="margin-bottom:10px">${when(x.at)} · ${who(x.by)}</p>
        ${x.act === 'delete' ? html`<p>المستند المحذوف كان بتاريخ <b>${fmtDate(x.before.date)}</b> وبمبلغ <b>${money(totalOf(x.before), { sym: true })}</b>${x.before.party ? html` للطرف <b>${partyName(x.before.party, '')}</b>` : ''}.</p>`
          : changes.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>الحقل</th><th>قبل</th><th>بعد</th></tr></thead><tbody>${changes.map((c) => html`<tr><td>${c.label}</td><td>${c.a}</td><td><b>${c.b}</b></td></tr>`)}</tbody></table></div>
            <p class="muted small" style="margin-top:8px">المبلغ قبل: ${money(totalOf(x.before))} · بعد: ${money(totalOf(after))}</p>`
          : html`<p class="muted">لم تتغير الحقول الأساسية.</p>`}`,
    });
  });
}
