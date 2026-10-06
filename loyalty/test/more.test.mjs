import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScheduled } from '../src/app.js';
import { localTime } from '../src/perks.js';
import { fakeDevice, setup, signup } from './helpers.mjs';

const DAY = 864e5;
const HOUR = 36e5;
// ساعة معيّنة بتوقيت عمّان (UTC+3) بعد كذا يوم من اليوم
const amman = (hour, days = 0) => { const d = new Date(Date.now() + days * DAY); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour - 3, 0); };

// منصة فيها مدير (أول حساب) ومحل تاني، وخدمة إشعارات وهمية بتفك الرسائل
async function platform() {
  const sent = [];
  const devices = new Map();
  const fetchImpl = async (url, init) => {
    const d = devices.get(url);
    sent.push({ url, msg: d ? JSON.parse(await d.decrypt(new Uint8Array(init.body))) : null });
    return new Response(null, { status: 201 });
  };
  const w = await setup({ fetch: fetchImpl });
  const admin = w.client();
  await signup(admin, { shopName: 'Platform' });
  await admin.get('/api/me');
  const owner = w.client();
  const { shop } = await signup(owner, { shopName: 'Mocha' });
  const device = async (c, path, name) => {
    const d = await fakeDevice();
    const endpoint = `https://web.push.apple.com/${name}`;
    devices.set(endpoint, d);
    const r = await c.post(path, { endpoint, keys: { p256dh: d.p256dh, auth: d.auth } });
    assert.ok(r.status === 201, JSON.stringify(r.data));
    return endpoint;
  };
  async function customer(name, phone, extra = {}) {
    const guest = w.client();
    const r = await guest.post(`/api/shops/${shop.slug}/join`, { name, phone, ...extra });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const id = (await owner.get(`/api/members/lookup?code=${r.data.token}`)).data.member.id;
    return { guest, token: r.data.token, id };
  }
  async function staffClient(email = `cashier${Math.random().toString(36).slice(2)}@test.com`) {
    await owner.post('/api/staff', { name: 'أحمد', email, password: 'cashier-pass' });
    const st = w.client();
    await st.post('/api/auth/login', { email, password: 'cashier-pass' });
    return st;
  }
  const flushAll = async (...cs) => { for (const c of cs) await c.flush(); };
  const to = (endpoint) => sent.filter((x) => x.url === endpoint).map((x) => x.msg);
  const cron = (now) => runScheduled({ db: w.db, env: w.env, waitUntil: (p) => p }, now);
  return { ...w, admin, owner, shop, device, customer, staffClient, sent, to, flushAll, cron };
}

test('تنبيهات صاحب المحل ومدير المنصة: تقييم زعلان، طلب اشتراك، حوالة، تفعيل، وملخص اليوم', async () => {
  const p = await platform();
  const { admin, owner, device, to, flushAll } = p;
  const adminDev = await device(admin, '/api/me/push', 'admin');
  const ownerDev = await device(owner, '/api/me/push', 'owner');
  assert.equal((await owner.get('/api/me')).data.userPush, 1);
  // جهاز التجربة
  const t = await owner.post('/api/me/push', { ...{ endpoint: ownerDev, keys: { p256dh: 'x' } } });
  assert.equal(t.status, 400, 'اشتراك ناقص');
  // تقييم زعلان ← صاحب المحل
  const sara = await p.customer('سارة أحمد', '0791110001');
  await owner.post(`/api/members/${sara.id}/earn`, { amount: 10 });
  await sara.guest.post(`/api/cards/${sara.token}/review`, { stars: 2, comment: 'بطيء' });
  await flushAll(sara.guest);
  assert.deepEqual(to(ownerDev).map((m) => m.body), ['بطيء']);
  assert.match(to(ownerDev)[0].title, /★★ تقييم من سارة/);
  // طلب اشتراك ← المدير
  await p.client().post('/api/leads', { shopName: 'Cafe X', name: 'خالد', phone: '0790000000', kind: 'كوفي شوب' });
  // حوالة ← المدير، وتفعيلها ← صاحب المحل
  await admin.put('/api/admin/settings', { cliqAlias: 'NUQATAK' });
  await owner.post('/api/billing/claim', { plan: 'month', payer: 'أحمد' });
  await flushAll(owner, admin);
  const pay = (await admin.get('/api/admin/payments')).data.payments[0];
  await admin.post(`/api/admin/payments/${pay.id}`, { action: 'approve' });
  await flushAll(admin);
  const adminMsgs = to(adminDev).map((m) => m.title);
  assert.ok(adminMsgs.includes('📩 طلب اشتراك جديد'));
  assert.ok(adminMsgs.includes('💳 حوالة CliQ للتأكيد'));
  assert.ok(to(ownerDev).some((m) => m.title === '✅ انفعّل اشتراكك'));
  // ملخص اليوم الساعة 10 بالليل بتوقيت المحل، مرة وحدة
  const before = to(ownerDev).length;
  assert.equal((await p.cron(amman(21))).summaries, 0);
  assert.equal((await p.cron(amman(22))).summaries, 2, 'محل المنصة ومحل موكا');
  assert.equal((await p.cron(amman(22) + 30 * 60 * 1000)).summaries, 0);
  assert.match(to(ownerDev)[before].title, /📊 ملخص اليوم · Mocha/);
  // إيقاف
  assert.equal((await owner.req('DELETE', '/api/me/push', { endpoint: ownerDev })).status, 200);
  assert.equal((await owner.get('/api/me')).data.userPush, 0);
});

