// السيرفر: صفحات + API. معالج واحد handle(request, ctx) بيشتغل على Cloudflare Workers وعلى Node.
// ctx = { db, env, asset(path) → Response, waitUntil(promise) }
import * as auth from './auth.js';
import * as apple from './apple.js';
import { pemToDer } from '../public/js/asn1.js';
import * as gw from './gwallet.js';
import * as webpush from './webpush.js';
import * as perks from './perks.js';
import { DEMO_EMAIL, DEMO_VERSION, seedDemo } from './demo.js';
import { APP_VERSION, CHANGELOG } from './changelog.js';
import { aiConfig, aiCost, chat, cleanHistory } from './ai.js';
import { geminiFindShops } from './gemini.js';
import * as sales from './sales.js';
import * as wa from './whatsapp.js';
import { defaultLogoPng } from './png.js';
import { earnFor, progress, rewardCost, rewardRule, stampsLine, unitLabel, unitWord } from '../public/js/rules.js';
import { FEATURES } from '../public/js/plans.js';
import { b64ToBytes, bytesToB64, clean, fail, HttpError, isUniqueError, json, normPhone, randomDigits, randomToken, sha256Hex } from './util.js';

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const TOKEN_RE = /^[a-z2-9]{20}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
export const CURRENCIES = { JO: 'JOD', PS: 'ILS', SA: 'SAR', AE: 'AED', KW: 'KWD', QA: 'QAR', BH: 'BHD', OM: 'OMR', EG: 'EGP', IQ: 'IQD', LB: 'USD', SY: 'SYP', TR: 'TRY', US: 'USD' };
const CALLING = { JO: '962', PS: '970', SA: '966', AE: '971', KW: '965', QA: '974', BH: '973', OM: '968', EG: '20', IQ: '964', LB: '961', SY: '963', TR: '90', US: '1' };
const MAX_BODY = 1.5 * 1024 * 1024;
const MAX_LOGO = 700 * 1024;

const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'permissions-policy': 'camera=(self), geolocation=(self)',
};

// ─── عرض البيانات ───
function shopView(shop, origin) {
  return {
    id: shop.id,
    slug: shop.slug,
    name: shop.name,
    color: shop.color,
    programType: shop.program_type,
    pointsPerUnit: shop.points_per_unit,
    rewardThreshold: shop.reward_threshold,
    stampsRequired: shop.stamps_required,
    rewardName: shop.reward_name,
    currency: shop.currency,
    country: shop.country,
    welcomeText: shop.welcome_text,
    locations: branchesOf(shop),
    links: JSON.parse(shop.links || '{}'),
    logo: logoUrl(shop, origin),
    customLogo: !!shop.custom_logo,
    joinUrl: `${origin}/j/${shop.slug}`,
    rule: rewardRule(shop),
    cost: rewardCost(shop),
    unit: unitLabel(shop),
    perks: perksView(shop),
  };
}

// كل فرع إله رقم ثابت (من إحداثياته، أو المحفوظ) عشان نربط فيه الموظفين والحركات
function branchId(lat, lng) {
  let h = 2166136261;
  for (const ch of `${lat},${lng}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `b${h.toString(36).padStart(6, '0').slice(-6)}`;
}
function branchesOf(shop) {
  return JSON.parse(shop.locations || '[]').map((l) => ({ ...l, id: l.id || branchId(l.lat, l.lng) }));
}

// إعدادات العروض كما بتطلع للوحة
function perksView(shop) {
  return {
    boosts: perks.parseBoosts(shop.boosts),
    boostNow: perks.activeBoost(shop),
    tiersOn: !!shop.tiers_on,
    tierSilver: shop.tier_silver,
    tierGold: shop.tier_gold,
    bdayOn: !!shop.bday_on,
    bdayGift: perks.bdayGift(shop),
    winbackDays: shop.winback_days,
    winbackText: shop.winback_text,
    winbackDouble: !!shop.winback_double,
    reviewOn: !!shop.review_on,
    reviewUrl: shop.review_url,
    refBonus: perks.refBonus(shop),
    guardCooldown: shop.guard_cooldown,
    guardDaily: shop.guard_daily,
    guardBig: guardBig(shop),
    creditOn: !!shop.credit_on,
    creditBonus: shop.credit_bonus,
    expiryMonths: shop.expiry_months,
  };
}

function publicShopView(shop, origin) {
  return {
    slug: shop.slug,
    name: shop.name,
    color: shop.color,
    logo: logoUrl(shop, origin),
    programType: shop.program_type,
    rewardName: shop.reward_name,
    rule: rewardRule(shop),
    cost: rewardCost(shop),
    unit: unitLabel(shop),
    welcomeText: shop.welcome_text,
    boostNow: perks.activeBoost(shop),
    refBonus: perks.refBonus(shop),
    bdayOn: !!shop.bday_on,
    bdayGift: perks.bdayGift(shop),
    tiersOn: !!shop.tiers_on,
    links: JSON.parse(shop.links || '{}'),
    creditOn: !!shop.credit_on,
    currency: shop.currency,
    pointsPerUnit: shop.points_per_unit,
  };
}

// الموظف ما بيشوف رقم الزبون كامل: آخر 3 أرقام بس (بيكفي ليتأكد إنه الزبون الصح)
const maskPhone = (p) => `••••${String(p).slice(-3)}`;

function memberView(m, shop, hidePhone = false) {
  return {
    id: m.id,
    name: m.name,
    phone: hidePhone ? maskPhone(m.phone) : m.phone,
    phoneHidden: hidePhone,
    cardNo: m.card_no,
    token: m.token,
    balance: m.balance,
    lifetime: m.lifetime,
    redeemed: m.redeemed,
    visits: m.visits,
    lastVisit: m.last_visit,
    createdAt: m.created_at,
    inWallet: !!m.gw_object,
    progress: progress(shop, m.balance),
    stamps: shop.program_type === 'stamps' ? stampsLine(shop, m.balance) : null,
    tier: perks.tierOf(shop, m.visits),
    boostUntil: m.boost_until && m.boost_until > Date.now() ? m.boost_until : null,
    // الكاشير بيعرف إنه عيد ميلاده اليوم، بس التاريخ نفسه للمالك والزبون
    birthday: hidePhone ? null : m.birthday || null,
    birthdayToday: !!m.birthday && perks.isBirthdayToday(m.birthday, perks.localTime(shop.country)),
    credit: (m.credit || 0) / 1000,
    expiresAt: shop.expiry_months > 0 && m.balance > 0 ? pointsExpireAt(shop, m) : null,
  };
}

// صلاحية النقاط: بتنتهي إذا ما زار الزبون عدد أشهر (والعدّ بيبلّش من يوم ما تفعّلت الميزة كحد أدنى)
const MONTH = 30 * 864e5;
function pointsExpireAt(shop, m) {
  const activity = Math.max(m.last_visit || m.created_at, shop.expiry_since || 0);
  return activity + shop.expiry_months * MONTH;
}

// شكل الزبون حسب مين بيطلب: صاحب المحل بيشوف كل إشي، الموظف بدون الرقم
const viewFor = (c, m) => memberView(m, c.shop, c.user?.role === 'staff');

const logoUrl = (shop, origin) => `${origin}/media/logo/${shop.id}.png?v=${shop.logo_version}`;

// رابط المنيو (للبطاقة والمحفظة) بس إذا المحل عنده أصناف متوفرة أو ملف PDF، عشان ما نودّي الزبون لصفحة فاضية
async function menuUrlOf(c, shop) {
  const row = await c.db.get('SELECT 1 AS x FROM shops s WHERE s.id = ? AND (s.menu_pdf > 0 OR EXISTS (SELECT 1 FROM menu_items WHERE shop_id = s.id AND available = 1))', shop.id);
  return row ? `${c.origin}/m/${shop.slug}` : null;
}

// ─── Google Wallet ───
async function syncClass(c, shop) {
  const cfg = gw.googleConfig(c.env);
  if (!cfg) return { enabled: false };
  try {
    await gw.upsertClass(cfg, gw.buildClass(cfg, shop, c.origin, { menuUrl: await menuUrlOf(c, shop) }));
    shop.gw_synced_at = Date.now();
    await c.db.run('UPDATE shops SET gw_synced_at = ?, gw_error = NULL WHERE id = ?', shop.gw_synced_at, shop.id);
    return { enabled: true, ok: true };
  } catch (e) {
    await c.db.run('UPDATE shops SET gw_error = ? WHERE id = ?', String(e.message).slice(0, 500), shop.id);
    return { enabled: true, ok: false, error: e.message };
  }
}

function googleStatus(c, shop) {
  return { enabled: !!gw.googleConfig(c.env), syncedAt: shop.gw_synced_at || null, error: shop.gw_error || null };
}

// بعد أي تغيير بالنقاط: نحدّث البطاقة بمحفظة الزبون بالخلفية (بدون ما نأخّر الكاشير)
function pushMember(c, shop, member) {
  const cfg = gw.googleConfig(c.env);
  if (!cfg || !member.gw_object) return;
  c.waitUntil(gw.patchObject(cfg, gw.buildObject(cfg, shop, member, c.origin)).catch((e) => console.error('gwallet patch:', e.message)));
}

async function googleSave(c, token) {
  const m = TOKEN_RE.test(token) ? await c.db.get('SELECT * FROM members WHERE token = ?', token) : null;
  if (!m) return notFound(c);
  const cfg = gw.googleConfig(c.env);
  if (!cfg) return new Response(null, { status: 302, headers: { location: `/c/${token}?gw=off` } });
  const shop = await shopRow(c.db, m.shop_id);
  const obj = gw.buildObject(cfg, shop, m, c.origin);
  let url;
  try {
    if (!shop.gw_synced_at) {
      const s = await syncClass(c, shop);
      if (!s.ok) throw new Error(s.error);
    }
    await gw.upsertObject(cfg, obj);
    url = await gw.saveUrl(cfg, c.origin, { objects: [{ id: obj.id, classId: obj.classId }] });
  } catch (e) {
    // لو الـ API ما زبط، منبعت الفئة والبطاقة كاملين جوّا الرابط و Google بتنشئهم وقت الحفظ
    console.error('gwallet save:', e.message);
    url = await gw.saveUrl(cfg, c.origin, { classes: [gw.buildClass(cfg, shop, c.origin, { menuUrl: await menuUrlOf(c, shop) })], objects: [obj] });
  }
  await c.db.run('UPDATE members SET gw_object = 1 WHERE id = ?', m.id);
  return new Response(null, { status: 302, headers: { location: url, 'cache-control': 'no-store' } });
}

// ─── Apple Wallet ───
// الإعداد بينحفظ بقاعدة البيانات (صف واحد): المفتاح الخاص، الشهادة من Apple، ورقم الفريق
async function appleConfig(c, { withKey = true } = {}) {
  const row = await c.db.get('SELECT * FROM apple_config WHERE id = 1');
  if (!row || !row.cert || !row.private_key) return null;
  return {
    passTypeId: row.pass_type_id,
    teamId: row.team_id,
    authSecret: row.auth_secret,
    certExpires: row.cert_expires,
    ...(withKey ? { pkcs8: b64ToBytes(row.private_key), certDer: b64ToBytes(row.cert) } : {}),
    chain: c.env.APPLE_WWDR_PEM ? [pemToDer(c.env.APPLE_WWDR_PEM)] : undefined,
  };
}

async function passImages(c, shop) {
  const row = await c.db.get('SELECT mime, data FROM shop_logos WHERE shop_id = ?', shop.id);
  const png = row && row.mime === 'image/png' ? b64ToBytes(row.data) : await defaultLogoPng(shop.color, 180);
  return { 'icon.png': png, 'icon@2x.png': png, 'logo.png': png, 'logo@2x.png': png };
}

async function pkpassFor(c, cfg, member) {
  const shop = await shopRow(c.db, member.shop_id);
  const passJson = apple.buildPassJson(shop, member, { ...cfg, origin: c.origin, authToken: await apple.authTokenFor(cfg.authSecret, member.token), menuUrl: await menuUrlOf(c, shop) });
  const bytes = await apple.buildPkpass({ passJson, images: await passImages(c, shop), ...cfg });
  const updated = Math.max(member.updated_at || member.created_at, shop.updated_at || shop.created_at);
  return { bytes, updated };
}

function pkpassResponse(bytes, updated, extra = {}) {
  return new Response(bytes, {
    headers: {
      'content-type': 'application/vnd.apple.pkpass',
      'content-disposition': 'attachment; filename="card.pkpass"',
      'last-modified': new Date(Math.floor(updated / 1000) * 1000).toUTCString(),
      'cache-control': 'no-store',
      ...extra,
    },
  });
}

// تعريف «تطبيق» البطاقة لما تنضاف للشاشة الرئيسية (لازم للإشعارات على الآيفون)
async function cardManifest(c, token) {
  const m = TOKEN_RE.test(token) ? await c.db.get('SELECT * FROM members WHERE token = ?', token) : null;
  if (!m) return notFound(c);
  const shop = await shopRow(c.db, m.shop_id);
  const body = {
    name: `بطاقة ${shop.name}`,
    short_name: shop.name,
    start_url: `/c/${token}`,
    scope: '/',
    display: 'standalone',
    dir: 'rtl',
    lang: 'ar',
    background_color: '#f6f4f1',
    theme_color: shop.color,
    icons: [{ src: logoUrl(shop, c.origin), sizes: '256x256', type: 'image/png', purpose: 'any' }],
  };
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'no-cache' } });
}

async function appleSave(c, token) {
  const m = TOKEN_RE.test(token) ? await c.db.get('SELECT * FROM members WHERE token = ?', token) : null;
  if (!m) return notFound(c);
  const cfg = await appleConfig(c);
  if (!cfg) return new Response(null, { status: 302, headers: { location: `/c/${token}?apple=off` } });
  const { bytes, updated } = await pkpassFor(c, cfg, m);
  return pkpassResponse(bytes, updated);
}

// خدمة Apple لتحديث البطاقات (PassKit Web Service): ‎/apple/v1/…
const ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
async function appleService(c) {
  const parts = c.url.pathname.split('/').slice(3); // بعد ‎/apple/v1/
  const method = c.req.method;
  if (method === 'POST' && parts[0] === 'log') {
    const body = await c.req.json().catch(() => ({}));
    for (const line of (body.logs || []).slice(0, 20)) console.log('apple wallet:', String(line).slice(0, 300));
    return new Response(null, { status: 200 });
  }
  const cfg = await appleConfig(c);
  if (!cfg) return new Response(null, { status: 404 });
  const authorized = async (serial) => {
    const header = c.req.headers.get('authorization') || '';
    const want = `ApplePass ${await apple.authTokenFor(cfg.authSecret, serial)}`;
    if (header.length !== want.length) return false;
    let diff = 0;
    for (let i = 0; i < want.length; i++) diff |= header.charCodeAt(i) ^ want.charCodeAt(i);
    return diff === 0;
  };
  // تسجيل جهاز / إلغاء تسجيله
  if (parts[0] === 'devices' && parts[2] === 'registrations' && parts.length === 5 && (method === 'POST' || method === 'DELETE')) {
    const [, device, , passType, serial] = parts;
    if (!ID_RE.test(device) || passType !== cfg.passTypeId || !TOKEN_RE.test(serial)) return new Response(null, { status: 404 });
    if (!(await authorized(serial))) return new Response(null, { status: 401 });
    if (method === 'DELETE') {
      await c.db.run('DELETE FROM apple_regs WHERE device_id = ? AND serial = ?', device, serial);
      return new Response(null, { status: 200 });
    }
    if (!(await c.db.get('SELECT id FROM members WHERE token = ?', serial))) return new Response(null, { status: 404 });
    const body = await c.req.json().catch(() => ({}));
    const pushToken = clean(body.pushToken, 200);
    if (!pushToken) return new Response(null, { status: 400 });
    const existing = await c.db.get('SELECT push_token FROM apple_regs WHERE device_id = ? AND serial = ?', device, serial);
    await c.db.run('INSERT OR REPLACE INTO apple_regs (device_id, serial, push_token, created_at) VALUES (?, ?, ?, ?)', device, serial, pushToken, Date.now());
    return new Response(null, { status: existing ? 200 : 201 });
  }
  // شو البطاقات اللي تغيّرت على هالجهاز
  if (method === 'GET' && parts[0] === 'devices' && parts[2] === 'registrations' && parts.length === 4) {
    const [, device, , passType] = parts;
    if (!ID_RE.test(device) || passType !== cfg.passTypeId) return new Response(null, { status: 404 });
    const since = Number(c.url.searchParams.get('passesUpdatedSince')) || 0;
    const rows = await c.db.all(
      `SELECT m.token AS serial, MAX(COALESCE(m.updated_at, m.created_at), COALESCE(s.updated_at, s.created_at)) AS upd
       FROM apple_regs r JOIN members m ON m.token = r.serial JOIN shops s ON s.id = m.shop_id WHERE r.device_id = ?`, device,
    );
    const changed = rows.filter((r) => r.upd > since);
    if (!changed.length) return new Response(null, { status: 204 });
    return json({ serialNumbers: changed.map((r) => r.serial), lastUpdated: String(Math.max(...changed.map((r) => r.upd))) });
  }
  // آخر نسخة من بطاقة
  if (method === 'GET' && parts[0] === 'passes' && parts.length === 3) {
    const [, passType, serial] = parts;
    if (passType !== cfg.passTypeId || !TOKEN_RE.test(serial)) return new Response(null, { status: 404 });
    if (!(await authorized(serial))) return new Response(null, { status: 401 });
    const m = await c.db.get('SELECT * FROM members WHERE token = ?', serial);
    if (!m) return new Response(null, { status: 404 });
    const { bytes, updated } = await pkpassFor(c, cfg, m);
    const ims = Date.parse(c.req.headers.get('if-modified-since') || '');
    if (ims && Math.floor(updated / 1000) * 1000 <= ims) return new Response(null, { status: 304 });
    return pkpassResponse(bytes, updated);
  }
  return new Response(null, { status: 404 });
}

// إعداد Apple من لوحة مدير المنصة: طلب شهادة ← رفع الشهادة من Apple
async function adminApple(c) {
  await requireAdmin(c);
  const row = await c.db.get('SELECT * FROM apple_config WHERE id = 1');
  return json({
    hasKey: !!(row && row.private_key),
    configured: !!(row && row.cert),
    passTypeId: (row && row.pass_type_id) || null,
    teamId: (row && row.team_id) || null,
    certExpires: (row && row.cert_expires) || null,
  });
}

// المتصفح بيولّد المفتاح وطلب الشهادة (توليد RSA تقيل على حد وقت Cloudflare)، والسيرفر بيتحقق وبيحفظ
async function adminAppleKey(c) {
  await requireAdmin(c);
  const row = await c.db.get('SELECT * FROM apple_config WHERE id = 1');
  if (row && row.cert && !c.body.regenerate) fail(409, 'Apple Wallet مفعّل. طلب جديد بيوقف البطاقات لحد ما ترفع شهادة جديدة');
  let pkcs8;
  let spki;
  try { pkcs8 = b64ToBytes(String(c.body.privateKey || '')); spki = b64ToBytes(String(c.body.publicKey || '')); } catch { fail(400, 'المفتاح مش صالح'); }
  if (pkcs8.length > 4096 || spki.length > 1024 || !(await apple.keyPairMatches(pkcs8, spki))) fail(400, 'المفتاح مش صالح');
  await c.db.run(
    `INSERT INTO apple_config (id, private_key, public_key, cert, pass_type_id, team_id, cert_expires, auth_secret, updated_at)
     VALUES (1, ?, ?, NULL, NULL, NULL, NULL, ?, ?)
     ON CONFLICT(id) DO UPDATE SET private_key = excluded.private_key, public_key = excluded.public_key, cert = NULL, pass_type_id = NULL, team_id = NULL, cert_expires = NULL, updated_at = excluded.updated_at`,
    bytesToB64(pkcs8), bytesToB64(spki), (row && row.auth_secret) || randomToken(32), Date.now(),
  );
  return adminApple(c);
}

async function adminAppleCert(c) {
  await requireAdmin(c);
  const row = await c.db.get('SELECT * FROM apple_config WHERE id = 1');
  if (!row || !row.public_key) fail(400, 'اعمل طلب الشهادة (CSR) أول');
  const input = String(c.body.cert || '').trim();
  let der;
  try { der = /-----BEGIN/.test(input) ? pemToDer(input) : b64ToBytes(input.replace(/\s+/g, '')); } catch { fail(400, 'ملف الشهادة مش صالح'); }
  let info;
  try { info = apple.parseCertificate(der); } catch { fail(400, 'ملف الشهادة مش صالح. ارفع ملف pass.cer اللي نزّلته من Apple'); }
  if (bytesToB64(info.spkiRaw) !== row.public_key) fail(400, 'هالشهادة مش مبنية على آخر طلب (CSR) عملته من هون. ارفع الشهادة الصحيحة أو اعمل طلب جديد');
  if (!info.passTypeId || !info.passTypeId.startsWith('pass.') || !info.teamId) fail(400, 'هاي مش شهادة Pass Type ID');
  if (info.notAfter && info.notAfter < Date.now()) fail(400, 'هالشهادة منتهية');
  await c.db.run('UPDATE apple_config SET cert = ?, pass_type_id = ?, team_id = ?, cert_expires = ?, updated_at = ? WHERE id = 1',
    bytesToB64(der), info.passTypeId, info.teamId, info.notAfter, Date.now());
  return adminApple(c);
}

// ─── إشعارات الويب ───
async function vapidKeys(c) {
  let row = await c.db.get('SELECT * FROM push_config WHERE id = 1');
  if (!row) {
    const k = await webpush.generateVapidKeys();
    await c.db.run('INSERT OR IGNORE INTO push_config (id, public_key, private_key, created_at) VALUES (1, ?, ?, ?)', k.publicKey, k.privateKey, Date.now());
    row = await c.db.get('SELECT * FROM push_config WHERE id = 1');
  }
  return { publicKey: row.public_key, privateKey: row.private_key };
}

async function pushKey(c) {
  return json({ publicKey: (await vapidKeys(c)).publicKey });
}

// بيحفظ اشتراك الجهاز (أو بيحدّثه) وبيرجّع الزبون والاشتراك
async function saveSubscription(c, token) {
  const m = await c.db.get('SELECT * FROM members WHERE token = ?', token);
  if (!m) fail(404, 'ما لقينا هالبطاقة');
  await rateLimit(c, `pushsub:${c.ip}`, 30, 60 * MIN);
  const { endpoint, p256dh, auth: authKey } = readSubscription(c.body);
  await c.db.batch([
    [`INSERT INTO push_subs (shop_id, member_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint, member_id) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`, [m.shop_id, m.id, endpoint, p256dh, authKey, Date.now()]],
    // آخر 5 أجهزة لكل زبون
    ['DELETE FROM push_subs WHERE member_id = ? AND id NOT IN (SELECT id FROM push_subs WHERE member_id = ? ORDER BY id DESC LIMIT 5)', [m.id, m.id]],
  ]);
  return { m, sub: await c.db.get('SELECT * FROM push_subs WHERE member_id = ? AND endpoint = ?', m.id, endpoint) };
}

async function cardPushSubscribe(c, token) {
  await saveSubscription(c, token);
  return json({ ok: true }, 201);
}

// إشعار تجريبي لنفس الجهاز، والنتيجة بترجع فوراً للبطاقة (عشان نعرف إذا Apple/Google استلموه أو ليش رفضوه)
async function cardPushTest(c, token) {
  const { m, sub } = await saveSubscription(c, token);
  await rateLimit(c, `pushtest:${m.id}`, 8, 60 * MIN, 'جرّبت كتير، استنى شوي وجرّب كمان مرة');
  const shop = await shopRow(c.db, m.shop_id);
  const r = await pushTo(c, [sub], () => demoSafe(shop, {
    title: shop.name,
    body: isEn(m) ? 'All set! Notifications work ✅ You’ll be notified every time you earn points.' : 'تمام! الإشعارات شغّالة ✅ رح يوصلك إشعار كل ما تنضافلك نقاط.',
    icon: logoUrl(shop, c.origin),
    url: `${c.origin}/c/${m.token}`,
  }));
  const x = r.results[0];
  return json({ result: x.result, reason: x.reason });
}

async function cardPushUnsubscribe(c, token) {
  const m = await c.db.get('SELECT id FROM members WHERE token = ?', token);
  if (!m) fail(404, 'ما لقينا هالبطاقة');
  await c.db.run('DELETE FROM push_subs WHERE member_id = ? AND endpoint = ?', m.id, String(c.body.endpoint || ''));
  return json({ ok: true });
}

// بيبعت لكل اشتراك رسالته، وبيسجّل النتيجة، وبيحذف الاشتراكات اللي انتهت
async function pushTo(c, subs, messageFor, table = 'push_subs') {
  const out = { ok: 0, error: 0, results: [] };
  if (!subs.length) return out;
  const vapid = await vapidKeys(c);
  const opts = { vapid, subject: c.env.VAPID_SUBJECT || c.origin, fetchImpl: c.env.fetch || ((...a) => fetch(...a)), cache: new Map() };
  out.results = await Promise.all(subs.map((s) => webpush.sendPush(s, messageFor(s), opts)));
  const now = Date.now();
  const writes = out.results.map((r, i) => {
    if (r.result === 'ok') out.ok++; else out.error++;
    if (r.result === 'error') console.error('web push:', new URL(subs[i].endpoint).host, r.reason);
    return r.result === 'gone'
      ? [`DELETE FROM ${table} WHERE endpoint = ?`, [subs[i].endpoint]]
      : [`UPDATE ${table} SET last_at = ?, last_error = ? WHERE id = ?`, [now, r.reason, subs[i].id]];
  });
  await c.db.batch(writes);
  return out;
}

// ─── إشعارات لأصحاب المحلات ومدير المنصة (على اللوحة) ───
function readSubscription(body) {
  const endpoint = String(body.endpoint || '');
  const keys = body.keys || {};
  const p256dh = String(keys.p256dh || '');
  const authKey = String(keys.auth || '');
  if (!webpush.validEndpoint(endpoint)) fail(400, 'اشتراك الإشعارات مش صالح');
  let ok = false;
  try { ok = webpush.fromB64url(p256dh).length === 65 && webpush.fromB64url(authKey).length === 16; } catch { ok = false; }
  if (!ok) fail(400, 'اشتراك الإشعارات مش صالح');
  return { endpoint, p256dh, auth: authKey };
}

// بحساب العرض في ناس كتير بنفس الحساب، فبعض الإجراءات ممنوعة فيه
function noDemo(c, what = 'هاد الإجراء') {
  if (c.shop && c.shop.demo) fail(403, `${what} مش متاح بحساب العرض. افتح تجربتك المجانية لتجرّبه 🎁`);
}

async function userPushSubscribe(c) {
  noDemo(c, 'تفعيل التنبيهات');
  const sub = readSubscription(c.body);
  await c.db.batch([
    [`INSERT INTO user_push_subs (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(endpoint, user_id) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`, [c.user.id, sub.endpoint, sub.p256dh, sub.auth, Date.now()]],
    ['DELETE FROM user_push_subs WHERE user_id = ? AND id NOT IN (SELECT id FROM user_push_subs WHERE user_id = ? ORDER BY id DESC LIMIT 5)', [c.user.id, c.user.id]],
  ]);
  if (c.body.test) {
    await rateLimit(c, `upushtest:${c.user.id}`, 8, 60 * MIN, 'جرّبت كتير، استنى شوي');
    const row = await c.db.get('SELECT * FROM user_push_subs WHERE user_id = ? AND endpoint = ?', c.user.id, sub.endpoint);
    const r = await pushTo(c, [row], () => ({ title: 'نقاطك', body: 'تمام! رح توصلك هون التنبيهات المهمة ✅', url: `${c.origin}/app` }), 'user_push_subs');
    return json({ result: r.results[0].result, reason: r.results[0].reason }, 201);
  }
  return json({ ok: true }, 201);
}

async function userPushUnsubscribe(c) {
  await c.db.run('DELETE FROM user_push_subs WHERE user_id = ? AND endpoint = ?', c.user.id, String(c.body.endpoint || ''));
  return json({ ok: true });
}

// بيبعت لمستخدمين باللوحة (بالخلفية، وما بيأثر على الطلب لو فشل)
function notifyUsers(c, userIds, message) {
  if (!userIds.length) return;
  c.waitUntil((async () => {
    const subs = await c.db.all(`SELECT * FROM user_push_subs WHERE user_id IN (${userIds.map(() => '?').join(',')})`, ...userIds);
    await pushTo(c, subs, () => ({ url: `${c.origin}/app`, ...message }), 'user_push_subs');
  })().catch((e) => console.error('user push:', e.message)));
}

async function notifyOwners(c, shopId, message) {
  const rows = await c.db.all("SELECT id FROM users WHERE shop_id = ? AND role = 'owner'", shopId);
  notifyUsers(c, rows.map((r) => r.id), message);
}

async function notifyAdmin(c, message) {
  const row = await c.db.get(FIRST_USER);
  if (row && row.id) notifyUsers(c, [row.id], message);
}

// إشعار لزبون واحد (نقاط/مكافأة): بنستنى النتيجة لحد ثانيتين عشان الكاشير يعرف إذا انبعت، والباقي بيكمل بالخلفية
async function notifyMember(c, member, message) {
  const subs = await c.db.all('SELECT * FROM push_subs WHERE member_id = ?', member.id);
  if (!subs.length) return { devices: 0 };
  const job = pushTo(c, subs, () => demoSafe(c.shop, { ...message, url: `${c.origin}/c/${member.token}` }))
    .catch((e) => { console.error('web push:', e.message); return null; });
  c.waitUntil(job);
  let timer;
  const r = await Promise.race([job, new Promise((res) => { timer = setTimeout(res, 2000, 'slow'); })]);
  clearTimeout(timer);
  if (r === 'slow') return { devices: subs.length, pending: true };
  if (!r) return { devices: subs.length, sent: 0, reason: 'خطأ بالسيرفر' };
  return { devices: subs.length, sent: r.ok, reason: r.ok ? null : (r.results.find((x) => x.result !== 'ok') || {}).reason || null };
}

function earnMessage(shop, before, after, perk, ref) {
  const delta = perk.delta;
  const p0 = progress(shop, before.balance);
  const p1 = progress(shop, after.balance);
  const stamps = shop.program_type === 'stamps';
  if (isEn(after)) {
    const extras = [...perk.reasonsEn, ...(ref ? [`👥 +${ref.bonus} invite gift`] : [])];
    const tail = extras.length ? ` (${extras.join(', ')})` : '';
    const body = p1.available > p0.available
      ? `🎁 Your reward is ready: ${shop.reward_name}! Ask for it on your next visit.${tail}`
      : stamps
        ? `You got ${delta} ${unitEn(shop, delta)} ☕${tail} You now have ${p1.toward}/${p1.cost}`
        : `You earned ${delta} ${unitEn(shop, delta)} ☕${tail} Balance: ${after.balance}, ${p1.remaining} to go for ${shop.reward_name}`;
    return { title: shop.name, body };
  }
  const extras = [...perk.reasons, ...(ref ? [`👥 +${ref.bonus} هدية الدعوة`] : [])];
  const tail = extras.length ? ` (${extras.join('، ')})` : '';
  const body = p1.available > p0.available
    ? `🎁 مكافأتك جاهزة: ${shop.reward_name}! اطلبها بزيارتك الجاية.${tail}`
    : stamps
      ? `انضافلك ${delta === 1 ? 'ختم' : `${delta} أختام`} ☕${tail} صار عندك ${p1.toward}/${p1.cost}`
      : `انضافلك ${delta} ${unitWord(shop, delta)} ☕${tail} رصيدك صار ${after.balance}، وباقي ${p1.remaining} لـ ${shop.reward_name}`;
  return { title: shop.name, body };
}

// الرسالة الجماعية بتنبعت على دفعات صغيرة (Cloudflare بيحد وقت المعالجة بكل طلب)، والواجهة بتكمّل الدفعات لحالها
const PUSH_BATCH = 10;
async function broadcastBatch(c, id, cursor) {
  const b = await c.db.get('SELECT * FROM broadcasts WHERE id = ? AND shop_id = ?', id, c.shop.id);
  if (!b) fail(404, 'ما لقينا الرسالة');
  if (c.shop.demo) return { sent: 0, failed: 0, next: null }; // حساب العرض ما بيبعت إشعارات حقيقية
  const subs = await c.db.all(
    'SELECT p.*, m.token FROM push_subs p JOIN members m ON m.id = p.member_id WHERE p.shop_id = ? AND p.id > ? ORDER BY p.id LIMIT ?',
    c.shop.id, cursor, PUSH_BATCH,
  );
  const icon = logoUrl(c.shop, c.origin);
  const r = await pushTo(c, subs, (s) => ({ title: b.header, body: b.body, icon, url: `${c.origin}/c/${s.token}`, tag: `broadcast-${b.id}` }));
  return { sent: r.ok, failed: r.error, next: subs.length === PUSH_BATCH ? subs[subs.length - 1].id : null };
}

async function broadcastContinue(c, id) {
  await requireActive(c);
  const cursor = int(c.body.cursor, 0, Number.MAX_SAFE_INTEGER, 'مؤشر غلط');
  return json({ push: await broadcastBatch(c, Number(id), cursor) });
}

// ─── المهام الدورية (كل 5 دقايق): هدايا عيد الميلاد، طلب التقييم، وتذكير الزبائن الغايبين ───
// الخطة المجانية بـ Cloudflare بتعطي 10ms معالجة لكل تشغيلة، وتشفير الإشعار الواحد بياخد تقريباً 1ms،
// فبنبعت لحد 10 إشعارات بالتشغيلة (120 بالساعة) وبنكمّل بالجاية
const CRON_BUDGET = 10;
const HOUR = 36e5;

export async function runScheduled(ctx, now = Date.now()) {
  const origin = String(ctx.env.PUBLIC_URL || (await getSetting(ctx.db, 'origin')) || '').replace(/\/+$/, '');
  if (!origin) return { skipped: 'ما في رابط للموقع لسا (بينحفظ أول ما حدا يفتح اللوحة)' };
  const platformShop = await platformShopId(ctx.db);
  // live: شرط «المحل شغّال» جوّا الاستعلامات، عشان زبائن المحلات المتوقفة ما يسدّوا الدور على الباقيين
  const c = { ...ctx, origin, budget: CRON_BUDGET, live: { sql: `(s.demo = 1 OR s.id = ? OR COALESCE(s.active_until, s.created_at + ${TRIAL_DAYS * DAY}) > ?)`, args: [platformShop ?? 0, now] } };
  const shops = new Map();
  const shopOf = async (id) => {
    if (!shops.has(id)) {
      const shop = await shopRow(c.db, id);
      shops.set(id, shop && subscriptionOf(shop, platformShop).state !== 'expired' ? shop : null); // shopRow: الأساسي بدون الميزات المميزة
    }
    return shops.get(id);
  };
  const out = { birthdays: 0, reviews: 0, winback: 0 };
  out.birthdays = await birthdayJob(c, shopOf, now);
  if (c.budget > 0) out.reviews = await reviewAskJob(c, shopOf, now);
  if (c.budget > 0) out.winback = await winbackJob(c, shopOf, now);
  if (c.budget > 0) out.summaries = await summaryJob(c, now);
  if (c.budget > 0) out.reminders = await reminderJob(c, platformShop, now);
  out.outreach = await salesOutreachJob(c, now).catch((e) => { console.error('outreach:', e.message); return 0; });
  Object.assign(out, await expiryJob(c, shopOf, now));
  out.giftsRefunded = await giftRefundJob(c, now);
  const day = localDayKey('JO', now);
  // حساب العرض بيرجع لحاله كل يوم الساعة 4 الصبح، أو فوراً لما ينضافله إشي جديد (رقم النسخة تغيّر)
  const demoOld = (await getSetting(c.db, 'demo_version')) !== String(DEMO_VERSION);
  if (((perks.localTime('JO', now).hour >= 4 && (await getSetting(c.db, 'demo_day')) !== day) || demoOld) && (await c.db.get('SELECT id FROM shops WHERE demo = 1 LIMIT 1'))) {
    await setSetting(c.db, 'demo_day', day);
    await setSetting(c.db, 'demo_version', String(DEMO_VERSION));
    await seedDemo(c.db, now);
    out.demoReset = true;
  }
  await c.db.run('DELETE FROM rate_hits WHERE expires_at < ?', now);
  return out;
}

// أجهزة الزبون للإشعارات الدورية (لحد 5، الأحدث). كل مهمة بتتأكد إنه الميزانية بتكفي قبل ما تسجّل إنها بعتت،
// وإذا ما كفّت بتوقف وبتكمّل بالتشغيلة الجاية (5 أجهزة أقل من الميزانية، فدايماً في زبون واحد على الأقل بيمشي)
const cronSubs = (c, m) => c.db.all('SELECT * FROM push_subs WHERE member_id = ? ORDER BY id DESC LIMIT 5', m.id);
async function cronSend(c, shop, m, subs, message) {
  if (!subs.length) return;
  c.budget -= subs.length;
  await pushTo(c, subs, () => demoSafe(shop, { icon: logoUrl(shop, c.origin), url: `${c.origin}/c/${m.token}`, title: shop.name, ...message }));
}

// حساب العرض: أي زائر بيقدر يغيّر اسم المحل ونصوصه، فإشعاراته لأجهزة حقيقية بنص ثابت (ما بتنستعمل لرسائل غريبة)
const demoSafe = (shop, message) => (shop && shop.demo
  ? { ...message, title: 'كوفي العرض (تجربة)', body: 'هيك بيوصل الإشعار لزبائنك مع كل نقاط ومكافأة ✅ هاد حساب العرض بنقاطك' }
  : message);

// 🎂 يوم عيد الميلاد (بتوقيت المحل، من 9 الصبح): الهدية بتنضاف للرصيد وبيوصله إشعار
async function birthdayJob(c, shopOf, now) {
  const near = [-1, 0, 1].map((d) => new Date(now + d * DAY).toISOString().slice(5, 10));
  // مواليد 29 شباط بيحتفلوا 28 شباط بالسنين العادية، فبنجيبهم بس حوالين آخر شباط (وما بياخدوا من دور غيرهم طول السنة)
  const mds = [...new Set(near.some((d) => d >= '02-27' && d <= '03-01') ? [...near, '02-29'] : near)];
  // اللي أخدوا هديتهم هالسنة بيجوا آخر الدور، عشان ما ياخدوا مكان اللي لسا ما أخدوها
  const rows = await c.db.all(
    `SELECT m.* FROM members m JOIN shops s ON s.id = m.shop_id
     WHERE m.birthday IN (${mds.map(() => '?').join(', ')}) AND m.bday_set_at <= ? AND s.bday_on = 1 AND ${PRO_SQL} AND ${c.live.sql}
     ORDER BY (m.bday_year IS NOT NULL AND m.bday_year >= ?), m.id LIMIT 200`,
    ...mds, now - perks.BDAY_MIN_AGE_DAYS * DAY, ...c.live.args, new Date(now).getUTCFullYear(),
  );
  let n = 0;
  for (const m of rows) {
    const shop = await shopOf(m.shop_id);
    if (!shop || !shop.bday_on) continue;
    const t = perks.localTime(shop.country, now);
    if (m.bday_year === t.year || !perks.isBirthdayToday(m.birthday, t) || t.hour < 9 || t.hour > 21) continue;
    const gift = perks.bdayGift(shop);
    const wallet = gift > 0 && m.gw_object && gw.googleConfig(c.env);
    const subs = await cronSubs(c, m);
    if (subs.length + (wallet ? 2 : 0) > c.budget) break;
    const due = 'id = ? AND (bday_year IS NULL OR bday_year <> ?)';
    const res = await c.db.batch([
      ...(gift > 0 ? [[`INSERT INTO txns (shop_id, member_id, kind, delta, note, created_at) SELECT shop_id, id, 'adjust', ?, '🎂 هدية عيد الميلاد', ? FROM members WHERE ${due}`, [gift, now, m.id, t.year]]] : []),
      [`UPDATE members SET balance = balance + ?, bday_year = ?, updated_at = ? WHERE ${due}`, [gift, t.year, now, m.id, t.year]],
    ]);
    if (!res[res.length - 1].changes) continue;
    n++;
    const first = perks.firstName(m.name);
    const body = isEn(m)
      ? (gift <= 0 ? `Happy birthday, ${first}! 🎉 From all of us at ${shop.name}`
        : gift === rewardCost(shop) ? `Happy birthday, ${first}! 🎉 ${shop.reward_name} is on us today, it’s already on your card 🎁`
          : `Happy birthday, ${first}! 🎉 You got ${gift} ${unitEn(shop, gift)} as a birthday gift 🎁`)
      : gift <= 0 ? `كل سنة وإنت سالم يا ${first}! 🎉 من كل فريق ${shop.name}`
        : gift === rewardCost(shop) ? `كل سنة وإنت سالم يا ${first}! 🎉 ${shop.reward_name} اليوم علينا، الهدية صارت بحسابك 🎁`
          : `كل سنة وإنت سالم يا ${first}! 🎉 انضافلك ${gift} ${unitWord(shop, gift)} هدية عيدك 🎁`;
    if (wallet) {
      c.budget -= 2;
      pushMember(c, shop, await c.db.get('SELECT * FROM members WHERE id = ?', m.id));
    }
    await cronSend(c, shop, m, subs, { title: `${shop.name} 🎂`, body });
  }
  return n;
}

// ⭐ بعد الزيارة بساعة لـ 6 ساعات: «كيف كانت زيارتك؟» (مرة كل شهر بالكتير، ومش بالليل)
async function reviewAskJob(c, shopOf, now) {
  const rows = await c.db.all(
    `SELECT m.* FROM members m JOIN shops s ON s.id = m.shop_id
     WHERE m.last_visit BETWEEN ? AND ? AND (m.review_ask_at IS NULL OR m.review_ask_at < ?) AND s.review_on = 1 AND ${PRO_SQL} AND ${c.live.sql}
       AND EXISTS (SELECT 1 FROM push_subs p WHERE p.member_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.member_id = m.id AND r.created_at > m.last_visit)
     ORDER BY m.last_visit LIMIT 200`,
    now - 6 * HOUR, now - HOUR, now - 30 * DAY, ...c.live.args,
  );
  let n = 0;
  for (const m of rows) {
    const shop = await shopOf(m.shop_id);
    if (!shop || !shop.review_on) continue;
    const t = perks.localTime(shop.country, now);
    if (t.hour < 9 || t.hour > 22) continue;
    const subs = await cronSubs(c, m);
    if (subs.length > c.budget) break;
    const r = await c.db.run('UPDATE members SET review_ask_at = ? WHERE id = ? AND (review_ask_at IS NULL OR review_ask_at < ?)', now, m.id, now - 30 * DAY);
    if (!r.changes || !subs.length) continue;
    const body = isEn(m) ? `How was your visit to ${shop.name} today? Rate us in one tap ⭐` : `كيف كانت زيارتك لـ ${shop.name} اليوم؟ قيّمنا بكبسة ⭐`;
    await cronSend(c, shop, m, subs, { body, url: `${c.origin}/c/${m.token}?rate=1` });
    n++;
  }
  return n;
}

// 💤 الزبون اللي غاب (حسب إعداد المحل): «اشتقنالك» مع نقاط دبل لـ 3 أيام، مرة وحدة لكل غيبة
async function winbackJob(c, shopOf, now) {
  const rows = await c.db.all(
    `SELECT m.* FROM members m JOIN shops s ON s.id = m.shop_id
     WHERE s.winback_days > 0 AND COALESCE(m.last_visit, m.created_at) < ? - s.winback_days * ${DAY} AND ${PRO_SQL} AND ${c.live.sql}
       AND (m.nudged_at IS NULL OR m.nudged_at < COALESCE(m.last_visit, m.created_at))
       AND EXISTS (SELECT 1 FROM push_subs p WHERE p.member_id = m.id)
     ORDER BY COALESCE(m.last_visit, m.created_at) LIMIT 200`,
    now, ...c.live.args,
  );
  let n = 0;
  for (const m of rows) {
    const shop = await shopOf(m.shop_id);
    if (!shop) continue;
    const t = perks.localTime(shop.country, now);
    if (t.hour < 11 || t.hour > 20) continue;
    const subs = await cronSubs(c, m);
    if (subs.length > c.budget) break;
    if (!subs.length) continue; // ما في جهاز: ما بنعطيه نقاط دبل ما رح يعرف عنها
    const boost = shop.winback_double ? now + 3 * DAY : m.boost_until;
    const r = await c.db.run('UPDATE members SET nudged_at = ?, boost_until = ? WHERE id = ? AND (nudged_at IS NULL OR nudged_at < COALESCE(last_visit, created_at))', now, boost, m.id);
    if (!r.changes) continue;
    const first = perks.firstName(m.name);
    const en = isEn(m) && !shop.winback_text;
    const text = (shop.winback_text || (en ? 'We miss you, {الاسم} ☕ Come see us soon' : 'اشتقنالك يا {الاسم} ☕ مرّ علينا قريب')).replaceAll('{الاسم}', () => first);
    const body = shop.winback_double ? `${text}${en ? ' — double points for 3 days 🎁' : ' — نقاطك دبل لـ 3 أيام 🎁'}` : text;
    await cronSend(c, shop, m, subs, { body });
    n++;
  }
  return n;
}

// ⏳ صلاحية النقاط: تذكير قبل أسبوع (للي مفعّل الإشعارات)، وبعدين النقاط بتنتهي
async function expiryJob(c, shopOf, now) {
  const activity = 'MAX(COALESCE(m.last_visit, m.created_at), COALESCE(s.expiry_since, 0))';
  const ends = `${activity} + s.expiry_months * ${MONTH}`;
  const warn = await c.db.all(
    `SELECT m.*, ${ends} AS ends FROM members m JOIN shops s ON s.id = m.shop_id
     WHERE s.expiry_months > 0 AND m.balance > 0 AND ${ends} - ${7 * DAY} < ? AND ${PRO_SQL} AND ${c.live.sql}
       AND (m.expiry_warned_at IS NULL OR m.expiry_warned_at < ${activity})
       AND EXISTS (SELECT 1 FROM push_subs p WHERE p.member_id = m.id)
     ORDER BY ends LIMIT 200`, now, ...c.live.args,
  );
  let warned = 0;
  for (const m of warn) {
    const shop = await shopOf(m.shop_id);
    if (!shop) continue;
    const t = perks.localTime(shop.country, now);
    if (t.hour < 11 || t.hour > 20) continue;
    const subs = await cronSubs(c, m);
    if (subs.length > c.budget) break;
    await c.db.run('UPDATE members SET expiry_warned_at = ? WHERE id = ?', now, m.id);
    // اللي فاتت صلاحيته وهو ما وصله تذكير (متل محل كان متوقف ورجع): بياخد أسبوع من هلق
    const days = Math.max(1, Math.round((m.ends > now ? m.ends - now : 7 * DAY) / DAY));
    const body = isEn(m) ? `⏳ Your ${m.balance} ${unitEn(shop, m.balance)} expire in ${days} day${days === 1 ? '' : 's'}. Drop by and use them ☕`
      : `⏳ عندك ${m.balance} ${unitWord(shop, m.balance)} بتنتهي بعد ${days} ${days === 1 ? 'يوم' : 'أيام'}. مرّ علينا واستعملها ☕`;
    if (!subs.length) continue;
    await cronSend(c, shop, m, subs, { body });
    warned++;
  }
  const due = await c.db.all(
    `SELECT m.* FROM members m JOIN shops s ON s.id = m.shop_id WHERE s.expiry_months > 0 AND m.balance > 0 AND ${ends} <= ? AND ${PRO_SQL} AND ${c.live.sql}
       AND (NOT EXISTS (SELECT 1 FROM push_subs p WHERE p.member_id = m.id)
         OR (m.expiry_warned_at >= ${activity} AND m.expiry_warned_at <= ?))
     ORDER BY ${ends} LIMIT 100`, now, ...c.live.args, now - 6 * DAY,
  );
  let expired = 0;
  for (const m of due) {
    const shop = await shopOf(m.shop_id);
    if (!shop) continue; // محل متوقف: ما بنمسح نقاط زبائنه
    const res = await c.db.batch([
      ["INSERT INTO txns (shop_id, member_id, kind, delta, note, created_at) SELECT shop_id, id, 'adjust', -balance, '⏳ انتهت صلاحية النقاط', ? FROM members WHERE id = ? AND balance = ?", [now, m.id, m.balance]],
      ['UPDATE members SET balance = 0, updated_at = ? WHERE id = ? AND balance = ?', [now, m.id, m.balance]],
    ]);
    if (!res[1].changes) continue;
    expired++;
    if (m.gw_object && gw.googleConfig(c.env) && c.budget >= 2) {
      c.budget -= 2;
      pushMember(c, shop, await c.db.get('SELECT * FROM members WHERE id = ?', m.id));
    }
  }
  return { expiryWarned: warned, expired };
}

// ⏳ تذكير صاحب المحل قبل ما تخلص التجربة أو الاشتراك (قبل 3 أيام وقبل يوم)، للي مفعّل التنبيهات
async function reminderJob(c, platformShop, now) {
  const shops = await c.db.all(
    `SELECT s.* FROM shops s WHERE s.demo = 0 AND s.id <> ? AND COALESCE(s.active_until, s.created_at + ${TRIAL_DAYS * DAY}) BETWEEN ? AND ?
       AND EXISTS (SELECT 1 FROM users u JOIN user_push_subs p ON p.user_id = u.id WHERE u.shop_id = s.id AND u.role = 'owner')`,
    platformShop ?? 0, now, now + 3 * DAY + HOUR,
  );
  let n = 0;
  for (const shop of shops) {
    const sub = subscriptionOf(shop, platformShop);
    const left = Math.ceil((sub.until - now) / DAY);
    if (![1, 3].includes(left) || c.budget <= 0) continue;
    const t = perks.localTime(shop.country, now);
    if (t.hour < 10 || t.hour > 20) continue;
    const key = `${sub.until}:${left}`;
    if (shop.reminder_key === key) continue;
    const owners = await c.db.all("SELECT p.* FROM user_push_subs p JOIN users u ON u.id = p.user_id WHERE u.shop_id = ? AND u.role = 'owner' ORDER BY p.id DESC LIMIT 5", shop.id);
    if (owners.length > c.budget) break;
    await c.db.run('UPDATE shops SET reminder_key = ? WHERE id = ?', key, shop.id);
    c.budget -= owners.length;
    const when = left === 1 ? 'بكرة' : 'بعد 3 أيام';
    const body = sub.state === 'trial'
      ? `⏳ تجربتك المجانية بنقاطك بتخلص ${when}. اشترك من ⚙️ الإعدادات عشان ما يوقف الكاشير، وزبائنك ونقاطهم محفوظين.`
      : `⏳ اشتراكك بنقاطك بيخلص ${when}. جدّد من ⚙️ الإعدادات عشان ما يوقف الكاشير.`;
    await pushTo(c, owners, () => ({ title: shop.name, body, url: `${c.origin}/app#settings` }), 'user_push_subs');
    n++;
  }
  return n;
}

// 🎁 الهدية اللي ما انستلمت خلال 30 يوم بترجع لصاحبها
async function giftRefundJob(c, now) {
  const due = await c.db.all('SELECT * FROM credit_gifts WHERE claimed_at IS NULL AND refunded_at IS NULL AND created_at <= ? LIMIT 50', now - GIFT_DAYS * DAY);
  let n = 0;
  for (const g of due) {
    const tag = `gift-back:${g.id}`; // مفتاح فريد: لو اشتغلت تشغيلتين سوا، التانية بتفشل كلها
    try {
      const res = await c.db.batch([
        ['UPDATE credit_gifts SET refunded_at = ? WHERE id = ? AND claimed_at IS NULL AND refunded_at IS NULL', [now, g.id]],
        ["INSERT INTO credit_txns (shop_id, member_id, kind, amount, note, idem, created_at) SELECT ?, id, 'topup', ?, '↩️ رجعت هدية ما انستلمت', ?, ? FROM members WHERE id = ? AND EXISTS (SELECT 1 FROM credit_gifts WHERE id = ? AND refunded_at = ?)", [g.shop_id, g.amount, tag, now, g.from_member, g.id, now]],
        ['UPDATE members SET credit = credit + ? WHERE id = ? AND EXISTS (SELECT 1 FROM credit_txns WHERE shop_id = ? AND idem = ? AND member_id = ? AND created_at = ?)', [g.amount, g.from_member, g.shop_id, tag, g.from_member, now]],
      ]);
      if (res[0].changes) n++;
    } catch (e) {
      if (!isUniqueError(e)) throw e;
    }
  }
  return n;
}

// 📊 ملخص اليوم لصاحب المحل الساعة 10 بالليل (بتوقيته)، للي مفعّل الإشعارات على اللوحة
async function summaryJob(c, now) {
  const shops = await c.db.all(
    `SELECT s.* FROM shops s WHERE s.demo = 0 AND ${PRO_SQL} AND ${c.live.sql} AND EXISTS (SELECT 1 FROM users u JOIN user_push_subs p ON p.user_id = u.id WHERE u.shop_id = s.id AND u.role = 'owner')`,
    ...c.live.args,
  );
  let n = 0;
  for (const shop of shops) {
    const t = perks.localTime(shop.country, now);
    const day = t.year * 10000 + t.month * 100 + t.day;
    if (t.hour < 22 || shop.summary_day === day) continue;
    const owners = await c.db.all("SELECT p.* FROM user_push_subs p JOIN users u ON u.id = p.user_id WHERE u.shop_id = ? AND u.role = 'owner' ORDER BY p.id DESC LIMIT 5", shop.id);
    if (owners.length > c.budget) break;
    const r = await c.db.run('UPDATE shops SET summary_day = ? WHERE id = ? AND (summary_day IS NULL OR summary_day <> ?)', day, shop.id, day);
    if (!r.changes) continue;
    const start = now - (t.mins * 60 + new Date(now).getUTCSeconds()) * 1000;
    const [v, j, rd] = await Promise.all([
      c.db.get("SELECT COUNT(*) AS n FROM txns WHERE shop_id = ? AND kind = 'earn' AND created_at >= ?", shop.id, start),
      c.db.get('SELECT COUNT(*) AS n FROM members WHERE shop_id = ? AND created_at >= ?', shop.id, start),
      c.db.get("SELECT COUNT(*) AS n FROM txns WHERE shop_id = ? AND kind = 'redeem' AND created_at >= ?", shop.id, start),
    ]);
    c.budget -= owners.length;
    await pushTo(c, owners, () => ({ title: `📊 ملخص اليوم · ${shop.name}`, body: `${v.n} زيارة · ${j.n} زبون جديد · ${rd.n} مكافأة`, url: `${c.origin}/app#activity` }), 'user_push_subs');
    n++;
  }
  return n;
}

async function getSetting(db, k) {
  const row = await db.get('SELECT v FROM platform_settings WHERE k = ?', k);
  return row ? row.v : null;
}

async function jsonSetting(db, k) {
  try { return JSON.parse((await getSetting(db, k)) || 'null'); } catch { return null; }
}

async function setSetting(db, k, v) {
  await db.run('INSERT INTO platform_settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, String(v));
}

// ─── مساعدات ───
async function shopBySlug(db, slug) {
  const shop = await db.get('SELECT * FROM shops WHERE slug = ?', String(slug).toLowerCase());
  if (!shop) fail(404, 'ما لقينا هالمحل');
  return planShop(shop);
}

async function memberOf(c, id) {
  const m = await c.db.get('SELECT * FROM members WHERE id = ? AND shop_id = ?', Number(id), c.shop.id);
  if (!m) fail(404, 'ما لقينا هالزبون');
  return m;
}

function readName(v) {
  const name = clean(v, 60);
  if (name.length < 2) fail(400, 'اكتب الاسم');
  return name;
}

function readPhone(v) {
  const phone = normPhone(v);
  if (phone.length < 7 || phone.length > 15) fail(400, 'رقم الجوال مش صحيح');
  return phone;
}

const DUPLICATE_PHONE = 'هالرقم مسجّل عنا من قبل. اطلب من الكاشير يبعتلك رابط بطاقتك.';

// رقم الزبون بينحفظ بالشكل المحلي (0791234567)، والبحث بيقبل كل أشكاله (962791234567، 791234567…)
// عشان نفس الزبون ما ياخد بطاقتين إذا كتب رقمه مرة بمفتاح الدولة ومرة بدونه
const memberPhone = (v, shop) => localPhone(readPhone(v), shop.country);
function phoneForms(phone, country) {
  const local = localPhone(phone, country);
  const code = CALLING[country];
  return [...new Set([local, normPhone(phone), ...(code && local.startsWith('0') ? [code + local.slice(1)] : [])])];
}
function memberByPhone(db, shop, phone, cols = 'id') {
  const forms = phoneForms(phone, shop.country);
  return db.get(`SELECT ${cols} FROM members WHERE shop_id = ? AND phone IN (${forms.map(() => '?').join(', ')})`, shop.id, ...forms);
}

async function createMember(db, shop, name, phone, { birthday = null, referredBy = null, lang = 'ar' } = {}) {
  const now = Date.now();
  if (await memberByPhone(db, shop, phone)) fail(409, DUPLICATE_PHONE);
  for (let i = 0; i < 6; i++) {
    try {
      const r = await db.run(
        'INSERT INTO members (shop_id, token, card_no, name, phone, birthday, bday_set_at, referred_by, lang, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        shop.id, randomToken(), randomDigits(8), name, phone, birthday, birthday ? now : null, referredBy, lang === 'en' ? 'en' : 'ar', now,
      );
      return db.get('SELECT * FROM members WHERE id = ?', r.lastId);
    } catch (e) {
      if (!isUniqueError(e)) throw e;
      if (/phone/.test(e.message)) fail(409, DUPLICATE_PHONE);
    }
  }
  fail(500, 'ما قدرنا ننشئ البطاقة، جرّب كمان مرة');
}

function slugBase(name) {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  return base.length >= 3 ? base : 'shop';
}

async function storeDefaultLogo(db, shop) {
  const png = await defaultLogoPng(shop.color);
  await db.run('INSERT OR REPLACE INTO shop_logos (shop_id, mime, data) VALUES (?, ?, ?)', shop.id, 'image/png', bytesToB64(png));
}

function idemKey(v) {
  const k = clean(v, 64);
  return /^[A-Za-z0-9_-]{8,64}$/.test(k) ? k : null;
}

function int(v, min, max, msg) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) fail(400, msg);
  return n;
}

