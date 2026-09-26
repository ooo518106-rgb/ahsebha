// ═══ الترحيب وإعداد المنشأة، ولوحة التحكم ═══
import * as store from '../store.js';
import { COUNTRIES, dashboard as summarize, docNo, stockReport, ymd, monthStart, validSaudiVat, isDate } from '../core.js';
import { html, money, fmtDate, hijri, toast, confirmBox, empty, $, showErrors, field, monthName, badge } from '../ui.js';
import { go, setTitle, docHref } from '../nav.js';
import { today, S, partyName, docStatus } from './common.js';
import { monthlyChart } from './chart.js';
import { demoData } from '../demo.js';

const FEATURES = [
  ['🧾', 'فواتير ضريبية ورمز QR', 'فاتورة ضريبية ومبسطة وإشعارات دائنة، مع رمز QR حسب متطلبات هيئة الزكاة والضريبة والجمارك، وطباعة A4 أو إيصال حراري.'],
  ['📒', 'قيود تلقائية بالقيد المزدوج', 'كل فاتورة وسند ومصروف يولّد قيده تلقائياً، مع دليل حسابات قابل للتعديل وقيود يدوية للتسويات.'],
  ['📦', 'مخزون بالتكلفة المتوسطة', 'متابعة الكميات وتكلفة البضاعة المباعة وربح كل منتج، وتنبيه عند قرب النفاد، وتسويات الجرد.'],
  ['👥', 'عملاء وموردون وكشوف حساب', 'أرصدة لحظية، أعمار الديون، ربط الدفعات بالفواتير، وإرسال الكشف عبر واتساب.'],
  ['📊', 'تقارير مالية كاملة', 'قائمة الدخل، الميزانية العمومية، ميزان المراجعة، إقرار الضريبة، وحركة الصندوق والبنوك.'],
  ['🔒', 'بياناتك على جهازك', 'بدون تسجيل وبدون خوادم: كل شيء يُحفظ في متصفحك، مع نسخة احتياطية تنزّلها وتستعيدها متى شئت.'],
];

