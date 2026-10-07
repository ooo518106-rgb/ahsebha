// المنيو الإلكتروني للمحل: بيفتح من QR الطاولة، وتحته دعوة لبطاقة الولاء
import { $, api, html, render, setBrand } from './common.js';
import { LANG, applyLang, setLang, t } from './i18n.js';

applyLang();
const slug = location.pathname.split('/')[2];
const root = $('#root');
const LINKS = ['instagram', 'snapchat', 'tiktok', 'facebook', 'whatsapp', 'website'];
const fmtPrice = (n, cur) => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(n)} ${cur}`;

function savedCard() {
  try { return JSON.parse(localStorage.getItem('loy_cards') || '{}')[slug] || null; } catch { return null; }
}

async function main() {
  let r;
  try { r = await api(`/api/shops/${encodeURIComponent(slug)}/menu`); } catch (e) {
    render(root, html`<div class="panel center" style="margin-top:90px"><h1>😕</h1><p>${e.message}</p></div>`);
    return;
  }
  const { shop, categories, pdf } = r;
  setBrand(shop.color);
  document.title = `${t('menu')} — ${shop.name}`;
  const card = savedCard();
  const links = LINKS.filter((k) => shop.links && shop.links[k]);
  render(root, html`
    <p class="lang-switch"><button type="button" class="linkish" id="langBtn">${t('langSwitch')}</button></p>
    <div class="brand-hero"><img src="${shop.logo}" alt=""><h1>${shop.name}</h1><p class="muted">${t('menu')}</p></div>
    ${pdf ? html`<a class="panel menu-pdf-open" href="${pdf.url}" target="_blank" rel="noopener"><span class="pdf-ico" aria-hidden="true">📄</span><span class="grow"><b>${t('menuPdf')}</b><span class="small muted">${t('menuPdfHint')}</span></span><span aria-hidden="true">${LANG === 'en' ? '→' : '←'}</span></a>` : ''}
    ${categories.length > 1 ? html`<nav class="menu-cats">${categories.map((c, i) => html`<a href="#cat-${i}" class="chip">${c.name || t('menu')}</a>`)}</nav>` : ''}
    ${categories.length ? categories.map((c, i) => html`<section class="panel menu-sec" id="cat-${i}">
        ${c.name ? html`<h2>${c.name}</h2>` : ''}
        <ul class="menu-items">${c.items.map((it) => html`<li>
          ${it.image ? html`<img src="${it.image}" alt="" loading="lazy">` : ''}
          <div class="grow"><b>${it.name}</b>${it.description ? html`<div class="small muted">${it.description}</div>` : ''}
            ${it.sizes.length ? html`<div class="sizes" role="group" aria-label="${t('sizeLabel')}">${it.sizes.map((z, j) => html`<button type="button" class="size${j ? '' : ' on'}" aria-pressed="${j ? 'false' : 'true'}" data-price="${fmtPrice(z.price, shop.currency)}">${z.name}</button>`)}</div>` : ''}</div>
          ${it.sizes.length ? html`<span class="price num">${fmtPrice(it.sizes[0].price, shop.currency)}</span>`
            : it.price != null ? html`<span class="price num">${fmtPrice(it.price, shop.currency)}</span>` : ''}</li>`)}</ul>
      </section>`) : pdf ? '' : html`<p class="panel center muted">${t('menuEmpty')}</p>`}
    <section class="panel center stack menu-join">
      <b>${t('menuJoin', { reward: shop.rewardName })}</b>
      <a class="btn big block" href="${card ? `/c/${card}` : `/j/${shop.slug}`}">${card ? t('menuOpenCard') : t('menuJoinBtn')}</a>
    </section>
    ${links.length ? html`<div class="row" style="justify-content:center;margin-top:12px">${links.map((k) => html`<a class="btn ghost sm" href="${shop.links[k]}" target="_blank" rel="noopener">${t(k)}</a>`)}</div>` : ''}
    <p class="powered">${t('powered')} <a href="/">نقاطك</a></p>`);
  $('#langBtn').onclick = () => { setLang(LANG === 'ar' ? 'en' : 'ar'); location.reload(); };
}

// الزبون بيختار الحجم (صغير، كبير…) وبيتغيّر السعر قدّامه
root.addEventListener('click', (e) => {
  const btn = e.target.closest('.size');
  if (!btn) return;
  const li = btn.closest('li');
  for (const b of li.querySelectorAll('.size')) { b.classList.toggle('on', b === btn); b.setAttribute('aria-pressed', String(b === btn)); }
  const price = li.querySelector('.price');
  price.textContent = btn.dataset.price;
  price.classList.remove('bump');
  void price.offsetWidth;
  price.classList.add('bump');
});

main();
