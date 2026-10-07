import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signup } from './helpers.mjs';
import { cleanHistory } from '../src/ai.js';

// Anthropic وهمي: بيسجّل الطلبات وبيرد برسالة جاهزة
function fakeClaude(reply = () => ({ text: 'جرّب الكابتشينو الكبير ☕' })) {
  const calls = [];
  const fetch = async (url, init) => {
    const u = String(url);
    if (!u.startsWith('https://api.anthropic.com/')) return new Response(null, { status: 201 });
    const headers = new Headers(init.headers);
    const body = JSON.parse(init.body);
    calls.push({ url: u, headers, body });
    const r = reply(body, calls.length);
    if (r.status) return new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'boom' } }), { status: r.status, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({
      id: `msg_${calls.length}`, type: 'message', role: 'assistant', model: body.model,
      content: [{ type: 'thinking', thinking: '', signature: 'sig' }, ...(r.text ? [{ type: 'text', text: r.text }] : [])],
      stop_reason: r.refusal ? 'refusal' : 'end_turn', stop_sequence: null,
      usage: { input_tokens: 150, output_tokens: 90, cache_read_input_tokens: 2400, cache_creation_input_tokens: 0 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, calls };
}

async function shopWithMenu(env) {
  const w = await setup(env);
  const admin = w.client();
  await signup(admin, { shopName: 'Platform' });
  const owner = w.client();
  const { shop } = await signup(owner, { shopName: 'Mocha' });
  await owner.post('/api/menu', { category: 'مشروبات ساخنة', name: 'كابتشينو', sizes: [{ name: 'صغير', price: 2.5 }, { name: 'كبير', price: 3 }] });
  await owner.post('/api/menu', { category: 'حلويات', name: 'تشيز كيك', price: 3.5, description: 'بالتوت' });
  const guest = w.client();
  const j = await guest.post(`/api/shops/${shop.slug}/join`, { name: 'سارة أحمد', phone: '0791234567' });
  const id = (await owner.get(`/api/members/lookup?code=${j.data.token}`)).data.member.id;
  await owner.post(`/api/members/${id}/earn`, { amount: 30 });
  return { ...w, admin, owner, shop, guest, token: j.data.token };
}

test('المساعد: بيبعت لـ Claude معلومات المحل والمنيو (بالكاش) ومعلومات الزبون، وبيرجّع الجواب', async () => {
  const claude = fakeClaude();
  const p = await shopWithMenu({ ANTHROPIC_API_KEY: 'sk-test-key', fetch: claude.fetch });
  assert.equal((await p.guest.get(`/api/cards/${p.token}`)).data.assistant, true);
  assert.equal((await p.guest.get(`/api/shops/${p.shop.slug}/menu`)).data.assistant, true);
  const r = await p.guest.post('/api/assistant', { token: p.token, messages: [{ role: 'user', content: 'شو بتنصحني؟' }] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.reply, 'جرّب الكابتشينو الكبير ☕');
  const call = claude.calls[0];
  assert.ok(call.url.startsWith('https://api.anthropic.com/v1/messages'));
  assert.equal(call.headers.get('x-api-key'), 'sk-test-key');
  assert.match(call.headers.get('anthropic-beta'), /server-side-fallback-2026-07-01/);
  const b = call.body;
  assert.equal(b.model, 'claude-opus-5-5');
  assert.equal(b.fallbacks, 'default');
  assert.deepEqual(b.output_config, { effort: 'low' });
  assert.equal(b.thinking, undefined, 'Opus 5.5: التفكير بيشتغل لحاله');
  assert.deepEqual(b.system[0].cache_control, { type: 'ephemeral' });
  assert.match(b.system[0].text, /كابتشينو: صغير 2\.5 JOD \/ كبير 3 JOD/);
  assert.match(b.system[0].text, /تشيز كيك: 3\.5 JOD \(بالتوت\)/);
  assert.doesNotMatch(b.system[0].text, /سارة/, 'الجزء المحفوظ بالكاش ما فيه معلومات الزبون');
  assert.match(b.system[1].text, /اسمه: سارة/);
  assert.match(b.system[1].text, /رصيده: 30/);
  assert.deepEqual(b.messages, [{ role: 'user', content: 'شو بتنصحني؟' }]);
  // الاستهلاك بينحسب للمدير (بدون المحادثة)
  const st = (await p.admin.get('/api/admin/stats')).data.ai;
  assert.equal(st.requests, 1);
  assert.equal(st.output, 90);
  assert.ok(st.costUsd >= 0);
  assert.equal((await p.owner.get('/api/me')).data.ai.monthQuestions, 1);
  // من المنيو بدون بطاقة
  await p.client().post('/api/assistant', { slug: p.shop.slug, messages: [{ role: 'user', content: 'شو عندكم حلو؟' }] });
  assert.match(claude.calls[1].body.system[1].text, /بدون بطاقة/);
});

test('المساعد: مقفّل بدون مفتاح، بالأساسي، ولما المالك يطفيه، ومع حدود باليوم', async () => {
  const off = await shopWithMenu({});
  assert.equal((await off.guest.get(`/api/cards/${off.token}`)).data.assistant, false);
  assert.equal((await off.guest.post('/api/assistant', { token: off.token, messages: [{ role: 'user', content: 'مرحبا' }] })).status, 404);

  const claude = fakeClaude();
  const p = await shopWithMenu({ ANTHROPIC_API_KEY: 'sk-test', AI_CUSTOMER_DAILY: '2', fetch: claude.fetch });
  const ask = (content = 'مرحبا') => p.guest.post('/api/assistant', { token: p.token, messages: [{ role: 'user', content }] });
  assert.equal((await ask()).status, 200);
  assert.equal((await ask()).status, 200);
  assert.equal((await ask()).status, 429, 'سؤالين باليوم لهالزبون');
  // صاحب المحل بيطفيه
  const q = await shopWithMenu({ ANTHROPIC_API_KEY: 'sk-test', fetch: claude.fetch });
  await q.owner.put('/api/shop/perks', { aiOn: false });
  assert.equal((await q.guest.get(`/api/cards/${q.token}`)).data.assistant, false);
  assert.equal((await q.guest.post('/api/assistant', { token: q.token, messages: [{ role: 'user', content: 'هاي' }] })).status, 404);
  // الباقة الأساسية
  await q.owner.put('/api/shop/perks', { aiOn: true });
  await q.admin.post(`/api/admin/shops/${q.shop.id}/plan`, { action: 'month', tier: 'basic' });
  assert.equal((await q.guest.get(`/api/cards/${q.token}`)).data.assistant, false);
  assert.equal((await q.guest.post('/api/assistant', { token: q.token, messages: [{ role: 'user', content: 'هاي' }] })).status, 404);
});

test('المساعد: الرفض والأخطاء بيرجعوا رسالة لطيفة، والمحادثة بتتنظف', async () => {
  let mode = 'refusal';
  const claude = fakeClaude(() => (mode === 'refusal' ? { refusal: true } : { status: 500 }));
  const p = await shopWithMenu({ ANTHROPIC_API_KEY: 'sk-test', fetch: claude.fetch });
  const r = await p.guest.post('/api/assistant', { token: p.token, messages: [{ role: 'user', content: 'سؤال' }] });
  assert.equal(r.status, 200);
  assert.match(r.data.reply, /ما بقدر أساعد بهالسؤال/);
  mode = 'error';
  const e = await p.guest.post('/api/assistant', { token: p.token, messages: [{ role: 'user', content: 'سؤال' }] });
  assert.equal(e.status, 503);
  assert.match(e.data.error, /المساعد مش متاح/);
  assert.equal((await p.guest.post('/api/assistant', { token: p.token, messages: [{ role: 'assistant', content: 'أهلا' }] })).status, 400);
  // تنظيف المحادثة: أدوار متناوبة، آخر 12، نص قصير، وبتبلّش وبتخلص بالزبون
  const h = cleanHistory([{ role: 'assistant', content: 'أهلا' }, { role: 'user', content: 'a' }, { role: 'user', content: 'b' }, { role: 'system', content: 'x' }, { role: 'assistant', content: 'c' }, { role: 'user', content: 'x'.repeat(900) }]);
  assert.deepEqual(h.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.equal(h[0].content, 'a\nb');
  assert.equal(h[2].content.length, 500);
  assert.equal(cleanHistory([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }]), null);
});
