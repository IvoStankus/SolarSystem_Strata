/* _cdp.mjs - real browser validation.
   Drives headless Microsoft Edge through the Chrome DevTools Protocol with no
   extra npm dependencies (Node 22 has a global WebSocket + fetch).
   It loads index.html from file://, waits for the scene, runs interactions
   (label click -> camera focus, speed buttons, toggles, pause, resize),
   captures console output / uncaught exceptions, and writes screenshots.
   Run:  node _cdp.mjs
*/
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const url = 'file:///' + path.resolve('index.html').replace(/\\/g, '/');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));

const chrome = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--use-gl=angle', '--use-angle=swiftshader',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-background-networking', '--disable-sync', '--mute-audio',
  '--hide-scrollbars', '--window-size=1440,900',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${tmp}`, url
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---- find the page target ------------------------------------------ */
let target = null;
for (let i = 0; i < 60 && !target; i++){
  await sleep(500);
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const list = await res.json();
    target = list.find(t => t.type === 'page' && t.url.startsWith('file://'));
  } catch {}
}
if (!target){ console.error('NO TARGET - browser did not start'); chrome.kill(); process.exit(1); }

/* ---- tiny CDP client ------------------------------------------------ */
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let mid = 0;
const pending = new Map();
const events = [];
ws.onmessage = ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)){ pending.get(msg.id)(msg); pending.delete(msg.id); }
  else if (msg.method) events.push(msg);
};
const send = (method, params = {}) => new Promise(res => {
  const id = ++mid; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
});
const expr = async code => {
  const r = await send('Runtime.evaluate', { expression: code, returnByValue: true, awaitPromise: true });
  const res = r.result || {};
  if (res.exceptionDetails) return { ERROR: res.exceptionDetails.exception?.description || res.exceptionDetails.text };
  return res.result ? res.result.value : { ERROR: JSON.stringify(r).slice(0, 300) };
};

const consoleLines = [], exceptions = [];
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
for (const e of events){
  if (e.method === 'Runtime.exceptionThrown') exceptions.push(e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
}
ws.onmessage = ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)){ pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Log.entryAdded'){
    const e = msg.params.entry;
    if (e.level === 'error' || e.level === 'warning') consoleLines.push(`${e.level.toUpperCase()}: ${e.text}`);
  }
  if (msg.method === 'Runtime.exceptionThrown'){
    exceptions.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  }
};

/* ---- let it boot ---------------------------------------------------- */
await sleep(11000);

const boot = await expr(`(() => {
  const q = s => document.querySelector(s);
  const cv = q('canvas');
  return {
    loaderGone: q('#loader') ? q('#loader').className : 'missing',
    fatalShown: q('#fatal') ? q('#fatal').className : 'missing',
    canvas: cv ? { w: cv.width, h: cv.height } : null,
    labels: document.querySelectorAll('#labels div').length,
    chips: document.querySelectorAll('#body-list button').length,
    fps: q('#rd-fps')?.textContent, date: q('#rd-date')?.textContent,
    cam: q('#rd-cam')?.textContent, speed: q('#rd-speed')?.textContent,
    toggles: [...document.querySelectorAll('#panel input[type=checkbox]')].map(i => i.id + '=' + i.checked).join(' '),
    sliders: q('#speed') ? q('#speed').value : 'missing'
  };
})()`);
console.log('BOOT:', JSON.stringify(boot, null, 1));

const shot = async name => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (r.result?.data){ fs.writeFileSync(name, Buffer.from(r.result.data, 'base64')); console.log('wrote', name); }
  else console.log('screenshot failed', JSON.stringify(r.error));
};
await shot('_shot_wide.png');

/* ---- click the Jupiter label (label click focuses the camera) ------- */
const clicked = await expr(`(() => {
  const labs = [...document.querySelectorAll('#labels div')];
  const pick = labs.find(d => d.textContent.toLowerCase().startsWith('jupiter')) || labs[0];
  if (!pick) return 'no labels';
  const r = pick.getBoundingClientRect();
  pick.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, clientX:r.left+r.width/2, clientY:r.top+r.height/2 }));
  pick.dispatchEvent(new PointerEvent('pointerup',   { bubbles:true, clientX:r.left+r.width/2, clientY:r.top+r.height/2 }));
  pick.click();
  return pick.textContent;
})()`);
console.log('clicked label:', clicked);
await sleep(6000);

const sel = await expr(`(() => {
  const i = document.querySelector('#info');
  return { hidden: i.className, text: i.innerText.replace(/\\n+/g,' | ').slice(0, 420) };
})()`);
console.log('INFO PANEL:', JSON.stringify(sel, null, 1));
await shot('_shot_close.png');

/* ---- click on empty space (deselect), speed preset, toggles, pause -- */
await expr(`document.querySelector('#btn-reset')?.click(); 'reset'`);
await sleep(2500);
await expr(`[...document.querySelectorAll('[data-speed]')].find(b => b.dataset.speed === '10')?.click(); 'spd'`);
await sleep(3000);
const sp10 = await expr(`document.querySelector('#rd-speed').textContent`);
await expr(`['t-orbits','t-labels','t-moonorbits','t-belt','t-stars'].forEach(id => { const c = document.getElementById(id); c.checked = false; c.dispatchEvent(new Event('change')); }); 'off'`);
await sleep(2500);
await expr(`['t-orbits','t-labels','t-moonorbits','t-belt','t-stars'].forEach(id => { const c = document.getElementById(id); c.checked = true; c.dispatchEvent(new Event('change')); }); 'on'`);
await expr(`document.getElementById('btn-play').click(); 'pause'`);
await sleep(2500);
const paused = await expr(`(() => { const q = s => document.querySelector(s); return { speed: q('#rd-speed').textContent, date: q('#rd-date').textContent, play: q('#btn-play').textContent }; })()`);
console.log('after speed 10x then pause:', JSON.stringify(paused), '(speed readout was', sp10 + ')');

/* ---- keyboard shortcuts -------------------------------------------- */
await expr(`document.getElementById('btn-play').click(); 'play again'`);
await sleep(1500);
for (const key of ['ArrowUp', 'ArrowUp', 'ArrowDown', '6', 'Escape']){
  await expr(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)} })); '${key}'`);
  await sleep(900);
}
await sleep(2000);
await shot('_shot_neptune.png');

/* ---- resize -------------------------------------------------------- */
await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 620, deviceScaleFactor: 1, mobile: false });
await sleep(2500);
await shot('_shot_small.png');
const after = await expr(`(() => {
  const cv = document.querySelector('canvas');
  const labs = [...document.querySelectorAll('#labels div')].filter(d => d.style.display === 'block').length;
  return { canvas: { w: cv.width, h: cv.height }, visibleLabels: labs, fps: document.querySelector('#rd-fps').textContent };
})()`);
console.log('after resize 900x620:', JSON.stringify(after));

/* ---- report -------------------------------------------------------- */
const fatal = await expr(`(() => { const f = document.querySelector('#fatal'); return { cls: f.className, text: f.innerText.trim() }; })()`);
console.log('fatal panel:', JSON.stringify(fatal));
console.log('console warnings/errors:', consoleLines.length ? consoleLines.slice(0, 20) : 'none');
console.log('uncaught exceptions:', exceptions.length ? exceptions : 'none');

ws.close(); chrome.kill();
console.log('CDP RUN DONE');
process.exit(0);
