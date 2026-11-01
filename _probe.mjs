/* _probe.mjs - minimal CDP evaluate probe */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9334;
const url = 'file:///' + path.resolve('index.html').replace(/\\/g, '/');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-p-'));
const chrome = spawn(EDGE, ['--headless=new', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  '--no-first-run', '--disable-extensions', '--window-size=1280,800',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${tmp}`, url], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let target = null;
for (let i = 0; i < 60 && !target; i++){
  await sleep(400);
  try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        target = l.find(t => t.type === 'page' && t.url.startsWith('file://')); } catch {}
}
console.log('target found:', !!target, target && target.url);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let mid = 0; const pending = new Map();
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)){ pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(res => { const id = ++mid; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });

await sleep(9000);
console.log('1+1 ->', JSON.stringify(await send('Runtime.evaluate', { expression: '1+1', returnByValue: true })));
console.log('dom  ->', JSON.stringify(await send('Runtime.evaluate', {
  expression: 'document.readyState + " | canvases=" + document.querySelectorAll("canvas").length + " | loader=" + document.querySelector("#loader").className + " | fatal=" + document.querySelector("#fatal").className',
  returnByValue: true }), null, 1));
console.log('obj  ->', JSON.stringify(await send('Runtime.evaluate', {
  expression: '({ fps: document.querySelector("#rd-fps").textContent, date: document.querySelector("#rd-date").textContent, cam: document.querySelector("#rd-cam").textContent, labels: document.querySelectorAll("#labels div").length, canvas: (c => c && [c.width, c.height])(document.querySelector("canvas")) })',
  returnByValue: true }), null, 1));
ws.close(); chrome.kill(); process.exit(0);
