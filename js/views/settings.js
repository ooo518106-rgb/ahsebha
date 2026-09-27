// ═══ الإعدادات: المنشأة، الضريبة والعملة، الفواتير، السنة المالية، النسخ الاحتياطي ═══
import * as store from '../store.js';
import { COUNTRIES, CURRENCIES, validSaudiVat, isDate, num } from '../core.js';
import { html, raw, fmtDate, toast, confirmBox, $, showErrors, field, MONTHS, attr } from '../ui.js';
import { go, guard, setTitle } from '../nav.js';
import { head, S } from './common.js';
import { downloadBackup, restoreFile, loadDemo } from './home.js';

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

    <div class="card" style="margin-top:14px"><div class="card-h"><h3>💾 النسخ الاحتياطي</h3><span class="muted small">${s.lastBackupAt ? 'آخر نسخة: ' + fmtDate(s.lastBackupAt.slice(0, 10)) : 'لم تنزّل نسخة بعد'}</span></div>
      <p class="muted small" style="margin-bottom:12px">بياناتك محفوظة في هذا المتصفح على هذا الجهاز فقط. نزّل نسخة احتياطية أسبوعياً على الأقل، واحفظها في مكان آمن (بريدك أو Google Drive). يمكنك استعادتها على أي جهاز.</p>
      <div class="actions"><button class="btn btn-primary" data-backup>⬇️ تنزيل نسخة احتياطية</button>
        <label class="btn btn-ghost">📂 استعادة من ملف<input type="file" accept=".json,application/json" data-restore hidden></label></div>
      <p class="muted small" style="margin-top:10px" data-storage></p></div>

    <div class="card" style="margin-top:14px;border-color:var(--neg)"><div class="card-h"><h3>⚠️ منطقة الخطر</h3></div>
      <div class="actions"><button class="btn btn-ghost" data-demo>🧪 استبدال البيانات ببيانات تجريبية</button><button class="btn btn-danger" data-wipe>🗑️ حذف كل البيانات</button></div></div>`);

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

  $('[data-backup]', root).onclick = (e) => {
    downloadBackup();
    const h = e.target.closest('.card').querySelector('.card-h .muted');
    if (h) h.textContent = 'آخر نسخة: ' + fmtDate(new Date().toISOString().slice(0, 10));
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

  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then((e) => {
      const used = (e.usage || 0) / 1048576;
      const quota = (e.quota || 0) / 1048576;
      const el = $('[data-storage]', root);
      if (el && quota) el.textContent = `المساحة المستخدمة في المتصفح: ${used.toFixed(1)} ميغابايت من ${quota > 1024 ? (quota / 1024).toFixed(0) + ' غيغابايت' : quota.toFixed(0) + ' ميغابايت'} متاحة.`;
    }).catch(() => {});
  }
}
