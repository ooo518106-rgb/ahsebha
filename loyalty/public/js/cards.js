// «كل بطاقاتي»: كل بطاقات الزبون من محلات مختلفة بصفحة وحدة (وأيقونة وحدة على الشاشة الرئيسية)
// البطاقات محفوظة على الجهاز نفسه (loy_cards)، ما في حساب ولا كلمة سر
import { $, api, cardHTML, html, render, toast } from './common.js?v=1.82';
import { LANG, applyLang, setLang, t } from './i18n.js?v=1.82';

applyLang();
const root = $('#root');
const TOKEN_RE = /\/c\/([a-z2-9]{20})(?:[/?#]|$)/;

function saved() {
  try { return JSON.parse(localStorage.getItem('loy_cards') || '{}'); } catch { return {}; }
}
function store(cards) {
  try { localStorage.setItem('loy_cards', JSON.stringify(cards)); } catch { /* اختياري */ }
}

async function main() {
  const entries = Object.entries(saved());
  // بنجيب كل البطاقات مع بعض؛ البطاقة المحذوفة (404) بتنشال من الجهاز
  const results = await Promise.all(entries.map(([slug, token]) => api(`/api/cards/${token}`)
    .then((d) => ({ slug, token, d }), (e) => ({ slug, token, gone: e.status === 404 }))));
  const gone = results.filter((r) => r.gone);
  if (gone.length) {
    const cards = saved();
    for (const r of gone) if (cards[r.slug] === r.token) delete cards[r.slug];
    store(cards);
  }
  const list = results.filter((r) => r.d);
  // اللي عنده هدية جاهزة أول، وبعدين حسب الاسم
  list.sort((a, b) => (b.d.member.progress.available > 0) - (a.d.member.progress.available > 0) || a.d.shop.name.localeCompare(b.d.shop.name));
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  render(root, html`
    <p class="lang-switch"><button type="button" class="linkish" id="langBtn">${t('langSwitch')}</button></p>
    <div class="brand-hero"><img src="/img/nuqatak-logo.png" alt=""><h1>${t('myCards')}</h1></div>
    ${list.length ? list.map(({ slug, token, d }) => html`<div class="my-card">
        <a href="/c/${token}" aria-label="${d.shop.name}">${cardHTML(d.shop, d.member, { qr: false, tr: t })}</a>
        <div class="row" style="justify-content:space-between;margin-top:6px">
          ${d.member.credit > 0 ? html`<span class="small">${t('credit', { amount: d.member.credit, cur: d.shop.currency })}</span>` : html`<span></span>`}
          <button type="button" class="linkish small muted" data-remove="${slug}">${t('removeCard')}</button>
        </div></div>`)
      : html`<p class="panel center muted">${t('myCardsEmpty')}</p>`}
    ${results.length > list.length + gone.length ? html`<p class="alert warn small">${t('error')}</p>` : ''}
    <form class="panel small stack" id="addForm">
      <label for="cardLink"><b>${t('addCardLink')}</b></label>
      <div class="row tight"><input id="cardLink" class="grow" dir="ltr" inputmode="url" placeholder="https://…/c/…" autocomplete="off">
        <button class="btn" type="submit">${t('addCard')}</button></div>
    </form>
    ${!standalone ? html`<p class="small muted center">${t('myCardsHint')}</p>` : ''}
    <p class="powered">${t('powered')} <a href="/">نقاطك</a></p>`);
  $('#langBtn').onclick = () => { setLang(LANG === 'ar' ? 'en' : 'ar'); location.reload(); };
}

root.addEventListener('click', (e) => {
  const rm = e.target.closest('[data-remove]');
  if (!rm) return;
  const cards = saved();
  delete cards[rm.dataset.remove];
  store(cards);
  main();
});

root.addEventListener('submit', async (e) => {
  if (e.target.id !== 'addForm') return;
  e.preventDefault();
  const m = TOKEN_RE.exec($('#cardLink').value.trim());
  if (!m) { toast(t('addCardLink'), 'bad'); return; }
  try {
    const d = await api(`/api/cards/${m[1]}`);
    store({ ...saved(), [d.shop.slug]: m[1] });
    main();
  } catch (err) { toast(err.message, 'bad'); }
});

main();
