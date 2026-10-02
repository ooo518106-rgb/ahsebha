// حساب العرض: محل تجريبي مليان زبائن وزيارات وتقييمات، عشان تفرجيه لأصحاب المحلات. بيرجع لحاله كل يوم.
// قاعدة: كل ميزة جديدة بالمنصة لازم تنضاف هون كمان، عشان اللي بيجرّب العرض يشوفها شغّالة.
import { hashPassword } from './auth.js';
import { randomDigits, randomToken } from './util.js';
import { DEMO_LOGO, MENU_IMAGES } from './demo-assets.js';

export const DEMO_SLUG = 'demo-cafe';
export const DEMO_EMAIL = 'demo@nuqatak.demo';
// زيد الرقم كل ما تضيف إشي جديد للعرض: الحساب بيتجدّد لحاله بعد النشر (بدل ما يستنى الساعة 4 الصبح)
export const DEMO_VERSION = 2;
const DAY = 864e5;
const AMMAN = 3 * 36e5; // الأردن UTC+3 طول السنة

// أرقام عشوائية بس ثابتة (نفس العرض كل يوم)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['سارة', 'عمر', 'ليلى', 'خالد', 'رنا', 'يزن', 'هبة', 'محمد', 'دانة', 'علي', 'نور', 'فادي', 'لين', 'أحمد', 'جود', 'سامي', 'تالا', 'كريم', 'ريم', 'زيد', 'مرام', 'حمزة', 'سلمى', 'بشار', 'غدير', 'مالك', 'شهد', 'عبدالله', 'رهف', 'طارق'];
const LAST = ['الخطيب', 'العلي', 'حداد', 'المصري', 'النجار', 'الزعبي', 'خوري', 'العمري', 'الشامي', 'عبيدات'];
const COMMENTS_GOOD = ['أحلى قهوة بالمنطقة ☕', 'الموظفين كتير لطيفين', 'المكان مرتب والخدمة سريعة', 'الكيك عندكم خرافي'];
const COMMENTS_BAD = ['الانتظار كان طويل شوي', 'القهوة كانت باردة', 'الموسيقى كانت عالية'];

const firstName = (name) => name.split(' ')[0];
const topOf = (members) => members.reduce((a, b) => (b.visits > a.visits ? b : a));

// ميزات على زبائن معيّنين: دعوة صاحب، هدية عيد ميلاد، وزبائن غابوا ووصلهم «اشتقنالك» (نفس اللي بتعمله المهام الحقيقية)
async function addPerks(db, { s, now, members, ids }) {
  const all = members.map((_, i) => i);
  const top = members.indexOf(topOf(members));
  const year = new Date(now + AMMAN).getUTCFullYear();
  const adds = [];
  // 👥 ادعُ صاحبك: 3 زبائن جداد انضموا بدعوة من زبائن دايمين، والاتنين أخدوا الهدية
  const newest = [...all].sort((a, b) => members[b].created - members[a].created).filter((i) => i !== top).slice(0, 3);
  const loyal = [...all].sort((a, b) => members[b].visits - members[a].visits).filter((i) => i !== top && !newest.includes(i)).slice(0, 3);
  for (let k = 0; k < newest.length; k++) {
    const n = newest[k];
    const by = loyal[k];
    const at = Math.min(now - 36e5, members[n].created + DAY);
    adds.push([n, 10, `👥 هدية الانضمام بدعوة من ${firstName(members[by].name)}`, at], [by, 10, `👥 دعوة ${firstName(members[n].name)}`, at]);
    await db.run('UPDATE members SET referred_by = ?, ref_rewarded = ? WHERE id = ?', ids[by], at, ids[n]);
  }
  // 🎂 هدية عيد الميلاد لزبائن عيدهم مرق هالسنة
  const bdayAt = (i) => {
    const [mm, dd] = members[i].birthday.split('-').map(Number);
    return Date.UTC(year, mm - 1, dd, 9, 0) - AMMAN;
  };
  const bdays = all.filter((i) => members[i].birthday && bdayAt(i) < now - DAY && bdayAt(i) > members[i].created + 14 * DAY).slice(0, 3);
  for (const i of bdays) {
    adds.push([i, 100, '🎂 هدية عيد الميلاد', bdayAt(i)]);
    await db.run('UPDATE members SET bday_year = ? WHERE id = ?', year, ids[i]);
  }
  // 💤 زبائن غابوا أكتر من شهر: وصلهم «اشتقنالك» ونقاطهم دبل لـ 3 أيام لما يرجعوا
  const absent = all.filter((i) => now - members[i].last >= 32 * DAY).slice(0, 3);
  for (const i of absent) await db.run('UPDATE members SET nudged_at = ?, boost_until = ? WHERE id = ?', now - DAY, now + 2 * DAY, ids[i]);
  for (const [i, delta, note, at] of adds) {
    await db.batch([
      ["INSERT INTO txns (shop_id, member_id, kind, delta, note, created_at) VALUES (?, ?, 'adjust', ?, ?, ?)", [s, ids[i], delta, note, at]],
      ['UPDATE members SET balance = balance + ? WHERE id = ?', [delta, ids[i]]],
    ]);
  }
}

