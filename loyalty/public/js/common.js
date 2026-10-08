// أدوات الواجهة المشتركة: قوالب آمنة، طلبات API، تنبيهات، رمز QR، ورسم بطاقة الولاء

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// قالب HTML: كل قيمة بتتهرّب تلقائياً، إلا اللي ملفوفة بـ raw() أو ناتجة عن html``
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));
const part = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('') : v === false || v == null ? '' : esc(v));
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Raw(out);
}
export function render(el, tpl) { el.innerHTML = String(tpl); return el; }

export async function api(path, { method = 'GET', body } = {}) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body ?? {});
  }
  let res;
  try { res = await fetch(path, init); } catch { throw Object.assign(new Error('ما في اتصال بالإنترنت'), { status: 0 }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'صار خطأ، جرّب كمان مرة'), { status: res.status, data });
  return data;
}

export function toast(msg, kind = '') {
  let box = $('#toast');
  if (!box) { box = document.createElement('div'); box.id = 'toast'; box.setAttribute('role', 'status'); document.body.append(box); }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  box.append(t);
  setTimeout(() => t.remove(), 3200);
}

export const fmt = (n) => new Intl.NumberFormat('en-US').format(n);
export const fmtDate = (ms) => (ms ? new Intl.DateTimeFormat('ar-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms)) : '—');
export function ago(ms) {
  if (!ms) return '—';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'هلأ';
  if (m < 60) return `قبل ${m} د`;
  const h = Math.round(m / 60);
  if (h < 24) return `قبل ${h} س`;
  const d = Math.round(h / 24);
  return d < 30 ? `قبل ${d} يوم` : fmtDate(ms);
}

// مفتاح لكل عملية عشان ما تنحسب مرتين لو انبعتت مرتين
export function newKey() {
  if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function qrSVG(text, label = 'رمز QR') {
  if (!window.qrcode) return '';
  const q = window.qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
  return raw(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 4} ${n + 4}" shape-rendering="crispEdges" role="img" aria-label="${esc(label)}"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`);
}

// لون الكتابة فوق لون المحل: غامق فوق الألوان الفاتحة، وأبيض فوق الباقي
const HEX_RE = /^#[0-9a-f]{6}$/i;
export function inkFor(color) {
  if (!HEX_RE.test(color || '')) return '#ffffff';
  const n = parseInt(color.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.7 ? '#1c130d' : '#ffffff';
}

// theme: لون شريط الجوال فوق (بالصفحات اللي فوقها شريط بلون المحل)
export function setBrand(color, { theme = true } = {}) {
  if (!HEX_RE.test(color || '')) return;
  document.documentElement.style.setProperty('--brand', color);
  document.documentElement.style.setProperty('--brand-ink', inkFor(color));
  const meta = $('meta[name="theme-color"]');
  if (meta && theme) meta.content = color;
}

export function stampsHTML(cost, filled) {
  // آخر ختم عليه نجمة: هو المكافأة
  return html`<div class="stamps" aria-label="${filled} من ${cost}">${Array.from({ length: cost }, (_, i) => html`<i class="${i < filled ? 'on' : ''}" style="--i:${i}">${i < filled ? '✓' : i === cost - 1 ? '★' : ''}</i>`)}</div>`;
}

// شكل البطاقة نفسه بصفحة الزبون وبمعاينة الإعدادات. tr = دالة الترجمة (صفحة الزبون)، وبدونها عربي
// مفتاح كلمة الوحدة حسب العدد (بالعربي 3 لـ 10 جمع، وبالإنجليزي 1 مفرد): unitPoint / unitPoints / unitPoint1
export const unitKey = (stamps, n) => (stamps ? 'unitStamp' : 'unitPoint') + (n >= 3 && n <= 10 ? 's' : n === 1 ? '1' : '');
const CARD_AR = { name: 'الاسم', points: 'النقاط', stamps: 'الأختام', unitPoint: 'نقطة', unitStamp: 'ختم', unitPoints: 'نقاط', unitStamps: 'أختام', unitPoint1: 'نقطة', unitStamp1: 'ختم', ready1: '🎁 عندك مكافأة جاهزة: {reward}', readyN: '🎁 عندك {n} مكافآت جاهزة: {reward}', remaining: 'باقي {n} {unit} لـ {reward}' };
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
export function cardHTML(shop, member, { qr = true, tr = (k, v = {}) => fill(CARD_AR[k], v) } = {}) {
  const p = member.progress;
  const stamps = shop.programType === 'stamps';
  const filled = p.available && !p.toward ? p.cost : p.toward;
  const status = p.available
    ? (p.available > 1 ? tr('readyN', { n: p.available, reward: shop.rewardName }) : tr('ready1', { reward: shop.rewardName }))
    : tr('remaining', { n: p.remaining, unit: tr(unitKey(stamps, p.remaining)), reward: shop.rewardName });
  return html`
    <div class="loyalty-card${p.available ? ' ready' : ''}" style="--c:${shop.color};--ci:${inkFor(shop.color)}">
      <div class="lc-head">
        <img class="lc-logo" src="${shop.logo}" alt="">
        <div class="lc-name">${shop.name}</div>
        <span class="lc-chip" aria-hidden="true"></span>
      </div>
      <div class="lc-row">
        <div><div class="lc-label">${tr('name')}</div><div class="lc-value">${member.name}</div></div>
        <div class="lc-end"><div class="lc-label">${tr(stamps ? 'stamps' : 'points')}</div><div class="lc-value num">${stamps ? `${filled}/${p.cost}` : fmt(member.balance)}</div></div>
      </div>
      <div style="margin-top:12px">
        ${stamps ? stampsHTML(p.cost, filled) : html`<div class="bar"><i style="width:${p.pct}%"></i></div>`}
        <div class="small" style="margin-top:6px;opacity:.9">${status}</div>
      </div>
      ${qr ? html`<div class="lc-qr">${qrSVG(member.token, 'QR')}</div><div class="lc-cardno num">${member.cardNo}</div>` : ''}
    </div>`;
}

export const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
