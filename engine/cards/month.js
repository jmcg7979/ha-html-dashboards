// Month calendar: 6-week grid, ‹ › and Today, a chip per calendar to show / hide it (remembered on this screen,
// shared with agenda cards that `follow`), events as coloured bars (all-day first), tap a day for its full list.
// { type: 'month', calendars: [{ entity, name, tone }] }
import { h, esc, icon, setHTML, toggle, setTone } from '../core/dom.js';
import { onReady, connected } from '../core/ha.js';
import { events, hidden, setHidden } from '../core/calendars.js';
import { timeOpts } from '../core/units.js';

export const panel = true;   // on a page: its own glass panel (core/layout.js)

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtT = (d) => d.toLocaleTimeString([], timeOpts({ hour: 'numeric', minute: '2-digit' })).replace(':00', '').replace(/\s?([ap])\.?\s?m\.?/i, (m, p) => p.toLowerCase());

export default function month(cfg) {
  const cals = cfg.calendars;
  const el = h(`<div class="month"><div class="mhead"><button class="rbtn mprev">${icon('chevron-left')}</button><div class="mtitle"></div><button class="rbtn mnext">${icon('chevron-right')}</button>
    <button class="chip mtoday">Today</button><span class="mcals">${cals.map((c, i) => `<button class="chip mcal" data-i="${i}"><i></i>${esc(c.name)}</button>`).join('')}</span></div>
    <div class="mdow">${DAYS.map((d) => `<span>${d}</span>`).join('')}</div><div class="mgrid"></div><div class="mday" hidden></div></div>`);
  const grid = el.querySelector('.mgrid'), title = el.querySelector('.mtitle'), dayPanel = el.querySelector('.mday'), chips = [...el.querySelectorAll('.mcal')];
  let cur = new Date(); cur.setDate(1); cur.setHours(0, 0, 0, 0);
  let evs = [], seq = 0, sel = null;
  const tone = (id) => (cals.find((c) => c.entity === id) || {}).tone || 'mist';

  const draw = () => {
    const hid = hidden(), today = new Date().toDateString();
    chips.forEach((c, i) => { setTone(c, cals[i].tone); toggle(c, 'on', !hid.has(cals[i].entity)); });
    title.textContent = cur.toLocaleDateString([], { month: 'long', year: 'numeric' });
    const first = new Date(cur); first.setDate(1 - first.getDay());
    const vis = evs.filter((e) => !hid.has(e.cal));
    let o = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(first); d.setDate(first.getDate() + i);
      const d1 = new Date(d); d1.setDate(d.getDate() + 1);
      const on = vis.filter((e) => e.s < d1 && e.en > d && !(e.allDay && e.en <= d));
      o += `<button class="mcell${d.getMonth() !== cur.getMonth() ? ' out' : ''}${d.toDateString() === today ? ' today' : ''}${sel && d.toDateString() === sel.toDateString() ? ' sel' : ''}" data-d="${+d}">
        <span class="mnum">${d.getDate()}</span>${on.slice(0, 3).map((e) => `<span class="mev${e.allDay ? ' all' : ''}" style="--t:var(--${tone(e.cal)})">${e.allDay ? '' : `<b>${fmtT(e.s)}</b> `}${esc(e.title)}</span>`).join('')}
        ${on.length > 3 ? `<span class="mmore">+${on.length - 3} more</span>` : ''}</button>`;
    }
    setHTML(grid, o);
    if (sel) {
      const d1 = new Date(sel); d1.setDate(sel.getDate() + 1);
      const on = vis.filter((e) => e.s < d1 && e.en > sel && !(e.allDay && e.en <= sel));
      setHTML(dayPanel, `<div class="mdhead"><b>${sel.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</b><button class="rbtn mdclose">${icon('close')}</button></div>
        ${on.length ? on.map((e) => `<div class="aev" style="--t:var(--${tone(e.cal)})"><span class="atime">${e.allDay ? 'All day' : fmtT(e.s) + '–' + fmtT(e.en)}</span><span class="atitle">${esc(e.title)}${e.where ? `<span class="sub"> · ${esc(e.where)}</span>` : ''}</span></div>`).join('') : '<div class="anone">Nothing this day.</div>'}`);
    }
    dayPanel.hidden = !sel;
  };
  // a panel left on this page: the highlighted day moves on, and the month follows if it was showing the current one
  let shown = new Date();
  setInterval(() => { const n = new Date(); if (n.toDateString() === shown.toDateString()) return;
    const wasCurrent = cur.getFullYear() === shown.getFullYear() && cur.getMonth() === shown.getMonth(); shown = n;
    if (wasCurrent && cur.getMonth() !== n.getMonth()) { cur = new Date(n.getFullYear(), n.getMonth(), 1); sel = null; }
    load(); }, 600000);
  const load = async () => {
    const my = ++seq, first = new Date(cur); first.setDate(1 - first.getDay()); const last = new Date(first); last.setDate(first.getDate() + 42);
    draw();
    try { const l = await events(cals.map((c) => c.entity), first, last); if (my === seq) { evs = l; draw(); } } catch (e) { /* keep last */ }
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
  setInterval(() => { if (connected() && !document.hidden) load(); }, 15 * 60e3);
  return el;
}
