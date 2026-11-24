// @ts-check
// The rail (#rail) under the remote. It is its own column: Up / Down stay in it, Right goes back into the page where you
// left it, and Left from the page's first column opens it on the page you are on. It is where the highlight lives on a
// TV (most pages are for looking at): Up / Down in it shows each page as you go (preview), OK or Right digs into the
// page. A page with sub-pages (Systems) opens its own menu in the rail on OK instead, and the highlight stays there.
import { candidates, visible, valid, focus } from './focus.js';

export const railItems = () => candidates().filter((el) => el.closest('#rail'));
export const railHome = () => { const r = railItems(); return r.find((el) => el.classList.contains('on')) || r[0]; };
let previewing = false, pt = 0;
export const inPreview = () => previewing;   // a preview is switching the page: the highlight stays on the rail item or tab

// the view on screen
export const viewShown = () => document.querySelector('#app > .pview:not([hidden]), #app > .view:not([hidden])');
// into the page shown: its sub-page tabs when it has them (on the one shown), else its first item
export function enterPage() {
  const view = viewShown();
  const tab = view && view.querySelector('.vtabs:not([hidden]) .ptab.on');
  return tab && visible(tab) ? tab : candidates().find((el) => el.closest('#app'));
}
// show the page of the rail item the highlight rests on (a quarter second, so running down the rail doesn't build every page);
// a page with sub-pages shows its first one without opening its menu (that takes OK)
export function preview(el) {
  clearTimeout(pt);
  pt = setTimeout(() => {
    if (document.activeElement !== el || el.classList.contains('on')) return;
    previewing = true;
    if (el.matches('.ptab')) el.click();   // a sub-page tab: the view switches its page itself
    else if (el.dataset.v) dispatchEvent(new CustomEvent('dash:view', { detail: el.dataset.v }));
    else { previewing = false; return; }
    setTimeout(() => {
      const rail = document.getElementById('rail');
      if (!el.closest('.rsub')) rail.classList.remove('drill');
      if (!valid(document.activeElement)) focus(el);   // the switch took the highlight's place away: back on the item (not when it has moved on meanwhile)
      previewing = false;
    }, 60);
  }, 250);
}
// OK on a rail item (a click the app answers): into the page it opened, into a paged view's own menu, or back on the
// main rail from that menu
export function initRail() {
  document.addEventListener('click', (e) => {
    const a = /** @type {Element} */ (e.target).closest('#rail a[data-v], #rail .rback'); if (!a) return;
    if (previewing) return;
    setTimeout(() => {
      const sub = document.querySelector('#rail.drill .rsub.open');
      if (sub && !a.closest('.rsub')) { const on = sub.querySelector('a.on') || sub.querySelector('a'); if (on) focus(on); return; }
      if (a.classList.contains('rback')) { const on = railHome(); if (on) focus(on); return; }
      const c = enterPage(); if (c) focus(c);
    }, 250);
  });
}
