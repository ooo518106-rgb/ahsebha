// صفحة البيع: بطاقة تجريبية، طلب اشتراك (فورم أو واتساب)، ودخول المحلات
import { $, $$, api, cardHTML, render } from './common.js';
import { PLAN_DEFAULTS, featuresHTML } from './plans.js';
import { mountSales } from './sales.js';

const params = new URLSearchParams(location.search);
const code = params.get('code');
// رابط المندوب (?partner=…): بنحفظه 60 يوم، وبيرافق التسجيل أو طلب الاشتراك
const PARTNER_KEY = 'nq_partner';
(() => {
  const p = (params.get('partner') || '').toLowerCase();
  try { if (/^[a-z2-9]{6}$/.test(p)) localStorage.setItem(PARTNER_KEY, JSON.stringify({ code: p, at: Date.now() })); } catch { /* اختياري */ }
})();
const partner = () => {
  try {
    const v = JSON.parse(localStorage.getItem(PARTNER_KEY) || 'null');
    return v && Date.now() - v.at < 60 * 864e5 ? v.code : undefined;
  } catch { return undefined; }
};
// 🎁 عرض من وكيل المبيعات (?offer=…): تجربة مجانية أطول، بنحفظه أسبوعين وبيرافق التسجيل
const OFFER_KEY = 'nq_offer';
const keepOffer = (code) => { try { localStorage.setItem(OFFER_KEY, JSON.stringify({ code, at: Date.now() })); } catch { /* اختياري */ } };
(() => { const o = (params.get('offer') || '').toLowerCase(); if (/^[a-z2-9]{8}$/.test(o)) keepOffer(o); })();
const offerCode = () => {
  try {
    const v = JSON.parse(localStorage.getItem(OFFER_KEY) || 'null');
    return v && Date.now() - v.at < 14 * 864e5 ? v.code : undefined;
  } catch { return undefined; }
};
let offerDays = null;
// 🔗 رابط المحل الخاص من رسالة واتساب (?p=…): الوكيل بيعرف مين هو وبيكمّل معه
const PROSPECT_KEY = 'nq_p';
(() => { const v = (params.get('p') || '').toLowerCase(); if (/^[a-z2-9]{8}$/.test(v)) { try { localStorage.setItem(PROSPECT_KEY, JSON.stringify({ code: v, at: Date.now() })); } catch { /* اختياري */ } } })();
const prospectCode = () => {
  try {
    const v = JSON.parse(localStorage.getItem(PROSPECT_KEY) || 'null');
    return v && Date.now() - v.at < 60 * 864e5 ? v.code : undefined;
  } catch { return undefined; }
};
const prospectInfo = prospectCode() ? api(`/api/p/${prospectCode()}`).catch(() => { try { localStorage.removeItem(PROSPECT_KEY); } catch { /* اختياري */ } return null; }) : Promise.resolve(null);
function showOffer(o) {
  offerDays = o.trialDays;
  let el = $('#offerBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'offerBanner';
    el.className = 'offer-banner';
    $('.hero-copy').prepend(el);
  }
  el.innerHTML = '<span></span><button type="button" class="btn sm">ابدأ هلأ</button>';
  el.querySelector('span').textContent = `🎁 ${o.shopName ? `عرض خاص لـ ${o.shopName}: ` : 'عرضك الخاص: '}تجربة مجانية ${o.trialDays} يوم بدل 14`;
  el.querySelector('button').onclick = () => startSignup();
  if (mode === 'signup') setMode('signup');
}
if (offerCode()) api(`/api/offers/${offerCode()}`).then(showOffer).catch(() => { try { localStorage.removeItem(OFFER_KEY); } catch { /* اختياري */ } });

// ترحيب باسم المحل فوق الصفحة
function welcome(pr, canChat) {
  const el = document.createElement('div');
  el.className = 'offer-banner';
  el.innerHTML = `<span></span>${canChat ? '<button type="button" class="btn sm" id="welcomeChat">💬 اسألني</button>' : ''}`;
  el.querySelector('span').textContent = `👋 أهلا ${pr.name}! جهزنالك هالصفحة: شوف كيف بتشتغل نقاطك، واسألني أي سؤال.`;
  $('.hero-copy').prepend(el);
}

let mode = 'login';
let signupOpen = false;
let whatsapp = null;

// 🎬 حساب العرض: بيفتح لوحة محل تجريبي مليان بيانات (بدون تسجيل)
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-demo]');
  if (!b) return;
  b.disabled = true;
  try {
    await api('/api/demo/login', { method: 'POST' });
    location.href = '/app';
  } catch (err) {
    alert(err.message);
    b.disabled = false;
  }
});

// الأقسام بتظهر بنعومة مع التمرير
(() => {
  const items = $$('[data-reveal]');
  if (!('IntersectionObserver' in window)) return;
  document.documentElement.classList.add('reveal-on');
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  items.forEach((el) => io.observe(el));
})();

