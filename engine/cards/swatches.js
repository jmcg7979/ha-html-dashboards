// Colour presets for an RGB light.  { type: 'swatches', entity, colors: [[255,147,41], ...] }
import { h } from '../core/dom.js';
import { run } from '../core/actions.js';

const DEFAULT = [[255, 147, 41], [255, 197, 143], [255, 255, 255], [255, 0, 0], [255, 120, 0], [255, 220, 0], [0, 255, 60], [0, 200, 255], [0, 60, 255], [160, 0, 255], [255, 0, 160]];
export default function swatches(cfg) {
  const colors = cfg.colors || DEFAULT;
  const el = h(`<div class="swatches">${colors.map((c, i) => `<button class="sw" data-i="${i}" style="background:rgb(${c.join(',')})"></button>`).join('')}</div>`);
  el.addEventListener('click', (ev) => { const b = ev.target.closest('.sw'); if (b) run({ call: 'light.turn_on', data: { rgb_color: colors[+b.dataset.i] } }, { el: b, ev, entity: cfg.entity }); });
  return el;
}
