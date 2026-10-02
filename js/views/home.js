// ═══ الترحيب وإعداد المنشأة، ولوحة التحكم ═══
import * as store from '../store.js';
import { COUNTRIES, dashboard as summarize, docNo, stockReport, ymd, monthStart, validSaudiVat, isDate, isPdc, addDays } from '../core.js';
import { html, money, fmtDate, hijri, toast, confirmBox, empty, $, showErrors, field, monthName, badge } from '../ui.js';
import { go, setTitle, docHref } from '../nav.js';
import { today, S, partyName, docStatus, taxAuth } from './common.js';
import { monthlyChart } from './chart.js';
import { demoData } from '../demo.js';
import { zipBytes, unzipEntries, entryBytes, entryText } from '../xlsx.js';

const FEATURES = [
  ['🧾', 'فواتير ضريبية ورمز QR', 'فاتورة ضريبية ومبسطة وإشعارات دائنة، مع رمز QR حسب متطلبات هيئة الزكاة والضريبة والجمارك، وطباعة A4 أو إيصال حراري.'],
  ['📒', 'قيود تلقائية بالقيد المزدوج', 'كل فاتورة وسند ومصروف يولّد قيده تلقائياً، مع دليل حسابات قابل للتعديل وقيود يدوية للتسويات.'],
  ['📦', 'مخزون بالتكلفة المتوسطة', 'متابعة الكميات وتكلفة البضاعة المباعة وربح كل منتج، وتنبيه عند قرب النفاد، وتسويات الجرد.'],
  ['🖥️', 'كاشير وباركود', 'شاشة بيع سريعة بالباركود أو الكاميرا، دفع نقدي وبطاقة ومقسّم، طباعة إيصال، تقفيل الصندوق اليومي، وطباعة ملصقات الباركود.'],
  ['👥', 'عملاء وموردون وكشوف حساب', 'أرصدة لحظية، أعمار الديون، ربط الدفعات بالفواتير، وتذكير المتأخرين عبر واتساب.'],
  ['📥', 'استيراد من Excel ومستخدمون', 'انقل منتجاتك وعملاءك من ملف Excel دفعة واحدة، وأضف كاشير ومحاسب برموز دخول وصلاحيات.'],
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
      <div class="actions"><button class="btn btn-primary" data-start>🚀 ابدأ منشأتك الآن</button><button class="btn btn-ghost" data-demo>🧪 جرّب ببيانات تجريبية</button><label class="btn btn-ghost">📂 استعادة نسخة احتياطية<input type="file" accept=".json,.zip,application/json,application/zip" data-restore hidden></label></div>
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
    <p class="note note-info">البرنامج مجاني ويعمل من المتصفح على الجوال والكمبيوتر. بياناتك تُحفظ على هذا الجهاز فقط ولا تُرسل لأي خادم، فاحرص على تنزيل نسخة احتياطية بشكل دوري من الإعدادات.</p>
    <p class="muted small" style="margin-top:10px;text-align:center">الخصوصية: نستخدم Google Analytics لإحصاءات الزيارات فقط، أما فواتيرك وأرقامك فلا تغادر جهازك.</p>
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
  toast('تم تحميل بيانات تجريبية لمتجر إلكترونيات في عمّان 🧪');
  go('#/');
}

