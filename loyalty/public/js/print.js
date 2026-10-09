// صفحة الطباعة: ملصق كاونتر A4، كروت طاولات (4 بالصفحة)، أو ستيكرات شباك (6 بالصفحة) — للانضمام أو للمنيو
import { $, api, html, qrSVG, raw, render } from './common.js';

const slug = location.pathname.split('/')[2];
const params = new URLSearchParams(location.search);
const what = params.get('for') === 'menu' ? 'menu' : 'join';
const layout = ['poster', 'table', 'sticker'].includes(params.get('layout')) ? params.get('layout') : 'poster';
const root = $('#root');

const TEXT = {
  join: { head: 'امسح وخذ بطاقة الولاء 🎁', sub: 'بتنحفظ بمحفظة جوالك، وبتجمع نقاط مع كل طلب' },
  menu: { head: 'امسح وشوف المنيو 📋', sub: 'واجمع نقاط مع كل طلب ☕' },
};

function tile(shop, url, size) {
  const tx = TEXT[what];
  return html`<div class="pt pt-${size}" style="--c:${shop.color}">
    <img class="pt-logo" src="${shop.logo}" alt="">
    <div class="pt-name">${shop.name}</div>
    <div class="pt-head">${tx.head}</div>
    <div class="pt-qr">${qrSVG(url, tx.head)}</div>
    ${size === 'poster' ? html`<div class="pt-sub">${tx.sub}</div><div class="pt-rule">${shop.rule}</div>` : html`<div class="pt-sub">${tx.sub}</div>`}
    <div class="pt-foot">نقاطك</div>
  </div>`;
}

async function main() {
  let shop;
  try { ({ shop } = await api(`/api/shops/${encodeURIComponent(slug)}/public`)); } catch (e) {
    render(root, html`<p class="center" style="padding:60px">${e.message}</p>`);
    return;
  }
  const url = `${location.origin}/${what === 'menu' ? 'm' : 'j'}/${shop.slug}`;
  const per = { poster: 1, table: 4, sticker: 6 }[layout];
  const link = (w, l, label) => html`<a class="btn sm ${w === what && l === layout ? '' : 'ghost'}" href="?for=${w}&layout=${l}">${label}</a>`;
  render(root, html`
    <div class="print-bar no-print">
      <div class="row">
        ${link('join', 'poster', 'ملصق A4')}${link('join', 'table', 'كروت طاولات')}${link('join', 'sticker', 'ستيكرات')}
        ${link('menu', 'table', 'QR المنيو للطاولات')}${link('menu', 'poster', 'ملصق المنيو')}
      </div>
      <button class="btn" type="button" id="doPrint">🖨️ اطبع أو احفظ PDF</button>
      <p class="small muted">من نافذة الطباعة اختار «حفظ كـ PDF» إذا بدك تبعته للمطبعة. كروت الطاولات بتنقص عالخط المنقّط وبتنطوى.</p>
    </div>
    <div class="sheet sheet-${layout}">${Array.from({ length: per }, () => tile(shop, url, layout))}</div>`);
  document.title = `${shop.name} — اطبع`;
  $('#doPrint').onclick = () => window.print();
  // على الجوال: الورقة A4 (794px) بتصغر لتبيّن كاملة بدون تمرير لليمين، والطباعة بتضل A4
  const fit = () => { const k = Math.min(1, (window.innerWidth - 16) / 794); document.querySelectorAll('.sheet').forEach((s) => { s.style.zoom = k < 1 ? String(k) : ''; }); };
  fit();
  window.addEventListener('resize', fit);
}

main();
