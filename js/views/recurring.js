// ═══ المستندات المتكررة: فواتير ومصروفات وقيود تُنشأ تلقائياً كل أسبوع أو شهر أو ربع أو سنة ═══
import * as store from '../store.js';
import { DOC_TYPES, docNo, docAmount, daysBetween, isDate } from '../core.js';
import { html, raw, money, fmtDate, toast, confirmBox, modal, $, field, empty, showErrors } from '../ui.js';
import { go, setTitle, docHref } from '../nav.js';
import { head, S, dec, today, partyName, accName } from './common.js';

export const FREQ = { week: 'كل أسبوع', month: 'كل شهر', quarter: 'كل 3 أشهر', year: 'كل سنة' };
const describe = (src) => {
  const who = src.party ? partyName(src.party) : src.type === 'expense' ? (src.payee || accName(src.account)) : src.type === 'transfer' ? `${accName(src.from)} ← ${accName(src.to)}` : src.account ? accName(src.account) : '';
  return [DOC_TYPES[src.type]?.name, who].filter(Boolean).join(' — ');
};

// نافذة «تكرار» من صفحة أي مستند
export function repeatDialog(doc) {
  const first = store.nextRun(doc.date, 'month', Number(doc.date.slice(8)));
  return modal({
    title: '♻️ تكرار هذا المستند',
    body: html`<form class="form-grid" novalidate>
      <div class="span-all">${field('الاسم', html`<input class="inp" name="name" data-f="name" value="${doc.notes ? doc.notes.slice(0, 60) : describe(doc)}" autofocus>`)}<small class="fld-e" data-err="name" hidden></small></div>
      ${field('التكرار', html`<select class="inp" name="freq">${Object.entries(FREQ).map(([k, v]) => html`<option value="${k}" ${k === 'month' ? raw('selected') : ''}>${v}</option>`)}</select>`)}
      <div>${field('أول مستند جديد بتاريخ', html`<input class="inp" type="date" name="next" data-f="next" value="${first}">`)}<small class="fld-e" data-err="next" hidden></small></div>
      ${field('حتى تاريخ (اختياري)', html`<input class="inp" type="date" name="until">`)}
      <p class="muted small span-all">يُنشئ البرنامج نسخة من هذا المستند في كل موعد عند فتحه، بنفس ${DOC_TYPES[doc.type]?.lines ? 'البنود والأسعار' : 'المبلغ والحسابات'}. يمكنك إيقافه أو تعديله من «المستندات المتكررة».</p>
      <div class="dlg-actions span-all"><button class="btn btn-primary">حفظ التكرار</button><button type="button" class="btn btn-ghost" data-no>إلغاء</button></div></form>`,
    onMount: (dlg, done) => {
      const f = $('form', dlg);
      $('[data-no]', dlg).onclick = () => done(null);
      f.onsubmit = (e) => {
        e.preventDefault();
        const errs = {};
        if (!f.name.value.trim()) errs.name = 'اكتب اسماً يميّزه';
        if (!isDate(f.next.value)) errs.next = 'اختر التاريخ';
        else if (f.until.value && f.until.value < f.next.value) errs.next = 'تاريخ النهاية قبل البداية';
        if (!showErrors(f, errs)) return;
        const src = store.templateOf(doc);
        const r = store.saveRecurring({
          name: f.name.value.trim(), src, freq: f.freq.value, next: f.next.value, until: f.until.value || '', day: Number(f.next.value.slice(8)), active: true,
          dueDays: doc.dueDate && isDate(doc.dueDate) ? daysBetween(doc.date, doc.dueDate) : '',
        });
        done(r);
      };
    },
  }).then((r) => {
    if (!r) return;
    const res = store.runRecurring(today(), { only: r.id });
    toast(res.created.length ? `تم الحفظ ✓ وأُنشئ ${res.created.length} مستند مستحق` : `تم الحفظ ✓ أول مستند في ${fmtDate(r.next)}`);
  });
}

