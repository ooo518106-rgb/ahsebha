// ═══ الكاشير (نقطة البيع) وتقفيل الصندوق اليومي ═══
import * as store from '../store.js';
import { calcDoc, validateDoc, num, round, docNo, moneyAccounts, balances, paymentList, nextAccountCode, lineFactor } from '../core.js';
import { html, raw, money, moneyText, toast, confirmBox, modal, combo, $, $$, norm, field, fmtDate } from '../ui.js';
import { go, setTitle, docHref, withQuery } from '../nav.js';
import { S, dec, today, partyItems, quickParty, docPaper, printPaper, cameraDialog, partyName, accName, defaultWh } from './common.js';
import { can, usersEnabled } from '../auth.js';

const HELD_KEY = 'ahsebha-pos-held';
const newCart = () => ({ lines: [], party: null });
let cart = newCart();

const readHeld = () => { try { return JSON.parse(localStorage.getItem(HELD_KEY) || '[]'); } catch (e) { return []; } };
const writeHeld = (xs) => { try { localStorage.setItem(HELD_KEY, JSON.stringify(xs.slice(0, 30))); } catch (e) { /* التعليق اختياري */ } };

// حسابات الدفع في الكاشير: النقد والبطاقة
function posAccounts() {
  const s = S();
  const money = moneyAccounts(store.getDb());
  const cash = money.find((a) => a.id === s.posCash) || money.find((a) => a.id === 'cash') || money[0];
  const card = money.find((a) => a.id === s.posCard) || money.find((a) => a.id !== (cash && cash.id)) || cash;
  return { cash, card, money };
}

