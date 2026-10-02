// ═══ المرفقات: صور الإيصالات والفواتير وملفات PDF على المستندات ═══
// الملف نفسه في IndexedDB (store.putFile)، والمستند يحمل وصفه فقط
import * as store from '../store.js';
import { can } from '../auth.js';
import { html, toast, modal, confirmBox, $, $$ } from '../ui.js';

const MAX_SIZE = 5 * 1024 * 1024;
const SAFE = /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/;
export const isImage = (f) => /^image\/(jpeg|png|webp|gif)$/.test(f.type || '');
export const sizeText = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' م.ب' : Math.max(1, Math.round(n / 1024)) + ' ك.ب');

// الصورة كما تظهر (مع اتجاه الكاميرا)
export async function loadBitmap(blob) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (e) { /* نجرب عنصر الصورة */ }
  }
  const url = URL.createObjectURL(blob);
  try { const img = new Image(); img.src = url; await img.decode(); return img; } finally { URL.revokeObjectURL(url); }
}

// لوحة رسم بحجم أقصى للضلع الأطول (للضغط ولقراءة الرموز والنص)
export async function toCanvas(blob, max, { crop } = {}) {
  const bmp = await loadBitmap(blob);
  const sx = crop ? Math.round(bmp.width * crop[0]) : 0, sy = crop ? Math.round(bmp.height * crop[1]) : 0;
  const sw = crop ? Math.round(bmp.width * crop[2]) : bmp.width, sh = crop ? Math.round(bmp.height * crop[3]) : bmp.height;
  const scale = Math.min(max / Math.max(sw, sh), 4);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * scale)); c.height = Math.max(1, Math.round(sh * scale));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  return c;
}
const canvasBlob = (c, type = 'image/jpeg', q = 0.8) => new Promise((r) => c.toBlob(r, type, q));

// تصغير الصورة إلى JPEG بضلع أقصاه 1600 بكسل: الإيصال يبقى مقروءاً والحجم بحدود 200 كيلوبايت
export async function compressImage(file) {
  const c = await toCanvas(file, 1600);
  const scale = Math.min(1, 1600 / Math.max(c.width, c.height));
  if (scale < 1) return file;
  const blob = await canvasBlob(c, 'image/jpeg', 0.8);
  return blob && (blob.size < file.size || file.type !== 'image/jpeg') ? blob : file;
}

// يحفظ ملفاً مرفوعاً ويرجّع وصفه
export async function saveUpload(file) {
  if (!store.filesSupported()) throw new Error('المرفقات غير متاحة في هذا المتصفح (ربما التصفح الخاص)');
  let blob = file, type = file.type || '', name = file.name || 'مرفق';
  if (/^image\//.test(type) && type !== 'image/gif') {
    try { blob = await compressImage(file); } catch (e) { blob = file; }
    if (blob !== file) { type = 'image/jpeg'; name = name.replace(/\.[^./]+$/, '') + '.jpg'; }
  }
  if (!SAFE.test(type)) throw new Error(`«${name}»: نرفق الصور (JPG/PNG) وملفات PDF فقط`);
  if (blob.size > MAX_SIZE) throw new Error(`«${name}» أكبر من 5 ميغا`);
  return store.putFile({ id: store.newId(), name: name.slice(0, 120), type, size: blob.size }, blob);
}
export async function saveUploads(list) {
  const out = [];
  for (const f of list) {
    try { out.push(await saveUpload(f)); } catch (e) { toast(e.message, 'err'); }
  }
  return out;
}

// روابط العرض تبقى طوال الجلسة (الملف لا يتغير بعد حفظه)، وتُفرَّغ عند استبدال البيانات (استعادة أو حذف)
const urls = new Map();
if (typeof window !== 'undefined') window.addEventListener('acc:shell', () => { urls.forEach((u) => URL.revokeObjectURL(u)); urls.clear(); });
export async function fileURL(f) {
  if (urls.has(f.id)) return urls.get(f.id);
  let blob = null;
  try { blob = await store.getFile(f.id); } catch (e) { /* لا يوجد تخزين */ }
  if (!blob) return null;
  const u = URL.createObjectURL(SAFE.test(blob.type) ? blob : new Blob([blob], { type: 'application/octet-stream' }));
  urls.set(f.id, u);
  return u;
}

