// ═══ الأصول الثابتة: السجل، جدول الإهلاك الشهري، والاستبعاد (بيع أو إتلاف) ═══
import * as store from '../store.js';
import { assetSchedule, assetAccum, descendantIds, num, round, isDate, isLockedDate, monthsBetween } from '../core.js';
import { html, raw, money, fmtDate, toast, confirmBox, modal, $, field, empty, showErrors, exportTable } from '../ui.js';
import { go, guard, setTitle, withQuery } from '../nav.js';
import { head, S, dec, today, accName, moneyOptions, csvName } from './common.js';

const fixedAccounts = () => {
  const ids = descendantIds(store.getDb(), 'g12');
  return store.getDb().accounts.filter((a) => ids.has(a.id) && !a.group && a.id !== 'accdep');
};
// العدد مع المعدود بالعربي: سنة، سنتان، 3 سنوات، 11 سنة
const count = (n, [one, two, few, many]) => (n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`);
const lifeText = (m) => { const y = Math.floor(m / 12), r = m % 12; return [y ? count(y, ['سنة', 'سنتان', 'سنوات', 'سنة']) : '', r ? count(r, ['شهر', 'شهران', 'أشهر', 'شهراً']) : ''].filter(Boolean).join(' و') || '—'; };
function info(a) {
  const s = S();
  const sc = store.getBooks().schedules.get(a.id) || assetSchedule(a, { startDate: s.startDate, dec: dec() });
  const acc = assetAccum(a, sc, today());
  const cost = num(a.cost);
  const disposed = a.disposed && isDate(a.disposed.date);
  const done = !disposed && round(cost - num(a.salvage) - acc, dec()) <= 0;
  return { sc, acc, nbv: round(cost - acc, dec()), disposed, done, state: disposed ? ['مستبعد', 'muted'] : done ? ['مستهلك بالكامل', 'info'] : ['قيد الاستخدام', 'ok'] };
}
// الأصل له قيود داخل فترة مقفلة: لا يُعدَّل ولا يُحذف
const lockedAsset = (a, sc) => {
  const s = S();
  if (!isDate(s.lockDate)) return false;
  return (sc.preStart && s.startDate <= s.lockDate) || sc.rows.some((r) => r.date <= s.lockDate && r.date <= today()) || (a.disposed && isLockedDate(s, a.disposed.date));
};

export function list({ root }) {
  setTitle('الأصول الثابتة');
  const rows = store.getDb().assets.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const infos = new Map(rows.map((a) => [a.id, info(a)]));
  const live = rows.filter((a) => !infos.get(a.id).disposed);
  const sum = (f) => live.reduce((t, a) => t + f(a), 0);
  root.innerHTML = String(html`${head('الأصول الثابتة', { sub: 'الأثاث والأجهزة والسيارات، وإهلاكها الشهري يُسجَّل تلقائياً', actions: html`<a class="btn btn-primary" href="#/assets/new">➕ أصل جديد</a>` })}
    ${rows.length ? html`<div class="grid g4" style="margin-bottom:14px">
      <div class="kpi"><span class="kpi-l">تكلفة الأصول</span><span class="kpi-v">${money(sum((a) => num(a.cost)), { sym: true })}</span><span class="kpi-s">${live.length} أصل</span></div>
      <div class="kpi"><span class="kpi-l">مجمع الإهلاك</span><span class="kpi-v">${money(sum((a) => infos.get(a.id).acc), { sym: true })}</span></div>
      <div class="kpi"><span class="kpi-l">القيمة الدفترية</span><span class="kpi-v">${money(sum((a) => infos.get(a.id).nbv), { sym: true })}</span></div>
      <div class="kpi"><span class="kpi-l">الإهلاك الشهري</span><span class="kpi-v">${money(sum((a) => (infos.get(a.id).done ? 0 : infos.get(a.id).sc.monthly)), { sym: true })}</span></div></div>
    <div class="toolbar"><span class="grow"></span><button class="btn btn-ghost btn-sm" data-csv>⬇️ Excel</button></div>
    <div class="tbl-wrap"><table class="tbl" data-table><thead><tr><th>الأصل</th><th class="hide-sm">الحساب</th><th class="hide-sm">تاريخ الاستخدام</th><th class="num">التكلفة</th><th class="hide-sm">العمر</th><th class="num">مجمع الإهلاك</th><th class="num">القيمة الدفترية</th><th>الحالة</th></tr></thead><tbody>
      ${rows.map((a) => { const x = infos.get(a.id); return html`<tr data-href="#/assets/${a.id}"><td><b>${a.name}</b></td><td class="hide-sm">${accName(a.account)}</td><td class="hide-sm">${fmtDate(a.date)}</td>
        <td class="num">${money(a.cost)}</td><td class="hide-sm">${lifeText(num(a.life))}</td><td class="num">${money(x.acc)}</td><td class="num"><b>${money(x.disposed ? 0 : x.nbv)}</b></td><td><span class="badge badge-${x.state[1]}">${x.state[0]}</span></td></tr>`; })}
    </tbody></table></div>`
    : empty('🏢', 'لا توجد أصول ثابتة', 'أضف الأثاث والأجهزة والسيارات بتكلفتها وعمرها، ويسجّل البرنامج إهلاكها كل شهر تلقائياً في قائمة الدخل والميزانية.', html`<a class="btn btn-primary" href="#/assets/new">➕ أصل جديد</a>`)}`);
  root.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-href]');
    if (tr) go(tr.dataset.href);
    if (e.target.closest('[data-csv]')) { const t = $('[data-table]', root); if (t) exportTable(t, csvName('الأصول الثابتة')); }
  });
}

export function form({ root, params }) {
  const s = S();
  const existing = params.id ? store.findAsset(params.id) : null;
  if (params.id && !existing) { root.innerHTML = String(empty('🔎', 'الأصل غير موجود')); return; }
  if (existing && lockedAsset(existing, info(existing).sc)) { setTitle(existing.name); root.innerHTML = String(empty('🔒', 'للأصل قيود في فترة مقفلة', 'لا يمكن تعديل تكلفته أو عمره. يمكنك استبعاده بتاريخ بعد القفل.', html`<a class="btn btn-ghost" href="#/assets/${existing.id}">العودة</a>`)); return; }
  const accs = fixedAccounts();
  const a = existing ? { ...existing } : { name: '', account: accs[0]?.id || 'equip', date: today(), cost: '', salvage: '', life: 60, priorDep: '', notes: '' };
  const title = existing ? `تعديل: ${existing.name}` : 'أصل ثابت جديد';
  setTitle(title);
  const years = Math.floor(num(a.life) / 12), months = num(a.life) % 12;
  const numAttrs = raw('type="text" inputmode="decimal" data-num autocomplete="off"');
  root.innerHTML = String(html`${head(title, { actions: html`<a class="btn btn-ghost" href="${existing ? '#/assets/' + existing.id : '#/assets'}">إلغاء</a>` })}
    <form novalidate data-form><div class="card"><div class="form-grid">
      <div class="span2">${field('اسم الأصل', html`<input class="inp" name="name" data-f="name" value="${a.name}" placeholder="مثال: سيارة توصيل هايلكس 2025" autofocus>`)}<small class="fld-e" data-err="name" hidden></small></div>
      ${field('الحساب', html`<select class="inp" name="account">${accs.map((x) => html`<option value="${x.id}" ${x.id === a.account ? raw('selected') : ''}>${x.name}</option>`)}</select>`, { hint: 'لإضافة نوع جديد: دليل الحسابات ← تحت «الأصول الثابتة»' })}
      <div>${field('تاريخ بدء الاستخدام', html`<input class="inp" type="date" name="date" data-f="date" value="${a.date}">`)}<small class="fld-e" data-err="date" hidden></small></div>
      <div>${field('التكلفة', html`<input class="inp" name="cost" data-f="cost" ${numAttrs} value="${a.cost}">`)}<small class="fld-e" data-err="cost" hidden></small></div>
      <div>${field('القيمة المتبقية في آخر العمر', html`<input class="inp" name="salvage" data-f="salvage" ${numAttrs} value="${a.salvage}" placeholder="0">`, { hint: 'الخردة المتوقعة، غالباً صفر' })}<small class="fld-e" data-err="salvage" hidden></small></div>
      <div class="fld"><span class="fld-l">العمر الإنتاجي</span><div class="inline"><input class="inp" name="years" ${numAttrs} value="${years}" aria-label="سنوات"><span class="muted small">سنة</span><input class="inp" name="months" ${numAttrs} value="${months}" aria-label="أشهر"><span class="muted small">شهر</span></div>
        <small class="fld-h">مثال: أجهزة 3–5 سنوات، أثاث 5–10، سيارات 4–5</small><small class="fld-e" data-err="life" hidden></small></div>
      <div data-prior-box>${field('الإهلاك المتراكم حتى بداية التشغيل', html`<input class="inp" name="priorDep" data-f="priorDep" ${numAttrs} value="${a.priorDep}" placeholder="0">`)}<small class="fld-e" data-err="priorDep" hidden></small></div>
      <div class="span-all">${field('ملاحظات', html`<input class="inp" name="notes" value="${a.notes || ''}" placeholder="الرقم التسلسلي، الموقع، المورد…">`)}</div>
    </div>
    <p class="note note-info" style="margin-top:12px" data-hint></p></div>
    <div class="form-actions sticky-actions"><button class="btn btn-primary">💾 حفظ</button></div></form>`);
  const f = $('[data-form]', root);
  const sync = () => {
    const pre = isDate(s.startDate) && f.date.value && f.date.value < s.startDate;
    $('[data-prior-box]', root).hidden = !pre;
    const life = Math.round(num(f.years.value) * 12 + num(f.months.value));
    const monthly = life > 0 && num(f.cost.value) > 0 ? (num(f.cost.value) - num(f.salvage.value) - (pre ? num(f.priorDep.value) : 0)) / Math.max(1, life - (pre ? monthsBetween(f.date.value.slice(0, 8) + '01', s.startDate.slice(0, 8) + '01') : 0)) : 0;
    $('[data-hint]', root).innerHTML = String(pre
      ? html`هذا الأصل قائم قبل بداية التشغيل (${fmtDate(s.startDate)}): تُضاف تكلفته ومجمع إهلاكه إلى القيد الافتتاحي تلقائياً، فلا تكتبهما كرصيد افتتاحي في دليل الحسابات.${monthly > 0 ? html` الإهلاك الشهري: <b>${money(monthly, { sym: true })}</b>` : ''}`
      : html`سجّل شراء الأصل نفسه كمصروف على حساب «${accName(f.account.value)}» (يظهر لك رابط بعد الحفظ). ${monthly > 0 ? html`الإهلاك الشهري: <b>${money(monthly, { sym: true })}</b> يُسجَّل بنهاية كل شهر.` : ''}`);
  };
  f.addEventListener('input', () => { guard.dirty = true; sync(); });
  f.addEventListener('change', sync);
  sync();
  f.onsubmit = (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    const life = Math.round(num(v.years) * 12 + num(v.months));
    const pre = isDate(s.startDate) && v.date < s.startDate;
    const out = { ...a, name: String(v.name || '').trim(), account: v.account, date: v.date, cost: round(num(v.cost), dec()), salvage: round(num(v.salvage), dec()), life, priorDep: pre ? round(num(v.priorDep), dec()) : 0, notes: String(v.notes || '').trim() };
    const errs = {};
    if (!out.name) errs.name = 'اكتب اسم الأصل';
    if (!isDate(out.date)) errs.date = 'اختر التاريخ';
    else if (isLockedDate(s, out.date < s.startDate ? s.startDate : out.date) && !existing) errs.date = `الفترة مقفلة حتى ${fmtDate(s.lockDate)}`;
    if (!(out.cost > 0)) errs.cost = 'اكتب التكلفة';
    if (out.salvage < 0 || out.salvage >= out.cost) errs.salvage = 'القيمة المتبقية أقل من التكلفة';
    if (!(life >= 1)) errs.life = 'اكتب العمر بالسنوات أو الأشهر';
    if (out.priorDep < 0 || out.priorDep > out.cost - out.salvage) errs.priorDep = 'الإهلاك السابق أكبر من قيمة الأصل';
    if (!showErrors(root, errs)) return;
    const saved = store.saveAsset(out);
    guard.dirty = false;
    toast('تم الحفظ ✓');
    go(existing || pre ? `#/assets/${saved.id}` : withQuery(`assets/${saved.id}`, { buy: 1 }));
  };
}

