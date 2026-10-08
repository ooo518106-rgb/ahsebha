// 🎨 صورة الشريط على وجه بطاقة الآيفون (strip.png، 375×144 نقطة) وصورة بطاقة Google (hero، 1032×336): عملات بأيقونة شغل المحل (☕ 🧁 ✂️ 🍴 🛍 ⭐)
// على زخرفة نجمة ثمانية خفيفة بلون المحل. المليانة عملات بارزة، الفاضية محفورة، الجاية إطارها متقطّع،
// وآخر وحدة هدية بتصير عملة ذهبية بتلمع لما المكافأة تجهز. من اليمين لليسار.
// الرسم تقيل، فمنقسّمه: الخلفية مرة لكل لون، وكل عملة مرة لكل لون وأيقونة، وكل حالة بتتجمّع منهم وبتنحفظ.
import { encodePng, hexToRgb } from './png.js';
import { progress } from '../public/js/rules.js';

export const STRIP_VERSION = 2; // غيّره لما يتغيّر الرسم (بيبطّل الكاش)
const S = 3; // صورة حادة 3x، والآيفونات الـ 2x بتصغّرها
// s: شريط Apple (البطاقة اللي عليها QR مربّع)، g: صورة Google Wallet (hero) بالنسبة اللي بتطلبها 1032×336
const FORMATS = { s: { W: 375, H: 144 }, g: { W: 344, H: 112 } };