export async function openFile(f) {
  const u = await fileURL(f);
  if (!u) { toast('الملف غير موجود على هذا الجهاز (ربما استعدت نسخة احتياطية بدون مرفقات)', 'warn'); return; }
  modal({
    title: f.name,
    wide: isImage(f),
    body: html`${isImage(f) ? html`<div class="att-view"><img src="${u}" alt="${f.name}"></div>` : html`<p class="dlg-msg">📄 ${f.name} · ${sizeText(f.size)}</p>`}
      <div class="dlg-actions">${isImage(f) ? '' : html`<a class="btn btn-primary" href="${u}" target="_blank" rel="noopener">فتح الملف</a>`}<a class="btn btn-ghost" href="${u}" download="${f.name}">⬇️ تنزيل</a></div>`,
  });
}

export const addButtons = () => html`<label class="btn btn-ghost btn-sm">📷 تصوير<input type="file" accept="image/*" capture="environment" data-att-add hidden></label>
  <label class="btn btn-ghost btn-sm">📎 إرفاق ملف<input type="file" accept="image/*,application/pdf" multiple data-att-add hidden></label>`;

export function filesGrid(files, { del = false } = {}) {
  return html`<div class="att-grid">${files.map((f) => html`<div class="att">
    <button type="button" class="att-open" data-att-open="${f.id}" title="${f.name}">${isImage(f) ? html`<img alt="${f.name}" data-thumb="${f.id}">` : html`<span class="att-ic">📄</span>`}<small>${f.name}</small></button>
    ${del ? html`<button type="button" class="icon-btn att-del" data-att-rm="${f.id}" aria-label="إزالة المرفق">✕</button>` : ''}</div>`)}</div>`;
}

export async function hydrate(root, files) {
  for (const img of $$('img[data-thumb]', root)) {
    if (img.getAttribute('src')) continue;
    const f = files.find((x) => x.id === img.dataset.thumb);
    const u = f && (await fileURL(f));
    if (u) img.src = u;
    else img.closest('.att')?.classList.add('att-missing');
  }
}

// بطاقة المرفقات: get() يرجّع القائمة الحالية، و set(list) يحفظها (المستند المحفوظ) أو يحدّث النموذج
// المستند المقفل: يمكن إضافة إثبات له، لا إزالة شيء منه
export function filesCard(files, { add = true, hint = '' } = {}) {
  return html`<div class="card att-card" data-att><div class="card-h"><h3>📎 المرفقات${files.length ? html` <span class="muted small">(${files.length})</span>` : ''}</h3>
    ${add && store.filesSupported() ? html`<div class="inline">${addButtons()}</div>` : ''}</div>
    ${files.length ? filesGrid(files, { del: true }) : html`<p class="muted small">${hint || 'أرفق صورة الفاتورة أو الإيصال أو ملف PDF، وبتنحفظ مع المستند على هذا الجهاز.'}</p>`}</div>`;
}

export function bindFiles(root, { get, set, canDel = () => true, add = true, hint = '' }) {
  const box = () => $('[data-att]', root);
  const draw = () => {
    const files = get();
    const el = box();
    if (!el) return;
    el.outerHTML = String(filesCard(files, { add, hint }));
    if (!canDel()) $$('[data-att-rm]', box()).forEach((b) => b.remove());
    hydrate(box(), files);
  };
  root.addEventListener('change', async (e) => {
    if (!e.target.matches('[data-att-add]')) return;
    const list = [...e.target.files];
    e.target.value = '';
    if (!list.length) return;
    const added = await saveUploads(list);
    if (!added.length) return;
    await set([...get(), ...added]);
    toast(added.length === 1 ? 'تم إرفاق الملف ✓' : `تم إرفاق ${added.length} ملفات ✓`);
    draw();
  });
  root.addEventListener('click', async (e) => {
    const o = e.target.closest('[data-att-open]');
    if (o) { const f = get().find((x) => x.id === o.dataset.attOpen); if (f) openFile(f); return; }
    const rm = e.target.closest('[data-att-rm]');
    if (!rm) return;
    const f = get().find((x) => x.id === rm.dataset.attRm);
    if (!f || !(await confirmBox(`إزالة المرفق «${f.name}»؟`, { ok: 'إزالة', danger: true }))) return;
    await set(get().filter((x) => x.id !== f.id), f);
    draw();
  });
  draw();
  return { draw };
}

// على صفحة مستند محفوظ: الحفظ فوري ويُسجَّل في سجل التعديلات. الإزالة لمن يملك التعديل وخارج الفترة المقفلة
export function bindDocFiles(root, d, { locked = false } = {}) {
  return bindFiles(root, {
    get: () => store.findDoc(d.id)?.files || [],
    set: async (files, removed) => {
      store.patchDoc(d.id, { files }, { log: true });
      if (removed) store.deleteFiles([removed.id]).catch(() => {});
    },
    canDel: () => !locked && can('edit'),
  });
}
