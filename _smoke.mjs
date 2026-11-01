/* Full-module smoke test: runs the app's ES module in Node with the real
   three.js core but stubbed renderer / controls / composer / DOM, then
   drives hundreds of animation frames plus every UI control.            */
import fs from 'node:fs';
import * as RealTHREE from './_three.mjs';

const html = fs.readFileSync('index.html', 'utf8');
const mStart = html.indexOf('<script type="module">');
const mBody = html.indexOf('\n', mStart) + 1;
const mEnd = html.indexOf('</script>', mStart);
let src = html.slice(mBody, mEnd).replace(/^import .*$/gm, '');
src += `\n;globalThis.__T = { THREE, entries, planetEntries, moonEntries, shortcuts, belt, camera, controls, scene,
  renderer, composer, bloom, sunEntry, focusOn, setSelected, resetView, setSpeed, setPaused, applyQuality, showInfo,
  get simDays(){ return simDays; }, get speed(){ return speed; }, get paused(){ return paused; },
  get useBloom(){ return useBloom; }, get labelsOn(){ return labelsOn; }, get keplerTrue(){ return keplerTrue; } };\n`;

/* ---------------- DOM stubs ---------------- */
const els = new Map();
const created = { buttons: [], divs: [], canvases: [] };
class Ctx {
  constructor(cv){ this.c = cv; }
  createImageData(w, h){ return { width:w, height:h, data:new Uint8ClampedArray(w*h*4) }; }
  putImageData(i){ this.c.__img = i; }
  createRadialGradient(){ return { addColorStop(){} }; }
  createLinearGradient(){ return { addColorStop(){} }; }
  fillRect(){} beginPath(){} arc(){} fill(){} stroke(){} moveTo(){} lineTo(){} save(){} restore(){} translate(){} scale(){}
  set fillStyle(v){} set strokeStyle(v){} set lineWidth(v){} set lineCap(v){}
}
function makeEl(tag, id){
  const el = {
    tag, id, children: [], style: {}, dataset: {}, handlers: {}, _cls: new Set(),
    innerHTML: '', textContent: '', value: '1', checked: true, title: '', tagName: tag.toUpperCase(),
    classList: {
      add: c => el._cls.add(c), remove: c => el._cls.delete(c), contains: c => el._cls.has(c),
      toggle: (c, f) => { if (f === undefined) el._cls.has(c) ? el._cls.delete(c) : el._cls.add(c);
                          else f ? el._cls.add(c) : el._cls.delete(c); }
    },
    addEventListener(t, f){ (el.handlers[t] ||= []).push(f); },
    removeEventListener(){}, appendChild(c){ el.children.push(c); return c; },
    querySelectorAll: sel => (el.__qsa ? el.__qsa(sel) : []),
    querySelector: () => makeEl('button'),
    getBoundingClientRect: () => ({ left:0, top:0, width:0, height:0 })
  };
  if (tag === 'canvas'){
    el.width = 0; el.height = 0;
    el.getContext = () => (el.__ctx ||= new Ctx(el));
  }
  return el;
}
globalThis.document = {
  createElement: t => { const e = makeEl(t); if (t === 'button') created.buttons.push(e); if (t === 'div') created.divs.push(e); return e; },
  getElementById: id => { if (!els.has(id)) els.set(id, makeEl(id === 'q' || id === 'speed' ? 'input' : 'div', id)); return els.get(id); },
  querySelectorAll: sel => {
    const m = /\[data-speed="?([0-9.]+)"?\]/.exec(sel);
    if (sel === '[data-speed]' || m){
      return [...html.matchAll(/data-speed="([0-9.]+)"/g)].map(x => { const b = makeEl('button'); b.dataset.speed = x[1]; return b; });
    }
    return [];
  },
  addEventListener(){}, body: makeEl('body')
};
globalThis.window = globalThis;
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 1440; globalThis.innerHeight = 900;
const globalHandlers = {};
globalThis.addEventListener = (t, f) => { (globalHandlers[t] ||= []).push(f); };
globalThis.dispatch = (t, ev) => (globalHandlers[t] || []).forEach(f => f(ev));

/* frame pump: the app calls requestAnimationFrame(animate) */
let frameQueue = [];
globalThis.requestAnimationFrame = fn => { frameQueue.push(fn); return frameQueue.length; };

/* controllable clock: three's Clock reads performance.now() each call */
const realPerf = globalThis.performance;
let perfOffset = 0;
const PERF_T0 = realPerf.now();
globalThis.performance = { timeOrigin: realPerf.timeOrigin, now: () => PERF_T0 + (perfOffset += 0) + 0, mark(){}, measure(){} };
let vnow = PERF_T0;
globalThis.performance.now = () => vnow;