const c01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const cov = (d) => c01(0.5 - d); // تغطية البكسل من المسافة للحافة (حواف ناعمة)
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const ring = (x, y, r, t) => Math.abs(Math.hypot(x, y) - r) - t / 2;
function box(x, y, hx, hy, r = 0) {
  const qx = Math.abs(x) - hx + r;
  const qy = Math.abs(y) - hy + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function seg(x, y, ax, ay, bx, by, t) {
  const px = x - ax; const py = y - ay; const vx = bx - ax; const vy = by - ay;
  const h = c01((px * vx + py * vy) / (vx * vx + vy * vy));
  return Math.hypot(px - vx * h, py - vy * h) - t / 2;
}
function star5(x, y, r, rf) {
  const k1x = 0.809016994375; const k1y = -0.587785252292;
  let px = Math.abs(x); let py = -y;
  let d = Math.max(k1x * px + k1y * py, 0); px -= 2 * d * k1x; py -= 2 * d * k1y;
  d = Math.max(-k1x * px + k1y * py, 0); px += 2 * d * k1x; py -= 2 * d * k1y;
  px = Math.abs(px); py -= r;
  const bax = rf * -k1y; const bay = rf * k1x - 1;
  const h = Math.min(Math.max((px * bax + py * bay) / (bax * bax + bay * bay), 0), r);
  return Math.hypot(px - bax * h, py - bay * h) * Math.sign(py * bax - px * bay);
}
const rhomb = (x, y, a, b) => ((Math.abs(x) / a + Math.abs(y) / b - 1) * (a * b)) / Math.hypot(a, b);
const sparkle = (x, y, s) => Math.min(rhomb(x, y, s, s * 0.26), rhomb(x, y, s * 0.26, s)); // ✦

// ─── الأيقونات: x,y من نص العملة (y لتحت)، u = قطرها، والنتيجة تغطية 0..1 ───
function wave(x, y, u, x0) { // بخار متموّج
  const t = (y + 0.155 * u) / (-0.16 * u);
  const k = 2 * Math.PI * 1.1; const a = 0.028 * u; const hw = 0.021 * u;
  const f = x0 + a * Math.sin(k * t); const df = ((a * k) / (0.16 * u)) * Math.cos(k * t);
  const dx = Math.abs(x - f) / Math.sqrt(1 + df * df) - hw;
  const ends = Math.max(-t, t - 1) * 0.16 * u;
  return ends > 0 ? Math.hypot(Math.max(dx + hw, 0), ends) - hw : dx;
}
const ICONS = {
  cup(x, y, u) {
    const cx = -0.04 * u; const cy = 0.05 * u;
    const body = Math.min(box(x - cx, y - cy, 0.19 * u, 0.14 * u, 0.08 * u), box(x - cx, y - (cy - 0.07 * u), 0.19 * u, 0.07 * u));
    const handle = Math.max(ring(x - (cx + 0.19 * u), y - (cy - 0.01 * u), 0.075 * u, 0.045 * u), -(x - (cx + 0.19 * u)));
    const saucer = box(x, y - 0.235 * u, 0.29 * u, 0.026 * u, 0.026 * u);
    return cov(Math.min(body, handle, saucer, wave(x, y, u, -0.11 * u), wave(x, y, u, 0)));
  },
  cupcake(x, y, u) {
    const yy = y - 0.02 * u;
    const wrap = Math.max(-yy, yy - 0.25 * u, Math.abs(x) - (0.19 * u - yy * 0.25));
    const pleats = Math.min(Math.abs(x) - 0.012 * u, Math.abs(Math.abs(x) - 0.09 * u) - 0.012 * u);
    const frost = Math.min(Math.hypot(x + 0.12 * u, y + 0.02 * u) - 0.1 * u, Math.hypot(x - 0.12 * u, y + 0.02 * u) - 0.1 * u, Math.hypot(x, y + 0.09 * u) - 0.13 * u);
    return Math.max(cov(Math.max(wrap, -pleats)), y < 0.005 * u ? cov(frost) : 0, cov(Math.hypot(x, y + 0.25 * u) - 0.055 * u));
  },
  scissors(x, y, u) {
    return cov(Math.min(
      ring(x + 0.11 * u, y - 0.19 * u, 0.075 * u, 0.04 * u), ring(x - 0.11 * u, y - 0.19 * u, 0.075 * u, 0.04 * u),
      seg(x, y, -0.06 * u, 0.13 * u, 0.13 * u, -0.29 * u, 0.055 * u), seg(x, y, 0.06 * u, 0.13 * u, -0.13 * u, -0.29 * u, 0.055 * u),
    ));
  },
  dish(x, y, u) { // شوكة وسكين
    const fork = Math.min(seg(x, y, -0.11 * u, 0.29 * u, -0.11 * u, -0.02 * u, 0.055 * u), box(x + 0.11 * u, y + 0.03 * u, 0.075 * u, 0.035 * u, 0.02 * u),
      seg(x, y, -0.17 * u, -0.03 * u, -0.17 * u, -0.27 * u, 0.03 * u), seg(x, y, -0.11 * u, -0.03 * u, -0.11 * u, -0.27 * u, 0.03 * u), seg(x, y, -0.05 * u, -0.03 * u, -0.05 * u, -0.27 * u, 0.03 * u));
    const knife = Math.min(box(x - 0.11 * u, y + 0.1 * u, 0.05 * u, 0.17 * u, 0.05 * u), seg(x, y, 0.11 * u, 0.06 * u, 0.11 * u, 0.29 * u, 0.055 * u));
    return cov(Math.min(fork, knife));
  },
  bag(x, y, u) {
    return cov(Math.min(box(x, y - 0.07 * u, 0.21 * u, 0.19 * u, 0.04 * u), Math.max(ring(x, y + 0.12 * u, 0.09 * u, 0.04 * u), y + 0.12 * u)));
  },
  star(x, y, u) { return cov(star5(x, y + 0.01 * u, 0.3 * u, 0.48) - 0.012 * u); },
};
function giftIcon(x, y, u) {
  let g = Math.max(cov(box(x, y + 0.07 * u, 0.25 * u, 0.065 * u, 0.025 * u)), cov(box(x, y - 0.14 * u, 0.2 * u, 0.115 * u, 0.025 * u)));
  g *= 1 - cov(box(x, y - 0.06 * u, 0.03 * u, 0.25 * u));
  return Math.max(g, cov(ring(x + 0.075 * u, y + 0.18 * u, 0.055 * u, 0.035 * u)), cov(ring(x - 0.075 * u, y + 0.18 * u, 0.055 * u, 0.035 * u)));
}

// أيقونة العملة من اسم المكافأة واسم المحل
export function iconFor(shop) {
  const t = `${shop.reward_name || ''} ${shop.name || ''}`;
  if (/قهو|مشروب|كوفي|كافي|كاب|لاتيه|شاي|عصير|اسبريسو|coffee|cafe|café|drink|latte|tea|juice/i.test(t)) return 'cup';
  if (/كيك|حلو|حلا|كناف|دونات|مخبز|معجنات|كرواسون|cake|sweet|bake|dessert|donut/i.test(t)) return 'cupcake';
  if (/قص|حلاق|شعر|صالون|سبا|تجميل|salon|barber|hair|spa|beauty/i.test(t)) return 'scissors';
  if (/وجب|مطعم|بيتزا|برجر|برغر|سندويش|شاورما|فلافل|مشاوي|restaurant|pizza|burger|meal|grill/i.test(t)) return 'dish';
  if (/ملابس|متجر|تسوق|بوتيك|store|boutique|fashion/i.test(t)) return 'bag';
  return 'star';
}

// كم عملة، وكم وحدة مليانة، والمكافأة جاهزة؟
export function stripState(shop, balance) {
  const p = progress(shop, balance);
  const slots = p.cost <= 12 ? p.cost : 10; // أختام أو نقاط قليلة: عملة لكل وحدة؛ غير هيك 10 عملات = نسبة
  const ready = p.available > 0;
  const filled = ready ? slots : Math.min(slots - 1, Math.floor((p.toward / p.cost) * slots));
  return { slots, filled, ready };
}

// صفين (أو صف إذا 6 أو أقل)، من اليمين لليسار
function layout(n, { W, H }) {
  const d = n <= 6 ? 44 : n <= 10 ? 40 : 34;
  const gap = n <= 6 ? 14 : n <= 10 ? 17 : 13;
  const rows = n <= 6 ? [n] : [Math.ceil(n / 2), Math.floor(n / 2)];
  const ys = rows.length === 1 ? [H / 2] : [H / 2 - (d / 2 + 6), H / 2 + (d / 2 + 6)];
  const spots = [];
  rows.forEach((m, r) => {
    const right = W / 2 + (m * d + (m - 1) * gap) / 2 - d / 2;
    for (let i = 0; i < m; i++) spots.push({ x: right - i * (d + gap), y: ys[r] });
  });
  return { d, spots };
}

function theme(color) {
  const bg = hexToRgb(color);
  const light = (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]) / 255 > 0.7;
  const fg = light ? [44, 33, 24] : [255, 250, 240];
  return {
    bg, light, fg,
    // اللون الفاتح: عملات غامقة وأيقونتها بلون المحل؛ الغامق: عملات كريمي
    coinTop: light ? [74, 60, 48] : [255, 253, 247],
    coinBot: light ? [40, 31, 24] : [236, 226, 206],
  };
}
const GOLD_T = [255, 228, 150];
const GOLD_M = [242, 186, 72];
const GOLD_B = [196, 128, 34];
const INK = [96, 58, 12];
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

