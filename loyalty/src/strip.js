// Wallet artwork v4: geometric membership, Readex Pro and exact reward percentage.
// Old versions stay available because saved Google passes contain immutable image URLs.
import { progress } from '../public/js/rules.js';
import { renderModern } from './strip-modern.js';
import { renderKey as haloRender } from './strip-halo.js';
import { ICONS, iconFor, stripState, renderKey as classicRender } from './strip-classic.js';
export { iconFor, stripState };
export const STRIP_VERSION = 4;
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


export function stripKey(shop, balance, kind = 's') {
  const st = stripState(shop, balance);
  const p = progress(shop, balance);
  const percent = st.ready ? 100 : Math.min(99, Math.floor(p.toward / p.cost * 100));
  return `${kind}${STRIP_VERSION}|${normColor(shop.color)}|${iconFor(shop)}|${st.slots}|${st.filled}|${st.ready ? 1 : 0}|${percent}`;
}
export function parseKey(key) {
  const m = /^([sg])([234])\|(#[0-9a-f]{6})\|([a-z]+)\|(\d{1,2})\|(\d{1,2})\|([01])(?:\|(\d{1,3}))?$/.exec(String(key));
  if (!m || !ICONS[m[4]]) return null;
  const slots = Number(m[5]), filled = Number(m[6]), ready = m[7] === '1';
  if (slots < 1 || slots > 12 || filled > slots) return null;
  if (m[2] !== '2' && (ready ? filled !== slots : filled >= slots)) return null;
  const percent = m[8] == null ? null : Number(m[8]);
  if (m[2] === '4' ? (percent == null || percent > 100 || (ready ? percent !== 100 : percent >= 100)) : percent != null) return null;
  return { percent, version: Number(m[2]), f: FORMATS[m[1]], color: m[3], icon: m[4], st: { slots, filled, ready } };
}
export function renderKey(key) {
  const k = parseKey(key);
  if (!k) return null;
  return remember(pngCache, key, () => k.version === 2 ? classicRender(key) : k.version === 3 ? haloRender(key) : renderModern(k), 24);
}
export const stripPng = (shop, balance, kind = 's') => renderKey(stripKey(shop, balance, kind));
export const heroPath = (shop, balance) => `/img/hero/${stripKey(shop, balance, 'g').replace('#', '').replace(/\|/g, '-')}.png`;
export function heroKey(name) {
  const p = String(name).split('-');
  return (p.length === 6 || (p.length === 7 && /^[sg]4$/.test(p[0]))) ? `${p[0]}|#${p[1]}|${p.slice(2).join('|')}` : null;
}
export const peekStrip = (key) => pngCache.get(key) || null;
export const stripFiles = (png) => ({ 'strip.png': png, 'strip@2x.png': png, 'strip@3x.png': png });
