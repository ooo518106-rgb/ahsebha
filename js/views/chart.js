// ═══ رسم الأعمدة الشهرية للوحة التحكم (SVG بدون مكتبات) ═══
// عمودان لكل شهر (الإيرادات والمصروفات) على محور واحد. الزمن من اليمين لليسار
// مثل اتجاه القراءة، والتلميح يظهر عند المرور أو التركيز على الشهر.
import { html, esc, fmtNum, monthName, moneyText } from '../ui.js';

const SERIES = [
  { key: 'revenue', name: 'الإيرادات', cls: 's1' },
  { key: 'expenses', name: 'المصروفات', cls: 's2' },
];
const compact = new Intl.NumberFormat('ar-u-nu-latn', { notation: 'compact', maximumFractionDigits: 1 });
const tick = (v) => (Math.abs(v) >= 10000 ? compact.format(v) : fmtNum(v, 0));

function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

export function monthlyChart(box, series) {
  box.innerHTML = String(html`<div class="legend" style="margin-bottom:8px">${SERIES.map((s) => html`<span><i class="sw-${s.cls}"></i>${s.name}</span>`)}</div>
    <div class="chart-box" style="position:relative"><div data-svg></div><div class="chart-tip" role="status" hidden></div></div>
    <details style="margin-top:8px"><summary class="muted small" style="cursor:pointer">عرض البيانات كجدول</summary>
      <div class="tbl-wrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>الشهر</th><th class="num">الإيرادات</th><th class="num">المصروفات</th><th class="num">صافي الربح</th></tr></thead><tbody>
      ${series.map((m) => html`<tr><td>${monthName(m.month)} ${m.month.slice(0, 4)}</td><td class="num">${fmtNum(m.revenue)}</td><td class="num">${fmtNum(m.expenses)}</td><td class="num">${fmtNum(m.profit)}</td></tr>`)}</tbody></table></div></details>`);
  const holder = box.querySelector('[data-svg]');
  const tip = box.querySelector('.chart-tip');

  function draw() {
    const W = holder.clientWidth || 600;
    const H = 230;
    const pad = { top: 14, bottom: 30, start: 56, end: 6 };
    const plotW = W - pad.start - pad.end;
    const plotH = H - pad.top - pad.bottom;
    const max = Math.max(0, ...series.flatMap((m) => [m.revenue, m.expenses]));
    const step = niceStep(max / 4);
    const top = Math.max(step, Math.ceil(max / step) * step);
    const y = (v) => pad.top + plotH - (Math.max(0, v) / top) * plotH;
    const band = plotW / series.length;
    const bw = Math.min(24, Math.max(6, band * 0.28));
    const gap = 2;
    // RTL: الشهر الأول في أقصى اليمين (بجانب المحور)
    const bandX = (i) => pad.end + plotW - (i + 1) * band;
    const ticks = [];
    for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
    const bar = (x, v, cls) => {
      const h = Math.max(0, y(0) - y(v));
      if (h <= 0) return '';
      const r = Math.min(4, h, bw / 2);
      const x2 = x + bw, yb = y(0), yt = yb - h;
      return `<path class="${cls}" d="M${x} ${yb}V${yt + r}Q${x} ${yt} ${x + r} ${yt}H${x2 - r}Q${x2} ${yt} ${x2} ${yt + r}V${yb}Z"/>`;
    };
    let svg = `<svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="الإيرادات والمصروفات لآخر ستة أشهر">`;
    for (const v of ticks) {
      const yy = Math.round(y(v)) + 0.5;
      svg += `<line class="grid" x1="${pad.end}" x2="${W - pad.start + 6}" y1="${yy}" y2="${yy}"/>`;
      // النص عربي الاتجاه: بداية السطر عند الحافة اليمنى
      svg += `<text class="ax" x="${W - 2}" y="${yy + 4}" text-anchor="start">${esc(tick(v))}</text>`;
    }
    series.forEach((m, i) => {
      const bx = bandX(i);
      const cx = bx + band / 2;
      const x1 = cx + gap / 2;             // الإيرادات يميناً
      const x2 = cx - gap / 2 - bw;        // المصروفات يساراً
      svg += `<g class="bandg" tabindex="0" data-i="${i}" aria-label="${esc(`${monthName(m.month)}: الإيرادات ${moneyText(m.revenue)}، المصروفات ${moneyText(m.expenses)}`)}">`;
      svg += `<rect class="hit" x="${bx}" y="${pad.top}" width="${band}" height="${plotH}"/>`;
      svg += bar(x1, m.revenue, 's1') + bar(x2, m.expenses, 's2');
      const label = band >= 42 ? monthName(m.month) : String(Number(m.month.slice(5, 7)));
      svg += `<text class="ax" x="${cx}" y="${H - 10}" text-anchor="middle">${esc(label)}</text></g>`;
    });
    svg += `<line class="base" x1="${pad.end}" x2="${W - pad.start + 6}" y1="${Math.round(y(0)) + 0.5}" y2="${Math.round(y(0)) + 0.5}"/></svg>`;
    holder.innerHTML = svg;
  }

  function show(i, anchorX) {
    const m = series[i];
    if (!m) return;
    tip.replaceChildren();
    const title = document.createElement('div');
    title.className = 'tip-t';
    title.textContent = `${monthName(m.month)} ${m.month.slice(0, 4)}`;
    tip.append(title);
    for (const [label, v, cls] of [['الإيرادات', m.revenue, 's1'], ['المصروفات', m.expenses, 's2'], ['صافي الربح', m.profit, '']]) {
      const row = document.createElement('div');
      row.className = 'tip-r';
      const key = document.createElement('i');
      key.className = cls ? 'key-' + cls : 'key-none';
      const val = document.createElement('b');
      val.textContent = moneyText(v);
      val.dir = 'ltr';
      const lab = document.createElement('span');
      lab.textContent = label;
      row.append(key, val, lab);
      tip.append(row);
    }
    tip.hidden = false;
    const bw = box.querySelector('.chart-box').clientWidth;
    const tw = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(bw - tw, anchorX - tw / 2)) + 'px';
    box.querySelectorAll('.bandg').forEach((g) => g.classList.toggle('on', Number(g.dataset.i) === i));
  }
  const hide = () => { tip.hidden = true; box.querySelectorAll('.bandg.on').forEach((g) => g.classList.remove('on')); };

  holder.addEventListener('pointermove', (e) => {
    const g = e.target.closest('.bandg');
    if (!g) return hide();
    const r = box.querySelector('.chart-box').getBoundingClientRect();
    show(Number(g.dataset.i), e.clientX - r.left);
  });
  holder.addEventListener('pointerleave', hide);
  holder.addEventListener('focusin', (e) => {
    const g = e.target.closest('.bandg');
    if (!g) return;
    const r = box.querySelector('.chart-box').getBoundingClientRect();
    const gr = g.getBoundingClientRect();
    show(Number(g.dataset.i), gr.left + gr.width / 2 - r.left);
  });
  holder.addEventListener('focusout', hide);

  draw();
  if (typeof ResizeObserver !== 'undefined') {
    let w = holder.clientWidth;
    const ro = new ResizeObserver(() => { if (holder.isConnected && holder.clientWidth !== w) { w = holder.clientWidth; draw(); } if (!holder.isConnected) ro.disconnect(); });
    ro.observe(holder);
  }
}
