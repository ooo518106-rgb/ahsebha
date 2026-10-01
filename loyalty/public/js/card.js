// صفحة بطاقة الزبون: QR للكاشير + زر الحفظ بمحفظة Google، وبتتحدّث لحالها لما تنضاف نقاط
import { $, api, cardHTML, html, isIOS, render, setBrand, toast } from './common.js';

const token = location.pathname.split('/')[2];
const params = new URLSearchParams(location.search);
const root = $('#root');
let lastBalance = null;
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
    ? { ok: true, text: '✅ انبعتلك إشعار تجريبي، لازم يطلعلك هلق. إذا ما شفته، اسحب من فوق الشاشة لتحت.' }
    : { ok: false, text: html`❌ ما قدرنا نوصّل الإشعار (<bdi>${r.reason || 'خطأ'}</bdi>). صوّر هالشاشة وابعتها للمحل.` };
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
    toast('تفعّلت الإشعارات 🔔', 'ok');
  } catch (err) {
    toast(err.message || 'ما قدرنا نفعّل الإشعارات', 'bad');
  }
  draw();
}

async function runTest(btn) {
  btn.disabled = true;
  try { await testPush(); } catch (err) { pushNote = { ok: false, text: `❌ ${err.message || 'ما زبط'}` }; }
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
  toast('وقّفنا الإشعارات', 'ok');
  draw();
}

function pushPanel() {
  if (pushState === 'off') {
    return html`<div class="panel small stack"><b>🔔 بدك يوصلك إشعار لما تنضافلك نقاط أو يكون في عرض؟</b>
      <button class="btn block" type="button" id="pushOn">فعّل الإشعارات</button></div>`;
  }
  if (pushState === 'on') {
    return html`<p class="center small muted">🔔 الإشعارات مفعّلة · <button type="button" class="linkish" id="pushTest">جرّب إشعار</button> · <button type="button" class="linkish" id="pushOff">إيقاف</button></p>
      ${pushNote ? html`<p class="alert ${pushNote.ok ? 'ok' : 'warn'} small">${pushNote.text}</p>` : ''}`;
  }
  if (pushState === 'denied') return html`<p class="center small muted">🔕 الإشعارات مسكّرة لهالبطاقة. بتقدر تفتحها من إعدادات الجوال.</p>`;
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
  if (!quiet && lastBalance !== null && data.member.balance > lastBalance) toast(`+${data.member.balance - lastBalance} ${data.shop.unit} 🎉`, 'ok');
  lastBalance = data.member.balance;
  // ما بنعيد الرسم إذا ما تغيّر إشي (عشان ما يضيع اللي الزبون عم يكتبه)
  const sig = JSON.stringify(data);
  if (sig === lastSig) return;
  lastSig = sig;
  lastData = data;
  draw();
}

// ─── العروض على البطاقة: المستوى، نقاط دبل، عيد الميلاد، التقييم، ادعُ صاحبك ───
let lastSig = null;
let rate = null; // { stars } لما يختار نجوم أقل من 4 ويكتب ملاحظة، أو { done, googleUrl }
const MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
const fmtDay = (ms) => new Intl.DateTimeFormat('ar-u-nu-latn', { weekday: 'long' }).format(new Date(ms));

