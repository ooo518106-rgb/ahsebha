// ═══════════════════════════════════════════
// احسبها — محرك المحاسبة (دوال نقية بلا DOM)
// ═══════════════════════════════════════════
// المستندات (فواتير، سندات، مصروفات…) هي الأصل، والقيود تُشتق منها في كل
// حساب. لذلك تعديل أي مستند يحدّث القيود والمخزون والتقارير تلقائياً، ولا
// يمكن أن يختلف قيد عن مستنده. نفس الملف يعمل في المتصفح وفي اختبارات Node.

export const SCHEMA = 1;

// ─── العملات والدول ───
export const CURRENCIES = {
  SAR: { sym: 'ر.س', dec: 2, name: 'ريال سعودي', sub: 'هللة' },
  AED: { sym: 'د.إ', dec: 2, name: 'درهم إماراتي', sub: 'فلس' },
  KWD: { sym: 'د.ك', dec: 3, name: 'دينار كويتي', sub: 'فلس' },
  QAR: { sym: 'ر.ق', dec: 2, name: 'ريال قطري', sub: 'درهم' },
  BHD: { sym: 'د.ب', dec: 3, name: 'دينار بحريني', sub: 'فلس' },
  OMR: { sym: 'ر.ع', dec: 3, name: 'ريال عماني', sub: 'بيسة' },
  JOD: { sym: 'د.أ', dec: 3, name: 'دينار أردني', sub: 'فلس' },
  EGP: { sym: 'ج.م', dec: 2, name: 'جنيه مصري', sub: 'قرش' },
  IQD: { sym: 'د.ع', dec: 0, name: 'دينار عراقي', sub: '' },
  USD: { sym: '$', dec: 2, name: 'دولار أمريكي', sub: 'سنت' },
  EUR: { sym: '€', dec: 2, name: 'يورو', sub: 'سنت' },
};

export const COUNTRIES = {
  SA: { name: 'السعودية', currency: 'SAR', vatRate: 15, taxLabel: 'ضريبة القيمة المضافة' },
  AE: { name: 'الإمارات', currency: 'AED', vatRate: 5, taxLabel: 'ضريبة القيمة المضافة' },
  JO: { name: 'الأردن', currency: 'JOD', vatRate: 16, taxLabel: 'ضريبة المبيعات' },
  KW: { name: 'الكويت', currency: 'KWD', vatRate: 0, taxLabel: 'الضريبة' },
  QA: { name: 'قطر', currency: 'QAR', vatRate: 0, taxLabel: 'الضريبة' },
  BH: { name: 'البحرين', currency: 'BHD', vatRate: 10, taxLabel: 'ضريبة القيمة المضافة' },
  OM: { name: 'عُمان', currency: 'OMR', vatRate: 5, taxLabel: 'ضريبة القيمة المضافة' },
  EG: { name: 'مصر', currency: 'EGP', vatRate: 14, taxLabel: 'ضريبة القيمة المضافة' },
  IQ: { name: 'العراق', currency: 'IQD', vatRate: 0, taxLabel: 'الضريبة' },
  XX: { name: 'دولة أخرى', currency: 'USD', vatRate: 0, taxLabel: 'الضريبة' },
};

export const currencyInfo = (code) => CURRENCIES[code] || CURRENCIES.SAR;

export function defaultSettings(o = {}) {
  const c = COUNTRIES[o.country] || COUNTRIES.SA;
  return {
    name: '', vatNo: '', crNo: '', address: '', phone: '', email: '', logo: '',
    country: o.country || 'SA', currency: c.currency,
    vat: c.vatRate > 0, vatRate: c.vatRate, taxLabel: c.taxLabel, inclusive: false,
    startDate: '', fiscalStartMonth: 1,
    salePrefix: 'INV-', invoiceNote: '', printSize: 'a4', showHijri: false,
    lastBackupAt: null,
    ...o,
  };
}

// ─── أرقام وتقريب ───
// يقبل الأرقام العربية (٠-٩) والفارسية والفواصل، لأن لوحات المفاتيح العربية تكتبها أحياناً
export function num(x) {
  if (typeof x === 'number') return Number.isFinite(x) ? x : 0;
  if (x == null || x === '') return 0;
  const s = String(x).trim()
    .replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 0xf))
    .replace(/٫/g, '.')
    .replace(/[,٬\s]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

// تقريب نصف لأعلى بعيداً عن الصفر، مع إزالة أخطاء الفاصلة العائمة (1.005 → 1.01)
export function round(x, d = 2) {
  const v = Number(x);
  if (!Number.isFinite(v)) return 0;
  const f = 10 ** d;
  const r = Math.round(Number((Math.abs(v) * f).toPrecision(15))) / f;
  return v < 0 ? (-r || 0) : r;
}
const qround = (x) => round(x, 6);

// ─── التواريخ (نصوص YYYY-MM-DD، بلا مناطق زمنية) ───
const pad = (n) => String(n).padStart(2, '0');
const split = (s) => String(s).split('-').map(Number);
const fromUTC = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
export const ymd = (dt = new Date()) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s));
export function addDays(s, n) { const [y, m, d] = split(s); return fromUTC(Date.UTC(y, m - 1, d + n)); }
export function addMonths(s, n) {
  const [y, m, d] = split(s);
  const last = new Date(Date.UTC(y, m + n, 0)).getUTCDate();
  return fromUTC(Date.UTC(y, m - 1 + n, Math.min(d, last)));
}
export const monthStart = (s) => String(s).slice(0, 8) + '01';
export function monthEnd(s) { const [y, m] = split(s); return fromUTC(Date.UTC(y, m, 0)); }
export function quarterStart(s) { const [y, m] = split(s); return `${y}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}-01`; }
export function fiscalYearStart(s, month = 1) { const [y, m] = split(s); return `${m >= month ? y : y - 1}-${pad(month)}-01`; }
export function daysBetween(a, b) {
  const [y1, m1, d1] = split(a); const [y2, m2, d2] = split(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5);
}

// ─── دليل الحسابات الافتراضي ───
export const ACCOUNT_TYPES = { asset: 'الأصول', liability: 'الخصوم', equity: 'حقوق الملكية', revenue: 'الإيرادات', expense: 'المصروفات' };
export const isDebitNature = (t) => t === 'asset' || t === 'expense';
export const BALANCE_SHEET_TYPES = ['asset', 'liability', 'equity'];
// حسابات يديرها البرنامج بنفسه: أرصدتها الافتتاحية تأتي من العملاء والموردين والمنتجات
export const CONTROL_ACCOUNTS = ['ar', 'ap', 'inv'];

const grp = (id, code, name, type, parent) => ({ id, code, name, type, parent: parent || null, group: true, sys: true });
const acc = (id, code, name, type, parent, extra) => ({ id, code, name, type, parent, group: false, ...extra });

