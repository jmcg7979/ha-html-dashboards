// Unload leak check (Playwright, via shot.sh: SHOT_SCRIPT=unloadcheck.mjs). Opens every view, every page of a view with
// pages and (--popups) every pop-up and each of its tabs, goes back to the first view, waits past the unload time, and
// counts what is left. Two rounds: a leak shows as growth from round 1 to round 2 (something started once and kept, like
// a shared poller, is the same in both). Exit 1 if anything grew, or on an error.
//   --base URL --d main --q 'k=v&...' --size 1280x800 --unload 2 (seconds) [--popups]
//   a TV dashboard: --d tv --q 'tv=<id>&p=tv' --size 960x540
// Counted:
//   watchers, ticks, views, popups   the page's own counters (window.dashStats, app.js), and any it adds later
//   intervals     setInterval not yet cleared
//   timeouts      setTimeout not yet fired or cleared. A chain that re-arms itself for ever counts as one, every round;
//                 a card that leaves its chain running after its view is gone adds one per round
//   listeners     listeners on window and document
//   sockets, peers, mediaSources   WebSocket, RTCPeerConnection and MediaSource objects still in memory after a
//                 garbage collection, open or closed: a closed one that stays is held by something that should have let go
//   videos        <video> elements in the page
//   streams       <video> / <audio> elements that have a source, in the page or not
// When a count grows, the lines after the verdict say where the extra ones were set up (file:line).
import { args, launch, newPage, watchErrors, open, settle, dashUrl, needsSignIn, viewIds, popupIds, showView, openPopup, openTrend, closePopup, popupOnScreen } from './lib/browser.mjs';

const o = args({ base: { type: 'string' }, d: { type: 'string', default: 'main' }, q: { type: 'string' }, size: { type: 'string', default: '1280x800' }, unload: { type: 'string', default: '2' }, popups: { type: 'boolean', default: false } },
  'unloadcheck.mjs --base URL [--d main] [--q k=v] [--size WxH] [--unload 2] [--popups]', { required: ['base'] });
const U = +o.unload;

// Runs in the page before any of its scripts: wraps what can be left behind, so it can be counted.
function countLive() {
  const W = window, D = document;
  // where in the page's code something was set up: the first frame of the stack that has a URL
  const where = () => { const m = (new Error().stack || '').split('\n').slice(2).map((l) => l.match(/https?:\/\/[^/]+(\/[^\s)]+)/)).find(Boolean); return m ? m[1].replace(/\?v=\w+/, '').replace(/:\d+$/, '') : '?'; };
  const tally = (list) => { const out = {}; for (const k of list) out[k] = (out[k] || 0) + 1; return out; };

  const intervals = new Map(), timeouts = new Map(), delay = {};   // delay: the time last asked for at each place, for the report
  const si = W.setInterval, ci = W.clearInterval, st = W.setTimeout, ct = W.clearTimeout;
  W.setInterval = function (...a) { const id = si.apply(W, a); const from = where(); intervals.set(id, from); delay[from] = +a[1] || 0; return id; };
  W.setTimeout = function (fn, ms, ...rest) {
    if (typeof fn !== 'function') return st.call(W, fn, ms, ...rest);
    const id = st.call(W, function (...x) { timeouts.delete(id); return fn.apply(this, x); }, ms, ...rest);
    const from = where(); timeouts.set(id, from); delay[from] = +ms || 0; return id;
  };
  // timers share one set of ids: either clear cancels either kind
  W.clearInterval = function (id) { intervals.delete(id); timeouts.delete(id); return ci.call(W, id); };
  W.clearTimeout = function (id) { intervals.delete(id); timeouts.delete(id); return ct.call(W, id); };

  // listeners on window and document: one entry per (listener, type, capture), as the browser keeps them
  const listeners = new Map();   // target name -> Map(listener -> Map('type capture' -> where))
  for (const [name, target] of [['window', W], ['document', D]]) {
    const add = target.addEventListener, remove = target.removeEventListener, mine = new Map(); listeners.set(name, mine);
    const key = (type, opt) => type + ' ' + !!(opt === true || (opt && opt.capture));
    const drop = (fn, k) => { const m = mine.get(fn); if (m) { m.delete(k); if (!m.size) mine.delete(fn); } };
    target.addEventListener = function (type, fn, opt) {
      if (fn) {
        const k = key(type, opt); if (!mine.has(fn)) mine.set(fn, new Map());
        if (!mine.get(fn).has(k)) mine.get(fn).set(k, `${name} ${type} @ ${where()}`);
        if (opt && opt.once) add.call(target, type, () => drop(fn, k), { once: true, capture: !!opt.capture });   // gone after it has run once
        if (opt && opt.signal) opt.signal.addEventListener('abort', () => drop(fn, k), { once: true });
      }
      return add.call(target, type, fn, opt);
    };
    target.removeEventListener = function (type, fn, opt) { if (fn) drop(fn, key(type, opt)); return remove.call(target, type, fn, opt); };
  }

  // objects that hold a connection or a stream: counted while they are still in memory
  const kept = {};
  for (const [as, name] of [['sockets', 'WebSocket'], ['peers', 'RTCPeerConnection'], ['mediaSources', 'MediaSource'], ['mediaSources', 'ManagedMediaSource']]) {
    const C = W[name]; if (!C) continue;
    const refs = kept[as] = kept[as] || [];
    W[name] = class extends C { constructor(...a) { super(...a); refs.push([new WeakRef(this), where()]); } };
  }
  const inMemory = (refs) => tally((refs || []).filter(([r]) => r.deref()).map(([, from]) => from));
  const media = [], seen = new WeakSet();
  for (const prop of ['src', 'srcObject']) {
    const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, prop);
    Object.defineProperty(HTMLMediaElement.prototype, prop, { ...d, set(v) { if (!seen.has(this)) { seen.add(this); media.push(new WeakRef(this)); } d.set.call(this, v); } });
  }
  const alive = (refs) => (refs || []).map((r) => r.deref()).filter(Boolean);

  W.__live = () => ({
    intervals: tally(intervals.values()), timeouts: tally(timeouts.values()), delay,
    listeners: tally([...listeners.values()].flatMap((mine) => [...mine.values()].flatMap((m) => [...m.values()]))),
    sockets: inMemory(kept.sockets), peers: inMemory(kept.peers), mediaSources: inMemory(kept.mediaSources),
    videos: D.querySelectorAll('video').length,
    streams: alive(media).filter((el) => el.srcObject || el.getAttribute('src')).length,
  });
}

