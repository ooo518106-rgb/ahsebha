// لوحة المحل: الكاشير (مسح وإضافة نقاط)، الزبائن، النشاط، رابط الانضمام، والإعدادات
import { $, $$, ago, api, cardHTML, fmt, fmtDate, html, newKey, qrSVG, render, setBrand, stampsHTML, toast } from './common.js';
import { generateKeyAndCsr } from './csr.js';
import { parseLatLng } from './rules.js';
import { startCameraScan } from './scan.js';
import { parseBirthday, readCsv, readXlsx } from './sheet.js';

const state = { me: null, shop: null, google: null, member: null, key: newKey(), stopScan: null, branch: (() => { try { return localStorage.getItem('nq_branch') || ''; } catch { return ''; } })() };
const branchName = (id) => (state.shop.locations.find((l) => l.id === id) || {}).name || '';
const view = $('#view');
const isOwner = () => state.me && state.me.user.role === 'owner';
const CALLING = { JO: '962', PS: '970', SA: '966', AE: '971', KW: '965', QA: '974', BH: '973', OM: '968', EG: '20', IQ: '964', LB: '961', SY: '963', TR: '90', US: '1' };
const COUNTRIES = { JO: 'الأردن', PS: 'فلسطين', SA: 'السعودية', AE: 'الإمارات', KW: 'الكويت', QA: 'قطر', BH: 'البحرين', OM: 'عُمان', EG: 'مصر', IQ: 'العراق', LB: 'لبنان', SY: 'سوريا', TR: 'تركيا', US: 'أمريكا' };

// ─── التشغيل والتنقل ───
async function loadMe() {
  const me = await api('/api/me');
  state.me = me;
  state.shop = me.shop;
  state.google = me.google;
  applyShop();
  $('#userName').textContent = me.user.name;
  $$('.owner-only').forEach((el) => el.classList.toggle('hidden', !isOwner()));
  $$('.admin-only').forEach((el) => el.classList.toggle('hidden', !me.user.isAdmin));
  renderSubBanner();
}

// شريط الاشتراك: كم باقي من التجربة، أو إنه الاشتراك خلص (مع زر واتساب للتفعيل)
function renderSubBanner() {
  const box = $('#subBanner');
  const sub = state.me.subscription;
  const wa = state.me.whatsapp;
  // الزر بيفتح قسم الاشتراك بالإعدادات (الدفع بـ CliQ أو الواتساب)
  const link = (text) => (isOwner() ? '#settings/billing' : wa ? `https://wa.me/${wa}?text=${encodeURIComponent(text)}` : null);
  const ask = `مرحبا، بدي أشترك بنقاطك لمحل ${state.shop.name}`;
  let tpl = null;
  if (state.me.demo) {
    // حساب العرض: بنوضّح إنه تجريبي، ومنعطي رابط بطاقة زبون وزر التجربة الحقيقية
    tpl = html`<div class="alert ok sub-banner"><div>🎬 <b>هاد محل تجريبي</b> فيه زبائن وحركات جاهزة. جرّب كل إشي براحتك، والبيانات بترجع لحالها كل يوم.</div>
      <div class="row">${state.me.demo.sampleCard ? html`<a class="btn sm ghost" href="/c/${state.me.demo.sampleCard}" target="_blank" rel="noopener">شوف بطاقة زبون</a>` : ''}
      <button class="btn sm" type="button" id="demoStart">ابدأ تجربتك المجانية</button></div></div>`;
  } else if (sub.state === 'expired') {
    tpl = html`<div class="alert bad sub-banner"><div><b>خلصت فترة ${sub.paid ? 'الاشتراك' : 'التجربة'} ⏳</b> الكاشير متوقف لحد ما تفعّل الاشتراك. زبائنك ونقاطهم محفوظين.</div>
      ${link(ask) ? html`<a class="btn sm wa" href="${link(ask)}" target="_blank" rel="noopener">فعّل الاشتراك</a>` : ''}</div>`;
  } else if (sub.state === 'trial' && isOwner()) {
    tpl = html`<div class="alert warn sub-banner"><div>🎁 <b>تجربة مجانية:</b> باقي <b class="num">${sub.daysLeft}</b> ${sub.daysLeft === 1 ? 'يوم' : 'يوم'}. الاشتراك 15 دينار بالشهر أو 150 بالسنة.</div>
      ${link(ask) ? html`<a class="btn sm wa" href="${link(ask)}" target="_blank" rel="noopener">اشترك</a>` : ''}</div>`;
  } else if (sub.state === 'active' && sub.daysLeft <= 5 && isOwner()) {
    tpl = html`<div class="alert warn sub-banner"><div>اشتراكك بيخلص بعد <b class="num">${sub.daysLeft}</b> يوم.</div>
      ${link(`مرحبا، بدي أجدد اشتراك نقاطك لمحل ${state.shop.name}`) ? html`<a class="btn sm wa" href="${link(`مرحبا، بدي أجدد اشتراك نقاطك لمحل ${state.shop.name}`)}" target="_blank" rel="noopener">جدّد</a>` : ''}</div>`;
  }
  box.classList.toggle('hidden', !tpl);
  if (tpl) render(box, tpl);
  const ds = $('#demoStart', box);
  if (ds) ds.onclick = async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); location.href = '/#start'; };
  // رابط قسم الاشتراك بيفتح بنفس الصفحة (مش تبويب جديد)
  $$('a[href^="#"]', box).forEach((a) => a.removeAttribute('target'));
}

function applyShop() {
  setBrand(state.shop.color, { theme: false });
  $('#shopLogo').src = state.shop.logo;
  $('#shopName').textContent = state.shop.name;
  document.title = `${state.shop.name} — نقاطك`;
}

const VIEWS = { cashier, members, activity, join: joinView, offers, settings, admin };
function route() {
  stopCamera();
  $('#dlg').onclose = null;
  let [tab, sub] = (location.hash.slice(1) || 'cashier').split('/');
  if (!VIEWS[tab] || ((tab === 'settings' || tab === 'offers') && !isOwner()) || (tab === 'admin' && !state.me.user.isAdmin)) tab = 'cashier';
  state.sub = sub || null;
  state.nav = (state.nav || 0) + 1;
  $$('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  // انتقال ناعم بين التبويبات بالمتصفحات اللي بتدعمه
  const show = () => { VIEWS[tab](); };
  if (document.startViewTransition && state.tab && state.tab !== tab && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(show);
  else show();
  state.tab = tab;
}

async function boot() {
  try {
    await loadMe();
  } catch (e) {
    if (e.status === 401) { location.replace('/#login'); return; }
    render(view, html`<div class="panel center"><p>${e.message}</p><button class="btn" id="retry">جرّب كمان مرة</button></div>`);
    $('#retry').onclick = boot;
    return;
  }
  window.addEventListener('hashchange', route);
  $('#logout').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); location.replace('/#login'); };
  $('#dlgClose').onclick = () => $('#dlg').close();
  route();
}