export function defaultAccounts() {
  const S = { sys: true };
  return [
    grp('g1', '1', 'الأصول', 'asset'),
    grp('g11', '11', 'الأصول المتداولة', 'asset', 'g1'),
    acc('cash', '1101', 'الصندوق', 'asset', 'g11', { money: true, sys: true }),
    acc('bank', '1102', 'البنك', 'asset', 'g11', { money: true, sys: true }),
    acc('ar', '1103', 'العملاء', 'asset', 'g11', S),
    acc('inv', '1104', 'المخزون', 'asset', 'g11', S),
    acc('vin', '1105', 'ضريبة المشتريات (مدخلات)', 'asset', 'g11', S),
    acc('prepaid', '1106', 'مصروفات مدفوعة مقدماً', 'asset', 'g11'),
    grp('g12', '12', 'الأصول الثابتة', 'asset', 'g1'),
    acc('furn', '1201', 'الأثاث والتجهيزات', 'asset', 'g12'),
    acc('equip', '1202', 'الأجهزة والمعدات', 'asset', 'g12'),
    acc('cars', '1203', 'السيارات', 'asset', 'g12'),
    grp('g2', '2', 'الخصوم', 'liability'),
    grp('g21', '21', 'الخصوم المتداولة', 'liability', 'g2'),
    acc('ap', '2101', 'الموردون', 'liability', 'g21', S),
    acc('vout', '2102', 'ضريبة المبيعات (مخرجات)', 'liability', 'g21', S),
    acc('vdue', '2103', 'ضريبة مستحقة للهيئة', 'liability', 'g21', S),
    acc('wages', '2104', 'رواتب مستحقة', 'liability', 'g21'),
    acc('loans', '2105', 'القروض والتمويل', 'liability', 'g21'),
    grp('g3', '3', 'حقوق الملكية', 'equity'),
    acc('cap', '3101', 'رأس المال', 'equity', 'g3', S),
    acc('draw', '3102', 'جاري المالك (المسحوبات)', 'equity', 'g3', S),
    acc('ret', '3103', 'الأرباح المبقاة', 'equity', 'g3', S),
    grp('g4', '4', 'الإيرادات', 'revenue'),
    acc('sales', '4101', 'المبيعات', 'revenue', 'g4', S),
    acc('sret', '4102', 'مردودات المبيعات', 'revenue', 'g4', S),
    acc('oinc', '4103', 'إيرادات أخرى', 'revenue', 'g4'),
    grp('g5', '5', 'المصروفات', 'expense'),
    grp('g51', '51', 'تكلفة المبيعات', 'expense', 'g5'),
    acc('cogs', '5101', 'تكلفة البضاعة المباعة', 'expense', 'g51', S),
    acc('adj', '5102', 'فروقات الجرد والتالف', 'expense', 'g51', S),
    grp('g52', '52', 'المصروفات التشغيلية', 'expense', 'g5'),
    acc('e_sal', '5201', 'الرواتب والأجور', 'expense', 'g52'),
    acc('e_rent', '5202', 'الإيجار', 'expense', 'g52'),
    acc('e_util', '5203', 'الكهرباء والماء', 'expense', 'g52'),
    acc('e_tel', '5204', 'الاتصالات والإنترنت', 'expense', 'g52'),
    acc('e_mkt', '5205', 'التسويق والإعلان', 'expense', 'g52'),
    acc('e_ship', '5206', 'الشحن والتوصيل', 'expense', 'g52'),
    acc('e_fees', '5207', 'عمولات بنكية وبوابات الدفع', 'expense', 'g52'),
    acc('e_plat', '5208', 'عمولات منصات البيع', 'expense', 'g52'),
    acc('e_maint', '5209', 'الصيانة والإصلاح', 'expense', 'g52'),
    acc('e_gov', '5210', 'الرسوم الحكومية', 'expense', 'g52'),
    acc('e_office', '5211', 'مستلزمات مكتبية ونظافة', 'expense', 'g52'),
    acc('e_misc', '5212', 'مصروفات متنوعة', 'expense', 'g52'),
  ];
}

export const accountMap = (db) => new Map((db.accounts || []).map((a) => [a.id, a]));

// ترتيب شجري: كل حساب تحت أبيه، والإخوة حسب الرمز
export function sortedAccounts(db) {
  const kids = new Map();
  const ids = new Set((db.accounts || []).map((a) => a.id));
  for (const a of db.accounts || []) {
    const p = a.parent && ids.has(a.parent) ? a.parent : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(a);
  }
  const cmp = (a, b) => String(a.code).localeCompare(String(b.code), 'en', { numeric: true });
  const out = [];
  const seen = new Set();
  const walk = (p, depth) => {
    for (const a of (kids.get(p) || []).sort(cmp)) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push({ ...a, depth });
      walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function descendantIds(db, id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const a of db.accounts || []) if (a.parent && out.has(a.parent) && !out.has(a.id)) { out.add(a.id); grew = true; }
  }
  return out;
}

export function nextAccountCode(db, parentId) {
  const parent = (db.accounts || []).find((a) => a.id === parentId);
  const base = parent ? String(parent.code) : '';
  const codes = (db.accounts || []).filter((a) => a.parent === parentId).map((a) => Number(a.code)).filter(Number.isFinite);
  if (codes.length) return String(Math.max(...codes) + 1);
  return base + (base.length >= 2 ? '01' : '1');
}

export const moneyAccounts = (db) => (db.accounts || []).filter((a) => a.money && !a.group);

// ─── المستندات ───
export const DOC_TYPES = {
  sale: { name: 'فاتورة مبيعات', plural: 'فواتير المبيعات', prefix: 'INV-', party: 'customer', lines: true },
  quote: { name: 'عرض سعر', plural: 'عروض الأسعار', prefix: 'QT-', party: 'customer', lines: true },
  sreturn: { name: 'مرتجع مبيعات', plural: 'مرتجعات المبيعات', prefix: 'CN-', party: 'customer', lines: true },
  purchase: { name: 'فاتورة مشتريات', plural: 'فواتير المشتريات', prefix: 'PUR-', party: 'supplier', lines: true },
  preturn: { name: 'مرتجع مشتريات', plural: 'مرتجعات المشتريات', prefix: 'DN-', party: 'supplier', lines: true },
  expense: { name: 'مصروف', plural: 'المصروفات', prefix: 'EXP-' },
  receipt: { name: 'سند قبض', plural: 'سندات القبض', prefix: 'RV-' },
  payment: { name: 'سند صرف', plural: 'سندات الصرف', prefix: 'PV-' },
  transfer: { name: 'تحويل بين الحسابات', plural: 'التحويلات', prefix: 'TR-' },
  journal: { name: 'قيد يومية', plural: 'قيود اليومية', prefix: 'JV-' },
  adjust: { name: 'تسوية مخزون', plural: 'تسويات المخزون', prefix: 'ADJ-' },
};

export function docNo(d, S = {}) {
  if (!d) return '';
  if (d.type === 'opening') return 'افتتاحي';
  const t = DOC_TYPES[d.type];
  if (!t) return String(d.no ?? '');
  const prefix = d.type === 'sale' && S.salePrefix != null ? S.salePrefix : t.prefix;
  return prefix + String(d.no ?? 0).padStart(4, '0');
}

// S أساسية، Z صفرية، E معفاة، O خارج نطاق الضريبة (مثل الرواتب والرسوم الحكومية) ولا تدخل الإقرار
export const TAX_CATS = { S: 'خاضع', Z: 'صفري', E: 'معفى', O: 'خارج النطاق' };

// حساب بنود المستند: الخصم، الصافي، الضريبة، الإجمالي (مع دعم الأسعار الشاملة)
export function calcDoc(doc, dec = 2) {
  const rate = num(doc.vatRate);
  const inc = !!doc.inclusive;
  const cats = () => ({ S: { net: 0, vat: 0 }, Z: { net: 0, vat: 0 }, E: { net: 0, vat: 0 }, O: { net: 0, vat: 0 } });
  const out = { lines: [], gross: 0, discount: 0, net: 0, vat: 0, total: 0, byCat: cats() };
  for (const l of doc.lines || []) {
    const qty = num(l.qty), price = num(l.price);
    const disc = Math.min(100, Math.max(0, num(l.disc)));
    const cat = TAX_CATS[l.tax] ? l.tax : 'S';
    const r = cat === 'S' ? rate : 0;
    const gross = round(qty * price, dec);
    const discount = round(gross * disc / 100, dec);
    const amount = round(gross - discount, dec);
    const net = inc ? round(amount / (1 + r / 100), dec) : amount;
    const vat = inc ? round(amount - net, dec) : round(net * r / 100, dec);
    const total = round(net + vat, dec);
    out.lines.push({ qty, price, disc, cat, rate: r, gross, discount, net, vat, total });
    out.gross += gross; out.discount += discount; out.net += net; out.vat += vat; out.total += total;
    out.byCat[cat].net += net; out.byCat[cat].vat += vat;
  }
  for (const k of ['gross', 'discount', 'net', 'vat', 'total']) out[k] = round(out[k], dec);
  for (const c of Object.values(out.byCat)) { c.net = round(c.net, dec); c.vat = round(c.vat, dec); }
  return out;
}

