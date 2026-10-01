// لوحة المحل: الكاشير (مسح وإضافة نقاط)، الزبائن، النشاط، رابط الانضمام، والإعدادات
import { $, $$, ago, api, cardHTML, fmt, fmtDate, html, newKey, qrSVG, render, setBrand, stampsHTML, toast } from './common.js';
import { generateKeyAndCsr } from './csr.js';
import { parseLatLng } from './rules.js';
import { startCameraScan } from './scan.js';

const state = { me: null, shop: null, google: null, member: null, key: newKey(), stopScan: null };
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
  const link = (text) => (wa ? `https://wa.me/${wa}?text=${encodeURIComponent(text)}` : null);
  const ask = `مرحبا، بدي أشترك بنقاطك لمحل ${state.shop.name}`;
  let tpl = null;
  if (sub.state === 'expired') {
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
}

function applyShop() {
  setBrand(state.shop.color);
  $('#shopLogo').src = state.shop.logo;
  $('#shopName').textContent = state.shop.name;
  document.title = `${state.shop.name} — نقاطك`;
}

const VIEWS = { cashier, members, activity, join: joinView, settings, admin };
function route() {
  stopCamera();
  $('#dlg').onclose = null;
  let tab = location.hash.slice(1) || 'cashier';
  if (!VIEWS[tab] || (tab === 'settings' && !isOwner()) || (tab === 'admin' && !state.me.user.isAdmin)) tab = 'cashier';
  $$('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  VIEWS[tab]();
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

function cashier() {
  render(view, html`
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
      <button class="btn ghost block" id="openMember" type="button">ملف الزبون ورابط بطاقته</button>
    </div>`);

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
    amount.oninput = () => {
      const pts = Math.floor(Number(amount.value) * s.pointsPerUnit + 1e-9);
      $('#preview').textContent = pts > 0 ? `+${fmt(pts)} نقطة` : ' ';
    };
    $('#earnForm').onsubmit = (e) => { e.preventDefault(); earn(m, { amount: amount.value }); };
    if (matchMedia('(pointer: fine)').matches) amount.focus();
  }
}

// لو السيرفر رد إنه الاشتراك خلص، منحدّث الشريط فوق
async function onSubError(e) {
  if (e.status === 402) { try { await loadMe(); } catch { /* بنضل على الرسالة */ } }
}

async function earn(m, body) {
  const btn = $('#earnBtn');
  btn.disabled = true;
  try {
    const r = await api(`/api/members/${m.id}/earn`, { method: 'POST', body: { ...body, key: state.key } });
    state.key = newKey();
    state.member = r.member;
    toast(r.duplicate ? 'هاي الحركة انسجلت قبل' : `+${fmt(r.delta)} ${state.shop.unit} لـ ${m.name}`, 'ok');
    showMember(r.member);
  } catch (e) {
    toast(e.message, 'bad');
    btn.disabled = false;
    onSubError(e);
  }
}

async function redeem(m) {
  if (!confirm(`صرف «${state.shop.rewardName}» لـ ${m.name}؟`)) return;
  const btn = $('#redeemBtn');
  btn.disabled = true;
  try {
    const r = await api(`/api/members/${m.id}/redeem`, { method: 'POST', body: { key: state.key } });
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

function newMemberDialog() {
  const body = openDialog('زبون جديد', html`
    <form class="stack" id="nm" novalidate>
      <div class="field"><label for="nmName">الاسم</label><input id="nmName" name="name" required maxlength="60"></div>
      <div class="field"><label for="nmPhone">رقم الجوال</label><input id="nmPhone" name="phone" type="tel" inputmode="tel" dir="ltr" required></div>
      <p class="error" id="nmErr"></p>
      <button class="btn big block" type="submit">إنشاء البطاقة</button>
      <p class="hint">أسهل للزبون يمسح QR الانضمام بنفسه (تبويب «الانضمام»). هون للي ما معه نت أو مستعجل.</p>
    </form>`);
  $('#nmName', body).focus();
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
      <a class="btn grow" href="${waLink(m.phone, cardMessage(m, url))}" target="_blank" rel="noopener">واتساب</a>
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
      <span class="small muted">${withMember ? `${KIND[t.kind]} · ` : ''}${t.amount ? `${fmt(t.amount)} ${state.shop.currency} · ` : ''}${t.note ? `${t.note} · ` : ''}${t.by || ''} · ${ago(t.at)}</span></div>
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
      ${pushLine(d.push)}
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
      <div class="row"><input class="grow" id="q" type="search" placeholder="دوّر بالاسم أو الجوال أو رقم البطاقة"><button class="btn soft" id="addM" type="button">+ زبون</button></div>
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
  try { r = await api(`/api/activity?dayStart=${+day}&weekStart=${+week}&monthStart=${+month}`); } catch (e) { render(view, html`<p class="alert bad">${e.message}</p>`); return; }
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
}

// ─── رابط الانضمام والملصق ───
function joinView() {
  const s = state.shop;
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
          <button class="btn grow" id="print" type="button">🖨️ اطبع الملصق</button>
          <button class="btn ghost grow" type="button" data-copy="${s.joinUrl}">نسخ الرابط</button>
          <a class="btn ghost grow" href="${s.joinUrl}" target="_blank" rel="noopener">جرّب الصفحة</a>
        </div>
        <p class="hint">حط الرابط كمان بالانستغرام والواتساب بزنس.</p>
      </section>
    </div>`);
  bindCopy(view);
  $('#print').onclick = () => window.print();
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
      <button class="btn soft" type="submit">ابعت الإشعار</button>
      <p class="hint">بتوصل لـ <b class="num">${n}</b> ${n === 1 ? 'زبون' : 'زبون'} فعّلوا الإشعارات${state.google.enabled ? '، وللي حافظين البطاقة بمحفظة Google' : ''}. مسموح 3 رسائل باليوم، فخليها للعروض المهمة.</p>
    </form>`;
}

async function settings() {
  const s = state.shop;
  let locs = s.locations.map((l) => ({ ...l }));
  render(view, html`
    <div class="grid2" style="align-items:start">
      <div>
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
      </div>
      <div>
        <section class="panel stack">
          <h2>شكل البطاقة</h2>
          <div id="preview"></div>
          <div class="row">
            <label class="btn ghost grow" style="margin:0">رفع الشعار<input type="file" id="logoFile" accept="image/png,image/jpeg" class="hidden"></label>
            ${s.customLogo ? html`<button class="btn ghost" id="logoRemove" type="button">الشعار الافتراضي</button>` : ''}
          </div>
          <p class="hint">صورة مربعة PNG أو JPG، والأفضل 660×660.</p>
        </section>
        <section class="panel stack">${broadcastPanel()}</section>
        <section class="panel stack"><h2>محفظة Google</h2><div id="gpanel">${googlePanel()}</div></section>
        <section class="panel stack" id="staffPanel"><h2>الموظفين</h2><p class="muted small">جاري التحميل…</p></section>
        <form class="panel stack" id="pwForm">
          <h2>كلمة السر</h2>
          <input name="current" type="password" placeholder="كلمة السر الحالية" autocomplete="current-password" dir="ltr" required>
          <input name="next" type="password" placeholder="كلمة السر الجديدة (8 حروف أو أكتر)" autocomplete="new-password" dir="ltr" minlength="8" required>
          <button class="btn ghost" type="submit">غيّر كلمة السر</button>
        </form>
      </div>
    </div>`);

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
    btn.textContent = 'ابعت الإشعار';
  };

  $('#pwForm').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/me/password', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); toast('تغيّرت كلمة السر ✅', 'ok'); } catch (err) { toast(err.message, 'bad'); }
  };

  refresh();
  drawLocs();
  loadStaff();
}

async function loadStaff(data) {
  const panel = $('#staffPanel');
  if (!panel) return;
  let users;
  try { ({ users } = data || (await api('/api/staff'))); } catch (e) { render(panel, html`<h2>الموظفين</h2><p class="alert bad">${e.message}</p>`); return; }
  render(panel, html`
    <h2>الموظفين</h2>
    <ul class="list">${users.map((u) => html`<li><div class="main"><b>${u.name}</b><span class="small muted" dir="ltr">${u.email}</span></div>
      <span class="badge ${u.role === 'owner' ? 'ok' : ''}">${u.role === 'owner' ? 'المالك' : 'كاشير'}</span>
      ${u.role === 'staff' ? html`<button class="btn ghost sm" type="button" data-rm="${u.id}" aria-label="حذف">✕</button>` : ''}</li>`)}</ul>
    <details><summary class="btn soft block">+ أضف كاشير</summary>
      <form class="stack" id="staffForm" style="margin-top:10px">
        <input name="name" placeholder="الاسم" required maxlength="60">
        <input name="email" type="email" placeholder="الإيميل" dir="ltr" required>
        <input name="password" type="password" placeholder="كلمة سر (8 حروف أو أكتر)" dir="ltr" minlength="8" required autocomplete="new-password">
        <button class="btn" type="submit">إضافة</button>
        <p class="hint">الكاشير بيقدر يمسح ويضيف نقاط ويصرف مكافآت، بس ما بيقدر يغيّر الإعدادات أو يعدّل الرصيد يدوياً.</p>
      </form></details>`);
  $$('[data-rm]', panel).forEach((b) => {
    b.onclick = async () => {
      if (!confirm('تحذف هالموظف؟')) return;
      try { loadStaff(await api(`/api/staff/${b.dataset.rm}`, { method: 'DELETE' })); } catch (e) { toast(e.message, 'bad'); }
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
  try {
    [{ leads }, { shops, signupOpen }, appleSt] = await Promise.all([api('/api/admin/leads'), api('/api/admin/shops'), api('/api/admin/apple')]);
  } catch (e) { render(view, html`<p class="alert bad">${e.message}</p>`); return; }
  const fresh = leads.filter((l) => l.status === 'new').length;
  render(view, html`
    ${signupOpen
      ? html`<p class="alert ok">أي محل بيقدر يسجّل ويجرّب ${14} يوم مجاناً، وبعدها بيتوقف لحاله لحد ما تفعّله من هون بـ «+ شهر» أو «+ سنة».</p>`
      : html`<p class="alert ok">التسجيل مسكّر برمز. ابعت للمحل الجديد: <span dir="ltr" class="num">${location.origin}/?code=رمزك</span></p>`}
    <div class="stats" style="margin-top:12px">
      <div class="stat"><b class="num">${fresh}</b><span class="small muted">طلبات جديدة</span></div>
      <div class="stat"><b class="num">${leads.length}</b><span class="small muted">كل الطلبات</span></div>
      <div class="stat"><b class="num">${shops.length}</b><span class="small muted">محلات مسجّلة</span></div>
    </div>
    <section class="panel" style="margin-top:14px">
      <h2>طلبات الاشتراك</h2>
      ${leads.length ? html`<ul class="list" id="leadList">${leads.map((l) => html`<li style="align-items:flex-start">
        <div class="main"><b>${l.shopName} <span class="badge ${LEAD_STATUS[l.status][1]}">${LEAD_STATUS[l.status][0]}</span></b>
          <span class="small muted">${l.name} · <span class="num">${l.phone}</span>${l.city ? ` · ${l.city}` : ''}${l.kind ? ` · ${l.kind}` : ''} · ${ago(l.createdAt)}</span>
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
          <span class="small muted"><span dir="ltr">${s.ownerEmail || ''}</span> · ${fmt(s.members)} زبون · من ${fmtDate(s.createdAt)} · آخر حركة ${ago(s.lastActivity)}</span>
          ${s.subscription.state === 'owner' ? '' : html`<div class="row" style="margin-top:6px">
            <button class="btn sm" type="button" data-plan="month" data-shop="${s.id}">+ شهر</button>
            <button class="btn sm soft" type="button" data-plan="year" data-shop="${s.id}">+ سنة</button>
            ${s.subscription.state === 'expired' ? '' : html`<button class="btn sm ghost" type="button" data-plan="stop" data-shop="${s.id}">إيقاف</button>`}
          </div>`}</div></li>`;
      })}</ul>` : html`<p class="muted">ما في محلات لسا.</p>`}
    </section>
    <section class="panel stack" id="applePanel">${applePanel(appleSt)}</section>`);
  bindApple();
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
