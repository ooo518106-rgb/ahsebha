import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScheduled } from '../src/app.js';
import { localTime } from '../src/perks.js';
import { fakeDevice, setup, signup } from './helpers.mjs';

const DAY = 864e5;
const HOUR = 36e5;
// الساعة 12 الظهر بتوقيت عمّان (UTC+3) بعد كذا يوم من اليوم
const ammanNoon = (days = 0) => { const d = new Date(Date.now() + days * DAY); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9, 0); };

// محل + خدمة إشعارات وهمية بتفك الرسائل
async function world() {
  const sent = [];
  const devices = new Map();
  const fetchImpl = async (url, init) => {
    const d = devices.get(url);
    sent.push({ url, msg: d ? JSON.parse(await d.decrypt(new Uint8Array(init.body))) : null });
    return new Response(null, { status: 201 });
  };
  const w = await setup({ fetch: fetchImpl });
  const owner = w.client();
  const { shop } = await signup(owner, { shopName: 'Mocha' });
  await owner.get('/api/me'); // بيحفظ رابط الموقع للمهام الدورية
  async function customer(name, phone, extra = {}) {
    const guest = w.client();
    const r = await guest.post(`/api/shops/${shop.slug}/join`, { name, phone, ...extra });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const token = r.data.token;
    const id = (await owner.get(`/api/members/lookup?code=${token}`)).data.member.id;
    return { guest, token, id };
  }
  async function subscribe(cust) {
    const d = await fakeDevice();
    const endpoint = `https://web.push.apple.com/${cust.token}`;
    devices.set(endpoint, d);
    assert.equal((await cust.guest.post(`/api/cards/${cust.token}/push`, { endpoint, keys: { p256dh: d.p256dh, auth: d.auth } })).status, 201);
  }
  const cron = (now) => runScheduled({ db: w.db, env: w.env, waitUntil: () => {} }, now);
  return { ...w, owner, shop, customer, subscribe, sent, cron };
}

test('نقاط دبل بأوقات معيّنة: بتنطبق بس بالوقت المحدد', async () => {
  const { owner, customer } = await world();
  const today = localTime('JO').weekday;
  assert.equal((await owner.put('/api/shop/perks', { boosts: [{ days: [today], from: '00:00', to: '23:59', mult: 3 }] })).status, 200);
  const me = (await owner.get('/api/me')).data.shop.perks;
  assert.equal(me.boostNow, 3, 'الكاشير بيشوف إنه العرض شغّال');
  const sara = await customer('سارة', '0791110001');
  const r = await owner.post(`/api/members/${sara.id}/earn`, { amount: 10 });
  assert.equal(r.data.delta, 30);
  assert.equal(r.data.base, 10);
  assert.deepEqual(r.data.reasons, ['⏰ نقاط ×3']);
  // يوم تاني ← ما في مضاعفة
  await owner.put('/api/shop/perks', { boosts: [{ days: [(today + 1) % 7], from: '00:00', to: '23:59', mult: 2 }] });
  assert.equal((await owner.post(`/api/members/${sara.id}/earn`, { amount: 10 })).data.delta, 10);
  // التحقق من القواعد
  assert.equal((await owner.put('/api/shop/perks', { boosts: [{ days: [], from: '10:00', to: '12:00', mult: 2 }] })).status, 400);
  assert.equal((await owner.put('/api/shop/perks', { boosts: [{ days: [1], from: '12:00', to: '10:00', mult: 2 }] })).status, 400);
  assert.equal((await owner.put('/api/shop/perks', { boosts: [{ days: [1], from: '10:00', to: '12:00', mult: 5 }] })).status, 400);
});

