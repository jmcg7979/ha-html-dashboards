// Calendar events from HA's REST API, plus which calendars are hidden on this screen (shared by the month view and
// the agenda lists; remembered in localStorage).
import { token, origin } from './auth.js';

// calendars: entity ids, or { entity, skip } where skip is a regular expression: events whose title matches are left out
// (a daily reminder that would crowd out everything else)
export async function events(calendars, start, end) {
  const tk = await token();
  const cals = calendars.map((c) => (typeof c === 'string' ? { entity: c } : c)), entities = cals.map((c) => c.entity);
  const lists = await Promise.all(cals.map((c) => fetch(`${origin}/api/calendars/${c.entity}?start=${start.toISOString()}&end=${end.toISOString()}`, { headers: { Authorization: 'Bearer ' + tk } })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null).then((evs) => evs && evs.filter((e) => !(c.skip && c.skip.test(e.summary || ''))).map((e) => ({ ...e, cal: c.entity })))));
  // none loaded is an error, not an empty calendar; some loaded: the list says which didn't
  const failed = entities.filter((c, i) => !lists[i]); if (entities.length && failed.length === entities.length) throw new Error('calendar');
  const out = lists.filter(Boolean).flat().map((e) => {
    const allDay = !e.start.dateTime, s = new Date(e.start.dateTime || e.start.date + 'T00:00:00'), en = new Date(e.end.dateTime || e.end.date + 'T00:00:00');
    return { title: e.summary || 'Busy', s, en, allDay, cal: e.cal, where: e.location || '', desc: e.description || '' };
  }).sort((a, b) => a.s - b.s || b.allDay - a.allDay);
  out.failed = failed;
  return out;
}

const KEY = 'dash.calendars.hidden';
export function hidden() { try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch (e) { return new Set(); } }
export function setHidden(set) {
  try { localStorage.setItem(KEY, JSON.stringify([...set])); } catch (e) { /* storage blocked */ }
  window.dispatchEvent(new CustomEvent('dash:calendars'));
}