// ─── تبويبات فرعية: الصفحات الطويلة بتنعرض قسم قسم بدل ما تكون كلها ورا بعض ───
function subnav(key, groups) {
  return html`<nav class="subnav" data-subnav="${key}" role="tablist" aria-label="الأقسام">${groups.filter(Boolean).map((g) => html`<button type="button" role="tab" data-g="${g[0]}">${g[1]}</button>`)}</nav>`;
}
function bindSubnav(key, first) {
  const nav = $(`[data-subnav="${key}"]`);
  const ids = $$('[data-g]', nav).map((b) => b.dataset.g);
  const show = (id) => {
    $$('[data-group]', view).forEach((el) => el.classList.toggle('hidden', el.dataset.group !== id));
    $$('[data-g]', nav).forEach((b) => { const on = b.dataset.g === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    try { localStorage.setItem(`nq_sub_${key}`, id); } catch { /* اختياري */ }
  };
  nav.onclick = (e) => {
    const b = e.target.closest('[data-g]');
    if (!b) return;
    show(b.dataset.g);
    history.replaceState(null, '', `#${key}/${b.dataset.g}`);
    b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  };
  let saved = null;
  try { saved = localStorage.getItem(`nq_sub_${key}`); } catch { /* اختياري */ }
  const start = [state.sub, saved, first].find((id) => id && ids.includes(id)) || ids[0];
  show(start);
  const on = $('.on', nav);
  if (on && nav.scrollWidth > nav.clientWidth) on.scrollIntoView({ inline: 'center', block: 'nearest' });
  return show;
}

function openDialog(title, tpl) {
  $('#dlgTitle').textContent = title;
  render($('#dlgBody'), tpl);
  const d = $('#dlg');
  if (!d.open) d.showModal();
  return $('#dlgBody');
}

const waLink = (phone, text) => {
  const intl = phone.startsWith('0') ? (CALLING[state.shop.country] || '') + phone.replace(/^0+/, '') : phone;
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
};
const cardMessage = (m, url) => `أهلاً ${m.name}! هاي بطاقة الولاء تبعتك عند ${state.shop.name} 🎁\n${url}\nاحفظها بمحفظة الجوال واعرضها مع كل طلب.`;

// ─── الكاشير ───
function stopCamera() {
  if (state.stopScan) { state.stopScan(); state.stopScan = null; }
}

// ✅ خطوات البداية للمحل الجديد
const STEPS = {
  logo: ['ارفع شعار المحل', '#settings'],
  branch: ['حط موقع المحل (عشان تطلع البطاقة لما يقرّب الزبون)', '#settings'],
  settings: ['اختار المكافأة ولون البطاقة', '#settings'],
  poster: ['اطبع ملصق الـ QR وحطه عالكاونتر', '#join'],
  customer: ['ضيف أول زبون (جرّب على حالك)', '#join'],
  alerts: ['فعّل تنبيهاتك على جوالك', '#settings/alerts'],
};
function onboardingCard() {
  const ob = state.me.onboarding;
  if (!ob) return '';
  const done = ob.steps.filter((x) => x.done).length;
  return html`<section class="panel stack onboard" style="margin-bottom:14px">
    <div class="row" style="justify-content:space-between"><h2 style="margin:0">🚀 جهّز محلك</h2><span class="small muted">${done} من ${ob.steps.length}</span></div>
    <div class="bar"><i style="width:${Math.round((done / ob.steps.length) * 100)}%"></i></div>
    <ul class="checklist">${ob.steps.map((x) => html`<li class="${x.done ? 'done' : ''}">${x.done ? '✅' : '⬜'} ${x.done ? STEPS[x.key][0] : html`<a href="${STEPS[x.key][1]}">${STEPS[x.key][0]}</a>`}</li>`)}</ul>
    <button class="linkish small" type="button" id="obHide">إخفاء</button>
  </section>`;
}

function cashier() {
  render(view, html`
    ${onboardingCard()}
    <div class="grid2" style="align-items:start">
      <section class="panel stack">
        <h2>امسح بطاقة الزبون</h2>
        <div class="scanner hidden" id="scanner"><video id="video" muted playsinline></video></div>
        <button class="btn big block" id="camBtn" type="button">📷 افتح الكاميرا</button>
        <form class="row" id="findForm">
          <input class="grow" id="code" placeholder="رقم البطاقة أو الجوال" autocomplete="off" enterkeyhint="search">
          <button class="btn ghost" type="submit">بحث</button>
        </form>
        <p class="hint">قارئ QR موصول بالكمبيوتر؟ خلّي المؤشر بالخانة وامسح.</p>
        <button class="btn soft block" id="newBtn" type="button">+ زبون جديد</button>
        ${state.me.user.branchId ? html`<p class="small muted center">📍 فرعك: <b>${branchName(state.me.user.branchId)}</b></p>`
          : isOwner() && state.shop.locations.length > 1 ? html`<label class="small">📍 الفرع: <select id="branchSel" style="width:auto">
              <option value="">بدون</option>${state.shop.locations.map((l) => html`<option value="${l.id}" ${l.id === state.branch ? 'selected' : ''}>${l.name}</option>`)}</select></label>` : ''}
      </section>
      <section id="memberPanel"></section>
    </div>`);
  showMember(state.member);
  if (matchMedia('(pointer: fine)').matches) $('#code').focus();

  $('#camBtn').onclick = async () => {
    if (state.stopScan) { stopCamera(); $('#scanner').classList.add('hidden'); $('#camBtn').textContent = '📷 افتح الكاميرا'; return; }
    $('#scanner').classList.remove('hidden');
    $('#camBtn').textContent = 'سكّر الكاميرا';
    try {
      state.stopScan = await startCameraScan($('#video'), (code) => findMember(code, true));
    } catch (e) {
      $('#scanner').classList.add('hidden');
      $('#camBtn').textContent = '📷 افتح الكاميرا';
      toast(e.name === 'NotAllowedError' ? 'اسمح للمتصفح يستخدم الكاميرا' : e.message || 'ما قدرنا نفتح الكاميرا', 'bad');
    }
  };
  $('#findForm').onsubmit = (e) => { e.preventDefault(); const v = $('#code').value.trim(); if (v) findMember(v); };
  $('#newBtn').onclick = () => newMemberDialog();
  const ob = $('#obHide');
  if (ob) ob.onclick = async () => { await api('/api/shop/onboard', { method: 'POST', body: { step: 'dismissed' } }).catch(() => {}); state.me.onboarding = null; cashier(); };
  const bs = $('#branchSel');
  if (bs) bs.onchange = () => { state.branch = bs.value; try { localStorage.setItem('nq_branch', bs.value); } catch { /* اختياري */ } };
}

async function findMember(code, fromCamera = false) {
  try {
    const { member } = await api(`/api/members/lookup?code=${encodeURIComponent(code)}`);
    selectMember(member);
    if (fromCamera) { stopCamera(); $('#scanner')?.classList.add('hidden'); const b = $('#camBtn'); if (b) b.textContent = '📷 امسح الزبون التالي'; }
    const input = $('#code');
    if (input) input.value = '';
  } catch (e) {
    toast(e.message, 'bad');
  }
}

function selectMember(m) {
  state.member = m;
  state.key = newKey();
  if ((location.hash || '#cashier') !== '#cashier') location.hash = '#cashier';
  else showMember(m);
}

function memberSummary(m) {
  const s = state.shop;
  const p = m.progress;
  const stamps = s.programType === 'stamps';
  const filled = p.available && !p.toward ? p.cost : p.toward;
  return html`
    <div class="row" style="justify-content:space-between;align-items:flex-end">
      <div><div class="small muted">${stamps ? 'الأختام' : 'الرصيد'}</div><div class="balance num">${stamps ? `${filled}/${p.cost}` : fmt(m.balance)}</div></div>
      <div class="small muted" style="text-align:left">زيارات: <span class="num">${m.visits}</span><br>آخر زيارة: ${ago(m.lastVisit)}</div>
    </div>
    ${stamps ? stampsHTML(p.cost, filled) : html`<div class="bar"><i style="width:${p.pct}%"></i></div>`}
    ${p.available
      ? html`<div class="reward-ready">🎁 ${p.available > 1 ? `${p.available} مكافآت جاهزة` : 'مكافأة جاهزة'}: ${s.rewardName}</div>`
      : html`<div class="small muted">باقي <b class="num">${p.remaining}</b> ${s.unit} لـ ${s.rewardName}</div>`}`;
}

function showMember(m) {
  const panel = $('#memberPanel');
  if (!panel) return;
  if (!m) {
    render(panel, html`<div class="panel center muted" style="padding:40px 16px"><div style="font-size:2.5rem">🎫</div><p>امسح QR الزبون أو دوّر عليه برقم البطاقة أو الجوال</p></div>`);
    return;
  }
  const s = state.shop;
  const stamps = s.programType === 'stamps';
  render(panel, html`
    <div class="panel stack">
      <div class="member-head">
        <div class="avatar">${m.name.trim().charAt(0)}</div>
        <div class="grow" style="flex:1;min-width:0"><b>${m.name}</b><div class="small muted"><span class="num">${m.cardNo}</span> · <span class="num">${m.phone}</span></div></div>
        <button class="btn ghost sm" id="closeMember" type="button" aria-label="إلغاء">✕</button>
      </div>
      ${memberBadges(m)}
      ${memberSummary(m)}
      ${stamps
        ? html`<div class="row"><div class="stepper"><button class="btn ghost" type="button" id="minus">−</button><output id="count">1</output><button class="btn ghost" type="button" id="plus">+</button></div>
            <button class="btn big grow" id="earnBtn" type="button">أضف ختم</button></div>`
        : html`<form class="stack" id="earnForm">
            <label for="amount">مبلغ الفاتورة (${s.currency})</label>
            <div class="row"><input class="grow num" id="amount" type="number" inputmode="decimal" min="0" step="0.001" placeholder="0.00" style="font-size:1.3rem" required>
            <button class="btn big" id="earnBtn" type="submit">أضف</button></div>
            <div class="small muted" id="preview">&nbsp;</div>
          </form>`}
      <button class="btn ${m.progress.available ? 'big' : 'ghost'} block" id="redeemBtn" type="button" ${m.progress.available ? '' : 'disabled'}>🎁 صرف المكافأة: ${s.rewardName}</button>
      <div id="memberCoupons"></div>
      ${s.perks.creditOn || m.credit > 0 ? html`<div class="credit-box stack">
          <div class="row" style="justify-content:space-between"><b>💳 الرصيد</b><b class="num">${fmt(m.credit)} ${s.currency}</b></div>
          <div class="row"><input class="grow num" id="creditAmt" type="number" inputmode="decimal" min="0" step="0.001" placeholder="المبلغ">
            <button class="btn ghost" type="button" id="spendBtn" ${m.credit > 0 ? '' : 'disabled'}>ادفع من الرصيد</button>
            ${s.perks.creditOn ? html`<button class="btn soft" type="button" id="topupBtn">اشحن${s.perks.creditBonus ? ` +${s.perks.creditBonus}%` : ''}</button>` : ''}</div>
        </div>` : ''}
      <button class="btn ghost block" id="openMember" type="button">ملف الزبون ورابط بطاقته</button>
    </div>`);
  loadMemberCoupons(m);
  bindCredit(m);

  $('#closeMember').onclick = () => { state.member = null; showMember(null); };
  $('#openMember').onclick = () => memberDialog(m.id);
  $('#redeemBtn').onclick = () => redeem(m);
  if (stamps) {
    let count = 1;
    const sync = () => { $('#count').value = count; $('#count').textContent = count; $('#earnBtn').textContent = count === 1 ? 'أضف ختم' : `أضف ${count} أختام`; };
    $('#minus').onclick = () => { count = Math.max(1, count - 1); sync(); };
    $('#plus').onclick = () => { count = Math.min(50, count + 1); sync(); };
    $('#earnBtn').onclick = () => earn(m, { count });
  } else {
    const amount = $('#amount');
    const { mult, label } = perkMult(m);
    amount.oninput = () => {
      const pts = Math.floor(Math.floor(Number(amount.value) * s.pointsPerUnit + 1e-9) * mult + 1e-9);
      $('#preview').textContent = pts > 0 ? `+${fmt(pts)} نقطة${label}` : ' ';
    };
    $('#earnForm').onsubmit = (e) => { e.preventDefault(); earn(m, { amount: amount.value }); };
    if (matchMedia('(pointer: fine)').matches) amount.focus();
  }
}

// كوبونات الزبون عند الكاشير، وكل كوبون بينصرف مرة وحدة
async function loadMemberCoupons(m) {
  if (!$('#memberCoupons')) return;
  let r;
  try { r = await api(`/api/members/${m.id}/coupons`); } catch { return; }
  const box = $('#memberCoupons');
  if (!box || (state.member && state.member.id !== m.id)) return;
  render(box, r.coupons.length ? html`<div class="stack">${r.coupons.map((cp) => html`<div class="coupon row"><div class="grow"><b>🎟️ ${cp.title}</b>${cp.details ? html`<div class="small muted">${cp.details}</div>` : ''}<div class="small muted">لحد ${fmtDay(cp.expiresAt)}</div></div>
      <button class="btn sm" type="button" data-use="${cp.id}">صرف ✓</button></div>`)}</div>` : '');
  $$('[data-use]', box).forEach((b) => {
    b.onclick = async () => {
      if (!confirm('صرف هالكوبون للزبون؟')) return;
      try { await api(`/api/members/${m.id}/coupons/${b.dataset.use}/use`, { method: 'POST' }); toast('انصرف الكوبون ✅', 'ok'); loadMemberCoupons(m); } catch (e) { toast(e.message, 'bad'); }
    };
  });
}

// الرصيد المدفوع: شحن (مع الهدية) ودفع منه
function bindCredit(m) {
  const amt = $('#creditAmt');
  if (!amt) return;
  const go = async (kind) => {
    const v = Number(amt.value);
    if (!(v > 0)) { toast('اكتب المبلغ', 'bad'); amt.focus(); return; }
    const cur = state.shop.currency;
    if (!confirm(kind === 'topup' ? `شحن ${v} ${cur} لـ ${m.name}${state.shop.perks.creditBonus ? ` (+${state.shop.perks.creditBonus}% هدية)` : ''}؟` : `دفع ${v} ${cur} من رصيد ${m.name}؟`)) return;
    try {
      const r = await api(`/api/members/${m.id}/credit/${kind}`, { method: 'POST', body: { amount: v, key: newKey(), branch: state.branch } });
      state.member = r.member;
      toast(kind === 'topup' ? `انشحن ✅ رصيده ${fmt(r.member.credit)} ${cur}` : `انخصم ✅ باقي ${fmt(r.member.credit)} ${cur}`, 'ok');
      if (r.push) pushToast(r.push);
      showMember(r.member);
      if (kind === 'spend' && state.shop.programType === 'points' && $('#amount')) { $('#amount').value = v; $('#amount').dispatchEvent(new Event('input')); $('#amount').focus(); }
    } catch (e) { toast(e.message, 'bad'); }
  };
  $('#spendBtn').onclick = () => go('spend');
  const t = $('#topupBtn');
  if (t) t.onclick = () => go('topup');
}

// شارات الزبون عند الكاشير: عيد ميلاده، مستواه، والعروض الشغّالة
function memberBadges(m) {
  const b = [];
  if (m.birthdayToday) b.push(html`<span class="chip on">🎂 عيد ميلاده اليوم!</span>`);
  if (m.tier) b.push(html`<span class="chip">${m.tier.icon} ${m.tier.name}</span>`);
  if (state.shop.perks.boostNow > 1) b.push(html`<span class="chip on">⏰ نقاط ×${state.shop.perks.boostNow} هلق</span>`);
  else if (m.boostUntil) b.push(html`<span class="chip on">💤 راجع بعد غيبة: ×2</span>`);
  return b.length ? html`<div class="days">${b}</div>` : '';
}

// تقدير المضاعفة للمعاينة (السيرفر هو اللي بيحسب النهائي)
function perkMult(m) {
  const time = Math.max(state.shop.perks.boostNow || 1, m.boostUntil && m.boostUntil > Date.now() ? 2 : 1);
  const tier = m.tier ? m.tier.mult : 1;
  const mult = time * tier;
  return { mult, label: mult > 1 ? ` (×${mult})` : '' };
}

// لو السيرفر رد إنه الاشتراك خلص، منحدّث الشريط فوق
async function onSubError(e) {
  if (e.status === 402) { try { await loadMe(); } catch { /* بنضل على الرسالة */ } }
}

async function earn(m, body) {
  const btn = $('#earnBtn');
  btn.disabled = true;
  try {
    const r = await api(`/api/members/${m.id}/earn`, { method: 'POST', body: { ...body, key: state.key, branch: state.branch } });
    state.key = newKey();
    state.member = r.member;
    toast(r.duplicate ? 'هاي الحركة انسجلت قبل' : `+${fmt(r.delta)} ${state.shop.unit} لـ ${m.name}${r.reasons && r.reasons.length ? ` (${r.reasons.join('، ')})` : ''}`, 'ok');
    if (r.refBonus) toast(`👥 +${fmt(r.refBonus)} هدية الدعوة إله ولصاحبه`, 'ok');
    if (r.push) pushToast(r.push);
    showMember(r.member);
  } catch (e) {
    toast(e.message, 'bad');
    btn.disabled = false;
    onSubError(e);
  }
}

// شو صار بإشعار الزبون بعد إضافة النقاط
function pushToast(p) {
  if (!p.devices) toast('🔕 الزبون مش مفعّل الإشعارات على بطاقته');
  else if (p.pending || p.sent) toast('🔔 انبعت إشعار للزبون', 'ok');
  else toast(`⚠️ إشعار الزبون ما انبعت (${p.reason || 'خطأ'})`, 'bad');
}

async function redeem(m) {
  if (!confirm(`صرف «${state.shop.rewardName}» لـ ${m.name}؟`)) return;
  const btn = $('#redeemBtn');
  btn.disabled = true;
  try {
    const r = await api(`/api/members/${m.id}/redeem`, { method: 'POST', body: { key: state.key, branch: state.branch } });
    state.key = newKey();
    state.member = r.member;
    toast(`🎁 انصرفت المكافأة لـ ${m.name}`, 'ok');
    showMember(r.member);
  } catch (e) {
    toast(e.message, 'bad');
    btn.disabled = false;
    onSubError(e);
  }
}

// زبون جديد: الزبون بيمسح QR الانضمام وبيكتب اسمه ورقمه بنفسه (الموظف ما بيشوف رقمه)،
// والمالك بس بيقدر يكتب البيانات بإيده للي ما معه نت
// 📥 استيراد زبائن من Excel أو CSV: بنقرأ الملف بالجوال، بنطابق الأعمدة، وبنبعت على دفعات
const FIELD_HINTS = {
  name: [/اسم|name/i],
  phone: [/جوال|موبايل|هاتف|رقم|phone|mobile|tel/i],
  balance: [/رصيد|نقاط|أختام|balance|points|stamps/i],
  birthday: [/ميلاد|birth/i],
};
function importDialog(done) {
  const body = openDialog('📥 استيراد زبائن', html`<div class="stack">
    <p class="small">ملف Excel (‎.xlsx) أو CSV، كل زبون بسطر. الأعمدة: <b>الاسم، الجوال</b>، و(اختياري) <b>الرصيد، عيد الميلاد</b>.</p>
    <button class="btn ghost sm" type="button" id="tpl">⬇️ نزّل نموذج جاهز</button>
    <label class="btn" style="margin:0">اختار الملف<input type="file" id="sheetFile" accept=".xlsx,.csv,.txt,text/csv" class="hidden"></label>
    <div id="importBody"></div>
  </div>`);
  $('#tpl', body).onclick = () => {
    const blob = new Blob(['\ufeffالاسم,الجوال,الرصيد,عيد الميلاد\r\nسارة أحمد,0791234567,40,21/5\r\n'], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'nuqatak-customers.csv';
    a.click();
  };
  $('#sheetFile', body).onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    let rows;
    try {
      rows = /\.xlsx$/i.test(file.name) ? await readXlsx(await file.arrayBuffer()) : readCsv(await file.text());
    } catch (err) { toast(err.message || 'ما قدرنا نقرأ الملف', 'bad'); return; }
    rows = rows.filter((r) => r.some((x) => x));
    if (!rows.length) { toast('الملف فاضي', 'bad'); return; }
    // أول سطر عناوين؟ بنطابق الأعمدة منه، وإلا بنفترض الترتيب: الاسم، الجوال، الرصيد، الميلاد
    const head = rows[0];
    const map = {};
    for (const [field, res] of Object.entries(FIELD_HINTS)) map[field] = head.findIndex((h) => res.some((re) => re.test(h)));
    const hasHeader = map.name >= 0 || map.phone >= 0;
    if (!hasHeader) Object.assign(map, { name: 0, phone: 1, balance: 2, birthday: 3 });
    const data = hasHeader ? rows.slice(1) : rows;
    const cols = Math.max(...rows.map((r) => r.length));
    const colName = (i) => (hasHeader ? head[i] || `عمود ${i + 1}` : `عمود ${i + 1}`);
    const sel = (field, label) => html`<div class="field grow"><label>${label}</label><select data-field="${field}">
      <option value="-1">—</option>${Array.from({ length: cols }, (_, i) => html`<option value="${i}" ${map[field] === i ? 'selected' : ''}>${colName(i)}</option>`)}</select></div>`;
    const box = $('#importBody', body);
    render(box, html`<p class="small muted">لقينا <b class="num">${data.length}</b> زبون. تأكد من الأعمدة:</p>
      <div class="row">${sel('name', 'الاسم')}${sel('phone', 'الجوال')}</div>
      <div class="row">${sel('balance', 'الرصيد')}${sel('birthday', 'عيد الميلاد')}</div>
      <div id="preview" class="small"></div>
      <button class="btn big block" type="button" id="doImport">استورد ${data.length} زبون</button>
      <div id="importResult"></div>`);
    const toRow = (r, i) => {
      const b = map.birthday >= 0 ? parseBirthday(r[map.birthday]) : null;
      return { line: i + (hasHeader ? 2 : 1), name: r[map.name] || '', phone: r[map.phone] || '', balance: map.balance >= 0 ? r[map.balance] : 0, bdayDay: b?.day, bdayMonth: b?.month };
    };
    const preview = () => render($('#preview', box), html`<table class="mini">${data.slice(0, 4).map((r, i) => {
      const x = toRow(r, i);
      return html`<tr><td>${x.name}</td><td class="num">${x.phone}</td><td class="num">${x.balance || ''}</td><td>${x.bdayDay ? `${x.bdayDay}/${x.bdayMonth}` : ''}</td></tr>`;
    })}</table>`);
    preview();
    $$('[data-field]', box).forEach((s2) => { s2.onchange = () => { map[s2.dataset.field] = Number(s2.value); preview(); }; });
    $('#doImport', box).onclick = async () => {
      if (map.name < 0 || map.phone < 0) { toast('اختار عمود الاسم وعمود الجوال', 'bad'); return; }
      const btn = $('#doImport', box);
      btn.disabled = true;
      const all = data.map(toRow);
      let added = 0;
      const skipped = [];
      try {
        for (let i = 0; i < all.length; i += 50) {
          btn.textContent = `جاري الاستيراد… ${i} من ${all.length}`;
          const r = await api('/api/members/import', { method: 'POST', body: { rows: all.slice(i, i + 50) } });
          added += r.added;
          skipped.push(...r.skipped);
        }
      } catch (err) { toast(err.message, 'bad'); }
      btn.textContent = 'خلص ✅';
      render($('#importResult', box), html`<p class="alert ok small">انضاف <b class="num">${added}</b> زبون${skipped.length ? `، وتخطّينا ${skipped.length}` : ''}.</p>
        ${skipped.length ? html`<ul class="small muted">${skipped.slice(0, 12).map((x) => html`<li>سطر ${x.line}: ${x.reason}</li>`)}</ul>` : ''}`);
      done();
    };
  };
}

function newMemberDialog() {
  const s = state.shop;
  const body = openDialog('زبون جديد', html`
    <div class="stack">
      <div class="center"><div style="width:220px;margin:0 auto">${qrSVG(s.joinUrl, 'رابط الانضمام')}</div>
        <p><b>خلّي الزبون يمسح هالرمز بكاميرا جواله</b></p>
        <p class="small muted">بيكتب اسمه ورقمه بنفسه وبتطلعله بطاقته. بعدها بيعرضلك البطاقة وبتمسحها لتضيفله النقاط.</p></div>
      ${isOwner() ? html`<details><summary class="btn ghost block">أو اكتب بياناته إنت (للي ما معه نت)</summary>
        <form class="stack" id="nm" novalidate style="margin-top:10px">
          <div class="field"><label for="nmName">الاسم</label><input id="nmName" name="name" required maxlength="60"></div>
          <div class="field"><label for="nmPhone">رقم الجوال</label><input id="nmPhone" name="phone" type="tel" inputmode="tel" dir="ltr" required></div>
          <p class="error" id="nmErr"></p>
          <button class="btn big block" type="submit">إنشاء البطاقة</button>
        </form></details>` : ''}
    </div>`);
  if (!isOwner()) return;
  $('#nm', body).onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/members', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      selectMember(r.member);
      shareCard(r.member, r.cardUrl, 'انعملت البطاقة ✅');
    } catch (err) {
      if (err.status === 409 && err.data.memberId) {
        toast('هالرقم إله بطاقة، فتحناها', 'ok');
        $('#dlg').close();
        const d = await api(`/api/members/${err.data.memberId}`);
        selectMember(d.member);
        return;
      }
      $('#nmErr', body).textContent = err.message;
    }
  };
}

