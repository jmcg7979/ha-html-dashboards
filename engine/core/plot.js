// What every chart shares: plain functions for axes. No DOM.
import { hourShort } from './units.js';

const HOUR = 3600e3, DAY = 864e5;
const MON = (d) => d.toLocaleDateString([], { month: 'short' }), dayName = (d) => d.toLocaleDateString([], { weekday: 'short' }), dateShort = (d) => `${MON(d)} ${d.getDate()}`;

// the gap between gridlines: 1, 2 or 5 times a power of ten
export function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;   // no 2.5: whole numbers read better (112.5° vs 112°)
}
// decimals a label needs to show a multiple of that step exactly: 5 -> 0, 0.5 -> 1, 0.02 -> 2
export const stepDecimals = (step) => Math.min(3, (String(+step.toPrecision(6)).split('.')[1] || '').length);

// ---- the value axis ----
// Room around the readings lo..hi: 8 % above and below, at least minSpan tall, and every line in `lines` (thresholds) inside it
export function padRange(lo, hi, { lines = [], minSpan = 1 } = {}) {
  lines.forEach((v) => { lo = Math.min(lo, v); hi = Math.max(hi, v); });
  const span = Math.max(hi - lo, minSpan), mid = (hi + lo) / 2;
  return [mid - span / 2 - span * 0.08, mid + span / 2 + span * 0.08];
}
// Never below a fixed floor or above a fixed ceiling: the range is moved, keeping its height where it can
export function limitRange(lo, hi, floor, ceil) {
  if (floor != null && lo < floor) { hi += floor - lo; lo = floor; }
  if (ceil != null && hi > ceil) { lo = Math.max(floor != null ? floor : -Infinity, lo - (hi - ceil)); hi = ceil; }
  return [lo, hi];
}
// Gridlines for a range in about `parts` steps: the step, the range widened to whole steps, and the decimals its labels need
export function gridRange(lo, hi, parts) {
  const step = niceStep((hi - lo) / parts);
  return { step, lo: Math.floor(lo / step + 1e-9) * step, hi: Math.ceil(hi / step - 1e-9) * step, decimals: stepDecimals(step) };
}

// ---- the time axis ----
// [{ t, label, major }] for start..end drawn `width` px wide, stepped on the local clock (a label stays on its round hour and
// on midnight across a clock change). Hours for a day or less, days for a week, dates for a month, months for longer; the
// first of a bigger unit (midnight, Monday, the 1st, January) is `major` and drawn bolder.
export function timeTicks(start, end, width) {
  const span = end - start, want = Math.max(3, Math.floor(width / 80)), raw = span / want;
  const steps = [[HOUR, 'h'], [2 * HOUR, 'h'], [3 * HOUR, 'h'], [6 * HOUR, 'h'], [12 * HOUR, 'h'], [DAY, 'd'], [2 * DAY, 'd'], [7 * DAY, 'w'], [14 * DAY, 'w'], [1, 'm'], [2, 'm'], [3, 'm']];
  const [n, kind] = steps.find(([s, k]) => (k === 'm' ? s * 30.4 * DAY : s) >= raw * 0.7) || steps[steps.length - 1];
  const out = [], d = new Date(start);
  if (kind === 'h') { d.setMinutes(0, 0, 0); const k = n / HOUR; while (+d < start || d.getHours() % k) d.setHours(d.getHours() + 1); }
  else if (kind === 'd' || kind === 'w') { d.setHours(0, 0, 0, 0); if (+d < start) d.setDate(d.getDate() + 1); if (kind === 'w') while (d.getDay() !== 1) d.setDate(d.getDate() + 1); }
  else { d.setHours(0, 0, 0, 0); d.setDate(1); d.setMonth(d.getMonth() + 1); while (d.getMonth() % n) d.setMonth(d.getMonth() + 1); }
  for (let guard = 0; +d <= end && guard < 60; guard++) {
    const t = new Date(d);
    if (kind === 'h') out.push(t.getHours() === 0 ? { t: +t, label: dayName(t), major: true } : { t: +t, label: hourShort(t) });
    else if (kind === 'd') out.push(span <= 8 * DAY ? { t: +t, label: `${dayName(t)} ${t.getDate()}`, major: t.getDay() === 1 } : { t: +t, label: dateShort(t), major: t.getDate() === 1 });
    else if (kind === 'w') out.push({ t: +t, label: dateShort(t) });
    else out.push(t.getMonth() === 0 ? { t: +t, label: String(t.getFullYear()), major: true } : { t: +t, label: MON(t) });
    if (kind === 'h') d.setHours(d.getHours() + n / HOUR); else if (kind === 'd') d.setDate(d.getDate() + n / DAY); else if (kind === 'w') d.setDate(d.getDate() + n / DAY); else d.setMonth(d.getMonth() + n);
  }
  return out;
}
