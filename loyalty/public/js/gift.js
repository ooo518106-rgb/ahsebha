// صفحة الهدية: صاحبك أهداك رصيد بمحل → بتستلمه على بطاقتك، أو بتاخد بطاقة جديدة وبتستلمه
import { $, api, html, render, setBrand, toast } from './common.js?v=1.82';
import { LANG, applyLang, setLang, t } from './i18n.js?v=1.82';

applyLang();
const code = location.pathname.split('/')[2];
const root = $('#root');

function savedCard(slug) {
  try { return JSON.parse(localStorage.getItem('loy_cards') || '{}')[slug] || null; } catch { return null; }
}

async function main() {
  let g;
  try { g = await api(`/api/gifts/${code}`); } catch (e) {
    render(root, html`<div class="panel center" style="margin-top:90px"><h1>😕</h1><p>${e.message}</p></div>`);
    return;
  }
  const { shop } = g;
  setBrand(shop.color);
  document.title = `🎁 ${shop.name}`;
  const card = savedCard(shop.slug);
  render(root, html`
    <p class="lang-switch"><button type="button" class="linkish" id="langBtn">${t('langSwitch')}</button></p>
    <div class="brand-hero"><img src="${shop.logo}" alt=""><h1>${shop.name}</h1></div>
    <div class="panel center stack">
      <div class="gift-emblem" aria-hidden="true">🎁</div>
      <h2>${t('giftTitle', { name: g.from || '🙂', amount: g.amount, cur: shop.currency })}</h2>
      ${g.open ? html`<p class="muted">${t('giftAt', { shop: shop.name })}</p>
        ${card ? html`<button class="btn big block" type="button" id="claim">${t('giftClaim')}</button>`
          : html`<a class="btn big block" href="/j/${shop.slug}?gift=${code}">${t('giftJoin')}</a>`}`
        : html`<p class="alert warn">${t('giftGone')}</p>
          ${card ? html`<a class="btn block" href="/c/${card}">${t('openMine')}</a>` : ''}`}
    </div>
    <p class="powered">${t('powered')} <a href="/">نقاطك</a></p>`);
  $('#langBtn').onclick = () => { setLang(LANG === 'ar' ? 'en' : 'ar'); location.reload(); };
  const btn = $('#claim');
  if (btn) {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const r = await api(`/api/gifts/${code}/claim`, { method: 'POST', body: { token: card } });
        location.href = `/c/${r.token}?gift=1`;
      } catch (err) {
        toast(err.message, 'bad');
        btn.disabled = false;
      }
    };
  }
}

main();