export function view({ root }) {
  setTitle('المستندات المتكررة');
  const db = store.getDb();
  const s = S();
  const rows = db.recurring.slice().sort((a, b) => (a.active === false) - (b.active === false) || String(a.next).localeCompare(String(b.next)));
  root.innerHTML = String(html`${head('المستندات المتكررة', { sub: 'الإيجار والاشتراكات والأقساط والفواتير الشهرية تُنشأ تلقائياً في موعدها' })}
    ${rows.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>الاسم</th><th class="hide-sm">المستند</th><th class="num">المبلغ</th><th>التكرار</th><th>القادم</th><th class="num hide-sm">أُنشئ</th><th></th></tr></thead><tbody>
      ${rows.map((r) => { const last = db.docs.filter((d) => d.recurring === r.id).pop();
        return html`<tr><td><b>${r.name}</b>${r.active === false ? html` <span class="badge badge-muted">متوقف</span>` : ''}${r.error ? html`<div class="neg small">⚠️ ${r.error}</div>` : ''}</td>
        <td class="hide-sm">${describe(r.src)}</td><td class="num">${money(docAmount(r.src, dec()))}</td><td>${FREQ[r.freq] || r.freq}</td>
        <td class="nowrap">${r.active === false ? '—' : fmtDate(r.next)}${r.until ? html`<div class="muted small">حتى ${fmtDate(r.until)}</div>` : ''}</td>
        <td class="num hide-sm">${r.count || 0}${last ? html` <a class="small" href="${docHref(last)}">آخرها ${docNo(last, s)}</a>` : ''}</td>
        <td class="num"><span class="inline" style="justify-content:flex-end">
          ${r.active === false ? html`<button class="btn btn-ghost btn-sm" data-on="${r.id}">▶️ تشغيل</button>` : html`<button class="btn btn-ghost btn-sm" data-now="${r.id}">⚡ أنشئ التالي الآن</button><button class="btn btn-ghost btn-sm" data-off="${r.id}">⏸ إيقاف</button>`}
          <button class="btn btn-ghost btn-sm" data-edit="${r.id}">✏️</button><button class="icon-btn" data-del="${r.id}" aria-label="حذف">🗑️</button></span></td></tr>`; })}
    </tbody></table></div>`
    : empty('♻️', 'لا توجد مستندات متكررة', 'افتح أي فاتورة أو مصروف أو قيد واضغط «♻️ تكرار» ليتكرر تلقائياً كل شهر مثلاً.', html`<a class="btn btn-primary" href="#/expenses">💸 المصروفات</a>`)}`);

  root.addEventListener('click', async (e) => {
    const id = (k) => e.target.closest(`[data-${k}]`)?.dataset[k];
    if (id('off')) { store.saveRecurring({ id: id('off'), active: false }); go('#/recurring'); }
    else if (id('on')) {
      const r = store.findRecurring(id('on'));
      // عند التشغيل من جديد لا نُنشئ المواعيد الفائتة كلها: يبدأ من اليوم فصاعداً
      let next = r.next;
      while (next < today()) next = store.nextRun(next, r.freq, r.day);
      store.saveRecurring({ id: r.id, active: true, next, error: '', until: r.until && r.until < next ? '' : r.until });
      go('#/recurring');
    } else if (id('now')) {
      const r = store.findRecurring(id('now'));
      if (!(await confirmBox(`إنشاء المستند التالي من «${r.name}» الآن بتاريخ ${fmtDate(r.next)}؟`, { ok: 'إنشاء الآن' }))) return;
      const res = store.runRecurring(r.next, { only: r.id });
      if (res.errors.length) toast(res.errors[0].msg, 'err');
      else { toast('تم الإنشاء ✓'); go(docHref(res.created[0])); }
    } else if (id('edit')) editDialog(store.findRecurring(id('edit')));
    else if (id('del')) {
      const r = store.findRecurring(id('del'));
      if (await confirmBox(`حذف التكرار «${r.name}»؟ المستندات التي أُنشئت سابقاً تبقى كما هي.`, { ok: 'حذف', danger: true })) { store.deleteRecurring(r.id); go('#/recurring'); }
    }
  });
}

function editDialog(r) {
  modal({
    title: `تعديل: ${r.name}`,
    body: html`<form class="form-grid" novalidate>
      <div class="span-all">${field('الاسم', html`<input class="inp" name="name" value="${r.name}">`)}</div>
      ${field('التكرار', html`<select class="inp" name="freq">${Object.entries(FREQ).map(([k, v]) => html`<option value="${k}" ${k === r.freq ? raw('selected') : ''}>${v}</option>`)}</select>`)}
      ${field('الموعد القادم', html`<input class="inp" type="date" name="next" value="${r.next}">`)}
      ${field('حتى تاريخ (اختياري)', html`<input class="inp" type="date" name="until" value="${r.until || ''}">`)}
      ${field('المبلغ الجديد (اختياري)', html`<input class="inp" name="amount" type="text" inputmode="decimal" data-num placeholder="${docAmount(r.src, dec())}">`, { hint: r.src.lines ? 'للفواتير: يُعدَّل سعر البند الأول' : '' })}
      <div class="dlg-actions span-all"><button class="btn btn-primary">حفظ</button><button type="button" class="btn btn-ghost" data-no>إلغاء</button></div></form>`,
    onMount: (dlg, done) => {
      const f = $('form', dlg);
      $('[data-no]', dlg).onclick = () => done(null);
      f.onsubmit = (e) => {
        e.preventDefault();
        if (!isDate(f.next.value)) return;
        const src = JSON.parse(JSON.stringify(r.src));
        const amt = f.amount.value.trim();
        if (amt) {
          if (src.lines && src.lines.length) src.lines[0].price = Number(amt.replace(/,/g, '')) || src.lines[0].price;
          else if ('amount' in src) src.amount = Number(amt.replace(/,/g, '')) || src.amount;
          if (src.paid && src.payAcc) delete src.paid;
        }
        store.saveRecurring({ id: r.id, name: f.name.value.trim() || r.name, freq: f.freq.value, next: f.next.value, until: f.until.value || '', day: Number(f.next.value.slice(8)), src, error: '' });
        done(true);
      };
    },
  }).then((ok) => { if (ok) { toast('تم الحفظ ✓'); go('#/recurring'); } });
}

