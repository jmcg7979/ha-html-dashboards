// Times of day, days and durations as text: plain functions that cards and site files share. Each takes `now` (a Date, default
// the present) where the answer depends on the clock, so it can be tested. The 12 / 24-hour choice is the site's (core/units.js).
import { hmParts, timeOpts } from './units.js';

const parts = (hms) => { const p = String(hms == null ? '' : hms).split(':').map(Number); return p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1]) ? p : null; };
// '18:30:00' (an input_datetime's state) -> minutes after midnight, or null
export const minutesOf = (hms) => { const p = parts(hms); return p ? p[0] * 60 + p[1] : null; };
// '18:30:00' -> '6:30 PM' or '18:30'; '–' when it isn't a time
export const clockOf = (hms) => { const p = parts(hms); return p ? hmParts(p[0], p[1]).filter(Boolean).join(' ') : '–'; };
// '0:45:00' (a timer's duration) -> milliseconds, or null
export const msOf = (hms) => { const p = String(hms == null ? '' : hms).split(':').map(Number); return p.length === 3 && !p.some(isNaN) ? (p[0] * 3600 + p[1] * 60 + p[2]) * 1e3 : null; };
// a Date -> '6:30 PM' or '18:30'
export const timeOf = (d) => d.toLocaleTimeString([], timeOpts({ hour: 'numeric', minute: '2-digit' }));
// when a time of day comes next: 'Today' while it is still ahead, else 'Tomorrow' (night: 'Tonight' / 'Tomorrow night'); '' when it isn't a time
export const nextDayWord = (hms, night, now = new Date()) => { const m = minutesOf(hms); if (m == null) return '';
  return m > now.getHours() * 60 + now.getMinutes() ? (night ? 'Tonight' : 'Today') : (night ? 'Tomorrow night' : 'Tomorrow'); };
// the day a moment falls on, by the calendar: 'Today', 'Tomorrow', else the weekday's name (a past day reads 'Today')
export const dayWord = (d, now = new Date()) => { const t = new Date(now); t.setHours(0, 0, 0, 0); const x = new Date(d); x.setHours(0, 0, 0, 0); const n = Math.round((x - t) / 864e5);
  return n <= 0 ? 'Today' : n === 1 ? 'Tomorrow' : x.toLocaleDateString([], { weekday: 'long' }); };
// 'Wed 6:30 AM' -> 'Wednesday' (the first word, spelled out when it is a short weekday)
export const weekdayOf = (text) => { const d = String(text || '').split(' ')[0]; return { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' }[d] || d; };
// a length of time in words, from minutes: '45 min', '2 h', '2 h 5 min'. Less than a minute is `under` ('1 min' unless given)
export const lengthWord = (min, under = '1 min') => { const m = Math.round(min); if (!(m >= 1)) return under;
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}`; };
// time left in words, rounded up to the minute: '12 min left', '1 h 05 m left'; '' when nothing is left
export const leftWord = (ms) => { if (!(ms > 0)) return ''; const m = Math.ceil(ms / 60e3);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m left` : `${m} min left`; };
// How long since a moment, in words that take "ago" or "Up" around them: "under 1 min", "5 mins", "4 months".
// A moment ahead of this clock (the two clocks differ by a little) counts as now; not a time at all gives ''.
export const ago = (t) => { const d = (Date.now() - new Date(t).getTime()) / 1000; if (isNaN(d)) return '';
  for (const [s, u] of [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'min']]) { const n = Math.floor(d / s); if (n >= 1) return n + ' ' + u + (n > 1 ? 's' : ''); } return 'under 1 min'; };
// the same as a whole phrase: "just now", "5 mins ago"
export const since = (t) => { const a = ago(t); return a === 'under 1 min' ? 'just now' : a && a + ' ago'; };
// and for a moment to come: "in 5 mins", "in under 1 min", "due" once it has passed
export const until = (t) => { const ms = new Date(t).getTime() - Date.now(); return isNaN(ms) ? '' : ms < -60e3 ? 'due' : 'in ' + ago(Date.now() - Math.max(0, ms)); };
