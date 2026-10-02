// ═══ قراءة الإيصال بالكاميرا: رمز QR الضريبي أولاً (دقيق)، وإلا قراءة النص من الصورة على الجهاز نفسه ═══
import * as store from '../store.js';
import { DOC_TYPES, docNo } from '../core.js';
import { parseZatcaQR, extractReceipt, matchSupplier, lastExpenseFrom, findDuplicate, scanMeta } from '../receipt.js';
import { startCameraScan, loadZxing } from '../barcode.js';
import { html, modal, toast, money, fmtDate, $, $$ } from '../ui.js';
import { go, guard, docHref } from '../nav.js';
import { toCanvas, saveUpload, sizeText } from './attach.js';
import { today, S } from './common.js';

// ─── رمز QR من صورة ───
export async function qrFromImage(blob) {
  const read = (t) => parseZatcaQR(t, { today: today() });
  // الرمز غالباً أسفل الإيصال: نجرب الصورة كاملة ثم النصف السفلي بدقة أعلى ثم العلوي
  const tries = [[1400], [1000], [1800, [0, 0.45, 1, 0.55]], [2400], [1800, [0, 0, 1, 0.55]]];
  if ('BarcodeDetector' in window) {
    try {
      if ((await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
        const det = new window.BarcodeDetector({ formats: ['qr_code'] });
        for (const [max, crop] of tries.slice(2, 4).concat([[1400]])) {
          for (const f of await det.detect(await toCanvas(blob, max, { crop }))) { const r = read(f.rawValue); if (r) return r; }
        }
      }
    } catch (e) { /* نجرب zxing */ }
  }
  const ZXing = await loadZxing();
  const hints = new Map([[ZXing.DecodeHintType.TRY_HARDER, true]]);
  for (const [max, crop] of tries) {
    try {
      const lum = new ZXing.HTMLCanvasElementLuminanceSource(await toCanvas(blob, max, { crop }));
      const r = read(new ZXing.QRCodeReader().decode(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum)), hints).getText());
      if (r) return r;
    } catch (e) { /* لا رمز بهذا الحجم */ }
  }
  return null;
}

