// 💎 الباقات: نفس القائمة بصفحة البيع وبصفحة الاشتراك. الأسعار من السيرفر (/api/site أو /api/billing)، وهاي احتياط بس
export const PLAN_DEFAULTS = {
  basic: { name: 'أساسي', month: 12, year: 120 },
  pro: { name: 'مميز', month: 25, year: 250 },
};

// [الميزة، بالأساسي، بالمميز]: true ✅، false ❌، أو نص
export const FEATURES = [
  ['بطاقة نقاط أو أختام بمحفظة الآيفون والأندرويد', true, true],
  ['انضمام بـ QR وملصقات للطباعة', true, true],
  ['إشعار للزبون مع كل نقاط ومكافأة', true, true],
  ['المنيو الإلكتروني بالصور والأحجام وPDF', true, true],
  ['رسائل جماعية لكل الزبائن', '4 بالشهر', 'بلا حد'],
  ['الفروع والموظفين', 'فرع واحد · موظفين 2', 'بلا حد'],
  ['التقارير', 'الأساسية', 'كاملة + Excel'],
  ['العروض التلقائية: عيد الميلاد، «اشتقنالك»، النقاط الدبل، المستويات، ادعُ صاحبك', false, true],
  ['الكوبونات الموجّهة', false, true],
  ['الرصيد المدفوع مسبقاً والهدايا بين الأصحاب', false, true],
  ['التقييم وتحويل الراضيين لتقييم Google', false, true],
  ['صلاحية النقاط مع تذكير قبلها', false, true],
  ['حماية من تلاعب الكاشير وملخص يومي', false, true],
  ['استيراد زبائنك القدام من Excel', false, true],
  ['الإضافات الجاية: إشعارات مجدولة ولوحة صحة المحل', false, 'قريباً'],
];

// قائمة الميزات لباقة وحدة (HTML بسيط: النصوص ثابتة من هون، مش من المستخدم)
export function featuresHTML(tier) {
  const i = tier === 'basic' ? 1 : 2;
  return `<ul class="feats">${FEATURES.map((f) => {
    const v = f[i];
    const cls = v === false ? 'no' : 'yes';
    return `<li class="${cls}"><i aria-hidden="true">${v === false ? '✕' : '✓'}</i><span>${f[0]}${typeof v === 'string' ? ` <b>${v}</b>` : ''}${v === false ? '<span class="sr-only"> (مش موجودة)</span>' : ''}</span></li>`;
  }).join('')}</ul>`;
}

// جملة وحدة عن كل باقة (لبطاقات الاختيار)
export const PLAN_BLURB = {
  basic: 'البطاقة بالمحفظة، والمنيو، وإشعارات النقاط. فرع واحد.',
  pro: 'كل الأساسي + العروض التلقائية، والكوبونات، والرصيد، والتقارير الكاملة. بلا حدود.',
};

// جدول مقارنة بين الباقتين
export function compareHTML() {
  const cell = (v) => (v === true ? '<span class="yes" aria-label="موجودة">✓</span>' : v === false ? '<span class="no" aria-label="مش موجودة">✕</span>' : `<b>${v}</b>`);
  return `<table class="compare"><thead><tr><th>الميزة</th><th>⭐ أساسي</th><th>💎 مميز</th></tr></thead><tbody>${FEATURES.map((f) => `<tr><td>${f[0]}</td><td>${cell(f[1])}</td><td>${cell(f[2])}</td></tr>`).join('')}</tbody></table>`;
}
