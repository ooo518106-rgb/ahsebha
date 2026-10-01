import { test } from 'node:test';
import assert from 'node:assert/strict';
import { earnFor, parseLatLng, progress, rewardRule, stampsLine } from '../public/js/rules.js';
import { normPhone } from '../src/util.js';
import { defaultLogoPng } from '../src/png.js';

const points = { program_type: 'points', points_per_unit: 1, reward_threshold: 100, stamps_required: 9, reward_name: 'مشروب مجاني', currency: 'JOD' };
const stamps = { ...points, program_type: 'stamps' };

test('النقاط: المبلغ × النقاط لكل وحدة، لتحت', () => {
  assert.deepEqual(earnFor(points, { amount: 12.75 }), { delta: 12, amount: 12.75 });
  assert.equal(earnFor({ ...points, points_per_unit: 10 }, { amount: 2.5 }).delta, 25);
  assert.equal(earnFor({ ...points, points_per_unit: 0.1 }, { amount: 30 }).delta, 3); // بدون خطأ الفاصلة العشرية
  assert.ok(earnFor(points, { amount: 0.5 }).error);
  assert.ok(earnFor(points, { amount: -5 }).error);
  assert.ok(earnFor(points, { amount: 'abc' }).error);
  assert.ok(earnFor(points, { amount: 1e9 }).error);
});

test('الأختام: ختم واحد افتراضياً، وعدد صحيح بحدود', () => {
  assert.equal(earnFor(stamps, {}).delta, 1);
  assert.equal(earnFor(stamps, { count: 3 }).delta, 3);
  assert.ok(earnFor(stamps, { count: 0 }).error);
  assert.ok(earnFor(stamps, { count: 1.5 }).error);
  assert.ok(earnFor(stamps, { count: 51 }).error);
});

test('التقدّم نحو المكافأة', () => {
  assert.deepEqual(progress(points, 0), { cost: 100, available: 0, toward: 0, remaining: 100, pct: 0 });
  assert.deepEqual(progress(points, 250), { cost: 100, available: 2, toward: 50, remaining: 50, pct: 50 });
  assert.equal(progress(stamps, 9).available, 1);
  assert.equal(stampsLine(stamps, 4), '●●●●○○○○○');
  assert.equal(stampsLine(stamps, 9), '●●●●●●●●●');
  assert.equal(stampsLine(stamps, 11), '●●○○○○○○○');
});

test('نص القاعدة', () => {
  assert.equal(rewardRule(points), 'كل 1 JOD = نقطة · 100 نقطة = مشروب مجاني');
  assert.equal(rewardRule(stamps), 'اجمع 9 أختام واحصل على مشروب مجاني');
});

test('الإحداثيات من روابط خرائط Google والنص', () => {
  assert.deepEqual(parseLatLng('https://www.google.com/maps/place/Mocha/@31.9539,35.9106,17z/data=!3m1'), { lat: 31.9539, lng: 35.9106 });
  assert.deepEqual(parseLatLng('https://www.google.com/maps/place/x/data=!4m6!3m5!1s0x0:0x0!8m2!3d31.95401!4d35.91012'), { lat: 31.95401, lng: 35.91012 });
  assert.deepEqual(parseLatLng('https://maps.google.com/?q=24.7136,46.6753'), { lat: 24.7136, lng: 46.6753 });
  assert.deepEqual(parseLatLng(' 31.95, 35.91 '), { lat: 31.95, lng: 35.91 });
  assert.equal(parseLatLng('https://maps.app.goo.gl/abc'), null);
  assert.equal(parseLatLng('100, 200'), null);
});

test('توحيد رقم الجوال', () => {
  assert.equal(normPhone('+962 79 123 4567'), '962791234567');
  assert.equal(normPhone('00962791234567'), '962791234567');
  assert.equal(normPhone('٠٧٩١٢٣٤٥٦٧'), '0791234567');
});

test('الشعار الافتراضي PNG صالح', async () => {
  const png = await defaultLogoPng('#6b3e26', 64);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const { inflateSync } = await import('node:zlib');
  // IDAT بيبدأ بعد التوقيع (8) + IHDR (25)، وبعدين الطول والنوع
  const len = new DataView(png.buffer).getUint32(33);
  const raw = inflateSync(png.subarray(41, 41 + len));
  assert.equal(raw.length, 64 * (64 * 3 + 1));
  // الزاوية بيضاء والنص بلون المحل
  assert.deepEqual([...raw.subarray(1, 4)], [255, 255, 255]);
  const mid = 32 * (64 * 3 + 1) + 1 + 32 * 3;
  assert.deepEqual([...raw.subarray(mid, mid + 3)], [0x6b, 0x3e, 0x26]);
});
