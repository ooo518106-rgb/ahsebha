import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signup } from './helpers.mjs';
import { runScheduled } from '../src/app.js';
import { exportDb, verifyBackup } from '../src/backup.js';
import { MEMBER_DELETE_GUARD } from '../src/schema.js';

test('💰 الربح الحقيقي: الدخل بعد الخصم، ناقص عمولة المندوب والمصاريف، والدخل المتكرر الفعلي', async () => {
  const { client } = await setup();
  const admin = client();
  await signup(admin, { shopName: 'Platform' });
  await admin.put('/api/admin/settings', { cliqAlias: 'NUQATAK', cliqName: 'نقاطك', cliqBank: 'البنك العربي' });
  const rs = (await admin.post('/api/admin/resellers', { name: 'خالد', pct: 20 })).data.resellers[0];
  const owner = client();
  await owner.post('/api/auth/signup', { shopName: 'Cafe Partner', email: 'fin@test.com', password: 'secret-pass-1', partner: rs.code });
  const claim = (await owner.post('/api/billing/claim', { plan: 'month', tier: 'pro', payer: 'أحمد' })).data;
  assert.equal(claim.payments[0].amount, 17.5, 'عرض أول المحلات 30%');
  await admin.post(`/api/admin/payments/${(await admin.get('/api/admin/payments')).data.payments[0].id}`, { action: 'approve' });

  assert.equal((await owner.get('/api/admin/finance')).status, 403);
  let f = (await admin.get('/api/admin/finance')).data;
  assert.deepEqual([f.month.gross, f.month.discounts, f.month.net, f.month.costs.commissions], [25, 7.5, 17.5, 3.5]);
  assert.equal(f.cfg.saved, false, 'أرقام مقترحة لحد ما يحفظ');
  assert.equal(f.month.costs.fixedJod, 6.56, '(8.25 + 1) × 0.709');
  assert.equal(f.month.profit, 7.44);
  assert.deepEqual([f.mrr.now, f.mrr.list, f.mrr.free], [17.5, 25, 0]);

  assert.equal((await admin.put('/api/admin/finance', { waUsd: 5, fixed: [] })).status, 400);
  f = (await admin.put('/api/admin/finance', { waUsd: 0.05, fixed: [{ name: 'Cloudflare المدفوع', usd: 5 }, { name: '', usd: 3 }, { name: 'غلط', usd: -1 }] })).data;
  assert.deepEqual(f.cfg.fixed, [{ name: 'Cloudflare المدفوع', usd: 5 }]);
  assert.equal(f.month.costs.fixedJod, 3.55);
  assert.equal(f.month.profit, 10.45);
});

test('🚨 مراقبة التشغيل: أخطاء السيرفر، المهام الدورية، والتنبيه مرة كل 12 ساعة لنفس المشكلة', async () => {
  const { db, env, client } = await setup({ PUBLIC_URL: 'https://nuqatak.test' });
  const admin = client();
  await signup(admin, { shopName: 'Platform' });
  const owner = client();
  await signup(owner, { shopName: 'Cafe' });
  assert.equal((await owner.get('/api/admin/ops')).status, 403);
  let checks = (await admin.get('/api/admin/ops')).data.checks;
  const by = (k) => checks.find((x) => x.key === k);
  assert.equal(by('cron').state, 'warn', 'لسا ما اشتغلت');
  assert.equal(by('errors').state, 'ok');
  assert.equal(by('backup').state, 'warn', 'الإيميل مش مربوط');

  // 25 خطأ بالساعة الأخيرة
  const now = Date.now();
  const hour = Math.floor(now / 36e5);
  await db.run('INSERT INTO rate_hits (k, n, expires_at) VALUES (?, 25, ?)', `err:${hour}`, (hour + 2) * 36e5);
  await db.run("INSERT INTO platform_settings (k, v) VALUES ('err_last', ?)", JSON.stringify({ at: now, where: 'POST /api/x', message: 'boom' }));
  const cron = (t) => runScheduled({ db, env, waitUntil: (x) => x }, t);
  const out = await cron(now);
  assert.equal(out.ops, 1, 'نبّهنا على مشكلة وحدة');
  checks = (await admin.get('/api/admin/ops')).data.checks;
  assert.equal(by('cron').state, 'ok');
  assert.equal(by('errors').state, 'bad');
  assert.match(by('errors').detail, /25 خطأ.*boom/);
  assert.equal((await cron(now + 5 * 60e3)).ops, 'later', 'كل ساعة');
  assert.equal((await cron(now + 2 * 36e5)).ops, 0, 'نفس المشكلة: مش قبل 12 ساعة');

  // المهام وقفت: أي حدا بيفتح اللوحة بيشغّل الفحص
  await db.run("UPDATE platform_settings SET v = ? WHERE k = 'cron_last'", String(Date.now() - 2 * 36e5));
  await owner.get('/api/me');
  await owner.flush();
  const alerted = (await admin.get('/api/admin/ops')).data.alerted;
  assert.ok(alerted.cron > now - 60e3);
  assert.equal((await admin.get('/api/admin/ops')).data.checks.find((x) => x.key === 'cron').state, 'bad');
});

test('🧪 فحص الاسترجاع: النسخة بتنفك وبترجع كاملة، وملف SQL جاهز، والنسخة الناقصة بتنكشف', async () => {
  const sent = [];
  class EmailMessage { constructor(from, to, raw) { Object.assign(this, { from, to, raw }); } }
  const { db, client } = await setup({ PUBLIC_URL: 'https://nuqatak.test', MAIL: { send: async (m) => { sent.push(m); } }, EmailMessage });
  const admin = client();
  const { shop } = await signup(admin, { shopName: 'Platform' });
  await client().post(`/api/shops/${shop.slug}/join`, { name: 'زبون', phone: '0791230000' });
  assert.equal((await client().post('/api/admin/backup/verify')).status, 401);
  const v = (await admin.post('/api/admin/backup/verify')).data;
  assert.equal(v.ok, true, JSON.stringify(v.issues));
  assert.ok(v.tables > 15 && v.rows > 3);
  assert.equal((await admin.get('/api/admin/backup/status')).data.restoreCheck.ok, true);
  const sql = (await admin.get('/api/admin/backup/restore.sql')).data;
  assert.match(String(sql), /INSERT INTO "members"/);
  assert.match(String(sql), /protect_member_funds/);
  // النسخة الأسبوعية بتنفحص قبل ما تنبعت
  await admin.post('/api/admin/backup/status', {});
  assert.equal(sent.length, 1);
  assert.equal((await admin.get('/api/admin/backup/status')).data.last.verified, true);
  // نسخة ناقصة جدول وصفوف: بتنكشف
  const data = await exportDb(db);
  delete data.tables.members;
  data.tables.txns.columns.push('ghost');
  data.tables.app_x = { columns: ['a'], rows: [[1]] };
  const bad = await verifyBackup(db, data, MEMBER_DELETE_GUARD);
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.some((x) => /جدول ناقص: members/.test(x)));
  assert.ok(bad.issues.some((x) => /أعمدة مختلفة: txns/.test(x)));
  assert.ok(bad.issues.some((x) => /جدول مش موجود بقاعدة البيانات: app_x/.test(x)));
  const ops = (await admin.get('/api/admin/ops')).data.checks;
  assert.equal(ops.find((x) => x.key === 'restore').state, 'ok');
});
