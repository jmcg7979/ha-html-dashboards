// Fetch recorded history for charts: returns [[ms, value], ...] per series (attribute or state).
import { request } from './ha.js';

export async function series(list, hours = 24) {
  const end = new Date(), start = new Date(end - hours * 3600e3);
  const ids = [...new Set(list.map((s) => s.entity))];
  const res = await request({ type: 'history/history_during_period', start_time: start.toISOString(), end_time: end.toISOString(), entity_ids: ids, minimal_response: false, no_attributes: false, significant_changes_only: false });
  return list.map((s) => {
    const pts = []; let attrs = {};
    (res[s.entity] || []).forEach((r) => {
      if (r.a) attrs = r.a;
      const v = parseFloat(s.attr ? (r.a || attrs)[s.attr] : r.s), t = (r.lu || r.lc) * 1000;
      if (!isNaN(v) && t) pts.push([Math.max(t, +start), v]);
    });
    if (pts.length) pts.push([+end, pts[pts.length - 1][1]]);
    return { pts, t0: +start, t1: +end };
  });
}

// Smooth SVG path through points (x,y already in view-box units), Catmull-Rom -> Bézier
export function smooth(xy) {
  if (xy.length < 2) return '';
  let d = `M${xy[0][0].toFixed(1)},${xy[0][1].toFixed(1)}`;
  for (let i = 0; i < xy.length - 1; i++) {
    const p0 = xy[i - 1] || xy[i], p1 = xy[i], p2 = xy[i + 1], p3 = xy[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}
