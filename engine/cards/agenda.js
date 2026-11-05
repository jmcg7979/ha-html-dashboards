// Upcoming calendar events, grouped by day ("Today", "Tomorrow", weekday).
// { type: 'agenda', calendars: ['calendar.family'] or [{ entity, name, tone, icon }], days: 7, limit: 6,
//   filter: /Holiday/i (only matching titles), follow: true (skip calendars hidden on the Calendar page), empty: 'text',
//   chips: true (a show / hide chip per calendar, shared with the month view and other `follow` agendas),
//   details: true (tap an event to expand its times, location and full description in place; tap again to fold it) }
import { h, esc, icon, setHTML, toggle, setTone } from '../core/dom.js';
import { onReady, connected } from '../core/ha.js';
import { events, hidden, setHidden } from '../core/calendars.js';
import { timeOpts } from '../core/units.js';

export const panel = true;   // on a page: its own glass panel (core/layout.js)

const dayKey = (d) => d.toDateString();
function dayName(d, far) {
  const t = new Date(); t.setHours(0, 0, 0, 0); const x = new Date(d); x.setHours(0, 0, 0, 0);
  const diff = Math.round((x - t) / 864e5);
  return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff < 7 && !far ? x.toLocaleDateString(undefined, { weekday: 'long' }) : x.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
const tm = (d) => d.toLocaleTimeString(undefined, timeOpts({ hour: 'numeric', minute: '2-digit' }));
const dt = (d) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
function when(e) {
  if (e.allDay) { const last = new Date(e.en); last.setDate(last.getDate() - 1); return last > e.s && last.toDateString() !== e.s.toDateString() ? `${dt(e.s)} – ${dt(last)}` : 'All day'; }
  return e.s.toDateString() === e.en.toDateString() ? `${tm(e.s)} – ${tm(e.en)}` : `${dt(e.s)} ${tm(e.s)} – ${dt(e.en)} ${tm(e.en)}`;
}
// plain text, links clickable (pasted emails carry them)
const rich = (s) => esc(s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);

export default function agenda(cfg) {
  const cals = cfg.calendars.map((c) => (typeof c === 'string' ? { entity: c } : c));
  const el = h(`<div class="agenda${cfg.compact ? ' compact' : ''}${cfg.details ? ' details' : ''}">${cfg.chips ? `<div class="acals">${cals.map((c, i) => `<button class="chip mcal" data-i="${i}"><i></i>${esc(c.name || c.entity)}</button>`).join('')}</div>` : ''}<div class="alist"><div class="sub">Loading the calendar…</div></div></div>`);
  const list = el.querySelector('.alist'), chips = [...el.querySelectorAll('.mcal')], open = new Set();
  const key = (e) => `${e.cal}|${+e.s}|${e.title}`;
  let evs = [];
  const drawChips = () => { const hid = hidden(); chips.forEach((c, i) => { setTone(c, cals[i].tone); toggle(c, 'on', !hid.has(cals[i].entity)); }); };
  const draw = () => {
    const start = new Date();
    if (!evs.length) { setHTML(list, `<div class="anone">${esc(cfg.empty || 'Nothing on the calendar this week.')}</div>`); return; }
    const groups = [];
    evs.forEach((e) => { const d = e.s < start ? start : e.s, k = dayKey(d); let g = groups.find((x) => x.k === k); if (!g) groups.push(g = { k, d, evs: [] }); g.evs.push(e); });
    const cal = (id) => cals.find((c) => c.entity === id) || {};
    setHTML(list, groups.map((g) => `<div class="aday"><div class="adname">${dayName(g.d, (cfg.days || 7) > 14)}</div>${g.evs.map((e) => {
      const k = key(e), more = cfg.details && open.has(k);
      return `<div class="aev${cfg.details ? ' tap' : ''}${more ? ' open' : ''}" data-k="${esc(k)}" style="--t:var(--${(cfg.colors || {})[e.cal] || cal(e.cal).tone || 'mist'})"><div class="arow"><span class="atime">${e.allDay ? 'All day' : esc(tm(e.s))}</span><span class="atitle">${esc(e.title)}</span>${cfg.details && (e.desc || e.where) ? `<span class="amore">${icon(more ? 'chevron-up' : 'chevron-down')}</span>` : cal(e.cal).icon ? `<span class="aicon">${icon(cal(e.cal).icon)}</span>` : ''}</div>${more ? `<div class="adet"><div class="awhen">${esc(when(e))}${cal(e.cal).name ? ` · ${esc(cal(e.cal).name)}` : ''}</div>${e.where ? `<div class="awhere">${icon('map-marker')}<span>${esc(e.where)}</span></div>` : ''}${e.desc ? `<div class="adesc">${rich(e.desc)}</div>` : ''}</div>` : ''}</div>`;
    }).join('')}</div>`).join(''));
  };
  let partial = false, seq = 0;
  const load = async () => {
    const my = ++seq;
    drawChips();
    const start = new Date(), end = new Date(Date.now() + (cfg.days || 7) * 864e5), hid = cfg.follow || cfg.chips ? hidden() : new Set();
    try {
      const got = await events(cals.map((c) => c.entity).filter((c) => !hid.has(c)), start, end);
      if (my !== seq) return;
      partial = got.failed.length > 0;
      evs = got.filter((e) => e.en > Date.now() && (!cfg.filter || cfg.filter.test(e.title))).slice(0, cfg.limit || 6);
      draw();
      if (partial) list.insertAdjacentHTML('beforeend', '<div class="anone">Some calendars didn’t load.</div>');
    } catch (x) { if (my === seq) setHTML(list, '<div class="anone">The calendar didn’t load. It will try again shortly.</div>'); }
  };
  el.addEventListener('click', (ev) => {
    const t = ev.target;
    if (t.closest('a')) return;
    const c = t.closest('.mcal'); if (c) { const hid = hidden(), id = cals[+c.dataset.i].entity; hid.has(id) ? hid.delete(id) : hid.add(id); setHidden(hid); if (!cfg.follow) load(); return; }
    if (!cfg.details) return;
    const row = t.closest('.aev'); if (!row) return;
    if (t.closest('.adesc') && window.getSelection && String(window.getSelection())) return;   // selecting text, not folding
    const k = row.dataset.k; open.has(k) ? open.delete(k) : open.add(k); draw();
  });
  onReady(load); if (connected()) load();
  if (cfg.follow || cfg.chips) window.addEventListener('dash:calendars', load);
  setInterval(() => { if (connected() && !document.hidden) load(); }, 15 * 60e3);
  return el;
}
