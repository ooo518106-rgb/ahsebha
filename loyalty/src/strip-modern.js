// Geometric membership artwork, with Readex Pro typography and exact reward progress.
import { encodePng, hexToRgb } from './png.js';
import { walletGlyph } from './wallet-type.js';
import { modernGeometry } from './wallet-modern-masks.js';

const S = 3;
const clamp = v => Math.max(0, Math.min(1, v));
const edge = d => clamp(.5 - d * S);
// rtl: stamps fill from the right, like Arabic reading. flat: no background gradient, so the band matches the pass colour.
export async function renderModern({ f, color, st, percent }, { rtl = false, flat = false } = {}) {
  const W=f.W*S,H=f.H*S,stride=W*3+1,raw=new Uint8Array(stride*H);
  const bg=hexToRgb(color),light=(.299*bg[0]+.587*bg[1]+.114*bg[2])>178.5;
  const fg=light ? [35,31,28] : [255,247,232],decor=await modernGeometry(f.W);
  const chars=await Promise.all([...String(percent),'%'].map(c=>walletGlyph(f.H,c)));
  const label=await walletGlyph(f.H,st.ready?'ready':'progress');
  const glyphs=[];
  let gx=24*S;
  for(const [i,g] of chars.entries()) {
    const isPercent=i===chars.length-1;
    glyphs.push({...g,x:Math.round(gx),y:Math.round((f.H*.57)*S-g.h)});
    gx+=g.w+(isPercent?0:3*S);
  }
  glyphs.push({...label,x:24*S,y:Math.round(f.H*.65*S)});
  const start=24,finish=f.W*.65,railY=f.H*.88;
  const spacing=st.slots>1?(finish-start)/(st.slots-1):0;
  const dotRadius=Math.min(4.2,f.H*.033,spacing>0?spacing*.3:4.2);
  for(let y=0;y<H;y++) for(let x=0;x<W;x++) {
    const X=(x+.5)/S,Y=(y+.5)/S,o=y*W+x,dst=y*stride+1+x*3;
    let alpha=flat?0:decor[o*2]/255;
    alpha+=decor[o*2+1]/255*(1-alpha);
    const within=X>=start&&X<=finish&&st.slots>1;
    const rail=within?edge(Math.abs(Y-railY)-.45)*(light?.18:.25):0;
    alpha+=rail*(1-alpha);
    const n=st.slots>1?Math.max(0,Math.min(st.slots-1,Math.round((X-start)/spacing))):0;
    const dot=edge(Math.hypot(X-start-n*spacing,Y-railY)-dotRadius);
    // Inactive stamps keep the same contrast even over a light decorative fold.
    alpha=alpha*(1-dot)+((rtl?st.slots-1-n:n)<st.filled?1:.22)*dot;
    for(const g of glyphs) {
      const xx=x-g.x,yy=y-g.y;
      if(xx>=0&&xx<g.w&&yy>=0&&yy<g.h)alpha+=(g.data[yy*g.w+xx]/255)*(1-alpha);
    }
    for(let ch=0;ch<3;ch++) raw[dst+ch]=Math.round(bg[ch]+(fg[ch]-bg[ch])*alpha);
  }
  return encodePng(W,H,raw);
}