// النسخة الكاملة ملف zip: البيانات (ahsebha-backup.json) والمرفقات (files/<id>.<ext>)
const BACKUP_JSON = 'ahsebha-backup.json';
export async function restoreFile(file) {
  if (!file) return;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    let entries = null;
    let data;
    if (buf[0] === 0x50 && buf[1] === 0x4b) {
      entries = unzipEntries(buf);
      const json = await entryText(entries, BACKUP_JSON);
      if (json == null) throw new Error('هذا الملف ليس نسخة احتياطية من برنامج محاسبة احسبها');
      data = store.parseBackup(json);
    } else data = store.parseBackup(new TextDecoder().decode(buf));
    const docs = data.docs.length;
    const metas = new Map(data.docs.flatMap((d) => (d.files || []).map((f) => [f.id, f])));
    const inZip = entries ? [...entries.keys()].map((n) => [n, /^files\/([\w-]{1,40})(?:\.\w{1,5})?$/.exec(n)]).filter(([, m]) => m && metas.has(m[1])) : [];
    if (store.getDb() && !(await confirmBox(`سيتم استبدال كل البيانات الحالية بالنسخة الاحتياطية «${data.settings.name || ''}» (${docs} مستند${inZip.length ? ` و${inZip.length} مرفق` : ''}).`, { ok: 'استعادة', danger: true }))) return;
    let lost = 0;
    for (const [name, m] of inZip) {
      try {
        const meta = metas.get(m[1]);
        await store.putFile(meta, new Blob([await entryBytes(entries, name)], { type: meta.type }));
      } catch (e) { lost++; }
    }
    store.replaceDb(data);
    window.dispatchEvent(new Event('acc:shell'));
    toast(lost ? `تمت الاستعادة، لكن ${lost} مرفق ما انحفظ على هذا الجهاز` : 'تمت الاستعادة ✓', lost ? 'warn' : 'ok');
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
  // شيكات مؤجلة تستحق خلال أسبوع أو تأخرت، وتكرار تعطل
  const chqs = db.docs.filter((d) => isPdc(d) && !isDate(d.cleared) && !isDate(d.bounced) && d.chequeDue <= addDays(t, 7)).sort((a, b) => a.chequeDue.localeCompare(b.chequeDue));
  const recErr = db.recurring.filter((r) => r.active !== false && r.error);
  const kpi = (label, value, href, sub, cls = '') => html`<a class="kpi" href="${href}"><span class="kpi-l">${label}</span><span class="kpi-v ${cls}">${value}</span>${sub ? html`<span class="kpi-s">${sub}</span>` : ''}</a>`;
  const monthLabel = `${monthName(t)} ${t.slice(0, 4)}`;

  root.innerHTML = String(html`
    <div class="page-head"><div><h2>أهلاً بك 👋</h2><div class="sub">${s.name || ''} · ${fmtDate(t)}${s.country === 'SA' ? ` · ${hijri(t)}` : ''}</div></div>
      <div class="actions"><a class="btn btn-primary" href="#/sales/new">🧾 فاتورة جديدة</a><a class="btn btn-ghost" href="#/pos">🖥️ الكاشير</a><a class="btn btn-ghost" href="#/expenses/new">💸 مصروف</a></div></div>
    ${db.demo ? html`<p class="note note-info" style="margin-bottom:14px">🧪 هذه بيانات تجريبية للتجربة. عندما تكون جاهزاً: <a href="#/settings">الإعدادات</a> ← «حذف كل البيانات» ثم ابدأ بمنشأتك.</p>` : ''}
    ${needBackup ? html`<p class="note note-warn" style="margin-bottom:14px">💾 ${since == null ? 'لم تنزّل أي نسخة احتياطية بعد.' : `آخر نسخة احتياطية قبل ${since} يوم.`} بياناتك محفوظة على هذا الجهاز فقط. <a href="#/settings" data-backup>نزّل نسخة احتياطية الآن</a></p>` : ''}
    ${showSteps ? html`<div class="card" style="margin-bottom:14px"><div class="card-h"><h3>🚀 خطوات البداية</h3><span class="muted small">${steps.filter((x) => x[1]).length} من ${steps.length}</span></div>
      <div class="list-mini">${steps.map(([label, done, href]) => html`<a href="${href}"><span>${done ? '✅' : '⬜'} ${label}</span>${done ? '' : html`<span class="meta">ابدأ ←</span>`}</a>`)}</div></div>` : ''}
    <div class="grid g4">
      ${kpi(`مبيعات ${monthName(t)}`, money(D.revenue, { sym: true }), '#/reports/sales', 'صافي بعد المرتجعات وقبل الضريبة')}
      ${kpi('المصروفات والتكاليف', money(D.expenses, { sym: true }), '#/reports/income', 'تشمل تكلفة البضاعة المباعة')}
      ${kpi('صافي الربح', money(D.profit, { sym: true }), '#/reports/income', monthLabel, D.profit < 0 ? 'neg' : 'pos')}
      ${kpi('النقدية والبنوك', money(D.cash, { sym: true }), '#/reports/cash', 'الرصيد المتوفر الآن')}
      ${kpi('مستحق من العملاء', money(D.receivable, { sym: true }), '#/collections', D.overdue.length ? `${D.overdue.length} فاتورة متأخرة · تذكير واتساب` : 'لا توجد متأخرات')}
      ${kpi('مستحق للموردين', money(D.payable, { sym: true }), '#/reports/aging-ap')}
      ${s.vat ? kpi(D.vatDue >= 0 ? `ضريبة مستحقة لل${taxAuth().slice(2)}` : 'ضريبة قابلة للاسترداد', money(Math.abs(D.vatDue), { sym: true }), '#/reports/vat', 'الرصيد غير المسدد') : ''}
      ${kpi('قيمة المخزون', money(stockValue, { sym: true }), '#/reports/stock', D.low.length ? `${D.low.length} صنف قارب على النفاد` : 'بالتكلفة المتوسطة')}
    </div>
    <div class="card" style="margin-top:14px"><div class="card-h"><h3>الإيرادات والمصروفات — آخر ستة أشهر</h3><a class="small" href="#/reports/income">قائمة الدخل ←</a></div><div data-chart></div></div>
    <div class="grid g2" style="margin-top:14px">
      <div class="card"><div class="card-h"><h3>آخر الفواتير</h3><a class="small" href="#/sales">الكل ←</a></div>
        ${sales.length ? html`<div class="list-mini">${sales.slice(0, 6).map((d) => { const st = docStatus(d, B); return html`<a href="${docHref(d)}"><span><b dir="ltr">${docNo(d, s)}</b> · ${partyName(d.party, 'عميل نقدي')} <span class="meta">${fmtDate(d.date)}</span></span><span>${money(B.totals.get(d.id)?.total || 0)} ${badge(st.state)}</span></a>`; })}</div>`
          : empty('🧾', 'لا توجد فواتير بعد', '', html`<a class="btn btn-primary btn-sm" href="#/sales/new">أنشئ أول فاتورة</a>`)}</div>
      <div class="card"><div class="card-h"><h3>تنبيهات</h3></div>
        ${D.overdue.length || D.low.length || chqs.length || recErr.length ? html`<div class="list-mini">
          ${chqs.slice(0, 5).map((d) => html`<a href="#/cheques${d.type === 'payment' ? '?tab=out' : ''}"><span>🧾 شيك ${d.type === 'receipt' ? 'وارد' : 'صادر'} ${d.chequeNo || ''} · ${partyName(d.party, '')} ${d.chequeDue < t ? html`<span class="neg">متأخر</span>` : html`<span class="meta">يستحق ${fmtDate(d.chequeDue)}</span>`}</span><span>${money(d.amount)}</span></a>`)}
          ${recErr.slice(0, 3).map((r) => html`<a href="#/recurring"><span>♻️ تعذّر إنشاء «${r.name}»</span><span class="meta">${r.error}</span></a>`)}
          ${D.overdue.slice(0, 5).map((d) => html`<a href="${docHref(d)}"><span>⏰ فاتورة متأخرة <b dir="ltr">${docNo(d, s)}</b> · ${partyName(d.party)}</span><span class="neg">${money(B.status.get(d.id).due)}</span></a>`)}
          ${D.low.slice(0, 5).map((r) => html`<a href="#/products/${r.product.id}"><span>📦 ${r.product.name} قارب على النفاد</span><span class="meta">المتوفر ${Number(r.qty.toFixed(3))}</span></a>`)}
        </div>` : html`<p class="muted small">لا توجد تنبيهات. كل شيء على ما يرام ✅</p>`}</div>
    </div>`);

  monthlyChart($('[data-chart]', root), D.series);
  const bk = $('[data-backup]', root);
  if (bk) bk.onclick = (e) => { e.preventDefault(); downloadBackup(); };
}

