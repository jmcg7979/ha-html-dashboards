// Doors and windows list with Open / Closed state; open ones first and tinted.
// { type: 'openings', items: { 'binary_sensor.front_door_sensor': 'Front Door', ... } }
import { h, esc, icon, setHTML } from '../core/dom.js';
import { st, watch } from '../core/store.js';

export default function openings(cfg) {
  const ids = Object.keys(cfg.items), el = h('<div class="openings"></div>');
  watch(ids, () => {
    const rows = ids.map((id) => { const e = st(id), win = e && e.attributes.device_class === 'window'; return { id, name: cfg.items[id], open: !!e && e.state === 'on', na: !e || ['unavailable', 'unknown'].includes(e.state), win }; })
      .sort((a, b) => b.open - a.open);
    setHTML(el, rows.map((r) => `<div class="orow${r.open ? ' on' : ''}"><span class="ic${r.open ? ' on' : ''}" style="--t:var(--lamp)">${icon(r.win ? (r.open ? 'window-open-variant' : 'window-closed-variant') : (r.open ? 'door-open' : 'door-closed'))}</span><span class="name">${esc(r.name)}</span><span class="sub">${r.na ? 'Unavailable' : r.open ? 'Open' : 'Closed'}</span></div>`).join(''));
  });
  return el;
}
