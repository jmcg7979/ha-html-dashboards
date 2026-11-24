// One system at a glance for the Systems summary: overall OK / Attention / Problem, the reasons, key metrics as bars.
// { type: 'health', title, icon, page: 'systems/nas', up: uptime sensor (timestamp),
//   metrics: [{ name, entity, unit, warn, crit, max }],
//   checks: [{ entity, ok: ['normal'] | (e) => bool, label: 'Volume', level: 'crit' | 'warn' }],   // not ok -> listed as a reason
//   updates: [{ entity, label }] }                                                               // update.* on -> "update available"
// The level and the reasons are core/assess.js's, so this card says the same as the Systems pages.
import { h, esc, icon, setText, setHTML } from '../core/dom.js';
import { st, watch } from '../core/store.js';
import { assess, nodeIds, metricLevel, LEVEL_TONE, LEVEL_NAME, LEVEL_ICON } from '../core/assess.js';
import { ago } from '../core/time.js';
import { unitTag } from '../core/format.js';

export default function health(cfg) {
  const el = h(`<button class="health"><div class="hhead"><span class="ic on">${icon(cfg.icon)}</span><span class="tx"><span class="name">${esc(cfg.title)}</span><span class="sub hup"></span></span><span class="hbadge"></span></div>
    <div class="hwhy"></div><div class="hbars">${(cfg.metrics || []).map((m) => `<div class="hbar"><span class="hlab">${esc(m.name)}</span><span class="htrack"><i></i></span><span class="hval"></span></div>`).join('')}</div></button>`);
  const why = el.querySelector('.hwhy'), badge = el.querySelector('.hbadge'), up = el.querySelector('.hup'), bars = [...el.querySelectorAll('.hbar')];
  const node = { name: cfg.title, up: cfg.up, metrics: cfg.metrics, checks: cfg.checks, updates: cfg.updates, watch: cfg.watch };   // what core/assess.js judges
  const draw = () => {
    (cfg.metrics || []).forEach((m, i) => {
      const e = st(m.entity), v = e ? parseFloat(e.state) : NaN, b = bars[i], max = m.max || 100;
      b.style.setProperty('--t', `var(--${isNaN(v) ? 'stone' : LEVEL_TONE[metricLevel(m, v)]})`);
      b.querySelector('i').style.width = (isNaN(v) ? 0 : Math.min(100, (v / max) * 100)) + '%';
      setText(b.querySelector('.hval'), isNaN(v) ? '–' : Math.round(v) + unitTag(m.unit || '%'));
    });
    const a = assess(node);
    el.style.setProperty('--t', `var(--${LEVEL_TONE[a.level]})`);
    el.classList.toggle('warn', a.level > 0);
    setHTML(badge, `${icon(LEVEL_ICON[a.level])}<span>${LEVEL_NAME[a.level]}</span>`);
    setText(why, a.reasons.length ? a.reasons.map((r) => r.text).join(' · ') : 'Everything normal');
    const u = cfg.up && st(cfg.up); setText(up, u && !['unknown', 'unavailable'].includes(u.state) && ago(u.state) ? 'Up ' + ago(u.state) : '');
  };
  watch(nodeIds(node), draw);
  if (cfg.page) el.addEventListener('click', () => window.dispatchEvent(new CustomEvent('dash:view', { detail: cfg.page })));
  return el;
}