test('الحماية من تلاعب الموظفين: نفس الزبون ورا بعض، حد اليوم، وتنبيه للنقاط الكتير', async () => {
  const p = await platform();
  const { owner, device, to, flushAll } = p;
  const ownerDev = await device(owner, '/api/me/push', 'owner');
  const st = await p.staffClient();
  const sara = await p.customer('سارة', '0791110002');
  assert.equal((await st.post(`/api/members/${sara.id}/earn`, { amount: 10, key: 'k-first-0001' })).status, 200);
  // إعادة لنفس الطلب (نت ضعيف) ← مش محاولة مكررة
  assert.equal((await st.post(`/api/members/${sara.id}/earn`, { amount: 10, key: 'k-first-0001' })).data.duplicate, true);
  // طلب تاني بعد دقيقة ← ممنوع للكاشير، وتنبيه للمالك
  const again = await st.post(`/api/members/${sara.id}/earn`, { amount: 10 });
  assert.equal(again.status, 409);
  assert.match(again.data.error, /انضافله نقاط قبل/);
  await st.post(`/api/members/${sara.id}/earn`, { amount: 10 }); // ما بيبعت تنبيه تاني بنفس الساعة
  await flushAll(st);
  assert.equal(to(ownerDev).filter((m) => m.title === '🛡️ محاولة نقاط مكررة').length, 1);
  // المالك مستثنى
  assert.equal((await owner.post(`/api/members/${sara.id}/earn`, { amount: 10 })).status, 200);
  // حد اليوم (3 زيارات): المالك ضاف التالتة، فالكاشير ما بيقدر حتى بعد ما تخلص فترة الانتظار
  await owner.post(`/api/members/${sara.id}/earn`, { amount: 10 });
  await p.db.run('UPDATE members SET last_visit = ? WHERE id = ?', Date.now() - 60 * 60 * 1000, sara.id);
  const daily = await st.post(`/api/members/${sara.id}/earn`, { amount: 10 });
  assert.equal(daily.status, 409);
  assert.match(daily.data.error, /مرات اليوم/);
  // نقاط كتير مرة وحدة (مكافأة كاملة = 100) ← تنبيه
  const omar = await p.customer('عمر', '0791110003');
  assert.equal((await st.post(`/api/members/${omar.id}/earn`, { amount: 120 })).status, 200);
  await flushAll(st);
  assert.ok(to(ownerDev).some((m) => m.title === '⚠️ نقاط كتير على بطاقة وحدة' && /ضاف 120 نقطة لـ عمر/.test(m.body)));
  // المالك بيغيّر الإعدادات أو بيوقفها
  assert.equal((await owner.put('/api/shop/perks', { guardCooldown: 0, guardDaily: 0, guardBig: 500 })).status, 200);
  assert.equal((await st.post(`/api/members/${omar.id}/earn`, { amount: 5 })).status, 200);
  assert.equal((await owner.put('/api/shop/perks', { guardCooldown: 999 })).status, 400);
  // تقرير الموظفين
  const staff = (await owner.get('/api/reports')).data.staff;
  const ahmad = staff.find((u) => u.role === 'staff');
  assert.equal(ahmad.earns, 3);
  assert.equal(ahmad.customers, 2);
  assert.equal(ahmad.points, 135);
});

test('الكوبونات: لمجموعة معيّنة، بتطلع على البطاقة، وبتنصرف مرة وحدة', async () => {
  const p = await platform();
  const { owner, device, to } = p;
  await owner.put('/api/shop/perks', { tiersOn: true, tierSilver: 2, tierGold: 3 });
  const gold = await p.customer('سارة', '0791110004');
  const plain = await p.customer('عمر', '0791110005');
  for (let i = 0; i < 3; i++) await owner.post(`/api/members/${gold.id}/earn`, { amount: 1, key: `gold-visit-${i}xx` });
  await p.db.run('UPDATE members SET last_visit = NULL WHERE id = ?', gold.id);
  const dev = await device(gold.guest, `/api/cards/${gold.token}/push`, 'gold');
  const list = (await owner.get('/api/coupons')).data;
  assert.equal(list.segments.find((x) => x.key === 'gold').count, 1);
  assert.equal(list.segments.find((x) => x.key === 'all').count, 2);
  assert.equal((await owner.post('/api/coupons', { title: 'x', segment: 'gold', days: 3 })).status, 400);
  assert.equal((await owner.post('/api/coupons', { title: 'خصم 20% على الكيك', segment: 'nope', days: 3 })).status, 400);
  const r = await owner.post('/api/coupons', { title: 'خصم 20% على الكيك', details: 'مع أي مشروب', segment: 'gold', days: 3 });
  assert.equal(r.status, 201);
  assert.equal(r.data.issued, 1);
  assert.equal(r.data.push.sent, 1);
  assert.match(to(dev)[0].body, /خصم 20% على الكيك — مع أي مشروب · صالح 3 أيام/);
  // على البطاقة
  assert.equal((await gold.guest.get(`/api/cards/${gold.token}`)).data.coupons[0].title, 'خصم 20% على الكيك');
  assert.deepEqual((await plain.guest.get(`/api/cards/${plain.token}`)).data.coupons, []);
  // الكاشير بيصرفه مرة وحدة
  const st = await p.staffClient();
  const cs = (await st.get(`/api/members/${gold.id}/coupons`)).data.coupons;
  assert.equal(cs.length, 1);
  assert.equal((await st.post(`/api/members/${gold.id}/coupons/${cs[0].id}/use`, {})).status, 200);
  assert.equal((await st.post(`/api/members/${gold.id}/coupons/${cs[0].id}/use`, {})).status, 409);
  assert.equal((await st.post(`/api/members/${plain.id}/coupons/${cs[0].id}/use`, {})).status, 409, 'مش إله');
  const after = (await owner.get('/api/coupons')).data.coupons[0];
  assert.equal(after.used, 1);
  // الإيقاف
  const r2 = await owner.post('/api/coupons', { title: 'قهوة الصبح بنص السعر', segment: 'all', days: 7 });
  assert.equal(r2.data.issued, 2);
  assert.equal((await owner.req('DELETE', `/api/coupons/${r2.data.id}`)).status, 200);
  assert.deepEqual((await plain.guest.get(`/api/cards/${plain.token}`)).data.coupons, []);
  assert.equal((await st.get('/api/coupons')).status, 403, 'إنشاء الكوبونات للمالك');
});