// المصروف بند واحد، فيُحسب بنفس قواعد الفاتورة
export const expenseAsDoc = (d) => ({ vatRate: d.vatRate, inclusive: d.inclusive, lines: [{ qty: 1, price: d.amount, tax: d.tax }] });

// ترتيب المستندات: بالتاريخ، ثم الوارد للمخزون قبل الصادر في نفس اليوم، ثم وقت الإنشاء
const PRIORITY = { opening: 0, purchase: 1, sreturn: 2, adjust: 3, preturn: 4, sale: 5 };
export function docOrder(a, b) {
  return (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
    || ((PRIORITY[a.type] ?? 6) - (PRIORITY[b.type] ?? 6))
    || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    || String(a.id).localeCompare(String(b.id));
}

// ═══ بناء الدفاتر: القيود، المخزون، أرصدة العملاء والموردين ═══
export function buildBooks(db) {
  const S = db.settings || {};
  const dec = currencyInfo(S.currency).dec;
  const R = (x) => round(x, dec);
  const accounts = accountMap(db);
  const products = new Map((db.products || []).map((p) => [p.id, p]));
  const parties = new Map((db.parties || []).map((p) => [p.id, p]));

  const postings = [];
  const entries = new Map();
  const totals = new Map();
  const lineCosts = new Map();
  const stock = new Map();
  const moves = [];
  const partyItems = new Map();
  const issues = [];

  // ── المخزون بالتكلفة المتوسطة المرجحة ──
  const st = (pid) => { let s = stock.get(pid); if (!s) stock.set(pid, s = { qty: 0, value: 0, last: null }); return s; };
  const unitOf = (s, p) => (s.qty > 0 ? Math.max(0, s.value / s.qty) : (s.last != null ? s.last : num(p.cost)));
  const move = (p, d, i, qty, value, s, variance) => moves.push({
    product: p.id, doc: d.id, type: d.type, no: d.no, date: d.date, line: i, qty, value, variance: variance || 0, qtyAfter: s.qty, valueAfter: s.value,
  });

  // وارد: إذا كان الرصيد سالباً (بيع قبل تسجيل الشراء) يُحمَّل فرق التكلفة على تكلفة المبيعات
  function stockIn(p, q, val, d, i) {
    const s = st(p.id);
    let variance = 0;
    if (s.qty < 0) {
      const provisional = s.value / s.qty;
      const q2 = qround(s.qty + q);
      const v2 = R(q2 >= 0 ? q2 * (val / q) : q2 * provisional);
      variance = R(s.value + val - v2);
      s.qty = q2; s.value = v2;
    } else {
      s.qty = qround(s.qty + q); s.value = R(s.value + val);
    }
    if (q > 0) s.last = val / q;
    move(p, d, i, q, val, s, variance);
    return variance;
  }

  function stockOut(p, q, d, i) {
    const s = st(p.id);
    const unit = unitOf(s, p);
    let cost = R(q * unit);
    s.qty = qround(s.qty - q);
    s.value = R(s.value - cost);
    if (s.qty === 0 && s.value !== 0) { cost = R(cost + s.value); s.value = 0; }
    if (s.qty < 0) issues.push({ doc: d.id, product: p.id, msg: 'رصيد المخزون صار سالباً' });
    move(p, d, i, -q, -cost, s);
    return { cost, unit };
  }

  // صادر بقيمة محددة (مرتجع المشتريات بسعر الشراء)؛ يرجّع أي بقايا قيمة لما تصير الكمية صفراً
  function stockOutAt(p, q, val, d, i) {
    const s = st(p.id);
    s.qty = qround(s.qty - q);
    s.value = R(s.value - val);
    let residue = 0;
    if (s.qty === 0 && s.value !== 0) { residue = s.value; s.value = 0; }
    move(p, d, i, -q, -val, s, residue);
    return residue;
  }

  // ── بناء القيد ──
  let cur = null;
  const begin = (doc) => { cur = { doc, lines: [] }; };
  function add(accId, amount, side, o = {}) {
    let a = R(amount);
    if (!a) return;
    if (a < 0) { a = -a; side = side === 'dr' ? 'cr' : 'dr'; }
    cur.lines.push({ acc: accId, dr: side === 'dr' ? a : 0, cr: side === 'cr' ? a : 0, party: o.party || null, key: o.key || null, link: o.link || null, memo: o.memo || '' });
  }
  function commit() {
    const { doc } = cur;
    const merged = [];
    for (const l of cur.lines) {
      const side = l.dr ? 'dr' : 'cr';
      const m = merged.find((x) => x.acc === l.acc && x.party === l.party && x.key === l.key && x.link === l.link && x.memo === l.memo && (x.dr ? 'dr' : 'cr') === side);
      if (m) { m.dr = R(m.dr + l.dr); m.cr = R(m.cr + l.cr); } else merged.push({ ...l });
    }
    const dr = R(merged.reduce((s, l) => s + l.dr, 0));
    const cr = R(merged.reduce((s, l) => s + l.cr, 0));
    if (dr !== cr) issues.push({ doc: doc.id, msg: 'قيد غير متوازن' });
    if (!merged.length) return;
    entries.set(doc.id, { doc, date: doc.date, lines: merged, dr, cr });
    merged.forEach((l, idx) => {
      if (!accounts.has(l.acc)) issues.push({ doc: doc.id, msg: 'حساب غير موجود في الدليل' });
      postings.push({ ...l, doc: doc.id, type: doc.type, no: doc.no, date: doc.date });
      if (l.party && (l.acc === 'ar' || l.acc === 'ap')) {
        const charge = l.acc === 'ar' ? l.dr > 0 : l.cr > 0;
        if (!partyItems.has(l.party)) partyItems.set(l.party, []);
        partyItems.get(l.party).push({ key: l.key || `${doc.id}:${idx}`, doc: doc.id, type: doc.type, no: doc.no, date: doc.date, side: charge ? 'c' : 's', amount: l.dr || l.cr, link: l.link });
      }
    });
  }

  const partyOf = (d, kind) => { const p = parties.get(d.party); return p && p.kind === kind ? p.id : null; };
  const payOf = (d, total) => {
    const paid = Math.min(R(num(d.paid)), total);
    const a = accounts.get(d.payAcc);
    return paid > 0 && a && !a.group ? { acc: a.id, paid } : { acc: null, paid: 0 };
  };

  // ── الأرصدة الافتتاحية: قيد واحد بتاريخ بداية التشغيل، والفرق في رأس المال ──
  const opening = { id: 'opening', type: 'opening', no: 0, date: isDate(S.startDate) ? S.startDate : '1970-01-01', createdAt: '' };
  function postOpening(d) {
    begin(d);
    const memo = 'رصيد افتتاحي';
    for (const a of accounts.values()) {
      if (a.group || !num(a.opening) || !BALANCE_SHEET_TYPES.includes(a.type)) continue;
      if (CONTROL_ACCOUNTS.includes(a.id) || a.id === 'cap') continue;
      add(a.id, num(a.opening), isDebitNature(a.type) ? 'dr' : 'cr', { memo });
    }
    for (const p of parties.values()) {
      if (!num(p.opening)) continue;
      if (p.kind === 'customer') add('ar', num(p.opening), 'dr', { party: p.id, key: 'open:' + p.id, memo });
      else add('ap', num(p.opening), 'cr', { party: p.id, key: 'open:' + p.id, memo });
    }
    for (const p of products.values()) {
      const q = num(p.openQty);
      if (p.type !== 'stock' || q <= 0) continue;
      const val = R(q * num(p.openCost));
      stockIn(p, q, val, d, -1);
      add('inv', val, 'dr', { memo: 'مخزون أول المدة' });
    }
    const dr = cur.lines.reduce((s, l) => s + l.dr, 0);
    const cr = cur.lines.reduce((s, l) => s + l.cr, 0);
    add('cap', dr - cr, 'cr', { memo: 'رأس المال الافتتاحي' });
    commit();
  }

  function postSale(d) {
    const T = calcDoc(d, dec); totals.set(d.id, T);
    const pid = partyOf(d, 'customer');
    const pay = payOf(d, T.total);
    begin(d);
    if (pid) {
      add('ar', T.total, 'dr', { party: pid, key: d.id });
      if (pay.acc) { add(pay.acc, pay.paid, 'dr'); add('ar', pay.paid, 'cr', { party: pid, key: d.id + ':p', link: d.id }); }
    } else {
      if (pay.acc) add(pay.acc, pay.paid, 'dr');
      const rest = R(T.total - pay.paid);
      if (rest) { add('ar', rest, 'dr'); issues.push({ doc: d.id, msg: 'فاتورة آجلة بلا عميل' }); }
    }
    T.lines.forEach((L) => add('sales', L.net, 'cr'));
    add('vout', T.vat, 'cr');
    const costs = (d.lines || []).map((l, i) => {
      const p = products.get(l.product);
      if (!p || p.type !== 'stock' || !(num(l.qty) > 0)) return null;
      const c = stockOut(p, num(l.qty), d, i);
      add('cogs', c.cost, 'dr'); add('inv', c.cost, 'cr');
      return c;
    });
    lineCosts.set(d.id, costs);
    commit();
  }

  function postSalesReturn(d) {
    const T = calcDoc(d, dec); totals.set(d.id, T);
    const pid = partyOf(d, 'customer');
    const pay = payOf(d, T.total);
    begin(d);
    add('sret', T.net, 'dr');
    add('vout', T.vat, 'dr');
    if (pid) {
      add('ar', T.total, 'cr', { party: pid, key: d.id, link: d.refId || null });
      if (pay.acc) { add('ar', pay.paid, 'dr', { party: pid, key: d.id + ':p', link: d.id }); add(pay.acc, pay.paid, 'cr'); }
    } else {
      if (pay.acc) add(pay.acc, pay.paid, 'cr');
      const rest = R(T.total - pay.paid);
      if (rest) { add('ar', rest, 'cr'); issues.push({ doc: d.id, msg: 'مرتجع بلا عميل ولم يُرد مبلغه' }); }
    }
    // يرجع للمخزون بتكلفته الأصلية إن وُجدت الفاتورة الأصلية
    const ref = d.refId ? (db.docs || []).find((x) => x.id === d.refId) : null;
    const refCosts = ref ? lineCosts.get(ref.id) || [] : [];
    const costs = (d.lines || []).map((l, i) => {
      const p = products.get(l.product);
      const q = num(l.qty);
      if (!p || p.type !== 'stock' || !(q > 0)) return null;
      const j = ref ? (ref.lines || []).findIndex((x, k) => x.product === l.product && refCosts[k]) : -1;
      const unit = j >= 0 ? refCosts[j].unit : unitOf(st(p.id), p);
      const val = R(q * unit);
      const variance = stockIn(p, q, val, d, i);
      add('inv', val, 'dr'); add('cogs', val, 'cr');
      if (variance) { add('cogs', variance, 'dr'); add('inv', variance, 'cr'); }
      return { unit, cost: val };
    });
    lineCosts.set(d.id, costs);
    commit();
  }

  function postPurchase(d) {
    const T = calcDoc(d, dec); totals.set(d.id, T);
    const pid = partyOf(d, 'supplier');
    const pay = payOf(d, T.total);
    begin(d);
    (d.lines || []).forEach((l, i) => {
      const L = T.lines[i];
      const p = products.get(l.product);
      if (p && p.type === 'stock' && L.qty > 0) {
        add('inv', L.net, 'dr');
        const variance = stockIn(p, L.qty, L.net, d, i);
        if (variance) { add('cogs', variance, 'dr'); add('inv', variance, 'cr'); }
      } else add('cogs', L.net, 'dr');
    });
    add('vin', T.vat, 'dr');
    if (pid) {
      add('ap', T.total, 'cr', { party: pid, key: d.id });
      if (pay.acc) { add('ap', pay.paid, 'dr', { party: pid, key: d.id + ':p', link: d.id }); add(pay.acc, pay.paid, 'cr'); }
    } else {
      if (pay.acc) add(pay.acc, pay.paid, 'cr');
      const rest = R(T.total - pay.paid);
      if (rest) { add('ap', rest, 'cr'); issues.push({ doc: d.id, msg: 'فاتورة مشتريات آجلة بلا مورد' }); }
    }
    commit();
  }

  function postPurchaseReturn(d) {
    const T = calcDoc(d, dec); totals.set(d.id, T);
    const pid = partyOf(d, 'supplier');
    const pay = payOf(d, T.total);
    begin(d);
    if (pid) {
      add('ap', T.total, 'dr', { party: pid, key: d.id, link: d.refId || null });
      if (pay.acc) { add(pay.acc, pay.paid, 'dr'); add('ap', pay.paid, 'cr', { party: pid, key: d.id + ':p', link: d.id }); }
    } else {
      if (pay.acc) add(pay.acc, pay.paid, 'dr');
      const rest = R(T.total - pay.paid);
      if (rest) { add('ap', rest, 'dr'); issues.push({ doc: d.id, msg: 'مرتجع مشتريات بلا مورد ولم يُسترد مبلغه' }); }
    }
    (d.lines || []).forEach((l, i) => {
      const L = T.lines[i];
      const p = products.get(l.product);
      if (p && p.type === 'stock' && L.qty > 0) {
        add('inv', L.net, 'cr');
        const residue = stockOutAt(p, L.qty, L.net, d, i);
        if (residue) { add('cogs', residue, 'dr'); add('inv', residue, 'cr'); }
      } else add('cogs', L.net, 'cr');
    });
    add('vin', T.vat, 'cr');
    commit();
  }

  function postExpense(d) {
    const T = calcDoc(expenseAsDoc(d), dec); totals.set(d.id, T);
    const pid = partyOf(d, 'supplier');
    const pay = payOf(d, T.total);
    begin(d);
    add(d.account, T.net, 'dr');
    add('vin', T.vat, 'dr');
    if (pid) {
      add('ap', T.total, 'cr', { party: pid, key: d.id });
      if (pay.acc) { add('ap', pay.paid, 'dr', { party: pid, key: d.id + ':p', link: d.id }); add(pay.acc, pay.paid, 'cr'); }
    } else {
      add(pay.acc || 'cash', T.total, 'cr');
      if (!pay.acc || pay.paid !== T.total) issues.push({ doc: d.id, msg: 'مصروف بلا مورد ولم يُحدد مصدر الدفع كاملاً' });
    }
    commit();
  }

  function counterOf(d) {
    const p = parties.get(d.party);
    if (p) return { acc: p.kind === 'customer' ? 'ar' : 'ap', party: p.id };
    return { acc: d.account, party: null };
  }

  function postVoucher(d) {
    const amt = R(num(d.amount));
    const c = counterOf(d);
    const o = c.party ? { party: c.party, key: d.id, link: d.link || null } : {};
    begin(d);
    if (d.type === 'receipt') { add(d.money, amt, 'dr'); add(c.acc, amt, 'cr', o); }
    else { add(c.acc, amt, 'dr', o); add(d.money, amt, 'cr'); }
    commit();
  }

  function postTransfer(d) {
    begin(d);
    add(d.to, num(d.amount), 'dr');
    add(d.from, num(d.amount), 'cr');
    commit();
  }

  function postJournal(d) {
    begin(d);
    (d.lines || []).forEach((l, i) => {
      const o = { memo: l.memo || '', party: l.party || null, key: l.party ? `${d.id}:${i}` : null };
      add(l.account, num(l.dr), 'dr', o);
      add(l.account, num(l.cr), 'cr', o);
    });
    commit();
  }

  function postAdjust(d) {
    const accId = accounts.has(d.account) ? d.account : 'adj';
    begin(d);
    const costs = (d.lines || []).map((l, i) => {
      const p = products.get(l.product);
      const q = num(l.qty);
      if (!p || p.type !== 'stock' || !q) return null;
      if (q > 0) {
        const unit = l.cost !== '' && l.cost != null ? num(l.cost) : unitOf(st(p.id), p);
        const val = R(q * unit);
        const variance = stockIn(p, q, val, d, i);
        add('inv', val, 'dr'); add(accId, val, 'cr');
        if (variance) { add('cogs', variance, 'dr'); add('inv', variance, 'cr'); }
        return { unit, cost: val };
      }
      const c = stockOut(p, -q, d, i);
      add(accId, c.cost, 'dr'); add('inv', c.cost, 'cr');
      return c;
    });
    lineCosts.set(d.id, costs);
    commit();
  }

  const handlers = {
    opening: postOpening, sale: postSale, sreturn: postSalesReturn, purchase: postPurchase, preturn: postPurchaseReturn,
    expense: postExpense, receipt: postVoucher, payment: postVoucher, transfer: postTransfer, journal: postJournal, adjust: postAdjust,
  };
  const docs = [opening, ...(db.docs || []).filter((d) => handlers[d.type] && d.type !== 'opening')].sort(docOrder);
  for (const d of docs) handlers[d.type](d);

  // ── مطابقة الدفعات مع الفواتير: الربط الصريح أولاً ثم الأقدم فالأقدم ──
  const remaining = new Map();
  const applications = new Map();
  const partyBalance = new Map();
  const openItems = new Map();
  for (const [pid, list] of partyItems) {
    const { rem, apps } = matchItems(list, R);
    let bal = 0;
    for (const it of list) { bal += it.side === 'c' ? it.amount : -it.amount; remaining.set(it.key, rem.get(it.key)); }
    partyBalance.set(pid, R(bal));
    openItems.set(pid, list.filter((it) => rem.get(it.key) > 0).map((it) => ({ ...it, open: rem.get(it.key) })));
    for (const a of apps) {
      for (const [k, other] of [[a.c.key, a.s], [a.s.key, a.c]]) {
        if (!applications.has(k)) applications.set(k, []);
        applications.get(k).push({ doc: other.doc, type: other.type, no: other.no, date: other.date, key: other.key, amount: a.amount });
      }
    }
  }

  // حالة السداد لكل فاتورة/مصروف، والمتبقي غير المخصص لكل سند أو مرتجع
  const status = new Map();
  for (const d of db.docs || []) {
    const T = totals.get(d.id);
    if (d.type === 'sale' || d.type === 'purchase' || d.type === 'expense') {
      const total = T.total;
      const kind = d.type === 'sale' ? 'customer' : 'supplier';
      const due = partyOf(d, kind) ? (remaining.get(d.id) ?? 0) : R(total - payOf(d, total).paid);
      const paid = R(total - due);
      status.set(d.id, { total, paid, due, state: due <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid' });
    } else if (d.type === 'sreturn' || d.type === 'preturn') {
      const kind = d.type === 'sreturn' ? 'customer' : 'supplier';
      const open = partyOf(d, kind) ? (remaining.get(d.id) ?? 0) : 0;
      status.set(d.id, { total: T.total, refunded: payOf(d, T.total).paid, open });
    } else if (d.type === 'receipt' || d.type === 'payment') {
      const amount = R(num(d.amount));
      const open = d.party ? (remaining.get(d.id) ?? 0) : 0;
      status.set(d.id, { total: amount, applied: R(amount - open), open });
    }
  }

  return { dec, postings, entries, totals, lineCosts, stock, moves, partyItems, remaining, applications, partyBalance, openItems, status, issues };
}

export function matchItems(list, R = (x) => round(x, 2)) {
  const rem = new Map();
  const byKey = new Map();
  const apps = [];
  for (const it of list) { rem.set(it.key, it.amount); byKey.set(it.key, it); }
  const apply = (c, s) => {
    const m = R(Math.min(rem.get(c.key), rem.get(s.key)));
    if (!(m > 0)) return;
    rem.set(c.key, R(rem.get(c.key) - m));
    rem.set(s.key, R(rem.get(s.key) - m));
    apps.push({ c, s, amount: m });
  };
  for (const it of list) {
    const o = it.link && byKey.get(it.link);
    if (!o || o.side === it.side) continue;
    if (it.side === 'c') apply(it, o); else apply(o, it);
  }
  const cs = list.filter((i) => i.side === 'c');
  const ss = list.filter((i) => i.side === 's');
  let i = 0, j = 0;
  while (i < cs.length && j < ss.length) {
    if (!(rem.get(cs[i].key) > 0)) { i++; continue; }
    if (!(rem.get(ss[j].key) > 0)) { j++; continue; }
    apply(cs[i], ss[j]);
  }
  return { rem, apps };
}

// ═══ التقارير ═══

// أرصدة الحسابات: الافتتاحي قبل from، والحركة بين from و to (مدين موجب)
export function balances(books, { from, to } = {}) {
  const m = new Map();
  for (const p of books.postings) {
    if (to && p.date > to) continue;
    let b = m.get(p.acc);
    if (!b) m.set(p.acc, b = { open: 0, dr: 0, cr: 0, close: 0 });
    if (from && p.date < from) b.open += p.dr - p.cr;
    else { b.dr += p.dr; b.cr += p.cr; }
  }
  const R = (x) => round(x, books.dec);
  for (const b of m.values()) { b.open = R(b.open); b.dr = R(b.dr); b.cr = R(b.cr); b.close = R(b.open + b.dr - b.cr); }
  return m;
}

// تجميع أرصدة الحسابات الفرعية في آبائها
export function rollup(db, m, dec = 2) {
  const accs = accountMap(db);
  const out = new Map();
  for (const [id, b] of m) {
    const seen = new Set();
    let cur = id;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const t = out.get(cur) || { open: 0, dr: 0, cr: 0, close: 0 };
      t.open += b.open; t.dr += b.dr; t.cr += b.cr; t.close += b.close;
      out.set(cur, t);
      cur = accs.get(cur)?.parent;
    }
  }
  for (const t of out.values()) for (const k of ['open', 'dr', 'cr', 'close']) t[k] = round(t[k], dec);
  return out;
}

const split2 = (v) => (v >= 0 ? [v, 0] : [0, -v]);

export function trialBalance(db, books, { from, to } = {}) {
  const dec = books.dec;
  const leaf = balances(books, { from, to });
  const all = rollup(db, leaf, dec);
  const known = new Set((db.accounts || []).map((a) => a.id));
  const rows = [];
  for (const a of sortedAccounts(db)) {
    const b = all.get(a.id);
    if (!b || (!b.open && !b.dr && !b.cr)) continue;
    const [openDr, openCr] = split2(b.open);
    const [closeDr, closeCr] = split2(b.close);
    rows.push({ account: a, depth: a.depth, group: a.group, openDr, openCr, dr: b.dr, cr: b.cr, closeDr, closeCr });
  }
  for (const [id, b] of leaf) {
    if (known.has(id)) continue;
    const [openDr, openCr] = split2(b.open); const [closeDr, closeCr] = split2(b.close);
    rows.push({ account: { id, code: '?', name: 'حساب محذوف', type: 'asset' }, depth: 0, group: false, openDr, openCr, dr: b.dr, cr: b.cr, closeDr, closeCr });
  }
  const tot = { openDr: 0, openCr: 0, dr: 0, cr: 0, closeDr: 0, closeCr: 0 };
  for (const r of rows) if (!r.group) for (const k in tot) tot[k] += r[k];
  for (const k in tot) tot[k] = round(tot[k], dec);
  return { rows, totals: tot, balanced: tot.dr === tot.cr && tot.openDr === tot.openCr && tot.closeDr === tot.closeCr };
}

// صافي الربح بين تاريخين (الإيرادات − المصروفات)
export function profit(db, books, { from, to } = {}) {
  const types = new Map((db.accounts || []).map((a) => [a.id, a.type]));
  let v = 0;
  for (const p of books.postings) {
    if ((from && p.date < from) || (to && p.date > to)) continue;
    const t = types.get(p.acc);
    if (t === 'revenue' || t === 'expense') v += p.cr - p.dr;
  }
  return round(v, books.dec);
}

export function incomeStatement(db, books, { from, to } = {}) {
  const dec = books.dec;
  const m = balances(books, { from, to });
  const accs = accountMap(db);
  const cogsIds = descendantIds(db, 'g51');
  const revenue = [], cogs = [], expenses = [];
  for (const a of sortedAccounts(db)) {
    if (a.group) continue;
    const b = m.get(a.id);
    if (!b || (!b.dr && !b.cr)) continue;
    if (a.type === 'revenue') revenue.push({ account: a, amount: round(b.cr - b.dr, dec) });
    else if (a.type === 'expense') {
      const row = { account: a, amount: round(b.dr - b.cr, dec), group: accs.get(a.parent)?.name || '' };
      (cogsIds.has(a.id) ? cogs : expenses).push(row);
    }
  }
  const sum = (xs) => round(xs.reduce((s, r) => s + r.amount, 0), dec);
  const totalRevenue = sum(revenue), totalCogs = sum(cogs), totalExpenses = sum(expenses);
  const gross = round(totalRevenue - totalCogs, dec);
  return { revenue, cogs, expenses, totalRevenue, totalCogs, gross, totalExpenses, net: round(gross - totalExpenses, dec) };
}

export function balanceSheet(db, books, { to } = {}) {
  const dec = books.dec;
  const S = db.settings || {};
  const m = balances(books, { to });
  const accs = accountMap(db);
  const sections = { asset: [], liability: [], equity: [] };
  for (const a of sortedAccounts(db)) {
    if (a.group || !sections[a.type]) continue;
    const b = m.get(a.id);
    if (!b || !b.close) continue;
    sections[a.type].push({ account: a, group: accs.get(a.parent)?.name || '', amount: isDebitNature(a.type) ? b.close : -b.close });
  }
  const asOf = to || '9999-12-31';
  const fy = fiscalYearStart(asOf, num(S.fiscalStartMonth) || 1);
  const prior = profit(db, books, { to: addDays(fy, -1) });
  const current = profit(db, books, { from: fy, to });
  if (prior) sections.equity.push({ account: { id: '_prior', name: 'أرباح (خسائر) سنوات سابقة' }, group: '', amount: prior, computed: true });
  sections.equity.push({ account: { id: '_current', name: 'صافي ربح (خسارة) السنة الحالية' }, group: '', amount: current, computed: true });
  const sum = (xs) => round(xs.reduce((s, r) => s + r.amount, 0), dec);
  const totals = { asset: sum(sections.asset), liability: sum(sections.liability), equity: sum(sections.equity) };
  return { sections, totals, fyStart: fy, balanced: totals.asset === round(totals.liability + totals.equity, dec) };
}

// إقرار الضريبة: من المستندات مباشرة حسب فئة كل بند
export function vatReport(db, books, { from, to } = {}) {
  const dec = books.dec;
  const cats = () => ({ S: { net: 0, vat: 0 }, Z: { net: 0, vat: 0 }, E: { net: 0, vat: 0 } });
  const r = { sale: cats(), sreturn: cats(), purchase: cats(), preturn: cats(), expense: cats(), docs: [] };
  for (const d of db.docs || []) {
    if (!r[d.type] || (from && d.date < from) || (to && d.date > to)) continue;
    const T = books.totals.get(d.id);
    if (!T) continue;
    for (const c of ['S', 'Z', 'E']) { r[d.type][c].net += T.byCat[c].net; r[d.type][c].vat += T.byCat[c].vat; }
    r.docs.push({ doc: d, net: T.net, vat: T.vat, total: T.total });
  }
  const R = (x) => round(x, dec);
  for (const k of ['sale', 'sreturn', 'purchase', 'preturn', 'expense']) for (const c of Object.values(r[k])) { c.net = R(c.net); c.vat = R(c.vat); }
  const line = (a, b, c) => ({ net: R(a.net + (b ? b.net : 0) - c.net), vat: R(a.vat + (b ? b.vat : 0) - c.vat) });
  r.sales = { S: line(r.sale.S, null, r.sreturn.S), Z: line(r.sale.Z, null, r.sreturn.Z), E: line(r.sale.E, null, r.sreturn.E) };
  r.purchases = { S: line(r.purchase.S, r.expense.S, r.preturn.S), Z: line(r.purchase.Z, r.expense.Z, r.preturn.Z), E: line(r.purchase.E, r.expense.E, r.preturn.E) };
  r.output = r.sales.S.vat;
  r.input = r.purchases.S.vat;
  r.net = R(r.output - r.input);
  r.docs.sort((a, b) => docOrder(a.doc, b.doc));
  return r;
}

// أعمار الديون للعملاء أو الموردين حسب تاريخ الاستحقاق
export const AGING_BUCKETS = [
  { id: 'current', name: 'غير مستحق' }, { id: 'd30', name: '1–30 يوم' }, { id: 'd60', name: '31–60 يوم' },
  { id: 'd90', name: '61–90 يوم' }, { id: 'd90p', name: 'أكثر من 90' },
];
export function aging(db, books, kind, asOf) {
  const dec = books.dec;
  const docs = new Map((db.docs || []).map((d) => [d.id, d]));
  const rows = [];
  const tot = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0, credit: 0, total: 0 };
  for (const p of db.parties || []) {
    if (p.kind !== kind) continue;
    const bal = books.partyBalance.get(p.id) || 0;
    if (!bal) continue;
    const r = { party: p, current: 0, d30: 0, d60: 0, d90: 0, d90p: 0, credit: 0, total: bal };
    for (const it of books.openItems.get(p.id) || []) {
      if (it.side === 's') { r.credit -= it.open; continue; }
      const d = docs.get(it.doc);
      const due = (d && d.dueDate) || it.date;
      const late = daysBetween(due, asOf);
      const b = late <= 0 ? 'current' : late <= 30 ? 'd30' : late <= 60 ? 'd60' : late <= 90 ? 'd90' : 'd90p';
      r[b] += it.open;
    }
    for (const k in tot) { r[k] = round(r[k], dec); tot[k] += r[k]; }
    rows.push(r);
  }
  for (const k in tot) tot[k] = round(tot[k], dec);
  rows.sort((a, b) => b.total - a.total);
  return { rows, totals: tot };
}

// كشف حساب عميل أو مورد: الرصيد موجب = مستحق (له علينا أو لنا عليه حسب النوع)
export function partyStatement(db, books, partyId, { from, to } = {}) {
  const p = (db.parties || []).find((x) => x.id === partyId);
  const sign = p && p.kind === 'supplier' ? -1 : 1;
  let open = 0;
  const rows = [];
  for (const x of books.postings) {
    if (x.party !== partyId || (x.acc !== 'ar' && x.acc !== 'ap')) continue;
    if (to && x.date > to) continue;
    const v = sign * (x.dr - x.cr);
    if (from && x.date < from) { open += v; continue; }
    rows.push({ ...x });
  }
  let bal = round(open, books.dec);
  for (const r of rows) { bal = round(bal + sign * (r.dr - r.cr), books.dec); r.balance = bal; }
  const dr = round(rows.reduce((s, r) => s + r.dr, 0), books.dec);
  const cr = round(rows.reduce((s, r) => s + r.cr, 0), books.dec);
  return { party: p, opening: round(open, books.dec), rows, dr, cr, closing: bal };
}

// دفتر الأستاذ لحساب واحد (مع الحسابات الفرعية إن كان تجميعياً)
export function ledger(db, books, accountId, { from, to } = {}) {
  const a = (db.accounts || []).find((x) => x.id === accountId);
  const ids = descendantIds(db, accountId);
  const sign = a && !isDebitNature(a.type) ? -1 : 1;
  let open = 0;
  const rows = [];
  for (const x of books.postings) {
    if (!ids.has(x.acc) || (to && x.date > to)) continue;
    if (from && x.date < from) { open += sign * (x.dr - x.cr); continue; }
    rows.push({ ...x });
  }
  let bal = round(open, books.dec);
  for (const r of rows) { bal = round(bal + sign * (r.dr - r.cr), books.dec); r.balance = bal; }
  const dr = round(rows.reduce((s, r) => s + r.dr, 0), books.dec);
  const cr = round(rows.reduce((s, r) => s + r.cr, 0), books.dec);
  return { account: a, opening: round(open, books.dec), rows, dr, cr, closing: bal };
}

export function stockReport(db, books) {
  const dec = books.dec;
  const rows = (db.products || []).filter((p) => p.type === 'stock').map((p) => {
    const s = books.stock.get(p.id) || { qty: 0, value: 0 };
    const unit = s.qty > 0 ? s.value / s.qty : num(p.cost);
    return { product: p, qty: s.qty, value: round(s.value, dec), unit: round(unit, dec), low: num(p.reorder) > 0 && s.qty <= num(p.reorder) };
  });
  return { rows, value: round(rows.reduce((t, r) => t + r.value, 0), dec) };
}

// تحليل المبيعات والربحية حسب المنتج والعميل
export function salesAnalysis(db, books, { from, to } = {}) {
  const dec = books.dec;
  const R = (x) => round(x, dec);
  const byProduct = new Map(), byCustomer = new Map();
  const products = new Map((db.products || []).map((p) => [p.id, p]));
  const parties = new Map((db.parties || []).map((p) => [p.id, p]));
  let net = 0, cost = 0, count = 0;
  for (const d of db.docs || []) {
    if ((d.type !== 'sale' && d.type !== 'sreturn') || (from && d.date < from) || (to && d.date > to)) continue;
    const T = books.totals.get(d.id);
    const costs = books.lineCosts.get(d.id) || [];
    const sg = d.type === 'sale' ? 1 : -1;
    if (d.type === 'sale') count++;
    (d.lines || []).forEach((l, i) => {
      const L = T.lines[i];
      const c = costs[i] ? costs[i].cost : 0;
      const key = l.product && products.has(l.product) ? l.product : '_free:' + (l.desc || '');
      const name = products.get(l.product)?.name || l.desc || 'بند';
      let r = byProduct.get(key);
      if (!r) byProduct.set(key, r = { key, name, product: products.get(l.product) || null, qty: 0, net: 0, cost: 0 });
      r.qty += sg * L.qty; r.net += sg * L.net; r.cost += sg * c;
      net += sg * L.net; cost += sg * c;
    });
    const pk = d.party && parties.has(d.party) ? d.party : '_cash';
    let c = byCustomer.get(pk);
    if (!c) byCustomer.set(pk, c = { key: pk, name: parties.get(d.party)?.name || 'عميل نقدي', count: 0, net: 0, vat: 0, total: 0 });
    if (d.type === 'sale') c.count++;
    c.net += sg * T.net; c.vat += sg * T.vat; c.total += sg * T.total;
  }
  const products_ = [...byProduct.values()].map((r) => ({ ...r, qty: qround(r.qty), net: R(r.net), cost: R(r.cost), profit: R(r.net - r.cost), margin: r.net ? (r.net - r.cost) / r.net * 100 : 0 }))
    .sort((a, b) => b.net - a.net);
  const customers = [...byCustomer.values()].map((r) => ({ ...r, net: R(r.net), vat: R(r.vat), total: R(r.total) })).sort((a, b) => b.net - a.net);
  return { products: products_, customers, net: R(net), cost: R(cost), profit: R(net - cost), count };
}

// حركة الصندوق والبنوك
export function cashReport(db, books, { from, to } = {}) {
  const m = balances(books, { from, to });
  const rows = moneyAccounts(db).map((a) => {
    const b = m.get(a.id) || { open: 0, dr: 0, cr: 0, close: 0 };
    return { account: a, open: b.open, in: b.dr, out: b.cr, close: b.close };
  });
  const sum = (k) => round(rows.reduce((s, r) => s + r[k], 0), books.dec);
  return { rows, totals: { open: sum('open'), in: sum('in'), out: sum('out'), close: sum('close') } };
}

// ملخص لوحة التحكم
export function dashboard(db, books, today) {
  const dec = books.dec;
  const R = (x) => round(x, dec);
  const month = { from: monthStart(today), to: monthEnd(today) };
  const is = incomeStatement(db, books, month);
  const bal = balances(books, { to: today });
  const close = (id) => (bal.get(id) || { close: 0 }).close;
  const cash = R(moneyAccounts(db).reduce((s, a) => s + close(a.id), 0));
  const types = new Map((db.accounts || []).map((a) => [a.id, a.type]));
  const first = monthStart(addMonths(today, -5));
  const series = [];
  for (let i = 0; i < 6; i++) series.push({ month: monthStart(addMonths(first, i)), revenue: 0, expenses: 0 });
  for (const p of books.postings) {
    if (p.date < first || p.date > month.to) continue;
    const t = types.get(p.acc);
    if (t !== 'revenue' && t !== 'expense') continue;
    const s = series.find((x) => x.month === monthStart(p.date));
    if (!s) continue;
    if (t === 'revenue') s.revenue += p.cr - p.dr; else s.expenses += p.dr - p.cr;
  }
  for (const s of series) { s.revenue = R(s.revenue); s.expenses = R(s.expenses); s.profit = R(s.revenue - s.expenses); }
  const overdue = (db.docs || []).filter((d) => d.type === 'sale' && d.dueDate && d.dueDate < today && (books.status.get(d.id)?.due || 0) > 0);
  const low = stockReport(db, books).rows.filter((r) => r.low);
  return {
    month, revenue: is.totalRevenue, expenses: R(is.totalCogs + is.totalExpenses), profit: is.net,
    cash, receivable: close('ar'), payable: -close('ap'), vatDue: R(-(close('vout') + close('vin') + close('vdue'))),
    series, overdue, low,
  };
}

// ─── رمز QR لفاتورة هيئة الزكاة (المرحلة الأولى): TLV ثم Base64 ───
export function zatcaTLV(fields) {
  const enc = new TextEncoder();
  const bytes = [];
  fields.forEach((v, i) => {
    const b = enc.encode(String(v));
    if (b.length > 255) throw new Error('قيمة أطول من المسموح في رمز QR');
    bytes.push(i + 1, b.length, ...b);
  });
  return base64(bytes);
}

export function zatcaInvoiceQR(settings, doc, totals) {
  const t = /^\d{2}:\d{2}(:\d{2})?$/.test(doc.time || '') ? doc.time : '00:00:00';
  const local = new Date(`${doc.date}T${t.length === 5 ? t + ':00' : t}`);
  const stamp = Number.isNaN(local.getTime()) ? `${doc.date}T00:00:00Z` : local.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return zatcaTLV([settings.name || '', settings.vatNo || '', stamp, totals.total.toFixed(2), totals.vat.toFixed(2)]);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function base64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}

// الرقم الضريبي السعودي: 15 رقماً يبدأ وينتهي بـ 3
export const validSaudiVat = (v) => /^3\d{13}3$/.test(String(v || '').trim());

// ─── التحقق من المستندات قبل الحفظ ───
export function validateDoc(db, d) {
  const e = {};
  const accs = accountMap(db);
  const leaf = (id) => { const a = accs.get(id); return a && !a.group ? a : null; };
  const isMoney = (id) => !!leaf(id)?.money;
  const party = (db.parties || []).find((p) => p.id === d.party);
  const T = DOC_TYPES[d.type];
  if (!T) return { type: 'نوع مستند غير معروف' };
  if (!isDate(d.date)) e.date = 'اختر تاريخاً صحيحاً';
  const dec = currencyInfo(db.settings?.currency).dec;
  const payRules = (total, kind) => {
    const paid = num(d.paid);
    if (paid < 0) e.paid = 'المبلغ لا يكون سالباً';
    else if (round(paid, dec) > total) e.paid = 'المبلغ المدفوع أكبر من الإجمالي';
    if (paid > 0 && !isMoney(d.payAcc)) e.payAcc = 'اختر الصندوق أو البنك';
    if (!d.party && round(paid, dec) !== total) {
      e.party = kind === 'customer' ? 'اختر العميل، أو سجّل المبلغ كاملاً كمدفوع' : 'اختر المورد، أو سجّل المبلغ كاملاً كمدفوع';
    }
  };
  if (T.lines) {
    const lines = d.lines || [];
    if (!lines.length) e.lines = 'أضف بنداً واحداً على الأقل';
    lines.forEach((l, i) => {
      if (!(num(l.qty) > 0)) e['qty' + i] = 'الكمية أكبر من صفر';
      if (num(l.price) < 0) e['price' + i] = 'السعر لا يكون سالباً';
      if (num(l.disc) < 0 || num(l.disc) > 100) e['disc' + i] = 'الخصم بين 0 و 100';
      if (!l.product && !String(l.desc || '').trim()) e['desc' + i] = 'اختر منتجاً أو اكتب وصفاً';
    });
    if (d.party && (!party || party.kind !== T.party)) e.party = T.party === 'customer' ? 'اختر عميلاً صحيحاً' : 'اختر مورداً صحيحاً';
    if (d.type !== 'quote') payRules(calcDoc(d, dec).total, T.party);
  } else if (d.type === 'expense') {
    const a = leaf(d.account);
    if (!a || !['expense', 'asset'].includes(a.type) || a.money || ['ar', 'ap', 'inv', 'vin'].includes(a.id)) e.account = 'اختر بند المصروف';
    if (!(num(d.amount) > 0)) e.amount = 'اكتب المبلغ';
    if (d.party && (!party || party.kind !== 'supplier')) e.party = 'اختر مورداً صحيحاً';
    payRules(calcDoc(expenseAsDoc(d), dec).total, 'supplier');
  } else if (d.type === 'receipt' || d.type === 'payment') {
    if (!isMoney(d.money)) e.money = 'اختر الصندوق أو البنك';
    if (!(num(d.amount) > 0)) e.amount = 'اكتب المبلغ';
    if (d.party) { if (!party) e.party = 'اختر الطرف'; }
    else {
      const a = leaf(d.account);
      if (!a) e.account = 'اختر الحساب';
      else if (['ar', 'ap', 'inv'].includes(a.id)) e.account = a.id === 'inv' ? 'حركة المخزون تكون من المشتريات أو التسويات' : 'اختر العميل أو المورد بدلاً من الحساب الإجمالي';
      else if (a.id === d.money) e.account = 'الحساب نفس حساب النقدية';
    }
  } else if (d.type === 'transfer') {
    if (!isMoney(d.from)) e.from = 'اختر الحساب المحوَّل منه';
    if (!isMoney(d.to)) e.to = 'اختر الحساب المحوَّل إليه';
    if (d.from && d.from === d.to) e.to = 'اختر حساباً مختلفاً';
    if (!(num(d.amount) > 0)) e.amount = 'اكتب المبلغ';
  } else if (d.type === 'journal') {
    const lines = d.lines || [];
    if (lines.length < 2) e.lines = 'القيد يحتاج سطرين على الأقل';
    let dr = 0, cr = 0;
    lines.forEach((l, i) => {
      const a = leaf(l.account);
      const x = num(l.dr), y = num(l.cr);
      if (!a) e['account' + i] = 'اختر الحساب';
      else if (a.id === 'inv') e['account' + i] = 'حركة المخزون تكون من المشتريات أو التسويات';
      else if ((a.id === 'ar' || a.id === 'ap') && !(db.parties || []).some((p) => p.id === l.party && p.kind === (a.id === 'ar' ? 'customer' : 'supplier'))) {
        e['party' + i] = a.id === 'ar' ? 'اختر العميل' : 'اختر المورد';
      }
      if (x < 0 || y < 0 || (x > 0) === (y > 0)) e['amount' + i] = 'اكتب مبلغاً في المدين أو الدائن';
      dr += x; cr += y;
    });
    if (!e.lines && round(dr, dec) !== round(cr, dec)) e.lines = 'القيد غير متوازن: مجموع المدين لا يساوي الدائن';
  } else if (d.type === 'adjust') {
    const lines = d.lines || [];
    if (!lines.length) e.lines = 'أضف منتجاً واحداً على الأقل';
    lines.forEach((l, i) => {
      const p = (db.products || []).find((x) => x.id === l.product);
      if (!p || p.type !== 'stock') e['product' + i] = 'اختر منتجاً مخزنياً';
      if (!num(l.qty)) e['qty' + i] = 'الفرق لا يكون صفراً';
      if (l.cost !== '' && l.cost != null && num(l.cost) < 0) e['cost' + i] = 'التكلفة لا تكون سالبة';
    });
  }
  return e;
}

// ─── التفقيط: كتابة المبلغ بالحروف للسندات والفواتير ───
const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
const SCALES = [null, ['ألف', 'ألفان', 'آلاف', 'ألفاً'], ['مليون', 'مليونان', 'ملايين', 'مليوناً'], ['مليار', 'ملياران', 'مليارات', 'ملياراً']];

function below1000(n) {
  const h = Math.floor(n / 100), r = n % 100;
  const out = [];
  if (h) out.push(HUNDREDS[h]);
  if (r) {
    if (r < 10) out.push(ONES[r]);
    else if (r < 20) out.push(TEENS[r - 10]);
    else out.push(r % 10 ? `${ONES[r % 10]} و${TENS[Math.floor(r / 10)]}` : TENS[Math.floor(r / 10)]);
  }
  return out.join(' و');
}

export function numberToWords(n) {
  n = Math.floor(Math.abs(num(n)));
  if (!n) return 'صفر';
  if (n >= 1e12) return String(n);
  const groups = [];
  while (n > 0) { groups.push(n % 1000); n = Math.floor(n / 1000); }
  const parts = [];
  for (let s = groups.length - 1; s >= 0; s--) {
    const g = groups[s];
    if (!g) continue;
    if (!s) { parts.push(below1000(g)); continue; }
    const [one, two, plural, accusative] = SCALES[s];
    const r = g % 100;
    if (g === 1) parts.push(one);
    else if (g === 2) parts.push(two);
    else if (r >= 3 && r <= 10) parts.push(`${below1000(g)} ${plural}`);
    else if (r >= 11) parts.push(`${below1000(g)} ${accusative}`);
    else parts.push(`${below1000(g)} ${one}`);
  }
  return parts.join(' و');
}

export function tafqeet(amount, currency) {
  const c = currencyInfo(currency);
  const v = round(Math.abs(num(amount)), c.dec);
  const whole = Math.floor(v);
  const frac = Math.round((v - whole) * 10 ** c.dec);
  let s = `فقط ${numberToWords(whole)} ${c.name}`;
  if (frac && c.sub) s += ` و${frac} ${c.sub}`;
  return s + ' لا غير';
}