test('المستويات: الفضي بياخد ×1.25 والذهبي ×1.5، والأختام شارة بس', async () => {
  const { owner, customer } = await world();
  await owner.put('/api/shop/perks', { tiersOn: true, tierSilver: 2, tierGold: 3 });
  const sara = await customer('سارة', '0791110002');
  const deltas = [];
  for (let i = 0; i < 4; i++) deltas.push((await owner.post(`/api/members/${sara.id}/earn`, { amount: 10 })).data.delta);
  assert.deepEqual(deltas, [10, 10, 12, 15]);
  const m = (await owner.get(`/api/members/${sara.id}`)).data.member;
  assert.equal(m.tier.key, 'gold');
  assert.equal(m.tier.next, null);
  assert.equal((await owner.put('/api/shop/perks', { tierSilver: 5, tierGold: 5 })).status, 400, 'الذهبي لازم أكتر من الفضي');
  // محل أختام: المستوى شارة بس، والختم بيضل ختم
  const w2 = await world();
  await w2.owner.put('/api/shop', { programType: 'stamps' });
  await w2.owner.put('/api/shop/perks', { tiersOn: true, tierSilver: 2, tierGold: 3 });
  const ali = await w2.customer('علي', '0791110099');
  const got = [];
  for (let i = 0; i < 4; i++) got.push((await w2.owner.post(`/api/members/${ali.id}/earn`, { count: 1 })).data.delta);
  assert.deepEqual(got, [1, 1, 1, 1]);
  assert.equal((await w2.owner.get(`/api/members/${ali.id}`)).data.member.tier.key, 'gold');
});

test('ادعُ صاحبك: الاتنين بياخدوا هدية بأول زيارة للصاحب، ومرة وحدة بس', async () => {
  const { owner, customer, subscribe, sent, shop, client } = await world();
  const sara = await customer('سارة أحمد', '0791110003');
  await subscribe(sara);
  const card = (await sara.guest.get(`/api/cards/${sara.token}`)).data;
  assert.match(card.refUrl, new RegExp(`/j/${shop.slug}\\?ref=[a-z2-9]{6}$`));
  const code = card.refUrl.split('ref=')[1];
  assert.equal((await sara.guest.get(`/api/cards/${sara.token}`)).data.refUrl, card.refUrl, 'نفس الكود كل مرة');
  assert.equal((await client().get(`/api/shops/${shop.slug}/public?ref=${code}`)).data.referrer, 'سارة');
  const omar = await customer('عمر', '0791110004', { ref: code });
  const r = await owner.post(`/api/members/${omar.id}/earn`, { amount: 5 });
  assert.equal(r.data.refBonus, 10, 'الافتراضي عُشر نقاط المكافأة');
  assert.equal(r.data.member.balance, 15);
  assert.equal((await owner.get(`/api/members/${sara.id}`)).data.member.balance, 10);
  await owner.flush();
  assert.ok(sent.some((x) => x.msg && /صاحبك عمر زارنا/.test(x.msg.body)), 'سارة وصلها إشعار');
  // الزيارة التانية ما فيها هدية
  assert.equal((await owner.post(`/api/members/${omar.id}/earn`, { amount: 5 })).data.refBonus, undefined);
  assert.equal((await owner.get(`/api/members/${sara.id}`)).data.member.balance, 10);
  // كود غلط أو الدعوة مسكّرة
  const x = await customer('خالد', '0791110005', { ref: 'zzzzzz' });
  assert.equal((await owner.post(`/api/members/${x.id}/earn`, { amount: 5 })).data.refBonus, undefined);
  await owner.put('/api/shop/perks', { refBonus: 0 });
  assert.equal((await sara.guest.get(`/api/cards/${sara.token}`)).data.refUrl, null);
});

