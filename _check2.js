/* If the ES-module import above never ran (offline / blocked CDN) say so
   politely instead of showing a black page.                            */
setTimeout(() => {
  if (!window.__boot){
    const f = document.getElementById('fatal');
    if (f) f.classList.add('show');
    const l = document.getElementById('loader');
    if (l) l.classList.add('gone');
  }
}, 6000);
