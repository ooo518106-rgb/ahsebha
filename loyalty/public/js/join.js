// صفحة انضمام الزبون: بيمسح QR الملصق عالكاونتر → اسمه وجواله → بطاقته
import { $, api, html, raw, render, saveCardManagement, setBrand, unitKey } from './common.js';
import { LANG, applyLang, ruleText, setLang, t } from './i18n.js';

applyLang();

const slug = location.pathname.split('/')[2];
const query = new URLSearchParams(location.search);
const ref = (query.get('ref') || '').toLowerCase();
const giftCode = /^[a-z2-9]{20}$/.test(query.get('gift') || '') ? query.get('gift') : null;
const unitOf = (shop, n) => t(unitKey(shop.programType === 'stamps', n));
const root = $('#root');

function savedCards() {
  try { return JSON.parse(localStorage.getItem('loy_cards') || '{}'); } catch { return {}; }
}

async function main() {
  let shop;
  let referrer = null;
  try {
    ({ shop, referrer } = await api(`/api/shops/${encodeURIComponent(slug)}/public${/^[a-z2-9]{6}$/.test(ref) ? `?ref=${ref}` : ''}`));
  } catch (e) {
    render(root, html`<div class="panel center" style="margin-top:90px"><h1>😕</h1><p>${e.message}</p></div>`);
    return;
  }
  setBrand(shop.color);
  document.title = t('joinPageTitle', { shop: shop.name });
  const existing = savedCards()[slug];
  if (shop.paused) {
    render(root, html`
      <div class="brand-hero"><img src="${shop.logo}" alt=""><h1>${shop.name}</h1></div>
      <div class="panel center"><p>${t('paused')}</p>
        ${existing ? html`<a class="btn block" style="margin-top:8px" href="/c/${existing}">${t('openMine')}</a>` : ''}</div>
      <p class="powered">${t('powered')} <a href="/">نقاطك</a></p>`);
    return;
  }
  render(root, html`
    <p class="lang-switch"><button type="button" class="linkish" id="langBtn">${t('langSwitch')}</button></p>
    <div class="brand-hero">
      <img src="${shop.logo}" alt="">
      <h1>${shop.name}</h1>
      <p class="muted">${ruleText(shop)}</p>
    </div>
    ${referrer ? html`<div class="alert ok center" style="margin-bottom:12px">${t('referred', { name: referrer, n: shop.refBonus, unit: unitOf(shop, shop.refBonus) })}</div>` : ''}
    ${giftCode ? html`<div class="alert ok center" style="margin-bottom:12px">${t('giftJoin')} 🎁</div>` : ''}
    ${existing ? html`<div class="panel center"><p>${t('haveCard')}</p><a class="btn block" style="margin-top:8px" href="/c/${existing}">${t('openMine')}</a></div>` : ''}
    <form class="panel stack" id="join" novalidate>
      <h2>${t('joinTitle')}</h2>
      <div class="field"><label for="name">${t('name')}</label><input id="name" name="name" autocomplete="name" required maxlength="60"></div>
      <div class="field"><label for="phone">${t('phone')}</label><input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" dir="ltr" required placeholder="07xxxxxxxx">
        <div class="hint">${t('phoneHint')}</div></div>
      ${shop.bdayOn ? html`<div class="field"><label>${t('bday')} <span class="muted">${t('optional')}</span></label>
        <div class="row tight"><select name="bdayDay" class="grow" aria-label="${t('day')}"><option value="">${t('day')}</option>${Array.from({ length: 31 }, (_, i) => html`<option>${i + 1}</option>`)}</select>
          <select name="bdayMonth" class="grow" aria-label="${t('month')}"><option value="">${t('month')}</option>${t('months').map((m, i) => html`<option value="${i + 1}">${m}</option>`)}</select></div>
        <div class="hint">${shop.bdayGift > 0 ? t('bdayGift', { gift: shop.bdayGift >= shop.cost ? shop.rewardName : `${shop.bdayGift} ${unitOf(shop, shop.bdayGift)}` }) : t('bdayGreet')}</div></div>` : ''}
      <div class="hp" aria-hidden="true"><input type="text" name="website" tabindex="-1" autocomplete="off"></div>
      <p class="error" id="err" role="alert"></p>
      <button class="btn big block" type="submit">${t('getCard')}</button>
      <p class="small muted center">${t('walletNote', { shop: shop.name })}</p>
      <p class="small muted center">${raw(t('consent'))}</p>
    </form>
    <p class="powered">${t('powered')} <a href="/">نقاطك</a></p>`);
  $('#langBtn').onclick = () => { setLang(LANG === 'ar' ? 'en' : 'ar'); location.reload(); };

  $('#join').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    $('#err').textContent = '';
    try {
      const r = await api(`/api/shops/${encodeURIComponent(slug)}/join`, { method: 'POST', body: { ...Object.fromEntries(new FormData(e.target)), ref: referrer ? ref : undefined, lang: LANG } });
      saveCardManagement(r.token, r.managementKey);
      try { localStorage.setItem('loy_cards', JSON.stringify({ ...savedCards(), [slug]: r.token })); } catch { /* اختياري */ }
      // جاي من رابط هدية: بنستلمها على البطاقة الجديدة (إذا فشلت، البطاقة انعملت على كل حال)
      let claimed = false;
      if (giftCode) claimed = await api(`/api/gifts/${giftCode}/claim`, { method: 'POST', body: { token: r.token } }).then(() => true, () => false);
      location.href = `/c/${r.token}?new=1${claimed ? '&gift=1' : ''}#manage=${r.managementKey}`;
    } catch (err) {
      $('#err').textContent = err.message;
      btn.disabled = false;
    }
  });
}

main();
