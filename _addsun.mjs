import fs from 'fs';
const f = 'index.html';
let s = fs.readFileSync(f, 'utf8');
const map = {
  Earth:   "149.6 M km (1.00 AU)",
  Jupiter: "778.5 M km (5.20 AU)",
  Saturn:  "1,434 M km (9.55 AU)",
  Uranus:  "2,871 M km (19.2 AU)",
  Neptune: "4,495 M km (30.1 AU)",
};
let n = 0;
s = s.replace(/'Distance from (Earth|Jupiter|Saturn|Uranus|Neptune)':'([^']+)',/g,
  (m, p, v) => { n++; return `'Distance from ${p}':'${v}', 'Distance from Sun':'${map[p]}',`; });
fs.writeFileSync(f, s);
console.log('moon rows patched:', n);
