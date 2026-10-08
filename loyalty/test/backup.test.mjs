import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setup, signup } from './helpers.mjs';
import { runScheduled } from '../src/app.js';

// إيميل وهمي متل Cloudflare send_email
function mailer() {
  const sent = [];
  class EmailMessage { constructor(from, to, raw) { Object.assign(this, { from, to, raw }); } }
  return { sent, EmailMessage, MAIL: { send: async (m) => { sent.push(m); } } };
}
const attachment = (raw) => {
  const part = raw.split('Content-Transfer-Encoding: base64\r\n\r\n')[2];
  return JSON.parse(gunzipSync(Buffer.from(part.split('\r\n--')[0].replace(/\r\n/g, ''), 'base64')).toString());
};

test('💾 نسخة احتياطية: تنزيل لمدير المنصة بس، وفيها كل الجداول إلا الحساسة والكاش، وبتسترجع', async () => {
  const { client } = await setup({ PUBLIC_URL: 'https://nuqatak.test' });
  const admin = client();
  const { shop } = await signup(admin, { shopName: 'Mocha' });
  const other = client();
  await signup(other, { shopName: 'Other' });
  await client().post(`/api/shops/${shop.slug}/join`, { name: "سارة O'Neil", phone: '0791234567' });

  assert.equal((await other.get('/api/admin/backup')).status, 403);
  const st = (await admin.get('/api/admin/backup/status')).data;
  assert.equal(st.mail, false);
  assert.equal(st.last, null);

  const res = await admin.req('GET', '/api/admin/backup');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/gzip');
  assert.match(res.headers.get('content-disposition'), /nuqatak-backup-\d{4}-\d\d-\d\d\.json\.gz/);
  const data = JSON.parse(gunzipSync(Buffer.from(res.data)).toString());
  assert.equal(data.app, 'nuqatak');
  assert.equal(data.tables.shops.rows.length, 2);
  assert.equal(data.tables.members.rows.length, 1);
  assert.ok(data.tables.users.columns.includes('pw_hash'));
  for (const t of ['sessions', 'rate_hits', 'strip_cache', 'password_resets']) assert.equal(data.tables[t], undefined, t);
  assert.ok((await admin.get('/api/admin/backup/status')).data.downloadedAt);

  // الاسترجاع: SQL صالح (الاقتباس بالأسماء متل O'Neil)
  const dir = mkdtempSync(path.join(tmpdir(), 'nq-backup-'));
  writeFileSync(path.join(dir, 'b.json.gz'), Buffer.from(res.data));
  const sql = execFileSync('node', ['scripts/restore-backup.mjs', path.join(dir, 'b.json.gz')], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  assert.match(sql, /DELETE FROM "members";/);
  assert.match(sql, /'سارة O''Neil'/);
});

test('💾 كل أسبوع بتنبعت نسخة على إيميل مدير المنصة (إذا Email Routing مربوط)', async () => {
  const m = mailer();
  const { db, env, client } = await setup({ PUBLIC_URL: 'https://nuqatak.test', MAIL: m.MAIL, EmailMessage: m.EmailMessage });
  const admin = client();
  await signup(admin, { shopName: 'Mocha', email: 'boss@example.com' });
  const ctx = { db, env, waitUntil: (x) => x };
  // الخميس 11 بالليل بعمّان (أول مرة: بتنبعت فوراً)
  const thu = Date.UTC(2026, 9, 8, 20, 0);
  let out = await runScheduled(ctx, thu);
  assert.equal(out.backup, 'sent');
  assert.equal(m.sent.length, 1);
  const msg = m.sent[0];
  assert.equal(msg.from, 'backup@nuqatak.test');
  assert.equal(msg.to, 'boss@example.com');
  assert.match(msg.raw, /^From: =\?UTF-8\?B\?/);
  assert.match(msg.raw, /filename="nuqatak-backup-2026-10-08\.json\.gz"/);
  assert.equal(attachment(msg.raw).tables.shops.rows.length, 1);
  // بعد ساعة: ما بتنبعت مرة تانية
  out = await runScheduled(ctx, thu + 3600e3);
  assert.equal(out.backup, 'fresh');
  // بعد أسبوع: بتستنى الساعة 3 الصبح
  out = await runScheduled(ctx, thu + 7 * 864e5);
  assert.equal(out.backup, 'later');
  out = await runScheduled(ctx, Date.UTC(2026, 9, 16, 0, 30)); // 3:30 الصبح بعمّان
  assert.equal(out.backup, 'sent');
  assert.equal(m.sent.length, 2);
  const st = (await admin.get('/api/admin/backup/status')).data;
  assert.deepEqual([st.mail, st.to, st.last.ok, st.last.shops], [true, 'boss@example.com', true, 1]);
  // زر «ابعت هلأ»
  assert.equal((await admin.post('/api/admin/backup/status', {})).status, 200);
  assert.equal(m.sent.length, 3);
  // فشل الإرسال: بيتسجّل، وبيرجع يجرّب بعد 6 ساعات
  m.MAIL.send = async () => { throw new Error('destination not verified'); };
  await db.run("DELETE FROM platform_settings WHERE k = 'backup_last'");
  await assert.rejects(runScheduled(ctx, Date.UTC(2026, 9, 23, 0, 30)).then((o) => { if (o.backup === 'error') throw new Error('error'); return o; }));
  assert.match((await admin.get('/api/admin/backup/status')).data.last.error, /destination not verified/);
  assert.equal((await runScheduled(ctx, Date.UTC(2026, 9, 23, 1, 0))).backup, 'wait');
});
