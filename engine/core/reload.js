// Reload the page once nobody is using it: the screen has been left alone for a minute and nothing is open
// (pop-up, alarm takeover, camera alert or full-screen camera, voice). Used after a deploy and when the Docker containers change.
let touched = Date.now(), waiting = false;
['pointerdown', 'keydown'].forEach((t) => window.addEventListener(t, () => { touched = Date.now(); }, true));
const busy = () => Date.now() - touched < 60000 || location.hash || document.documentElement.classList.contains('alarm-open') ||
  document.querySelector('.camalert:not([hidden]), .camera.full, .askwrap');
export function reloadWhenIdle(now = false) {
  if (waiting) return; waiting = true;
  const go = () => (!now && busy() ? setTimeout(go, 30000) : location.reload());
  go();
}
