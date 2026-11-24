// @ts-check
// Back and Home on the remote.
//   Back  goes up one level, never repeats or undoes anything: the top layer closes (core/layers.js: a ringing timer
//         stops, then the confirm dialog, a camera alert, then a menu, a full-screen camera, the pop-up or the drawer,
//         whichever opened last), else from a page's content to its tabs (when it has them), from there to its icon in
//         the rail, from the rail to Home; on Home, to the top. A view with back: 'home' (Now playing) goes there.
//         [data-backto="selector"] on a list: Back from inside it goes to the nearest match (the switch that picked the
//         panel), however far the list is scrolled.
//   Home  closes every layer but a take-over and goes back to the top of the first view.
import { layers, back as closeTop, closeAll } from '../layers.js';
import { close as closePopup } from '../popup.js';
import { scope, visible, focus, first } from './focus.js';
import { railItems, railHome, viewShown } from './rail.js';
import { adjusting, endAdjust } from './hold.js';

const SHOWN_MS = 2000;   // how long Back / Home wait for the view they asked for
const goTo = (view) => dispatchEvent(new CustomEvent('dash:view', { detail: view }));
// once the view asked for is on screen (the router says so; SHOWN_MS at most for a view that never arrives)
function onceShown(fn) {
  let t = 0;
  const run = () => { clearTimeout(t); removeEventListener('dash:shown', run); fn(); };
  addEventListener('dash:shown', run); t = setTimeout(run, SHOWN_MS);
}
const toTop = () => onceShown(() => { scrollTo({ top: 0 }); first(); });

export function back() {
  const adj = adjusting(); if (adj) { endAdjust(adj); return; }   // the launcher's Back while adjusting
  // in a list that names where Back goes (its tabs): there, before the pop-up it sits in closes; a take-over (one in the
  // corner too) or a menu on top comes first
  const over = layers()[0], busy = over && (over.kind === 'takeover' || over.kind === 'menu');
  const bt = !busy && document.activeElement && document.activeElement.closest('[data-backto]');
  let to = null; for (let p = bt && bt.parentElement; p && !to; p = p.parentElement) to = p.querySelector(bt.getAttribute('data-backto'));   // the nearest match up the tree
  if (to && visible(to) && scope().contains(to)) { focus(to); return; }
  if (closeTop()) return;
  if (location.hash.length > 1) { closePopup(); return; }   // a pop-up that is still loading: it stays away
  const v = document.querySelector('#app > [data-back]:not([hidden])');   // a view with back: 'home' (core/router.js)
  if (v) { goTo(v.getAttribute('data-back')); return; }
  const cur = document.activeElement, view = viewShown();
  const onHome = !!railItems()[0] && railItems()[0].classList.contains('on');   // the first rail item is Home
  const tab = view && view.querySelector('.vtabs:not([hidden]) .ptab.on');
  if (cur && cur.closest('#app') && !cur.closest('.vtabs') && tab && visible(tab)) { focus(tab); return; }   // content -> its tabs
  if (cur && cur.closest('#app') && !onHome && railHome()) { focus(railHome()); return; }                    // the page -> its icon in the rail
  if (cur && cur.closest('#rail') && !onHome) { toTop(); goTo(''); return; }                                 // the rail -> Home
  scrollTo({ top: 0, behavior: 'smooth' }); first();   // Home: back to the top
}
// Home: every layer but a take-over closes (that is what the home screen should show), then the first view, at the top
export function home() { closeAll((l) => l.kind === 'takeover'); if (location.hash.length > 1) closePopup(); toTop(); goTo(''); }