// رابط البطاقة: QR يمسحه الزبون بجواله، أو واتساب، أو نسخ
function cardLinkHTML(m, url) {
  return html`
    <div class="center"><div style="width:180px;margin:0 auto">${qrSVG(url, 'رابط بطاقة الزبون')}</div>
      <p class="small muted">خلي الزبون يمسح هاد الرمز بكاميرا جواله ليفتح بطاقته ويحفظها بالمحفظة</p></div>
    <div class="row">
      ${m.phoneHidden ? '' : html`<a class="btn grow" href="${waLink(m.phone, cardMessage(m, url))}" target="_blank" rel="noopener">واتساب</a>`}
      <button class="btn ghost grow" type="button" data-copy="${url}">نسخ الرابط</button>
      <a class="btn ghost grow" href="${url}" target="_blank" rel="noopener">فتح</a>
    </div>`;
}

function bindCopy(root) {
  $$('[data-copy]', root).forEach((b) => {
    b.onclick = async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); toast('انسخ ✅', 'ok'); } catch { prompt('انسخ الرابط:', b.dataset.copy); }
    };
  });
}

function shareCard(m, url, title) {
  const body = openDialog(title, html`<div class="stack"><p><b>${m.name}</b> · <span class="num">${m.cardNo}</span></p>${cardLinkHTML(m, url)}</div>`);
  bindCopy(body);
}

const KIND = { earn: 'إضافة', redeem: 'مكافأة', adjust: 'تعديل' };
function txnRow(t, withMember = false) {
  const plus = t.delta > 0;
  return html`<li class="${withMember ? 'click' : ''}" data-member="${withMember ? t.memberId : ''}">
    <div class="main"><b>${withMember ? t.member : KIND[t.kind]}${t.kind === 'redeem' ? ' 🎁' : ''}</b>
      <span class="small muted">${withMember ? `${KIND[t.kind]} · ` : ''}${t.amount ? `${fmt(t.amount)} ${state.shop.currency} · ` : ''}${t.note ? `${t.note} · ` : ''}${t.branch && state.shop.locations.length > 1 ? `📍 ${branchName(t.branch)} · ` : ''}${t.by || ''} · ${ago(t.at)}</span></div>
    <span class="delta num ${plus ? 'plus' : 'minus'}">${plus ? '+' : ''}${fmt(t.delta)}</span></li>`;
}

// حالة إشعارات الويب عند الزبون: مفعّلة؟ وآخر إشعار وصل ولا لأ (ومع السبب لو ما وصل)
function pushLine(p) {
  if (!p || !p.devices) return html`<div class="small muted">🔕 ما فعّل إشعارات البطاقة</div>`;
  const last = !p.lastAt ? 'لسا ما انبعتله إشعار'
    : p.lastError ? html`آخر إشعار ما وصل ${ago(p.lastAt)} (<bdi>${p.lastError}</bdi>)` : `آخر إشعار انبعت ${ago(p.lastAt)} ✅`;
  return html`<div class="small ${p.lastError ? 'error' : 'muted'}">🔔 الإشعارات مفعّلة${p.devices > 1 ? ` على ${p.devices} أجهزة` : ''} · ${last}</div>`;
}

async function memberDialog(id) {
  let d;
  try { d = await api(`/api/members/${id}`); } catch (e) { toast(e.message, 'bad'); return; }
  const m = d.member;
  const body = openDialog(m.name, html`
    <div class="stack">
      <div class="small muted"><span class="num">${m.cardNo}</span> · <span class="num">${m.phone}</span> · من ${fmtDate(m.createdAt)} ${m.inWallet ? html` · <span class="badge ok">بالمحفظة</span>` : ''}</div>
      ${memberSummary(m)}
      ${m.expiresAt ? html`<div class="small muted">⏳ نقاطه بتنتهي ${fmtDay(m.expiresAt)} إذا ما زار</div>` : ''}
      ${m.birthday ? html`<div class="small muted">🎂 عيد ميلاده: ${Number(m.birthday.slice(3))}/${Number(m.birthday.slice(0, 2))}</div>` : ''}
      ${pushLine(d.push)}
      ${state.shop.perks.creditOn || m.credit > 0 ? html`<details id="creditHist"><summary class="btn ghost block">💳 الرصيد: ${fmt(m.credit)} ${state.shop.currency}</summary><div class="small muted" style="margin-top:8px">جاري التحميل…</div></details>` : ''}
      <button class="btn block" id="useMember" type="button">استخدمه بالكاشير</button>
      <details><summary class="btn ghost block">رابط البطاقة (واتساب / QR)</summary><div style="margin-top:10px">${cardLinkHTML(m, d.cardUrl)}</div></details>
      ${isOwner() ? html`<details><summary class="btn ghost block">تعديل الرصيد يدوياً</summary>
        <form class="stack" id="adj" style="margin-top:10px">
          <div class="row"><input class="grow num" name="delta" type="number" step="1" placeholder="+10 أو -10" required><input class="grow" name="note" placeholder="السبب" required maxlength="120"></div>
          <button class="btn ghost block" type="submit">حفظ التعديل</button>
        </form></details>` : ''}
      <h3 style="font-size:1rem">آخر الحركات</h3>
      ${d.txns.length ? html`<ul class="list">${d.txns.map((t) => txnRow(t))}</ul>` : html`<p class="muted small">ما في حركات لسا</p>`}
      ${isOwner() ? html`<button class="btn ghost block" id="delMember" type="button" style="color:var(--bad)">حذف الزبون وكل بياناته</button>` : ''}
    </div>`);
  bindCopy(body);
  const ch = $('#creditHist', body);
  if (ch) ch.ontoggle = async () => {
    if (!ch.open || ch.dataset.loaded) return;
    ch.dataset.loaded = '1';
    try {
      const r = await api(`/api/members/${m.id}/credit`);
      render(ch.querySelector('div'), r.history.length ? html`<ul class="list">${r.history.map((x) => html`<li><div class="main"><b>${x.note ? `${x.note} ${x.kind === 'topup' ? '+' : '−'}${fmt(x.amount)}` : x.kind === 'topup' ? `شحن ${fmt(x.amount)}${x.bonus ? ` + ${fmt(x.bonus)} هدية` : ''}` : `دفع ${fmt(x.amount)}`}</b>
        <span class="small muted">${x.by || ''} · ${ago(x.at)}</span></div></li>`)}</ul>` : html`<p>ما في حركات رصيد.</p>`);
    } catch (e) { render(ch.querySelector('div'), html`<p class="alert bad">${e.message}</p>`); }
  };
  $('#useMember', body).onclick = () => { $('#dlg').close(); selectMember(m); };
  const del = $('#delMember', body);
  if (del) del.onclick = async () => {
    if (!confirm(`حذف ${m.name} نهائياً مع نقاطه وكل سجله؟ (مثلاً لما يطلب الزبون حذف بياناته)`)) return;
    try {
      await api(`/api/members/${m.id}`, { method: 'DELETE' });
      if (state.member && state.member.id === m.id) state.member = null;
      $('#dlg').close();
      toast('انحذف الزبون', 'ok');
      if ((location.hash || '#cashier') === '#cashier') showMember(state.member);
    } catch (err) { toast(err.message, 'bad'); }
  };
  const adj = $('#adj', body);
  if (adj) {
    const key = newKey();
    adj.onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(adj);
      try {
        await api(`/api/members/${m.id}/adjust`, { method: 'POST', body: { delta: Number(f.get('delta')), note: f.get('note'), key } });
        toast('انحفظ التعديل', 'ok');
        if (state.member && state.member.id === m.id) state.member = null;
        memberDialog(m.id);
      } catch (err) { toast(err.message, 'bad'); }
    };
  }
}

// ─── الزبائن ───
function members() {
  render(view, html`
    <section class="panel stack">
      <div class="row"><input class="grow" id="q" type="search" placeholder="دوّر بالاسم أو الجوال أو رقم البطاقة"><button class="btn soft" id="addM" type="button">+ زبون</button>${isOwner() ? html`<button class="btn ghost" id="importM" type="button">📥 استيراد</button>` : ''}</div>
      <p class="small muted" id="count"></p>
      <ul class="list" id="mlist"></ul>
      <button class="btn ghost block hidden" id="more" type="button">عرض المزيد</button>
    </section>`);
  let offset = 0;
  let q = '';
  let timer;
  const load = async (append = false) => {
    try {
      const r = await api(`/api/members?q=${encodeURIComponent(q)}&offset=${offset}`);
      const items = r.members.map((m) => html`<li class="click" data-member="${m.id}">
        <div class="avatar" style="width:38px;height:38px;font-size:1rem">${m.name.trim().charAt(0)}</div>
        <div class="main"><b>${m.name}</b><span class="small muted"><span class="num">${m.phone}</span> · ${ago(m.lastVisit || m.createdAt)}</span></div>
        <span class="num" style="font-weight:800">${state.shop.programType === 'stamps' ? `${m.progress.toward}/${m.progress.cost}` : fmt(m.balance)}</span>
        ${m.progress.available ? html`<span class="badge ok">🎁</span>` : ''}</li>`);
      const list = $('#mlist');
      if (!list) return;
      if (append) list.insertAdjacentHTML('beforeend', items.join(''));
      else render(list, html`${items}`);
      $('#count').textContent = `${fmt(r.total)} زبون${q ? ' مطابق' : ''}`;
      $('#more').classList.toggle('hidden', offset + r.members.length >= r.total);
    } catch (e) { toast(e.message, 'bad'); }
  };
  $('#q').oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => { q = e.target.value.trim(); offset = 0; load(); }, 250); };
  $('#more').onclick = () => { offset += 50; load(true); };
  $('#addM').onclick = () => newMemberDialog();
  const im = $('#importM');
  if (im) im.onclick = () => importDialog(() => { offset = 0; load(); });
  $('#mlist').onclick = (e) => { const li = e.target.closest('[data-member]'); if (li) memberDialog(li.dataset.member); };
  $('#dlg').onclose = () => { offset = 0; load(); };
  load();
}

// ─── النشاط ───
async function activity() {
  render(view, html`<p class="center muted">جاري التحميل…</p>`);
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const week = new Date(day); week.setDate(day.getDate() - 6);
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  let r;
  const nav = state.nav;
  try { r = await api(`/api/activity?dayStart=${+day}&weekStart=${+week}&monthStart=${+month}`); } catch (e) { if (nav === state.nav) render(view, html`<p class="alert bad">${e.message}</p>`); return; }
  if (nav !== state.nav) return; // انتقل لتبويب تاني قبل ما توصل الأرقام
  const s = r.stats;
  render(view, html`
    <div class="stats">
      <div class="stat"><b class="num">${fmt(s.members)}</b><span class="small muted">كل الزبائن</span></div>
      <div class="stat"><b class="num">${fmt(s.newWeek)}</b><span class="small muted">جدد آخر 7 أيام</span></div>
      <div class="stat"><b class="num">${fmt(s.visitsDay)}</b><span class="small muted">زيارات اليوم</span></div>
      <div class="stat"><b class="num">${fmt(s.earnedMonth)}</b><span class="small muted">${state.shop.programType === 'stamps' ? 'أختام' : 'نقاط'} هالشهر</span></div>
      <div class="stat"><b class="num">${fmt(s.redeemedMonth)}</b><span class="small muted">مكافآت هالشهر</span></div>
    </div>
    <section class="panel" style="margin-top:14px">
      <h2>آخر الحركات</h2>
      ${r.recent.length ? html`<ul class="list" id="alist">${r.recent.map((t) => txnRow(t, true))}</ul>` : html`<p class="muted">لسا ما في حركات. ابدأ من الكاشير 👆</p>`}
    </section>`);
  const list = $('#alist');
  if (list) list.onclick = (e) => { const li = e.target.closest('[data-member]'); if (li && li.dataset.member) memberDialog(li.dataset.member); };
  if (isOwner()) loadReports();
}

// ─── التقارير (للمالك) ───
const WEEKDAYS = ['الأحد', 'الاتنين', 'التلاتا', 'الأربعا', 'الخميس', 'الجمعة', 'السبت'];
const hourLabel = (h) => (h === 0 ? '12ص' : h < 12 ? `${h}ص` : h === 12 ? '12ظ' : `${h - 12}م`);

// أعمدة بلون المحل: سلسلة وحدة (بدون مفتاح ألوان)، القيمة عند المرور أو اللمس، ورقم الأعلى بس مكتوب، وجدول بالأرقام تحت
function columns(values, labels, { tick = () => true, unit = '', tip = (l) => l } = {}) {
  const max = Math.max(...values, 0);
  const peak = values.indexOf(max);
  return html`<div class="cols" role="img" aria-label="${labels.map((l, i) => `${l}: ${values[i]}`).join('، ')}">
      ${values.map((v, i) => html`<div class="col" tabindex="0" data-tip="${tip(labels[i])}: ${fmt(v)}${unit}">
        ${i === peak && max > 0 ? html`<b class="num">${fmt(v)}</b>` : ''}<i style="height:${max ? Math.round((v / max) * 100) : 0}%"></i></div>`)}
    </div>
    <div class="cols-x">${labels.map((l, i) => html`<span>${tick(i) ? l : ''}</span>`)}</div>
    <details class="small"><summary class="muted">الأرقام</summary><table class="mini">${labels.map((l, i) => html`<tr><td>${l}</td><td class="num">${fmt(values[i])}</td></tr>`)}</table></details>`;
}

