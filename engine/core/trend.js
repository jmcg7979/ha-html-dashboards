// History drill-in (#trend pop-up, cards/trend.js): any trace or reading on the Systems pages opens it with openTrend(spec).
// spec: { title, icon, tone, unit: '%' | '°F' | 'Mbit/s' | …, decimals, warn, crit, floor: 0 (axis never below), ceil: 100 (never above),
//         minSpan (smallest value span drawn), series: [{ entity | [entities summed], name, tone, scale: 1 }],
//         events: { title, entity (on = happening), log (optional: entity with attribute log: [{ start, end }], kept past the
//         10 days of recorded history) } = a list under the chart: start, end, length }
// Data: the last 24 h (and 6 h) from recorded history, every reading; 7 d and longer from HA's long-term statistics
// (hourly / daily mean, low and high), which HA keeps forever. A sensor without statistics falls back to history (10 days).
import { request } from './ha.js';

export const sel = { spec: null };
// the pop-up itself; core/popup.js registers it for every dashboard (engine-owned, so no site can be without it)
export const trendPopup = { title: 'History', icon: 'chart-line', width: 'max', cards: [{ type: 'trend', span: 12 }] };
export function openTrend(spec) {
  sel.spec = spec;
  window.dispatchEvent(new CustomEvent('trend:sel'));
  location.hash = 'trend';
}

export const RANGES = [
  { key: '6h', ms: 6 * 3600e3, src: 'raw' },
  { key: '24h', ms: 24 * 3600e3, src: 'raw' },
  { key: '7d', ms: 7 * 864e5, src: 'hour' },
  { key: '30d', ms: 30 * 864e5, src: 'hour' },
  { key: '90d', ms: 90 * 864e5, src: 'day' },
  { key: '1y', ms: 365 * 864e5, src: 'day' },
];
const PERIOD = { hour: 3600e3, day: 864e5 };

// when an on / off sensor was on, from recorded history (10 days): [{ start, end | null while it lasts }] in ms, oldest first.
// unavailable doesn't end a span (an HA restart in the middle of one); a span already running when the window opens is left out.
export async function spans(entity, ms) {
  const end = Date.now(), start = end - ms, out = [];
  const res = await request({ type: 'history/history_during_period', start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(),
    entity_ids: [entity], minimal_response: true, no_attributes: true, significant_changes_only: false });
  let cur = null;
  (res[entity] || []).forEach((r, i) => { const t = (r.lu || r.lc) * 1000;
    if (r.s === 'on' && !cur) cur = { start: i ? t : null };
    if (r.s === 'off' && cur) { if (cur.start) out.push({ start: cur.start, end: t }); cur = null; } });
  if (cur && cur.start) out.push({ start: cur.start, end: null });
  return out;
}

// raw history -> [[t, v|null]] (v null = unavailable), one list per entity
async function raw(ids, start, end) {
  const res = await request({ type: 'history/history_during_period', start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(),
    entity_ids: ids, minimal_response: true, no_attributes: true, significant_changes_only: false });
  return ids.map((id) => (res[id] || []).map((r) => { const v = parseFloat(r.s); return [Math.max((r.lu || r.lc) * 1000, start), isNaN(v) ? null : v]; }));
}
// several entities summed, as events (a sum only while every one has a value)
function sumRaw(lists) {
  if (lists.length === 1) return lists[0];
  const ev = []; lists.forEach((l, k) => l.forEach(([t, v]) => ev.push([t, k, v]))); ev.sort((a, b) => a[0] - b[0]);
  const cur = lists.map(() => undefined), out = [];
  ev.forEach(([t, k, v]) => { cur[k] = v; if (cur.every((x) => x !== undefined)) out.push([t, cur.some((x) => x == null) ? null : cur.reduce((a, b) => a + b, 0)]); });
  return out;
}
// step-wise readings -> n buckets of { t, mean, lo, hi } (time-weighted mean; a state holds until the next one); null = no value
function bucket(pts, start, end, n) {
  const w = (end - start) / n, out = [];
  let i = 0, cur = null;
  while (i < pts.length && pts[i][0] <= start) cur = pts[i++][1];
  for (let k = 0; k < n; k++) {
    const b0 = start + k * w, b1 = b0 + w; let lo = cur, hi = cur, acc = 0, dur = 0, t = b0;
    const add = (v, until) => { if (v != null) { acc += v * (until - t); dur += until - t; lo = lo == null ? v : Math.min(lo, v); hi = hi == null ? v : Math.max(hi, v); } t = until; };
    while (i < pts.length && pts[i][0] < b1) { add(cur, pts[i][0]); cur = pts[i][1]; if (cur != null) { lo = lo == null ? cur : Math.min(lo, cur); hi = hi == null ? cur : Math.max(hi, cur); } i++; }
    add(cur, Math.min(b1, end));
    out.push(dur > 0 ? { t: b0 + w / 2, mean: acc / dur, lo, hi } : { t: b0 + w / 2, mean: null });
  }
  return out;
}
// long-term statistics -> [{ t, mean, lo, hi }] per series (summed series: means summed, no band)
async function stats(series, start, end, period) {
  const ids = [...new Set(series.flatMap((s) => [].concat(s.entity)))];
  const res = await request({ type: 'recorder/statistics_during_period', start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(),
    statistic_ids: ids, period, types: ['mean', 'min', 'max'] });
  return series.map((s) => {
    const own = [].concat(s.entity), by = new Map();
    own.forEach((id, k) => (res[id] || []).forEach((r) => { if (r.mean == null) return; let x = by.get(r.start); if (!x) by.set(r.start, (x = { n: 0, mean: 0, lo: r.min, hi: r.max })); x.n++; x.mean += r.mean; if (k) { x.lo = null; x.hi = null; } }));
    return [...by.entries()].filter(([, x]) => x.n === own.length).sort((a, b) => a[0] - b[0])
      .map(([t, x]) => ({ t: t + PERIOD[period] / 2, mean: x.mean, lo: own.length > 1 ? null : x.lo, hi: own.length > 1 ? null : x.hi }));
  });
}

// -> { series: [[{ t, mean, lo, hi }]], start, end, src: 'raw' | 'hour' | 'day', first: earliest data time, fallback: true when statistics were missing }
export async function load(spec, range, buckets) {
  const end = Date.now(), start = end - range.ms, sc = (s) => s.scale || 1;
  const scaleB = (list, s) => list.map((b) => ({ t: b.t, mean: b.mean == null ? null : b.mean * sc(s), lo: b.lo == null ? null : b.lo * sc(s), hi: b.hi == null ? null : b.hi * sc(s) }));
  const fromRaw = async (st, n) => {
    const ids = [...new Set(spec.series.flatMap((s) => [].concat(s.entity)))], lists = await raw(ids, st, end), of = new Map(ids.map((id, i) => [id, lists[i]]));
    return spec.series.map((s) => scaleB(bucket(sumRaw([].concat(s.entity).map((id) => of.get(id))), st, end, n), s));
  };
  let out, src = range.src, fallback = false;
  if (src === 'raw') out = await fromRaw(start, buckets);
  else {
    out = (await stats(spec.series, start, end, src)).map((l, i) => scaleB(l, spec.series[i]));
    if (out.every((l) => !l.length)) { fallback = true; src = 'raw'; out = await fromRaw(start, Math.min(buckets, Math.round(range.ms / 3600e3))); }
  }
  const firsts = out.map((l) => (l.find((b) => b.mean != null) || {}).t).filter(Boolean);
  return { series: out, start, end, src, fallback, first: firsts.length ? Math.min(...firsts) : null };
}
