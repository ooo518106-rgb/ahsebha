import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { setup, signup } from './helpers.mjs';
import { runScheduled } from '../src/app.js';
import { cleanHistory } from '../src/ai.js';
import { isOptOut, waNumber } from '../src/whatsapp.js';

// Anthropic وهمي + واتساب وهمي: بيسجّلوا الطلبات، وClaude بيرد حسب الدالة (نص، أو استعمال أداة)
function fakes(reply = () => ({ text: 'أهلا! شو نوع محلك؟ ☕' }), waReply = () => ({ status: 200 })) {
  const claude = [];
  const graph = [];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://graph.facebook.com/')) {
      const body = init.body ? JSON.parse(init.body) : {};
      graph.push({ url: u, headers: new Headers(init.headers), body });
      const r = waReply(body, graph.length);
      if (r.status !== 200) return new Response(JSON.stringify({ error: { message: r.message || 'boom', code: r.code } }), { status: r.status, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ messages: [{ id: `wamid.${graph.length}` }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (!u.startsWith('https://api.anthropic.com/')) return new Response(null, { status: 201 });
    const body = JSON.parse(init.body);
    claude.push({ url: u, headers: new Headers(init.headers), body });
    const r = reply(body, claude.length);
    if (r.status) return new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'boom' } }), { status: r.status, headers: { 'content-type': 'application/json' } });
    const content = [{ type: 'thinking', thinking: '', signature: 'sig' }];
    if (r.text) content.push({ type: 'text', text: r.text });
    if (r.tool) content.push({ type: 'tool_use', id: `toolu_${claude.length}`, name: r.tool, input: r.input });
    return new Response(JSON.stringify({
      id: `msg_${claude.length}`, type: 'message', role: 'assistant', model: body.model, content,
      stop_reason: r.refusal ? 'refusal' : r.tool ? 'tool_use' : 'end_turn', stop_sequence: null,
      usage: { input_tokens: 150, output_tokens: 90, cache_read_input_tokens: 2400, cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: r.searches || 0 } },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, claude, graph };
}

const WA_ENV = { WHATSAPP_TOKEN: 'wa-token', WHATSAPP_PHONE_ID: '1234567890', WHATSAPP_APP_SECRET: 'app-secret', WHATSAPP_VERIFY_TOKEN: 'verify-me', WA_DEBOUNCE_MS: '0' };

async function platform(env) {
  const w = await setup({ PUBLIC_URL: 'https://nuqatak.test', ...env });
  const admin = w.client();
  await signup(admin, { shopName: 'Platform' });
  return { ...w, admin };
}

const lastUser = (call) => call.body.messages[call.body.messages.length - 1];
const sign = (raw, secret = 'app-secret') => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
function hook(c, payload, secret) {
  const raw = JSON.stringify(payload);
  return c.req('POST', '/api/wa/webhook', raw, { 'x-hub-signature-256': sign(raw, secret) });
}
const incomingMsg = (from, text, id = `wamid.in.${Math.random()}`) => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1234567890' }, contacts: [{ wa_id: from, profile: { name: 'أبو أحمد' } }], messages: [{ from, id, timestamp: '1760000000', type: 'text', text: { body: text } }] } }] }],
});
// الأحد 12 الظهر بتوقيت عمّان (9 الصبح UTC)
const SUNDAY_NOON = Date.UTC(2026, 9, 11, 9, 0);

