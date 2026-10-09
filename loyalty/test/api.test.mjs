import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signup } from './helpers.mjs';

test('تسجيل محل جديد: الرابط من الاسم الإنجليزي، والإعدادات الافتراضية', async () => {
  const { client } = await setup();
  const c = client();
  const { shop } = await signup(c);
  assert.equal(shop.slug, 'mocha-coffee-house');
  assert.equal(shop.programType, 'points');
  assert.equal(shop.welcomeText, 'Mocha Coffee House ترحب بكم');
  assert.equal(shop.joinUrl, 'https://loyalty.test/j/mocha-coffee-house');
  // نفس الاسم مرة تانية بياخد رابط مختلف، والاسم العربي بياخد shop
  const c2 = client();
  assert.match((await signup(c2)).shop.slug, /^mocha-coffee-house-\d{4}$/);
  assert.equal((await signup(client(), { shopName: 'موكا كوفي' })).shop.slug, 'shop');
  // الإيميل مكرر
  const dup = await client().post('/api/auth/signup', { shopName: 'X Shop', email: (await c.get('/api/me')).data.user.email, password: 'another-pass' });
  assert.equal(dup.status, 409);
  // كلمة سر قصيرة
  assert.equal((await client().post('/api/auth/signup', { shopName: 'Y Shop', email: 'y@test.com', password: '123' })).status, 400);
});

test('رمز التسجيل لما يكون مفعّل', async () => {
  const { client } = await setup({ SIGNUP_CODE: 'OPEN-SESAME' });
  const r = await client().post('/api/auth/signup', { shopName: 'Shop A', email: 'a@test.com', password: 'secret-pass-1' });
  assert.equal(r.status, 403);
  const ok = await client().post('/api/auth/signup', { shopName: 'Shop A', email: 'a@test.com', password: 'secret-pass-1', code: 'OPEN-SESAME' });
  assert.equal(ok.status, 201);
});

test('الزبون بينضم من صفحة المحل وبياخد بطاقة، والرقم ما بيتكرر', async () => {
  const { client } = await setup();
  const owner = client();
  const { shop } = await signup(owner);
  const guest = client();
  const pub = await guest.get(`/api/shops/${shop.slug}/public`);
  assert.equal(pub.status, 200);
  assert.equal(pub.data.shop.name, 'Mocha Coffee House');
  assert.equal(pub.data.shop.id, undefined);

  const j = await guest.post(`/api/shops/${shop.slug}/join`, { name: 'أحمد', phone: '+962 79 123 4567' });
  assert.equal(j.status, 201);
  assert.match(j.data.token, /^[a-z2-9]{20}$/);
  assert.equal(j.data.url, `https://loyalty.test/c/${j.data.token}`);

  // نفس الرقم بصيغة تانية → مرفوض بدون ما نكشف البطاقة
  const again = await guest.post(`/api/shops/${shop.slug}/join`, { name: 'حدا تاني', phone: '00962791234567' });
  assert.equal(again.status, 409);
  assert.equal(again.data.token, undefined);

  const card = await guest.get(`/api/cards/${j.data.token}`);
  assert.equal(card.status, 200);
  assert.equal(card.data.member.name, 'أحمد');
  assert.match(card.data.member.cardNo, /^\d{8}$/);
  assert.equal(card.data.member.phone, undefined, 'صفحة البطاقة ما بتكشف الجوال');
  assert.equal(card.data.member.id, undefined);
  assert.equal(card.data.google, false);

  assert.equal((await guest.post(`/api/shops/${shop.slug}/join`, { name: 'ب', phone: '0791111111' })).status, 400);
  assert.equal((await guest.post(`/api/shops/${shop.slug}/join`, { name: 'بوت', phone: '0791111111', website: 'x' })).status, 400);
  assert.equal((await guest.post('/api/shops/no-such-shop/join', { name: 'سارة', phone: '0791111111' })).status, 404);
});

test('النقاط: إضافة، منع التكرار، واستبدال المكافأة مرة وحدة بس', async () => {
  const { client } = await setup();
  const c = client();
  const { shop } = await signup(c);
  const add = await c.post('/api/members', { name: 'سارة', phone: '0790000001' });
  assert.equal(add.status, 201);
  const id = add.data.member.id;

  let r = await c.post(`/api/members/${id}/earn`, { amount: 12.5, key: 'k-earn-0001' });
  assert.equal(r.status, 200);
  assert.equal(r.data.delta, 12);
  assert.equal(r.data.member.balance, 12);
  assert.equal(r.data.member.visits, 1);

  // نفس المفتاح (نت ضعيف وانبعت مرتين) → ما بتنحسب مرتين
  r = await c.post(`/api/members/${id}/earn`, { amount: 12.5, key: 'k-earn-0001' });
  assert.equal(r.data.duplicate, true);
  assert.equal(r.data.member.balance, 12);

  r = await c.post(`/api/members/${id}/redeem`, { key: 'k-redeem-01' });
  assert.equal(r.status, 409, 'الرصيد مش كافي');

  r = await c.post(`/api/members/${id}/earn`, { amount: 95, key: 'k-earn-0002' });
  assert.equal(r.data.member.balance, 107);
  assert.equal(r.data.member.progress.available, 1);

  r = await c.post(`/api/members/${id}/redeem`, { key: 'k-redeem-02' });
  assert.equal(r.status, 200);
  assert.equal(r.data.member.balance, 7);
  assert.equal(r.data.member.redeemed, 1);
  r = await c.post(`/api/members/${id}/redeem`, { key: 'k-redeem-02' });
  assert.equal(r.data.duplicate, true);
  assert.equal(r.data.member.balance, 7);
  assert.equal((await c.post(`/api/members/${id}/redeem`, { key: 'k-redeem-03' })).status, 409);

  // تعديل يدوي للمالك، وما بيصير الرصيد بالسالب
  assert.equal((await c.post(`/api/members/${id}/adjust`, { delta: -50, note: 'غلط' })).status, 409);
  assert.equal((await c.post(`/api/members/${id}/adjust`, { delta: 5 })).status, 400, 'السبب مطلوب');
  r = await c.post(`/api/members/${id}/adjust`, { delta: 3, note: 'تعويض' });
  assert.equal(r.data.member.balance, 10);

  const detail = await c.get(`/api/members/${id}`);
  assert.deepEqual(detail.data.txns.map((t) => [t.kind, t.delta]), [['adjust', 3], ['redeem', -100], ['earn', 95], ['earn', 12]]);
  assert.equal(detail.data.txns[0].by, 'Mocha Coffee House');

  const act = await c.get(`/api/activity?dayStart=${Date.now() - 1000}`);
  assert.equal(act.data.stats.members, 1);
  assert.equal(act.data.stats.visitsDay, 2);
  assert.equal(act.data.stats.earnedMonth, 107);
  assert.equal(act.data.stats.redeemedMonth, 1);
  assert.equal(act.data.recent.length, 4);
  assert.equal(shop.programType, 'points');
});