// ─── الاشتراك: 14 يوم تجربة، وبعدها المحل بيتوقف لحد ما مدير المنصة يفعّله ───
export const TRIAL_DAYS = 14;

// ─── 💎 الباقات: الأساسي فيه البطاقة كاملة وشغّالة، والمميز فيه كل اللي بيجيب زبائن أكتر ويرجّعهم ───
export const PLANS = {
  basic: { name: 'أساسي', month: 12, year: 120 },
  pro: { name: 'مميز', month: 25, year: 250 },
};
export const BASIC_LIMITS = { branches: 1, staff: 2, broadcasts: 4 };
// التجربة المجانية ومحل العرض على المميز، والمشترك حسب الباقة اللي دفعها
const isPro = (shop) => shop.plan !== 'basic' || !shop.paid || !!shop.demo;
const PRO_SQL = "(s.plan <> 'basic' OR s.paid = 0 OR s.demo = 1)";
// بالأساسي إعدادات الميزات المميزة بتضل محفوظة بس ما بتشتغل، وبترجع لحالها لما يرقّي
const BASIC_OFF = { boosts: '[]', tiers_on: 0, ref_bonus: 0, bday_on: 0, winback_days: 0, review_on: 0, expiry_months: 0, credit_on: 0, guard_cooldown: 0, guard_daily: 0, guard_big: Number.MAX_SAFE_INTEGER };
const planShop = (shop) => (!shop || isPro(shop) ? shop : { ...shop, ...BASIC_OFF });
const shopRow = async (db, id) => planShop(await db.get('SELECT * FROM shops WHERE id = ?', id));
const proMsg = (what) => `${what} من ميزات الباقة المميزة 💎. رقّي باقتك من ⚙️ الإعدادات ← الاشتراك`;
function requirePro(c, what) {
  if (!isPro(c.shop)) fail(403, proMsg(what), { upgrade: true });
}
const planInfo = (shop) => ({ tier: isPro(shop) ? 'pro' : 'basic', chosen: shop.plan === 'basic' ? 'basic' : 'pro', name: PLANS[isPro(shop) ? 'pro' : 'basic'].name, limits: isPro(shop) ? null : BASIC_LIMITS });
const DAY = 864e5;

// صاحب المنصة = أول حساب حقيقي انعمل عليها. حساب العرض ما بينحسب، حتى لو حدا فتحه قبل ما صاحب المنصة يسجّل
const FIRST_USER = 'SELECT u.id, u.shop_id FROM users u JOIN shops s ON s.id = u.shop_id WHERE s.demo = 0 ORDER BY u.id LIMIT 1';

// محل صاحب المنصة ما بيخلص اشتراكه
async function platformShopId(db) {
  const row = await db.get(FIRST_USER);
  return row ? row.shop_id : null;
}

function subscriptionOf(shop, platformShop) {
  if (shop.id === platformShop || shop.demo) return { state: 'owner', until: null, daysLeft: null };
  const until = shop.active_until ?? shop.created_at + TRIAL_DAYS * DAY;
  const left = until - Date.now();
  if (left <= 0) return { state: 'expired', until, daysLeft: 0, paid: !!shop.paid };
  return { state: shop.paid ? 'active' : 'trial', until, daysLeft: Math.ceil(left / DAY) };
}

async function subscription(c, shop) {
  return subscriptionOf(shop, await platformShopId(c.db));
}

async function requireActive(c, shop = c.shop) {
  if ((await subscription(c, shop)).state === 'expired') fail(402, 'خلصت فترة اشتراك محلك. تواصل معنا لتفعيله، وزبائنك ونقاطهم محفوظين.');
}

// حد لعدد الطلبات لكل مفتاح بنافذة زمنية؛ لما يتجاوز بيرجع 429
async function rateLimit(c, key, max, windowMs, msg = 'طلبات كتير، جرّب بعد كم دقيقة') {
  const now = Date.now();
  const win = Math.floor(now / windowMs);
  const row = await c.db.get(
    'INSERT INTO rate_hits (k, n, expires_at) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n',
    `${key}:${win}`, (win + 1) * windowMs,
  );
  if (Math.random() < 0.02) await c.db.run('DELETE FROM rate_hits WHERE expires_at < ?', now);
  if (row.n > max) fail(429, msg);
}
const MIN = 60 * 1000;

// حذف الزبون وكل سجله نهائياً، وإيقاف بطاقته بمحفظة Google لو كان حافظها
async function deleteMember(c, shop, m) {
  await c.db.batch([
    ['DELETE FROM txns WHERE member_id = ? AND shop_id = ?', [m.id, shop.id]],
    ['DELETE FROM push_subs WHERE member_id = ?', [m.id]],
    ['DELETE FROM member_coupons WHERE member_id = ?', [m.id]],
    ['DELETE FROM credit_txns WHERE member_id = ?', [m.id]],
    ['DELETE FROM reviews WHERE member_id = ?', [m.id]],
    ['DELETE FROM members WHERE id = ? AND shop_id = ?', [m.id, shop.id]],
    ['DELETE FROM apple_regs WHERE serial = ?', [m.token]],
  ]);
  const cfg = gw.googleConfig(c.env);
  if (cfg && m.gw_object) {
    c.waitUntil(gw.patchObject(cfg, { id: gw.objectId(cfg, m.id), state: 'INACTIVE' }).catch((e) => console.error('gwallet deactivate:', e.message)));
  }
}

// ─── المسارات العامة (بدون تسجيل دخول) ───
async function publicShop(c, slug) {
  const shop = await shopBySlug(c.db, slug);
  const paused = (await subscription(c, shop)).state === 'expired';
  const referrer = await referrerOf(c, shop, c.url.searchParams.get('ref'));
  return json({ shop: { ...publicShopView(shop, c.origin), paused }, referrer: referrer ? perks.firstName(referrer.name) : null });
}

const REF_RE = /^[a-z2-9]{6}$/;
async function referrerOf(c, shop, code) {
  const ref = String(code || '').toLowerCase();
  if (!REF_RE.test(ref) || perks.refBonus(shop) <= 0) return null;
  return c.db.get('SELECT id, name FROM members WHERE shop_id = ? AND ref_code = ?', shop.id, ref);
}

