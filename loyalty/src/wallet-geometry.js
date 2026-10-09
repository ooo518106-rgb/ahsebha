// Build-time vector masks; regenerate with node scripts/build-wallet-masks.mjs.
import { ICONS, giftIcon } from './strip-classic.js';
import { CUP_WIDTH, CUP_HEIGHT } from './reward-art.js';
const S=3;
const clamp = v => Math.max(0, Math.min(1, v));
const cover = d => clamp(0.5-d*S);
const geometryCache=new Map();
const remember=(map,key,make)=>make();
export function geometry(f, slots, ready, icon) {
  return remember(geometryCache, `${f.W}|${slots}|${ready ? 1 : 0}|${icon}`, () => {
    const PW = f.W * S, PH = f.H * S;
    const data = new Uint8Array(PW * PH * 5);
    const cx = f.W * 0.265, cy = f.H * 0.5, r = f.H * 0.325;
    const thickness = f.H * 0.038;
    const step = Math.PI * 2 / slots, gap = Math.min(0.23, step * 0.35);
    const halfArc = (step - gap) / 2;
    const artH = f.H * 0.78, artW = artH * CUP_WIDTH / CUP_HEIGHT;
    const artX = f.W * 0.745 - artW / 2, artY = f.H * 0.55 - artH / 2;
    const capSin = Math.sin(halfArc), capCos = Math.cos(halfArc);
    for (let y = 0; y < PH; y++) {
      const Y = (y + 0.5) / S;
      for (let x = 0; x < PW; x++) {
        const X = (x + 0.5) / S, o = (y * PW + x) * 5;
        const dx = X - cx, dy = Y - cy, radial = Math.hypot(dx, dy);
        // Progress starts at twelve o'clock and advances clockwise, with separate rounded segments.
        const angle = (Math.atan2(dy, dx) + Math.PI * 2.5) % (Math.PI * 2);
        const n = Math.min(slots - 1, Math.floor(angle / step));
        const a = angle - (n + 0.5) * step;
        const d = Math.abs(a) <= halfArc ? Math.abs(radial - r) : Math.hypot(radial * Math.cos(a) - r * capCos, Math.abs(radial * Math.sin(a)) - r * capSin);
        data[o] = n;
        data[o + 1] = Math.round(255 * cover(d - thickness / 2));
        // Quiet inner hairline and a carved sparkle; a gift replaces it when a reward is available.
        const starD = Math.min((Math.abs(dx) / (f.H * 0.1) + Math.abs(dy) / (f.H * 0.022) - 1), (Math.abs(dx) / (f.H * 0.022) + Math.abs(dy) / (f.H * 0.1) - 1)) * f.H * 0.021;
        const centre = ready ? giftIcon(dx, dy, f.H * 0.32) : cover(starD);
        data[o + 2] = Math.round(255 * Math.max(centre, cover(Math.abs(radial - r * 0.77) - 0.18) * 0.13));
        // Two soft steam ribbons link the photograph to the composition, without text baked into the art.
        const t = Y / f.H;
        const edge = clamp(Math.min(Y, f.H - Y) / 13);
        const steamX = f.W * 0.73 + Math.sin(t * 6.7) * f.H * 0.1;
        const steam = Math.exp(-(((X - steamX) / (f.H * 0.033)) ** 2)) * clamp((0.44 - t) * 3);
        const swooshY = f.H * (0.51 + 0.075 * Math.sin((X / f.W) * 5.2));
        const swoosh = Math.exp(-(((Y - swooshY) / (f.H * 0.095)) ** 2)) * clamp((X / f.W - 0.4) * 3);
        data[o + 3] = Math.round(255 * edge * Math.max(steam * 0.13, swoosh * 0.025));
        if (icon !== 'cup') data[o + 4] = Math.round(255 * ICONS[icon](X - f.W * 0.745, Y - f.H * 0.51, f.H * 1.32));
      }
    }
    return { data, artW, artH, artX, artY };
  }, 4);
}
