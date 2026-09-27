// ═══ التقارير: القوائم المالية، الضريبة، المبيعات، الديون، النقدية، المخزون ═══
import * as store from '../store.js';
import {
  trialBalance, incomeStatement, balanceSheet, vatReport, aging, AGING_BUCKETS, salesAnalysis, cashReport, stockReport,
  docNo, DOC_TYPES, num, round,
} from '../core.js';
import { html, raw, money, qty, fmtDate, toast, confirmBox, empty, $, exportTable, attr } from '../ui.js';
import { go, setTitle, docHref, withQuery } from '../nav.js';
import { head, bindRows, today, S, dec, taxLabel, partyName, periodOf, periodBar, bindPeriod, periodLabel, printReport, csvName } from './common.js';

const REPORTS = [
  { sec: 'القوائم المالية' },
  { id: 'income', icon: '📈', t: 'قائمة الدخل', d: 'الإيرادات والتكاليف والمصروفات وصافي الربح' },
  { id: 'balance', icon: '⚖️', t: 'الميزانية العمومية', d: 'الأصول والخصوم وحقوق الملكية في تاريخ معين' },
  { id: 'trial', icon: '🧮', t: 'ميزان المراجعة', d: 'أرصدة وحركات كل الحسابات والتحقق من التوازن' },
  { sec: 'الضريبة' },
  { id: 'vat', icon: '🧾', t: 'إقرار الضريبة', d: 'ضريبة المبيعات والمشتريات وصافي المستحق للفترة' },
  { sec: 'المبيعات والذمم' },
  { id: 'sales', icon: '🏆', t: 'تحليل المبيعات والأرباح', d: 'الأكثر مبيعاً وربحاً حسب المنتج والعميل' },
  { id: 'aging-ar', icon: '⏳', t: 'أعمار ديون العملاء', d: 'المستحقات حسب مدة التأخير' },
  { id: 'aging-ap', icon: '📅', t: 'أعمار ديون الموردين', d: 'ما عليك للموردين حسب الاستحقاق' },
  { sec: 'النقدية والمخزون والمصروفات' },
  { id: 'cash', icon: '💰', t: 'حركة الصندوق والبنوك', d: 'الداخل والخارج ورصيد كل حساب' },
  { id: 'stock', icon: '📦', t: 'تقييم المخزون', d: 'الكميات والتكلفة المتوسطة وقيمة المخزون' },
  { id: 'expenses', icon: '💸', t: 'المصروفات حسب البند', d: 'أين تذهب مصاريفك ونسبة كل بند' },
  { sec: 'الدفاتر' },
  { href: '#/daybook', icon: '📖', t: 'دفتر اليومية', d: 'كل القيود بالتسلسل' },
  { href: '#/accounts', icon: '🗂️', t: 'دفتر الأستاذ', d: 'اختر حساباً من الدليل لعرض حركته' },
  { href: '#/customers', icon: '📄', t: 'كشوف حساب العملاء', d: 'من بطاقة كل عميل' },
];

export function index({ root }) {
  setTitle('التقارير');
  const sections = [];
  for (const r of REPORTS) { if (r.sec) sections.push({ sec: r.sec, items: [] }); else sections[sections.length - 1].items.push(r); }
  root.innerHTML = String(html`${head('التقارير', { sub: 'كل التقارير محسوبة من قيودك لحظياً، ويمكن طباعتها أو تصديرها لـ Excel' })}
    ${sections.map((x) => html`<h3 class="nav-sec" style="margin:18px 0 8px;font-size:.85rem">${x.sec}</h3><div class="tiles">
      ${x.items.map((r) => html`<a class="tile" href="${r.href || '#/reports/' + r.id}"><span class="ic">${r.icon}</span><span><b>${r.t}</b><br><small class="muted">${r.d}</small></span></a>`)}</div>`)}`);
}