export function show({ root, params, query }) {
  const a = store.findAsset(params.id);
  if (!a) { setTitle('الأصول الثابتة'); root.innerHTML = String(empty('🔎', 'الأصل غير موجود', '', html`<a class="btn btn-ghost" href="#/assets">العودة</a>`)); return; }
  setTitle(a.name);
  const x = info(a);
  const t = today();
  const locked = lockedAsset(a, x.sc);
  const gl = x.disposed ? round(num(a.disposed.proceeds) + x.acc - num(a.cost), dec()) : 0;
  const bought = store.getDb().docs.some((d) => d.type === 'expense' && d.account === a.account && Math.abs(num(d.amount) - num(a.cost)) < 1);
  root.innerHTML = String(html`${head(a.name, { sub: `${accName(a.account)} · منذ ${fmtDate(a.date)} · العمر ${lifeText(num(a.life))}`,
    actions: html`${x.disposed ? (locked ? '' : html`<button class="btn btn-ghost" data-undo>↶ إلغاء الاستبعاد</button>`) : html`<button class="btn btn-ghost" data-dispose>📤 بيع أو استبعاد</button>`}
      ${locked ? '' : html`<a class="btn btn-ghost" href="#/assets/${a.id}/edit">✏️ تعديل</a><button class="btn btn-text-danger" data-del>🗑️ حذف</button>`}` })}
    ${query.buy && !x.sc.preStart && !bought ? html`<p class="note note-info" style="margin-bottom:12px">الخطوة التالية: <a href="#/expenses/new?account=${a.account}&amount=${a.cost}&notes=${encodeURIComponent('شراء ' + a.name)}">سجّل شراء الأصل كمصروف</a> (من الصندوق أو البنك أو آجل على المورد) حتى تظهر تكلفته في الحسابات.</p>` : ''}
    ${locked ? html`<p class="note note-warn" style="margin-bottom:12px">🔒 للأصل قيود إهلاك في فترة مقفلة، فلا يمكن تعديله أو حذفه.</p>` : ''}
    <div class="grid g4" style="margin-bottom:14px">
      <div class="kpi"><span class="kpi-l">التكلفة</span><span class="kpi-v">${money(a.cost, { sym: true })}</span></div>
      <div class="kpi"><span class="kpi-l">مجمع الإهلاك</span><span class="kpi-v">${money(x.acc, { sym: true })}</span>${x.sc.prior ? html`<span class="kpi-s">منها ${money(x.sc.prior)} قبل التشغيل</span>` : ''}</div>
      <div class="kpi"><span class="kpi-l">القيمة الدفترية</span><span class="kpi-v">${money(x.disposed ? 0 : x.nbv, { sym: true })}</span></div>
      <div class="kpi"><span class="kpi-l">الحالة</span><span class="kpi-v"><span class="badge badge-${x.state[1]}">${x.state[0]}</span></span>${x.done || x.disposed ? '' : html`<span class="kpi-s">${money(x.sc.monthly)} شهرياً</span>`}</div>
    </div>
    ${x.disposed ? html`<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>الاستبعاد</h3></div><div class="list-mini">
      <div class="it"><span>التاريخ</span><b>${fmtDate(a.disposed.date)}</b></div>
      <div class="it"><span>قيمة البيع</span><b>${money(a.disposed.proceeds || 0)} ${num(a.disposed.proceeds) ? `(${accName(a.disposed.money)})` : ''}</b></div>
      <div class="it"><span>${gl >= 0 ? 'ربح الاستبعاد' : 'خسارة الاستبعاد'}</span><b class="${gl < 0 ? 'neg' : 'pos'}">${money(Math.abs(gl))}</b></div></div></div>` : ''}
    <div class="card"><div class="card-h"><h3>جدول الإهلاك</h3><button class="btn btn-ghost btn-sm" data-csv>⬇️ Excel</button></div>
      ${x.sc.rows.length ? html`<div class="tbl-wrap"><table class="tbl" data-table><thead><tr><th>الشهر</th><th class="num">الإهلاك</th><th class="num">المتراكم</th><th class="num">القيمة الدفترية</th><th></th></tr></thead><tbody>
        ${x.sc.prior ? html`<tr class="grp"><td>قبل بداية التشغيل</td><td class="num">${money(x.sc.prior)}</td><td class="num">${money(x.sc.prior)}</td><td class="num">${money(num(a.cost) - x.sc.prior)}</td><td></td></tr>` : ''}
        ${x.sc.rows.map((r, i) => { const cut = x.disposed && r.date >= a.disposed.date; const posted = !cut && r.date <= t;
          if (cut) return '';
          const later = !posted && x.sc.rows.slice(0, i).filter((y) => y.date > t).length >= 12;
          return html`<tr class="${cut ? 'sub-row' : ''}" ${later ? raw('data-later hidden') : ''}><td class="nowrap">${r.month}</td><td class="num">${cut ? '—' : money(r.amount)}</td><td class="num">${cut ? '' : money(r.acc)}</td><td class="num">${cut ? '' : money(r.nbv)}</td><td>${cut ? html`<span class="muted small">بعد الاستبعاد</span>` : posted ? html`<span class="badge badge-ok">مسجّل</span>` : html`<span class="muted small">قادم</span>`}</td></tr>`; })}
      </tbody></table></div>${!x.disposed && x.sc.rows.filter((r) => r.date > t).length > 12 ? html`<p style="text-align:center;margin-top:10px"><button class="btn btn-ghost btn-sm" data-all>عرض الجدول كاملاً (${x.sc.rows.length} شهراً)</button></p>` : ''}` : html`<p class="muted">لا يوجد إهلاك: التكلفة مستهلكة بالكامل أو العمر منتهٍ.</p>`}</div>
    ${a.notes ? html`<p class="muted small" style="margin-top:10px">${a.notes}</p>` : ''}`);

  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-all]')) { root.querySelectorAll('[data-later]').forEach((r) => { r.hidden = false; }); e.target.closest('p').remove(); }
    if (e.target.closest('[data-csv]')) { const tb = $('[data-table]', root); if (tb) { root.querySelectorAll('[data-later]').forEach((r) => { r.hidden = false; }); exportTable(tb, csvName('إهلاك ' + a.name)); } }
    if (e.target.closest('[data-del]')) {
      if (!(await confirmBox(`حذف «${a.name}» من سجل الأصول؟ تُحذف قيود إهلاكه أيضاً (ولا يُحذف مصروف شرائه).`, { ok: 'حذف', danger: true }))) return;
      store.deleteAsset(a.id); toast('تم الحذف'); go('#/assets');
    }
    if (e.target.closest('[data-undo]')) {
      if (!(await confirmBox('إلغاء الاستبعاد وإعادة الأصل للاستخدام؟', { ok: 'إلغاء الاستبعاد' }))) return;
      store.saveAsset({ id: a.id, disposed: null }); toast('تم ✓'); go('#/assets/' + a.id);
    }
    if (e.target.closest('[data-dispose]')) dispose(a, x);
  });
}

