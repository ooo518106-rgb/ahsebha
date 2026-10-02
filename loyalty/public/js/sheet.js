// قراءة ملف Excel (‎.xlsx) أو CSV بالمتصفح بدون مكتبات: بيرجّع صفوف (مصفوفة نصوص)
// ملف xlsx = ZIP فيه XML، فبنفك الـ ZIP بـ DecompressionStream وبنقرأ أول ورقة

const colIndex = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

async function unzip(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('الملف مش Excel صالح');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const files = {};
  const dec = new TextDecoder();
  for (let n = 0; n < count && dv.getUint32(off, true) === 0x02014b50; n++) {
    const nameLen = dv.getUint16(off + 28, true);
    const name = dec.decode(u8.subarray(off + 46, off + 46 + nameLen));
    files[name] = { method: dv.getUint16(off + 10, true), size: dv.getUint32(off + 20, true), local: dv.getUint32(off + 42, true) };
    off += 46 + nameLen + dv.getUint16(off + 30, true) + dv.getUint16(off + 32, true);
  }
  return async (name) => {
    const f = files[name];
    if (!f) return null;
    const start = f.local + 30 + dv.getUint16(f.local + 26, true) + dv.getUint16(f.local + 28, true);
    const data = u8.subarray(start, start + f.size);
    if (f.method === 0) return dec.decode(data);
    return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  };
}

export async function readXlsx(buf) {
  const read = await unzip(buf);
  const xml = (text) => new DOMParser().parseFromString(text, 'application/xml');
  const shared = [];
  const ss = await read('xl/sharedStrings.xml');
  if (ss) for (const si of xml(ss).getElementsByTagName('si')) shared.push([...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
  const sheet = await read('xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('ما لقينا ورقة بالملف');
  const rows = [];
  for (const row of xml(sheet).getElementsByTagName('row')) {
    const r = [];
    for (const c of row.getElementsByTagName('c')) {
      const col = colIndex((c.getAttribute('r') || 'A').replace(/\d+/g, ''));
      const t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      r[col] = t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? [...c.getElementsByTagName('t')].map((x) => x.textContent).join('') : v;
    }
    rows.push(Array.from(r, (x) => (x ?? '').toString().trim()));
  }
  return rows;
}

export function readCsv(text) {
  const src = text.replace(/^﻿/, '');
  const first = src.split(/\r?\n/)[0] || '';
  const delim = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell.trim()); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows.filter((r) => r.some((x) => x));
}

// تاريخ الميلاد من أي شكل: 21/5، 21/05/1996، 1996-05-21، أو رقم تاريخ Excel
export function parseBirthday(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (/^\d{4,5}(\.\d+)?$/.test(s) && Number(s) > 59) {
    const d = new Date(Math.round((Number(s) - 25569) * 864e5));
    return { day: d.getUTCDate(), month: d.getUTCMonth() + 1 };
  }
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return { day: Number(m[3]), month: Number(m[2]) };
  m = /^(\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return { day: Number(m[1]), month: Number(m[2]) };
  return null;
}
