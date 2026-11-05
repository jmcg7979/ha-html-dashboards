// NAS drive bays: one slot per drive with its status, temperature (and trace) and SMART flags.
// { type: 'bays', drives: [{ name, status, temp, bad, life }], warm, hot (defaults 122, 131 °F or 50, 55 °C) }
import { h, esc, icon, setText } from '../core/dom.js';
import { st, watch } from '../core/store.js';
import { sparkline } from '../core/spark.js';
import { drill } from './host.js';
import { deg, degUnit, metric } from '../core/units.js';

export default function bays(cfg) {
  const el = h(`<div class="bays-wrap"><div class="bays">${cfg.drives.map((d) => `<div class="bay"><span class="bled"></span><span class="bname">${esc(d.name)}</span><span class="btemp"></span><span class="bst"></span></div>`).join('')}</div></div>`);
  const slots = [...el.querySelectorAll('.bay')];
  cfg.drives.forEach((d, i) => {
    const s = slots[i], sp = sparkline(d.temp, { tone: 'mist' }); s.appendChild(sp);
    drill(s, () => ({ title: `${cfg.owner || 'NAS'} · ${d.name} temp`, icon: 'harddisk', unit: degUnit(), warn: cfg.warm || (metric() ? 50 : 122), crit: cfg.hot || (metric() ? 55 : 131), minSpan: 10, series: [{ entity: d.temp, name: d.name }] }));
    watch([d.status, d.temp, d.bad, d.life], () => {
      const stt = (st(d.status) || {}).state, t = parseFloat((st(d.temp) || {}).state), flag = [d.bad, d.life].some((x) => (st(x) || {}).state === 'on');
      const bad = flag || (stt && stt !== 'normal'), hot = t >= (cfg.hot || (metric() ? 55 : 131)), warm = t >= (cfg.warm || (metric() ? 50 : 122));
      s.style.setProperty('--t', `var(--${bad || hot ? 'ember' : warm ? 'lamp' : 'sage'})`); sp.setTone(hot ? 'ember' : warm ? 'lamp' : 'mist');
      setText(s.querySelector('.btemp'), isNaN(t) ? '–' : deg(t) + '°');
      setText(s.querySelector('.bst'), flag ? 'SMART warning' : stt ? stt.charAt(0).toUpperCase() + stt.slice(1).replace(/_/g, ' ') : '–');
    });
  });
  return el;
}