test('عيد الميلاد: الهدية بتنضاف يوم العيد الساعة 9 الصبح بتوقيت المحل، مرة بالسنة', async () => {
  const { db, owner, customer, subscribe, sent, cron, client, shop } = await world();
  const t = ammanNoon(40);
  const md = new Date(t).toISOString().slice(5, 10);
  const [mm, dd] = md.split('-').map(Number);
  assert.equal((await client().post(`/api/shops/${shop.slug}/join`, { name: 'سلمى', phone: '0791110006', bdayDay: 31, bdayMonth: 2 })).status, 400, 'تاريخ مش موجود');
  const salma = await customer('سلمى', '0791110007', { bdayDay: dd, bdayMonth: mm });
  await subscribe(salma);
  assert.equal((await owner.get(`/api/members/${salma.id}`)).data.member.birthday, md);
  // ما بتنحسب لو التاريخ انكتب من أقل من أسبوعين (حتى ما حدا يكتب تاريخ اليوم)
  await db.run('UPDATE members SET bday_set_at = ? WHERE id = ?', t - 5 * DAY, salma.id);
  assert.equal((await cron(t)).birthdays, 0);
  await db.run('UPDATE members SET bday_set_at = ? WHERE id = ?', t - 30 * DAY, salma.id);
  assert.equal((await cron(t - 5 * HOUR)).birthdays, 0, 'الساعة 7 الصبح بعمّان: لسا بكير');
  assert.equal((await cron(t)).birthdays, 1);
  const m = (await owner.get(`/api/members/${salma.id}`)).data.member;
  assert.equal(m.balance, 100, 'الهدية الافتراضية = مكافأة كاملة');
  assert.ok(sent.some((x) => x.msg && /كل سنة وإنت سالم يا سلمى/.test(x.msg.body) && /مشروب مجاني اليوم علينا/.test(x.msg.body)));
  assert.equal((await cron(t + HOUR)).birthdays, 0, 'مرة وحدة بالسنة');
  // من البطاقة: الزبون بيضيف تاريخه مرة وحدة
  const ali = await customer('علي', '0791110008');
  assert.equal((await ali.guest.post(`/api/cards/${ali.token}/birthday`, { day: 30, month: 2 })).status, 400);
  assert.equal((await ali.guest.post(`/api/cards/${ali.token}/birthday`, { day: 5, month: 3 })).status, 200);
  assert.equal((await ali.guest.post(`/api/cards/${ali.token}/birthday`, { day: 6, month: 3 })).status, 409);
});

test('الزبون الغايب: بيوصله «اشتقنالك» مرة لكل غيبة، ونقاطه دبل لـ 3 أيام', async () => {
  const { db, owner, customer, subscribe, sent, cron } = await world();
  await owner.put('/api/shop/perks', { winbackDays: 30, winbackText: 'وحشتنا يا {الاسم} ☕' });
  const sara = await customer('سارة', '0791110009');
  const quiet = await customer('بدون إشعارات', '0791110010');
  await subscribe(sara);
  await owner.post(`/api/members/${sara.id}/earn`, { amount: 10 });
  const t = ammanNoon(0);
  await db.run('UPDATE members SET last_visit = ?, created_at = ? WHERE id IN (?, ?)', t - 31 * DAY, t - 60 * DAY, sara.id, quiet.id);
  sent.length = 0;
  assert.equal((await cron(t - 4 * HOUR)).winback, 0, 'الصبح بكير: لأ');
  assert.equal((await cron(t)).winback, 1, 'اللي ما فعّل الإشعارات ما بينحسب');
  assert.equal(sent[0].msg.body, 'وحشتنا يا سارة ☕ — نقاطك دبل لـ 3 أيام 🎁');
  assert.equal((await cron(t + HOUR)).winback, 0, 'مرة وحدة لكل غيبة');
  // زيارته الجاية دبل
  const r = await owner.post(`/api/members/${sara.id}/earn`, { amount: 10 });
  assert.equal(r.data.delta, 20);
  assert.deepEqual(r.data.reasons, ['💤 رجعتك ×2']);
  assert.equal((await owner.put('/api/shop/perks', { winbackDays: 3 })).status, 400, 'أقل إشي 7 أيام');
});

