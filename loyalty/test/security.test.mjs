import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signup } from './helpers.mjs';
import { runScheduled } from '../src/app.js';
import { extendUntil, extendUntilSql } from '../src/subscription.js';
import { MIGRATIONS, SCHEMA } from '../src/schema.js';

const DAY = 86400000;
async function fixture() {
  const w = await setup();
  const admin = w.client();
  await signup(admin, { shopName: 'Platform' });
  const owner = w.client();
  const { shop } = await signup(owner, { shopName: 'Security Cafe' });
  await owner.put('/api/shop/perks', { creditOn: true, creditBonus: 0 });
  const guest = w.client();
  const joined = (await guest.post(`/api/shops/${shop.slug}/join`, { name: 'Customer', phone: '0791234567' })).data;
  const member = (await owner.get(`/api/members/lookup?code=${joined.token}`)).data.member;
  return { ...w, admin, owner, guest, shop, member, joined };
}

test('public QR and correct phone cannot gift or delete a card; private key can', async () => {
  const w = await fixture();
  await w.owner.post(`/api/members/${w.member.id}/credit/topup`, { amount: 10 });
  const outsider = w.client();
  for (const operation of ['gift', 'delete']) {
    const r = await outsider.post(`/api/cards/${w.member.token}/${operation}`, { phone: w.member.phone, amount: 5 });
    assert.equal(r.status, 403);
  }
  const publicCard = (await outsider.get(`/api/cards/${w.member.token}`)).data.member;
  assert.equal(publicCard.managementKey, undefined);
  assert.equal(publicCard.management_hash, undefined);
  assert.equal((await w.owner.get(`/api/members/${w.member.id}`)).data.cardUrl.includes('#manage'), false);
  assert.equal((await w.guest.post(`/api/cards/${w.member.token}/gift`, { phone: w.member.phone, amount: 5 })).status, 201);
});

test('only this shop owner can rotate private card access; previous key is revoked', async () => {
  const w = await fixture();
  await w.owner.post(`/api/members/${w.member.id}/credit/topup`, { amount: 10 });
  await w.owner.post('/api/staff', { name: 'Cashier', email: 'rotation@test.com', password: 'cashier-secret' });
  const staff = w.client();
  await staff.post('/api/auth/login', { email: 'rotation@test.com', password: 'cashier-secret' });
  assert.equal((await staff.post(`/api/members/${w.member.id}/management`)).status, 403);
  assert.equal((await w.admin.post(`/api/members/${w.member.id}/management`)).status, 404);
  const newLink = await w.owner.post(`/api/members/${w.member.id}/management`);
  assert.equal(newLink.status, 200);
  const key = new URL(newLink.data.url).hash.slice('#manage='.length);
  assert.equal((await w.guest.post(`/api/cards/${w.member.token}/gift`, { phone: w.member.phone, amount: 1 })).status, 403);
  assert.equal((await w.client().req('POST', `/api/cards/${w.member.token}/gift`, { phone: w.member.phone, amount: 1 }, { 'x-card-management-key': key })).status, 201);
});

test('deletion refuses prepaid funds and open gifts, then removes settled gift references', async () => {
  const w = await fixture();
  const id = w.member.id;
  await w.owner.post(`/api/members/${id}/credit/topup`, { amount: 5 });
  assert.equal((await w.owner.del(`/api/members/${id}`)).status, 409);
  const gift = (await w.guest.post(`/api/cards/${w.member.token}/gift`, { amount: 5, phone: w.member.phone })).data;
  assert.equal((await w.owner.del(`/api/members/${id}`)).status, 409);
  // Independent protection still applies to a direct DELETE inside a transaction.
  await assert.rejects(w.db.batch([['DELETE FROM members WHERE id = ?', [id]]]), /member_funds_unsettled/);
  const recipient = w.client();
  const to = (await recipient.post(`/api/shops/${w.shop.slug}/join`, { name: 'Recipient', phone: '0790000000' })).data;
  assert.equal((await recipient.post(`/api/gifts/${gift.code}/claim`, { token: to.token })).status, 200);
  assert.equal((await w.owner.del(`/api/members/${id}`)).status, 200);
  assert.equal((await w.db.get('SELECT COUNT(*) AS n FROM credit_gifts WHERE from_member = ?', id)).n, 0);
  assert.equal((await recipient.get(`/api/cards/${to.token}`)).data.member.credit, 5);
});

