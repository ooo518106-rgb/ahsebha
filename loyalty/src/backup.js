// 💾 نسخة احتياطية لقاعدة البيانات: كل الجداول (إلا الكاش واللي بيخلص لحاله) بملف JSON مضغوط (gzip).
// بتنزل من «👑 المنصة ← 💾 النسخ»، وبتنبعت كل أسبوع على إيميلك (Cloudflare Email Routing).
// الاسترجاع: node scripts/restore-backup.mjs ملف.json.gz > restore.sql ← npx wrangler d1 execute loyalty --remote --file=restore.sql

// صور الشريط بترجع تنرسم، والطلبات المؤقتة والجلسات وروابط كلمة السر ما إلها داعي (والجلسات حساسة)
const SKIP = new Set(['strip_cache', 'rate_hits', 'sessions', 'password_resets', 'mfa_tickets']);
// سر التحقق بخطوتين ما بيطلع بالنسخة (بتوصل عالإيميل): بعد الاسترجاع بترجع تشغّله
const SCRUB = { users: new Set(['totp_secret', 'totp_pending']) };
const PAGE = 500;

export async function exportDb(db, now = Date.now()) {
  const names = (await db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name"))
    .map((r) => r.name).filter((n) => !SKIP.has(n));
  const out = { app: 'nuqatak', format: 1, exportedAt: new Date(now).toISOString(), tables: {} };
  for (const t of names) {
    let columns = null;
    const rows = [];
    for (let offset = 0; ; offset += PAGE) {
      const batch = await db.all(`SELECT * FROM "${t}" ORDER BY rowid LIMIT ${PAGE} OFFSET ${offset}`);
      if (batch.length && !columns) columns = Object.keys(batch[0]);
      for (const r of batch) rows.push(columns.map((k) => (SCRUB[t] && SCRUB[t].has(k) ? null : r[k])));
      if (batch.length < PAGE) break;
    }
    out.tables[t] = { columns: columns || [], rows };
  }
  return out;
}

export async function gzipJson(obj) {
  const stream = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const backupName = (now = Date.now()) => `nuqatak-backup-${new Date(now + 3 * 36e5).toISOString().slice(0, 10)}.json.gz`;

// كل جدول وكم صف (للإيميل والصفحة)
export const summary = (data) => Object.entries(data.tables).map(([t, v]) => [t, v.rows.length]);

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const wrap = (s) => s.replace(/.{1,76}/g, '$&\r\n');
const utf8b64 = (text) => b64(new TextEncoder().encode(text));

// إيميل نص عادي (رابط كلمة السر)
export function mimeText({ from, fromName, to, subject, text, now = Date.now() }) {
  const id = `nq${now.toString(36)}${Math.random().toString(36).slice(2)}`;
  return [
    `From: =?UTF-8?B?${utf8b64(fromName)}?= <${from}>`,
    `To: <${to}>`,
    `Subject: =?UTF-8?B?${utf8b64(subject)}?=`,
    `Date: ${new Date(now).toUTCString()}`,
    `Message-ID: <${id}@${from.split('@')[1]}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(utf8b64(text)),
  ].join('\r\n');
}

// إيميل MIME فيه الملف مرفق (Cloudflare send_email بياخد الإيميل خام)
export function mimeMessage({ from, fromName, to, subject, text, filename, data, now = Date.now() }) {
  const boundary = `nq${now.toString(36)}${Math.random().toString(36).slice(2)}`;
  const domain = from.split('@')[1];
  return [
    `From: =?UTF-8?B?${utf8b64(fromName)}?= <${from}>`,
    `To: <${to}>`,
    `Subject: =?UTF-8?B?${utf8b64(subject)}?=`,
    `Date: ${new Date(now).toUTCString()}`,
    `Message-ID: <${boundary}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(utf8b64(text)),
    `--${boundary}`,
    `Content-Type: application/gzip; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    'Content-Transfer-Encoding: base64',
    '',
    wrap(b64(data)),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}