test('التقييم: طلب بعد الزيارة، والتقييم الحلو بيروح على Google والزعلان بيضل عند المحل', async () => {
  const { db, owner, customer, subscribe, sent, cron } = await world();
  assert.equal((await owner.put('/api/shop/perks', { reviewUrl: 'http://bad.example' })).status, 400);
  await owner.put('/api/shop/perks', { reviewUrl: 'https://g.page/r/mocha/review' });
  const sara = await customer('سارة', '0791110011');
  await subscribe(sara);
  assert.equal((await sara.guest.get(`/api/cards/${sara.token}`)).data.canRate, false, 'لسا ما زار');
  await owner.post(`/api/members/${sara.id}/earn`, { amount: 10 });
  assert.equal((await sara.guest.get(`/api/cards/${sara.token}`)).data.canRate, true);
  // إشعار «كيف كانت زيارتك؟» بعد ساعتين
  const t = ammanNoon(0);
  await db.run('UPDATE members SET last_visit = ? WHERE id = ?', t - 2 * HOUR, sara.id);
  sent.length = 0;
  assert.equal((await cron(t)).reviews, 1);
  assert.match(sent[0].msg.body, /كيف كانت زيارتك/);
  assert.match(sent[0].msg.url, /\?rate=1$/);
  assert.equal((await cron(t + 30 * 60 * 1000)).reviews, 0, 'مرة وحدة');
  await db.run('UPDATE members SET last_visit = ? WHERE id = ?', Date.now(), sara.id);
  let r = await sara.guest.post(`/api/cards/${sara.token}/review`, { stars: 5 });
  assert.equal(r.status, 201);
  assert.equal(r.data.googleUrl, 'https://g.page/r/mocha/review');
  assert.equal((await sara.guest.post(`/api/cards/${sara.token}/review`, { stars: 4 })).status, 409, 'مرة لكل زيارة');
  await owner.post(`/api/members/${sara.id}/earn`, { amount: 10 });
  r = await sara.guest.post(`/api/cards/${sara.token}/review`, { stars: 2, comment: 'القهوة كانت باردة' });
  assert.equal(r.data.googleUrl, null);
  const row = await db.get('SELECT * FROM reviews WHERE member_id = ? AND stars = 2', sara.id);
  assert.equal(row.comment, 'القهوة كانت باردة');
  assert.equal((await sara.guest.post(`/api/cards/${sara.token}/review`, { stars: 9 })).status, 400);
});

test('المهام الدورية ما بتشتغل للمحل المتوقف، وبتحترم سقف الإشعارات', async () => {
  const { db, customer, subscribe, cron, client } = await world();
  const t = ammanNoon(0);
  const people = [];
  for (let i = 0; i < 35; i++) {
    const p = await customer(`زبون ${i}`, `07922${String(i).padStart(5, '0')}`);
    await subscribe(p);
    people.push(p.id);
  }
  await db.run(`UPDATE members SET last_visit = ?, created_at = ? WHERE id IN (${people.join(',')})`, t - 40 * DAY, t - 60 * DAY);
  assert.equal((await cron(t)).winback, 30, 'سقف 30 إشعار بالتشغيلة');
  assert.equal((await cron(t + 15 * 60 * 1000)).winback, 5, 'الباقي بالتشغيلة الجاية');
  // محل تاني خلصت تجربته: زبائنه ما بيوصلهم إشي
  const other = client();
  const { shop: s2 } = await signup(other, { shopName: 'Expired' });
  await db.run('UPDATE shops SET active_until = ? WHERE id = ?', t - DAY, s2.id);
  const g = client();
  const token = (await g.post(`/api/shops/${s2.slug}/join`, { name: 'زبون', phone: '0793330000' })).data.token;
  const d = await fakeDevice();
  await g.post(`/api/cards/${token}/push`, { endpoint: 'https://web.push.apple.com/x2', keys: { p256dh: d.p256dh, auth: d.auth } });
  await db.run('UPDATE members SET last_visit = ?, created_at = ? WHERE token = ?', t - 40 * DAY, t - 60 * DAY, token);
  assert.equal((await cron(t + 30 * 60 * 1000)).winback, 0);
});