test('مساعد المبيعات بالموقع: بيبعت لـ Claude التعليمات والأسعار (بالكاش) وبيرجّع الجواب، ومخفي بدون مفتاح', async () => {
  const off = await platform({});
  assert.equal((await off.client().get('/api/site')).data.sales, false);
  assert.equal((await off.client().post('/api/sales', { messages: [{ role: 'user', content: 'مرحبا' }] })).status, 404);

  const f = fakes();
  const p = await platform({ ANTHROPIC_API_KEY: 'sk-test', fetch: f.fetch });
  assert.equal((await p.client().get('/api/site')).data.sales, true);
  const r = await p.client().post('/api/sales', { messages: [{ role: 'user', content: 'كم السعر؟' }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.reply, 'أهلا! شو نوع محلك؟ ☕');
  const call = f.claude[0];
  assert.equal(call.headers.get('x-api-key'), 'sk-test');
  assert.match(call.headers.get('anthropic-beta'), /server-side-fallback-2026-07-01/);
  const b = call.body;
  assert.equal(b.model, 'claude-opus-5-5');
  assert.equal(b.fallbacks, 'default');
  assert.deepEqual(b.output_config, { effort: 'low' });
  assert.deepEqual(b.system[0].cache_control, { type: 'ephemeral' });
  assert.match(b.system[0].text, /أساسي 12 دينار بالشهر أو 120 دينار بالسنة/);
  assert.match(b.system[0].text, /مميز 25 دينار بالشهر أو 250 دينار بالسنة/);
  assert.match(b.system[0].text, /العرض الوحيد بالسعر: «عرض أول المحلات»: أول 20 محل بيشتركوا بياخدوا خصم 30% على أول 3 شهور \(الأساسي 8\.4 دينار/);
  assert.match(b.system[0].text, /غير هيك السعر ثابت/);
  assert.match(b.system[0].text, /لـ 30 يوم كحد أقصى/);
  assert.match(b.system[0].text, /https:\/\/nuqatak\.test\/#start/);
  assert.match(b.system[1].text, /القناة: المحادثة على موقع نقاطك/);
  assert.deepEqual(b.tools.map((t) => t.name), ['make_offer', 'save_contact']);
  assert.deepEqual(b.messages, [{ role: 'user', content: 'كم السعر؟' }]);
  // الاستهلاك بينحسب لصفحة المنصة
  const st = (await p.admin.get('/api/admin/stats')).data.ai;
  assert.equal(st.requests, 1);
  assert.equal(st.byKind.web, 1);
  assert.ok(st.costUsd >= 0);
});

test('مساعد المبيعات: بياخد رقم صاحب المحل كطلب، وبيعمل عرض تجربة أطول (لحد 30 يوم) بيشتغل بالتسجيل', async () => {
  let step = 0;
  const f = fakes((body) => {
    step++;
    const last = body.messages[body.messages.length - 1];
    if (step === 1) return { tool: 'save_contact', input: { shop_name: 'كوفي الورد', name: 'أحمد', phone: '0791234567', city: 'عمّان', kind: 'كوفي شوب', note: 'فرعين، المميز' } };
    if (step === 2) { assert.equal(last.content[0].type, 'tool_result'); return { text: 'تمام، سجّلت رقمك ومنتواصل معك 🙌' }; }
    if (step === 3) return { tool: 'make_offer', input: { trial_days: 60, plan: 'pro', reason: 'متردد' } };
    if (step === 4) { assert.equal(last.content[0].is_error, true); assert.match(last.content[0].content, /بين 15 و 30/); return { tool: 'make_offer', input: { trial_days: 30, plan: 'pro', reason: 'متردد' } }; }
    const out = JSON.parse(last.content[0].content);
    assert.match(out.link, /^https:\/\/nuqatak\.test\/\?offer=[a-z2-9]{8}#start$/);
    return { text: `جهزتلك تجربة 30 يوم: ${out.link}` };
  });
  const p = await platform({ ANTHROPIC_API_KEY: 'sk-test', fetch: f.fetch });
  const visitor = p.client();
  const r1 = await visitor.post('/api/sales', { messages: [{ role: 'user', content: 'أنا أحمد من كوفي الورد 0791234567' }] });
  assert.equal(r1.data.lead, true);
  const leads = (await p.admin.get('/api/admin/leads')).data.leads;
  assert.equal(leads[0].shopName, 'كوفي الورد');
  assert.equal(leads[0].source, 'ai');
  const r2 = await visitor.post('/api/sales', { messages: [{ role: 'user', content: 'بدي وقت أفكر' }] });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  assert.equal(r2.data.offer.trialDays, 30);
  const code = r2.data.offer.code;
  assert.equal((await visitor.get(`/api/offers/${code}`)).data.trialDays, 30);
  // التسجيل بالعرض: التجربة 30 يوم، والعرض بيخلص بعدها
  const shopOwner = p.client();
  await signup(shopOwner, { shopName: 'Rose Cafe', offer: code });
  const sub = (await shopOwner.get('/api/me')).data.subscription;
  assert.equal(sub.state, 'trial');
  assert.ok(sub.daysLeft >= 29 && sub.daysLeft <= 30, String(sub.daysLeft));
  assert.equal((await visitor.get(`/api/offers/${code}`)).status, 404);
  const again = p.client();
  await signup(again, { shopName: 'Other Cafe', offer: code });
  assert.ok((await again.get('/api/me')).data.subscription.daysLeft <= 14);
});

test('مساعد المبيعات: الرفض والأخطاء بيرجعوا رسالة لطيفة، وحد الرسائل باليوم', async () => {
  const f = fakes((b, n) => (n === 1 ? { refusal: true } : { status: 500 }));
  const p = await platform({ ANTHROPIC_API_KEY: 'sk-test', fetch: f.fetch, AI_VISITOR_DAILY: '3' });
  const v = p.client();
  const r = await v.post('/api/sales', { messages: [{ role: 'user', content: 'سؤال' }] });
  assert.equal(r.status, 200);
  assert.match(r.data.reply, /ما بقدر أساعد/);
  const e = await v.post('/api/sales', { messages: [{ role: 'user', content: 'سؤال' }] });
  assert.equal(e.status, 503);
  assert.equal((await v.post('/api/sales', { messages: [{ role: 'assistant', content: 'بس رد' }] })).status, 400);
  await v.post('/api/sales', { messages: [{ role: 'user', content: 'سؤال' }] });
  assert.equal((await v.post('/api/sales', { messages: [{ role: 'user', content: 'سؤال' }] })).status, 429);
  assert.deepEqual(cleanHistory([{ role: 'assistant', content: 'أهلا' }, { role: 'user', content: 'a' }, { role: 'user', content: 'b' }]), [{ role: 'user', content: 'a\nb' }]);
});

test('البحث عن محلات: بالإنترنت (web search)، وبيحفظ اللي إلهم موبايل بالدور والباقي يدوي، وبدون تكرار', async () => {
  const shops = [
    { name: 'كوفي الياسمين', area: 'عبدون، عمّان', kind: 'كوفي شوب', phone: '0791112223', instagram: '@yasmine.cafe', website: 'https://maps.google.com/x', why: 'تقييم 4.7', opener: 'مرحبا كوفي الياسمين 👋 شفت تقييماتكم الحلوة بعبدون!' },
    { name: 'مخبز الشام', area: 'الصويفية', kind: 'مخبز', phone: '06 5551234', instagram: '', website: 'javascript:alert(1)', why: '' },
    { name: 'كوفي الياسمين', area: 'عبدون', kind: 'كوفي شوب', phone: '0791112223', instagram: '', website: '', why: '' },
  ];
  const f = fakes(() => ({ tool: 'save_shops', input: { shops }, searches: 4 }));
  const p = await platform({ ANTHROPIC_API_KEY: 'sk-test', fetch: f.fetch });
  assert.equal((await p.client().post('/api/admin/sales/search', { query: 'كوفي شوب بعبدون' })).status, 401);
  const r = await p.admin.post('/api/admin/sales/search', { query: 'كوفي شوب بعبدون', count: 10 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.added, 2);
  assert.equal(f.claude.length, 1, 'بعد save_shops ما في جولة زيادة');
  const b = f.claude[0].body;
  const ws = b.tools.find((t) => t.type === 'web_search_20260209');
  assert.equal(ws.name, 'web_search');
  assert.equal(ws.user_location.country, 'JO');
  assert.deepEqual(b.output_config, { effort: 'medium' });
  const cafe = r.data.prospects.find((x) => x.name === 'كوفي الياسمين');
  const bakery = r.data.prospects.find((x) => x.name === 'مخبز الشام');
  assert.equal(cafe.wa, '962791112223');
  assert.equal(cafe.status, 'new');
  assert.equal(cafe.instagram, 'https://instagram.com/yasmine.cafe');
  assert.equal(bakery.wa, null);
  assert.equal(bakery.status, 'manual');
  assert.equal(bakery.website, null, 'روابط غير http بتنشال');
  // رسالة لكل محل: أول جملة كتبها الوكيل، ورابطه الخاص بالموقع
  assert.match(cafe.message, /^مرحبا كوفي الياسمين 👋 شفت تقييماتكم الحلوة بعبدون!/);
  assert.match(cafe.message, /https:\/\/nuqatak\.test\/\?p=[a-z2-9]{8}/);
  assert.ok(cafe.waLink.startsWith('https://wa.me/962791112223?text='));
  assert.equal(decodeURIComponent(cafe.waLink.split('text=')[1]), cafe.message);
  assert.match(bakery.message, /مرحبا مخبز الشام/, 'بدون رسالة من الوكيل: رسالة عامة');
  // بالبحث الجاي بيقله شو عنا من قبل
  await p.admin.post('/api/admin/sales/search', { query: 'كوفي بعبدون' });
  assert.match(f.claude[1].body.messages[0].content, /كوفي الياسمين/);
  assert.equal((await p.admin.get('/api/admin/sales')).data.prospects.length, 2);
  assert.equal((await p.admin.get('/api/admin/stats')).data.ai.searches, 8);
});

test('واتساب: الإرسال التلقائي بأوقات الدوام وضمن الحد باليوم، ومشكلة القالب بتوقفه', async () => {
  const f = fakes();
  const p = await platform({ ANTHROPIC_API_KEY: 'sk-test', fetch: f.fetch, ...WA_ENV });
  for (const [name, phone] of [['محل 1', '0791000001'], ['محل 2', '0791000002'], ['محل 3', '0791000003']]) {
    assert.equal((await p.admin.post('/api/admin/prospects', { name, phone })).status, 200);
  }
  assert.equal((await p.admin.post('/api/admin/prospects', { name: 'أرضي', phone: '065551234' })).status, 400);
  const cron = (now) => runScheduled({ db: p.db, env: p.env, waitUntil: (x) => x }, now);
  assert.equal((await cron(SUNDAY_NOON)).outreach, 0, 'مطفي لحد ما يشغّله');
  assert.equal((await p.admin.put('/api/admin/sales/settings', { auto: true, daily: 2 })).status, 200);
  assert.equal((await cron(SUNDAY_NOON - 4 * 3600e3)).outreach, 0, '8 الصبح: بدري');
  assert.equal((await cron(SUNDAY_NOON - 2 * 86400e3)).outreach, 0, 'الجمعة');
  assert.equal((await cron(SUNDAY_NOON)).outreach, 2);
  assert.equal((await cron(SUNDAY_NOON + 300e3)).outreach, 0, 'الحد باليوم');
  const t = f.graph.find((g) => g.body.type === 'template');
  assert.equal(t.url, 'https://graph.facebook.com/v26.0/1234567890/messages');
  assert.equal(t.headers.get('authorization'), 'Bearer wa-token');
  assert.equal(t.body.to, '962791000001');
  assert.equal(t.body.template.name, 'nuqatak_intro');
  assert.deepEqual(t.body.template.components[0].parameters, [{ type: 'text', text: 'محل 1' }]);
  const st = (await p.admin.get('/api/admin/sales')).data;
  assert.equal(st.sentToday, 2);
  assert.equal(st.counts.sent, 2);

  // القالب مش موافق عليه: بيوقف الإرسال كله والمحل بيرجع للدور
  const g = fakes(undefined, () => ({ status: 400, code: 132001, message: 'Template name does not exist' }));
  const q = await platform({ ANTHROPIC_API_KEY: 'sk-test', fetch: g.fetch, ...WA_ENV });
  await q.admin.post('/api/admin/prospects', { name: 'محل', phone: '0791000009' });
  await q.admin.put('/api/admin/sales/settings', { auto: true, daily: 20 });
  assert.equal((await runScheduled({ db: q.db, env: q.env, waitUntil: (x) => x }, SUNDAY_NOON)).outreach, 0);
  const qs = (await q.admin.get('/api/admin/sales')).data;
  assert.equal(qs.settings.auto, false);
  assert.equal(qs.prospects[0].status, 'new');
  assert.match(qs.prospects[0].error, /Template/);
  assert.match(qs.stopped.why, /Template/, 'السبب بيبيّن بصفحة المبيعات');
  assert.equal(g.graph.filter((x) => x.body.type === 'template').length, 1);
});

test('واتساب: إذا Meta وقّفت القالب أو نزّلت تقييم الرقم (بلاغات وحظر)، الإرسال بيوقف لحاله', async () => {
  let quality = 'GREEN';
  const sends = [];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    const ok = (d) => new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } });
    if (!u.startsWith('https://graph.facebook.com/')) return new Response(null, { status: 201 });
    if (u.includes('?fields=display_phone_number')) return ok({ quality_rating: quality, status: 'CONNECTED' });
    sends.push(JSON.parse(init.body));
    return ok({ messages: [{ id: `wamid.q${sends.length}` }] });
  };
  const p = await platform({ GEMINI_API_KEY: 'g', fetch, ...WA_ENV, WHATSAPP_WABA_ID: '5550001' });
  for (let i = 1; i <= 8; i++) await p.admin.post('/api/admin/prospects', { name: `محل ${i}`, phone: `079100000${i}` });
  await p.admin.put('/api/admin/sales/settings', { auto: true, daily: 20 });
  const cron = (now) => runScheduled({ db: p.db, env: p.env, waitUntil: (x) => x }, now);
  assert.equal((await cron(SUNDAY_NOON)).outreach, 2, 'أخضر: بيبعت');
  // صار أصفر: بيوقف بس بعد ساعة من آخر فحص
  quality = 'YELLOW';
  assert.equal((await cron(SUNDAY_NOON + 300e3)).outreach, 2, 'الفحص كل ساعة');
  assert.equal((await cron(SUNDAY_NOON + 3700e3)).outreach, 0);
  let st = (await p.admin.get('/api/admin/sales')).data;
  assert.equal(st.settings.auto, false);
  assert.match(st.stopped.why, /أصفر/);
  // إنت رجّعت شغّلته وهو أصفر: بيكمّل، وإذا صار أحمر بيوقف
  await p.admin.put('/api/admin/sales/settings', { auto: true, daily: 20 });
  assert.equal((await p.admin.get('/api/admin/sales')).data.stopped, null);
  assert.equal((await cron(SUNDAY_NOON + 2 * 3700e3)).outreach, 2);
  quality = 'RED';
  assert.equal((await cron(SUNDAY_NOON + 3 * 3700e3)).outreach, 0);
  st = (await p.admin.get('/api/admin/sales')).data;
  assert.equal(st.settings.auto, false);
  assert.match(st.stopped.why, /أحمر/);

  // Meta وقّفت القالب (إشعار على الـ webhook)
  quality = 'GREEN';
  await p.admin.put('/api/admin/sales/settings', { auto: true, daily: 20 });
  const meta = p.client();
  const paused = { object: 'whatsapp_business_account', entry: [{ id: '5550001', changes: [{ field: 'message_template_status_update', value: { event: 'PAUSED', message_template_name: 'nuqatak_intro', message_template_language: 'ar', reason: 'Low quality' } }] }] };
  assert.equal((await hook(meta, paused)).status, 200);
  st = (await p.admin.get('/api/admin/sales')).data;
  assert.equal(st.settings.auto, false);
  assert.match(st.stopped.why, /وقّفت قالب أول رسالة \(PAUSED\): Low quality/);
  // قالب تاني، أو موافقة: ما بيوقف
  await p.admin.put('/api/admin/sales/settings', { auto: true, daily: 20 });
  await hook(meta, { ...paused, entry: [{ id: '5550001', changes: [{ field: 'message_template_status_update', value: { event: 'APPROVED', message_template_name: 'nuqatak_intro' } }] }] });
  await hook(meta, { ...paused, entry: [{ id: '5550001', changes: [{ field: 'message_template_status_update', value: { event: 'PAUSED', message_template_name: 'other' } }] }] });
  assert.equal((await p.admin.get('/api/admin/sales')).data.settings.auto, true);
  // تقييم الرقم نزل (إشعار)
  await hook(meta, { object: 'whatsapp_business_account', entry: [{ id: '5550001', changes: [{ field: 'phone_number_quality_update', value: { display_phone_number: '962770528804', event: 'FLAGGED', current_limit: 'TIER_250' } }] }] });
  st = (await p.admin.get('/api/admin/sales')).data;
  assert.equal(st.settings.auto, false);
  assert.match(st.stopped.why, /FLAGGED/);
});

test('واتساب: الـ webhook موقّع، الوكيل بيرد ويفاوض، و«لا» بتوقف الرسائل، وإنت بتقدر ترد بنفسك', async () => {
  let step = 0;
  const f = fakes((body) => {
    step++;
    if (step === 1) return { text: 'أهلا أبو أحمد! كم فرع عندك؟' };
    if (step === 2) return { tool: 'call_owner', input: { reason: 'بده يحكي عن فرعين' } };
    return { text: 'تمام، صاحب المنصة رح يحكي معك اليوم 🙏' };
  });
  const p = await platform({ ANTHROPIC_API_KEY: 'sk-test', fetch: f.fetch, ...WA_ENV });
  const meta = p.client();
  // ربط الـ webhook
  assert.equal((await meta.get('/api/wa/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345')).data, '12345');
  assert.equal((await meta.get('/api/wa/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1')).status, 403);
  // بدون توقيع صحيح ما بنقبل
  const raw = JSON.stringify(incomingMsg('962791000001', 'مرحبا'));
  assert.equal((await meta.req('POST', '/api/wa/webhook', raw, { 'x-hub-signature-256': sign(raw, 'wrong') })).status, 401);
  const diag = (await p.admin.get('/api/admin/wa/number')).data.lastHook;
  assert.equal(diag.signed, false);
  assert.deepEqual(diag.fields, ['messages']);
  assert.equal(diag.ours, 1, 'رسالة وحدة لرقم الإيجنت');

  await p.admin.post('/api/admin/prospects', { name: 'كوفي الورد', phone: '0791000001', kind: 'كوفي شوب' });
  await p.admin.put('/api/admin/sales/settings', { auto: true, daily: 20 });
  await runScheduled({ db: p.db, env: p.env, waitUntil: (x) => x }, SUNDAY_NOON);
  const id = (await p.admin.get('/api/admin/sales')).data.prospects[0].id;

  assert.equal((await hook(meta, incomingMsg('962791000001', 'آه احكيلي', 'wamid.a'))).status, 200);
  await meta.flush();
  const reply = f.graph.at(-1);
  assert.equal(reply.body.type, 'text');
  assert.equal(reply.body.to, '962791000001');
  assert.equal(reply.body.text.body, 'أهلا أبو أحمد! كم فرع عندك؟');
  const ctx = f.claude[0].body;
  assert.match(ctx.system[1].text, /القناة: واتساب/);
  assert.match(ctx.system[1].text, /الاسم: كوفي الورد/);
  assert.match(ctx.system[1].text, /أول رسالة بعتناله/);
  assert.deepEqual(ctx.tools.map((t) => t.name), ['make_offer', 'save_contact', 'call_owner', 'set_status']);
  assert.deepEqual(ctx.messages, [{ role: 'user', content: 'آه احكيلي' }]);
  // نفس الرسالة مرتين (Meta بتعيد): ما بنرد مرتين
  await hook(meta, incomingMsg('962791000001', 'آه احكيلي', 'wamid.a'));
  await meta.flush();
  assert.equal(f.claude.length, 1);

  await hook(meta, incomingMsg('962791000001', 'عندي فرعين وبدي أحكي مع حدا', 'wamid.b'));
  await meta.flush();
  let d = (await p.admin.get(`/api/admin/prospects/${id}`)).data;
  assert.equal(d.prospect.status, 'hot');
  assert.deepEqual(d.messages.map((m) => m.role), ['agent', 'in', 'agent', 'in', 'agent']);
  assert.equal(d.canReply, true);
  assert.deepEqual(f.claude[1].body.messages.map((m) => m.role), ['user', 'assistant', 'user'], 'المحادثة كاملة بدون القالب');

  // إنت بترد: الوكيل بيوقف مع هالمحل
  d = (await p.admin.post(`/api/admin/prospects/${id}/reply`, { text: 'أهلين، أنا صاحب نقاطك' })).data;
  assert.equal(d.prospect.paused, true);
  assert.equal(f.graph.at(-1).body.text.body, 'أهلين، أنا صاحب نقاطك');
  const calls = f.claude.length;
  await hook(meta, incomingMsg('962791000001', 'تمام', 'wamid.c'));
  await meta.flush();
  assert.equal(f.claude.length, calls, 'موقوف: الوكيل ما بيرد');

  // «لا» من رقم تاني: ما منرجع نبعتله
  await hook(meta, incomingMsg('962792000002', 'لا شكراً', 'wamid.d'));
  await meta.flush();
  const other = (await p.admin.get('/api/admin/sales')).data.prospects.find((x) => x.wa === '962792000002');
  assert.equal(other.status, 'optout');
  assert.equal(other.source, 'inbound');
  assert.match(f.graph.at(-1).body.text.body, /ما رح نرجع نبعتلك/);
  assert.equal(f.claude.length, calls);
});

test('المحادثة من المتصفح: ردود «الوكيل» الطويلة بتنقص، والمحادثة كلها إلها سقف', () => {
  const long = 'ا'.repeat(1900);
  const h = cleanHistory([{ role: 'user', content: 'مرحبا' }, { role: 'assistant', content: long }, { role: 'user', content: 'كم السعر؟' }]);
  assert.equal(h[1].content.length, 1000);
  const many = Array.from({ length: 16 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: (i % 2 ? 'ب' : 'س').repeat(i % 2 ? 1000 : 600) }));
  many.push({ role: 'user', content: 'آخر سؤال' });
  const cut = cleanHistory(many);
  assert.ok(cut.reduce((n, m) => n + m.content.length, 0) <= 8000);
  assert.equal(cut[0].role, 'user');
  assert.match(cut.at(-1).content, /آخر سؤال/);
});

test('واتساب: إشعار مش من Meta أو مكسور ما بيوقّع السيرفر، واللي سجّل بيضل «سجّل» حتى لو كتب «وقف»', async () => {
  const f = fakes();
  const p = await platform({ ANTHROPIC_API_KEY: 'sk-test', fetch: f.fetch, ...WA_ENV });
  const meta = p.client();
  for (const junk of [{ entry: 5 }, { entry: [{ changes: 7 }] }, { entry: [null] }, [], 'x']) {
    assert.equal((await hook(meta, junk)).status, 200, JSON.stringify(junk));
  }
  // بدون توقيع: مرفوض، والتشخيص ما بينكتب أكتر من مرة بالدقيقة
  const raw = JSON.stringify({ entry: 5 });
  assert.equal((await meta.req('POST', '/api/wa/webhook', raw, { 'x-hub-signature-256': sign(raw, 'wrong') })).status, 401);
  assert.equal((await p.admin.get('/api/admin/wa/number')).data.lastHook.signed, true, 'آخر موقّع ما انمسح');
  // محل سجّل بنقاطك وبعدين كتب «وقف»
  await hook(meta, incomingMsg('962791000001', 'مرحبا'));
  await meta.flush();
  const id = (await p.admin.get('/api/admin/sales')).data.prospects[0].id;
  await p.admin.put(`/api/admin/prospects/${id}`, { status: 'won' });
  await hook(meta, incomingMsg('962791000001', 'وقف'));
  assert.equal((await p.admin.get('/api/admin/sales')).data.prospects[0].status, 'won');
});

test('أرقام واتساب ورسائل الإيقاف', () => {
  assert.equal(waNumber('0791234567'), '962791234567');
  assert.equal(waNumber('+962 79 123 4567'), '962791234567');
  assert.equal(waNumber('791234567'), '962791234567');
  assert.equal(waNumber('065551234'), null);
  assert.equal(waNumber('٠٧٨١٢٣٤٥٦٧'), '962781234567');
  assert.equal(waNumber('+966501234567'), '966501234567');
  assert.ok(isOptOut('لا'));
  assert.ok(isOptOut('لا شكراً'));
  assert.ok(isOptOut('STOP'));
  assert.ok(!isOptOut('لا بدي أعرف السعر'));
  // بنص المحادثة «لا» جواب على سؤال، مش طلب إيقاف
  assert.ok(!isOptOut('لا', { firstReply: false }));
  assert.ok(!isOptOut('لا شكراً', { firstReply: false }));
  assert.ok(isOptOut('مش مهتم', { firstReply: false }));
  assert.ok(isOptOut('وقف', { firstReply: false }));
});

const statusHook = (id, code, message) => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1234567890' }, statuses: [{ id, status: 'failed', timestamp: '1760000000', recipient_id: '962791000001', errors: [{ code, title: message, error_data: { details: message } }] }] } }] }],
});

