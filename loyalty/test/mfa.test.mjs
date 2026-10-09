import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { setup, signup } from './helpers.mjs';
import * as totp from '../src/totp.js';

// الرمز اللي رح يطلّعه التطبيق بعد [n] خطوات من هلأ
const code = (secret, n = 0) => totp.codeAt(secret, totp.stepOf() + n);
const wrong = async (secret) => String((Number(await code(secret)) + 1) % 1e6).padStart(6, '0');

test('TOTP: نفس رموز RFC 6238، والرمز ما بينعاد، ومقبول ±30 ثانية', async () => {
  const secret = totp.base32(new TextEncoder().encode('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.deepEqual([...totp.unbase32(secret)], [...new TextEncoder().encode('12345678901234567890')]);
  for (const [t, want] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037']]) {
    assert.equal(await totp.codeAt(secret, Math.floor(t / 30)), want, String(t));
  }
  const now = 1234567890e3;
  const step = totp.stepOf(now);
  assert.equal(await totp.verify(secret, '005924', now), step);
  assert.equal(await totp.verify(secret, '005 924', now), step, 'المسافات عادي');
  assert.equal(await totp.verify(secret, '005924', now, step), 0, 'نفس الرمز ما بينعاد');
  assert.equal(await totp.verify(secret, '005924', now + 30e3), step, 'الرمز اللي قبله مقبول');
  assert.equal(await totp.verify(secret, '005924', now + 90e3), 0, 'رمز قديم');
  assert.equal(await totp.verify(secret, '12345', now), 0);
  assert.match(totp.newSecret(), /^[A-Z2-7]{32}$/);
});

test('🔐 التحقق بخطوتين: تشغيل، دخول برمز، رموز احتياطية، حماية من التكرار، رابط كلمة السر، وإطفاء', async () => {
  const w = await setup({ PUBLIC_URL: 'https://nuqatak.test' });
  const admin = w.client();
  const { email } = await signup(admin, { shopName: 'Platform' });
  const pass = 'secret-pass-1';
  assert.equal((await admin.get('/api/me')).data.user.mfa, false);
  assert.deepEqual((await admin.get('/api/me/2fa')).data, { on: false, recoveryLeft: 0 });

  // التشغيل: كلمة السر أول، بعدين أول رمز من التطبيق
  assert.equal((await admin.post('/api/me/2fa/setup', { password: 'wrong-pass' })).status, 400);
  const s = (await admin.post('/api/me/2fa/setup', { password: pass })).data;
  assert.match(s.secret, /^[A-Z2-7]{32}$/);
  assert.ok(s.uri.startsWith('otpauth://totp/Nuqatak:'));
  assert.ok(s.uri.includes(`secret=${s.secret}`));
  assert.equal((await admin.post('/api/auth/login', { email, password: pass })).data.mfa, undefined, 'لسا مش مفعّل');
  const other = w.client();
  assert.equal((await other.post('/api/auth/login', { email, password: pass })).status, 200);
  assert.equal((await admin.post('/api/me/2fa/enable', { code: await wrong(s.secret) })).status, 400);
  const en = await admin.post('/api/me/2fa/enable', { code: await code(s.secret) });
  assert.equal(en.status, 200, JSON.stringify(en.data));
  assert.equal(en.data.codes.length, 8);
  assert.match(en.data.codes[0], /^[a-z2-9]{5}-[a-z2-9]{5}$/);
  assert.equal((await admin.get('/api/me')).data.user.mfa, true, 'إنت بتضل داخل');
  assert.equal((await other.get('/api/me')).status, 401, 'الأجهزة التانية طلعت');
  assert.deepEqual((await admin.get('/api/me/2fa')).data, { on: true, recoveryLeft: 8 });
  assert.equal((await admin.post('/api/me/2fa/setup', { password: pass })).status, 409);

  // الدخول: كلمة السر لحالها ما بتكفي
  const c = w.client();
  const l = await c.post('/api/auth/login', { email, password: pass });
  assert.equal(l.status, 200);
  assert.equal(l.data.mfa, true);
  assert.match(l.data.ticket, /^[a-z2-9]{32}$/);
  assert.equal(l.headers.get('set-cookie'), null);
  assert.equal((await c.get('/api/me')).status, 401);
  assert.equal((await c.post('/api/auth/2fa', { ticket: l.data.ticket, code: await wrong(s.secret) })).status, 400);
  const next = await code(s.secret, 1);
  const ok = await c.post('/api/auth/2fa', { ticket: l.data.ticket, code: next });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal((await c.get('/api/me')).data.user.email, email);
  assert.equal((await c.post('/api/auth/2fa', { ticket: l.data.ticket, code: next })).status, 401, 'التذكرة لمرة وحدة');
  // نفس الرمز ما بيدخّل مرة تانية (حدا شافه)
  const c2 = w.client();
  const l2 = await c2.post('/api/auth/login', { email, password: pass });
  assert.equal((await c2.post('/api/auth/2fa', { ticket: l2.data.ticket, code: next })).status, 400);
  // 5 محاولات غلط: التذكرة بتنحرق
  for (let i = 0; i < 4; i++) assert.equal((await c2.post('/api/auth/2fa', { ticket: l2.data.ticket, code: '000000x' })).status, 400);
  assert.equal((await c2.post('/api/auth/2fa', { ticket: l2.data.ticket, code: en.data.codes[0] })).status, 401);
  assert.equal((await c2.get('/api/me')).status, 401);

  // رمز احتياطي: بيدخّل مرة وحدة
  const c3 = w.client();
  const l3 = await c3.post('/api/auth/login', { email, password: pass });
  const rec = await c3.post('/api/auth/2fa', { ticket: l3.data.ticket, code: en.data.codes[0].toUpperCase() });
  assert.equal(rec.status, 200);
  assert.equal(rec.data.recovery, 7);
  const l4 = await w.client().post('/api/auth/login', { email, password: pass });
  assert.equal((await c3.post('/api/auth/2fa', { ticket: l4.data.ticket, code: en.data.codes[0] })).status, 400, 'انستعمل');

  // صاحب محل تاني: رابط كلمة السر بيغيّرها بس، والدخول لازم بالرمز
  const owner = w.client();
  const o = await signup(owner, { shopName: 'Cafe Two' });
  const os = (await owner.post('/api/me/2fa/setup', { password: pass })).data;
  assert.equal((await owner.post('/api/me/2fa/enable', { code: await code(os.secret) })).status, 200);
  assert.equal((await admin.get('/api/admin/shops')).data.shops.find((x) => x.id === o.shop.id).mfa, 1);
  const link = (await admin.post(`/api/admin/shops/${o.shop.id}/reset-link`)).data;
  const anon = w.client();
  const reset = await anon.post('/api/auth/reset', { token: new URL(link.url).searchParams.get('reset'), password: 'brand-new-pass-1' });
  assert.equal(reset.status, 200);
  assert.equal(reset.data.mfa, true);
  assert.equal((await anon.get('/api/me')).status, 401, 'الرابط ما بيدخّل بدون الرمز');
  assert.equal((await anon.post('/api/auth/2fa', { ticket: reset.data.ticket, code: await code(os.secret, 1) })).status, 200);
  assert.equal((await anon.get('/api/me')).data.shop.id, o.shop.id);
  // ضيّع جواله: المدير بس بيطفّيله، وبيطلع من كل الأجهزة
  assert.equal((await owner.get('/api/me')).status, 401, 'كلمة السر الجديدة طلّعت الجلسة القديمة');
  assert.equal((await anon.post(`/api/admin/shops/${o.shop.id}/mfa-off`)).status, 403);
  assert.equal((await admin.post(`/api/admin/shops/${o.shop.id}/mfa-off`)).status, 200);
  assert.equal((await anon.get('/api/me')).status, 401);
  assert.equal((await w.client().post('/api/auth/login', { email: o.email, password: 'brand-new-pass-1' })).data.ok, true);

  // النسخة الاحتياطية ما فيها السر
  const gz = (await admin.get('/api/admin/backup')).data;
  const users = JSON.parse(gunzipSync(Buffer.from(gz)).toString()).tables.users;
  const col = users.columns.indexOf('totp_secret');
  assert.ok(col >= 0);
  assert.ok(users.rows.every((r) => r[col] === null));
  assert.ok(!('mfa_tickets' in JSON.parse(gunzipSync(Buffer.from(gz)).toString()).tables));

  // رموز جديدة وإطفاء: كلمة السر + رمز (احتياطي كمان بينفع)
  assert.equal((await admin.post('/api/me/2fa/codes', { password: pass, code: await wrong(s.secret) })).status, 400);
  const fresh = await admin.post('/api/me/2fa/codes', { password: pass, code: en.data.codes[1] });
  assert.equal(fresh.status, 200);
  assert.equal((await admin.get('/api/me/2fa')).data.recoveryLeft, 8);
  assert.equal((await admin.post('/api/me/2fa/disable', { password: pass, code: en.data.codes[2] })).status, 400, 'الرموز القديمة بطلت');
  assert.equal((await admin.post('/api/me/2fa/disable', { password: 'nope-nope', code: fresh.data.codes[0] })).status, 400);
  assert.equal((await admin.post('/api/me/2fa/disable', { password: pass, code: fresh.data.codes[0] })).status, 200);
  assert.equal((await admin.get('/api/me')).data.user.mfa, false);
  assert.equal((await w.client().post('/api/auth/login', { email, password: pass })).data.ok, true);
});

// إيميل وهمي متل Cloudflare send_email
function mailer() {
  const sent = [];
  class EmailMessage { constructor(from, to, raw) { Object.assign(this, { from, to, raw }); } }
  return { sent, EmailMessage, MAIL: { send: async (m) => { sent.push(m); } } };
}
const bodyOf = (raw) => Buffer.from(raw.split('\r\n\r\n').slice(1).join('').replace(/\r\n/g, ''), 'base64').toString();

test('🔑 نسيت كلمة السر: إذا الإيميل بيبعت، الرابط بيوصل لحاله (ساعة)، وإذا ما زبط بيوصلك إشعار', async () => {
  const m = mailer();
  const w = await setup({ PUBLIC_URL: 'https://nuqatak.test', MAIL: m.MAIL, EmailMessage: m.EmailMessage });
  const admin = w.client();
  await signup(admin, { shopName: 'Platform' });
  const owner = w.client();
  const { email, shop } = await signup(owner, { shopName: 'Cafe Two' });
  const anon = w.client();
  const r = await anon.post('/api/auth/forgot', { email: 'nobody@x.test' });
  assert.equal(r.data.mail, true);
  await anon.flush();
  assert.equal(m.sent.length, 0, 'إيميل مش مسجّل: ما بنبعت إشي');
  await anon.post('/api/auth/forgot', { email });
  await anon.flush();
  assert.equal(m.sent.length, 1);
  assert.equal(m.sent[0].to, email);
  assert.equal(m.sent[0].from, 'no-reply@nuqatak.test');
  const text = bodyOf(m.sent[0].raw);
  assert.match(text, /Cafe Two/);
  const token = /\?reset=([a-z2-9]{32})/.exec(text)[1];
  assert.equal((await anon.get(`/api/auth/reset?token=${token}`)).data.email, email);
  assert.equal((await admin.get('/api/admin/shops')).data.shops.find((s) => s.id === shop.id).resetAskedAt, null, 'وصله إيميل: ما في داعي تزعجك');
  assert.equal((await admin.get('/api/admin/backup/status')).data.resetMail.ok, true);
  assert.equal((await anon.post('/api/auth/reset', { token, password: 'brand-new-pass-1' })).status, 200);

  // الإرسال ما زبط (خطة مجانية مثلاً): بيرجع للطريقة القديمة
  m.MAIL.send = async () => { throw new Error('destination address not verified'); };
  await w.client().post('/api/auth/forgot', { email });
  await anon.flush();
  const c = w.client();
  await c.post('/api/auth/forgot', { email });
  await c.flush();
  assert.ok((await admin.get('/api/admin/shops')).data.shops.find((s) => s.id === shop.id).resetAskedAt);
  const st = (await admin.get('/api/admin/backup/status')).data.resetMail;
  assert.equal(st.ok, false);
  assert.match(st.error, /not verified/);
});
