// ═══════════════════════════════════════════
// احسبها - دوال جميع الحسابات
// ═══════════════════════════════════════════

// ═══ حاسبة تابي وتمارا ═══
function calcTabby() {
  const price = parseFloat(document.getElementById('price').value) || 0;
  const feePercent = parseFloat(document.getElementById('fee').value) || 0;
  const fixedFee = parseFloat(document.getElementById('fixed').value) || 0;
  const vatPercent = parseFloat(document.getElementById('vat').value) || 0;

  const commission = (price * feePercent / 100) + fixedFee;
  const vat = commission * (vatPercent / 100);
  const totalDeduction = commission + vat;
  const net = price - totalDeduction;

  const totalEl = document.getElementById('total-deduction');
  const netEl = document.getElementById('net-amount');
  const commEl = document.getElementById('commission');
  const vatEl = document.getElementById('vat-amount');
  const alertEl = document.getElementById('tabby-alert');

  if (commEl) commEl.textContent = fmt(commission) + ' ر.س';
  if (vatEl) vatEl.textContent = fmt(vat) + ' ر.س';
  if (totalEl) totalEl.textContent = fmt(totalDeduction) + ' ر.س';
  if (netEl) {
    netEl.textContent = fmt(net) + ' ر.س';
    netEl.className = 'result-value ' + (net > 0 ? 'positive' : 'negative');
  }

  if (alertEl) {
    if (net <= 0) {
      alertEl.className = 'alert alert-error';
      alertEl.textContent = '⚠️ تحذير: بعد خصم العمولة والضريبة، لن تحصل على أي مبلغ!';
    } else if (net < price * 0.5) {
      alertEl.className = 'alert alert-warning';
      alertEl.textContent = '⚡ تنبيه: أكثر من نصف قيمة المنتج تذهب للعمولة!';
    } else {
      alertEl.className = 'alert alert-success';
      alertEl.textContent = '✅ عملية مربحة - تستلم ' + fmt(net) + ' ر.س';
    }
  }
}

// ═══ حاسبة الزكاة ═══
function calcZakat() {
  const wealth = parseFloat(document.getElementById('wealth').value) || 0;
  const goldPrice = parseFloat(document.getElementById('gold-price').value) || 0;
  const nisab = goldPrice * 85;
  const zakat = wealth * 0.025;

  const nisabEl = document.getElementById('nisab-value');
  const zakatEl = document.getElementById('zakat-value');
  const alertEl = document.getElementById('zakat-alert');

  if (nisabEl) nisabEl.textContent = fmt(nisab) + ' ر.س';
  if (zakatEl) zakatEl.textContent = fmt(zakat) + ' ر.س';

  if (alertEl) {
    if (wealth < nisab) {
      alertEl.className = 'alert alert-warning';
      alertEl.textContent = '⚠️ مالك أقل من النصاب (' + fmt(nisab) + ' ر.س) - لا تجب الزكاة';
      if (zakatEl) zakatEl.textContent = '0.00 ر.س';
    } else {
      alertEl.className = 'alert alert-success';
      alertEl.textContent = '✅ تجب عليك الزكاة بمقدار ' + fmt(zakat) + ' ر.س';
    }
  }
}

// ═══ حاسبة ضريبة القيمة المضافة ═══
function calcVAT() {
  const price = parseFloat(document.getElementById('price').value) || 0;
  const rate = parseFloat(document.getElementById('rate').value) || 0;
  const mode = document.getElementById('mode').value;

  let base, vat, total;

  if (mode === 'add') {
    base = price;
    vat = price * (rate / 100);
    total = price + vat;
  } else {
    total = price;
    base = price / (1 + rate / 100);
    vat = price - base;
  }

  const baseEl = document.getElementById('base-price');
  const vatEl = document.getElementById('vat-value');
  const totalEl = document.getElementById('total-price');

  if (baseEl) baseEl.textContent = fmt(base) + ' ر.س';
  if (vatEl) vatEl.textContent = fmt(vat) + ' ر.س';
  if (totalEl) totalEl.textContent = fmt(total) + ' ر.س';
}