async function loadReports() {
  const box = document.createElement('div');
  box.id = 'reports';
  view.append(box);
  render(box, html`<p class="center muted">جاري تحميل التقارير…</p>`);
  let r;
  try { r = await api('/api/reports'); } catch (e) { render(box, html`<p class="alert bad">${e.message}</p>`); return; }
  const t = r.totals;
  const g = r.ratings;
  const weeks = r.newByWeek.map((_, i) => (i === 7 ? 'هالأسبوع' : `قبل ${7 - i}`));
  render(box, html`
    <div class="row" style="margin-top:22px;justify-content:space-between">
      <h2 style="margin:0">📊 التقارير <span class="small muted">(آخر 30 يوم)</span></h2>
      <a class="btn ghost sm" href="/api/reports/members.csv" download>⬇️ ملف Excel بكل الزبائن</a>
    </div>
    <div class="stats" style="margin-top:10px">
      <div class="stat"><b class="num">${t.returnRate == null ? '—' : `${t.returnRate}%`}</b><span class="small muted">رجعوا أكتر من مرة</span></div>
      <div class="stat"><b class="num">${fmt(t.active || 0)}</b><span class="small muted">زاروا آخر 30 يوم</span></div>
      <div class="stat"><b class="num">${g.avg == null ? '—' : `${g.avg} ⭐`}</b><span class="small muted">متوسط التقييم (${fmt(g.total)})</span></div>
      <div class="stat"><b class="num">${fmt(t.pushDevices || 0)}</b><span class="small muted">جهاز مفعّل الإشعارات</span></div>
      <div class="stat"><b class="num">${fmt(t.referred || 0)}</b><span class="small muted">إجوا بدعوة صاحب</span></div>
      <div class="stat"><b class="num">${fmt(t.birthdays || 0)}</b><span class="small muted">سجّلوا عيد ميلادهم</span></div>
      ${state.shop.perks.creditOn || r.credit.outstanding ? html`<div class="stat"><b class="num">${fmt(r.credit.outstanding)}</b><span class="small muted">رصيد الزبائن (${state.shop.currency})</span></div>
        <div class="stat"><b class="num">${fmt(r.credit.topups)}</b><span class="small muted">شحن آخر 30 يوم</span></div>` : ''}
    </div>
    <div class="grid2" style="align-items:start;margin-top:14px">
      <section class="panel stack"><h3>أكتر ساعات فيها زيارات</h3>${columns(r.byHour, r.byHour.map((_, h) => hourLabel(h)), { tick: (h) => h % 3 === 0, unit: ' زيارة', tip: (l) => `الساعة ${l}` })}</section>
      <section class="panel stack"><h3>الزيارات حسب أيام الأسبوع</h3>${columns(r.byWeekday, WEEKDAYS, { unit: ' زيارة' })}</section>
      ${state.shop.locations.length > 1 && r.byBranch.length ? html`<section class="panel stack"><h3>الزيارات حسب الفرع</h3>${(() => {
        const rows = r.byBranch.map((b) => ({ name: b.id ? branchName(b.id) || 'فرع محذوف' : 'بدون فرع', n: b.n })).sort((a, b) => b.n - a.n);
        const max = Math.max(...rows.map((x) => x.n));
        return html`<div class="hbars">${rows.map((x) => html`<div class="hbar wide"><span>${x.name}</span><div class="track"><i style="width:${Math.round((x.n / max) * 100)}%"></i></div><b class="num">${fmt(x.n)}</b></div>`)}</div>`;
      })()}</section>` : ''}
      <section class="panel stack"><h3>زبائن جدد كل أسبوع</h3>${columns(r.newByWeek, weeks, { tick: (i) => i === 0 || i === 7 || i === 4, unit: ' زبون' })}</section>
      <section class="panel stack"><h3>التقييمات</h3>
        ${g.total ? html`<div class="hbars">${[5, 4, 3, 2, 1].map((n) => html`<div class="hbar"><span>${n} ★</span><div class="track"><i style="width:${Math.round((g.counts[n - 1] / Math.max(...g.counts)) * 100)}%"></i></div><b class="num">${fmt(g.counts[n - 1])}</b></div>`)}</div>`
          : html`<p class="muted small">لسا ما في تقييمات. بتوصل لحالها بعد الزيارات (من 🎁 العروض).</p>`}
        ${g.comments.length ? html`<h3 style="margin-top:8px">آخر الملاحظات (بتوصلك إنت بس)</h3><ul class="list" id="rcomments">${g.comments.map((c) => html`<li class="click" data-member="${c.memberId}"><div class="main"><b>${'★'.repeat(c.stars)} ${c.name}</b><span class="small muted">${c.comment || 'بدون تعليق'} · ${ago(c.at)}</span></div></li>`)}</ul>` : ''}
      </section>
    </div>
    ${r.staff.length ? html`<section class="panel" style="margin-top:14px"><h3>👥 شغل الموظفين</h3>
      <ul class="list">${r.staff.map((u) => html`<li><div class="main"><b>${u.name}${u.role === 'owner' ? ' (المالك)' : ''}</b>
        <span class="small muted">${fmt(u.customers)} زبون · ${fmt(u.earns)} مرة إضافة · ${fmt(u.points)} ${state.shop.unit} · ${fmt(u.redeems)} مكافأة</span></div></li>`)}</ul></section>` : ''}
    <section class="panel" style="margin-top:14px"><h3>أحسن 10 زبائن</h3>
      ${r.top.length ? html`<ul class="list" id="rtop">${r.top.map((m, i) => html`<li class="click" data-member="${m.id}"><div class="main"><b>${i + 1}. ${m.name}</b><span class="small muted">${fmt(m.visits)} زيارة · ${fmt(m.lifetime)} ${state.shop.unit} · آخر زيارة ${ago(m.lastVisit)}</span></div></li>`)}</ul>` : html`<p class="muted small">لسا ما في زيارات.</p>`}
    </section>`);
  for (const id of ['#rtop', '#rcomments']) {
    const el = $(id, box);
    if (el) el.onclick = (e) => { const li = e.target.closest('[data-member]'); if (li) memberDialog(li.dataset.member); };
  }
}

// خطوة «اطبع الملصق» بتنحسب لما يفتح صفحة الملصق أو يطبعه
function markPoster() {
  api('/api/shop/onboard', { method: 'POST', body: { step: 'poster' } }).catch(() => {});
  const st = state.me.onboarding && state.me.onboarding.steps.find((x) => x.key === 'poster');
  if (st) st.done = true;
}

// ─── رابط الانضمام والملصق ───
function joinView() {
  const s = state.shop;
  const printUrl = (what, layout) => `/print/${s.slug}?for=${what}&layout=${layout}`;
  const menuUrl = `${location.origin}/m/${s.slug}`;
  render(view, html`
    <div class="grid2" style="align-items:start">
      <div class="poster" id="poster">
        <img class="logo" src="${s.logo}" alt="">
        <h2 style="margin-top:8px">${s.name}</h2>
        <p style="font-weight:700;margin-top:6px">امسح وخذ بطاقة الولاء 🎁</p>
        <div class="qr">${qrSVG(s.joinUrl, 'رابط الانضمام')}</div>
        <p>${s.rule}</p>
        <p class="small muted">بتنحفظ بمحفظة جوالك</p>
      </div>
      <section class="panel stack">
        <h2>كيف بينضم الزبون؟</h2>
        <ol style="padding-inline-start:20px" class="small">
          <li>اطبع الملصق وحطه عالكاونتر أو عالطاولات.</li>
          <li>الزبون بيمسحه بكاميرا جواله، وبيكتب اسمه ورقمه.</li>
          <li>بتطلعله بطاقته مع زر «أضف إلى محفظة Google».</li>
          <li>مع كل طلب: بيعرض البطاقة، وإنت بتمسحها من تبويب الكاشير.</li>
        </ol>
        <div class="field"><label>رابط الانضمام</label><input readonly dir="ltr" value="${s.joinUrl}"></div>
        <div class="row">
          <button class="btn ghost grow" type="button" data-copy="${s.joinUrl}">نسخ الرابط</button>
          <a class="btn ghost grow" href="${s.joinUrl}" target="_blank" rel="noopener">جرّب الصفحة</a>
        </div>
        <h3>🖨️ اطبع (أو احفظ PDF)</h3>
        <div class="row">
          <a class="btn grow" data-print href="${printUrl('join', 'poster')}" target="_blank" rel="noopener">ملصق كاونتر A4</a>
          <a class="btn soft grow" data-print href="${printUrl('join', 'table')}" target="_blank" rel="noopener">كروت طاولات</a>
          <a class="btn soft grow" data-print href="${printUrl('join', 'sticker')}" target="_blank" rel="noopener">ستيكر شباك</a>
        </div>
        <p class="hint">حط الرابط كمان بالانستغرام والواتساب بزنس.</p>
      </section>
    </div>
    <section class="panel stack" style="margin-top:14px" id="menuPanel">
      <h2>📋 المنيو الإلكتروني</h2>
      <p class="hint">الزبون بيمسح QR على الطاولة وبيشوف المنيو بجواله، وتحته زر «خذ بطاقة الولاء». ما في داعي تطبع منيو كل ما يتغيّر سعر.</p>
      <div class="row">
        <a class="btn ghost grow" href="${menuUrl}" target="_blank" rel="noopener">شوف المنيو</a>
        <button class="btn ghost grow" type="button" data-copy="${menuUrl}">نسخ الرابط</button>
        <a class="btn soft grow" data-print href="${printUrl('menu', 'table')}" target="_blank" rel="noopener">🖨️ كروت QR للطاولات</a>
      </div>
      <form class="stack menu-form" id="menuForm">
        <div class="row">
          <input class="grow" name="category" placeholder="القسم: مشروبات ساخنة" maxlength="40" list="menuCats">
          <input class="grow" name="name" placeholder="اسم الصنف" maxlength="60" required>
        </div>
        <div class="row">
          <input class="grow num" name="price" type="number" inputmode="decimal" min="0" step="0.001" placeholder="السعر (${s.currency})">
          <input class="grow" name="description" placeholder="وصف قصير (اختياري)" maxlength="200">
        </div>
        <label class="btn ghost" style="margin:0">📷 صورة (اختياري)<input type="file" name="imageFile" accept="image/*" class="hidden"></label>
        <button class="btn" type="submit">+ أضف الصنف</button>
      </form>
      <datalist id="menuCats"></datalist>
      <div id="menuList"><p class="muted small">جاري التحميل…</p></div>
    </section>`);
  bindCopy(view);
  $$('[data-print]').forEach((a) => { a.addEventListener('click', markPoster); });
  loadMenu();
}

// صورة الصنف: بنصغّرها لـ 480 بكسل JPG قبل ما نرفعها
async function resizeMenuImage(file) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 480 / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.width * scale);
  cv.height = Math.round(img.height * scale);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  for (const q of [0.82, 0.7, 0.55]) {
    const url = cv.toDataURL('image/jpeg', q);
    if (url.length * 0.75 < 190 * 1024) return url;
  }
  throw new Error('الصورة كبيرة، جرّب وحدة تانية');
}

async function loadMenu(data) {
  const box = $('#menuList');
  if (!box) return;
  let r;
  try { r = data || await api('/api/menu'); } catch (e) { render(box, html`<p class="alert bad">${e.message}</p>`); return; }
  if (!box.isConnected) return; // تركوا التبويب قبل ما يوصل المنيو
  const cats = [...new Set(r.items.map((x) => x.category))];
  render($('#menuCats'), html`${cats.filter(Boolean).map((cat) => html`<option value="${cat}"></option>`)}`);
  render(box, r.items.length ? html`${cats.map((cat) => html`<h3 style="margin-top:10px">${cat || 'بدون قسم'}</h3>
      <ul class="list">${r.items.filter((x) => x.category === cat).map((it) => html`<li class="${it.available ? '' : 'off'}">
        ${it.image ? html`<img class="thumb" src="${it.image}" alt="">` : ''}
        <div class="main"><b>${it.name}</b><span class="small muted">${it.price != null ? `${fmt(it.price)} ${state.shop.currency}` : ''}${it.description ? ` · ${it.description}` : ''}</span></div>
        <label class="small check"><input type="checkbox" data-avail="${it.id}" ${it.available ? 'checked' : ''}> متوفّر</label>
        <button class="btn ghost sm" type="button" data-edit="${it.id}" aria-label="تعديل">✏️</button>
        <button class="btn ghost sm" type="button" data-del="${it.id}" aria-label="حذف">✕</button></li>`)}</ul>`)}`
    : html`<p class="muted small">المنيو فاضي. ضيف أول صنف من فوق 👆</p>`);
  const items = new Map(r.items.map((x) => [String(x.id), x]));
  $$('[data-avail]', box).forEach((cb) => {
    cb.onchange = async () => { try { loadMenu(await api(`/api/menu/${cb.dataset.avail}`, { method: 'PUT', body: { available: cb.checked } })); } catch (e) { toast(e.message, 'bad'); } };
  });
  $$('[data-del]', box).forEach((b) => {
    b.onclick = async () => {
      if (!confirm(`تحذف «${items.get(b.dataset.del).name}» من المنيو؟`)) return;
      try { loadMenu(await api(`/api/menu/${b.dataset.del}`, { method: 'DELETE' })); } catch (e) { toast(e.message, 'bad'); }
    };
  });
  $$('[data-edit]', box).forEach((b) => { b.onclick = () => editMenuItem(items.get(b.dataset.edit)); });
  const form = $('#menuForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const file = f.get('imageFile');
      const body = { category: f.get('category'), name: f.get('name'), price: f.get('price'), description: f.get('description') };
      if (file && file.size) body.image = await resizeMenuImage(file);
      loadMenu(await api('/api/menu', { method: 'POST', body }));
      form.reset();
      form.category.value = body.category;
      form.name.focus();
      toast('انضاف ✅', 'ok');
    } catch (err) { toast(err.message, 'bad'); }
    btn.disabled = false;
  };
}

function editMenuItem(it) {
  const body = openDialog('تعديل الصنف', html`<form class="stack" id="menuEdit">
      <input name="category" value="${it.category}" placeholder="القسم" maxlength="40" list="menuCats">
      <input name="name" value="${it.name}" placeholder="الاسم" maxlength="60" required>
      <input name="price" class="num" type="number" inputmode="decimal" min="0" step="0.001" value="${it.price ?? ''}" placeholder="السعر">
      <input name="description" value="${it.description}" placeholder="وصف قصير" maxlength="200">
      ${it.image ? html`<div class="row"><img class="thumb" src="${it.image}" alt=""><label class="check small"><input type="checkbox" name="removeImage"> شيل الصورة</label></div>` : ''}
      <label class="btn ghost" style="margin:0">📷 ${it.image ? 'غيّر الصورة' : 'ضيف صورة'}<input type="file" name="imageFile" accept="image/*" class="hidden"></label>
      <button class="btn" type="submit">حفظ</button>
    </form>`);
  $('#menuEdit', body).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const file = f.get('imageFile');
      const payload = { category: f.get('category'), name: f.get('name'), price: f.get('price'), description: f.get('description'), removeImage: f.get('removeImage') === 'on' };
      if (file && file.size) payload.image = await resizeMenuImage(file);
      const r = await api(`/api/menu/${it.id}`, { method: 'PUT', body: payload });
      $('#dlg').close();
      loadMenu(r);
      toast('انحفظ ✅', 'ok');
    } catch (err) { toast(err.message, 'bad'); }
  };
}

// ─── الإعدادات ───
function ruleText(f) {
  if (f.programType === 'stamps') return `اجمع ${f.stampsRequired} أختام واحصل على ${f.rewardName}`;
  const per = Number(f.pointsPerUnit);
  return `${per === 1 ? `كل 1 ${f.currency} = نقطة` : `كل 1 ${f.currency} = ${per} نقطة`} · ${f.rewardThreshold} نقطة = ${f.rewardName}`;
}

// الشعار بيتحفظ PNG (Apple Wallet ما بتقبل غيره)، وإذا كبير منصغّره
async function resizeLogo(file) {
  const img = await createImageBitmap(file);
  for (const size of [660, 520, 400]) {
    const url = drawLogo(img, size, 'image/png');
    if (url.length <= 900000) return url;
  }
  return drawLogo(img, 400, 'image/jpeg', 0.88);
}