test('stale legacy gift identity never credits a reused member id, even in another shop', async () => {
  const w = await fixture();
  const id = w.member.id;
  const oldToken = w.member.token;
  await w.owner.del(`/api/members/${id}`);
  const replacement = (await w.admin.post('/api/members', { name: 'Replacement', phone: '0793333333' })).data.member;
  assert.equal(replacement.id, id);
  await w.db.run('INSERT INTO credit_gifts (shop_id, from_member, from_token, amount, code, created_at) VALUES (?, ?, ?, 5000, ?, ?)', w.shop.id, id, oldToken, 'aaaaaaaaaaaaaaaaaaaa', Date.now() - 31 * DAY);
  const out = await runScheduled({ db: w.db, env: { PUBLIC_URL: 'https://loyalty.test' }, waitUntil: () => {} });
  assert.equal(out.giftsRefunded, 0);
  assert.equal((await w.db.get('SELECT credit FROM members WHERE id = ?', id)).credit, 0);
  assert.equal((await w.db.get('SELECT refunded_at FROM credit_gifts WHERE from_member = ?', id)).refunded_at, null, 'unreconciled gift stays visible for manual review');
});

test('failed approval rolls back subscription and payment, and retry succeeds exactly once', async () => {
  const w = await fixture();
  const until = Date.now() - 1000;
  await w.db.run('UPDATE shops SET active_until = ? WHERE id = ?', until, w.shop.id);
  const payment = await w.db.run("INSERT INTO payments (shop_id, plan, tier, amount, payer, created_at) VALUES (?, 'month', 'pro', 25, 'Customer', ?)", w.shop.id, Date.now());
  await w.db.run("CREATE TRIGGER audit_fail_payment BEFORE UPDATE ON payments WHEN NEW.status = 'approved' BEGIN SELECT RAISE(ABORT, 'audit_failure'); END");
  assert.equal((await w.admin.post(`/api/admin/payments/${payment.lastId}`, { action: 'approve' })).status, 500);
  assert.equal((await w.db.get('SELECT status FROM payments WHERE id = ?', payment.lastId)).status, 'pending');
  assert.equal((await w.db.get('SELECT active_until FROM shops WHERE id = ?', w.shop.id)).active_until, until);
  await w.db.run('DROP TRIGGER audit_fail_payment');
  const approvals = await Promise.all([0, 1].map(() => w.admin.post(`/api/admin/payments/${payment.lastId}`, { action: 'approve' })));
  assert.ok(approvals.some((r) => r.status === 200));
  const final = await w.db.get('SELECT active_until FROM shops WHERE id = ?', w.shop.id);
  assert.ok(final.active_until - Date.now() <= 31 * DAY);
  assert.equal((await w.admin.post(`/api/admin/payments/${payment.lastId}`, { action: 'approve' })).status, 404);
});

test('legacy gift migration requires the original debit and cannot adopt a replacement identity', async () => {
  const w = await fixture();
  await w.owner.post(`/api/members/${w.member.id}/credit/topup`, { amount: 5 });
  const gift = (await w.guest.post(`/api/cards/${w.member.token}/gift`, { amount: 5, phone: w.member.phone })).data;
  await w.db.run('UPDATE credit_gifts SET from_token = NULL WHERE code = ?', gift.code);
  await w.db.run('INSERT INTO credit_gifts (shop_id, from_member, amount, code, created_at) VALUES (?, ?, 5000, ?, ?)', w.shop.id, w.member.id, 'bbbbbbbbbbbbbbbbbbbb', Date.now() - DAY);
  await w.db.run("UPDATE platform_settings SET v = 'legacy-gifts' WHERE k = 'schema_migrations'");
  await w.db.init(SCHEMA, MIGRATIONS);
  assert.equal((await w.db.get('SELECT from_token FROM credit_gifts WHERE code = ?', gift.code)).from_token, w.member.token);
  assert.equal((await w.db.get('SELECT from_token FROM credit_gifts WHERE code = ?', 'bbbbbbbbbbbbbbbbbbbb')).from_token, null);
});

