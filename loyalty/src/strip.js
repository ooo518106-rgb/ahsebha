// 🎨 صورة الشريط على وجه بطاقة الآيفون (strip.png): دواير التقدّم من اليمين لليسار،
// المليانة عليها ✓، وآخر دايرة هدية 🎁 بتصير ذهبية لما المكافأة تجهز. بلون المحل، وبتتغيّر مع رصيد الزبون.
import { encodePng, hexToRgb } from './png.js';
import { progress } from '../public/js/rules.js';

const W = 375; // نقطة. Apple: الشريط بالبطاقة اللي عليها QR مربّع 375×98
const H = 98;
const GOLD = [244, 192, 78];
const GOLD_INK = [74, 52, 16];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const cov = (d) => clamp01(0.5 - d); // تغطية البكسل من المسافة للحافة (حواف ناعمة)
const circle = (x, y, r) => Math.hypot(x, y) - r;
const ring = (x, y, r, t) => Math.abs(Math.hypot(x, y) - r) - t / 2;
function roundRect(x, y, hx, hy, r) {
  const qx = Math.abs(x) - hx + r;
  const qy = Math.abs(y) - hy + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function segment(x, y, ax, ay, bx, by, t) {
  const px = x - ax; const py = y - ay; const vx = bx - ax; const vy = by - ay;
  const h = clamp01((px * vx + py * vy) / (vx * vx + vy * vy));
  return Math.hypot(px - vx * h, py - vy * h) - t / 2;
}

// كم دايرة، وكم وحدة مليانة، والمكافأة جاهزة؟
export function stripState(shop, balance) {
  const p = progress(shop, balance);
  const slots = p.cost <= 12 ? p.cost : 10; // أختام أو نقاط قليلة: دايرة لكل وحدة؛ غير هيك 10 دواير = نسبة
  const ready = p.available > 0;
  const filled = ready ? slots : Math.min(slots - 1, Math.floor((p.toward / p.cost) * slots));
  return { slots, filled, ready };
}

// ترتيب الدواير: صف إذا 6 أو أقل، وإلا صفين. من اليمين لليسار (عربي)
function layout(slots) {
  const rows = slots <= 6 ? [slots] : [Math.ceil(slots / 2), Math.floor(slots / 2)];
  const d = rows.length === 1 ? 44 : 34;
  const gap = rows.length === 1 ? 12 : 14;
  const ys = rows.length === 1 ? [H / 2] : [H / 2 - 22, H / 2 + 22];
  const out = [];
  rows.forEach((n, r) => {
    const right = W / 2 + (n * d + (n - 1) * gap) / 2 - d / 2;
    for (let i = 0; i < n; i++) out.push({ x: right - i * (d + gap), y: ys[r] });
  });
  return { d, spots: out };
}

// كل بكسل على وحدة من 3 خطوط ألوان: لون المحل↔الأبيض (أو الغامق)، لون المحل↔الذهبي، الذهبي↔البني.
// فبنكتب الصورة بـ 192 لون (PNG بلوحة ألوان): بايت لكل بكسل، أسرع بكتير وأخف
const LEVELS = 64;
const BG_FG = 0;
const BG_GOLD = LEVELS;
const GOLD_INKL = LEVELS * 2;
const idx = (line, level) => line + Math.round(clamp01(level) * (LEVELS - 1));
const over = (a, b) => a + b - a * b; // شفافيتين فوق بعض

function palette(bg, fg) {
  const out = new Uint8Array(LEVELS * 3 * 3);
  const lines = [[bg, fg], [bg, GOLD], [GOLD, GOLD_INK]];
  lines.forEach(([a, b], l) => {
    for (let k = 0; k < LEVELS; k++) {
      const t = k / (LEVELS - 1);
      for (let j = 0; j < 3; j++) out[(l * LEVELS + k) * 3 + j] = Math.round(a[j] + (b[j] - a[j]) * t);
    }
  });
  return out;
}

// رسمة وحدة (دايرة فاضية، الجاية، مليانة، هدية، هدية جاهزة) بتنرسم مرة لكل حجم وبتنحفظ: أرقام ألوان من اللوحة
function sprite(kind, d, s) {
  const size = Math.ceil((d + 12) * s);
  const c = size / 2;
  const r = (d / 2) * s;
  const u = d * s;
  const px = new Uint8Array(size * size); // 0 = لون المحل
  for (let yy = 0; yy < size; yy++) {
    for (let xx = 0; xx < size; xx++) {
      const x = xx + 0.5 - c;
      const y = yy + 0.5 - c;
      if (Math.hypot(x, y) > r + 6 * s) continue;
      let v = 0;
      if (kind === 'empty') {
        v = idx(BG_FG, over(cov(circle(x, y, r)) * 0.08, cov(ring(x, y, r - 1.25 * s, 2.5 * s)) * 0.45));
      } else if (kind === 'next') {
        // الدايرة الجاية: إطار متقطّع أوضح، يعني «الختم الجاي هون»
        const period = (2 * Math.PI) / 10;
        const phase = (((Math.atan2(y, x) + Math.PI / 2) % period) + period) % period;
        const dash = cov((Math.abs(phase - period * 0.3) - period * 0.3) * (r - 1.5 * s));
        v = idx(BG_FG, over(cov(circle(x, y, r)) * 0.14, cov(ring(x, y, r - 1.5 * s, 3 * s)) * dash * 0.95));
      } else if (kind === 'filled') {
        const t = 0.09 * u; // ✓ (الـ y لتحت)
        const tick = cov(Math.min(segment(x, y, -0.22 * u, 0, -0.06 * u, 0.15 * u, t), segment(x, y, -0.06 * u, 0.15 * u, 0.23 * u, -0.15 * u, t)));
        v = idx(BG_FG, cov(circle(x, y, r)) * 0.96 * (1 - tick));
      } else {
        // 🎁 علبة وغطا وشريطة بالنص وفيونكة
        let g = Math.max(cov(roundRect(x, y + 0.07 * u, 0.25 * u, 0.065 * u, 0.025 * u)), cov(roundRect(x, y - 0.14 * u, 0.2 * u, 0.115 * u, 0.025 * u)));
        g *= 1 - cov(roundRect(x, y - 0.06 * u, 0.03 * u, 0.25 * u, 0));
        g = Math.max(g, cov(ring(x + 0.075 * u, y + 0.18 * u, 0.055 * u, 0.035 * u)), cov(ring(x - 0.075 * u, y + 0.18 * u, 0.055 * u, 0.035 * u)));
        if (kind === 'giftReady') {
          const fill = cov(circle(x, y, r));
          v = g > 0 && fill >= 1 ? idx(GOLD_INKL, g) : idx(BG_GOLD, over(cov(ring(x, y, r + 3.5 * s, 3 * s)) * 0.35, fill));
        } else v = idx(BG_FG, over(cov(ring(x, y, r - 1.25 * s, 2.5 * s)) * 0.7, g * 0.75));
      }
      px[yy * size + xx] = v;
    }
  }
  return { size, px };
}

const cache = new Map();
const remember = (k, make) => {
  if (!cache.has(k)) {
    if (cache.size > 300) cache.clear();
    cache.set(k, make());
  }
  return cache.get(k);
};

const SCALE = 3; // صورة وحدة حادة (3x)، والآيفونات الـ 2x بتصغّرها
async function render(color, state) {
  const bg = hexToRgb(color);
  const light = (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]) / 255 > 0.7;
  const fg = light ? [31, 26, 23] : [255, 255, 255];
  const s = SCALE;
  const w = Math.round(W * s);
  const h = Math.round(H * s);
  const stride = w + 1;
  const raw = new Uint8Array(stride * h); // كله صفر = لون المحل، وبايت الفلتر 0
  const { d, spots } = layout(state.slots);
  spots.forEach((p, i) => {
    const last = i === state.slots - 1;
    const kind = last ? (state.ready ? 'giftReady' : 'gift') : i < state.filled ? 'filled' : i === state.filled ? 'next' : 'empty';
    const sp = remember(`${kind}|${d}|${s}`, () => sprite(kind, d, s));
    const x0 = Math.round(p.x * s - sp.size / 2);
    const y0 = Math.round(p.y * s - sp.size / 2);
    for (let yy = 0; yy < sp.size; yy++) {
      const y = y0 + yy;
      if (y >= 0 && y < h) raw.set(sp.px.subarray(yy * sp.size, (yy + 1) * sp.size), y * stride + 1 + x0);
    }
  });
  return encodePng(w, h, raw, palette(bg, fg));
}

// نفس الصورة بالأسماء الثلاث (Apple بتعبّي فيها مكان الشريط بأي حجم)
export async function stripImages(shop, balance) {
  const state = stripState(shop, balance);
  const color = /^#[0-9a-f]{6}$/i.test(shop.color || '') ? shop.color.toLowerCase() : '#6b3e26';
  const png = await remember(`png|${color}|${state.slots}|${state.filled}|${state.ready}`, () => render(color, state));
  return { 'strip.png': png, 'strip@2x.png': png, 'strip@3x.png': png };
}
