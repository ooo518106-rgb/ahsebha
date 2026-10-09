// 🧾 قراءة QR الفاتورة بالكاميرا: المبلغ ورقم الفاتورة، بدل ما الكاشير يكتبهم.
// بيفهم: فواتير الضريبة الإلكترونية (TLV بـ base64، متل الفوترة الإلكترونية بالسعودية)، روابط فيها المبلغ، JSON، ونص عادي.
// إذا ما لقى مبلغ، بيرجّع بصمة للفاتورة على الأقل (نفس الفاتورة ما بتاخد نقاط مرتين)، والكاشير بيكتب المبلغ.

const MAX_AMOUNT = 100000;
const num = (v) => {
  const n = Number(String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[,٫]/g, '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 && n <= MAX_AMOUNT ? Math.round(n * 1000) / 1000 : null;
};
const cleanRef = (v) => { const s = String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 60); return s.length >= 2 ? s : null; };

// بصمة قصيرة ثابتة للنص (FNV-1a بـ 64 بت): نفس الـ QR = نفس البصمة
export function receiptRef(text) {
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(String(text))) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `qr-${h.toString(36)}`;
}

function b64Bytes(s) {
  if (!/^[A-Za-z0-9+/=_-]{12,}$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch { return null; }
}

// TLV: [رقم الحقل][الطول][القيمة UTF-8]… الحقل 1 البائع، 3 الوقت، 4 المجموع مع الضريبة، 5 الضريبة
export function parseTlv(text) {
  const b = b64Bytes(String(text).trim());
  if (!b || b.length < 6) return null;
  const out = {};
  const dec = new TextDecoder('utf-8', { fatal: true });
  let i = 0;
  let count = 0;
  while (i < b.length) {
    const tag = b[i];
    const len = b[i + 1];
    if (!tag || tag > 30 || len === undefined || i + 2 + len > b.length) return null;
    try { out[tag] = dec.decode(b.subarray(i + 2, i + 2 + len)); } catch { return null; }
    i += 2 + len;
    count++;
  }
  return count >= 3 ? out : null;
}

const AMOUNT_KEYS = ['total', 'amount', 'grand_total', 'grandtotal', 'invoicetotal', 'invoice_total', 'totalamount', 'total_amount', 'sum', 'payable'];
const REF_KEYS = ['invoice', 'invoiceno', 'invoice_no', 'invoicenumber', 'invoice_number', 'inv', 'receipt', 'receiptno', 'receipt_no', 'number', 'no', 'uuid', 'id', 'ref'];
function pick(obj, keys) {
  const low = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase().replace(/[\s-]/g, '_'), v]));
  for (const k of keys) {
    const v = low[k] ?? low[k.replace(/_/g, '')];
    if (v !== undefined && v !== null && typeof v !== 'object') return v;
  }
  return null;
}

export function parseReceipt(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  // بطاقة زبون (رمز 20 حرف أو رابط /c/…): مش فاتورة
  if (/^[a-z2-9]{20}$/.test(text) || /\/c\/[a-z2-9]{20}(?:[/?#]|$)/.test(text)) return { card: true };
  const tlv = parseTlv(text);
  if (tlv) {
    const amount = num(tlv[4]);
    return { amount, invoice: receiptRef(text), seller: tlv[1] || null, source: 'tlv' };
  }
  if (/^[{[]/.test(text)) {
    try {
      const o = JSON.parse(text);
      if (o && typeof o === 'object' && !Array.isArray(o)) return { amount: num(pick(o, AMOUNT_KEYS)), invoice: cleanRef(pick(o, REF_KEYS)) || receiptRef(text), source: 'json' };
    } catch { /* مش JSON */ }
  }
  if (/^https?:\/\//i.test(text)) {
    try {
      const u = new URL(text);
      const q = Object.fromEntries(u.searchParams);
      return { amount: num(pick(q, AMOUNT_KEYS)), invoice: cleanRef(pick(q, REF_KEYS)) || receiptRef(text), source: 'url' };
    } catch { /* رابط غلط */ }
  }
  const total = /(?:total|grand\s*total|amount|المجموع|الإجمالي|الاجمالي|المبلغ|المطلوب)[^\d٠-٩]{0,15}([\d٠-٩]+(?:[.,٫][\d٠-٩]+)?)/i.exec(text);
  const ref = /(?:invoice|receipt|inv|فاتورة|رقم\s*الفاتورة)\s*(?:no\.?|number|#|رقم)?\s*[:#-]?\s*([A-Za-z0-9-]{3,30})/i.exec(text);
  return { amount: total ? num(total[1]) : null, invoice: (ref && cleanRef(ref[1])) || receiptRef(text), source: 'text' };
}
