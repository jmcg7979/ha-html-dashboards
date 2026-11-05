// What the user needs to know right now, without a dialog: a tap that didn't reach HA, and a screen that has lost HA.
//   initToast()      call once at start: reports failed service calls (core/ha.js)
//   toast('text')    a message for a few seconds
//   showOffline(on)  the bar saying the readings on screen are old, shown after a short grace so a quick reconnect stays quiet
import { h } from './dom.js';
import { onCallFail } from './ha.js';
import { timeOpts } from './units.js';

const GRACE = 6000;
let box = null, hideT = 0, bar = null, barT = 0;

export function toast(text) {
  if (!box) { box = h('<div id="toast" role="alert" hidden></div>'); document.body.appendChild(box); }
  box.textContent = text; box.hidden = false;
  clearTimeout(hideT); hideT = setTimeout(() => { box.hidden = true; }, 5000);
}

export function showOffline(off) {
  if (!bar) { bar = h('<div id="offline" role="status" hidden></div>'); document.body.appendChild(bar); }
  if (!off) { clearTimeout(barT); barT = 0; bar.hidden = true; return; }
  if (barT || !bar.hidden) return;   // every failed reconnect lands here: keep the first time we lost HA
  const since = new Date().toLocaleTimeString([], timeOpts({ hour: 'numeric', minute: '2-digit' }));
  barT = setTimeout(() => { bar.textContent = `Not connected · readings from ${since}`; bar.hidden = false; }, GRACE);
}

export function initToast() {
  onCallFail((why) => toast(why === 'offline' ? 'Not connected. Nothing was sent.' : `Home Assistant refused that${why ? ': ' + why : ''}`));
}