// ═══ حاسبة القروض (متناقصة + ثابتة) ═══
function calcLoan() {
  const amount = parseFloat(document.getElementById('amount').value) || 0;
  const rate = parseFloat(document.getElementById('rate').value) || 0;
  const months = parseInt(document.getElementById('months').value) || 1;
  const method = document.getElementById('method').value;

  let payment, total, interest;

  if (method === 'declining') {
    if (rate > 0) {
      const mr = (rate / 100) / 12;
      const f = Math.pow(1 + mr, months);
      payment = amount * (mr * f) / (f - 1);
    } else {
      payment = amount / months;
    }
    total = payment * months;
    interest = total - amount;
  } else {
    // مرابحة (ثابتة)
    interest = amount * (rate / 100) * (months / 12);
    total = amount + interest;
    payment = total / months;
  }

  const paymentEl = document.getElementById('payment');
  const interestEl = document.getElementById('interest');
  const totalEl = document.getElementById('total');

  if (paymentEl) paymentEl.textContent = fmt(payment) + ' ر.س';
  if (interestEl) interestEl.textContent = fmt(interest) + ' ر.س';
  if (totalEl) totalEl.textContent = fmt(total) + ' ر.س';
}

// ═══ حاسبة هامش الربح (التجارة الإلكترونية) ═══
function calcProfit() {
  const cost = parseFloat(document.getElementById('cost').value) || 0;
  const shipping = parseFloat(document.getElementById('shipping').value) || 0;
  const sellPrice = parseFloat(document.getElementById('sell-price').value) || 0;
  const gatewayPercent = parseFloat(document.getElementById('gateway').value) || 0;
  const fixedFee = parseFloat(document.getElementById('fixed-fee').value) || 0;

  const totalCost = cost + shipping;
  const gateway = (sellPrice * gatewayPercent / 100) + fixedFee;
  const profit = sellPrice - totalCost - gateway;
  const margin = sellPrice > 0 ? (profit / sellPrice) * 100 : 0;

  const costEl = document.getElementById('total-cost');
  const gatewayEl = document.getElementById('gateway-fee');
  const profitEl = document.getElementById('net-profit');
  const marginEl = document.getElementById('margin');

  if (costEl) costEl.textContent = fmt(totalCost) + ' ر.س';
  if (gatewayEl) gatewayEl.textContent = fmt(gateway) + ' ر.س';
  if (profitEl) {
    profitEl.textContent = fmt(profit) + ' ر.س';
    profitEl.className = 'result-value ' + (profit > 0 ? 'positive' : 'negative');
  }
  if (marginEl) marginEl.textContent = fmt(margin, 1) + '%';
}

// ═══ حاسبة الخصومات ═══
function calcDiscount() {
  const price = parseFloat(document.getElementById('price').value) || 0;
  const type = document.getElementById('type').value;
  let discount = 0;

  if (type === 'percent') {
    const percent = parseFloat(document.getElementById('percent').value) || 0;
    discount = price * (percent / 100);
  } else {
    discount = parseFloat(document.getElementById('fixed-disc').value) || 0;
    if (discount > price) discount = price;
  }

  const finalPrice = price - discount;

  const discountEl = document.getElementById('discount-amount');
  const finalEl = document.getElementById('final-price');

  if (discountEl) discountEl.textContent = fmt(discount) + ' ر.س';
  if (finalEl) finalEl.textContent = fmt(finalPrice) + ' ر.س';
}

// ═══ حاسبة العمر ═══
function calcAge() {
  const dobStr = document.getElementById('dob').value;
  if (!dobStr) return;

  const dob = new Date(dobStr);
  const today = new Date();
  const totalDays = Math.floor((today - dob) / (1000 * 60 * 60 * 24));
  const totalWeeks = Math.floor(totalDays / 7);

  let years = today.getFullYear() - dob.getFullYear();
  let months = today.getMonth() - dob.getMonth();
  let days = today.getDate() - dob.getDate();

  if (days < 0) {
    months--;
    const prevMonth = new Date(today.getFullYear(), today.getMonth(), 0);
    days += prevMonth.getDate();
  }
  if (months < 0) {
    years--;
    months += 12;
  }

  const yearsEl = document.getElementById('age-years');
  const monthsEl = document.getElementById('age-months');
  const daysEl = document.getElementById('age-days');
  const totalEl = document.getElementById('age-total-days');

  if (yearsEl) yearsEl.textContent = years;
  if (monthsEl) monthsEl.textContent = months;
  if (daysEl) daysEl.textContent = days;
  if (totalEl) totalEl.textContent = totalDays.toLocaleString();
}