function drawLogo(img, size, type, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  const scale = Math.min(size / img.width, size / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return canvas.toDataURL(type, quality);
}

function googlePanel() {
  const g = state.google;
  if (!g.enabled) {
    return html`<div class="alert warn">محفظة Google لسا مش مفعّلة على السيرفر. الزبائن بياخدوا بطاقة على الويب فيها QR، وبس تتفعّل بيصير عندهم زر «أضف إلى محفظة Google». خطوات التفعيل بملف README.</div>`;
  }
  return html`
    <div class="row">${g.error ? html`<span class="badge bad">فيه مشكلة</span>` : g.syncedAt ? html`<span class="badge ok">متصل</span>` : html`<span class="badge warn">لسا ما تزامن</span>`}
      <span class="small muted">${g.syncedAt ? `آخر مزامنة ${ago(g.syncedAt)}` : ''}</span>
      <button class="btn ghost sm" id="syncBtn" type="button">زامن هلأ</button></div>
    ${g.error ? html`<p class="alert bad small">${g.error}</p>` : ''}
`;
}

function broadcastPanel() {
  const n = state.me.pushCount || 0;
  return html`<h2>رسالة لكل الزبائن 🔔</h2>
    <form class="stack" id="bc">
      <input name="header" placeholder="العنوان (اختياري): ${state.shop.name}" maxlength="40">
      <textarea name="body" rows="2" placeholder="مثلاً: خصم 20% على كل المشروبات اليوم ☕" maxlength="300" required></textarea>
      <div class="row">
        <button class="btn ghost grow" type="button" id="bcTest">جرّب على جوالي أول</button>
        <button class="btn soft grow" type="submit">ابعت لكل الزبائن</button>
      </div>
      <p class="hint">بتوصل لـ <b class="num">${n}</b> زبون فعّلوا الإشعارات${state.google.enabled ? '، وللي حافظين البطاقة بمحفظة Google' : ''}.
        «جرّب على جوالي» بتوصلك إنت بس (لازم تكون مفعّل «🔔 تنبيهات إلك»). ما في حد للرسائل، بس كترها بيزعج الزبائن وممكن يسكّروا الإشعارات.</p>
    </form>`;
}

async function settings() {
  const s = state.shop;
  let locs = s.locations.map((l) => ({ ...l }));
  render(view, html`
    ${subnav('settings', [['shop', '🏪 المحل والبطاقة'], ['wallet', '📲 المحفظة والروابط'], ['team', '👥 الموظفين والحماية'], ['alerts', '🔔 تنبيهاتك'], state.me.subscription.state !== 'owner' && ['billing', '💳 الاشتراك']])}
    <div class="grid2 group" data-group="shop">
      <form class="panel stack" id="shopForm" novalidate>
      <h2>المحل</h2>
      <div class="field"><label for="f-name">اسم المحل</label><input id="f-name" name="name" value="${s.name}" maxlength="60"></div>
      <div class="field"><label for="f-slug">رابط المحل</label><input id="f-slug" name="slug" value="${s.slug}" dir="ltr" maxlength="40">
      <div class="hint num" id="slugHint"></div></div>
      <div class="row">
      <div class="field grow"><label for="f-country">الدولة</label><select id="f-country" name="country">${Object.entries(COUNTRIES).map(([k, v]) => html`<option value="${k}" ${k === s.country ? 'selected' : ''}>${v} (${state.me.currencies[k]})</option>`)}</select></div>
      <div class="field"><label for="f-color">لون البطاقة</label><input id="f-color" name="color" type="color" value="${s.color}"></div>
      </div>

      <h2 style="margin-top:18px">برنامج الولاء</h2>
      <div class="seg" id="ptype">
      <button type="button" data-v="points" class="${s.programType === 'points' ? 'on' : ''}">نقاط</button>
      <button type="button" data-v="stamps" class="${s.programType === 'stamps' ? 'on' : ''}">أختام</button>
      </div>
      <div class="row points-only">
      <div class="field grow"><label for="f-ppu">نقاط لكل 1 <span class="cur">${s.currency}</span></label><input id="f-ppu" name="pointsPerUnit" type="number" min="0.001" step="any" value="${s.pointsPerUnit}" class="num"></div>
      <div class="field grow"><label for="f-thr">نقاط المكافأة</label><input id="f-thr" name="rewardThreshold" type="number" min="1" step="1" value="${s.rewardThreshold}" class="num"></div>
      </div>
      <div class="field stamps-only"><label for="f-stamps">عدد الأختام للمكافأة</label><input id="f-stamps" name="stampsRequired" type="number" min="2" max="30" step="1" value="${s.stampsRequired}" class="num">
      <div class="hint">«اشتري 9 والعاشر مجاني» = 9 أختام.</div></div>
      <div class="field"><label for="f-reward">المكافأة</label><input id="f-reward" name="rewardName" value="${s.rewardName}" maxlength="40"></div>
      <p class="alert ok small" id="rulePreview"></p>

      <h2 style="margin-top:18px">الفروع والموقع 📍</h2>
      <p class="hint">لما يقرّب الزبون من أي فرع، الجوال بيطلّعله بطاقتك على شاشة القفل. لحد 10 فروع.</p>
      <div id="locs"></div>
      <div class="row">
      <button class="btn soft grow" id="here" type="button">📍 موقعي الحالي (وأنا بالمحل)</button>
      </div>
      <div class="row">
      <input class="grow" id="maplink" placeholder="أو الصق رابط خرائط Google / إحداثيات 31.95, 35.91" dir="ltr">
      <button class="btn ghost" id="addLink" type="button">أضف</button>
      </div>
      <p class="hint">الروابط المختصرة (maps.app.goo.gl) ما فيها إحداثيات: افتح الرابط، اضغط مطوّل على المحل، وانسخ الأرقام اللي بتطلع.</p>
      <div class="field"><label for="f-welcome">رسالة الترحيب</label><input id="f-welcome" name="welcomeText" value="${s.welcomeText}" maxlength="100" placeholder="${s.name} ترحب بكم ☕">
      <div class="hint">بتطلع على شاشة القفل بالآيفون لما يقرّب الزبون (مع بطاقة Apple Wallet). على الأندرويد، Google بتطلّع البطاقة باسم المحل وشعاره وهي اللي بتختار الكلام.</div></div>
      <p class="error" id="shopErr"></p>
      <button class="btn big block" type="submit">حفظ</button>
      </form>
      <section class="panel stack">
      <h2>شكل البطاقة</h2>
      <div id="preview"></div>
      <div class="row">
      <label class="btn ghost grow" style="margin:0">رفع الشعار<input type="file" id="logoFile" accept="image/png,image/jpeg" class="hidden"></label>
      ${s.customLogo ? html`<button class="btn ghost" id="logoRemove" type="button">الشعار الافتراضي</button>` : ''}
      </div>
      <p class="hint">صورة مربعة PNG أو JPG، والأفضل 660×660.</p>
      </section>
    </div>
    <div class="grid2 group" data-group="wallet">
      <section class="panel stack"><h2>محفظة Google</h2><div id="gpanel">${googlePanel()}</div></section>
      <form class="panel stack" id="linksForm">
      <h2>🔗 روابط المحل على البطاقة</h2>
      <input name="instagram" placeholder="إنستغرام: @mocha.jo" dir="ltr" value="${(s.links.instagram || '').replace('https://instagram.com/', '@')}">
      <input name="tiktok" placeholder="تيك توك: @mocha.jo" dir="ltr" value="${(s.links.tiktok || '').replace('https://www.tiktok.com/', '')}">
      <input name="facebook" placeholder="فيسبوك: mochajo" dir="ltr" value="${(s.links.facebook || '').replace('https://facebook.com/', '')}">
      <input name="whatsapp" placeholder="واتساب المحل: 079xxxxxxx" dir="ltr" inputmode="tel" value="${(s.links.whatsapp || '').replace('https://wa.me/', '+')}">
      <input name="website" placeholder="الموقع: https://..." dir="ltr" value="${s.links.website || ''}">
      <p class="hint">بتطلع أزرار على بطاقة الزبون. فاضي = ما بيطلع.</p>
      <button class="btn" type="submit">حفظ</button>
      </form>
    </div>
    <div class="grid2 group" data-group="team">
      <section class="panel stack" id="staffPanel"><h2>الموظفين</h2><p class="muted small">جاري التحميل…</p></section>
      <form class="panel stack" id="guardForm">
      <h2>🛡️ الحماية من تلاعب الكاشير</h2>
      <div class="row">
      <div class="field grow"><label for="g-cool">نفس الزبون مرتين ورا بعض: استنى (دقيقة)</label><input id="g-cool" name="guardCooldown" type="number" min="0" max="240" value="${s.perks.guardCooldown}" class="num"></div>
      <div class="field grow"><label for="g-day">أكتر إشي باليوم لنفس الزبون</label><input id="g-day" name="guardDaily" type="number" min="0" max="50" value="${s.perks.guardDaily}" class="num"></div>
      </div>
      <div class="field"><label for="g-big">نبّهني إذا كاشير ضاف بمرة وحدة أكتر من (${s.unit})</label><input id="g-big" name="guardBig" type="number" min="1" value="${s.perks.guardBig}" class="num"></div>
      <p class="hint">بتنطبق على الكاشيرية بس، إنت مستثنى. 0 = بدون حد. لما حدا يحاول يتجاوز الحد بيوصلك تنبيه (فعّل «🔔 تنبيهات إلك»)، وبتلاقي شغل كل موظف بـ 📊 النشاط.</p>
      <button class="btn" type="submit">حفظ</button>
      </form>
      <form class="panel stack" id="pwForm">
      <h2>كلمة السر</h2>
      <input name="current" type="password" placeholder="كلمة السر الحالية" autocomplete="current-password" dir="ltr" required>
      <input name="next" type="password" placeholder="كلمة السر الجديدة (8 حروف أو أكتر)" autocomplete="new-password" dir="ltr" minlength="8" required>
      <button class="btn ghost" type="submit">غيّر كلمة السر</button>
      </form>
    </div>
    <div class="grid2 group" data-group="alerts">
      <section class="panel stack" id="alertsPanel"></section>
    </div>
    ${state.me.subscription.state !== 'owner' ? html`
    <div class="grid2 group" data-group="billing">
      <section class="panel stack" id="billing"><h2>💳 الاشتراك</h2><p class="muted small">جاري التحميل…</p></section>
    </div>` : ''}`);
  bindSubnav('settings', 'shop');

  const form = $('#shopForm');
  let ptype = s.programType;
  const values = () => {
    const f = Object.fromEntries(new FormData(form));
    return { ...f, programType: ptype, currency: state.me.currencies[f.country] };
  };
  const refresh = () => {
    const f = values();
    $$('.points-only').forEach((el) => el.classList.toggle('hidden', ptype !== 'points'));
    $$('.stamps-only').forEach((el) => el.classList.toggle('hidden', ptype !== 'stamps'));
    $$('.cur').forEach((el) => { el.textContent = f.currency; });
    $('#rulePreview').textContent = ruleText(f);
    $('#slugHint').textContent = `${location.origin}/j/${f.slug}`;
    const cost = ptype === 'stamps' ? Number(f.stampsRequired) || 9 : Number(f.rewardThreshold) || 100;
    const toward = Math.floor(cost * 0.4);
    const shopPreview = { ...s, name: f.name || s.name, color: f.color, programType: ptype, rewardName: f.rewardName || s.rewardName };
    render($('#preview'), cardHTML(shopPreview, { name: 'اسم الزبون', balance: toward, cardNo: '12345678', token: 'preview-card', progress: { cost, available: 0, toward, remaining: cost - toward, pct: 40 } }));
  };
  const drawLocs = () => {
    render($('#locs'), html`${locs.length ? html`<ul class="list">${locs.map((l, i) => html`<li>
        <input value="${l.name}" data-i="${i}" class="loc-name" maxlength="40" style="flex:1" aria-label="اسم الفرع">
        <a class="btn ghost sm" href="https://www.google.com/maps?q=${l.lat},${l.lng}" target="_blank" rel="noopener" title="${l.lat}, ${l.lng}">خريطة</a>
        <button class="btn ghost sm" type="button" data-del="${i}" aria-label="حذف">✕</button></li>`)}</ul>` : html`<p class="alert warn small">ما في فروع لسا. بدون موقع ما رح تطلع البطاقة لما يقرّب الزبون.</p>`}`);
    $$('.loc-name').forEach((el) => { el.oninput = () => { locs[el.dataset.i].name = el.value; }; });
    $$('[data-del]').forEach((b) => { b.onclick = () => { locs.splice(Number(b.dataset.del), 1); drawLocs(); }; });
  };
  const addLoc = (lat, lng) => {
    if (locs.length >= 10) { toast('لحد 10 فروع', 'bad'); return; }
    locs.push({ name: locs.length ? `فرع ${locs.length + 1}` : 'الفرع الرئيسي', lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 });
    drawLocs();
    toast('انضاف الفرع، لا تنسى «حفظ»', 'ok');
  };
  form.oninput = refresh;
  $$('#ptype button').forEach((b) => { b.onclick = () => { ptype = b.dataset.v; $$('#ptype button').forEach((x) => x.classList.toggle('on', x === b)); refresh(); }; });
  $('#here').onclick = () => {
    if (!navigator.geolocation) { toast('الجهاز ما بيدعم تحديد الموقع', 'bad'); return; }
    $('#here').disabled = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => { $('#here').disabled = false; addLoc(pos.coords.latitude, pos.coords.longitude); if (pos.coords.accuracy > 100) toast(`دقة الموقع ${Math.round(pos.coords.accuracy)} م — الأفضل تجرّب برّا أو بالرابط`, 'bad'); },
      (err) => { $('#here').disabled = false; toast(err.code === 1 ? 'اسمح للمتصفح يعرف موقعك' : 'ما قدرنا نحدد الموقع', 'bad'); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  $('#maplink').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#addLink').click(); } };
  $('#addLink').onclick = () => {
    const p = parseLatLng($('#maplink').value);
    if (!p) { toast('ما لقينا إحداثيات بهالرابط', 'bad'); return; }
    $('#maplink').value = '';
    addLoc(p.lat, p.lng);
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    $('#shopErr').textContent = '';
    const f = values();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const r = await api('/api/shop', { method: 'PUT', body: { ...f, locations: locs } });
      state.shop = r.shop;
      state.google = r.google;
      applyShop();
      render($('#gpanel'), googlePanel());
      bindGoogle();
      const ls = r.google.lastSync;
      toast(ls && ls.enabled && !ls.ok ? 'انحفظ، بس فيه مشكلة بمزامنة Google' : 'انحفظ ✅', ls && ls.enabled && !ls.ok ? 'bad' : 'ok');
    } catch (err) {
      $('#shopErr').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  };

  $('#logoFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const dataUrl = await resizeLogo(file);
      const r = await api('/api/shop/logo', { method: 'PUT', body: { dataUrl } });
      state.shop = r.shop;
      state.google = r.google;
      applyShop();
      settings();
      toast('انرفع الشعار ✅', 'ok');
    } catch (err) { toast(err.message || 'ما قدرنا نقرا الصورة', 'bad'); }
  };
  const rm = $('#logoRemove');
  if (rm) rm.onclick = async () => { const r = await api('/api/shop/logo', { method: 'PUT', body: { remove: true } }); state.shop = r.shop; applyShop(); settings(); };

  function bindGoogle() {
    const sync = $('#syncBtn');
    if (sync) sync.onclick = async () => {
      sync.disabled = true;
      try { const r = await api('/api/shop/sync', { method: 'POST' }); state.google = r.google; toast(r.google.error ? 'المزامنة ما زبطت' : 'تمت المزامنة ✅', r.google.error ? 'bad' : 'ok'); } catch (err) { toast(err.message, 'bad'); }
      render($('#gpanel'), googlePanel());
      bindGoogle();
    };
  }
  bindGoogle();

  loadBilling();
  drawAlerts();
  $('#linksForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/shop/links', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
      state.shop = r.shop;
      toast('انحفظت الروابط ✅', 'ok');
    } catch (err) { toast(err.message, 'bad'); }
  };
  $('#guardForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/shop/perks', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
      state.shop = r.shop;
      toast('انحفظ ✅', 'ok');
    } catch (err) { toast(err.message, 'bad'); }
  };
  $('#pwForm').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/me/password', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); toast('تغيّرت كلمة السر ✅', 'ok'); } catch (err) { toast(err.message, 'bad'); }
  };

  refresh();
  drawLocs();
  loadStaff();
}