test('الرصيد المدفوع مسبقاً: شحن مع هدية، دفع منه، ما بينزل تحت الصفر، وإشعار للزبون', async () => {
  const p = await platform();
  const { owner, device, to } = p;
  const sara = await p.customer('سارة', '0791110006');
  const dev = await device(sara.guest, `/api/cards/${sara.token}/push`, 'sara');
  assert.equal((await owner.post(`/api/members/${sara.id}/credit/topup`, { amount: 20 })).status, 400, 'لازم يتفعّل أول');
  await owner.put('/api/shop/perks', { creditOn: true, creditBonus: 10 });
  let r = await owner.post(`/api/members/${sara.id}/credit/topup`, { amount: 20, key: 'topup-key-0001' });
  assert.equal(r.status, 200);
  assert.equal(r.data.member.credit, 22);
  assert.deepEqual(r.data.topup, { amount: 20, bonus: 2 });
  assert.equal((await owner.post(`/api/members/${sara.id}/credit/topup`, { amount: 20, key: 'topup-key-0001' })).data.duplicate, true, 'نفس الطلب ما بينحسب مرتين');
  assert.match(to(dev)[0].body, /انشحن رصيدك 20 JOD \+ 2 هدية. رصيدك صار 22 JOD/);
  // الدفع
  const st = await p.staffClient();
  r = await st.post(`/api/members/${sara.id}/credit/spend`, { amount: 3.5 });
  assert.equal(r.data.member.credit, 18.5);
  assert.match(to(dev)[1].body, /انخصم 3.5 JOD من رصيدك. باقي 18.5 JOD/);
  r = await st.post(`/api/members/${sara.id}/credit/spend`, { amount: 100 });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /الرصيد ما بيكفي/);
  assert.equal((await st.post(`/api/members/${sara.id}/credit/spend`, { amount: -5 })).status, 400);
  // الشحن بدون هدية (تصحيح من المالك)
  assert.equal((await owner.post(`/api/members/${sara.id}/credit/topup`, { amount: 1.5, bonus: false })).data.member.credit, 20);
  const h = (await owner.get(`/api/members/${sara.id}/credit`)).data;
  assert.equal(h.credit, 20);
  assert.deepEqual(h.history.map((x) => x.kind), ['topup', 'spend', 'topup']);
  assert.equal((await sara.guest.get(`/api/cards/${sara.token}`)).data.member.credit, 20);
  const rep = (await owner.get('/api/reports')).data.credit;
  assert.deepEqual(rep, { outstanding: 20, topups: 21.5, spent: 3.5 });
});

test('صلاحية النقاط: بتبلّش من يوم التفعيل، تذكير قبل أسبوع، وبعدين بتنتهي', async () => {
  const p = await platform();
  const { owner, device, to } = p;
  const sara = await p.customer('سارة', '0791110007');
  await owner.post(`/api/members/${sara.id}/earn`, { amount: 40 });
  // زيارتها قديمة (قبل سنتين)، بس الميزة تفعّلت اليوم ← نقاطها ما بتنمسح فوراً
  await p.db.run('UPDATE members SET last_visit = ?, created_at = ? WHERE id = ?', Date.now() - 700 * DAY, Date.now() - 800 * DAY, sara.id);
  assert.equal((await owner.put('/api/shop/perks', { expiryMonths: 5 })).status, 400);
  await owner.put('/api/shop/perks', { expiryMonths: 6, winbackDays: 0, reviewOn: false }); // بس الصلاحية بهالاختبار
  assert.equal((await p.cron(amman(12))).expired, 0);
  const m = (await owner.get(`/api/members/${sara.id}`)).data.member;
  assert.ok(Math.abs(m.expiresAt - (Date.now() + 180 * DAY)) < HOUR, 'بتنتهي بعد 6 أشهر من اليوم');
  // تذكير قبل أسبوع
  const dev = await device(sara.guest, `/api/cards/${sara.token}/push`, 'sara');
  const warnAt = amman(12, 175);
  assert.equal((await p.cron(warnAt)).expiryWarned, 1);
  assert.match(to(dev)[0].body, /عندك 40 نقطة بتنتهي بعد 5 أيام/);
  assert.equal((await p.cron(warnAt + HOUR)).expiryWarned, 0, 'مرة وحدة');
  // انتهت
  const r = await p.cron(amman(12, 181));
  assert.equal(r.expired, 1);
  const after = (await owner.get(`/api/members/${sara.id}`)).data;
  assert.equal(after.member.balance, 0);
  assert.equal(after.txns[0].note, '⏳ انتهت صلاحية النقاط');
  assert.equal(after.txns[0].delta, -40);
});