// ═══ حاسبة عمولة سلة وزد ═══
function calcSalla() {
  const sellPrice = parseFloat(document.getElementById('sell-price').value) || 0;
  const productCost = parseFloat(document.getElementById('product-cost').value) || 0;
  const shipping = parseFloat(document.getElementById('shipping').value) || 0;
  const commission = parseFloat(document.getElementById('commission').value) || 0;
  const payment = parseFloat(document.getElementById('payment').value) || 0;
  const paymentFixed = parseFloat(document.getElementById('payment-fixed').value) || 0;
  const vat = parseFloat(document.getElementById('vat').value) || 0;

  const platformFee = sellPrice * (commission / 100);
  const paymentFee = (sellPrice * (payment / 100)) + paymentFixed;
  const vatFee = (platformFee + paymentFee) * (vat / 100);
  const totalDeductions = platformFee + paymentFee + vatFee;
  const netProfit = sellPrice - productCost - shipping - totalDeductions;

  const pfEl = document.getElementById('platform-fee');
  const payEl = document.getElementById('payment-fee');
  const tdEl = document.getElementById('total-deductions');
  const npEl = document.getElementById('net-profit');
  const alertEl = document.getElementById('salla-alert');

  if (pfEl) pfEl.textContent = fmt(platformFee) + ' ر.س';
  if (payEl) payEl.textContent = fmt(paymentFee) + ' ر.س';
  if (tdEl) tdEl.textContent = fmt(totalDeductions) + ' ر.س';
  if (npEl) {
    npEl.textContent = fmt(netProfit) + ' ر.س';
    npEl.className = 'result-value ' + (netProfit > 0 ? 'positive' : 'negative');
  }

  if (alertEl) {
    if (netProfit <= 0) {
      alertEl.className = 'alert alert-error';
      alertEl.textContent = '⚠️ خسارة! راجع التسعير أو التكاليف';
    } else if (netProfit < sellPrice * 0.2) {
      alertEl.className = 'alert alert-warning';
      alertEl.textContent = '⚡ هامش ضعيف (أقل من 20%)';
    } else {
      alertEl.className = 'alert alert-success';
      alertEl.textContent = '✅ عملية مربحة - ربح ' + fmt(netProfit) + ' ر.س';
    }
  }
}
// ═══ تنسيق العملة ═══
function fmtCurrency(num, currency = 'ر.س') {
  return fmt(num) + ' ' + currency;
}

// ═══ حاسبة الإعلانات ROAS ═══
function calcROAS() {
  const adSpend = parseFloat(document.getElementById('ad-spend').value) || 0;
  const orders = parseInt(document.getElementById('orders').value) || 1;
  const aov = parseFloat(document.getElementById('aov').value) || 0;
  const marginPercent = parseFloat(document.getElementById('margin-percent').value) || 0;

  const revenue = orders * aov;
  const roas = adSpend > 0 ? revenue / adSpend : 0;
  const cpa = orders > 0 ? adSpend / orders : 0;
  const grossProfit = revenue * (marginPercent / 100);
  const netProfit = grossProfit - adSpend;
  const breakevenRoas = marginPercent > 0 ? 100 / marginPercent : 0;
  const maxCpa = aov * (marginPercent / 100);

  const set = (id, val, cls) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = val;
    if (cls) el.className = 'result-value ' + cls;
  };

  set('revenue', fmt(revenue) + ' ر.س');
  set('roas', roas.toFixed(2) + 'x', roas >= breakevenRoas ? 'positive' : 'negative');
  set('cpa', fmt(cpa) + ' ر.س');
  set('gross-profit', fmt(grossProfit) + ' ر.س');
  set('net-profit', fmt(netProfit) + ' ر.س', netProfit > 0 ? 'positive' : 'negative');
  set('max-cpa', fmt(maxCpa) + ' ر.س');

  const alertEl = document.getElementById('roas-alert');
  if (alertEl) {
    if (roas < breakevenRoas) {
      alertEl.className = 'alert alert-error';
      alertEl.textContent = '⚠️ حملة خاسرة! ROAS الحالي (' + roas.toFixed(2) + 'x) أقل من التعادل (' + breakevenRoas.toFixed(2) + 'x)';
    } else if (roas < breakevenRoas * 1.5) {
      alertEl.className = 'alert alert-warning';
      alertEl.textContent = '⚡ ربح ضعيف. حاول تحسين الحملة للوصول إلى ' + (breakevenRoas * 1.5).toFixed(2) + 'x';
    } else {
      alertEl.className = 'alert alert-success';
      alertEl.textContent = '🎉 حملة مربحة! ROAS = ' + roas.toFixed(2) + 'x';
    }
  }
}