const cache = new Map();
const remember = (k, make) => {
  if (!cache.has(k)) {
    if (cache.size > 400) cache.clear();
    cache.set(k, make());
  }
  return cache.get(k);
};

// زخرفة النجمة الثمانية: بلاطة 30 نقطة بتتكرر (نفسها لكل الألوان)
const TILE = 30 * S;
function patternTile() {
  return remember('tile', () => {
    const t = new Float32Array(TILE * TILE);
    const P = 30;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const X = (x + 0.5) / S; const Y = (y + 0.5) / S;
        const gx = (X % P) - P / 2; const gy = (Y % P) - P / 2;
        const a = P * 0.3;
        const starLine = Math.abs(Math.min(Math.max(Math.abs(gx), Math.abs(gy)) - a, (Math.abs(gx) + Math.abs(gy)) / Math.SQRT2 - a));
        const bx = ((X + P / 2) % P) - P / 2; const by = ((Y + P / 2) % P) - P / 2;
        const dia = Math.abs(Math.abs(bx) + Math.abs(by) - P * 0.2);
        t[y * TILE + x] = cov((Math.min(starLine, dia) - 0.35) * S);
      }
    }
    return t;
  });
}

// الخلفية: لون المحل + ضو ناعم بالنص + الزخرفة، وكلهم بيختفوا عند الحواف (ما في خط فاصل مع البطاقة)
function background(color, { W, H }) {
  return remember(`bg|${color}|${W}x${H}`, () => {
    const PW = W * S; const PH = H * S;
    const { bg, light } = theme(color);
    const tile = patternTile();
    const stride = PW * 3 + 1;
    const raw = new Uint8Array(stride * PH);
    const line = light ? BLACK : WHITE;
    const la = light ? 0.05 : 0.07;
    const gx = new Float32Array(PW);
    for (let x = 0; x < PW; x++) { const dx = ((x + 0.5) / S - W / 2) / (W / 2); gx[x] = 0.8 * dx * dx; }
    for (let y = 0; y < PH; y++) {
      const Y = (y + 0.5) / S;
      const dy = (Y - H / 2) / (H / 2);
      const fade = c01(Math.min(Y, H - Y) / 26) * la;
      const trow = (y % TILE) * TILE;
      const o = y * stride;
      for (let x = 0; x < PW; x++) {
        const e = c01(1 - (gx[x] + dy * dy));
        const g = 0.1 * e * e;
        const l = tile[trow + (x % TILE)] * fade;
        const i = o + 1 + x * 3;
        for (let j = 0; j < 3; j++) {
          const base = bg[j] + (255 - bg[j]) * g;
          raw[i + j] = Math.round(base + (line[j] - base) * l);
        }
      }
    }
    return raw;
  });
}