function bindBroadcast() {
  const bc = $('#bc');
  bc.onsubmit = async (e) => {
    e.preventDefault();
    if (!confirm('تبعت هالإشعار لكل الزبائن؟')) return;
    const btn = bc.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const r = await api('/api/broadcast', { method: 'POST', body: Object.fromEntries(new FormData(bc)) });
      let sent = r.push.sent;
      let next = r.push.next;
      while (next) {
        btn.textContent = `جاري الإرسال… ${sent}`;
        const x = await api(`/api/broadcast/${r.id}/continue`, { method: 'POST', body: { cursor: next } });
        sent += x.push.sent;
        next = x.push.next;
      }
      bc.reset();
      const gmsg = r.google === 'ok' ? ' + محفظة Google' : r.google ? ' (محفظة Google ما زبطت)' : '';
      toast(`انبعتت الرسالة لـ ${sent} جهاز${gmsg} ✅`, r.google && r.google !== 'ok' ? 'bad' : 'ok');
    } catch (err) { toast(err.message, 'bad'); }
    btn.disabled = false;
    btn.textContent = 'ابعت لكل الزبائن';
  };
  $('#bcTest').onclick = async () => {
    const f = Object.fromEntries(new FormData(bc));
    if (!f.body || f.body.trim().length < 2) { toast('اكتب نص الرسالة', 'bad'); return; }
    try {
      const r = await api('/api/broadcast/test', { method: 'POST', body: f });
      toast(r.sent ? 'انبعتت التجربة لجوالك إنت بس 📱 شوفها' : `ما وصلت التجربة (${r.reason || 'خطأ'})`, r.sent ? 'ok' : 'bad');
    } catch (err) { toast(err.message, 'bad'); }
  };
}

// ─── العروض: رسالة لكل الزبائن، نقاط دبل، عيد الميلاد، الغايبين، التقييمات، ادعُ صاحبك، المستويات ───
const DAYS = ['أحد', 'اتنين', 'تلاتا', 'أربعا', 'خميس', 'جمعة', 'سبت'];

function offers() {
  const s = state.shop;
  const p = s.perks;
  const unit = s.unit;
  let boosts = p.boosts.map((b) => ({ ...b, days: [...b.days] }));
  render(view, html`
    ${subnav('offers', [['msgs', '📣 رسائل وكوبونات'], ['points', '⭐ النقاط والمستويات'], ['auto', '🤖 تلقائي'], ['credit', '💳 رصيد ودعوات']])}
    <div class="grid2 group" data-group="msgs">
      <section class="panel stack">${broadcastPanel()}</section>
      <section class="panel stack" id="couponsPanel"><h2>🎟️ كوبونات</h2><p class="muted small">جاري التحميل…</p></section>
    </div>
    <div class="grid2 group" data-group="points">
      <form class="panel stack" data-perks="boosts">
      <h2>⏰ نقاط دبل بأوقات معيّنة</h2>
      <p class="hint">مثلاً كل يوم أحد، أو من 2 لـ 5 العصر لما المحل فاضي. الزبون بيشوف العرض على بطاقته، والكاشير بيشوفه وهو بيضيف النقاط.</p>
      ${p.boostNow > 1 ? html`<p class="alert ok small">شغّال هلق: النقاط ×${p.boostNow}</p>` : ''}
      <div id="boosts"></div>
      <button class="btn ghost" type="button" id="addBoost">+ أضف وقت</button>
      <button class="btn" type="submit">حفظ</button>
      </form>
      <form class="panel stack" data-perks="tiers">
      <h2>🥇 مستويات الزبائن</h2>
      <label class="check"><input type="checkbox" name="tiersOn" ${p.tiersOn ? 'checked' : ''}> مفعّلة</label>
      <div class="row">
      <div class="field grow"><label for="p-ts">🥈 فضي بعد (زيارة)</label><input id="p-ts" name="tierSilver" type="number" min="2" step="1" value="${p.tierSilver}" class="num"></div>
      <div class="field grow"><label for="p-tg">🥇 ذهبي بعد (زيارة)</label><input id="p-tg" name="tierGold" type="number" min="3" step="1" value="${p.tierGold}" class="num"></div>
      </div>
      <p class="hint">${s.programType === 'stamps' ? 'ببرنامج الأختام المستوى شارة على البطاقة بس.' : 'الفضي بياخد نقاط ×1.25 والذهبي ×1.5 على كل طلب.'} الزبون بيشوف مستواه وكم باقيله على بطاقته.</p>
      <button class="btn" type="submit">حفظ</button>
      </form>
      <form class="panel stack" data-perks="expiry">
      <h2>⏳ صلاحية النقاط</h2>
      <div class="field"><label for="p-ex">النقاط بتنتهي إذا الزبون ما زار لمدة</label>
      <select id="p-ex" name="expiryMonths">${[[0, 'ما بتنتهي'], [6, '6 أشهر'], [12, 'سنة'], [24, 'سنتين']].map(([v, l]) => html`<option value="${v}" ${v === p.expiryMonths ? 'selected' : ''}>${l}</option>`)}</select></div>
      <p class="hint">قبل أسبوع من انتهاء النقاط بيوصله تذكير «مرّ علينا واستعملها». لما تفعّلها، العدّ بيبلّش من اليوم، فنقاط الزبائن القدام ما بتنمسح فجأة.</p>
      <button class="btn" type="submit">حفظ</button>
      </form>
    </div>
    <div class="grid2 group" data-group="auto">
      <form class="panel stack" data-perks="bday">
      <h2>🎂 هدية عيد الميلاد</h2>
      <label class="check"><input type="checkbox" name="bdayOn" ${p.bdayOn ? 'checked' : ''}> مفعّلة</label>
      <div class="field"><label for="p-bday">الهدية (${unit})</label><input id="p-bday" name="bdayGift" type="number" min="0" step="1" value="${p.bdayGift}" class="num">
      <div class="hint">${s.cost} ${unit} = ${s.rewardName} كامل. حط 0 إذا بدك معايدة بس بدون هدية.</div></div>
      <p class="hint">الزبون بيكتب تاريخ ميلاده لما ينضم أو من بطاقته. يوم عيده (من 9 الصبح) بتنضاف الهدية لرصيده وبيوصله إشعار. التاريخ لازم يكون محفوظ من أسبوعين على الأقل.</p>
      <button class="btn" type="submit">حفظ</button>
      </form>
      <form class="panel stack" data-perks="winback">
      <h2>💤 تذكير الزبائن اللي غابوا</h2>
      <div class="field"><label for="p-wb">بعد كم يوم غياب؟</label>
      <select id="p-wb" name="winbackDays">${[0, 14, 21, 30, 45, 60, 90].map((d) => html`<option value="${d}" ${d === p.winbackDays ? 'selected' : ''}>${d ? `${d} يوم` : 'موقّف'}</option>`)}</select></div>
      <div class="field"><label for="p-wbt">الرسالة</label><input id="p-wbt" name="winbackText" maxlength="120" value="${p.winbackText}" placeholder="اشتقنالك يا {الاسم} ☕ مرّ علينا قريب">
      <div class="hint">{الاسم} بيتبدّل باسم الزبون.</div></div>
      <label class="check"><input type="checkbox" name="winbackDouble" ${p.winbackDouble ? 'checked' : ''}> نقاطه دبل لـ 3 أيام لما يرجع</label>
      <p class="hint">بيوصل مرة وحدة لكل غيبة، للي مفعّلين الإشعارات، بين 11 الصبح و 8 المسا.</p>
      <button class="btn" type="submit">حفظ</button>
      </form>
      <form class="panel stack" data-perks="review">
      <h2>⭐ التقييم بعد الزيارة</h2>
      <label class="check"><input type="checkbox" name="reviewOn" ${p.reviewOn ? 'checked' : ''}> مفعّل</label>
      <div class="field"><label for="p-rv">رابط تقييم محلك على Google</label><input id="p-rv" name="reviewUrl" dir="ltr" value="${p.reviewUrl}" placeholder="https://g.page/r/...">
      <div class="hint">من <b>Google Business Profile</b> ← «اطلب تقييمات» (Ask for reviews) ← انسخ الرابط.</div></div>
      <p class="hint">بعد الزيارة بساعة بيوصل الزبون «كيف كانت زيارتك؟». اللي بيعطي 4 أو 5 نجوم بنطلب منه يقيّم على Google، واللي أقل بيوصلك كلامه إنت بس (بتشوفه بـ 📊 النشاط).</p>
      <button class="btn" type="submit">حفظ</button>
      </form>
    </div>
    <div class="grid2 group" data-group="credit">
      <form class="panel stack" data-perks="credit">
      <h2>💳 رصيد مدفوع مسبقاً</h2>
      <label class="check"><input type="checkbox" name="creditOn" ${p.creditOn ? 'checked' : ''}> مفعّل</label>
      <div class="field"><label for="p-cb">هدية الشحن (%)</label><input id="p-cb" name="creditBonus" type="number" min="0" max="100" step="1" value="${p.creditBonus}" class="num">
      <div class="hint">مثلاً 10%: بيدفع 20 وبياخد رصيد 22.</div></div>
      <p class="hint">الزبون بيدفع مسبقاً عند الكاشير، والرصيد بيطلع على بطاقته، وبيدفع منه بالزيارات الجاية. مع كل شحن أو دفع بيوصله إشعار، فما حدا بيقدر يصرف من رصيده بدون ما يعرف.</p>
      <button class="btn" type="submit">حفظ</button>
      </form>
      <form class="panel stack" data-perks="ref">
      <h2>👥 ادعُ صاحبك</h2>
      <div class="field"><label for="p-ref">هدية الدعوة لكل واحد (${unit})</label><input id="p-ref" name="refBonus" type="number" min="0" step="1" value="${p.refBonus}" class="num">
      <div class="hint">حط 0 لتوقيفها.</div></div>
      <p class="hint">كل زبون عنده رابط دعوة على بطاقته. لما صاحبه ينضم منه ويزوركم أول مرة، الاتنين بياخدوا الهدية (لحد 10 دعوات بالشهر لكل زبون).</p>
      <button class="btn" type="submit">حفظ</button>
      </form>
    </div>`);
  bindSubnav('offers', 'msgs');
  bindBroadcast();
  loadCoupons();

  const drawBoosts = () => {
    render($('#boosts'), boosts.length ? html`${boosts.map((b, i) => html`<div class="boost" data-i="${i}">
        <div class="days">${DAYS.map((d, k) => html`<button type="button" class="chip ${b.days.includes(k) ? 'on' : ''}" data-day="${k}">${d}</button>`)}</div>
        <div class="row">
          <label class="small">من <input type="time" data-f="from" value="${b.from}"></label>
          <label class="small">لحد <input type="time" data-f="to" value="${b.to}"></label>
          <select data-f="mult" aria-label="المضاعفة"><option value="2" ${b.mult === 2 ? 'selected' : ''}>×2</option><option value="3" ${b.mult === 3 ? 'selected' : ''}>×3</option></select>
          <button class="btn ghost sm" type="button" data-rm="${i}" aria-label="حذف">✕</button>
        </div></div>`)}` : html`<p class="muted small">ما في أوقات لسا.</p>`);
  };
  drawBoosts();
  $('#boosts').onclick = (e) => {
    const box = e.target.closest('.boost');
    if (!box) return;
    const b = boosts[Number(box.dataset.i)];
    const day = e.target.closest('[data-day]');
    if (day) { const k = Number(day.dataset.day); b.days = b.days.includes(k) ? b.days.filter((x) => x !== k) : [...b.days, k]; drawBoosts(); }
    if (e.target.closest('[data-rm]')) { boosts.splice(Number(box.dataset.i), 1); drawBoosts(); }
  };
  $('#boosts').oninput = (e) => {
    const box = e.target.closest('.boost');
    const f = e.target.dataset.f;
    if (!box || !f) return;
    boosts[Number(box.dataset.i)][f] = f === 'mult' ? Number(e.target.value) : e.target.value;
  };
  $('#addBoost').onclick = () => { boosts.push({ days: [0], from: '14:00', to: '17:00', mult: 2 }); drawBoosts(); };

  // كل قسم بيبعت حقوله بس
  $$('form[data-perks]').forEach((form) => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const kind = form.dataset.perks;
      const f = new FormData(form);
      const on = (k) => f.get(k) === 'on';
      const body = {
        boosts: { boosts },
        bday: { bdayOn: on('bdayOn'), bdayGift: f.get('bdayGift') },
        winback: { winbackDays: f.get('winbackDays'), winbackText: f.get('winbackText'), winbackDouble: on('winbackDouble') },
        review: { reviewOn: on('reviewOn'), reviewUrl: f.get('reviewUrl') },
        ref: { refBonus: f.get('refBonus') },
        tiers: { tiersOn: on('tiersOn'), tierSilver: f.get('tierSilver'), tierGold: f.get('tierGold') },
        credit: { creditOn: on('creditOn'), creditBonus: f.get('creditBonus') },
        expiry: { expiryMonths: f.get('expiryMonths') },
      }[kind];
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const r = await api('/api/shop/perks', { method: 'PUT', body });
        state.shop = r.shop;
        toast('انحفظ ✅', 'ok');
        if (kind === 'boosts') offers();
      } catch (err) { toast(err.message, 'bad'); }
      btn.disabled = false;
    };
  });
}


// ─── الاشتراك والدفع بـ CliQ ───
const PAY_STATUS = { pending: ['⏳ عم نتأكد منها', 'warn'], approved: ['✅ تأكدت', 'ok'], rejected: ['❌ ما وصلت', 'bad'] };

