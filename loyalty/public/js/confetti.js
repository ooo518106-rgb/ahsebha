// قصاصات ملونة للاحتفال: نقاط جديدة، مكافأة جاهزة، بطاقة جديدة، أو هدية
const COLORS = ['#f3c98b', '#d9a066', '#ffffff', '#4ade80', '#f472b6', '#60a5fa', '#facc15'];

export function confetti({ count = 140, origin = { x: 0.5, y: 0.32 }, colors = COLORS } = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  canvas.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = innerWidth;
  const H = innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const parts = Array.from({ length: count }, (_, i) => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
    const v = 7 + Math.random() * 10;
    return {
      x: W * origin.x, y: H * origin.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      w: 6 + Math.random() * 6, h: 9 + Math.random() * 9, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
      color: colors[i % colors.length], round: Math.random() < 0.3,
    };
  });
  const LIFE = 2800;
  const start = performance.now();
  let last = start;
  function frame(now) {
    const dt = Math.min(2, (now - last) / 16.7);
    last = now;
    const age = now - start;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = age > LIFE - 600 ? Math.max(0, (LIFE - age) / 600) : 1;
    for (const p of parts) {
      p.vy += 0.32 * dt;
      p.vx *= 0.986;
      p.vy *= 0.986;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += p.vr * dt;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.scale(1, Math.cos(p.r * 2));
      ctx.fillStyle = p.color;
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (age < LIFE) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}