test('manual and free activations roll back payment and subscription together', async () => {
  const w = await fixture();
  const before = (await w.db.get('SELECT active_until FROM shops WHERE id = ?', w.shop.id)).active_until;
  await w.db.run("CREATE TRIGGER audit_fail_insert BEFORE INSERT ON payments BEGIN SELECT RAISE(ABORT, 'audit_failure'); END");
  assert.equal((await w.admin.post(`/api/admin/shops/${w.shop.id}/plan`, { action: 'month' })).status, 500);
  assert.equal((await w.db.get('SELECT active_until FROM shops WHERE id = ?', w.shop.id)).active_until, before);
  await w.db.run('DROP TRIGGER audit_fail_insert');
  await w.admin.post(`/api/admin/shops/${w.shop.id}/deal`, { pct: 100, months: 1 });
  await w.db.run("CREATE TRIGGER audit_fail_extension BEFORE UPDATE OF active_until ON shops BEGIN SELECT RAISE(ABORT, 'audit_failure'); END");
  assert.equal((await w.owner.post('/api/billing/claim', { plan: 'month' })).status, 500);
  assert.equal((await w.db.get('SELECT COUNT(*) AS n FROM payments WHERE shop_id = ?', w.shop.id)).n, 0);
});

test('staff daily limit and cooldown are enforced after concurrent stale reads', async () => {
  for (const guard of [{ guardDaily: 1, guardCooldown: 0 }, { guardDaily: 0, guardCooldown: 10 }]) {
    const w = await fixture();
    await w.owner.put('/api/shop/perks', guard);
    await w.owner.post('/api/staff', { name: 'Cashier', email: 'race@test.com', password: 'cashier-secret' });
    const staff = w.client();
    await staff.post('/api/auth/login', { email: 'race@test.com', password: 'cashier-secret' });
    // Let both requests read the same guard state before either executes its batch.
    const originalBatch = w.db.batch;
    let arrivals = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    w.db.batch = async (list) => {
      if (list[0][0].startsWith('INSERT INTO txns') && list[0][0].includes("'earn'")) {
        if (++arrivals === 2) release();
        await gate;
      }
      return originalBatch(list);
    };
    try {
      const results = await Promise.all([0, 1].map((i) => staff.post(`/api/members/${w.member.id}/earn`, { amount: 10, key: `race-earn-key-${i}` })));
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      assert.deepEqual(await w.db.get('SELECT visits, balance FROM members WHERE id = ?', w.member.id), { visits: 1, balance: 10 });
      assert.equal((await w.db.get("SELECT COUNT(*) AS n FROM txns WHERE member_id = ? AND kind = 'earn'", w.member.id)).n, 1);
    } finally { w.db.batch = originalBatch; }
  }
});

test('password change revokes other sessions and rotates the current session', async () => {
  const w = await setup();
  const owner = w.client();
  const account = await signup(owner);
  const other = w.client();
  await other.post('/api/auth/login', { email: account.email, password: account.password });
  const changed = await owner.put('/api/me/password', { current: account.password, next: 'new-secret-password' });
  assert.equal(changed.status, 200);
  assert.match(changed.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await owner.get('/api/me')).status, 200);
  assert.equal((await other.get('/api/me')).status, 401);
  assert.equal((await w.client().post('/api/auth/login', { email: account.email, password: account.password })).status, 401);
});