function dispose(a, x) {
  const s = S();
  modal({
    title: `بيع أو استبعاد: ${a.name}`,
    body: html`<form class="form-grid" novalidate>
      <div>${field('التاريخ', html`<input class="inp" type="date" name="date" data-f="date" value="${today()}">`)}<small class="fld-e" data-err="date" hidden></small></div>
      ${field('قيمة البيع (صفر للإتلاف)', html`<input class="inp" name="proceeds" type="text" inputmode="decimal" data-num placeholder="0">`)}
      ${field('استُلم المبلغ في', html`<select class="inp" name="money">${moneyOptions('cash')}</select>`)}
      <p class="muted small span-all">القيمة الدفترية الحالية ${money(x.nbv, { sym: true })}. الفرق بينها وبين قيمة البيع يُسجَّل ربحاً أو خسارة، ويتوقف الإهلاك من شهر الاستبعاد.</p>
      <div class="dlg-actions span-all"><button class="btn btn-primary">تأكيد الاستبعاد</button><button type="button" class="btn btn-ghost" data-no>إلغاء</button></div></form>`,
    onMount: (dlg, done) => {
      const f = $('form', dlg);
      $('[data-no]', dlg).onclick = () => done(null);
      f.onsubmit = (e) => {
        e.preventDefault();
        const date = f.date.value;
        const err = !isDate(date) ? 'اختر التاريخ' : date < a.date ? 'قبل تاريخ بدء الاستخدام' : isLockedDate(s, date) ? `الفترة مقفلة حتى ${fmtDate(s.lockDate)}` : '';
        if (!showErrors(f, err ? { date: err } : {})) return;
        store.saveAsset({ id: a.id, disposed: { date, proceeds: round(num(f.proceeds.value), dec()), money: f.money.value } });
        done(true);
      };
    },
  }).then((ok) => { if (ok) { toast('تم تسجيل الاستبعاد ✓'); go('#/assets/' + a.id); } });
}
