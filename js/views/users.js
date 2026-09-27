// ═══ المستخدمون: المالك والمحاسب والكاشير، رموز الدخول، والقفل التلقائي ═══
import * as store from '../store.js';
import { html, raw, fmtDate, toast, confirmBox, modal, $, field, showErrors } from '../ui.js';
import { go, setTitle } from '../nav.js';
import { head, S } from './common.js';
import * as auth from '../auth.js';

const LOCK_OPTIONS = [[0, 'بدون قفل تلقائي'], [1, 'بعد دقيقة'], [5, 'بعد 5 دقائق'], [10, 'بعد 10 دقائق'], [15, 'بعد 15 دقيقة'], [30, 'بعد 30 دقيقة'], [60, 'بعد ساعة']];
const refresh = () => { window.dispatchEvent(new Event('acc:shell')); go('#/users'); };

// نموذج رمز PIN مع التأكيد
const pinFields = (label = 'رمز الدخول (4 إلى 8 أرقام)') => html`
  <div>${field(label, html`<input class="inp" name="pin" data-f="pin" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" dir="ltr">`)}<small class="fld-e" data-err="pin" hidden></small></div>
  <div>${field('تأكيد الرمز', html`<input class="inp" name="pin2" data-f="pin2" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" dir="ltr">`)}<small class="fld-e" data-err="pin2" hidden></small></div>`;
function pinErrors(f, errs) {
  if (!auth.validPin(f.pin.value)) errs.pin = 'الرمز من 4 إلى 8 أرقام';
  else if (f.pin.value !== f.pin2.value) errs.pin2 = 'الرمزان غير متطابقين';
  return errs;
}
const roleOptions = (sel) => html`${Object.entries(auth.ROLES).map(([k, r]) => html`<option value="${k}" ${k === sel ? raw('selected') : ''}>${r.name} — ${r.desc}</option>`)}`;
const activeOwners = (exceptId) => store.getDb().users.filter((u) => u.role === 'owner' && u.active !== false && u.id !== exceptId);

async function showRecovery(code) {
  await modal({
    title: '🔑 رمز الاسترجاع',
    body: html`<p class="dlg-msg">إذا نسيت رمز دخول المالك، هذا الرمز هو الطريقة الوحيدة للدخول. <b>اكتبه على ورقة واحفظه في مكان آمن</b>؛ لن يظهر مرة أخرى.</p>
      <div class="recovery-code" dir="ltr">${code}</div>
      <label class="check" style="margin-top:12px"><input type="checkbox" data-ok> كتبت الرمز وحفظته</label>
      <div class="dlg-actions"><button type="button" class="btn btn-ghost btn-sm" data-copy>📋 نسخ</button><button type="button" class="btn btn-primary" data-done disabled>تم</button></div>`,
    onMount: (dlg, done) => {
      $('[data-ok]', dlg).onchange = (e) => { $('[data-done]', dlg).disabled = !e.target.checked; };
      $('[data-done]', dlg).onclick = () => done(true);
      $('[data-copy]', dlg).onclick = () => navigator.clipboard?.writeText(code).then(() => toast('تم النسخ'), () => {});
      // لا يُغلق بالنقر خارج النافذة قبل التأكيد
      dlg.addEventListener('cancel', (e) => { if ($('[data-done]', dlg).disabled) e.preventDefault(); });
    },
  });
}
async function newRecovery() {
  const code = auth.makeRecoveryCode();
  store.setRecovery(await auth.makeSecret(auth.cleanRecovery(code)));
  await showRecovery(code);
}

export function view({ root, query }) {
  setTitle('المستخدمون والصلاحيات');
  const db = store.getDb();
  const s = S();
  const me = auth.currentUser();

  // ── لا يوجد مستخدمون: تفعيل النظام بإنشاء المالك ──
  if (!db.users.length) {
    root.innerHTML = String(html`${head('المستخدمون والصلاحيات', { sub: 'رمز دخول لكل موظف، وصلاحيات حسب الدور' })}
      <div class="grid g3" style="margin-bottom:14px">${Object.values(auth.ROLES).map((r) => html`<div class="card"><h3 style="font-size:1rem;margin-bottom:4px">${r.name}</h3><p class="muted small">${r.desc}</p></div>`)}</div>
      <form class="card" data-form novalidate><div class="card-h"><h3>👑 تفعيل المستخدمين: أنشئ حساب المالك</h3></div>
        <div class="form-grid">
          <div>${field('اسم المالك', html`<input class="inp" name="name" data-f="name" autocomplete="off" autofocus>`)}<small class="fld-e" data-err="name" hidden></small></div>
          ${pinFields()}
        </div>
        <p class="muted small" style="margin-top:10px">بعد التفعيل سيُطلب رمز الدخول عند فتح البرنامج، وسيظهر لك رمز استرجاع لمرة واحدة في حال نسيت الرمز.</p>
        <div class="form-actions"><button class="btn btn-primary">🔒 تفعيل المستخدمين</button></div></form>
      <p class="note note-info" style="margin-top:14px">القفل يمنع الموظفين من فتح الشاشات غير المسموحة لهم، لكن البيانات نفسها محفوظة في هذا المتصفح بدون تشفير. احتفظ بنسخة احتياطية ولا تترك الجهاز مع شخص غير موثوق.</p>`);
    const f = $('[data-form]', root);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const errs = pinErrors(f, {});
      if (!f.name.value.trim()) errs.name = 'اكتب الاسم';
      if (!showErrors(f, errs)) return;
      const owner = store.saveUser({ name: f.name.value.trim(), role: 'owner', active: true, pin: await auth.makeSecret(f.pin.value) });
      if (s.lockMinutes == null) store.saveSettings({ lockMinutes: 10 });
      auth.signIn(store.findUser(owner.id));
      await newRecovery();
      toast('تم تفعيل المستخدمين ✓');
      refresh();
    };
    return;
  }

  // ── إدارة المستخدمين ──
  const users = db.users.slice().sort((a, b) => (a.role === 'owner' ? -1 : 0) - (b.role === 'owner' ? -1 : 0) || a.name.localeCompare(b.name, 'ar'));
  const docsBy = new Map();
  for (const d of db.docs) if (d.by) docsBy.set(d.by, (docsBy.get(d.by) || 0) + 1);
  root.innerHTML = String(html`${head('المستخدمون والصلاحيات', { sub: me ? `أنت: ${me.name} (${auth.ROLES[me.role]?.name || ''})` : '', actions: html`<button class="btn btn-ghost" data-lock>🔒 قفل الآن</button><button class="btn btn-primary" data-add>➕ مستخدم جديد</button>` })}
    ${query.reset ? html`<p class="note note-warn" style="margin-bottom:14px">دخلت برمز الاسترجاع. غيّر رمز دخولك الآن، ثم أنشئ رمز استرجاع جديداً.</p>` : ''}
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>المستخدم</th><th>الدور</th><th class="hide-sm">آخر دخول</th><th class="num hide-sm">المستندات</th><th></th></tr></thead><tbody>
      ${users.map((u) => html`<tr><td><b>${u.name}</b>${me && u.id === me.id ? html` <span class="badge badge-info">أنت</span>` : ''}${u.active === false ? html` <span class="badge badge-muted">موقوف</span>` : ''}</td>
        <td>${auth.ROLES[u.role]?.name || u.role}</td><td class="hide-sm">${u.lastLoginAt ? fmtDate(u.lastLoginAt.slice(0, 10)) : '—'}</td><td class="num hide-sm">${docsBy.get(u.id) || 0}</td>
        <td class="num"><span class="inline" style="justify-content:flex-end"><button class="btn btn-ghost btn-sm" data-edit="${u.id}">✏️ تعديل</button><button class="btn btn-ghost btn-sm" data-pin="${u.id}">🔑 الرمز</button>${me && u.id === me.id ? '' : html`<button class="icon-btn" data-remove="${u.id}" aria-label="حذف">🗑️</button>`}</span></td></tr>`)}
    </tbody></table></div>
    <div class="grid g2" style="margin-top:14px">
      <div class="card"><div class="card-h"><h3>⏱️ القفل التلقائي</h3></div>
        ${field('قفل الشاشة عند عدم الاستخدام', html`<select class="inp" data-lock-min>${LOCK_OPTIONS.map(([v, t]) => html`<option value="${v}" ${Number(s.lockMinutes ?? 10) === v ? raw('selected') : ''}>${t}</option>`)}</select>`)}
        <p class="muted small" style="margin-top:8px">بعد القفل يُطلب رمز الدخول من جديد. زر 🔒 أعلى الشاشة يقفل فوراً.</p></div>
      <div class="card"><div class="card-h"><h3>🔑 رمز الاسترجاع</h3></div>
        <p class="muted small">يدخل به المالك إذا نسي رمزه. إنشاء رمز جديد يلغي القديم.</p>
        <div class="actions" style="margin-top:10px"><button class="btn btn-ghost" data-recovery>🔁 إنشاء رمز استرجاع جديد</button></div></div>
    </div>
    <div class="card" style="margin-top:14px"><div class="card-h"><h3>الصلاحيات</h3></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th></th>${Object.values(auth.ROLES).map((r) => html`<th>${r.name}</th>`)}</tr></thead><tbody>
        ${[['الكاشير وفواتير البيع وسندات القبض', '✓', '✓', '✓'], ['تعديل وحذف المستندات', '✓', '✓', '—'], ['المشتريات والمصروفات والقيود', '✓', '✓', '—'], ['المنتجات والاستيراد', '✓', '✓', '—'], ['التقارير ولوحة التحكم', '✓', '✓', '—'], ['الإعدادات والنسخ الاحتياطي', '✓', '✓', '—'], ['إدارة المستخدمين وحذف البيانات', '✓', '—', '—']].map((r) => html`<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`)}
      </tbody></table></div></div>
    <p class="note note-info" style="margin-top:14px">القفل يمنع الموظفين من فتح الشاشات غير المسموحة لهم، لكن البيانات نفسها محفوظة في هذا المتصفح بدون تشفير. احتفظ بنسخة احتياطية ولا تترك الجهاز مع شخص غير موثوق.</p>
    <div class="card" style="margin-top:14px;border-color:var(--neg)"><div class="card-h"><h3>إيقاف نظام المستخدمين</h3></div>
      <p class="muted small">يحذف كل المستخدمين ورموزهم، ويعود البرنامج مفتوحاً بدون رمز دخول.</p>
      <div class="actions" style="margin-top:10px"><button class="btn btn-text-danger" data-disable>إيقاف المستخدمين</button></div></div>`);

  function userForm(u) {
    const isNew = !u;
    return modal({
      title: isNew ? 'مستخدم جديد' : `تعديل: ${u.name}`,
      body: html`<form class="form-grid" novalidate>
        <div class="span-all">${field('الاسم', html`<input class="inp" name="name" data-f="name" value="${u ? u.name : ''}" autocomplete="off" autofocus>`)}<small class="fld-e" data-err="name" hidden></small></div>
        <div class="span-all">${field('الدور', html`<select class="inp" name="role" data-f="role">${roleOptions(u ? u.role : 'cashier')}</select>`)}<small class="fld-e" data-err="role" hidden></small></div>
        ${isNew ? pinFields() : html`<label class="check span-all"><input type="checkbox" name="active" ${u.active !== false ? raw('checked') : ''}> نشط (يستطيع الدخول)</label><small class="fld-e span-all" data-err="active" hidden></small>`}
        <div class="dlg-actions span-all"><button class="btn btn-primary">حفظ</button><button type="button" class="btn btn-ghost" data-no>إلغاء</button></div></form>`,
      onMount: (dlg, done) => {
        const f = $('form', dlg);
        $('[data-no]', dlg).onclick = () => done(null);
        f.onsubmit = async (e) => {
          e.preventDefault();
          const name = f.name.value.trim();
          const errs = isNew ? pinErrors(f, {}) : {};
          if (!name) errs.name = 'اكتب الاسم';
          else if (store.getDb().users.some((x) => x.id !== u?.id && x.name.trim() === name)) errs.name = 'يوجد مستخدم بنفس الاسم';
          if (!isNew && u.role === 'owner' && (f.role.value !== 'owner' || !f.active.checked) && !activeOwners(u.id).length) errs.role = 'يجب أن يبقى مالك واحد نشط على الأقل';
          if (!showErrors(f, errs)) return;
          if (isNew) store.saveUser({ name, role: f.role.value, active: true, pin: await auth.makeSecret(f.pin.value) });
          else store.saveUser({ id: u.id, name, role: f.role.value, active: f.active.checked });
          done(true);
        };
      },
    });
  }
  function pinForm(u) {
    return modal({
      title: `تغيير رمز الدخول: ${u.name}`,
      body: html`<form class="form-grid" novalidate>${pinFields('الرمز الجديد (4 إلى 8 أرقام)')}
        <div class="dlg-actions span-all"><button class="btn btn-primary">حفظ الرمز</button><button type="button" class="btn btn-ghost" data-no>إلغاء</button></div></form>`,
      onMount: (dlg, done) => {
        const f = $('form', dlg);
        f.pin.focus();
        $('[data-no]', dlg).onclick = () => done(null);
        f.onsubmit = async (e) => {
          e.preventDefault();
          if (!showErrors(f, pinErrors(f, {}))) return;
          store.saveUser({ id: u.id, pin: await auth.makeSecret(f.pin.value) });
          done(true);
        };
      },
    });
  }

  root.addEventListener('click', async (e) => {
    const t = e.target;
    const id = (k) => t.closest(`[data-${k}]`)?.dataset[k];
    if (t.closest('[data-add]')) { if (await userForm(null)) { toast('تمت إضافة المستخدم ✓'); refresh(); } }
    else if (id('edit')) { if (await userForm(store.findUser(id('edit')))) { toast('تم الحفظ ✓'); auth.init(); refresh(); } }
    else if (id('pin')) { if (await pinForm(store.findUser(id('pin')))) { toast('تم تغيير الرمز ✓'); if (query.reset) go('#/users'); } }
    else if (id('remove')) {
      const u = store.findUser(id('remove'));
      if (u.role === 'owner' && !activeOwners(u.id).length) { toast('لا يمكن حذف آخر مالك', 'err'); return; }
      if (await confirmBox(`حذف المستخدم «${u.name}»؟ مستنداته تبقى كما هي.`, { ok: 'حذف', danger: true })) { store.deleteUser(u.id); toast('تم الحذف'); refresh(); }
    } else if (t.closest('[data-lock]')) auth.lock();
    else if (t.closest('[data-recovery]')) {
      if (await confirmBox('إنشاء رمز استرجاع جديد يلغي الرمز القديم. متابعة؟', { ok: 'إنشاء رمز جديد' })) { await newRecovery(); toast('تم إنشاء رمز الاسترجاع ✓'); }
    } else if (t.closest('[data-disable]')) {
      if (!(await confirmBox('سيتم حذف كل المستخدمين ورموزهم، ويصبح البرنامج مفتوحاً لأي شخص يستخدم هذا الجهاز. متابعة؟', { ok: 'إيقاف المستخدمين', danger: true, title: 'إيقاف المستخدمين' }))) return;
      store.clearUsers();
      auth.init();
      toast('تم إيقاف نظام المستخدمين');
      refresh();
    }
  });
  $('[data-lock-min]', root).onchange = (e) => { store.saveSettings({ lockMinutes: Number(e.target.value) }); toast('تم الحفظ ✓'); };
  if (query.reset && me) setTimeout(() => $(`[data-pin="${me.id}"]`, root)?.click(), 200);
}
