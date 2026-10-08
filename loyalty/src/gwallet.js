// Google Wallet: بطاقة ولاء لكل زبون (LoyaltyObject) تحت فئة لكل محل (LoyaltyClass).
// - رابط «أضف إلى محفظة Google» = JWT موقّع بمفتاح حساب الخدمة.
// - تحديث النقاط وإرسال الرسائل عن طريق Wallet REST API.
// - merchantLocations (لحد 10 مواقع) هي اللي بتخلي الجوال يطلّع البطاقة لما يقرّب الزبون من المحل.
import { progress, rewardRule, stampsLine, unitWord } from '../public/js/rules.js';
import { b64ToBytes, b64url, b64urlText } from './util.js';
import { shopLinks } from './apple.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://walletobjects.googleapis.com/walletobjects/v1';
const SCOPE = 'https://www.googleapis.com/auth/wallet_object.issuer';
export const SAVE_URL = 'https://pay.google.com/gp/v/save/';

// GOOGLE_ISSUER_ID + GOOGLE_SERVICE_ACCOUNT (محتوى ملف JSON تبع حساب الخدمة كامل)
export function googleConfig(env = {}) {
  if (!env.GOOGLE_ISSUER_ID || !env.GOOGLE_SERVICE_ACCOUNT) return null;
  let sa;
  try { sa = typeof env.GOOGLE_SERVICE_ACCOUNT === 'string' ? JSON.parse(env.GOOGLE_SERVICE_ACCOUNT) : env.GOOGLE_SERVICE_ACCOUNT; } catch { return null; }
  if (!sa || !sa.client_email || !sa.private_key) return null;
  return {
    issuerId: String(env.GOOGLE_ISSUER_ID).trim(),
    email: sa.client_email,
    privateKey: sa.private_key,
    prefix: env.GOOGLE_ID_PREFIX || 'loy',
    fetch: env.fetch || ((...a) => fetch(...a)),
  };
}

export const classId = (cfg, shopId) => `${cfg.issuerId}.${cfg.prefix}_s${shopId}`;
export const objectId = (cfg, memberId) => `${cfg.issuerId}.${cfg.prefix}_m${memberId}`;

const keyCache = new Map();
function importKey(pem) {
  if (!keyCache.has(pem)) {
    const der = b64ToBytes(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
    keyCache.set(pem, crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']));
  }
  return keyCache.get(pem);
}

export async function signJwt(claims, privateKeyPem) {
  const head = `${b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64urlText(JSON.stringify(claims))}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await importKey(privateKeyPem), new TextEncoder().encode(head));
  return `${head}.${b64url(new Uint8Array(sig))}`;
}

const ar = (value) => ({ defaultValue: { language: 'ar', value } });

export function buildClass(cfg, shop, origin, { menuUrl = null } = {}) {
  const locations = JSON.parse(shop.locations || '[]').slice(0, 10);
  const cls = {
    id: classId(cfg, shop.id),
    issuerName: shop.name,
    programName: shop.name,
    programLogo: {
      sourceUri: { uri: `${origin}/media/logo/${shop.id}.png?v=${shop.logo_version}` },
      contentDescription: ar(shop.name),
    },
    hexBackgroundColor: shop.color,
    reviewStatus: 'UNDER_REVIEW',
    countryCode: shop.country,
    accountIdLabel: 'رقم البطاقة',
    accountNameLabel: 'الاسم',
    multipleDevicesAndHoldersAllowedStatus: 'ONE_USER_ALL_DEVICES',
    textModulesData: [{ id: 'reward', header: 'المكافأة', body: rewardRule(shop) }],
  };
  if (locations.length) cls.merchantLocations = locations.map((l) => ({ latitude: l.lat, longitude: l.lng }));
  // رابط المنيو على مستوى الفئة: بيطلع بتفاصيل كل بطاقات المحل مرة وحدة (جنب رابط البطاقة تبع كل زبون).
  // التحديث عند Google بـ PATCH، فلازم نبعت القائمة فاضية لما ينشال المنيو عشان ينمسح الرابط
  // المنيو أول إشي، وبعده روابط المحل (إنستغرام، واتساب…)
  cls.linksModuleData = { uris: [
    ...(menuUrl ? [{ id: 'menu', uri: menuUrl, description: '📋 المنيو' }] : []),
    ...shopLinks(shop).map((l) => ({ id: `link-${l.key}`, uri: l.url, description: `${l.label}: ${l.text}` })),
  ] };
  return cls;
}

export function buildObject(cfg, shop, member, origin) {
  const p = progress(shop, member.balance);
  const stamps = shop.program_type === 'stamps';
  const obj = {
    id: objectId(cfg, member.id),
    classId: classId(cfg, shop.id),
    state: 'ACTIVE',
    accountId: member.card_no,
    accountName: member.name,
    barcode: { type: 'QR_CODE', value: member.token, alternateText: member.card_no },
    loyaltyPoints: stamps
      ? { label: 'الأختام', balance: { string: `${p.available ? p.cost : p.toward}/${p.cost}` } }
      : { label: 'النقاط', balance: { int: member.balance } },
    secondaryLoyaltyPoints: p.available
      ? { label: 'مكافآت جاهزة', balance: { int: p.available } }
      : { label: 'باقي للمكافأة', balance: { int: p.remaining } },
    textModulesData: [{ id: 'progress', header: shop.reward_name, body: stamps ? stampsLine(shop, member.balance) : `${p.toward} / ${p.cost} ${unitWord(shop, p.cost)}` }],
    linksModuleData: { uris: [
      ...(shop.review_on ? [{ id: 'rate', uri: `${origin}/c/${member.token}#rate`, description: '⭐ قيّم زيارتك' }] : []),
      { id: 'card', uri: `${origin}/c/${member.token}`, description: 'بطاقتي على الويب' },
    ] },
  };
  return obj;
}

