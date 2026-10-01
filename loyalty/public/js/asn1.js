// ASN.1 DER بأبسط شكل: بناء وقراءة، بحدود اللي بنحتاجه لطلب الشهادة (CSR) وتوقيع بطاقات Apple (PKCS#7)

export function concat(parts) {
  const list = parts.flat(Infinity).filter(Boolean);
  const out = new Uint8Array(list.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of list) { out.set(p, o); o += p.length; }
  return out;
}

function encLen(n) {
  if (n < 0x80) return Uint8Array.of(n);
  const bytes = [];
  while (n > 0) { bytes.unshift(n & 0xff); n = Math.floor(n / 256); }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

export const tlv = (tag, ...contents) => { const body = concat(contents); return concat([Uint8Array.of(tag), encLen(body.length), body]); };
export const seq = (...c) => tlv(0x30, ...c);
export const set = (...c) => tlv(0x31, ...c);
export const ctx = (n, ...c) => tlv(0xa0 | n, ...c); // [n] بنية (constructed)
export const NULL = Uint8Array.of(0x05, 0x00);
export const octets = (bytes) => tlv(0x04, bytes);
export const bits = (bytes) => tlv(0x03, Uint8Array.of(0), bytes);
export const utf8 = (s) => tlv(0x0c, new TextEncoder().encode(s));
export const printable = (s) => tlv(0x13, new TextEncoder().encode(s));

export function int(n) {
  if (typeof n === 'number') {
    const bytes = [];
    do { bytes.unshift(n & 0xff); n = Math.floor(n / 256); } while (n > 0);
    if (bytes[0] & 0x80) bytes.unshift(0);
    return tlv(0x02, Uint8Array.from(bytes));
  }
  return tlv(0x02, n[0] & 0x80 ? concat([Uint8Array.of(0), n]) : n);
}

export function oid(dotted) {
  const parts = dotted.split('.').map(Number);
  const out = [40 * parts[0] + parts[1]];
  for (const v of parts.slice(2)) {
    const stack = [v & 0x7f];
    let x = Math.floor(v / 128);
    while (x > 0) { stack.unshift((x & 0x7f) | 0x80); x = Math.floor(x / 128); }
    out.push(...stack);
  }
  return tlv(0x06, Uint8Array.from(out));
}

export function utcTime(date) {
  const p = (n) => String(n).padStart(2, '0');
  const s = `${p(date.getUTCFullYear() % 100)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
  return tlv(0x17, new TextEncoder().encode(s));
}

// SET OF بالـ DER لازم يكون مرتّب حسب الترميز
export function setOf(items) {
  const sorted = [...items].sort((a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
    return a.length - b.length;
  });
  return set(...sorted);
}

// ─── القراءة ───
export function read(der, offset = 0) {
  const tag = der[offset];
  let len = der[offset + 1];
  let head = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + der[offset + 2 + i];
    head = 2 + n;
  }
  const start = offset + head;
  return { tag, start, end: start + len, offset, raw: der.subarray(offset, start + len), body: der.subarray(start, start + len) };
}

export function children(der, node) {
  const out = [];
  for (let o = node.start; o < node.end;) { const c = read(der, o); out.push(c); o = c.end; }
  return out;
}

export function oidToString(bytes) {
  const out = [Math.floor(bytes[0] / 40), bytes[0] % 40];
  let v = 0;
  for (const b of bytes.subarray(1)) {
    v = v * 128 + (b & 0x7f);
    if (!(b & 0x80)) { out.push(v); v = 0; }
  }
  return out.join('.');
}

export function pemToDer(pem) {
  const b64 = String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function derToPem(der, label) {
  let s = '';
  for (let i = 0; i < der.length; i += 0x8000) s += String.fromCharCode(...der.subarray(i, i + 0x8000));
  const b64 = btoa(s).replace(/(.{64})/g, '$1\n').replace(/\n$/, '');
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}