export function report(ctx) {
  const r = REPORTS.find((x) => x.id === ctx.params.name);
  if (!r) { setTitle('التقارير'); ctx.root.innerHTML = String(empty('🔎', 'التقرير غير موجود', '', html`<a class="btn btn-ghost" href="#/reports">كل التقارير</a>`)); return; }
  setTitle(r.t);
  const fn = { income, balance, trial, vat, sales, 'aging-ar': (c) => agingView(c, 'customer'), 'aging-ap': (c) => agingView(c, 'supplier'), cash, stock, expenses }[r.id];
  fn(ctx, r);
}

// إطار موحد: عنوان، فترة، طباعة، Excel
function frame({ root, path, query }, r, { per, asOf, fixed, body, note }) {
  const sub = asOf != null ? `حتى تاريخ ${fmtDate(asOf)}` : periodLabel(per);
  root.innerHTML = String(html`${head(r.t, { sub, actions: html`<a class="btn btn-ghost" href="#/reports">📊 كل التقارير</a>` })}
    <div class="toolbar">${fixed ? '' : asOf != null ? html`<label class="inline small"><span>حتى تاريخ</span><input class="inp" type="date" data-asof value="${asOf}"></label>` : periodBar(per)}
      <span class="grow"></span><button class="btn btn-ghost btn-sm" data-print>🖨️ طباعة / PDF</button><button class="btn btn-ghost btn-sm" data-csv>⬇️ Excel</button></div>
    ${body}${note ? html`<p class="tbl-note">${note}</p>` : ''}`);
  if (asOf != null) { const a = $('[data-asof]', root); if (a) a.onchange = (e) => go(withQuery(path, { ...query, to: e.target.value })); }
  else bindPeriod(root, path, query);
  bindRows(root);
  $('[data-print]', root).onclick = () => { const t = $('[data-table]', root); if (t) printReport(r.t, sub, t); };
  $('[data-csv]', root).onclick = () => { const t = $('[data-table]', root); if (t) exportTable(t, csvName(r.t)); };
}

const pct = (v, base) => (base ? html`<span class="muted small" dir="ltr">${(Math.round((v / base) * 1000) / 10).toLocaleString('en-US')}%</span>` : '');

// ── قائمة الدخل ──
function income(ctx, r) {
  const db = store.getDb();
  const per = periodOf(ctx.query, 'year');
  const I = incomeStatement(db, store.getBooks(), per);
  const rev = I.totalRevenue;
  const row = (x, cls = '') => html`<tr class="${cls}" data-href="${withQuery('accounts/' + x.account.id, { from: per.from, to: per.to })}"><td class="ind-1">${x.account.name}</td><td class="num">${money(x.amount, { paren: true })}</td><td class="num hide-sm">${pct(x.amount, rev)}</td></tr>`;
  const groups = [...new Set(I.expenses.map((x) => x.group))];
  const body = html`<div class="tbl-wrap"><table class="tbl" data-table><thead><tr><th>البند</th><th class="num">المبلغ</th><th class="num hide-sm">% من الإيرادات</th></tr></thead><tbody>
    <tr class="grp"><td colspan="3">الإيرادات</td></tr>${I.revenue.map((x) => row(x))}
    <tr class="strong"><td>صافي الإيرادات</td><td class="num">${money(rev, { paren: true })}</td><td class="hide-sm"></td></tr>
    <tr class="grp"><td colspan="3">تكلفة المبيعات</td></tr>${I.cogs.map((x) => row(x))}
    <tr class="strong"><td>إجمالي تكلفة المبيعات</td><td class="num">${money(I.totalCogs, { paren: true })}</td><td class="num hide-sm">${pct(I.totalCogs, rev)}</td></tr>
    <tr class="strong"><td>مجمل الربح</td><td class="num">${money(I.gross, { paren: true })}</td><td class="num hide-sm">${pct(I.gross, rev)}</td></tr>
    ${groups.map((g) => html`<tr class="grp"><td colspan="3">${g || 'المصروفات'}</td></tr>${I.expenses.filter((x) => x.group === g).map((x) => row(x))}`)}
    <tr class="strong"><td>إجمالي المصروفات</td><td class="num">${money(I.totalExpenses, { paren: true })}</td><td class="num hide-sm">${pct(I.totalExpenses, rev)}</td></tr>
  </tbody><tfoot><tr><td>${I.net >= 0 ? 'صافي الربح' : 'صافي الخسارة'}</td><td class="num"><span class="${I.net < 0 ? 'neg' : 'pos'}">${money(I.net, { paren: true })}</span></td><td class="num hide-sm">${pct(I.net, rev)}</td></tr></tfoot></table></div>`;
  frame(ctx, r, { per, body, note: 'الأرقام بين قوسين سالبة. اضغط على أي بند لعرض تفاصيله في دفتر الأستاذ.' });
}