// ═══ حاسبة الخصومات ═══
function calcDiscount() {
  const price = parseFloat(document.getElementById('price').value) || 0;
  const type = document.getElementById('type').value;
  let discount = 0;

  if (type === 'percent') {
    const percent = parseFloat(document.getElementById('percent').value) || 0;
    discount = price * (percent / 100);
  } else {
    discount = parseFloat(document.getElementById('fixed-disc').value) || 0;
    if (discount > price) discount = price;
  }

  const finalPrice = price - discount;
  const savingPercent = price > 0 ? (discount / price) * 100 : 0;

  const dEl = document.getElementById('discount-amount');
  const fEl = document.getElementById('final-price');
  const pEl = document.getElementById('saving-percent');

  if (dEl) dEl.textContent = fmt(discount) + ' ر.س';
  if (fEl) fEl.textContent = fmt(finalPrice) + ' ر.س';
  if (pEl) pEl.textContent = savingPercent.toFixed(1) + '%';
}

function toggleDiscountType() {
  const type = document.getElementById('type').value;
  const percentGroup = document.getElementById('percent-group');
  const fixedGroup = document.getElementById('fixed-group');

  if (type === 'percent') {
    percentGroup.style.display = 'block';
    fixedGroup.style.display = 'none';
  } else {
    percentGroup.style.display = 'none';
    fixedGroup.style.display = 'block';
  }
  calcDiscount();
}

// ═══ حاسبة الرواتب ═══
function calcSalary() {
  const basic = parseFloat(document.getElementById('basic').value) || 0;
  const allow = parseFloat(document.getElementById('allowances').value) || 0;
  const deduct = parseFloat(document.getElementById('deductions').value) || 0;
  const net = basic + allow - deduct;
  const el = document.getElementById('net-salary');
  const alertEl = document.getElementById('salary-alert');
  if (el) el.textContent = fmt(net) + ' ر.س';
  if (alertEl) {
    if (net < 0) {
      alertEl.className = 'alert alert-error';
      alertEl.textContent = '⚠️ الخصومات تتجاوز الراتب!';
    } else if (net < basic) {
      alertEl.className = 'alert alert-warning';
      alertEl.textContent = '⚡ صافي الراتب أقل من الأساسي';
    } else {
      alertEl.className = 'alert alert-success';
      alertEl.textContent = '✅ الراتب المستحق: ' + fmt(net) + ' ر.س';
    }
  }
}

