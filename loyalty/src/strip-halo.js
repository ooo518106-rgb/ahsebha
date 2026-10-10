// Wallet artwork: one reward sculpture and a segmented progress halo. The shop owns its palette.
// Version 2 stays available because saved Google passes contain immutable image URLs.
import { encodePng, hexToRgb } from './png.js';
import { walletGeometry } from './wallet-masks.js';
import { cupPixels, CUP_WIDTH, CUP_HEIGHT } from './reward-art.js';
import { ICONS, iconFor, stripState, renderKey as classicRender } from './strip-classic.js';
export { iconFor, stripState };
export const STRIP_VERSION = 3;
const S = 3;
const FORMATS = { s: { W: 375, H: 144 }, g: { W: 344, H: 112 } };
const normColor = (c) => /^#[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : '#6b3e26';
const pngCache = new Map();
// Bound isolate memory regardless of how many shops/colours share a worker.
function remember(map, key, make, limit) {
  if (map.has(key)) return map.get(key);
  if (map.size >= limit) map.delete(map.keys().next().value);
  const value = make();
  map.set(key, value);
  if (value instanceof Promise) value.catch(() => { if (map.get(key) === value) map.delete(key); });
  return value;
}


async function render({ f, color, icon, st }) {
  const PW = f.W * S, PH = f.H * S, stride = PW * 3 + 1;
  const raw = new Uint8Array(stride * PH);
  const bg = hexToRgb(color);
  const light = (0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]) > 178.5;
  const fg = light ? [48, 41, 34] : [255, 247, 232];
  const { ring, centre, decor, art, artW, artH, artX, artY } = await walletGeometry(f, st.slots, st.ready, icon);
  const cup = icon === 'cup' ? await cupPixels() : null;
  for (let y = 0; y < PH; y++) {
    const Y = (y + 0.5) / S;
    const ay = Math.floor((Y - artY) / artH * CUP_HEIGHT);
    for (let x = 0; x < PW; x++) {
      const X = (x + 0.5) / S, o = y * PW + x, dst = y * stride + 1 + x * 3;
      const active = ring[o * 2] < st.filled;
      const ringA = ring[o * 2 + 1] / 255 * (active ? 1 : light ? 0.19 : 0.20);
      const centreA = centre[o] / 255 * (st.ready ? 0.96 : 0.76);
      const iconA = (art ? art[o] / 255 : 0);
      const ax = Math.floor((X - artX) / artW * CUP_WIDTH);
      const ci = (ay * CUP_WIDTH + ax) * 4;
      const cupA = cup && ax >= 0 && ax < CUP_WIDTH && ay >= 0 && ay < CUP_HEIGHT ? cup[ci + 3] / 255 : 0;
      for (let ch = 0; ch < 3; ch++) {
        let v = bg[ch];
        v += (fg[ch] - v) * decor[o] / 255;
        v += (fg[ch] - v) * ringA;
        v += (fg[ch] - v) * centreA;
        // Generic business icons receive the same ivory/dark treatment; never show a coffee cup to a barber.
        v += (fg[ch] - v) * iconA;
        if (cupA) v += (cup[ci + ch] - v) * cupA;
        raw[dst + ch] = Math.round(v);
      }
    }
  }
  return encodePng(PW, PH, raw);
}

export function stripKey(shop, balance, kind = 's') {
  const st = stripState(shop, balance);
  return `${kind}${STRIP_VERSION}|${normColor(shop.color)}|${iconFor(shop)}|${st.slots}|${st.filled}|${st.ready ? 1 : 0}`;
}
export function parseKey(key) {
  const m = /^([sg])([23])\|(#[0-9a-f]{6})\|([a-z]+)\|(\d{1,2})\|(\d{1,2})\|([01])$/.exec(String(key));
  if (!m || !ICONS[m[4]]) return null;
  const slots = Number(m[5]), filled = Number(m[6]), ready = m[7] === '1';
  if (slots < 1 || slots > 12 || filled > slots) return null;
  if (m[2] === '3' && (ready ? filled !== slots : filled >= slots)) return null;
  return { version: Number(m[2]), f: FORMATS[m[1]], color: m[3], icon: m[4], st: { slots, filled, ready } };
}
export function renderKey(key) {
  const k = parseKey(key);
  if (!k) return null;
  return remember(pngCache, key, () => k.version === 2 ? classicRender(key) : render(k), 24);
}
export const stripPng = (shop, balance, kind = 's') => renderKey(stripKey(shop, balance, kind));
export const heroPath = (shop, balance) => `/img/hero/${stripKey(shop, balance, 'g').replace('#', '').replace(/\|/g, '-')}.png`;
export function heroKey(name) {
  const p = String(name).split('-');
  return p.length === 6 ? `${p[0]}|#${p[1]}|${p.slice(2).join('|')}` : null;
}
export const peekStrip = (key) => pngCache.get(key) || null;
export const stripFiles = (png) => ({ 'strip.png': png, 'strip@2x.png': png, 'strip@3x.png': png });