test('برنامج الأختام، وما بيتغيّر النوع بعد أول حركة', async () => {
  const { client } = await setup();
  const c = client();
  await signup(c);
  let r = await c.put('/api/shop', { programType: 'stamps', stampsRequired: 5, rewardName: 'قهوة مجانية' });
  assert.equal(r.status, 200);
  assert.equal(r.data.shop.rule, 'اجمع 5 أختام واحصل على قهوة مجانية');
  const id = (await c.post('/api/members', { name: 'ليلى', phone: '0790000002' })).data.member.id;
  r = await c.post(`/api/members/${id}/earn`, { count: 2 });
  assert.equal(r.data.member.balance, 2);
  assert.equal(r.data.member.stamps, '●●○○○');
  r = await c.post(`/api/members/${id}/earn`, {});
  r = await c.post(`/api/members/${id}/earn`, { count: 2 });
  assert.equal(r.data.member.progress.available, 1);
  r = await c.post(`/api/members/${id}/redeem`, {});
  assert.equal(r.data.member.balance, 0);
  assert.equal((await c.put('/api/shop', { programType: 'points' })).status, 409);
});

test('كل محل معزول عن التاني', async () => {
  const { client } = await setup();
  const a = client();
  const b = client();
  const shopA = (await signup(a)).shop;
  await signup(b, { shopName: 'Burger Place' });
  const join = await client().post(`/api/shops/${shopA.slug}/join`, { name: 'زبون أ', phone: '0790000003' });
  const memberA = (await a.get(`/api/members/lookup?code=${join.data.token}`)).data.member;

  assert.equal((await b.get(`/api/members/lookup?code=${join.data.token}`)).status, 404);
  assert.equal((await b.get(`/api/members/lookup?code=${memberA.cardNo}`)).status, 404);
  assert.equal((await b.get(`/api/members/${memberA.id}`)).status, 404);
  assert.equal((await b.post(`/api/members/${memberA.id}/earn`, { amount: 50 })).status, 404);
  assert.equal((await b.post(`/api/members/${memberA.id}/redeem`, {})).status, 404);
  assert.equal((await b.get('/api/members')).data.total, 0);
  // نفس رقم الجوال مسموح بمحل تاني
  assert.equal((await b.post('/api/members', { name: 'زبون أ', phone: '0790000003' })).status, 201);
});

test('البحث عن بطاقة: QR أو رابط البطاقة أو رقمها أو الجوال', async () => {
  const { client } = await setup();
  const c = client();
  await signup(c);
  const m = (await c.post('/api/members', { name: 'خالد الأحمد', phone: '0795555555' })).data.member;
  for (const code of [m.token, m.token.toUpperCase(), `https://loyalty.test/c/${m.token}`, m.cardNo, '079 555 5555']) {
    const r = await c.get(`/api/members/lookup?code=${encodeURIComponent(code)}`);
    assert.equal(r.status, 200, code);
    assert.equal(r.data.member.id, m.id);
  }
  assert.equal((await c.get('/api/members/lookup?code=nothing')).status, 404);
  assert.equal((await c.get('/api/members?q=الأحمد')).data.total, 1);
  assert.equal((await c.get('/api/members?q=5555')).data.total, 1);
  assert.equal((await c.get('/api/members?q=%25')).data.total, 0, '% بتنعامل كحرف عادي');
  const dup = await c.post('/api/members', { name: 'مكرر', phone: '0795555555' });
  assert.equal(dup.status, 409);
  assert.equal(dup.data.memberId, m.id);
});

test('الصلاحيات: الموظف بيسجّل نقاط بس ما بيغيّر الإعدادات', async () => {
  const { client } = await setup();
  const owner = client();
  await signup(owner);
  let r = await owner.post('/api/staff', { name: 'كاشير', email: 'cashier@test.com', password: 'cashier-pass' });
  assert.equal(r.status, 200);
  assert.equal(r.data.users.length, 2);

  const staff = client();
  assert.equal((await staff.get('/api/me')).status, 401);
  assert.equal((await staff.post('/api/auth/login', { email: 'CASHIER@test.com', password: 'cashier-pass' })).status, 200);
  assert.equal((await staff.get('/api/me')).data.user.role, 'staff');
  assert.equal((await staff.post('/api/members', { name: 'زبون', phone: '0790000004' })).status, 403, 'الموظف ما بيكتب رقم الزبون');
  const id = (await owner.post('/api/members', { name: 'زبون', phone: '0790000004' })).data.member.id;
  assert.equal((await staff.post(`/api/members/${id}/earn`, { amount: 10 })).status, 200);
  assert.equal((await staff.put('/api/shop', { name: 'اسم جديد' })).status, 403);
  assert.equal((await staff.post(`/api/members/${id}/adjust`, { delta: 100, note: 'هدية' })).status, 403);
  assert.equal((await staff.get('/api/staff')).status, 403);

  // الموظف ما بيشوف رقم الزبون: آخر 3 أرقام بس، والمالك بيشوفه كامل
  const other = (await owner.post('/api/members', { name: 'سلمى', phone: '0791234567' })).data.member;
  const masked = (await staff.get(`/api/members/${other.id}`)).data.member;
  assert.equal(masked.phone, '••••567');
  assert.equal(masked.phoneHidden, true);
  assert.ok((await staff.get('/api/members')).data.members.every((m) => m.phoneHidden && !/\d{4}/.test(m.phone)), 'القائمة بدون أرقام');
  assert.equal((await staff.get(`/api/members/lookup?code=0791234567`)).data.member.phone, '••••567', 'بيلاقيه برقمه بس ما بيشوفه');
  assert.equal((await staff.post(`/api/members/${other.id}/earn`, { amount: 1 })).data.member.phone, '••••567');
  assert.equal((await owner.get(`/api/members/${other.id}`)).data.member.phone, '0791234567');
  // البحث بجزء من الرقم ممنوع للموظف (عشان ما يطلّع أرقام الناس رقم رقم)، وبالرقم الكامل مسموح
  assert.equal((await staff.get('/api/members?q=07912')).data.total, 0);
  assert.equal((await staff.get('/api/members?q=0791234567')).data.total, 1);
  assert.equal((await owner.get('/api/members?q=07912')).data.total, 1);


  // المالك بيحذف الموظف وجلسته بتنتهي
  const staffId = r.data.users.find((u) => u.role === 'staff').id;
  assert.equal((await owner.del(`/api/staff/${staffId}`)).status, 200);
  assert.equal((await staff.get('/api/me')).status, 401);
  // المالك ما بينحذف
  const ownerId = r.data.users.find((u) => u.role === 'owner').id;
  assert.equal((await owner.del(`/api/staff/${ownerId}`)).status, 404);

  await owner.post('/api/auth/logout', {});
  assert.equal((await owner.get('/api/me')).status, 401);
});

