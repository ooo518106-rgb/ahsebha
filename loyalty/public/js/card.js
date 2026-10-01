// صفحة بطاقة الزبون: QR للكاشير + زر الحفظ بمحفظة Google، وبتتحدّث لحالها لما تنضاف نقاط
import { $, api, cardHTML, html, isIOS, render, setBrand, toast, WALLET_ICON } from './common.js';

const token = location.pathname.split('/')[2];
const params = new URLSearchParams(location.search);
const root = $('#root');
let lastBalance = null;

async function load(first = false) {
  let data;
  try {
    data = await api(`/api/cards/${token}`);
  } catch (e) {
    if (first) render(root, html`<div class="panel center" style="margin-top:60px"><h1>😕</h1><p>${e.message}</p></div>`);
    return;
  }
  const { shop, member, google } = data;
  if (lastBalance !== null && member.balance > lastBalance) toast(`+${member.balance - lastBalance} ${shop.unit} 🎉`, 'ok');
  lastBalance = member.balance;
  setBrand(shop.color);
  document.title = `بطاقة ${shop.name}`;
  const ios = isIOS();
  render(root, html`
    ${params.has('new') ? html`<div class="alert ok" style="margin-bottom:12px">أهلاً ${member.name}! هاي بطاقتك 🎉 ${ios ? '' : 'احفظها بالمحفظة عشان تطلعلك بسرعة.'}</div>` : ''}
    ${params.get('gw') === 'off' ? html`<div class="alert warn" style="margin-bottom:12px">الحفظ بمحفظة Google لسا مش مفعّل. اعرض هالصفحة للكاشير.</div>` : ''}
    ${cardHTML(shop, member)}
    <div class="stack" style="margin-top:16px">
      ${google && !ios ? html`<a class="wallet-btn" href="/c/${token}/google">${WALLET_ICON}<span>أضف إلى محفظة Google</span></a>` : ''}
      ${ios ? html`<div class="panel small">
          <b>على الآيفون:</b> بطاقة Apple Wallet جاية قريباً. لهلأ، كبس على <b>مشاركة ⬆️</b> وبعدين <b>«إضافة إلى الشاشة الرئيسية»</b> عشان تفتحها بسرعة.
        </div>` : ''}
      <div class="panel small">
        <b>${shop.rule}</b>
        <p class="muted" style="margin-top:4px">اعرض الـ QR للكاشير مع كل طلب. ${google && !ios ? 'بعد ما تحفظها بالمحفظة بتلاقيها جنب بطاقاتك، وبتطلعلك لحالها لما تقرّب من المحل.' : ''}</p>
      </div>
      <p class="center small muted">زياراتك: <span class="num">${member.visits}</span> · المكافآت اللي أخدتها: <span class="num">${member.redeemed}</span></p>
    </div>`);
}

await load(true);
if (params.has('new') || params.has('gw')) history.replaceState(null, '', location.pathname);
// تحديث كل 15 ثانية والصفحة مفتوحة، عشان الزبون يشوف نقاطه وهو عالكاونتر
setInterval(() => { if (document.visibilityState === 'visible') load(); }, 15000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