test('واتساب: الرسالة اللي بتفشل بعد ما Meta قبلتها (الدفع، الرقم) بتبيّن على المحل، ومشكلة الحساب بتوقف الإرسال', async () => {
  const f = fakes();
  const p = await platform({ ANTHROPIC_API_KEY: 'sk-test', fetch: f.fetch, ...WA_ENV });
  await p.admin.post('/api/admin/prospects', { name: 'محل 1', phone: '0791000001' });
  await p.admin.post('/api/admin/prospects', { name: 'محل 2', phone: '0791000002' });
  await p.admin.put('/api/admin/sales/settings', { auto: true, daily: 20 });
  assert.equal((await runScheduled({ db: p.db, env: p.env, waitUntil: (x) => x }, SUNDAY_NOON)).outreach, 2);
  const meta = p.client();
  const ids = f.graph.map((g, i) => (g.body.type === 'template' ? `wamid.${i + 1}` : null)).filter(Boolean); // رقم كل رسالة من Meta الوهمية
  // الرقم الأول مش عليه واتساب: بس هالمحل
  assert.equal((await hook(meta, statusHook(ids[0], 131026, 'Message undeliverable'))).status, 200);
  let st = (await p.admin.get('/api/admin/sales')).data;
  let one = st.prospects.find((x) => x.name === 'محل 1');
  assert.equal(one.status, 'failed');
  assert.match(one.error, /undeliverable \(131026\)/);
  assert.equal(st.settings.auto, true);
  // التاني: مشكلة بالدفع، يعني كل الرسائل رح تفشل: بيرجع للدور وبيوقف الإرسال
  await hook(meta, statusHook(ids[1], 131042, 'Business eligibility payment issue'));
  st = (await p.admin.get('/api/admin/sales')).data;
  const two = st.prospects.find((x) => x.name === 'محل 2');
  assert.equal(two.status, 'new');
  assert.match(two.error, /payment/);
  assert.equal(st.settings.auto, false);
  assert.equal(st.sentToday, 0);
  const num = (await p.admin.get('/api/admin/wa/number')).data;
  assert.equal(num.lastHook.failed, 1);
  assert.equal(num.lastFailure.code, 131042);
  assert.equal(num.lastFailure.name, 'محل 2');
  assert.match(num.lastFailure.message, /payment issue \(131042\)/);
  // رسالة مش إلنا: ولا إشي
  assert.equal((await hook(meta, statusHook('wamid.unknown', 131042, 'x'))).status, 200);

  // الشبكة وقعت: بيرجع للدور بدون ما يطفي الإرسال
  const net = fakes(undefined, () => { throw new TypeError('Network connection lost'); });
  const q = await platform({ ANTHROPIC_API_KEY: 'sk-test', fetch: net.fetch, ...WA_ENV });
  await q.admin.post('/api/admin/prospects', { name: 'محل', phone: '0791000009' });
  await q.admin.put('/api/admin/sales/settings', { auto: true, daily: 20 });
  assert.equal((await runScheduled({ db: q.db, env: q.env, waitUntil: (x) => x }, SUNDAY_NOON)).outreach, 0);
  const qs = (await q.admin.get('/api/admin/sales')).data;
  assert.equal(qs.settings.auto, true);
  assert.equal(qs.prospects[0].status, 'new');
});

