// A figure with its last 24 hours behind it: label, big value, a short detail, the trace filling the tile.
// { type: 'kpi', label, icon, tone: 'mist', spark: entity | [entities summed], scale: 1, entities: [...], value: () => 'text' | { text, unit, detail }, tap,
//   pair: [{ entity, tone, arrow: '↓', scale }, { entity, tone, arrow: '↑', scale }]   two figures side by side, each with its own trace (e.g. download / upload),
//   trend: { unit, … } (core/trend.js spec; tap opens the history instead of `tap`),
//   value then returns { pair: ['18', '2.2'], unit: 'Mbit/s' } }
import { h, esc, icon, setText, setHTML } from '../core/dom.js';
import { watch } from '../core/store.js';
import { sparkline } from '../core/spark.js';
import { openTrend } from '../core/trend.js';
import { run } from '../core/actions.js';

export default function kpi(cfg) {
  const el = h(`<button class="kpi" style="--t:var(--${cfg.tone || 'mist'})"><span class="khead">${icon(cfg.icon)}<span class="klab">${esc(cfg.label)}</span><span class="kdet"></span></span>
    <span class="kval"></span></button>`);
  if (cfg.pair) {   // two traces drawn over each other in one box
    const box = document.createElement('div'); box.className = 'kspark kpair';
    const group = { hi: {} };
    cfg.pair.forEach((p) => { const sp = sparkline(p.entity, { tone: p.tone, scale: p.scale, minRange: cfg.minRange, group }); box.appendChild(sp); });
    el.appendChild(box);
  } else { const sp = sparkline(cfg.spark, { tone: cfg.tone || 'mist', scale: cfg.scale }); sp.classList.add('kspark'); /* in flow, below the figure */ el.appendChild(sp); }
  const val = el.querySelector('.kval'), det = el.querySelector('.kdet');
  watch(cfg.entities || (cfg.pair ? cfg.pair.map((p) => p.entity) : [].concat(cfg.spark)), () => { let r = cfg.value(); if (typeof r !== 'object') r = { text: r };
    if (r.pair) setHTML(val, r.pair.map((t, i) => `<span class="kpv" style="--t:var(--${cfg.pair[i].tone})"><i>${esc(cfg.pair[i].arrow || '')}</i>${esc(t)}</span>`).join('') + (r.unit ? `<small>${esc(r.unit)}</small>` : ''));
    else setHTML(val, `${esc(r.text)}${r.unit ? `<small>${esc(r.unit)}</small>` : ''}`);
    setText(det, r.detail || ''); });
  if (cfg.trend) el.addEventListener('click', () => openTrend({ title: cfg.label, icon: cfg.icon, tone: cfg.tone, ...cfg.trend }));
  else if (cfg.tap) el.addEventListener('click', (ev) => (typeof cfg.tap === 'string' ? window.dispatchEvent(new CustomEvent('dash:view', { detail: cfg.tap })) : run(cfg.tap, { el, ev })));
  return el;
}
