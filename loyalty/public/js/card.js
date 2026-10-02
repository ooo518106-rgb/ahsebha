// صفحة بطاقة الزبون: QR للكاشير + زر الحفظ بمحفظة Google، وبتتحدّث لحالها لما تنضاف نقاط
import { $, api, cardHTML, html, isIOS, raw, render, setBrand, toast } from './common.js';
import { LANG, applyLang, fmtDate, ruleText, setLang, t } from './i18n.js';
import { confetti } from './confetti.js';

applyLang();

const token = location.pathname.split('/')[2];
const params = new URLSearchParams(location.search);
const root = $('#root');
let lastBalance = null;
let lastAvail = null;
let deleted = false;
let lastData = null;

// ─── إشعارات الويب ───
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const pushFlag = `loy_push_${token}`;
let pushState = 'unknown'; // off | on | denied | install | unsupported

function flag(v) {
  try { if (v === undefined) return localStorage.getItem(pushFlag) === '1'; if (v) localStorage.setItem(pushFlag, '1'); else localStorage.removeItem(pushFlag); } catch { return false; }
  return v;
}

async function detectPush() {
  if (!pushSupported) { pushState = isIOS() && !standalone ? 'install' : 'unsupported'; return; }
  if (Notification.permission === 'denied') { pushState = 'denied'; return; }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    const sub = await reg.pushManager.getSubscription();
    pushState = sub && Notification.permission === 'granted' && flag() ? 'on' : 'off';
    // بنذكّر السيرفر بالاشتراك كل مرة بتنفتح البطاقة (لو ضاع من عنده)
    if (pushState === 'on') api(`/api/cards/${token}/push`, { method: 'POST', body: sub.toJSON() }).catch(() => {});
  } catch {
    pushState = 'unsupported';
  }
}

const keyBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)), (ch) => ch.charCodeAt(0));

let pushNote = null; // نتيجة الإشعار التجريبي: { ok, text }

async function subscribe(reg) {
  const { publicKey } = await api('/api/push/key');
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
}

// بيبعت إشعار تجريبي لهالجهاز (وبيحفظ الاشتراك بالمرة)، وبيكتب شو صار
async function testPush(retry = true) {
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || await subscribe(reg);
  const r = await api(`/api/cards/${token}/push/test`, { method: 'POST', body: sub.toJSON() });
  if (r.result === 'gone' && retry) {
    // الاشتراك القديم انتهى: بنعمل واحد جديد وبنجرّب كمان مرة
    await sub.unsubscribe().catch(() => {});
    await subscribe(reg);
    return testPush(false);
  }
  pushNote = r.result === 'ok'
    ? { ok: true, text: t('pushTestOk') }
    : { ok: false, text: t('pushTestBad', { reason: r.reason || t('error') }) };
  return r.result === 'ok';
}

async function enablePush() {
  // طلب الإذن أول إشي، جوّا الكبسة نفسها (الآيفون بيطلب هيك)
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { pushState = perm === 'denied' ? 'denied' : 'off'; draw(); return; }
  try {
    await navigator.serviceWorker.register('/sw.js');
    await testPush();
    flag(true);
    pushState = 'on';
    toast(t('pushEnabled'), 'ok');
  } catch (err) {
    toast(err.message || t('pushFailed'), 'bad');
  }
  draw();
}

async function runTest(btn) {
  btn.disabled = true;
  try { await testPush(); } catch (err) { pushNote = { ok: false, text: `❌ ${err.message || t('error')}` }; }
  draw();
}

async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) await api(`/api/cards/${token}/push`, { method: 'DELETE', body: { endpoint: sub.endpoint } });
  } catch { /* بنطفيها محلياً على كل حال */ }
  flag(false);
  pushState = 'off';
  pushNote = null;
  toast(t('pushStopped'), 'ok');
  draw();
}

