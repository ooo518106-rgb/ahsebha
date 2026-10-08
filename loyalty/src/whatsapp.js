// 📲 واتساب الرسمي (WhatsApp Business Cloud API من Meta): وكيل المبيعات بيبعت أول رسالة (قالب موافق عليه من Meta)،
// ولما المحل يرد، الردود بتوصل على /api/wa/webhook والوكيل بيجاوب خلال 24 ساعة من آخر رسالة إله.
import { normPhone } from './util.js';

// الأسرار من Cloudflare: WHATSAPP_TOKEN (توكن دائم)، WHATSAPP_PHONE_ID (رقم تعريف رقم الهاتف)،
// WHATSAPP_APP_SECRET (للتأكد إنه الرسائل جاية من Meta)، WHATSAPP_VERIFY_TOKEN (كلمة بتختارها لربط الـ webhook)
export function waConfig(env) {
  const token = String(env.WHATSAPP_TOKEN || '').trim();
  const phoneId = String(env.WHATSAPP_PHONE_ID || '').trim();
  if (!token || !/^\d{5,20}$/.test(phoneId)) return null;
  return {
    token,
    phoneId,
    appSecret: String(env.WHATSAPP_APP_SECRET || '').trim(),
    verifyToken: String(env.WHATSAPP_VERIFY_TOKEN || '').trim(),
    wabaId: /^\d{5,20}$/.test(String(env.WHATSAPP_WABA_ID || '')) ? String(env.WHATSAPP_WABA_ID) : null,
    template: String(env.WHATSAPP_TEMPLATE || 'nuqatak_intro').trim(),
    // أول رسالة الجديدة (صورة + أزرار): أول اسم موافق عليه من هالقائمة (العربي أول)، ولحد هداك القديمة
    templates2: String(env.WHATSAPP_TEMPLATE2 || 'nuqatak_intro_ar,nuqatak_intro2').split(',').map((x) => x.trim()).filter(Boolean),
    alertTemplate: String(env.WHATSAPP_ALERT_TEMPLATE || 'nuqatak_alert').trim(), // تنبيه لصاحب المنصة على رقمه
    lang: String(env.WHATSAPP_TEMPLATE_LANG || 'ar').trim(),
    version: /^v\d+\.\d+$/.test(String(env.WHATSAPP_API_VERSION || '')) ? env.WHATSAPP_API_VERSION : 'v26.0',
    fetch: env.fetch || ((...a) => fetch(...a)),
  };
}

const CODES = { JO: '962', PS: '970', SA: '966', AE: '971', KW: '965', QA: '974', BH: '973', OM: '968', EG: '20', IQ: '964', LB: '961', SY: '963', TR: '90' };

// الرقم بالشكل الدولي بدون + (962791234567)، أو null إذا مش رقم موبايل بينفع للواتساب
export function waNumber(raw, country = 'JO') {
  let d = normPhone(raw);
  const code = CODES[country] || '962';
  if (/^0\d{8,10}$/.test(d)) d = code + d.slice(1);
  else if (country === 'JO' && /^7\d{8}$/.test(d)) d = `962${d}`;
  if (d.startsWith('962')) return /^9627[789]\d{7}$/.test(d) ? d : null; // الأردن: موبايل بس (الأرضي 06 ما عليه واتساب)
  return /^\d{10,15}$/.test(d) ? d : null;
}