export function pos({ root }) {
  setTitle('الكاشير');
  const db = store.getDb();
  const s = S();
  const B = store.getBooks();
  const products = db.products.filter((p) => p.active !== false);
  const cats = [...new Set(products.map((p) => p.category).filter(Boolean))];
  let cat = '';
  const accs = posAccounts();

  root.innerHTML = String(html`<div class="pos-screen">
    <section class="pos-products">
      <div class="pos-search"><input class="inp" data-scan placeholder="🔍 ابحث بالاسم أو امسح الباركود (مثال للكمية: 3*الباركود)" autocomplete="off" enterkeyhint="done">
        <button class="btn btn-ghost" data-cam title="مسح بالكاميرا">📷</button><button class="btn btn-ghost" data-settings title="إعدادات الكاشير">⚙️</button></div>
      ${cats.length ? html`<div class="pos-cats"><button class="chip on" data-cat="">الكل</button>${cats.map((c) => html`<button class="chip" data-cat="${c}">${c}</button>`)}</div>` : ''}
      <div class="pos-grid" data-grid></div>
    </section>
    <aside class="pos-cart" data-cart-panel>
      <div class="pos-cust"><input class="inp" data-party placeholder="👤 عميل نقدي — اختر عميلاً للبيع الآجل" value="${partyName(cart.party)}"></div>
      <div class="pos-lines" data-lines></div>
      <div class="pos-totals" data-totals></div>
      <div class="pos-actions">
        <button class="pos-pay pos-cash" data-pay="cash">💵 نقداً <small>F2</small></button>
        <button class="pos-pay pos-card" data-pay="card">💳 ${accs.card ? accs.card.name : 'بطاقة'} <small>F3</small></button>
        <button class="btn btn-ghost" data-pay="split">🔀 دفع مقسّم أو آجل <small class="muted">F4</small></button>
        <div class="pos-row"><button class="btn btn-ghost btn-sm" data-hold>⏸ تعليق</button><button class="btn btn-ghost btn-sm" data-held></button><button class="btn btn-text-danger btn-sm" data-clear>🗑 إلغاء</button></div>
        <div class="pos-row"><a class="btn btn-ghost btn-sm" href="#/pos/closing">🧾 تقفيل الصندوق</a><a class="btn btn-ghost btn-sm" href="#/sales-returns/new">↩️ مرتجع</a></div>
      </div>
    </aside>
    <div class="pos-bar" data-bar><span data-bar-t></span><button class="btn btn-primary btn-sm" data-go-cart>السلة والدفع ↓</button></div>
  </div>`);

  const scan = $('[data-scan]', root);
  const grid = $('[data-grid]', root);
  // البحث بالباركود أو الرمز، بما فيها باركود الوحدات (الكرتون مثلاً)
  const byCode = (code) => {
    const lc = code.toLowerCase();
    for (const x of products) {
      if ((x.barcode && x.barcode === code) || (x.sku && x.sku.toLowerCase() === lc)) return { p: x, unit: null };
      const u = (x.units || []).find((y) => y.barcode && y.barcode === code);
      if (u) return { p: x, unit: u };
    }
    return null;
  };
  const stockLeft = (p) => {
    if (p.type !== 'stock') return null;
    const inCart = cart.lines.filter((l) => l.product === p.id).reduce((t, l) => t + num(l.qty) * lineFactor(l), 0);
    return round((B.stock.get(p.id)?.qty || 0) - inCart, 3);
  };

  function drawGrid() {
    const q = norm(scan.value.replace(/^\d+(\.\d+)?\*/, '').trim());
    const list = products.filter((p) => (!cat || p.category === cat) && (!q || norm(`${p.name} ${p.nameEn || ''} ${p.barcode || ''} ${p.sku || ''}`).includes(q))).slice(0, 150);
    grid.innerHTML = list.length ? String(html`${list.map((p) => {
      const left = stockLeft(p);
      return html`<button class="pos-tile ${left != null && left <= 0 ? 'out' : ''}" data-p="${p.id}"><span class="t-n">${p.name}</span><span class="t-p">${money(p.price)}</span>${left != null ? html`<span class="t-s">${left <= 0 ? 'نفد' : 'متوفر ' + left}</span>` : ''}</button>`;
    })}`) : String(html`<div class="empty" style="grid-column:1/-1"><p>لا توجد منتجات مطابقة. ${products.length ? '' : html`<a href="#/products/new">أضف منتجاتك</a> أو <a href="#/import?type=products">استوردها من Excel</a>.`}</p></div>`);
  }

  const calc = () => calcDoc({ vatRate: s.vat ? num(s.vatRate) : 0, inclusive: !!s.inclusive, lines: cart.lines }, dec());

  function drawCart() {
    const T = calc();
    const box = $('[data-lines]', root);
    box.innerHTML = cart.lines.length ? String(html`${cart.lines.map((l, i) => html`<div class="pos-line" data-i="${i}">
        <button class="pl-name" data-edit="${i}">${l.desc}${l.unit ? html` <small class="badge badge-muted">${l.unit}</small>` : ''}${num(l.disc) ? html` <small class="badge badge-info">خصم ${num(l.disc)}%</small>` : ''}<small class="muted">${money(l.price)} × ${num(l.qty)}</small></button>
        <div class="pl-qty"><button data-dec="${i}" aria-label="إنقاص">−</button><span>${num(l.qty)}</span><button data-inc="${i}" aria-label="زيادة">+</button></div>
        <b class="pl-tot">${money(T.lines[i].total)}</b>
        <button class="icon-btn" data-del="${i}" aria-label="حذف">✕</button></div>`)}`)
      : String(html`<div class="pos-empty">🛒<br>اضغط على منتج أو امسح الباركود</div>`);
    const count = cart.lines.reduce((t, l) => t + num(l.qty), 0);
    $('[data-totals]', root).innerHTML = String(html`
      ${T.discount ? html`<div class="row"><span>الخصم</span>${money(-T.discount)}</div>` : ''}
      ${s.vat ? html`<div class="row"><span>قبل الضريبة</span>${money(T.net)}</div><div class="row"><span>الضريبة ${num(s.vatRate)}%</span>${money(T.vat)}</div>` : ''}
      <div class="row grand"><span>الإجمالي <small class="muted">(${count} قطعة)</small></span><span>${money(T.total, { sym: true })}</span></div>`);
    $('[data-bar-t]', root).innerHTML = String(html`🛒 ${count} · <b>${money(T.total, { sym: true })}</b>`);
    $('[data-bar]', root).hidden = !cart.lines.length;
    $$('[data-pay]', root).forEach((b) => { b.disabled = !cart.lines.length; });
    const held = readHeld();
    $('[data-held]', root).textContent = `📋 المعلّقة (${held.length})`;
    $('[data-held]', root).disabled = !held.length;
  }

  function add(p, qty = 1, unit = null) {
    const f = unit ? num(unit.factor) : 1;
    const price = unit ? (unit.price !== '' && unit.price != null ? num(unit.price) : round(num(p.price) * f, dec())) : num(p.price);
    const uname = unit ? unit.name : '';
    const i = cart.lines.findIndex((l) => l.product === p.id && (l.unit || '') === uname && num(l.price) === price && !num(l.disc));
    if (i >= 0) cart.lines[i].qty = round(num(cart.lines[i].qty) + qty, 3);
    else cart.lines.push({ product: p.id, desc: p.name, qty, price, disc: 0, tax: p.tax || 'S', ...(unit ? { unit: uname, factor: f } : {}) });
    const left = stockLeft(p);
    if (left != null && left < 0) toast(`تنبيه: الكمية المتوفرة من «${p.name}» لا تكفي`, 'warn');
    drawCart(); drawGrid();
    const tile = grid.querySelector(`[data-p="${CSS.escape(p.id)}"]`);
    if (tile) { tile.classList.remove('hit'); void tile.offsetWidth; tile.classList.add('hit'); }
  }

  // Enter في البحث: باركود أو رمز مطابق، أو نتيجة وحيدة
  function onEnter() {
    const raw0 = scan.value.trim();
    if (!raw0) return;
    const m = raw0.match(/^(\d+(?:\.\d+)?)\*(.+)$/);
    const qty = m ? num(m[1]) : 1;
    const code = (m ? m[2] : raw0).trim();
    const hit = byCode(code);
    let p = hit ? hit.p : null;
    if (!p) {
      const q = norm(code);
      const hits = products.filter((x) => norm(`${x.name} ${x.nameEn || ''}`).includes(q));
      if (hits.length === 1) p = hits[0];
    }
    if (p) { add(p, qty > 0 ? qty : 1, hit ? hit.unit : null); scan.value = ''; drawGrid(); }
    else notFound(code);
  }
  function notFound(code) {
    toast(`لا يوجد منتج بالرمز ${code}`, 'err');
    if (can('products') && /^[\x20-\x7E]{4,}$/.test(code)) {
      confirmBox(`لا يوجد منتج بالباركود ${code}. تريد إضافته كمنتج جديد؟`, { ok: 'إضافة منتج', title: 'باركود غير معروف' }).then((ok) => { if (ok) go(withQuery('products/new', { barcode: code, back: 'pos' })); });
    }
  }

  function editLine(i) {
    const l = cart.lines[i];
    modal({
      title: l.desc,
      body: html`<form class="form-grid" novalidate>
        ${field('الكمية', html`<input class="inp" name="qty" type="text" inputmode="decimal" data-num value="${l.qty}" autofocus>`)}
        ${field('السعر', html`<input class="inp" name="price" type="text" inputmode="decimal" data-num value="${l.price}">`)}
        ${field('خصم %', html`<input class="inp" name="disc" type="text" inputmode="decimal" data-num value="${l.disc || ''}" placeholder="0">`)}
        <div class="dlg-actions span-all"><button class="btn btn-primary">تم</button><button type="button" class="btn btn-text-danger" data-remove>حذف الصنف</button></div></form>`,
      onMount: (dlg, done) => {
        const f = $('form', dlg);
        f.qty.select();
        $('[data-remove]', dlg).onclick = () => { cart.lines.splice(i, 1); done(true); };
        f.onsubmit = (e) => {
          e.preventDefault();
          const q = num(f.qty.value);
          if (q > 0) l.qty = q; else cart.lines.splice(i, 1);
          l.price = Math.max(0, num(f.price.value));
          l.disc = Math.min(100, Math.max(0, num(f.disc.value)));
          done(true);
        };
      },
    }).then(() => { drawCart(); drawGrid(); scan.focus(); });
  }

  // ── الدفع ──
  async function checkout(mode) {
    if (!cart.lines.length) return;
    const T = calc();
    const total = T.total;
    let result = null;
    if (mode === 'card') {
      result = (await confirmBox(`تأكيد الدفع بـ ${accs.card.name}: ${moneyText(total)}`, { ok: '✓ تم الدفع', title: 'الدفع بالبطاقة' }))
        ? { payments: [{ acc: accs.card.id, amount: total }] } : null;
    } else if (mode === 'cash') result = await cashDialog(total);
    else result = await splitDialog(total);
    if (!result) { scan.focus(); return; }
    const doc = {
      type: 'sale', date: today(), party: cart.party || null, vatRate: s.vat ? num(s.vatRate) : 0, inclusive: !!s.inclusive,
      lines: cart.lines.map((l) => ({ product: l.product, desc: l.desc, qty: num(l.qty), price: num(l.price), disc: num(l.disc), tax: l.tax || 'S', ...(l.unit ? { unit: l.unit, factor: num(l.factor) } : {}) })),
      notes: '', payments: result.payments.filter((p) => p.amount > 0), pos: true,
    };
    const wh = store.getDb().warehouses.some((w) => w.id === s.posWh) ? s.posWh : defaultWh();
    if (wh) doc.wh = wh;
    if (s.posCc && store.getDb().centers.some((c) => c.id === s.posCc)) doc.cc = s.posCc;
    if (result.tendered) { doc.tendered = result.tendered; doc.change = round(result.tendered - (result.payments.find((p) => p.acc === accs.cash.id)?.amount || 0), dec()); }
    const errs = validateDoc(store.getDb(), doc);
    if (Object.keys(errs).length) { toast(Object.values(errs)[0], 'err'); return; }
    store.saveDoc(doc);
    toast(`تم البيع ✓ ${docNo(doc, s)}`);
    if (s.posAutoPrint !== false) printPaper(docPaper(doc, { size: s.posPrintSize || 'receipt' }), { size: s.posPrintSize || 'receipt', title: docNo(doc, s) });
    cart = newCart();
    $('[data-party]', root).value = '';
    drawCart(); drawGrid();
    scan.value = '';
    scan.focus();
  }

  function cashDialog(total) {
    const notes = [...new Set([total, Math.ceil(total / 5) * 5, Math.ceil(total / 10) * 10, Math.ceil(total / 50) * 50, Math.ceil(total / 100) * 100, Math.ceil(total / 500) * 500].map((x) => round(x, dec())))].slice(0, 5);
    return modal({
      title: 'الدفع نقداً',
      body: html`<form novalidate><div class="pos-due">المطلوب<b>${money(total, { sym: true })}</b></div>
        ${field('المبلغ المستلم', html`<input class="inp pos-big" name="got" type="text" inputmode="decimal" data-num value="${total}" autofocus>`)}
        <div class="pos-notes">${notes.map((n) => html`<button type="button" class="chip" data-n="${n}">${money(n)}</button>`)}</div>
        <div class="pos-change">الباقي للعميل<b data-change>0</b></div>
        <div class="dlg-actions"><button class="btn btn-primary">✓ إتمام البيع <small>Enter</small></button><button type="button" class="btn btn-ghost" data-no>رجوع</button></div></form>`,
      onMount: (dlg, done) => {
        const f = $('form', dlg);
        const upd = () => {
          const got = num(f.got.value);
          const ch = round(got - total, dec());
          $('[data-change]', dlg).innerHTML = String(money(Math.max(0, ch), { sym: true }));
          $('[data-change]', dlg).classList.toggle('neg', ch < 0);
        };
        f.got.select(); upd();
        f.got.oninput = upd;
        $('[data-no]', dlg).onclick = () => done(null);
        dlg.addEventListener('click', (e) => { const b = e.target.closest('[data-n]'); if (b) { f.got.value = b.dataset.n; upd(); f.got.focus(); } });
        f.onsubmit = (e) => {
          e.preventDefault();
          const got = num(f.got.value);
          if (round(got, dec()) < total) { toast('المبلغ المستلم أقل من المطلوب. استخدم الدفع المقسّم أو الآجل', 'err'); return; }
          done({ payments: [{ acc: accs.cash.id, amount: total }], tendered: round(got, dec()) });
        };
      },
    });
  }

  function splitDialog(total) {
    const rows = accs.money.map((a) => ({ acc: a.id, name: a.name, amount: '' }));
    return modal({
      title: 'دفع مقسّم أو آجل',
      body: html`<form novalidate><div class="pos-due">المطلوب<b>${money(total, { sym: true })}</b></div>
        <div class="form-grid">${rows.map((r) => field(r.name, html`<input class="inp" name="${r.acc}" type="text" inputmode="decimal" data-num placeholder="0">`))}</div>
        <div class="pos-change">المتبقي ${cart.party ? html`(آجل على ${partyName(cart.party)})` : ''}<b data-rest></b></div>
        ${cart.party ? '' : html`<p class="muted small">للبيع الآجل اختر العميل أولاً من أعلى السلة.</p>`}
        <div class="dlg-actions"><button class="btn btn-primary">✓ إتمام البيع</button><button type="button" class="btn btn-ghost" data-no>رجوع</button></div></form>`,
      onMount: (dlg, done) => {
        const f = $('form', dlg);
        const sum = () => round(rows.reduce((t, r) => t + num(f[r.acc].value), 0), dec());
        const upd = () => {
          const rest = round(total - sum(), dec());
          $('[data-rest]', dlg).innerHTML = String(money(rest, { sym: true }));
          $('[data-rest]', dlg).classList.toggle('neg', rest < 0);
        };
        f[rows[0].acc].focus();
        f.oninput = upd; upd();
        $('[data-no]', dlg).onclick = () => done(null);
        f.onsubmit = (e) => {
          e.preventDefault();
          const paid = sum();
          if (paid > total) { toast('المدفوع أكبر من المطلوب', 'err'); return; }
          if (paid < total && !cart.party) { toast('اختر العميل لتسجيل الباقي آجلاً عليه', 'err'); return; }
          done({ payments: rows.map((r) => ({ acc: r.acc, amount: round(num(f[r.acc].value), dec()) })).filter((p) => p.amount > 0) });
        };
      },
    });
  }

  // ── التعليق والاستئناف ──
  function hold() {
    if (!cart.lines.length) return;
    const held = readHeld();
    held.unshift({ id: Date.now().toString(36), at: new Date().toISOString(), cart });
    writeHeld(held);
    cart = newCart();
    $('[data-party]', root).value = '';
    toast('تم تعليق الفاتورة ⏸');
    drawCart(); drawGrid(); scan.focus();
  }
  function showHeld() {
    const held = readHeld();
    modal({
      title: 'الفواتير المعلّقة',
      body: html`<div class="list-mini">${held.map((h) => {
        const T = calcDoc({ vatRate: s.vat ? num(s.vatRate) : 0, inclusive: !!s.inclusive, lines: h.cart.lines }, dec());
        return html`<div class="it"><span>${new Date(h.at).toLocaleTimeString('ar-SA-u-nu-latn', { hour: '2-digit', minute: '2-digit' })} · ${h.cart.lines.length} صنف${h.cart.party ? ' · ' + partyName(h.cart.party) : ''}</span>
          <span class="inline"><b>${money(T.total)}</b><button class="btn btn-primary btn-sm" data-resume="${h.id}">استئناف</button><button class="icon-btn" data-drop="${h.id}" aria-label="حذف">✕</button></span></div>`;
      })}</div>`,
      onMount: (dlg, done) => {
        dlg.addEventListener('click', (e) => {
          const r = e.target.closest('[data-resume]');
          const d = e.target.closest('[data-drop]');
          if (r) {
            let xs = readHeld();
            const h = xs.find((x) => x.id === r.dataset.resume);
            xs = xs.filter((x) => x.id !== r.dataset.resume);
            if (cart.lines.length) xs.unshift({ id: Date.now().toString(36), at: new Date().toISOString(), cart });
            writeHeld(xs);
            cart = h.cart;
            done(true);
          } else if (d) {
            writeHeld(readHeld().filter((x) => x.id !== d.dataset.drop));
            d.closest('.it').remove();
            if (!readHeld().length) done(true);
          }
        });
      },
    }).then(() => { $('[data-party]', root).value = partyName(cart.party); drawCart(); drawGrid(); scan.focus(); });
  }

  function settingsDialog() {
    modal({
      title: 'إعدادات الكاشير',
      body: html`<form class="form-grid" novalidate>
        ${field('حساب النقد', html`<select class="inp" name="posCash">${accs.money.map((a) => html`<option value="${a.id}" ${a.id === accs.cash.id ? raw('selected') : ''}>${a.name}</option>`)}</select>`)}
        ${field('حساب البطاقة / مدى', html`<select class="inp" name="posCard">${accs.money.map((a) => html`<option value="${a.id}" ${a.id === accs.card.id ? raw('selected') : ''}>${a.name}</option>`)}</select>`)}
        ${store.getDb().warehouses.length ? field('المستودع', html`<select class="inp" name="posWh">${store.getDb().warehouses.map((w) => html`<option value="${w.id}" ${w.id === (s.posWh || defaultWh()) ? raw('selected') : ''}>${w.name}</option>`)}</select>`) : ''}
        ${store.getDb().centers.length ? field('الفرع', html`<select class="inp" name="posCc"><option value="">— بدون —</option>${store.getDb().centers.map((c) => html`<option value="${c.id}" ${c.id === s.posCc ? raw('selected') : ''}>${c.name}</option>`)}</select>`) : ''}
        ${field('حجم الإيصال', html`<select class="inp" name="posPrintSize"><option value="receipt" ${s.posPrintSize !== 'a4' ? raw('selected') : ''}>حراري 80 مم</option><option value="a4" ${s.posPrintSize === 'a4' ? raw('selected') : ''}>A4</option></select>`)}
        <label class="check span-all"><input type="checkbox" name="posAutoPrint" ${s.posAutoPrint !== false ? raw('checked') : ''}> طباعة الإيصال تلقائياً بعد كل بيع</label>
        <p class="muted small span-all">لإضافة حساب مدى أو محفظة: دليل الحسابات ← حساب جديد تحت «الأصول المتداولة» مع تفعيل «صندوق أو بنك».</p>
        <div class="dlg-actions span-all"><button class="btn btn-primary">حفظ</button></div></form>`,
      onMount: (dlg, done) => {
        const f = $('form', dlg);
        f.onsubmit = (e) => { e.preventDefault(); store.saveSettings({ posCash: f.posCash.value, posCard: f.posCard.value, posPrintSize: f.posPrintSize.value, posAutoPrint: f.posAutoPrint.checked, ...(f.posWh ? { posWh: f.posWh.value } : {}), ...(f.posCc ? { posCc: f.posCc.value } : {}) }); done(true); };
      },
    }).then((ok) => { if (ok) go('#/pos'); });
  }

  // ── الأحداث ──
  scan.addEventListener('input', drawGrid);
  scan.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(); } else if (e.key === 'Escape') { scan.value = ''; drawGrid(); } });
  root.addEventListener('click', (e) => {
    const t = e.target;
    const tile = t.closest('[data-p]');
    if (tile) { const p = store.findProduct(tile.dataset.p); if (p) add(p); scan.focus(); return; }
    const c = t.closest('[data-cat]');
    if (c) { cat = c.dataset.cat; $$('[data-cat]', root).forEach((b) => b.classList.toggle('on', b === c)); drawGrid(); return; }
    const inc = t.closest('[data-inc]'), dec_ = t.closest('[data-dec]'), del = t.closest('[data-del]'), ed = t.closest('[data-edit]');
    if (inc) { const l = cart.lines[inc.dataset.inc]; l.qty = round(num(l.qty) + 1, 3); drawCart(); drawGrid(); return; }
    if (dec_) { const i = Number(dec_.dataset.dec); const l = cart.lines[i]; l.qty = round(num(l.qty) - 1, 3); if (l.qty <= 0) cart.lines.splice(i, 1); drawCart(); drawGrid(); return; }
    if (del) { cart.lines.splice(Number(del.dataset.del), 1); drawCart(); drawGrid(); return; }
    if (ed) { editLine(Number(ed.dataset.edit)); return; }
    const pay = t.closest('[data-pay]');
    if (pay) { checkout(pay.dataset.pay); return; }
    if (t.closest('[data-hold]')) hold();
    else if (t.closest('[data-held]')) showHeld();
    else if (t.closest('[data-clear]')) { if (cart.lines.length) confirmBox('إلغاء الفاتورة الحالية؟', { ok: 'إلغاء الفاتورة', danger: true }).then((ok) => { if (ok) { cart = newCart(); $('[data-party]', root).value = ''; drawCart(); drawGrid(); } }); }
    else if (t.closest('[data-cam]')) cameraDialog((code) => { const h = byCode(code); if (h) add(h.p, 1, h.unit); else toast('باركود غير معروف: ' + code, 'err'); return false; }, { title: 'مسح المنتجات بالكاميرا' });
    else if (t.closest('[data-settings]')) settingsDialog();
    else if (t.closest('[data-go-cart]')) $('[data-cart-panel]', root).scrollIntoView({ behavior: 'smooth' });
  });
  combo($('[data-party]', root), {
    items: partyItems('customer'),
    onType: () => { cart.party = null; },
    onPick: (it) => { cart.party = it.value; $('[data-party]', root).value = it.label; scan.focus(); },
    onCreate: (text) => quickParty('customer', text),
    createLabel: 'عميل جديد',
  });
  const keys = (e) => {
    if (!root.isConnected) { document.removeEventListener('keydown', keys); return; }
    if (document.querySelector('dialog[open]')) return;
    const map = { F2: 'cash', F3: 'card', F4: 'split' };
    if (map[e.key]) { e.preventDefault(); checkout(map[e.key]); }
    else if (e.key === 'F9') { e.preventDefault(); hold(); }
  };
  document.addEventListener('keydown', keys);

  drawGrid();
  drawCart();
  if (matchMedia('(min-width: 761px)').matches) scan.focus();
}