const backupName = (kind, ext) => `احسبها-${kind}-${(S().name || 'منشأتي').replace(/[\\/:*?"<>|\s]+/g, '-')}-${ymd(new Date())}.${ext}`;
function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}
export function downloadBackup() {
  save(new Blob([store.backupJSON()], { type: 'application/json' }), backupName('نسخة-احتياطية', 'json'));
  toast(store.usedFileIds().size ? 'تم تنزيل البيانات ✓ (بدون المرفقات؛ للمرفقات نزّل النسخة الكاملة من الإعدادات)' : 'تم تنزيل النسخة الاحتياطية ✓ احفظها في مكان آمن');
}
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'application/pdf': '.pdf' };
export async function downloadFullBackup() {
  const files = [{ name: BACKUP_JSON, data: store.backupJSON() }];
  const seen = new Set();
  let missing = 0;
  for (const d of store.getDb().docs) {
    for (const f of d.files || []) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      const blob = await store.getFile(f.id).catch(() => null);
      if (blob) files.push({ name: `files/${f.id}${EXT[f.type] || ''}`, data: new Uint8Array(await blob.arrayBuffer()) });
      else missing++;
    }
  }
  save(new Blob([zipBytes(files)], { type: 'application/zip' }), backupName('نسخة-كاملة', 'zip'));
  toast(`تم تنزيل النسخة الكاملة ✓ (${files.length - 1} مرفق)${missing ? ` — ${missing} مرفق مش موجود على هذا الجهاز` : ''}`, missing ? 'warn' : 'ok');
}
