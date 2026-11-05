// A short list of like devices (access points, containers) in one panel: health-tinted icon, name and a detail line,
// a 24-hour trace, and one figure on the right.
// { type: 'devices', title, columns: 2, summary: () => '4 of 4 online', watch: [...],
//   items: [{ name, icon, node (health def, core/assess.js), sub: () => 'text', spark: entity, trend: { … } (tap -> history, core/trend.js), value: () => 'text', watch: [...] }] }
import { h, esc, icon, setText } from '../core/dom.js';
import { watch, tick } from '../core/store.js';
import { assess, nodeIds, LEVEL_TONE } from '../core/assess.js';
import { sparkline } from '../core/spark.js';
import { drill } from './host.js';

export const panel = true;   // on a page: its own glass panel (core/layout.js)

export default function devices(cfg) {
  const el = h(`<div class="devs"><div class="dvhead"><span class="atitle">${esc(cfg.title)}</span><span class="sub dvsum"></span></div>
    <div class="dvlist" style="--dcols:${cfg.columns || 2}">${cfg.items.map((i) => `<div class="dv"><span class="aic">${icon(i.icon)}</span><span class="atx"><span class="awhat">${esc(i.name)}</span><span class="awho dvsub"></span></span><span class="dvsp"></span><span class="dvval"></span></div>`).join('')}</div></div>`);
  const rows = [...el.querySelectorAll('.dv')];
  cfg.items.forEach((it, k) => {
    const r = rows[k], sp = it.spark ? sparkline(it.spark, { tone: 'mist', minRange: it.minRange != null ? it.minRange : 10 }) : null;
    if (sp) r.querySelector('.dvsp').appendChild(sp);
    if (it.trend) drill(r, () => ({ title: it.name, icon: it.icon, ...it.trend }));
    const draw = () => {
      const a = assess(it.node || {}), tone = LEVEL_TONE[a.level];
      r.style.setProperty('--t', `var(--${tone})`); r.classList.toggle('warn', a.level > 0); if (sp) sp.setTone(a.level ? tone : 'mist');
      setText(r.querySelector('.dvsub'), a.reasons.length ? a.reasons.map((x) => x.text).join(' · ') : it.sub ? it.sub() : '');
      setText(r.querySelector('.dvval'), it.value ? it.value() : '');
    };
    watch([...nodeIds(it.node || {}), ...(it.watch || [])], draw); tick(() => { if (new Date().getSeconds() === 0) draw(); });
  });
  if (cfg.summary) watch(cfg.watch || [], () => setText(el.querySelector('.dvsum'), cfg.summary()));
  return el;
}
