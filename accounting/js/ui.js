// ═══ أدوات الواجهة: قوالب آمنة، تنسيق، نوافذ، قوائم بحث، تصدير وطباعة ═══
import { currencyInfo, num, round } from './core.js';

// ─── قوالب HTML آمنة: كل قيمة تُهرَّب تلقائياً إلا ما صُنع بـ html أو raw ───
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(String(s ?? ''));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
function part(v) {
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  if (v == null || v === false || v === true) return '';
  return esc(v);
}
export function html(strings, ...vals) {
  let s = strings[0];
  for (let i = 0; i < vals.length; i++) s += part(vals[i]) + strings[i + 1];
  return new Safe(s);
}
// خاصية HTML بقيمة مُهرَّبة: ${attr('data-href', url)}
export const attr = (name, value) => new Safe(` ${name}="${esc(value)}"`);
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ─── التنسيق ───
let S = {};
export const setSettings = (s) => { S = s || {}; };
export const cur = () => currencyInfo(S.currency);

export function fmtNum(v, dec = cur().dec) {
  return Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
export function moneyText(v, { sym = true, dec } = {}) {
  const c = cur();
  const n = round(num(v), dec ?? c.dec);
  return (n < 0 ? '-' : '') + fmtNum(Math.abs(n), dec ?? c.dec) + (sym ? ' ' + c.sym : '');
}
// الأرقام داخل dir=ltr حتى لا تنقلب إشارة السالب في النص العربي
export function money(v, { sym = false, paren = false, dec, cls = '' } = {}) {
  const c = cur();
  const n = round(num(v), dec ?? c.dec);
  const s = fmtNum(Math.abs(n), dec ?? c.dec);
  const t = n < 0 ? (paren ? `(${s})` : `-${s}`) : s;
  return html`<span class="n${n < 0 ? ' neg' : ''}${cls ? ' ' + cls : ''}" dir="ltr">${t}</span>${sym ? html`<small class="cur"> ${c.sym}</small>` : ''}`;
}
export function qty(v) {
  const n = round(num(v), 3);
  return html`<span class="n" dir="ltr">${n.toLocaleString('en-US', { maximumFractionDigits: 3 })}</span>`;
}
export function fmtDate(s) {
  if (!s) return '';
  const [y, m, d] = String(s).split('-');
  return `${d}/${m}/${y}`;
}
export function hijri(s) {
  try {
    return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(s + 'T12:00:00'));
  } catch (e) { return ''; }
}
export const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const monthName = (s) => MONTHS[Number(String(s).slice(5, 7)) - 1] || '';

// تطبيع البحث العربي: الهمزات والتاء المربوطة والياء والتشكيل
export const norm = (s) => String(s ?? '').toLowerCase()
  .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .replace(/[ً-ْـ]/g, '');

// ─── إشعارات قصيرة ───
export function toast(msg, kind = 'ok') {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = document.createElement('div');
  t.className = 'toast toast-' + kind;
  t.textContent = msg;
  box.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, kind === 'err' ? 4500 : 2600);
}

// ─── نوافذ حوار ───
export function modal({ title, body, wide = false, onMount }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dlg' + (wide ? ' dlg-wide' : '');
    dlg.innerHTML = String(html`<div class="dlg-box">
      <header class="dlg-head"><h2>${title}</h2><button type="button" class="icon-btn" data-x aria-label="إغلاق">✕</button></header>
      <div class="dlg-body">${body}</div></div>`);
    let result = null;
    const done = (v) => { result = v; dlg.close(); };
    dlg.querySelector('[data-x]').onclick = () => done(null);
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) done(null); });
    document.body.append(dlg);
    dlg.showModal();
    if (onMount) onMount(dlg, done);
    const f = dlg.querySelector('[autofocus]');
    if (f) f.focus();
  });
}

export function confirmBox(message, { ok = 'تأكيد', danger = false, title = 'تأكيد' } = {}) {
  return modal({
    title,
    body: html`<p class="dlg-msg">${message}</p>
      <div class="dlg-actions"><button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${ok}</button>
      <button type="button" class="btn btn-ghost" data-no>إلغاء</button></div>`,
    onMount: (dlg, done) => {
      dlg.querySelector('[data-ok]').onclick = () => done(true);
      dlg.querySelector('[data-no]').onclick = () => done(false);
      dlg.querySelector('[data-ok]').focus();
    },
  }).then((v) => v === true);
}

