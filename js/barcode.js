// ═══ الباركود: توليد EAN-13 و Code128 كرسوم SVG، والقراءة بكاميرا الجوال ═══

// ─── EAN-13 ───
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function eanCheckDigit(d12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d12[i]) * (i % 2 ? 3 : 1);
  return String((10 - (sum % 10)) % 10);
}
export const isEan13 = (code) => /^\d{13}$/.test(String(code)) && eanCheckDigit(String(code).slice(0, 12)) === String(code)[12];

// باركود داخلي للمتجر: يبدأ بـ 20 (نطاق الاستخدام الداخلي في GS1) ثم أرقام عشوائية ورقم التحقق
export function makeStoreBarcode(taken = new Set()) {
  for (;;) {
    const a = new Uint8Array(10);
    crypto.getRandomValues(a);
    const d = '20' + Array.from(a, (b) => b % 10).join('');
    const code = d + eanCheckDigit(d);
    if (!taken.has(code)) return code;
  }
}

export function ean13Modules(code) {
  const first = Number(code[0]);
  let m = '101';
  for (let i = 1; i <= 6; i++) m += (PARITY[first][i - 1] === 'L' ? L : G)[Number(code[i])];
  m += '01010';
  for (let i = 7; i <= 12; i++) m += R[Number(code[i])];
  return m + '101';
}

// ─── Code 128 (المجموعة B: الحروف والأرقام اللاتينية) ───
const C128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

export const code128Supported = (text) => /^[\x20-\x7E]+$/.test(String(text));

export function code128Modules(text) {
  const vals = [104];
  for (const ch of String(text)) vals.push(ch.charCodeAt(0) - 32);
  let sum = vals[0];
  for (let i = 1; i < vals.length; i++) sum += vals[i] * i;
  vals.push(sum % 103, 106);
  let m = '';
  for (const v of vals) {
    const w = C128[v];
    for (let i = 0; i < w.length; i++) m += (i % 2 ? '0' : '1').repeat(Number(w[i]));
  }
  return m;
}

// رسم SVG قابل للطباعة؛ العرض بالوحدات حتى يتمدد حسب الملصق
export function barcodeSVG(code, { height = 40, text = true } = {}) {
  code = String(code || '');
  if (!code || (!isEan13(code) && !code128Supported(code))) return '';
  const modules = isEan13(code) ? ean13Modules(code) : code128Modules(code);
  const quiet = 10;
  const w = modules.length + quiet * 2;
  const textH = text ? 11 : 0;
  let d = '';
  let run = 0;
  for (let i = 0; i <= modules.length; i++) {
    if (modules[i] === '1') run++;
    else if (run) { d += `M${quiet + i - run} 0h${run}v${height}h-${run}z`; run = 0; }
  }
  const label = text ? `<text x="${w / 2}" y="${height + 10}" text-anchor="middle" font-family="monospace" font-size="10" fill="#000">${code.replace(/[<&>"]/g, '')}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${height + textH}" preserveAspectRatio="none" role="img" aria-label="باركود ${code.replace(/[<&>"]/g, '')}"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/>${label}</svg>`;
}

// ─── القراءة بالكاميرا ───
let zxingLoading = null;
function loadZxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (!zxingLoading) {
    zxingLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('../vendor/zxing.min.js', import.meta.url).href;
      s.onload = () => resolve(window.ZXing);
      s.onerror = () => { zxingLoading = null; reject(new Error('تعذّر تحميل قارئ الباركود')); };
      document.head.append(s);
    });
  }
  return zxingLoading;
}

export function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 1150;
    g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination);
    o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, 90);
  } catch (e) { /* الصوت اختياري */ }
}

// يشغّل الكاميرا داخل video ويستدعي onCode لكل رمز جديد؛ يرجّع دالة الإيقاف
export async function startCameraScan(video, onCode) {
  let stopped = false;
  let last = '';
  let lastAt = 0;
  const emit = (code) => {
    const t = Date.now();
    if (!code || (code === last && t - lastAt < 1500)) return;
    last = code; lastAt = t;
    beep();
    onCode(code);
  };
  if ('BarcodeDetector' in window) {
    const formats = await window.BarcodeDetector.getSupportedFormats().catch(() => []);
    const wanted = ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code'].filter((f) => formats.includes(f));
    if (wanted.length) {
      const detector = new window.BarcodeDetector({ formats: wanted });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      video.srcObject = stream;
      video.setAttribute('playsinline', '');
      await video.play();
      const tick = async () => {
        if (stopped) return;
        try { const found = await detector.detect(video); if (found[0]) emit(found[0].rawValue); } catch (e) { /* إطار غير جاهز */ }
        setTimeout(tick, 180);
      };
      tick();
      return () => { stopped = true; stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
    }
  }
  const ZXing = await loadZxing();
  const reader = new ZXing.BrowserMultiFormatReader();
  await reader.decodeFromVideoDevice(undefined, video, (result) => { if (result && !stopped) emit(result.getText()); });
  return () => { stopped = true; reader.reset(); };
}
