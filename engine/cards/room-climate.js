// Room climate card: big temperature over a 24-hour sparkline, humidity, set points, heating/cooling state.
// { type: 'room-climate', entity, name, humidity, tap }
import { h, esc, icon, setText, setHTML, setTone, toggle, cap } from '../core/dom.js';
import { st, num, watch } from '../core/store.js';
import { onReady, connected } from '../core/ha.js';
import { run } from '../core/actions.js';
import { series, smooth } from '../core/history.js';
import { deg } from '../core/units.js';

export default function roomClimate(cfg) {
  const el = h(`<button class="rclim"><svg class="rspark" viewBox="0 0 200 60" preserveAspectRatio="none"></svg>
    <div class="rtop"><span class="name">${esc(cfg.name)}</span><span class="ract"></span></div>
    <div class="rtemp"></div><div class="rfoot"><span class="sub rhum"></span><span class="sub rset"></span></div></button>`);
  const q = (s) => el.querySelector(s);
  watch([cfg.entity, cfg.humidity], () => {
    const e = st(cfg.entity); if (!e) return;
    const a = e.attributes, act = a.hvac_action || e.state, hv = num(cfg.humidity);
    setText(q('.rtemp'), a.current_temperature != null ? deg(a.current_temperature) + '°' : '–');
    setText(q('.rhum'), hv != null ? Math.round(hv) + '% humidity' : '');
    setText(q('.rset'), e.state === 'off' ? 'Off' : a.target_temp_low != null ? `${deg(a.target_temp_low)}–${deg(a.target_temp_high)}°` : a.temperature != null ? `Set ${deg(a.temperature)}°` : '');
    const tone = act === 'heating' ? 'lamp' : act === 'cooling' ? 'mist' : 'stone';
    setTone(el, tone); toggle(el, 'on', tone !== 'stone');
    setHTML(q('.ract'), tone === 'stone' ? esc(cap(act)) : icon(act === 'heating' ? 'fire' : 'snowflake') + esc(cap(act)));
  });
  const spark = async () => {
    try {
      const [s] = await series([{ entity: cfg.entity, attr: 'current_temperature' }], 24);
      if (s.pts.length < 2) return;
      const vs = s.pts.map((p) => p[1]), lo = Math.min(...vs) - 0.5, hi = Math.max(...vs) + 0.5;
      // bucket to ~24 points so the curve is smooth rather than stepped
      const n = 24, xy = [];
      for (let i = 0; i <= n; i++) { const t = s.t0 + ((s.t1 - s.t0) * i) / n; let v = s.pts[0][1]; for (const p of s.pts) { if (p[0] <= t) v = p[1]; else break; } xy.push([(i * 200) / n, 54 - ((v - lo) / (hi - lo)) * 40]); }
      const d = smooth(xy);
      q('.rspark').innerHTML = `<path d="${d} L200,60 L0,60 Z" class="rsa"/><path d="${d}" class="rsl"/>`;
    } catch (x) { /* no history */ }
  };
  onReady(spark); if (connected()) spark();
  setInterval(() => { if (connected() && !document.hidden) spark(); }, 15 * 60e3);
  if (cfg.tap) el.addEventListener('click', (ev) => run(cfg.tap, { el, ev, entity: cfg.entity }));
  return el;
}
