// السيرفر: صفحات + API. معالج واحد handle(request, ctx) بيشتغل على Cloudflare Workers وعلى Node.
// ctx = { db, env, asset(path) → Response, waitUntil(promise) }
import * as auth from './auth.js';
import * as apple from './apple.js';
import { pemToDer } from '../public/js/asn1.js';
import * as gw from './gwallet.js';
import * as webpush from './webpush.js';
import { defaultLogoPng } from './png.js';
import { earnFor, progress, rewardCost, rewardRule, stampsLine, unitLabel } from '../public/js/rules.js';
import { b64ToBytes, bytesToB64, clean, fail, HttpError, isUniqueError, json, normPhone, randomDigits, randomToken } from './util.js';

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const TOKEN_RE = /^[a-z2-9]{20}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
export const CURRENCIES = { JO: 'JOD', PS: 'ILS', SA: 'SAR', AE: 'AED', KW: 'KWD', QA: 'QAR', BH: 'BHD', OM: 'OMR', EG: 'EGP', IQ: 'IQD', LB: 'USD', SY: 'SYP', TR: 'TRY', US: 'USD' };
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
    locations: JSON.parse(shop.locations || '[]'),
    logo: logoUrl(shop, origin),
    customLogo: !!shop.custom_logo,
    joinUrl: `${origin}/j/${shop.slug}`,
    rule: rewardRule(shop),
    cost: rewardCost(shop),
    unit: unitLabel(shop),
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
  };
}

function memberView(m, shop) {
  return {
    id: m.id,
    name: m.name,
    phone: m.phone,
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
  };
}

const logoUrl = (shop, origin) => `${origin}/media/logo/${shop.id}.png?v=${shop.logo_version}`;