// العملة: طبقات فوق بعض على شفاف (لون + شفافية)، بتنرسم مرة لكل لون وأيقونة ونوع
function sprite(color, icon, kind, d) {
  return remember(`sp|${color}|${icon}|${kind}|${d}`, () => {
    const { bg, light, fg, coinTop, coinBot } = theme(color);
    const ICON = ICONS[icon] || ICONS.star;
    const r = (d / 2) * S; const u = d * S;
    const half = Math.ceil(kind === 'giftReady' ? 1.1 * u : r + 12 * S);
    const size = half * 2;
    const px = new Float32Array(size * size * 4);
    let i = 0;
    const put = (col, a) => {
      if (a <= 0) return;
      const o = i * 4; const da = px[o + 3]; const k = a + da * (1 - a);
      for (let j = 0; j < 3; j++) px[o + j] = (col[j] * a + px[o + j] * da * (1 - a)) / k;
      px[o + 3] = k;
    };
    const sparks = kind === 'giftReady' ? [[-0.78, -0.58, 0.2], [0.72, -0.62, 0.13], [0.82, 0.5, 0.1], [-0.66, 0.66, 0.08]] : [];
    for (let yy = 0; yy < size; yy++) {
      for (let xx = 0; xx < size; xx++) {
        i = yy * size + xx;
        const x = xx + 0.5 - half; const y = yy + 0.5 - half;
        const dist = Math.hypot(x, y);
        for (const [ox, oy, sz] of sparks) put([255, 246, 210], cov(sparkle(x - ox * u, y - oy * u, sz * u)));
        if (dist > r + 12 * S) continue;
        if (kind === 'filled' || kind === 'giftReady') {
          const gold = kind === 'giftReady';
          if (gold && dist > r - 1) put(GOLD_T, 0.5 * Math.pow(c01(1 - (dist - r) / (11 * S)), 2.2)); // توهّج
          put(BLACK, (light ? 0.2 : 0.32) * Math.pow(c01((r + 3 * S - Math.hypot(x, y - 2 * S)) / (5 * S)), 1.5)); // ظل ناعم
          const t = c01((y / r + 1) / 2);
          const face = gold ? (t < 0.5 ? mix(GOLD_T, GOLD_M, t * 2) : mix(GOLD_M, GOLD_B, (t - 0.5) * 2)) : mix(coinTop, coinBot, t);
          const disc = cov(dist - r);
          put(face, disc);
          put(y < 0 ? WHITE : gold ? GOLD_B : coinBot, cov(Math.abs(dist - (r - 1.2 * S)) - 0.6 * S) * (light && !gold ? 0.3 : 0.55)); // حافة بارزة
          put(gold ? GOLD_B : bg, cov(Math.abs(dist - r * 0.8) - 0.45 * S) * (gold ? 0.55 : 0.3));
          put(WHITE, (light && !gold ? 0.15 : 0.35) * c01(1 - Math.hypot(x + 0.3 * r, y + 0.42 * r) / (0.45 * r)) * disc); // لمعة
          put(gold ? INK : bg, gold ? giftIcon(x, y, u * 1.02) : ICON(x, y, u));
        } else {
          const disc = cov(dist - r);
          put(BLACK, disc * (light ? 0.08 : 0.2)); // محفورة
          put(BLACK, disc * 0.18 * c01(1 - (y + r) / (0.5 * r)));
          put(light ? WHITE : fg, cov(Math.abs(dist - (r - 0.5 * S)) - 0.5 * S) * (y > 0 ? 0.28 : 0.06));
          if (kind === 'next') {
            const per = (2 * Math.PI) / 14;
            const ph = (((Math.atan2(y, x) + Math.PI / 2) % per) + per) % per;
            put(fg, cov(Math.abs(dist - (r + 2.5 * S)) - 0.9 * S) * cov((Math.abs(ph - per * 0.3) - per * 0.3) * (r + 2.5 * S)) * 0.85);
          }
          if (kind === 'gift') {
            put(fg, giftIcon(x, y, u) * 0.6);
            put(GOLD_T, cov(Math.abs(dist - (r - 0.5 * S)) - 0.7 * S) * 0.55);
          } else put(fg, ICON(x, y, u) * (kind === 'next' ? 0.4 : 0.2));
        }
      }
    }
    return { half, size, px };
  });
}