async function loadBilling() {
  const box = $('#billing');
  if (!box) return;
  let b;
  try { b = await api('/api/billing'); } catch (e) { render(box, html`<h2>💳 الاشتراك</h2><p class="alert bad">${e.message}</p>`); return; }
  const sub = b.subscription;
  const status = sub.state === 'trial' ? html`<p class="alert warn small">🎁 تجربة مجانية: باقي <b class="num">${sub.daysLeft}</b> يوم.</p>`
    : sub.state === 'active' ? html`<p class="alert ok small">✅ مشترك لحد <b>${fmtDay(sub.until)}</b> (باقي <span class="num">${sub.daysLeft}</span> يوم).</p>`
      : html`<p class="alert bad small">⏳ الاشتراك خالص. الكاشير متوقف لحد ما تجدّد، وزبائنك ونقاطهم محفوظين.</p>`;
  const wa = b.whatsapp ? `https://wa.me/${b.whatsapp}?text=${encodeURIComponent(`مرحبا، بدي أشترك بنقاطك لمحل ${state.shop.name}`)}` : null;
  render(box, html`<h2>💳 الاشتراك</h2>${status}
    ${b.cliq ? html`<form class="stack" id="payForm">
        <div class="seg" id="planSeg">
          <button type="button" data-plan="month" class="on">شهر · <span class="num">${b.prices.month}</span> دينار</button>
          <button type="button" data-plan="year">سنة · <span class="num">${b.prices.year}</span> دينار <span class="small">(وفّر شهرين)</span></button>
        </div>
        <ol class="small" style="padding-inline-start:20px;display:grid;gap:6px">
          <li>افتح تطبيق البنك ← <b>CliQ</b> ← حوّل <b class="num" id="payAmount">${b.prices.month}</b> دينار على الاسم المستعار:
            <div class="row" style="margin-top:4px"><code class="alias" dir="ltr">${b.cliq.alias}</code><button class="btn ghost sm" type="button" data-copy="${b.cliq.alias}">نسخ</button></div>
            ${b.cliq.name ? html`<span class="muted">باسم: ${b.cliq.name}${b.cliq.bank ? ` · ${b.cliq.bank}` : ''}</span>` : ''}</li>
          <li>بعد ما تحوّل، اكتب اسمك متل ما بيطلع بالحوالة واكبس «حوّلت».</li>
        </ol>
        <input name="payer" placeholder="اسم اللي حوّل" maxlength="60" required>
        <input name="ref" placeholder="رقم الحوالة (اختياري)" maxlength="60" dir="ltr">
        <button class="btn" type="submit">حوّلت ✅</button>
        <p class="hint">منتأكد من الحوالة ومنفعّل اشتراكك عادةً بنفس اليوم.</p>
      </form>` : ''}
    ${wa ? html`<a class="btn ${b.cliq ? 'ghost' : ''} block wa" href="${wa}" target="_blank" rel="noopener">${b.cliq ? 'سؤال؟ احكي معنا عالواتساب' : 'اشترك عالواتساب'}</a>` : ''}
    ${b.payments.length ? html`<h3 style="margin-top:6px">حوالاتك</h3><ul class="list">${b.payments.map((p) => html`<li><div class="main"><b>${p.plan === 'year' ? 'سنة' : 'شهر'} · <span class="num">${p.amount}</span> دينار</b>
        <span class="small muted">${p.payer}${p.ref ? ` · ${p.ref}` : ''} · ${ago(p.createdAt)}</span></div><span class="badge ${PAY_STATUS[p.status][1]}">${PAY_STATUS[p.status][0]}</span></li>`)}</ul>` : ''}`);
  bindCopy(box);
  const form = $('#payForm', box);
  if (!form) return;
  let plan = 'month';
  $$('#planSeg button', box).forEach((btn) => {
    btn.onclick = () => {
      plan = btn.dataset.plan;
      $$('#planSeg button', box).forEach((x) => x.classList.toggle('on', x === btn));
      $('#payAmount', box).textContent = b.prices[plan];
    };
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    try {
      await api('/api/billing/claim', { method: 'POST', body: { plan, payer: f.get('payer'), ref: f.get('ref') } });
      toast('وصلنا تبليغك ✅ منتأكد ومنفعّل', 'ok');
      loadBilling();
    } catch (err) { toast(err.message, 'bad'); }
  };
}


// ─── تنبيهات لصاحب المحل (ولمدير المنصة) على جواله ───
const dashStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const dashIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const pushOK = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64key = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)), (ch) => ch.charCodeAt(0));

async function drawAlerts(note = null) {
  const box = $('#alertsPanel');
  if (!box) return;
  const what = state.me.user.isAdmin
    ? 'تقييم زعلان من زبون، وملخص آخر اليوم، وتنبيه إذا كاشير ضاف نقاط كتير. وكمدير منصة: طلبات الاشتراك، والمحلات الجديدة، وحوالات CliQ.'
    : 'تقييم زعلان من زبون، وملخص آخر اليوم الساعة 10 بالليل، وتنبيه إذا كاشير ضاف نقاط كتير، وتأكيد اشتراكك.';
  let on = false;
  if (pushOK && Notification.permission === 'granted') {
    try { const reg = await navigator.serviceWorker.getRegistration('/'); on = !!(reg && await reg.pushManager.getSubscription()) && state.me.userPush > 0; } catch { on = false; }
  }
  render(box, html`<h2>🔔 تنبيهات إلك</h2><p class="hint">${what}</p>
    ${!pushOK ? (dashIOS && !dashStandalone
      ? html`<p class="alert warn small">على الآيفون: افتح اللوحة بـ Safari ← <b>مشاركة ⬆️</b> ← <b>«إضافة إلى الشاشة الرئيسية»</b>، وافتحها من الأيقونة وارجع لهون.</p>`
      : html`<p class="muted small">هالمتصفح ما بيدعم الإشعارات.</p>`)
      : Notification.permission === 'denied' ? html`<p class="alert warn small">الإشعارات مسكّرة. افتحها من إعدادات الجوال للموقع.</p>`
        : on ? html`<p class="small">✅ مفعّلة على هالجهاز · <button class="linkish" type="button" id="alertTest">جرّب</button> · <button class="linkish" type="button" id="alertOff">إيقاف</button></p>`
          : html`<button class="btn" type="button" id="alertOn">فعّل التنبيهات على هالجهاز</button>`}
    ${note ? html`<p class="alert ${note.ok ? 'ok' : 'warn'} small">${note.text}</p>` : ''}`);
  const subscribe = async (test) => {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const { publicKey } = await api('/api/push/key');
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64key(publicKey) });
    const r = await api('/api/me/push', { method: 'POST', body: { ...sub.toJSON(), test } });
    state.me.userPush = Math.max(1, state.me.userPush);
    return r.result === 'ok' ? { ok: true, text: '✅ انبعتلك تنبيه تجريبي، لازم يطلعلك هلق.' } : { ok: false, text: `ما وصل التنبيه (${r.reason || 'خطأ'})` };
  };
  const on$ = $('#alertOn', box);
  if (on$) on$.onclick = async () => {
    on$.disabled = true;
    if ((await Notification.requestPermission()) !== 'granted') { drawAlerts(); return; }
    try { drawAlerts(await subscribe(true)); } catch (e) { drawAlerts({ ok: false, text: e.message }); }
  };
  const test$ = $('#alertTest', box);
  if (test$) test$.onclick = async () => { try { drawAlerts(await subscribe(true)); } catch (e) { drawAlerts({ ok: false, text: e.message }); } };
  const off$ = $('#alertOff', box);
  if (off$) off$.onclick = async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) await api('/api/me/push', { method: 'DELETE', body: { endpoint: sub.endpoint } });
    } catch { /* بنطفيها على كل حال */ }
    state.me.userPush = 0;
    drawAlerts();
  };
}


// ─── الكوبونات (تبويب العروض) ───
async function loadCoupons() {
  const box = $('#couponsPanel');
  if (!box) return;
  let r;
  try { r = await api('/api/coupons'); } catch (e) { render(box, html`<h2>🎟️ كوبونات</h2><p class="alert bad">${e.message}</p>`); return; }
  const now = Date.now();
  render(box, html`<h2>🎟️ كوبونات</h2>
    <p class="hint">عرض لمجموعة زبائن: بيطلع على بطاقاتهم وبيوصلهم إشعار، والكاشير بيصرفه لكل زبون مرة وحدة.</p>
    <form class="stack" id="couponForm">
      <input name="title" placeholder="العرض، مثلاً: خصم 20% على الكيك" maxlength="60" required>
      <input name="details" placeholder="تفاصيل (اختياري): مع أي مشروب" maxlength="200">
      <div class="row">
        <select name="segment" class="grow" aria-label="لمين">${r.segments.map((g) => html`<option value="${g.key}">${g.name} (${g.count})</option>`)}</select>
        <select name="days" class="grow" aria-label="المدة">${[[1, 'اليوم بس'], [3, '3 أيام'], [7, 'أسبوع'], [14, 'أسبوعين'], [30, 'شهر']].map(([v, l]) => html`<option value="${v}" ${v === 7 ? 'selected' : ''}>${l}</option>`)}</select>
      </div>
      <button class="btn" type="submit">ابعت الكوبون</button>
    </form>
    ${r.coupons.length ? html`<ul class="list">${r.coupons.map((cp) => html`<li><div class="main"><b>${cp.title}</b>
        <span class="small muted">${cp.segmentName} · انصرف ${fmt(cp.used)} من ${fmt(cp.issued)} · ${cp.expiresAt > now ? `لحد ${fmtDay(cp.expiresAt)}` : 'خلص'}</span></div>
        ${cp.expiresAt > now ? html`<button class="btn ghost sm" type="button" data-stop="${cp.id}">إيقاف</button>` : ''}</li>`)}</ul>` : ''}`);
  const form = $('#couponForm', box);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const seg = r.segments.find((g) => g.key === f.segment);
    if (!confirm(`تبعت «${f.title}» لـ ${seg.count} زبون؟`)) return;
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const x = await api('/api/coupons', { method: 'POST', body: f });
      let sent = x.push.sent;
      let next = x.push.next;
      while (next) {
        btn.textContent = `جاري الإرسال… ${sent}`;
        const y = await api(`/api/coupons/${x.id}/continue`, { method: 'POST', body: { cursor: next } });
        sent += y.push.sent;
        next = y.push.next;
      }
      toast(`انبعت الكوبون لـ ${x.issued} زبون (${sent} إشعار) ✅`, 'ok');
      loadCoupons();
    } catch (err) { toast(err.message, 'bad'); btn.disabled = false; btn.textContent = 'ابعت الكوبون'; }
  };
  $$('[data-stop]', box).forEach((b) => {
    b.onclick = async () => {
      if (!confirm('توقف هالكوبون؟ رح يختفي من بطاقات الزبائن.')) return;
      try { await api(`/api/coupons/${b.dataset.stop}`, { method: 'DELETE' }); loadCoupons(); } catch (e) { toast(e.message, 'bad'); }
    };
  });
}

async function loadStaff(data) {
  const panel = $('#staffPanel');
  if (!panel) return;
  let users;
  try { ({ users } = data || (await api('/api/staff'))); } catch (e) { render(panel, html`<h2>الموظفين</h2><p class="alert bad">${e.message}</p>`); return; }
  render(panel, html`
    <h2>الموظفين</h2>
    <ul class="list">${users.map((u) => html`<li class="wrap-row"><div class="main"><b>${u.name}</b><span class="small muted" dir="ltr">${u.email}</span></div>
      ${u.role === 'staff' && state.shop.locations.length ? html`<select class="staff-branch" data-id="${u.id}" aria-label="الفرع">
        <option value="">كل الفروع</option>${state.shop.locations.map((l) => html`<option value="${l.id}" ${l.id === u.branchId ? 'selected' : ''}>${l.name}</option>`)}</select>` : ''}
      <span class="badge ${u.role === 'owner' ? 'ok' : ''}">${u.role === 'owner' ? 'المالك' : 'كاشير'}</span>
      ${u.role === 'staff' ? html`<button class="btn ghost sm" type="button" data-rm="${u.id}" aria-label="حذف">✕</button>` : ''}</li>`)}</ul>
    <details><summary class="btn soft block">+ أضف كاشير</summary>
      <form class="stack" id="staffForm" style="margin-top:10px">
        <input name="name" placeholder="الاسم" required maxlength="60">
        <input name="email" type="email" placeholder="الإيميل" dir="ltr" required>
        <input name="password" type="password" placeholder="كلمة سر (8 حروف أو أكتر)" dir="ltr" minlength="8" required autocomplete="new-password">
        <button class="btn" type="submit">إضافة</button>
        <p class="hint">الكاشير بيقدر يمسح ويضيف نقاط ويصرف مكافآت. ما بيشوف رقم جوال الزبون (بس آخر 3 أرقام) وما بيكتبه: الزبون الجديد بيمسح QR الانضمام وبيعبّي بياناته بنفسه. وما بيقدر يغيّر الإعدادات أو يعدّل الرصيد يدوياً أو يحذف زبائن. بيدخل من نفس الموقع بالإيميل وكلمة السر اللي بتعطيه ياهم.</p>
      </form></details>`);
  $$('[data-rm]', panel).forEach((b) => {
    b.onclick = async () => {
      if (!confirm('تحذف هالموظف؟')) return;
      try { loadStaff(await api(`/api/staff/${b.dataset.rm}`, { method: 'DELETE' })); } catch (e) { toast(e.message, 'bad'); }
    };
  });
  $$('.staff-branch', panel).forEach((sel) => {
    sel.onchange = async () => {
      try { loadStaff(await api(`/api/staff/${sel.dataset.id}`, { method: 'PUT', body: { branchId: sel.value || null } })); toast('انحفظ ✅', 'ok'); } catch (err) { toast(err.message, 'bad'); }
    };
  });
  $('#staffForm', panel).onsubmit = async (e) => {
    e.preventDefault();
    try { loadStaff(await api('/api/staff', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) })); toast('انضاف الموظف ✅', 'ok'); } catch (err) { toast(err.message, 'bad'); }
  };
}

// ─── لوحة مدير المنصة: طلبات الاشتراك والمحلات المشتركة ───
const LEAD_STATUS = { new: ['جديد', 'warn'], contacted: ['تم التواصل', ''], won: ['اشترك ✅', 'ok'], lost: ['ما اشترك', 'bad'] };
const SUB_BADGE = {
  owner: () => ['محل المنصة', 'ok'],
  trial: (s) => [`تجربة: باقي ${s.daysLeft} يوم`, 'warn'],
  active: (s) => [`مشترك لحد ${fmtDay(s.until)}`, 'ok'],
  expired: (s) => [s.paid ? 'خلص الاشتراك' : 'خلصت التجربة', 'bad'],
};
const fmtDay = (ms) => new Intl.DateTimeFormat('ar-u-nu-latn', { dateStyle: 'medium' }).format(new Date(ms));