function pushPanel() {
  if (pushState === 'off') {
    return html`<div class="panel small stack"><b>${t('pushAsk')}</b>
      <button class="btn block" type="button" id="pushOn">${t('pushOn')}</button></div>`;
  }
  if (pushState === 'on') {
    return html`<p class="center small muted">${t('pushIsOn')} · <button type="button" class="linkish" id="pushTest">${t('pushTest')}</button> · <button type="button" class="linkish" id="pushOff">${t('pushOff')}</button></p>
      ${pushNote ? html`<p class="alert ${pushNote.ok ? 'ok' : 'warn'} small">${pushNote.text}</p>` : ''}`;
  }
  if (pushState === 'denied') return html`<p class="center small muted">${t('pushDenied')}</p>`;
  return '';
}

// إشعار وصل والبطاقة مفتوحة: بنحدّثها فوراً وبنعرض نص الإشعار
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', async (e) => {
    if (!e.data || e.data.type !== 'push') return;
    await load(false, true);
    if (e.data.body) toast(`🔔 ${e.data.body}`, 'ok');
  });
}

async function load(first = false, quiet = false) {
  let data;
  try {
    data = await api(`/api/cards/${token}`);
  } catch (e) {
    if (first) render(root, html`<div class="panel center" style="margin-top:60px"><h1>😕</h1><p>${e.message}</p></div>`);
    return;
  }
  const gained = lastBalance !== null && data.member.balance > lastBalance;
  if (!quiet && gained) toast(`+${data.member.balance - lastBalance} ${t(data.shop.programType === 'stamps' ? 'unitStamp' : 'unitPoint')} 🎉`, 'ok');
  // احتفال: نقاط جديدة، وأكبر لما تجهز مكافأة
  const ready = lastAvail !== null && data.member.progress.available > lastAvail;
  if (ready) confetti({ count: 220 });
  else if (gained) confetti();
  lastBalance = data.member.balance;
  lastAvail = data.member.progress.available;
  // ما بنعيد الرسم إذا ما تغيّر إشي (عشان ما يضيع اللي الزبون عم يكتبه)
  const sig = JSON.stringify(data);
  if (sig === lastSig) return;
  lastSig = sig;
  lastData = data;
  remember(data.shop.slug);
  draw();
}

// بنحفظ البطاقة على هالجهاز: صفحة «كل بطاقاتي» والمنيو بيلاقوها من هون
function remember(slug) {
  try {
    const cards = JSON.parse(localStorage.getItem('loy_cards') || '{}');
    if (cards[slug] === token) return;
    cards[slug] = token;
    localStorage.setItem('loy_cards', JSON.stringify(cards));
  } catch { /* اختياري */ }
}

// ─── العروض على البطاقة: المستوى، نقاط دبل، عيد الميلاد، التقييم، ادعُ صاحبك ───
let lastSig = null;
let rate = null; // { stars } لما يختار نجوم أقل من 4 ويكتب ملاحظة، أو { done, googleUrl }
let gift = null; // آخر هدية عملها: { url, text }
const fmtDay = (ms) => fmtDate(ms, { weekday: 'long', day: 'numeric', month: 'long' });
const first = (name) => String(name).trim().split(/\s+/)[0];
const unitOf = (shop) => t(shop.programType === 'stamps' ? 'unitStamp' : 'unitPoint');
const LINKS = ['instagram', 'tiktok', 'facebook', 'whatsapp', 'website'];