// كود الدعوة للزبون (بينعمل أول مرة بيفتح بطاقته)
async function refCodeFor(c, m) {
  if (m.ref_code) return m.ref_code;
  for (let i = 0; i < 5; i++) {
    const code = randomToken().slice(0, 6);
    try {
      const r = await c.db.run('UPDATE members SET ref_code = ? WHERE id = ? AND ref_code IS NULL', code, m.id);
      if (r.changes) return code;
      return (await c.db.get('SELECT ref_code FROM members WHERE id = ?', m.id)).ref_code;
    } catch (e) {
      if (!isUniqueError(e)) throw e;
    }
  }
  return null;
}

async function join(c, slug) {
  const shop = await shopBySlug(c.db, slug);
  if (c.body.website) fail(400, 'طلب غير صالح'); // فخ للبوتات
  if ((await subscription(c, shop)).state === 'expired') fail(403, 'برنامج الولاء بهالمحل متوقف مؤقتاً.');
  // سقف لكل جهاز/شبكة، وسقف عام لكل محل (لو حدا غيّر الـ IP)
  await rateLimit(c, `join:${c.ip}`, 20, 10 * MIN);
  await rateLimit(c, `join-shop:${shop.id}`, 150, 10 * MIN, 'في ضغط على التسجيل هلأ، جرّب بعد شوي');
  const birthday = c.body.bdayDay || c.body.bdayMonth ? perks.readBirthday(c.body.bdayDay, c.body.bdayMonth) : null;
  if ((c.body.bdayDay || c.body.bdayMonth) && !birthday) fail(400, 'تاريخ الميلاد مش صحيح');
  const referrer = await referrerOf(c, shop, c.body.ref);
  const m = await createMember(c.db, shop, readName(c.body.name), memberPhone(c.body.phone, shop), { birthday, referredBy: referrer ? referrer.id : null, lang: c.body.lang });
  return json({ token: m.token, url: `${c.origin}/c/${m.token}` }, 201);
}

async function cardInfo(c, token) {
  const m = await c.db.get('SELECT * FROM members WHERE token = ?', token);
  if (!m) fail(404, 'ما لقينا هالبطاقة');
  const shop = await shopRow(c.db, m.shop_id);
  const v = memberView(m, shop);
  delete v.phone;
  delete v.phoneHidden;
  delete v.id;
  // البطاقة المفتوحة بتسأل كل 15 ثانية: الاستعلامات المستقلة بتمشي سوا
  const [code, apple, coupons, rate, menuUrl] = await Promise.all([
    perks.refBonus(shop) > 0 ? refCodeFor(c, m) : null,
    appleConfig(c, { withKey: false }),
    activeCoupons(c.db, m.id),
    canRate(c, shop, m),
    menuUrlOf(c, shop),
  ]);
  return json({
    shop: publicShopView(shop, c.origin),
    member: v,
    google: !!gw.googleConfig(c.env),
    apple: !!apple,
    refUrl: code ? `${c.origin}/j/${shop.slug}?ref=${code}` : null,
    coupons,
    canRate: rate,
    menuUrl,
  });
}

// الزبون بيضيف تاريخ ميلاده (مرة وحدة؛ لتغييره بيحكي مع المحل)
async function cardBirthday(c, token) {
  const m = await c.db.get('SELECT * FROM members WHERE token = ?', token);
  if (!m) fail(404, 'ما لقينا هالبطاقة');
  const md = perks.readBirthday(c.body.day, c.body.month);
  if (!md) fail(400, 'تاريخ الميلاد مش صحيح');
  const r = await c.db.run('UPDATE members SET birthday = ?, bday_set_at = ? WHERE id = ? AND birthday IS NULL', md, Date.now(), m.id);
  if (!r.changes) fail(409, 'تاريخ ميلادك محفوظ من قبل. لتغييره احكي مع المحل.');
  return json({ ok: true, birthday: md });
}

// صفحة البطاقة مفتوحة لأي حدا معه رابطها، والرابط هو نفسه الـ QR اللي بيمسحه الكاشير.
// فالأوامر اللي بتاخد من الزبون (إهداء الرصيد، حذف البطاقة) بتطلب رقم جواله كمان، والكاشير بيشوفه مخفي
async function confirmPhone(c, shop, m) {
  const raw = normPhone(c.body.phone);
  if (raw.length < 7) fail(400, 'اكتب رقم جوالك للتأكيد');
  await rateLimit(c, `confirm:${m.id}`, 8, 60 * MIN, 'محاولات كتير، جرّب بعد ساعة');
  if (!phoneForms(raw, shop.country).includes(m.phone)) fail(403, 'رقم الجوال مش نفس رقم البطاقة');
}

// ─── 🎁 إهداء رصيد لصاحب ───
const GIFT_DAYS = 30;
async function createGift(c, token) {
  const m = await c.db.get('SELECT * FROM members WHERE token = ?', token);
  if (!m) fail(404, 'ما لقينا هالبطاقة');
  const shop = await shopRow(c.db, m.shop_id);
  if (!shop.credit_on) fail(400, 'الرصيد مش مفعّل بهالمحل');
  const amount = readMoney(c.body.amount);
  if (amount < 500) fail(400, 'أقل هدية نص دينار');
  await confirmPhone(c, shop, m);
  await rateLimit(c, `gift:${m.id}`, 5, 24 * 60 * MIN, 'بعثت هدايا كتير اليوم');
  const code = randomToken();
  const now = Date.now();
  // نفس شرط الرصيد على التلات جمل جوّا نفس العملية: يا بيصيروا كلهم يا ولا وحدة
  const res = await c.db.batch([
    ['INSERT INTO credit_gifts (shop_id, from_member, amount, code, created_at) SELECT ?, id, ?, ?, ? FROM members WHERE id = ? AND credit >= ?', [shop.id, amount, code, now, m.id, amount]],
    ["INSERT INTO credit_txns (shop_id, member_id, kind, amount, note, created_at) SELECT ?, id, 'spend', ?, '🎁 هدية لصاحب', ? FROM members WHERE id = ? AND credit >= ?", [shop.id, amount, now, m.id, amount]],
    ['UPDATE members SET credit = credit - ?, updated_at = ? WHERE id = ? AND credit >= ?', [amount, now, m.id, amount]],
  ]);
  if (!res[2].changes) fail(409, `رصيدك ما بيكفي (رصيدك ${money(m.credit)} ${shop.currency})`);
  return json({ code, url: `${c.origin}/g/${code}`, amount: amount / 1000, credit: (m.credit - amount) / 1000 }, 201);
}

async function giftInfo(c, code) {
  const g = await c.db.get('SELECT * FROM credit_gifts WHERE code = ?', code);
  if (!g) fail(404, 'ما لقينا الهدية');
  const shop = await shopRow(c.db, g.shop_id);
  const from = await c.db.get('SELECT name FROM members WHERE id = ?', g.from_member);
  const open = !g.claimed_at && !g.refunded_at && g.created_at > Date.now() - GIFT_DAYS * DAY;
  return json({ shop: publicShopView(shop, c.origin), amount: g.amount / 1000, from: perks.firstName(from?.name || ''), open });
}

async function claimGift(c, code) {
  const g = await c.db.get('SELECT * FROM credit_gifts WHERE code = ?', code);
  if (!g) fail(404, 'ما لقينا الهدية');
  const m = await c.db.get('SELECT * FROM members WHERE token = ?', String(c.body.token || ''));
  if (!m || m.shop_id !== g.shop_id) fail(400, 'هالهدية لبطاقة بنفس المحل');
  if (m.id === g.from_member) fail(400, 'ما بتقدر تستلم هديتك إنت 🙂');
  const now = Date.now();
  // الرصيد بينضاف بس إذا انكتبت حركة هالطلب (نفس الوقت). والحركة إلها مفتاح فريد للهدية:
  // لو وصل طلبين بنفس الملّي ثانية، التاني بيفشل كله وما بينضاف الرصيد مرتين
  const tag = `gift:${g.id}`;
  let res;
  try {
    res = await c.db.batch([
      ['UPDATE credit_gifts SET claimed_by = ?, claimed_at = ? WHERE id = ? AND claimed_at IS NULL AND refunded_at IS NULL AND created_at > ?', [m.id, now, g.id, now - GIFT_DAYS * DAY]],
      ["INSERT INTO credit_txns (shop_id, member_id, kind, amount, note, idem, created_at) SELECT ?, ?, 'topup', ?, '🎁 هدية من صاحب', ?, ? WHERE EXISTS (SELECT 1 FROM credit_gifts WHERE id = ? AND claimed_by = ? AND claimed_at = ?)", [g.shop_id, m.id, g.amount, tag, now, g.id, m.id, now]],
      ['UPDATE members SET credit = credit + ?, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM credit_txns WHERE shop_id = ? AND idem = ? AND member_id = ? AND created_at = ?)', [g.amount, now, m.id, g.shop_id, tag, m.id, now]],
    ]);
  } catch (e) {
    if (!isUniqueError(e)) throw e;
    res = [{ changes: 0 }];
  }
  if (!res[0].changes) fail(409, 'هالهدية انستلمت أو انتهت');
  const shop = await shopRow(c.db, g.shop_id);
  const sender = await c.db.get('SELECT * FROM members WHERE id = ?', g.from_member);
  if (sender) {
    c.waitUntil(notifyMember({ ...c, shop }, sender, {
      title: shop.name,
      body: isEn(sender) ? `🎁 ${perks.firstName(m.name)} claimed your gift (${money(g.amount)} ${shop.currency})` : `🎁 ${perks.firstName(m.name)} استلم هديتك (${money(g.amount)} ${shop.currency})`,
      icon: logoUrl(shop, c.origin),
    }).catch(() => {}));
  }
  return json({ ok: true, token: m.token, amount: g.amount / 1000 });
}

async function cardLang(c, token) {
  const lang = c.body.lang === 'en' ? 'en' : 'ar';
  const r = await c.db.run('UPDATE members SET lang = ? WHERE token = ?', lang, token);
  if (!r.changes) fail(404, 'ما لقينا هالبطاقة');
  return json({ ok: true, lang });
}

// ─── التقييمات ───
// الزبون بيقيّم زيارته خلال يومين منها، ومرة وحدة لكل زيارة
const RATE_WINDOW = 2 * DAY;
async function canRate(c, shop, m) {
  if (!shop.review_on || !m.last_visit || m.last_visit < Date.now() - RATE_WINDOW) return false;
  const last = await c.db.get('SELECT MAX(created_at) AS at FROM reviews WHERE member_id = ?', m.id);
  return !last.at || last.at < m.last_visit;
}

async function cardReview(c, token) {
  const m = await c.db.get('SELECT * FROM members WHERE token = ?', token);
  if (!m) fail(404, 'ما لقينا هالبطاقة');
  const shop = await shopRow(c.db, m.shop_id);
  await rateLimit(c, `review:${c.ip}`, 10, 60 * MIN);
  const stars = int(c.body.stars, 1, 5, 'اختار من 1 لـ 5 نجوم');
  if (!(await canRate(c, shop, m))) fail(409, 'قيّمت هالزيارة من قبل، شكراً إلك 🙏');
  const comment = clean(c.body.comment, 500);
  await c.db.run('INSERT INTO reviews (shop_id, member_id, stars, comment, created_at) VALUES (?, ?, ?, ?, ?)', shop.id, m.id, stars, comment, Date.now());
  if (stars <= 3) await notifyOwners(c, shop.id, { title: `${'★'.repeat(stars)} تقييم من ${perks.firstName(m.name)}`, body: comment || 'بدون تعليق', url: `${c.origin}/app#activity` });
  // التقييم الحلو منطلب نشره على Google، والزعلان بيضل عند صاحب المحل
  return json({ ok: true, googleUrl: stars >= 4 && shop.review_url ? shop.review_url : null }, 201);
}

// الزبون بيحذف بطاقته وبياناته بنفسه (رابط البطاقة، ورقم جواله للتأكيد)
async function deleteCard(c, token) {
  const m = await c.db.get('SELECT * FROM members WHERE token = ?', token);
  if (!m) fail(404, 'ما لقينا هالبطاقة');
  const shop = await shopRow(c.db, m.shop_id);
  await confirmPhone(c, shop, m);
  await deleteMember(c, shop, m);
  return json({ ok: true });
}

async function site(c) {
  return json({
    contactEmail: c.env.CONTACT_EMAIL || null,
    // زر الواتساب بصفحة البيع: لواتساب الوكيل إذا شغّال (بيرد لحاله وبيبلّغك)، وإلا لرقمك.
    // المحلات المشتركة (الدفع والدعم) بيضلوا يحكوك على رقمك
    whatsapp: (aiConfig(c.env) && await agentWa(c)) || ownerWhatsapp(c.env),
    signupOpen: !c.env.SIGNUP_CODE,
    apple: !!(await appleConfig(c, { withKey: false })),
    plans: PLANS,
    sales: !!aiConfig(c.env),
  });
}

// طلب اشتراك من صفحة البيع
const LEAD_KINDS = ['مطعم', 'كوفي شوب', 'مخبز وحلويات', 'صالون', 'محل تجاري', 'غيره'];
async function createLead(c) {
  if (c.body.website) fail(400, 'طلب غير صالح');
  await saveLead(c, c.body, 'form');
  return json({ ok: true }, 201);
}

// source: form (الفورم بالصفحة) أو ai (مساعد المبيعات بالمحادثة)
async function saveLead(c, b, source) {
  await rateLimit(c, `lead:${c.ip}`, 5, 60 * MIN);
  const shopName = clean(b.shopName, 60);
  if (shopName.length < 2) fail(400, 'اكتب اسم المحل');
  const name = readName(b.name);
  const phone = readPhone(b.phone);
  const kind = LEAD_KINDS.includes(b.kind) ? b.kind : '';
  await c.db.run(
    'INSERT INTO leads (shop_name, name, phone, city, kind, note, reseller_id, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    shopName, name, phone, clean(b.city, 40), kind, clean(b.note, 500), (await resellerByCode(c.db, b.partner))?.id ?? null, source, Date.now(),
  );
  await notifyAdmin(c, { title: source === 'ai' ? '🤖 طلب اشتراك من مساعد المبيعات' : '📩 طلب اشتراك جديد', body: `${shopName} · ${name}${kind ? ` · ${kind}` : ''}`, url: `${c.origin}/app#admin` });
  await alertOwnerWa(c, {
    event: source === 'ai' ? 'طلب اشتراك من مساعد المبيعات' : 'طلب اشتراك جديد',
    who: `${shopName} · ${name}`, phone, about: [kind, clean(b.city, 40), clean(b.note, 140)].filter(Boolean).join(' · ') || 'بده يشترك', key: `l:${phone}`,
  });
}

// مدير المنصة = أول حساب حقيقي انعمل عليها (صاحب المنصة)
async function isPlatformAdmin(c) {
  const first = await c.db.get(FIRST_USER);
  return !!(c.user && first && first.id === c.user.id);
}

async function requireAdmin(c) {
  if (!(await isPlatformAdmin(c))) fail(403, 'هاي الصفحة لمدير المنصة بس');
}

// مدير المنصة بيرتّب منيو أي محل (مثلاً المحل بعتله المنيو عالواتساب): نفس إجراءات المنيو بس على المحل المختار
const forShop = (fn) => async (c, shopId, ...rest) => {
  await requireAdmin(c);
  const shop = await shopRow(c.db, Number(shopId));
  if (!shop) fail(404, 'ما لقينا المحل');
  c.shop = shop;
  return fn(c, ...rest);
};

async function adminLeads(c) {
  await requireAdmin(c);
  const leads = await c.db.all(`SELECT l.id, l.shop_name AS shopName, l.name, l.phone, l.city, l.kind, l.note, l.status, l.source, l.created_at AS createdAt, r.name AS reseller
    FROM leads l LEFT JOIN resellers r ON r.id = l.reseller_id ORDER BY l.created_at DESC LIMIT 200`);
  return json({ leads });
}

async function adminLeadStatus(c, id) {
  await requireAdmin(c);
  if (!['new', 'contacted', 'won', 'lost'].includes(c.body.status)) fail(400, 'حالة غير معروفة');
  const r = await c.db.run('UPDATE leads SET status = ? WHERE id = ?', c.body.status, Number(id));
  if (!r.changes) fail(404, 'ما لقينا الطلب');
  return adminLeads(c);
}

async function adminShops(c) {
  await requireAdmin(c);
  const shops = await c.db.all(
    `SELECT s.id, s.name, s.slug, s.currency, s.plan, s.created_at AS createdAt, s.active_until, s.paid, s.created_at,
       (SELECT COUNT(*) FROM members m WHERE m.shop_id = s.id) AS members,
       (SELECT MAX(t.created_at) FROM txns t WHERE t.shop_id = s.id) AS lastActivity,
       (SELECT u.email FROM users u WHERE u.shop_id = s.id AND u.role = 'owner' ORDER BY u.id LIMIT 1) AS ownerEmail,
       (SELECT MAX(u.reset_asked_at) FROM users u WHERE u.shop_id = s.id AND u.role = 'owner') AS resetAskedAt,
       (SELECT r.name FROM resellers r WHERE r.id = s.reseller_id) AS reseller
     FROM shops s WHERE s.demo = 0 ORDER BY s.created_at DESC LIMIT 500`,
  );
  const platformShop = await platformShopId(c.db);
  const out = shops.map(({ active_until, paid, created_at, plan, ...s }) => ({ ...s, plan: planInfo({ plan, paid }), subscription: subscriptionOf({ id: s.id, active_until, paid, created_at }, platformShop) }));
  return json({ shops: out, signupOpen: !c.env.SIGNUP_CODE });
}

// 💰 أرقام المنصة لمديرها: الدخل، الاشتراكات، التجارب اللي رح تخلص
async function adminStats(c) {
  await requireAdmin(c);
  const now = Date.now();
  const platformShop = await platformShopId(c.db);
  const t = perks.localTime('JO', now);
  const monthStart = Date.UTC(t.year, t.month - 1, 1) - 3 * 36e5;
  const shops = await c.db.all(
    `SELECT s.*, (SELECT u.email FROM users u WHERE u.shop_id = s.id AND u.role = 'owner' ORDER BY u.id LIMIT 1) AS ownerEmail,
       (SELECT p.plan FROM payments p WHERE p.shop_id = s.id AND p.status = 'approved' ORDER BY p.decided_at DESC LIMIT 1) AS lastPlan
     FROM shops s WHERE s.demo = 0 AND s.id <> ?`, platformShop ?? 0,
  );
  const [month, total] = await Promise.all([
    c.db.get("SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE status = 'approved' AND decided_at >= ?", monthStart),
    c.db.get("SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE status = 'approved'"),
  ]);
  const counts = { active: 0, trial: 0, expired: 0, newMonth: 0, basic: 0, pro: 0 };
  let mrr = 0;
  const ending = [];
  for (const s of shops) {
    const sub = subscriptionOf(s, platformShop);
    counts[sub.state] = (counts[sub.state] || 0) + 1;
    if (s.created_at >= monthStart) counts.newMonth++;
    // الدخل الشهري المتكرر حسب الباقة: الشهري بسعره، والسنوي ÷ 12
    if (sub.state === 'active') {
      const tier = readTier(s.plan);
      counts[tier]++;
      mrr += s.lastPlan === 'year' ? planPrice(tier, 'year') / 12 : planPrice(tier, 'month');
    }
    if ((sub.state === 'trial' || sub.state === 'active') && sub.daysLeft <= 7) ending.push({ id: s.id, name: s.name, state: sub.state, daysLeft: sub.daysLeft, ownerEmail: s.ownerEmail });
  }
  ending.sort((a, b) => a.daysLeft - b.daysLeft);
  const ai = await aiMonth(c.db);
  const cfg = aiConfig(c.env);
  // Gemini بيختار الموديل لحاله: منعرفه من آخر رد ناجح
  const aiModel = cfg ? (cfg.provider === 'gemini' ? cfg.model || ((await jsonSetting(c.db, 'ai_last_ok')) || {}).model || null : cfg.model) : null;
  return json({
    revenueMonth: month.n, revenueTotal: total.n, mrr: Math.round(mrr * 100) / 100, counts, ending, version: APP_VERSION, changelog: CHANGELOG,
    ai: { ready: !!cfg, provider: cfg ? cfg.provider : null, model: aiModel, ...ai, costUsd: cfg ? aiCost(aiModel || cfg.provider, ai) : null },
  });
}

// مدير المنصة بيفعّل اشتراك محل (+ شهر / + سنة) أو بيوقفه
async function adminShopPlan(c, id) {
  await requireAdmin(c);
  const shop = await shopRow(c.db, Number(id));
  if (!shop) fail(404, 'ما لقينا المحل');
  const tier = readTier(c.body.tier);
  if (c.body.action === 'month' || c.body.action === 'year') {
    await extendPlan(c.db, shop, c.body.action, tier);
    // بنسجّلها كدفعة (كاش أو تحويل برّا المنصة) عشان الإيرادات وعمولة المندوب
    await c.db.run("INSERT INTO payments (shop_id, plan, tier, amount, payer, status, created_at, decided_at) VALUES (?, ?, ?, ?, 'تفعيل يدوي', 'approved', ?, ?)", shop.id, c.body.action, tier, planPrice(tier, c.body.action), Date.now(), Date.now());
  }
  // تبديل الباقة بدون دفعة (تصحيح، أو ترقية بالفرق برّا المنصة)
  else if (c.body.action === 'basic' || c.body.action === 'pro') await c.db.run('UPDATE shops SET plan = ? WHERE id = ?', c.body.action, shop.id);
  else if (c.body.action === 'stop') await c.db.run('UPDATE shops SET active_until = ?, paid = 0 WHERE id = ?', Date.now() - 1000, shop.id);
  else fail(400, 'إجراء غير معروف');
  return adminShops(c);
}

// تمديد الاشتراك شهر أو سنة من آخر يوم فيه (أو من اليوم لو كان خالص)، على الباقة اللي دفعها
const readTier = (v) => (v === 'basic' ? 'basic' : 'pro');
async function extendPlan(db, shop, period, tier) {
  const current = shop.active_until ?? shop.created_at + TRIAL_DAYS * DAY;
  const d = new Date(Math.max(Date.now(), current));
  if (period === 'month') d.setMonth(d.getMonth() + 1); else d.setFullYear(d.getFullYear() + 1);
  await db.run('UPDATE shops SET active_until = ?, paid = 1, plan = ? WHERE id = ?', d.getTime(), readTier(tier), shop.id);
}

// ─── الدفع بـ CliQ: صاحب المحل بيحوّل وبيبلّغ، ومدير المنصة بيتأكد من حسابه وبيفعّل بكبسة ───
const planPrice = (tier, period) => PLANS[tier === 'basic' ? 'basic' : 'pro'][period];
const CLIQ_RE = /^[A-Za-z0-9._+\- ]{3,40}$/;

async function cliqInfo(db) {
  const alias = await getSetting(db, 'cliq_alias');
  if (!alias) return null;
  return { alias, name: (await getSetting(db, 'cliq_name')) || '', bank: (await getSetting(db, 'cliq_bank')) || '' };
}

const paymentView = (p) => ({ id: p.id, plan: p.plan, tier: readTier(p.tier), amount: p.amount, payer: p.payer, ref: p.ref, status: p.status, createdAt: p.created_at, decidedAt: p.decided_at });

async function billing(c) {
  const payments = await c.db.all('SELECT * FROM payments WHERE shop_id = ? ORDER BY created_at DESC LIMIT 10', c.shop.id);
  return json({
    subscription: await subscription(c, c.shop),
    plans: PLANS,
    plan: planInfo(c.shop),
    limits: BASIC_LIMITS,
    currency: 'JOD',
    cliq: await cliqInfo(c.db),
    whatsapp: ownerWhatsapp(c.env),
    payments: payments.map(paymentView),
  });
}

async function billingClaim(c) {
  noDemo(c, 'الدفع');
  if (!(await cliqInfo(c.db))) fail(400, 'الدفع بـ CliQ مش مفعّل لسا، تواصل معنا عالواتساب');
  const plan = c.body.plan;
  if (plan !== 'month' && plan !== 'year') fail(400, 'اختار شهر أو سنة');
  const tier = readTier(c.body.tier);
  const amount = planPrice(tier, plan);
  const payer = clean(c.body.payer, 60);
  if (payer.length < 2) fail(400, 'اكتب اسم اللي حوّل (متل ما بيطلع بالحوالة)');
  await rateLimit(c, `claim:${c.shop.id}`, 5, 24 * 60 * MIN, 'بلّغت كتير اليوم، استنى لنتأكد من الحوالات');
  const pending = await c.db.get("SELECT COUNT(*) AS n FROM payments WHERE shop_id = ? AND status = 'pending'", c.shop.id);
  if (pending.n >= 2) fail(409, 'عندك حوالات لسا عم نتأكد منها');
  await c.db.run('INSERT INTO payments (shop_id, plan, tier, amount, payer, ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', c.shop.id, plan, tier, amount, payer, clean(c.body.ref, 60), Date.now());
  await notifyAdmin(c, { title: '💳 حوالة CliQ للتأكيد', body: `${c.shop.name} · ${PLANS[tier].name} · ${amount} دينار من ${payer}`, url: `${c.origin}/app#admin` });
  return billing(c);
}

async function adminPayments(c) {
  await requireAdmin(c);
  const rows = await c.db.all(
    `SELECT p.*, s.name AS shopName FROM payments p JOIN shops s ON s.id = p.shop_id
     ORDER BY CASE p.status WHEN 'pending' THEN 0 ELSE 1 END, p.created_at DESC LIMIT 60`,
  );
  return json({ payments: rows.map((p) => ({ ...paymentView(p), shopId: p.shop_id, shopName: p.shopName })), cliq: await cliqInfo(c.db) });
}

async function adminPaymentDecide(c, id) {
  await requireAdmin(c);
  const action = c.body.action;
  if (!['approve', 'reject'].includes(action)) fail(400, 'إجراء غير معروف');
  const p = await c.db.get("SELECT * FROM payments WHERE id = ? AND status = 'pending'", Number(id));
  if (!p) fail(404, 'ما لقينا حوالة بتستنى');
  // العلامة أول، عشان لو انكبس الزر مرتين ما ينمدد الاشتراك مرتين
  const r = await c.db.run("UPDATE payments SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'", action === 'approve' ? 'approved' : 'rejected', Date.now(), p.id);
  if (r.changes && action === 'approve') {
    await extendPlan(c.db, await shopRow(c.db, p.shop_id), p.plan, p.tier);
    await notifyOwners(c, p.shop_id, { title: '✅ انفعّل اشتراكك', body: `وصلتنا حوالتك (${p.amount} دينار) على الباقة ${readTier(p.tier) === 'basic' ? 'الأساسية' : 'المميزة'}. شكراً إلك 🙏`, url: `${c.origin}/app#settings` });
  }
  return adminPayments(c);
}

async function adminSettings(c) {
  await requireAdmin(c);
  if (c.req.method === 'PUT') {
    const alias = String(c.body.cliqAlias || '').trim();
    if (alias && !CLIQ_RE.test(alias)) fail(400, 'الاسم المستعار (Alias) مش صحيح');
    await setSetting(c.db, 'cliq_alias', alias);
    await setSetting(c.db, 'cliq_name', clean(c.body.cliqName, 60));
    await setSetting(c.db, 'cliq_bank', clean(c.body.cliqBank, 60));
  }
  return json({ cliq: await cliqInfo(c.db) });
}

