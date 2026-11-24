// Entity state, optimistic overrides, and render scheduling.
// Cards register what they depend on with watch(); only those cards re-render when an entity changes.
// A watch / tick made while a view is built is dropped when the view is unloaded (core/scope.js).
import { changed as pressChanged } from './feedback.js';
import { onDispose } from './scope.js';

const S = Object.create(null);    // entity_id -> { state, attributes, lc, lu }
const OPT = Object.create(null);  // entity_id -> optimistic override until HA confirms
const DEPS = new Map();           // entity_id -> Set(render fn)
let dirtyFns = new Set(), rq = 0, tq = 0, ready = false;

// ---- reading ----
export function st(id) {
  const e = S[id], o = OPT[id];
  if (o) {
    if (performance.now() > o.exp) delete OPT[id];
    else return { state: o.s != null ? o.s : (e ? e.state : ''), attributes: Object.assign({}, e ? e.attributes : {}, o.a || {}), lc: e ? e.lc : 0, lu: e ? e.lu : 0, pending: true };
  }
  return e || null;
}
// an entity's state, or undefined when there is no such entity; has: it reports (neither missing, unavailable nor unknown)
export const state = (id) => { const e = st(id); return e ? e.state : undefined; };
export const has = (id) => { const v = state(id); return v != null && v !== 'unavailable' && v !== 'unknown'; };
export const isOn = (id) => { const e = st(id); return !!e && e.state === 'on'; };
export const num = (id) => { const e = st(id); const v = e ? parseFloat(e.state) : NaN; return isNaN(v) ? null : v; };
export const attr = (id, a) => { const e = st(id); return e ? e.attributes[a] : undefined; };
export const entityIds = () => [...DEPS.keys()];
// leak checks (engine/_dev/tools/unloadcheck.mjs): how many watchers and ticks are registered
export const stats = () => ({ watchers: [...DEPS.values()].reduce((n, s) => n + s.size, 0), ticks: TICK.size });
// name of the person whose HA user id this is (person entities carry user_id)
export function personName(userId) {
  for (const id in S) if (id.startsWith('person.') && S[id].attributes.user_id === userId) return S[id].attributes.friendly_name || id.slice(7);
  return '';
}
export const isReady = () => ready;

// ---- subscriptions ----
// -> off(): the same undone by hand, for a watch made outside a view (core/session.js: scope.js outside())
export function watch(ids, fn) {
  const list = ids.filter(Boolean);
  list.forEach((id) => { if (!DEPS.has(id)) DEPS.set(id, new Set()); DEPS.get(id).add(fn); });
  const off = () => { list.forEach((id) => { const s = DEPS.get(id); if (s) s.delete(fn); }); dirtyFns.delete(fn); };
  onDispose(off);   // its view unloaded (core/scope.js)
  if (ready) fn();
  return off;
}
// A card told by several sources at once (its own watch, a session: core/session.js) draws once for all of them:
// soon(draw) -> a function that runs draw after the burst it was called in, however often it was called
export function soon(fn) {
  let due = false;
  return () => { if (due) return; due = true; queueMicrotask(() => { due = false; fn(); }); };
}
// Changes are batched to the next animation frame, with a timer as a fallback: the panel's WebView can stop running
// requestAnimationFrame while nothing is moving (and every browser stops it while the page is hidden), which left
// state - and the camera alert pop-up - waiting until a touch woke it. Whichever fires first flushes and cancels the other.
export function dirty(ids) {
  ids.forEach((id) => { const s = DEPS.get(id); if (s) s.forEach((f) => dirtyFns.add(f)); });
  if (!rq) rq = requestAnimationFrame(flush);
  if (!tq) tq = setTimeout(flush, 250);
}
function flush() {
  cancelAnimationFrame(rq); clearTimeout(tq); rq = tq = 0;
  const fs = dirtyFns; dirtyFns = new Set();
  fs.forEach(run);
}
function run(f) { try { f(); } catch (e) { console.error(e); } }

// ---- optimistic UI ----
// ok(realState) decides when HA has caught up; until then (or 12 s) the card shows the expected value.
export function dropOptimistic(id) { if (OPT[id]) { delete OPT[id]; dirty([id]); } }
export function optimistic(id, s, a, ok, t0) {
  OPT[id] = { s, a, ok, t0, exp: performance.now() + 12000 };
  dirty([id]);
}
setInterval(() => { for (const k in OPT) if (performance.now() > OPT[k].exp) { delete OPT[k]; dirty([k]); } }, 2000);

// ---- applying the subscribe_entities stream (a = added, c = changed with +/-, r = removed) ----
export function applyEntities(ev) {
  const ch = [];
  // a: every entity of a new subscription, also the ones already here (each new view or pop-up subscribes again with the
  // whole list): one that hasn't been updated since is not a change, so the cards that watch it are not redrawn
  if (ev.a) for (const id in ev.a) { const x = ev.a[id], was = S[id], lu = x.lu || x.lc; if (was && lu != null && was.lu === lu && was.state === x.s) continue; S[id] = { state: x.s, attributes: x.a || {}, lc: x.lc, lu }; ch.push(id); }
  if (ev.c) for (const id in ev.c) {
    const x = ev.c[id], e = S[id]; if (!e) continue;
    const n = { state: e.state, attributes: Object.assign({}, e.attributes), lc: e.lc, lu: e.lu };
    const p = x['+'];
    if (p) { if ('s' in p) n.state = p.s; if (p.a) Object.assign(n.attributes, p.a); if (p.lc) { n.lc = p.lc; n.lu = p.lc; } if (p.lu) n.lu = p.lu; }
    if (x['-'] && x['-'].a) x['-'].a.forEach((k) => delete n.attributes[k]);
    S[id] = n; ch.push(id);
  }
  if (ev.r) ev.r.forEach((id) => { delete S[id]; ch.push(id); });
  ch.forEach(settle); run(() => pressChanged(ch));
  if (!ready) { ready = true; const all = new Set(); DEPS.forEach((s) => s.forEach((f) => all.add(f))); all.forEach(run); }
  else dirty(ch);
}
function settle(id) {
  const o = OPT[id], e = S[id];
  let ok = false; try { ok = !!(o && e && o.ok(e)); } catch (x) { console.error(x); }   // ok() comes from a card or a config
  if (ok) { if (o.t0) metric('confirm', performance.now() - o.t0); delete OPT[id]; }
}

// ---- clock: cards that show countdowns / relative times ----
const TICK = new Set();
export function tick(fn) { TICK.add(fn); onDispose(() => TICK.delete(fn)); }
setInterval(() => { if (!document.hidden) TICK.forEach(run); }, 1000);

// ---- timing readout ----
export const M = { paint: [], confirm: [], cam: [], camFull: 0 };
const perfListeners = new Set();
export function onPerf(fn) { perfListeners.add(fn); onDispose(() => perfListeners.delete(fn)); }
export function metric(k, v) {
  if (Array.isArray(M[k])) { M[k].push(v); if (M[k].length > 20) M[k].shift(); } else M[k] = v;
  perfListeners.forEach(run);
}
// Call at the start of a tap handler: records tap -> next painted frame.
export function tapStart(ev) {
  const t0 = ev && ev.timeStamp ? ev.timeStamp : performance.now();
  requestAnimationFrame(() => setTimeout(() => metric('paint', performance.now() - t0), 0));
  return t0;
}
