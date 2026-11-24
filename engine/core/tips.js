// What a button that shows no words is called: one small label, the engine's own, placed beside the button (on <body>,
// so a card that crops what it holds can't cut it). A card does nothing but name its button: the words are the button's
// `aria-label`, which a screen reader says too. A button that shows words never gets one.
//   on a TV (the remote): once the highlight, moved there with an arrow, has rested WAIT on the button; it goes after
//     STAY, or with the next press. A highlight the page placed itself (a pop-up opening) names nothing
//   on a computer: while the mouse rests on the button, after the same wait; a press or a scroll takes it away
//   on touch: nothing (a held finger already means other things)
//   initTips()    once per page
//   wordless(el)  whether el shows no words: no letter or digit (an icon, a picture, a bare − or +)
//   unnamed()     for the checks: the icon buttons on screen that have no name (engine/_dev/tools/regress.mjs)
const BTN = 'button, a[href], [role="button"]';
const WAIT = 500, STAY = 4000, LOOK = 500;
let tip = null, anchor = null, byFocus = false, waitT = 0, stayT = 0, lookT = 0, over = null, arrowAt = -1e9;

export const wordless = (el) => !/[\p{L}\p{N}]/u.test(el.innerText || '');
const nameOf = (el) => (el.getAttribute('aria-label') || '').trim();
const shows = (el) => el.isConnected && !el.closest('[hidden]') && el.getClientRects().length > 0;
const button = (t) => { const b = t && t.closest ? t.closest(BTN) : null; return b && nameOf(b) ? b : null; };

// above the button, centered on it; under it when there is no room above; never off the screen's sides.
// The label's margin (base.css) is its distance from the button and from the screen's edge
function place() {
  const r = anchor.getBoundingClientRect(), m = parseFloat(getComputedStyle(tip).marginTop) || 0, w = tip.offsetWidth, hgt = tip.offsetHeight;
  const x = Math.max(m, Math.min(innerWidth - w - m, r.left + r.width / 2 - w / 2)), y = r.top - m - hgt >= m ? r.top - m - hgt : r.bottom + m;
  const at = `${Math.round(x - m)}px ${Math.round(y - m)}px`;
  if (tip.dataset.at !== at) { tip.dataset.at = at; tip.style.left = Math.round(x - m) + 'px'; tip.style.top = Math.round(y - m) + 'px'; }
}
// while it shows: gone with a button that left the screen or now shows words, renamed with it (a button that changes
// what it does), moved with it
function look() {
  const text = anchor ? nameOf(anchor) : '';
  if (!text || !shows(anchor) || !wordless(anchor)) return hide();
  if (tip.textContent !== text) tip.textContent = text;
  place();
}
function show(el, focus) {
  if (!shows(el) || !wordless(el)) return;
  if (!tip) { tip = document.createElement('div'); tip.id = 'tip'; tip.setAttribute('aria-hidden', 'true'); document.body.appendChild(tip); }
  anchor = el; tip.textContent = nameOf(el); tip.hidden = false; place();
  lookT = setInterval(look, LOOK);
  if (focus) stayT = setTimeout(hide, STAY);
}
function hide() {
  clearTimeout(waitT); clearTimeout(stayT); clearInterval(lookT);
  if (anchor) { anchor = null; tip.hidden = true; }
}
const rest = (el, ok, focus) => { hide(); byFocus = focus; waitT = setTimeout(() => { if (ok()) show(el, focus); }, WAIT); };

let started = false;
export function initTips() {
  if (started) return; started = true;
  const remote = () => document.documentElement.classList.contains('remote');
  // the remote: the highlight arrived with an arrow (core/remote.js moves it while the key is handled) and is still there
  addEventListener('keydown', (e) => { if ((e.key || '').startsWith('Arrow')) arrowAt = performance.now(); else hide(); }, true);
  document.addEventListener('focusin', (e) => {
    if (!remote()) return;
    const b = button(e.target), at = performance.now();
    if (b) rest(b, () => Math.abs(at - arrowAt) < 100 && document.activeElement === b, true); else hide();
  });
  document.addEventListener('focusout', () => { if (byFocus) hide(); });
  // the mouse: the same button until it leaves it (a press ends it for this visit)
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const b = button(e.target); if (b === over) return;
    over = b; if (b) rest(b, () => over === b, false); else if (!byFocus) hide();
  });
  document.addEventListener('pointerout', (e) => { if (e.pointerType === 'mouse' && !e.relatedTarget) { over = null; if (!byFocus) hide(); } });
  document.addEventListener('pointerdown', hide, true);
  // what it names may be covered or gone: a layer opened or closed, another view; a scroll moves a button under the
  // highlight (the label follows) or away from under the mouse
  addEventListener('dash:layers', hide); addEventListener('dash:shown', hide);
  addEventListener('scroll', () => { if (!anchor) return; if (byFocus) place(); else hide(); }, true);
}

// An icon button nobody named: no words, an icon in it, no aria-label. Not a tile's own icon (the tile says what it is)
// and not a picture (a cover, an app's banner: the picture is the name).
export function unnamed() {
  return [...document.querySelectorAll(BTN)].filter((el) => !nameOf(el) && shows(el) && !el.matches('.tile .ic') && el.querySelector('svg') && !el.querySelector('img') && wordless(el))
    .map((el) => { const c = el.closest('[class*="view-"], .popup, .cell'); return `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}${c ? ' in .' + [...c.classList].join('.') : ''}`; });
}
