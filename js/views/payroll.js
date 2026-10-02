// ═══ الموظفون ومسيرات الرواتب: التأمينات، السلف، قسائم الراتب، ملف البنك، ومكافأة نهاية الخدمة ═══
import * as store from '../store.js';
import { docNo, num, round, isDate, validateDoc, payrollRates, gosiFor, payLine, payrollTotals, eosAward, employeeAdvances, monthEnd, addMonths, balances, tafqeet, daysBetween } from '../core.js';
import { html, raw, money, fmtDate, toast, confirmBox, modal, $, field, empty, showErrors, exportTable, download, MONTHS } from '../ui.js';
import { go, guard, setTitle, docHref } from '../nav.js';
import { head, bindRows, S, dec, today, moneyOptions, moneyList, accName, printPaper, entryTable, csvName, docLocked, lockedNote, lockedPage, countAr, YEARS, MONTHS_N, ssName, ssWord, ssShort } from './common.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const monthLabel = (p) => (p ? `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}` : '');
const natLabels = () => (S().country === 'SA' ? ['سعودي', 'غير سعودي'] : S().country === 'JO' ? ['أردني', 'غير أردني'] : ['مواطن', 'وافد']);
const fixedPay = (e) => round(num(e.basic) + num(e.housing) + num(e.transport) + num(e.other), dec());
const serviceText = (from, to) => {
  if (!isDate(from)) return '—';
  const d = Math.max(0, daysBetween(from, to));
  const y = Math.floor(d / 365), m = Math.floor((d % 365) / 30.42);
  return [y ? countAr(y, YEARS) : '', m ? countAr(m, MONTHS_N) : ''].filter(Boolean).join(' و') || 'أقل من شهر';
};
const centerName = (id) => store.getDb().centers.find((c) => c.id === id)?.name || '';

// ═══ الموظفون ═══
export function employees({ root }) {
  setTitle('الموظفون');
  const db = store.getDb();
  const s = S();
  const rates = payrollRates(s);
  const adv = employeeAdvances(db);
  const list = db.employees.slice().sort((a, b) => (a.active === false) - (b.active === false) || a.name.localeCompare(b.name, 'ar'));
  const active = list.filter((e) => e.active !== false && !(e.leaveDate && e.leaveDate < today()));
  const t = today();
  const eos = round(active.reduce((x, e) => x + eosAward(e, { to: t, country: s.country, dec: dec() }).full, 0), dec());
  const booked = round(-((balances(store.getBooks(), { to: t }).get('eos_pay') || { close: 0 }).close), dec());
  const monthly = round(active.reduce((x, e) => x + fixedPay(e), 0), dec());
  const gosiCo = round(active.reduce((x, e) => x + gosiFor(e, rates, dec()).gosiCo, 0), dec());
  root.innerHTML = String(html`${head('الموظفون', { sub: `${active.length} موظف على رأس العمل`, actions: html`<a class="btn btn-ghost" href="#/payroll">💼 مسيرات الرواتب</a><a class="btn btn-primary" href="#/employees/new">➕ موظف جديد</a>` })}
    ${list.length ? html`<div class="grid g4" style="margin-bottom:14px">
      <div class="kpi"><span class="kpi-l">الرواتب الشهرية</span><span class="kpi-v">${money(monthly, { sym: true })}</span><span class="kpi-s">الأساسي والبدلات الثابتة</span></div>
      <div class="kpi"><span class="kpi-l">${ssWord()} على المنشأة شهرياً</span><span class="kpi-v">${money(gosiCo, { sym: true })}</span></div>
      <div class="kpi"><span class="kpi-l">مكافأة نهاية الخدمة المستحقة</span><span class="kpi-v">${money(eos, { sym: true })}</span><span class="kpi-s">المسجّل في الحسابات ${money(booked)}</span></div>
      <div class="kpi"><span class="kpi-l">السلف القائمة</span><span class="kpi-v">${money([...adv.values()].reduce((x, v) => x + Math.max(0, v), 0), { sym: true })}</span></div></div>
    ${Math.abs(eos - booked) >= 1 ? html`<p class="note note-info" style="margin-bottom:12px">مخصص نهاية الخدمة المسجل يختلف عن المستحق بـ ${money(eos - booked, { sym: true })}. <button class="btn btn-ghost btn-sm" data-eos>📒 تسجيل الفرق بقيد</button></p>` : ''}
    <div class="toolbar"><span class="grow"></span><button class="btn btn-ghost btn-sm" data-csv>⬇️ Excel</button></div>
    <div class="tbl-wrap"><table class="tbl" data-table><thead><tr><th>الموظف</th><th class="hide-sm">الوظيفة</th>${db.centers.length ? html`<th class="hide-sm">الفرع</th>` : ''}<th class="num">الراتب</th><th class="num hide-sm">${ssWord()} (موظف/منشأة)</th><th class="num hide-sm">السلف</th><th class="hide-sm">الخدمة</th></tr></thead><tbody>
      ${list.map((e) => { const g = gosiFor(e, rates, dec()); return html`<tr data-href="#/employees/${e.id}"><td><b>${e.name}</b>${e.active === false || (e.leaveDate && e.leaveDate < t) ? html` <span class="badge badge-muted">منتهية خدمته</span>` : ''}<div class="muted small">${e.nationality === 'expat' ? natLabels()[1] : natLabels()[0]}</div></td>
        <td class="hide-sm">${e.job || ''}</td>${db.centers.length ? html`<td class="hide-sm">${centerName(e.cc)}</td>` : ''}<td class="num">${money(fixedPay(e))}</td>
        <td class="num hide-sm">${money(g.gosiEmp)} / ${money(g.gosiCo)}</td><td class="num hide-sm">${adv.get(e.id) ? money(adv.get(e.id)) : '—'}</td><td class="hide-sm">${serviceText(e.joinDate, e.leaveDate || t)}</td></tr>`; })}
    </tbody></table></div>`
    : empty('👷', 'لا يوجد موظفون', `أضف موظفيك برواتبهم وبدلاتهم، ثم أنشئ مسير الرواتب الشهري بكبسة: يحسب ${ssWord()} والسلف والصافي ويسجل القيد.`, html`<a class="btn btn-primary" href="#/employees/new">➕ موظف جديد</a>`)}
    <p class="muted small" style="margin-top:12px">نسب ${ssWord()} من <a href="#/settings">الإعدادات</a> ← الرواتب و${ssName()}. تأكد دائماً من النسب الحالية لدى الجهة الرسمية.</p>`);
  bindRows(root);
  const csv = $('[data-csv]', root);
  if (csv) csv.onclick = () => exportTable($('[data-table]', root), csvName('الموظفون'));
  const eb = $('[data-eos]', root);
  if (eb) eb.onclick = async () => {
    const diff = round(eos - booked, dec());
    if (!(await confirmBox(`تسجيل قيد بتاريخ اليوم: ${diff > 0 ? 'زيادة' : 'تخفيض'} مخصص نهاية الخدمة بـ ${money(Math.abs(diff), { sym: true })}؟`, { ok: 'تسجيل القيد' }))) return;
    const lines = diff > 0 ? [{ account: 'e_eos', dr: diff, cr: 0 }, { account: 'eos_pay', dr: 0, cr: diff }] : [{ account: 'eos_pay', dr: -diff, cr: 0 }, { account: 'e_eos', dr: 0, cr: -diff }];
    const doc = { type: 'journal', date: t, notes: 'تسوية مخصص مكافأة نهاية الخدمة', lines };
    const errs = validateDoc(store.getDb(), doc);
    if (Object.keys(errs).length) { toast(Object.values(errs)[0], 'err'); return; }
    store.saveDoc(doc);
    toast('تم تسجيل القيد ✓');
    go(docHref(doc));
  };
}

