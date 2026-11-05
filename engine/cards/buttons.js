// A group of square buttons (a room's quick controls), with or without labels.
// { type: 'buttons', columns: 4, labels: true, buttons: [{ entity, icon, name, tap: 'toggle' | action, hold: action, tone, active: (entity) => bool }] }
// hold = press for half a second (e.g. open the device's pop-up)
// colour lights use their current rgb_color as the tone while on (lightColor: false turns that off)
import { h, esc, icon, setTone, toggle } from '../core/dom.js';
import { st, watch } from '../core/store.js';
import { run } from '../core/actions.js';

const ACTIVE = ['on', 'playing', 'open'];

export default function buttons(cfg) {
  const el = h(`<div class="buttons${cfg.labels ? ' labelled' : ''}" style="--n:${cfg.columns || cfg.buttons.length}">${cfg.buttons.map((b, i) => `<button class="bbtn" data-i="${i}"><span class="ic">${icon(b.icon)}</span>${cfg.labels ? `<span class="blabel">${esc(b.name || '')}</span>` : ''}</button>`).join('')}</div>`);
  const btns = [...el.querySelectorAll('.bbtn')];
  cfg.buttons.forEach((b, i) => {
    const ic = btns[i].querySelector('.ic'); setTone(btns[i], b.tone || 'lamp');
    // a colour light that is on lights its button in its own colour (e.g. an LED strip), like HA's tile
    if (b.entity) watch([b.entity], () => { const e = st(b.entity), on = b.active ? b.active(e) : !!e && ACTIVE.includes(e.state), rgb = on && e.attributes.rgb_color;
      if (rgb && b.lightColor !== false) btns[i].style.setProperty('--t', rgb.join(', ')); else setTone(btns[i], b.tone || 'lamp');
      toggle(ic, 'on', on); toggle(btns[i], 'on', on); toggle(btns[i], 'pending', e && e.pending); });
  });
  let holdT = 0, held = false;
  el.addEventListener('pointerdown', (ev) => {
    const b = ev.target.closest('.bbtn'); if (!b) return; const x = cfg.buttons[+b.dataset.i]; held = false;
    if (x.hold) holdT = setTimeout(() => { held = true; run(x.hold, { el: b, ev, entity: x.entity }); }, 500);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => el.addEventListener(t, () => clearTimeout(holdT)));
  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('.bbtn'); if (!b || held) return;
    const x = cfg.buttons[+b.dataset.i]; run(x.tap || 'toggle', { el: b, ev, entity: x.entity });
  });
  return el;
}
