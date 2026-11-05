// A site's own card: a camera still, reloaded every `every` seconds, with the time of the frame on it. For cameras without Frigate
// (the engine's camera cards need it, and the image card only reloads when the entity updates).
// { type: 'snapshot', entity: 'camera.driveway', name: 'Driveway', ratio: '16/9', every: 10, tap }
// A frame that fails to load leaves the last one dimmed, its time still on it (never shown as current).
import { h, esc } from '../core/dom.js';
import { st, watch } from '../core/store.js';
import { origin } from '../core/auth.js';
import { run } from '../core/actions.js';
import { timeOpts } from '../core/units.js';

export default function snapshot(cfg) {
  const el = h(`<div class="imagecard" style="aspect-ratio:${cfg.ratio || '16/9'};position:relative"><img alt="" style="object-fit:cover">
    <span class="sub" style="position:absolute;left:var(--sp-8);bottom:var(--sp-8);padding:var(--sp-2) var(--sp-8);border-radius:var(--r-pill);background:var(--pit)"></span></div>`);
  const img = el.querySelector('img'), tag = el.querySelector('span');
  const label = (t) => { tag.innerHTML = `${esc(cfg.name)}${t ? ' · ' + esc(t) : ''}`; };
  img.onload = () => { el.classList.remove('stale'); label(new Date().toLocaleTimeString([], timeOpts({ hour: '2-digit', minute: '2-digit', second: '2-digit' }))); };
  img.onerror = () => el.classList.add('stale');
  const load = () => {
    const e = st(cfg.entity), p = e && e.attributes.entity_picture;
    if (!p || e.state === 'unavailable') { el.classList.add('stale'); return; }
    if (!document.hidden) img.src = origin + p + (p.includes('?') ? '&' : '?') + 't=' + Date.now();
  };
  label('');
  watch([cfg.entity], load);   // the store only holds watched entities
  setInterval(() => { if (el.isConnected) load(); }, (cfg.every || 10) * 1000);
  if (cfg.tap) { el.style.cursor = 'pointer'; el.addEventListener('click', (ev) => run(cfg.tap, { el, ev, entity: cfg.entity })); }
  return el;
}
