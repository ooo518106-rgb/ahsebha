// صفحة المندوب (برابطه السري): رابطه للمشاركة، المحلات اللي سجّلت منه، وعمولته
import { $, api, fmt, html, render } from './common.js?v=1.82';

const token = location.pathname.split('/')[2];
const root = $('#root');
const STATE = { trial: ['تجربة', 'warn'], active: ['مشترك', 'ok'], expired: ['متوقف', 'bad'], owner: ['—', ''] };
const day = (ms) => new Intl.DateTimeFormat('ar-u-nu-latn', { dateStyle: 'medium' }).format(new Date(ms));

async function main() {
  let r;
  try { r = await api(`/api/partner/${token}`); } catch (e) {
    render(root, html`<div class="panel center" style="margin-top:60px"><h1>😕</h1><p>${e.message}</p></div>`);
    return;
  }
  const wa = `https://wa.me/?text=${encodeURIComponent(`جرّب نقاطك لمحلك: بطاقة ولاء بمحفظة الجوال لزبائنك، وأول 14 يوم مجاناً 🎁\n${r.link}`)}`;
  render(root, html`
    <div class="brand-hero"><img src="/img/nuqatak-logo.png" alt=""><h1>أهلاً ${r.name} 👋</h1><p class="muted">صفحتك كمندوب لـ «نقاطك»</p></div>
    <section class="panel stack">
      <h2>رابطك</h2>
      <p class="small muted">أي محل بيسجّل أو بيبعت طلب من هالرابط بينحسبلك، وإلك <b>${r.pct}%</b> من كل اشتراك بيدفعه.</p>
      <input readonly dir="ltr" value="${r.link}" id="link">
      <div class="row"><button class="btn grow" type="button" id="copy">نسخ الرابط</button><a class="btn ghost grow wa" href="${wa}" target="_blank" rel="noopener">شاركه عالواتساب</a></div>
    </section>
    <div class="stats" style="margin-top:14px">
      <div class="stat"><b class="num">${fmt(r.shops.length)}</b><span class="small muted">محلات سجّلت منك</span></div>
      <div class="stat"><b class="num">${fmt(r.earned)}</b><span class="small muted">عمولتك (دينار)</span></div>
      <div class="stat"><b class="num">${fmt(r.paid)}</b><span class="small muted">انصرفلك</span></div>
      <div class="stat"><b class="num">${fmt(r.due)}</b><span class="small muted">إلك</span></div>
    </div>
    <section class="panel" style="margin-top:14px"><h2>محلاتك</h2>
      ${r.shops.length ? html`<ul class="list">${r.shops.map((s) => html`<li><div class="main"><b>${s.name}</b><span class="small muted">من ${day(s.createdAt)}</span></div><span class="badge ${STATE[s.state][1]}">${STATE[s.state][0]}</span></li>`)}</ul>`
        : html`<p class="muted small">لسا ما سجّل محل من رابطك. شاركه مع أصحاب المطاعم والكوفي شوبات اللي بتعرفهم.</p>`}
    </section>
    <p class="powered"><a href="/">نقاطك</a></p>`);
  $('#copy').onclick = async () => {
    try { await navigator.clipboard.writeText(r.link); $('#copy').textContent = 'انسخ ✅'; } catch { $('#link').select(); }
  };
}

main();