// ─── Google Wallet ───
async function syncClass(c, shop) {
  const cfg = gw.googleConfig(c.env);
  if (!cfg) return { enabled: false };
  try {
    await gw.upsertClass(cfg, gw.buildClass(cfg, shop, c.origin));
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
  const shop = await c.db.get('SELECT * FROM shops WHERE id = ?', m.shop_id);
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
    url = await gw.saveUrl(cfg, c.origin, { classes: [gw.buildClass(cfg, shop, c.origin)], objects: [obj] });
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
  const shop = await c.db.get('SELECT * FROM shops WHERE id = ?', member.shop_id);
  const passJson = apple.buildPassJson(shop, member, { ...cfg, origin: c.origin, authToken: await apple.authTokenFor(cfg.authSecret, member.token) });
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
  const shop = await c.db.get('SELECT * FROM shops WHERE id = ?', m.shop_id);
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
  const endpoint = String(c.body.endpoint || '');
  const keys = c.body.keys || {};
  const p256dh = String(keys.p256dh || '');
  const authKey = String(keys.auth || '');
  if (!webpush.validEndpoint(endpoint)) fail(400, 'اشتراك الإشعارات مش صالح');
  let ok = false;
  try { ok = webpush.fromB64url(p256dh).length === 65 && webpush.fromB64url(authKey).length === 16; } catch { ok = false; }
  if (!ok) fail(400, 'اشتراك الإشعارات مش صالح');
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
  const shop = await c.db.get('SELECT * FROM shops WHERE id = ?', m.shop_id);
  const r = await pushTo(c, [sub], () => ({
    title: shop.name,
    body: 'تمام! الإشعارات شغّالة ✅ رح يوصلك إشعار كل ما تنضافلك نقاط.',
    icon: logoUrl(shop, c.origin),
    url: `${c.origin}/c/${m.token}`,
    tag: `test-${m.id}`,
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
async function pushTo(c, subs, messageFor) {
  const out = { ok: 0, error: 0, results: [] };
  if (!subs.length) return out;
  const vapid = await vapidKeys(c);
  const opts = { vapid, subject: c.env.VAPID_SUBJECT || c.origin, fetchImpl: c.env.fetch || ((...a) => fetch(...a)) };
  out.results = await Promise.all(subs.map((s) => webpush.sendPush(s, messageFor(s), opts)));
  const now = Date.now();
  const writes = out.results.map((r, i) => {
    if (r.result === 'ok') out.ok++; else out.error++;
    if (r.result === 'error') console.error('web push:', new URL(subs[i].endpoint).host, r.reason);
    return r.result === 'gone'
      ? ['DELETE FROM push_subs WHERE endpoint = ?', [subs[i].endpoint]]
      : ['UPDATE push_subs SET last_at = ?, last_error = ? WHERE id = ?', [now, r.reason, subs[i].id]];
  });
  await c.db.batch(writes);
  return out;
}

function notifyMember(c, member, message) {
  c.waitUntil((async () => {
    const subs = await c.db.all('SELECT * FROM push_subs WHERE member_id = ?', member.id);
    await pushTo(c, subs, () => ({ ...message, url: `${c.origin}/c/${member.token}` }));
  })().catch((e) => console.error('web push:', e.message)));
}

function earnMessage(shop, before, after, delta) {
  const p0 = progress(shop, before.balance);
  const p1 = progress(shop, after.balance);
  const stamps = shop.program_type === 'stamps';
  const body = p1.available > p0.available
    ? `🎁 مكافأتك جاهزة: ${shop.reward_name}! اطلبها بزيارتك الجاية.`
    : stamps
      ? `انضافلك ${delta === 1 ? 'ختم' : `${delta} أختام`} ☕ صار عندك ${p1.toward}/${p1.cost}`
      : `انضافلك ${delta} نقطة ☕ رصيدك صار ${after.balance}، وباقي ${p1.remaining} لـ ${shop.reward_name}`;
  return { title: shop.name, body, tag: `card-${after.id}` };
}

// الرسالة الجماعية بتنبعت على دفعات (Cloudflare بيحد عدد الطلبات الخارجية بكل طلب)
const PUSH_BATCH = 40;
async function broadcastBatch(c, id, cursor) {
  const b = await c.db.get('SELECT * FROM broadcasts WHERE id = ? AND shop_id = ?', id, c.shop.id);
  if (!b) fail(404, 'ما لقينا الرسالة');
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

// ─── مساعدات ───
async function shopBySlug(db, slug) {
  const shop = await db.get('SELECT * FROM shops WHERE slug = ?', String(slug).toLowerCase());
  if (!shop) fail(404, 'ما لقينا هالمحل');
  return shop;
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

async function createMember(db, shop, name, phone) {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await db.run(
        'INSERT INTO members (shop_id, token, card_no, name, phone, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        shop.id, randomToken(), randomDigits(8), name, phone, Date.now(),
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
const DAY = 864e5;

// محل صاحب المنصة (أول حساب) ما بيخلص اشتراكه
async function platformShopId(db) {
  const row = await db.get('SELECT shop_id FROM users ORDER BY id LIMIT 1');
  return row ? row.shop_id : null;
}

function subscriptionOf(shop, platformShop) {
  if (shop.id === platformShop) return { state: 'owner', until: null, daysLeft: null };
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
  return json({ shop: { ...publicShopView(shop, c.origin), paused } });
}

async function join(c, slug) {
  const shop = await shopBySlug(c.db, slug);
  if (c.body.website) fail(400, 'طلب غير صالح'); // فخ للبوتات
  if ((await subscription(c, shop)).state === 'expired') fail(403, 'برنامج الولاء بهالمحل متوقف مؤقتاً.');
  // سقف لكل جهاز/شبكة، وسقف عام لكل محل (لو حدا غيّر الـ IP)
  await rateLimit(c, `join:${c.ip}`, 20, 10 * MIN);
  await rateLimit(c, `join-shop:${shop.id}`, 150, 10 * MIN, 'في ضغط على التسجيل هلأ، جرّب بعد شوي');
  const m = await createMember(c.db, shop, readName(c.body.name), readPhone(c.body.phone));
  return json({ token: m.token, url: `${c.origin}/c/${m.token}` }, 201);
}

async function cardInfo(c, token) {
  const m = await c.db.get('SELECT * FROM members WHERE token = ?', token);
  if (!m) fail(404, 'ما لقينا هالبطاقة');
  const shop = await c.db.get('SELECT * FROM shops WHERE id = ?', m.shop_id);
  const v = memberView(m, shop);
  delete v.phone;
  delete v.id;
  return json({ shop: publicShopView(shop, c.origin), member: v, google: !!gw.googleConfig(c.env), apple: !!(await appleConfig(c)) });
}

// الزبون بيحذف بطاقته وبياناته بنفسه (رابط البطاقة نفسه هو الإثبات)
async function deleteCard(c, token) {
  const m = await c.db.get('SELECT * FROM members WHERE token = ?', token);
  if (!m) fail(404, 'ما لقينا هالبطاقة');
  const shop = await c.db.get('SELECT * FROM shops WHERE id = ?', m.shop_id);
  await deleteMember(c, shop, m);
  return json({ ok: true });
}

async function site(c) {
  return json({
    contactEmail: c.env.CONTACT_EMAIL || null,
    whatsapp: /^\d{8,15}$/.test(String(c.env.WHATSAPP_NUMBER || '')) ? String(c.env.WHATSAPP_NUMBER) : null,
    signupOpen: !c.env.SIGNUP_CODE,
    apple: !!(await appleConfig(c, { withKey: false })),
  });
}

// طلب اشتراك من صفحة البيع
const LEAD_KINDS = ['مطعم', 'كوفي شوب', 'مخبز وحلويات', 'صالون', 'محل تجاري', 'غيره'];
async function createLead(c) {
  const b = c.body;
  if (b.website) fail(400, 'طلب غير صالح');
  await rateLimit(c, `lead:${c.ip}`, 5, 60 * MIN);
  const shopName = clean(b.shopName, 60);
  if (shopName.length < 2) fail(400, 'اكتب اسم المحل');
  const name = readName(b.name);
  const phone = readPhone(b.phone);
  const kind = LEAD_KINDS.includes(b.kind) ? b.kind : '';
  await c.db.run(
    'INSERT INTO leads (shop_name, name, phone, city, kind, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    shopName, name, phone, clean(b.city, 40), kind, clean(b.note, 500), Date.now(),
  );
  return json({ ok: true }, 201);
}

// مدير المنصة = أول حساب انعمل عليها (صاحب المنصة)
async function isPlatformAdmin(c) {
  const first = await c.db.get('SELECT MIN(id) AS id FROM users');
  return !!(c.user && first && first.id === c.user.id);
}

async function requireAdmin(c) {
  if (!(await isPlatformAdmin(c))) fail(403, 'هاي الصفحة لمدير المنصة بس');
}

async function adminLeads(c) {
  await requireAdmin(c);
  const leads = await c.db.all('SELECT id, shop_name AS shopName, name, phone, city, kind, note, status, created_at AS createdAt FROM leads ORDER BY created_at DESC LIMIT 200');
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
    `SELECT s.id, s.name, s.slug, s.created_at AS createdAt, s.active_until, s.paid, s.created_at,
       (SELECT COUNT(*) FROM members m WHERE m.shop_id = s.id) AS members,
       (SELECT MAX(t.created_at) FROM txns t WHERE t.shop_id = s.id) AS lastActivity,
       (SELECT u.email FROM users u WHERE u.shop_id = s.id AND u.role = 'owner' ORDER BY u.id LIMIT 1) AS ownerEmail
     FROM shops s ORDER BY s.created_at DESC LIMIT 500`,
  );
  const platformShop = await platformShopId(c.db);
  const out = shops.map(({ active_until, paid, created_at, ...s }) => ({ ...s, subscription: subscriptionOf({ id: s.id, active_until, paid, created_at }, platformShop) }));
  return json({ shops: out, signupOpen: !c.env.SIGNUP_CODE });
}

// مدير المنصة بيفعّل اشتراك محل (+ شهر / + سنة) أو بيوقفه
async function adminShopPlan(c, id) {
  await requireAdmin(c);
  const shop = await c.db.get('SELECT * FROM shops WHERE id = ?', Number(id));
  if (!shop) fail(404, 'ما لقينا المحل');
  const now = Date.now();
  const current = shop.active_until ?? shop.created_at + TRIAL_DAYS * DAY;
  let until;
  let paid = 1;
  if (c.body.action === 'month' || c.body.action === 'year') {
    const d = new Date(Math.max(now, current));
    if (c.body.action === 'month') d.setMonth(d.getMonth() + 1); else d.setFullYear(d.getFullYear() + 1);
    until = d.getTime();
  } else if (c.body.action === 'stop') {
    until = now - 1000;
    paid = 0;
  } else {
    fail(400, 'إجراء غير معروف');
  }
  await c.db.run('UPDATE shops SET active_until = ?, paid = ? WHERE id = ?', until, paid, shop.id);
  return adminShops(c);
}

async function logo(c, shopId) {
  let row = await c.db.get('SELECT mime, data FROM shop_logos WHERE shop_id = ?', Number(shopId));
  if (!row) {
    const shop = await c.db.get('SELECT * FROM shops WHERE id = ?', Number(shopId));
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
  const pw = await auth.hashPassword(b.password);
  const now = Date.now();
  const base = slugBase(shopName);
  let slug = base;
  for (let i = 0; ; i++) {
    try {
      await c.db.batch([
        ['INSERT INTO shops (slug, name, country, currency, welcome_text, active_until, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [slug, shopName, country, CURRENCIES[country], `${shopName} ترحب بكم`, now + TRIAL_DAYS * DAY, now]],
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
  const user = await c.db.get('SELECT id FROM users WHERE email = ?', email);
  const token = await auth.createSession(c.db, user.id);
  return json({ ok: true }, 201, { 'set-cookie': auth.sessionCookie(token, c.req) });
}

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

async function me(c) {
  return json({
    user: { id: c.user.id, name: c.user.name, email: c.user.email, role: c.user.role, isAdmin: await isPlatformAdmin(c) },
    shop: shopView(c.shop, c.origin),
    google: googleStatus(c, c.shop),
    subscription: await subscription(c, c.shop),
    pushCount: (await c.db.get('SELECT COUNT(DISTINCT member_id) AS n FROM push_subs WHERE shop_id = ?', c.shop.id)).n,
    whatsapp: /^\d{8,15}$/.test(String(c.env.WHATSAPP_NUMBER || '')) ? String(c.env.WHATSAPP_NUMBER) : null,
    currencies: CURRENCIES,
  });
}

async function changePassword(c) {
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
    where += " AND (name LIKE ? ESCAPE '\\' OR card_no = ?" + (digits.length >= 3 ? ' OR phone LIKE ?' : '') + ')';
    a.push(like, q);
    if (digits.length >= 3) a.push(`%${digits}%`);
  }
  const rows = await c.db.all(`SELECT * FROM members WHERE ${where} ORDER BY COALESCE(last_visit, created_at) DESC LIMIT 50 OFFSET ?`, ...a, offset);
  const total = await c.db.get(`SELECT COUNT(*) AS n FROM members WHERE ${where}`, ...a);
  return json({ members: rows.map((m) => memberView(m, c.shop)), total: total.n });
}

async function addMember(c) {
  await requireActive(c);
  const name = readName(c.body.name);
  const phone = readPhone(c.body.phone);
  const existing = await c.db.get('SELECT id FROM members WHERE shop_id = ? AND phone = ?', c.shop.id, phone);
  if (existing) return json({ error: 'هالرقم إله بطاقة من قبل', memberId: existing.id }, 409);
  const m = await createMember(c.db, c.shop, name, phone);
  return json({ member: memberView(m, c.shop), cardUrl: `${c.origin}/c/${m.token}` }, 201);
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
    if (!m && digits.length >= 7) m = await c.db.get('SELECT * FROM members WHERE phone = ? AND shop_id = ?', digits, c.shop.id);
  }
  if (!m) fail(404, 'ما لقينا هالبطاقة عندكم');
  return json({ member: memberView(m, c.shop) });
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
  return json({ member: memberView(m, c.shop), txns, push, cardUrl: `${c.origin}/c/${m.token}` });
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
  if (!extra.duplicate && message) {
    const msg = message(fresh);
    if (msg) notifyMember(c, fresh, { ...msg, icon: logoUrl(c.shop, c.origin) });
  }
  return json({ member: memberView(fresh, c.shop), ...extra });
}

async function earn(c, id) {
  await requireActive(c);
  const m = await memberOf(c, id);
  const r = earnFor(c.shop, c.body);
  if (r.error) fail(400, r.error);
  const now = Date.now();
  const res = await applyTxn(c, [
    ['INSERT INTO txns (shop_id, member_id, kind, delta, amount, user_id, idem, created_at) VALUES (?, ?, \'earn\', ?, ?, ?, ?, ?)', [c.shop.id, m.id, r.delta, r.amount, c.user.id, idemKey(c.body.key), now]],
    ['UPDATE members SET balance = balance + ?, lifetime = lifetime + ?, visits = visits + 1, last_visit = ?, updated_at = ? WHERE id = ? AND shop_id = ?', [r.delta, r.delta, now, now, m.id, c.shop.id]],
  ]);
  return respondMember(c, m.id, res ? { delta: r.delta } : { duplicate: true }, (fresh) => earnMessage(c.shop, m, fresh, r.delta));
}

async function redeem(c, id) {
  await requireActive(c);
  const m = await memberOf(c, id);
  const cost = rewardCost(c.shop);
  const now = Date.now();
  // الشرط (الرصيد كافي) جوّا نفس العملية، فما في مجال تنصرف المكافأة مرتين
  const res = await applyTxn(c, [
    [`INSERT INTO txns (shop_id, member_id, kind, delta, user_id, idem, created_at)
      SELECT ?, id, 'redeem', ?, ?, ?, ? FROM members WHERE id = ? AND shop_id = ? AND balance >= ?`, [c.shop.id, -cost, c.user.id, idemKey(c.body.key), now, m.id, c.shop.id, cost]],
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
    [`INSERT INTO txns (shop_id, member_id, kind, delta, user_id, note, idem, created_at)
      SELECT ?, id, 'adjust', ?, ?, ?, ?, ? FROM members WHERE id = ? AND shop_id = ? AND balance + ? >= 0`, [c.shop.id, delta, c.user.id, note, idemKey(c.body.key), now, m.id, c.shop.id, delta]],
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
      `SELECT t.id, t.kind, t.delta, t.amount, t.note, t.created_at AS at, m.id AS memberId, m.name AS member, u.name AS by
       FROM txns t JOIN members m ON m.id = t.member_id LEFT JOIN users u ON u.id = t.user_id
       WHERE t.shop_id = ? ORDER BY t.created_at DESC, t.id DESC LIMIT 50`, s,
    ),
  ]);
  return json({ stats: { members: members.n, newWeek: newWeek.n, visitsDay: visitsDay.n, earnedMonth: earnedMonth.n, redeemedMonth: redeemedMonth.n }, recent });
}

// ─── إعدادات المحل (للمالك) ───
async function updateShop(c) {
  const b = c.body;
  const s = c.shop;
  const next = {};
  next.name = clean(b.name ?? s.name, 60);
  if (next.name.length < 2) fail(400, 'اكتب اسم المحل');
  next.slug = String(b.slug ?? s.slug).trim().toLowerCase();
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
  next.locations = JSON.stringify(locs.map((l, i) => {
    const lat = Number(l && l.lat);
    const lng = Number(l && l.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) fail(400, `موقع الفرع ${i + 1} مش صحيح`);
    return { name: clean(l.name, 40) || `فرع ${i + 1}`, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
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
  const shop = await c.db.get('SELECT * FROM shops WHERE id = ?', s.id);
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
  const shop = await c.db.get('SELECT * FROM shops WHERE id = ?', s.id);
  const google = await syncClass(c, shop);
  return json({ shop: shopView(shop, c.origin), google: { ...googleStatus(c, shop), lastSync: google } });
}

async function syncNow(c) {
  const r = await syncClass(c, c.shop);
  if (!r.enabled) fail(400, 'Google Wallet مش مفعّل على السيرفر');
  const shop = await c.db.get('SELECT * FROM shops WHERE id = ?', c.shop.id);
  return json({ google: { ...googleStatus(c, shop), lastSync: r } });
}

// رسالة لكل الزبائن: لحاملي البطاقة بمحفظة Google، وللي فعّلوا إشعارات الويب
async function broadcast(c) {
  await requireActive(c);
  const header = clean(c.body.header, 40) || c.shop.name;
  const body = clean(c.body.body, 300);
  if (body.length < 2) fail(400, 'اكتب نص الرسالة');
  await rateLimit(c, `broadcast:${c.shop.id}`, 3, 24 * 60 * MIN, 'مسموح 3 رسائل باليوم، عشان ما ينزعجوا الزبائن');
  const r = await c.db.run('INSERT INTO broadcasts (shop_id, header, body, created_at) VALUES (?, ?, ?, ?)', c.shop.id, header, body, Date.now());
  let google = null;
  const cfg = gw.googleConfig(c.env);
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
  return json({ id: r.lastId, google, push: await broadcastBatch(c, r.lastId, 0) });
}

// ─── الموظفين ───
async function listStaff(c) {
  const users = await c.db.all('SELECT id, name, email, role, created_at AS createdAt FROM users WHERE shop_id = ? ORDER BY id', c.shop.id);
  return json({ users });
}

async function addStaff(c) {
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
  ['POST', /^\/api\/shops\/([a-z0-9-]{3,40})\/join$/, join],
  ['GET', /^\/api\/cards\/([a-z2-9]{20})$/, cardInfo],
  ['POST', /^\/api\/cards\/([a-z2-9]{20})\/delete$/, deleteCard],
  ['GET', /^\/api\/site$/, site],
  ['GET', /^\/api\/push\/key$/, pushKey],
  ['POST', /^\/api\/cards\/([a-z2-9]{20})\/push$/, cardPushSubscribe],
  ['POST', /^\/api\/cards\/([a-z2-9]{20})\/push\/test$/, cardPushTest],
  ['DELETE', /^\/api\/cards\/([a-z2-9]{20})\/push$/, cardPushUnsubscribe],
  ['POST', /^\/api\/leads$/, createLead],
  ['GET', /^\/api\/admin\/leads$/, adminLeads, 'staff'],
  ['PUT', /^\/api\/admin\/leads\/(\d+)$/, adminLeadStatus, 'staff'],
  ['GET', /^\/api\/admin\/shops$/, adminShops, 'staff'],
  ['POST', /^\/api\/admin\/shops\/(\d+)\/plan$/, adminShopPlan, 'staff'],
  ['GET', /^\/api\/admin\/apple$/, adminApple, 'staff'],
  ['POST', /^\/api\/admin\/apple\/key$/, adminAppleKey, 'staff'],
  ['PUT', /^\/api\/admin\/apple\/cert$/, adminAppleCert, 'staff'],
  ['POST', /^\/api\/auth\/signup$/, signup],
  ['POST', /^\/api\/auth\/login$/, loginRoute],
  ['POST', /^\/api\/auth\/logout$/, logout],
  ['GET', /^\/api\/me$/, me, 'staff'],
  ['PUT', /^\/api\/me\/password$/, changePassword, 'staff'],
  ['GET', /^\/api\/members$/, listMembers, 'staff'],
  ['POST', /^\/api\/members$/, addMember, 'staff'],
  ['GET', /^\/api\/members\/lookup$/, lookup, 'staff'],
  ['GET', /^\/api\/members\/(\d+)$/, memberDetail, 'staff'],
  ['POST', /^\/api\/members\/(\d+)\/earn$/, earn, 'staff'],
  ['POST', /^\/api\/members\/(\d+)\/redeem$/, redeem, 'staff'],
  ['POST', /^\/api\/members\/(\d+)\/adjust$/, adjust, 'owner'],
  ['DELETE', /^\/api\/members\/(\d+)$/, removeMember, 'owner'],
  ['GET', /^\/api\/activity$/, activity, 'staff'],
  ['PUT', /^\/api\/shop$/, updateShop, 'owner'],
  ['PUT', /^\/api\/shop\/logo$/, updateLogo, 'owner'],
  ['POST', /^\/api\/shop\/sync$/, syncNow, 'owner'],
  ['POST', /^\/api\/broadcast$/, broadcast, 'owner'],
  ['POST', /^\/api\/broadcast\/(\d+)\/continue$/, broadcastContinue, 'owner'],
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
      c.shop = await c.db.get('SELECT * FROM shops WHERE id = ?', c.user.shop_id);
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

export async function handle(req, ctx) {
  const url = new URL(req.url);
  const c = { ...ctx, req, url, origin: String(ctx.env.PUBLIC_URL || url.origin).replace(/\/+$/, ''), body: {}, ip: ctx.ip || 'unknown' };
  const p = url.pathname;
  try {
    if (p.startsWith('/api/')) return await api(c);
    if (p.startsWith('/apple/v1/')) return await appleService(c);
    if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(c);
    let m;
    if ((m = p.match(/^\/media\/logo\/(\d+)\.png$/))) return await logo(c, m[1]);
    if (p === '/' || p === '/index.html') return await page(c, '/index.html');
    if (p === '/privacy' || p === '/privacy/') return await page(c, '/privacy.html');
    if (p === '/app' || p === '/app/') return await page(c, '/app.html');
    if (/^\/j\/[a-z0-9-]{3,40}\/?$/.test(p)) return await page(c, '/join.html');
    if ((m = p.match(/^\/c\/([a-z2-9]{20})\/google$/))) return await googleSave(c, m[1]);
    if ((m = p.match(/^\/c\/([a-z2-9]{20})\/apple$/))) return await appleSave(c, m[1]);
    if ((m = p.match(/^\/c\/([a-z2-9]{20})\/manifest\.webmanifest$/))) return await cardManifest(c, m[1]);
    if (/^\/c\/[a-z2-9]{20}\/?$/.test(p)) return await page(c, '/card.html');
    if (/\.html$/.test(p)) return notFound(c);
    const res = await c.asset(p);
    return res.status === 404 ? notFound(c) : res;
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'صار خطأ بالسيرفر، جرّب كمان شوي' }, 500);
  }
}