// رابط الحفظ: لو الكائن موجود عند Google بنبعت المعرّف بس (JWT قصير)، وإلا بنبعته كامل
export async function saveUrl(cfg, origin, { objects = [], classes = [] }) {
  const payload = { loyaltyObjects: objects };
  if (classes.length) payload.loyaltyClasses = classes;
  const jwt = await signJwt({ iss: cfg.email, aud: 'google', typ: 'savetowallet', iat: Math.floor(Date.now() / 1000), origins: [origin], payload }, cfg.privateKey);
  return SAVE_URL + jwt;
}

const tokenCache = new Map();
async function accessToken(cfg) {
  const hit = tokenCache.get(cfg.email);
  if (hit && hit.exp > Date.now() + 60000) return hit.token;
  const iat = Math.floor(Date.now() / 1000);
  const assertion = await signJwt({ iss: cfg.email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }, cfg.privateKey);
  const res = await cfg.fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Google auth: ${data.error_description || data.error || res.status}`);
  tokenCache.set(cfg.email, { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 });
  return data.access_token;
}

async function call(cfg, method, path, body) {
  const res = await cfg.fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${await accessToken(cfg)}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

function gError(r) {
  return new Error(`Google Wallet ${r.status}: ${(r.data && r.data.error && r.data.error.message) || 'خطأ غير معروف'}`);
}

// إضافة أو تحديث: POST، ولو موجود (409) بنعمل PATCH
async function upsert(cfg, type, body) {
  const ins = await call(cfg, 'POST', `/${type}`, body);
  if (ins.ok) return ins.data;
  if (ins.status !== 409) throw gError(ins);
  const upd = await call(cfg, 'PATCH', `/${type}/${encodeURIComponent(body.id)}`, body);
  if (!upd.ok) throw gError(upd);
  return upd.data;
}
export const upsertClass = (cfg, cls) => upsert(cfg, 'loyaltyClass', cls);
export const upsertObject = (cfg, obj) => upsert(cfg, 'loyaltyObject', obj);

// تحديث بطاقة زبون بعد ما تتغيّر نقاطه؛ false يعني الزبون لسا ما حفظها بمحفظته
export async function patchObject(cfg, obj) {
  const r = await call(cfg, 'PATCH', `/loyaltyObject/${encodeURIComponent(obj.id)}`, obj);
  if (r.status === 404) return false;
  if (!r.ok) throw gError(r);
  return true;
}

// رسالة لكل حاملي بطاقات المحل، بتوصلهم إشعار (Google بتحدد كم إشعار مسموح باليوم)
export async function addClassMessage(cfg, shopId, { header, body }) {
  const message = { id: `msg_${Date.now()}`, header, body, messageType: 'TEXT_AND_NOTIFY' };
  const r = await call(cfg, 'POST', `/loyaltyClass/${encodeURIComponent(classId(cfg, shopId))}/addMessage`, { message });
  if (!r.ok) throw gError(r);
  return r.data;
}