// ── الميزانية العمومية ──
function balance(ctx, r) {
  const db = store.getDb();
  const asOf = ctx.query.to || today();
  const Bs = balanceSheet(db, store.getBooks(), { to: asOf });
  const section = (title, rows, total, totalLabel) => {
    const groups = [...new Set(rows.map((x) => x.group))];
    return html`<tr class="grp"><td colspan="2">${title}</td></tr>
      ${groups.map((g) => html`${g && g !== title && groups.length > 1 ? html`<tr class="sub-row"><td class="ind-1"><b>${g}</b></td><td></td></tr>` : ''}
        ${rows.filter((x) => x.group === g).map((x) => html`<tr ${x.computed ? '' : attr('data-href', `#/accounts/${x.account.id}?to=${asOf}`)}><td class="ind-2">${x.account.name}</td><td class="num">${money(x.amount, { paren: true })}</td></tr>`)}`)}
      <tr class="strong"><td>${totalLabel}</td><td class="num">${money(total, { paren: true })}</td></tr>`;
  };
  const body = html`${Bs.balanced ? '' : html`<p class="note note-bad" style="margin-bottom:12px">الميزانية غير متوازنة. راجع الأرصدة الافتتاحية والقيود اليدوية.</p>`}
    <div class="tbl-wrap"><table class="tbl" data-table><thead><tr><th>البند</th><th class="num">المبلغ</th></tr></thead><tbody>
    ${section('الأصول', Bs.sections.asset, Bs.totals.asset, 'إجمالي الأصول')}
    ${section('الخصوم (الالتزامات)', Bs.sections.liability, Bs.totals.liability, 'إجمالي الخصوم')}
    ${section('حقوق الملكية', Bs.sections.equity, Bs.totals.equity, 'إجمالي حقوق الملكية')}
    </tbody><tfoot><tr><td>إجمالي الخصوم وحقوق الملكية</td><td class="num">${money(round(Bs.totals.liability + Bs.totals.equity, dec()), { paren: true })}</td></tr></tfoot></table></div>`;
  frame(ctx, r, { asOf, body, note: `السنة المالية الحالية تبدأ في ${fmtDate(Bs.fyStart)}. أرباح السنة تظهر ضمن حقوق الملكية إلى حين ترحيلها.` });
}

// ── ميزان المراجعة ──
function trial(ctx, r) {
  const db = store.getDb();
  const per = periodOf(ctx.query, 'year');
  const T = trialBalance(db, store.getBooks(), per);
  const cell = (v) => html`<td class="num">${v ? money(v) : ''}</td>`;
  const body = html`${T.rows.length ? html`<p class="note ${T.balanced ? 'note-ok' : 'note-bad'}" style="margin-bottom:12px">${T.balanced ? 'الميزان متوازن ✓ مجموع المدين يساوي مجموع الدائن.' : 'الميزان غير متوازن! راجع القيود.'}</p>` : ''}
    <div class="tbl-wrap"><table class="tbl" data-table><thead>
      <tr><th rowspan="2">الرمز</th><th rowspan="2">الحساب</th><th class="num" colspan="2" style="text-align:center">رصيد أول الفترة</th><th class="num" colspan="2" style="text-align:center">حركة الفترة</th><th class="num" colspan="2" style="text-align:center">الرصيد الختامي</th></tr>
      <tr><th class="num">مدين</th><th class="num">دائن</th><th class="num">مدين</th><th class="num">دائن</th><th class="num">مدين</th><th class="num">دائن</th></tr></thead><tbody>
      ${T.rows.map((x) => html`<tr class="${x.group ? 'grp' : ''}" data-href="${withQuery('accounts/' + x.account.id, { from: per.from, to: per.to })}"><td class="code">${x.account.code}</td><td class="ind-${Math.min(x.depth, 3)}">${x.account.name}</td>
        ${cell(x.openDr)}${cell(x.openCr)}${cell(x.dr)}${cell(x.cr)}${cell(x.closeDr)}${cell(x.closeCr)}</tr>`)}
    </tbody><tfoot><tr><td colspan="2">المجموع</td>${cell(T.totals.openDr)}${cell(T.totals.openCr)}${cell(T.totals.dr)}${cell(T.totals.cr)}${cell(T.totals.closeDr)}${cell(T.totals.closeCr)}</tr></tfoot></table></div>`;
  frame(ctx, r, { per, body, note: 'المجاميع تشمل الحسابات الفرعية فقط (بدون المجموعات) حتى لا تتكرر.' });
}

// ── إقرار الضريبة ──
function vat(ctx, r) {
  const db = store.getDb();
  const s = S();
  const per = periodOf(ctx.query, 'quarter');
  const V = vatReport(db, store.getBooks(), per);
  const rate = num(s.vatRate);
  const line = (n, label, base, adj, tax) => html`<tr><td class="code">${n}</td><td>${label}</td><td class="num">${money(base)}</td><td class="num">${adj ? money(-adj) : '—'}</td><td class="num">${tax == null ? '—' : money(tax)}</td></tr>`;
  const sumNet = (a) => round(a.S.net + a.Z.net + a.E.net, dec());
  const settled = db.docs.find((d) => d.type === 'journal' && d.vatPeriod && d.vatPeriod.from === per.from && d.vatPeriod.to === per.to);
  const body = html`${s.vat ? '' : html`<p class="note note-warn" style="margin-bottom:12px">منشأتك غير مسجلة في الضريبة حسب الإعدادات. <a href="#/settings">غيّر الإعدادات</a> إن كنت مسجلاً.</p>`}
    <div class="grid g3" style="margin-bottom:14px">
      <div class="kpi"><span class="kpi-l">ضريبة المبيعات (المخرجات)</span><span class="kpi-v">${money(V.output, { sym: true })}</span></div>
      <div class="kpi"><span class="kpi-l">ضريبة المشتريات (المدخلات)</span><span class="kpi-v">${money(V.input, { sym: true })}</span></div>
      <div class="kpi"><span class="kpi-l">${V.net >= 0 ? 'صافي الضريبة المستحقة' : 'صافي الضريبة القابلة للاسترداد'}</span><span class="kpi-v ${V.net > 0 ? 'neg' : 'pos'}">${money(Math.abs(V.net), { sym: true })}</span></div>
    </div>
    <div class="tbl-wrap"><table class="tbl" data-table><thead><tr><th>#</th><th>البند</th><th class="num">المبلغ (قبل الضريبة)</th><th class="num">التعديلات (المرتجعات)</th><th class="num">${taxLabel()}</th></tr></thead><tbody>
      <tr class="grp"><td colspan="5">المبيعات</td></tr>
      ${line(1, `المبيعات الخاضعة للنسبة الأساسية (${rate}%)`, V.sale.S.net, V.sreturn.S.net, V.sales.S.vat)}
      ${line(2, 'المبيعات الخاضعة للنسبة الصفرية', V.sale.Z.net, V.sreturn.Z.net, null)}
      ${line(3, 'المبيعات المعفاة', V.sale.E.net, V.sreturn.E.net, null)}
      <tr class="strong"><td></td><td>إجمالي المبيعات</td><td class="num">${money(sumNet(V.sale))}</td><td class="num">${money(-sumNet(V.sreturn))}</td><td class="num">${money(V.output)}</td></tr>
      <tr class="grp"><td colspan="5">المشتريات والمصروفات</td></tr>
      ${line(4, `المشتريات الخاضعة للنسبة الأساسية (${rate}%)`, round(V.purchase.S.net + V.expense.S.net, dec()), V.preturn.S.net, V.purchases.S.vat)}
      ${line(5, 'المشتريات الخاضعة للنسبة الصفرية', round(V.purchase.Z.net + V.expense.Z.net, dec()), V.preturn.Z.net, null)}
      ${line(6, 'المشتريات المعفاة', round(V.purchase.E.net + V.expense.E.net, dec()), V.preturn.E.net, null)}
      <tr class="strong"><td></td><td>إجمالي المشتريات</td><td class="num">${money(round(sumNet(V.purchase) + sumNet(V.expense), dec()))}</td><td class="num">${money(-sumNet(V.preturn))}</td><td class="num">${money(V.input)}</td></tr>
    </tbody><tfoot><tr><td></td><td>${V.net >= 0 ? 'صافي الضريبة المستحقة للسداد' : 'صافي الضريبة القابلة للاسترداد أو الترحيل'}</td><td></td><td></td><td class="num">${money(V.net)}</td></tr></tfoot></table></div>
    <div class="card" style="margin-top:14px"><div class="card-h"><h3>تسوية الضريبة وسدادها</h3></div>
      ${settled ? html`<p>تم تسجيل قيد التسوية لهذه الفترة: <a href="${docHref(settled)}">${docNo(settled, s)}</a>. لسداد المبلغ للهيئة سجّل <a href="#/payments/new?account=vdue&amount=${Math.max(0, V.net)}">سند صرف</a> على حساب «ضريبة مستحقة للهيئة».</p>`
        : html`<p class="muted small" style="margin-bottom:10px">بعد تقديم الإقرار، سجّل قيد التسوية: يُقفل حسابي ضريبة المبيعات والمشتريات للفترة ويُرحّل الصافي إلى «ضريبة مستحقة للهيئة»، ثم سجّل سند صرف عند السداد.</p>
          <button class="btn btn-primary btn-sm" data-settle ${per.from && per.to && (V.output || V.input) ? '' : raw('disabled')}>📒 إنشاء قيد تسوية الضريبة للفترة</button>`}</div>
    <details class="card" style="margin-top:14px"><summary style="cursor:pointer;font-weight:800">🗂️ المستندات المشمولة (${V.docs.length})</summary>
      <div class="tbl-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>المستند</th><th>التاريخ</th><th>الطرف</th><th class="num">الصافي</th><th class="num">${taxLabel()}</th></tr></thead><tbody>
        ${V.docs.map((x) => { const sg = x.doc.type === 'sreturn' || x.doc.type === 'preturn' ? -1 : 1; return html`<tr data-href="${docHref(x.doc)}"><td>${DOC_TYPES[x.doc.type].name} <span dir="ltr" class="muted">${docNo(x.doc, s)}</span></td><td>${fmtDate(x.doc.date)}</td><td>${partyName(x.doc.party, x.doc.payee || '')}</td><td class="num">${money(sg * x.net)}</td><td class="num">${money(sg * x.vat)}</td></tr>`; })}
      </tbody></table></div></details>`;
  frame(ctx, r, { per, body, note: 'التقرير مساعد لتعبئة الإقرار في بوابة الهيئة، ويعتمد على الفواتير والمصروفات المسجلة. راجع الأرقام قبل التقديم.' });
  const btn = $('[data-settle]', ctx.root);
  if (btn) btn.onclick = async () => {
    if (!(await confirmBox(`سيُنشأ قيد بتاريخ ${fmtDate(per.to)} يُقفل ضريبة المخرجات (${money(V.output)}) والمدخلات (${money(V.input)}) ويرحّل الصافي إلى «ضريبة مستحقة للهيئة».`, { ok: 'إنشاء القيد' }))) return;
    const lines = [];
    if (V.output) lines.push({ account: 'vout', dr: V.output, cr: 0, memo: 'إقفال ضريبة المخرجات' });
    if (V.input) lines.push({ account: 'vin', dr: 0, cr: V.input, memo: 'إقفال ضريبة المدخلات' });
    if (V.net > 0) lines.push({ account: 'vdue', dr: 0, cr: V.net, memo: 'صافي مستحق للهيئة' });
    if (V.net < 0) lines.push({ account: 'vdue', dr: -V.net, cr: 0, memo: 'صافي قابل للاسترداد' });
    const doc = store.saveDoc({ type: 'journal', date: per.to, notes: `تسوية ${taxLabel()} للفترة ${fmtDate(per.from)} - ${fmtDate(per.to)}`, lines, vatPeriod: { from: per.from, to: per.to } });
    toast('تم إنشاء قيد التسوية ✓');
    go(docHref(doc));
  };
}

// ── تحليل المبيعات ──
function sales(ctx, r) {
  const db = store.getDb();
  const per = periodOf(ctx.query, 'month');
  const A = salesAnalysis(db, store.getBooks(), per);
  const margin = A.net ? Math.round((A.profit / A.net) * 1000) / 10 : 0;
  const body = html`<div class="grid g4" style="margin-bottom:14px">
      <div class="kpi"><span class="kpi-l">صافي المبيعات</span><span class="kpi-v">${money(A.net, { sym: true })}</span><span class="kpi-s">${A.count} فاتورة · متوسط ${money(A.count ? A.net / A.count : 0)}</span></div>
      <div class="kpi"><span class="kpi-l">تكلفة المبيعات</span><span class="kpi-v">${money(A.cost, { sym: true })}</span></div>
      <div class="kpi"><span class="kpi-l">مجمل الربح</span><span class="kpi-v ${A.profit < 0 ? 'neg' : 'pos'}">${money(A.profit, { sym: true })}</span></div>
      <div class="kpi"><span class="kpi-l">هامش الربح</span><span class="kpi-v">${margin}%</span></div></div>
    <div class="card"><div class="card-h"><h3>حسب المنتج</h3></div>
    ${A.products.length ? html`<div class="tbl-wrap"><table class="tbl" data-table><thead><tr><th>المنتج / البند</th><th class="num">الكمية</th><th class="num">صافي المبيعات</th><th class="num hide-sm">التكلفة</th><th class="num">الربح</th><th class="num">الهامش</th></tr></thead><tbody>
      ${A.products.map((x) => html`<tr ${x.product ? attr('data-href', `#/products/${x.product.id}`) : ''}><td>${x.name}</td><td class="num">${qty(x.qty)}</td><td class="num">${money(x.net)}</td><td class="num hide-sm">${money(x.cost)}</td><td class="num"><span class="${x.profit < 0 ? 'neg' : ''}">${money(x.profit)}</span></td><td class="num">${Math.round(x.margin)}%</td></tr>`)}
    </tbody><tfoot><tr><td>الإجمالي</td><td></td><td class="num">${money(A.net)}</td><td class="num hide-sm">${money(A.cost)}</td><td class="num">${money(A.profit)}</td><td class="num">${margin}%</td></tr></tfoot></table></div>` : html`<p class="muted">لا توجد مبيعات في هذه الفترة.</p>`}</div>
    <div class="card"><div class="card-h"><h3>حسب العميل</h3></div>
    ${A.customers.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>العميل</th><th class="num">الفواتير</th><th class="num">الصافي</th><th class="num hide-sm">${taxLabel()}</th><th class="num">الإجمالي</th></tr></thead><tbody>
      ${A.customers.map((x) => html`<tr ${x.key !== '_cash' ? attr('data-href', `#/customers/${x.key}`) : ''}><td>${x.name}</td><td class="num">${x.count}</td><td class="num">${money(x.net)}</td><td class="num hide-sm">${money(x.vat)}</td><td class="num">${money(x.total)}</td></tr>`)}
    </tbody></table></div>` : html`<p class="muted">لا توجد مبيعات في هذه الفترة.</p>`}</div>`;
  frame(ctx, r, { per, body, note: 'الربح هنا = صافي المبيعات − تكلفة البضاعة المباعة بالتكلفة المتوسطة (قبل المصروفات).' });
}

// ── أعمار الديون ──
function agingView(ctx, kind) {
  const r = REPORTS.find((x) => x.id === (kind === 'customer' ? 'aging-ar' : 'aging-ap'));
  const asOf = today();
  const A = aging(store.getDb(), store.getBooks(), kind, asOf);
  const seg = kind === 'customer' ? 'customers' : 'suppliers';
  const body = A.rows.length ? html`<div class="tbl-wrap"><table class="tbl" data-table><thead><tr><th>${kind === 'customer' ? 'العميل' : 'المورد'}</th>${AGING_BUCKETS.map((b) => html`<th class="num">${b.name}</th>`)}<th class="num">رصيد دائن</th><th class="num">الإجمالي</th></tr></thead><tbody>
      ${A.rows.map((x) => html`<tr data-href="#/${seg}/${x.party.id}"><td>${x.party.name}</td>${AGING_BUCKETS.map((b) => html`<td class="num">${x[b.id] ? html`<span class="${b.id !== 'current' ? 'neg' : ''}">${money(x[b.id])}</span>` : ''}</td>`)}<td class="num">${x.credit ? money(x.credit) : ''}</td><td class="num"><b>${money(x.total)}</b></td></tr>`)}
    </tbody><tfoot><tr><td>الإجمالي</td>${AGING_BUCKETS.map((b) => html`<td class="num">${money(A.totals[b.id])}</td>`)}<td class="num">${money(A.totals.credit)}</td><td class="num">${money(A.totals.total)}</td></tr></tfoot></table></div>`
    : empty('✅', kind === 'customer' ? 'لا توجد مستحقات على العملاء' : 'لا توجد مستحقات للموردين');
  frame(ctx, r, { asOf, fixed: true, body, note: 'يُحسب التأخير من تاريخ الاستحقاق، أو من تاريخ الفاتورة إن لم يُحدد استحقاق. الدفعات تُخصم من الأقدم أولاً ما لم تُربط بفاتورة محددة.' });
}

// ── النقدية ──
function cash(ctx, r) {
  const per = periodOf(ctx.query, 'month');
  const C = cashReport(store.getDb(), store.getBooks(), per);
  const body = html`<div class="tbl-wrap"><table class="tbl" data-table><thead><tr><th>الحساب</th><th class="num">رصيد أول الفترة</th><th class="num">الداخل</th><th class="num">الخارج</th><th class="num">الرصيد الحالي</th></tr></thead><tbody>
    ${C.rows.map((x) => html`<tr data-href="${withQuery('accounts/' + x.account.id, { from: per.from, to: per.to })}"><td>${x.account.name}</td><td class="num">${money(x.open)}</td><td class="num pos">${money(x.in)}</td><td class="num neg">${money(x.out)}</td><td class="num"><b>${money(x.close)}</b></td></tr>`)}
  </tbody><tfoot><tr><td>الإجمالي</td><td class="num">${money(C.totals.open)}</td><td class="num">${money(C.totals.in)}</td><td class="num">${money(C.totals.out)}</td><td class="num">${money(C.totals.close)}</td></tr></tfoot></table></div>`;
  frame(ctx, r, { per, body, note: 'اضغط على أي حساب لعرض تفاصيل حركته. التحويلات بين الصندوق والبنك تظهر داخلاً في حساب وخارجاً من الآخر.' });
}

// ── المخزون ──
function stock(ctx, r) {
  const db = store.getDb();
  const R = stockReport(db, store.getBooks());
  const body = R.rows.length ? html`<div class="sum-bar"><span>عدد الأصناف: <b>${R.rows.length}</b></span><span>قيمة المخزون: <b>${money(R.value, { sym: true })}</b></span></div>
    <div class="tbl-wrap"><table class="tbl" data-table><thead><tr><th>الصنف</th><th class="num">الكمية</th><th class="num">متوسط التكلفة</th><th class="num">القيمة</th><th class="num hide-sm">سعر البيع</th><th class="num hide-sm">الهامش المتوقع</th></tr></thead><tbody>
    ${R.rows.map((x) => { const pr = num(x.product.price); return html`<tr data-href="#/products/${x.product.id}"><td>${x.product.name}${x.low ? html` <span class="badge badge-bad">نفاد</span>` : ''}</td><td class="num"><span class="${x.qty < 0 ? 'neg' : ''}">${qty(x.qty)}</span></td><td class="num">${money(x.unit)}</td><td class="num">${money(x.value)}</td><td class="num hide-sm">${money(pr)}</td><td class="num hide-sm">${pr ? Math.round(((pr - x.unit) / pr) * 100) + '%' : '—'}</td></tr>`; })}
    </tbody><tfoot><tr><td>الإجمالي</td><td></td><td></td><td class="num">${money(R.value)}</td><td class="hide-sm"></td><td class="hide-sm"></td></tr></tfoot></table></div>`
    : empty('📦', 'لا توجد منتجات مخزنية');
  frame(ctx, r, { asOf: today(), fixed: true, body, note: 'تقييم المخزون الحالي بطريقة المتوسط المرجح. قيمة المخزون تساوي رصيد حساب المخزون في الميزانية.' });
}

// ── المصروفات حسب البند ──
function expenses(ctx, r) {
  const db = store.getDb();
  const per = periodOf(ctx.query, 'month');
  const I = incomeStatement(db, store.getBooks(), per);
  const rows = I.expenses.filter((x) => x.amount).sort((a, b) => b.amount - a.amount);
  const total = I.totalExpenses;
  const body = rows.length ? html`<div class="tbl-wrap"><table class="tbl" data-table><thead><tr><th>البند</th><th class="num">المبلغ</th><th class="num">النسبة</th><th class="hide-sm" style="width:30%"></th></tr></thead><tbody>
    ${rows.map((x) => { const p = total ? (x.amount / total) * 100 : 0; return html`<tr data-href="${withQuery('accounts/' + x.account.id, { from: per.from, to: per.to })}"><td>${x.account.name}</td><td class="num">${money(x.amount)}</td><td class="num">${Math.round(p * 10) / 10}%</td>
      <td class="hide-sm"><div style="height:8px;border-radius:4px;background:var(--soft);overflow:hidden"><div style="height:100%;width:${Math.max(0, Math.min(100, p)).toFixed(1)}%;background:#6366f1;border-radius:4px"></div></div></td></tr>`; })}
  </tbody><tfoot><tr><td>إجمالي المصروفات التشغيلية</td><td class="num">${money(total)}</td><td class="num">100%</td><td class="hide-sm"></td></tr></tfoot></table></div>`
    : empty('💸', 'لا توجد مصروفات في هذه الفترة');
  frame(ctx, r, { per, body, note: `لا تشمل تكلفة البضاعة المباعة (${money(I.totalCogs)}). النسبة من إجمالي المصروفات التشغيلية.` });
}
