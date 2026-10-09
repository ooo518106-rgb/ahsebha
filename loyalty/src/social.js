// 📣 وكيل النشر: منشورات نقاطك على إنستغرام وفيسبوك لحالها، منشور باليوم من الدور.
// بيحتاج META_TOKEN (توكن Meta فيه صلاحيات الصفحة وإنستغرام) بإعدادات Cloudflare.
// إنستغرام بياخد الصورة من رابط عام (JPEG)، فالصور بتنخدم من الموقع نفسه.

const HASHTAGS = '#نقاطك #بطاقة_ولاء #كوفي_شوب #مطاعم_الأردن #مشاريع_صغيرة #عمان #الأردن';

// 📚 أول دفعة منشورات جاهزة (بالموقع: /social/…)، بترتيب الأسبوع
export const LIBRARY = [
  {
    src: '/social/w1-1-steps.jpg',
    caption: `كيف بتشتغل نقاطك؟ ⚡ 3 خطوات بس:

1️⃣ الزبون بيمسح ملصق الـ QR عالكاونتر أو الطاولة
2️⃣ بيحفظ البطاقة بجواله (Apple Wallet أو Google Wallet)، بدون أي تطبيق
3️⃣ الكاشير بيضيف النقاط بكاميرا أي جوال، والبطاقة بتتحدّث لحالها وبيوصله إشعار

بتجهز بدقيقة، وأول 14 يوم ببلاش 🎁
الرابط بالبايو 👆

${HASHTAGS}`,
  },
  {
    src: '/social/w1-2-notifs.jpg',
    caption: `رسالة وحدة… وبيرجعلك 📲

مع نقاطك بتوصل لجوال زبونك إشعارات لحالها:
💤 «اشتقنالك» للي غاب عنك
🎂 هدية بعيد ميلاده
⭐ «باقيلك نقطة وحدة عالمكافأة»
🔔 وعروضك بكبسة وحدة

وإنت مشغول بمحلك، البطاقة عم تشتغل عنك.
جرّبها 14 يوم ببلاش، الرابط بالبايو 👆

${HASHTAGS}`,
  },
  {
    src: '/social/w1-3-noapp.jpg',
    caption: `«الزبون ما رح ينزّل تطبيق عشان محلي» 🙄
ولا بده ينزّل 😉

بطاقة نقاطك بتنحفظ بالمحفظة الموجودة أصلاً بجواله:
Apple Wallet عالآيفون، وGoogle Wallet عالأندرويد
جنب بطاقة البنك، ما بتضيع ولا بتنتسى بالبيت.

جرّب 14 يوم ببلاش، الرابط بالبايو 👆

${HASHTAGS}`,
  },
  {
    src: '/social/w1-4-customers.jpg',
    caption: `بتعرف مين زبائنك الدايمين؟ 🤔

مع نقاطك بتشوف:
🥇 مين أكتر زبائنك زيارة
🕐 أكتر ساعات الزحمة عندك
💤 مين غاب عنك، وبتبعتله «اشتقنالك» بكبسة

اعرف زبائنك، ورجّع اللي غاب.
جرّب 14 يوم ببلاش، الرابط بالبايو 👆

${HASHTAGS}`,
  },
  {
    src: '/social/w1-5-price.jpg',
    caption: `بطاقة ولاء لمحلك بسعر قهوتين بالأسبوع ☕☕

الباقة الأساسية من 8.4 دينار بالشهر (عرض أول 20 محل: خصم 30%)
رجعلك زبون واحد زيادة بالأسبوع؟ طلعت حقها 😉

وقبل كل إشي جرّب 14 يوم ببلاش، بدون بطاقة بنك 🎁
الرابط بالبايو 👆

${HASHTAGS}`,
  },
  {
    src: '/social/w1-6-menu.jpg',
    caption: `منيو QR وبطاقة ولاء بمسحة وحدة 📋

🪑 ملصق QR جاهز للطباعة على كل طاولة
📸 المنيو بالصور والأسعار، وبتعدّله لحالك بأي وقت
🎁 وتحته زر بطاقة الولاء، فالزبون بيجمع نقاط من أول زيارة

جاهز بدقيقة ⚡ وأول 14 يوم ببلاش
الرابط بالبايو 👆

${HASHTAGS}`,
  },
];