// ═══ تقفيل الصندوق اليومي ═══
export function closing({ root, query, path }) {
  setTitle('تقفيل الصندوق');
  const db = store.getDb();
  const s = S();
  const B = store.getBooks();
  const day = query.date || today();
  const accs = posAccounts();
  const sales = db.docs.filter((d) => d.type === 'sale' && d.date === day);
  const returns = db.docs.filter((d) => d.type === 'sreturn' && d.date === day);
  const byAcc = new Map();
  let total = 0, credit = 0;
  for (const d of sales) {
    const t = B.totals.get(d.id).total;
    total += t;
    let paid = 0;
    for (const p of paymentList(d)) { const a = num(p.amount); if (a > 0) { byAcc.set(p.acc, (byAcc.get(p.acc) || 0) + a); paid += a; } }
    credit += Math.max(0, t - paid);
  }
  let refunds = 0;
  for (const d of returns) refunds += paymentList(d).reduce((t, p) => t + num(p.amount), 0);
  // مبيعات كل كاشير عند تفعيل المستخدمين
  const byUser = new Map();
  if (usersEnabled()) for (const d of sales) { const k = d.by || ''; const x = byUser.get(k) || { n: 0, total: 0 }; x.n++; x.total += B.totals.get(d.id).total; byUser.set(k, x); }
  const prev = balances(B, { to: new Date(new Date(day + 'T12:00:00').getTime() - 864e5).toISOString().slice(0, 10) });
  const cashId = accs.cash ? accs.cash.id : 'cash';
  const dayBal = balances(B, { from: day, to: day });
  const open = (prev.get(cashId) || { close: 0 }).close;
  const inn = (dayBal.get(cashId) || { dr: 0 }).dr;
  const out = (dayBal.get(cashId) || { cr: 0 }).cr;
  const expected = round(open + inn - out, dec());

  const table = html`<table class="tbl" data-table><tbody>
    <tr class="grp"><td colspan="2">المبيعات — ${fmtDate(day)}</td></tr>
    <tr><td>عدد الفواتير</td><td class="num">${sales.length}</td></tr>
    <tr><td>إجمالي المبيعات</td><td class="num">${money(total)}</td></tr>
    ${[...byAcc].map(([a, v]) => html`<tr><td class="ind-1">${accName(a)}</td><td class="num">${money(v)}</td></tr>`)}
    ${credit ? html`<tr><td class="ind-1">آجل على العملاء</td><td class="num">${money(credit)}</td></tr>` : ''}
    <tr><td>المرتجعات المردودة</td><td class="num">${money(refunds)}</td></tr>
    ${byUser.size ? html`<tr class="grp"><td colspan="2">حسب المستخدم</td></tr>${[...byUser].map(([u, x]) => html`<tr><td class="ind-1">${store.findUser(u)?.name || 'غير محدد'} <span class="muted small">(${x.n})</span></td><td class="num">${money(x.total)}</td></tr>`)}` : ''}
    <tr class="grp"><td colspan="2">${accs.cash ? accs.cash.name : 'الصندوق'}</td></tr>
    <tr><td>رصيد بداية اليوم</td><td class="num">${money(open)}</td></tr>
    <tr><td>الداخل اليوم</td><td class="num">${money(inn)}</td></tr>
    <tr><td>الخارج اليوم</td><td class="num">${money(out)}</td></tr>
    <tr class="strong"><td>المتوقع في الصندوق</td><td class="num">${money(expected)}</td></tr>
  </tbody></table>`;
  root.innerHTML = String(html`
    <div class="page-head"><div><h2>تقفيل الصندوق</h2><div class="sub">ملخص مبيعات اليوم ومطابقة النقد الفعلي</div></div>
      <div class="actions"><a class="btn btn-primary" href="#/pos">🖥️ الكاشير</a></div></div>
    <div class="toolbar"><label class="inline small"><span>اليوم</span><input class="inp" type="date" data-day value="${day}"></label><span class="grow"></span><button class="btn btn-ghost btn-sm" data-print>🖨️ طباعة</button></div>
    <div class="grid g4" style="margin-bottom:14px">
      <div class="kpi"><span class="kpi-l">المبيعات</span><span class="kpi-v">${money(total, { sym: true })}</span><span class="kpi-s">${sales.length} فاتورة</span></div>
      ${[...byAcc].slice(0, 2).map(([a, v]) => html`<div class="kpi"><span class="kpi-l">${accName(a)}</span><span class="kpi-v">${money(v, { sym: true })}</span></div>`)}
      <div class="kpi"><span class="kpi-l">المتوقع في الصندوق</span><span class="kpi-v">${money(expected, { sym: true })}</span></div>
    </div>
    <div class="grid g2">
      <div class="tbl-wrap">${table}</div>
      <div class="card"><div class="card-h"><h3>عدّ النقد الفعلي</h3></div>
        ${field('المبلغ الموجود فعلاً في الصندوق', html`<input class="inp pos-big" data-count type="text" inputmode="decimal" data-num placeholder="${expected}">`)}
        <div class="pos-change" style="margin-top:10px">الفرق<b data-diff>—</b></div>
        <button class="btn btn-ghost" data-book style="margin-top:12px" disabled>📒 تسجيل الفرق في الحسابات</button>
        <p class="muted small" style="margin-top:8px">العجز يُسجَّل مصروفاً والزيادة إيراداً، في حساب «عجز وزيادة الصندوق».</p></div>
    </div>`);
  $('[data-day]', root).onchange = (e) => go(withQuery(path, { date: e.target.value }));
  if (!can('buy')) { $('[data-book]', root).hidden = true; $('[data-book]', root).nextElementSibling.textContent = 'أبلغ المحاسب أو المالك بالفرق لتسجيله.'; }
  const cnt = $('[data-count]', root);
  const diffOf = () => (cnt.value.trim() === '' ? null : round(num(cnt.value) - expected, dec()));
  cnt.oninput = () => {
    const d = diffOf();
    const el = $('[data-diff]', root);
    el.innerHTML = d == null ? '—' : String(html`${money(d, { sym: true })} ${d < 0 ? '(عجز)' : d > 0 ? '(زيادة)' : '✓'}`);
    el.classList.toggle('neg', d != null && d < 0);
    $('[data-book]', root).disabled = !d;
  };
  $('[data-book]', root).onclick = async () => {
    const d = diffOf();
    if (!d) return;
    if (!(await confirmBox(`تسجيل ${d < 0 ? 'عجز' : 'زيادة'} ${moneyText(Math.abs(d))} في ${accName(cashId)} بتاريخ ${fmtDate(day)}؟`, { ok: 'تسجيل القيد' }))) return;
    let acc = store.getDb().accounts.find((a) => a.role === 'cashdiff');
    if (!acc) acc = store.saveAccount({ code: nextAccountCode(store.getDb(), 'g52'), name: 'عجز وزيادة الصندوق', type: 'expense', parent: 'g52', group: false, role: 'cashdiff' });
    const lines = d < 0 ? [{ account: acc.id, dr: -d, cr: 0, memo: 'عجز الصندوق' }, { account: cashId, dr: 0, cr: -d }] : [{ account: cashId, dr: d, cr: 0 }, { account: acc.id, dr: 0, cr: d, memo: 'زيادة الصندوق' }];
    const doc = store.saveDoc({ type: 'journal', date: day, notes: `تسوية عدّ الصندوق ${fmtDate(day)}`, lines });
    toast('تم تسجيل الفرق ✓');
    go(docHref(doc));
  };
  $('[data-print]', root).onclick = () => printPaper(html`<div class="paper receipt"><div class="pp-title" style="text-align:center"><h1>تقفيل الصندوق</h1><div>${s.name || ''}</div><div class="muted">${fmtDate(day)}</div></div>${table}<div class="pp-sign" style="grid-template-columns:1fr 1fr"><div>الكاشير</div><div>المدير</div></div></div>`, { size: 'receipt', title: 'تقفيل ' + day });
}
