// Health of one system from its entities, shared by the Systems cards (summary map, attention list, panel badges).
// node: { name, metrics: [{ name, entity, unit, warn, crit, max, scale }],
//         checks: [{ entity, ok: ['normal'] | (e) => bool, label, level: 'crit' | 'warn' }],   // not ok -> a reason
//         updates: [{ entity, label }] }                                                      // update.* on -> attention
// -> { level: 0 ok | 1 attention | 2 problem, reasons: [{ level, text, kind: 'metric' | 'check' | 'update' }] }
import { st } from './store.js';

export const LEVEL_TONE = ['sage', 'lamp', 'ember'];
export const LEVEL_NAME = ['OK', 'Attention', 'Problem'];
export const LEVEL_ICON = ['check-circle', 'alert', 'alert-octagon'];

export function metricLevel(m, v) {
  if (isNaN(v)) return 0;
  return m.invert ? (m.crit != null && v <= m.crit ? 2 : m.warn != null && v <= m.warn ? 1 : 0)
    : (m.crit != null && v >= m.crit ? 2 : m.warn != null && v >= m.warn ? 1 : 0);
}

export function assess(node) {
  const reasons = [];
  (node.metrics || []).forEach((m) => {
    const e = st(m.entity), v = e ? parseFloat(e.state) * (m.scale || 1) : NaN, lv = metricLevel(m, v);
    if (lv) reasons.push({ level: lv, kind: 'metric', text: `${m.label || m.name} ${Math.round(v)}${m.unit != null ? m.unit : '%'}` });
  });
  (node.checks || []).forEach((c) => {
    const e = st(c.entity); if (!e) return;
    const ok = typeof c.ok === 'function' ? c.ok(e) : c.ok.includes(e.state);
    if (!ok) reasons.push({ level: c.level === 'warn' ? 1 : 2, kind: 'check', text: c.text ? c.text(e) : `${c.label || node.name} ${e.state === 'unavailable' ? 'unavailable' : String(e.state).replace(/_/g, ' ')}` });
  });
  (node.updates || []).forEach((u) => {
    const e = st(u.entity);
    const lv = e && e.attributes.latest_version;   // an image digest (sha256:…) is not a version anyone can read
    if (e && e.state === 'on') reasons.push({ level: 1, kind: 'update', text: lv && !/^sha256:/.test(lv) ? `${String(lv).startsWith(u.label) ? '' : u.label + ' '}${lv} available` : `${u.label} update available` });
  });
  return { level: reasons.reduce((a, r) => Math.max(a, r.level), 0), reasons };
}

// every entity a node depends on (for watch lists)
export const nodeIds = (node) => [node.up, ...(node.metrics || []).map((m) => m.entity), ...(node.checks || []).map((c) => c.entity), ...(node.updates || []).map((u) => u.entity), ...(node.watch || [])].filter(Boolean);
