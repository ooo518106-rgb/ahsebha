// ═══ الاستيراد من Excel: تعريف الأعمدة، التعرّف على العناوين، ومطابقة السجلات الموجودة ═══
// دوال نقية بلا DOM حتى تُختبر في Node.
import { num, round } from './core.js';
import { isEan13, code128Supported } from './barcode.js';

// تطبيع عنوان العمود: حروف صغيرة، بلا مسافات أو رموز، وتوحيد الهمزات
export const normKey = (s) => String(s ?? '').toLowerCase()
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ً-ْـ]/g, '')
  .split(/[\s_\-.:()/\\#*]+/).map((w) => w.replace(/^ال(?=\S{3})/, '')).join('');

const PRODUCT_FIELDS = [
  { k: 'name', t: 'الاسم', req: true, syn: ['اسم', 'اسم المنتج', 'اسم الصنف', 'صنف', 'منتج', 'البيان', 'name', 'product', 'product name', 'item', 'item name', 'description'] },
  { k: 'nameEn', t: 'الاسم بالإنجليزي', syn: ['الاسم بالانجليزي', 'اسم انجليزي', 'الاسم الانجليزي', 'english name', 'name en', 'name english'] },
  { k: 'barcode', t: 'الباركود', syn: ['باركود', 'الباركود', 'barcode', 'bar code', 'ean', 'upc', 'gtin'] },
  { k: 'sku', t: 'الرمز (SKU)', syn: ['رمز', 'الرمز', 'كود', 'رقم الصنف', 'كود الصنف', 'sku', 'code', 'item code', 'ref'] },
  { k: 'category', t: 'التصنيف', syn: ['تصنيف', 'التصنيف', 'الفئه', 'فئه', 'القسم', 'قسم', 'مجموعه', 'category', 'group', 'department'] },
  { k: 'type', t: 'النوع (منتج / خدمة)', syn: ['نوع', 'النوع', 'type', 'kind'] },
  { k: 'unit', t: 'الوحدة', syn: ['وحده', 'الوحده', 'unit', 'uom'] },
  { k: 'price', t: 'سعر البيع', num: true, syn: ['سعر البيع', 'سعر', 'السعر', 'price', 'sale price', 'selling price', 'sales price', 'retail price'] },
  { k: 'cost', t: 'سعر الشراء (التكلفة)', num: true, syn: ['سعر الشراء', 'التكلفه', 'تكلفه', 'سعر التكلفه', 'cost', 'purchase price', 'buy price', 'cost price'] },
  { k: 'openQty', t: 'الكمية الافتتاحية', num: true, syn: ['كميه', 'الكميه', 'الكميه الافتتاحيه', 'الرصيد', 'رصيد', 'المخزون', 'qty', 'quantity', 'stock', 'on hand', 'opening qty'] },
  { k: 'reorder', t: 'حد إعادة الطلب', num: true, syn: ['حد الطلب', 'حد اعاده الطلب', 'الحد الادني', 'reorder', 'reorder level', 'min', 'minimum'] },
  { k: 'tax', t: 'الضريبة (خاضع / صفري / معفى)', syn: ['ضريبه', 'الضريبه', 'tax', 'vat', 'tax category'] },
];
const partyFields = (kind) => [
  { k: 'name', t: 'الاسم', req: true, syn: ['اسم', 'الاسم', kind === 'customer' ? 'اسم العميل' : 'اسم المورد', kind === 'customer' ? 'العميل' : 'المورد', 'name', kind === 'customer' ? 'customer' : 'supplier', 'company'] },
  { k: 'nameEn', t: 'الاسم بالإنجليزي', syn: ['الاسم بالانجليزي', 'اسم انجليزي', 'english name', 'name en'] },
  { k: 'phone', t: 'الجوال', syn: ['جوال', 'الجوال', 'هاتف', 'الهاتف', 'رقم الجوال', 'موبايل', 'phone', 'mobile', 'tel', 'telephone', 'whatsapp'] },
  { k: 'email', t: 'البريد الإلكتروني', syn: ['بريد', 'البريد', 'البريد الالكتروني', 'ايميل', 'email', 'e-mail', 'mail'] },
  { k: 'vatNo', t: 'الرقم الضريبي', syn: ['رقم ضريبي', 'الرقم الضريبي', 'الرقم الضريبي للعميل', 'vat', 'vat no', 'vat number', 'tax number', 'trn'] },
  { k: 'crNo', t: 'السجل التجاري', syn: ['سجل تجاري', 'السجل التجاري', 'cr', 'cr no', 'commercial register'] },
  { k: 'address', t: 'العنوان', syn: ['عنوان', 'العنوان', 'المدينه', 'address', 'city'] },
  { k: 'opening', t: kind === 'customer' ? 'الرصيد الافتتاحي (عليه لكم)' : 'الرصيد الافتتاحي (له عليكم)', num: true, syn: ['رصيد', 'الرصيد', 'الرصيد الافتتاحي', 'رصيد افتتاحي', 'balance', 'opening', 'opening balance'] },
  { k: 'notes', t: 'ملاحظات', syn: ['ملاحظات', 'ملاحظه', 'notes', 'note', 'remarks'] },
];

export const IMPORT_TYPES = {
  products: { name: 'المنتجات والخدمات', one: 'منتج', fields: PRODUCT_FIELDS, list: '#/products' },
  customers: { name: 'العملاء', one: 'عميل', kind: 'customer', fields: partyFields('customer'), list: '#/customers' },
  suppliers: { name: 'الموردون', one: 'مورد', kind: 'supplier', fields: partyFields('supplier'), list: '#/suppliers' },
};

// يحدد عمود كل حقل من عناوين الصف الأول: تطابق كامل أولاً، ثم احتواء
export function guessMapping(headers, type) {
  const fields = IMPORT_TYPES[type].fields;
  const keys = headers.map(normKey);
  const map = {};
  const used = new Set();
  const pick = (f, test) => {
    if (map[f.k] != null) return;
    const i = keys.findIndex((h, j) => h && !used.has(j) && test(h));
    if (i >= 0) { map[f.k] = i; used.add(i); }
  };
  for (const f of fields) { const syn = [f.t, ...f.syn].map(normKey); pick(f, (h) => syn.includes(h)); }
  for (const f of fields) { const syn = [f.t, ...f.syn].map(normKey).filter((x) => x.length >= 3); pick(f, (h) => syn.some((x) => h.includes(x))); }
  return map;
}

// طول رقم الجوال بدون الصفر الأول في الدول التي تكتبه
const TRUNK = { SA: 9, AE: 9, JO: 9, EG: 10, IQ: 10 };
const cell = (row, i) => (i == null || i < 0 ? '' : String(row[i] ?? '').trim());
const digits = (s) => String(s || '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632)).replace(/\D/g, '');
const phoneKey = (s) => { const d = digits(s); return d.length >= 7 ? d.slice(-9) : ''; };
const nameKey = (s) => normKey(s);

function parseType(v) {
  const k = normKey(v);
  if (!k) return '';
  return /خدم|service|srv/.test(k) ? 'service' : 'stock';
}
function parseTax(v) {
  const k = normKey(v);
  if (!k) return '';
  if (/معف|exempt|^e$/.test(k)) return 'E';
  if (/خارج|out|^o$/.test(k)) return 'O';
  if (/صفر|zero|^z$|^0%?$/.test(k)) return 'Z';
  return 'S';
}
// الأرقام من Excel قد تأتي نصاً فيه عملة أو فواصل
const numOrBlank = (v) => {
  if (v === '') return '';
  const clean = String(v).replace(/[^\d٠-٩۰-۹.,٫\-]/g, '');
  return clean === '' ? '' : num(clean);
};

// يحوّل الصفوف إلى سجلات جاهزة، مع المطابقة والأخطاء
// النتيجة: [{ row, rec, match, action: 'new'|'update'|'error', errors: [] , notes: [] }]
export function buildRecords(rows, mapping, type, db) {
  const T = IMPORT_TYPES[type];
  const isProd = type === 'products';
  const existing = isProd ? db.products : db.parties.filter((p) => p.kind === T.kind);
  const byBarcode = new Map(), bySku = new Map(), byName = new Map(), byPhone = new Map(), byVat = new Map();
  for (const x of existing) {
    if (isProd) {
      if (x.barcode) byBarcode.set(String(x.barcode), x);
      if (x.sku) bySku.set(String(x.sku).toLowerCase(), x);
    } else {
      if (phoneKey(x.phone)) byPhone.set(phoneKey(x.phone), x);
      if (x.vatNo) byVat.set(digits(x.vatNo), x);
    }
    byName.set(nameKey(x.name), x);
  }
  const seen = new Map();
  const out = [];
  rows.forEach((row, idx) => {
    const v = {};
    for (const f of T.fields) v[f.k] = f.num ? numOrBlank(cell(row, mapping[f.k])) : cell(row, mapping[f.k]);
    if (T.fields.every((f) => v[f.k] === '' || v[f.k] == null)) return;
    const errors = [];
    const notes = [];
    if (!v.name) errors.push('الاسم فارغ');
    let match = null;
    if (isProd) {
      if (v.barcode) {
        v.barcode = String(v.barcode).replace(/\.0+$/, '').trim();
        if (!isEan13(v.barcode) && !code128Supported(v.barcode)) errors.push('الباركود أرقام وحروف لاتينية فقط');
      }
      match = (v.barcode && byBarcode.get(v.barcode)) || (v.sku && bySku.get(String(v.sku).toLowerCase())) || (v.name && byName.get(nameKey(v.name))) || null;
      for (const k of ['price', 'cost', 'openQty', 'reorder']) if (v[k] !== '' && v[k] < 0) errors.push('قيمة سالبة في ' + T.fields.find((f) => f.k === k).t);
      if (v.barcode && byBarcode.get(v.barcode) && match && byBarcode.get(v.barcode).id !== match.id) errors.push('الباركود مستخدم لمنتج آخر');
    } else {
      match = (v.vatNo && byVat.get(digits(v.vatNo))) || (phoneKey(v.phone) && byPhone.get(phoneKey(v.phone))) || (v.name && byName.get(nameKey(v.name))) || null;
      if (v.email && !/^\S+@\S+\.\S+$/.test(v.email)) errors.push('البريد الإلكتروني غير صحيح');
    }
    // التكرار داخل الملف نفسه
    const key = isProd ? (v.barcode || (v.sku && 'sku:' + String(v.sku).toLowerCase()) || 'n:' + nameKey(v.name)) : (phoneKey(v.phone) || 'n:' + nameKey(v.name));
    if (v.name && seen.has(key)) errors.push(`مكرر في الملف (السطر ${seen.get(key) + 2})`);
    else if (v.name) seen.set(key, idx);

    const rec = {};
    if (isProd) {
      rec.name = v.name;
      for (const k of ['nameEn', 'barcode', 'sku', 'category', 'unit']) if (v[k] !== '') rec[k] = v[k];
      const ty = parseType(v.type);
      if (ty) rec.type = ty;
      const tx = parseTax(v.tax);
      if (tx) rec.tax = tx;
      for (const k of ['price', 'cost', 'reorder']) if (v[k] !== '') rec[k] = round(v[k], 4);
      if (match) {
        if (v.openQty !== '' && round(v.openQty, 3) !== round(num(match.openQty), 3)) notes.push('الكمية لا تتغير للمنتجات الموجودة (استخدم تسوية المخزون)');
      } else {
        rec.type = rec.type || 'stock';
        rec.openQty = rec.type === 'stock' && v.openQty !== '' ? round(v.openQty, 3) : 0;
        rec.openCost = num(rec.cost);
        if (rec.openQty && !rec.openCost) notes.push('بدون تكلفة: الكمية الافتتاحية ستُقيَّم بصفر');
        Object.assign(rec, { price: rec.price ?? 0, cost: rec.cost ?? 0, reorder: rec.reorder ?? 0, tax: rec.tax || 'S', unit: rec.unit || '', sku: rec.sku || '', barcode: rec.barcode || '', active: true });
      }
    } else {
      rec.name = v.name;
      for (const k of ['nameEn', 'phone', 'email', 'crNo', 'address', 'notes']) if (v[k] !== '') rec[k] = String(v[k]);
      // Excel يحذف الصفر الأول من أرقام الجوال المخزنة كأرقام
      const raw = mapping.phone != null ? row[mapping.phone] : '';
      const trunk = TRUNK[db.settings?.country];
      if (typeof raw === 'number' && trunk && digits(raw).length === trunk) rec.phone = '0' + digits(raw);
      if (v.vatNo !== '') rec.vatNo = digits(v.vatNo) || String(v.vatNo);
      if (match) {
        if (v.opening !== '' && round(v.opening, 4) !== round(num(match.opening), 4)) notes.push('الرصيد الافتتاحي لا يتغير للموجودين');
      } else {
        rec.kind = T.kind;
        rec.opening = v.opening === '' ? 0 : round(v.opening, 4);
        for (const k of ['phone', 'email', 'vatNo', 'crNo', 'address', 'notes']) rec[k] = rec[k] || '';
      }
    }
    if (match) rec.id = match.id;
    out.push({ row: idx + 2, rec, match, action: errors.length ? 'error' : match ? 'update' : 'new', errors, notes });
  });
  return out;
}

// قالب فارغ مع مثال، للتنزيل
export function templateRows(type) {
  const T = IMPORT_TYPES[type];
  const head = T.fields.map((f) => f.t);
  const ex = type === 'products'
    ? { name: 'شاحن سريع 20 واط', nameEn: 'Fast Charger 20W', barcode: '', sku: 'CH-20', category: 'إكسسوارات', type: 'منتج', unit: 'حبة', price: 45, cost: 28, openQty: 10, reorder: 3, tax: 'خاضع' }
    : { name: type === 'customers' ? 'مؤسسة الريادة التجارية' : 'شركة التوريدات المتحدة', nameEn: '', phone: '0500000001', email: '', vatNo: '', crNo: '', address: 'الرياض', opening: 0, notes: '' };
  return [head, T.fields.map((f) => ex[f.k] ?? '')];
}