function perksPanels(shop, member, refUrl, canRate) {
  const unit = shop.programType === 'stamps' ? 'ختم' : 'نقطة';
  const t = member.tier;
  return html`
    ${member.birthdayToday ? html`<div class="alert ok center">🎂 كل سنة وإنت سالم يا ${member.name.split(' ')[0]}! 🎉</div>` : ''}
    ${shop.boostNow > 1 ? html`<div class="alert ok center">⏰ هلق نقاطك ×${shop.boostNow} على كل طلب!</div>`
      : member.boostUntil ? html`<div class="alert ok center">🎁 اشتقنالك! نقاطك دبل لحد ${fmtDay(member.boostUntil)}</div>` : ''}
    ${t ? html`<div class="panel small tier tier-${t.key}"><b>${t.icon} مستواك: ${t.name}</b>${t.mult > 1 ? html` · نقاطك ×${t.mult}` : ''}
      ${t.next ? html`<div class="muted" style="margin-top:4px">باقي <span class="num">${t.next.visitsLeft}</span> ${t.next.visitsLeft === 1 ? 'زيارة' : 'زيارات'} وبتصير ${t.next.icon} ${t.next.name}</div>` : ''}</div>` : ''}
    ${rate && rate.done ? html`<div class="panel small center stack"><b>شكراً إلك 🙏</b>
        ${rate.googleUrl ? html`<p class="muted">بتساعدنا كتير إذا كتبت تقييمك على Google ⭐</p><a class="btn block" href="${rate.googleUrl}" target="_blank" rel="noopener">قيّمنا على Google</a>` : html`<p class="muted">وصل كلامك لـ ${shop.name}.</p>`}</div>`
      : canRate ? html`<div class="panel small center stack" id="ratePanel"><b>كيف كانت زيارتك اليوم؟</b>
        <div class="stars" role="group" aria-label="التقييم">${[1, 2, 3, 4, 5].map((n) => html`<button type="button" data-star="${n}" class="${rate && rate.stars >= n ? 'on' : ''}" aria-label="${n} من 5">★</button>`)}</div>
        ${rate && rate.stars ? html`<textarea id="rateNote" rows="2" maxlength="500" placeholder="شو اللي ما عجبك؟ رح يوصل لصاحب المحل بس"></textarea>
          <button class="btn block" type="button" id="rateSend">ابعت</button>` : ''}</div>` : ''}
    ${shop.bdayOn && !member.birthday ? html`<form class="panel small stack" id="bdayForm"><b>🎂 شو تاريخ ميلادك؟</b>
        <span class="muted">${shop.bdayGift > 0 ? `بنهديك ${shop.bdayGift >= shop.cost ? shop.rewardName : `${shop.bdayGift} ${unit}`} يوم عيدك 🎁` : 'عشان نعايدك يوم عيدك 🎉'}</span>
        <div class="row tight"><select name="day" class="grow" required aria-label="اليوم"><option value="">اليوم</option>${Array.from({ length: 31 }, (_, i) => html`<option>${i + 1}</option>`)}</select>
          <select name="month" class="grow" required aria-label="الشهر"><option value="">الشهر</option>${MONTHS.map((m, i) => html`<option value="${i + 1}">${m}</option>`)}</select>
          <button class="btn" type="submit">حفظ</button></div></form>` : ''}
    ${refUrl ? html`<div class="panel small stack"><b>👥 ادعُ صاحبك</b>
        <span class="muted">لما يزورنا أول مرة، بتاخدوا انتو التنين <b class="num">${shop.refBonus}</b> ${unit} هدية.</span>
        <div class="row"><button class="btn grow" type="button" id="shareRef">ابعتله الدعوة</button>
          <button class="btn ghost" type="button" id="copyRef">نسخ الرابط</button></div></div>` : ''}`;
}

function inviteText() {
  const { shop, refUrl } = lastData;
  return `تعال انضم لبطاقة الولاء تبعت ${shop.name} ☕ وبأول زيارة بناخد انا وإنت هدية 🎁\n${refUrl}`;
}

function draw() {
  if (!lastData || deleted) return;
  const { shop, member, google, apple, refUrl, canRate } = lastData;
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
      ${perksPanels(shop, member, refUrl, canRate)}
      ${google && !ios ? html`<a class="gw-button" href="/c/${token}/google"><img src="/img/google-wallet-button-ar.svg" alt="الإضافة إلى محفظة Google" width="309" height="50"></a>` : ''}
      ${ios && apple ? html`<a class="gw-button" href="/c/${token}/apple"><img class="apple-badge" src="/img/add-to-apple-wallet.svg" alt="Add to Apple Wallet" width="160" height="50"></a>` : ''}
      ${ios && !standalone ? html`<div class="panel small">
          <b>على الآيفون:</b> كبس على <b>مشاركة ⬆️</b> وبعدين <b>«إضافة إلى الشاشة الرئيسية»</b>، وافتح البطاقة من الأيقونة: بتفتح بسرعة وبتقدر تفعّل إشعارات النقاط والعروض 🔔
        </div>` : ''}
      ${pushPanel()}
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
  if (e.target.closest('#shareRef')) {
    const text = inviteText();
    if (navigator.share) { navigator.share({ text }).catch(() => {}); } else { window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener'); }
    return;
  }
  if (e.target.closest('#copyRef')) {
    try { await navigator.clipboard.writeText(lastData.refUrl); toast('انسخ الرابط ✅', 'ok'); } catch { prompt('انسخ الرابط:', lastData.refUrl); }
  }
});

root.addEventListener('submit', async (e) => {
  if (e.target.id !== 'bdayForm') return;
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await api(`/api/cards/${token}/birthday`, { method: 'POST', body: { day: f.get('day'), month: f.get('month') } });
    toast('انحفظ تاريخ ميلادك 🎂', 'ok');
    await load();
  } catch (err) { toast(err.message, 'bad'); }
});

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

await detectPush();
await load(true);
if (params.has('new') || params.has('gw') || params.has('apple')) history.replaceState(null, '', location.pathname);
// تحديث كل 15 ثانية والصفحة مفتوحة، عشان الزبون يشوف نقاطه وهو عالكاونتر
setInterval(() => { if (!deleted && document.visibilityState === 'visible') load(); }, 15000);
document.addEventListener('visibilitychange', () => { if (!deleted && document.visibilityState === 'visible') load(); });