/* ---------------- three.js core + stubbed GL layer ---------------- */
class RendererStub {
  constructor(){ this.domElement = makeEl('canvas'); this.shadowMap = { enabled:false, type:0 };
                 this.capabilities = { getMaxAnisotropy: () => 8 }; this.toneMapping = 0; this.outputColorSpace = 'srgb';
                 this.renders = 0; }
  setPixelRatio(p){ this.pr = p; } setSize(w,h){ this.w = w; this.h = h; }
  render(scene, camera){ scene.updateMatrixWorld(true); camera.updateMatrixWorld(true); this.renders++; }
  dispose(){}
}
class ControlsStub {
  constructor(camera, dom){ this.object = camera; this.domElement = dom; this.target = new RealTHREE.Vector3(); this.updates = 0; }
  update(){ this.updates++; } dispose(){}
}
class PassStub { constructor(){ this.enabled = true; } setSize(){} dispose(){} }
class ComposerStub {
  constructor(renderer){ this.renderer = renderer; this.passes = []; this.renders = 0; }
  addPass(p){ this.passes.push(p); } setSize(){} setPixelRatio(){}
  render(){ this.renderer.sceneUpdate++; this.renders++; }
  renderWithScene(scene){ scene.updateMatrixWorld(true); }
}
class BloomStub extends PassStub {
  constructor(res, s, r, t){ super(); this.resolution = res; this.strength = s; this.radius = r; this.threshold = t; }
}
const THREE = { ...RealTHREE, WebGLRenderer: RendererStub };

const fire = (el, type, ev = {}) => (el.handlers[type] || []).forEach(f =>
  f({ target: el, type, preventDefault(){}, stopPropagation(){}, ...ev }));

/* ---------------- run the module ---------------- */
const fn = new Function('THREE', 'OrbitControls', 'EffectComposer', 'RenderPass', 'UnrealBloomPass', 'OutputPass', src);
const t0 = Date.now();
fn(THREE, ControlsStub, ComposerStub, PassStub, BloomStub, PassStub);
const T = globalThis.__T;
const buildMs = Date.now() - t0;

let problems = [];
const finiteVec = v => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
function step(n, label){
  for (let i = 0; i < n; i++){
    vnow += 16.667;
    const q = frameQueue; frameQueue = [];
    for (const f of q){ try { f(vnow); } catch (e){ problems.push(`${label}: ${e.message}\n${e.stack.split('\n')[1]}`); frameQueue = q; return; } }
  }
}

console.log(`module booted in ${buildMs.toFixed(0)} ms`);
console.log(`pickable bodies: ${T.entries.length} (expect 20) | planets ${T.planetEntries.length} | moons ${T.moonEntries.length} | belt instances ${T.belt.count}`);
if (T.entries.length !== 20) problems.push('wrong entry count ' + T.entries.length + ': ' + T.entries.map(e => e.data.name).join(','));
if (T.belt.count !== 1500) problems.push('belt count ' + T.belt.count);