test('واتساب: «لا» بنص المحادثة جواب للوكيل مش إيقاف، ولما الوكيل ما بيقدر يرد بينحفظ السبب', async () => {
  let down = false;
  const f = fakes(() => (down ? { status: 500 } : { text: 'تمام! وكيف بترجّع زبائنك هلأ؟' }));
  const p = await platform({ ANTHROPIC_API_KEY: 'sk-test', fetch: f.fetch, ...WA_ENV });
  const meta = p.client();
  await hook(meta, incomingMsg('962791000001', 'مرحبا، بدي أعرف عن نقاطك'));
  await meta.flush();
  await hook(meta, incomingMsg('962791000001', 'لا'));
  await meta.flush();
  let pr = (await p.admin.get('/api/admin/sales')).data.prospects[0];
  assert.equal(pr.status, 'talking');
  assert.equal(pr.name, 'أبو أحمد');
  assert.equal(f.claude.length, 2, 'الوكيل رد على «لا»');
  assert.deepEqual(lastUser(f.claude[1]), { role: 'user', content: 'لا' });
  // الذكاء الاصطناعي واقع: ما في رد، والخطأ بيبيّن بصفحة المبيعات
  down = true;
  const sent = f.graph.length;
  await hook(meta, incomingMsg('962791000001', 'كم السعر؟'));
  await meta.flush();
  const st = (await p.admin.get('/api/admin/sales')).data;
  assert.ok(st.aiLastError);
  assert.equal(f.graph.length, sent, 'ما انبعت إشي');
  // اسم واتساب رموز بس: بنحط الرقم
  await hook(meta, { ...incomingMsg('962792000002', 'مرحبا'), entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1234567890' }, contacts: [{ wa_id: '962792000002', profile: { name: '.' } }], messages: [{ from: '962792000002', id: 'wamid.dot', timestamp: '1760000000', type: 'text', text: { body: 'مرحبا' } }] } }] }] });
  pr = (await p.admin.get('/api/admin/sales')).data.prospects.find((x) => x.wa === '962792000002');
  assert.equal(pr.name, '+962792000002');
});

test('المحل اللي سجّل من رابطه الخاص (بدون عرض) بيصير «سجّل»', async () => {
  const p = await platform({});
  await p.admin.post('/api/admin/prospects', { name: 'كوفي الورد', phone: '0791000001' });
  const pr = (await p.admin.get('/api/admin/sales')).data.prospects[0];
  const code = pr.link.split('?p=')[1];
  await signup(p.client(), { shopName: 'كوفي الورد', prospect: code });
  const after = (await p.admin.get('/api/admin/sales')).data.prospects[0];
  assert.equal(after.status, 'won');
  assert.ok(after.shopId);
});

test('رابط المحل الخاص: إنت بتبعت من واتسابك، وهو بيفتح الرابط، والوكيل بيكمّل معه بالموقع وبتنحفظ المحادثة', async () => {
  let step = 0;
  const f = fakes(() => {
    step++;
    if (step === 1) return { text: 'أهلا كوفي الورد! كم فرع عندكم؟' };
    if (step === 2) return { tool: 'call_owner', input: { reason: 'بده حدا يتصل فيه' } };
    return { text: 'تمام، صاحب المنصة رح يتصل فيك اليوم 🙏' };
  });
  const p = await platform({ ANTHROPIC_API_KEY: 'sk-test', fetch: f.fetch });
  await p.admin.post('/api/admin/prospects', { name: 'كوفي الورد', phone: '0791000001', kind: 'كوفي شوب' });
  let pr = (await p.admin.get('/api/admin/sales')).data.prospects[0];
  const code = pr.link.split('?p=')[1];
  // إنت بعتت الرسالة من واتسابك
  const d = (await p.admin.post(`/api/admin/prospects/${pr.id}/sent`)).data;
  assert.equal(d.prospect.status, 'sent');
  assert.ok(d.prospect.sentAt);
  assert.equal(d.messages[0].channel, 'manual');
  assert.match(d.messages[0].text, new RegExp(code));
  // صاحب المحل فتح الرابط
  const shop = p.client();
  assert.deepEqual((await shop.get(`/api/p/${code}`)).data, { name: 'كوفي الورد' });
  assert.equal((await p.client().get('/api/p/zzzzzzzz')).status, 404);
  pr = (await p.admin.get('/api/admin/sales')).data.prospects[0];
  assert.ok(pr.openedAt);
  // بيحكي مع الوكيل: الوكيل بيعرفه، وعنده أدوات المحل المعروف
  const r1 = await shop.post('/api/sales', { prospect: code, messages: [{ role: 'user', content: 'مرحبا، شو هاد؟' }] });
  assert.equal(r1.data.reply, 'أهلا كوفي الورد! كم فرع عندكم؟');
  const b = f.claude[0].body;
  assert.match(b.system[1].text, /فتح رابطه الخاص/);
  assert.match(b.system[1].text, /الاسم: كوفي الورد/);
  assert.match(b.system[1].text, /أول رسالة بعتناله: «مرحبا كوفي الورد/);
  assert.deepEqual(b.tools.map((t) => t.name), ['make_offer', 'save_contact', 'call_owner', 'set_status']);
  await shop.post('/api/sales', { prospect: code, messages: [{ role: 'user', content: 'مرحبا، شو هاد؟' }, { role: 'assistant', content: r1.data.reply }, { role: 'user', content: 'فرعين، بدي حدا يتصل فيني' }] });
  const chatLog = (await p.admin.get(`/api/admin/prospects/${pr.id}`)).data;
  assert.equal(chatLog.prospect.status, 'hot');
  assert.deepEqual(chatLog.messages.map((m) => `${m.role}:${m.channel}`), ['owner:manual', 'in:web', 'agent:web', 'in:web', 'agent:web']);
  assert.equal(chatLog.messages[3].text, 'فرعين، بدي حدا يتصل فيني');
  assert.equal(chatLog.canReply, false, 'محادثة الموقع: بترد من واتسابك');
});

test('بعد ربط Meta: رسالتك بتفتح واتساب الوكيل، وهو بيعرف المحل من الرمز حتى لو من رقم تاني', async () => {
  const f = fakes(() => ({ text: 'أهلا! أنا مساعد نقاطك، كيف بقدر أساعدك؟' }));
  const p = await platform({ ANTHROPIC_API_KEY: 'sk-test', fetch: f.fetch, ...WA_ENV });
  await p.admin.post('/api/admin/prospects', { name: 'مخبز الشام', phone: '0791000005' });
  assert.equal((await p.client().get('/api/site')).data.whatsapp, null, 'قبل: ما في رقم');
  assert.equal((await p.admin.put('/api/admin/sales/settings', { auto: false, daily: 20, agentWa: '0790000099' })).status, 200);
  assert.equal((await p.client().get('/api/site')).data.whatsapp, '962790000099', 'زر الواتساب بصفحة البيع لواتساب الوكيل');
  const pr = (await p.admin.get('/api/admin/sales')).data.prospects[0];
  const code = pr.link.split('?p=')[1];
  assert.match(pr.message, /https:\/\/wa\.me\/962790000099\?text=/);
  assert.match(decodeURIComponent(pr.message), new RegExp(`#${code}`));
  await p.admin.post(`/api/admin/prospects/${pr.id}/sent`);
  // صاحب المخبز راسل الوكيل من رقم تاني
  const meta = p.client();
  await hook(meta, incomingMsg('962795555555', `مرحبا، بدي أعرف أكتر عن نقاطك #${code}`, 'wamid.x'));
  await meta.flush();
  const st = (await p.admin.get('/api/admin/sales')).data;
  assert.equal(st.prospects.length, 1, 'ما انعمل محل جديد');
  assert.equal(st.prospects[0].wa, '962795555555');
  assert.equal(st.prospects[0].status, 'talking');
  assert.match(f.claude[0].body.system[1].text, /الاسم: مخبز الشام/);
});

test('رقم الإيجنت عند Meta: الحالة، الكود، التأكيد والتسجيل، وسبب الرفض بالزبط', async () => {
  const f = fakes(undefined, (body, n) => (body.pin === '000000' ? { status: 400, code: 133005, message: 'Two step verification PIN Mismatch' } : { status: 200 }));
  const p = await platform({ ANTHROPIC_API_KEY: 'sk-test', fetch: f.fetch, ...WA_ENV });
  const off = await platform({});
  assert.equal((await off.admin.get('/api/admin/wa/number')).status, 400);
  assert.equal((await p.client().get('/api/admin/wa/number')).status, 401);
  assert.equal((await p.admin.get('/api/admin/wa/number')).status, 200);
  assert.ok(f.graph.some((g) => /\/v26\.0\/1234567890\?fields=.*code_verification_status/.test(g.url)));
  const lastPost = () => f.graph.filter((g) => !g.url.includes('?')).at(-1); // بعد كل إجراء بنفحص الحالة (GET)
  await p.admin.post('/api/admin/wa/number', { action: 'code', method: 'VOICE' });
  assert.match(lastPost().url, /1234567890\/request_code$/);
  assert.deepEqual(lastPost().body, { code_method: 'VOICE', language: 'ar' });
  assert.equal((await p.admin.post('/api/admin/wa/number', { action: 'verify', code: '12' })).status, 400);
  await p.admin.post('/api/admin/wa/number', { action: 'verify', code: '123 456' });
  assert.deepEqual(lastPost().body, { code: '123456' });
  await p.admin.post('/api/admin/wa/number', { action: 'register', pin: '246810' });
  assert.match(lastPost().url, /1234567890\/register$/);
  assert.deepEqual(lastPost().body, { messaging_product: 'whatsapp', pin: '246810' });
  // الاشتراك باستلام الردود (بيحتاج WHATSAPP_WABA_ID)
  const w = await platform({ ANTHROPIC_API_KEY: 'sk-test', fetch: f.fetch, ...WA_ENV, WHATSAPP_WABA_ID: '5550001' });
  await w.admin.post('/api/admin/wa/number', { action: 'subscribe' });
  assert.ok(f.graph.some((g) => /v26\.0\/5550001\/subscribed_apps$/.test(g.url)), 'subscribed_apps');
  assert.equal((await p.admin.post('/api/admin/wa/number', { action: 'subscribe' })).status, 400, 'بدون WABA ID');
  const bad = await p.admin.post('/api/admin/wa/number', { action: 'register', pin: '000000' });
  assert.equal(bad.status, 502);
  assert.match(bad.data.error, /PIN Mismatch.*133005/);
});

test('رقم الإيجنت: حالة قالب أول رسالة على حساب الواتساب الصح، وإذا في إشي مانع الإرسال', async () => {
  let tpl = [{ name: 'nuqatak_intro', status: 'PENDING', language: 'ar', category: 'MARKETING', rejected_reason: 'NONE', id: '1' }];
  let health = { can_send_message: 'BLOCKED', entities: [{ entity_type: 'WABA', id: '5550001', can_send_message: 'BLOCKED', errors: [{ error_code: 141010, error_description: 'No valid payment method.', possible_solution: 'Add a payment method.' }] }] };
  const urls = [];
  const fetch = async (url) => {
    const u = String(url);
    urls.push(u);
    const ok = (d) => new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.includes('/message_templates')) return ok({ data: tpl });
    if (u.includes('fields=health_status')) return ok({ health_status: health });
    if (u.includes('/subscribed_apps')) return ok({ data: [{ whatsapp_business_api_data: { id: '1' } }] });
    return ok({ display_phone_number: '+962 77 052 8804', code_verification_status: 'VERIFIED', platform_type: 'CLOUD_API', status: 'CONNECTED' });
  };
  const p = await platform({ GEMINI_API_KEY: 'g', fetch, ...WA_ENV, WHATSAPP_WABA_ID: '5550001' });
  let d = (await p.admin.get('/api/admin/wa/number')).data;
  assert.deepEqual(d.template, { status: 'PENDING', language: 'ar', category: 'MARKETING', reason: null });
  assert.equal(d.wabaId, '5550001');
  assert.ok(urls.some((u) => /\/v26\.0\/5550001\/message_templates\?name=nuqatak_intro/.test(u)));
  assert.equal(d.sending.can, 'BLOCKED');
  assert.match(d.sending.errors[0], /payment method/);
  // المكالمات مش مفعّلة: ما إلها علاقة بالرسائل
  health = { can_send_message: 'LIMITED', entities: [{ entity_type: 'PHONE_NUMBER', can_send_message: 'LIMITED', errors: [{ error_description: 'WhatsApp Business calling cannot use SIP because it is not enabled', possible_solution: 'Configure SIP' }] }, { entity_type: 'APP', can_send_message: 'LIMITED', errors: [{ error_description: 'This app cannot use SIP for WhatsApp Business calling' }] }] };
  d = (await p.admin.get('/api/admin/wa/number')).data;
  assert.deepEqual(d.sending, { can: 'AVAILABLE', errors: [] });
  // القالب انعمل على حساب تاني
  tpl = [{ name: 'nuqatak_intro_old', status: 'APPROVED', language: 'ar' }];
  d = (await p.admin.get('/api/admin/wa/number')).data;
  assert.deepEqual(d.template, { status: 'MISSING' });
  // بدون WHATSAPP_WABA_ID: ما في فحص للقالب
  const q = await platform({ GEMINI_API_KEY: 'g', fetch, ...WA_ENV });
  assert.equal((await q.admin.get('/api/admin/wa/number')).data.template, null);
});

test('صفحة حذف البيانات لـ Meta بتفتح على أي عنوان بدون تحويل', async () => {
  const p = await platform({});
  const c = p.client();
  assert.equal((await c.get('/privacy')).status, 301, 'الخصوصية بتتحوّل للدومين');
  const r = await c.get('/data-deletion');
  assert.equal(r.status, 200);
  assert.match(r.data, /privacy\.html/);
});

test('كبسة «وريني كيف بتطلع»: صورة البطاقة فوراً، وبعدها الوكيل بيكمّل الحكي (عارف إنه الصورة وصلت)', async () => {
  const sent = [];
  const ai = [];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    const json = (d) => new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.startsWith('https://graph.facebook.com/')) {
      sent.push(body);
      return json({ messages: [{ id: `wamid.s${sent.length}` }] });
    }
    if (!u.startsWith('https://generativelanguage.googleapis.com/')) return new Response(null, { status: 201 });
    if (u.includes('/models?')) return json({ models: [{ name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] }] });
    ai.push(body);
    return json({ candidates: [{ content: { role: 'model', parts: [{ text: 'هاي مثال 👆 جرّبها بنفسك من هون' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } });
  };
  const p = await platform({ GEMINI_API_KEY: 'g', fetch, ...WA_ENV });
  await p.admin.post('/api/admin/prospects', { name: 'كوفي الورد', phone: '0791000001' });
  const meta = p.client();
  await hook(meta, { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1234567890' }, contacts: [{ wa_id: '962791000001', profile: { name: 'x' } }], messages: [{ from: '962791000001', id: 'wamid.btn', timestamp: '1760000000', type: 'button', button: { text: 'وريني كيف بتطلع', payload: 'x' } }] } }] }] });
  await meta.flush();
  assert.deepEqual(sent.map((m) => m.type), ['image', 'text'], 'الصورة وبعدها رد الوكيل');
  assert.equal(sent[1].text.body, 'هاي مثال 👆 جرّبها بنفسك من هون');
  const last = ai[0].contents.at(-1);
  assert.equal(last.role, 'user');
  assert.match(last.parts[0].text, /^وريني كيف بتطلع/);
  assert.match(last.parts[0].text, /بعتناله هلأ تلقائياً 🖼 \[صورة البطاقة\] هيك بتطلع/);
  const st = (await p.admin.get('/api/admin/sales')).data;
  const chat = (await p.admin.get(`/api/admin/prospects/${st.prospects[0].id}`)).data.messages;
  assert.deepEqual(chat.map((m) => m.role), ['in', 'agent', 'agent']);
});

test('صورة البطاقة: إذا واتساب رفضها منجرّب مرة كمان، وإذا ضل يرفض بيبيّن السبب بمربع الرقم والوكيل بيرد عادي', async () => {
  const sent = [];
  let refuse = 0;
  const fetch = async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
    if (u.startsWith('https://graph.facebook.com/')) {
      if (u.includes('?fields=')) return json({ quality_rating: 'GREEN' });
      if (body.type === 'image' && refuse-- > 0) return json({ error: { message: 'Service temporarily unavailable', code: 131016 } }, 503);
      sent.push(body);
      return json({ messages: [{ id: `wamid.r${sent.length}` }] });
    }
    if (!u.startsWith('https://generativelanguage.googleapis.com/')) return new Response(null, { status: 201 });
    if (u.includes('/models?')) return json({ models: [{ name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] }] });
    return json({ candidates: [{ content: { role: 'model', parts: [{ text: 'تفضل 👆' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } });
  };
  const p = await platform({ GEMINI_API_KEY: 'g', fetch, ...WA_ENV });
  await p.admin.post('/api/admin/prospects', { name: 'كوفي الورد', phone: '0791000001' });
  const tap = async (id) => {
    const meta = p.client();
    await hook(meta, { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1234567890' }, contacts: [{ wa_id: '962791000001', profile: { name: 'x' } }], messages: [{ from: '962791000001', id, timestamp: '1760000000', type: 'button', button: { text: 'وريني كيف بتطلع', payload: 'x' } }] } }] }] });
    await meta.flush();
  };
  refuse = 1;
  await tap('wamid.t1');
  assert.deepEqual(sent.map((m) => m.type), ['image', 'text'], 'رفض مرة ← التانية زبطت');
  sent.length = 0;
  refuse = 2;
  await tap('wamid.t2');
  assert.deepEqual(sent.map((m) => m.type), ['text'], 'الوكيل رد حتى بدون الصورة');
  const box = (await p.admin.get('/api/admin/wa/number')).data;
  assert.equal(box.lastFailure.name, 'كوفي الورد');
  assert.match(box.lastFailure.message, /^صورة البطاقة: Service temporarily unavailable/);
});

// Gemini وهمي: قائمة الموديلات، والردود (نص أو استدعاء أداة)، وبحث Google
function fakeGemini(reply) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://graph.facebook.com/')) return new Response(JSON.stringify({ messages: [{ id: 'wamid.g' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (!u.startsWith('https://generativelanguage.googleapis.com/')) return new Response(null, { status: 201 });
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: u, headers: new Headers(init.headers), body });
    const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
    if (u.includes('/models?')) return json({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.6-flash-lite', supportedGenerationMethods: ['generateContent'] }] });
    const r = reply(body, calls.length);
    if (r.status) return json({ error: { message: 'quota' } }, r.status);
    const parts = [];
    if (r.text) parts.push({ text: r.text });
    if (r.call) parts.push({ functionCall: { name: r.call, args: r.args }, thoughtSignature: 'sig' });
    return json({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP', ...(r.grounded ? { groundingMetadata: { webSearchQueries: ['a', 'b'] } } : {}) }], usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 40, thoughtsTokenCount: 10 } });
  };
  return { fetch, calls };
}

test('Gemini: بمفتاح GEMINI_API_KEY الوكيل بيحكي ويفاوض بأدواته، وبيختار أحدث Flash', async () => {
  let n = 0;
  const g = fakeGemini((body) => {
    n++;
    if (n === 1) return { call: 'make_offer', args: { trial_days: 21, plan: 'basic', reason: 'متردد' } };
    const last = body.contents.at(-1);
    assert.equal(last.role, 'user');
    assert.ok(last.parts[0].functionResponse.response.link.includes('?offer='));
    assert.equal(body.contents.at(-2).parts.at(-1).thoughtSignature, 'sig', 'رد الموديل بيرجع كما هو');
    return { text: 'جهزتلك تجربة 21 يوم 🎁' };
  });
  const p = await platform({ GEMINI_API_KEY: 'g-key', fetch: g.fetch });
  assert.equal((await p.client().get('/api/site')).data.sales, true);
  const r = await p.client().post('/api/sales', { messages: [{ role: 'user', content: 'بدي وقت أفكر' }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.reply, 'جهزتلك تجربة 21 يوم 🎁');
  assert.equal(r.data.offer.trialDays, 21);
  const gen = g.calls.find((c) => c.url.includes(':generateContent'));
  assert.match(gen.url, /models\/gemini-3\.6-flash:generateContent$/);
  assert.equal(gen.headers.get('x-goog-api-key'), 'g-key');
  assert.match(gen.body.systemInstruction.parts[0].text, /غير هيك السعر ثابت/);
  const decl = gen.body.tools[0].functionDeclarations;
  assert.deepEqual(decl.map((d) => d.name), ['make_offer', 'save_contact']);
  assert.equal(decl[0].parameters.type, 'OBJECT');
  assert.equal(decl[0].parameters.additionalProperties, undefined);
  assert.deepEqual(gen.body.contents[0], { role: 'user', parts: [{ text: 'بدي وقت أفكر' }] });
  const st = (await p.admin.get('/api/admin/stats')).data.ai;
  assert.equal(st.provider, 'gemini');
  assert.equal(st.output, 100);
  assert.equal(st.model, 'gemini-3.6-flash', 'الموديل اللي اشتغل فعلاً');
  assert.ok(st.costUsd >= 0);
  // الحصة خلصت
  const q = await platform({ GEMINI_API_KEY: 'g-key', fetch: fakeGemini(() => ({ status: 429 })).fetch });
  const e = await q.client().post('/api/sales', { messages: [{ role: 'user', content: 'مرحبا' }] });
  assert.equal(e.status, 503);
  assert.match(e.data.error, /مشغول/);
  const diag = (await q.admin.get('/api/admin/sales')).data;
  assert.equal(diag.aiLastError.provider, 'gemini');
  assert.equal(diag.aiLastError.status, 429);
  assert.equal(diag.aiLastOk, null);
  assert.ok((await p.admin.get('/api/admin/sales')).data.aiLastOk.at, 'الرد الناجح بينسجّل');
  assert.equal((await p.admin.get('/api/admin/sales')).data.aiLastOk.model, 'gemini-3.6-flash');
});

test('Gemini: البحث عن محلات بـ Google Search وبعدين ترتيبها JSON', async () => {
  const g = fakeGemini((body) => {
    if (body.tools) {
      assert.deepEqual(body.tools, [{ google_search: {} }]);
      return { text: '1) كوفي الندى، الصويفية، 0795556667، انستغرام @nada.cafe', grounded: true };
    }
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.equal(body.generationConfig.responseSchema.properties.shops.type, 'ARRAY');
    return { text: JSON.stringify({ shops: [{ name: 'كوفي الندى', area: 'الصويفية', kind: 'كوفي شوب', phone: '0795556667', instagram: '@nada.cafe', website: '', why: 'جلسات حلوة', opener: 'مرحبا كوفي الندى 👋' }] }) };
  });
  const p = await platform({ GEMINI_API_KEY: 'g-key', fetch: g.fetch });
  const r = await p.admin.post('/api/admin/sales/search', { query: 'كوفي بالصويفية' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.added, 1);
  assert.equal(r.data.aiProvider, 'gemini');
  const shop = r.data.prospects[0];
  assert.equal(shop.wa, '962795556667');
  assert.equal(shop.instagram, 'https://instagram.com/nada.cafe');
  assert.match(shop.message, /^مرحبا كوفي الندى 👋/);
  assert.equal((await p.admin.get('/api/admin/stats')).data.ai.searches, 2);
});

test('Claude أولى إذا الاتنين موجودين، إلا مع AI_PROVIDER=gemini', async () => {
  const { aiConfig } = await import('../src/ai.js');
  assert.equal(aiConfig({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' }).provider, 'anthropic');
  assert.equal(aiConfig({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', AI_PROVIDER: 'gemini' }).provider, 'gemini');
  assert.equal(aiConfig({ GEMINI_API_KEY: 'g' }).provider, 'gemini');
  assert.equal(aiConfig({ GEMINI_API_KEY: 'g', GEMINI_MODEL: 'gemini-2.5-flash' }).model, 'gemini-2.5-flash');
  assert.equal(aiConfig({}), null);
});

test('Gemini على الموقع الحقيقي: بيستعمل fetch العادي إذا ما في fetch وهمي', async () => {
  const g = fakeGemini(() => ({ text: 'أهلا! 👋' }));
  const real = globalThis.fetch;
  globalThis.fetch = g.fetch;
  try {
    const p = await platform({ GEMINI_API_KEY: 'g-key' });
    const r = await p.client().post('/api/sales', { messages: [{ role: 'user', content: 'مرحبا' }] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.reply, 'أهلا! 👋');
  } finally {
    globalThis.fetch = real;
  }
});

test('تنبيهك على واتسابك: حدا راسل الوكيل، رسالة جديدة، بده يحكي معك، أو ترك طلب (قالب، أو نص إذا راسلت رقم الإيجنت آخر 24 ساعة)', async () => {
  let step = 0;
  const forOwner = (body) => JSON.stringify(body.system).includes('مساعد صاحب منصة');
  const f = fakes((body) => (forOwner(body) ? { text: '🔥 أبو أحمد بده يحكي معك، اتصل فيه' } : ++step % 2 ? { tool: 'call_owner', input: { reason: 'بده\nيحكي عن فرعين' } } : { text: 'تمام، رح يحكي معك 🙏' }), (body) => (body.template && body.template.name === 'nuqatak_alert' && step > 4 ? { status: 400, message: 'Template name does not exist', code: 132001 } : { status: 200 }));
  const p = await platform({ ANTHROPIC_API_KEY: 'sk-test', fetch: f.fetch, ...WA_ENV, WHATSAPP_NUMBER: '962798900911' });
  const meta = p.client();
  const alerts = () => f.graph.filter((g) => g.body.to === '962798900911');

  await hook(meta, incomingMsg('962791000001', 'بدي أحكي مع المدير', 'wamid.x1'));
  await meta.flush();
  assert.equal(alerts().length, 2, 'محادثة جديدة + بده يحكي معك');
  assert.ok(alerts().every((g) => g.body.type === 'template' && g.body.template.name === 'nuqatak_alert'));
  const params = alerts().map((g) => g.body.template.components[0].parameters.map((x) => x.text));
  assert.deepEqual(params.find((x) => /راسل/.test(x[0])), ['أبو أحمد · حدا جديد راسل الوكيل', '+962791000001', 'بدي أحكي مع المدير']);
  assert.deepEqual(params.find((x) => /بده يحكي معك/.test(x[0])), ['أبو أحمد · بده يحكي معك', '+962791000001', 'بده يحكي عن فرعين'], 'بدون سطر جديد');
  // نفس المحل كمان مرة: ما بنعيد (رسالة جديدة مرة بالساعة، بده يحكي معك مرة كل 3 ساعات)
  await hook(meta, incomingMsg('962791000001', 'وين المدير؟', 'wamid.x2'));
  await meta.flush();
  assert.equal(alerts().length, 2);
  // التنبيه ما وصل (Meta بعتت failed على رقمه)
  const failed = (id) => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1234567890' }, statuses: [{ id, status: 'failed', timestamp: '1760000000', recipient_id: '962798900911', errors: [{ code: 131026, title: 'Message undeliverable', error_data: { details: 'Message undeliverable' } }] }] } }] }] });
  await hook(meta, failed(`wamid.${f.graph.indexOf(alerts().at(-1)) + 1}`));
  let num = (await p.admin.get('/api/admin/wa/number')).data;
  assert.equal(num.ownerWa, '962798900911');
  assert.equal(num.alertTemplateName, 'nuqatak_alert');
  assert.equal(num.alertLast.ok, false);
  assert.match(num.alertLast.message, /131026/);

  // راسلت رقم الإيجنت من رقمك: 24 ساعة التنبيهات بتوصل نص عادي فيه كل التفاصيل
  // وبتسأله «شو الأخبار؟»: بيجاوبك من بيانات المنصة (مش كأنك محل)
  await hook(meta, incomingMsg('962798900911', 'شو الأخبار؟ في محلات بدها تشترك؟', 'wamid.o1'));
  await hook(meta, incomingMsg('962798900911', 'شو الأخبار؟ في محلات بدها تشترك؟', 'wamid.o1')); // Meta عادتها
  await meta.flush();
  const toOwner = f.claude.filter((x) => forOwner(x.body));
  assert.equal(toOwner.length, 1);
  assert.deepEqual(toOwner[0].body.tools.map((t) => t.name), ['reply_to_shop', 'guide_shop', 'set_guidance', 'pause_shop', 'set_auto'], 'أدوات التوجيه مش أدوات البيع');
  const sys = toOwner[0].body.system;
  assert.match(sys, /🔥 بدهم يحكوا معك \(1\):\n- #\d+ أبو أحمد · \+962791000001/);
  assert.match(sys, /آخر رسالة: «وين المدير؟»/);
  assert.match(sys, /📩 طلبات اشتراك لسا ما حكيتهم \(0\)/);
  assert.equal(lastUser(toOwner[0]).content, 'شو الأخبار؟ في محلات بدها تشترك؟');
  assert.equal(alerts().at(-1).body.text.body, '🔥 أبو أحمد بده يحكي معك، اتصل فيه');
  assert.ok(!(await p.admin.get('/api/admin/sales')).data.prospects.some((x) => x.wa === '962798900911'), 'رقمك مش محل');
  const before = alerts().length;
  assert.equal((await meta.post('/api/leads', { shopName: 'مخبز السعادة', name: 'سامي', phone: '0791000002', kind: 'مخبز وحلويات', city: 'إربد' })).status, 201);
  await meta.flush();
  const txt = alerts().slice(before).find((g) => g.body.type === 'text');
  assert.ok(txt, 'انبعت نص');
  assert.match(txt.body.text.body, /طلب اشتراك جديد/);
  assert.match(txt.body.text.body, /مخبز السعادة · سامي/);
  assert.match(txt.body.text.body, /0791000002/);
  assert.match(txt.body.text.body, /nuqatak\.test\/app#admin/);

  // زر «جرّب»: القالب مش موجود عند Meta → بيرجّع السبب
  await p.db.run("DELETE FROM platform_settings WHERE k = 'owner_wa_in'");
  step = 10;
  const bad = await p.admin.post('/api/admin/wa/number', { action: 'alert' });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /132001/);
  step = 0;
  const ok = await p.admin.post('/api/admin/wa/number', { action: 'alert' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  num = (await p.admin.get('/api/admin/wa/number')).data;
  assert.equal(num.alertLast.ok, true);
  assert.equal(num.alertLast.via, 'template');
});

test('بدون ذكاء اصطناعي: لما تراسل رقم الإيجنت من رقمك بيوصلك تقرير الوضع كما هو', async () => {
  const f = fakes();
  const p = await platform({ fetch: f.fetch, ...WA_ENV, WHATSAPP_NUMBER: '962798900911' });
  const meta = p.client();
  await meta.post('/api/leads', { shopName: 'حلويات النور', name: 'رامي', phone: '0791000003', kind: 'مخبز وحلويات' });
  await hook(meta, incomingMsg('962798900911', 'شو الوضع', 'wamid.o9'));
  await meta.flush();
  const r = f.graph.filter((g) => g.body.to === '962798900911' && g.body.type === 'text').at(-1);
  assert.match(r.body.text.body, /^📋 الوضع هلأ:/);
  assert.match(r.body.text.body, /📩 طلبات اشتراك لسا ما حكيتهم \(1\):\n- حلويات النور · رامي · 0791000003 · مخبز وحلويات/);
  assert.match(r.body.text.body, /🎯 وكيل المبيعات: الإرسال لحاله موقّف/);
  assert.match(r.body.text.body, /🏪 المحلات: 0/);
});

test('توجّه الوكيل من واتسابك: رسالة لمحل، توجيه لمحل، توجيه عام، توقيف الإرسال', async () => {
  const owner = [];
  const f = fakes((body) => {
    const sys = JSON.stringify(body.system);
    if (!sys.includes('مساعد صاحب منصة')) return { text: 'أهلا! 🙏' };
    owner.push(body);
    const last = body.messages.at(-1);
    const n = owner.length;
    if (n === 1) return { tool: 'reply_to_shop', input: { shop: 'كوفي', message: 'صاحب المنصة رح يتصل فيك بكرا الصبح 🙏' } };
    if (n === 2) { assert.match(JSON.stringify(last.content), /sent/); return { tool: 'guide_shop', input: { shop: '#1', instruction: 'اعرض عليه شهرين تجربة' } }; }
    if (n === 3) return { tool: 'set_guidance', input: { text: 'ركّز على الكوفيهات بعمّان' } };
    if (n === 4) return { tool: 'set_auto', input: { on: false } };
    if (n === 5) return { text: 'تمام ✅ بعتتله، وحفظت التوجيه، ووقّفت الإرسال' };
    if (n === 6) return { tool: 'reply_to_shop', input: { shop: 'مش موجود', message: 'مرحبا' } };
    if (n === 7) { assert.match(JSON.stringify(last.content), /ما لقيت محل/); return { text: 'ما لقيته، أي محل قصدك؟' }; }
    return { text: '؟' };
  });
  const p = await platform({ ANTHROPIC_API_KEY: 'sk-test', fetch: f.fetch, ...WA_ENV, WHATSAPP_NUMBER: '962798900911' });
  const meta = p.client();
  await p.admin.put('/api/admin/sales/settings', { auto: true, daily: 20 });
  await hook(meta, incomingMsg('962791000001', 'مرحبا عندي كوفي', 'wamid.s1'));
  await meta.flush();
  const id = (await p.admin.get('/api/admin/sales')).data.prospects[0].id;
  assert.equal(id, 1);
  await p.db.run("UPDATE prospects SET name = 'كوفي الورد' WHERE id = 1");

  await hook(meta, incomingMsg('962798900911', 'قله رح اتصل فيه بكرا، واعرض عليه شهرين، وركّز على الكوفيهات، ووقف الإرسال', 'wamid.o1'));
  await meta.flush();
  const toShop = f.graph.filter((g) => g.body.to === '962791000001' && g.body.type === 'text').at(-1);
  assert.equal(toShop.body.text.body, 'صاحب المنصة رح يتصل فيك بكرا الصبح 🙏');
  assert.equal(f.graph.filter((g) => g.body.to === '962798900911' && g.body.type === 'text').at(-1).body.text.body, 'تمام ✅ بعتتله، وحفظت التوجيه، ووقّفت الإرسال');
  const st = (await p.admin.get('/api/admin/sales')).data;
  assert.equal(st.settings.auto, false);
  assert.equal(st.prospects[0].guide, 'اعرض عليه شهرين تجربة');
  assert.equal(st.prospects[0].paused, false, 'الوكيل بيضل يرد');
  const chatLog = (await p.admin.get(`/api/admin/prospects/${id}`)).data.messages;
  assert.equal(chatLog.at(-1).role, 'owner');

  // الوكيل بيشوف التوجيهات بردّه الجاي مع المحل
  await hook(meta, incomingMsg('962791000001', 'طيب كم السعر؟', 'wamid.s2'));
  await meta.flush();
  const agentCtx = f.claude.filter((x) => !JSON.stringify(x.body.system).includes('مساعد صاحب منصة')).at(-1).body.system[1].text;
  assert.match(agentCtx, /توجيه صاحب المنصة لهالمحل \(التزم فيه\): اعرض عليه شهرين تجربة/);
  assert.match(agentCtx, /توجيهات صاحب المنصة لكل المحادثات.*ركّز على الكوفيهات بعمّان/);

  // محل مش موجود: بيسألك
  await hook(meta, incomingMsg('962798900911', 'ابعت لمحل مش موجود', 'wamid.o2'));
  await meta.flush();
  assert.equal(f.graph.filter((g) => g.body.to === '962798900911' && g.body.type === 'text').at(-1).body.text.body, 'ما لقيته، أي محل قصدك؟');
});

test('أول رسالة الجديدة: صورة + أزرار لما Meta توافق (وإلا القديمة)، وكبسة «وريني» بتبعت صورة، ومنعرف مين قرأ', async () => {
  const graph = [];
  let tpl2 = 'PENDING';
  let tplAr = 'PENDING';
  let breakTpl2 = false;
  const fetch = async (url, init = {}) => {
    const u = String(url);
    if (!u.startsWith('https://graph.facebook.com/')) return new Response(null, { status: 201 });
    const body = init.body ? JSON.parse(init.body) : {};
    graph.push({ url: u, method: init.method || 'POST', body });
    const ok = (d) => new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.includes('/message_templates')) return ok({ data: u.includes('nuqatak_intro2') ? [{ name: 'nuqatak_intro2', status: tpl2, language: 'en' }] : u.includes('nuqatak_intro_ar') ? [{ name: 'nuqatak_intro_ar', status: tplAr, language: 'ar' }] : [] });
    if (u.includes('?fields=')) return ok({ quality_rating: 'GREEN' });
    if (breakTpl2 && body.template && body.template.name === 'nuqatak_intro_ar') return new Response(JSON.stringify({ error: { message: 'Number of parameters does not match', code: 132000 } }), { status: 400 });
    return ok({ messages: [{ id: `wamid.${graph.length}` }] });
  };
  const p = await platform({ fetch, ...WA_ENV, WHATSAPP_WABA_ID: '5550001' });
  await p.admin.put('/api/admin/sales/settings', { auto: true, daily: 20 });
  for (const [i, n] of ['كوفي الورد', 'مخبز النور', 'حلويات السعادة'].entries()) await p.admin.post('/api/admin/prospects', { name: n, phone: `079100000${i + 1}` });
  const ctx = { db: p.db, env: p.env, waitUntil: (x) => x };
  const sends = () => graph.filter((g) => g.body.type === 'template');

  // لسا عند Meta: بتنبعت القديمة
  await runScheduled(ctx, SUNDAY_NOON);
  assert.equal(sends()[0].body.template.name, 'nuqatak_intro');
  assert.equal(sends()[0].body.template.components.length, 1);

  // وافقت على العربي: الجديدة بصورة الرأس (حتى لو في نسخة English موافق عليها كمان)
  tpl2 = 'APPROVED';
  tplAr = 'APPROVED';
  await p.db.run("DELETE FROM platform_settings WHERE k = 'wa_tpl2'");
  await runScheduled(ctx, SUNDAY_NOON + 10 * 60e3);
  const t2 = sends().find((g) => g.body.template.name === 'nuqatak_intro_ar');
  assert.ok(t2, 'انبعتت الجديدة');
  assert.deepEqual(t2.body.template.components[0], { type: 'header', parameters: [{ type: 'image', image: { link: 'https://nuqatak.test/img/promo-card.jpg' } }] });
  assert.equal(t2.body.template.language.code, 'ar', 'العربي أول');
  const st = (await p.admin.get('/api/admin/sales')).data;
  assert.equal(st.intro.status, 'APPROVED');
  const shop = st.prospects.find((x) => x.wa === t2.body.to);
  const chat = (await p.admin.get(`/api/admin/prospects/${shop.id}`)).data.messages;
  assert.match(chat[0].text, /وريني كيف بتطلع/);

  // انقرت (إشعار حالة من Meta) ← بتنحسب
  const wamid = `wamid.${graph.indexOf(t2) + 1}`;
  await hook(p.client(), { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1234567890' }, statuses: [{ id: wamid, status: 'read', timestamp: '1760000000', recipient_id: t2.body.to }] } }] }] });
  const st2 = (await p.admin.get('/api/admin/sales')).data;
  assert.equal(st2.funnel.read, 1);
  assert.equal(st2.funnel.delivered, 1, 'انقرت يعني وصلت');
  assert.ok(st2.prospects.find((x) => x.id === shop.id).readAt);

  // كبس زر «🖼 وريني كيف بتطلع» ← صورة البطاقة فوراً
  const meta = p.client();
  await hook(meta, { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1234567890' }, contacts: [{ wa_id: t2.body.to, profile: { name: 'x' } }], messages: [{ from: t2.body.to, id: 'wamid.btn1', timestamp: '1760000000', type: 'button', button: { text: '🖼 وريني كيف بتطلع', payload: 'x' } }] } }] }] });
  await meta.flush();
  const img = graph.find((g) => g.body.type === 'image');
  assert.equal(img.body.to, t2.body.to);
  assert.equal(img.body.image.link, 'https://nuqatak.test/img/promo-card.jpg');

  // الجديدة انعملت غلط (بدون صورة): بنسجّل السبب وبنبعت القديمة لنفس المحل
  breakTpl2 = true;
  await p.admin.post('/api/admin/prospects', { name: 'مطعم البيت', phone: '0791000009' });
  const before = sends().length;
  await runScheduled(ctx, SUNDAY_NOON + 20 * 60e3);
  const after = sends().slice(before);
  assert.deepEqual(after.map((g) => g.body.template.name), ['nuqatak_intro_ar', 'nuqatak_intro']);
  assert.equal((await p.admin.get('/api/admin/sales')).data.intro.status, 'ERROR');
  // Meta بعتت إن حالة القالب الجديد تغيّرت ← منعيد نفحص فوراً
  await hook(p.client(), { object: 'whatsapp_business_account', entry: [{ id: '5550001', changes: [{ field: 'message_template_status_update', value: { event: 'APPROVED', message_template_name: 'nuqatak_intro_ar', message_template_language: 'ar' } }] }] });
  assert.equal((await p.admin.get('/api/admin/sales')).data.intro, null);
});