test('روابط المحل والفروع: الروابط بتتصحّح، والموظف مربوط بفرعه بالحركات والتقارير', async () => {
  const p = await platform();
  const { owner } = p;
  let r = await owner.put('/api/shop/links', { instagram: '@mocha.jo', tiktok: 'https://www.tiktok.com/@mochajo', facebook: 'mochajo', whatsapp: '0791234567', website: 'https://mocha.jo' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.shop.links, { instagram: 'https://instagram.com/mocha.jo', tiktok: 'https://www.tiktok.com/@mochajo', facebook: 'https://facebook.com/mochajo', whatsapp: 'https://wa.me/962791234567', website: 'https://mocha.jo' });
  assert.equal((await owner.put('/api/shop/links', { website: 'http://x.com' })).status, 400);
  assert.equal((await owner.put('/api/shop/links', { instagram: 'not valid!' })).status, 400);
  const sara = await p.customer('سارة', '0791110008');
  assert.equal((await sara.guest.get(`/api/cards/${sara.token}`)).data.shop.links.instagram, 'https://instagram.com/mocha.jo');
  // الفروع
  r = await owner.put('/api/shop', { locations: [{ name: 'عبدون', lat: 31.95, lng: 35.91 }, { name: 'الصويفية', lat: 31.96, lng: 35.86 }] });
  const [abdoun, swe] = r.data.shop.locations;
  const st = await p.staffClient('branch-cashier@test.com');
  const staffId = (await owner.get('/api/staff')).data.users.find((u) => u.role === 'staff').id;
  assert.equal((await owner.put(`/api/staff/${staffId}`, { branchId: 'bnope00' })).status, 400);
  assert.equal((await owner.put(`/api/staff/${staffId}`, { branchId: swe.id })).data.users.find((u) => u.id === staffId).branchId, swe.id);
  // الموظف لازم يسجّل دخول من جديد عشان ياخد الفرع؟ لأ: الفرع بينقرا مع كل طلب
  await st.post(`/api/members/${sara.id}/earn`, { amount: 5, branch: abdoun.id });
  const omar = await p.customer('عمر', '0791110009');
  await owner.post(`/api/members/${omar.id}/earn`, { amount: 5, branch: abdoun.id });
  await owner.post(`/api/members/${omar.id}/earn`, { amount: 5, branch: 'bfake00' });
  const rows = await p.db.all('SELECT branch_id FROM txns WHERE kind = ? ORDER BY id', 'earn');
  assert.deepEqual(rows.map((x) => x.branch_id), [swe.id, abdoun.id, null], 'الموظف دايماً على فرعه، والمالك بيختار (وفرع مش موجود = بدون)');
  const byBranch = (await owner.get('/api/reports')).data.byBranch;
  assert.equal(byBranch.find((x) => x.id === swe.id).n, 1);
  assert.equal(byBranch.find((x) => x.id === abdoun.id).n, 1);
  assert.equal((await st.get('/api/me')).data.user.branchId, swe.id);
});

test('الإنجليزي: الزبون اللي اختار English بتوصله الإشعارات بالإنجليزي، وبيقدر يرجع للعربي', async () => {
  const p = await platform();
  const { owner, device, to } = p;
  const john = await p.customer('John Smith', '0791110010', { lang: 'en' });
  const dev = await device(john.guest, `/api/cards/${john.token}/push`, 'john');
  await owner.post(`/api/members/${john.id}/earn`, { amount: 10 });
  assert.equal(to(dev)[0].body, 'You earned 10 points ☕ Balance: 10, 90 to go for مشروب مجاني');
  await owner.put('/api/shop/perks', { creditOn: true });
  await owner.post(`/api/members/${john.id}/credit/topup`, { amount: 10 });
  assert.match(to(dev)[1].body, /^💳 Topped up 10 JOD \+ 1 gift. Your balance is 11 JOD$/);
  assert.equal((await john.guest.post(`/api/cards/${john.token}/lang`, { lang: 'ar' })).status, 200);
  await p.db.run('UPDATE members SET last_visit = ? WHERE id = ?', Date.now() - 3600e3, john.id);
  await owner.post(`/api/members/${john.id}/earn`, { amount: 10 });
  assert.match(to(dev)[2].body, /^انضافلك 10 نقطة/);
  assert.equal((await p.client().post('/api/cards/aaaaaaaaaaaaaaaaaaaa/lang', { lang: 'en' })).status, 404);
});

test('المندوبين: رابط المندوب بيربط المحل فيه، والعمولة من الدفعات المؤكدة، وصفحة إله بالرابط السري', async () => {
  const p = await platform();
  const { admin, client, db } = p;
  assert.equal((await p.owner.post('/api/admin/resellers', { name: 'خالد', pct: 20 })).status, 403);
  assert.equal((await admin.post('/api/admin/resellers', { name: 'خالد المندوب', phone: '0795551111', pct: 95 })).status, 400);
  let list = (await admin.post('/api/admin/resellers', { name: 'خالد المندوب', phone: '0795551111', pct: 20 })).data.resellers;
  const r = list[0];
  assert.match(r.link, /\/\?partner=[a-z2-9]{6}$/);
  // محل سجّل من رابطه، وطلب اشتراك من رابطه
  const shopOwner = client();
  await shopOwner.post('/api/auth/signup', { shopName: 'Cafe Partner', email: 'cp@test.com', password: 'secret-pass-1', partner: r.code });
  await client().post('/api/leads', { shopName: 'Lead Cafe', name: 'سامي', phone: '0790000001', partner: r.code });
  await client().post('/api/auth/signup', { shopName: 'Cafe Bad', email: 'cb@test.com', password: 'secret-pass-1', partner: 'zzzzzz' });
  const shops = (await admin.get('/api/admin/shops')).data.shops;
  assert.equal(shops.find((s) => s.name === 'Cafe Partner').reseller, 'خالد المندوب');
  assert.equal(shops.find((s) => s.name === 'Cafe Bad').reseller, null);
  assert.equal((await admin.get('/api/admin/leads')).data.leads[0].reseller, 'خالد المندوب');
  // تفعيل يدوي بسنة (150) ← عمولة 30
  const cp = shops.find((s) => s.name === 'Cafe Partner');
  await admin.post(`/api/admin/shops/${cp.id}/plan`, { action: 'year' });
  list = (await admin.get('/api/admin/resellers')).data.resellers;
  assert.equal(list[0].sales, 150);
  assert.equal(list[0].earned, 30);
  assert.equal(list[0].due, 30);
  assert.equal(list[0].shops[0].state, 'active');
  await admin.post(`/api/admin/resellers/${r.id}/payout`, { amount: 20 });
  // صفحة المندوب
  const token = list[0].statsUrl.split('/partner/')[1];
  const pub = (await client().get(`/api/partner/${token}`)).data;
  assert.equal(pub.name, 'خالد المندوب');
  assert.equal(pub.paid, 20);
  assert.equal(pub.due, 10);
  assert.equal(pub.shops.length, 1);
  assert.equal((await client().get('/api/partner/aaaaaaaaaaaaaaaaaaaa')).status, 404);
  assert.equal((await client().get(`/partner/${token}`)).status, 200);
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM payments WHERE payer = 'تفعيل يدوي'")).n, 1);
});

test('تجربة الرسالة على جوال صاحب المحل بس، والرسائل لكل الزبائن بدون حد', async () => {
  const p = await platform();
  const { owner, device, to } = p;
  assert.equal((await owner.post('/api/broadcast/test', { body: 'خصم اليوم' })).status, 400, 'لازم يفعّل التنبيهات أول');
  const ownerDev = await device(owner, '/api/me/push', 'owner-bc');
  const sara = await p.customer('سارة', '0791110011');
  const custDev = await device(sara.guest, `/api/cards/${sara.token}/push`, 'sara-bc');
  const r = await owner.post('/api/broadcast/test', { header: 'عرض', body: 'خصم اليوم 20%' });
  assert.equal(r.data.sent, 1);
  assert.deepEqual(to(ownerDev).map((m) => m.body), ['خصم اليوم 20%']);
  assert.equal(to(custDev).length, 0, 'الزبائن ما وصلهم إشي');
  for (let i = 0; i < 5; i++) assert.equal((await owner.post('/api/broadcast', { body: `رسالة ${i}` })).status, 200);
  assert.equal(to(custDev).length, 5);
});

test('حساب العرض: دخول بكبسة، بيانات جاهزة، إجراءات ممنوعة، وبيرجع لحاله كل يوم', async () => {
  const p = await platform();
  const v = p.client();
  assert.equal((await v.post('/api/demo/login', {})).status, 200);
  const me = (await v.get('/api/me')).data;
  assert.equal(me.shop.name, 'كوفي العرض');
  assert.equal(me.subscription.state, 'owner', 'ما بيخلص');
  assert.ok(me.demo.sampleCard);
  assert.ok((await v.get('/api/members')).data.total >= 60);
  const rep = (await v.get('/api/reports')).data;
  assert.ok(rep.byHour.reduce((a, b) => a + b, 0) > 100);
  assert.ok(rep.ratings.total >= 10);
  assert.equal((await v.post('/api/staff', { name: 'x', email: 'real@person.com', password: 'secret-pass-1' })).status, 403);
  assert.equal((await v.put('/api/me/password', { current: 'x', next: 'secret-pass-2' })).status, 403);
  assert.equal((await v.put('/api/shop', { slug: 'mocha' })).data.shop.slug, 'demo-cafe', 'رابط العرض ما بيتغيّر');
  const bc = await v.post('/api/broadcast', { body: 'تجربة' });
  assert.equal(bc.data.demo, true, 'ما بتنبعت إشعارات حقيقية');
  // المدير ما بيشوف محل العرض بقائمة المحلات
  assert.ok(!(await p.admin.get('/api/admin/shops')).data.shops.some((s) => s.name === 'كوفي العرض'));
  // زائر تاني بيدخل نفس الحساب، والتعديلات بترجع بالليل
  await v.put('/api/shop', { name: 'اسم غريب' });
  const now = Date.now();
  const t = new Date(now + 864e5); // بكرة الساعة 5 الصبح بتوقيت عمّان
  const tomorrow5am = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), 2, 0);
  const r = await p.cron(tomorrow5am);
  assert.equal(r.demoReset, true);
  assert.equal((await p.cron(tomorrow5am + 3600e3)).demoReset, undefined, 'مرة باليوم');
  const v2 = p.client();
  await v2.post('/api/demo/login', {});
  assert.equal((await v2.get('/api/me')).data.shop.name, 'كوفي العرض');
  // كل الميزات معبّاية: شعار، منيو بالصور، كاشيرين، كوبونين، هدايا، دعوات، أعياد ميلاد، وزبائن غابوا
  assert.equal((await v2.get('/api/me')).data.shop.customLogo, true);
  const menu = (await p.client().get('/api/shops/demo-cafe/menu')).data.categories.flatMap((c) => c.items);
  assert.ok(menu.length >= 8 && menu.every((i) => i.image && i.description));
  const demoPdf = (await p.client().get('/api/shops/demo-cafe/menu')).data.pdf;
  const pdfFile = await p.client().get(demoPdf.url.replace(/^https?:\/\/[^/]+/, ''));
  assert.equal(pdfFile.status, 200);
  assert.equal(new TextDecoder().decode(pdfFile.data.subarray(0, 5)), '%PDF-');
  assert.equal(pdfFile.data.length, demoPdf.size);
  assert.equal((await v2.get('/api/staff')).data.users.filter((u) => u.role === 'staff').length, 2);
  assert.equal((await v2.get('/api/coupons')).data.coupons.length, 2);
  const count = async (sql) => (await p.db.get(sql)).n;
  assert.equal(await count("SELECT COUNT(*) AS n FROM credit_gifts g JOIN shops s ON s.id = g.shop_id WHERE s.demo = 1"), 2);
  assert.equal(await count("SELECT COUNT(*) AS n FROM txns t JOIN shops s ON s.id = t.shop_id WHERE s.demo = 1 AND t.note LIKE '👥%'"), 6);
  assert.ok(await count("SELECT COUNT(*) AS n FROM txns t JOIN shops s ON s.id = t.shop_id WHERE s.demo = 1 AND t.note LIKE '🎂%'") >= 1);
  assert.equal(await count('SELECT COUNT(*) AS n FROM members m JOIN shops s ON s.id = m.shop_id WHERE s.demo = 1 AND m.boost_until > ' + Date.now()), 3);
  // إشي جديد انضاف للعرض (رقم نسخة مختلف) ← بيتجدّد بأول تشغيلة بدون ما يستنى الصبح
  await p.db.run("UPDATE platform_settings SET v = '0' WHERE k = 'demo_version'");
  assert.equal((await p.cron(tomorrow5am + 2 * 3600e3)).demoReset, true);
  assert.equal((await p.cron(tomorrow5am + 3 * 3600e3)).demoReset, undefined);
});