const b = await launch({ args: ['--js-flags=--expose-gc'] });   // window.gc(): counts of objects "still in memory" are taken after a collection
const p = await newPage(b, { base: o.base, size: o.size, init: countLive });
const errors = watchErrors(p);
const url = dashUrl(o.base, { d: o.d, q: `unload=${U}${o.q ? '&' + o.q : ''}` });
// signed in, as on a real screen: without it no state ever arrives and nothing a card hooks up after data or a fetch is exercised
await open(p, url, { errors });
if (await needsSignIn(p)) { console.log('NOT SIGNED IN: the page asks for a sign-in, so nothing was checked'); await b.close(); process.exit(1); }
if (!(await p.evaluate(() => typeof window.dashStats === 'function'))) { console.log('THE DASHBOARD DID NOT START: ' + (errors.texts().join(' | ') || 'no error reported')); await b.close(); process.exit(1); }

const SUM = ['intervals', 'timeouts', 'listeners', 'sockets', 'peers', 'mediaSources'];   // counted per place they were set up; the snapshot line shows the totals
const total = (by) => Object.values(by).reduce((n, x) => n + x, 0);
// What is live now. Timeouts are sampled a few times and the lowest count per place is kept: a one-off that is about to
// fire drops out, a chain that re-arms itself is there every time.
async function snap(samples = 1) {
  await p.evaluate(() => { if (window.gc) { window.gc(); window.gc(); } });
  let live = null;
  for (let i = 0; i < samples; i++) {
    if (i) await p.waitForTimeout(250);
    const s = await p.evaluate(() => ({ ...window.dashStats(), ...window.__live() }));
    Object.assign(delays, s.delay); delete s.delay;
    if (live) for (const k of Object.keys(live.timeouts)) live.timeouts[k] = Math.min(live.timeouts[k], s.timeouts[k] || 0); else live = s;
  }
  for (const k of Object.keys(live.timeouts)) if (!live.timeouts[k]) delete live.timeouts[k];
  return live;
}
const delays = {};   // place -> the delay or period last asked for there (ms)
const line = (s) => JSON.stringify(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, SUM.includes(k) ? total(v) : v])));
const size = (v) => (Array.isArray(v) ? v.length : typeof v === 'number' ? v : v && typeof v === 'object' ? total(v) : 0);

const views = await viewIds(p, o.base, o.d, { frames: true });
const popups = o.popups ? await popupIds(p, o.base, o.d) : [];
const start = await snap(); console.log('start  ', line(start));
let prev = null; const grew = [];
for (const round of [1, 2]) {
  for (const v of views) { errors.mark(v); await showView(p, v); await settle(p, { base: o.base }); }
  for (const id of popups) {
    errors.mark('#' + id);
    if (id === 'trend') await openTrend(p, o.base); else await openPopup(p, id);
    await settle(p, { base: o.base });
    const tabs = popupOnScreen(p).locator('.ptab');
    for (let t = 1; t < await tabs.count(); t++) { await tabs.nth(t).click(); await settle(p, { base: o.base }); }
    await closePopup(p);
  }
  const full = await snap();
  errors.mark(views[0]); await showView(p, views[0]);
  await p.waitForTimeout(U * 1000 + 1500);
  const back = await snap(6);
  console.log(`round ${round}: all open ${line(full)}\n         back home ${line(back)}`);
  // shared pollers started once (round 1) may stay; kept views (dash.unload.keep) too
  if (prev) for (const k of Object.keys(back)) {
    if (size(back[k]) <= size(prev[k] ?? 0)) continue;
    grew.push(`${k}: ${size(prev[k] ?? 0)} -> ${size(back[k])}`);
    if (SUM.includes(k)) for (const [from, n] of Object.entries(back[k])) if (n > (prev[k][from] || 0)) grew.push(`    ${from}${from in delays ? ` (${Math.round(delays[from] / 100) / 10} s)` : ''}: ${prev[k][from] || 0} -> ${n}`);
  }
  prev = back;
}
const root = new URL(o.base.replace(/\/$/, '')).pathname + '/';
const errs = errors.lines();
console.log(`views ${views.length}, pop-ups ${popups.length}; errors: ${errs.length ? errs.slice(0, 8).join(' | ') : 'none'}`);
console.log(grew.length ? 'LEAK: round 2 left more behind than round 1\n  ' + grew.join('\n  ').replaceAll(root, '') : 'ok: nothing grows from round to round');
await b.close(); process.exit(grew.length || errs.length ? 1 : 0);