test('الحماية: JSON بس، ومن نفس الموقع، وقفل بعد محاولات كتير', async () => {
  const { client } = await setup();
  const c = client();
  const { email } = await signup(c);
  const id = (await c.post('/api/members', { name: 'زبون', phone: '0790000005' })).data.member.id;
  // فورم من موقع غريب (بدون JSON)
  let r = await c.req('POST', `/api/members/${id}/earn`, 'amount=1000', { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(r.status, 415);
  r = await c.req('POST', `/api/members/${id}/earn`, { amount: 1000 }, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  r = await c.req('POST', `/api/members/${id}/earn`, { amount: 10 }, { origin: 'https://loyalty.test' });
  assert.equal(r.status, 200);

  const x = client();
  for (let i = 0; i < 8; i++) assert.equal((await x.post('/api/auth/login', { email, password: 'wrong-password' })).status, 401);
  assert.equal((await x.post('/api/auth/login', { email, password: 'secret-pass-1' })).status, 429, 'مقفول مؤقتاً حتى بكلمة السر الصح');
  assert.equal((await x.post('/api/auth/login', { email: 'nobody@test.com', password: 'whatever-1' })).status, 401);
});

test('الإعدادات: الفروع والتحقق من القيم', async () => {
  const { client } = await setup();
  const c = client();
  const { shop } = await signup(c);
  let r = await c.put('/api/shop', { locations: [{ name: 'عبدون', lat: 31.9539123, lng: 35.9106456 }, { lat: '31.98', lng: '35.87' }] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.shop.locations.map(({ id, ...l }) => l), [{ name: 'عبدون', lat: 31.953912, lng: 35.910646 }, { name: 'فرع 2', lat: 31.98, lng: 35.87 }]);
  // كل فرع إله رقم ثابت، وما بيتغيّر لما نعيد الحفظ
  const ids = r.data.shop.locations.map((l) => l.id);
  assert.ok(ids.every((id) => /^b[a-z0-9]{6}$/.test(id)) && ids[0] !== ids[1]);
  assert.deepEqual((await c.put('/api/shop', { locations: r.data.shop.locations })).data.shop.locations.map((l) => l.id), ids);
  assert.equal(r.data.google.enabled, false);
  assert.equal((await c.put('/api/shop', { locations: [{ lat: 95, lng: 10 }] })).status, 400);
  assert.equal((await c.put('/api/shop', { locations: Array(11).fill({ lat: 1, lng: 1 }) })).status, 400);
  assert.equal((await c.put('/api/shop', { color: 'red' })).status, 400);
  assert.equal((await c.put('/api/shop', { slug: 'Bad Slug' })).status, 400);
  r = await c.put('/api/shop', { slug: 'mocha', country: 'SA' });
  assert.equal(r.data.shop.slug, 'mocha');
  assert.equal(r.data.shop.currency, 'SAR');
  assert.equal(r.data.shop.joinUrl, 'https://loyalty.test/j/mocha');
  const other = client();
  await signup(other, { shopName: 'Other Shop' });
  assert.equal((await other.put('/api/shop', { slug: 'mocha' })).status, 409);
  assert.equal(shop.id > 0, true);
});

test('الشعار: افتراضي بلون المحل، ورفع صورة مع التحقق', async () => {
  const { client } = await setup();
  const c = client();
  const { shop } = await signup(c);
  let r = await client().get(`/media/logo/${shop.id}.png`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.deepEqual([...r.data.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);

  const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  r = await c.put('/api/shop/logo', { dataUrl: `data:image/png;base64,${png1x1}` });
  assert.equal(r.status, 200);
  assert.equal(r.data.shop.customLogo, true);
  assert.match(r.data.shop.logo, /\?v=1$/);
  assert.equal((await c.put('/api/shop/logo', { dataUrl: `data:image/jpeg;base64,${png1x1}` })).status, 400, 'النوع لازم يطابق المحتوى');
  assert.equal((await c.put('/api/shop/logo', { dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' })).status, 400);
  r = await c.put('/api/shop/logo', { remove: true });
  assert.equal(r.data.shop.customLogo, false);
  assert.equal((await client().get('/media/logo/999.png')).status, 404);
});

test('الصفحات والروابط', async () => {
  const { client } = await setup();
  const c = client();
  await signup(c);
  const m = (await c.post('/api/members', { name: 'زبون', phone: '0790000006' })).data.member;
  const page = async (p) => { const r = await c.get(p); return [r.status, typeof r.data === 'string' ? r.data : '']; };
  assert.deepEqual(await page('/'), [200, '<html>/index.html</html>']);
  assert.deepEqual(await page('/app'), [200, '<html>/app.html</html>']);
  assert.deepEqual(await page('/j/mocha-coffee-house'), [200, '<html>/join.html</html>']);
  assert.deepEqual(await page(`/c/${m.token}`), [200, '<html>/card.html</html>']);
  assert.equal((await c.get('/app.html')).status, 404);
  assert.equal((await c.get('/nothing')).status, 404);
  assert.match((await c.get('/')).headers.get('content-security-policy'), /frame-ancestors 'none'/);
  // بدون إعداد Google: زر المحفظة بيرجع للبطاقة
  const g = await c.get(`/c/${m.token}/google`);
  assert.equal(g.status, 302);
  assert.equal(g.headers.get('location'), `/c/${m.token}?gw=off`);
  assert.equal((await c.get('/api/nothing')).status, 404);
});

test('حد الطلبات: الانضمام والتسجيل من نفس الشبكة', async () => {
  const { client } = await setup();
  const { shop } = await signup(client());
  const sameWifi = client('203.0.113.7');
  for (let i = 0; i < 20; i++) {
    const r = await sameWifi.post(`/api/shops/${shop.slug}/join`, { name: `زبون ${i}`, phone: `07900100${String(i).padStart(2, '0')}` });
    assert.equal(r.status, 201, `join ${i}`);
  }
  const blocked = await sameWifi.post(`/api/shops/${shop.slug}/join`, { name: 'زبون 21', phone: '0790010099' });
  assert.equal(blocked.status, 429);
  assert.equal((await client('198.51.100.1').post(`/api/shops/${shop.slug}/join`, { name: 'زبون تاني', phone: '0790010098' })).status, 201);

  const net = '192.0.2.50';
  for (let i = 0; i < 5; i++) assert.equal((await client(net).post('/api/auth/signup', { shopName: `Shop ${i}`, email: `s${i}@rl.test`, password: 'secret-pass-1' })).status, 201);
  assert.equal((await client(net).post('/api/auth/signup', { shopName: 'Shop 6', email: 's6@rl.test', password: 'secret-pass-1' })).status, 429);
});

test('حذف البيانات: الزبون من صفحة بطاقته، والمالك من اللوحة', async () => {
  const { client } = await setup();
  const owner = client();
  const { shop } = await signup(owner);
  const guest = client();
  const j = await guest.post(`/api/shops/${shop.slug}/join`, { name: 'سلمى', phone: '0791112222' });
  const m = (await owner.get(`/api/members/lookup?code=${j.data.token}`)).data.member;
  await owner.post(`/api/members/${m.id}/earn`, { amount: 30 });

  assert.equal((await guest.post(`/api/cards/${j.data.token}/delete`, {})).status, 400, 'بدون رقم الجوال');
  assert.equal((await guest.post(`/api/cards/${j.data.token}/delete`, { phone: '0791119999' })).status, 403, 'رقم غلط (متل كاشير معه الـ QR بس)');
  assert.equal((await guest.post(`/api/cards/${j.data.token}/delete`, { phone: '+962 79 111 2222' })).status, 200);
  assert.equal((await guest.get(`/api/cards/${j.data.token}`)).status, 404);
  assert.equal((await owner.get('/api/members')).data.total, 0);
  assert.equal((await owner.get('/api/activity')).data.recent.length, 0, 'السجل انمسح كمان');
  assert.equal((await guest.post(`/api/cards/${j.data.token}/delete`, { phone: '0791112222' })).status, 404);
  // نفس الرقم بيقدر ينضم من جديد بعد الحذف
  assert.equal((await guest.post(`/api/shops/${shop.slug}/join`, { name: 'سلمى', phone: '0791112222' })).status, 201);

  const id = (await owner.get('/api/members')).data.members[0].id;
  await owner.post('/api/staff', { name: 'كاشير', email: 'del-cashier@test.com', password: 'cashier-pass' });
  const staff = client();
  await staff.post('/api/auth/login', { email: 'del-cashier@test.com', password: 'cashier-pass' });
  assert.equal((await staff.del(`/api/members/${id}`)).status, 403, 'الكاشير ما بيحذف');
  assert.equal((await owner.del(`/api/members/${id}`)).status, 200);
  assert.equal((await owner.get(`/api/members/${id}`)).status, 404);
});

test('صفحة الخصوصية وإيميل التواصل', async () => {
  const { client } = await setup({ CONTACT_EMAIL: 'privacy@example.com' });
  const c = client();
  const r = await c.get('/privacy');
  assert.equal(r.status, 200);
  assert.equal(r.data, '<html>/privacy.html</html>');
  const { PLANS } = await import('../src/app.js');
  const { PLAN_DEFAULTS, FEATURES } = await import('../public/js/plans.js');
  assert.deepEqual(PLAN_DEFAULTS, PLANS, 'أسعار صفحة البيع نفس أسعار السيرفر');
  assert.equal(FEATURES.length, 16);
  assert.deepEqual((await c.get('/api/site')).data, { contactEmail: 'privacy@example.com', whatsapp: null, signupOpen: true, apple: false, plans: PLANS, promo: { pct: 30, months: 3, total: 20, left: 20 }, testimonials: [], sales: false });
  const { client: client2 } = await setup({ WHATSAPP_NUMBER: '962798900911', SIGNUP_CODE: 'x', PROMO_TOTAL: '0' });
  assert.deepEqual((await client2().get('/api/site')).data, { contactEmail: null, whatsapp: '962798900911', signupOpen: false, apple: false, plans: PLANS, promo: null, testimonials: [], sales: false });
});

test('طلبات الاشتراك: من صفحة البيع، وبيشوفها مدير المنصة بس', async () => {
  const { client } = await setup();
  const platform = client();
  await signup(platform, { shopName: 'Platform Owner' }); // أول حساب = مدير المنصة
  const shopOwner = client();
  await signup(shopOwner, { shopName: 'Another Shop' });

  assert.equal((await platform.get('/api/me')).data.user.isAdmin, true);
  assert.equal((await shopOwner.get('/api/me')).data.user.isAdmin, false);

  const visitor = client();
  let r = await visitor.post('/api/leads', { shopName: 'كافيه الورد', name: 'ليث', phone: '0795551234', city: 'عمّان', kind: 'كوفي شوب', note: 'عندي فرعين' });
  assert.equal(r.status, 201);
  assert.equal((await visitor.post('/api/leads', { shopName: 'x', name: 'ليث', phone: '0795551234' })).status, 400, 'اسم المحل قصير');
  assert.equal((await visitor.post('/api/leads', { shopName: 'بوت', name: 'بوت', phone: '0795551234', website: 'spam' })).status, 400);
  for (let i = 0; i < 4; i++) await visitor.post('/api/leads', { shopName: `محل ${i}`, name: 'سبام', phone: '0795551234' });
  assert.equal((await visitor.post('/api/leads', { shopName: 'محل زيادة', name: 'سبام', phone: '0795551234' })).status, 429);

  assert.equal((await visitor.get('/api/admin/leads')).status, 401);
  assert.equal((await shopOwner.get('/api/admin/leads')).status, 403, 'صاحب محل عادي ما بيشوف الطلبات');
  assert.equal((await shopOwner.get('/api/admin/shops')).status, 403);

  r = await platform.get('/api/admin/leads');
  assert.equal(r.status, 200);
  assert.equal(r.data.leads.length, 4, '5 محاولات بالساعة (حتى الغلط منها بينحسب)');
  const lead = r.data.leads.find((l) => l.shopName === 'كافيه الورد');
  assert.deepEqual([lead.name, lead.phone, lead.city, lead.kind, lead.note, lead.status], ['ليث', '0795551234', 'عمّان', 'كوفي شوب', 'عندي فرعين', 'new']);
  r = await platform.put(`/api/admin/leads/${lead.id}`, { status: 'contacted' });
  assert.equal(r.data.leads.find((l) => l.id === lead.id).status, 'contacted');
  assert.equal((await platform.put(`/api/admin/leads/${lead.id}`, { status: 'weird' })).status, 400);

  r = await platform.get('/api/admin/shops');
  assert.equal(r.data.shops.length, 2);
  assert.equal(r.data.signupOpen, true);
  assert.ok(r.data.shops.every((s) => s.ownerEmail && typeof s.members === 'number'));
});

test('التجربة 14 يوم: بعدها المحل بيتوقف لحد ما مدير المنصة يفعّله', async () => {
  const { db, client } = await setup();
  const platform = client();
  const { shop: platformShop } = await signup(platform, { shopName: 'Platform' });
  const owner = client();
  const { shop } = await signup(owner, { shopName: 'Trial Cafe' });

  assert.equal((await platform.get('/api/me')).data.subscription.state, 'owner');
  let me = (await owner.get('/api/me')).data;
  assert.equal(me.subscription.state, 'trial');
  assert.equal(me.subscription.daysLeft, 14);

  const id = (await owner.post('/api/members', { name: 'زبون', phone: '0790000007' })).data.member.id;
  const token = (await owner.get(`/api/members/${id}`)).data.member.token;
  assert.equal((await owner.post(`/api/members/${id}/earn`, { amount: 10 })).status, 200);

  // خلصت التجربة
  await db.run('UPDATE shops SET active_until = ? WHERE id = ?', Date.now() - 1000, shop.id);
  me = (await owner.get('/api/me')).data;
  assert.equal(me.subscription.state, 'expired');
  assert.equal((await owner.post(`/api/members/${id}/earn`, { amount: 10 })).status, 402);
  assert.equal((await owner.post(`/api/members/${id}/redeem`, {})).status, 402);
  assert.equal((await owner.post(`/api/members/${id}/adjust`, { delta: 5, note: 'هدية' })).status, 402);
  assert.equal((await owner.post('/api/members', { name: 'جديد', phone: '0790000008' })).status, 402);
  const guest = client();
  assert.equal((await guest.post(`/api/shops/${shop.slug}/join`, { name: 'زبون', phone: '0790000009' })).status, 403);
  assert.equal((await guest.get(`/api/shops/${shop.slug}/public`)).data.shop.paused, true);
  // البيانات ضلت: الزبون بيشوف بطاقته، والمالك بيشوف زبائنه وبيقدر يحذف ويعدّل الإعدادات
  assert.equal((await guest.get(`/api/cards/${token}`)).data.member.balance, 10);
  assert.equal((await owner.get('/api/members')).data.total, 1);
  assert.equal((await owner.put('/api/shop', { rewardName: 'كيكة' })).status, 200);

  // صاحب محل عادي ما بيفعّل حاله
  assert.equal((await owner.post(`/api/admin/shops/${shop.id}/plan`, { action: 'year' })).status, 403);
  // مدير المنصة بيفعّل شهر
  let r = await platform.post(`/api/admin/shops/${shop.id}/plan`, { action: 'month' });
  assert.equal(r.status, 200);
  const sub = r.data.shops.find((s) => s.id === shop.id).subscription;
  assert.equal(sub.state, 'active');
  assert.ok(sub.daysLeft >= 28 && sub.daysLeft <= 31, String(sub.daysLeft));
  assert.equal((await owner.post(`/api/members/${id}/earn`, { amount: 10 })).status, 200);
  assert.equal((await guest.get(`/api/shops/${shop.slug}/public`)).data.shop.paused, false);
  // + سنة بتنضاف فوق الشهر
  r = await platform.post(`/api/admin/shops/${shop.id}/plan`, { action: 'year' });
  assert.ok(r.data.shops.find((s) => s.id === shop.id).subscription.daysLeft > 390);
  // إيقاف
  r = await platform.post(`/api/admin/shops/${shop.id}/plan`, { action: 'stop' });
  assert.equal(r.data.shops.find((s) => s.id === shop.id).subscription.state, 'expired');
  assert.equal((await platform.post(`/api/admin/shops/${shop.id}/plan`, { action: 'free' })).status, 400);

  // محل المنصة ما بيخلص أبداً
  await db.run('UPDATE shops SET active_until = ? WHERE id = ?', Date.now() - 1000, platformShop.id);
  const pid = (await platform.post('/api/members', { name: 'زبون', phone: '0790000010' })).data.member.id;
  assert.equal((await platform.post(`/api/members/${pid}/earn`, { amount: 5 })).status, 200);
});

test('ترحيل الجداول: الأعمدة الجديدة بتنضاف لقاعدة قديمة، والتشغيل مرتين ما بيكسر', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { sqlite } = await import('../src/db.js');
  const { SCHEMA, MIGRATIONS } = await import('../src/schema.js');
  const raw = new DatabaseSync(':memory:');
  // جدول المحلات بشكله القديم (قبل الاشتراكات)
  raw.exec("CREATE TABLE shops (id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at INTEGER NOT NULL)");
  raw.exec("INSERT INTO shops (slug, name, created_at) VALUES ('old', 'Old', 1)");
  const db = sqlite(raw);
  await db.init(SCHEMA, MIGRATIONS);
  await db.init(SCHEMA, MIGRATIONS);
  const row = await db.get("SELECT active_until, paid FROM shops WHERE slug = 'old'");
  assert.deepEqual(row, { active_until: null, paid: 0 });
});

test('الدفع بـ CliQ: المحل بيبلّغ عن الحوالة، ومدير المنصة بيأكد فبيتمدد الاشتراك', async () => {
  const { client, db } = await setup({ PROMO_TOTAL: '0' }); // بالسعر الكامل (عرض أول المحلات إله اختبار لحاله)
  const admin = client();
  await signup(admin, { shopName: 'Platform' });
  const owner = client();
  const { shop } = await signup(owner, { shopName: 'Cafe' });
  // قبل ما يحط مدير المنصة الـ Alias
  assert.equal((await owner.get('/api/billing')).data.cliq, null);
  assert.equal((await owner.post('/api/billing/claim', { plan: 'month', payer: 'أحمد' })).status, 400);
  assert.equal((await owner.put('/api/admin/settings', { cliqAlias: 'NUQATAK' })).status, 403, 'بس مدير المنصة');
  assert.equal((await admin.put('/api/admin/settings', { cliqAlias: 'bad<alias>' })).status, 400);
  assert.equal((await admin.put('/api/admin/settings', { cliqAlias: 'NUQATAK', cliqName: 'نقاطك', cliqBank: 'البنك العربي' })).status, 200);
  let b = (await owner.get('/api/billing')).data;
  assert.deepEqual(b.cliq, { alias: 'NUQATAK', name: 'نقاطك', bank: 'البنك العربي' });
  assert.deepEqual(b.plans, { basic: { name: 'أساسي', month: 12, year: 120 }, pro: { name: 'مميز', month: 25, year: 250 } });
  assert.equal(b.plan.tier, 'pro', 'التجربة على المميز');
  assert.equal((await owner.post('/api/billing/claim', { plan: 'week', payer: 'أحمد' })).status, 400);
  assert.equal((await owner.post('/api/billing/claim', { plan: 'year', payer: '' })).status, 400);
  b = (await owner.post('/api/billing/claim', { plan: 'year', payer: 'أحمد محمد', ref: 'TX123' })).data;
  assert.equal(b.payments[0].status, 'pending');
  assert.equal(b.payments[0].amount, 250, 'المميز بالسنة (الافتراضي)');
  assert.equal(b.payments[0].tier, 'pro');
  const before = (await db.get('SELECT active_until FROM shops WHERE id = ?', shop.id)).active_until;
  const list = (await admin.get('/api/admin/payments')).data.payments;
  assert.equal(list[0].shopName, 'Cafe');
  assert.equal((await owner.post(`/api/admin/payments/${list[0].id}`, { action: 'approve' })).status, 403);
  assert.equal((await admin.post(`/api/admin/payments/${list[0].id}`, { action: 'approve' })).status, 200);
  assert.equal((await admin.post(`/api/admin/payments/${list[0].id}`, { action: 'approve' })).status, 404, 'مرة وحدة');
  const after = await db.get('SELECT active_until, paid FROM shops WHERE id = ?', shop.id);
  assert.equal(after.paid, 1);
  const d = new Date(before); d.setFullYear(d.getFullYear() + 1);
  assert.equal(after.active_until, d.getTime(), 'سنة من آخر يوم بالتجربة');
  assert.equal((await owner.get('/api/me')).data.subscription.state, 'active');
  // الرفض ما بيغيّر الاشتراك، وما في أكتر من حوالتين بيستنوا
  await owner.post('/api/billing/claim', { plan: 'month', payer: 'أحمد' });
  await owner.post('/api/billing/claim', { plan: 'month', payer: 'أحمد' });
  assert.equal((await owner.post('/api/billing/claim', { plan: 'month', payer: 'أحمد' })).status, 409);
  const p2 = (await admin.get('/api/admin/payments')).data.payments.find((p) => p.status === 'pending');
  await admin.post(`/api/admin/payments/${p2.id}`, { action: 'reject' });
  assert.equal((await db.get('SELECT active_until FROM shops WHERE id = ?', shop.id)).active_until, after.active_until);
});

test('عرض أول المحلات: خصم 30% على أول 3 شهور لأول المحلات، والمكان بينحجز لما تتأكد الحوالة', async () => {
  const { client, db } = await setup({ PROMO_TOTAL: '2' });
  const admin = client();
  await signup(admin, { shopName: 'Platform' });
  await admin.put('/api/admin/settings', { cliqAlias: 'NUQATAK' });
  const owner = client();
  const { shop } = await signup(owner, { shopName: 'Cafe' });
  assert.deepEqual((await client().get('/api/site')).data.promo, { pct: 30, months: 3, total: 2, left: 2 });
  let b = (await owner.get('/api/billing')).data;
  assert.deepEqual(b.prices, { basic: { month: 8.4, year: 84 }, pro: { month: 17.5, year: 175 } }, 'الشهري والسنوي بخصم 30%');
  assert.equal(b.promo.monthsLeft, 3);
  // الشهري بالخصم، والحوالة اللي بتستنى بتحجز شهرها
  b = (await owner.post('/api/billing/claim', { plan: 'month', tier: 'pro', payer: 'أحمد' })).data;
  assert.equal(b.payments[0].amount, 17.5);
  assert.equal(b.payments[0].discount, 7.5);
  assert.equal(b.promo.monthsLeft, 2);
  b = (await owner.post('/api/billing/claim', { plan: 'month', tier: 'basic', payer: 'أحمد' })).data;
  assert.equal(b.payments[0].amount, 8.4);
  assert.equal(b.promo.monthsLeft, 1);
  const [second, first] = (await admin.get('/api/admin/payments')).data.payments;
  await admin.post(`/api/admin/payments/${first.id}`, { action: 'approve' });
  assert.ok((await db.get('SELECT founder_at FROM shops WHERE id = ?', shop.id)).founder_at, 'أخد مكانه');
  assert.equal((await client().get('/api/site')).data.promo.left, 1);
  await admin.post(`/api/admin/payments/${second.id}`, { action: 'reject' });
  b = (await owner.get('/api/billing')).data;
  assert.equal(b.promo.monthsLeft, 2, 'المرفوضة رجّعت شهرها');
  assert.equal(b.promo.founder, true);
  // السنوي بعد شهر: أول سنة بخصم 30% وبتخلّص الشهور الباقية، وبعدها السعر العادي
  b = (await owner.post('/api/billing/claim', { plan: 'year', tier: 'pro', payer: 'أحمد' })).data;
  assert.equal(b.payments[0].amount, 175);
  assert.equal(b.payments[0].discount, 75);
  await admin.post(`/api/admin/payments/${b.payments[0].id}`, { action: 'approve' });
  b = (await owner.get('/api/billing')).data;
  assert.deepEqual(b.prices.pro, { month: 25, year: 250 });
  b = (await owner.post('/api/billing/claim', { plan: 'month', tier: 'pro', payer: 'أحمد' })).data;
  assert.equal(b.payments[0].amount, 25);
  assert.equal(b.payments[0].discount, 0);
  // التفعيل اليدوي من مدير المنصة بياخد آخر مكان
  const owner2 = client();
  const { shop: shop2 } = await signup(owner2, { shopName: 'Bakery' });
  assert.equal((await admin.post(`/api/admin/shops/${shop2.id}/plan`, { action: 'month', tier: 'basic' })).status, 200);
  assert.equal((await db.get("SELECT amount FROM payments WHERE shop_id = ? AND payer = 'تفعيل يدوي'", shop2.id)).amount, 8.4);
  assert.equal((await client().get('/api/site')).data.promo, null, 'خلصت الأماكن');
  // اللي بعدهم بالسعر العادي
  const owner3 = client();
  await signup(owner3, { shopName: 'Late' });
  b = (await owner3.get('/api/billing')).data;
  assert.deepEqual(b.prices.basic, { month: 12, year: 120 });
  assert.equal(b.promo.left, 0);
  assert.equal(b.promo.monthsLeft, 0);
  // 🎁 خصم خاص من مدير المنصة: 50% على شهر واحد (السنوي بينخصم منه بقدر الشهر)، وبعدها السعر العادي
  const late = (await admin.get('/api/admin/shops')).data.shops.find((x) => x.name === 'Late');
  assert.equal((await owner3.post(`/api/admin/shops/${late.id}/deal`, { pct: 50, months: 1 })).status, 403, 'بس مدير المنصة');
  assert.equal((await admin.post(`/api/admin/shops/${late.id}/deal`, { pct: 101, months: 1 })).status, 400);
  let shopsList = (await admin.post(`/api/admin/shops/${late.id}/deal`, { pct: 50, months: 1 })).data.shops;
  assert.deepEqual(shopsList.find((x) => x.id === late.id).deal, { pct: 50, months: 1 });
  b = (await owner3.get('/api/billing')).data;
  assert.deepEqual(b.prices.basic, { month: 6, year: 114 });
  assert.deepEqual(b.deal, { pct: 50, monthsLeft: 1 });
  b = (await owner3.post('/api/billing/claim', { plan: 'month', tier: 'basic', payer: 'سامي' })).data;
  assert.equal(b.payments[0].amount, 6);
  assert.equal(b.deal, null, 'خلص شهره');
  assert.deepEqual(b.prices.basic, { month: 12, year: 120 });
  // دايماً 20%، وبينشال بـ 0
  await admin.post(`/api/admin/shops/${late.id}/deal`, { pct: 20, months: 0 });
  b = (await owner3.get('/api/billing')).data;
  assert.deepEqual(b.prices.basic, { month: 9.6, year: 96 });
  assert.deepEqual(b.deal, { pct: 20, monthsLeft: null });
  await admin.post(`/api/admin/shops/${late.id}/deal`, { pct: 0 });
  assert.equal((await owner3.get('/api/billing')).data.deal, null);
  // 100% على شهر: ما في تحويل، بيتفعّل فوراً بكبسة (حتى بدون CliQ)
  await admin.post(`/api/admin/shops/${late.id}/deal`, { pct: 100, months: 1 });
  b = (await owner3.get('/api/billing')).data;
  assert.deepEqual(b.prices.pro, { month: 0, year: 225 }, 'السنوي: شهر ببلاش من السنة');
  const untilBefore = (await db.get('SELECT active_until, created_at FROM shops WHERE id = ?', late.id));
  b = (await owner3.post('/api/billing/claim', { plan: 'month', tier: 'pro' })).data;
  assert.equal(b.payments[0].status, 'approved');
  assert.equal(b.payments[0].amount, 0);
  assert.equal(b.subscription.state, 'active');
  assert.ok((await db.get('SELECT active_until FROM shops WHERE id = ?', late.id)).active_until > (untilBefore.active_until ?? untilBefore.created_at));
  assert.equal(b.deal, null, 'خلص الشهر المجاني');
  // 100% دايماً: مشترك على طول بدون تفعيل، وما بينحسب بالدخل
  await admin.post(`/api/admin/shops/${late.id}/deal`, { pct: 100, months: 0 });
  b = (await owner3.get('/api/billing')).data;
  assert.equal(b.subscription.state, 'active');
  assert.equal(b.subscription.free, true);
  assert.equal(b.plan.tier, 'pro');
  const listed = (await admin.get('/api/admin/shops')).data.shops.find((x) => x.id === late.id);
  assert.equal(listed.subscription.free, true);
  // لما ينشال: بيضل شغّال 14 يوم لحد ما يدفع
  await admin.post(`/api/admin/shops/${late.id}/deal`, { pct: 0 });
  b = (await owner3.get('/api/billing')).data;
  assert.equal(b.subscription.free, undefined);
  assert.equal(b.subscription.daysLeft, 14);
  // محل من أول المحلات بخصم خاص أقل: بياخد الأحسن إله
  await admin.post(`/api/admin/shops/${shop2.id}/deal`, { pct: 10, months: 12 });
  b = (await owner2.get('/api/billing')).data;
  assert.equal(b.prices.basic.month, 8.4, '30% أحسن من 10%');
  for (let i = 0; i < 2; i++) assert.equal((await owner2.post('/api/billing/claim', { plan: 'month', tier: 'basic', payer: 'خالد' })).data.payments[0].amount, 8.4, 'الشهرين الباقيين من العرض');
  for (const x of (await admin.get('/api/admin/payments')).data.payments.filter((x) => x.status === 'pending')) await admin.post(`/api/admin/payments/${x.id}`, { action: 'approve' });
  b = (await owner2.post('/api/billing/claim', { plan: 'month', tier: 'basic', payer: 'خالد' })).data;
  assert.equal(b.payments[0].amount, 10.8, 'خلصت شهور العرض، فبياخد خصمه الخاص');
  const sales = await import('../src/sales.js');
  assert.match(sales.salesContext({ today: 'x', promoLeft: 0 }), /عرض أول المحلات خلص/);
  assert.match(sales.salesContext({ today: 'x', promoLeft: 7 }), /ضايل 7 مكان/);
});

test('آراء المحلات: مدير المنصة بيضيف رأي من محل عنا، وبيطلع بصفحة البيع، وبينحذف', async () => {
  const { client } = await setup();
  const admin = client();
  await signup(admin, { shopName: 'Platform' });
  const owner = client();
  const { shop } = await signup(owner, { shopName: 'كوفي الورد' });
  assert.equal((await owner.post('/api/admin/testimonials', { shopId: shop.id, quote: 'زباينا صاروا يرجعوا أكتر' })).status, 403, 'بس مدير المنصة');
  assert.equal((await admin.post('/api/admin/testimonials', { shopId: 999, quote: 'زباينا صاروا يرجعوا أكتر' })).status, 400);
  assert.equal((await admin.post('/api/admin/testimonials', { shopId: shop.id, quote: 'حلو' })).status, 400, 'قصير كتير');
  const r = await admin.post('/api/admin/testimonials', { shopId: shop.id, person: 'أبو أحمد', quote: '«زباينا صاروا يرجعوا أكتر من أول شهر»' });
  assert.equal(r.status, 200);
  assert.ok(r.data.shops.some((x) => x.name === 'كوفي الورد'));
  const t = r.data.testimonials[0];
  assert.equal(t.quote, 'زباينا صاروا يرجعوا أكتر من أول شهر', 'بدون علامات الاقتباس');
  assert.deepEqual((await client().get('/api/site')).data.testimonials, [{ shop: 'كوفي الورد', person: 'أبو أحمد', quote: 'زباينا صاروا يرجعوا أكتر من أول شهر', logo: `/media/logo/${shop.id}.png?v=0` }]);
  assert.equal((await client().get(`/media/logo/${shop.id}.png`)).status, 200);
  assert.equal((await admin.del(`/api/admin/testimonials/${t.id}`)).status, 200);
  assert.deepEqual((await client().get('/api/site')).data.testimonials, []);
});

test('الدومين الرسمي: صفحات العنوان القديم بتتحوّل، والـ API وApple والصور بيضلوا شغّالين', async () => {
  const { client } = await setup({ PUBLIC_URL: 'https://nuqatak.example' });
  const c = client();
  for (const [path, to] of [['/', '/'], ['/app', '/app'], ['/c/abcdefghijkmnpqrstuv', '/c/abcdefghijkmnpqrstuv'], ['/j/mocha?ref=x7', '/j/mocha?ref=x7'], ['/m/mocha', '/m/mocha'], ['/privacy', '/privacy']]) {
    const r = await c.get(path);
    assert.equal(r.status, 301, path);
    assert.equal(r.headers.get('location'), `https://nuqatak.example${to}`);
  }
  assert.equal((await c.get('/api/version')).status, 200, 'الـ API ما بيتحوّل');
  assert.notEqual((await c.get('/apple/v1/passes/x/y')).status, 301, 'خدمة Apple ما بتتحوّل');
  assert.notEqual((await c.get('/media/logo/1.png')).status, 301);
  assert.notEqual((await c.get('/c/abcdefghijkmnpqrstuv/google')).status, 301, 'رابط الحفظ بالمحفظة بيشتغل مباشرة');
  // على الدومين الرسمي نفسه ما في تحويل
  const { client: same } = await setup({ PUBLIC_URL: 'https://loyalty.test' });
  assert.equal((await same().get('/')).status, 200);
});

test('🩺 صحة المحل: بتستنى 5 زبائن، وبعدها رقم من 100 ونصائح للمؤشرات الضعيفة', async () => {
  const { client } = await setup();
  const owner = client();
  const { shop } = await signup(owner, { shopName: 'Mocha' });
  assert.equal((await client().get('/api/health')).status, 401);
  assert.deepEqual((await owner.get('/api/health')).data, { early: true, members: 0 });
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const t = (await client().post(`/api/shops/${shop.slug}/join`, { name: `زبون ${i}`, phone: `07944${String(i).padStart(5, '0')}` })).data.token;
    ids.push((await owner.get(`/api/members/lookup?code=${t}`)).data.member.id);
  }
  for (const id of ids.slice(0, 3)) await owner.post(`/api/members/${id}/earn`, { amount: 2 });
  const h = (await owner.get('/api/health')).data;
  assert.equal(typeof h.score, 'number');
  assert.ok(h.score > 0 && h.score <= 100);
  assert.deepEqual(h.parts.map((p) => p.key), ['active', 'return', 'new', 'reach', 'rewards']);
  assert.equal(h.parts.reduce((a, p) => a + p.weight, 0), 100);
  const ret = h.parts.find((p) => p.key === 'return');
  assert.equal(ret.value, '0%', 'ما حدا رجع لسا');
  assert.ok(ret.tip && ret.href, 'مؤشر ضعيف: نصيحة ورابط');
  assert.equal(h.parts.find((p) => p.key === 'active').tip, null, 'كلهم زاروا هالشهر');
  assert.equal(h.parts.find((p) => p.key === 'reach').value, '0%', 'ما حدا حفظ البطاقة ولا فعّل الإشعارات');
  assert.equal(h.visits.now, 3);
  assert.deepEqual(h.atRisk, []);
});
