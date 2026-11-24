// Health of one system from its entities, shared by the Systems cards (summary map, attention list, panel badges).
// node: { name, metrics: [{ name, label, entity, unit, warn, crit, max, scale, invert: true (low is bad: a battery, free space) }],
//         checks: [{ entity, ok: ['normal'] | (e) => bool, label, name, level: 'crit' | 'warn', text: (e) => 'what is wrong' }],   // not ok -> a reason
//         updates: [{ entity, label }] }                                                      // update.* on -> attention
// -> { level: 0 ok | 1 attention | 2 problem, reasons: [{ level, text, kind: 'metric' | 'check' | 'update' | 'silent' }] }
// A reading, check or update with nothing to go on (its entity is unavailable, unknown, or HA has no such entity) is
// "not reporting": never OK, and never the check's own problem text (`ok` and `text` only ever see a real state).
// A node gets one Attention reason for everything that is silent: "Proxmox not reporting" when that is all of it,
// "Server CPU not reporting" for one reading (a metric's label; a check's "<node> <name>", else its label) and
// "Proxmox: CPU, Memory not reporting" for several (a metric's name; a check's name, else its label, else "status").
// A node that already has a Problem from a check that did report (the machine is off, the container stopped) doesn't
// also list what went silent with it.
import { st, dirty, isReady } from './store.js';
import { unitTag } from './format.js';

export const LEVEL_TONE = ['sage', 'lamp', 'ember'];
export const LEVEL_NAME = ['OK', 'Attention', 'Problem'];
export const LEVEL_ICON = ['check-circle', 'alert', 'alert-octagon'];

export function metricLevel(m, v) {
  if (isNaN(v)) return 0;
  return m.invert ? (m.crit != null && v <= m.crit ? 2 : m.warn != null && v <= m.warn ? 1 : 0)
    : (m.crit != null && v >= m.crit ? 2 : m.warn != null && v >= m.warn ? 1 : 0);
}

// An entity the store knows nothing of may only not have arrived yet: a view built a moment ago asks HA for its
// entities and has them within a second. So it counts as not reporting once it has been asked about for wait.ms, and
// the cards that watch it are redrawn then.
export const wait = { ms: 4000 };
const asked = new Map();   // entity id -> when it was first found absent
let recheck = 0;
function silent(id) {
  const e = st(id);
  if (e) { asked.delete(id); return e.state === 'unavailable' || e.state === 'unknown'; }
  const now = Date.now(); if (!asked.has(id)) asked.set(id, now);
  const left = wait.ms - (now - asked.get(id));
  if (left <= 0) return true;
  if (!recheck) recheck = setTimeout(() => { recheck = 0; dirty([...asked.keys()]); }, left + 20);
  return false;
}

export function assess(node) {
  const reasons = [], quiet = [];   // quiet: what is not reporting, as [short name, name that stands alone]
  if (!isReady()) return { level: 0, reasons };   // nothing has come from HA yet
  let n = 0;
  (node.metrics || []).forEach((m) => {
    if (!m.entity) return; n++;
    const e = st(m.entity), v = e ? parseFloat(e.state) * (m.scale || 1) : NaN, lv = metricLevel(m, v);
    if (silent(m.entity) || (e && isNaN(v))) return quiet.push([m.name || m.label, m.label || m.name]);
    if (lv) reasons.push({ level: lv, kind: 'metric', text: `${m.label || m.name} ${Math.round(v)}${unitTag(m.unit != null ? m.unit : '%')}` });
  });
  (node.checks || []).forEach((c) => {
    if (!c.entity) return; n++;
    if (silent(c.entity)) return quiet.push([c.name || c.label || 'status', c.label && !c.name ? c.label : `${node.name || ''} ${c.name || 'status'}`.trim()]);
    const e = st(c.entity); if (!e) return;   // absent, and still within its wait
    const ok = typeof c.ok === 'function' ? c.ok(e) : c.ok.includes(e.state);
    if (!ok) reasons.push({ level: c.level === 'warn' ? 1 : 2, kind: 'check', text: c.text ? c.text(e) : `${c.label || node.name} ${String(e.state).replace(/_/g, ' ')}` });
  });
  (node.updates || []).forEach((u) => {
    if (!u.entity) return; n++;
    if (silent(u.entity)) return quiet.push([`${u.label} update`, `${u.label} update`]);
    const e = st(u.entity);
    const lv = e && e.attributes.latest_version;   // an image digest (sha256:…) is not a version anyone can read
    if (e && e.state === 'on') reasons.push({ level: 1, kind: 'update', text: lv && !/^sha256:/.test(lv) ? `${String(lv).startsWith(u.label) ? '' : u.label + ' '}${lv} available` : `${u.label} update available` });
  });
  if (quiet.length && !reasons.some((r) => r.level === 2 && r.kind === 'check')) {
    const names = quiet.map((q) => q[0]), more = names.length - 3;
    const list = more > 0 ? `${names.slice(0, 3).join(', ')} and ${more} more` : names.join(', ');
    reasons.push({ level: 1, kind: 'silent', text: (quiet.length === n && n > 1 && node.name ? node.name
      : quiet.length === 1 ? quiet[0][1] : `${node.name ? node.name + ': ' : ''}${list}`) + ' not reporting' });
  }
  return { level: reasons.reduce((a, r) => Math.max(a, r.level), 0), reasons };
}

// every entity a node depends on (for watch lists)
export const nodeIds = (node) => [node.up, ...(node.metrics || []).map((m) => m.entity), ...(node.checks || []).map((c) => c.entity), ...(node.updates || []).map((u) => u.entity), ...(node.watch || [])].filter(Boolean);
