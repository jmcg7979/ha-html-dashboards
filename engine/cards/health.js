// One system at a glance for the Systems summary: overall OK / Attention / Problem, the reasons, key metrics as bars.
// { type: 'health', title, icon, page: 'systems/nas', up: uptime sensor (timestamp),
//   metrics: [{ name, entity, unit, warn, crit, max }],
//   checks: [{ entity, ok: ['normal'] | (e) => bool, label: 'Volume', level: 'crit' | 'warn' }],   // not ok -> listed as a reason
//   updates: [{ entity, label }] }                                                               // update.* on -> "update available"
import { h, esc, icon, setText, setHTML } from '../core/dom.js';
import { st, watch, tick } from '../core/store.js';

export const ago = (t) => { const d = (Date.now() - new Date(t).getTime()) / 1000; if (isNaN(d) || d < 0) return '';
  for (const [s, u] of [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'min']]) { const n = Math.floor(d / s); if (n >= 1) return n + ' ' + u + (n > 1 ? 's' : ''); } return 'just now'; };

export default function health(cfg) {
  const el = h(`<button class="health"><div class="hhead"><span class="ic on">${icon(cfg.icon)}</span><span class="tx"><span class="name">${esc(cfg.title)}</span><span class="sub hup"></span></span><span class="hbadge"></span></div>
    <div class="hwhy"></div><div class="hbars">${(cfg.metrics || []).map((m) => `<div class="hbar"><span class="hlab">${esc(m.name)}</span><span class="htrack"><i></i></span><span class="hval"></span></div>`).join('')}</div></button>`);
  const why = el.querySelector('.hwhy'), badge = el.querySelector('.hbadge'), up = el.querySelector('.hup'), bars = [...el.querySelectorAll('.hbar')];
  const ids = [cfg.up, ...(cfg.metrics || []).map((m) => m.entity), ...(cfg.checks || []).map((c) => c.entity), ...(cfg.updates || []).map((u) => u.entity)].filter(Boolean);
  const draw = () => {
    let level = 0; const reasons = [];
    (cfg.metrics || []).forEach((m, i) => {
      const e = st(m.entity), v = e ? parseFloat(e.state) : NaN, b = bars[i], max = m.max || 100;
      const lv = isNaN(v) ? 0 : m.crit != null && v >= m.crit ? 2 : m.warn != null && v >= m.warn ? 1 : 0;
      b.style.setProperty('--t', `var(--${['sage', 'lamp', 'ember'][lv]})`);
      b.querySelector('i').style.width = (isNaN(v) ? 0 : Math.min(100, (v / max) * 100)) + '%';
      setText(b.querySelector('.hval'), isNaN(v) ? '–' : Math.round(v) + (m.unit || '%'));
      if (lv) { level = Math.max(level, lv); reasons.push(`${m.name} ${Math.round(v)}${m.unit || '%'}`); }
    });
    (cfg.checks || []).forEach((c) => {
      const e = st(c.entity); if (!e) return;
      const ok = typeof c.ok === 'function' ? c.ok(e) : c.ok.includes(e.state);
      if (!ok) { const lv = c.level === 'warn' ? 1 : 2; level = Math.max(level, lv); reasons.push(`${c.label} ${e.state === 'unavailable' ? 'unavailable' : e.state.replace(/_/g, ' ')}`); }
    });
    (cfg.updates || []).forEach((u) => { const e = st(u.entity); if (e && e.state === 'on') { level = Math.max(level, 1); reasons.push(`${u.label} update available`); } });
    el.style.setProperty('--t', `var(--${['sage', 'lamp', 'ember'][level]})`);
    el.classList.toggle('warn', level > 0);
    setHTML(badge, `${icon(['check-circle', 'alert', 'alert-octagon'][level])}<span>${['OK', 'Attention', 'Problem'][level]}</span>`);
    setText(why, reasons.length ? reasons.join(' · ') : 'Everything normal');
    const u = cfg.up && st(cfg.up); setText(up, u && !['unknown', 'unavailable'].includes(u.state) ? 'Up ' + ago(u.state) : '');
  };
  watch(ids, draw); tick(() => {});
  if (cfg.page) el.addEventListener('click', () => window.dispatchEvent(new CustomEvent('dash:view', { detail: cfg.page })));
  return el;
}