test('expired subscription permits spending existing credit, but forbids top-up and earning', async () => {
  const w = await fixture();
  await w.owner.post(`/api/members/${w.member.id}/credit/topup`, { amount: 10 });
  await w.db.run('UPDATE shops SET active_until = ? WHERE id = ?', Date.now() - 1000, w.shop.id);
  assert.equal((await w.owner.post(`/api/members/${w.member.id}/credit/spend`, { amount: 3 })).status, 200);
  assert.equal((await w.owner.post(`/api/members/${w.member.id}/credit/topup`, { amount: 1 })).status, 402);
  assert.equal((await w.owner.post(`/api/members/${w.member.id}/earn`, { amount: 1 })).status, 402);
  assert.equal((await w.owner.post(`/api/members/${w.member.id}/credit/spend`, { amount: 8 })).status, 409);
  assert.equal((await w.guest.get(`/api/cards/${w.member.token}`)).data.member.credit, 7);
});

test('fresh signup never becomes admin; secret bootstrap is explicit and single-use', async () => {
  const w = await setup();
  const first = w.client();
  await first.post('/api/auth/signup', { shopName: 'First Customer', email: 'first@test.com', password: 'first-password' });
  assert.equal((await first.get('/api/me')).data.user.isAdmin, false);
  assert.equal((await first.get('/api/admin/shops')).status, 403);
  assert.equal((await first.post('/api/platform/bootstrap', { code: 'wrong-secret' })).status, 403);
  assert.equal((await first.bootstrap()).status, 200);
  const second = w.client();
  await signup(second);
  assert.equal((await second.get('/api/me')).data.user.isAdmin, false);
  assert.equal((await second.bootstrap()).status, 409);
  await w.db.run('DELETE FROM users WHERE id = ?', (await first.get('/api/me')).data.user.id);
  const third = w.client();
  await signup(third);
  assert.equal((await third.get('/api/me')).data.user.isAdmin, false, 'deleted administrator never transfers its role to a later signup');
});

test('legacy migration pins the existing admin once and never changes that identity', async () => {
  const w = await setup({ PLATFORM_SETUP_CODE: '' });
  const existing = w.client();
  await signup(existing);
  await w.db.run("DELETE FROM platform_settings WHERE k = 'platform_admin_pinned'");
  await w.db.run("UPDATE platform_settings SET v = 'legacy-schema' WHERE k = 'schema_migrations'");
  await w.db.init(SCHEMA, MIGRATIONS);
  const pinned = (await w.db.get("SELECT v FROM platform_settings WHERE k = 'platform_admin_user_id'")).v;
  assert.equal((await existing.get('/api/me')).data.user.isAdmin, true);
  await signup(w.client());
  await w.db.init(SCHEMA, MIGRATIONS);
  assert.equal((await w.db.get("SELECT v FROM platform_settings WHERE k = 'platform_admin_user_id'")).v, pinned);
});

test('UTC calendar extensions clamp month ends and leap days; SQL matches JavaScript', async () => {
  const w = await fixture();
  const cases = [
    ['2026-01-31T12:34:56.789Z', 'month', '2026-02-28T12:34:56.789Z'],
    ['2028-01-31T12:34:56.789Z', 'month', '2028-02-29T12:34:56.789Z'],
    ['2028-02-29T12:34:56.789Z', 'year', '2029-02-28T12:34:56.789Z'],
    ['2026-10-09T12:34:56.789Z', 'month', '2026-11-09T12:34:56.789Z'],
    ['2026-12-31T12:34:56.789Z', 'month', '2027-01-31T12:34:56.789Z'],
  ];
  for (const [start, period, end] of cases) {
    const base = Date.parse(start);
    const now = base - DAY;
    assert.equal(extendUntil(base, period, now), Date.parse(end));
    await w.db.run('UPDATE shops SET active_until = ? WHERE id = ?', base, w.shop.id);
    const sql = await w.db.get(`SELECT ${extendUntilSql(period, now, 14)} AS deadline FROM shops WHERE id = ?`, w.shop.id);
    assert.equal(sql.deadline, Date.parse(end));
  }
});
