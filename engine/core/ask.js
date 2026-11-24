// A confirmation dialog for actions that are hard to undo (power off, restart). Resolves true on the action button, false on
// Cancel, a tap outside, Escape or the remote's Back (core/layers.js: it is the top layer, over a pop-up it was asked in). Built from the pop-up parts (pwrap / popup / phead / sb), so it matches the design language.
// ask({ title: 'Restart Frigate?', text: 'Recording pauses…', ok: 'Restart', icon: 'restart', tone: 'ember' }) -> Promise<boolean>
// Used by run() when an action has confirm: { ... } (confirm: true stays the quick tap-again check).
import { h, esc, icon } from './dom.js';
import { layer } from './layers.js';

let open = null;
export function ask({ title, text = '', ok = 'OK', icon: ic = 'alert-outline', tone = 'ember' } = {}) {
  if (open) open(false);
  return new Promise((resolve) => {
    const el = h(`<div class="pwrap askwrap"><div class="popup ask" role="alertdialog" aria-modal="true" style="--t:var(--${tone})">
      <div class="phead"><span class="ic">${icon(ic)}</span><div class="tx"><div class="name">${esc(title)}</div>${text ? `<div class="sub">${esc(text)}</div>` : ''}</div></div>
      <div class="askbtns"><button class="sb askno">Cancel</button><button class="sb askok">${icon(ic)}<span>${esc(ok)}</span></button></div></div></div>`);
    const L = layer({ el, kind: 'dialog', scope: el.querySelector('.popup'), close: () => done(false) });
    const done = (v) => { if (!el.isConnected) return; el.remove(); open = null; L.shut(); resolve(v); };
    el.addEventListener('click', (ev) => { ev.stopPropagation(); if (ev.target === el || ev.target.closest('.askno')) done(false); else if (ev.target.closest('.askok')) done(true); });
    document.body.appendChild(el); open = done; L.open();
    el.querySelector('.askno').focus({ preventScroll: true });   // the safe choice has focus
  });
}
