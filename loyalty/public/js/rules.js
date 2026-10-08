// قواعد الولاء — حسابات بحتة بدون قاعدة بيانات، بتنستخدم بالسيرفر (src/) وبالواجهة

export const MAX_AMOUNT = 100000;
export const MAX_STAMPS_PER_VISIT = 50;

// كلفة المكافأة الوحدة: عدد النقاط أو عدد الأختام
export function rewardCost(shop) {
  return shop.program_type === 'stamps' ? shop.stamps_required : shop.reward_threshold;
}

export function unitLabel(shop) {
  return shop.program_type === 'stamps' ? 'ختم' : 'نقطة';
}

// الكلمة مع العدد بالعربي: من 3 لـ 10 جمع (6 نقاط، 9 أختام)، وغيرها مفرد (1 نقطة، 15 نقطة، 100 نقطة)
export const countWord = (n, one, many) => (n >= 3 && n <= 10 ? many : one);
export const unitWord = (shop, n) => (shop.program_type === 'stamps' ? countWord(n, 'ختم', 'أختام') : countWord(n, 'نقطة', 'نقاط'));

// كم بياخد الزبون على هالزيارة. النقاط: المبلغ × نقاط لكل وحدة (لتحت). الأختام: عدد القطع.
export function earnFor(shop, { amount, count } = {}) {
  if (shop.program_type === 'stamps') {
    const n = count == null || count === '' ? 1 : Number(count);
    if (!Number.isInteger(n) || n < 1 || n > MAX_STAMPS_PER_VISIT) return { error: `عدد الأختام لازم يكون بين 1 و ${MAX_STAMPS_PER_VISIT}` };
    return { delta: n, amount: null };
  }
  const a = Number(amount);
  if (!Number.isFinite(a) || a <= 0 || a > MAX_AMOUNT) return { error: 'اكتب مبلغ الفاتورة' };
  const delta = Math.floor(a * Number(shop.points_per_unit) + 1e-9);
  if (delta < 1) return { error: 'المبلغ أقل من إنه ياخد نقطة' };
  return { delta, amount: Math.round(a * 1000) / 1000 };
}

// وين وصل الزبون: كم مكافأة جاهزة، وكم باقيله للجاية
export function progress(shop, balance) {
  const cost = rewardCost(shop);
  const available = Math.floor(balance / cost);
  const toward = balance - available * cost;
  return { cost, available, toward, remaining: cost - toward, pct: Math.round((toward / cost) * 100) };
}

export function rewardRule(shop) {
  if (shop.program_type === 'stamps') return `اجمع ${shop.stamps_required} ${unitWord(shop, shop.stamps_required)} واحصل على ${shop.reward_name}`;
  const per = Number(shop.points_per_unit);
  const earn = per === 1 ? `كل 1 ${shop.currency} = نقطة` : `كل 1 ${shop.currency} = ${per} ${unitWord(shop, per)}`;
  return `${earn} · ${shop.reward_threshold} ${unitWord(shop, shop.reward_threshold)} = ${shop.reward_name}`;
}

export function stampsLine(shop, balance) {
  const { cost, toward, available } = progress(shop, balance);
  const filled = available > 0 && toward === 0 ? cost : toward;
  return '●'.repeat(filled) + '○'.repeat(cost - filled);
}

// إحداثيات من رابط خرائط Google أو من نص "31.95, 35.91"
export function parseLatLng(text) {
  let s = String(text || '');
  try { s = decodeURIComponent(s); } catch { /* نص عادي فيه % */ }
  const pats = [/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/, /[?&](?:q|query|ll|destination)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, /^\s*(-?\d+(?:\.\d+)?)\s*[,،\s]\s*(-?\d+(?:\.\d+)?)\s*$/];
  for (const p of pats) {
    const m = s.match(p);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}
