import { $, $$, api } from './common.js';

let mode = 'signup';

// لو مسجّل دخول من قبل، على اللوحة مباشرة
api('/api/me').then(() => location.replace('/app')).catch(() => {});

function setMode(m) {
  mode = m;
  $$('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  $$('.signup-only').forEach((el) => el.classList.toggle('hidden', m !== 'signup' || (el.id === 'codeField' && !showCode)));
  $('#password').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
  $('#authBtn').textContent = m === 'signup' ? 'ابدأ مجاناً' : 'دخول';
  $('#authError').textContent = '';
}
let showCode = new URLSearchParams(location.search).has('code');
if (showCode) $('#code').value = new URLSearchParams(location.search).get('code');

$$('.seg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
if (location.hash === '#login') setMode('login'); else setMode('signup');

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
    if (err.status === 403 && mode === 'signup') { showCode = true; setMode('signup'); $('#authError').textContent = err.message; }
  } finally {
    btn.disabled = false;
  }
});