function perksPanels(shop, member, refUrl, canRate, coupons) {
  const unit = unitOf(shop);
  const tier = member.tier;
  return html`
    ${member.birthdayToday ? html`<div class="alert ok center">${t('bdayToday', { name: first(member.name) })}</div>` : ''}
    ${shop.boostNow > 1 ? html`<div class="alert ok center">${t('boostNow', { m: shop.boostNow })}</div>`
      : member.boostUntil ? html`<div class="alert ok center">${t('boostUntil', { day: fmtDay(member.boostUntil) })}</div>` : ''}
    ${coupons.map((cp) => html`<div class="panel small coupon-card"><b>${t('coupon', { title: cp.title })}</b>${cp.details ? html`<div>${cp.details}</div>` : ''}
      <div class="muted">${t('couponUntil', { day: fmtDay(cp.expiresAt) })}</div></div>`)}
    ${shop.creditOn || member.credit > 0 ? html`<div class="panel small stack"><div class="row" style="justify-content:space-between"><b>${t('credit', { amount: member.credit, cur: shop.currency })}</b><span class="muted">${t('creditHint')}</span></div>
      ${shop.creditOn && member.credit >= 0.5 ? html`<button class="btn ghost block" type="button" id="giftBtn">${t('giftBtn')}</button>` : ''}
      ${gift ? html`<div class="alert ok stack"><b>${t('giftMade')}</b><div class="row"><button class="btn grow" type="button" id="giftShare">${t('giftSend')}</button>
        <button class="btn ghost" type="button" id="giftCopy">${t('copyLink')}</button></div></div>` : ''}</div>` : ''}
    ${member.expiresAt ? html`<p class="small muted center">${t('expires', { day: fmtDate(member.expiresAt) })}</p>` : ''}
    ${tier ? html`<div class="panel small tier tier-${tier.key}"><b>${t('tier', { icon: tier.icon, name: LANG === 'en' ? { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' }[tier.key] : tier.name })}</b>${tier.mult > 1 ? t('tierMult', { m: tier.mult }) : ''}
      ${tier.next ? html`<div class="muted" style="margin-top:4px">${t('tierNext', { n: tier.next.visitsLeft, visits: t(tier.next.visitsLeft === 1 ? 'visit1' : 'visitN'), icon: tier.next.icon, name: LANG === 'en' ? (tier.key === 'bronze' ? 'Silver' : 'Gold') : tier.next.name })}</div>` : ''}</div>` : ''}
    ${rate && rate.done ? html`<div class="panel small center stack"><b>${t('thanks')}</b>
        ${rate.googleUrl ? html`<p class="muted">${t('googleAsk')}</p><a class="btn block" href="${rate.googleUrl}" target="_blank" rel="noopener">${t('googleBtn')}</a>` : html`<p class="muted">${t('feedbackSent', { shop: shop.name })}</p>`}</div>`
      : canRate ? html`<div class="panel small center stack" id="ratePanel"><b>${t('rateAsk')}</b>
        <div class="stars" role="group" aria-label="${t('rateAsk')}">${[1, 2, 3, 4, 5].map((n) => html`<button type="button" data-star="${n}" class="${rate && rate.stars >= n ? 'on' : ''}" aria-label="${n}/5">★</button>`)}</div>
        ${rate && rate.stars ? html`<textarea id="rateNote" rows="2" maxlength="500" placeholder="${t('rateNote')}"></textarea>
          <button class="btn block" type="button" id="rateSend">${t('send')}</button>` : ''}</div>` : ''}
    ${shop.bdayOn && !member.birthday ? html`<form class="panel small stack" id="bdayForm"><b>${t('bdayAsk')}</b>
        <span class="muted">${shop.bdayGift > 0 ? t('bdayGift', { gift: shop.bdayGift >= shop.cost ? shop.rewardName : `${shop.bdayGift} ${unit}` }) : t('bdayGreet')}</span>
        <div class="row tight"><select name="day" class="grow" required aria-label="${t('day')}"><option value="">${t('day')}</option>${Array.from({ length: 31 }, (_, i) => html`<option>${i + 1}</option>`)}</select>
          <select name="month" class="grow" required aria-label="${t('month')}"><option value="">${t('month')}</option>${t('months').map((m, i) => html`<option value="${i + 1}">${m}</option>`)}</select>
          <button class="btn" type="submit">${t('save')}</button></div></form>` : ''}
    ${refUrl ? html`<div class="panel small stack"><b>${t('invite')}</b>
        <span class="muted">${t('inviteHint', { n: shop.refBonus, unit })}</span>
        <div class="row"><button class="btn grow" type="button" id="shareRef">${t('inviteSend')}</button>
          <button class="btn ghost" type="button" id="copyRef">${t('copyLink')}</button></div></div>` : ''}`;
}

function linksRow(shop) {
  const items = LINKS.filter((k) => shop.links && shop.links[k]);
  if (!items.length) return '';
  return html`<div class="panel small stack"><b>${t('links')}</b><div class="row">${items.map((k) => html`<a class="btn ghost sm" href="${shop.links[k]}" target="_blank" rel="noopener">${t(k)}</a>`)}</div></div>`;
}

function inviteText() {
  const { shop, refUrl } = lastData;
  return t('inviteText', { shop: shop.name, url: refUrl });
}

function draw() {
  if (!lastData || deleted) return;
  const { shop, member, google, apple, refUrl, canRate, coupons = [] } = lastData;
  setBrand(shop.color, { theme: false });
  document.title = t('cardTitle', { shop: shop.name });
  homeScreen(shop.logo, shop.name);
  const ios = isIOS();
  render(root, html`
    <p class="lang-switch"><button type="button" class="linkish" id="langBtn">${t('langSwitch')}</button></p>
    ${params.has('new') ? html`<div class="alert ok" style="margin-bottom:12px">${t('welcomeNew', { name: member.name })} ${(ios && !apple) ? '' : t('saveToWallet')}</div>` : ''}
    ${params.get('gw') === 'off' ? html`<div class="alert warn" style="margin-bottom:12px">${t('gwOff')}</div>` : ''}
    ${params.get('apple') === 'off' ? html`<div class="alert warn" style="margin-bottom:12px">${t('appleOff')}</div>` : ''}
    ${cardHTML(shop, member, { tr: t })}
    <div class="stack" style="margin-top:16px">
      ${perksPanels(shop, member, refUrl, canRate, coupons)}
      ${google && !ios ? html`<a class="gw-button" href="/c/${token}/google">${LANG === 'en' ? html`<img src="/img/google-wallet-button-en.svg" alt="${t('gwAlt')}" width="283" height="50">` : html`<img src="/img/google-wallet-button-ar.svg" alt="${t('gwAlt')}" width="309" height="50">`}</a>` : ''}
      ${ios && apple ? html`<a class="gw-button" href="/c/${token}/apple"><img class="apple-badge" src="/img/add-to-apple-wallet.svg" alt="Add to Apple Wallet" width="160" height="50"></a>` : ''}
      ${ios && !standalone ? html`<div class="panel small">${raw(t('iosTip'))}</div>` : ''}
      ${pushPanel()}
      <div class="panel small">
        <b>${ruleText(shop)}</b>
        <p class="muted" style="margin-top:4px">${t('showQr')} ${(google && !ios) || (apple && ios) ? t('walletHint') : ''}${apple && ios ? t('iosSide') : ''}</p>
      </div>
      ${linksRow(shop)}
      <p class="center small muted">${t('visits', { v: member.visits, r: member.redeemed })}</p>
      <p class="center"><a class="btn ghost sm" href="/cards">${t('allCards')}</a></p>
      <p class="center small muted"><a href="/privacy">${t('privacy')}</a> · <button type="button" class="linkish" id="deleteCard">${t('deleteCard')}</button></p>
      <p class="powered">${t('powered')} <a href="/">نقاطك</a></p>
    </div>`);
}

// لما الزبون يضيف البطاقة للشاشة الرئيسية: أيقونتها شعار المحل واسمها اسم المحل
function homeScreen(icon, title) {
  if (!$('link[rel="manifest"]')) {
    const man = document.createElement('link');
    man.rel = 'manifest';
    man.href = `/c/${token}/manifest.webmanifest`;
    document.head.append(man);
  }
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

root.addEventListener('click', (e) => {
  const on = e.target.closest('#pushOn');
  if (on) { on.disabled = true; enablePush(); }
  if (e.target.closest('#pushOff')) disablePush();
  const t = e.target.closest('#pushTest');
  if (t) runTest(t);
});

// التقييم: 4 أو 5 نجوم بينبعت فوراً (ومنطلب تقييم على Google)، وأقل بنسأل شو اللي ما عجبه
async function sendRating(stars, comment = '') {
  try {
    const r = await api(`/api/cards/${token}/review`, { method: 'POST', body: { stars, comment } });
    rate = { done: true, googleUrl: r.googleUrl };
  } catch (err) {
    toast(err.message, 'bad');
    rate = null;
  }
  draw();
}

root.addEventListener('click', async (e) => {
  const star = e.target.closest('[data-star]');
  if (star) {
    const n = Number(star.dataset.star);
    if (n >= 4) sendRating(n);
    else { rate = { stars: n }; draw(); $('#rateNote')?.focus(); }
    return;
  }
  if (e.target.closest('#rateSend')) { sendRating(rate.stars, $('#rateNote').value); return; }
  if (e.target.closest('#giftBtn')) { makeGift(); return; }
  if (e.target.closest('#giftShare')) {
    if (navigator.share) { navigator.share({ text: gift.text }).catch(() => {}); } else { window.open(`https://wa.me/?text=${encodeURIComponent(gift.text)}`, '_blank', 'noopener'); }
    return;
  }
  if (e.target.closest('#giftCopy')) {
    try { await navigator.clipboard.writeText(gift.url); toast(t('copied'), 'ok'); } catch { prompt(t('copyLink'), gift.url); }
    return;
  }
  if (e.target.closest('#shareRef')) {
    const text = inviteText();
    if (navigator.share) { navigator.share({ text }).catch(() => {}); } else { window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener'); }
    return;
  }
  if (e.target.closest('#copyRef')) {
    try { await navigator.clipboard.writeText(lastData.refUrl); toast(t('copied'), 'ok'); } catch { prompt(t('copyLink'), lastData.refUrl); }
  }
  if (e.target.closest('#langBtn')) {
    const next = LANG === 'ar' ? 'en' : 'ar';
    setLang(next);
    // الإشعارات كمان بتصير بنفس اللغة
    await api(`/api/cards/${token}/lang`, { method: 'POST', body: { lang: next } }).catch(() => {});
    location.reload();
  }
});

// 🎁 إهداء رصيد: بينخصم من رصيده هلق، وصاحبه بيستلمه من الرابط (وإذا ما استلمه خلال 30 يوم بيرجع)
async function makeGift() {
  const { shop } = lastData;
  const input = prompt(t('giftAsk', { cur: shop.currency }), '');
  if (input == null) return;
  const amount = Number(String(input).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(',', '.').trim());
  if (!(amount > 0)) return;
  try {
    const r = await api(`/api/cards/${token}/gift`, { method: 'POST', body: { amount } });
    gift = { url: r.url, text: t('giftText', { amount: r.amount, cur: shop.currency, shop: shop.name, url: r.url }) };
    confetti({ count: 90, origin: { x: 0.5, y: 0.6 } });
    lastSig = null;
    await load(false, true);
  } catch (err) { toast(err.message, 'bad'); }
}

root.addEventListener('submit', async (e) => {
  if (e.target.id !== 'bdayForm') return;
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await api(`/api/cards/${token}/birthday`, { method: 'POST', body: { day: f.get('day'), month: f.get('month') } });
    toast(t('bdaySaved'), 'ok');
    await load();
  } catch (err) { toast(err.message, 'bad'); }
});

root.addEventListener('click', async (e) => {
  if (!e.target.closest('#deleteCard')) return;
  if (!confirm(t('deleteConfirm'))) return;
  try {
    await api(`/api/cards/${token}/delete`, { method: 'POST' });
    deleted = true;
    forget();
    render(root, html`<div class="panel center" style="margin-top:60px"><h1>👋</h1><p>${t('deleted')}</p></div>`);
  } catch (err) {
    toast(err.message, 'bad');
  }
});

await detectPush();
await load(true);
if (params.has('gift')) toast(t('giftClaimed'), 'ok');
if (params.has('new') || params.has('gift')) setTimeout(() => confetti({ count: 180 }), 350);
if (params.has('new') || params.has('gw') || params.has('apple') || params.has('gift')) history.replaceState(null, '', location.pathname);
// تحديث كل 15 ثانية والصفحة مفتوحة، عشان الزبون يشوف نقاطه وهو عالكاونتر
setInterval(() => { if (!deleted && document.visibilityState === 'visible') load(); }, 15000);
document.addEventListener('visibilitychange', () => { if (!deleted && document.visibilityState === 'visible') load(); });
