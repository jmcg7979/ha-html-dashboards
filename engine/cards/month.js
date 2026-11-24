// Month calendar: 6-week grid, ‹ › and Today, a chip per calendar to show / hide it (remembered on this screen,
// shared with agenda cards that `follow`), events as colored bars (all-day first), tap a day for its full list.
// { type: 'month', calendars: [{ entity, name, tone, skip }], weekStart: 0 }   weekStart: 0 = Sunday … 6 = Saturday; left out, the
// week starts where the browser's language says it does. Day and month names are in that language too.
import { h, esc, icon, setHTML, toggle, setTone } from '../core/dom.js';
import { onReady, connected } from '../core/ha.js';
import { events, hidden, setHidden } from '../core/calendars.js';
import { timeOpts } from '../core/units.js';

export const panel = true;   // on a page: its own glass panel (core/layout.js)

// the day a week starts on where this language is spoken (0 = Sunday), Sunday when the browser can't say
export function localeWeekStart(lang) {
  try { const l = new Intl.Locale(lang || navigator.language), w = (l.getWeekInfo ? l.getWeekInfo() : l.weekInfo) || {}; return w.firstDay ? w.firstDay % 7 : 0; } catch (e) { return 0; }
}
// short day names from `start` on, in the browser's language (2023-01-01 was a Sunday)
export const dayNames = (start, lang) => Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + start + i).toLocaleDateString(lang || [], { weekday: 'short' }));
// the first day shown for a month: the start of the week its 1st falls in
export const gridStart = (month, start) => { const d = new Date(month.getFullYear(), month.getMonth(), 1); d.setDate(1 - ((d.getDay() - start + 7) % 7)); return d; };
const fmtT = (d) => d.toLocaleTimeString([], timeOpts({ hour: 'numeric', minute: '2-digit' })).replace(':00', '').replace(/\s?([ap])\.?\s?m\.?/i, (m, p) => p.toLowerCase());
// The events on a day (d = its midnight): each that starts before the next midnight and ends after this one. An all-day
// event ends at the midnight after its last day, so it is not on the day after.
export function onDay(evs, d) { const d1 = new Date(d); d1.setDate(d.getDate() + 1); return evs.filter((e) => e.s < d1 && e.en > d); }