test('خطوات البداية، تذكير نهاية التجربة، وأرقام المنصة للمدير', async () => {
  const p = await platform();
  const { owner, admin, device, to } = p;
  let ob = (await owner.get('/api/me')).data.onboarding;
  assert.deepEqual(ob.steps.map((x) => [x.key, x.done]), [['logo', false], ['branch', false], ['settings', false], ['poster', false], ['customer', false], ['alerts', false]]);
  await owner.put('/api/shop', { locations: [{ name: 'الفرع', lat: 31.95, lng: 35.91 }] });
  await owner.post('/api/shop/onboard', { step: 'poster' });
  await p.customer('سارة', '0791110012');
  ob = (await owner.get('/api/me')).data.onboarding;
  assert.deepEqual(ob.steps.filter((x) => x.done).map((x) => x.key), ['branch', 'settings', 'poster', 'customer']);
  await owner.post('/api/shop/onboard', { step: 'dismissed' });
  assert.equal((await owner.get('/api/me')).data.onboarding, null);
  assert.equal((await owner.post('/api/shop/onboard', { step: 'hack' })).status, 400);
  // تذكير قبل 3 أيام وقبل يوم من نهاية التجربة (للي مفعّل التنبيهات)
  const dev = await device(owner, '/api/me/push', 'owner-remind');
  // التجربة بتخلص بعد 3 أيام إلا ساعة من الظهر (بتوقيت عمّان)
  await p.db.run('UPDATE shops SET active_until = ? WHERE id = ?', amman(12, 3) - 3600e3, p.shop.id);
  let now = amman(12);
  assert.equal((await p.cron(now)).reminders, 1);
  assert.match(to(dev).at(-1).body, /تجربتك المجانية بنقاطك بتخلص بعد 3 أيام/);
  assert.equal((await p.cron(now + 3600e3)).reminders, 0, 'مرة وحدة');
  now = amman(12, 2);
  assert.equal((await p.cron(now)).reminders, 1);
  assert.match(to(dev).at(-1).body, /بتخلص بكرة/);
  // أرقام المنصة
  await admin.post(`/api/admin/shops/${p.shop.id}/plan`, { action: 'year' });
  const st = (await admin.get('/api/admin/stats')).data;
  assert.equal(st.revenueMonth, 150);
  assert.equal(st.counts.active, 1);
  assert.equal(st.mrr, 12.5);
  assert.equal((await owner.get('/api/admin/stats')).status, 403);
});

