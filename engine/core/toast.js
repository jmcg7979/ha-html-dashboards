// What the user needs to know right now, without a dialog: a tap that didn't reach HA, and a screen that has lost HA.
//   initToast()      call once at start: reports failed service calls (core/ha.js)
//   toast('text', ms, kind) a message for a few seconds (ms: how long, default 5 s); the next toast replaces it.
//                    kind: 'busy' (a spinner: something is under way), 'ok' (a check), 'warn'; default: guessed from the text
//   hideToast()      take the current message away now
//   showOffline(on)  the bar saying the readings on screen are old, shown after a short grace so a quick reconnect stays quiet
import { h, icon } from './dom.js';
import { onCallFail } from './ha.js';
import { timeOpts } from './units.js';

const GRACE = 6000;
let box = null, hideT = 0, bar = null, barT = 0;

const WARN = /n[’']t|not |refused|couldn|failed|didn/i;
export function toast(text, ms = 5000, kind) {
  if (!box) { box = h('<div id="toast" role="alert" hidden><span class="tsi"></span><span class="tst"></span></div>'); document.body.appendChild(box); }
  kind = kind || (/…$/.test(text) ? 'busy' : WARN.test(text) ? 'warn' : 'ok');
  box.className = 't-' + kind;
  box.querySelector('.tsi').innerHTML = kind === 'busy' ? '<i class="tspin"></i>' : icon(kind === 'warn' ? 'alert-circle' : 'check-circle');
  box.querySelector('.tst').textContent = text;
  if (box.hidden) { box.hidden = false; box.style.animation = 'none'; void box.offsetWidth; box.style.animation = ''; }   // slide in when it appears, not on every update
  clearTimeout(hideT); hideT = setTimeout(() => { box.hidden = true; }, ms);
}

export function hideToast() { clearTimeout(hideT); if (box) box.hidden = true; }

export function showOffline(off) {
  if (!bar) { bar = h('<div id="offline" role="status" hidden></div>'); document.body.appendChild(bar); }
  if (!off) { clearTimeout(barT); barT = 0; bar.hidden = true; return; }
  if (barT || !bar.hidden) return;   // every failed reconnect lands here: keep the first time we lost HA
  const since = new Date().toLocaleTimeString([], timeOpts({ hour: 'numeric', minute: '2-digit' }));
  barT = setTimeout(() => { bar.textContent = `Not connected · readings from ${since}`; bar.hidden = false; }, GRACE);
}

export function initToast() {
  onCallFail((why) => toast(why === 'offline' ? 'Not connected. Nothing was sent.' : why === 'dropped' ? 'The connection dropped. That may not have been done.' : `Home Assistant refused that${why ? ': ' + why : ''}`));
}
