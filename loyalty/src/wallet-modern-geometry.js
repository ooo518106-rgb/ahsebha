// Build-time geometry; regenerate with scripts/build-wallet-modern-masks.mjs.
const S=3;
const clamp=v=>Math.max(0,Math.min(1,v));
const edge=d=>clamp(.5-d*S);
const geometryCache = new Map();

// A universal folded starburst suits coffee shops, salons and retail alike.
export function geometry(f) {
  if (geometryCache.has(f.W)) return geometryCache.get(f.W);
  const W = f.W*S, H = f.H*S, data = new Uint8Array(W*H*2);
  const cx=f.W*.805, cy=f.H*.49, radius=f.H*.45;
  for(let y=0;y<H;y++) for(let x=0;x<W;x++) {
    const X=(x+.5)/S,Y=(y+.5)/S, dx=X-cx,dy=Y-cy, r=Math.hypot(dx,dy);
    const angle=(Math.atan2(dy,dx)+Math.PI*2)%(Math.PI*2);
    const sector=Math.floor(angle/(Math.PI/4));
    const t=angle%(Math.PI/4);
    const outer=radius*(sector%2 ? .82 : 1);
    const boundary=outer/(Math.cos(t)+Math.sin(t));
    // Seven narrow triangular folds and one intentionally quiet sector.
    const fold=sector!==5 ? edge(r-boundary)*edge((t-Math.PI*.145)*r) : 0;
    const i=(y*W+x)*2;
    data[i]=Math.round(255*clamp((X/f.W-.42)*.18 + (Y>f.H*.80-(X/f.W)*f.H*.32 ? .025 : 0)));
    data[i+1]=Math.round(255*fold*(sector%2 ? .46 : .98));
  }
  geometryCache.set(f.W,data);
  return data;
}