// الشريط فوق بيغمق شوي لما تنزل
const nav = $('#nav');
const onScroll = () => nav.classList.toggle('scrolled', scrollY > 12);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

// تاريخ اليوم على شاشة الجوال التجريبي
$('.phone-date').textContent = new Intl.DateTimeFormat('ar-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

// بطاقة تجريبية بالواجهة
render($('#demoCard'), cardHTML(
  { name: 'موكا كوفي هاوس', color: '#6b3e26', logo: '/img/demo-logo.svg', programType: 'stamps', rewardName: 'قهوة مجانية' },
  { name: 'سارة', balance: 6, cardNo: '48213907', token: 'nuqatak-demo-card', progress: { cost: 9, available: 0, toward: 6, remaining: 3, pct: 67 } },
));

const waLink = (text) => `https://wa.me/${whatsapp}?text=${encodeURIComponent(text)}`;
function showWhatsApp(text = 'مرحبا، بدي أعرف أكتر عن نقاطك لمحلي') {
  if (!whatsapp) return;
  $$('[data-wa]').forEach((a) => { a.href = waLink(text); a.classList.remove('hidden'); });
}

// 💎 الباقتين بميزاتهم (بتنرسم فوراً، وبتتحدّث بأسعار السيرفر)
function drawPlans(plans = PLAN_DEFAULTS) {
  const box = $('#planCards');
  if (!box) return;
  const card = (tier, best) => {
    const p = plans[tier];
    const save = p.month * 12 - p.year;
    return `<div class="plan${best ? ' best' : ''}">
      ${best ? '<span class="badge ok">الأكثر طلباً</span>' : ''}
      <h3>${tier === 'pro' ? '💎' : '⭐'} ${p.name}</h3>
      <div class="price"><b class="num">${p.month}</b><span>دينار / بالشهر</span></div>
      <p class="small muted">أو <b class="num">${p.year}</b> دينار بالسنة${save > 0 ? ` (وفّر ${save})` : ''}</p>
      <a class="btn block${best ? '' : ' ghost'}" href="#contact" data-start>ابدأ التجربة المجانية</a>
      ${featuresHTML(tier)}
    </div>`;
  };
  box.innerHTML = card('basic', false) + card('pro', true);
}
drawPlans();

api('/api/site').then(async (s) => {
  if (s.plans) drawPlans(s.plans);
  whatsapp = s.whatsapp;
  signupOpen = s.signupOpen;
  if (s.apple) $('#faqIphone').textContent = 'بتنحفظ البطاقة بـ Apple Wallet، وبتفتح بكبستين على الزر الجانبي، ولما يقرّب الزبون من محلك بتطلعله على شاشة القفل برسالة الترحيب تبعتك.';
  showWhatsApp();
  setupAuth();
  const pr = await prospectInfo;
  if (pr) welcome(pr, s.sales);
  if (s.sales) {
    const chat = mountSales({
      onStart: () => startSignup(),
      onOffer: (o) => { keepOffer(o.code); showOffer(o); },
      extra: () => ({ partner: partner(), offer: offerCode(), prospect: prospectCode() }),
      shopName: pr && pr.name,
    });
    // أول مرة بيفتح رابطه: المحادثة بتفتح لحالها بعد ثانية
    let opened = false;
    try { opened = sessionStorage.getItem('nq_p_open') === '1'; sessionStorage.setItem('nq_p_open', '1'); } catch { /* اختياري */ }
    if (pr && params.get('p') && !opened) setTimeout(() => chat.open(), 1200);
    const btn = $('#welcomeChat');
    if (btn) btn.onclick = () => chat.open();
  }
}).catch(() => setupAuth());

// المحل اللي مسجّل دخول بيشوف «لوحتي» بدل «دخول»
api('/api/me').then(() => { const a = $('#navLogin'); a.textContent = 'لوحتي'; a.href = '/app'; }).catch(() => {});

// ─── طلب الاشتراك ───
$('#leadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button[type=submit]');
  const body = Object.fromEntries(new FormData(form));
  btn.disabled = true;
  $('#leadErr').textContent = '';
  try {
    await api('/api/leads', { method: 'POST', body: { ...body, partner: partner() } });
    form.classList.add('hidden');
    $('#leadDone').classList.remove('hidden');
    showWhatsApp(`مرحبا، أنا ${body.name} من ${body.shopName}. بعتلكم طلب تجربة نقاطك 🙌`);
  } catch (err) {
    $('#leadErr').textContent = err.message;
    btn.disabled = false;
  }
});