// إعدادات النشر: شغّال؟ الأيام (0 = الأحد … 6 = السبت)، والساعة بتوقيت الأردن، ووين بينزل
export const DEFAULT_CFG = { on: false, days: [6, 0, 1, 2, 3, 4], hour: 19, ig: true, fb: true };
export function readCfg(v) {
  const c = { ...DEFAULT_CFG, ...(v && typeof v === 'object' ? v : {}) };
  const days = Array.isArray(c.days) ? [...new Set(c.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : DEFAULT_CFG.days;
  const hour = Number.isInteger(Number(c.hour)) && c.hour >= 0 && c.hour <= 23 ? Number(c.hour) : DEFAULT_CFG.hour;
  return { on: !!c.on, days, hour, ig: c.ig !== false, fb: c.fb !== false };
}

// ─── Meta Graph API ───
export const metaConfig = (env) => {
  const token = String(env.META_TOKEN || '').trim();
  if (!token) return null;
  return { token, pageId: String(env.META_PAGE_ID || '').trim() || null, version: String(env.META_GRAPH_VERSION || env.WHATSAPP_GRAPH_VERSION || 'v21.0'), fetch: env.fetch || fetch };
};

async function graph(cfg, path, { method = 'GET', token = cfg.token, body } = {}) {
  const res = await cfg.fetch(`https://graph.facebook.com/${cfg.version}/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const er = data.error || {};
    const e = new Error(er.error_user_msg || er.message || `Meta ${res.status}`);
    e.code = er.code;
    e.status = res.status;
    throw e;
  }
  return data;
}

// الصفحة وحساب إنستغرام المربوط فيها، وتوكن الصفحة (للنشر). إذا في أكتر من صفحة: META_PAGE_ID أو اللي معها إنستغرام.
// التوكن ممكن يكون توكن مستخدم/نظام (فيه صفحات) أو توكن الصفحة نفسها
export async function accounts(cfg) {
  const fields = 'id,name,access_token,instagram_business_account{id,username}';
  let list;
  if (cfg.pageId) list = [await graph(cfg, `${cfg.pageId}?fields=${fields}`)];
  else {
    let err = null;
    list = ((await graph(cfg, `me/accounts?fields=${fields}&limit=50`).catch((e) => { err = e; return {}; })).data) || [];
    if (!list.length) {
      // توكن صفحة: /me هي الصفحة (category موجودة بس للصفحات، فتوكن مستخدم بدون صفحات بيفشل هون)
      const me = await graph(cfg, 'me?fields=id,name,category,instagram_business_account{id,username}').catch(() => null);
      if (me && me.id && me.category) list = [{ ...me, access_token: cfg.token }];
      else if (err) throw err;
    }
  }
  const page = list.find((p) => p.instagram_business_account) || list[0];
  if (!page) throw new Error('التوكن ما إله صلاحية على أي صفحة فيسبوك. ضيف الصفحة للتوكن (Assets) وأعد توليده');
  const ig = page.instagram_business_account || null;
  return { pageId: page.id, pageName: page.name, pageToken: page.access_token || cfg.token, igId: ig ? ig.id : null, igUser: ig ? ig.username : null };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// بينشر الصورة (رابط JPEG عام) بنص على إنستغرام و/أو فيسبوك. بيرجّع { ig, fb, errors }
export async function publish(cfg, acc, { imageUrl, caption, ig = true, fb = true, wait = 2000 }) {
  const out = { ig: null, fb: null, errors: [] };
  if (ig) {
    try {
      if (!acc.igId) throw new Error('ما في حساب إنستغرام مربوط بالصفحة');
      const c = await graph(cfg, `${acc.igId}/media`, { method: 'POST', token: acc.pageToken, body: { image_url: imageUrl, caption } });
      // إنستغرام بيجهّز الصورة: منستنى لحد ما تخلص (عادة ثواني)
      for (let i = 0; i < 5; i++) {
        const st = await graph(cfg, `${c.id}?fields=status_code`, { token: acc.pageToken }).catch(() => ({}));
        if (!st.status_code || st.status_code === 'FINISHED') break;
        if (st.status_code === 'ERROR') throw new Error('إنستغرام ما قبل الصورة (لازم JPEG ونسبتها بين 4:5 و 1.91:1)');
        await sleep(wait);
      }
      out.ig = (await graph(cfg, `${acc.igId}/media_publish`, { method: 'POST', token: acc.pageToken, body: { creation_id: c.id } })).id;
    } catch (e) { out.errors.push(`إنستغرام: ${e.message}`); }
  }
  if (fb) {
    try {
      const r = await graph(cfg, `${acc.pageId}/photos`, { method: 'POST', token: acc.pageToken, body: { url: imageUrl, caption } });
      out.fb = r.post_id || r.id;
    } catch (e) { out.errors.push(`فيسبوك: ${e.message}`); }
  }
  return out;
}

// ✍️ تعليمات الوكيل لما يكتب نص منشور (إذا ما في نص جاهز)
export function captionSystem({ promoLeft, trialDays }) {
  return [
    'إنت مسؤول السوشال ميديا لمنصة «نقاطك» (nuqatak.com) بالأردن: بطاقة ولاء رقمية للمحلات (كوفي شوب، مطاعم، مخابز، صالونات) بتنحفظ بمحفظة جوال الزبون (Apple Wallet وGoogle Wallet) بدون تطبيق.',
    'المعلومات اللي بتعتمد عليها بس: الزبون بيمسح QR وبياخد البطاقة بثواني. الكاشير بيضيف نقاط أو أختام بكاميرا أي جوال. البطاقة بتتحدّث لحالها وبيوصل للزبون إشعار. عروض لكل الزبائن، هدية عيد ميلاد، «اشتقنالك» للي غاب، منيو QR، تقارير بزبائنك الدايمين. الباقة الأساسية 12 دينار بالشهر والمميزة 25.',
    `التجربة ${trialDays} يوم ببلاش بدون بطاقة بنك.${promoLeft > 0 ? ` وفي عرض لأول المحلات: خصم 30% (ضايل ${promoLeft} مكان).` : ''}`,
    'اكتب نص منشور إنستغرام وفيسبوك واحد، بلهجة أردنية/شامية بسيطة وقريبة، موجّه لأصحاب المحلات:',
    '- سطر أول بيشد (سؤال أو مشكلة بيعيشها صاحب المحل)، وبعده 3 لـ 5 سطور قصيرة، وإيموجي قليلة.',
    '- آخر سطر: «جرّب 14 يوم ببلاش، الرابط بالبايو 👆»، وبعده سطر فاضي وبعدين 5 لـ 7 هاشتاغات عربي.',
    '- ممنوع تخترع أرقام أو نتائج أو أسماء محلات أو آراء زبائن. بدون روابط بالنص، وبدون عناوين أو نجوم markdown.',
    '- رجّع نص المنشور بس، بدون أي مقدمة.',
  ].join('\n');
}

export const fallbackCaption = (trialDays) => `بطاقة ولاء لمحلك بمحفظة جوال زبونك 📲
بدون تطبيق وبدون كروت ورق: كل زيارة نقاط، والزبون بيرجعلك.

جرّب ${trialDays} يوم ببلاش، الرابط بالبايو 👆

${HASHTAGS}`;
