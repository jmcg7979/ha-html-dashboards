// Sparklines: small history traces for one entity each, fetched in one batched request per screen and kept live.
// sparkline(entity, { tone, min, max, group: { hi: {} } (traces sharing one scale from 0), minRange (smallest value span drawn, so noise stays small), scale, area: true }) -> element; it sizes to its box (CSS), redraws on resize,
// appends live states as they arrive, and re-fetches history when shown again after 5 minutes.
import { request, onReady, connected } from './ha.js';
import { st, watch } from './store.js';
import { smooth } from './history.js';

const HOURS = 24, cache = new Map();   // entity -> { pts: [[ms, v]], t: fetched at, waiters: [] }
let queue = new Set(), timer = 0;

function fetchAll() {
  timer = 0; const ids = [...queue]; queue = new Set(); if (!ids.length) return;
  const end = Date.now(), start = end - HOURS * 3600e3;
  request({ type: 'history/history_during_period', start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(), entity_ids: ids,
    minimal_response: true, no_attributes: true, significant_changes_only: false })
    .then((res) => ids.forEach((id) => {
      const pts = []; (res[id] || []).forEach((r) => { const v = parseFloat(r.s), t = (r.lu || r.lc) * 1000; if (!isNaN(v) && t) pts.push([Math.max(t, start), v]); });
      const c = cache.get(id); c.pts = thin(pts, 96); c.t = Date.now(); c.waiters.splice(0).forEach((f) => f());
    }))
    .catch(() => ids.forEach((id) => { const c = cache.get(id); c.t = 0; }));
}
// keep at most n points (bucket averages), so a chatty sensor stays cheap to draw
function thin(pts, n) {
  if (pts.length <= n) return pts;
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0], out = [], b = (t1 - t0) / n; let i = 0;
  for (let k = 0; k < n; k++) { let s = 0, c = 0; const e = t0 + (k + 1) * b; while (i < pts.length && pts[i][0] <= e) { s += pts[i][1]; c++; i++; } if (c) out.push([t0 + (k + .5) * b, s / c]); }
  return out;
}
function want(id, cb) {
  let c = cache.get(id);
  if (!c) { c = { pts: null, t: 0, waiters: [] }; cache.set(id, c); }
  if (c.pts && Date.now() - c.t < 5 * 60e3) return cb();
  c.waiters.push(cb);
  if (!queue.has(id)) { queue.add(id); if (!timer) timer = setTimeout(() => (connected() ? fetchAll() : onReady(fetchAll)), 30); }
}

// several entities summed into one trace (e.g. Wi-Fi clients over every network)
function summed(ids) {
  const ev = [];
  ids.forEach((id, k) => (cache.get(id).pts || []).forEach(([t, v]) => ev.push([t, k, v])));
  ev.sort((a, b) => a[0] - b[0]);
  const cur = ids.map(() => null), out = [];
  ev.forEach(([t, k, v]) => { cur[k] = v; if (cur.every((x) => x != null)) out.push([t, cur.reduce((a, b) => a + b, 0)]); });
  return out;
}
const live = (ids, scale) => { let s = 0; for (const id of ids) { const v = parseFloat((st(id) || {}).state); if (isNaN(v)) return NaN; s += v; } return s * scale; };

// one reading per moment however many sparklines share the entity; only the last 24 h, thinned, so a screen left open for weeks stays small
function push(c, v) {
  const now = Date.now(), last = c.pts[c.pts.length - 1];
  if (last && now - last[0] < 1000) return;
  c.pts.push([now, v]);
  if (c.pts.length > 2000) { const t0 = now - HOURS * 3600e3; c.pts = c.pts.filter((p, i) => p[0] >= t0 && i % 2 === 0); }
}

export function sparkline(entity, o = {}) {
  const ids = [].concat(entity), scale = o.scale || 1;
  const el = document.createElement('div');
  el.className = 'spark';
  if (o.tone) el.style.setProperty('--t', `var(--${o.tone})`);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('preserveAspectRatio', 'none'); el.appendChild(svg);
  const gid = 'sg' + Math.random().toString(36).slice(2, 8);
  let shown = false;
  const draw = () => {
    const W = el.clientWidth, H = el.clientHeight;
    if (!W || !H || ids.some((id) => !cache.get(id) || !cache.get(id).pts)) return;
    const now = Date.now(), t0 = now - HOURS * 3600e3;
    const pts = (ids.length > 1 ? summed(ids) : cache.get(ids[0]).pts).filter((p) => p[0] >= t0).map(([t, v]) => [t, v * scale]);
    const cur = live(ids, scale); if (!isNaN(cur)) pts.push([now, cur]);
    if (pts.length < 2) { svg.innerHTML = ''; return; }
    const vs = pts.map((p) => p[1]);
    if (o.stats) o.stats({ lo: Math.min(...vs), hi: Math.max(...vs) });
    let gmax = null;
    if (o.group) {   // traces drawn over each other share one scale from 0
      o.group.hi[gid] = Math.max(...vs); gmax = Math.max(...Object.values(o.group.hi), o.minRange || 1) * 1.1;
    }
    let lo = gmax != null ? 0 : o.min != null ? o.min : Math.min(...vs), hi = gmax != null ? gmax : o.max != null ? o.max : Math.max(...vs);
    if (gmax == null && o.min == null && o.max == null) {
      const pad = Math.max((hi - lo) * 0.15, Math.abs(hi) * 0.02, 0.5); lo -= pad; hi += pad;
      if (o.minRange && hi - lo < o.minRange) { const mid = (hi + lo) / 2; lo = mid - o.minRange / 2; hi = mid + o.minRange / 2; if (lo < 0 && vs.every((v) => v >= 0)) { hi -= lo; lo = 0; } }
    }
    if (hi <= lo) hi = lo + 1;
    const X = (t) => ((t - t0) / (now - t0)) * W, Y = (v) => H - 1.5 - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (H - 3);
    const d = smooth(pts.map((p) => [X(p[0]), Y(p[1])]));
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = `<defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="rgb(var(--t))" stop-opacity=".32"/><stop offset="1" stop-color="rgb(var(--t))" stop-opacity="0"/></linearGradient></defs>` +
      (o.area === false ? '' : `<path d="${d}L${X(pts[pts.length - 1][0]).toFixed(1)},${H}L${X(pts[0][0]).toFixed(1)},${H}Z" fill="url(#${gid})"/>`) +
      `<path d="${d}" class="sline"/>`;
  };
  watch(ids, () => { ids.forEach((id) => { const c = cache.get(id), v = parseFloat((st(id) || {}).state); if (c && c.pts && !isNaN(v)) push(c, v); }); draw(); });
  new ResizeObserver(draw).observe(el);
  new IntersectionObserver((e) => { shown = e[0].isIntersecting; if (shown) ids.forEach((id) => want(id, draw)); }).observe(el);
  el.setTone = (t) => el.style.setProperty('--t', `var(--${t})`);
  return el;
}
