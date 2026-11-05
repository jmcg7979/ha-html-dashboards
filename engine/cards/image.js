// A picture from an image or camera entity (e.g. the vacuum's map), refreshed when the entity updates.
// { type: 'image', entity: 'image.q5_max_map_custom', ratio: '4/3', fit: 'contain', tap }
// While the entity is unavailable the last picture stays, dimmed (never shown as current).
import { h } from '../core/dom.js';
import { st, watch } from '../core/store.js';
import { origin } from '../core/auth.js';
import { run } from '../core/actions.js';

export default function image(cfg) {
  const el = h(`<div class="imagecard" style="aspect-ratio:${cfg.ratio || '4/3'}"><img alt="" style="object-fit:${cfg.fit || 'contain'}"></div>`);
  const img = el.querySelector('img');
  watch([cfg.entity], () => { const e = st(cfg.entity), p = e && e.attributes.entity_picture; el.classList.toggle('stale', !e || e.state === 'unavailable'); if (p) { const u = origin + p + (p.includes('?') ? '&' : '?') + 't=' + (e.lu || ''); if (img.getAttribute('src') !== u) img.src = u; } });
  if (cfg.tap) el.addEventListener('click', (ev) => run(cfg.tap, { el, ev, entity: cfg.entity }));
  return el;
}
