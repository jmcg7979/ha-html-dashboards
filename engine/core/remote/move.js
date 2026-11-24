// @ts-check
// An arrow key: the highlight goes to the nearest item in that direction (nearest.js), with the rules that come first:
// the rail is its own column, an item's own buttons are reached with Right from it, tabs go along their row.
// A tile's own buttons (.sb) are reached with Right from the tile; Left from the first goes back to it. The same for any
// item marked [data-subs] (a row of the Playing card: OK on the row opens its player, its buttons are to its right).
// [data-enter="selector"] on a list: arrowing into it from outside lands on that item.
import { scope, onPage, visible, valid, candidates, shownFrom, newPress, opener, wasInRail, focus, first } from './focus.js';
import { railItems, railHome, enterPage, preview } from './rail.js';
import { nearest } from './nearest.js';

const HOST = '.tile, [data-subs]';   // an item with buttons of its own
const subsOf = (t) => [...t.querySelectorAll('.sb')].filter(visible);

/** @param {number[]} d the direction: [1, 0] right, [-1, 0] left, [0, 1] down, [0, -1] up */
export function move(d) {
  newPress();
  const cur = document.activeElement;
  if (!valid(cur)) { if (wasInRail() && onPage() && railHome()) focus(railHome()); else first(); return; }   // e.g. the rail swapped to a view's own menu
  if (cur.closest('#rail')) {
    if (d[0] > 0) { const o = opener(), back = valid(o) && o.closest('#app') ? o : enterPage(); if (back) focus(back); return; }
    if (d[0] < 0) return;
    const r = railItems(), n = r[r.indexOf(cur) + d[1]]; if (n) { focus(n); preview(n); }
    return;
  }
  // into an item's own buttons and back (the nearest-item search never picks something inside the item you are on)
  const host = cur.matches('.sb') ? cur.closest(HOST) : null;
  if (cur.matches(HOST) && d[0] > 0 && subsOf(cur).length) { focus(subsOf(cur)[0]); return; }
  if (host && d[0]) {
    const list = subsOf(host), n = list[list.indexOf(cur) + d[0]];
    if (n) { focus(n); return; }
    if (d[0] < 0) { focus(host); return; }
  }
  if (cur.matches('.vtabs .ptab') && d[0]) {
    const tabs = [...cur.parentElement.querySelectorAll('.ptab')].filter(visible), n = tabs[tabs.indexOf(cur) + d[0]];
    if (n) { focus(n); preview(n); } else if (d[0] < 0 && railHome()) focus(railHome());
    return;
  }
  const c = candidates().filter((el) => el !== cur && !el.closest('#rail') && shownFrom(el, cur));
  const i = nearest(cur.getBoundingClientRect(), c.map((el) => el.getBoundingClientRect()), d, (k) => !cur.contains(c[k]) && !c[k].contains(cur));
  let best = i < 0 ? null : c[i];
  if (best && best.matches('.vtabs .ptab') && !cur.closest('.vtabs')) best = best.parentElement.querySelector('.ptab.on') || best;   // up into the tabs: the one shown
  const ent = best && best.closest('[data-enter]');   // into a list from outside: its entry point (Up next: the next song), not whichever row is nearest
  if (ent && !ent.contains(cur)) { const f = ent.querySelector(ent.dataset.enter); if (f && visible(f)) best = f; }
  if (best) focus(best);
  else if (d[0] < 0 && onPage() && railHome()) focus(railHome());   // nothing further left: the rail
  else if (d[1]) (onPage() ? window : scope()).scrollBy({ top: d[1] * innerHeight * 0.6, behavior: 'smooth' });   // nothing above / below to select: scroll (charts at a page's foot)
}