export function employeeForm({ root, params }) {
  const db = store.getDb();
  const existing = params.id ? store.findEmployee(params.id) : null;
  if (params.id && !existing) { root.innerHTML = String(empty('🔎', 'الموظف غير موجود')); return; }
  const e = existing ? { ...existing } : { name: '', nationalId: '', nationality: 'citizen', job: '', phone: '', joinDate: today(), leaveDate: '', basic: '', housing: '', transport: '', other: '', gosi: true, cc: '', bank: '', iban: '', active: true, notes: '' };
  const title = existing ? `تعديل: ${existing.name}` : 'موظف جديد';
  setTitle(title);
  const [nat1, nat2] = natLabels();
  const na = raw('type="text" inputmode="decimal" data-num autocomplete="off"');
  root.innerHTML = String(html`${head(title, { actions: html`<a class="btn btn-ghost" href="${existing ? '#/employees/' + existing.id : '#/employees'}">إلغاء</a>` })}
    <form novalidate data-form>
      <div class="card"><div class="form-grid">
        <div class="span2">${field('الاسم', html`<input class="inp" name="name" data-f="name" value="${e.name}" autofocus>`)}</div>
        ${field('الجنسية', html`<select class="inp" name="nationality"><option value="citizen" ${e.nationality !== 'expat' ? raw('selected') : ''}>${nat1}</option><option value="expat" ${e.nationality === 'expat' ? raw('selected') : ''}>${nat2}</option></select>`)}
        ${field('رقم الهوية / الإقامة', html`<input class="inp" name="nationalId" value="${e.nationalId || ''}" dir="ltr" inputmode="numeric">`)}
        ${field('الوظيفة', html`<input class="inp" name="job" value="${e.job || ''}" placeholder="مثال: بائع، محاسب، فني">`)}
        ${field('الجوال', html`<input class="inp" name="phone" value="${e.phone || ''}" dir="ltr" inputmode="tel">`)}
        ${field('تاريخ المباشرة', html`<input class="inp" type="date" name="joinDate" data-f="joinDate" value="${e.joinDate || ''}">`)}
        ${field('تاريخ انتهاء الخدمة', html`<input class="inp" type="date" name="leaveDate" data-f="leaveDate" value="${e.leaveDate || ''}">`, { hint: 'اتركه فارغاً ما دام على رأس العمل' })}
        ${db.centers.length ? field('الفرع / مركز التكلفة', html`<select class="inp" name="cc"><option value="">— بدون —</option>${db.centers.map((c) => html`<option value="${c.id}" ${c.id === e.cc ? raw('selected') : ''}>${c.name}</option>`)}</select>`) : ''}
      </div></div>
      <div class="card"><div class="card-h"><h3>💰 الراتب الشهري</h3><span class="muted small" data-total></span></div><div class="form-grid">
        ${field('الراتب الأساسي', html`<input class="inp" name="basic" data-f="basic" ${na} value="${e.basic}">`)}
        ${field('بدل السكن', html`<input class="inp" name="housing" ${na} value="${e.housing}">`)}
        ${field('بدل النقل', html`<input class="inp" name="transport" ${na} value="${e.transport}">`)}
        ${field('بدلات أخرى ثابتة', html`<input class="inp" name="other" ${na} value="${e.other}">`)}
        <label class="check span-all"><input type="checkbox" name="gosi" ${e.gosi !== false ? raw('checked') : ''}> مشترك في ${ssName()} <span class="muted small" data-gosi></span></label>
      </div></div>
      <div class="card"><div class="card-h"><h3>🏦 الحساب البنكي (لملف تحويل الرواتب)</h3></div><div class="form-grid">
        ${field('البنك', html`<input class="inp" name="bank" value="${e.bank || ''}">`)}
        <div class="span2">${field('رقم الآيبان', html`<input class="inp" name="iban" data-f="iban" value="${e.iban || ''}" dir="ltr" placeholder="${S().country === 'JO' ? 'JO00ABCD0000000000000000000000' : 'SA0000000000000000000000'}">`)}</div>
      </div></div>
      <div class="card"><label class="check"><input type="checkbox" name="active" ${e.active !== false ? raw('checked') : ''}> نشط (يظهر في مسيرات الرواتب)</label>
        <div style="margin-top:10px">${field('ملاحظات', html`<textarea class="inp" name="notes" rows="2">${e.notes || ''}</textarea>`)}</div></div>
      <div class="form-actions sticky-actions"><button class="btn btn-primary">💾 حفظ</button></div>
    </form>`);
  const f = $('[data-form]', root);
  const calc = () => {
    const x = { basic: f.basic.value, housing: f.housing.value, transport: f.transport.value, other: f.other.value, nationality: f.nationality.value, gosi: f.gosi.checked };
    $('[data-total]', root).innerHTML = String(html`الإجمالي ${money(fixedPay(x))}`);
    const g = gosiFor(x, payrollRates(S()), dec());
    $('[data-gosi]', root).innerHTML = x.gosi ? String(html`(على الموظف ${money(g.gosiEmp)}، على المنشأة ${money(g.gosiCo)})`) : '';
  };
  f.addEventListener('input', () => { guard.dirty = true; calc(); });
  f.addEventListener('change', calc);
  calc();
  f.onsubmit = (ev) => {
    ev.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    const errs = {};
    if (!String(v.name || '').trim()) errs.name = 'اكتب اسم الموظف';
    if (!isDate(v.joinDate)) errs.joinDate = 'اختر تاريخ المباشرة';
    if (v.leaveDate && (!isDate(v.leaveDate) || v.leaveDate < v.joinDate)) errs.leaveDate = 'تاريخ غير صحيح';
    if (!(num(v.basic) > 0)) errs.basic = 'اكتب الراتب الأساسي';
    const iban = String(v.iban || '').replace(/\s/g, '').toUpperCase();
    if (iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) errs.iban = 'رقم الآيبان غير صحيح';
    if (!showErrors(root, errs)) return;
    const out = { ...e, name: v.name.trim(), nationality: v.nationality, nationalId: (v.nationalId || '').trim(), job: (v.job || '').trim(), phone: (v.phone || '').trim(), joinDate: v.joinDate, leaveDate: v.leaveDate || '',
      basic: round(num(v.basic), dec()), housing: round(num(v.housing), dec()), transport: round(num(v.transport), dec()), other: round(num(v.other), dec()), gosi: f.gosi.checked, cc: v.cc || '', bank: (v.bank || '').trim(), iban, active: f.active.checked, notes: (v.notes || '').trim() };
    const saved = store.saveEmployee(out);
    guard.dirty = false;
    toast('تم الحفظ ✓');
    go('#/employees/' + saved.id);
  };
}

