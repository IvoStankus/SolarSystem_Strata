/* Node harness: run the app's procedural texture factory headlessly.
   Stubs canvas + THREE texture bits, then checks output for NaN/blank
   pixels, longitude-seam continuity, and measures generation cost.     */
import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');
const cut = (startMark, endMark) => {
  const a = html.indexOf(startMark), b = html.indexOf(endMark);
  if (a < 0 || b < 0) throw new Error('marker not found: ' + startMark);
  return html.slice(a, b);
};
const dataSrc  = cut('const TAU =', '/* =====================================================================\n   2. PROCEDURAL');
const texSrc   = cut('const TEX_W = 512', '/* =====================================================================\n   3. RENDERER');

/* ---- stubs ---- */
class Ctx {
  constructor(cv){ this.c = cv; this.stack = []; }
  createImageData(w, h){ return { width:w, height:h, data:new Uint8ClampedArray(w*h*4) }; }
  putImageData(img){ this.c.__img = img; this.checked = true; }
  createRadialGradient(){ return { addColorStop(){ } }; }
  createLinearGradient(){ return { addColorStop(){ } }; }
  fillRect(){} beginPath(){} arc(){} fill(){} stroke(){} moveTo(){} lineTo(){}
  save(){} restore(){} translate(){} scale(){} set fillStyle(v){} set strokeStyle(v){}
  set lineWidth(v){} set lineCap(v){}
}
class Canvas { constructor(){ this.width=0; this.height=0; } getContext(){ return (this.__ctx ||= new Ctx(this)); } }
globalThis.document = { createElement: t => { if (t !== 'canvas') throw new Error('unexpected element ' + t); return new Canvas(); } };

class CanvasTexture {
  constructor(image){ this.image = image; this.colorSpace = null; this.wrapS = this.wrapT = null; this.anisotropy = 0; this.needsUpdate = false; }
}
const THREE = { CanvasTexture, SRGBColorSpace: 'srgb', RepeatWrapping: 1000, ClampToEdgeWrapping: 1001 };
globalThis.THREE = THREE;

/* ---- evaluate app source ---- */
const body = `
${dataSrc}
${texSrc}
return { PLANETS, SUN, texBanded, texRocky, texMars, texEarth, texIce, texClouds, texSun, texRing,
         texGlow, texSelectRing, texStar, fbm, fAU, ELEMS: null };`;
const api = new Function('THREE', body)(THREE);

/* ---- checks ---- */
let fail = 0;
function inspect(name, tex){
  const img = tex.image.__img;
  if (!img) { console.log(`${name.padEnd(16)} SKIPPED (no putImageData)`); return; }
  const d = img.data, W = img.width, H = img.height;
  let nan = 0, min = 255, max = 0, distinct = new Set();
  for (let i = 0; i < d.length; i += 4){
    for (let k = 0; k < 4; k++){ const v = d[i+k]; if (Number.isNaN(v)) nan++; if (v < min) min = v; if (v > max) max = v; }
    if (i % 997 < 4) distinct.add(d[i] + ',' + d[i+1] + ',' + d[i+2] + ',' + d[i+3]);
  }
  /* longitude seam: column 0 vs column W-1 should be close, not a hard cliff */
  let seam = 0;
  for (let y = 0; y < H; y++){
    const a = (y*W)*4, b = (y*W + W-1)*4;
    seam = Math.max(seam, Math.abs(d[a]-d[b]), Math.abs(d[a+1]-d[b+1]), Math.abs(d[a+2]-d[b+2]), Math.abs(d[a+3]-d[b+3]));
  }
  const ok = nan === 0 && max > min + 20 && distinct.size > 12 && seam < 90;
  if (!ok) fail++;
  console.log(`${name.padEnd(16)} ${img.width}x${img.height} min=${min} max=${max} nan=${nan} colours=${distinct.size} seamΔ=${seam} ${ok ? 'OK' : 'FAIL'}`);
}

const t0 = performance.now();
const made = [];
for (const p of api.PLANETS){
  const f = { banded:api.texBanded, earth:api.texEarth, mars:api.texMars, ice:api.texIce, rocky:api.texRocky }[p.tex.type];
  const tx = f(p.tex); made.push([p.name, tx]);
  if (p.clouds) made.push([p.name + ' clouds', api.texClouds(p.clouds)]);
  if (p.ring)   made.push([p.name + ' rings',   api.texRing(p.ring)]);
  (p.moons || []).forEach(m => made.push([m.name, m.tex.type === 'ice' ? api.texIce(m.tex) : api.texRocky(m.tex)]));
}
made.push(['Sun', api.texSun(5)]);
made.push(['glow', api.texGlow('#ffcf7a', 0.5)]);
made.push(['select', api.texSelectRing()]);
made.push(['star', api.texStar()]);
const t1 = performance.now();
for (const [n, t] of made) inspect(n, t);

/* noise sanity + fAU monotonicity */
let lo = 1, hi = 0;
for (let i = 0; i < 4000; i++){ const v = api.fbm(Math.random(), Math.random(), 6, 5, 3, 2); lo = Math.min(lo, v); hi = Math.max(hi, v); }
console.log(`fbm range [${lo.toFixed(3)}, ${hi.toFixed(3)}] (expect within 0..1)`);
if (lo < 0 || hi > 1) fail++;
const rad = api.PLANETS.map(p => api.fAU(p.au));
const mono = rad.every((v, i) => i === 0 || v > rad[i-1]);
console.log('fAU monotonic:', mono, '| Mercury→Neptune scene radii:', rad.map(r => r.toFixed(1)).join(', '));
if (!mono) fail++;
console.log(`texture generation: ${(t1 - t0).toFixed(0)} ms in node`);
console.log(fail === 0 ? 'TEXTURE PASS' : `TEXTURE FAIL (${fail})`);