/* every body must carry the info-card fields the brief asks for */
for (const e of T.entries){
  const f = e.data.facts || {}, keys = Object.keys(f);
  const has = re => keys.some(k => re.test(k));
  if (!has(/Diameter/i))       problems.push(`${e.data.name}: no Diameter`);
  if (!has(/Distance from/i))  problems.push(`${e.data.name}: no Distance`);
  if (!has(/Orbital period|Rotation|Revolution/i)) problems.push(`${e.data.name}: no period`);
  if (!e.data.fun || e.data.fun.length < 40) problems.push(`${e.data.name}: weak fun fact`);
  if (keys.some(k => !String(f[k]).trim())) problems.push(`${e.data.name}: empty fact`);
  if (!e.data.kind) problems.push(`${e.data.name}: no kind`);
  if (!e.data.color || !/^#[0-9a-f]{3,8}$/i.test(e.data.color)) problems.push(`${e.data.name}: bad colour`);
  if (!(e.data.radius > 0)) problems.push(`${e.data.name}: bad radius`);
}

/* simulated-time rate at 1x should be ~4 sim days per real second */
step(600, 'rate');
const rateErr = Math.abs(T.simDays - 40);
console.log(`time rate: ${T.simDays.toFixed(2)} sim days after 10 s @1x (expect ~40, deviation ${rateErr.toFixed(2)})`);
if (rateErr > 1) problems.push('sim day rate off: ' + T.simDays);

/* --- physics sanity over 600 frames at 1x --- */
const pos0 = new Map(T.entries.map(e => [e.data.name, e.anchor.getWorldPosition(new RealTHREE.Vector3())]));
step(600, 'run1x');
const pos1 = new Map(T.entries.map(e => [e.data.name, e.anchor.getWorldPosition(new RealTHREE.Vector3())]));
let bad = 0, moved = 0;
for (const e of T.entries){
  const a = pos0.get(e.data.name), b = pos1.get(e.data.name);
  if (!finiteVec(b)) { problems.push(`${e.data.name} position NaN`); bad++; }
  if (a.distanceTo(b) > 1e-4) moved++;
}
console.log(`1200 frames @1x: bodies that moved = ${moved}/${T.entries.length} (Sun is static), simDays = ${T.simDays.toFixed(1)}, renders = ${T.renderer.renders + T.composer.renders}`);
if (moved !== T.entries.length - 1) problems.push('some bodies did not move: ' + moved);

/* eccentricity: Mercury's star-to-planet distance must vary ~12 % */
const merc = T.planetEntries.find(e => e.data.name === 'Mercury');
let dmin = 1e9, dmax = -1e9;
for (let i = 0; i < 500; i++){ step(1, 'ecc'); const d = merc.anchor.getWorldPosition(new RealTHREE.Vector3()).length(); dmin = Math.min(dmin, d); dmax = Math.max(dmax, d); }
console.log(`Mercury scene radius range ${dmin.toFixed(2)} .. ${dmax.toFixed(2)} (ratio ${(dmax/dmin).toFixed(3)}, expect 1.06..1.30)`);
if (!(dmax / dmin > 1.06 && dmax / dmin < 1.31)) problems.push('Mercury eccentric orbit wrong: ' + (dmax/dmin));

/* moons stay on their shell + tidally locked rotation */
let moonErr = 0;
for (const m of T.moonEntries){
  const p = m.parent.anchor.getWorldPosition(new RealTHREE.Vector3());
  const q = m.anchor.getWorldPosition(new RealTHREE.Vector3());
  moonErr = Math.max(moonErr, Math.abs(q.distanceTo(p) - m.data.dist));
}
if (moonErr > 1e-3) problems.push('moon shell error ' + moonErr);
console.log('max moon shell error:', moonErr.toExponential(1));

/* belt matrices finite */
const mat = T.belt.mesh.instanceMatrix.array;
if (mat.some(v => !Number.isFinite(v))) problems.push('NaN in belt instance matrices');

/* --- UI: toggles, quality, speed, kepler --- */
const ids = ['t-orbits', 't-moonorbits', 't-labels', 't-belt', 't-stars', 't-bloom', 't-kepler'];
for (const id of ids){
  const el = document.getElementById(id);
  el.checked = false; fire(el, 'change'); step(20, id + '-off');
  el.checked = true;  fire(el, 'change'); step(20, id + '-on');
}
const q = document.getElementById('q');
for (const v of ['0', '2', '1']){ q.value = v; fire(q, 'change'); step(10, 'quality' + v); }
console.log(`quality: bloom=${T.useBloom} labels=${T.labelsOn} kepler=${T.keplerTrue}`);
for (const b of (els.get('body-list') ? [] : [])) void b;

/* speed buttons live in the static HTML, so emulate their handlers directly through the exposed API */
for (const v of [0, 0.5, 1, 5, 10, 20, 3.7]){ T.setSpeed(v); step(30, 'speed' + v); }
T.setPaused(true); step(30, 'paused');
const sdPaused = T.simDays; step(30, 'paused2');
if (Math.abs(T.simDays - sdPaused) > 1e-9) problems.push('time advanced while paused');
T.setPaused(false); T.setSpeed(1);

/* kepler mode then compare Mercury vs Neptune angular travel */
const tk = document.getElementById('t-kepler'); tk.checked = true; fire(tk, 'change');
const ang = e => { const p = e.anchor.getWorldPosition(new RealTHREE.Vector3()); return Math.atan2(p.z, p.x); };
const m0 = ang(merc), nep0 = ang(T.planetEntries.find(e => e.data.name === 'Neptune'));
step(600, 'kepler');
const dMer = Math.abs(ang(merc) - m0), dNep = Math.abs(ang(T.planetEntries.find(e => e.data.name === 'Neptune')) - nep0);
console.log(`kepler 600 frames: Mercury swept ${dMer.toFixed(2)} rad, Neptune ${dNep.toFixed(3)} rad`);
if (!(dMer > dNep * 4)) problems.push('kepler relative speeds wrong');
tk.checked = false; fire(tk, 'change'); step(60, 'kepler-off');

/* --- focus / follow / picking --- */
for (const en of T.shortcuts){
  T.focusOn(en); step(45, 'focus-' + en.data.name);
  if (!finiteVec(T.camera.position) || !finiteVec(T.controls.target)) problems.push('camera NaN focusing ' + en.data.name);
  const d = T.camera.position.distanceTo(en.anchor.getWorldPosition(new RealTHREE.Vector3()));
  if (!(d > 0.2 && d < 1e4)) problems.push(`camera distance ${d} for ${en.data.name}`);
}
/* follow a planet for 300 frames - camera must ride along, target must track */
const nept = T.shortcuts.find(e => e.data.name === 'Neptune');
T.focusOn(nept); step(150, 'nept-focus');          // 1.25 s tween, so let it finish
let trackErr = 0;
for (let i = 0; i < 300; i++){ step(1, 'nept-follow'); trackErr = Math.max(trackErr, T.controls.target.distanceTo(nept.anchor.getWorldPosition(new RealTHREE.Vector3()))); }
console.log('follow Neptune: max target error', trackErr.toFixed(3));
if (trackErr > 0.5) problems.push('camera does not follow body: ' + trackErr);

/* click picking: project Jupiter to screen coords and fire pointer events */
const jup = T.shortcuts.find(e => e.data.name === 'Jupiter');
T.focusOn(jup); step(60, 'jup');
const v = jup.anchor.getWorldPosition(new RealTHREE.Vector3()).project(T.camera);
const cx = (v.x * 0.5 + 0.5) * innerWidth, cy = (-v.y * 0.5 + 0.5) * innerHeight;
const dom = T.renderer.domElement;
fire(dom, 'pointerdown', { clientX: cx, clientY: cy });
fire(dom, 'pointerup',   { clientX: cx + 1, clientY: cy });
step(10, 'click');
console.log('clicked Jupiter -> selected:', T.entries.find(e => e.labelEl.classList.contains('sel'))?.data.name || 'NOTHING');

/* keyboard */
for (const key of [' ', 'ArrowUp', 'ArrowDown', '0', '3', '8', 'r', 'Escape']){
  globalThis.dispatch('keydown', { key, target: { tagName:'BODY' }, preventDefault(){} });
  step(15, 'key-' + key);
}
T.resetView(); step(90, 'reset');
if (!finiteVec(T.camera.position)) problems.push('camera NaN after reset');

/* body chips created in the sidebar */
const chips = created.buttons.filter(b => b.innerHTML.includes('<i'));
for (const c of chips.slice(0, 4)){ fire(c, 'click'); step(20, 'chip'); }
console.log(`sidebar chips: ${chips.length}, labels: ${created.divs.length}`);
if (chips.length !== 9) problems.push('chip count ' + chips.length);
if (created.divs.length !== T.entries.length) problems.push('label count ' + created.divs.length);

/* label projection sanity */
let labelShown = 0, labelNaN = 0;
for (const e of T.entries){
  const d = e.labelEl.style.display;
  if (d === 'block') labelShown++;
  if (d === 'block' && (!Number.isFinite(parseFloat(e.labelEl.style.left)) || !Number.isFinite(parseFloat(e.labelEl.style.top)))) labelNaN++;
}
console.log(`labels visible: ${labelShown}, NaN positions: ${labelNaN}`);
if (labelNaN) problems.push('label NaN ' + labelNaN);

/* info panel: every body renders the required rows */
const infoEl2 = document.getElementById('info');
let infoOk = 0;
for (const e of T.entries){
  T.showInfo(e);
  const h = infoEl2.innerHTML || '';
  const need = /Diameter/.test(h) && /Distance from/.test(h) && /(Orbital period|Rotation)/.test(h) && /Fun fact/.test(h);
  if (need) infoOk++; else problems.push('info card incomplete for ' + e.data.name);
}
console.log(`info cards complete: ${infoOk}/${T.entries.length}`);
T.showInfo(null);
if (!infoEl2.classList.contains('hidden')) problems.push('info panel did not hide on deselect');

/* resize */
innerWidth = 800; innerHeight = 600; globalThis.dispatch('resize', {}); step(20, 'resize');

console.log(`\ntotals: renderer.render ${T.renderer.renders}, composer.render ${T.composer.renders}, controls.update ${T.controls.updates}`);
console.log(problems.length ? 'SMOKE FAIL:\n - ' + problems.join('\n - ') : 'SMOKE PASS');