export function employeeShow({ root, params, query }) {
  const e = store.findEmployee(params.id);
  if (!e) { setTitle('الموظفون'); root.innerHTML = String(empty('🔎', 'الموظف غير موجود', '', html`<a class="btn btn-ghost" href="#/employees">العودة</a>`)); return; }
  setTitle(e.name);
  const db = store.getDb();
  const s = S();
  const t = today();
  const g = gosiFor(e, payrollRates(s), dec());
  const adv = employeeAdvances(db).get(e.id) || 0;
  const runs = db.docs.filter((d) => d.type === 'payroll' && (d.lines || []).some((l) => l.employee === e.id)).sort((a, b) => b.period.localeCompare(a.period));
  const advDocs = db.docs.filter((d) => d.employee === e.id && d.account === 'adv').sort((a, b) => b.date.localeCompare(a.date));
  const eosTo = query.to && isDate(query.to) ? query.to : e.leaveDate || t;
  const reason = ['resign', 'dismiss'].includes(query.reason) ? query.reason : 'end';
  const eos = eosAward(e, { to: eosTo, reason, country: s.country, dec: dec() });
  root.innerHTML = String(html`${head(e.name, { sub: [e.job, e.nationality === 'expat' ? natLabels()[1] : natLabels()[0], e.cc ? centerName(e.cc) : ''].filter(Boolean).join(' · '),
    actions: html`<button class="btn btn-primary" data-adv>💸 سلفة</button><a class="btn btn-ghost" href="#/employees/${e.id}/edit">✏️ تعديل</a><button class="btn btn-text-danger" data-del>🗑️ حذف</button>` })}
    <div class="grid g4" style="margin-bottom:14px">
      <div class="kpi"><span class="kpi-l">الراتب الشهري</span><span class="kpi-v">${money(fixedPay(e), { sym: true })}</span><span class="kpi-s">أساسي ${money(e.basic)}</span></div>
      <div class="kpi"><span class="kpi-l">${ssWord()} شهرياً</span><span class="kpi-v">${money(g.gosiEmp + g.gosiCo, { sym: true })}</span><span class="kpi-s">موظف ${money(g.gosiEmp)} · منشأة ${money(g.gosiCo)}</span></div>
      <div class="kpi"><span class="kpi-l">رصيد السلف</span><span class="kpi-v ${adv > 0 ? 'neg' : ''}">${money(adv, { sym: true })}</span></div>
      <div class="kpi"><span class="kpi-l">مدة الخدمة</span><span class="kpi-v" style="font-size:1.05rem">${serviceText(e.joinDate, e.leaveDate || t)}</span><span class="kpi-s">منذ ${fmtDate(e.joinDate)}</span></div>
    </div>
    <div class="card"><div class="card-h"><h3>🧮 مكافأة نهاية الخدمة</h3></div>
      <div class="toolbar"><label class="inline small"><span>حتى تاريخ</span><input class="inp" type="date" data-eos-to value="${eosTo}"></label>
        <select class="inp" data-eos-reason>${(s.country === 'JO' ? [['end', 'انتهاء الخدمة أو الاستقالة'], ['dismiss', 'فصل بموجب المادة 28']] : [['end', 'انتهاء العقد أو إنهاء من صاحب العمل'], ['resign', 'استقالة الموظف']]).map(([k, l]) => html`<option value="${k}" ${k === reason ? raw('selected') : ''}>${l}</option>`)}</select></div>
      <div class="grid g3"><div class="kpi"><span class="kpi-l">الأجر المعتمد</span><span class="kpi-v">${money(eos.wage)}</span><span class="kpi-s">${s.country === 'AE' ? 'الأجر الأساسي' : 'الأساسي والبدلات الثابتة'}</span></div>
        <div class="kpi"><span class="kpi-l">سنوات الخدمة</span><span class="kpi-v">${eos.years.toFixed(2)}</span></div>
        <div class="kpi"><span class="kpi-l">المكافأة</span><span class="kpi-v pos">${money(eos.amount, { sym: true })}</span>${eos.covered ? html`<span class="kpi-s">مشمول بـ${ssName()}</span>` : eos.share != null && eos.share < 1 ? html`<span class="kpi-s">${eos.share === 0 ? (s.country === 'JO' ? 'لا يستحق (المادة 28)' : 'لا يستحق (أقل من سنتين)') : `${eos.share === 1 / 3 ? 'ثلث' : 'ثلثا'} المكافأة الكاملة ${money(eos.full)}`}</span>` : ''}</div></div>
      <p class="muted small" style="margin-top:8px">${s.country === 'JO' ? 'حسب قانون العمل الأردني (المادة 32): لا يستحق الموظف المشمول بالضمان الاجتماعي مكافأة نهاية خدمة من صاحب العمل، ويستحق غير المشمول أجر شهر عن كل سنة خدمة وكسورها على أساس آخر أجر.' : s.country === 'AE' ? 'حسب قانون العمل الإماراتي: 21 يوماً عن كل سنة من أول خمس سنوات و30 يوماً لما بعدها، بحد أقصى أجر سنتين.' : 'حسب نظام العمل السعودي (المادتان 84 و85): نصف شهر عن كل سنة من أول خمس سنوات وشهر كامل لما بعدها، وتُخفض في الاستقالة.'} الحساب تقديري؛ راجع العقد والأنظمة المحدثة.</p></div>
    <div class="grid g2" style="margin-top:14px">
      <div class="card"><div class="card-h"><h3>💼 الرواتب</h3></div>${runs.length ? html`<div class="list-mini">${runs.slice(0, 12).map((d) => { const i = d.lines.findIndex((l) => l.employee === e.id); const x = payLine(d.lines[i], dec());
        return html`<a href="${docHref(d)}"><span>${monthLabel(d.period)} <span class="meta">${docNo(d, s)}</span></span><b>${money(x.net)}</b></a>`; })}</div>` : html`<p class="muted small">لا توجد مسيرات بعد.</p>`}</div>
      <div class="card"><div class="card-h"><h3>💸 السلف</h3></div>${advDocs.length ? html`<div class="list-mini">${advDocs.map((d) => html`<a href="${docHref(d)}"><span>${d.type === 'payment' ? 'سلفة' : 'سداد'} <span class="meta">${fmtDate(d.date)}</span></span><b>${money(d.amount)}</b></a>`)}</div>` : html`<p class="muted small">لا توجد سلف.</p>`}
        ${adv > 0 ? html`<p class="muted small" style="margin-top:8px">تُخصم من الراتب بكتابة المبلغ في عمود «السلفة» عند إنشاء المسير.</p>` : ''}</div>
    </div>`);
  const upd = () => go(`#/employees/${e.id}?to=${$('[data-eos-to]', root).value}&reason=${$('[data-eos-reason]', root).value}`);
  $('[data-eos-to]', root).onchange = upd;
  $('[data-eos-reason]', root).onchange = upd;
  $('[data-del]', root).onclick = async () => {
    if (!(await confirmBox(`حذف الموظف «${e.name}»؟`, { ok: 'حذف', danger: true }))) return;
    try { store.deleteEmployee(e.id); toast('تم الحذف'); go('#/employees'); } catch (err) { toast(err.message, 'err'); }
  };
  $('[data-adv]', root).onclick = () => modal({
    title: `سلفة للموظف ${e.name}`,
    body: html`<form class="form-grid" novalidate>
      <div>${field('المبلغ', html`<input class="inp" name="amount" data-f="amount" type="text" inputmode="decimal" data-num autofocus>`)}</div>
      <div>${field('التاريخ', html`<input class="inp" type="date" name="date" data-f="date" value="${t}">`)}</div>
      ${field('صُرفت من', html`<select class="inp" name="money">${moneyOptions(moneyList()[0]?.id)}</select>`)}
      <p class="muted small span-all">تُسجَّل على حساب «سلف الموظفين» وتُسترد من الراتب في المسيرات القادمة.</p>
      <div class="dlg-actions span-all"><button class="btn btn-primary">تسجيل السلفة</button></div></form>`,
    onMount: (dlg, done) => {
      const f = $('form', dlg);
      f.onsubmit = (ev) => {
        ev.preventDefault();
        const doc = { type: 'payment', date: f.date.value, party: null, account: 'adv', employee: e.id, amount: round(num(f.amount.value), dec()), money: f.money.value, method: 'cash', chequeNo: '', link: null, notes: `سلفة للموظف ${e.name}` };
        if (!showErrors(f, validateDoc(store.getDb(), doc))) return;
        store.saveDoc(doc);
        done(true);
      };
    },
  }).then((ok) => { if (ok) { toast('تم تسجيل السلفة ✓'); go('#/employees/' + e.id); } });
}