export default function month(cfg) {
  const START = cfg.weekStart != null ? ((+cfg.weekStart % 7) + 7) % 7 : localeWeekStart();
  const cals = cfg.calendars;
  const el = h(`<div class="month"><div class="mhead"><button class="rbtn mprev" aria-label="The month before">${icon('chevron-left')}</button><div class="mtitle"></div><button class="rbtn mnext" aria-label="The month after">${icon('chevron-right')}</button>
    <button class="chip mtoday">Today</button><span class="mnote"></span><span class="mcals">${cals.map((c, i) => `<button class="chip mcal" data-i="${i}"><i></i>${esc(c.name)}</button>`).join('')}</span></div>
    <div class="mdow">${dayNames(START).map((d) => `<span>${esc(d)}</span>`).join('')}</div><div class="mgrid"></div><div class="mday" hidden></div></div>`);
  const grid = el.querySelector('.mgrid'), title = el.querySelector('.mtitle'), dayPanel = el.querySelector('.mday'), noteEl = el.querySelector('.mnote'), chips = [...el.querySelectorAll('.mcal')];
  let cur = new Date(); cur.setDate(1); cur.setHours(0, 0, 0, 0);
  let evs = [], seq = 0, sel = null, note = '', failed = false, last = 0;
  const tone = (id) => (cals.find((c) => c.entity === id) || {}).tone || 'mist';

  const draw = () => {
    const hid = hidden(), today = new Date().toDateString();
    chips.forEach((c, i) => { setTone(c, cals[i].tone); toggle(c, 'on', !hid.has(cals[i].entity)); });
    title.textContent = cur.toLocaleDateString([], { month: 'long', year: 'numeric' }); noteEl.textContent = note;
    const first = gridStart(cur, START);
    const vis = evs.filter((e) => !hid.has(e.cal));
    let o = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(first); d.setDate(first.getDate() + i);
      const on = onDay(vis, d);
      o += `<button class="mcell${d.getMonth() !== cur.getMonth() ? ' out' : ''}${d.toDateString() === today ? ' today' : ''}${sel && d.toDateString() === sel.toDateString() ? ' sel' : ''}" data-d="${+d}">
        <span class="mnum">${d.getDate()}</span>${on.slice(0, 3).map((e) => `<span class="mev${e.allDay ? ' all' : ''}" style="--t:var(--${tone(e.cal)})">${e.allDay ? '' : `<b>${fmtT(e.s)}</b> `}${esc(e.title)}</span>`).join('')}
        ${on.length > 3 ? `<span class="mmore">+${on.length - 3} more</span>` : ''}</button>`;
    }
    setHTML(grid, o);
    if (sel) {
      const on = onDay(vis, sel);
      setHTML(dayPanel, `<div class="mdhead"><b>${sel.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</b><button class="rbtn mdclose" aria-label="Close">${icon('close')}</button></div>
        ${on.length ? on.map((e) => `<div class="aev" style="--t:var(--${tone(e.cal)})"><span class="atime">${e.allDay ? 'All day' : fmtT(e.s) + '–' + fmtT(e.en)}</span><span class="atitle">${esc(e.title)}${e.where ? `<span class="sub"> · ${esc(e.where)}</span>` : ''}</span></div>`).join('') : '<div class="anone">Nothing this day.</div>'}`);
    }
    dayPanel.hidden = !sel;
  };
  // a panel left on this page: the highlighted day moves on, and the month follows if it was showing the current one
  let shown = new Date();
  const newDay = () => { const n = new Date(); if (n.toDateString() === shown.toDateString()) return false;
    const wasCurrent = cur.getFullYear() === shown.getFullYear() && cur.getMonth() === shown.getMonth(); shown = n;
    if (wasCurrent && cur.getMonth() !== n.getMonth()) { cur = new Date(n.getFullYear(), n.getMonth(), 1); sel = null; }
    return true; };
  // a load that fails is said in the heading (the events already shown stay); so is a calendar missing from the answer
  const load = async () => {
    const my = ++seq, first = gridStart(cur, START); const end = new Date(first); end.setDate(first.getDate() + 42);
    last = Date.now();
    draw();
    try { const l = await events(cals, first, end); if (my !== seq) return; evs = l; failed = false; note = l.failed.length ? 'Some calendars didn’t load' : ''; }
    catch (e) { if (my !== seq) return; failed = true; note = 'The calendar didn’t load. It will try again shortly.'; }
    draw();
  };
  el.addEventListener('click', (ev) => {
    const t = ev.target;
    if (t.closest('.mprev')) { cur.setMonth(cur.getMonth() - 1); sel = null; load(); return; }
    if (t.closest('.mnext')) { cur.setMonth(cur.getMonth() + 1); sel = null; load(); return; }
    if (t.closest('.mtoday')) { cur = new Date(); cur.setDate(1); cur.setHours(0, 0, 0, 0); sel = null; load(); return; }
    if (t.closest('.mdclose')) { sel = null; draw(); return; }
    const c = t.closest('.mcal'); if (c) { const hid = hidden(), id = cals[+c.dataset.i].entity; hid.has(id) ? hid.delete(id) : hid.add(id); setHidden(hid); draw(); return; }
    const cell = t.closest('.mcell'); if (cell) { const d = new Date(+cell.dataset.d); sel = sel && sel.toDateString() === d.toDateString() ? null : d; if (d.getMonth() !== cur.getMonth()) { cur = new Date(d); cur.setDate(1); load(); } else draw(); }
  });
  onReady(load); if (connected()) load();
  window.addEventListener('dash:calendars', draw);   // a calendar shown or hidden on another card
  // Every 15 minutes (2 after a load that failed), and when the day changes. Looked at each minute and when the page is
  // shown again, so a refresh that fell due while it was hidden is made up then.
  const check = () => { if (document.hidden) return; const turned = newDay(); if (connected() && (turned || Date.now() - last >= (failed ? 2 : 15) * 60e3)) load(); else if (turned) draw(); };
  setInterval(check, 60e3);
  document.addEventListener('visibilitychange', check); window.addEventListener('tv:resume', check);
  return el;
}
