import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signup } from './helpers.mjs';

test('نسيت كلمة السر: الطلب بيوصل للمنصة، والمدير بيعمل رابط لمرة وحدة، وكلمة السر الجديدة بتطلّع الجلسات القديمة', async () => {
  const w = await setup({ WHATSAPP_NUMBER: '962798900911' });
  const admin = w.client();
  await signup(admin, { shopName: 'Platform' });
  const owner = w.client();
  const { email, shop } = await signup(owner, { shopName: 'Cafe Two' });

  // الطلب: نفس الرد للإيميل الموجود والمش موجود (ما بنكشف مين مسجّل)
  const anon = w.client();
  assert.equal((await anon.post('/api/auth/forgot', { email: 'nobody@x.test' })).status, 200);
  const r = await anon.post('/api/auth/forgot', { email: email.toUpperCase() });
  assert.equal(r.status, 200);
  assert.equal(r.data.whatsapp, '962798900911', 'رقمك، مش رقم الوكيل');
  assert.equal((await anon.post('/api/auth/forgot', { email: 'x' })).status, 400);
  await anon.flush(); // الإشعار بعد الرد
  let row = (await admin.get('/api/admin/shops')).data.shops.find((s) => s.id === shop.id);
  assert.ok(row.resetAskedAt, 'بيبيّن بقائمة المحلات');

  // الرابط: للمدير بس
  assert.equal((await owner.post(`/api/admin/shops/${shop.id}/reset-link`)).status, 403);
  const link = (await admin.post(`/api/admin/shops/${shop.id}/reset-link`)).data;
  assert.equal(link.email, email);
  const token = new URL(link.url).searchParams.get('reset');
  assert.match(token, /^[a-z2-9]{32}$/);
  row = (await admin.get('/api/admin/shops')).data.shops.find((s) => s.id === shop.id);
  assert.equal(row.resetAskedAt, null);

  assert.equal((await anon.get(`/api/auth/reset?token=${token}`)).data.email, email);
  assert.equal((await anon.get('/api/auth/reset?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).status, 404);
  assert.equal((await anon.post('/api/auth/reset', { token, password: 'short' })).status, 400);

  // كلمة السر الجديدة: بتدخّله، وبتطلّع الجلسة القديمة، والرابط ما بينفع مرتين
  assert.equal((await owner.get('/api/me')).status, 200);
  const ok = await anon.post('/api/auth/reset', { token, password: 'brand-new-pass-1' });
  assert.equal(ok.status, 200);
  assert.equal((await anon.get('/api/me')).data.shop.id, shop.id, 'دخل لحاله');
  assert.equal((await owner.get('/api/me')).status, 401, 'الجلسة القديمة طلعت');
  assert.equal((await anon.post('/api/auth/reset', { token, password: 'another-pass-1' })).status, 404);
  const fresh = w.client();
  assert.equal((await fresh.post('/api/auth/login', { email, password: 'secret-pass-1' })).status, 401);
  assert.equal((await fresh.post('/api/auth/login', { email, password: 'brand-new-pass-1' })).status, 200);

  // رابط جديد بيلغي القديم
  const a = new URL((await admin.post(`/api/admin/shops/${shop.id}/reset-link`)).data.url).searchParams.get('reset');
  const b = new URL((await admin.post(`/api/admin/shops/${shop.id}/reset-link`)).data.url).searchParams.get('reset');
  assert.equal((await anon.get(`/api/auth/reset?token=${a}`)).status, 404);
  assert.equal((await anon.get(`/api/auth/reset?token=${b}`)).status, 200);
});

test('صفحة الشروط والأحكام بتفتح، وفيها الأسعار والاسترجاع', async () => {
  const w = await setup();
  const r = await w.client().get('/terms');
  assert.equal(r.status, 200);
  assert.match(String(r.data), /\/terms\.html/, 'بيرجّع صفحة الشروط');
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('../public/terms.html', import.meta.url), 'utf8');
  assert.match(text, /الشروط والأحكام/);
  assert.match(text, /الإلغاء والاسترجاع/);
  assert.match(text, /12 دينار/);
});

test('Google: robots.txt بيمنع اللوحة وبطاقات الزبائن، وخريطة الموقع فيها الصفحات العامة', async () => {
  const w = await setup({ PUBLIC_URL: 'https://nuqatak.test' });
  const c = w.client();
  const robots = await c.get('/robots.txt');
  assert.equal(robots.status, 200);
  assert.match(String(robots.data), /Disallow: \/c\//);
  assert.match(String(robots.data), /Disallow: \/app/);
  assert.match(String(robots.data), /Sitemap: https:\/\/nuqatak\.test\/sitemap\.xml/);
  const map = String((await c.get('/sitemap.xml')).data);
  for (const u of ['https://nuqatak.test/', 'https://nuqatak.test/terms', 'https://nuqatak.test/privacy']) assert.ok(map.includes(`<loc>${u}</loc>`), u);
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1]);
  assert.equal(ld[1]['@type'], 'SoftwareApplication');
});
