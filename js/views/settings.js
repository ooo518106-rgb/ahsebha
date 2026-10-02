// ═══ الإعدادات: المنشأة، الضريبة والعملة، الفواتير، السنة المالية، النسخ الاحتياطي ═══
import * as store from '../store.js';
import { COUNTRIES, CURRENCIES, validSaudiVat, isDate, num, payrollRates } from '../core.js';
import { html, raw, fmtDate, toast, confirmBox, modal, $, showErrors, field, MONTHS, attr } from '../ui.js';
import { go, guard, setTitle } from '../nav.js';
import { head, S } from './common.js';
import { downloadBackup, downloadFullBackup, restoreFile, loadDemo } from './home.js';
import { can } from '../auth.js';

export function view({ root }) {
  setTitle('الإعدادات');
  const db = store.getDb();
  const s = { ...S() };
  const opt = (v, cur, label) => html`<option value="${v}" ${String(v) === String(cur) ? raw('selected') : ''}>${label}</option>`;
  const inp = (k, attrs = '') => html`<input class="inp" name="${k}" data-f="${k}" value="${s[k] ?? ''}" ${raw(attrs)}>`;

  root.innerHTML = String(html`
    ${head('الإعدادات')}
    <form novalidate data-form class="stack">
      <div class="card"><div class="card-h"><h3>🏢 بيانات المنشأة</h3><span class="muted small">تظهر في رأس الفواتير والسندات</span></div>
        <div class="form-grid">
          <div class="span2">${field('اسم المنشأة', inp('name'))}<small class="fld-e" data-err="name" hidden></small></div>
          ${field('السجل التجاري', inp('crNo', 'dir="ltr"'))}
          <div class="span2">${field('العنوان', inp('address'))}</div>
          ${field('اسم المنشأة بالإنجليزي', inp('nameEn', 'dir="ltr"'), { hint: 'للفاتورة ثنائية اللغة' })}
          ${field('العنوان بالإنجليزي', inp('addressEn', 'dir="ltr"'))}
          ${field('الهاتف', inp('phone', 'dir="ltr" inputmode="tel"'))}
          ${field('البريد الإلكتروني', inp('email', 'dir="ltr" type="email"'))}
          <div class="fld span2"><span class="fld-l">الشعار</span><div class="inline">
            <img data-logo-img alt="" style="max-height:56px;max-width:140px;border:1px solid var(--border);border-radius:8px;background:#fff;padding:4px" ${s.logo ? attr('src', s.logo) : raw('hidden')}>
            <label class="btn btn-ghost btn-sm">📷 اختيار صورة<input type="file" accept="image/png,image/jpeg,image/webp" data-logo hidden></label>
            <button type="button" class="btn btn-ghost btn-sm" data-logo-x ${s.logo ? '' : raw('hidden')}>إزالة</button></div>
            <small class="fld-h">يُصغَّر تلقائياً ويُحفظ مع بياناتك</small></div>
        </div></div>

      <div class="card"><div class="card-h"><h3>🧾 الضريبة والعملة</h3></div>
        <div class="form-grid">
          ${field('الدولة', html`<select class="inp" name="country">${Object.entries(COUNTRIES).map(([k, c]) => opt(k, s.country, c.name))}</select>`)}
          ${field('العملة', html`<select class="inp" name="currency">${Object.entries(CURRENCIES).map(([k, c]) => opt(k, s.currency, `${c.name} (${c.sym})`))}</select>`, { hint: db.docs.length ? 'تغيير العملة لا يحوّل المبالغ المسجلة' : '' })}
          <label class="check span-all"><input type="checkbox" name="vat" ${s.vat ? raw('checked') : ''}> المنشأة مسجلة في الضريبة (تظهر الضريبة في الفواتير والإقرار)</label>
          <div data-vat-box class="span-all"><div class="form-grid">
            <div>${field('الرقم الضريبي', inp('vatNo', 'dir="ltr" inputmode="numeric"'))}<small class="fld-e" data-err="vatNo" hidden></small></div>
            ${field('نسبة الضريبة %', inp('vatRate', 'type="text" inputmode="decimal" data-num autocomplete="off"'), { hint: 'تُطبق على المستندات الجديدة فقط' })}
            ${field('اسم الضريبة', inp('taxLabel'))}
            <label class="check" style="align-self:end;min-height:40px"><input type="checkbox" name="inclusive" ${s.inclusive ? raw('checked') : ''}> أسعار البيع شاملة الضريبة افتراضياً</label>
          </div></div>
        </div></div>

      <div class="card"><div class="card-h"><h3>🖨️ الفواتير والطباعة</h3></div>
        <div class="form-grid">
          ${field('بادئة رقم فاتورة المبيعات', inp('salePrefix', 'dir="ltr"'), { hint: 'مثال: INV- فتظهر INV-0001' })}
          ${field('حجم الطباعة', html`<select class="inp" name="printSize">${opt('a4', s.printSize, 'ورقة A4')}${opt('receipt', s.printSize, 'إيصال حراري 80 مم (للمبيعات)')}</select>`)}
          ${field('لغة الفاتورة', html`<select class="inp" name="invoiceLang">${opt('ar', s.invoiceLang || 'ar', 'عربي')}${opt('bi', s.invoiceLang, 'عربي وإنجليزي (ثنائية اللغة)')}</select>`, { hint: 'الثنائية تُظهر العناوين وأسماء المنتجات بالإنجليزي أيضاً' })}
          <label class="check" style="align-self:end;min-height:40px"><input type="checkbox" name="showHijri" ${s.showHijri ? raw('checked') : ''}> إظهار التاريخ الهجري</label>
          <div class="span-all">${field('ملاحظة أسفل الفاتورة', html`<textarea class="inp" name="invoiceNote" rows="2" placeholder="مثال: الاستبدال خلال 7 أيام، أو بيانات الحساب البنكي للتحويل">${s.invoiceNote || ''}</textarea>`)}</div>
        </div></div>

      <div class="card"><div class="card-h"><h3>📅 السنة المالية والأرصدة الافتتاحية</h3></div>
        <div class="form-grid">
          ${field('تاريخ بداية التشغيل', inp('startDate', 'type="date"'), { hint: 'تاريخ القيد الافتتاحي' })}
          ${field('بداية السنة المالية', html`<select class="inp" name="fiscalStartMonth">${MONTHS.map((m, i) => opt(i + 1, s.fiscalStartMonth || 1, m))}</select>`)}
        </div>
        <p class="muted small" style="margin-top:10px">الأرصدة الافتتاحية: الصندوق والبنوك والأصول من <a href="#/accounts">دليل الحسابات</a>، أرصدة العملاء والموردين من بطاقة كل منهم، وكميات المخزون من بطاقة كل منتج. الفرق يُسجل في رأس المال تلقائياً.</p></div>

      <div class="form-actions sticky-actions"><button class="btn btn-primary">💾 حفظ الإعدادات</button></div>
    </form>

    <div class="grid g2" style="margin-top:14px">
      <a class="tile" href="#/users"><span class="ic">👤</span><span>المستخدمون ورموز الدخول<small class="muted" style="display:block;font-weight:600">مالك، محاسب، كاشير، وقفل تلقائي</small></span></a>
      <a class="tile" href="#/import"><span class="ic">📥</span><span>الاستيراد من Excel<small class="muted" style="display:block;font-weight:600">المنتجات والعملاء والموردون دفعة واحدة</small></span></a>
    </div>

    <div class="card" style="margin-top:14px"><div class="card-h"><h3>🏬 المستودعات والفروع</h3></div>
      <div class="grid g2">
        <div><h4 style="margin-bottom:6px">المستودعات</h4>${db.warehouses.length ? html`<div class="list-mini">${db.warehouses.map((w) => html`<div class="it"><span>${w.name}${w.id === s.defaultWh || (!s.defaultWh && w === db.warehouses[0]) ? html` <span class="badge badge-info">الافتراضي</span>` : ''}</span><span class="inline"><button type="button" class="btn btn-ghost btn-sm" data-rename="warehouses:${w.id}">✏️</button><button type="button" class="btn btn-ghost btn-sm" data-default="${w.id}">افتراضي</button><button type="button" class="icon-btn" data-remove="warehouses:${w.id}" aria-label="حذف">🗑️</button></span></div>`)}</div>` : html`<p class="muted small">مستودع واحد (لا حاجة لتعريفه).</p>`}
          <button type="button" class="btn btn-ghost btn-sm" data-add="warehouses" style="margin-top:8px">➕ مستودع</button></div>
        <div><h4 style="margin-bottom:6px">الفروع / مراكز التكلفة</h4>${db.centers.length ? html`<div class="list-mini">${db.centers.map((c) => html`<div class="it"><span>${c.name}</span><span class="inline"><button type="button" class="btn btn-ghost btn-sm" data-rename="centers:${c.id}">✏️</button><button type="button" class="icon-btn" data-remove="centers:${c.id}" aria-label="حذف">🗑️</button></span></div>`)}</div>` : html`<p class="muted small">لا توجد فروع.</p>`}
          <button type="button" class="btn btn-ghost btn-sm" data-add="centers" style="margin-top:8px">➕ فرع</button></div>
      </div>
      <p class="muted small" style="margin-top:10px">المستودعات تتابع كمية كل صنف في كل مكان مع تحويلات بينها. الفروع (مراكز التكلفة) تُختار في الفواتير والمصروفات والرواتب، وتظهر قائمة الدخل لكل فرع.</p></div>

    <div class="card" style="margin-top:14px"><div class="card-h"><h3>💼 الرواتب والتأمينات الاجتماعية</h3><span class="muted small">${s.payroll ? 'نسب معدّلة' : 'النسب الافتراضية للدولة'}</span></div>
      <form class="form-grid" data-payroll novalidate>
        ${field('حصة الموظف المواطن %', html`<input class="inp" name="citizenEmp" type="text" inputmode="decimal" data-num value="${payrollRates(s).citizenEmp}">`)}
        ${field('حصة المنشأة عن المواطن %', html`<input class="inp" name="citizenCo" type="text" inputmode="decimal" data-num value="${payrollRates(s).citizenCo}">`)}
        ${field('حصة الموظف الوافد %', html`<input class="inp" name="expatEmp" type="text" inputmode="decimal" data-num value="${payrollRates(s).expatEmp}">`)}
        ${field('حصة المنشأة عن الوافد %', html`<input class="inp" name="expatCo" type="text" inputmode="decimal" data-num value="${payrollRates(s).expatCo}">`)}
        ${field('الحد الأعلى للأجر الخاضع', html`<input class="inp" name="cap" type="text" inputmode="decimal" data-num value="${payrollRates(s).cap || ''}" placeholder="بدون حد">`)}
        ${field('الأجر الخاضع', html`<select class="inp" name="base">${[['bh', 'الأساسي + السكن'], ['basic', 'الأساسي فقط'], ['gross', 'كل الأجر الثابت']].map(([k, l]) => html`<option value="${k}" ${k === payrollRates(s).base ? raw('selected') : ''}>${l}</option>`)}</select>`)}
        <p class="muted small span-all">تتغير النسب من وقت لآخر؛ تأكد منها من موقع التأمينات الاجتماعية في دولتك قبل إصدار المسير.</p>
        <div class="dlg-actions span-all"><button class="btn btn-primary btn-sm">حفظ النسب</button>${s.payroll ? html`<button type="button" class="btn btn-ghost btn-sm" data-payroll-reset>نسب الدولة الافتراضية</button>` : ''}</div>
      </form></div>

    <div class="card" style="margin-top:14px"><div class="card-h"><h3>🔒 قفل الفترات المحاسبية</h3><span class="muted small">${s.lockDate ? 'مقفلة حتى ' + fmtDate(s.lockDate) : 'لا توجد فترة مقفلة'}</span></div>
      <p class="muted small" style="margin-bottom:10px">بعد إقفال شهر أو سنة (أو تقديم الإقرار الضريبي) اقفلها، فلا يمكن إضافة أو تعديل أو حذف أي مستند بتاريخ داخلها. كل التعديلات تُسجَّل في <a href="#/audit">سجل التعديلات</a>.</p>
      ${can('admin') ? html`<div class="inline" style="flex-wrap:wrap"><input class="inp" type="date" data-lock value="${s.lockDate || ''}" style="max-width:200px"><button class="btn btn-primary btn-sm" data-lock-save>قفل حتى هذا التاريخ</button>${s.lockDate ? html`<button class="btn btn-ghost btn-sm" data-lock-clear>فتح كل الفترات</button>` : ''}</div>`
        : html`<p class="small">تغيير القفل للمالك فقط.</p>`}</div>

    <div class="card" style="margin-top:14px"><div class="card-h"><h3>💾 النسخ الاحتياطي</h3><span class="muted small">${s.lastBackupAt ? 'آخر نسخة: ' + fmtDate(s.lastBackupAt.slice(0, 10)) : 'لم تنزّل نسخة بعد'}</span></div>
      <p class="muted small" style="margin-bottom:12px">بياناتك محفوظة في هذا المتصفح على هذا الجهاز فقط. نزّل نسخة احتياطية أسبوعياً على الأقل، واحفظها في مكان آمن (بريدك أو Google Drive). يمكنك استعادتها على أي جهاز.</p>
      <div class="actions"><button class="btn btn-primary" data-backup>⬇️ تنزيل نسخة احتياطية</button>
        ${store.usedFileIds().size ? html`<button class="btn btn-ghost" data-backup-full>🗂️ نسخة كاملة مع المرفقات (${store.usedFileIds().size})</button>` : ''}
        ${can('admin') ? html`<label class="btn btn-ghost">📂 استعادة من ملف<input type="file" accept=".json,.zip,application/json,application/zip" data-restore hidden></label>` : ''}</div>
      ${store.usedFileIds().size ? html`<p class="muted small" style="margin-top:8px">النسخة العادية (.json) فيها كل البيانات بدون صور المرفقات وحجمها صغير. النسخة الكاملة (.zip) فيها الصور كمان.</p>` : ''}
      <p class="muted small" style="margin-top:10px" data-storage></p></div>

    ${can('admin') ? html`<div class="card" style="margin-top:14px;border-color:var(--neg)"><div class="card-h"><h3>⚠️ منطقة الخطر</h3></div>
      <div class="actions"><button class="btn btn-ghost" data-demo>🧪 استبدال البيانات ببيانات تجريبية</button><button class="btn btn-danger" data-wipe>🗑️ حذف كل البيانات</button></div></div>` : ''}`);

  const form = $('[data-form]', root);
  const vatBox = $('[data-vat-box]', root);
  const syncVat = () => { vatBox.hidden = !form.vat.checked; };
  syncVat();
  form.vat.onchange = syncVat;
  form.addEventListener('input', () => { guard.dirty = true; });
  form.country.onchange = async () => {
    guard.dirty = true;
    const c = COUNTRIES[form.country.value];
    if (await confirmBox(`تطبيق إعدادات ${c.name} الافتراضية؟ العملة ${CURRENCIES[c.currency].name}، ${c.vatRate ? `والضريبة ${c.vatRate}%` : 'وبدون ضريبة'}.`, { ok: 'تطبيق', title: 'إعدادات الدولة' })) {
      form.currency.value = c.currency;
      form.vat.checked = c.vatRate > 0;
      if (c.vatRate) form.vatRate.value = c.vatRate;
      form.taxLabel.value = c.taxLabel;
      syncVat();
    }
  };

  // الشعار: يُصغَّر إلى 360 بكسل كحد أقصى
  let logo = s.logo || '';
  const img = $('[data-logo-img]', root);
  $('[data-logo]', root).onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const im = new Image();
      im.onload = () => {
        const k = Math.min(1, 360 / Math.max(im.width, im.height));
        const c = document.createElement('canvas');
        c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        logo = c.toDataURL(f.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9);
        img.src = logo; img.hidden = false; $('[data-logo-x]', root).hidden = false;
        guard.dirty = true;
      };
      im.onerror = () => toast('تعذّر قراءة الصورة', 'err');
      im.src = reader.result;
    };
    reader.readAsDataURL(f);
  };
  $('[data-logo-x]', root).onclick = () => { logo = ''; img.hidden = true; $('[data-logo-x]', root).hidden = true; guard.dirty = true; };

  form.onsubmit = (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    const errs = {};
    if (!String(v.name || '').trim()) errs.name = 'اكتب اسم المنشأة';
    const vatNo = String(v.vatNo || '').replace(/\s/g, '');
    if (form.vat.checked && vatNo && v.country === 'SA' && !validSaudiVat(vatNo)) errs.vatNo = 'الرقم الضريبي السعودي 15 رقماً يبدأ وينتهي بالرقم 3';
    if (!showErrors(form, errs)) return;
    store.saveSettings({
      name: v.name.trim(), crNo: (v.crNo || '').trim(), address: (v.address || '').trim(), phone: (v.phone || '').trim(), email: (v.email || '').trim(), logo,
      nameEn: (v.nameEn || '').trim(), addressEn: (v.addressEn || '').trim(), invoiceLang: v.invoiceLang === 'bi' ? 'bi' : 'ar',
      country: v.country, currency: v.currency, vat: form.vat.checked, vatNo, vatRate: form.vat.checked ? num(v.vatRate) : 0,
      taxLabel: (v.taxLabel || '').trim() || 'الضريبة', inclusive: form.inclusive.checked,
      salePrefix: (v.salePrefix ?? 'INV-').trim(), printSize: v.printSize, showHijri: form.showHijri.checked, invoiceNote: (v.invoiceNote || '').trim(),
      startDate: isDate(v.startDate) ? v.startDate : s.startDate, fiscalStartMonth: Number(v.fiscalStartMonth) || 1,
    });
    guard.dirty = false;
    window.dispatchEvent(new Event('acc:shell'));
    toast('تم حفظ الإعدادات ✓');
    go('#/settings');
  };

  const full = $('[data-backup-full]', root);
  if (full) full.onclick = async () => { full.disabled = true; try { await downloadFullBackup(); } finally { full.disabled = false; } };
  $('[data-backup]', root).onclick = (e) => {
    downloadBackup();
    const h = e.target.closest('.card').querySelector('.card-h .muted');
    if (h) h.textContent = 'آخر نسخة: ' + fmtDate(new Date().toISOString().slice(0, 10));
  };
  if (can('admin')) {
    $('[data-lock-save]', root).onclick = async () => {
      const v = $('[data-lock]', root).value;
      if (!isDate(v)) { toast('اختر تاريخ القفل', 'err'); return; }
      if (v > new Date().toISOString().slice(0, 10)) { toast('لا يمكن قفل فترة لم تنتهِ بعد', 'err'); return; }
      if (!(await confirmBox(`قفل كل المستندات حتى ${fmtDate(v)}؟ لن يمكن إضافة أو تعديل أو حذف مستند بتاريخ داخل هذه الفترة.`, { ok: 'قفل الفترة', title: 'قفل الفترة' }))) return;
      store.setLockDate(v);
      toast('تم قفل الفترة ✓');
      go('#/settings');
    };
    const clr = $('[data-lock-clear]', root);
    if (clr) clr.onclick = async () => {
      if (!(await confirmBox('فتح كل الفترات المقفلة للتعديل؟', { ok: 'فتح الفترات', danger: true }))) return;
      store.setLockDate('');
      toast('تم فتح الفترات');
      go('#/settings');
    };
    $('[data-restore]', root).onchange = (e) => restoreFile(e.target.files[0]);
    $('[data-demo]', root).onclick = () => loadDemo();
    $('[data-wipe]', root).onclick = async () => {
      if (!(await confirmBox('سيتم حذف كل بيانات المنشأة من هذا الجهاز نهائياً: الفواتير والعملاء والمنتجات والقيود. لا يمكن التراجع إلا من نسخة احتياطية.', { ok: 'حذف كل شيء', danger: true, title: 'حذف كل البيانات' }))) return;
      if (!(await confirmBox('تأكيد أخير: هل نزّلت نسخة احتياطية؟ سيُحذف كل شيء الآن.', { ok: 'نعم، احذف', danger: true, title: 'تأكيد الحذف' }))) return;
      await store.wipe();
      guard.dirty = false;
      window.dispatchEvent(new Event('acc:shell'));
      toast('تم حذف كل البيانات');
      go('#/welcome');
    };
  }

  // المستودعات والفروع
  const nameDialog = (title, value = '') => modal({
    title,
    body: html`<form novalidate>${field('الاسم', html`<input class="inp" name="n" value="${value}" autofocus>`)}<div class="dlg-actions"><button class="btn btn-primary">حفظ</button></div></form>`,
    onMount: (dlg, done) => { const f = $('form', dlg); f.onsubmit = (e) => { e.preventDefault(); if (f.n.value.trim()) done(f.n.value.trim()); }; },
  });
  root.addEventListener('click', async (e) => {
    const add = e.target.closest('[data-add]');
    const ren = e.target.closest('[data-rename]');
    const rm = e.target.closest('[data-remove]');
    const def = e.target.closest('[data-default]');
    if (add) {
      const kind = add.dataset.add;
      const name = await nameDialog(kind === 'warehouses' ? 'مستودع جديد' : 'فرع جديد');
      if (!name) return;
      // أول مستودع: الكميات الحالية تبقى في «المستودع الرئيسي»
      if (kind === 'warehouses' && !store.getDb().warehouses.length) store.saveListItem('warehouses', { id: 'main', name: 'المستودع الرئيسي' });
      store.saveListItem(kind, { name });
      toast('تمت الإضافة ✓'); window.dispatchEvent(new Event('acc:shell')); go('#/settings');
    } else if (ren) {
      const [kind, id] = ren.dataset.rename.split(':');
      const item = store.getDb()[kind].find((x) => x.id === id);
      const name = await nameDialog('إعادة تسمية', item.name);
      if (name) { store.saveListItem(kind, { id, name }); go('#/settings'); }
    } else if (rm) {
      const [kind, id] = rm.dataset.remove.split(':');
      if (!(await confirmBox('حذف هذا العنصر؟', { ok: 'حذف', danger: true }))) return;
      try { store.deleteListItem(kind, id); window.dispatchEvent(new Event('acc:shell')); go('#/settings'); } catch (err) { toast(err.message, 'err'); }
    } else if (def) { store.saveSettings({ defaultWh: def.dataset.default }); go('#/settings'); }
    else if (e.target.closest('[data-payroll-reset]')) { store.saveSettings({ payroll: null }); toast('تمت الاستعادة'); go('#/settings'); }
  });
  $('[data-payroll]', root).onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    const v = { citizenEmp: num(f.citizenEmp.value), citizenCo: num(f.citizenCo.value), expatEmp: num(f.expatEmp.value), expatCo: num(f.expatCo.value), cap: num(f.cap.value), base: f.base.value };
    if (Object.values(v).some((x) => typeof x === 'number' && (x < 0 || x > 100000))) { toast('نسب غير صحيحة', 'err'); return; }
    store.saveSettings({ payroll: v });
    toast('تم حفظ النسب ✓');
    go('#/settings');
  };

  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then((e) => {
      const used = (e.usage || 0) / 1048576;
      const quota = (e.quota || 0) / 1048576;
      const el = $('[data-storage]', root);
      if (el && quota) el.textContent = `المساحة المستخدمة في المتصفح: ${used.toFixed(1)} ميغابايت من ${quota > 1024 ? (quota / 1024).toFixed(0) + ' غيغابايت' : quota.toFixed(0) + ' ميغابايت'} متاحة.`;
    }).catch(() => {});
  }
}
