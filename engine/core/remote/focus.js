// @ts-check
// The remote's highlight: what can take it, where it may go now, and putting it on an item with the item in view.
// What can be focused: buttons, links, and the card roots that take a tap (tile, camera, agenda row with details); a
// card marks anything else with [data-focus], [data-nofocus] opts out, [data-focus-first] marks the start item.
import { top } from '../layers.js';

const FOCUSABLE = 'button:not([disabled]), a[href], [data-focus], .tile:not(.ro), .camera, .aev.tap';
const SKIP = '.camera button, .tile .ic';   // a camera is one stop (OK = full screen), not its small overlay buttons; a tile is one stop (OK = what its icon does)

// the top layer is the whole world while it is open (core/layers.js); with none, the page: the rail is part of it (Left
// from the first column reaches it)
export const scope = () => { const t = top(); return t ? t.scope : document.querySelector('.shell'); };
export const onPage = () => !top();
export function visible(el) {
  if (!el.isConnected || el.closest('[hidden], [data-nofocus]')) return false;
  const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false;
  if ((r.right <= 0 || r.left >= innerWidth) && !el.closest('.hrow')) return false;   // off the screen sideways (a closed drawer); a sideways row scrolls to it
  const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none';
}
// An item in a scrolling list (a queue, an event list) that is scrolled out of the list's view only counts from inside that
// list (arrowing down it scrolls); from outside, it would be an invisible stop at the same height as the buttons beside it.
let scrollers = new WeakMap();   // per key press (newPress clears it): getComputedStyle up the tree for every candidate is slow on a TV
export const newPress = () => { scrollers = new WeakMap(); };
function scroller(el) {
  if (scrollers.has(el)) return scrollers.get(el);
  let found = null;
  for (let p = el.parentElement; p && !p.matches('.shell, body') && !found; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if (o === 'auto' || o === 'scroll') found = p; }
  scrollers.set(el, found); return found;
}
export function shownFrom(el, cur) {
  const sc = scroller(el); if (!sc || sc.contains(cur)) return true;
  const s = sc.getBoundingClientRect(), q = el.getBoundingClientRect();
  return q.bottom > s.top + 2 && q.top < s.bottom - 2;
}
export function candidates() {   // (the layer itself can be the one stop: a camera in full screen)
  const s = scope();
  return [s, ...s.querySelectorAll(FOCUSABLE)].filter((el) => el.matches(FOCUSABLE) && !el.matches(SKIP) && visible(el));
}
export function valid(el) { return el && el !== document.body && scope().contains(el) && el.matches(FOCUSABLE) && !el.matches(SKIP) && visible(el); }

let openerRef = null;   // the last item focused on the page itself, held weakly: its view may be unloaded meanwhile
export const opener = () => (openerRef && openerRef.deref()) || null;
let lastWasRail = false;
export const wasInRail = () => lastWasRail;   // the highlight was last put on a rail item

export function focus(el) {
  if (!el) return;
  if (!el.hasAttribute('tabindex') && !el.matches('button, a[href]')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
  lastWasRail = !!el.closest('#rail');
  if (onPage() && !lastWasRail) openerRef = new WeakRef(el);
  // keep the highlight away from the screen's edges, so the row below or above it shows too. The highlight is the item's,
  // or that of the box that draws it for the item ([data-ring-box]: a Rooms tile around its main button): that is what is
  // brought into view, whole
  el = el.closest('[data-ring-box]') || el;
  const r = el.getBoundingClientRect(), top = innerHeight * 0.15, bottom = innerHeight * 0.9;
  // a row that scrolls sideways (.hrow): keep the item in it, with the previous one peeking in when there is one
  const row = el.closest('.hrow');
  if (row) {
    const rr = row.getBoundingClientRect(), er = el.getBoundingClientRect(), peek = er.width * 0.35;
    if (er.left < rr.left) row.scrollBy({ left: er.left - rr.left - peek, behavior: 'smooth' });
    else if (er.right > rr.right) row.scrollBy({ left: er.right - rr.right + peek, behavior: 'smooth' });
  }
  if (el.closest('#rail')) return;   // the rail doesn't scroll
  // a list that scrolls inside its card (a queue): keep the item in it, with the next one showing
  const sc = scroller(el);
  if (sc && onPage()) {
    const sr = sc.getBoundingClientRect(), er = el.getBoundingClientRect(), pad = er.height * 0.6;
    if (er.top < sr.top) sc.scrollBy({ top: er.top - sr.top - pad, behavior: 'smooth' });
    else if (er.bottom > sr.bottom) sc.scrollBy({ top: er.bottom - sr.bottom + pad, behavior: 'smooth' });
    return;
  }
  if (!onPage()) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  else if (r.top < top) scrollBy({ top: r.top - top, behavior: 'smooth' });
  else if (r.bottom > bottom) scrollBy({ top: Math.min(r.top - top, r.bottom - bottom), behavior: 'smooth' });
}
export function first() {
  const c = candidates();
  let f = c.find((el) => el.matches('[data-focus-first]') && !el.closest('[hidden]')) || c.find((el) => el.closest('.pbody, .dbody')) || c.find((el) => el.closest('#app')) || c[0];
  if (f && f.matches('.vtabs .ptab')) f = f.parentElement.querySelector('.ptab.on') || f;   // a page with tabs: the one shown
  focus(f);   // in a pop-up or the drawer: its content, not the close button
}
