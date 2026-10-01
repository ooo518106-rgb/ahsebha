// صفحة البيع: بطاقة تجريبية، طلب اشتراك (فورم أو واتساب)، ودخول المحلات
import { $, $$, api, cardHTML, render } from './common.js';

const params = new URLSearchParams(location.search);
const code = params.get('code');
let mode = 'login';
let signupOpen = false;
let whatsapp = null;

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
    await api('/api/leads', { method: 'POST', body });
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
  $('#authBtn').textContent = m === 'signup' ? 'افتح حسابي' : 'دخول';
  $('#authError').textContent = '';
}

function setupAuth() {
  if (code) $('#code').value = code;
  const canSignup = signupOpen || !!code;
  $('#authTabs').classList.toggle('hidden', !canSignup);
  setMode(code ? 'signup' : 'login');
  if (code) $('#login').scrollIntoView({ behavior: 'smooth' });
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
      await api('/api/auth/signup', { method: 'POST', body: Object.fromEntries(f) });
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
