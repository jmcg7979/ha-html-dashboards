// @ts-check
// Touch gestures the shell's sheets share.

// Drag a bottom sheet down to close it (only when its content is scrolled to the top). Used by the More sheet and pop-ups.
/**
 * @param {HTMLElement} panel the sheet
 * @param {() => void} onClose
 */
export function swipeToClose(panel, onClose) {
  let y0 = null, dy = 0;
  panel.addEventListener('touchstart', (e) => {
    // any scroll box between the finger and the sheet that isn't at its top owns the gesture (not just .pbody)
    const at = /** @type {HTMLElement} */ (e.target);
    for (let n = at; n && n !== panel; n = n.parentElement) {
      if (n.scrollTop > 0 && n.scrollHeight > n.clientHeight && /auto|scroll/.test(getComputedStyle(n).overflowY)) { y0 = null; return; }
    }
    if (at.closest('input, .slider, .tslider, .mvbar, .mbar, .leaflet-container, .dial, svg, canvas, video, .ptabs')) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  panel.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    panel.style.transition = 'none'; panel.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  panel.addEventListener('touchcancel', () => { if (y0 == null) return; panel.style.transition = 'transform .2s ease-out'; panel.style.transform = ''; y0 = null; });
  panel.addEventListener('touchend', () => {
    if (y0 == null) return;
    panel.style.transition = 'transform .2s ease-out';
    if (dy > 90) { panel.style.transform = 'translateY(100%)'; setTimeout(() => { panel.style.transform = ''; panel.style.transition = ''; onClose(); }, 180); }
    else panel.style.transform = '';
    y0 = null;
  });
}
