// Weather page, next days (NWS twice-daily): one row per day with icon, rain chance, low → high on a shared
// temperature scale; tap a day for the full day and night forecast text.
// { type: 'wx-days', entity: 'weather.home_nws', days: 7, fallback: { lat, lon } }   fallback: see core/forecast.js
import { h, esc, setHTML } from '../core/dom.js';
import { forecast, byDay, wxIcon, wxImg, viaLine } from '../core/forecast.js';

export const panel = true;   // on a page: its own glass panel (core/layout.js)

const r = (v) => (v == null || isNaN(v) ? '–' : Math.round(v));

export default function wxDays(cfg) {
  const el = h('<div class="wxdays"></div>');
  let open = -1, days = [], via = '';
  const draw = () => {
    if (!days.length) { setHTML(el, '<div class="anone">Loading the forecast…</div>'); return; }
    const lo = Math.min(...days.map((d) => d.lo ?? d.hi)), hi = Math.max(...days.map((d) => d.hi ?? d.lo)), span = hi - lo || 1;
    setHTML(el, days.map((d, i) => {
      const a = ((d.lo ?? d.hi) - lo) / span * 100, b = ((d.hi ?? d.lo) - lo) / span * 100;
      return `<button class="wxday${i === open ? ' open' : ''}" data-i="${i}"><span class="wxdn">${i === 0 ? 'Today' : esc(d.date.toLocaleDateString([], { weekday: 'short' }))}</span>
        <span class="wxdi">${wxImg(wxIcon(d.cond, !d.day))}</span><span class="wxpp">${d.pp >= 20 ? r(d.pp) + '%' : ''}</span>
        <span class="wxlo">${r(d.lo)}°</span><span class="wxbar"><i style="left:${a}%;right:${100 - b}%"></i></span><span class="wxhi">${r(d.hi)}°</span>
        ${i === open ? `<span class="wxlong">${d.short && !d.text.length ? esc(d.short) : ''}${d.text.map(([n, x]) => `<b>${esc(n)}</b> ${esc(x)}`).join('<br>')}</span>` : ''}</button>`;
    }).join('') + (via ? `<div class="wxvia">${esc(via)}</div>` : ''));
  };
  forecast(cfg.entity, 'twice_daily', (list, meta) => {
    via = viaLine(meta);
    days = byDay(list).slice(0, cfg.days || 7); draw();
  }, cfg.fallback);
  el.addEventListener('click', (ev) => { const b = ev.target.closest('.wxday'); if (!b) return; open = open === +b.dataset.i ? -1 : +b.dataset.i; draw(); });
  return el;
}
