// صفحة البيع: بطاقة تجريبية، طلب اشتراك (فورم أو واتساب)، ودخول المحلات
import { $, $$, api, cardHTML, render } from './common.js';

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

api('/api/site').then((s) => {
  whatsapp = s.whatsapp;
  signupOpen = s.signupOpen;
  if (s.apple) $('#faqIphone').textContent = 'بتنحفظ البطاقة بـ Apple Wallet، وبتفتح بكبستين على الزر الجانبي، ولما يقرّب الزبون من محلك بتطلعله على شاشة القفل برسالة الترحيب تبعتك.';
  showWhatsApp();
  setupAuth();
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
  $('#password').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
  $('#authBtn').textContent = m === 'signup' ? 'ابدأ تجربتي المجانية' : 'دخول';
  $('#authTitle').textContent = m === 'signup' ? 'ابدأ تجربتك المجانية' : 'دخول المحلات';
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

$('#auth').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const btn = $('#authBtn');
  btn.disabled = true;
  $('#authError').textContent = '';
  try {
    if (mode === 'signup') {
      await api('/api/auth/signup', { method: 'POST', body: { ...Object.fromEntries(f), partner: partner() } });
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
