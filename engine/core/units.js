// Display units, set by a site in home.js: export const units = { temperature: 'C', clock: '24h' }. Both optional; the defaults are °F, and times in 12-hour or the browser's own format.
// `temperature` names the unit the site's sensors report and picks the labels, decimals and default limits. Nothing is converted: HA's numbers are shown as they are.
// Read when called, not at load: home.js and the engine's modules can import each other in a cycle.
import * as home from '../home.js';

const U = () => home.units || {};
export const metric = () => U().temperature === 'C';
export const degUnit = () => (metric() ? '°C' : '°F');
export const h24 = () => U().clock === '24h';
// a temperature as text, no ° sign: whole degrees in °F, tenths in °C ("19.5", "20")
export const deg = (v) => String(metric() ? Math.round(v * 10) / 10 : Math.round(v));
// options for toLocaleTimeString: what the site asks for, or the browser's own format
export const timeOpts = (o) => (U().clock === '24h' ? { ...o, hourCycle: 'h23' } : U().clock === '12h' ? { ...o, hourCycle: 'h12' } : o);
// "4p", or "16" on a 24-hour site: chart axes
export const hourShort = (d) => (h24() ? String(d.getHours()).padStart(2, '0') : (d.getHours() % 12 || 12) + (d.getHours() < 12 ? 'a' : 'p'));
// hours and minutes as [time, AM or PM]; the second is '' on a 24-hour site
export const hmParts = (h, m) => (h24() ? [`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, ''] : [`${(h % 12) || 12}:${String(m).padStart(2, '0')}`, h < 12 ? 'AM' : 'PM']);