// ═══ مسيرات الرواتب ═══
export function list(type, { root }) {
  setTitle('مسيرات الرواتب');
  const db = store.getDb();
  const s = S();
  const rows = db.docs.filter((d) => d.type === 'payroll').sort((a, b) => b.period.localeCompare(a.period) || b.no - a.no);
  root.innerHTML = String(html`${head('مسيرات الرواتب', { sub: `رواتب كل شهر مع ${ssWord()} والسلف، وقيدها تلقائياً`, actions: html`<a class="btn btn-ghost" href="#/employees">👷 الموظفون</a><a class="btn btn-primary" href="#/payroll/new">➕ مسير جديد</a>` })}
    ${rows.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>الرقم</th><th>الشهر</th><th class="hide-sm">التاريخ</th><th class="num hide-sm">الموظفون</th><th class="num">الإجمالي</th><th class="num">الصافي</th><th>الصرف</th></tr></thead><tbody>
      ${rows.map((d) => { const P = payrollTotals(d, dec()); return html`<tr data-href="${docHref(d)}"><td dir="ltr" class="nowrap"><b>${docNo(d, s)}</b></td><td>${monthLabel(d.period)}</td><td class="hide-sm">${fmtDate(d.date)}</td>
        <td class="num hide-sm">${d.lines.length}</td><td class="num">${money(P.gross)}</td><td class="num"><b>${money(P.net)}</b></td><td>${d.money ? html`<span class="badge badge-ok">${accName(d.money)}</span>` : html`<span class="badge badge-warn">مستحق</span>`}</td></tr>`; })}
    </tbody></table></div>`
    : empty('💼', 'لا توجد مسيرات رواتب', store.getDb().employees.length ? `أنشئ مسير الشهر: يعبّأ بالموظفين النشطين ورواتبهم، وتُحسب ${ssWord()} تلقائياً.` : 'أضف الموظفين أولاً، ثم أنشئ مسير الرواتب الشهري.', html`<a class="btn btn-primary" href="${store.getDb().employees.length ? '#/payroll/new' : '#/employees/new'}">${store.getDb().employees.length ? '➕ مسير جديد' : '➕ موظف جديد'}</a>`)}`);
  bindRows(root);
}

const FIELDS = [['basic', 'الأساسي'], ['housing', 'السكن'], ['transport', 'النقل'], ['other', 'بدلات'], ['additions', 'إضافي ومكافآت'], ['absence', 'غياب وخصم'], ['advance', 'سلفة'], ['gosiEmp', 'الموظف'], ['gosiCo', 'المنشأة']];
const fieldLabel = (k, l) => (k === 'gosiEmp' || k === 'gosiCo' ? `${ssShort()} ${l}` : l);
const lineFor = (e, rates) => ({ employee: e.id, name: e.name, basic: num(e.basic), housing: num(e.housing), transport: num(e.transport), other: num(e.other), additions: 0, absence: 0, advance: 0, ...gosiFor(e, rates, dec()) });

export function form(type, { root, params, query }) {
  const db = store.getDb();
  const s = S();
  const existing = params.id ? store.findDoc(params.id) : null;
  if (params.id && (!existing || existing.type !== 'payroll')) { root.innerHTML = String(empty('🔎', 'المسير غير موجود')); return; }
  if (existing && docLocked(existing)) { setTitle('مسير رواتب'); root.innerHTML = String(lockedPage(existing)); return; }
  const rates = payrollRates(s);
  const last = db.docs.filter((d) => d.type === 'payroll').sort((a, b) => b.period.localeCompare(a.period))[0];
  const period = query.period || (last ? addMonths(last.period + '-01', 1).slice(0, 7) : today().slice(0, 7));
  const inPeriod = (e, p) => e.active !== false && isDate(e.joinDate) && e.joinDate <= monthEnd(p + '-01') && (!e.leaveDate || e.leaveDate >= p + '-01');
  const d = existing ? clone(existing) : {
    type: 'payroll', period, date: monthEnd(period + '-01'), money: moneyList().find((a) => a.id === 'bank')?.id || moneyList()[0]?.id || '', notes: '',
    lines: db.employees.filter((e) => inPeriod(e, period)).map((e) => lineFor(e, rates)),
  };
  const title = existing ? `تعديل مسير ${monthLabel(existing.period)}` : 'مسير رواتب جديد';
  setTitle(title);
  const advances = employeeAdvances(db);
  // السلف المستردة في هذا المسير نفسه لا تُحسب مرتين عند التعديل
  if (existing) for (const l of existing.lines) if (l.employee && num(l.advance)) advances.set(l.employee, (advances.get(l.employee) || 0) + num(l.advance));
  root.innerHTML = String(html`${head(title, { actions: html`<a class="btn btn-ghost" href="${existing ? docHref(existing) : '#/payroll'}">إلغاء</a>` })}
    <form novalidate data-form>
      <div class="card"><div class="form-grid">
        ${field('الشهر', html`<input class="inp" type="month" data-f="period" data-k="period" value="${d.period}">`)}
        ${field('تاريخ الصرف', html`<input class="inp" type="date" data-f="date" data-k="date" value="${d.date}">`)}
        ${field('الصرف', html`<select class="inp" data-f="money" data-k="money">${moneyOptions(d.money, { blank: 'مستحقة — تُصرف لاحقاً' })}</select>`)}
        <div class="span-all">${field('ملاحظات', html`<input class="inp" data-k="notes" value="${d.notes || ''}">`)}</div>
      </div></div>
      <div class="card" style="margin-top:14px"><div class="card-h"><h3>الموظفون</h3><span class="inline"><select class="inp" data-add-emp style="max-width:220px"></select></span></div>
        <div class="tbl-wrap"><table class="tbl pay-tbl"><thead><tr><th>الموظف</th>${FIELDS.map(([k, l]) => html`<th class="num">${fieldLabel(k, l)}</th>`)}<th class="num">الصافي</th><th></th></tr></thead><tbody data-lines></tbody><tfoot data-foot></tfoot></table></div>
        <small class="fld-e" data-err="lines" hidden></small></div>
      <div class="form-actions sticky-actions"><button class="btn btn-primary">💾 حفظ المسير</button></div>
    </form>`);
  const body = $('[data-lines]', root);
  const draw = () => {
    body.innerHTML = String(html`${d.lines.map((l, i) => { const x = payLine(l, dec()); const a = advances.get(l.employee) || 0;
      return html`<tr data-i="${i}"><td><b>${l.name}</b>${a > 0 ? html`<div class="muted small">سلفة قائمة ${money(a)}</div>` : ''}<small class="fld-e" data-err="line${i}" hidden></small></td>
        ${FIELDS.map(([k]) => html`<td class="num"><input class="inp pay-inp" data-pk="${k}" type="text" inputmode="decimal" data-num value="${l[k] || ''}" placeholder="0"></td>`)}
        <td class="num"><b data-net>${money(x.net)}</b></td><td><button type="button" class="icon-btn" data-rm="${i}" aria-label="إزالة">✕</button></td></tr>`; })}`);
    foot();
    const others = db.employees.filter((e) => e.active !== false && !d.lines.some((l) => l.employee === e.id));
    const sel = $('[data-add-emp]', root);
    sel.innerHTML = String(html`<option value="">➕ إضافة موظف…</option>${others.map((e) => html`<option value="${e.id}">${e.name}</option>`)}`);
    sel.hidden = !others.length;
  };
  const foot = () => {
    const P = payrollTotals(d, dec());
    const col = (k) => round(d.lines.reduce((t, l) => t + num(l[k]), 0), dec());
    $('[data-foot]', root).innerHTML = String(html`<tr><td>المجموع (${d.lines.length})</td>${FIELDS.map(([k]) => html`<td class="num">${money(col(k))}</td>`)}<td class="num">${money(P.net)}</td><td></td></tr>`);
  };
  body.addEventListener('input', (ev) => {
    const tr = ev.target.closest('tr[data-i]');
    const k = ev.target.dataset.pk;
    if (!tr || !k) return;
    const l = d.lines[Number(tr.dataset.i)];
    l[k] = ev.target.value;
    guard.dirty = true;
    // تغيير الأساسي أو البدلات يعيد حساب التأمينات
    if (['basic', 'housing', 'transport', 'other'].includes(k)) {
      const emp = store.findEmployee(l.employee) || {};
      const g = gosiFor({ ...emp, ...l }, rates, dec());
      l.gosiEmp = g.gosiEmp; l.gosiCo = g.gosiCo;
      $('[data-pk="gosiEmp"]', tr).value = g.gosiEmp || ''; $('[data-pk="gosiCo"]', tr).value = g.gosiCo || '';
    }
    $('[data-net]', tr).innerHTML = String(money(payLine(l, dec()).net));
    foot();
  });
  root.addEventListener('click', (ev) => {
    const rm = ev.target.closest('[data-rm]');
    if (rm) { d.lines.splice(Number(rm.dataset.rm), 1); guard.dirty = true; draw(); }
  });
  $('[data-add-emp]', root).onchange = (ev) => { const e = store.findEmployee(ev.target.value); if (e) { d.lines.push(lineFor(e, rates)); guard.dirty = true; draw(); } };
  root.addEventListener('change', (ev) => {
    const k = ev.target.dataset.k;
    if (!k) return;
    d[k] = ev.target.value;
    guard.dirty = true;
    if (k === 'period' && d.period && !existing) { d.date = monthEnd(d.period + '-01'); $('[data-k="date"]', root).value = d.date; }
  });
  root.addEventListener('input', (ev) => { if (ev.target.dataset.k === 'notes') d.notes = ev.target.value; });
  $('[data-form]', root).onsubmit = async (ev) => {
    ev.preventDefault();
    const doc = { ...d, lines: d.lines.map((l) => ({ ...l, ...Object.fromEntries(FIELDS.map(([k]) => [k, round(num(l[k]), dec())])) })), notes: String(d.notes || '').trim() };
    if (!showErrors(root, validateDoc(store.getDb(), doc))) { toast('راجع الحقول المظللة', 'err'); return; }
    const dup = store.getDb().docs.find((x) => x.type === 'payroll' && x.period === doc.period && x.id !== doc.id);
    if (dup && !(await confirmBox(`يوجد مسير لشهر ${monthLabel(doc.period)} (${docNo(dup, s)}). حفظ مسير آخر لنفس الشهر؟`, { ok: 'حفظ على أي حال' }))) return;
    store.saveDoc(doc);
    guard.dirty = false;
    toast('تم حفظ المسير ✓');
    go(docHref(doc));
  };
  draw();
}

export function show(type, { root, params }) {
  const d = store.findDoc(params.id);
  if (!d || d.type !== 'payroll') { setTitle('مسير رواتب'); root.innerHTML = String(empty('🔎', 'المسير غير موجود')); return; }
  const s = S();
  const B = store.getBooks();
  const no = docNo(d, s);
  setTitle(`مسير رواتب ${monthLabel(d.period)}`);
  const P = payrollTotals(d, dec());
  const locked = docLocked(d);
  const gosiTotal = round(P.gosiEmp + P.gosiCo, dec());
  const table = html`<table class="tbl" data-table><thead><tr><th>الموظف</th><th class="num">الأساسي</th><th class="num">البدلات</th><th class="num">إضافي</th><th class="num">غياب</th><th class="num">الإجمالي</th><th class="num">${ssWord()}</th><th class="num">السلفة</th><th class="num">الصافي</th></tr></thead><tbody>
    ${d.lines.map((l, i) => { const x = P.lines[i]; return html`<tr><td>${l.name}</td><td class="num">${money(l.basic)}</td><td class="num">${money(num(l.housing) + num(l.transport) + num(l.other))}</td><td class="num">${money(l.additions || 0)}</td><td class="num">${money(l.absence || 0)}</td>
      <td class="num">${money(x.gross)}</td><td class="num">${money(x.gosiEmp)}</td><td class="num">${money(x.advance)}</td><td class="num"><b>${money(x.net)}</b></td></tr>`; })}
  </tbody><tfoot><tr><td>المجموع</td><td></td><td></td><td></td><td></td><td class="num">${money(P.gross)}</td><td class="num">${money(P.gosiEmp)}</td><td class="num">${money(P.advance)}</td><td class="num">${money(P.net)}</td></tr></tfoot></table>`;
  root.innerHTML = String(html`${head(`مسير رواتب ${monthLabel(d.period)}`, { sub: html`<span dir="ltr">${no}</span> · ${fmtDate(d.date)} · ${d.money ? 'صُرف من ' + accName(d.money) : 'رواتب مستحقة لم تُصرف'}`,
    actions: html`<button class="btn btn-primary" data-print>🖨️ طباعة المسير</button><button class="btn btn-ghost" data-slips>🧾 قسائم الرواتب</button><button class="btn btn-ghost" data-bank>⬇️ ملف البنك</button>
      ${d.money ? '' : html`<a class="btn btn-ghost" href="#/payments/new?account=wages&amount=${P.net}">💵 صرف الرواتب</a>`}
      ${gosiTotal ? html`<a class="btn btn-ghost" href="#/payments/new?account=gosi_pay&amount=${gosiTotal}">🏛️ سداد ${ssWord()}</a>` : ''}
      ${locked ? '' : html`<a class="btn btn-ghost" href="#/payroll/${d.id}/edit">✏️ تعديل</a><button class="btn btn-text-danger" data-del>🗑️ حذف</button>`}` })}
    ${locked ? lockedNote(d) : ''}
    <div class="grid g4" style="margin-bottom:14px">
      <div class="kpi"><span class="kpi-l">إجمالي الرواتب</span><span class="kpi-v">${money(P.gross, { sym: true })}</span><span class="kpi-s">${d.lines.length} موظف</span></div>
      <div class="kpi"><span class="kpi-l">المستقطعات</span><span class="kpi-v">${money(P.deductions, { sym: true })}</span><span class="kpi-s">${ssShort()} ${money(P.gosiEmp)} · سلف ${money(P.advance)}</span></div>
      <div class="kpi"><span class="kpi-l">صافي الصرف</span><span class="kpi-v">${money(P.net, { sym: true })}</span></div>
      <div class="kpi"><span class="kpi-l">${ssShort()} على المنشأة</span><span class="kpi-v">${money(P.gosiCo, { sym: true })}</span><span class="kpi-s">المستحق لـ${ssName()} ${money(gosiTotal)}</span></div></div>
    <div class="tbl-wrap">${table}</div>
    <details class="card" style="margin-top:14px"><summary style="cursor:pointer;font-weight:800">📒 القيد المحاسبي</summary><div style="margin-top:12px">${entryTable(B.entries.get(d.id))}</div></details>`);
  $('[data-print]', root).onclick = () => printPaper(html`<div class="paper pp-report"><div class="pp-head"><div><h2 style="font-size:18px;font-weight:900">${s.name || ''}</h2></div><div class="pp-title"><h1>مسير رواتب ${monthLabel(d.period)}</h1><div class="en" dir="ltr">${no}</div></div></div>
    <div style="margin-top:12px">${table}</div><div class="pp-sign"><div>أعدّه</div><div>راجعه</div><div>اعتمده</div></div></div>`, { title: `مسير ${d.period}`, page: '@page { size: A4 landscape; margin: 10mm; }' });
  $('[data-slips]', root).onclick = () => printPaper(html`${d.lines.map((l, i) => slip(d, l, P.lines[i]))}`, { title: `قسائم ${d.period}` });
  $('[data-bank]', root).onclick = async () => {
    const { writeXlsx } = await import('../xlsx.js');
    const rows = [['اسم الموظف', 'رقم الهوية', 'البنك', 'رقم الآيبان', 'صافي الراتب', 'الأساسي', 'بدل السكن', 'بدلات أخرى', 'الخصومات']];
    d.lines.forEach((l, i) => { const e = store.findEmployee(l.employee) || {}; const x = P.lines[i]; rows.push([l.name, e.nationalId || '', e.bank || '', e.iban || '', x.net, num(l.basic), num(l.housing), round(num(l.transport) + num(l.other) + num(l.additions), dec()), round(x.deductions + num(l.absence), dec())]); });
    download(`رواتب ${d.period}.xlsx`, writeXlsx([{ name: 'الرواتب ' + d.period, rows }]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    if (d.lines.some((l) => !store.findEmployee(l.employee)?.iban)) toast('تنبيه: بعض الموظفين بلا رقم آيبان', 'warn');
  };
  const del = $('[data-del]', root);
  if (del) del.onclick = async () => {
    if (!(await confirmBox(`حذف مسير ${monthLabel(d.period)} مع قيده؟`, { ok: 'حذف', danger: true }))) return;
    store.deleteDoc(d.id); toast('تم الحذف'); go('#/payroll');
  };
}

// قسيمة الراتب لموظف واحد
function slip(d, l, x) {
  const s = S();
  const e = store.findEmployee(l.employee) || {};
  const row = (label, v) => (num(v) ? html`<tr><td>${label}</td><td class="num">${money(v)}</td></tr>` : '');
  return html`<div class="paper slip">
    <div class="pp-head"><div><h2 style="font-size:16px;font-weight:900">${s.name || ''}</h2>${s.crNo ? html`<div class="muted">السجل التجاري: <span dir="ltr">${s.crNo}</span></div>` : ''}</div><div class="pp-title"><h1>قسيمة راتب</h1><div class="en">Payslip · ${monthLabel(d.period)}</div></div></div>
    <div class="pp-meta"><div><span>الموظف</span><b>${l.name}</b></div><div><span>الوظيفة</span><b>${e.job || '—'}</b></div><div><span>رقم الهوية</span><b dir="ltr">${e.nationalId || '—'}</b></div><div><span>تاريخ الصرف</span><b>${fmtDate(d.date)}</b></div></div>
    <div class="grid g2">
      <table class="pp-lines"><thead><tr><th>المستحقات</th><th class="num">المبلغ</th></tr></thead><tbody>
        ${row('الراتب الأساسي', l.basic)}${row('بدل السكن', l.housing)}${row('بدل النقل', l.transport)}${row('بدلات أخرى', l.other)}${row('إضافي ومكافآت', l.additions)}${row('خصم غياب', -num(l.absence))}
        <tr><td><b>الإجمالي</b></td><td class="num"><b>${money(x.gross)}</b></td></tr></tbody></table>
      <table class="pp-lines"><thead><tr><th>الاستقطاعات</th><th class="num">المبلغ</th></tr></thead><tbody>
        ${row(ssName(), l.gosiEmp)}${row('استرداد سلفة', l.advance)}
        <tr><td><b>مجموع الاستقطاعات</b></td><td class="num"><b>${money(x.deductions)}</b></td></tr></tbody></table>
    </div>
    <div class="pp-box" style="display:flex;justify-content:space-between;margin-top:10px"><b>صافي الراتب</b><span class="pp-amount">${money(x.net)}</span></div>
    <div class="pp-words">${tafqeet(x.net, s.currency)}</div>
    <div class="pp-sign" style="grid-template-columns:1fr 1fr"><div>توقيع الموظف</div><div>المحاسب</div></div>
  </div>`;
}