// 🎁 هدايا رصيد بين الزبائن: وحدة انستلمت، ووحدة لسا بتستنى صاحبها يستلمها
async function addGifts(db, { s, now, members, ids }) {
  const top = topOf(members);
  const rich = members.map((_, i) => i).filter((i) => members[i] !== top && members[i].credit >= 5000);
  const poor = members.findIndex((m) => m !== top && !m.credit);
  if (rich.length < 2 || poor < 0) return;
  const [a, c] = rich;
  const sent = now - 3 * DAY;
  const claimed = sent + 3 * 36e5;
  await db.batch([
    ['INSERT INTO credit_gifts (shop_id, from_member, amount, code, claimed_by, claimed_at, created_at) VALUES (?, ?, 2000, ?, ?, ?, ?)', [s, ids[a], randomToken(), ids[poor], claimed, sent]],
    ["INSERT INTO credit_txns (shop_id, member_id, kind, amount, note, created_at) VALUES (?, ?, 'spend', 2000, '🎁 هدية لصاحب', ?)", [s, ids[a], sent]],
    ["INSERT INTO credit_txns (shop_id, member_id, kind, amount, note, created_at) VALUES (?, ?, 'topup', 2000, '🎁 هدية من صاحب', ?)", [s, ids[poor], claimed]],
    ['UPDATE members SET credit = credit - 2000 WHERE id = ?', [ids[a]]],
    ['UPDATE members SET credit = credit + 2000 WHERE id = ?', [ids[poor]]],
    ['INSERT INTO credit_gifts (shop_id, from_member, amount, code, created_at) VALUES (?, ?, 1000, ?, ?)', [s, ids[c], randomToken(), now - DAY]],
    ["INSERT INTO credit_txns (shop_id, member_id, kind, amount, note, created_at) VALUES (?, ?, 'spend', 1000, '🎁 هدية لصاحب', ?)", [s, ids[c], now - DAY]],
    ['UPDATE members SET credit = credit - 1000 WHERE id = ?', [ids[c]]],
  ]);
}

