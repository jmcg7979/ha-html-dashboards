// @ts-check
// OK on the remote: a press, a hold, and adjusting.
// OK sends the item `dash:ok` first: a card that answers it (preventDefault) does its remote action instead of a click
// (a dimmer tile toggles: a tap on its body sets the brightness where you tap).
// Hold OK (half a second) on an item marked [data-hold] (a dimmer tile): it gets `dash:hold` and takes the arrows while it
// has .adjusting: Left / Right send `dash:adjust` (detail -1 / 1), OK or Back sends `dash:adjust-end`. A short press is OK.
// Held = the key down for half a second, a repeated key down, or `tv:hold` from the launcher (its WebView drops repeats).
const HOLD_MS = 500;      // OK down this long on a [data-hold] item is a hold
const RELEASE_MS = 80;    // after OK's key up, how long the launcher's tv:hold may still follow before it counts as a short press

// the item being adjusted, if any
export const adjusting = () => { const el = document.activeElement; return el && el.classList && el.classList.contains('adjusting') ? el : null; };
export const adjust = (el, step) => el.dispatchEvent(new CustomEvent('dash:adjust', { detail: step }));
export const endAdjust = (el) => el.dispatchEvent(new CustomEvent('dash:adjust-end'));

let holdT = 0, holdEl = null;        // the hold that is pending: its timer and its item
let okDown = false, heldPress = false;   // OK is down; the OK that started adjusting is still down (its release doesn't end it)

function ok(el) {   // OK on an item: its own remote action if it has one (dash:ok answered), else a tap
  const ev = new CustomEvent('dash:ok', { cancelable: true });
  el.dispatchEvent(ev);
  if (!ev.defaultPrevented) el.click();
}
function hold(el) { clearTimeout(holdT); holdT = 0; heldPress = okDown; el.dispatchEvent(new CustomEvent('dash:hold')); }

// OK's key down on the item that has the highlight
/**
 * @param {KeyboardEvent} e
 * @param {HTMLElement} el
 */
export function okKey(e, el) {
  if (!e.repeat) okDown = true;
  if (e.repeat) {   // held: the first press decides; an item waiting for a hold gets it now (the TV repeats a held key)
    e.preventDefault();
    if (holdT && el === holdEl) hold(el);
    return;
  }
  if (el.matches('[data-hold]')) {   // short press = OK (on key up), held = adjust
    e.preventDefault(); clearTimeout(holdT); holdEl = el;
    holdT = setTimeout(() => { holdT = 0; if (document.activeElement === el) hold(el); }, HOLD_MS);
    return;
  }
  if (el.matches('button, a[href]')) { const o = new CustomEvent('dash:ok', { cancelable: true }); el.dispatchEvent(o); if (o.defaultPrevented) e.preventDefault(); return; }   // else the browser clicks it itself
  e.preventDefault(); ok(el);
}
// OK's key up: ends adjusting (not the release of the press that started it), or makes a pending hold a short press
/** @param {KeyboardEvent} e */
export function okUp(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  okDown = false;
  const adj = adjusting();
  if (adj) { e.preventDefault(); if (heldPress) heldPress = false; else endAdjust(adj); return; }
  if (!holdT) return;
  e.preventDefault();
  const el = holdEl;   // a short press, unless the launcher's tv:hold is just behind this key up
  setTimeout(() => { if (!holdT || holdEl !== el) return; clearTimeout(holdT); holdT = 0; if (document.activeElement === el) ok(el); }, RELEASE_MS);
}
// the launcher says OK is held (tv:hold)
export function launcherHold() { if (holdT && document.activeElement === holdEl) hold(holdEl); }
