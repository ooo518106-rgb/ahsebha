// قراءة QR بكاميرا الجوال: BarcodeDetector لو موجود (كروم أندرويد)، وإلا مكتبة zxing (بتنحمّل عند الحاجة)
let zxingLoading = null;
function loadZxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  if (!zxingLoading) {
    zxingLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/zxing.min.js';
      s.onload = () => resolve(window.ZXing);
      s.onerror = () => { zxingLoading = null; reject(new Error('تعذّر تحميل قارئ QR')); };
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
  } catch { /* الصوت اختياري */ }
}

// بيشغّل الكاميرا جوّا video وبيستدعي onCode لكل رمز جديد؛ بيرجّع دالة الإيقاف
export async function startCameraScan(video, onCode) {
  let stopped = false;
  let last = '';
  let lastAt = 0;
  const emit = (code) => {
    const t = Date.now();
    if (!code || (code === last && t - lastAt < 2500)) return;
    last = code; lastAt = t;
    beep();
    if (navigator.vibrate) navigator.vibrate(60);
    onCode(code);
  };
  if ('BarcodeDetector' in window) {
    const formats = await window.BarcodeDetector.getSupportedFormats().catch(() => []);
    if (formats.includes('qr_code')) {
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      video.srcObject = stream;
      video.setAttribute('playsinline', '');
      video.muted = true;
      await video.play();
      const tick = async () => {
        if (stopped) return;
        try { const found = await detector.detect(video); if (found[0]) emit(found[0].rawValue); } catch { /* إطار مش جاهز */ }
        setTimeout(tick, 160);
      };
      tick();
      return () => { stopped = true; stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
    }
  }
  const ZXing = await loadZxing();
  const hints = new Map([[ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.QR_CODE]]]);
  const reader = new ZXing.BrowserMultiFormatReader(hints);
  video.setAttribute('playsinline', '');
  await reader.decodeFromConstraints({ video: { facingMode: 'environment' }, audio: false }, video, (result) => { if (result && !stopped) emit(result.getText()); });
  return () => { stopped = true; reader.reset(); };
}