test('المنيو: المالك بيضيف ويعدّل ويخفي، والصفحة العامة بالأقسام والصور', async () => {
  const p = await platform();
  const { owner } = p;
  const png = 'data:image/png;base64,' + Buffer.from(await (await import('../src/png.js')).defaultLogoPng('#336699', 64)).toString('base64');
  assert.equal((await owner.post('/api/menu', { name: '' })).status, 400);
  assert.equal((await owner.post('/api/menu', { name: 'لاتيه', price: -1 })).status, 400);
  let r = await owner.post('/api/menu', { category: 'مشروبات ساخنة', name: 'لاتيه', price: '2.75', description: 'حليب طازة', image: png });
  assert.equal(r.status, 200);
  await owner.post('/api/menu', { category: 'حلويات', name: 'تشيز كيك', price: 3.5, sort: 1 });
  r = await owner.post('/api/menu', { category: 'مشروبات ساخنة', name: 'إسبريسو', price: 1.5, sort: 2 });
  const items = r.data.items;
  assert.equal(items.length, 3);
  assert.match(r.data.menuUrl, /\/m\/mocha$/);
  const latte = items.find((x) => x.name === 'لاتيه');
  assert.match(latte.image, /\/media\/menu\/\d+\.jpg\?v=\d+$/);
  const img = await p.client().get(new URL(latte.image).pathname);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  // إخفاء صنف خلص
  const esp = items.find((x) => x.name === 'إسبريسو');
  await owner.put(`/api/menu/${esp.id}`, { available: false });
  const pub = (await p.client().get(`/api/shops/${p.shop.slug}/menu`)).data;
  assert.deepEqual(pub.categories.map((cat) => [cat.name, cat.items.map((x) => x.name)]), [['مشروبات ساخنة', ['لاتيه']], ['حلويات', ['تشيز كيك']]]);
  assert.equal(pub.shop.name, 'Mocha');
  await owner.put(`/api/menu/${latte.id}`, { removeImage: true });
  assert.equal((await owner.get('/api/menu')).data.items.find((x) => x.id === latte.id).image, null);
  assert.equal((await owner.req('DELETE', `/api/menu/${esp.id}`)).status, 200);
  const st = await p.staffClient();
  assert.equal((await st.post('/api/menu', { name: 'x' })).status, 403);
  assert.equal((await p.client().get(`/m/${p.shop.slug}`)).status, 200);
});

test('استيراد الزبائن: أرقام بدون صفر، رصيد، أعياد ميلاد، وتخطّي المكرر والغلط', async () => {
  const p = await platform();
  const { owner } = p;
  await p.customer('موجود', '0791110013');
  const r = await owner.post('/api/members/import', { rows: [
    { line: 2, name: 'سارة أحمد', phone: '791234567', balance: '40', bdayDay: 5, bdayMonth: 3 },
    { line: 3, name: 'عمر', phone: '+962 79 555 1234', balance: 0 },
    { line: 4, name: 'مكرر', phone: '0791110013' },
    { line: 5, name: 'ب', phone: '0790000000' },
    { line: 6, name: 'رقم غلط', phone: '123' },
  ] });
  assert.equal(r.status, 200);
  assert.equal(r.data.added, 2);
  assert.deepEqual(r.data.skipped.map((x) => [x.line, x.reason]), [[4, 'الرقم مسجّل من قبل'], [5, 'الاسم ناقص'], [6, 'رقم الجوال مش صحيح']]);
  const sara = (await owner.get('/api/members?q=0791234567')).data.members[0];
  assert.equal(sara.balance, 40);
  assert.equal(sara.birthday, '03-05');
  assert.equal((await owner.get('/api/members?q=0795551234')).data.total, 1, '+962 صار 07');
  assert.equal((await owner.post('/api/members/import', { rows: [] })).status, 400);
  const st = await p.staffClient();
  assert.equal((await st.post('/api/members/import', { rows: [{ name: 'x', phone: '0790000001' }] })).status, 403);
});

