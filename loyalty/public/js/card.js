// صفحة بطاقة الزبون: QR للكاشير + زر الحفظ بمحفظة Google، وبتتحدّث لحالها لما تنضاف نقاط
import { $, api, cardHTML, html, isIOS, render, setBrand, toast } from './common.js';

const token = location.pathname.split('/')[2];
const params = new URLSearchParams(location.search);
const root = $('#root');
let lastBalance = null;
let deleted = false;

async function load(first = false) {
  let data;
  try {
    data = await api(`/api/cards/${token}`);
  } catch (e) {
    if (first) render(root, html`<div class="panel center" style="margin-top:60px"><h1>😕</h1><p>${e.message}</p></div>`);
    return;
  }
  const { shop, member, google, apple } = data;
  if (lastBalance !== null && member.balance > lastBalance) toast(`+${member.balance - lastBalance} ${shop.unit} 🎉`, 'ok');
  lastBalance = member.balance;
  setBrand(shop.color);
  document.title = `بطاقة ${shop.name}`;
  homeScreen(shop.logo, shop.name);
  const ios = isIOS();
  render(root, html`
    ${params.has('new') ? html`<div class="alert ok" style="margin-bottom:12px">أهلاً ${member.name}! هاي بطاقتك 🎉 ${(ios && !apple) ? '' : 'احفظها بالمحفظة عشان تطلعلك بسرعة.'}</div>` : ''}
    ${params.get('gw') === 'off' ? html`<div class="alert warn" style="margin-bottom:12px">الحفظ بمحفظة Google لسا مش مفعّل. اعرض هالصفحة للكاشير.</div>` : ''}
    ${params.get('apple') === 'off' ? html`<div class="alert warn" style="margin-bottom:12px">الحفظ بـ Apple Wallet لسا مش مفعّل. اعرض هالصفحة للكاشير.</div>` : ''}
    ${cardHTML(shop, member)}
    <div class="stack" style="margin-top:16px">
      ${google && !ios ? html`<a class="gw-button" href="/c/${token}/google"><img src="/img/google-wallet-button-ar.svg" alt="الإضافة إلى محفظة Google" width="309" height="50"></a>` : ''}
      ${ios && apple ? html`<a class="gw-button" href="/c/${token}/apple"><img class="apple-badge" src="/img/add-to-apple-wallet.svg" alt="Add to Apple Wallet" width="160" height="50"></a>` : ''}
      ${ios && !apple ? html`<div class="panel small">
          <b>على الآيفون:</b> بطاقة Apple Wallet جاية قريباً. لهلأ، كبس على <b>مشاركة ⬆️</b> وبعدين <b>«إضافة إلى الشاشة الرئيسية»</b> عشان تفتحها بسرعة.
        </div>` : ''}
      <div class="panel small">
        <b>${shop.rule}</b>
        <p class="muted" style="margin-top:4px">اعرض الـ QR للكاشير مع كل طلب. ${(google && !ios) || (apple && ios) ? 'بعد ما تحفظها بالمحفظة بتلاقيها جنب بطاقاتك، وبتطلعلك لحالها لما تقرّب من المحل.' : ''}${apple && ios ? ' وعلى الآيفون بتفتحها بكبستين على الزر الجانبي.' : ''}</p>
      </div>
      <p class="center small muted">زياراتك: <span class="num">${member.visits}</span> · المكافآت اللي أخدتها: <span class="num">${member.redeemed}</span></p>
      <p class="center small muted"><a href="/privacy">سياسة الخصوصية</a> · <button type="button" class="linkish" id="deleteCard">احذف بطاقتي وبياناتي</button></p>
      <p class="powered">بطاقات الولاء من <a href="/">نقاطك</a></p>
    </div>`);
}

// لما الزبون يضيف البطاقة للشاشة الرئيسية: أيقونتها شعار المحل واسمها اسم المحل
function homeScreen(icon, title) {
  let link = $('link[rel="apple-touch-icon"]');
  if (!link) { link = document.createElement('link'); link.rel = 'apple-touch-icon'; document.head.append(link); }
  if (link.href !== new URL(icon, location.href).href) link.href = icon;
  let meta = $('meta[name="apple-mobile-web-app-title"]');
  if (!meta) { meta = document.createElement('meta'); meta.name = 'apple-mobile-web-app-title'; document.head.append(meta); }
  meta.content = title;
}

function forget() {
  try {
    const cards = JSON.parse(localStorage.getItem('loy_cards') || '{}');
    for (const k of Object.keys(cards)) if (cards[k] === token) delete cards[k];
    localStorage.setItem('loy_cards', JSON.stringify(cards));
  } catch { /* اختياري */ }
}

root.addEventListener('click', async (e) => {
  if (!e.target.closest('#deleteCard')) return;
  if (!confirm('أكيد بدك تحذف بطاقتك؟ رح تنمسح نقاطك وكل سجلك عند هالمحل نهائياً، وما في رجعة.')) return;
  try {
    await api(`/api/cards/${token}/delete`, { method: 'POST' });
    deleted = true;
    forget();
    render(root, html`<div class="panel center" style="margin-top:60px"><h1>👋</h1><p>انحذفت بطاقتك وكل بياناتك. إذا كانت محفوظة بالمحفظة، رح تتوقف لحالها.</p></div>`);
  } catch (err) {
    toast(err.message, 'bad');
  }
});

await load(true);
if (params.has('new') || params.has('gw') || params.has('apple')) history.replaceState(null, '', location.pathname);
// تحديث كل 15 ثانية والصفحة مفتوحة، عشان الزبون يشوف نقاطه وهو عالكاونتر
setInterval(() => { if (!deleted && document.visibilityState === 'visible') load(); }, 15000);
document.addEventListener('visibilitychange', () => { if (!deleted && document.visibilityState === 'visible') load(); });
