// Windows grouped by room, one floor at a time (floor chips at the top, each with its open count).
// { type: 'windows', floor: 'Downstairs' (shown first), floors: [{ name, rooms: [{ name, icon, windows: { 'binary_sensor.x': 'Left', ... } }] }] }
import { h, esc, icon, setText, toggle, setTone } from '../core/dom.js';
import { st, watch } from '../core/store.js';

const open = (id) => (st(id) || {}).state === 'on';
const lost = (id) => { const e = st(id); return !e || ['unavailable', 'unknown'].includes(e.state); };

export default function windows(cfg) {
  const floors = cfg.floors;
  const el = h(`<div class="wins">
    <div class="segments wfloors">${floors.map((f, i) => `<button class="chip seg" data-i="${i}"><span>${esc(f.name)}</span><b class="wcount"></b></button>`).join('')}</div>
    ${floors.map((f, i) => `<div class="wfloor" data-i="${i}">${f.rooms.length ? f.rooms.map((r) => `
      <div class="wroom"><div class="ic">${icon(r.icon || 'window-closed-variant')}</div><div class="tx"><div class="name">${esc(r.name)}</div><div class="sub"></div></div>
        <div class="wpanes">${Object.entries(r.windows).map(([id, n]) => `<span class="wpane" data-id="${id}">${icon('window-closed-variant')}<span>${esc(n)}</span></span>`).join('')}</div></div>`).join('')
      : `<div class="anone">No window sensors on this floor yet.</div>`}</div>`).join('')}</div>`);
  const chips = [...el.querySelectorAll('.wfloors .seg')], pages = [...el.querySelectorAll('.wfloor')];
  let cur = Math.max(0, floors.findIndex((f) => f.name === cfg.floor));
  const show = (i) => { cur = i; chips.forEach((c, j) => toggle(c, 'on', j === i)); pages.forEach((p, j) => { p.hidden = j !== i; }); };
  chips.forEach((c) => setTone(c, 'mist'));
  const ids = floors.flatMap((f) => f.rooms.flatMap((r) => Object.keys(r.windows)));
  watch(ids, () => {
    floors.forEach((f, i) => {
      const n = f.rooms.reduce((a, r) => a + Object.keys(r.windows).filter(open).length, 0);
      setText(chips[i].querySelector('.wcount'), n ? `${n} open` : ''); toggle(chips[i], 'alert', n > 0);
      f.rooms.forEach((r, k) => {
        const room = pages[i].querySelectorAll('.wroom')[k], o = Object.entries(r.windows).filter(([id]) => open(id)).map(([, n2]) => n2);
        setTone(room, o.length ? 'lamp' : 'sage'); toggle(room, 'on', o.length > 0); toggle(room.querySelector('.ic'), 'on', o.length > 0);
        setText(room.querySelector('.sub'), !o.length ? (Object.keys(r.windows).some(lost) ? 'Sensor offline' : 'All closed') : o.length === Object.keys(r.windows).length ? 'All open' : `${o.join(', ')} open`);
        room.querySelectorAll('.wpane').forEach((p) => { const on = open(p.dataset.id); toggle(p, 'on', on); p.firstChild.outerHTML = icon(on ? 'window-open-variant' : 'window-closed-variant'); });
      });
    });
  });
  el.addEventListener('click', (ev) => { const c = ev.target.closest('.wfloors .seg'); if (c) show(+c.dataset.i); });
  show(cur);
  return el;
}