async function logo(c, shopId) {
  let row = await c.db.get('SELECT mime, data FROM shop_logos WHERE shop_id = ?', Number(shopId));
  if (!row) {
    const shop = await shopRow(c.db, Number(shopId));
    if (!shop) return notFound(c);
    await storeDefaultLogo(c.db, shop);
    row = await c.db.get('SELECT mime, data FROM shop_logos WHERE shop_id = ?', shop.id);
  }
  return new Response(b64ToBytes(row.data), { headers: { 'content-type': row.mime, 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' } });
}

// ─── الحساب ───
async function signup(c) {
  const b = c.body;
  await rateLimit(c, `signup:${c.ip}`, 5, 60 * MIN, 'محاولات تسجيل كتير من نفس الشبكة، جرّب بعد ساعة');
  if (c.env.SIGNUP_CODE && String(b.code || '').trim() !== String(c.env.SIGNUP_CODE)) fail(403, 'رمز التسجيل غلط. تواصل معنا لتحصل عليه');
  const shopName = clean(b.shopName, 60);
  if (shopName.length < 2) fail(400, 'اكتب اسم المحل');
  const email = String(b.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) fail(400, 'الإيميل مش صحيح');
  auth.checkPasswordStrength(b.password);
  if (await c.db.get('SELECT id FROM users WHERE email = ?', email)) fail(409, 'هالإيميل مسجّل من قبل، سجّل دخول');
  const ownerName = clean(b.name, 60) || shopName;
  const country = CURRENCIES[b.country] ? b.country : 'JO';
  const offer = await liveOffer(c.db, b.offer); // 🎁 عرض من وكيل المبيعات: تجربة أطول
  const pw = await auth.hashPassword(b.password);
  const now = Date.now();
  const base = slugBase(shopName);
  let slug = base;
  for (let i = 0; ; i++) {
    try {
      await c.db.batch([
        ['INSERT INTO shops (slug, name, country, currency, welcome_text, active_until, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [slug, shopName, country, CURRENCIES[country], `${shopName} ترحب بكم`, now + (offer ? offer.trial_days : TRIAL_DAYS) * DAY, now]],
        ['INSERT INTO users (shop_id, email, name, role, pw_hash, created_at) VALUES ((SELECT id FROM shops WHERE slug = ?), ?, ?, \'owner\', ?, ?)', [slug, email, ownerName, pw, now]],
      ]);
      break;
    } catch (e) {
      if (!isUniqueError(e)) throw e;
      if (/email/.test(e.message)) fail(409, 'هالإيميل مسجّل من قبل، سجّل دخول');
      if (i >= 5) throw e;
      slug = `${base}-${randomDigits(4)}`;
    }
  }
  const shop = await c.db.get('SELECT * FROM shops WHERE slug = ?', slug);
  await storeDefaultLogo(c.db, shop);
  const reseller = await resellerByCode(c.db, b.partner);
  if (reseller) await c.db.run('UPDATE shops SET reseller_id = ? WHERE id = ?', reseller.id, shop.id);
  if (offer) {
    // العرض لمرة وحدة: إذا تسجيلين بنفس اللحظة، واحد بس بياخد التجربة الأطول
    const claim = await c.db.run('UPDATE offers SET shop_id = ?, used_at = ? WHERE code = ? AND used_at IS NULL', shop.id, now, offer.code);
    if (!claim.changes) await c.db.run('UPDATE shops SET active_until = ? WHERE id = ?', now + TRIAL_DAYS * DAY, shop.id);
  }
  // المحل اللي حكى معه وكيل المبيعات (من العرض، أو من رابطه الخاص /?p=…)
  const prospectId = (offer && offer.prospect_id) || ((await prospectByCode(c.db, b.prospect)) || {}).id;
  if (prospectId) await c.db.run("UPDATE prospects SET status = 'won', shop_id = ? WHERE id = ?", shop.id, prospectId);
  await notifyAdmin(c, { title: offer ? '🎉 محل جديد سجّل من عرض وكيل المبيعات' : prospectId ? '🎉 محل من وكيل المبيعات بلّش تجربة' : '🎉 محل جديد بلّش تجربة', body: `${shopName} · ${email}${offer ? ` · تجربة ${offer.trial_days} يوم` : ''}`, url: `${c.origin}/app#admin` });
  const user = await c.db.get('SELECT id FROM users WHERE email = ?', email);
  const token = await auth.createSession(c.db, user.id);
  return json({ ok: true }, 201, { 'set-cookie': auth.sessionCookie(token, c.req) });
}

// 🎬 دخول حساب العرض بكبسة (بدون كلمة سر)
async function demoLogin(c) {
  await rateLimit(c, `demo:${c.ip}`, 20, 60 * MIN, 'جرّبت كتير، استنى شوي');
  let owner = await c.db.get('SELECT * FROM users WHERE email = ?', DEMO_EMAIL);
  if (!owner || (await getSetting(c.db, 'demo_version')) !== String(DEMO_VERSION)) {
    // طلب واحد بس بيعيد تعبئة العرض (اللي غيّر رقم النسخة)، عشان زائرين بنفس اللحظة ما يعبّوه مرتين
    const claim = await c.db.run("INSERT INTO platform_settings (k, v) VALUES ('demo_version', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v WHERE v <> excluded.v", String(DEMO_VERSION));
    if (claim.changes || !owner) {
      await seedDemo(c.db);
      await setSetting(c.db, 'demo_day', localDayKey('JO'));
    }
    owner = await c.db.get('SELECT * FROM users WHERE email = ?', DEMO_EMAIL);
    if (!owner) fail(503, 'العرض عم يتجهّز، جرّب كمان ثانية');
  }
  const token = await auth.createSession(c.db, owner.id);
  return json({ ok: true }, 200, { 'set-cookie': auth.sessionCookie(token, c.req) });
}

const localDayKey = (country, now = Date.now()) => { const t = perks.localTime(country, now); return String(t.year * 10000 + t.month * 100 + t.day); };

async function loginRoute(c) {
  await rateLimit(c, `login:${c.ip}`, 30, 10 * MIN, 'محاولات دخول كتير، جرّب بعد كم دقيقة');
  const user = await auth.login(c.db, c.body.email, c.body.password);
  const token = await auth.createSession(c.db, user.id);
  return json({ ok: true }, 200, { 'set-cookie': auth.sessionCookie(token, c.req) });
}

async function logout(c) {
  await auth.endSession(c.db, c.req);
  return json({ ok: true }, 200, { 'set-cookie': auth.sessionCookie(null, c.req) });
}

// ─── 🔑 نسيت كلمة السر ───
// ما في إيميل بالمنصة: صاحب المحل بيطلب من صفحة الدخول، بيوصلك إشعار، وإنت بتعمل رابط لمرة وحدة وبتبعتله ياه (واتساب)
const RESET_HOURS = 24;
async function forgotPassword(c) {
  await rateLimit(c, `forgot:${c.ip}`, 5, 60 * MIN, 'طلبات كتير، جرّب بعد ساعة');
  const email = String(c.body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) fail(400, 'اكتب إيميلك اللي سجّلت فيه');
  const user = await c.db.get("SELECT u.id, u.reset_asked_at, s.name AS shop FROM users u JOIN shops s ON s.id = u.shop_id WHERE u.email = ? AND u.role = 'owner' AND s.demo = 0", email);
  // نفس الرد سواء الإيميل موجود أو لأ (ما بنكشف مين مسجّل)، والإشعار مرة باليوم لكل حساب
  if (user && !(user.reset_asked_at > Date.now() - DAY)) {
    await c.db.run('UPDATE users SET reset_asked_at = ? WHERE id = ?', Date.now(), user.id);
    await notifyAdmin(c, { title: `🔑 ${user.shop} نسي كلمة السر`, body: `${email} · اعمله رابط من 👑 المنصة ← المحلات`, url: `${c.origin}/app#admin` });
  }
  return json({ ok: true, whatsapp: ownerWhatsapp(c.env) });
}

async function adminResetLink(c, shopId) {
  await requireAdmin(c);
  const user = await c.db.get("SELECT u.id, u.email FROM users u JOIN shops s ON s.id = u.shop_id WHERE s.id = ? AND u.role = 'owner' AND s.demo = 0 ORDER BY u.id LIMIT 1", Number(shopId));
  if (!user) fail(404, 'ما لقينا صاحب المحل');
  const token = randomToken(32);
  const now = Date.now();
  await c.db.run('DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?', user.id, now); // الرابط الجديد بيلغي القديم
  await c.db.run('INSERT INTO password_resets (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)', await sha256Hex(token), user.id, now + RESET_HOURS * HOUR, now);
  await c.db.run('UPDATE users SET reset_asked_at = NULL WHERE id = ?', user.id);
  return json({ url: `${c.origin}/?reset=${token}#login`, email: user.email, hours: RESET_HOURS });
}

async function resetRow(c, token) {
  const t = String(token || '');
  if (!/^[a-z2-9]{32}$/.test(t)) return null;
  return c.db.get('SELECT r.*, u.email FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > ?', await sha256Hex(t), Date.now());
}
const RESET_GONE = 'الرابط خلص أو انستعمل. اطلب رابط جديد';

async function resetInfo(c) {
  await rateLimit(c, `reset:${c.ip}`, 30, 60 * MIN);
  const r = await resetRow(c, c.url.searchParams.get('token'));
  if (!r) fail(404, RESET_GONE);
  return json({ email: r.email });
}

async function resetPassword(c) {
  await rateLimit(c, `reset:${c.ip}`, 30, 60 * MIN);
  auth.checkPasswordStrength(c.body.password);
  const r = await resetRow(c, c.body.token);
  if (!r) fail(404, RESET_GONE);
  const used = await c.db.run('UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL', Date.now(), r.token_hash);
  if (!used.changes) fail(404, RESET_GONE);
  // كلمة السر الجديدة بتطلّع أي حدا كان داخل بالقديمة
  await c.db.batch([
    ['UPDATE users SET pw_hash = ?, failed = 0, locked_until = 0 WHERE id = ?', [await auth.hashPassword(c.body.password), r.user_id]],
    ['DELETE FROM sessions WHERE user_id = ?', [r.user_id]],
  ]);
  const session = await auth.createSession(c.db, r.user_id);
  return json({ ok: true }, 200, { 'set-cookie': auth.sessionCookie(session, c.req) });
}

async function me(c) {
  const isAdmin = await isPlatformAdmin(c);
  // المهام الدورية ما إلها طلب، فبنحفظ رابط الموقع من زيارات صاحب المنصة بس (عشان ما حدا يغيّر روابط الإشعارات)
  if (isAdmin && !c.env.PUBLIC_URL && (await getSetting(c.db, 'origin')) !== c.origin) await setSetting(c.db, 'origin', c.origin);
  return json({
    user: { id: c.user.id, name: c.user.name, email: c.user.email, role: c.user.role, branchId: c.user.branch_id || null, isAdmin },
    shop: shopView(c.shop, c.origin),
    google: googleStatus(c, c.shop),
    subscription: await subscription(c, c.shop),
    plan: planInfo(c.shop),
    pushCount: (await c.db.get('SELECT COUNT(DISTINCT member_id) AS n FROM push_subs WHERE shop_id = ?', c.shop.id)).n,
    userPush: (await c.db.get('SELECT COUNT(*) AS n FROM user_push_subs WHERE user_id = ?', c.user.id)).n,
    whatsapp: ownerWhatsapp(c.env),
    currencies: CURRENCIES,
    onboarding: c.user.role === 'owner' && !c.shop.demo ? await onboardingOf(c) : null,
    demo: c.shop.demo ? { sampleCard: (await c.db.get('SELECT token FROM members WHERE shop_id = ? ORDER BY visits DESC LIMIT 1', c.shop.id))?.token || null } : null,
  });
}

// ✅ خطوات البداية للمحل الجديد (بتختفي لما تخلص أو لما يخفيها)
async function onboardingOf(c) {
  const s = c.shop;
  const flags = JSON.parse(s.onboard || '{}');
  if (flags.dismissed) return null;
  const [members, alerts] = await Promise.all([
    c.db.get('SELECT COUNT(*) AS n FROM members WHERE shop_id = ?', s.id),
    c.db.get("SELECT COUNT(*) AS n FROM user_push_subs p JOIN users u ON u.id = p.user_id WHERE u.shop_id = ? AND u.role = 'owner'", s.id),
  ]);
  const steps = [
    { key: 'logo', done: !!s.custom_logo },
    { key: 'branch', done: JSON.parse(s.locations || '[]').length > 0 },
    { key: 'settings', done: !!s.updated_at },
    { key: 'poster', done: !!flags.poster },
    { key: 'customer', done: members.n > 0 },
    { key: 'alerts', done: alerts.n > 0 },
  ];
  return steps.every((x) => x.done) ? null : { steps };
}

async function onboardStep(c) {
  const step = c.body.step;
  if (!['poster', 'dismissed'].includes(step)) fail(400, 'خطوة غير معروفة');
  const flags = JSON.parse(c.shop.onboard || '{}');
  flags[step] = true;
  await c.db.run('UPDATE shops SET onboard = ? WHERE id = ?', JSON.stringify(flags), c.shop.id);
  return json({ ok: true });
}

async function changePassword(c) {
  noDemo(c, 'تغيير كلمة السر');
  const row = await c.db.get('SELECT pw_hash FROM users WHERE id = ?', c.user.id);
  if (!(await auth.verifyPassword(String(c.body.current || ''), row.pw_hash))) fail(400, 'كلمة السر الحالية غلط');
  auth.checkPasswordStrength(c.body.next);
  await c.db.run('UPDATE users SET pw_hash = ? WHERE id = ?', await auth.hashPassword(c.body.next), c.user.id);
  return json({ ok: true });
}

// ─── الزبائن والنقاط ───
async function listMembers(c) {
  const q = clean(c.url.searchParams.get('q'), 60);
  const offset = Math.max(0, Number(c.url.searchParams.get('offset')) || 0);
  let where = 'shop_id = ?';
  const a = [c.shop.id];
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    const digits = normPhone(q);
    // الموظف بيلاقي الزبون برقمه الكامل بس (ما بيقدر يدوّر بجزء من الرقم ويطلّع أرقام الناس)
    const staff = c.user.role === 'staff';
    const byPhone = staff ? digits.length >= 7 : digits.length >= 3;
    const forms = staff && byPhone ? phoneForms(digits, c.shop.country) : [];
    where += " AND (name LIKE ? ESCAPE '\\' OR card_no = ?" + (byPhone ? (staff ? ` OR phone IN (${forms.map(() => '?').join(', ')})` : ' OR phone LIKE ?') : '') + ')';
    a.push(like, q);
    // المالك بيدوّر بجزء من الرقم: بدون الصفر ومفتاح الدولة، فبيلاقي الرقم بأي شكل انحفظ
    if (byPhone) a.push(...(staff ? forms : [`%${localPhone(digits, c.shop.country).replace(/^0/, '')}%`]));
  }
  const rows = await c.db.all(`SELECT * FROM members WHERE ${where} ORDER BY COALESCE(last_visit, created_at) DESC LIMIT 50 OFFSET ?`, ...a, offset);
  const total = await c.db.get(`SELECT COUNT(*) AS n FROM members WHERE ${where}`, ...a);
  return json({ members: rows.map((m) => viewFor(c, m)), total: total.n });
}

// 📥 استيراد زبائن من Excel/CSV (الواجهة بتقرأ الملف وبتبعت لحد 50 زبون بكل طلب)
function localPhone(raw, country) {
  const d = normPhone(raw);
  const code = CALLING[country];
  if (code && d.startsWith(code) && d.length >= code.length + 7) return `0${d.slice(code.length)}`;
  if (country === 'JO' && /^7\d{8}$/.test(d)) return `0${d}`; // Excel بيشيل الصفر من أول الرقم
  return d;
}

async function importMembers(c) {
  requirePro(c, 'استيراد الزبائن');
  await requireActive(c);
  noDemo(c, 'الاستيراد');
  const rows = c.body.rows;
  if (!Array.isArray(rows) || !rows.length || rows.length > 50) fail(400, 'ابعت من 1 لـ 50 زبون بكل مرة');
  await rateLimit(c, `import:${c.shop.id}`, 200, 60 * MIN, 'استوردت كتير، استنى شوي');
  const now = Date.now();
  let added = 0;
  const skipped = [];
  for (const [i, row] of rows.entries()) {
    const at = Number.isInteger(row && row.line) ? row.line : i + 1;
    const name = clean(row && row.name, 60);
    if (name.length < 2) { skipped.push({ line: at, reason: 'الاسم ناقص' }); continue; }
    const phone = localPhone(row.phone, c.shop.country);
    if (phone.length < 7 || phone.length > 15) { skipped.push({ line: at, reason: 'رقم الجوال مش صحيح' }); continue; }
    if (await memberByPhone(c.db, c.shop, phone)) { skipped.push({ line: at, reason: 'الرقم مسجّل من قبل' }); continue; }
    const birthday = row.bdayDay && row.bdayMonth ? perks.readBirthday(row.bdayDay, row.bdayMonth) : null;
    const balance = Math.max(0, Math.min(1000000, Math.floor(Number(row.balance) || 0)));
    let m;
    try {
      m = await createMember(c.db, c.shop, name, phone, { birthday });
    } catch (e) {
      if (e instanceof HttpError) { skipped.push({ line: at, reason: e.message }); continue; }
      throw e;
    }
    const writes = [];
    // التواريخ المستوردة من المالك نفسه، فما بنستنى أسبوعين قبل هدية عيد الميلاد
    if (birthday) writes.push(['UPDATE members SET bday_set_at = ? WHERE id = ?', [0, m.id]]);
    if (balance > 0) {
      writes.push(["INSERT INTO txns (shop_id, member_id, kind, delta, user_id, note, created_at) VALUES (?, ?, 'adjust', ?, ?, '📥 رصيد مستورد', ?)", [c.shop.id, m.id, balance, c.user.id, now]]);
      writes.push(['UPDATE members SET balance = balance + ? WHERE id = ?', [balance, m.id]]);
    }
    if (writes.length) await c.db.batch(writes);
    added++;
  }
  return json({ added, skipped });
}

async function addMember(c) {
  await requireActive(c);
  const name = readName(c.body.name);
  const phone = memberPhone(c.body.phone, c.shop);
  const existing = await memberByPhone(c.db, c.shop, phone);
  if (existing) return json({ error: 'هالرقم إله بطاقة من قبل', memberId: existing.id }, 409);
  const m = await createMember(c.db, c.shop, name, phone);
  return json({ member: viewFor(c, m), cardUrl: `${c.origin}/c/${m.token}` }, 201);
}

// الكاشير بيمسح QR (توكن أو رابط البطاقة) أو بيكتب رقم البطاقة أو الجوال
async function lookup(c) {
  const code = String(c.url.searchParams.get('code') || '').trim();
  const fromUrl = code.match(/\/c\/([a-z2-9]{20})(?:[/?#]|$)/);
  const token = fromUrl ? fromUrl[1] : code.toLowerCase();
  let m = null;
  if (TOKEN_RE.test(token)) m = await c.db.get('SELECT * FROM members WHERE token = ? AND shop_id = ?', token, c.shop.id);
  if (!m) {
    const digits = normPhone(code);
    if (/^\d{8}$/.test(digits)) m = await c.db.get('SELECT * FROM members WHERE card_no = ? AND shop_id = ?', digits, c.shop.id);
    if (!m && digits.length >= 7) m = await memberByPhone(c.db, c.shop, digits, '*');
  }
  if (!m) fail(404, 'ما لقينا هالبطاقة عندكم');
  return json({ member: viewFor(c, m) });
}

async function memberDetail(c, id) {
  const m = await memberOf(c, id);
  const txns = await c.db.all(
    `SELECT t.id, t.kind, t.delta, t.amount, t.note, t.created_at AS at, u.name AS by FROM txns t LEFT JOIN users u ON u.id = t.user_id
     WHERE t.member_id = ? AND t.shop_id = ? ORDER BY t.created_at DESC, t.id DESC LIMIT 30`,
    m.id, c.shop.id,
  );
  // الإشعارات: كم جهاز مفعّل، وشو صار بآخر إشعار
  const subs = await c.db.all('SELECT last_at, last_error FROM push_subs WHERE member_id = ? ORDER BY last_at IS NULL, last_at DESC', m.id);
  const push = { devices: subs.length, lastAt: subs[0]?.last_at || null, lastError: subs[0]?.last_error || null };
  return json({ member: viewFor(c, m), txns, push, cardUrl: `${c.origin}/c/${m.token}` });
}

// كل حركة نقاط إلها مفتاح (idem) من الواجهة: لو انبعتت مرتين (نت ضعيف أو كبسة مكررة) بتنحسب مرة وحدة
async function applyTxn(c, statements) {
  try {
    return await c.db.batch(statements);
  } catch (e) {
    if (isUniqueError(e) && /idem/.test(e.message)) return null;
    throw e;
  }
}

// الحركة المشروطة ما انطبقت: يا الرصيد مش كافي، يا هاي إعادة لطلب نجح قبل (فالرصيد نقص من أول مرة)
async function seenKey(c, key) {
  const k = idemKey(key);
  return !!(k && (await c.db.get('SELECT id FROM txns WHERE shop_id = ? AND idem = ?', c.shop.id, k)));
}

async function respondMember(c, id, extra = {}, message = null) {
  const fresh = await c.db.get('SELECT * FROM members WHERE id = ?', id);
  if (!extra.duplicate) pushMember(c, c.shop, fresh);
  let push;
  if (!extra.duplicate && message) {
    const msg = message(fresh);
    if (msg) push = await notifyMember(c, fresh, { ...msg, icon: logoUrl(c.shop, c.origin) });
  }
  return json({ member: viewFor(c, fresh), ...extra, ...(push ? { push } : {}) });
}

async function earn(c, id) {
  await requireActive(c);
  const m = await memberOf(c, id);
  const r = earnFor(c.shop, c.body);
  if (r.error) fail(400, r.error);
  const now = Date.now();
  // إعادة لطلب نجح قبل (نت ضعيف): ما بنعدّه محاولة مكررة
  if (await seenKey(c, c.body.key)) return respondMember(c, m.id, { duplicate: true });
  await guardEarn(c, m, now);
  // العروض: نقاط دبل بالوقت، رجعة الزبون الغايب، والمستوى
  const p = perks.applyPerks(c.shop, m, r.delta, now);
  const note = p.reasons.length ? p.reasons.join(' · ') : null;
  const res = await applyTxn(c, [
    ['INSERT INTO txns (shop_id, member_id, kind, delta, amount, user_id, note, idem, branch_id, created_at) VALUES (?, ?, \'earn\', ?, ?, ?, ?, ?, ?, ?)', [c.shop.id, m.id, p.delta, r.amount, c.user.id, note, idemKey(c.body.key), branchFor(c), now]],
    ['UPDATE members SET balance = balance + ?, lifetime = lifetime + ?, visits = visits + 1, last_visit = ?, updated_at = ? WHERE id = ? AND shop_id = ?', [p.delta, p.delta, now, now, m.id, c.shop.id]],
  ]);
  const ref = res ? await rewardReferral(c, m, now) : null;
  if (res && c.user.role === 'staff' && p.delta >= guardBig(c.shop)) {
    await alertOwner(c, `big:${c.user.id}:${m.id}`, {
      title: '⚠️ نقاط كتير على بطاقة وحدة',
      body: `${c.user.name} ضاف ${p.delta} ${unitWord(c.shop, p.delta)} لـ ${m.name}${r.amount ? ` (فاتورة ${r.amount} ${c.shop.currency})` : ''}`,
    });
  }
  const extra = res ? { delta: p.delta, base: p.base, reasons: p.reasons, ...(ref ? { refBonus: ref.bonus } : {}) } : { duplicate: true };
  return respondMember(c, m.id, extra, (fresh) => earnMessage(c.shop, m, fresh, p, ref));
}

// الفرع: الموظف مربوط بفرعه، والمالك بيختار من الكاشير (أو بدون)
function branchFor(c) {
  if (c.user.role === 'staff' && c.user.branch_id) return c.user.branch_id;
  const b = String(c.body.branch || '');
  return b && branchesOf(c.shop).some((l) => l.id === b) ? b : null;
}

// إشعارات الزبون بلغته (عربي أو إنجليزي)
const isEn = (m) => m && m.lang === 'en';
const unitEn = (shop, n) => (shop.program_type === 'stamps' ? (n === 1 ? 'stamp' : 'stamps') : (n === 1 ? 'point' : 'points'));

// ─── الحماية من تلاعب الموظفين (المالك مستثنى) ───
const guardBig = (shop) => shop.guard_big ?? rewardCost(shop);

// تنبيه لصاحب المحل، مرة بالساعة لنفس الموضوع (عشان ما يغرق بالإشعارات)
async function alertOwner(c, key, message) {
  const win = Math.floor(Date.now() / (60 * MIN));
  const row = await c.db.get(
    'INSERT INTO rate_hits (k, n, expires_at) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n',
    `alert:${c.shop.id}:${key}:${win}`, (win + 1) * 60 * MIN,
  );
  if (row.n === 1) await notifyOwners(c, c.shop.id, { url: `${c.origin}/app#activity`, ...message });
}

async function guardEarn(c, m, now) {
  if (c.user.role !== 'staff') return;
  const s = c.shop;
  if (s.guard_cooldown > 0 && m.last_visit && m.last_visit > now - s.guard_cooldown * MIN) {
    const mins = Math.max(1, Math.round((now - m.last_visit) / MIN));
    await alertOwner(c, `again:${m.id}`, { title: '🛡️ محاولة نقاط مكررة', body: `${c.user.name} حاول يضيف نقاط لـ ${m.name} مرة تانية بعد ${mins} دقيقة` });
    fail(409, `هالزبون انضافله نقاط قبل ${mins} دقيقة. إذا طلب جديد استنى شوي، أو خلّي المالك يضيفها.`);
  }
  if (s.guard_daily > 0) {
    const t = perks.localTime(s.country, now);
    const start = now - (t.mins * 60 + new Date(now).getUTCSeconds()) * 1000;
    const row = await c.db.get("SELECT COUNT(*) AS n FROM txns WHERE member_id = ? AND kind = 'earn' AND created_at >= ?", m.id, start);
    if (row.n >= s.guard_daily) {
      await alertOwner(c, `daily:${m.id}`, { title: '🛡️ وصل حد الزيارات اليوم', body: `${c.user.name} حاول يضيف نقاط لـ ${m.name} للمرة ${row.n + 1} اليوم` });
      fail(409, `هالزبون انضافله نقاط ${row.n} مرات اليوم وهاد الحد. المالك بيقدر يضيف أكتر.`);
    }
  }
}

// ادعُ صاحبك: بأول زيارة للزبون اللي انضم بدعوة، الاتنين بياخدوا هدية (مرة وحدة، وبسقف شهري للي بيدعي)
async function rewardReferral(c, m, now) {
  const bonus = perks.refBonus(c.shop);
  if (!m.referred_by || m.ref_rewarded || bonus <= 0) return null;
  const referrer = await c.db.get('SELECT * FROM members WHERE id = ? AND shop_id = ?', m.referred_by, c.shop.id);
  if (!referrer) return null;
  const monthStart = now - 30 * DAY;
  const done = await c.db.get('SELECT COUNT(*) AS n FROM members WHERE referred_by = ? AND ref_rewarded > ?', referrer.id, monthStart);
  const capped = done.n >= perks.REF_MONTHLY_CAP;
  // العلامة أول إشي، وكل الباقي مشروط عليها. والحركات إلها مفاتيح فريدة (فيها «:» فما بتتلخبط مع مفاتيح الكاشير):
  // لو طلبين وصلوا بنفس اللحظة، التاني بيفشل كله، فواحد بس بياخد
  const tag = `ref:${m.id}`;
  const tagBy = `refby:${m.id}`;
  const has = 'EXISTS (SELECT 1 FROM txns WHERE shop_id = ? AND idem = ? AND created_at = ?)';
  let res;
  try {
    res = await c.db.batch([
      ['UPDATE members SET ref_rewarded = ? WHERE id = ? AND ref_rewarded = 0', [now, m.id]],
      ["INSERT INTO txns (shop_id, member_id, kind, delta, note, idem, created_at) SELECT ?, ?, 'adjust', ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM members WHERE id = ? AND ref_rewarded = ?)", [c.shop.id, m.id, bonus, `👥 هدية الانضمام بدعوة من ${perks.firstName(referrer.name)}`, tag, now, m.id, now]],
      [`UPDATE members SET balance = balance + ? WHERE id = ? AND ${has}`, [bonus, m.id, c.shop.id, tag, now]],
      ...(capped ? [] : [
        [`INSERT INTO txns (shop_id, member_id, kind, delta, note, idem, created_at) SELECT ?, ?, 'adjust', ?, ?, ?, ? WHERE ${has}`, [c.shop.id, referrer.id, bonus, `👥 دعوة ${perks.firstName(m.name)}`, tagBy, now, c.shop.id, tag, now]],
        [`UPDATE members SET balance = balance + ?, updated_at = ? WHERE id = ? AND ${has}`, [bonus, now, referrer.id, c.shop.id, tagBy, now]],
      ]),
    ]);
  } catch (e) {
    if (isUniqueError(e)) return null;
    throw e;
  }
  if (!res[0].changes) return null;
  if (!capped) {
    const fresh = await c.db.get('SELECT * FROM members WHERE id = ?', referrer.id);
    pushMember(c, c.shop, fresh);
    c.waitUntil(notifyMember(c, fresh, {
      title: c.shop.name,
      body: isEn(fresh) ? `👥 Your friend ${perks.firstName(m.name)} visited us! You got ${bonus} ${unitEn(c.shop, bonus)} as an invite gift 🎉`
        : `👥 صاحبك ${perks.firstName(m.name)} زارنا! انضافلك ${bonus} ${unitWord(c.shop, bonus)} هدية الدعوة 🎉`,
      icon: logoUrl(c.shop, c.origin),
    }).catch(() => {}));
  }
  return { bonus };
}

async function redeem(c, id) {
  await requireActive(c);
  const m = await memberOf(c, id);
  const cost = rewardCost(c.shop);
  const now = Date.now();
  // الشرط (الرصيد كافي) جوّا نفس العملية، فما في مجال تنصرف المكافأة مرتين
  const res = await applyTxn(c, [
    [`INSERT INTO txns (shop_id, member_id, kind, delta, user_id, idem, branch_id, created_at)
      SELECT ?, id, 'redeem', ?, ?, ?, ?, ? FROM members WHERE id = ? AND shop_id = ? AND balance >= ?`, [c.shop.id, -cost, c.user.id, idemKey(c.body.key), branchFor(c), now, m.id, c.shop.id, cost]],
    ['UPDATE members SET balance = balance - ?, redeemed = redeemed + 1, updated_at = ? WHERE id = ? AND shop_id = ? AND balance >= ?', [cost, now, m.id, c.shop.id, cost]],
  ]);
  if (!res || (!res[1].changes && (await seenKey(c, c.body.key)))) return respondMember(c, m.id, { duplicate: true });
  if (!res[1].changes) fail(409, `ما عنده ${c.shop.program_type === 'stamps' ? 'أختام' : 'نقاط'} كفاية للمكافأة`);
  return respondMember(c, m.id, { delta: -cost });
}

async function removeMember(c, id) {
  const m = await memberOf(c, id);
  await deleteMember(c, c.shop, m);
  return json({ ok: true });
}

async function adjust(c, id) {
  await requireActive(c);
  const m = await memberOf(c, id);
  const delta = int(c.body.delta, -100000, 100000, 'اكتب عدد صحيح');
  if (!delta) fail(400, 'اكتب عدد غير الصفر');
  const note = clean(c.body.note, 120);
  if (note.length < 2) fail(400, 'اكتب سبب التعديل');
  const now = Date.now();
  const res = await applyTxn(c, [
    [`INSERT INTO txns (shop_id, member_id, kind, delta, user_id, note, idem, branch_id, created_at)
      SELECT ?, id, 'adjust', ?, ?, ?, ?, ?, ? FROM members WHERE id = ? AND shop_id = ? AND balance + ? >= 0`, [c.shop.id, delta, c.user.id, note, idemKey(c.body.key), branchFor(c), now, m.id, c.shop.id, delta]],
    ['UPDATE members SET balance = balance + ?, updated_at = ? WHERE id = ? AND shop_id = ? AND balance + ? >= 0', [delta, now, m.id, c.shop.id, delta]],
  ]);
  if (!res || (!res[1].changes && (await seenKey(c, c.body.key)))) return respondMember(c, m.id, { duplicate: true });
  if (!res[1].changes) fail(409, 'الرصيد ما بيصير بالسالب');
  return respondMember(c, m.id, { delta });
}

// آخر الحركات + أرقام اليوم والأسبوع والشهر (البداية بتيجي من جهاز المستخدم عشان فرق التوقيت)
async function activity(c) {
  const p = c.url.searchParams;
  const since = (k, def) => { const v = Number(p.get(k)); return Number.isFinite(v) && v > 0 ? v : def; };
  const now = Date.now();
  const day = since('dayStart', now - 864e5);
  const week = since('weekStart', now - 7 * 864e5);
  const month = since('monthStart', now - 30 * 864e5);
  const s = c.shop.id;
  const [members, newWeek, visitsDay, earnedMonth, redeemedMonth, recent] = await Promise.all([
    c.db.get('SELECT COUNT(*) AS n FROM members WHERE shop_id = ?', s),
    c.db.get('SELECT COUNT(*) AS n FROM members WHERE shop_id = ? AND created_at >= ?', s, week),
    c.db.get("SELECT COUNT(*) AS n FROM txns WHERE shop_id = ? AND kind = 'earn' AND created_at >= ?", s, day),
    c.db.get("SELECT COALESCE(SUM(delta), 0) AS n FROM txns WHERE shop_id = ? AND kind = 'earn' AND created_at >= ?", s, month),
    c.db.get("SELECT COUNT(*) AS n FROM txns WHERE shop_id = ? AND kind = 'redeem' AND created_at >= ?", s, month),
    c.db.all(
      `SELECT t.id, t.kind, t.delta, t.amount, t.note, t.branch_id AS branch, t.created_at AS at, m.id AS memberId, m.name AS member, u.name AS by
       FROM txns t JOIN members m ON m.id = t.member_id LEFT JOIN users u ON u.id = t.user_id
       WHERE t.shop_id = ? ORDER BY t.created_at DESC, t.id DESC LIMIT 50`, s,
    ),
  ]);
  return json({ stats: { members: members.n, newWeek: newWeek.n, visitsDay: visitsDay.n, earnedMonth: earnedMonth.n, redeemedMonth: redeemedMonth.n }, recent });
}

// ─── التقارير (للمالك): آخر 30 يوم ───
// فرق توقيت المحل عن UTC (بالدقيقة)، عشان نجمّع الزيارات حسب ساعة ويوم المحل
function tzOffset(country, now = Date.now()) {
  const t = perks.localTime(country, now);
  return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute) - Math.floor(now / 60000) * 60000;
}

async function reports(c) {
  const s = c.shop.id;
  const now = Date.now();
  const since = now - 30 * DAY;
  const off = tzOffset(c.shop.country, now);
  const [totals, byHour, byDay, weekly, top, stars, comments, staff, byBranch, credit] = await Promise.all([
    c.db.get(`SELECT COUNT(*) AS members,
        SUM(CASE WHEN last_visit >= ? THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN visits >= 1 THEN 1 ELSE 0 END) AS visited,
        SUM(CASE WHEN visits >= 2 THEN 1 ELSE 0 END) AS repeaters,
        SUM(CASE WHEN birthday IS NOT NULL THEN 1 ELSE 0 END) AS birthdays,
        SUM(CASE WHEN ref_rewarded > 0 THEN 1 ELSE 0 END) AS referred,
        (SELECT COUNT(*) FROM push_subs p WHERE p.shop_id = ?) AS pushDevices
      FROM members WHERE shop_id = ?`, since, s, s),
    c.db.all("SELECT CAST((created_at + ?) / 3600000 AS INTEGER) % 24 AS k, COUNT(*) AS n FROM txns WHERE shop_id = ? AND kind = 'earn' AND created_at >= ? GROUP BY k", off, s, since),
    // يوم 0 بالتاريخ (1/1/1970) كان خميس، فـ (اليوم + 4) % 7 = يوم الأسبوع (0 = الأحد)
    c.db.all("SELECT (CAST((created_at + ?) / 86400000 AS INTEGER) + 4) % 7 AS k, COUNT(*) AS n FROM txns WHERE shop_id = ? AND kind = 'earn' AND created_at >= ? GROUP BY k", off, s, since),
    c.db.all('SELECT CAST((? - created_at) / 604800000 AS INTEGER) AS k, COUNT(*) AS n FROM members WHERE shop_id = ? AND created_at >= ? GROUP BY k', now, s, now - 8 * 7 * DAY),
    c.db.all('SELECT id, name, visits, lifetime, last_visit AS lastVisit FROM members WHERE shop_id = ? AND visits > 0 ORDER BY visits DESC, lifetime DESC LIMIT 10', s),
    c.db.all('SELECT stars AS k, COUNT(*) AS n FROM reviews WHERE shop_id = ? GROUP BY stars', s),
    c.db.all(`SELECT r.stars, r.comment, r.created_at AS at, m.id AS memberId, m.name FROM reviews r JOIN members m ON m.id = r.member_id
      WHERE r.shop_id = ? AND (r.stars <= 3 OR r.comment <> '') ORDER BY r.created_at DESC LIMIT 20`, s),
    // شغل كل موظف: كم زبون خدم، وكم مرة ضاف نقاط وكم نقطة، وكم مكافأة صرف
    c.db.all(`SELECT u.id, u.name, u.role, COUNT(DISTINCT t.member_id) AS customers,
        SUM(CASE WHEN t.kind = 'earn' THEN 1 ELSE 0 END) AS earns,
        SUM(CASE WHEN t.kind = 'earn' THEN t.delta ELSE 0 END) AS points,
        SUM(CASE WHEN t.kind = 'redeem' THEN 1 ELSE 0 END) AS redeems
      FROM txns t JOIN users u ON u.id = t.user_id WHERE t.shop_id = ? AND t.created_at >= ? GROUP BY u.id ORDER BY points DESC`, s, since),
    c.db.all("SELECT branch_id AS id, COUNT(*) AS n FROM txns WHERE shop_id = ? AND kind = 'earn' AND created_at >= ? GROUP BY branch_id", s, since),
    // الهدايا بين الزبائن (إلها ملاحظة) بتنقل رصيد من زبون لزبون: مش شحن ولا دفع عند المحل
    c.db.get(`SELECT (SELECT COALESCE(SUM(credit), 0) FROM members WHERE shop_id = ?) AS outstanding,
        (SELECT COALESCE(SUM(amount), 0) FROM credit_txns WHERE shop_id = ? AND kind = 'topup' AND note IS NULL AND created_at >= ?) AS topups,
        (SELECT COALESCE(SUM(amount), 0) FROM credit_txns WHERE shop_id = ? AND kind = 'spend' AND note IS NULL AND created_at >= ?) AS spent`, s, s, since, s, since),
  ]);
  const fill = (rows, n) => { const a = Array(n).fill(0); for (const r of rows) if (r.k >= 0 && r.k < n) a[r.k] = r.n; return a; };
  const starCounts = fill(stars.map((r) => ({ k: r.k - 1, n: r.n })), 5);
  const rated = starCounts.reduce((a, b) => a + b, 0);
  return json({
    totals: { ...totals, returnRate: totals.visited ? Math.round((totals.repeaters / totals.visited) * 100) : null },
    byHour: fill(byHour, 24),
    byWeekday: fill(byDay, 7),
    newByWeek: fill(weekly, 8).reverse(), // من الأقدم للأحدث
    top,
    ...(isPro(c.shop) ? {
      staff,
      byBranch,
      credit: { outstanding: credit.outstanding / 1000, topups: credit.topups / 1000, spent: credit.spent / 1000 },
      ratings: { counts: starCounts, total: rated, avg: rated ? Math.round((starCounts.reduce((a, n, i) => a + n * (i + 1), 0) / rated) * 10) / 10 : null, comments },
    } : { locked: true, staff: [], byBranch: [], credit: { outstanding: 0, topups: 0, spent: 0 }, ratings: { counts: [0, 0, 0, 0, 0], total: 0, avg: null, comments: [] } }),
  });
}

// ملف Excel (CSV) بكل الزبائن — للمالك بس لأنه فيه أرقام الجوالات
async function membersCsv(c) {
  requirePro(c, 'تنزيل الزبائن Excel');
  const rows = await c.db.all('SELECT * FROM members WHERE shop_id = ? ORDER BY created_at', c.shop.id);
  const off = tzOffset(c.shop.country);
  const day = (ms) => (ms ? new Date(ms + off).toISOString().slice(0, 10) : '');
  // خلية بتبلّش بـ = أو + أو - أو @ ممكن Excel ينفذها كمعادلة، فبنحط قبلها '
  const cell = (v) => { let x = String(v ?? ''); if (/^[=+\-@\t\r]/.test(x)) x = `'${x}`; return `"${x.replace(/"/g, '""')}"`; };
  const head = ['الاسم', 'الجوال', 'رقم البطاقة', 'الرصيد', 'مجموع النقاط', 'الزيارات', 'المكافآت', 'آخر زيارة', 'تاريخ الانضمام', 'عيد الميلاد', 'المستوى'];
  const lines = [head.map(cell).join(',')];
  for (const m of rows) {
    const tier = perks.tierOf(c.shop, m.visits);
    // عيد الميلاد يوم/شهر (21/5)، نفس الشكل اللي بيقرأه استيراد الزبائن
    const bday = m.birthday ? `${Number(m.birthday.slice(3))}/${Number(m.birthday.slice(0, 2))}` : '';
    lines.push([m.name, m.phone, m.card_no, m.balance, m.lifetime, m.visits, m.redeemed, day(m.last_visit), day(m.created_at), bday, tier ? tier.name : ''].map(cell).join(','));
  }
  // BOM عشان Excel يقرأ العربي صح
  return new Response(`\ufeff${lines.join('\r\n')}\r\n`, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="members-${c.shop.slug}.csv"`, 'cache-control': 'no-store' },
  });
}

// ─── إعدادات المحل (للمالك) ───
async function updateShop(c) {
  const b = c.body;
  const s = c.shop;
  const next = {};
  next.name = clean(b.name ?? s.name, 60);
  if (next.name.length < 2) fail(400, 'اكتب اسم المحل');
  next.slug = s.demo ? s.slug : String(b.slug ?? s.slug).trim().toLowerCase();
  if (!SLUG_RE.test(next.slug)) fail(400, 'رابط المحل: حروف إنجليزية صغيرة وأرقام وشرطة (3 حروف على الأقل)');
  next.color = String(b.color ?? s.color);
  if (!COLOR_RE.test(next.color)) fail(400, 'اللون مش صحيح');
  next.country = CURRENCIES[b.country] ? b.country : s.country;
  next.currency = CURRENCIES[next.country];
  next.program_type = b.programType ?? s.program_type;
  if (!['points', 'stamps'].includes(next.program_type)) fail(400, 'نوع البرنامج مش صحيح');
  if (next.program_type !== s.program_type && (await c.db.get('SELECT id FROM txns WHERE shop_id = ? LIMIT 1', s.id))) {
    fail(409, 'ما بتقدر تغيّر نوع البرنامج بعد ما بلّشت تسجّل للزبائن');
  }
  const ppu = Number(b.pointsPerUnit ?? s.points_per_unit);
  if (!Number.isFinite(ppu) || ppu <= 0 || ppu > 1000) fail(400, 'النقاط لكل وحدة لازم تكون بين 0 و 1000');
  next.points_per_unit = Math.round(ppu * 1000) / 1000;
  next.reward_threshold = int(b.rewardThreshold ?? s.reward_threshold, 1, 1000000, 'نقاط المكافأة لازم تكون عدد صحيح');
  next.stamps_required = int(b.stampsRequired ?? s.stamps_required, 2, 30, 'عدد الأختام لازم يكون بين 2 و 30');
  next.reward_name = clean(b.rewardName ?? s.reward_name, 40);
  if (next.reward_name.length < 2) fail(400, 'اكتب شو المكافأة');
  next.welcome_text = clean(b.welcomeText ?? s.welcome_text, 100);
  const locs = b.locations ?? JSON.parse(s.locations || '[]');
  if (!Array.isArray(locs) || locs.length > 10) fail(400, 'لحد 10 فروع');
  // الأساسي فرع واحد (واللي نزل من المميز وعنده فروع، بيضلّوا بس ما بيزيد عليهم)
  if (!isPro(s) && locs.length > Math.max(BASIC_LIMITS.branches, JSON.parse(s.locations || '[]').length)) {
    fail(403, 'الباقة الأساسية فيها فرع واحد. رقّي للمميزة 💎 لفروع بلا حد', { upgrade: true });
  }
  next.locations = JSON.stringify(locs.map((l, i) => {
    const lat = Number(l && l.lat);
    const lng = Number(l && l.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) fail(400, `موقع الفرع ${i + 1} مش صحيح`);
    const rl = Math.round(lat * 1e6) / 1e6;
    const rg = Math.round(lng * 1e6) / 1e6;
    return { id: /^b[a-z0-9]{6}$/.test(String(l.id || '')) ? l.id : branchId(rl, rg), name: clean(l.name, 40) || `فرع ${i + 1}`, lat: rl, lng: rg };
  }));
  try {
    await c.db.run(
      `UPDATE shops SET name = ?, slug = ?, color = ?, country = ?, currency = ?, program_type = ?, points_per_unit = ?, reward_threshold = ?,
       stamps_required = ?, reward_name = ?, welcome_text = ?, locations = ? WHERE id = ?`,
      next.name, next.slug, next.color, next.country, next.currency, next.program_type, next.points_per_unit, next.reward_threshold,
      next.stamps_required, next.reward_name, next.welcome_text, next.locations, s.id,
    );
  } catch (e) {
    if (isUniqueError(e)) fail(409, 'هالرابط مستخدم لمحل تاني');
    throw e;
  }
  if (next.color !== s.color && !s.custom_logo) {
    await storeDefaultLogo(c.db, { ...s, color: next.color });
    await c.db.run('UPDATE shops SET logo_version = logo_version + 1 WHERE id = ?', s.id);
  }
  await c.db.run('UPDATE shops SET updated_at = ? WHERE id = ?', Date.now(), s.id);
  const shop = await shopRow(c.db, s.id);
  const google = await syncClass(c, shop);
  return json({ shop: shopView(shop, c.origin), google: { ...googleStatus(c, shop), lastSync: google } });
}

async function updateLogo(c) {
  const s = c.shop;
  if (c.body.remove) {
    await storeDefaultLogo(c.db, s);
    await c.db.run('UPDATE shops SET custom_logo = 0, logo_version = logo_version + 1 WHERE id = ?', s.id);
  } else {
    const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+=*)$/.exec(String(c.body.dataUrl || ''));
    if (!m) fail(400, 'الشعار لازم يكون صورة PNG أو JPG');
    const bytes = b64ToBytes(m[2]);
    if (bytes.length > MAX_LOGO) fail(400, 'الصورة كبيرة، صغّرها');
    const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const jpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if ((m[1] === 'image/png' && !png) || (m[1] === 'image/jpeg' && !jpg)) fail(400, 'ملف الصورة تالف');
    await c.db.run('INSERT OR REPLACE INTO shop_logos (shop_id, mime, data) VALUES (?, ?, ?)', s.id, m[1], m[2]);
    await c.db.run('UPDATE shops SET custom_logo = 1, logo_version = logo_version + 1 WHERE id = ?', s.id);
  }
  await c.db.run('UPDATE shops SET updated_at = ? WHERE id = ?', Date.now(), s.id);
  const shop = await shopRow(c.db, s.id);
  const google = await syncClass(c, shop);
  return json({ shop: shopView(shop, c.origin), google: { ...googleStatus(c, shop), lastSync: google } });
}

// إعدادات العروض (كل قسم بيبعت حقوله بس)
async function updatePerks(c) {
  requirePro(c, 'العروض التلقائية والإعدادات المتقدمة');
  const b = c.body;
  const s = c.shop;
  const flag = (k, col) => (b[k] === undefined ? s[col] : b[k] ? 1 : 0);
  const num = (k, col, min, max, msg) => (b[k] === undefined ? s[col] : int(b[k], min, max, msg));
  const next = {
    tiers_on: flag('tiersOn', 'tiers_on'),
    tier_silver: num('tierSilver', 'tier_silver', 2, 1000, 'زيارات الفضي لازم تكون بين 2 و 1000'),
    tier_gold: num('tierGold', 'tier_gold', 3, 5000, 'زيارات الذهبي لازم تكون بين 3 و 5000'),
    bday_on: flag('bdayOn', 'bday_on'),
    bday_gift: num('bdayGift', 'bday_gift', 0, 1000000, 'هدية عيد الميلاد لازم تكون عدد صحيح'),
    winback_days: num('winbackDays', 'winback_days', 0, 365, 'عدد الأيام لازم يكون بين 0 و 365'),
    winback_text: b.winbackText === undefined ? s.winback_text : clean(b.winbackText, 120),
    winback_double: flag('winbackDouble', 'winback_double'),
    review_on: flag('reviewOn', 'review_on'),
    review_url: b.reviewUrl === undefined ? s.review_url : String(b.reviewUrl || '').trim(),
    ref_bonus: num('refBonus', 'ref_bonus', 0, 1000000, 'هدية الدعوة لازم تكون عدد صحيح'),
    guard_cooldown: num('guardCooldown', 'guard_cooldown', 0, 240, 'الدقايق لازم تكون بين 0 و 240'),
    guard_daily: num('guardDaily', 'guard_daily', 0, 50, 'عدد المرات لازم يكون بين 0 و 50'),
    guard_big: num('guardBig', 'guard_big', 1, 1000000, 'حد التنبيه لازم يكون عدد صحيح'),
    credit_on: flag('creditOn', 'credit_on'),
    credit_bonus: num('creditBonus', 'credit_bonus', 0, 100, 'هدية الشحن لازم تكون بين 0 و 100%'),
    expiry_months: num('expiryMonths', 'expiry_months', 0, 24, 'المدة لازم تكون 0 أو 6 أو 12 أو 24 شهر'),
    expiry_since: s.expiry_since,
    boosts: s.boosts,
  };
  if (next.winback_days > 0 && next.winback_days < 7) fail(400, 'أقل إشي 7 أيام، عشان ما ننزعج الزبائن');
  if (![0, 6, 12, 24].includes(next.expiry_months)) fail(400, 'المدة لازم تكون 0 أو 6 أو 12 أو 24 شهر');
  // لما تتفعّل الصلاحية، العدّ بيبلّش من اليوم (ما بتنمسح نقاط الزبائن القدام فجأة)
  if (next.expiry_months > 0 && !s.expiry_months) next.expiry_since = Date.now();
  if (next.tier_gold <= next.tier_silver) fail(400, 'زيارات الذهبي لازم تكون أكتر من الفضي');
  if (next.review_url) {
    let ok = false;
    try { ok = new URL(next.review_url).protocol === 'https:' && next.review_url.length <= 300; } catch { ok = false; }
    if (!ok) fail(400, 'رابط التقييم لازم يبلّش بـ https://');
  }
  if (b.boosts !== undefined) {
    const v = perks.validateBoosts(b.boosts);
    if (v.error) fail(400, v.error);
    next.boosts = JSON.stringify(v.boosts);
  }
  const cols = Object.keys(next);
  await c.db.run(`UPDATE shops SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...cols.map((k) => next[k]), Date.now(), s.id);
  const shop = await shopRow(c.db, s.id);
  return json({ shop: shopView(shop, c.origin) });
}

async function syncNow(c) {
  const r = await syncClass(c, c.shop);
  if (!r.enabled) fail(400, 'Google Wallet مش مفعّل على السيرفر');
  const shop = await shopRow(c.db, c.shop.id);
  return json({ google: { ...googleStatus(c, shop), lastSync: r } });
}

// رسالة لكل الزبائن: لحاملي البطاقة بمحفظة Google، وللي فعّلوا إشعارات الويب
async function broadcast(c) {
  await requireActive(c);
  if (!isPro(c.shop)) {
    const t = perks.localTime(c.shop.country);
    const monthStart = Date.UTC(t.year, t.month - 1, 1) - tzOffset(c.shop.country, Date.now());
    const n = await c.db.get('SELECT COUNT(*) AS n FROM broadcasts WHERE shop_id = ? AND created_at >= ?', c.shop.id, monthStart);
    if (n.n >= BASIC_LIMITS.broadcasts) fail(403, `بعتت ${n.n} رسائل هالشهر، وهاد حد الباقة الأساسية. رقّي للمميزة 💎 لرسائل بلا حد`, { upgrade: true });
  }
  const header = clean(c.body.header, 40) || c.shop.name;
  const body = clean(c.body.body, 300);
  if (body.length < 2) fail(400, 'اكتب نص الرسالة');
  const r = await c.db.run('INSERT INTO broadcasts (shop_id, header, body, created_at) VALUES (?, ?, ?, ?)', c.shop.id, header, body, Date.now());
  let google = null;
  const cfg = c.shop.demo ? null : gw.googleConfig(c.env);
  if (cfg) {
    try {
      if (!c.shop.gw_synced_at) {
        const sync = await syncClass(c, c.shop);
        if (!sync.ok) throw new Error(sync.error);
      }
      await gw.addClassMessage(cfg, c.shop.id, { header, body });
      google = 'ok';
    } catch (e) {
      google = e.message;
    }
  }
  if (c.shop.demo) return json({ id: r.lastId, google: null, push: { sent: 0, failed: 0, next: null }, demo: true });
  return json({ id: r.lastId, google, push: await broadcastBatch(c, r.lastId, 0) });
}

// تجربة الرسالة على أجهزة صاحب المحل بس (ما بتنحسب من رسائل اليوم)
async function broadcastTest(c) {
  const header = clean(c.body.header, 40) || c.shop.name;
  const body = clean(c.body.body, 300);
  if (body.length < 2) fail(400, 'اكتب نص الرسالة');
  const subs = await c.db.all('SELECT * FROM user_push_subs WHERE user_id = ?', c.user.id);
  if (!subs.length) fail(400, 'عشان توصلك التجربة، فعّل «🔔 تنبيهات إلك» من الإعدادات على جوالك أول.');
  await rateLimit(c, `bctest:${c.user.id}`, 10, 60 * MIN, 'جرّبت كتير، استنى شوي');
  const r = await pushTo(c, subs, () => ({ title: header, body, icon: logoUrl(c.shop, c.origin), url: `${c.origin}/app#offers` }), 'user_push_subs');
  return json({ sent: r.ok, failed: r.error, reason: (r.results.find((x) => x.result !== 'ok') || {}).reason || null });
}

// ─── الكوبونات: عرض لمجموعة زبائن، وكل زبون بيصرفه مرة وحدة عند الكاشير ───
const SEGMENTS = {
  all: { name: 'كل الزبائن', where: '1 = 1', args: () => [] },
  silver: { name: 'الفضي والذهبي', where: 'visits >= ?', args: (shop) => [shop.tier_silver] },
  gold: { name: 'الذهبي بس', where: 'visits >= ?', args: (shop) => [shop.tier_gold] },
  absent: { name: 'اللي غابوا 30 يوم', where: 'COALESCE(last_visit, created_at) < ?', args: (shop, now) => [now - 30 * DAY] },
  bday: { name: 'مواليد هالشهر', where: 'birthday LIKE ?', args: (shop, now) => [`${String(perks.localTime(shop.country, now).month).padStart(2, '0')}-%`] },
  new: { name: 'الجداد (آخر 30 يوم)', where: 'created_at >= ?', args: (shop, now) => [now - 30 * DAY] },
};

const couponView = (cp) => ({ id: cp.id, title: cp.title, details: cp.details, segment: cp.segment, segmentName: SEGMENTS[cp.segment]?.name || '', expiresAt: cp.expires_at, issued: cp.issued, used: cp.used, createdAt: cp.created_at });

async function listCoupons(c) {
  const now = Date.now();
  const coupons = await c.db.all('SELECT * FROM coupons WHERE shop_id = ? ORDER BY created_at DESC LIMIT 20', c.shop.id);
  const segments = [];
  for (const [key, seg] of Object.entries(SEGMENTS)) {
    const row = await c.db.get(`SELECT COUNT(*) AS n FROM members WHERE shop_id = ? AND ${seg.where}`, c.shop.id, ...seg.args(c.shop, now));
    segments.push({ key, name: seg.name, count: row.n });
  }
  return json({ coupons: coupons.map(couponView), segments });
}

async function createCoupon(c) {
  requirePro(c, 'الكوبونات');
  await requireActive(c);
  const title = clean(c.body.title, 60);
  if (title.length < 2) fail(400, 'اكتب العرض (مثلاً: خصم 20% على الكيك)');
  const seg = SEGMENTS[c.body.segment];
  if (!seg) fail(400, 'اختار لمين الكوبون');
  const days = int(c.body.days, 1, 90, 'مدة الكوبون لازم تكون بين يوم و 90 يوم');
  const now = Date.now();
  const r = await c.db.run('INSERT INTO coupons (shop_id, title, details, segment, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    c.shop.id, title, clean(c.body.details, 200), c.body.segment, now + days * DAY, now);
  const ins = await c.db.run(`INSERT INTO member_coupons (coupon_id, member_id, shop_id) SELECT ?, id, shop_id FROM members WHERE shop_id = ? AND ${seg.where}`,
    r.lastId, c.shop.id, ...seg.args(c.shop, now));
  await c.db.run('UPDATE coupons SET issued = ? WHERE id = ?', ins.changes, r.lastId);
  if (c.shop.demo) return json({ id: r.lastId, issued: ins.changes, push: { sent: 0, failed: 0, next: null }, demo: true }, 201);
  return json({ id: r.lastId, issued: ins.changes, push: await couponBatch(c, r.lastId, 0) }, 201);
}

async function couponBatch(c, id, cursor) {
  const cp = await c.db.get('SELECT * FROM coupons WHERE id = ? AND shop_id = ?', id, c.shop.id);
  if (!cp) fail(404, 'ما لقينا الكوبون');
  if (c.shop.demo) return { sent: 0, failed: 0, next: null };
  const subs = await c.db.all(
    `SELECT p.*, m.token, m.lang FROM push_subs p JOIN members m ON m.id = p.member_id JOIN member_coupons mc ON mc.member_id = p.member_id AND mc.coupon_id = ?
     WHERE p.id > ? ORDER BY p.id LIMIT ?`, cp.id, cursor, PUSH_BATCH,
  );
  const days = Math.max(1, Math.round((cp.expires_at - cp.created_at) / DAY));
  const icon = logoUrl(c.shop, c.origin);
  const r = await pushTo(c, subs, (sub) => ({
    title: `🎟️ ${c.shop.name}`,
    body: isEn(sub) ? `${cp.title}${cp.details ? ` — ${cp.details}` : ''} · valid ${days === 1 ? 'today only' : `${days} days`}, show your card at the counter`
      : `${cp.title}${cp.details ? ` — ${cp.details}` : ''} · صالح ${days === 1 ? 'اليوم بس' : `${days} أيام`}، اعرض بطاقتك للكاشير`,
    icon, url: `${c.origin}/c/${sub.token}`, tag: `coupon-${cp.id}`,
  }));
  return { sent: r.ok, failed: r.error, next: subs.length === PUSH_BATCH ? subs[subs.length - 1].id : null };
}

async function couponContinue(c, id) {
  await requireActive(c);
  const cursor = int(c.body.cursor, 0, Number.MAX_SAFE_INTEGER, 'مؤشر غلط');
  return json({ push: await couponBatch(c, Number(id), cursor) });
}

async function stopCoupon(c, id) {
  const r = await c.db.run('UPDATE coupons SET expires_at = ? WHERE id = ? AND shop_id = ? AND expires_at > ?', Date.now(), Number(id), c.shop.id, Date.now());
  if (!r.changes) fail(404, 'ما لقينا كوبون شغّال');
  return listCoupons(c);
}

async function activeCoupons(db, memberId, now = Date.now()) {
  const rows = await db.all(
    `SELECT cp.* FROM member_coupons mc JOIN coupons cp ON cp.id = mc.coupon_id
     WHERE mc.member_id = ? AND mc.used_at IS NULL AND cp.expires_at > ? ORDER BY cp.expires_at`, memberId, now,
  );
  return rows.map((cp) => ({ id: cp.id, title: cp.title, details: cp.details, expiresAt: cp.expires_at }));
}

async function memberCoupons(c, id) {
  const m = await memberOf(c, id);
  return json({ coupons: await activeCoupons(c.db, m.id) });
}

async function useCoupon(c, id, couponId) {
  await requireActive(c);
  const m = await memberOf(c, id);
  const now = Date.now();
  const cid = Number(couponId);
  const res = await c.db.batch([
    [`UPDATE member_coupons SET used_at = ?, used_by = ? WHERE coupon_id = ? AND member_id = ? AND used_at IS NULL
      AND EXISTS (SELECT 1 FROM coupons WHERE id = ? AND shop_id = ? AND expires_at > ?)`, [now, c.user.id, cid, m.id, cid, c.shop.id, now]],
    // العدد بينحسب من جديد بدل +1، عشان طلب مكرر بنفس اللحظة ما يزيده مرتين
    ['UPDATE coupons SET used = (SELECT COUNT(*) FROM member_coupons WHERE coupon_id = ? AND used_at IS NOT NULL) WHERE id = ? AND shop_id = ?', [cid, cid, c.shop.id]],
  ]);
  if (!res[0].changes) fail(409, 'هالكوبون انصرف قبل أو خلص');
  return json({ ok: true, coupons: await activeCoupons(c.db, m.id) });
}

// ─── الرصيد المدفوع مسبقاً: الزبون بيشحن (مع هدية) وبيدفع منه بالمحل. المبالغ بالفلس (1000 = دينار) ───
const money = (mils) => String(Math.round(mils) / 1000);
function readMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 1000) fail(400, 'اكتب مبلغ بين 0 و 1000');
  return Math.round(n * 1000);
}

async function topup(c, id) {
  requirePro(c, 'شحن الرصيد'); // الصرف من رصيد موجود بيضل مسموح، لأنه مصاري الزبون
  await requireActive(c);
  if (!c.shop.credit_on) fail(400, 'الرصيد المدفوع مش مفعّل بهالمحل');
  const m = await memberOf(c, id);
  const amount = readMoney(c.body.amount);
  const bonus = c.body.bonus === false ? 0 : Math.floor((amount * c.shop.credit_bonus) / 100);
  const now = Date.now();
  const res = await applyTxn(c, [
    ["INSERT INTO credit_txns (shop_id, member_id, kind, amount, bonus, user_id, branch_id, idem, created_at) VALUES (?, ?, 'topup', ?, ?, ?, ?, ?, ?)", [c.shop.id, m.id, amount, bonus, c.user.id, branchFor(c), idemKey(c.body.key), now]],
    ['UPDATE members SET credit = credit + ?, updated_at = ? WHERE id = ? AND shop_id = ?', [amount + bonus, now, m.id, c.shop.id]],
  ]);
  if (!res) return respondMember(c, m.id, { duplicate: true });
  if (c.user.role === 'staff' && amount >= 50000) {
    await alertOwner(c, `topup:${c.user.id}`, { title: '💳 شحن رصيد كبير', body: `${c.user.name} شحن ${money(amount)} ${c.shop.currency} لـ ${m.name}` });
  }
  const cur = c.shop.currency;
  return respondMember(c, m.id, { topup: { amount: amount / 1000, bonus: bonus / 1000 } }, (fresh) => ({
    title: c.shop.name,
    body: isEn(fresh) ? `💳 Topped up ${money(amount)} ${cur}${bonus ? ` + ${money(bonus)} gift` : ''}. Your balance is ${money(fresh.credit)} ${cur}`
      : `💳 انشحن رصيدك ${money(amount)} ${cur}${bonus ? ` + ${money(bonus)} هدية` : ''}. رصيدك صار ${money(fresh.credit)} ${cur}`,
  }));
}

async function spend(c, id) {
  await requireActive(c);
  const m = await memberOf(c, id);
  const amount = readMoney(c.body.amount);
  const now = Date.now();
  const res = await applyTxn(c, [
    [`INSERT INTO credit_txns (shop_id, member_id, kind, amount, user_id, branch_id, idem, created_at)
      SELECT ?, id, 'spend', ?, ?, ?, ?, ? FROM members WHERE id = ? AND shop_id = ? AND credit >= ?`, [c.shop.id, amount, c.user.id, branchFor(c), idemKey(c.body.key), now, m.id, c.shop.id, amount]],
    ['UPDATE members SET credit = credit - ?, updated_at = ? WHERE id = ? AND shop_id = ? AND credit >= ?', [amount, now, m.id, c.shop.id, amount]],
  ]);
  if (!res) return respondMember(c, m.id, { duplicate: true });
  if (!res[1].changes) fail(409, `الرصيد ما بيكفي (رصيده ${money(m.credit)} ${c.shop.currency})`);
  const cur = c.shop.currency;
  return respondMember(c, m.id, { spent: amount / 1000 }, (fresh) => ({
    title: c.shop.name,
    body: isEn(fresh) ? `💳 ${money(amount)} ${cur} paid from your balance. ${money(fresh.credit)} ${cur} left`
      : `💳 انخصم ${money(amount)} ${cur} من رصيدك. باقي ${money(fresh.credit)} ${cur}`,
  }));
}

async function creditHistory(c, id) {
  const m = await memberOf(c, id);
  const rows = await c.db.all(
    `SELECT t.kind, t.amount, t.bonus, t.note, t.created_at AS at, u.name AS by FROM credit_txns t LEFT JOIN users u ON u.id = t.user_id
     WHERE t.member_id = ? ORDER BY t.created_at DESC LIMIT 15`, m.id,
  );
  return json({ credit: m.credit / 1000, history: rows.map((r) => ({ ...r, amount: r.amount / 1000, bonus: r.bonus / 1000 })) });
}

// ─── روابط المحل على البطاقة (إنستغرام، سناب شات، تيك توك، فيسبوك، واتساب، الموقع) ───
function normalizeLinks(b, country) {
  const out = {};
  const handle = (v, re) => {
    let x = String(v || '').trim();
    if (!x) return null;
    try { if (/^https?:\/\//i.test(x)) x = new URL(x).pathname.split('/').filter(Boolean)[0] || ''; } catch { return false; }
    x = x.replace(/^@/, '');
    return re.test(x) ? x : false;
  };
  const ig = handle(b.instagram, /^[A-Za-z0-9._]{1,30}$/);
  if (ig === false) fail(400, 'حساب إنستغرام مش صحيح');
  if (ig) out.instagram = `https://instagram.com/${ig}`;
  // سناب: الاسم لحاله، أو @الاسم، أو رابط snapchat.com/add/الاسم أو snapchat.com/@الاسم
  let sc = String(b.snapchat || '').trim();
  if (sc) {
    try { if (/^https?:\/\//i.test(sc)) { const parts = new URL(sc).pathname.split('/').filter(Boolean); sc = parts[0] === 'add' ? parts[1] || '' : parts[0] || ''; } } catch { sc = ''; }
    sc = sc.replace(/^@/, '');
    if (!/^[A-Za-z][A-Za-z0-9._-]{2,14}$/.test(sc)) fail(400, 'حساب سناب شات مش صحيح');
    out.snapchat = `https://www.snapchat.com/add/${sc}`;
  }
  const tt = handle(b.tiktok, /^[A-Za-z0-9._]{2,24}$/);
  if (tt === false) fail(400, 'حساب تيك توك مش صحيح');
  if (tt) out.tiktok = `https://www.tiktok.com/@${tt}`;
  const fb = handle(b.facebook, /^[A-Za-z0-9.\-]{3,60}$/);
  if (fb === false) fail(400, 'صفحة فيسبوك مش صحيحة');
  if (fb) out.facebook = `https://facebook.com/${fb}`;
  const wa = normPhone(b.whatsapp || '');
  if (wa) {
    const intl = wa.startsWith('0') ? (CALLING[country] || '') + wa.replace(/^0+/, '') : wa;
    if (!/^\d{8,15}$/.test(intl)) fail(400, 'رقم الواتساب مش صحيح');
    out.whatsapp = `https://wa.me/${intl}`;
  }
  const web = String(b.website || '').trim();
  if (web) {
    let ok = false;
    try { ok = new URL(web).protocol === 'https:' && web.length <= 200; } catch { ok = false; }
    if (!ok) fail(400, 'رابط الموقع لازم يبلّش بـ https://');
    out.website = web;
  }
  return out;
}

async function updateLinks(c) {
  const links = normalizeLinks(c.body, c.shop.country);
  await c.db.run('UPDATE shops SET links = ?, updated_at = ? WHERE id = ?', JSON.stringify(links), Date.now(), c.shop.id);
  const shop = await shopRow(c.db, c.shop.id);
  // الروابط على بطاقات Google Wallet (Apple بتاخدها لما البطاقة تتحدّث)
  if (shop.gw_synced_at) c.waitUntil(syncClass(c, shop));
  return json({ shop: shopView(shop, c.origin) });
}

// المالك بيربط الموظف بفرع (أو كل الفروع)
async function setStaffBranch(c, id) {
  const b = c.body.branchId ? String(c.body.branchId) : null;
  if (b && !branchesOf(c.shop).some((l) => l.id === b)) fail(400, 'ما لقينا هالفرع');
  const r = await c.db.run("UPDATE users SET branch_id = ? WHERE id = ? AND shop_id = ? AND role = 'staff'", b, Number(id), c.shop.id);
  if (!r.changes) fail(404, 'ما لقينا هالموظف');
  return listStaff(c);
}

// ─── المنيو الإلكتروني: أصناف بأسعار وصورة صغيرة اختيارية، وصفحة عامة /m/المحل ───
const MAX_MENU = 300;
const MAX_MENU_IMAGE = 200 * 1024;
const menuImageUrl = (it, origin) => (it.has_image ? `${origin}/media/menu/${it.id}.jpg?v=${it.updated_at}` : null);
const menuView = (it, origin) => ({ id: it.id, category: it.category, name: it.name, description: it.description, price: it.price, sizes: JSON.parse(it.sizes || '[]'), available: !!it.available, sort: it.sort, image: menuImageUrl(it, origin) });
const MENU_COLS = 'id, shop_id, category, name, description, price, sizes, available, sort, updated_at, image IS NOT NULL AS has_image';
const MAX_SIZES = 5;

function readPrice(raw, msg = 'السعر مش صحيح') {
  if (raw === null || raw === undefined || raw === '') return null;
  const price = Number(raw);
  if (!Number.isFinite(price) || price < 0 || price > 100000) fail(400, msg);
  return Math.round(price * 1000) / 1000;
}

// الأحجام (صغير، وسط، كبير…): كل حجم إله سعر، والزبون بيختار بينهم بصفحة المنيو
function readSizes(list) {
  if (!Array.isArray(list)) fail(400, 'الأحجام مش صحيحة');
  const sizes = [];
  for (const x of list) {
    const name = clean(x && x.name, 20);
    const price = readPrice(x && x.price, `سعر الحجم «${name || '؟'}» مش صحيح`);
    if (!name && price === null) continue;
    if (!name) fail(400, 'اكتب اسم الحجم (مثلاً: صغير)');
    if (price === null) fail(400, `اكتب سعر الحجم «${name}»`);
    if (sizes.some((y) => y.name === name)) fail(400, `الحجم «${name}» مكرر`);
    sizes.push({ name, price });
  }
  if (sizes.length > MAX_SIZES) fail(400, `لحد ${MAX_SIZES} أحجام للصنف`);
  if (sizes.length === 1) fail(400, 'الأحجام لازم تكون اتنين أو أكتر. لحجم واحد اكتب السعر بس');
  return sizes;
}

function readMenuItem(b, prev = {}) {
  const name = clean(b.name ?? prev.name, 60);
  if (name.length < 1) fail(400, 'اكتب اسم الصنف');
  const sizes = b.sizes !== undefined ? readSizes(b.sizes) : JSON.parse(prev.sizes || '[]');
  // مع الأحجام، السعر الأساسي هو أرخص حجم (بيلزم للترتيب وللي بيعرض سعر واحد)
  const price = sizes.length ? Math.min(...sizes.map((x) => x.price)) : readPrice(b.price !== undefined ? b.price : prev.price);
  return {
    category: clean(b.category ?? prev.category ?? '', 40),
    name,
    description: clean(b.description ?? prev.description ?? '', 200),
    price,
    sizes: JSON.stringify(sizes),
    available: (b.available ?? prev.available ?? true) ? 1 : 0,
    sort: Number.isInteger(Number(b.sort)) ? Number(b.sort) : (prev.sort ?? 0),
  };
}

function readMenuImage(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+=*)$/.exec(String(dataUrl || ''));
  if (!m) fail(400, 'الصورة لازم تكون PNG أو JPG');
  const bytes = b64ToBytes(m[2]);
  if (bytes.length > MAX_MENU_IMAGE) fail(400, 'الصورة كبيرة، صغّرها');
  const png = bytes[0] === 0x89 && bytes[1] === 0x50;
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!png && !jpg) fail(400, 'ملف الصورة تالف');
  return `${png ? 'image/png' : 'image/jpeg'};${m[2]}`;
}

async function listMenu(c) {
  const items = await c.db.all(`SELECT ${MENU_COLS} FROM menu_items WHERE shop_id = ? ORDER BY category, sort, id`, c.shop.id);
  return json({ items: items.map((it) => menuView(it, c.origin)), menuUrl: `${c.origin}/m/${c.shop.slug}`, pdf: menuPdfView(c.shop, c.origin) });
}

async function addMenuItem(c) {
  const count = await c.db.get('SELECT COUNT(*) AS n FROM menu_items WHERE shop_id = ?', c.shop.id);
  if (count.n >= MAX_MENU) fail(400, `لحد ${MAX_MENU} صنف`);
  const it = readMenuItem(c.body);
  const image = c.body.image ? readMenuImage(c.body.image) : null;
  const now = Date.now();
  await c.db.run('INSERT INTO menu_items (shop_id, category, name, description, price, sizes, image, available, sort, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    c.shop.id, it.category, it.name, it.description, it.price, it.sizes, image, it.available, it.sort, now, now);
  return listMenu(c);
}

async function updateMenuItem(c, id) {
  const prev = await c.db.get('SELECT * FROM menu_items WHERE id = ? AND shop_id = ?', Number(id), c.shop.id);
  if (!prev) fail(404, 'ما لقينا الصنف');
  const it = readMenuItem(c.body, prev);
  const image = c.body.removeImage ? null : c.body.image ? readMenuImage(c.body.image) : prev.image;
  await c.db.run('UPDATE menu_items SET category = ?, name = ?, description = ?, price = ?, sizes = ?, image = ?, available = ?, sort = ?, updated_at = ? WHERE id = ?',
    it.category, it.name, it.description, it.price, it.sizes, image, it.available, it.sort, Date.now(), prev.id);
  return listMenu(c);
}

async function deleteMenuItem(c, id) {
  const r = await c.db.run('DELETE FROM menu_items WHERE id = ? AND shop_id = ?', Number(id), c.shop.id);
  if (!r.changes) fail(404, 'ما لقينا الصنف');
  return listMenu(c);
}

// لما يصير عند المحل منيو (أو ينشال كله): منحدّث رابط المنيو ببطاقات Google، وبطاقات Apple بتاخده أول ما تتحدّث
const syncsMenu = (fn) => async (c, ...rest) => {
  const before = await menuUrlOf(c, c.shop);
  const res = await fn(c, ...rest);
  if ((await menuUrlOf(c, c.shop)) !== before) {
    c.shop.updated_at = Date.now();
    await c.db.run('UPDATE shops SET updated_at = ? WHERE id = ?', c.shop.updated_at, c.shop.id);
    if (c.shop.gw_synced_at) c.waitUntil(syncClass(c, c.shop));
  }
  return res;
};

// ─── ملف المنيو PDF ───
// المتصفح بيبعته قطع (كل قطعة لحد 600 كيلو، base64)، وأول ما توصل آخر قطعة بيصير هو المنيو المنشور
const MAX_MENU_PDF = 6 * 1024 * 1024;
const PDF_PART = 600 * 1024;
const B64_RE = /^[A-Za-z0-9+/]+=*$/;
const menuPdfUrl = (shop, origin) => (shop.menu_pdf ? `${origin}/media/menu-pdf/${shop.id}/${shop.menu_pdf}.pdf` : null);
const menuPdfView = (shop, origin) => (shop.menu_pdf ? { url: menuPdfUrl(shop, origin), size: shop.menu_pdf_size } : null);

async function uploadMenuPdf(c) {
  noDemo(c, 'رفع ملف المنيو');
  const s = c.shop;
  const size = Number(c.body.size);
  const parts = Number(c.body.parts);
  const part = Number(c.body.part);
  const data = String(c.body.data || '');
  if (!Number.isInteger(size) || size < 100 || size > MAX_MENU_PDF) fail(400, 'ملف المنيو لازم يكون أقل من 6 ميغا');
  if (parts !== Math.ceil(size / PDF_PART) || !Number.isInteger(part) || part < 0 || part >= parts) fail(400, 'قطعة الملف مش صحيحة');
  if (!data || data.length > Math.ceil(PDF_PART / 3) * 4 || !B64_RE.test(data)) fail(400, 'قطعة الملف مش صحيحة');
  let ver = Number(c.body.ver);
  if (part === 0) {
    if (!data.startsWith('JVBERi0')) fail(400, 'الملف لازم يكون PDF'); // «%PDF-»
    await rateLimit(c, `menupdf:${s.id}`, 10, 60 * MIN, 'رفعت ملفات كتير، استنى شوي');
    ver = Date.now();
    // رفعات قديمة ما كمّلت بتنمسح (المنيو المنشور بيضل لحد ما يكمل الجديد)
    await c.db.run('DELETE FROM menu_files WHERE shop_id = ? AND ver <> ?', s.id, s.menu_pdf);
  } else if (!Number.isInteger(ver) || ver <= 0) fail(400, 'قطعة الملف مش صحيحة');
  await c.db.run('INSERT OR REPLACE INTO menu_files (shop_id, ver, part, data) VALUES (?, ?, ?, ?)', s.id, ver, part, data);
  if (part < parts - 1) return json({ ver, next: part + 1 });
  // آخر قطعة: بنتأكد إنه كل القطع وصلت وحجمها مزبوط، وبعدين بننشره ومنمسح القديم
  const rows = await c.db.all('SELECT part, LENGTH(data) AS len, SUBSTR(data, -2) AS tail FROM menu_files WHERE shop_id = ? AND ver = ? ORDER BY part', s.id, ver);
  const got = rows.reduce((n, r) => n + Math.floor((r.len * 3) / 4) - (r.tail === '==' ? 2 : r.tail.endsWith('=') ? 1 : 0), 0);
  if (rows.length !== parts || rows.some((r, i) => r.part !== i) || got !== size) {
    await c.db.run('DELETE FROM menu_files WHERE shop_id = ? AND ver = ?', s.id, ver);
    fail(400, 'الملف ما وصل كامل، جرّب ترفعه كمان مرة');
  }
  await c.db.batch([
    ['UPDATE shops SET menu_pdf = ?, menu_pdf_size = ?, menu_pdf_parts = ?, updated_at = ? WHERE id = ?', [ver, size, parts, Date.now(), s.id]],
    ['DELETE FROM menu_files WHERE shop_id = ? AND ver <> ?', [s.id, ver]],
  ]);
  return json({ pdf: menuPdfView({ ...s, menu_pdf: ver, menu_pdf_size: size }, c.origin) });
}

async function deleteMenuPdf(c) {
  noDemo(c, 'حذف ملف المنيو');
  await c.db.batch([
    ['UPDATE shops SET menu_pdf = 0, menu_pdf_size = 0, menu_pdf_parts = 0 WHERE id = ?', [c.shop.id]],
    ['DELETE FROM menu_files WHERE shop_id = ?', [c.shop.id]],
  ]);
  return json({ pdf: null });
}

// بنبعت الملف قطعة قطعة (كل قطعة استعلام لحاله)، فما بنحمّل الملف كله بالذاكرة مرة وحدة
async function menuPdf(c, shopId, ver) {
  const shop = await c.db.get('SELECT id, menu_pdf, menu_pdf_size, menu_pdf_parts FROM shops WHERE id = ?', Number(shopId));
  if (!shop || !shop.menu_pdf || String(shop.menu_pdf) !== ver) return notFound(c);
  const fromB64 = Uint8Array.fromBase64 ? (x) => Uint8Array.fromBase64(x) : b64ToBytes;
  let part = 0;
  const stream = new ReadableStream({
    async pull(ctrl) {
      if (part >= shop.menu_pdf_parts) { ctrl.close(); return; }
      const row = await c.db.get('SELECT data FROM menu_files WHERE shop_id = ? AND ver = ? AND part = ?', shop.id, shop.menu_pdf, part++);
      if (!row) { ctrl.error(new Error('missing part')); return; }
      ctrl.enqueue(fromB64(row.data));
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'application/pdf', 'content-length': String(shop.menu_pdf_size), 'content-disposition': 'inline; filename="menu.pdf"',
      'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff',
    },
  });
}

// أصناف المنيو المتوفرة بأقسامها (الأقسام بترتيب أول صنف فيها)
async function menuCategories(c, shop) {
  const items = await c.db.all(`SELECT ${MENU_COLS} FROM menu_items WHERE shop_id = ? AND available = 1 ORDER BY sort, id`, shop.id);
  const cats = [];
  for (const it of items) {
    let cat = cats.find((x) => x.name === it.category);
    if (!cat) { cat = { name: it.category, items: [] }; cats.push(cat); }
    cat.items.push(menuView(it, c.origin));
  }
  return cats;
}

async function publicMenu(c, slug) {
  const shop = await shopBySlug(c.db, slug);
  return json({ shop: publicShopView(shop, c.origin), categories: await menuCategories(c, shop), pdf: menuPdfView(shop, c.origin) });
}

// ─── 🎯 وكيل المبيعات: بيدوّر على محلات، بيبعتلهم على واتساب، بيحكي معهم وبيفاوض (بدون خصم) ───
// للتشخيص بصفحة المبيعات: آخر خطأ من الذكاء الاصطناعي، وآخر رد ناجح
async function noteAi(c, ok, e = null, model = null) {
  const cfg = aiConfig(c.env);
  const v = { at: Date.now(), provider: cfg ? cfg.provider : null, ...(model ? { model: clean(model, 60) } : {}), ...(ok ? {} : { status: e && e.status, message: clean(e && e.message, 300) }) };
  try { await setSetting(c.db, ok ? 'ai_last_ok' : 'ai_last_error', JSON.stringify(v)); } catch { /* التشخيص ما بيوقف الشغل */ }
}

async function logAi(c, kind, usage) {
  await c.db.run(
    `INSERT INTO ai_usage (kind, day, requests, input_tokens, output_tokens, cache_read, cache_write, searches) VALUES (?, ?, 1, ?, ?, ?, ?, ?)
     ON CONFLICT(kind, day) DO UPDATE SET requests = requests + 1, input_tokens = input_tokens + excluded.input_tokens,
       output_tokens = output_tokens + excluded.output_tokens, cache_read = cache_read + excluded.cache_read,
       cache_write = cache_write + excluded.cache_write, searches = searches + excluded.searches`,
    kind, localDayKey('JO'), usage.input_tokens || 0, usage.output_tokens || 0, usage.cache_read_input_tokens || 0, usage.cache_creation_input_tokens || 0, usage.web_search_requests || 0,
  );
}

// استهلاك الوكيل من أول الشهر (بتوقيت الأردن): المجموع، ولكل قناة
async function aiMonth(db) {
  const t = perks.localTime('JO');
  const rows = await db.all(
    `SELECT kind, SUM(requests) AS requests, SUM(input_tokens) AS input, SUM(output_tokens) AS output, SUM(cache_read) AS cacheRead,
       SUM(cache_write) AS cacheWrite, SUM(searches) AS searches FROM ai_usage WHERE day >= ? GROUP BY kind`,
    String(t.year * 10000 + t.month * 100 + 1),
  );
  const total = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, searches: 0 };
  const byKind = {};
  for (const r of rows) {
    byKind[r.kind] = r.requests;
    for (const k of Object.keys(total)) total[k] += r[k] || 0;
  }
  return { ...total, byKind };
}

const ownerWhatsapp = (env) => (/^\d{8,15}$/.test(String(env.WHATSAPP_NUMBER || '')) ? String(env.WHATSAPP_NUMBER) : null);

// التعليمات (بالكاش) + القناة والمحل (وأول رسالة بعتناله) والعرض
async function salesSystem(c, channel, prospect, offer) {
  const first = prospect && await c.db.get("SELECT text FROM sales_msgs WHERE prospect_id = ? AND role <> 'in' ORDER BY id LIMIT 1", prospect.id);
  const rules = sales.salesRules({
    plans: PLANS, features: FEATURES, apple: !!(await appleConfig(c, { withKey: false })), signupOpen: !c.env.SIGNUP_CODE, origin: c.origin, ownerWhatsapp: ownerWhatsapp(c.env),
  });
  const t = perks.localTime('JO');
  const today = `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
  return [
    { type: 'text', text: rules, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: sales.salesContext({ channel, today, prospect, firstMessage: first && first.text, offer, offerLink: offer ? offerLink(c, offer.code) : null }) },
  ];
}

const OFFER_RE = /^[a-z2-9]{8}$/;
const offerLink = (c, code) => `${c.origin}/?offer=${code}#start`;
async function liveOffer(db, code) {
  const v = String(code || '').toLowerCase();
  return OFFER_RE.test(v) ? db.get('SELECT * FROM offers WHERE code = ? AND used_at IS NULL AND expires_at > ?', v, Date.now()) : null;
}

// 🎁 عرض: تجربة مجانية أطول برابط خاص (بدون أي خصم). لنفس المحل بنحدّث العرض الموجود وما منقصّر أيامه
async function createOffer(c, { prospect = null, shopName = null, channel, input }) {
  const days = Number(input.trial_days);
  if (!Number.isInteger(days) || days <= sales.BASE_TRIAL || days > sales.MAX_TRIAL) throw new Error(`trial_days لازم يكون بين ${sales.BASE_TRIAL + 1} و ${sales.MAX_TRIAL}`);
  const plan = readTier(input.plan);
  const now = Date.now();
  const expires = now + sales.OFFER_DAYS * DAY;
  const old = prospect && await c.db.get('SELECT * FROM offers WHERE prospect_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1', prospect.id, now);
  let code;
  if (old) {
    code = old.code;
    await c.db.run('UPDATE offers SET trial_days = MAX(trial_days, ?), plan = ?, expires_at = ? WHERE code = ?', days, plan, expires, code);
  } else {
    code = randomToken(8);
    await c.db.run('INSERT INTO offers (code, prospect_id, shop_name, trial_days, plan, channel, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      code, prospect ? prospect.id : null, clean(shopName || (prospect && prospect.name), 60) || null, days, plan, channel, expires, now);
  }
  const row = await c.db.get('SELECT * FROM offers WHERE code = ?', code);
  if (prospect) await c.db.run("UPDATE prospects SET note = TRIM(COALESCE(note, '') || ?) WHERE id = ?", ` 🎁 عرض تجربة ${row.trial_days} يوم: ${clean(input.reason, 120)}`, prospect.id);
  return { code, trialDays: row.trial_days, link: offerLink(c, code), validUntil: new Date(expires).toISOString().slice(0, 10) };
}

async function publicOffer(c, code) {
  const o = await liveOffer(c.db, code);
  if (!o) fail(404, 'العرض خلص أو مش موجود');
  return json({ trialDays: o.trial_days, plan: o.plan, shopName: o.shop_name, expiresAt: o.expires_at });
}

const SALES_DOWN = 'المساعد مش متاح هلأ، جرّب بعد شوي أو احكينا على واتساب';

// أدوات الوكيل مع محل معروف (على واتساب، أو بالموقع من رابطه الخاص)
function prospectTools(c, p, channel) {
  return async (name, input) => {
    if (name === 'make_offer') {
      const o = await createOffer(c, { prospect: p, channel, input });
      return { link: o.link, trial_days: o.trialDays, valid_until: o.validUntil };
    }
    if (name === 'save_contact') {
      await c.db.run(
        "UPDATE prospects SET owner_name = COALESCE(NULLIF(?, ''), owner_name), kind = COALESCE(NULLIF(?, ''), kind), area = COALESCE(NULLIF(?, ''), area), note = ? WHERE id = ?",
        clean(input.owner_name, 60), clean(input.kind, 40), clean(input.area, 60), clean(input.note, 500), p.id,
      );
      return { saved: true };
    }
    if (name === 'call_owner') {
      await c.db.run("UPDATE prospects SET status = 'hot' WHERE id = ? AND status <> 'won'", p.id);
      await notifyAdmin(c, { title: `🙋 ${p.name} بده يحكي معك`, body: clean(input.reason, 140), url: `${c.origin}/app#admin` });
      await alertOwnerWa(c, { event: 'بده يحكي معك', who: p.name, phone: p.wa ? `+${p.wa}` : p.phone, about: clean(input.reason, 140), key: `p:${p.id}` });
      return { notified: true };
    }
    if (name === 'set_status') {
      if (!['lost', 'optout'].includes(input.status)) throw new Error('حالة مش معروفة');
      await c.db.run("UPDATE prospects SET status = ? WHERE id = ? AND status <> 'won'", input.status, p.id); // اللي سجّل بيضل «سجّل»
      return { saved: true };
    }
    throw new Error(`أداة مش معروفة: ${name}`);
  };
}

// الحالات اللي بتصير «عم يحكي» لما المحل يرد
const TALKING_FROM = "('new', 'sent', 'failed', 'manual', 'lost', 'optout')";

// 💬 المحادثة بصفحة نقاطك الرئيسية: الزائر بيبعت المحادثة كلها. محادثة الزائر العادي ما بتنحفظ،
// ومحادثة المحل اللي فتح رابطه الخاص (/?p=…) بتنحفظ عشان تقرأها وتكمّل معه
async function salesChat(c) {
  const cfg = aiConfig(c.env);
  if (!cfg) fail(404, 'المساعد مش مفعّل');
  const messages = cleanHistory(c.body.messages);
  if (!messages) fail(400, 'اكتب سؤالك');
  await rateLimit(c, `ai:v:${c.ip}`, cfg.perVisitor, DAY, 'حكينا كتير اليوم 🙏 كمّل معنا على واتساب أو جرّب بكرا');
  await rateLimit(c, 'ai:all', cfg.platform, DAY, 'المساعد مشغول هلأ، جرّب بعد شوي');
  const offer = await liveOffer(c.db, c.body.offer);
  let prospect = await prospectByCode(c.db, c.body.prospect);
  if (!prospect && offer && offer.prospect_id) prospect = await c.db.get('SELECT * FROM prospects WHERE id = ?', offer.prospect_id);
  const shopOffer = prospect ? await c.db.get('SELECT * FROM offers WHERE prospect_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1', prospect.id, Date.now()) : offer;
  let lead = false;
  let made = null;
  const known = prospect && prospectTools(c, prospect, 'web');
  const runTool = async (name, input) => {
    if (name === 'make_offer') {
      await rateLimit(c, `offer:${c.ip}`, 3, DAY, 'ما بقدر أعمل عروض زيادة اليوم');
      made = await createOffer(c, { prospect, shopName: offer && offer.shop_name, channel: 'web', input });
      return { link: made.link, trial_days: made.trialDays, valid_until: made.validUntil };
    }
    if (known) return known(name, input);
    if (name === 'save_contact') {
      await saveLead(c, { shopName: input.shop_name, name: input.name, phone: input.phone, city: input.city, kind: input.kind, note: input.note, partner: c.body.partner }, 'ai');
      lead = true;
      return { saved: true };
    }
    throw new Error(`أداة مش معروفة: ${name}`);
  };
  let r;
  try {
    r = await chat(cfg, { system: await salesSystem(c, 'web', prospect, shopOffer), messages, tools: prospect ? sales.waTools() : sales.webTools(), runTool });
  } catch (e) {
    console.error('sales:', e.status || '', e.message);
    await noteAi(c, false, e);
    fail(503, e.status === 429 ? 'المساعد مشغول كتير هلأ، جرّب بعد شوي أو احكينا على واتساب' : SALES_DOWN);
  }
  await logAi(c, 'web', r.usage);
  await noteAi(c, true, null, r.model);
  const reply = r.refused || !r.text ? 'ما بقدر أساعد بهالسؤال 🙏 بس بقدر أحكيلك عن نقاطك وأسعارها، أو تشوف المحل التجريبي.' : r.text;
  if (prospect) {
    const now = Date.now();
    await saveSalesMsg(c.db, prospect.id, 'in', messages[messages.length - 1].content, null, now, 'web'); // cleanHistory قصّها أصلاً
    await saveSalesMsg(c.db, prospect.id, 'agent', reply, null, now + 1, 'web');
    await c.db.run(`UPDATE prospects SET last_in_at = ?, last_out_at = ?, status = CASE WHEN status IN ${TALKING_FROM} THEN 'talking' ELSE status END WHERE id = ?`, now, now, prospect.id);
    if (!prospect.last_in_at) await notifyAdmin(c, { title: `💬 ${prospect.name} عم يحكي مع وكيل المبيعات`, body: messages[messages.length - 1].content.slice(0, 120), url: `${c.origin}/app#admin` });
    await alertOwnerWa(c, { event: prospect.last_in_at ? 'رسالة جديدة بالموقع' : 'بلّش يحكي مع الوكيل بالموقع', who: prospect.name, phone: prospect.wa ? `+${prospect.wa}` : prospect.phone, about: messages[messages.length - 1].content, key: `c:${prospect.id}`, every: HOUR });
  }
  return json({ reply, lead, offer: made ? { code: made.code, trialDays: made.trialDays } : null });
}

// 🔗 رابط المحل الخاص (/?p=…): بيرجّع اسمه للصفحة، وأول مرة بيفتحه بيوصلك إشعار
const PROSPECT_RE = /^[a-z2-9]{8}$/;
async function prospectByCode(db, code) {
  const v = String(code || '').toLowerCase();
  return PROSPECT_RE.test(v) ? db.get('SELECT * FROM prospects WHERE code = ?', v) : null;
}

async function publicProspect(c, code) {
  const p = await prospectByCode(c.db, code);
  if (!p || p.status === 'optout') fail(404, 'الرابط مش موجود');
  if (!p.opened_at) {
    const r = await c.db.run('UPDATE prospects SET opened_at = ? WHERE id = ? AND opened_at IS NULL', Date.now(), p.id);
    if (r.changes) await notifyAdmin(c, { title: `👀 ${p.name} فتح رابطه`, body: 'الوكيل جاهز يحكي معه بالموقع', url: `${c.origin}/app#admin` });
  }
  return json({ name: p.name });
}

// ─── 📲 واتساب ───
const WA_PLACEHOLDER = { image: '[بعت صورة]', audio: '[بعت رسالة صوتية]', video: '[بعت فيديو]', sticker: '[بعت ستيكر]', document: '[بعت ملف]', location: '[بعت موقع]', contacts: '[بعت جهة اتصال]' };
// الأخطاء اللي بتخص الرقم نفسه (مش واتساب، أو ما بده رسائل تسويق)؛ غيرها (القالب، التوكن) بيوقف الإرسال كله
const WA_RECIPIENT_ERRORS = new Set([131026, 131049, 131047, 131021, 131050, 131051, 130472]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function saveSalesMsg(db, prospectId, role, text, waId = null, at = Date.now(), channel = 'wa') {
  return db.run('INSERT INTO sales_msgs (prospect_id, role, text, wa_id, channel, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING', prospectId, role, text, waId, channel, at);
}

// أول رسالة (القالب). بيرجّع true إذا انبعتت
async function sendIntro(c, wcfg, p, now = Date.now()) {
  const claim = await c.db.run("UPDATE prospects SET status = 'sent', sent_at = ?, error = NULL WHERE id = ? AND status IN ('new', 'failed') AND wa IS NOT NULL", now, p.id);
  if (!claim.changes) return false;
  try {
    const id = await wa.sendTemplate(wcfg, p.wa, p.name);
    await saveSalesMsg(c.db, p.id, 'agent', sales.templateFor(p.name), id, now);
    await c.db.run('UPDATE prospects SET last_out_at = ? WHERE id = ?', now, p.id);
    return true;
  } catch (e) {
    const msg = clean(`${e.message}${e.code ? ` (${e.code})` : ''}`, 200);
    if (!e.status) {
      // ما وصلنا لـ Meta (الشبكة): بيرجع للدور ومنجرّب بالدورة الجاية، بدون ما نوقف الإرسال
      await c.db.run("UPDATE prospects SET status = 'new', sent_at = NULL, error = ? WHERE id = ?", msg, p.id);
      const err = new Error(msg);
      err.stop = true;
      throw err;
    }
    if (await introFailed(c, p, e.code, msg)) return false;
    const err = new Error(msg);
    err.stop = true;
    throw err;
  }
}

// أول رسالة ما وصلت (فوراً، أو بإشعار من Meta بعدين). مشكلة بالرقم نفسه: المحل بيصير «ما انبعتت» وبيرجّع true.
// مشكلة بالحساب أو القالب: المحل بيرجع للدور والإرسال التلقائي بيوقف لحد ما تصلّحها
async function introFailed(c, p, code, msg) {
  if (WA_RECIPIENT_ERRORS.has(code)) {
    await c.db.run('UPDATE prospects SET status = ?, sent_at = NULL, error = ? WHERE id = ?', code === 131050 ? 'optout' : 'failed', msg, p.id);
    return true;
  }
  await c.db.run("UPDATE prospects SET status = 'new', sent_at = NULL, error = ? WHERE id = ?", msg, p.id);
  await stopOutreach(c, msg);
  return false;
}

// كل 5 دقايق: لحد رسالتين، بأوقات الدوام بالأردن (10 الصبح لـ 8 المسا، مش الجمعة)، وضمن الحد باليوم
async function salesOutreachJob(c, now) {
  const wcfg = wa.waConfig(c.env);
  if (!wcfg || (await getSetting(c.db, 'sales_auto')) !== '1') return 0;
  const t = perks.localTime('JO', now);
  if (t.weekday === 5 || t.hour < 10 || t.hour >= 20) return 0;
  const daily = Number(await getSetting(c.db, 'sales_daily')) || SALES_DAILY;
  const sent = (await c.db.get('SELECT COUNT(*) AS n FROM prospects WHERE sent_at > ?', now - DAY)).n;
  if (sent >= daily || !(await c.db.get("SELECT id FROM prospects WHERE status = 'new' AND wa IS NOT NULL AND paused = 0 LIMIT 1"))) return 0;
  if (!(await qualityOk(c, wcfg, now))) return 0;
  let n = 0;
  for (let room = Math.min(2, daily - sent); room > 0; room--) {
    const p = await c.db.get("SELECT * FROM prospects WHERE status = 'new' AND wa IS NOT NULL AND paused = 0 ORDER BY id LIMIT 1");
    if (!p) break;
    try {
      if (await sendIntro(c, wcfg, p, now)) n++;
    } catch (e) {
      if (e.stop) break;
      throw e;
    }
  }
  return n;
}
const SALES_DAILY = 20;

// الـ webhook تبع Meta: GET للربط أول مرة، وPOST لكل رسالة واصلة (موقّعة بسر التطبيق)
async function waWebhook(c) {
  const wcfg = wa.waConfig(c.env);
  if (c.req.method === 'GET') {
    const q = c.url.searchParams;
    if (wcfg && wcfg.verifyToken && q.get('hub.mode') === 'subscribe' && q.get('hub.verify_token') === wcfg.verifyToken) {
      return new Response(q.get('hub.challenge') || '', { headers: { 'content-type': 'text/plain' } });
    }
    return new Response('forbidden', { status: 403 });
  }
  if (c.req.method !== 'POST' || !wcfg) return new Response('not found', { status: 404 });
  const raw = await c.req.text();
  if (raw.length > MAX_BODY) return new Response('too large', { status: 413 });
  const signed = await wa.verifySignature(wcfg.appSecret, raw, c.req.headers.get('x-hub-signature-256'));
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = null; }
  // للتشخيص بصفحة المبيعات: آخر إشعار وصل من Meta (بدون نص الرسائل). اللي مش موقّع (ممكن من أي حدا) مرة بالدقيقة بالكتير
  const prev = signed ? null : await jsonSetting(c.db, 'wa_last_hook');
  if (signed || !prev || prev.at < Date.now() - 60_000) await setSetting(c.db, 'wa_last_hook', JSON.stringify({ at: Date.now(), signed, ...wa.hookSummary(payload, wcfg.phoneId) }));
  if (!signed) return new Response('bad signature', { status: 401 });
  if (!payload) return new Response('bad json', { status: 400 });
  for (const m of wa.incoming(payload, wcfg.phoneId)) await waIncoming(c, wcfg, m);
  for (const f of wa.failures(payload, wcfg.phoneId)) await waFailed(c, f);
  for (const ev of wa.accountEvents(payload, wcfg.wabaId)) await waAccountEvent(c, wcfg, ev);
  return new Response('ok');
}

// رسالة إلنا فشلت بعد ما Meta قبلتها. إذا كانت أول رسالة (القالب): نفس اللي بنعمله لما Meta ترفض فوراً،
// يعني الرقم بيصير «ما انبعتت»، ومشكلة الحساب (الدفع، القالب) بتوقف الإرسال التلقائي وبتبلّغك
async function waFailed(c, f) {
  const msg = clean(`${f.message}${f.code ? ` (${f.code})` : ''}`, 200);
  const alert = await jsonSetting(c.db, 'wa_alert_last');
  if (alert && alert.id && alert.id === f.id) { // التنبيه اللي انبعتلك ما وصل
    await setSetting(c.db, 'wa_alert_last', JSON.stringify({ ...alert, ok: false, message: msg }));
    return;
  }
  const sent = await c.db.get('SELECT prospect_id FROM sales_msgs WHERE wa_id = ?', f.id);
  const p = sent && await c.db.get('SELECT * FROM prospects WHERE id = ?', sent.prospect_id);
  if (!p) return;
  // للتشخيص بمربع رقم الإيجنت: آخر رسالة فشلت ولمين
  await setSetting(c.db, 'wa_last_failure', JSON.stringify({ at: Date.now(), code: f.code, message: msg, name: p.name }));
  if (p.status !== 'sent' || p.last_in_at) {
    await c.db.run('UPDATE prospects SET error = ? WHERE id = ?', msg, p.id);
    return;
  }
  await introFailed(c, p, f.code, msg);
}

// بيطفي الإرسال التلقائي وبيحفظ السبب (بيبيّن بصفحة المبيعات). الإشعار بس إذا كان شغّال
async function stopOutreach(c, why) {
  const was = (await getSetting(c.db, 'sales_auto')) === '1';
  await setSetting(c.db, 'sales_auto', '0');
  await setSetting(c.db, 'sales_stop', JSON.stringify({ at: Date.now(), why: clean(why, 300) }));
  if (was) await notifyAdmin(c, { title: '⚠️ وكيل المبيعات وقف الإرسال لحاله', body: clean(why, 140), url: `${c.origin}/app#admin` });
}

// Meta وقّفت القالب أو نزّلت تقييم الرقم (ناس حظروا أو بلّغوا): بنوقف الإرسال قبل ما الرقم يتقيّد
const TEMPLATE_STOP = new Set(['PAUSED', 'DISABLED', 'FLAGGED', 'REJECTED', 'PENDING_DELETION']);
const QUALITY_STOP = new Set(['FLAGGED', 'DOWNGRADE']);
async function waAccountEvent(c, wcfg, ev) {
  if (ev.kind === 'template' && ev.name === wcfg.template && TEMPLATE_STOP.has(ev.event)) {
    await stopOutreach(c, `Meta وقّفت قالب أول رسالة (${ev.event})${ev.reason ? `: ${ev.reason}` : ''}. غالباً ناس بلّغوا عنه أو حظروا الرقم`);
  } else if (ev.kind === 'quality' && QUALITY_STOP.has(ev.event)) {
    await stopOutreach(c, `Meta نزّلت تقييم رقم الوكيل (${ev.event}) لأنه ناس حظروا أو بلّغوا. استنى كم يوم وارجع ابدأ بعدد أقل`);
  }
}

// تقييم الرقم عند Meta (أخضر، أصفر، أحمر) كل ساعة: إذا نزل عن آخر مرة، بنوقف الإرسال.
// إذا رجّعت تشغّله وهو أصفر بنكمّل، بس إذا صار أحمر بنوقف
const QUALITY_RANK = { GREEN: 0, UNKNOWN: 0, YELLOW: 1, RED: 2 };
async function qualityOk(c, wcfg, now) {
  const last = await jsonSetting(c.db, 'wa_quality');
  if (last && now - last.at < HOUR) return true;
  let rating;
  try { rating = String((await wa.numberStatus(wcfg)).quality_rating || '').toUpperCase() || null; } catch { return true; } // ما قدرنا نفحص: منكمّل
  await setSetting(c.db, 'wa_quality', JSON.stringify({ at: now, rating }));
  const rank = QUALITY_RANK[rating] || 0;
  if (rank >= 1 && rank > (QUALITY_RANK[last && last.rating] || 0)) {
    await stopOutreach(c, rating === 'RED'
      ? 'تقييم رقم الوكيل عند Meta صار أحمر (ناس كتير حظروا أو بلّغوا). وقّف كم يوم قبل ما ترجع تبعت، وإلا ممكن الرقم ينحظر'
      : 'تقييم رقم الوكيل عند Meta صار أصفر (في ناس حظروا أو بلّغوا). استنى يوم أو يومين، ولما ترجع شغّله خلّي العدد أقل (10 باليوم)');
    return false;
  }
  return true;
}

async function waIncoming(c, wcfg, m) {
  const from = wa.waNumber(m.from) || m.from;
  if (!/^\d{8,15}$/.test(from)) return;
  const now = Date.now();
  if (from === ownerWhatsapp(c.env)) return ownerMessaged(c, wcfg, from, now, m);
  let p = await c.db.get('SELECT * FROM prospects WHERE wa = ?', from);
  // جاي من رابط رسالتك («… #رمز»): بنربطه بمحله، حتى لو راسل من رقم غير اللي لقيناه
  const code = !p && /#([a-z2-9]{8})(?![a-z2-9])/i.exec(m.text || '');
  const linked = code && await prospectByCode(c.db, code[1]);
  if (linked) {
    await c.db.run('UPDATE prospects SET wa = ? WHERE id = ?', from, linked.id);
    p = { ...linked, wa: from };
  } else if (!p) {
    const name = clean(m.name, 60); // اسمه على واتساب، إلا إذا رموز بس (متل «.»)
    await c.db.run("INSERT INTO prospects (name, phone, wa, code, status, source, created_at) VALUES (?, ?, ?, ?, 'talking', 'inbound', ?) ON CONFLICT DO NOTHING", /[\p{L}\p{N}]/u.test(name) ? name : `+${from}`, `+${from}`, from, randomToken(8), now);
    p = await c.db.get('SELECT * FROM prospects WHERE wa = ?', from);
    if (!p) return;
  }
  const text = m.text || WA_PLACEHOLDER[m.type] || '[رسالة]';
  const ins = await saveSalesMsg(c.db, p.id, 'in', text, m.id, now);
  if (!ins.changes) return; // Meta بتعيد نفس الرسالة أحياناً
  if (wa.isOptOut(m.text, { firstReply: !p.last_in_at })) {
    await c.db.run("UPDATE prospects SET status = CASE WHEN status = 'won' THEN status ELSE 'optout' END, last_in_at = ? WHERE id = ?", now, p.id);
    try {
      const bye = 'تمام، ما رح نرجع نبعتلك 🙏 وإذا احتجت إشي بأي وقت، إحنا هون.';
      await saveSalesMsg(c.db, p.id, 'agent', bye, await wa.sendText(wcfg, from, bye));
    } catch (e) { console.error('wa bye:', e.message); }
    return;
  }
  await c.db.run(`UPDATE prospects SET last_in_at = ?, status = CASE WHEN status IN ${TALKING_FROM} THEN 'talking' ELSE status END WHERE id = ?`, now, p.id);
  if (!p.last_in_at) await notifyAdmin(c, { title: p.source === 'inbound' ? '💬 حدا جديد راسل وكيل المبيعات' : `💬 ${p.name} رد على وكيل المبيعات`, body: text.slice(0, 120), url: `${c.origin}/app#admin` });
  else if (p.paused || !aiConfig(c.env)) await notifyAdmin(c, { title: `💬 ${p.name}`, body: text.slice(0, 120), url: `${c.origin}/app#admin` });
  await alertOwnerWa(c, {
    event: !p.last_in_at ? (p.source === 'inbound' ? 'حدا جديد راسل الوكيل' : 'رد على الوكيل') : p.paused || !aiConfig(c.env) ? 'رسالة جديدة، رد عليه إنت' : 'رسالة جديدة',
    who: p.name, phone: `+${from}`, about: text, key: `c:${p.id}`, every: HOUR,
  });
  if (p.paused || !aiConfig(c.env)) return;
  c.waitUntil(waReply(c, wcfg, p.id, ins.lastId).catch(async (e) => {
    console.error('wa reply:', e.status || '', e.message);
    // بدون رد، المحل بيضل مستني: بنبلّغك عشان ترد إنت
    if (e.wa) await c.db.run('UPDATE prospects SET error = ? WHERE id = ?', clean(`واتساب: ${e.message}`, 200), p.id);
    else await noteAi(c, false, e);
    await notifyAdmin(c, { title: `⚠️ الوكيل ما قدر يرد على ${p.name}`, body: `${text.slice(0, 80)} · رد عليه إنت من 🎯 المبيعات`, url: `${c.origin}/app#admin` });
    await alertOwnerWa(c, { event: 'الوكيل ما قدر يرد عليه، رد إنت', who: p.name, phone: `+${from}`, about: text, key: `s:${p.id}` });
  }).catch((e) => console.error('wa reply alert:', e.message)));
}

// الوكيل ما رح يرد على هالمحل: بنبلّغك (مرة باليوم لكل محل) عشان ترد إنت
async function agentSilent(c, p, why) {
  try { await rateLimit(c, `ai:wa:silent:${p.id}`, 1, DAY); } catch { return; }
  await notifyAdmin(c, { title: `⚠️ الوكيل ما رد على ${p.name}`, body: `${why} · رد عليه إنت من 🎯 المبيعات`, url: `${c.origin}/app#admin` });
  await alertOwnerWa(c, { event: 'الوكيل ما رد عليه، رد إنت', who: p.name, phone: p.wa ? `+${p.wa}` : p.phone, about: why, key: `s:${p.id}` });
}

// 📲 تنبيه على واتسابك (WHATSAPP_NUMBER) من رقم الإيجنت: حدا راسل الوكيل، رسالة جديدة بمحادثة، بده يحكي معك، ترك طلب، أو الوكيل ما رد.
// إذا راسلت رقم الإيجنت آخر 24 ساعة بيوصلك نص عادي، وإلا بالقالب (nuqatak_alert) لأنه واتساب ما بيسمح غير هيك.
// a: { event (شو صار)، who، phone، about (الرسالة أو التفاصيل)، key (نفس الإشي ما بيتكرر قبل every) }
async function alertOwnerWa(c, a) {
  const wcfg = wa.waConfig(c.env);
  const to = ownerWhatsapp(c.env);
  if (!wcfg || !to) return;
  try {
    if (a.key) await rateLimit(c, `walert:${a.key}`, 1, a.every || 3 * HOUR);
    await rateLimit(c, 'walert:all', 60, DAY);
  } catch { return; }
  c.waitUntil(sendOwnerAlert(c, wcfg, to, a).catch((e) => console.error('wa alert:', e.message)));
}

// 🧑‍💼 رقمك راسل رقم الإيجنت: مش محل. الوكيل بيصير مساعدك: «شو الأخبار؟ مين بده يشترك؟» وبيرد بتقرير من بيانات المنصة.
// كمان بيفتح 24 ساعة التنبيهات فيها نص عادي ببلاش
async function ownerMessaged(c, wcfg, from, now, m) {
  await setSetting(c.db, 'owner_wa_in', now);
  const text = clean(m.text, 1000);
  if (!text) return;
  if (m.id && (await getSetting(c.db, 'owner_last_msg')) === m.id) return; // Meta بتعيد نفس الرسالة أحياناً
  await setSetting(c.db, 'owner_last_msg', m.id || '');
  c.waitUntil(ownerReply(c, wcfg, from, text, now).catch((e) => console.error('wa owner:', e.status || '', e.message)));
}

async function ownerReply(c, wcfg, to, text, now) {
  const report = await ownerReport(c, now);
  const cfg = aiConfig(c.env);
  let reply = null;
  if (cfg) {
    try {
      await rateLimit(c, 'ai:owner', 60, DAY);
      const history = ((await jsonSetting(c.db, 'owner_chat')) || []).filter((x) => now - x.at < DAY).slice(-8);
      const messages = cleanHistory([...history.map(({ role, content }) => ({ role, content })), { role: 'user', content: text }]);
      const t = perks.localTime('JO', now);
      const when = `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')} ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
      const r = await chat(cfg, { system: sales.ownerSystem({ report, now: when, origin: c.origin }), messages, maxTokens: 3000 });
      await logAi(c, 'owner', r.usage);
      await noteAi(c, true, null, r.model);
      if (!r.refused && r.text) {
        reply = r.text;
        await setSetting(c.db, 'owner_chat', JSON.stringify([...history, { role: 'user', content: text, at: now }, { role: 'assistant', content: clean(reply, 1000), at: Date.now() }].slice(-8)));
      }
    } catch (e) {
      if (!(e instanceof HttpError)) await noteAi(c, false, e);
    }
  }
  await wa.sendText(wcfg, to, reply || `📋 الوضع هلأ:\n\n${report}`);
}

// الوضع كله بنص واحد (للوكيل يجاوبك منه، أو بيوصلك هو نفسه إذا الذكاء مش شغّال)
const agoAr = (ms) => (ms < HOUR ? `قبل ${Math.max(1, Math.round(ms / MIN))} دقيقة` : ms < DAY ? `قبل ${Math.round(ms / HOUR)} ساعة` : `قبل ${Math.round(ms / DAY)} يوم`);
async function ownerReport(c, now = Date.now()) {
  const L = [];
  const lastIn = (id) => c.db.get("SELECT text FROM sales_msgs WHERE prospect_id = ? AND role = 'in' ORDER BY id DESC LIMIT 1", id);
  const phoneOf = (p) => (p.wa ? `+${p.wa}` : p.phone || 'بدون رقم');

  const hot = await c.db.all("SELECT * FROM prospects WHERE status = 'hot' ORDER BY COALESCE(last_in_at, created_at) DESC LIMIT 10");
  L.push(`🔥 بدهم يحكوا معك (${hot.length}):`);
  for (const p of hot) L.push(`- ${p.name} · ${phoneOf(p)}${p.last_in_at ? ` · ${agoAr(now - p.last_in_at)}` : ''}${p.note ? ` · ${clean(p.note, 120)}` : ''} · آخر رسالة: «${clean((await lastIn(p.id) || {}).text, 120)}»`);
  if (!hot.length) L.push('- ولا حدا');

  const leads = await c.db.all("SELECT * FROM leads WHERE status = 'new' ORDER BY created_at DESC LIMIT 10");
  L.push('', `📩 طلبات اشتراك لسا ما حكيتهم (${leads.length}):`);
  for (const l of leads) L.push(`- ${l.shop_name} · ${l.name} · ${l.phone}${l.kind ? ` · ${l.kind}` : ''}${l.city ? ` · ${l.city}` : ''} · ${agoAr(now - l.created_at)}${l.note ? ` · ${clean(l.note, 100)}` : ''}`);
  if (!leads.length) L.push('- ولا طلب');

  const pay = await c.db.all("SELECT p.amount, p.payer, p.plan, p.created_at, s.name FROM payments p JOIN shops s ON s.id = p.shop_id WHERE p.status = 'pending' ORDER BY p.created_at DESC LIMIT 10");
  L.push('', `💳 حوالات CliQ بتستنى تأكيدك (${pay.length}):`);
  for (const x of pay) L.push(`- ${x.name} · ${x.amount} دينار (${x.plan === 'year' ? 'سنة' : 'شهر'}) من ${x.payer} · ${agoAr(now - x.created_at)}`);
  if (!pay.length) L.push('- ولا حوالة');

  const talks = await c.db.all("SELECT * FROM prospects WHERE last_in_at > ? AND status <> 'hot' ORDER BY last_in_at DESC LIMIT 10", now - DAY);
  L.push('', `💬 محادثات آخر 24 ساعة (${talks.length}):`);
  for (const p of talks) L.push(`- ${p.name} · ${phoneOf(p)} · ${PROSPECT_STATUS_AR[p.status] || p.status} · ${agoAr(now - p.last_in_at)} · آخر رسالة: «${clean((await lastIn(p.id) || {}).text, 120)}»${p.paused ? ' · (الوكيل موقّف معه، رد إنت)' : ''}${p.error ? ` · ⚠️ ${clean(p.error, 80)}` : ''}`);
  if (!talks.length) L.push('- ما في');

  const counts = Object.fromEntries((await c.db.all('SELECT status, COUNT(*) AS n FROM prospects GROUP BY status')).map((r) => [r.status, r.n]));
  const sent = (await c.db.get('SELECT COUNT(*) AS n FROM prospects WHERE sent_at > ?', now - DAY)).n;
  const auto = (await getSetting(c.db, 'sales_auto')) === '1';
  const stop = await jsonSetting(c.db, 'sales_stop');
  L.push('', `🎯 وكيل المبيعات: الإرسال لحاله ${auto ? 'شغّال' : 'موقّف'}${!auto && stop && stop.why ? ` (وقف لحاله ${agoAr(now - stop.at)}: ${stop.why})` : ''} · انبعت لـ ${sent} محل آخر 24 ساعة · بالدور ${counts.new || 0} · عم يحكوا ${counts.talking || 0} · سجّلوا ${counts.won || 0} · مش مهتمين ${counts.lost || 0} · ما بدهم رسائل ${counts.optout || 0} · فشلت ${counts.failed || 0}`);

  const platformShop = await platformShopId(c.db);
  const shops = await c.db.all('SELECT * FROM shops WHERE demo = 0 AND id <> ?', platformShop ?? 0);
  const st = { active: 0, trial: 0, expired: 0 };
  const ending = [];
  for (const sh of shops) {
    const sub = subscriptionOf(sh, platformShop);
    st[sub.state] = (st[sub.state] || 0) + 1;
    if ((sub.state === 'trial' || sub.state === 'active') && sub.daysLeft <= 7) ending.push(`${sh.name} (${sub.state === 'trial' ? 'تجربة' : 'اشتراك'} · ${sub.daysLeft} يوم)`);
  }
  const week = shops.filter((sh) => sh.created_at > now - 7 * DAY);
  const t = perks.localTime('JO', now);
  const month = (await c.db.get("SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE status = 'approved' AND decided_at >= ?", Date.UTC(t.year, t.month - 1, 1) - 3 * HOUR)).n;
  L.push('', `🏪 المحلات: ${shops.length} · مشتركين ${st.active} · بالتجربة ${st.trial} · خلصت ${st.expired} · سجّلوا آخر 7 أيام ${week.length}${week.length ? ` (${week.slice(0, 5).map((x) => x.name).join('، ')})` : ''} · دخل هالشهر ${month} دينار`);
  if (ending.length) L.push(`⏳ بيخلصوا خلال أسبوع: ${ending.slice(0, 8).join('، ')}`);

  const resets = await c.db.all("SELECT u.email, s.name FROM users u JOIN shops s ON s.id = u.shop_id WHERE u.reset_asked_at > ?", now - 3 * DAY);
  if (resets.length) L.push(`🔑 نسيوا كلمة السر: ${resets.map((r) => r.name).join('، ')} (اعملهم رابط من 👑 المنصة ← المحلات)`);
  const aiErr = await jsonSetting(c.db, 'ai_last_error');
  if (aiErr && aiErr.at && now - aiErr.at < DAY) L.push(`⚠️ الذكاء الاصطناعي فشل ${agoAr(now - aiErr.at)}: ${clean(aiErr.message, 120)}`);
  return L.join('\n');
}
const PROSPECT_STATUS_AR = { new: 'بالدور', sent: 'انبعتله', talking: 'عم يحكي', hot: 'بده يحكي معك', won: 'سجّل', lost: 'مش مهتم', optout: 'ما بده رسائل', failed: 'فشلت', manual: 'بدون واتساب' };

async function sendOwnerAlert(c, wcfg, to, a) {
  const via = Date.now() - (Number(await getSetting(c.db, 'owner_wa_in')) || 0) < 23 * HOUR ? 'text' : 'template';
  let last;
  try {
    const id = via === 'text'
      ? await wa.sendText(wcfg, to, [`🔔 ${a.event}`, a.who, a.phone && `📞 ${a.phone}`, a.about && `💬 ${clean(a.about, 300)}`, `${c.origin}/app#admin`].filter(Boolean).join('\n'))
      : await wa.sendAlert(wcfg, to, { who: `${a.who} · ${a.event}`, phone: a.phone, about: a.about });
    last = { at: Date.now(), ok: true, via, id };
  } catch (e) {
    last = { at: Date.now(), ok: false, via, message: clean(`${e.message}${e.code ? ` (${e.code})` : ''}`, 200) };
  }
  await setSetting(c.db, 'wa_alert_last', JSON.stringify(last));
  return last;
}

// رد الوكيل: بيستنى ثواني (إذا بعت كذا رسالة ورا بعض، بيرد مرة وحدة على آخرها)
async function waReply(c, wcfg, prospectId, msgId) {
  const cfg = aiConfig(c.env);
  await sleep(Number(c.env.WA_DEBOUNCE_MS ?? 3000));
  const last = await c.db.get("SELECT id FROM sales_msgs WHERE prospect_id = ? AND role = 'in' ORDER BY id DESC LIMIT 1", prospectId);
  if (!last || last.id !== msgId) return;
  const p = await c.db.get('SELECT * FROM prospects WHERE id = ?', prospectId);
  if (!p || p.paused || p.status === 'optout') return;
  try {
    await rateLimit(c, `ai:wa:${p.id}`, 30, DAY);
    await rateLimit(c, 'ai:all', cfg.platform, DAY);
  } catch {
    // ما منرد أكتر اليوم (بيحمينا من الردود الآلية اللي بترد على بعض)، بس بنبلّغك ترد إنت
    return agentSilent(c, p, 'الوكيل وصل حد الردود اليوم');
  }
  const rows = await c.db.all('SELECT role, text FROM sales_msgs WHERE prospect_id = ? ORDER BY id DESC LIMIT 16', p.id);
  const messages = cleanHistory(rows.reverse().map((r) => ({ role: r.role === 'in' ? 'user' : 'assistant', content: r.text })));
  if (!messages) return;
  const offer = await c.db.get('SELECT * FROM offers WHERE prospect_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1', p.id, Date.now());
  const runTool = prospectTools(c, p, 'wa');
  const r = await chat(cfg, { system: await salesSystem(c, 'wa', p, offer), messages, tools: sales.waTools(), runTool, maxTokens: 3000 });
  await logAi(c, 'wa', r.usage);
  await noteAi(c, true, null, r.model);
  if (r.refused || !r.text) return agentSilent(c, p, 'الوكيل ما لقى رد مناسب على هالرسالة');
  let id;
  try {
    id = await wa.sendText(wcfg, p.wa, r.text);
  } catch (e) {
    e.wa = true;
    throw e;
  }
  await saveSalesMsg(c.db, p.id, 'agent', r.text, id);
  await c.db.run('UPDATE prospects SET last_out_at = ?, error = NULL WHERE id = ?', Date.now(), p.id);
}

// ─── 👑 صفحة المنصة ← 🎯 المبيعات ───
const PROSPECT_STATUSES = ['new', 'sent', 'talking', 'hot', 'won', 'lost', 'optout', 'failed', 'manual'];
// ctx: { origin, agentWa } عشان الرسالة اللي بتبعتها إنت (رابط الموقع، أو واتساب الوكيل بعد ربط Meta)
function prospectView(p, offer, ctx) {
  const message = sales.outreachText(p, ctx);
  return {
    id: p.id, name: p.name, area: p.area, kind: p.kind, phone: p.phone, wa: p.wa, instagram: p.instagram, website: p.website, why: p.why,
    ownerName: p.owner_name, note: p.note, status: p.status, source: p.source, paused: !!p.paused, error: p.error, shopId: p.shop_id,
    sentAt: p.sent_at, lastInAt: p.last_in_at, lastOutAt: p.last_out_at, openedAt: p.opened_at, createdAt: p.created_at,
    message, link: `${ctx.origin}/?p=${p.code}`,
    waLink: p.wa ? `https://wa.me/${p.wa}?text=${encodeURIComponent(message)}` : null,
    offer: offer ? { trialDays: offer.trial_days, code: offer.code, used: !!offer.used_at } : null,
  };
}

// رقم واتساب الوكيل (بعد ربط Meta): رسالتك بتفتح محادثة معه بدل صفحة الموقع
async function agentWa(c) {
  if (!wa.waConfig(c.env)) return null;
  return wa.waNumber(await getSetting(c.db, 'sales_agent_wa'));
}
const salesCtx = async (c) => ({ origin: c.origin, agentWa: await agentWa(c) });

async function salesState(c) {
  // المحلات القديمة اللي ما إلها رابط خاص
  for (const r of await c.db.all('SELECT id FROM prospects WHERE code IS NULL LIMIT 500')) await c.db.run('UPDATE prospects SET code = ? WHERE id = ?', randomToken(8), r.id);
  const rows = await c.db.all('SELECT * FROM prospects ORDER BY COALESCE(last_in_at, last_out_at, created_at) DESC LIMIT 300');
  const ctx = await salesCtx(c);
  const offers = await c.db.all('SELECT * FROM offers WHERE prospect_id IS NOT NULL ORDER BY created_at');
  const offerOf = new Map(offers.map((o) => [o.prospect_id, o]));
  const counts = Object.fromEntries((await c.db.all('SELECT status, COUNT(*) AS n FROM prospects GROUP BY status')).map((r) => [r.status, r.n]));
  const wcfg = wa.waConfig(c.env);
  return {
    prospects: rows.map((p) => prospectView(p, offerOf.get(p.id), ctx)),
    counts,
    sentToday: (await c.db.get('SELECT COUNT(*) AS n FROM prospects WHERE sent_at > ?', Date.now() - DAY)).n,
    signups: (await c.db.get('SELECT COUNT(*) AS n FROM offers WHERE used_at IS NOT NULL')).n,
    settings: { auto: (await getSetting(c.db, 'sales_auto')) === '1', daily: Number(await getSetting(c.db, 'sales_daily')) || SALES_DAILY, agentWa: (await getSetting(c.db, 'sales_agent_wa')) || '' },
    stopped: await jsonSetting(c.db, 'sales_stop'), // ليش وقف الإرسال لحاله آخر مرة
    agentWa: ctx.agentWa,
    ai: !!aiConfig(c.env),
    aiProvider: aiConfig(c.env) ? aiConfig(c.env).provider : null,
    aiLastError: await jsonSetting(c.db, 'ai_last_error'),
    aiLastOk: await jsonSetting(c.db, 'ai_last_ok'),
    whatsapp: {
      ready: !!wcfg,
      verified: !!(wcfg && wcfg.appSecret && wcfg.verifyToken),
      webhookUrl: `${String(c.env.WEBHOOK_ORIGIN || 'https://loyalty.ooo518106.workers.dev').replace(/\/+$/, '')}/api/wa/webhook`, // Meta ما بتعدّي حماية البوتات على الدومين، فالرابط على عنوان workers.dev
      template: wcfg ? wcfg.template : String(c.env.WHATSAPP_TEMPLATE || 'nuqatak_intro'),
      templateText: sales.TEMPLATE_TEXT,
    },
  };
}

async function adminSales(c) {
  await requireAdmin(c);
  return json(await salesState(c));
}

// روابط من نتايج البحث: http(s) بس، والانستغرام من اسم الحساب كمان
const webUrl = (v) => { const u = clean(v, 300); return /^https?:\/\/[^\s]+$/i.test(u) ? u : null; };
function instaUrl(v) {
  const u = clean(v, 120);
  if (/^https?:\/\/(www\.)?instagram\.com\/[^\s]+$/i.test(u)) return u;
  const h = u.replace(/^@/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(h) ? `https://instagram.com/${h}` : null;
}

// 🔎 الوكيل بيدوّر بالإنترنت على محلات وبيحفظهم بالقائمة (بدقيقة تقريباً)
async function adminSalesSearch(c) {
  await requireAdmin(c);
  const cfg = aiConfig(c.env);
  if (!cfg) fail(400, 'ضيف مفتاح الذكاء الاصطناعي (GEMINI_API_KEY أو ANTHROPIC_API_KEY) بإعدادات Cloudflare أول');
  const query = clean(c.body.query, 120);
  if (query.length < 3) fail(400, 'اكتب شو بدك يدوّر (مثلاً: كوفي شوب بعبدون)');
  const count = Math.min(20, Math.max(3, Number(c.body.count) || 10));
  await rateLimit(c, `search:${c.user.id}`, 20, DAY, 'دوّرت كتير اليوم، كمّل بكرا');
  const known = await c.db.all('SELECT name FROM prospects ORDER BY id DESC LIMIT 120');
  let found = [];
  let r;
  try {
    if (cfg.provider === 'gemini') {
      // Gemini: بحث Google، وبعدين ترتيب النتايج حسب مخطط save_shops
      r = await geminiFindShops(cfg, { system: sales.searchSystem(count), ask: sales.searchAsk(query, known.map((k) => k.name)), shopsSchema: sales.SAVE_SHOPS.input_schema });
      found = r.shops.slice(0, count);
    } else {
      const runTool = async (name, input) => {
        if (name !== 'save_shops') throw new Error(`أداة مش معروفة: ${name}`);
        found = Array.isArray(input.shops) ? input.shops.slice(0, count) : [];
        return { saved: found.length };
      };
      r = await chat(cfg, {
        system: sales.searchSystem(count),
        messages: [{ role: 'user', content: sales.searchAsk(query, known.map((k) => k.name)) }],
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8, user_location: { type: 'approximate', country: 'JO', city: 'Amman', timezone: 'Asia/Amman' } }, sales.SAVE_SHOPS],
        runTool, stopOn: 'save_shops', maxTokens: 12000, effort: 'medium', timeout: 180_000, maxRounds: 8,
      });
    }
  } catch (e) {
    console.error('sales search:', e.status || '', e.message);
    await noteAi(c, false, e);
    fail(503, e.status === 429 ? 'خلصت حصة البحث المجانية لليوم، جرّب بكرا' : 'البحث ما زبط هلأ، جرّب كمان شوي');
  }
  await logAi(c, 'search', r.usage);
  const now = Date.now();
  let added = 0;
  const names = new Set(known.map((k) => k.name.trim().toLowerCase()));
  for (const s of found) {
    const name = clean(s && s.name, 60);
    if (name.length < 2 || names.has(name.toLowerCase())) continue;
    names.add(name.toLowerCase());
    const phone = clean(s.phone, 30);
    const num = phone ? wa.waNumber(phone) : null;
    const res = await c.db.run(
      `INSERT INTO prospects (name, area, kind, phone, wa, instagram, website, why, opener, code, status, source, search, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'search', ?, ?) ON CONFLICT DO NOTHING`,
      name, clean(s.area, 60), clean(s.kind, 40), phone || null, num, instaUrl(s.instagram), webUrl(s.website), clean(s.why, 300), clean(s.opener, 400) || null, randomToken(8), num ? 'new' : 'manual', query, now,
    );
    if (res.changes) added++;
  }
  return json({ added, found: found.length, searches: r.usage.web_search_requests, ...(await salesState(c)) });
}

async function adminAddProspect(c) {
  await requireAdmin(c);
  const name = clean(c.body.name, 60);
  if (name.length < 2) fail(400, 'اكتب اسم المحل');
  const phone = clean(c.body.phone, 30);
  const num = wa.waNumber(phone);
  if (!num) fail(400, 'اكتب رقم موبايل عليه واتساب (07…)');
  if (await c.db.get('SELECT id FROM prospects WHERE wa = ?', num)) fail(409, 'هالرقم بالقائمة من قبل');
  await c.db.run("INSERT INTO prospects (name, area, kind, phone, wa, why, code, status, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'new', 'manual', ?)",
    name, clean(c.body.area, 60), clean(c.body.kind, 40), phone, num, clean(c.body.note, 300), randomToken(8), Date.now());
  return adminSales(c);
}

async function prospectById(c, id) {
  await requireAdmin(c);
  const p = await c.db.get('SELECT * FROM prospects WHERE id = ?', Number(id));
  if (!p) fail(404, 'ما لقينا المحل');
  return p;
}

async function adminProspect(c, id) {
  const p = await prospectById(c, id);
  const msgs = await c.db.all('SELECT role, text, channel, created_at AS at FROM sales_msgs WHERE prospect_id = ? ORDER BY id DESC LIMIT 100', p.id);
  const offer = await c.db.get('SELECT * FROM offers WHERE prospect_id = ? ORDER BY created_at DESC LIMIT 1', p.id);
  const lastWa = await c.db.get("SELECT MAX(created_at) AS at FROM sales_msgs WHERE prospect_id = ? AND role = 'in' AND channel = 'wa'", p.id);
  return json({ prospect: prospectView(p, offer, await salesCtx(c)), messages: msgs.reverse(), canReply: !!(wa.waConfig(c.env) && p.wa && lastWa.at && Date.now() - lastWa.at < DAY) });
}

// إنت بعتت الرسالة من واتسابك: بنسجّل إنها انبعتت (والنص بيبيّن بالمحادثة)
async function adminProspectSent(c, id) {
  const p = await prospectById(c, id);
  const now = Date.now();
  if (!p.sent_at) {
    await saveSalesMsg(c.db, p.id, 'owner', sales.outreachText(p, await salesCtx(c)), null, now, 'manual');
    await c.db.run("UPDATE prospects SET sent_at = ?, last_out_at = ?, status = CASE WHEN status IN ('new', 'failed', 'manual') THEN 'sent' ELSE status END WHERE id = ?", now, now, p.id);
  }
  return adminProspect(c, id);
}

async function adminProspectUpdate(c, id) {
  const p = await prospectById(c, id);
  const status = c.body.status === undefined ? p.status : c.body.status;
  if (!PROSPECT_STATUSES.includes(status)) fail(400, 'حالة مش معروفة');
  const paused = c.body.paused === undefined ? p.paused : c.body.paused ? 1 : 0;
  await c.db.run('UPDATE prospects SET status = ?, paused = ? WHERE id = ?', status, paused, p.id);
  return adminProspect(c, id);
}

async function adminProspectDelete(c, id) {
  const p = await prospectById(c, id);
  await c.db.batch([['DELETE FROM sales_msgs WHERE prospect_id = ?', [p.id]], ['DELETE FROM prospects WHERE id = ?', [p.id]]]);
  return json({ ok: true });
}

// إرسال أول رسالة لمحل هلأ (بدون ما يستنى الدور)
async function adminProspectSend(c, id) {
  const p = await prospectById(c, id);
  const wcfg = wa.waConfig(c.env);
  if (!wcfg) fail(400, 'واتساب لسا مش مربوط');
  if (!p.wa) fail(400, 'ما في رقم واتساب لهالمحل');
  if (!['new', 'failed'].includes(p.status)) fail(400, 'انبعتله من قبل');
  try {
    if (!(await sendIntro(c, wcfg, p))) fail(400, (await c.db.get('SELECT error FROM prospects WHERE id = ?', p.id)).error || 'ما انبعتت');
  } catch (e) {
    if (e instanceof HttpError) throw e;
    fail(502, `واتساب رفض: ${e.message}`);
  }
  return adminProspect(c, id);
}

// إنت بترد بنفسك: الوكيل بيوقف مع هالمحل لحد ما ترجّعه
async function adminProspectReply(c, id) {
  const p = await prospectById(c, id);
  const wcfg = wa.waConfig(c.env);
  if (!wcfg) fail(400, 'واتساب لسا مش مربوط');
  const text = clean(c.body.text, 1000);
  if (!text) fail(400, 'اكتب الرسالة');
  const lastWa = await c.db.get("SELECT MAX(created_at) AS at FROM sales_msgs WHERE prospect_id = ? AND role = 'in' AND channel = 'wa'", p.id);
  if (!p.wa || !lastWa.at || Date.now() - lastWa.at >= DAY) fail(400, 'مرّ أكتر من 24 ساعة على آخر رسالة منه على واتساب الوكيل، وواتساب ما بيسمح ترد عليه إلا لما يراسلك هو');
  let waId;
  try { waId = await wa.sendText(wcfg, p.wa, text); } catch (e) { fail(502, `واتساب رفض: ${e.message}`); }
  await saveSalesMsg(c.db, p.id, 'owner', text, waId);
  await c.db.run('UPDATE prospects SET paused = 1, last_out_at = ? WHERE id = ?', Date.now(), p.id);
  return adminProspect(c, id);
}

// 📞 رقم الإيجنت: حالته عند Meta، وتأكيده بكود وتسجيله (بدل زر «تسجيل» بصفحة Meta إذا علّق)
async function adminWaNumber(c) {
  await requireAdmin(c);
  const wcfg = wa.waConfig(c.env);
  if (!wcfg) fail(400, 'حط WHATSAPP_TOKEN و WHATSAPP_PHONE_ID بإعدادات Cloudflare أول');
  const b = c.body;
  try {
    if (c.req.method === 'POST') {
      await rateLimit(c, `wanum:${c.user.id}`, 20, 60 * MIN, 'محاولات كتير، استنى شوي');
      if (b.action === 'code') await wa.requestCode(wcfg, b.method);
      else if (b.action === 'verify') {
        const code = String(b.code || '').replace(/\D/g, '');
        if (!/^\d{6}$/.test(code)) fail(400, 'الكود 6 أرقام');
        await wa.verifyCode(wcfg, code);
      } else if (b.action === 'subscribe') {
        if (!wcfg.wabaId) fail(400, 'ناقص WHATSAPP_WABA_ID');
        await wa.subscribeApp(wcfg);
      } else if (b.action === 'alert') {
        const to = ownerWhatsapp(c.env);
        if (!to) fail(400, 'حط رقمك WHATSAPP_NUMBER بإعدادات Cloudflare أول');
        const r = await sendOwnerAlert(c, wcfg, to, { event: 'تجربة تنبيه', who: 'محل تجربة', phone: '+962790000000', about: 'هيك رح يوصلك التنبيه لما حدا يراسل الوكيل أو بده يحكي معك' });
        if (!r.ok) fail(400, `ما انبعت: ${r.message}`);
      } else if (b.action === 'register') {
        const pin = String(b.pin || '').replace(/\D/g, '');
        if (!/^\d{6}$/.test(pin)) fail(400, 'الـ PIN لازم يكون 6 أرقام');
        await wa.registerNumber(wcfg, pin);
      } else fail(400, 'إجراء مش معروف');
    }
    const st = await wa.numberStatus(wcfg);
    const lastHook = await jsonSetting(c.db, 'wa_last_hook');
    const lastFailure = await jsonSetting(c.db, 'wa_last_failure');
    let subscribed = null;
    let template = null;
    let alertTemplate = null;
    // حالة القالب عند Meta، أو MISSING إذا مش على هالحساب
    const tplStatus = async (name) => {
      try {
        const list = ((await wa.templates(wcfg, name)).data || []).filter((t) => t.name === name);
        const t = list.find((x) => x.language === wcfg.lang) || list[0];
        return t
          ? { status: t.status, language: t.language, category: t.category, reason: t.rejected_reason && t.rejected_reason !== 'NONE' ? clean(t.rejected_reason, 80) : null }
          : { status: 'MISSING' };
      } catch { return null; }
    };
    if (wcfg.wabaId) {
      try { subscribed = ((await wa.subscribedApps(wcfg)).data || []).length > 0; } catch { subscribed = null; }
      template = await tplStatus(wcfg.template);
      alertTemplate = await tplStatus(wcfg.alertTemplate);
    }
    // هل في إشي مانع الإرسال (الدفع، الحساب، الرقم)
    let sending = null;
    try {
      const h = (await wa.health(wcfg)).health_status;
      if (h && h.can_send_message) {
        const all = (h.entities || []).flatMap((en) => (en.errors || []).map((er) => clean([er.error_description, er.possible_solution].filter(Boolean).join(' — '), 300))).filter(Boolean);
        // المكالمات (SIP) ما إلها علاقة بالرسائل: إذا هي السبب الوحيد، الرسائل شغّالة
        const errors = [...new Set(all.filter((e) => !/\b(calling|SIP)\b/i.test(e)))].slice(0, 3);
        const callsOnly = all.length > 0 && !errors.length && h.can_send_message === 'LIMITED';
        sending = { can: callsOnly ? 'AVAILABLE' : String(h.can_send_message), errors };
      }
    } catch { sending = null; }
    return json({
      lastHook,
      lastFailure,
      subscribed,
      template,
      templateName: wcfg.template,
      alertTemplate,
      alertTemplateName: wcfg.alertTemplate,
      alertLast: await jsonSetting(c.db, 'wa_alert_last'),
      ownerWa: ownerWhatsapp(c.env),
      wabaId: wcfg.wabaId,
      sending,
      ok: true,
      number: st.display_phone_number || null,
      name: st.verified_name || null,
      nameStatus: st.name_status || null,
      codeStatus: st.code_verification_status || null,
      status: st.status || null,
      platform: st.platform_type || null,
      quality: st.quality_rating || null,
    });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    fail(502, `Meta: ${clean(e.message, 300)}${e.code ? ` (${e.code})` : ''}`);
  }
}

async function adminSalesSettings(c) {
  await requireAdmin(c);
  const auto = !!c.body.auto;
  if (auto && !wa.waConfig(c.env)) fail(400, 'اربط واتساب أول (المفاتيح بإعدادات Cloudflare)');
  const daily = int(c.body.daily, 1, 200, 'الحد باليوم بين 1 و 200');
  const agent = clean(c.body.agentWa, 20);
  if (agent && !wa.waNumber(agent)) fail(400, 'رقم واتساب الوكيل مش صحيح');
  await setSetting(c.db, 'sales_agent_wa', agent ? wa.waNumber(agent) : '');
  await setSetting(c.db, 'sales_auto', auto ? '1' : '0');
  if (auto) await setSetting(c.db, 'sales_stop', '');
  await setSetting(c.db, 'sales_daily', String(daily));
  return adminSales(c);
}

async function menuImage(c, id) {
  const row = await c.db.get('SELECT image FROM menu_items WHERE id = ?', Number(id));
  if (!row || !row.image) return notFound(c);
  const [mime, data] = row.image.split(';');
  return new Response(b64ToBytes(data), { headers: { 'content-type': mime, 'cache-control': 'public, max-age=604800', 'x-content-type-options': 'nosniff' } });
}

// ─── المندوبين: كل مندوب إله رابط، والمحلات اللي بتسجّل منه بتنحسبله عمولة من اشتراكاتها ───
const PARTNER_RE = /^[a-z2-9]{6}$/;
async function resellerByCode(db, code) {
  const v = String(code || '').toLowerCase();
  return PARTNER_RE.test(v) ? db.get('SELECT * FROM resellers WHERE code = ?', v) : null;
}

async function resellerStats(c, r) {
  const platformShop = await platformShopId(c.db);
  const shops = await c.db.all('SELECT * FROM shops WHERE reseller_id = ? ORDER BY created_at DESC', r.id);
  const paidRow = await c.db.get("SELECT COALESCE(SUM(p.amount), 0) AS n FROM payments p JOIN shops s ON s.id = p.shop_id WHERE s.reseller_id = ? AND p.status = 'approved'", r.id);
  const out = await c.db.get('SELECT COALESCE(SUM(amount), 0) AS n FROM reseller_payouts WHERE reseller_id = ?', r.id);
  const earned = Math.round(paidRow.n * r.pct) / 100;
  return {
    id: r.id, name: r.name, phone: r.phone, code: r.code, pct: r.pct,
    link: `${c.origin}/?partner=${r.code}`,
    shops: shops.map((s) => ({ name: s.name, createdAt: s.created_at, state: subscriptionOf(s, platformShop).state })),
    sales: paidRow.n, earned, paid: out.n, due: Math.round((earned - out.n) * 100) / 100,
  };
}

async function adminResellers(c) {
  await requireAdmin(c);
  const rows = await c.db.all('SELECT * FROM resellers ORDER BY created_at DESC');
  const list = [];
  for (const r of rows) list.push({ ...(await resellerStats(c, r)), statsUrl: `${c.origin}/partner/${r.token}` });
  return json({ resellers: list });
}

async function adminAddReseller(c) {
  await requireAdmin(c);
  const name = readName(c.body.name);
  const pct = int(c.body.pct ?? 20, 1, 90, 'النسبة لازم تكون بين 1 و 90%');
  const phone = c.body.phone ? readPhone(c.body.phone) : '';
  for (let i = 0; i < 5; i++) {
    try {
      await c.db.run('INSERT INTO resellers (name, phone, code, token, pct, created_at) VALUES (?, ?, ?, ?, ?, ?)', name, phone, randomToken().slice(0, 6), randomToken(), pct, Date.now());
      return adminResellers(c);
    } catch (e) {
      if (!isUniqueError(e)) throw e;
    }
  }
  fail(500, 'جرّب كمان مرة');
}

async function adminResellerPayout(c, id) {
  await requireAdmin(c);
  const r = await c.db.get('SELECT * FROM resellers WHERE id = ?', Number(id));
  if (!r) fail(404, 'ما لقينا المندوب');
  const n = Number(c.body.amount);
  if (!Number.isFinite(n) || n <= 0 || n > 100000) fail(400, 'اكتب المبلغ اللي دفعته');
  await c.db.run('INSERT INTO reseller_payouts (reseller_id, amount, created_at) VALUES (?, ?, ?)', r.id, Math.round(n * 100) / 100, Date.now());
  return adminResellers(c);
}

// صفحة المندوب (برابط سري): محلاته وعمولته
async function partnerStats(c, token) {
  const r = await c.db.get('SELECT * FROM resellers WHERE token = ?', token);
  if (!r) fail(404, 'الرابط مش صحيح');
  const st = await resellerStats(c, r);
  delete st.id;
  return json(st);
}

// ─── الموظفين ───
async function listStaff(c) {
  const users = await c.db.all('SELECT id, name, email, role, branch_id AS branchId, created_at AS createdAt FROM users WHERE shop_id = ? ORDER BY id', c.shop.id);
  return json({ users });
}

async function addStaff(c) {
  noDemo(c, 'إضافة موظفين');
  if (!isPro(c.shop)) {
    const n = await c.db.get("SELECT COUNT(*) AS n FROM users WHERE shop_id = ? AND role = 'staff'", c.shop.id);
    if (n.n >= BASIC_LIMITS.staff) fail(403, `الباقة الأساسية فيها لحد ${BASIC_LIMITS.staff} موظفين. رقّي للمميزة 💎 لموظفين بلا حد`, { upgrade: true });
  }
  const name = readName(c.body.name);
  const email = String(c.body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) fail(400, 'الإيميل مش صحيح');
  auth.checkPasswordStrength(c.body.password);
  try {
    await c.db.run("INSERT INTO users (shop_id, email, name, role, pw_hash, created_at) VALUES (?, ?, ?, 'staff', ?, ?)", c.shop.id, email, name, await auth.hashPassword(c.body.password), Date.now());
  } catch (e) {
    if (isUniqueError(e)) fail(409, 'هالإيميل مستخدم');
    throw e;
  }
  return listStaff(c);
}

async function removeStaff(c, id) {
  const r = await c.db.run("DELETE FROM users WHERE id = ? AND shop_id = ? AND role = 'staff'", Number(id), c.shop.id);
  if (!r.changes) fail(404, 'ما لقينا هالموظف');
  return listStaff(c);
}

// ─── التوجيه ───
const API = [
  ['GET', /^\/api\/shops\/([a-z0-9-]{3,40})\/public$/, publicShop],
  ['GET', /^\/api\/version$/, () => json({ version: APP_VERSION, date: CHANGELOG[0].date })],
  ['POST', /^\/api\/sales$/, salesChat],
  ['GET', /^\/api\/offers\/([a-z2-9]{8})$/, publicOffer],
  ['GET', /^\/api\/p\/([a-z2-9]{8})$/, publicProspect],
  ['GET', /^\/api\/shops\/([a-z0-9-]{3,40})\/menu$/, publicMenu],
  ['GET', /^\/api\/menu$/, listMenu, 'owner'],
  ['POST', /^\/api\/menu$/, syncsMenu(addMenuItem), 'owner'],
  ['PUT', /^\/api\/menu\/(\d+)$/, syncsMenu(updateMenuItem), 'owner'],
  ['DELETE', /^\/api\/menu\/(\d+)$/, syncsMenu(deleteMenuItem), 'owner'],
  ['POST', /^\/api\/menu\/pdf$/, syncsMenu(uploadMenuPdf), 'owner'],
  ['DELETE', /^\/api\/menu\/pdf$/, syncsMenu(deleteMenuPdf), 'owner'],
  ['POST', /^\/api\/shops\/([a-z0-9-]{3,40})\/join$/, join],
  ['GET', /^\/api\/cards\/([a-z2-9]{20})$/, cardInfo],
  ['POST', /^\/api\/cards\/([a-z2-9]{20})\/delete$/, deleteCard],
  ['POST', /^\/api\/cards\/([a-z2-9]{20})\/birthday$/, cardBirthday],
  ['POST', /^\/api\/cards\/([a-z2-9]{20})\/review$/, cardReview],
  ['POST', /^\/api\/cards\/([a-z2-9]{20})\/lang$/, cardLang],
  ['POST', /^\/api\/cards\/([a-z2-9]{20})\/gift$/, createGift],
  ['GET', /^\/api\/gifts\/([a-z2-9]{20})$/, giftInfo],
  ['POST', /^\/api\/gifts\/([a-z2-9]{20})\/claim$/, claimGift],
  ['GET', /^\/api\/site$/, site],
  ['GET', /^\/api\/push\/key$/, pushKey],
  ['POST', /^\/api\/cards\/([a-z2-9]{20})\/push$/, cardPushSubscribe],
  ['POST', /^\/api\/cards\/([a-z2-9]{20})\/push\/test$/, cardPushTest],
  ['DELETE', /^\/api\/cards\/([a-z2-9]{20})\/push$/, cardPushUnsubscribe],
  ['POST', /^\/api\/leads$/, createLead],
  ['GET', /^\/api\/admin\/leads$/, adminLeads, 'staff'],
  ['GET', /^\/api\/admin\/sales$/, adminSales, 'staff'],
  ['POST', /^\/api\/admin\/sales\/search$/, adminSalesSearch, 'staff'],
  ['PUT', /^\/api\/admin\/sales\/settings$/, adminSalesSettings, 'staff'],
  ['GET', /^\/api\/admin\/wa\/number$/, adminWaNumber, 'staff'],
  ['POST', /^\/api\/admin\/wa\/number$/, adminWaNumber, 'staff'],
  ['POST', /^\/api\/admin\/prospects$/, adminAddProspect, 'staff'],
  ['GET', /^\/api\/admin\/prospects\/(\d+)$/, adminProspect, 'staff'],
  ['PUT', /^\/api\/admin\/prospects\/(\d+)$/, adminProspectUpdate, 'staff'],
  ['DELETE', /^\/api\/admin\/prospects\/(\d+)$/, adminProspectDelete, 'staff'],
  ['POST', /^\/api\/admin\/prospects\/(\d+)\/send$/, adminProspectSend, 'staff'],
  ['POST', /^\/api\/admin\/prospects\/(\d+)\/sent$/, adminProspectSent, 'staff'],
  ['POST', /^\/api\/admin\/prospects\/(\d+)\/reply$/, adminProspectReply, 'staff'],
  ['PUT', /^\/api\/admin\/leads\/(\d+)$/, adminLeadStatus, 'staff'],
  ['GET', /^\/api\/admin\/shops$/, adminShops, 'staff'],
  ['POST', /^\/api\/admin\/shops\/(\d+)\/plan$/, adminShopPlan, 'staff'],
  ['GET', /^\/api\/admin\/shops\/(\d+)\/menu$/, forShop(listMenu), 'staff'],
  ['POST', /^\/api\/admin\/shops\/(\d+)\/menu$/, forShop(syncsMenu(addMenuItem)), 'staff'],
  ['POST', /^\/api\/admin\/shops\/(\d+)\/menu\/pdf$/, forShop(syncsMenu(uploadMenuPdf)), 'staff'],
  ['DELETE', /^\/api\/admin\/shops\/(\d+)\/menu\/pdf$/, forShop(syncsMenu(deleteMenuPdf)), 'staff'],
  ['PUT', /^\/api\/admin\/shops\/(\d+)\/menu\/(\d+)$/, forShop(syncsMenu(updateMenuItem)), 'staff'],
  ['DELETE', /^\/api\/admin\/shops\/(\d+)\/menu\/(\d+)$/, forShop(syncsMenu(deleteMenuItem)), 'staff'],
  ['GET', /^\/api\/admin\/apple$/, adminApple, 'staff'],
  ['POST', /^\/api\/admin\/apple\/key$/, adminAppleKey, 'staff'],
  ['PUT', /^\/api\/admin\/apple\/cert$/, adminAppleCert, 'staff'],
  ['GET', /^\/api\/admin\/payments$/, adminPayments, 'staff'],
  ['POST', /^\/api\/admin\/payments\/(\d+)$/, adminPaymentDecide, 'staff'],
  ['GET', /^\/api\/admin\/settings$/, adminSettings, 'staff'],
  ['PUT', /^\/api\/admin\/settings$/, adminSettings, 'staff'],
  ['GET', /^\/api\/admin\/resellers$/, adminResellers, 'staff'],
  ['POST', /^\/api\/admin\/resellers$/, adminAddReseller, 'staff'],
  ['POST', /^\/api\/admin\/resellers\/(\d+)\/payout$/, adminResellerPayout, 'staff'],
  ['GET', /^\/api\/partner\/([a-z2-9]{20})$/, partnerStats],
  ['GET', /^\/api\/billing$/, billing, 'owner'],
  ['POST', /^\/api\/billing\/claim$/, billingClaim, 'owner'],
  ['POST', /^\/api\/auth\/signup$/, signup],
  ['POST', /^\/api\/auth\/login$/, loginRoute],
  ['POST', /^\/api\/demo\/login$/, demoLogin],
  ['POST', /^\/api\/auth\/logout$/, logout],
  ['POST', /^\/api\/auth\/forgot$/, forgotPassword],
  ['GET', /^\/api\/auth\/reset$/, resetInfo],
  ['POST', /^\/api\/auth\/reset$/, resetPassword],
  ['POST', /^\/api\/admin\/shops\/(\d+)\/reset-link$/, adminResetLink, 'staff'],
  ['GET', /^\/api\/me$/, me, 'staff'],
  ['PUT', /^\/api\/me\/password$/, changePassword, 'staff'],
  ['POST', /^\/api\/me\/push$/, userPushSubscribe, 'staff'],
  ['DELETE', /^\/api\/me\/push$/, userPushUnsubscribe, 'staff'],
  ['GET', /^\/api\/members$/, listMembers, 'staff'],
  // الموظف ما بيكتب رقم الزبون: الزبون بينضم بنفسه من QR الانضمام
  ['POST', /^\/api\/members$/, addMember, 'owner'],
  ['GET', /^\/api\/members\/lookup$/, lookup, 'staff'],
  ['POST', /^\/api\/members\/import$/, importMembers, 'owner'],
  ['GET', /^\/api\/members\/(\d+)$/, memberDetail, 'staff'],
  ['POST', /^\/api\/members\/(\d+)\/earn$/, earn, 'staff'],
  ['POST', /^\/api\/members\/(\d+)\/redeem$/, redeem, 'staff'],
  ['POST', /^\/api\/members\/(\d+)\/adjust$/, adjust, 'owner'],
  ['DELETE', /^\/api\/members\/(\d+)$/, removeMember, 'owner'],
  ['GET', /^\/api\/activity$/, activity, 'staff'],
  ['GET', /^\/api\/reports$/, reports, 'owner'],
  ['GET', /^\/api\/reports\/members\.csv$/, membersCsv, 'owner'],
  ['PUT', /^\/api\/shop$/, updateShop, 'owner'],
  ['PUT', /^\/api\/shop\/logo$/, updateLogo, 'owner'],
  ['PUT', /^\/api\/shop\/perks$/, updatePerks, 'owner'],
  ['POST', /^\/api\/shop\/onboard$/, onboardStep, 'owner'],
  ['GET', /^\/api\/admin\/stats$/, adminStats, 'staff'],
  ['POST', /^\/api\/shop\/sync$/, syncNow, 'owner'],
  ['POST', /^\/api\/broadcast$/, broadcast, 'owner'],
  ['POST', /^\/api\/broadcast\/(\d+)\/continue$/, broadcastContinue, 'owner'],
  ['POST', /^\/api\/broadcast\/test$/, broadcastTest, 'owner'],
  ['GET', /^\/api\/coupons$/, listCoupons, 'owner'],
  ['POST', /^\/api\/coupons$/, createCoupon, 'owner'],
  ['POST', /^\/api\/coupons\/(\d+)\/continue$/, couponContinue, 'owner'],
  ['DELETE', /^\/api\/coupons\/(\d+)$/, stopCoupon, 'owner'],
  ['GET', /^\/api\/members\/(\d+)\/coupons$/, memberCoupons, 'staff'],
  ['POST', /^\/api\/members\/(\d+)\/coupons\/(\d+)\/use$/, useCoupon, 'staff'],
  ['POST', /^\/api\/members\/(\d+)\/credit\/topup$/, topup, 'staff'],
  ['POST', /^\/api\/members\/(\d+)\/credit\/spend$/, spend, 'staff'],
  ['GET', /^\/api\/members\/(\d+)\/credit$/, creditHistory, 'staff'],
  ['PUT', /^\/api\/shop\/links$/, updateLinks, 'owner'],
  ['PUT', /^\/api\/staff\/(\d+)$/, setStaffBranch, 'owner'],
  ['GET', /^\/api\/staff$/, listStaff, 'owner'],
  ['POST', /^\/api\/staff$/, addStaff, 'owner'],
  ['DELETE', /^\/api\/staff\/(\d+)$/, removeStaff, 'owner'],
];

async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  // طلبات التعديل لازم تكون JSON: المتصفح ما بيسمح لموقع غريب يبعت JSON بدون إذن (CORS)، فهيك منحمي من CSRF
  if (req.method !== 'DELETE' && !/^application\/json\b/i.test(req.headers.get('content-type') || '')) fail(415, 'لازم الطلب يكون JSON');
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY) fail(413, 'الطلب كبير كتير');
  const text = await req.text();
  if (!text) return {};
  if (text.length > MAX_BODY) fail(413, 'الطلب كبير كتير');
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    fail(400, 'JSON مش صالح');
  }
}

async function api(c) {
  const { req, url } = c;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.get('origin');
    if (origin && (() => { try { return new URL(origin).host !== url.host; } catch { return true; } })()) fail(403, 'مصدر الطلب مش مسموح');
  }
  for (const [method, re, fn, role] of API) {
    const m = url.pathname.match(re);
    if (!m) continue;
    if (method !== req.method) continue;
    if (role) {
      c.user = await auth.currentUser(c.db, req);
      if (!c.user) fail(401, 'سجّل دخول أول');
      if (role === 'owner' && c.user.role !== 'owner') fail(403, 'هاد الإجراء للمالك بس');
      c.shop = await shopRow(c.db, c.user.shop_id);
    }
    c.body = await readBody(req);
    return fn(c, ...m.slice(1));
  }
  fail(404, 'مسار غير موجود');
}

function notFound(c) {
  return new Response('<!doctype html><meta charset="utf-8"><title>مش موجود</title><body style="font-family:system-ui;text-align:center;padding:4rem" dir="rtl"><h1>الصفحة مش موجودة</h1><a href="/">الرئيسية</a>', {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
  });
}

async function page(c, file) {
  const res = await c.asset(file);
  if (!res.ok) return notFound(c);
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  out.headers.set('cache-control', 'no-cache');
  return out;
}

// 🌐 الدومين الرسمي (PUBLIC_URL، مثلاً https://nuqatak.com): صفحات العنوان القديم (workers.dev) و www بتتحوّل لحالها.
// الـ API وخدمة Apple والصور و sw.js بيضلوا شغّالين على كل العناوين، عشان البطاقات اللي بالمحافظ والإشعارات اللي انبعتت قبل
const PAGE_RE = /^\/(?:$|index\.html$|app\/?$|privacy\/?$|terms\/?$|cards\/?$|(?:j|m|print)\/[a-z0-9-]{3,40}\/?$|(?:c|g|partner)\/[a-z2-9]{20}\/?$)/;
// 🔎 Google: شو يقرأ (الصفحة الرئيسية، الشروط، الخصوصية، صفحات المحلات والمنيو) وشو لأ (اللوحة، بطاقات الزبائن، الهدايا، الـ API)
function robotsTxt(c) {
  const body = ['User-agent: *', 'Disallow: /api/', 'Disallow: /app', 'Disallow: /c/', 'Disallow: /g/', 'Disallow: /cards', 'Disallow: /partner/', 'Disallow: /print/', 'Disallow: /apple/', '', `Sitemap: ${c.origin}/sitemap.xml`, ''].join('\n');
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}

function sitemapXml(c) {
  const day = CHANGELOG[0].date;
  const urls = [['/', '1.0', 'weekly'], ['/terms', '0.3', 'monthly'], ['/privacy', '0.3', 'monthly']];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, pr, f]) => `  <url><loc>${c.origin}${u}</loc><lastmod>${day}</lastmod><changefreq>${f}</changefreq><priority>${pr}</priority></url>`).join('\n')}\n</urlset>\n`;
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}

function canonicalRedirect(c) {
  if (!c.env.PUBLIC_URL || (c.req.method !== 'GET' && c.req.method !== 'HEAD')) return null;
  let canon;
  try { canon = new URL(c.env.PUBLIC_URL); } catch { return null; }
  if (c.url.host === canon.host || !PAGE_RE.test(c.url.pathname)) return null;
  return new Response(null, { status: 301, headers: { location: `${canon.origin}${c.url.pathname}${c.url.search}`, 'cache-control': 'public, max-age=86400' } });
}

export async function handle(req, ctx) {
  const url = new URL(req.url);
  const c = { ...ctx, req, url, origin: String(ctx.env.PUBLIC_URL || url.origin).replace(/\/+$/, ''), body: {}, ip: ctx.ip || 'unknown' };
  const p = url.pathname;
  const canon = canonicalRedirect(c);
  if (canon) return canon;
  try {
    if (p === '/api/wa/webhook') return await waWebhook(c);
    if (p.startsWith('/api/')) return await api(c);
    if (p.startsWith('/apple/v1/')) return await appleService(c);
    if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(c);
    let m;
    if ((m = p.match(/^\/media\/logo\/(\d+)\.png$/))) return await logo(c, m[1]);
    if ((m = p.match(/^\/media\/menu\/(\d+)\.jpg$/))) return await menuImage(c, m[1]);
    if ((m = p.match(/^\/media\/menu-pdf\/(\d+)\/(\d+)\.pdf$/))) return await menuPdf(c, m[1], m[2]);
    if (/^\/m\/[a-z0-9-]{3,40}\/?$/.test(p)) return await page(c, '/menu.html');
    if (/^\/print\/[a-z0-9-]{3,40}\/?$/.test(p)) return await page(c, '/print.html');
    if (/^\/g\/[a-z2-9]{20}\/?$/.test(p)) return await page(c, '/gift.html');
    if (p === '/cards' || p === '/cards/') return await page(c, '/cards.html');
    if (p === '/' || p === '/index.html') return await page(c, '/index.html');
    if (p === '/privacy' || p === '/privacy/') return await page(c, '/privacy.html');
    if (p === '/terms' || p === '/terms/') return await page(c, '/terms.html');
    // نفس صفحة الخصوصية لـ Meta (تعليمات حذف البيانات): ما بتتحوّل للدومين، لأنه زاحف Meta ما بيعدّي حماية البوتات عليه
    if (p === '/data-deletion' || p === '/data-deletion/') return await page(c, '/privacy.html');
    if (/^\/partner\/[a-z2-9]{20}\/?$/.test(p)) return await page(c, '/partner.html');
    if (p === '/app' || p === '/app/') return await page(c, '/app.html');
    if (/^\/j\/[a-z0-9-]{3,40}\/?$/.test(p)) return await page(c, '/join.html');
    if ((m = p.match(/^\/c\/([a-z2-9]{20})\/google$/))) return await googleSave(c, m[1]);
    if ((m = p.match(/^\/c\/([a-z2-9]{20})\/apple$/))) return await appleSave(c, m[1]);
    if ((m = p.match(/^\/c\/([a-z2-9]{20})\/manifest\.webmanifest$/))) return await cardManifest(c, m[1]);
    if (/^\/c\/[a-z2-9]{20}\/?$/.test(p)) return await page(c, '/card.html');
    if (p === '/robots.txt') return robotsTxt(c);
    if (p === '/sitemap.xml') return sitemapXml(c);
    if (/\.html$/.test(p)) return notFound(c);
    const res = await c.asset(p);
    return res.status === 404 ? notFound(c) : res;
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, ...(e.extra || {}) }, e.status);
    console.error(e);
    return json({ error: 'صار خطأ بالسيرفر، جرّب كمان شوي' }, 500);
  }
}