// ═══ الترحيب ═══
export function welcome({ root }) {
  if (store.getDb()) { go('#/'); return; }
  setTitle('برنامج محاسبة مجاني');
  const t = today();
  root.innerHTML = String(html`<section class="welcome">
    <div class="hero-acc"><div class="ic">📒</div><h1>برنامج محاسبة مجاني متكامل</h1>
      <p>للمحلات والمتاجر والمؤسسات الصغيرة: بِع واشترِ وسجّل مصاريفك، والبرنامج يعمل القيود والمخزون والضريبة والتقارير عنك.</p>
      <div class="actions"><button class="btn btn-primary" data-start>🚀 ابدأ منشأتك الآن</button><button class="btn btn-ghost" data-demo>🧪 جرّب ببيانات تجريبية</button><label class="btn btn-ghost">📂 استعادة نسخة احتياطية<input type="file" accept=".json,application/json" data-restore hidden></label></div>
    </div>
    <form class="card" data-setup hidden novalidate style="max-width:720px;margin:0 auto 22px">
      <div class="card-h"><h3>بيانات منشأتك</h3><span class="muted small">يمكنك تعديلها لاحقاً من الإعدادات</span></div>
      <div class="form-grid">
        <div class="span2">${field('اسم المنشأة كما يظهر في الفواتير', html`<input class="inp" name="name" data-f="name" autofocus placeholder="مثال: مؤسسة النخبة للتجارة">`)}<small class="fld-e" data-err="name" hidden></small></div>
        ${field('الدولة', html`<select class="inp" name="country">${Object.entries(COUNTRIES).map(([k, c]) => html`<option value="${k}">${c.name}</option>`)}</select>`)}
        <label class="check" style="align-self:end;min-height:40px"><input type="checkbox" name="vat" checked> مسجّل في الضريبة</label>
        <div data-vatno>${field('الرقم الضريبي', html`<input class="inp" name="vatNo" data-f="vatNo" inputmode="numeric" dir="ltr" placeholder="3xxxxxxxxxxxxx3">`)}<small class="fld-e" data-err="vatNo" hidden></small></div>
        ${field('تاريخ بداية التشغيل', html`<input class="inp" type="date" name="startDate" value="${monthStart(t)}">`, { hint: 'تُسجَّل الأرصدة الافتتاحية بهذا التاريخ' })}
      </div>
      <div class="form-actions"><button class="btn btn-primary">إنشاء المنشأة والبدء</button></div>
    </form>
    <div class="features">${FEATURES.map(([ic, t2, d]) => html`<div class="feature"><span class="ic">${ic}</span><b>${t2}</b><p>${d}</p></div>`)}</div>
    <p class="note note-info">البرنامج مجاني ويعمل من المتصفح على الجوال والكمبيوتر. بياناتك تُحفظ على هذا الجهاز فقط، فاحرص على تنزيل نسخة احتياطية بشكل دوري من الإعدادات.</p>
  </section>`);

  const form = $('[data-setup]', root);
  const syncVat = () => {
    const c = COUNTRIES[form.country.value];
    form.vat.checked = c.vatRate > 0;
    $('[data-vatno]', root).hidden = !form.vat.checked;
  };
  form.country.onchange = syncVat;
  form.vat.onchange = () => { $('[data-vatno]', root).hidden = !form.vat.checked; };
  $('[data-start]', root).onclick = () => { form.hidden = false; form.name.focus(); form.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  form.onsubmit = (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    const vatNo = form.vatNo.value.replace(/\s/g, '');
    const errs = {};
    if (!name) errs.name = 'اكتب اسم المنشأة';
    if (form.vat.checked && vatNo && form.country.value === 'SA' && !validSaudiVat(vatNo)) errs.vatNo = 'الرقم الضريبي السعودي 15 رقماً يبدأ وينتهي بالرقم 3';
    if (!showErrors(form, errs)) return;
    const c = COUNTRIES[form.country.value];
    store.createCompany({ name, country: form.country.value, currency: c.currency, vat: form.vat.checked, vatRate: form.vat.checked ? (c.vatRate || 15) : 0, taxLabel: c.taxLabel, vatNo: form.vat.checked ? vatNo : '', startDate: isDate(form.startDate.value) ? form.startDate.value : monthStart(t) });
    window.dispatchEvent(new Event('acc:shell'));
    toast('تم إنشاء المنشأة ✓ ابدأ بإضافة أرصدتك ومنتجاتك');
    go('#/');
  };
  $('[data-demo]', root).onclick = () => loadDemo();
  $('[data-restore]', root).onchange = (e) => restoreFile(e.target.files[0]);
}

export async function loadDemo() {
  if (store.getDb() && !(await confirmBox('سيتم استبدال بياناتك الحالية ببيانات تجريبية. نزّل نسخة احتياطية أولاً إن كانت بياناتك مهمة.', { ok: 'استبدال ببيانات تجريبية', danger: true }))) return;
  const d = demoData(today());
  store.replaceDb({ ...d, demo: true });
  window.dispatchEvent(new Event('acc:shell'));
  toast('تم تحميل بيانات تجريبية لمتجر إلكترونيات 🧪');
  go('#/');
}

export async function restoreFile(file) {
  if (!file) return;
  try {
    const data = store.parseBackup(await file.text());
    const docs = data.docs.length;
    if (store.getDb() && !(await confirmBox(`سيتم استبدال كل البيانات الحالية بالنسخة الاحتياطية «${data.settings.name || ''}» (${docs} مستند).`, { ok: 'استعادة', danger: true }))) return;
    store.replaceDb(data);
    window.dispatchEvent(new Event('acc:shell'));
    toast('تمت الاستعادة ✓');
    go('#/');
  } catch (e) { toast(e.message, 'err'); }
}

// ═══ لوحة التحكم ═══
export function dashboard({ root }) {
  const db = store.getDb();
  if (!db) { welcome({ root }); return; }
  const s = S();
  setTitle('الرئيسية');
  const B = store.getBooks();
  const t = today();
  const D = summarize(db, B, t);
  const stockValue = stockReport(db, B).value;
  const sales = db.docs.filter((d) => d.type === 'sale').sort((a, b) => b.date.localeCompare(a.date) || b.no - a.no);
  const since = s.lastBackupAt ? Math.floor((Date.now() - Date.parse(s.lastBackupAt)) / 864e5) : null;
  const needBackup = db.docs.length > 0 && (since == null || since >= 7);
  const steps = [
    ['بيانات المنشأة والضريبة', !!(s.name && (!s.vat || s.vatNo)), '#/settings'],
    ['رصيد الصندوق والبنك الافتتاحي', db.accounts.some((a) => a.money && Number(a.opening)), '#/accounts'],
    ['إضافة المنتجات والخدمات', db.products.length > 0, '#/products/new'],
    ['إضافة العملاء', db.parties.some((p) => p.kind === 'customer'), '#/customers/new'],
    ['إصدار أول فاتورة', sales.length > 0, '#/sales/new'],
  ];
  const showSteps = !db.demo && steps.some((x) => !x[1]);
  const kpi = (label, value, href, sub, cls = '') => html`<a class="kpi" href="${href}"><span class="kpi-l">${label}</span><span class="kpi-v ${cls}">${value}</span>${sub ? html`<span class="kpi-s">${sub}</span>` : ''}</a>`;
  const monthLabel = `${monthName(t)} ${t.slice(0, 4)}`;

  root.innerHTML = String(html`
    <div class="page-head"><div><h2>أهلاً بك 👋</h2><div class="sub">${s.name || ''} · ${fmtDate(t)}${s.country === 'SA' ? ` · ${hijri(t)}` : ''}</div></div>
      <div class="actions"><a class="btn btn-primary" href="#/sales/new">🧾 فاتورة جديدة</a><a class="btn btn-ghost" href="#/expenses/new">💸 مصروف</a></div></div>
    ${db.demo ? html`<p class="note note-info" style="margin-bottom:14px">🧪 هذه بيانات تجريبية للتجربة. عندما تكون جاهزاً: <a href="#/settings">الإعدادات</a> ← «حذف كل البيانات» ثم ابدأ بمنشأتك.</p>` : ''}
    ${needBackup ? html`<p class="note note-warn" style="margin-bottom:14px">💾 ${since == null ? 'لم تنزّل أي نسخة احتياطية بعد.' : `آخر نسخة احتياطية قبل ${since} يوم.`} بياناتك محفوظة على هذا الجهاز فقط. <a href="#/settings" data-backup>نزّل نسخة احتياطية الآن</a></p>` : ''}
    ${showSteps ? html`<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>🚀 خطوات البداية</h3><span class="muted small">${steps.filter((x) => x[1]).length} من ${steps.length}</span></div>
      <div class="list-mini">${steps.map(([label, done, href]) => html`<a href="${href}"><span>${done ? '✅' : '⬜'} ${label}</span>${done ? '' : html`<span class="meta">ابدأ ←</span>`}</a>`)}</div></div>` : ''}
    <div class="grid g4">
      ${kpi(`مبيعات ${monthName(t)}`, money(D.revenue, { sym: true }), '#/reports/sales', 'صافي بعد المرتجعات وقبل الضريبة')}
      ${kpi('المصروفات والتكاليف', money(D.expenses, { sym: true }), '#/reports/income', 'تشمل تكلفة البضاعة المباعة')}
      ${kpi('صافي الربح', money(D.profit, { sym: true }), '#/reports/income', monthLabel, D.profit < 0 ? 'neg' : 'pos')}
      ${kpi('النقدية والبنوك', money(D.cash, { sym: true }), '#/reports/cash', 'الرصيد المتوفر الآن')}
      ${kpi('مستحق من العملاء', money(D.receivable, { sym: true }), '#/reports/aging-ar', D.overdue.length ? `${D.overdue.length} فاتورة متأخرة` : 'لا توجد متأخرات')}
      ${kpi('مستحق للموردين', money(D.payable, { sym: true }), '#/reports/aging-ap')}
      ${s.vat ? kpi(D.vatDue >= 0 ? 'ضريبة مستحقة للهيئة' : 'ضريبة قابلة للاسترداد', money(Math.abs(D.vatDue), { sym: true }), '#/reports/vat', 'الرصيد غير المسدد') : ''}
      ${kpi('قيمة المخزون', money(stockValue, { sym: true }), '#/reports/stock', D.low.length ? `${D.low.length} صنف قارب على النفاد` : 'بالتكلفة المتوسطة')}
    </div>
    <div class="card" style="margin-top:14px"><div class="card-h"><h3>الإيرادات والمصروفات — آخر ستة أشهر</h3><a class="small" href="#/reports/income">قائمة الدخل ←</a></div><div data-chart></div></div>
    <div class="grid g2" style="margin-top:14px">
      <div class="card"><div class="card-h"><h3>آخر الفواتير</h3><a class="small" href="#/sales">الكل ←</a></div>
        ${sales.length ? html`<div class="list-mini">${sales.slice(0, 6).map((d) => { const st = docStatus(d, B); return html`<a href="${docHref(d)}"><span><b dir="ltr">${docNo(d, s)}</b> · ${partyName(d.party, 'عميل نقدي')} <span class="meta">${fmtDate(d.date)}</span></span><span>${money(B.totals.get(d.id)?.total || 0)} ${badge(st.state)}</span></a>`; })}</div>`
          : empty('🧾', 'لا توجد فواتير بعد', '', html`<a class="btn btn-primary btn-sm" href="#/sales/new">أنشئ أول فاتورة</a>`)}</div>
      <div class="card"><div class="card-h"><h3>تنبيهات</h3></div>
        ${D.overdue.length || D.low.length ? html`<div class="list-mini">
          ${D.overdue.slice(0, 5).map((d) => html`<a href="${docHref(d)}"><span>⏰ فاتورة متأخرة <b dir="ltr">${docNo(d, s)}</b> · ${partyName(d.party)}</span><span class="neg">${money(B.status.get(d.id).due)}</span></a>`)}
          ${D.low.slice(0, 5).map((r) => html`<a href="#/products/${r.product.id}"><span>📦 ${r.product.name} قارب على النفاد</span><span class="meta">المتوفر ${Number(r.qty.toFixed(3))}</span></a>`)}
        </div>` : html`<p class="muted small">لا توجد تنبيهات. كل شيء على ما يرام ✅</p>`}</div>
    </div>`);

  monthlyChart($('[data-chart]', root), D.series);
  const bk = $('[data-backup]', root);
  if (bk) bk.onclick = (e) => { e.preventDefault(); downloadBackup(); };
}

export function downloadBackup() {
  const s = S();
  const json = store.backupJSON();
  const name = `احسبها-نسخة-احتياطية-${(s.name || 'منشأتي').replace(/[\\/:*?"<>|\s]+/g, '-')}-${ymd(new Date())}.json`;
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  toast('تم تنزيل النسخة الاحتياطية ✓ احفظها في مكان آمن');
}
