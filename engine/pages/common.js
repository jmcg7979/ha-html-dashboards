// Formatters and small builders shared by the Systems pages of every site (site systems.js, pages/proxmox.js, pages/docker.js).
// One definition each, so the same reading looks the same everywhere. Nothing site-specific here.
import { st, num } from '../core/store.js';
import { ago } from '../core/time.js';
import { deg, degUnit } from '../core/units.js';

export { gb, gbDec, mb, bytes, mbit, fmt1, MIB_GB, mibGb } from '../core/format.js';
export const n0 = (id) => num(id) || 0;   // for arithmetic only; a reading on screen uses one of the next four, so a sensor with no value shows – and never 0
export const whole = (id, grouped) => { const v = num(id); return v == null ? '–' : grouped ? Math.round(v).toLocaleString() : String(Math.round(v)); };
export const pct = (id) => { const v = num(id); return v == null ? '–' : Math.round(v) + '%'; };
export const of = (id, fmt) => { const v = num(id); return v == null ? '–' : fmt(v); };
export const rate = (id, scale = 1) => { const v = num(id); return v == null ? NaN : Math.max(0, v * scale); };
export const s = (id) => (st(id) || {}).state;
// the state when the entity has one: null while it is unavailable, unknown, or HA has no such entity ("not reporting")
export const known = (id) => { const v = s(id); return v == null || v === 'unavailable' || v === 'unknown' ? null : v; };
export const okState = (id, ok) => ({ entity: id, ok: [].concat(ok) });
export const upFor = (id) => { const v = s(id); return v && !isNaN(new Date(v)) ? ago(v) : '–'; };
export const pxTime = (v) => new Date(String(v || '').replace(' ', 'T'));   // Proxmox's "2026-11-03 02:00:00"
// any data-rate sensors in Mbit/s, summed, whatever unit each reports in (System Monitor MB/s, Glances Mbit/s, router B/s ...);
// NaN when none of them has a value (mbit() then prints –), so a silent agent never reads as "0.0 Mbit/s"
const UNIT = { 'bit/s': 1e-6, 'kbit/s': 1e-3, 'Mbit/s': 1, 'Gbit/s': 1e3, 'B/s': 8e-6, 'kB/s': 8e-3, 'KB/s': 8e-3, 'MB/s': 8, 'GB/s': 8e3, 'KiB/s': 8.192e-3, 'MiB/s': 8.389 };
export const mbps = (ids) => { let sum = 0, any = false;
  [].concat(ids || []).forEach((id) => { const e = st(id), v = e ? parseFloat(e.state) : NaN; if (isNaN(v)) return; any = true; sum += Math.max(0, v * (UNIT[e.attributes.unit_of_measurement] || 1)); });
  return any ? sum : NaN; };
// firmware / update fact: the version, or what is available; – while the update entity says neither on nor off
export const fwText = (id) => { const e = st(id), v = known(id); if (v !== 'on' && v !== 'off') return '–';
  return v === 'on' ? { text: (e.attributes.latest_version || 'Update') + ' available', tone: 'lamp' } : e.attributes.installed_version || 'Up to date'; };
// a temperature fact, always color-coded from its metric's limits: sage OK, lamp at warn, ember at crit
export const degOf = (m) => { const v = num(m.entity); if (v == null) return '–'; return { text: deg(v) + '°', tone: v >= m.crit ? 'ember' : v >= m.warn ? 'lamp' : 'sage' }; };
// history pop-up spec for a temperature metric (core/trend.js)
export const tempTrend = (m, extra = {}) => ({ unit: degUnit(), warn: m.warn, crit: m.crit, minSpan: 10, icon: 'thermometer', series: [{ entity: m.entity, name: m.name, tone: 'lamp' }], ...extra });
export const meterOf = (m, extra = {}) => ({ entity: m.entity, name: m.name, unit: m.unit, warn: m.warn, crit: m.crit, ...extra });
export const host = (node, o) => ({ type: 'host', node: { ...node, page: undefined }, grow: true, ...o });
export const fact = (label, icon, entities, value, extra = {}) => ({ label, icon, entities, value, ...extra });