test('إهداء الرصيد: بينخصم من المهدي، صاحبه بيستلمه مرة وحدة، وإذا ما استلمه بيرجع بعد 30 يوم', async () => {
  const p = await platform();
  const { owner, device, to } = p;
  const sara = await p.customer('سارة علي', '0791110014');
  const omar = await p.customer('عمر', '0791110015');
  assert.equal((await sara.guest.post(`/api/cards/${sara.token}/gift`, { amount: 5 })).status, 400, 'الرصيد مش مفعّل');
  await owner.put('/api/shop/perks', { creditOn: true, creditBonus: 0 });
  await owner.post(`/api/members/${sara.id}/credit/topup`, { amount: 10 });
  const dev = await device(sara.guest, `/api/cards/${sara.token}/push`, 'sara-gift');
  let r = await sara.guest.post(`/api/cards/${sara.token}/gift`, { amount: 20 });
  assert.equal(r.status, 409, 'أكتر من رصيدها');
  assert.equal((await sara.guest.post(`/api/cards/${sara.token}/gift`, { amount: 0.2 })).status, 400, 'أقل من نص دينار');
  r = await sara.guest.post(`/api/cards/${sara.token}/gift`, { amount: 4 });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.credit, 6);
  assert.match(r.data.url, /\/g\/[a-z2-9]{20}$/);
  const code = r.data.code;
  // صفحة الهدية
  const info = (await p.client().get(`/api/gifts/${code}`)).data;
  assert.deepEqual([info.amount, info.from, info.open, info.shop.slug], [4, 'سارة', true, p.shop.slug]);
  assert.equal((await p.client().get(`/g/${code}`)).status, 200);
  // ما بتستلم هديتها، ولا بطاقة من محل تاني
  assert.equal((await sara.guest.post(`/api/gifts/${code}/claim`, { token: sara.token })).status, 400);
  const other = p.client();
  const { shop: shop2 } = await signup(other, { shopName: 'Other' });
  const stranger = (await p.client().post(`/api/shops/${shop2.slug}/join`, { name: 'غريب', phone: '0791110016' })).data.token;
  assert.equal((await p.client().post(`/api/gifts/${code}/claim`, { token: stranger })).status, 400);
  // عمر بيستلم
  r = await omar.guest.post(`/api/gifts/${code}/claim`, { token: omar.token });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await omar.guest.get(`/api/cards/${omar.token}`)).data.member.credit, 4);
  await p.flushAll(omar.guest);
  assert.match(to(dev).at(-1).body, /عمر استلم هديتك \(4 JOD\)/);
  assert.equal((await omar.guest.post(`/api/gifts/${code}/claim`, { token: omar.token })).status, 409, 'مرة وحدة');
  assert.equal((await p.client().get(`/api/gifts/${code}`)).data.open, false);
  // الحركات والتقارير: الهدية مش شحن ولا دفع عند المحل
  const h = (await owner.get(`/api/members/${omar.id}/credit`)).data.history;
  assert.equal(h[0].note, '🎁 هدية من صاحب');
  assert.deepEqual((await owner.get('/api/reports')).data.credit, { outstanding: 10, topups: 10, spent: 0 });
  // هدية تانية ما حدا استلمها ← بترجع بعد 30 يوم
  const code2 = (await sara.guest.post(`/api/cards/${sara.token}/gift`, { amount: 2.5 })).data.code;
  assert.equal((await sara.guest.get(`/api/cards/${sara.token}`)).data.member.credit, 3.5);
  assert.equal((await p.cron(Date.now() + 29 * DAY)).giftsRefunded, 0);
  assert.equal((await p.cron(Date.now() + 31 * DAY)).giftsRefunded, 1);
  assert.equal((await p.cron(Date.now() + 32 * DAY)).giftsRefunded, 0, 'مرة وحدة');
  assert.equal((await sara.guest.get(`/api/cards/${sara.token}`)).data.member.credit, 6);
  assert.equal((await omar.guest.post(`/api/gifts/${code2}/claim`, { token: omar.token })).status, 409, 'رجعت، ما بتنستلم');
  // كود مش موجود
  assert.equal((await p.client().get('/api/gifts/aaaaaaaaaaaaaaaaaaaa')).status, 404);
});

test('طلبين بنفس الملّي ثانية: الهدية والكوبون ما بينحسبوا مرتين', async () => {
  const p = await platform();
  const { owner } = p;
  const sara = await p.customer('سارة', '0791110017');
  const omar = await p.customer('عمر', '0791110018');
  await owner.put('/api/shop/perks', { creditOn: true, creditBonus: 0 });
  await owner.post(`/api/members/${sara.id}/credit/topup`, { amount: 10 });
  const code = (await sara.guest.post(`/api/cards/${sara.token}/gift`, { amount: 4 })).data.code;
  const cp = (await owner.post('/api/coupons', { title: 'قهوة مجانية', segment: 'all', days: 3 })).data;
  const st = await p.staffClient();
  const realNow = Date.now;
  const frozen = realNow();
  Date.now = () => frozen; // كل الطلبات بنفس الملّي ثانية (متل كبسة مكررة)
  try {
    const claims = [];
    for (let i = 0; i < 3; i++) claims.push((await omar.guest.post(`/api/gifts/${code}/claim`, { token: omar.token })).status);
    assert.deepEqual(claims, [200, 409, 409]);
    const uses = [];
    for (let i = 0; i < 2; i++) uses.push((await st.post(`/api/members/${omar.id}/coupons/${cp.id}/use`, {})).status);
    assert.deepEqual(uses, [200, 409]);
  } finally {
    Date.now = realNow;
  }
  assert.equal((await omar.guest.get(`/api/cards/${omar.token}`)).data.member.credit, 4);
  assert.equal((await owner.get('/api/coupons')).data.coupons[0].used, 1);
  // هدية الدعوة: زيارتين بنفس الملّي ثانية ← الهدية مرة وحدة للاتنين
  const ref = new URL((await sara.guest.get(`/api/cards/${sara.token}`)).data.refUrl).searchParams.get('ref');
  const lina = await p.customer('لينا', '0791110019', { ref });
  const before = (await owner.get(`/api/members/${sara.id}`)).data.member.balance;
  Date.now = () => frozen + DAY;
  try {
    const earns = await Promise.all([0, 1].map((i) => owner.post(`/api/members/${lina.id}/earn`, { amount: 5, key: `same-ms-earn-${i}` })));
    assert.deepEqual(earns.map((r) => r.status), [200, 200]);
  } finally {
    Date.now = realNow;
  }
  const bonus = 10; // عُشر الـ 100 نقطة
  assert.equal((await owner.get(`/api/members/${lina.id}`)).data.member.balance, 10 + bonus);
  assert.equal((await owner.get(`/api/members/${sara.id}`)).data.member.balance, before + bonus);
});