// ─── قراءة النص (Tesseract، بالعربي والإنجليزي، كله على الجهاز ومن ملفات البرنامج نفسه) ───
const OCR = new URL('../../vendor/ocr/', import.meta.url).href;
let tessLoading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!tessLoading) {
    tessLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = OCR + 'tesseract.min.js';
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => { tessLoading = null; s.remove(); reject(new Error('تعذّر تحميل محرك قراءة النص. تأكد من الاتصال بالإنترنت')); };
      document.head.append(s);
    });
  }
  return tessLoading;
}
// دعم SIMD في WebAssembly (أسرع)؛ الأجهزة القديمة تأخذ النسخة العادية
const simd = () => { try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); } catch (e) { return false; } };
const STEPS = { 'loading tesseract core': 'تحميل محرك القراءة', 'loading language traineddata': 'تحميل العربي والإنجليزي', 'initializing api': 'تجهيز المحرك', 'recognizing text': 'قراءة النص' };
export async function ocrImage(blob, onProgress = () => {}) {
  const T = await loadTesseract();
  const worker = await T.createWorker('ara+eng', 1, {
    workerPath: OCR + 'worker.min.js', workerBlobURL: false, langPath: OCR, cacheMethod: 'none',
    corePath: OCR + (simd() ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js'),
    logger: (m) => onProgress(STEPS[m.status] || '', m.progress || 0),
  });
  try {
    const { data } = await worker.recognize(await toCanvas(blob, 2000));
    return data.text || '';
  } finally { worker.terminate(); }
}

// ─── نافذة القراءة ───
// ترجع { info, files: [وصف المرفق], supplier } أو null
export function receiptDialog({ forType = 'expense', file: given = null } = {}) {
  const target = forType === 'purchase' ? 'الفاتورة' : 'المصروف';
  let stopCam = null;
  let closed = false;
  return modal({
    title: '📷 قراءة إيصال',
    wide: true,
    body: html`<div class="scan">
      <div data-step="pick">
        <p class="muted" style="margin-bottom:12px">صوّر الفاتورة أو الإيصال: البرنامج بيقرا رمز QR الضريبي (الأدق) أو النص المكتوب، وبيعبّي ${target} وبيرفق الصورة. القراءة كلها على جهازك.</p>
        <div class="scan-actions">
          <label class="btn btn-primary">📷 صوّر الإيصال<input type="file" accept="image/*" capture="environment" data-file hidden></label>
          <label class="btn btn-ghost">🖼️ صورة أو PDF من الجهاز<input type="file" accept="image/*,application/pdf" data-file hidden></label>
          <button type="button" class="btn btn-ghost" data-live>🔳 امسح رمز QR مباشرة</button>
        </div></div>
      <div data-step="live" hidden><div class="scan-video"><video playsinline muted></video></div>
        <p class="muted small" style="margin:8px 0">وجّه الكاميرا على رمز QR أسفل الفاتورة</p><button type="button" class="btn btn-ghost btn-sm" data-back>رجوع</button></div>
      <div data-step="work" hidden><div class="scan-row"><img class="scan-prev" data-prev alt="">
        <div class="grow"><p data-status>…</p><div class="scan-bar"><i data-bar></i></div><p class="muted small" data-hint style="margin-top:8px"></p></div></div></div>
      <div data-step="result" hidden></div>
    </div>`,
    onMount: (dlg, done) => {
      dlg.addEventListener('close', () => { closed = true; if (stopCam) stopCam(); });
      const step = (name) => $$('[data-step]', dlg).forEach((el) => { el.hidden = el.dataset.step !== name; });
      const status = (t, p) => {
        $('[data-status]', dlg).textContent = t;
        $('[data-bar]', dlg).style.width = p == null ? '15%' : Math.round(p * 100) + '%';
        $('[data-bar]', dlg).classList.toggle('busy', p == null);
      };

      async function process(file) {
        step('work');
        const prev = $('[data-prev]', dlg);
        if (/^image\//.test(file.type)) { prev.src = URL.createObjectURL(file); prev.hidden = false; } else prev.hidden = true;
        if (!/^image\//.test(file.type)) return result(null, file, '', 'ما منقدر نقرا ملفات PDF. الملف رح ينرفق، وعبّي القيم بإيدك.');
        status('بدوّر على رمز QR الضريبي…', null);
        let info = null;
        try { info = await qrFromImage(file); } catch (e) { /* نكمل بقراءة النص */ }
        if (closed) return;
        if (info) return result(info, file);
        status('ما في رمز QR واضح. عم نقرا النص المكتوب…', 0);
        $('[data-hint]', dlg).textContent = 'أول مرة بيتحمّل محرك القراءة (حوالي 12 ميغا) وبعدها بيشتغل بدون إنترنت.';
        let text = '';
        try {
          text = await ocrImage(file, (label, p) => { if (!closed && label) status(label + '…', p); });
        } catch (e) {
          if (closed) return;
          return result(null, file, '', e.message || 'تعذّرت قراءة النص');
        }
        if (closed) return;
        info = extractReceipt(text, { today: today() });
        if (info.total == null && !info.date && !info.vat) return result(null, file, text, 'ما قدرنا نطلع قيم واضحة من الصورة. جرّب صورة أوضح (إضاءة جيدة والإيصال مسطّح)، أو عبّي القيم بإيدك.');
        result(info, file, text);
      }

      function result(info, file, text = '', problem = '') {
        step('result');
        const db = store.getDb();
        const party = info ? matchSupplier(db, info) : null;
        const dup = info ? findDuplicate(db, info) : null;
        const s = S();
        const rate = Number(s.vatRate) || 0;
        const expected = info && info.total != null && rate ? Math.round((info.total * rate / (100 + rate)) * 100) / 100 : null;
        const taxOff = info && info.tax != null && expected != null && info.tax > 0 && Math.abs(info.tax - expected) > 0.05;
        const row = (label, value, ok = true) => (value === '' || value == null ? '' : html`<tr><th>${label}</th><td>${value}${ok ? '' : html` <span class="badge badge-warn">راجعها</span>`}</td></tr>`);
        $('[data-step="result"]', dlg).innerHTML = String(html`
          ${problem ? html`<p class="note note-warn" style="margin-bottom:12px">${problem}</p>`
            : info.kind === 'qr' ? html`<p class="note note-ok" style="margin-bottom:12px">✅ قرأنا رمز QR الضريبي — القيم مطابقة للفاتورة${info.signed ? ' (موقّعة إلكترونياً)' : ''}.</p>`
              : html`<p class="note note-warn" style="margin-bottom:12px">⚠️ قرأنا النص من الصورة. راجع القيم قبل الحفظ.</p>`}
          ${dup ? html`<p class="note note-bad" style="margin-bottom:12px">يبدو إنه هالإيصال مسجّل من قبل: <a href="${docHref(dup)}" target="_blank" rel="noopener">${DOC_TYPES[dup.type].name} ${docNo(dup, s)}</a> بتاريخ ${fmtDate(dup.date)}.</p>` : ''}
          ${info ? html`<div class="tbl-wrap"><table class="tbl scan-tbl"><tbody>
            ${row('البائع', info.seller ? html`${info.seller}${party ? html` <span class="badge badge-ok">مورد مسجّل: ${party.name}</span>` : ''}` : party ? party.name : '')}
            ${row('الرقم الضريبي', info.vat ? html`<span dir="ltr">${info.vat}</span>` : '')}
            ${row('التاريخ', info.date ? `${fmtDate(info.date)}${info.time ? ' ' + info.time : ''}` : '')}
            ${row('رقم الفاتورة', info.ref ? html`<span dir="ltr">${info.ref}</span>` : '')}
            ${row('الإجمالي شامل الضريبة', info.total != null ? money(info.total, { sym: true }) : '', info.kind === 'qr' || info.sure.total)}
            ${row(s.taxLabel || 'الضريبة', info.tax != null ? money(info.tax, { sym: true }) : '', !taxOff && (info.kind === 'qr' || info.sure.tax))}
          </tbody></table></div>
          ${taxOff ? html`<p class="muted small" style="margin-top:6px">الضريبة بالإيصال مختلفة عن ${rate}% من الإجمالي (${money(expected)}) — يمكن فيه أصناف معفاة. بنعبّي الإجمالي شامل الضريبة، وعدّل إذا لزم.</p>` : ''}
          ${!party && info.seller ? html`<label class="check" style="margin-top:10px"><input type="checkbox" data-add-sup ${forType === 'purchase' ? 'checked' : ''}> أضف «${info.seller}» لقائمة الموردين${info.vat ? ' مع رقمه الضريبي' : ''}</label>` : ''}` : ''}
          ${text ? html`<details style="margin-top:10px"><summary class="muted small" style="cursor:pointer">النص المقروء من الصورة</summary><pre class="scan-text" dir="auto">${text}</pre></details>` : ''}
          ${file ? html`<p class="muted small" style="margin-top:10px">📎 الصورة رح تنرفق مع ${target} (${sizeText(file.size)} قبل الضغط).</p>` : ''}
          <div class="dlg-actions">
            ${info ? html`<button type="button" class="btn btn-primary" data-apply>✓ تعبئة ${target}</button>` : file ? html`<button type="button" class="btn btn-primary" data-apply>📎 إرفاق ${/^image\//.test(file.type) ? 'الصورة' : 'الملف'} فقط</button>` : ''}
            <button type="button" class="btn btn-ghost" data-again>صورة ثانية</button></div>`);
        $('[data-again]', dlg).onclick = () => step('pick');
        const ap = $('[data-apply]', dlg);
        if (ap) ap.onclick = async () => {
          ap.disabled = true;
          let files = [];
          if (file) {
            try { files = [await saveUpload(file)]; } catch (e) { toast(e.message, 'warn'); }
          }
          const sup = $('[data-add-sup]', dlg);
          done({ info, files, supplier: sup && sup.checked ? { name: info.seller, vatNo: info.vat || '' } : null });
        };
      }

      $$('[data-file]', dlg).forEach((inp) => { inp.onchange = () => { const f = inp.files[0]; inp.value = ''; if (f) process(f); }; });
      $('[data-back]', dlg).onclick = () => { if (stopCam) { stopCam(); stopCam = null; } step('pick'); };
      $('[data-live]', dlg).onclick = async () => {
        step('live');
        const video = $('video', dlg);
        try {
          stopCam = await startCameraScan(video, async (code) => {
            const info = parseZatcaQR(code, { today: today() });
            if (!info) { toast('هذا الرمز مش رمز فاتورة ضريبية', 'warn'); return; }
            // صورة من الكاميرا لحظة القراءة تنحفظ كمرفق
            let shot = null;
            try {
              const c = document.createElement('canvas');
              c.width = video.videoWidth; c.height = video.videoHeight;
              c.getContext('2d').drawImage(video, 0, 0);
              const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
              if (b) shot = new File([b], 'receipt-qr.jpg', { type: 'image/jpeg' });
            } catch (e) { /* بدون صورة */ }
            if (stopCam) { stopCam(); stopCam = null; }
            result(info, shot);
          });
        } catch (e) {
          toast('ما قدرنا نفتح الكاميرا. اسمح للمتصفح باستخدامها أو صوّر الإيصال بدلها', 'err');
          step('pick');
        }
      };
      if (given) process(given);
    },
  });
}

// ─── تعبئة النماذج: مسودة تنتقل للنموذج عبر الرابط ───
let draft = null;
export function takeDraft(token) {
  if (!draft || draft.token !== token) return null;
  const d = draft.d;
  draft = null;
  return d;
}
function openDraft(path, d) {
  draft = { token: Math.random().toString(36).slice(2, 10), d };
  guard.dirty = false;
  go(`${path}?draft=${draft.token}`);
}
function supplierOf(res) {
  const db = store.getDb();
  const found = res.info ? matchSupplier(db, res.info) : null;
  if (found || !res.supplier) return found;
  return store.saveParty({ kind: 'supplier', name: res.supplier.name, phone: '', vatNo: res.supplier.vatNo, opening: 0 });
}

// d: حالة نموذج المصروف الحالية
export async function scanForExpense(d, { file } = {}) {
  const res = await receiptDialog({ forType: 'expense', file });
  if (!res) return;
  const x = { ...d, files: [...(d.files || []), ...res.files] };
  const info = res.info;
  if (info) {
    const p = supplierOf(res);
    const last = lastExpenseFrom(store.getDb(), { party: p && p.id, vat: info.vat, payee: info.seller });
    if (info.date) x.date = info.date;
    if (info.total != null) { x.amount = info.total; x.inclusive = true; }
    if (S().vat) x.tax = info.kind === 'qr' && info.tax === 0 ? 'Z' : 'S';
    if (p) { x.party = p.id; x.payee = ''; x.payeeVat = ''; } else { x.party = null; x.payee = info.seller || x.payee || ''; x.payeeVat = info.vat || ''; }
    if (info.ref) x.ref = info.ref;
    if (last) {
      if (!x.account) x.account = last.account;
      if (!x.cc && last.cc) x.cc = last.cc;
      x._pay = last.payAcc || '';
    }
    x.scan = scanMeta(info);
  }
  openDraft('#/expenses/new', x);
}

export async function scanForPurchase(d, { file } = {}) {
  const res = await receiptDialog({ forType: 'purchase', file });
  if (!res) return;
  const x = { ...d, files: [...(d.files || []), ...res.files] };
  const info = res.info;
  if (info) {
    const p = supplierOf(res);
    if (p) x.party = p.id;
    if (info.date) x.date = info.date;
    if (info.ref) x.ref = info.ref;
    x.scan = scanMeta(info);
  }
  openDraft('#/purchases/new', x);
}

// مقارنة المبلغ المسجّل مع الإيصال المقروء
export function receiptCheck(scan, t) {
  if (!scan || scan.total == null) return '';
  const ok = Math.abs(t.total - scan.total) < 0.01;
  const state = !t.total ? ['muted', 'أدخل البنود حتى يطابقها الإجمالي'] : ok ? ['pos', '✓ مطابق'] : ['neg', 'المبلغ مختلف عن الإيصال'];
  return html`<p class="small ${state[0]}" style="margin-top:8px">🧾 الإيصال${scan.kind === 'qr' ? ' (QR)' : ''}: ${money(scan.total, { sym: true })}${scan.tax ? html` منها ضريبة ${money(scan.tax)}` : ''} — ${state[1]}</p>`;
}
