// @ts-check
// TV remote (D-pad) navigation for the `tv` profile. Every tappable thing on screen (or in the open pop-up) can take the
// highlight; the arrows move it to the nearest one in that direction, OK/Enter taps it. While a layer is open
// (core/layers.js) it is the whole world: the highlight stays in it, and returns to where it was when it closes.
// The parts, in core/remote/:
//   focus.js    what can take the highlight ([data-focus], [data-nofocus], [data-focus-first]) and putting it there, in view
//   move.js     the arrows ([data-subs], [data-enter]), with nearest.js: the nearest item in a direction, over rectangles
//   rail.js     the rail as its own column, and the preview of the page under the highlight
//   hold.js     OK: `dash:ok`, hold OK on [data-hold] (`dash:hold`), adjusting (`dash:adjust`, `dash:adjust-end`)
//   back.js     Back (tv:back from the launcher, or Escape / Backspace in a browser; [data-backto]) and Home (tv:home)
// This file wires them to the keys and to what the page says: a view shown, a layer opened or closed.
import { valid, opener, onPage, focus, first } from './remote/focus.js';
import { move } from './remote/move.js';
import { initRail, inPreview } from './remote/rail.js';
import { adjusting, adjust, endAdjust, okKey, okUp, launcherHold } from './remote/hold.js';
import { back, home } from './remote/back.js';

const DIR = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const BACK_KEYS = ['Escape', 'Backspace', 'GoBack', 'BrowserBack'];

let on = false;
export function initRemote() {
  if (on) return; on = true;
  document.documentElement.classList.add('remote');
  addEventListener('keydown', key, true);
  addEventListener('keyup', okUp, true);
  addEventListener('tv:back', back);
  addEventListener('tv:hold', launcherHold);
  addEventListener('tv:home', home);
  initRail();
  // another view opened by the page itself (not from the rail): the highlight goes to its content
  // (what had the highlight went with the view it was in. Not during a preview: that puts it back itself)
  addEventListener('dash:shown', (e) => { if (e.detail.changed && !inPreview() && !valid(document.activeElement)) first(); });
  addEventListener('tv:resume', () => { if (!valid(document.activeElement)) first(); });
  // a layer opens on its content (once its owner has had its say: the confirm dialog starts on Cancel, a chip's menu on
  // what is chosen); when it goes, the highlight is back where it was when it opened, else where it last was on the page
  // (a layer that slides in has nothing on screen to take it yet: tried again for half a second)
  const place = (from, tries) => {
    if (valid(document.activeElement)) return;
    const o = opener();
    if (valid(from)) focus(from); else if (onPage() && valid(o)) focus(o); else first();
    if (tries && !valid(document.activeElement)) setTimeout(() => place(from, tries - 1), 100);
  };
  // (changed: what had it is gone.) Layers that close together (a song's menu with the queue it is in) are one placing:
  // the opener of the first of them that is still on screen, which is the outermost one's.
  let closed = null;
  addEventListener('dash:layers', (e) => {
    if (!closed) { closed = []; queueMicrotask(() => { const from = closed.find(valid) || null; closed = null; place(from, 5); }); }
    if (e.detail.closed && e.detail.opener) closed.push(e.detail.opener);
  });
  // until something is on screen to focus, try again as the page builds
  let n = 0; const t = setInterval(() => { if (valid(document.activeElement) || ++n > 40) { clearInterval(t); return; } first(); }, 250);
}

function key(e) {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if ((tag === 'input' || tag === 'textarea' || tag === 'select') && !DIR[e.key]) return;
  const adj = adjusting();
  if (adj) {   // adjusting: the arrows change the value, OK / Back finish
    e.preventDefault(); e.stopPropagation();
    if (DIR[e.key]) { if (DIR[e.key][0]) adjust(adj, DIR[e.key][0]); return; }
    if (BACK_KEYS.includes(e.key)) endAdjust(adj);
    return;   // OK finishes on its key up (hold.js): the held press's own repeats and release don't
  }
  if (DIR[e.key]) { e.preventDefault(); e.stopPropagation(); move(DIR[e.key]); return; }
  if (e.key === 'Enter' || e.key === ' ') {
    const el = /** @type {HTMLElement | null} */ (document.activeElement);
    if (!valid(el)) { e.preventDefault(); first(); return; }
    okKey(e, el);
    return;
  }
  if (BACK_KEYS.includes(e.key)) { e.preventDefault(); back(); }
}