async function admin() {
  render(view, html`<p class="center muted">جاري التحميل…</p>`);
  let leads;
  let shops;
  let signupOpen;
  let appleSt;
  let pay;
  let resellers;
  let stats;
  const nav = state.nav;
  try {
    [{ leads }, { shops, signupOpen }, appleSt, pay, { resellers }, stats] = await Promise.all([api('/api/admin/leads'), api('/api/admin/shops'), api('/api/admin/apple'), api('/api/admin/payments'), api('/api/admin/resellers'), api('/api/admin/stats')]);
  } catch (e) { if (nav === state.nav) render(view, html`<p class="alert bad">${e.message}</p>`); return; }
  if (nav !== state.nav) return;
  const fresh = leads.filter((l) => l.status === 'new').length;
  render(view, html`
    ${subnav('admin', [['overview', '📊 الأرقام'], ['pay', `💳 الحوالات${pay.payments.some((p) => p.status === 'pending') ? ' •' : ''}`], ['shops', `🏪 المحلات والطلبات${fresh ? ` (${fresh})` : ''}`], ['partners', '🤝 المندوبين'], ['apple', '🍎 Apple Wallet']])}
    <div class="group" data-group="overview">
    ${signupOpen
      ? html`<p class="alert ok">أي محل بيقدر يسجّل ويجرّب ${14} يوم مجاناً، وبعدها بيتوقف لحاله لحد ما تفعّله من هون بـ «+ شهر» أو «+ سنة».</p>`
      : html`<p class="alert ok">التسجيل مسكّر برمز. ابعت للمحل الجديد: <span dir="ltr" class="num">${location.origin}/?code=رمزك</span></p>`}
    <div class="stats" style="margin-top:12px">
      <div class="stat"><b class="num">${fmt(stats.revenueMonth)}</b><span class="small muted">دخل هالشهر (دينار)</span></div>
      <div class="stat"><b class="num">${fmt(stats.mrr)}</b><span class="small muted">دخل شهري متكرر</span></div>
      <div class="stat"><b class="num">${fmt(stats.counts.active || 0)}</b><span class="small muted">محلات مشتركة</span></div>
      <div class="stat"><b class="num">${fmt(stats.counts.trial || 0)}</b><span class="small muted">بالتجربة</span></div>
      <div class="stat"><b class="num">${fmt(stats.counts.expired || 0)}</b><span class="small muted">متوقفة</span></div>
      <div class="stat"><b class="num">${fmt(stats.counts.newMonth)}</b><span class="small muted">سجّلوا هالشهر</span></div>
    </div>
    ${stats.ending.length ? html`<section class="panel" style="margin-top:14px"><h2>⏳ بتخلص خلال 7 أيام</h2>
      <ul class="list">${stats.ending.map((e) => html`<li><div class="main"><b>${e.name}</b><span class="small muted">${e.state === 'trial' ? 'تجربة' : 'اشتراك'} · باقي ${e.daysLeft} ${e.daysLeft === 1 ? 'يوم' : 'أيام'} · <span dir="ltr">${e.ownerEmail || ''}</span></span></div></li>`)}</ul>
      <p class="hint">صاحب المحل بيوصله تذكير لحاله قبل 3 أيام وقبل يوم (إذا مفعّل التنبيهات). أحسن وقت تحكي معه.</p></section>` : ''}
    <div class="stats" style="margin-top:12px">
      <div class="stat"><b class="num">${fresh}</b><span class="small muted">طلبات جديدة</span></div>
      <div class="stat"><b class="num">${leads.length}</b><span class="small muted">كل الطلبات</span></div>
      <div class="stat"><b class="num">${shops.length}</b><span class="small muted">محلات مسجّلة</span></div>
      <div class="stat"><b class="num">${pay.payments.filter((p) => p.status === 'pending').length}</b><span class="small muted">حوالات بتستنى</span></div>
    </div>
    </div>
    <div class="group" data-group="pay">
    ${paymentsPanel(pay)}
    </div>
    <div class="group stack-panels" data-group="shops">
    <section class="panel">
      <h2>طلبات الاشتراك</h2>
      ${leads.length ? html`<ul class="list" id="leadList">${leads.map((l) => html`<li style="align-items:flex-start">
        <div class="main"><b>${l.shopName} <span class="badge ${LEAD_STATUS[l.status][1]}">${LEAD_STATUS[l.status][0]}</span></b>
          <span class="small muted">${l.name} · <span class="num">${l.phone}</span>${l.city ? ` · ${l.city}` : ''}${l.kind ? ` · ${l.kind}` : ''}${l.reseller ? ` · 🤝 ${l.reseller}` : ''} · ${ago(l.createdAt)}</span>
          ${l.note ? html`<div class="small" style="margin-top:4px">${l.note}</div>` : ''}
          <div class="row" style="margin-top:6px">
            <a class="btn sm wa" href="${waLink(l.phone, `مرحبا ${l.name}، معك فريق نقاطك بخصوص طلب التجربة لـ ${l.shopName} 🙌`)}" target="_blank" rel="noopener">واتساب</a>
            <a class="btn sm ghost" href="tel:${l.phone}">اتصال</a>
            <select class="lead-status" data-id="${l.id}" style="width:auto;min-height:34px;padding:4px 8px">${Object.entries(LEAD_STATUS).map(([k, [label]]) => html`<option value="${k}" ${k === l.status ? 'selected' : ''}>${label}</option>`)}</select>
          </div></div></li>`)}</ul>`
        : html`<p class="muted">لسا ما وصل طلبات. شارك رابط موقعك: <span dir="ltr">${location.origin}</span></p>`}
    </section>
    <section class="panel">
      <h2>المحلات</h2>
      ${shops.length ? html`<ul class="list" id="shopList">${shops.map((s) => {
        const [label, cls] = SUB_BADGE[s.subscription.state](s.subscription);
        return html`<li style="align-items:flex-start"><div class="main"><b>${s.name} <span class="badge ${cls}">${label}</span></b>
          <span class="small muted"><span dir="ltr">${s.ownerEmail || ''}</span> · ${fmt(s.members)} زبون · من ${fmtDate(s.createdAt)} · آخر حركة ${ago(s.lastActivity)}${s.reseller ? ` · 🤝 ${s.reseller}` : ''}</span>
          ${s.subscription.state === 'owner' ? '' : html`<div class="row" style="margin-top:6px">
            <button class="btn sm" type="button" data-plan="month" data-shop="${s.id}">+ شهر</button>
            <button class="btn sm soft" type="button" data-plan="year" data-shop="${s.id}">+ سنة</button>
            ${s.subscription.state === 'expired' ? '' : html`<button class="btn sm ghost" type="button" data-plan="stop" data-shop="${s.id}">إيقاف</button>`}
          </div>`}</div></li>`;
      })}</ul>` : html`<p class="muted">ما في محلات لسا.</p>`}
    </section>
    </div>
    <div class="group" data-group="partners">
    ${resellersPanel(resellers)}
    </div>
    <div class="group" data-group="apple">
    <section class="panel stack" id="applePanel">${applePanel(appleSt)}</section>
    </div>`);
  bindSubnav('admin', 'overview');
  bindApple();
  bindPayments();
  bindResellers();
  $$('[data-plan]').forEach((b) => {
    b.onclick = async () => {
      const name = b.closest('li').querySelector('b').firstChild.textContent.trim();
      const msg = { month: `تفعيل ${name} شهر إضافي؟`, year: `تفعيل ${name} سنة إضافية؟`, stop: `إيقاف ${name} هلأ؟ الكاشير عندهم رح يتوقف.` }[b.dataset.plan];
      if (!confirm(msg)) return;
      try { await api(`/api/admin/shops/${b.dataset.shop}/plan`, { method: 'POST', body: { action: b.dataset.plan } }); toast('انحفظ ✅', 'ok'); admin(); } catch (e) { toast(e.message, 'bad'); }
    };
  });
  $$('.lead-status').forEach((sel) => {
    sel.onchange = async () => {
      try { await api(`/api/admin/leads/${sel.dataset.id}`, { method: 'PUT', body: { status: sel.value } }); admin(); toast('انحفظ', 'ok'); } catch (e) { toast(e.message, 'bad'); }
    };
  });
}



// ─── المندوبين (لوحة مدير المنصة) ───
function resellersPanel(list) {
  return html`<section class="panel stack" id="resellersPanel">
    <h2>🤝 المندوبين</h2>
    <p class="hint">كل مندوب إله رابط. المحلات اللي بتسجّل منه بتنحسبله، وعمولته نسبة من الدفعات المؤكدة (CliQ أو «+ شهر/سنة»).</p>
    ${list.length ? html`<ul class="list">${list.map((r) => html`<li style="align-items:flex-start"><div class="main">
        <b>${r.name} <span class="badge">${r.pct}%</span></b>
        <span class="small muted">${fmt(r.shops.length)} محل · مبيعات ${fmt(r.sales)} · عمولة ${fmt(r.earned)} · انصرف ${fmt(r.paid)} · <b>إله ${fmt(r.due)}</b> دينار</span>
        <div class="row" style="margin-top:6px">
          <button class="btn sm ghost" type="button" data-copy="${r.link}">رابطه</button>
          <button class="btn sm ghost" type="button" data-copy="${r.statsUrl}">صفحته</button>
          ${r.phone ? html`<a class="btn sm wa" href="${waLink(r.phone, `مرحبا ${r.name}، هاي صفحتك بنقاطك: ${r.statsUrl}`)}" target="_blank" rel="noopener">ابعتله صفحته</a>` : ''}
          ${r.due > 0 ? html`<button class="btn sm" type="button" data-payout="${r.id}" data-due="${r.due}">سجّل دفعة</button>` : ''}
        </div></div></li>`)}</ul>` : html`<p class="muted small">ما في مندوبين لسا.</p>`}
    <details><summary class="btn ghost block">+ أضف مندوب</summary>
      <form class="stack" id="resellerForm" style="margin-top:10px">
        <input name="name" placeholder="الاسم" required maxlength="60">
        <input name="phone" placeholder="الجوال (اختياري)" type="tel" dir="ltr">
        <div class="field"><label for="r-pct">العمولة (%)</label><input id="r-pct" name="pct" type="number" min="1" max="90" value="20" class="num"></div>
        <button class="btn" type="submit">إضافة</button>
      </form></details>
  </section>`;
}

function bindResellers() {
  const box = $('#resellersPanel');
  if (!box) return;
  bindCopy(box);
  $$('[data-payout]', box).forEach((b) => {
    b.onclick = async () => {
      const v = prompt('كم دفعتله؟ (دينار)', b.dataset.due);
      if (!v) return;
      try { await api(`/api/admin/resellers/${b.dataset.payout}/payout`, { method: 'POST', body: { amount: v } }); toast('انسجلت الدفعة ✅', 'ok'); admin(); } catch (e) { toast(e.message, 'bad'); }
    };
  });
  $('#resellerForm', box).onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/admin/resellers', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('انضاف المندوب ✅', 'ok'); admin(); } catch (err) { toast(err.message, 'bad'); }
  };
}

// ─── لوحة مدير المنصة: حوالات CliQ وإعداداتها ───
function paymentsPanel(pay) {
  const c = pay.cliq || {};
  return html`<section class="panel stack" style="margin-top:14px" id="payPanel">
    <h2>💳 حوالات الاشتراك</h2>
    ${pay.payments.length ? html`<ul class="list">${pay.payments.map((p) => html`<li style="align-items:flex-start"><div class="main">
        <b>${p.shopName} <span class="badge ${PAY_STATUS[p.status][1]}">${PAY_STATUS[p.status][0]}</span></b>
        <span class="small">${p.plan === 'year' ? 'سنة' : 'شهر'} · <span class="num">${p.amount}</span> دينار</span>
        <span class="small muted">من: ${p.payer}${p.ref ? html` · رقم: <span dir="ltr">${p.ref}</span>` : ''} · ${ago(p.createdAt)}</span>
        ${p.status === 'pending' ? html`<div class="row" style="margin-top:6px">
          <button class="btn sm" type="button" data-pay="${p.id}" data-act="approve">✅ وصلت، فعّل</button>
          <button class="btn sm ghost" type="button" data-pay="${p.id}" data-act="reject">❌ ما وصلت</button></div>` : ''}
      </div></li>`)}</ul>` : html`<p class="muted small">ما في حوالات لسا.</p>`}
    <details${pay.cliq ? '' : ' open'}><summary class="btn ghost block">إعدادات CliQ (اللي بيحوّلوا عليه)</summary>
      <form class="stack" id="cliqForm" style="margin-top:10px">
        <input name="cliqAlias" placeholder="الاسم المستعار (Alias) أو رقم الجوال" dir="ltr" value="${c.alias || ''}" maxlength="40">
        <input name="cliqName" placeholder="اسم صاحب الحساب" value="${c.name || ''}" maxlength="60">
        <input name="cliqBank" placeholder="البنك (اختياري)" value="${c.bank || ''}" maxlength="60">
        <button class="btn" type="submit">حفظ</button>
        <p class="hint">بيطلع للمحلات بقسم «الاشتراك» عشان يحوّلوا عليه. فاضي = الدفع عالواتساب بس.</p>
      </form></details>
  </section>`;
}

function bindPayments() {
  $$('[data-pay]').forEach((b) => {
    b.onclick = async () => {
      const ok = b.dataset.act === 'approve';
      if (!confirm(ok ? 'تأكدت إنه المبلغ وصل حسابك؟ رح ينمدد اشتراك المحل.' : 'الحوالة ما وصلت؟')) return;
      try { await api(`/api/admin/payments/${b.dataset.pay}`, { method: 'POST', body: { action: b.dataset.act } }); toast(ok ? 'انفعّل الاشتراك ✅' : 'انحفظ', 'ok'); admin(); } catch (e) { toast(e.message, 'bad'); }
    };
  });
  const f = $('#cliqForm');
  if (f) f.onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/admin/settings', { method: 'PUT', body: Object.fromEntries(new FormData(f)) }); toast('انحفظ ✅', 'ok'); admin(); } catch (err) { toast(err.message, 'bad'); }
  };
}

// ─── إعداد Apple Wallet (مرة وحدة للمنصة كلها) ───
function applePanel(st) {
  state.appleHasKey = st.hasKey;
  if (st.configured) {
    return html`<h2>Apple Wallet 🍏</h2>
      <p class="alert ok">مفعّل ✅ بطاقات الآيفون شغّالة لكل المحلات.</p>
      <p class="small muted" dir="ltr" style="text-align:right">${st.passTypeId} · Team ${st.teamId}</p>
      ${st.certExpires ? html`<p class="small">الشهادة بتخلص بـ <b>${fmtDay(st.certExpires)}</b>. قبلها بشهر بنعمل طلب جديد.</p>` : ''}
      <button class="btn ghost sm" type="button" id="appleRenew">طلب شهادة جديدة (تجديد)</button>`;
  }
  return html`<h2>Apple Wallet 🍏</h2>
    <p class="small muted">بتعملها مرة وحدة، وبعدها كل محل بيصير عنده بطاقة آيفون. بدها حساب Apple Developer.</p>
    <div class="step-row"><b>1</b><div>
      <p>اعمل ملف «طلب الشهادة» ونزّله على جوالك:</p>
      <button class="btn sm ${st.hasKey ? 'ghost' : ''}" type="button" id="appleCsr">${st.hasKey ? 'اعمل طلب جديد' : 'اعمل طلب الشهادة'}</button>
      ${st.hasKey ? html`<span class="small muted">✅ انعمل طلب. إذا ضاع الملف، اعمل طلب جديد.</span>` : ''}
    </div></div>
    <div class="step-row"><b>2</b><div>
      <p>اعمل <b>Pass Type ID</b> بموقع Apple. الوصف <span dir="ltr">Nuqatak Loyalty</span>، والمعرّف <span dir="ltr" class="num">pass.com.nuqatak.loyalty</span>:</p>
      <a class="btn sm ghost" href="https://developer.apple.com/account/resources/identifiers/add/passTypeId" target="_blank" rel="noopener">افتح صفحة Pass Type ID</a>
    </div></div>
    <div class="step-row"><b>3</b><div>
      <p>اعمل <b>Pass Type ID Certificate</b>: اختار المعرّف، وارفع ملف طلب الشهادة (الخطوة 1)، وبعدين نزّل ملف <span dir="ltr">pass.cer</span>:</p>
      <a class="btn sm ghost" href="https://developer.apple.com/account/resources/certificates/add" target="_blank" rel="noopener">افتح صفحة الشهادات</a>
    </div></div>
    <div class="step-row"><b>4</b><div>
      <p>ارفع ملف <span dir="ltr">pass.cer</span> هون:</p>
      <label class="btn sm ${st.hasKey ? '' : 'ghost'}" style="margin:0">رفع الشهادة<input type="file" id="appleCert" accept=".cer,.pem,.crt,application/x-x509-ca-cert,application/pkix-cert" class="hidden"></label>
    </div></div>`;
}

function downloadText(text, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

function bindApple() {
  // المفتاح وطلب الشهادة بينعملوا هون بالمتصفح، والملف بينزل على الجهاز
  const makeCsr = async (regenerate) => {
    const { pkcs8, spki, csrPem } = await generateKeyAndCsr();
    const b64 = (u8) => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
    await api('/api/admin/apple/key', { method: 'POST', body: { privateKey: b64(pkcs8), publicKey: b64(spki), regenerate } });
    downloadText(csrPem, 'nuqatak.certSigningRequest');
  };
  const csr = $('#appleCsr');
  if (csr) csr.onclick = async () => {
    if (state.appleHasKey && !confirm('في طلب سابق. طلب جديد بيلغي القديم، فلازم ترفع لـ Apple الملف الجديد. تكمّل؟')) return;
    csr.disabled = true;
    try {
      await makeCsr(false);
      toast('انحفظ ملف طلب الشهادة ✅', 'ok');
      setTimeout(admin, 800);
    } catch (e) { toast(e.message, 'bad'); csr.disabled = false; }
  };
  const renew = $('#appleRenew');
  if (renew) renew.onclick = async () => {
    if (!confirm('طلب جديد بيوقف بطاقات الآيفون الجديدة لحد ما ترفع الشهادة الجديدة. متأكد؟')) return;
    try { await makeCsr(true); admin(); } catch (e) { toast(e.message, 'bad'); }
  };
  const cert = $('#appleCert');
  if (cert) cert.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let s = '';
      for (const b of bytes) s += String.fromCharCode(b);
      const text = s.includes('-----BEGIN') ? s : btoa(s);
      await api('/api/admin/apple/cert', { method: 'PUT', body: { cert: text } });
      toast('Apple Wallet صار مفعّل 🍏', 'ok');
      admin();
    } catch (err) { toast(err.message, 'bad'); }
  };
}

boot();
