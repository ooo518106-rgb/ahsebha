// العروض: نقاط دبل بأوقات معيّنة، مستويات الزبائن، عيد الميلاد، وهدية الدعوة — حسابات بحتة بدون قاعدة بيانات
import { rewardCost } from '../public/js/rules.js';

// توقيت كل دولة (أوقات العروض وعيد الميلاد بتمشي على ساعة المحل مش السيرفر)
export const TZ = {
  JO: 'Asia/Amman', PS: 'Asia/Hebron', SA: 'Asia/Riyadh', AE: 'Asia/Dubai', KW: 'Asia/Kuwait', QA: 'Asia/Qatar', BH: 'Asia/Bahrain',
  OM: 'Asia/Muscat', EG: 'Africa/Cairo', IQ: 'Asia/Baghdad', LB: 'Asia/Beirut', SY: 'Asia/Damascus', TR: 'Europe/Istanbul', US: 'America/New_York',
};
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmtCache = new Map();

// الوقت المحلي للمحل: السنة والشهر واليوم والساعة ويوم الأسبوع (0 = الأحد)
export function localTime(country, ms = Date.now()) {
  const tz = TZ[country] || TZ.JO;
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
    fmtCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const hour = Number(p.hour) % 24;
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour, minute: Number(p.minute), weekday: WEEKDAYS[p.weekday], md: `${p.month}-${p.day}`, mins: hour * 60 + Number(p.minute) };
}

// ─── نقاط دبل بأوقات معيّنة ───
// كل قاعدة: { days: [0..6], from: 'HH:MM', to: 'HH:MM', mult: 2 | 3 }
const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMins = (hm) => { const m = HM_RE.exec(hm); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
export const MAX_BOOSTS = 5;

export function parseBoosts(text) {
  try {
    const list = JSON.parse(text || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// بيرجّع القواعد نظيفة، أو رسالة الخطأ
export function validateBoosts(list) {
  if (!Array.isArray(list) || list.length > MAX_BOOSTS) return { error: `لحد ${MAX_BOOSTS} أوقات` };
  const out = [];
  for (const [i, r] of list.entries()) {
    const days = [...new Set((r && Array.isArray(r.days) ? r.days : []).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
    const from = toMins(r && r.from);
    const to = toMins(r && r.to);
    const mult = Number(r && r.mult);
    if (!days.length) return { error: `الوقت ${i + 1}: اختار يوم واحد على الأقل` };
    if (from == null || to == null || to <= from) return { error: `الوقت ${i + 1}: الساعة «لحد» لازم تكون بعد «من»` };
    if (![2, 3].includes(mult)) return { error: `الوقت ${i + 1}: المضاعفة لازم تكون ×2 أو ×3` };
    out.push({ days, from: r.from, to: r.to, mult });
  }
  return { boosts: out };
}

// أعلى مضاعفة شغّالة هلق (1 = ما في)
export function activeBoost(shop, ms = Date.now()) {
  const rules = parseBoosts(shop.boosts);
  if (!rules.length) return 1;
  const t = localTime(shop.country, ms);
  let best = 1;
  for (const r of rules) {
    if (r.days.includes(t.weekday) && t.mins >= toMins(r.from) && t.mins < toMins(r.to)) best = Math.max(best, r.mult);
  }
  return best;
}

// ─── المستويات: حسب عدد الزيارات ───
export const TIERS = {
  bronze: { name: 'برونزي', icon: '🥉', mult: 1 },
  silver: { name: 'فضي', icon: '🥈', mult: 1.25 },
  gold: { name: 'ذهبي', icon: '🥇', mult: 1.5 },
};

export function tierOf(shop, visits) {
  if (!shop.tiers_on) return null;
  const key = visits >= shop.tier_gold ? 'gold' : visits >= shop.tier_silver ? 'silver' : 'bronze';
  const next = key === 'bronze' ? { key: 'silver', at: shop.tier_silver } : key === 'silver' ? { key: 'gold', at: shop.tier_gold } : null;
  return {
    key,
    ...TIERS[key],
    // الأختام ما بتنقسم، فالمستوى بالأختام شارة بس
    mult: shop.program_type === 'stamps' ? 1 : TIERS[key].mult,
    next: next ? { name: TIERS[next.key].name, icon: TIERS[next.key].icon, visitsLeft: next.at - visits } : null,
  };
}

// ─── كم بياخد الزبون على هالزيارة مع العروض ───
// نقاط دبل (بالوقت) ورجعة الزبون الغايب ما بيتجمّعوا: بناخد الأعلى. المستوى بيضرب فوقهم (للنقاط بس).
export function applyPerks(shop, member, baseDelta, ms = Date.now()) {
  const reasons = [];
  const reasonsEn = [];
  const happy = activeBoost(shop, ms);
  const comeback = member.boost_until && member.boost_until > ms ? 2 : 1;
  const timeMult = Math.max(happy, comeback);
  if (timeMult > 1) {
    reasons.push(happy >= comeback ? `⏰ نقاط ×${happy}` : '💤 رجعتك ×2');
    reasonsEn.push(happy >= comeback ? `⏰ points ×${happy}` : '💤 welcome back ×2');
  }
  const tier = tierOf(shop, member.visits);
  const tierMult = tier ? tier.mult : 1;
  if (tierMult > 1) {
    reasons.push(`${tier.icon} ${tier.name} ×${tierMult}`);
    reasonsEn.push(`${tier.icon} ${tier.key === 'gold' ? 'Gold' : 'Silver'} ×${tierMult}`);
  }
  const delta = shop.program_type === 'stamps' ? baseDelta * timeMult : Math.floor(baseDelta * timeMult * tierMult + 1e-9);
  return { delta, base: baseDelta, reasons, reasonsEn };
}

// ─── عيد الميلاد ───
export const BDAY_MIN_AGE_DAYS = 14; // التاريخ لازم يكون محفوظ من أسبوعين على الأقل (عشان ما حدا يكتب تاريخ اليوم وياخد هدية)

export function readBirthday(day, month) {
  const d = Number(day);
  const m = Number(month);
  if (!Number.isInteger(d) || !Number.isInteger(m) || m < 1 || m > 12 || d < 1) return null;
  const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  if (d > days) return null;
  return `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// مواليد 29 شباط بيحتفلوا 28 شباط بالسنين العادية
export function isBirthdayToday(md, t) {
  if (md === t.md) return true;
  const leap = (t.year % 4 === 0 && t.year % 100 !== 0) || t.year % 400 === 0;
  return md === '02-29' && !leap && t.md === '02-28';
}

export const bdayGift = (shop) => shop.bday_gift ?? rewardCost(shop);

// ─── ادعُ صاحبك ───
export const refBonus = (shop) => shop.ref_bonus ?? (shop.program_type === 'stamps' ? 1 : Math.max(1, Math.round(shop.reward_threshold / 10)));
export const REF_MONTHLY_CAP = 10; // أكتر من هيك بالشهر لنفس الزبون ما بتنحسب هدايا

export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