// ═══ نهاية الخدمة ═══
function calcEndOfService() {
  const salary = parseFloat(document.getElementById('eos-salary').value) || 0;
  const years = parseInt(document.getElementById('eos-years').value) || 0;
  const months = parseInt(document.getElementById('eos-months').value) || 0;
  const reason = document.getElementById('eos-reason').value;
  const nationality = document.getElementById('eos-nationality').value;

  const totalYears = years + months / 12;
  const first5 = Math.min(totalYears, 5);
  const after5 = Math.max(totalYears - 5, 0);
  let gratuity = (first5 * salary * 0.5) + (after5 * salary);

  if (reason === 'resign') {
    if (totalYears < 2) gratuity = 0;
    else if (totalYears < 5) gratuity /= 3;
    else if (totalYears < 10) gratuity *= 2 / 3;
  }

  let gosiRate = 0;
  if (nationality === 'saudi') {
    const today = new Date();
    const cutoff = new Date('2024-07-03');
    if (new Date() > cutoff) {
      const y = today.getFullYear();
      if (y >= 2027) gosiRate = 0.1325;
      else if (y === 2026) gosiRate = 0.1275;
      else gosiRate = 0.12;
    } else {
      gosiRate = 0.1175;
    }
  } else {
    gosiRate = 0.02;
  }

  const gosi = salary * gosiRate;

  const gEl = document.getElementById('gratuity');
  const gosiEl = document.getElementById('gosi-share');
  const tEl = document.getElementById('eos-total');

  if (gEl) gEl.textContent = fmt(gratuity) + ' ر.س';
  if (gosiEl) gosiEl.textContent = fmt(gosi) + ' ر.س';
  if (tEl) tEl.textContent = fmt(gratuity + gosi) + ' ر.س';
}

// ═══ تكلفة الموظف ═══
function calcEmployeeCost() {
  const salary = parseFloat(document.getElementById('ec-salary').value) || 0;
  const housing = parseFloat(document.getElementById('ec-housing').value) || 0;
  const transport = parseFloat(document.getElementById('ec-transport').value) || 0;
  const other = parseFloat(document.getElementById('ec-other').value) || 0;
  const bonus = parseFloat(document.getElementById('ec-bonus').value) || 0;
  const nationality = document.getElementById('ec-nationality').value;

  const totalSal = salary + housing + transport + other;
  const gosiBase = Math.min(salary + housing, 45000);
  let gosiRate = nationality === 'saudi' ? 0.1275 : 0.02;
  const gosi = (nationality === 'saudi' ? gosiBase : totalSal) * gosiRate;

  const monthly = totalSal + gosi;
  const annual = (monthly * 12) + bonus;

  const mEl = document.getElementById('ec-monthly');
  const aEl = document.getElementById('ec-annual');
  const gEl = document.getElementById('ec-gosi');

  if (mEl) mEl.textContent = fmt(monthly) + ' ر.س';
  if (aEl) aEl.textContent = fmt(annual) + ' ر.س';
  if (gEl) gEl.textContent = fmt(gosi) + ' ر.س';
}

// ═══ حاسبة الدوام الدقيقة ═══
function calcWorkingHours() {
  const salary = parseFloat(document.getElementById('wh-salary').value) || 0;
  const startDate = document.getElementById('wh-start-date').value;
  const startTime = document.getElementById('wh-start-time').value;
  const endDate = document.getElementById('wh-end-date').value;
  const endTime = document.getElementById('wh-end-time').value;

  if (!startDate || !startTime || !endDate || !endTime) return;

  const start = new Date(startDate + 'T' + startTime);
  const end = new Date(endDate + 'T' + endTime);

  if (end <= start) {
    const alertEl = document.getElementById('wh-alert');
    if (alertEl) {
      alertEl.className = 'alert alert-error';
      alertEl.textContent = '⚠️ وقت النهاية يجب أن يكون بعد البداية';
    }
    return;
  }

  const diffMs = end - start;
  const diffSec = diffMs / 1000;
  const days = Math.floor(diffSec / 86400);
  const hours = Math.floor((diffSec % 86400) / 3600);
  const minutes = Math.floor((diffSec % 3600) / 60);

  const monthSec = 30 * 24 * 3600;
  const earned = (diffSec / monthSec) * salary;

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  set('wh-days', days);
  set('wh-hours', hours);
  set('wh-minutes', minutes);
  set('wh-earned', fmt(earned) + ' ر.س');

  const alertEl = document.getElementById('wh-alert');
  if (alertEl) {
    alertEl.className = 'alert alert-success';
    alertEl.textContent = '✅ الراتب المستحق: ' + fmt(earned) + ' ر.س';
  }
}
