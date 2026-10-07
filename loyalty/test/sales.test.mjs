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
      const body = JSON.parse(init.body);
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
  assert.match(b.system[0].text, /ما في خصم أبداً/);
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
    { name: 'كوفي الياسمين', area: 'عبدون، عمّان', kind: 'كوفي شوب', phone: '0791112223', instagram: '@yasmine.cafe', website: 'https://maps.google.com/x', why: 'تقييم 4.7' },
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
  const t = f.graph[0];
  assert.equal(t.url, 'https://graph.facebook.com/v22.0/1234567890/messages');
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
  assert.equal(g.graph.length, 1);
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
});