// بيعمل حساب العرض أول مرة، أو بيرجّعه لوضعه الأصلي
export async function seedDemo(db, now = Date.now()) {
  let shop = await db.get('SELECT * FROM shops WHERE slug = ?', DEMO_SLUG);
  if (!shop) {
    await db.run(
      "INSERT INTO shops (slug, name, color, country, currency, welcome_text, demo, active_until, created_at) VALUES (?, 'كوفي العرض', '#2f5d50', 'JO', 'JOD', 'كوفي العرض ترحب بكم ☕', 1, ?, ?)",
      DEMO_SLUG, now + 3650 * DAY, now - 120 * DAY,
    );
    shop = await db.get('SELECT * FROM shops WHERE slug = ?', DEMO_SLUG);
  }
  const s = shop.id;
  let owner = await db.get("SELECT * FROM users WHERE email = ?", DEMO_EMAIL);
  if (!owner) {
    await db.run("INSERT INTO users (shop_id, email, name, role, pw_hash, created_at) VALUES (?, ?, 'صاحب كوفي العرض', 'owner', ?, ?)", s, DEMO_EMAIL, await hashPassword(randomToken() + randomToken()), now);
    owner = await db.get("SELECT * FROM users WHERE email = ?", DEMO_EMAIL);
  }

  // نمسح كل إشي ونرجّع الإعدادات الأصلية
  const memberIds = 'SELECT id FROM members WHERE shop_id = ?';
  await db.batch([
    [`DELETE FROM member_coupons WHERE shop_id = ?`, [s]],
    [`DELETE FROM push_subs WHERE shop_id = ?`, [s]],
    [`DELETE FROM reviews WHERE shop_id = ?`, [s]],
    [`DELETE FROM credit_txns WHERE shop_id = ?`, [s]],
    [`DELETE FROM credit_gifts WHERE shop_id = ?`, [s]],
    [`DELETE FROM txns WHERE shop_id = ?`, [s]],
    [`DELETE FROM apple_regs WHERE serial IN (SELECT token FROM members WHERE shop_id = ?)`, [s]],
    [`DELETE FROM members WHERE id IN (${memberIds})`, [s]],
    [`DELETE FROM coupons WHERE shop_id = ?`, [s]],
    [`DELETE FROM broadcasts WHERE shop_id = ?`, [s]],
    [`DELETE FROM menu_items WHERE shop_id = ?`, [s]],
    [`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE shop_id = ? AND id <> ?)`, [s, owner.id]],
    [`DELETE FROM user_push_subs WHERE user_id IN (SELECT id FROM users WHERE shop_id = ?)`, [s]],
    [`DELETE FROM users WHERE shop_id = ? AND id <> ?`, [s, owner.id]],
    ['INSERT OR REPLACE INTO shop_logos (shop_id, mime, data) VALUES (?, ?, ?)', [s, DEMO_LOGO.mime, DEMO_LOGO.data]],
    [`UPDATE shops SET name = 'كوفي العرض', slug = ?, color = '#2f5d50', program_type = 'points', points_per_unit = 1, reward_threshold = 100,
      stamps_required = 9, reward_name = 'مشروب مجاني', welcome_text = 'كوفي العرض ترحب بكم ☕', custom_logo = 1, logo_version = logo_version + 1, demo = 1, paid = 1, active_until = ?,
      locations = ?, links = ?, boosts = ?, tiers_on = 1, tier_silver = 5, tier_gold = 12, bday_on = 1, bday_gift = NULL, winback_days = 30, winback_text = '',
      winback_double = 1, review_on = 1, review_url = '', ref_bonus = NULL, guard_cooldown = 10, guard_daily = 3, guard_big = NULL, credit_on = 1, credit_bonus = 10,
      expiry_months = 12, expiry_since = ?, onboard = '{}', updated_at = ? WHERE id = ?`, [
      DEMO_SLUG, now + 3650 * DAY,
      JSON.stringify([{ id: 'bdemo01', name: 'الفرع الرئيسي — عبدون', lat: 31.9539, lng: 35.8806 }, { id: 'bdemo02', name: 'فرع الصويفية', lat: 31.9605, lng: 35.8622 }]),
      JSON.stringify({ instagram: 'https://instagram.com/nuqatak.demo', tiktok: 'https://www.tiktok.com/@nuqatak.demo', facebook: 'https://facebook.com/nuqatak.demo', whatsapp: 'https://wa.me/962790000000' }),
      JSON.stringify([{ days: [0], from: '14:00', to: '17:00', mult: 2 }, { days: [5], from: '08:00', to: '11:00', mult: 2 }]),
      now - 100 * DAY, now, s,
    ]],
    [`INSERT INTO users (shop_id, email, name, role, pw_hash, branch_id, created_at) VALUES (?, ?, 'سامر (كاشير)', 'staff', ?, 'bdemo01', ?)`, [s, `staff-${randomDigits(6)}@nuqatak.demo`, owner.pw_hash, now - 100 * DAY]],
    [`INSERT INTO users (shop_id, email, name, role, pw_hash, branch_id, created_at) VALUES (?, ?, 'ريم (كاشير)', 'staff', ?, 'bdemo02', ?)`, [s, `staff-${randomDigits(6)}@nuqatak.demo`, owner.pw_hash, now - 80 * DAY]],
  ]);
  const staffRows = await db.all("SELECT id, branch_id FROM users WHERE shop_id = ? AND role = 'staff' ORDER BY id", s);
  const staff = staffRows[0];
  const staffOf = (branch) => (staffRows.find((u) => u.branch_id === branch) || staff).id;

  // زبائن وزيارات آخر 60 يوم (أكتر الزيارات الصبح والعصر والمسا)
  const r = rng(20261002);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const HOURS = [8, 8, 9, 9, 10, 11, 13, 14, 15, 17, 18, 18, 19, 19, 20, 21];
  const members = [];
  const txns = [];
  for (let i = 0; i < 64; i++) {
    const created = now - Math.floor(r() * 110 + 2) * DAY;
    const visits = Math.max(1, Math.floor(r() ** 1.6 * 22));
    let balance = 0;
    let lifetime = 0;
    let redeemed = 0;
    let last = created;
    const span = Math.min(60, (now - created) / DAY);
    for (let v = 0; v < visits; v++) {
      const dayAgo = Math.floor(r() * span);
      const local = new Date(now - dayAgo * DAY + AMMAN);
      local.setUTCHours(pick(HOURS), Math.floor(r() * 60), 0, 0);
      const at = Math.min(now - 60000, local.getTime() - AMMAN);
      const amount = Math.round((2 + r() * 10) * 2) / 2;
      const delta = Math.floor(amount);
      txns.push({ m: i, kind: 'earn', delta, amount, at, branch: r() < 0.65 ? 'bdemo01' : 'bdemo02' });
      balance += delta;
      lifetime += delta;
      last = Math.max(last, at);
      if (balance >= 100 && r() < 0.6) {
        txns.push({ m: i, kind: 'redeem', delta: -100, amount: null, at: at + 60000, branch: 'bdemo01' });
        balance -= 100;
        redeemed++;
      }
    }
    const name = `${FIRST[i % FIRST.length]} ${pick(LAST)}`;
    const month = 1 + Math.floor(r() * 12);
    const birthday = r() < 0.45 ? `${String(month).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}` : null;
    members.push({ name, phone: `0790${String(100000 + i * 137).slice(-6)}`, balance, lifetime, redeemed, visits, last, created, birthday, credit: r() < 0.2 ? Math.round(r() * 20) * 1000 : 0 });
  }

  // البطاقة اللي بتنعرض بالعرض (أكتر زبون بيزور): إلها رصيد عشان يبيّن على البطاقة
  topOf(members).credit ||= 8000;
  // 3 زبائن قدام آخر زيارة إلهم من أكتر من شهر (عشان يبيّن «اشتقنالك» والنقاط الدبل لما يرجعوا)
  const ABSENT = 33 * DAY;
  members.map((m, i) => i).filter((i) => members[i].visits <= 4 && now - members[i].created > 70 * DAY).slice(0, 3).forEach((i) => {
    const m = members[i];
    const shift = Math.max(0, m.last - (now - ABSENT));
    for (const t of txns) if (t.m === i) t.at -= shift;
    m.last -= shift;
    m.created = Math.min(m.created, Math.min(...txns.filter((t) => t.m === i).map((t) => t.at)) - DAY);
  });

  // إدخال على دفعات (D1 بيسمح لحد 100 قيمة بكل استعلام)
  const insertRows = async (sql, cols, rows) => {
    const per = Math.floor(99 / cols);
    for (let i = 0; i < rows.length; i += per) {
      const chunk = rows.slice(i, i + per);
      await db.run(`${sql} VALUES ${chunk.map(() => `(${Array(cols).fill('?').join(', ')})`).join(', ')}`, ...chunk.flat());
    }
  };
  await insertRows(
    'INSERT INTO members (shop_id, token, card_no, name, phone, balance, lifetime, redeemed, visits, last_visit, created_at, birthday, bday_set_at, credit)', 14,
    members.map((m) => [s, randomToken(), randomDigits(8), m.name, m.phone, m.balance, m.lifetime, m.redeemed, m.visits, m.last, m.created, m.birthday, m.birthday ? m.created : null, m.credit]),
  );
  const rows = await db.all('SELECT id, phone FROM members WHERE shop_id = ? ORDER BY id', s);
  const idOf = new Map(rows.map((x) => [x.phone, x.id]));
  const ids = members.map((m) => idOf.get(m.phone));
  await insertRows(
    'INSERT INTO txns (shop_id, member_id, kind, delta, amount, user_id, branch_id, created_at)', 8,
    txns.sort((a, b) => a.at - b.at).map((t) => [s, ids[t.m], t.kind, t.delta, t.amount, r() < 0.7 ? staffOf(t.branch) : owner.id, t.branch, t.at]),
  );
  await addPerks(db, { s, now, members, ids, owner, staff, r });
  // تقييمات، وكوبون شغّال، ورصيد لبعض الزبائن
  const reviews = [];
  for (let i = 0; i < 18; i++) {
    const stars = i % 6 === 5 ? 2 + (i % 2) : r() < 0.7 ? 5 : 4;
    reviews.push([s, ids[i * 3 % ids.length], stars, stars <= 3 ? pick(COMMENTS_BAD) : r() < 0.4 ? pick(COMMENTS_GOOD) : '', now - Math.floor(r() * 30 * DAY)]);
  }
  await insertRows('INSERT INTO reviews (shop_id, member_id, stars, comment, created_at)', 5, reviews);
  const cp = await db.run("INSERT INTO coupons (shop_id, title, details, segment, expires_at, created_at) VALUES (?, 'خصم 20% على الكيك', 'مع أي مشروب', 'silver', ?, ?)", s, now + 5 * DAY, now - 2 * DAY);
  const ins = await db.run('INSERT INTO member_coupons (coupon_id, member_id, shop_id) SELECT ?, id, shop_id FROM members WHERE shop_id = ? AND visits >= 5', cp.lastId, s);
  await db.run('UPDATE member_coupons SET used_at = ?, used_by = ? WHERE coupon_id = ? AND member_id IN (SELECT member_id FROM member_coupons WHERE coupon_id = ? LIMIT 4)', now - DAY, staff.id, cp.lastId, cp.lastId);
  await db.run('UPDATE coupons SET issued = ?, used = 4 WHERE id = ?', ins.changes, cp.lastId);
  const cp2 = await db.run("INSERT INTO coupons (shop_id, title, details, segment, expires_at, created_at) VALUES (?, 'قهوة الصبح بنص السعر', 'من 8 لـ 11 الصبح', 'all', ?, ?)", s, now + 3 * DAY, now - DAY);
  const ins2 = await db.run('INSERT INTO member_coupons (coupon_id, member_id, shop_id) SELECT ?, id, shop_id FROM members WHERE shop_id = ?', cp2.lastId, s);
  await db.run('UPDATE member_coupons SET used_at = ?, used_by = ? WHERE coupon_id = ? AND member_id IN (SELECT member_id FROM member_coupons WHERE coupon_id = ? ORDER BY member_id DESC LIMIT 6)', now - 3 * 36e5, staff.id, cp2.lastId, cp2.lastId);
  await db.run('UPDATE coupons SET issued = ?, used = 6 WHERE id = ?', ins2.changes, cp2.lastId);
  await insertRows(
    'INSERT INTO credit_txns (shop_id, member_id, kind, amount, bonus, user_id, created_at)', 7,
    members.map((m, i) => {
      if (!m.credit) return null;
      const paid = Math.max(1000, Math.round(m.credit / 1.1 / 1000) * 1000); // شحن بدنانير كاملة والباقي هدية
      return [s, ids[i], 'topup', Math.min(paid, m.credit), Math.max(0, m.credit - paid), staff.id, now - 7 * DAY];
    }).filter(Boolean),
  );
  await addGifts(db, { s, now, members, ids });
  // منيو بالصور والوصف (واحد مش متوفّر، عشان يبيّن كيف بيختفي من منيو الزبون)
  const menu = [
    ['مشروبات ساخنة', 'إسبريسو', 1.5, 'شوت مركّز من حبوب محمّصة عنا', 'espresso'],
    ['مشروبات ساخنة', 'كابتشينو', 2.5, 'إسبريسو مع حليب مرغّى ورسمة قلب', 'cappuccino'],
    ['مشروبات ساخنة', 'لاتيه', 2.75, 'ناعم وخفيف، بحليب كامل الدسم', 'latte'],
    ['مشروبات ساخنة', 'سبانش لاتيه', 3.25, 'بالحليب المكثّف المحلّى', 'spanish'],
    ['مشروبات باردة', 'آيس لاتيه', 3, 'إسبريسو وحليب بارد وتلج', 'icedLatte'],
    ['مشروبات باردة', 'موهيتو', 2.5, 'نعنع وليمون وصودا', 'mojito'],
    ['مشروبات باردة', 'ماتشا مثلّجة', 3.5, 'خلصت اليوم، بترجع بكرا', null, 0],
    ['حلويات', 'تشيز كيك', 3.5, 'بصوص التوت الأحمر', 'cheesecake'],
    ['حلويات', 'كرواسون شوكولا', 1.75, 'طازة كل صبح', 'croissant'],
  ];
  await insertRows('INSERT INTO menu_items (shop_id, category, name, price, description, image, available, sort, updated_at, created_at)', 10,
    menu.map(([cat, name, price, desc, img, available = 1], i) => [s, cat, name, price, desc, img ? MENU_IMAGES[img] : null, available, i, now, now]));
  return { shopId: s, ownerId: owner.id, sampleToken: (await db.get('SELECT token FROM members WHERE shop_id = ? ORDER BY visits DESC LIMIT 1', s)).token };
}
