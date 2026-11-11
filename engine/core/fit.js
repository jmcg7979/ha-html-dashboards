// Fill only when it fits. A page that fills the screen (fill: true, grow cards, row templates) squeezes its cards to the
// screen's height; on a short screen (a TV: 540 CSS px) that pushes content over the next card. So: while any squeezed
// box has content taller than itself, the page gets .nofill (css/base.css): natural heights, and it scrolls instead.
// It tries filling again every few seconds (in one task, so nothing flickers). Portrait screens never fill (stretched charts read badly).
// Watches each view / page: after it is built, on resize, and every few seconds while shown (data can grow a card).
const SQUEEZED = '.cell.grow, .sgrid.rows > .cell';

function spills(root) {
  for (const cell of root.querySelectorAll(SQUEEZED)) {
    if (cell.closest('[hidden]')) continue;
    for (const box of [cell, ...cell.querySelectorAll('*')]) {
      if (box.children.length === 0 || box.closest('svg, .camera, .cwall, .leaflet-container, .hrow')) continue;
      const s = getComputedStyle(box);
      if (/auto|scroll/.test(s.overflowY) || s.display === 'none' || s.display === 'contents') continue;   // contents: no box of its own
      const r = box.getBoundingClientRect(); if (!r.height) continue;
      let low = -Infinity;
      for (const k of box.children) { const ks = getComputedStyle(k); if (ks.position === 'absolute' || ks.position === 'fixed' || ks.display === 'none') continue; low = Math.max(low, k.getBoundingClientRect().bottom); }
      if (low - r.bottom > 8) return true;
    }
  }
  return false;
}

export function fitGuard(el) {
  const check = () => {
    if (!el.isConnected || el.hidden || el.closest('[hidden]')) return;
    if (innerHeight > innerWidth) { el.classList.add('nofill'); return; }
    if (!el.classList.contains('nofill')) { if (spills(el)) el.classList.add('nofill'); return; }
    // in natural heights: try filling again and keep it if nothing spills. Both happen in this one task, so the screen never
    // paints the attempt (no flicker); charts and meters shrink into the space when filling, so this is the real test.
    el.classList.remove('nofill'); if (spills(el)) el.classList.add('nofill');
  };
  requestAnimationFrame(() => requestAnimationFrame(check));
  [800, 2500].forEach((t) => setTimeout(check, t));
  addEventListener('resize', () => requestAnimationFrame(check));
  setInterval(() => { if (!document.hidden) check(); }, 3000);
  new MutationObserver(() => requestAnimationFrame(check)).observe(el, { attributes: true, attributeFilter: ['hidden'] });
}
