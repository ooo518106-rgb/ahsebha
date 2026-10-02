// ═══ التنقل: روابط المستندات، قراءة العنوان، والتنبيه قبل ترك نموذج غير محفوظ ═══

// مقطع الرابط لكل نوع مستند
export const SEG = {
  sale: 'sales', quote: 'quotes', sreturn: 'sales-returns', purchase: 'purchases', preturn: 'purchase-returns',
  expense: 'expenses', receipt: 'receipts', payment: 'payments', transfer: 'transfers', journal: 'journal', adjust: 'adjustments',
  sorder: 'sales-orders', porder: 'purchase-orders', payroll: 'payroll', stransfer: 'stock-transfers',
};

// القيود المشتقة (الإهلاك، تحصيل الشيكات) تفتح مصدرها
export function docHref(d) {
  if (!d) return '#/';
  if (d.type === 'opening') return '#/accounts';
  if (d.href) return d.href;
  if (d.src) return docHref(d.src);
  return SEG[d.type] ? `#/${SEG[d.type]}/${d.id}` : '#/';
}
export const partyHref = (p) => (p ? `#/${p.kind === 'supplier' ? 'suppliers' : 'customers'}/${p.id}` : '#/');

export function go(path) {
  const h = path.startsWith('#') ? path : '#' + path;
  if (location.hash === h) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = h;
}

export function parseHash() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [p, q = ''] = h.split('?');
  return { path: p.replace(/\/+$/, ''), query: Object.fromEntries(new URLSearchParams(q)) };
}

// يبني رابطاً بنفس المسار مع استعلام جديد (للفلاتر والفترات)
export function withQuery(path, query) {
  const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== '' && v != null)).toString();
  return '#/' + path + (q ? '?' + q : '');
}

// نموذج مفتوح بتعديلات غير محفوظة
export const guard = { dirty: false };

export function setTitle(t) {
  const el = document.getElementById('topbar-title');
  if (el) el.textContent = t;
  document.title = t + ' — محاسبة احسبها';
}

// إعادة عرض الصفحة الحالية بعد تعديل البيانات
export const refresh = () => go(location.hash || '#/');