async function render(color, icon, st, f) {
  const PW = f.W * S; const PH = f.H * S;
  const stride = PW * 3 + 1;
  const raw = background(color, f).slice();
  const { d, spots } = layout(st.slots, f);
  spots.forEach((p, n) => {
    const kind = n === st.slots - 1 ? (st.ready ? 'giftReady' : 'gift') : n < st.filled ? 'filled' : n === st.filled ? 'next' : 'empty';
    const sp = sprite(color, icon, kind, d);
    const x0 = Math.round(p.x * S) - sp.half;
    const y0 = Math.round(p.y * S) - sp.half;
    for (let yy = 0; yy < sp.size; yy++) {
      const y = y0 + yy;
      if (y < 0 || y >= PH) continue;
      for (let xx = 0; xx < sp.size; xx++) {
        const x = x0 + xx;
        const o = (yy * sp.size + xx) * 4;
        const a = sp.px[o + 3];
        if (a <= 0 || x < 0 || x >= PW) continue;
        const t = y * stride + 1 + x * 3;
        for (let j = 0; j < 3; j++) raw[t + j] = Math.round(raw[t + j] + (sp.px[o + j] - raw[t + j]) * a);
      }
    }
  });
  return encodePng(PW, PH, raw);
}

const normColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : '#6b3e26');

// مفتاح الصورة (للحفظ بقاعدة البيانات): نفس المفتاح = نفس الصورة بالزبط. kind: s (Apple) أو g (Google)
export function stripKey(shop, balance, kind = 's') {
  const st = stripState(shop, balance);
  return `${kind}${STRIP_VERSION}|${normColor(shop.color)}|${iconFor(shop)}|${st.slots}|${st.filled}|${st.ready ? 1 : 0}`;
}

// المفتاح ← شو نرسم (أو null إذا مش صالح أو من رسمة قديمة)
export function parseKey(key) {
  const m = /^([sg])(\d+)\|(#[0-9a-f]{6})\|([a-z]+)\|(\d{1,2})\|(\d{1,2})\|([01])$/.exec(String(key));
  if (!m || Number(m[2]) !== STRIP_VERSION || !ICONS[m[4]]) return null;
  const slots = Number(m[5]); const filled = Number(m[6]);
  if (slots < 1 || slots > 12 || filled > slots) return null;
  return { f: FORMATS[m[1]], color: m[3], icon: m[4], st: { slots, filled, ready: m[7] === '1' } };
}

export function renderKey(key) {
  const k = parseKey(key);
  if (!k) return null;
  return remember(`png|${key}`, () => render(k.color, k.icon, k.st, k.f));
}

export const stripPng = (shop, balance, kind = 's') => renderKey(stripKey(shop, balance, kind));

// رابط صورة Google (عام، وما فيه إشي عن الزبون: بس اللون والأيقونة والتقدّم)، وبيرجع للمفتاح
export const heroPath = (shop, balance) => `/img/hero/${stripKey(shop, balance, 'g').replace('#', '').replace(/\|/g, '-')}.png`;
export function heroKey(name) {
  const p = String(name).split('-');
  return p.length === 6 ? `${p[0]}|#${p[1]}|${p.slice(2).join('|')}` : null;
}

export const peekStrip = (key) => cache.get(`png|${key}`) || null; // وعد بالصورة إذا انرسمت بهالـ isolate

// نفس الصورة بالأسماء الثلاث (Apple بتعبّي فيها مكان الشريط)
export const stripFiles = (png) => ({ 'strip.png': png, 'strip@2x.png': png, 'strip@3x.png': png });
