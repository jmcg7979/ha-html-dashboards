// Reload the page once nobody is using it: the screen has been left alone for a minute and nothing is open
// (pop-up, alarm takeover, camera alert or full-screen camera, voice). Used after a deploy and when the Docker containers change.
let touched = Date.now(), waiting = false;
['pointerdown', 'keydown'].forEach((t) => window.addEventListener(t, () => { touched = Date.now(); }, true));
// coming back to the screen counts as use: a page resumed after hours would otherwise look idle and reload under your finger
document.addEventListener('visibilitychange', () => { if (!document.hidden) touched = Date.now(); });
export const usedSince = (t) => touched > t + 200;   // the resume itself sets `touched` too
const busy = () => Date.now() - touched < 60000 || location.hash || document.documentElement.classList.contains('alarm-open') ||
  document.querySelector('.camalert:not([hidden]), .camera.full, .askwrap');
// now = reload at once (the page has only just come back to the screen and nobody has touched it yet)
export function reloadWhenIdle(now = false) {
  if (now) { location.reload(); return; }
  if (waiting) return; waiting = true;
  const go = () => (!now && busy() ? setTimeout(go, 30000) : location.reload());
  go();
}