// طلب لـ Graph API. الخطأ بيحمل رسالة Meta (التفاصيل أوضح إشي) ورقمها
async function call(cfg, path, { method = 'POST', body } = {}) {
  const res = await cfg.fetch(`https://graph.facebook.com/${cfg.version}/${path}`, {
    method,
    headers: { authorization: `Bearer ${cfg.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const er = data.error || {};
    const e = new Error((er.error_data && er.error_data.details) || er.error_user_msg || er.message || `WhatsApp ${res.status}`);
    e.code = er.code;
    e.status = res.status;
    throw e;
  }
  return data;
}

async function graph(cfg, body) {
  const data = await call(cfg, `${cfg.phoneId}/messages`, { body: { messaging_product: 'whatsapp', ...body } });
  return data.messages && data.messages[0] ? data.messages[0].id : null;
}

// ─── تسجيل رقم الإيجنت من صفحة المنصة (لما صفحة Meta بتعلق) ───
export const numberStatus = (cfg) => call(cfg, `${cfg.phoneId}?fields=display_phone_number,verified_name,code_verification_status,name_status,status,quality_rating,platform_type`, { method: 'GET' });
export const requestCode = (cfg, method) => call(cfg, `${cfg.phoneId}/request_code`, { body: { code_method: method === 'VOICE' ? 'VOICE' : 'SMS', language: 'ar' } });
export const verifyCode = (cfg, code) => call(cfg, `${cfg.phoneId}/verify_code`, { body: { code } });
export const registerNumber = (cfg, pin) => call(cfg, `${cfg.phoneId}/register`, { body: { messaging_product: 'whatsapp', pin } });
// اشتراك التطبيق بحساب الواتساب (زر «الاشتراك في Webhooks» بصفحة Meta): بدونه ردود المحلات ما بتوصل
export const subscribedApps = (cfg) => call(cfg, `${cfg.wabaId}/subscribed_apps`, { method: 'GET' });
export const subscribeApp = (cfg) => call(cfg, `${cfg.wabaId}/subscribed_apps`, {});
// قالب أول رسالة على حساب الواتساب: حالته عند Meta (APPROVED، PENDING، REJECTED…)؛ إذا القائمة فاضية، القالب مش على هالحساب
export const templates = (cfg, name = cfg.template) => call(cfg, `${cfg.wabaId}/message_templates?name=${encodeURIComponent(name)}&fields=name,status,language,category,rejected_reason`, { method: 'GET' });
// بيقدر يبعت؟ (Meta بتقول إذا في إشي مانع: الدفع، الحساب، الرقم) { can_send_message, entities: [{ errors }] }
export const health = (cfg) => call(cfg, `${cfg.phoneId}?fields=health_status`, { method: 'GET' });

// أول رسالة: القالب، والمتغير {{1}} = اسم المحل. image: رابط صورة الرأس (للقالب اللي فوقه صورة)
export const sendTemplate = (cfg, to, shopName, { name = cfg.template, image = null, lang = cfg.lang } = {}) => graph(cfg, {
  to,
  type: 'template',
  template: {
    name,
    language: { code: lang },
    components: [
      ...(image ? [{ type: 'header', parameters: [{ type: 'image', image: { link: image } }] }] : []),
      { type: 'body', parameters: [{ type: 'text', text: String(shopName).replace(/\s+/g, ' ').slice(0, 60) }] },
    ],
  },
});

// صورة (بس خلال 24 ساعة من آخر رسالة منه)
export const sendImage = (cfg, to, link, caption = '') => graph(cfg, { to, type: 'image', image: { link, ...(caption ? { caption: String(caption).slice(0, 1000) } : {}) } });

// تنبيه لصاحب المنصة (قالب {{1}} مين، {{2}} رقمه، {{3}} شو بده). Meta بترفض متغير فاضي أو فيه سطر جديد
const param = (v) => ({ type: 'text', text: String(v || '').replace(/\s+/g, ' ').trim().slice(0, 200) || '—' });
export const sendAlert = (cfg, to, { who, phone, about }) => graph(cfg, {
  to,
  type: 'template',
  template: { name: cfg.alertTemplate, language: { code: cfg.lang }, components: [{ type: 'body', parameters: [param(who), param(phone), param(about)] }] },
});

// رد عادي (بس خلال 24 ساعة من آخر رسالة من المحل)
export const sendText = (cfg, to, text) => graph(cfg, { to, type: 'text', text: { body: String(text).slice(0, 4000), preview_url: true } });

// Meta بتوقّع كل رسالة بـ HMAC-SHA256 بسر التطبيق (X-Hub-Signature-256)
export async function verifySignature(appSecret, raw, header) {
  const m = /^sha256=([0-9a-f]{64})$/i.exec(String(header || ''));
  if (!appSecret || !m) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const sig = new Uint8Array(m[1].match(/../g).map((h) => parseInt(h, 16)));
  return crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(raw));
}

// أي إشي بالإشعار مش قائمة (إشعار غلط أو مش من Meta) بنعامله كقائمة فاضية
const list = (v) => (Array.isArray(v) ? v : []);
const changesOf = (payload) => list(payload && payload.entry).flatMap((entry) => list(entry && entry.changes).map((ch) => ({ entry, ch: ch || {} })));

// الرسائل الواصلة من الـ webhook: [{ from, id, name, text, at }]
export function incoming(payload, phoneId) {
  const out = [];
  for (const { ch } of changesOf(payload)) {
    const v = ch.value || {};
    if (phoneId && v.metadata && v.metadata.phone_number_id && v.metadata.phone_number_id !== phoneId) continue;
    const names = Object.fromEntries(list(v.contacts).map((ct) => [ct && ct.wa_id, ct && ct.profile && ct.profile.name]));
    for (const msg of list(v.messages)) {
      if (!msg || typeof msg !== 'object') continue;
      const text = msg.type === 'text' ? msg.text && msg.text.body
        : msg.type === 'button' ? msg.button && (msg.button.text || msg.button.payload)
          : msg.type === 'interactive' ? ((msg.interactive && (msg.interactive.button_reply || msg.interactive.list_reply)) || {}).title
            : null;
      out.push({ from: normPhone(msg.from), id: msg.id, name: names[msg.from] || '', text: text ? String(text).trim().slice(0, 1000) : '', type: msg.type, at: Number(msg.timestamp) * 1000 || Date.now() });
    }
  }
  return out;
}

// رسائلنا وصلت (delivered) أو انقرت (read): [{ id, status, at }]
export function statuses(payload, phoneId) {
  const out = [];
  for (const { ch } of changesOf(payload)) {
    const v = ch.value || {};
    if (phoneId && v.metadata && v.metadata.phone_number_id && v.metadata.phone_number_id !== phoneId) continue;
    for (const st of list(v.statuses)) {
      if (st && (st.status === 'delivered' || st.status === 'read') && st.id) out.push({ id: String(st.id), status: st.status, at: Number(st.timestamp) * 1000 || Date.now() });
    }
  }
  return out;
}

// رسائلنا اللي فشلت بعد ما Meta قبلتها (الرقم مش عليه واتساب، حد رسائل التسويق، الدفع، القالب…):
// Meta بترد «تمام» على الإرسال، وبعدين بتبعت إشعار حالة «failed» فيه السبب. [{ id, to, code, message }]
export function failures(payload, phoneId) {
  const out = [];
  for (const { ch } of changesOf(payload)) {
    const v = ch.value || {};
    if (phoneId && v.metadata && v.metadata.phone_number_id && v.metadata.phone_number_id !== phoneId) continue;
    for (const st of list(v.statuses)) {
      if (!st || st.status !== 'failed' || !st.id) continue;
      const er = list(st.errors)[0] || {};
      out.push({ id: String(st.id), to: normPhone(st.recipient_id), code: Number(er.code) || null, message: String((er.error_data && er.error_data.details) || er.message || er.title || 'failed').slice(0, 300) });
    }
  }
  return out;
}

// إشعارات عن الحساب نفسه: حالة القالب (Meta وقّفته لأنه ناس بلّغوا)، وتقييم الرقم (FLAGGED، DOWNGRADE).
// [{ kind: 'template'|'quality', event, name, reason }]
export function accountEvents(payload, wabaId) {
  const out = [];
  for (const { entry, ch } of changesOf(payload)) {
    if (wabaId && entry && entry.id && String(entry.id) !== wabaId) continue;
    const v = ch.value || {};
    const event = String(v.event || '').toUpperCase().slice(0, 40);
    if (!event) continue;
    if (ch.field === 'message_template_status_update') out.push({ kind: 'template', event, name: String(v.message_template_name || ''), reason: String(v.reason || (v.other_info && v.other_info.description) || '').slice(0, 200) });
    else if (ch.field === 'phone_number_quality_update') out.push({ kind: 'quality', event, name: String(v.display_phone_number || ''), reason: String(v.current_limit || '').slice(0, 40) });
  }
  return out;
}

// ملخص إشعار للتشخيص: شو الحقول، وكم رسالة لرقمنا ولأرقام تانية، وكم رسالة إلنا فشلت
export function hookSummary(payload, phoneId) {
  const fields = new Set();
  let ours = 0;
  let other = 0;
  for (const { ch } of changesOf(payload)) {
    if (ch.field) fields.add(String(ch.field).slice(0, 40));
    const n = list(ch.value && ch.value.messages).length;
    const pid = ch.value && ch.value.metadata && ch.value.metadata.phone_number_id;
    if (pid && pid === phoneId) ours += n; else other += n;
  }
  return { fields: [...fields].slice(0, 5), ours, other, failed: failures(payload, phoneId).length };
}

// «وقف» أو «stop» أو «مش مهتم»: ما منرجع نبعتله. «لا» لحالها بس إذا كانت أول رد على رسالتنا،
// لأنه بنص المحادثة غالباً جواب على سؤال الوكيل («عندك فروع؟» «لا»)
const STOP_RE = /^\s*(مش مهتم|مو مهتم|مش مهتمين|ما بدي|لا تبعت(لي)?|لا ترسل|وقف|توقف|وقّف|الغاء|إلغاء|stop|unsubscribe|not interested)\s*[.!🙏]*\s*$/i;
const NO_RE = /^\s*(لا|لأ|لا شكرا|لا شكراً|لا، شكراً|لا شكرًا|لا مشكور|no|no thanks?)\s*[.!🙏]*\s*$/i;
export const isOptOut = (text, { firstReply = true } = {}) => STOP_RE.test(String(text || '')) || (firstReply && NO_RE.test(String(text || '')));
