// ═══ قراءة الإيصالات: رمز QR الضريبي (TLV) أو نص الصورة، وتحويلهما لبيانات مصروف أو فاتورة مشتريات ═══
// دوال بلا DOM تعمل في المتصفح وفي Node؛ الواجهة (الكاميرا وقراءة النص) في views/scan.js

const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const BIDI = /[‎‏‪-‮⁦-⁩؜]/g;

// الأرقام الهندية والفارسية إلى لاتينية، والفاصلة العشرية العربية إلى نقطة، بلا علامات الاتجاه
export function normDigits(s) {
  return String(s ?? '').replace(BIDI, '')
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0))
    .replace(/٫/g, '.').replace(/٬/g, ',');
}

// للمطابقة: حروف صغيرة، بلا تشكيل، والهمزات والتاء المربوطة والياء موحّدة
const kw = (s) => normDigits(s).toLowerCase().replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ً-ْـ]/g, '');
const nameKey = (s) => kw(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const digitsOf = (s) => normDigits(s).replace(/\D/g, '');

const pad = (n) => String(n).padStart(2, '0');
export function isYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
const plusDays = (ymd, n) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// ─── رمز QR لفواتير هيئة الزكاة ───
// 1 اسم البائع، 2 رقمه الضريبي، 3 وقت الفاتورة، 4 الإجمالي شامل الضريبة، 5 الضريبة؛ والمرحلة الثانية تضيف 6-9 للتوقيع
function b64bytes(s) {
  let t = s.replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  return Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
}
export function parseZatcaQR(text, { today } = {}) {
  const s = String(text || '').replace(/\s+/g, '');
  if (s.length < 24 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return null;
  let b;
  try { b = b64bytes(s); } catch (e) { return null; }
  const tags = new Map();
  for (let i = 0; i < b.length;) {
    const tag = b[i], len = b[i + 1];
    if (!tag || len == null || i + 2 + len > b.length) return null;
    if (!tags.has(tag)) tags.set(tag, b.subarray(i + 2, i + 2 + len));
    i += 2 + len;
  }
  const dec = new TextDecoder();
  const txt = (t) => (tags.has(t) ? dec.decode(tags.get(t)).replace(BIDI, '').trim() : '');
  const seller = txt(1).slice(0, 120);
  const vat = digitsOf(txt(2));
  const ts = normDigits(txt(3));
  const total = Number(normDigits(txt(4)).replace(/,/g, ''));
  const tax = Number(normDigits(txt(5)).replace(/,/g, '') || 0);
  const date = findDate(ts, today) || (isYmd(ts.slice(0, 10)) ? ts.slice(0, 10) : '');
  if (!seller || vat.length < 9 || vat.length > 15 || !date || !Number.isFinite(total) || total < 0 || !Number.isFinite(tax) || tax < 0) return null;
  return { kind: 'qr', seller, vat, ts, date, time: (ts.match(/[T ](\d{1,2}:\d{2})/) || [])[1] || '', total: r2(total), tax: r2(tax), signed: tags.has(7) };
}

// ─── التواريخ داخل نص الإيصال ───
const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const AR_MONTHS = [['يناير', 'كانون الثاني'], ['فبراير', 'شباط'], ['مارس', 'اذار'], ['ابريل', 'نيسان'], ['مايو', 'ايار'], ['يونيو', 'حزيران'],
  ['يوليو', 'تموز'], ['اغسطس', 'اب'], ['سبتمبر', 'ايلول'], ['اكتوبر', 'تشرين الاول'], ['نوفمبر', 'تشرين الثاني'], ['ديسمبر', 'كانون الاول']];
function monthOf(word) {
  const w = kw(word).trim().replace(/\.$/, '');
  if (/^[a-z]{3,9}$/.test(w)) { const i = EN_MONTHS.indexOf(w.slice(0, 3)); return i >= 0 ? i + 1 : 0; }
  const i = AR_MONTHS.findIndex((xs) => xs.includes(w));
  return i >= 0 ? i + 1 : 0;
}
// أول تاريخ معقول في النص: سنة-شهر-يوم، يوم/شهر/سنة (أو شهر/يوم إن كان اليوم أكبر من 12)، أو «28 سبتمبر 2026»
export function findDate(text, today) {
  const t = kw(text);
  const year = today ? Number(today.slice(0, 4)) : new Date().getFullYear();
  const found = [];
  const push = (y, m, d, at, short) => {
    y = Number(y);
    if (short) y += 2000;
    const s = `${y}-${pad(Number(m))}-${pad(Number(d))}`;
    if (!isYmd(s) || y < year - (short ? 3 : 10) || y > year + 1) return;
    if (today && s > plusDays(today, 2)) return;
    found.push({ s, at });
  };
  for (const m of t.matchAll(/(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/g)) push(m[1], m[2], m[3], m.index);
  for (const m of t.matchAll(/(?<![\d.])(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?![\d.]|:)/g)) {
    let d = Number(m[1]), mo = Number(m[2]);
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    push(m[3], mo, d, m.index, m[3].length === 2);
  }
  for (const m of t.matchAll(/(?<!\d)(\d{1,2})[\s-]*([a-z]{3,9}|[ء-ي]{2,6}(?: [ء-ي]{4,6})?)\.?[\s,-]*(\d{4})(?!\d)/g)) {
    const mo = monthOf(m[2]);
    if (mo) push(m[3], mo, m[1], m.index);
  }
  for (const m of t.matchAll(/([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?!\d)/g)) {
    const mo = monthOf(m[1]);
    if (mo) push(m[3], mo, m[2], m.index);
  }
  found.sort((a, b) => a.at - b.at);
  return found.length ? found[0].s : '';
}

// ─── المبالغ في سطر: بدون التواريخ والأوقات والنسب والأرقام الطويلة (الضريبي والجوال) ───
function amountsOf(line) {
  const s = line
    .replace(/(?<!\d)\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?!\d)|(?<![\d.])\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}(?![\d.])/g, ' ')
    .replace(/(?<!\d)\d{1,2}:\d{2}(?::\d{2})?(?!\d)/g, ' ')
    .replace(/\d{9,}/g, ' ');
  const out = [];
  for (const m of s.matchAll(/(?<![\d.,])(\d{1,3}(?:,\d{3})+(?:\.\d{1,3})?|\d+(?:[.,]\d{1,3})?)(?![\d])(\s*%)?/g)) {
    const before = s.slice(0, m.index);
    if (m[2] || (/%\s*$/.test(before) && !/\d\s*%\s*$/.test(before))) continue; // 15% أو %15 (ترتيب النص العربي)
    let n = m[1];
    if (/^\d+,\d{1,2}$/.test(n)) n = n.replace(',', '.'); // فاصلة عشرية
    else n = n.replace(/,/g, '');
    const v = Number(n);
    if (Number.isFinite(v)) out.push({ v, dec: /\.\d/.test(n) });
  }
  return out;
}

// كلمات الأسطر (بعد التطبيع)
const TOTAL_ANY = /اجمالي|المجموع|\btotal\b|صافي|المطلوب|المستحق|\bnet\b|\bamount\b|\bbalance\b/;
const TOTAL_TIERS = [
  /شامل|\bincl|\bincluding\b|\bwith\s+(?:vat|tax)|مع الضريبه/,
  /المستحق|\bdue\b|\bpayable\b|المطلوب|صافي|\bnet\b|\bbalance\b/,
  /\bgrand\b|الكلي|اجمالي المبلغ|\btotal\s+amount\b/,
];
const NOT_TOTAL = /قبل|بدون|غير شامل|\bbefore\b|\bexcl|\bsub\s*-?\s*total|الفرعي|خصم|\bdiscount|\bdisc\b|نقد|\bcash\b|\bchange\b|الباقي|المتبقي|مدفوع|\bpaid\b|\btender|\bcard\b|بطاق|مدى|\bmada\b|\bvisa\b|\bmaster|\bitems?\b|عدد|\bqty\b|كميه|نقاط|\bpoints?\b|\btips?\b|توفير|\bsav(?:ed|ing)/;
const VAT_LINE = /ضريب|القيمه المضافه|\bvat\b|\btax\b/;
const VAT_NOT = /رقم|\bno\b|\bnumber\b|\breg|\btrn\b|\bid\b|شامل|\bincl|قبل|\bbefore\b|\bexcl|بدون|غير خاضع|معفي|\bexempt|\bnon\b/;
const VATNO_LINE = /الرقم الضريبي|رقم ضريبي|رقم التسجيل الضريبي|ضريبي رقم|\bvat\s*(?:no|number|reg|registration|#|id)\b|\btrn\b|\btax\s*(?:no|number|id|reg)\b|\btin\b/;
const REF_LINE = /رقم الفاتوره|فاتوره رقم|رقم الايصال|ايصال رقم|رقم الطلب|طلب رقم|\binvoice\s*(?:no|number|#|num)|\binv\.?\s*(?:no|#)|\bbill\s*(?:no|#|number)|\breceipt\s*(?:no|#|number)|\border\s*(?:no|#|number)|\bticket\s*(?:no|#)/;
const TITLE = /فاتوره|ضريبيه|مبسطه|ايصال|\binvoice\b|\breceipt\b|\btax\b|simplified|\bvat\b|رقم|تاريخ|\bdate\b|هاتف|جوال|\btel\b|\bphone\b|\bmobile\b|سجل|\bcr\b|www|http|@|العنوان|\baddress\b|فرع|\bbranch\b|كاشير|\bcashier\b|مرحبا|\bwelcome\b|شكرا|\bthank/;
// نسب ضريبية شائعة في المنطقة؛ للتحقق أن الضريبة المقروءة معقولة
const RATES = [5, 10, 11, 14, 15, 16, 17, 18];

// يستخرج من نص الإيصال (بعد قراءته من الصورة) المورد والتاريخ والإجمالي والضريبة والرقم الضريبي ورقم الفاتورة
export function extractReceipt(text, { today } = {}) {
  const lines = normDigits(text).split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const K = lines.map(kw);
  const onlyNumber = (i) => i < lines.length && !/\p{L}{3,}/u.test(lines[i]);
  const valueAt = (i) => {
    let a = amountsOf(lines[i]);
    if (!a.length && onlyNumber(i + 1)) a = amountsOf(lines[i + 1]);
    const decs = a.filter((x) => x.dec);
    const pick = (decs.length ? decs : a).at(-1);
    return pick ? pick.v : null;
  };

  // الإجمالي: سطر «شامل الضريبة» أولاً، ثم المستحق/الصافي، ثم الإجمالي الكلي، ثم أي «إجمالي»
  const tiers = [[], [], [], []];
  K.forEach((k, i) => {
    if (!TOTAL_ANY.test(k) && !TOTAL_TIERS.some((re) => re.test(k))) return;
    const incl = TOTAL_TIERS[0].test(k);
    if (NOT_TOTAL.test(k) && !incl) return;
    if (VAT_LINE.test(k) && !incl) return; // «إجمالي الضريبة» سطر ضريبة
    const v = valueAt(i);
    if (v == null || v <= 0) return;
    const tier = TOTAL_TIERS.findIndex((re) => re.test(k));
    tiers[tier < 0 ? 3 : tier].push(v);
  });
  let total = null, totalSure = false;
  const best = tiers.find((t) => t.length);
  if (best) { total = Math.max(...best); totalSure = true; }
  else {
    const all = [];
    K.forEach((k, i) => { if (!NOT_TOTAL.test(k) && !VATNO_LINE.test(k)) all.push(...amountsOf(lines[i]).filter((x) => x.dec).map((x) => x.v)); });
    if (all.length) total = Math.max(...all);
  }

  // الضريبة: أول سطر ضريبة ليس الرقم الضريبي ولا «شامل/قبل الضريبة»
  let tax = null;
  for (let i = 0; i < K.length && tax == null; i++) {
    if (!VAT_LINE.test(K[i]) || VAT_NOT.test(K[i])) continue;
    const v = valueAt(i);
    if (v != null && v > 0) tax = v;
  }
  if (tax != null && total != null && tax >= total) tax = null;
  const taxSure = tax != null && total != null && RATES.some((r) => Math.abs((tax / (total - tax)) * 100 - r) < 0.6);

  // الرقم الضريبي: من سطره، أو أي 15 رقماً تبدأ وتنتهي بـ 3 (السعودية)
  let vat = '';
  for (let i = 0; i < K.length && !vat; i++) {
    if (!VATNO_LINE.test(K[i])) continue;
    for (const l of [lines[i], onlyNumber(i + 1) ? lines[i + 1] : '']) {
      const m = (l.match(/\d[\d -]{7,22}\d/g) || []).map((x) => x.replace(/\D/g, '')).find((x) => x.length >= 9 && x.length <= 15);
      if (m) { vat = m; break; }
    }
  }
  if (!vat) {
    const m = normDigits(text).replace(/(\d)[ -](?=\d)/g, '$1').match(/(?<!\d)3\d{13}3(?!\d)/);
    if (m) vat = m[0];
  }

  // رقم الفاتورة: آخر رمز فيه أرقام في سطره (ليس تاريخاً ولا وقتاً ولا مبلغاً عشرياً)
  let ref = '';
  for (let i = 0; i < K.length && !ref; i++) {
    if (!REF_LINE.test(K[i])) continue;
    for (const l of [lines[i], onlyNumber(i + 1) ? lines[i + 1] : '']) {
      const toks = (l.match(/[A-Za-z0-9][A-Za-z0-9\-/#]{0,30}/g) || [])
        .filter((x) => /\d/.test(x) && !/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(x) && !/^\d+\.\d+$/.test(x));
      if (toks.length) { ref = toks.at(-1).replace(/^#/, '').slice(0, 30); break; }
    }
  }

  // اسم البائع: أول سطر نصي في رأس الإيصال ليس عنواناً («فاتورة ضريبية») ولا هاتفاً
  let seller = '';
  for (let i = 0; i < Math.min(lines.length, 6) && !seller; i++) {
    const letters = (lines[i].match(/\p{L}/gu) || []).length;
    const digits = (lines[i].match(/\d/g) || []).length;
    if (letters < 3 || digits > letters / 2 || TITLE.test(K[i])) continue;
    seller = lines[i].replace(/[|*=_~<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  }

  return {
    kind: 'ocr', seller, vat, ref, date: findDate(lines.join('\n'), today),
    total: total != null ? r2(total) : null, tax: tax != null ? r2(tax) : null,
    sure: { total: totalSure, tax: taxSure },
  };
}

// ─── الربط مع بيانات المنشأة ───
// المورد بالرقم الضريبي، ثم بالاسم المطابق تماماً
export function matchSupplier(db, { vat, seller } = {}) {
  const sup = (db.parties || []).filter((p) => p.kind === 'supplier');
  const v = digitsOf(vat);
  if (v) { const p = sup.find((x) => digitsOf(x.vatNo) === v); if (p) return p; }
  const n = nameKey(seller);
  if (n.length >= 3) { const p = sup.find((x) => nameKey(x.name) === n); if (p) return p; }
  return null;
}

// آخر مصروف من نفس المورد أو الجهة: نقترح بنده وطريقة دفعه
export function lastExpenseFrom(db, { party, vat, payee } = {}) {
  const v = digitsOf(vat);
  const n = nameKey(payee);
  const same = (d) => d.type === 'expense' && ((party && d.party === party) || (v && (digitsOf(d.payeeVat) === v || (d.scan && d.scan.vat === v))) || (n.length >= 3 && nameKey(d.payee) === n));
  return (db.docs || []).filter(same).sort((a, b) => b.date.localeCompare(a.date) || (b.no || 0) - (a.no || 0))[0] || null;
}

// هل سُجّل الإيصال من قبل؟ نفس رمز QR، أو نفس المورد والتاريخ والمبلغ
export function findDuplicate(db, info, { except, total } = {}) {
  if (!info) return null;
  const v = digitsOf(info.vat);
  const amt = info.total != null ? info.total : total;
  const near = (a, b) => a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.005;
  // رمزان ضريبيان: الوقت الدقيق يكفي للتمييز؛ وإلا نقارن المورد والتاريخ والمبلغ (ورقم الفاتورة إن وُجد)
  return (db.docs || []).find((d) => d.id !== except && (d.type === 'expense' || d.type === 'purchase') && d.scan && (
    info.kind === 'qr' && d.scan.kind === 'qr'
      ? d.scan.vat === v && d.scan.ts === info.ts && near(d.scan.total, info.total)
      : !!v && d.scan.vat === v && d.date === info.date && near(d.scan.total, amt) && (!info.ref || !d.ref || d.ref === info.ref)
  )) || null;
}

// ما يُحفظ مع المستند من الإيصال (للمقارنة وكشف التكرار)
export const scanMeta = (info) => ({ kind: info.kind, seller: info.seller || '', vat: digitsOf(info.vat), ...(info.ts ? { ts: info.ts } : {}), total: info.total, tax: info.tax });
