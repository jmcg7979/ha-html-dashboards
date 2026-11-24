// Unloading views and pop-ups: everything a card hooks up while it is built is recorded, so it can all be undone when
// the view (or pop-up) is unloaded (core/router.js, core/popup.js). capture(fn) runs fn (building cards) and records, while it runs:
//   watch() / tick()                    (core/store.js asks current())
//   setInterval, window / document addEventListener, ResizeObserver / IntersectionObserver / MutationObserver
//   onDispose(fn)                       a card's own cleanup (a camera stopping its streams, an MA queue subscription)
// It returns { value, dispose }. Only what runs synchronously inside fn is caught: a card that hooks something up later
// (after a fetch) must check el.isConnected itself or call onDispose while it is being built.
let cur = null, depth = 0;
const REAL = { si: window.setInterval, wa: window.addEventListener, da: document.addEventListener,
  obs: ['ResizeObserver', 'IntersectionObserver', 'MutationObserver'].filter((k) => window[k]).map((k) => [k, window[k]]) };
export const current = () => cur;
// shared things a card starts the first time it is used (a forecast poller, a key read) must outlive the card: run them outside
export function outside(fn) {
  if (!cur && !depth) { shared++; try { return fn(); } finally { shared--; } }
  const W = window, D = document, was = { si: W.setInterval, wa: W.addEventListener, da: D.addEventListener, obs: REAL.obs.map(([k]) => [k, W[k]]) }, c = cur;
  W.setInterval = REAL.si; W.addEventListener = REAL.wa; D.addEventListener = REAL.da; REAL.obs.forEach(([k, C]) => { W[k] = C; }); cur = null;
  shared++;
  try { return fn(); } finally { shared--; W.setInterval = was.si; W.addEventListener = was.wa; D.addEventListener = was.da; was.obs.forEach(([k, C]) => { W[k] = C; }); cur = c; }
}
// Outside a capture there is nobody to undo it: fine for what is meant to live as long as the page (outside(), a module's own
// start-up), a leak when a card calls it after it was built (after a fetch, in a click). dropped() counts those for the checks.
let lost = 0, shared = 0;
export const dropped = () => lost;
export function onDispose(fn) { if (cur) cur.push(fn); else if (!shared) lost++; }

export function capture(fn) {
  const list = [], prev = cur, W = window, D = document;
  const si = W.setInterval, wa = W.addEventListener, da = D.addEventListener;
  const obs = ['ResizeObserver', 'IntersectionObserver', 'MutationObserver'].filter((k) => W[k]).map((k) => [k, W[k]]);
  W.setInterval = function (...a) { const id = si.apply(W, a); list.push(() => clearInterval(id)); return id; };
  W.addEventListener = function (t, f, o) { wa.call(W, t, f, o); list.push(() => W.removeEventListener(t, f, o)); };
  D.addEventListener = function (t, f, o) { da.call(D, t, f, o); list.push(() => D.removeEventListener(t, f, o)); };
  // an observer is disconnected with its view, and lets go of its callback: a browser that keeps a disconnected observer
  // for a while (one with entries still to deliver) then keeps an empty shell, not the card and everything it reaches
  obs.forEach(([k, C]) => { W[k] = class extends C { constructor(cb, o) { let fn = cb; super(function (...a) { if (fn) return fn.apply(this, a); }, o); list.push(() => { this.disconnect(); fn = null; }); } }; });
  cur = list; depth++;
  const dispose = () => list.splice(0).forEach((f) => { try { f(); } catch (e) { console.error(e); } });
  try {
    const value = fn();
    if (prev) prev.push(dispose);   // a capture inside a capture (a pop-up built by a card): undone with its owner too
    return { value, dispose };
  } catch (e) {
    dispose(); throw e;   // half built: what it had hooked up so far is undone, nobody else holds the list
  } finally {
    W.setInterval = si; W.addEventListener = wa; D.addEventListener = da;
    obs.forEach(([k, C]) => { W[k] = C; });
    cur = prev; depth--;
  }
}
