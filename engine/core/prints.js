// 3D prints: every job in Frigate's printer buffer (from HA history of the job helpers) and the saved ones (Frigate exports).
//   jobs:    the job-tracking automation stamps input_datetime …job_started / …job_ended and input_text …job_name on every print.
//            A stamp counts only if it was written when it says (|state time − change time| < 2 min), which leaves out hand edits.
//   exports: rec.exports, a script returning Frigate's exports (default script.printer_exports) → [{ id, name, start, end, timelapse, file, thumb }]
// load(rec) → { jobs: [{ start, end, name, open, saved, exports: [...] }], exports: [...], exportsOk, error }   (cached 30 s)
import { request } from './ha.js';
import { st } from './store.js';

const parseLocal = (s) => { const d = new Date(String(s || '').replace(' ', 'T')); return isNaN(d) ? 0 : d.getTime() / 1000; };
let cache = null, at = 0;
export const invalidate = () => { cache = null; };

async function history(ids, days) {
  const end = new Date(), start = new Date(end - days * 864e5);
  return request({ type: 'history/history_during_period', start_time: start.toISOString(), end_time: end.toISOString(), entity_ids: ids,
    minimal_response: false, no_attributes: true, significant_changes_only: false });
}
export async function exportsList(rec) {
  try {
    const r = await request({ type: 'call_service', domain: 'script', service: (rec.exports || 'script.printer_exports').replace(/^script\./, ''), service_data: {}, return_response: true });
    const res = (r && r.response) || {};
    return { ok: res.ok !== false, list: res.exports || [], error: res.error || '' };
  } catch (e) { return { ok: false, list: [], error: (e && e.message) || String(e) }; }
}

// Helper stamps are in HA's own time zone; a browser elsewhere is whole half-hours off, so take the offset out against the write time.
const stamp = (v, t) => { const off = v - t; return Math.abs(off) < 15 * 3600 ? v - Math.round(off / 1800) * 1800 : v; };
const ACTIVE = ['running', 'prepare', 'slicing', 'init', 'pause'];
const LOST_END = 12 * 3600;   // how long a print with no recorded end is shown as lasting

// status: the printer's status entity. A job with no end stamp counts as printing only while the printer says so.
export async function load(rec, force = false, status) {
  if (!force && cache && Date.now() - at < 30000) return cache;
  const days = rec.buffer_days || 7;
  let historyOk = true;
  const [h, ex] = await Promise.all([history([rec.started, rec.ended, rec.name], days + 0.2).catch(() => { historyOk = false; return {}; }), exportsList(rec)]);
  const stamps = (id) => (h[id] || []).map((r) => { const t = r.lu || r.lc || 0, v = parseLocal(r.s); return { v: v && stamp(v, t), t }; }).filter((x) => x.v && Math.abs(x.v - x.t) < 120);
  const starts = stamps(rec.started).map((x) => x.v), ends = stamps(rec.ended).map((x) => x.v).sort((a, b) => a - b);
  const names = (h[rec.name] || []).map((r) => ({ s: r.s, t: r.lu || r.lc || 0 })).filter((x) => x.s && !['unknown', 'unavailable'].includes(x.s));
  // the current helper values too (history can lag a write by a moment)
  const cs = st(rec.started), ce = st(rec.ended);
  const s0 = cs && cs.attributes.timestamp, e0 = ce && ce.attributes.timestamp;
  if (s0 && Math.abs(s0 - parseLocal(cs.state)) < 1 && !starts.some((v) => Math.abs(v - s0) < 5) && Math.abs(s0 - (cs.lc || 0)) < 120) starts.push(s0);
  if (e0 && !ends.some((v) => Math.abs(v - e0) < 5) && Math.abs(e0 - (ce.lc || 0)) < 120) ends.push(e0);
  ends.sort((a, b) => a - b);
  const nowS = Date.now() / 1000, cutoff = nowS - days * 86400;
  const list = ex.list.filter((x) => !x.in_progress || true);
  const printing = !status || ACTIVE.includes((st(status) || {}).state);
  const jobs = [...new Set(starts)].sort((a, b) => b - a).map((start, i, sorted) => {
    const next = sorted[i - 1] || Infinity;   // newest first: the print after this one
    const end = ends.find((e) => e > start && e < next && e - start < 3 * 86400) || 0, open = !end && next === Infinity && printing;
    const nm = names.filter((n) => n.t <= (end || nowS) + 120).pop();
    const exps = list.filter((x) => Math.abs(x.start - (start - 15)) < 120);
    return { start, end: end || (open ? nowS : Math.min(next, start + LOST_END, nowS)), open, lost: !end && !open, name: (nm && nm.s) || '3D print', saved: exps.some((x) => !x.timelapse), exports: exps };
  }).filter((j) => j.end > cutoff);
  const out = { jobs, exports: list, exportsOk: ex.ok, historyOk, error: ex.error };
  if (historyOk) { cache = out; at = Date.now(); }
  return out;
}
// saved prints: a real-speed export and its timelapse paired by start time, newest first
export function savedPairs(exports) {
  const out = [];
  exports.forEach((x) => { let p = out.find((o) => Math.abs(o.start - x.start) < 60); if (!p) out.push((p = { start: x.start, end: x.end, name: x.name.replace(/\s*\(timelapse\)$/, '') }));
    p[x.timelapse ? 'timelapse' : 'real'] = x; if (!x.timelapse) p.name = x.name; });
  return out.sort((a, b) => b.start - a.start);
}
