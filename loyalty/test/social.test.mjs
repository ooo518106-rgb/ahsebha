import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signup } from './helpers.mjs';
import { runScheduled } from '../src/app.js';
import { LIBRARY, readCfg } from '../src/social.js';

// Meta وهمي: الصفحة وإنستغرام، وتجهيز الصورة ونشرها، وصور الصفحة. وGemini وهمي بيكتب النص
function fakeMeta({ igFails = false } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
    if (u.startsWith('https://generativelanguage.googleapis.com/')) {
      if (u.includes('/models?')) return json({ models: [{ name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] }] });
      calls.push({ ai: JSON.parse(init.body) });
      return json({ candidates: [{ content: { role: 'model', parts: [{ text: 'زبونك نسيك؟ 🤔\nجرّب 14 يوم ببلاش، الرابط بالبايو 👆\n\n#نقاطك' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } });
    }
    if (!u.startsWith('https://graph.facebook.com/')) return new Response(null, { status: 201 });
    const body = init.body ? JSON.parse(init.body) : null;
    const auth = new Headers(init.headers).get('authorization');
    calls.push({ url: u, method: init.method || 'GET', body, auth });
    if (u.includes('/me/accounts')) return json({ data: [{ id: 'P1', name: 'نقاطك - Nuqatak', access_token: 'page-token', instagram_business_account: { id: 'IG1', username: 'nuqatak' } }] });
    if (u.includes('/IG1/media_publish')) return json({ id: `igpost${calls.length}` });
    if (u.includes('/IG1/media')) return igFails ? json({ error: { message: 'Only photo or video can be accepted as media type.', code: 9004 } }, 400) : json({ id: 'C1' });
    if (u.includes('/C1?fields=status_code')) return json({ status_code: 'FINISHED' });
    if (u.includes('/P1/photos')) return json({ id: 'ph1', post_id: `P1_${calls.length}` });
    return json({ error: { message: 'unknown' } }, 400);
  };
  return { fetch, calls };
}

// السبت 10 أكتوبر 2026، الساعة 7:30 مسا بتوقيت الأردن (UTC+3)
const SAT_EVENING = Date.UTC(2026, 9, 10, 16, 30);
const HOUR = 36e5;

async function platform(env) {
  const w = await setup({ PUBLIC_URL: 'https://nuqatak.test', ...env });
  const admin = w.client();
  await signup(admin, { shopName: 'Platform' });
  const cron = (now) => runScheduled({ db: w.db, env: w.env, waitUntil: (x) => x }, now);
  return { ...w, admin, cron };
}

test('وكيل النشر: المنشورات الجاهزة بتنزل على إنستغرام وفيسبوك لحالها، منشور باليوم بالساعة اللي اخترتها', async () => {
  const m = fakeMeta();
  const p = await platform({ fetch: m.fetch, META_TOKEN: 'meta-token' });
  const owner = p.client();
  await signup(owner, { shopName: 'Cafe' });
  assert.equal((await owner.get('/api/admin/social')).status, 403, 'بس مدير المنصة');
  let s = (await p.admin.get('/api/admin/social')).data;
  assert.equal(s.ready, true);
  assert.deepEqual(s.account, { ok: true, page: 'نقاطك - Nuqatak', ig: 'nuqatak' });
  assert.equal(s.cfg.on, false, 'مطفي لحد ما تشغّله');
  assert.equal(s.library, LIBRARY.length);
  // المكتبة: مرة وحدة بس
  s = (await p.admin.post('/api/admin/social/posts', { library: true })).data;
  assert.equal(s.posts.length, LIBRARY.length);
  assert.equal(s.library, 0);
  s = (await p.admin.post('/api/admin/social/posts', { library: true })).data;
  assert.equal(s.posts.length, LIBRARY.length);
  assert.equal(s.posts[0].image, '/social/w1-1-steps.jpg');
  // مطفي: ما بينشر
  assert.equal((await p.cron(SAT_EVENING)).social, 'off');
  assert.equal((await p.admin.put('/api/admin/social', { on: true, days: [], hour: 19 })).status, 400);
  s = (await p.admin.put('/api/admin/social', { on: true, days: [6, 0, 1, 2, 3, 4], hour: 19, ig: true, fb: true })).data;
  assert.deepEqual(s.cfg, { on: true, days: [0, 1, 2, 3, 4, 6], hour: 19, ig: true, fb: true });
  // قبل الساعة 7 ما بينشر، وبعدها بينشر أول واحد
  assert.equal((await p.cron(SAT_EVENING - 2 * HOUR)).social, 'later');
  assert.equal((await p.cron(SAT_EVENING)).social, 'posted');
  const media = m.calls.find((x) => x.url && x.url.endsWith('/IG1/media'));
  assert.equal(media.body.image_url, 'https://nuqatak.test/social/w1-1-steps.jpg');
  assert.equal(media.body.caption, LIBRARY[0].caption);
  assert.equal(media.auth, 'Bearer page-token', 'بتوكن الصفحة');
  assert.ok(m.calls.some((x) => x.url && x.url.endsWith('/IG1/media_publish') && x.body.creation_id === 'C1'));
  const photo = m.calls.find((x) => x.url && x.url.endsWith('/P1/photos'));
  assert.deepEqual(photo.body, { url: 'https://nuqatak.test/social/w1-1-steps.jpg', caption: LIBRARY[0].caption });
  // نفس اليوم ما بيرجع ينشر
  assert.equal((await p.cron(SAT_EVENING + HOUR)).social, 'done');
  s = (await p.admin.get('/api/admin/social')).data;
  const posted = s.posts.find((x) => x.status === 'posted');
  assert.equal(posted.image, '/social/w1-1-steps.jpg');
  assert.equal(posted.ig, true);
  assert.equal(posted.fb, true);
  assert.equal(s.last.ok, true);
  // الجمعة مش من الأيام، والسبت الجاي بينزل التاني
  assert.equal((await p.cron(SAT_EVENING - 24 * HOUR)).social, 'later');
  assert.equal((await p.cron(SAT_EVENING + 24 * HOUR)).social, 'posted');
  assert.equal(m.calls.filter((x) => x.url && x.url.endsWith('/IG1/media')).at(-1).body.image_url, 'https://nuqatak.test/social/w1-2-notifs.jpg');
});

test('وكيل النشر: صورة مرفوعة بدون نص، الوكيل بيكتبه؛ انشر هلأ؛ وإذا إنستغرام رفض بيبيّن السبب', async () => {
  const m = fakeMeta({ igFails: true });
  const p = await platform({ fetch: m.fetch, META_TOKEN: 'meta-token', GEMINI_API_KEY: 'g' });
  const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64')}`;
  assert.equal((await p.admin.post('/api/admin/social/posts', { dataUrl: 'data:image/png;base64,iVBORw0KGgo=' })).status, 400, 'JPG بس');
  let s = (await p.admin.post('/api/admin/social/posts', { dataUrl: jpeg, topic: 'العيد' })).data;
  const post = s.posts[0];
  assert.equal(post.caption, '');
  assert.equal(post.image, `/media/social/${post.id}.jpg`);
  const img = await p.client().get(`/media/social/${post.id}.jpg`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  // انشر هلأ: إنستغرام رفض، فيسبوك نزل
  s = (await p.admin.post(`/api/admin/social/posts/${post.id}`, { action: 'publish' })).data;
  const done = s.posts.find((x) => x.id === post.id);
  assert.equal(done.status, 'posted');
  assert.equal(done.fb, true);
  assert.equal(done.ig, false);
  assert.match(done.error, /^إنستغرام: Only photo/);
  assert.match(done.caption, /^زبونك نسيك؟/, 'الوكيل كتب النص');
  assert.match(m.calls.find((x) => x.ai).ai.contents[0].parts[0].text, /العيد/);
  assert.equal(m.calls.find((x) => x.url && x.url.endsWith('/P1/photos')).body.url, `https://nuqatak.test/media/social/${post.id}.jpg`);
  assert.equal((await p.admin.post(`/api/admin/social/posts/${post.id}`, { action: 'publish' })).status, 400, 'نزل قبل');
  // تعديل النص، الأول بالدور، والحذف
  s = (await p.admin.post('/api/admin/social/posts', { dataUrl: jpeg, caption: 'نص 1' })).data;
  s = (await p.admin.post('/api/admin/social/posts', { dataUrl: jpeg, caption: 'نص 2' })).data;
  const [a, b] = s.posts.filter((x) => x.status === 'queued');
  assert.deepEqual([a.caption, b.caption], ['نص 1', 'نص 2']);
  s = (await p.admin.post(`/api/admin/social/posts/${b.id}`, { action: 'top' })).data;
  assert.equal(s.posts[0].id, b.id);
  s = (await p.admin.post(`/api/admin/social/posts/${b.id}`, { action: 'caption', caption: 'نص جديد' })).data;
  assert.equal(s.posts[0].caption, 'نص جديد');
  s = (await p.admin.post(`/api/admin/social/posts/${b.id}`, { action: 'delete' })).data;
  assert.ok(!s.posts.some((x) => x.id === b.id));
  assert.equal((await p.client().get(`/media/social/${b.id}.jpg`)).status, 404);
});

test('وكيل النشر: بيقبل توكن الصفحة نفسها كمان', async () => {
  const fetch = async (url) => {
    const u = String(url);
    const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
    if (u.includes('/me/accounts')) return json({ error: { message: '(#100) Tried accessing nonexisting field (accounts) on node type (Page)', code: 100 } }, 400);
    if (u.includes('/me?fields=')) return json({ id: 'P9', name: 'نقاطك', category: 'Software', instagram_business_account: { id: 'IG9', username: 'nuqatak' } });
    return new Response(null, { status: 201 });
  };
  const p = await platform({ fetch, META_TOKEN: 'page-token' });
  assert.deepEqual((await p.admin.get('/api/admin/social')).data.account, { ok: true, page: 'نقاطك', ig: 'nuqatak' });
});

test('وكيل النشر: بدون META_TOKEN بيبيّن إنه مش مربوط، والإعدادات بتتصلّح', async () => {
  const p = await platform({});
  const s = (await p.admin.get('/api/admin/social')).data;
  assert.equal(s.ready, false);
  assert.equal(s.account, null);
  assert.equal((await p.cron(SAT_EVENING)).social, 'off');
  assert.deepEqual(readCfg({ on: 1, days: [9, 'x', 2, 2], hour: 40, ig: false }), { on: true, days: [2], hour: 19, ig: false, fb: true });
});
