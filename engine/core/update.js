// @ts-check
// After a deploy (version.json changed), reload once the screen has been left alone (core/reload.js). A page coming back
// to the screen (a phone app reopened, a TV woken) checks at once: a new version then loads before anyone uses the page,
// instead of a few seconds into using it.
import { reloadWhenIdle, usedSince } from './reload.js';

const EVERY_MS = 5 * 60000;   // how often a page on screen asks
const FRESH_MS = 3000;        // a page back on screen this recently, and not touched since, reloads at once

export function autoUpdate() {
  let shown = 0;
  const check = (back) => fetch('version.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => {
    if (j && j.v && window.DASH_VERSION && j.v !== window.DASH_VERSION) reloadWhenIdle(back && Date.now() - shown < FRESH_MS && !usedSince(shown));
  }).catch(() => {});
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { shown = Date.now(); check(true); } });
  setInterval(check, EVERY_MS);
}
