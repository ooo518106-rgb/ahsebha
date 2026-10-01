// صفحة انضمام الزبون: بيمسح QR الملصق عالكاونتر → اسمه وجواله → بطاقته
import { $, api, html, render, setBrand } from './common.js';

const slug = location.pathname.split('/')[2];
const ref = (new URLSearchParams(location.search).get('ref') || '').toLowerCase();
const MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
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
  document.title = `انضم لبطاقة ولاء ${shop.name}`;
  const existing = savedCards()[slug];
  if (shop.paused) {
    render(root, html`
      <div class="brand-hero"><img src="${shop.logo}" alt=""><h1>${shop.name}</h1></div>
      <div class="panel center"><p>برنامج الولاء بهالمحل متوقف مؤقتاً.</p>
        ${existing ? html`<a class="btn block" style="margin-top:8px" href="/c/${existing}">افتح بطاقتي</a>` : ''}</div>
      <p class="powered">بطاقات الولاء من <a href="/">نقاطك</a></p>`);
    return;
  }
  render(root, html`
    <div class="brand-hero">
      <img src="${shop.logo}" alt="">
      <h1>${shop.name}</h1>
      <p class="muted">${shop.rule}</p>
    </div>
    ${referrer ? html`<div class="alert ok center" style="margin-bottom:12px">🎁 ${referrer} دعاك! بأول زيارة إلك بتاخدوا انتو التنين ${shop.refBonus} ${shop.unit} هدية.</div>` : ''}
    ${existing ? html`<div class="panel center"><p>عندك بطاقة عنا من قبل 👋</p><a class="btn block" style="margin-top:8px" href="/c/${existing}">افتح بطاقتي</a></div>` : ''}
    <form class="panel stack" id="join" novalidate>
      <h2>انضم لبطاقة الولاء</h2>
      <div class="field"><label for="name">الاسم</label><input id="name" name="name" autocomplete="name" required maxlength="60"></div>
      <div class="field"><label for="phone">رقم الجوال</label><input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" dir="ltr" required placeholder="07xxxxxxxx">
        <div class="hint">عشان لو ضاعت بطاقتك، الكاشير بيلاقيها برقمك.</div></div>
      ${shop.bdayOn ? html`<div class="field"><label>🎂 تاريخ ميلادك <span class="muted">(اختياري)</span></label>
        <div class="row tight"><select name="bdayDay" class="grow" aria-label="اليوم"><option value="">اليوم</option>${Array.from({ length: 31 }, (_, i) => html`<option>${i + 1}</option>`)}</select>
          <select name="bdayMonth" class="grow" aria-label="الشهر"><option value="">الشهر</option>${MONTHS.map((m, i) => html`<option value="${i + 1}">${m}</option>`)}</select></div>
        <div class="hint">${shop.bdayGift > 0 ? `بنهديك ${shop.bdayGift >= shop.cost ? shop.rewardName : `${shop.bdayGift} ${shop.unit}`} يوم عيدك 🎁` : 'عشان نعايدك يوم عيدك 🎉'}</div></div>` : ''}
      <div class="hp" aria-hidden="true"><input type="text" name="website" tabindex="-1" autocomplete="off"></div>
      <p class="error" id="err" role="alert"></p>
      <button class="btn big block" type="submit">أعطيني بطاقتي</button>
      <p class="small muted center">بتنحفظ بمحفظة الجوال، وبتطلعلك لحالها لما تكون قريب من ${shop.name}.</p>
      <p class="small muted center">لما تنضم بتوافق على <a href="/privacy" target="_blank" rel="noopener">سياسة الخصوصية</a>. منحفظ اسمك ورقمك ونقاطك (وتاريخ ميلادك لو كتبته) بس، وبتقدر تحذفهم بأي وقت.</p>
    </form>
    <p class="powered">بطاقات الولاء من <a href="/">نقاطك</a></p>`);

  $('#join').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    $('#err').textContent = '';
    try {
      const r = await api(`/api/shops/${encodeURIComponent(slug)}/join`, { method: 'POST', body: { ...Object.fromEntries(new FormData(e.target)), ref: referrer ? ref : undefined } });
      try { localStorage.setItem('loy_cards', JSON.stringify({ ...savedCards(), [slug]: r.token })); } catch { /* اختياري */ }
      location.href = `/c/${r.token}?new=1`;
    } catch (err) {
      $('#err').textContent = err.message;
      btn.disabled = false;
    }
  });
}

main();
