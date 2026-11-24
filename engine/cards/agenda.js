// Upcoming calendar events, grouped by day ("Today", "Tomorrow", weekday).
// { type: 'agenda', calendars: ['calendar.family'] or [{ entity, name, tone, icon, skip }], days: 7, limit: 6,   skip: core/calendars.js
//   filter: /Holiday/i (only matching titles), follow: true (skip calendars hidden on the Calendar page), empty: 'text',
//   chips: true (a show / hide chip per calendar, shared with the month view and other `follow` agendas),
//   details: true (tap an event to expand its times, location and full description in place; tap again to fold it) }
import { h, esc, icon, setHTML, toggle, setTone } from '../core/dom.js';
import { onReady, connected } from '../core/ha.js';
import { events, hidden, setHidden } from '../core/calendars.js';
import { timeOpts } from '../core/units.js';

export const panel = true;   // on a page: its own glass panel (core/layout.js)

const dayKey = (d) => d.toDateString();
// "Today", "Tomorrow", the weekday within a week, else the date (far: a list that looks weeks ahead always gives the date)
export function dayName(d, far, now = new Date()) {
  const t = new Date(now); t.setHours(0, 0, 0, 0); const x = new Date(d); x.setHours(0, 0, 0, 0);
  const diff = Math.round((x - t) / 864e5);
  return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff < 7 && !far ? x.toLocaleDateString(undefined, { weekday: 'long' }) : x.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
const tm = (d) => d.toLocaleTimeString(undefined, timeOpts({ hour: 'numeric', minute: '2-digit' }));
const dt = (d) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
// an event's times for its detail line: an all-day event that covers several days as a range (its end is the morning after its last day)
export function when(e) {
  if (e.allDay) { const last = new Date(e.en); last.setDate(last.getDate() - 1); return last > e.s && last.toDateString() !== e.s.toDateString() ? `${dt(e.s)} – ${dt(last)}` : 'All day'; }
  return e.s.toDateString() === e.en.toDateString() ? `${tm(e.s)} – ${tm(e.en)}` : `${dt(e.s)} ${tm(e.s)} – ${dt(e.en)} ${tm(e.en)}`;
}
// A description as plain text with its links clickable (pasted emails carry them). Calendars send either plain text or
// HTML: tags go (a line break stays a line break), entities are read (&amp; is "&"), and an address written as
// <https://…> keeps the address. What is left is escaped before the links are made, and a link ends before a quote or bracket.
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] !== '#') return NAMED[e.toLowerCase()] ?? m;
  const n = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : +e.slice(1);
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
});
export const rich = (s) => esc(decode(s.replace(/<br\s*\/?>/gi, '\n').replace(/<(https?:\/\/[^\s<>]+)>/gi, '$1').replace(/<[^>]+>/g, '')))
  .replace(/https?:\/\/(?:(?!&(?:quot|#39|lt|gt);)[^\s<])+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);

export default function agenda(cfg) {
  const cals = cfg.calendars.map((c) => (typeof c === 'string' ? { entity: c } : c));
  const el = h(`<div class="agenda${cfg.compact ? ' compact' : ''}${cfg.details ? ' details' : ''}">${cfg.chips ? `<div class="acals">${cals.map((c, i) => `<button class="chip mcal" data-i="${i}"><i></i>${esc(c.name || c.entity)}</button>`).join('')}</div>` : ''}<div class="alist"><div class="sub">Loading the calendar…</div></div></div>`);
  const list = el.querySelector('.alist'), chips = [...el.querySelectorAll('.mcal')], open = new Set();
  const key = (e) => `${e.cal}|${+e.s}|${e.title}`;
  let evs = [];
  const drawChips = () => { const hid = hidden(); chips.forEach((c, i) => { setTone(c, cals[i].tone); toggle(c, 'on', !hid.has(cals[i].entity)); }); };
  const draw = () => {
    const start = new Date();
    const note = partial ? '<div class="anone">Some calendars didn’t load.</div>' : '';   // part of what is drawn, so it stays while events are folded and unfolded
    if (!evs.length) { setHTML(list, `<div class="anone">${esc(cfg.empty || 'Nothing on the calendar this week.')}</div>${note}`); return; }
    const groups = [];
    evs.forEach((e) => { const d = e.s < start ? start : e.s, k = dayKey(d); let g = groups.find((x) => x.k === k); if (!g) groups.push(g = { k, d, evs: [] }); g.evs.push(e); });
    const cal = (id) => cals.find((c) => c.entity === id) || {};
    setHTML(list, groups.map((g) => `<div class="aday"><div class="adname">${dayName(g.d, (cfg.days || 7) > 14)}</div>${g.evs.map((e) => {
      const k = key(e), more = cfg.details && open.has(k);
      return `<div class="aev${cfg.details ? ' tap' : ''}${more ? ' open' : ''}" data-k="${esc(k)}" style="--t:var(--${cal(e.cal).tone || 'mist'})"><div class="arow"><span class="atime">${e.allDay ? 'All day' : esc(tm(e.s))}</span><span class="atitle">${esc(e.title)}</span>${cfg.details && (e.desc || e.where) ? `<span class="amore">${icon(more ? 'chevron-up' : 'chevron-down')}</span>` : cal(e.cal).icon ? `<span class="aicon">${icon(cal(e.cal).icon)}</span>` : ''}</div>${more ? `<div class="adet"><div class="awhen">${esc(when(e))}${cal(e.cal).name ? ` · ${esc(cal(e.cal).name)}` : ''}</div>${e.where ? `<div class="awhere">${icon('map-marker')}<span>${esc(e.where)}</span></div>` : ''}${e.desc ? `<div class="adesc">${rich(e.desc)}</div>` : ''}</div>` : ''}</div>`;
    }).join('')}</div>`).join('') + note);
  };
  let partial = false, failed = false, seq = 0, last = 0, day = '';
  const load = async () => {
    const my = ++seq; last = Date.now(); day = dayKey(new Date());
    drawChips();
    const start = new Date(), end = new Date(Date.now() + (cfg.days || 7) * 864e5), hid = cfg.follow || cfg.chips ? hidden() : new Set();
    try {
      const got = await events(cals.filter((c) => !hid.has(c.entity)), start, end);
      if (my !== seq) return;
      partial = got.failed.length > 0; failed = false;
      evs = got.filter((e) => e.en > Date.now() && (!cfg.filter || cfg.filter.test(e.title))).slice(0, cfg.limit || 6);
      draw();
    } catch (x) { if (my === seq) { failed = true; setHTML(list, '<div class="anone">The calendar didn’t load. It will try again shortly.</div>'); } }
  };
  el.addEventListener('click', (ev) => {
    const t = ev.target;
    if (t.closest('a')) return;
    const c = t.closest('.mcal'); if (c) { const hid = hidden(), id = cals[+c.dataset.i].entity; hid.has(id) ? hid.delete(id) : hid.add(id); setHidden(hid); return; }   // setHidden tells every calendar card, this one too
    if (!cfg.details) return;
    const row = t.closest('.aev'); if (!row) return;
    if (t.closest('.adesc') && window.getSelection && String(window.getSelection())) return;   // selecting text, not folding
    const k = row.dataset.k; open.has(k) ? open.delete(k) : open.add(k); draw();
  });
  onReady(load); if (connected()) load();
  if (cfg.follow || cfg.chips) window.addEventListener('dash:calendars', load);
  // Every 15 minutes (2 after a load that failed), and when the day changes: "Today" must not be yesterday's group. Looked at
  // each minute and when the page is shown again, so a refresh that fell due while it was hidden is made up then.
  const check = () => { if (connected() && !document.hidden && (Date.now() - last >= (failed ? 2 : 15) * 60e3 || dayKey(new Date()) !== day)) load(); };
  setInterval(check, 60e3);
  document.addEventListener('visibilitychange', check); window.addEventListener('tv:resume', check);
  return el;
}