test('المنيو PDF: بينرفع قطع، بينزل نفس الملف، بيتبدّل وبينشال، ومحمي', async () => {
  const p = await platform();
  const { owner } = p;
  const PART = 600 * 1024;
  const makePdf = (n, seed) => { const b = new Uint8Array(n); b.set(new TextEncoder().encode('%PDF-1.4\n')); for (let i = 9; i < n; i++) b[i] = (i * seed) & 255; return b; };
  const b64 = (u8) => Buffer.from(u8).toString('base64');
  const upload = async (bytes, client = owner) => {
    const parts = Math.ceil(bytes.length / PART);
    let ver;
    let r;
    for (let part = 0; part < parts; part++) {
      r = await client.post('/api/menu/pdf', { size: bytes.length, parts, part, ver, data: b64(bytes.subarray(part * PART, (part + 1) * PART)) });
      if (r.status !== 200) return r;
      ver = r.data.ver;
    }
    return r;
  };
  const pdf = makePdf(1_400_000, 7); // 3 قطع
  let r = await upload(pdf);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const url = r.data.pdf.url.replace(/^https?:\/\/[^/]+/, '');
  assert.equal(r.data.pdf.size, pdf.length);
  const dl = await p.client().get(url);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-type'), 'application/pdf');
  assert.deepEqual(Buffer.from(dl.data), Buffer.from(pdf), 'نفس الملف بالزبط');
  const pub = (await p.client().get(`/api/shops/${p.shop.slug}/menu`)).data;
  assert.equal(pub.pdf.url, r.data.pdf.url);
  assert.equal((await owner.get('/api/menu')).data.pdf.size, pdf.length);
  // تبديل: الرابط القديم بيبطّل، والقطع القديمة بتنمسح
  const pdf2 = makePdf(5000, 3);
  r = await upload(pdf2);
  assert.equal(r.status, 200);
  assert.equal((await p.client().get(url)).status, 404);
  assert.deepEqual(Buffer.from((await p.client().get(r.data.pdf.url.replace(/^https?:\/\/[^/]+/, ''))).data), Buffer.from(pdf2));
  assert.equal((await p.db.get('SELECT COUNT(*) AS n FROM menu_files')).n, 1);
  // مش PDF، أكبر من 6 ميغا، قطعة ناقصة
  assert.equal((await owner.post('/api/menu/pdf', { size: 5000, parts: 1, part: 0, data: b64(new Uint8Array(5000).fill(65)) })).status, 400);
  assert.equal((await owner.post('/api/menu/pdf', { size: 7 * 1024 * 1024, parts: 12, part: 0, data: b64(pdf.subarray(0, PART)) })).status, 400);
  const first = await owner.post('/api/menu/pdf', { size: pdf.length, parts: 3, part: 0, data: b64(pdf.subarray(0, PART)) });
  r = await owner.post('/api/menu/pdf', { size: pdf.length, parts: 3, part: 2, ver: first.data.ver, data: b64(pdf.subarray(2 * PART)) });
  assert.equal(r.status, 400, 'القطعة النص ناقصة');
  assert.equal((await owner.get('/api/menu')).data.pdf.size, pdf2.length, 'المنشور ما تغيّر');
  // الكاشير ما بيرفع، وحساب العرض ما بيرفع
  const st = await p.staffClient();
  assert.equal((await upload(pdf2, st)).status, 403);
  const demo = p.client();
  await demo.post('/api/demo/login', {});
  assert.equal((await upload(pdf2, demo)).status, 403);
  // الحذف
  assert.equal((await owner.del('/api/menu/pdf')).data.pdf, null);
  assert.equal((await p.client().get(`/api/shops/${p.shop.slug}/menu`)).data.pdf, null);
  assert.equal((await p.db.get('SELECT COUNT(*) AS n FROM menu_files WHERE shop_id = ?', p.shop.id)).n, 0);
});

test('مدير المنصة بيرتّب منيو أي محل: أصناف وPDF، والمالك العادي ما بيقدر', async () => {
  const p = await platform();
  const { admin, owner } = p;
  const sid = (await admin.get('/api/admin/shops')).data.shops.find((s) => s.slug === p.shop.slug).id;
  const base = `/api/admin/shops/${sid}/menu`;
  let r = await admin.post(base, { category: 'مشروبات', name: 'سنو وايت', price: 1.5, description: 'Snow White — صغير 1.50 · كبير 2.00' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.items[0].name, 'سنو وايت');
  const id = r.data.items[0].id;
  assert.equal((await admin.put(`${base}/${id}`, { price: 1.75 })).data.items[0].price, 1.75);
  const pdf = new TextEncoder().encode(`%PDF-1.4\n${'x'.repeat(2000)}`);
  r = await admin.post(`${base}/pdf`, { size: pdf.length, parts: 1, part: 0, data: Buffer.from(pdf).toString('base64') });
  assert.equal(r.status, 200);
  // المحل نفسه بيشوف اللي انضاف
  const mine = (await owner.get('/api/menu')).data;
  assert.equal(mine.items.length, 1);
  assert.equal(mine.pdf.size, pdf.length);
  assert.equal((await p.client().get(`/api/shops/${p.shop.slug}/menu`)).data.categories[0].items[0].price, 1.75);
  // صاحب محل عادي ما بيقدر يرتّب منيو محل تاني، ومحل مش موجود
  const adminShopId = (await admin.get('/api/admin/shops')).data.shops.find((s) => s.slug !== p.shop.slug).id;
  assert.equal((await owner.post(`/api/admin/shops/${adminShopId}/menu`, { name: 'x' })).status, 403);
  assert.equal((await admin.get('/api/admin/shops/99999/menu')).status, 404);
  assert.equal((await admin.del(`${base}/${id}`)).data.items.length, 0);
  assert.equal((await admin.del(`${base}/pdf`)).data.pdf, null);
});