// ─── قائمة بحث منسدلة (عملاء، منتجات، حسابات) ───
// items(): [{ value, label, sub, search }]؛ onPick(item)؛ onCreate(text) يرجّع عنصراً جديداً
export function combo(input, { items, onPick, onCreate, createLabel = 'إضافة', onType, empty = 'لا توجد نتائج' }) {
  const wrap = document.createElement('div');
  wrap.className = 'combo';
  input.replaceWith(wrap);
  wrap.append(input);
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  const list = document.createElement('ul');
  list.className = 'combo-list';
  list.hidden = true;
  list.setAttribute('role', 'listbox');
  wrap.append(list);
  let opts = [];
  let active = 0;

  function render() {
    const text = input.value.trim();
    const q = norm(text);
    const all = items();
    const hit = (it) => norm(`${it.label} ${it.sub || ''} ${it.search || ''}`).includes(q);
    opts = (q ? all.filter(hit) : all).slice(0, 60);
    if (onCreate && text && !all.some((it) => norm(it.label) === q)) opts.push({ create: true, label: text });
    if (active >= opts.length) active = Math.max(0, opts.length - 1);
    list.innerHTML = opts.length
      ? opts.map((o, i) => String(html`<li role="option" data-i="${i}" class="${i === active ? 'on' : ''}">${o.create
        ? html`<span>➕ ${createLabel}: <b>${o.label}</b></span>`
        : html`<span>${o.label}</span>${o.sub ? html`<small>${o.sub}</small>` : ''}`}</li>`)).join('')
      : String(html`<li class="none">${empty}</li>`);
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    const on = list.querySelector('.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  }
  const hide = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); };
  async function pick(o) {
    if (!o) return;
    hide();
    if (o.create) {
      const it = await onCreate(o.label);
      if (it) onPick(it);
    } else onPick(o);
  }
  input.addEventListener('focus', () => { active = 0; render(); input.select(); });
  input.addEventListener('input', () => { active = 0; if (onType) onType(input.value); render(); });
  input.addEventListener('blur', () => setTimeout(hide, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) render(); active = Math.min(opts.length - 1, active + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); render(); }
    else if (e.key === 'Enter') { if (!list.hidden && opts[active]) { e.preventDefault(); pick(opts[active]); } }
    else if (e.key === 'Escape') hide();
  });
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) pick(opts[Number(li.dataset.i)]); });
  return { refresh: render, close: hide };
}

// ─── تصدير CSV (يفتح في Excel بالعربي) ───
export function toCSV(rows) {
  const cell = (c) => {
    let s = String(c ?? '');
    // منع تنفيذ الصيغ عند فتح الملف في Excel (نص يبدأ بـ = أو + أو @)
    if (/^[=+\-@\t\r]/.test(s) && !/^-?[\d,.]+$/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}
export function tableRows(table) {
  const clean = (t) => {
    const s = t.replace(/\s+/g, ' ').trim();
    const m = s.match(/^\(?-?[\d,]+(\.\d+)?\)?$/);
    if (!m) return s;
    const v = s.replace(/[,()]/g, '');
    return s.startsWith('(') ? '-' + v : v;
  };
  return $$('tr', table).map((tr) => $$('th,td', tr).map((c) => clean(c.dataset.v ?? c.textContent)));
}
export function download(name, content, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}
export function exportTable(table, name) { download(name.replace(/[\\/:*?"<>|]/g, '-') + '.csv', toCSV(tableRows(table))); }

// ─── الطباعة: تُعرض الورقة وحدها وتختفي الواجهة ───
export function printHTML(content, { size = 'a4', title } = {}) {
  const area = document.getElementById('print-area');
  const page = document.getElementById('print-page');
  area.innerHTML = String(content);
  area.className = 'print-' + size;
  page.textContent = size === 'receipt' ? '@page { size: 80mm auto; margin: 3mm; }' : '@page { size: A4; margin: 10mm; }';
  document.body.classList.add('printing');
  const old = document.title;
  if (title) document.title = title;
  // التنظيف بعد الطباعة، أو عند أول لمسة إن لم يُطلق المتصفح afterprint
  const done = () => {
    document.body.classList.remove('printing');
    area.innerHTML = '';
    document.title = old;
    window.removeEventListener('afterprint', done);
    document.removeEventListener('pointerdown', done);
  };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(() => document.addEventListener('pointerdown', done), 400); }, 60);
}

export function qrSVG(text, size = 120) {
  if (typeof window === 'undefined' || !window.qrcode) return '';
  const q = window.qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  const cell = size / (n + 8);
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${(c + 4) * cell} ${(r + 4) * cell}h${cell}v${cell}h-${cell}z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="رمز QR للفاتورة"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// ─── مكوّنات صغيرة ───
export const STATE_BADGE = {
  paid: ['مدفوعة', 'ok'], partial: ['مدفوعة جزئياً', 'warn'], unpaid: ['غير مدفوعة', 'muted'], overdue: ['متأخرة', 'bad'],
  open: ['مفتوح', 'info'], converted: ['تحوّل لفاتورة', 'ok'], expired: ['منتهي', 'muted'],
};
export function badge(state) {
  const [t, k] = STATE_BADGE[state] || [state, 'muted'];
  return html`<span class="badge badge-${k}">${t}</span>`;
}

export function empty(icon, title, text, action) {
  return html`<div class="empty"><div class="empty-ic">${icon}</div><h3>${title}</h3>${text ? html`<p>${text}</p>` : ''}${action || ''}</div>`;
}

export function field(label, control, { hint, err, cls = '' } = {}) {
  return html`<label class="fld ${cls}"><span class="fld-l">${label}</span>${control}${hint ? html`<small class="fld-h">${hint}</small>` : ''}<small class="fld-e" ${err ? '' : raw('hidden')}>${err || ''}</small></label>`;
}

export function showErrors(root, errors) {
  $$('.has-err', root).forEach((e) => e.classList.remove('has-err'));
  $$('[data-err]', root).forEach((e) => { e.hidden = true; e.textContent = ''; });
  let first = null;
  for (const [k, msg] of Object.entries(errors || {})) {
    const box = root.querySelector(`[data-err="${k}"]`);
    if (box) { box.hidden = false; box.textContent = msg; }
    const ctl = root.querySelector(`[data-f="${k}"]`);
    if (ctl) { ctl.classList.add('has-err'); first = first || ctl; }
    else if (box) first = first || box;
  }
  if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return !first;
}