// ─── الدخول، والتسجيل للي معه رمز ───
function setMode(m) {
  mode = m;
  $$('#authTabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  $$('.signup-only').forEach((el) => el.classList.toggle('hidden', m !== 'signup' || (el.id === 'codeField' && signupOpen && !code)));
  $$('.login-only').forEach((el) => el.classList.toggle('hidden', m !== 'login'));
  $('#forgotMsg').classList.add('hidden');
  $('#password').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
  $('#authBtn').textContent = m === 'signup' ? 'ابدأ تجربتي المجانية' : 'دخول';
  $('#authTitle').textContent = m === 'signup' ? `ابدأ تجربتك المجانية${offerDays ? ` (${offerDays} يوم 🎁)` : ''}` : 'دخول المحلات';
  $('#authError').textContent = '';
}

function startSignup() {
  setMode('signup');
  $('#login').scrollIntoView({ behavior: 'smooth' });
  setTimeout(() => $('#shopName').focus({ preventScroll: true }), 400);
}

function setupAuth() {
  if (code) $('#code').value = code;
  const canSignup = signupOpen || !!code;
  $('#authTabs').classList.toggle('hidden', !canSignup);
  setMode(code || location.hash === '#start' ? 'signup' : 'login');
  if (code || location.hash === '#start') $('#login').scrollIntoView({ behavior: 'smooth' });
  if (canSignup) {
    // التجربة بتبلّش لحالها: زر «جرّب مجاناً» بيفتح التسجيل مباشرة، والفورم للي بده مساعدة
    $$('[data-start]').forEach((a) => {
      a.href = '#start';
      a.addEventListener('click', (e) => { e.preventDefault(); startSignup(); });
    });
    $('#contactTitle').textContent = 'بدك نساعدك تبلّش؟';
    $('#contactLead').textContent = 'اترك رقمك ومنتواصل معك نجهّز بطاقتك سوا، أو احكينا على واتساب.';
  }
}

$$('#authTabs button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

// 🔑 نسيت كلمة السر: الطلب بيوصل لفريق نقاطك، وبنبعتله رابط كلمة سر جديدة
$('#forgotBtn').addEventListener('click', async () => {
  const email = $('#email').value.trim();
  const msg = $('#forgotMsg');
  if (!email) { $('#authError').textContent = 'اكتب إيميلك فوق، وبعدين اكبس «نسيت كلمة السر؟»'; $('#email').focus(); return; }
  $('#authError').textContent = '';
  try {
    const r = await api('/api/auth/forgot', { method: 'POST', body: { email } });
    const wa = r.whatsapp ? `https://wa.me/${r.whatsapp}?text=${encodeURIComponent(`مرحبا، نسيت كلمة السر لحسابي بنقاطك: ${email}`)}` : null;
    msg.innerHTML = '<span></span>';
    msg.querySelector('span').textContent = 'وصلنا طلبك ✅ رح نبعتلك رابط لكلمة سر جديدة بأقرب وقت.';
    if (wa) {
      const a = document.createElement('a');
      a.className = 'btn sm wa';
      a.style.marginTop = '8px';
      a.href = wa;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'مستعجل؟ احكينا واتساب';
      msg.append(document.createElement('br'), a);
    }
    msg.classList.remove('hidden');
  } catch (err) { $('#authError').textContent = err.message; }
});

// رابط كلمة السر الجديدة (/?reset=…): فورم لحاله بدل الدخول
const resetToken = params.get('reset');
if (resetToken) {
  const showReset = (email) => {
    $('#auth').classList.add('hidden');
    $('#authTabs').classList.add('hidden');
    $('#resetForm').classList.remove('hidden');
    $('#authTitle').textContent = 'كلمة سر جديدة';
    $('#resetEmail').textContent = email;
    $('#login').scrollIntoView({ behavior: 'smooth' });
  };
  api(`/api/auth/reset?token=${encodeURIComponent(resetToken)}`).then((r) => showReset(r.email)).catch((e) => {
    $('#authError').textContent = e.message;
    $('#login').scrollIntoView({ behavior: 'smooth' });
  });
  $('#resetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('#newPw').value;
    if (pw !== $('#newPw2').value) { $('#resetError').textContent = 'كلمتين السر مش نفس الإشي'; return; }
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      await api('/api/auth/reset', { method: 'POST', body: { token: resetToken, password: pw } });
      location.href = '/app';
    } catch (err) { $('#resetError').textContent = err.message; btn.disabled = false; }
  });
}

$('#auth').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const btn = $('#authBtn');
  btn.disabled = true;
  $('#authError').textContent = '';
  try {
    if (mode === 'signup') {
      await api('/api/auth/signup', { method: 'POST', body: { ...Object.fromEntries(f), partner: partner(), offer: offerCode(), prospect: prospectCode() } });
      location.href = '/app#settings';
    } else {
      await api('/api/auth/login', { method: 'POST', body: { email: f.get('email'), password: f.get('password') } });
      location.href = '/app';
    }
  } catch (err) {
    $('#authError').textContent = err.message;
    if (err.status === 403 && mode === 'signup') $('#codeField').classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
});
