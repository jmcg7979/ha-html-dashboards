// Weather page, next 24 hours (NWS hourly): temperature curve with labels every 3 h, rain chance as bars,
// an hour axis, drawn in real pixels.
// { type: 'wx-hours', entity: 'weather.home_nws', hours: 24, height: 190, bars: false, fallback: { lat, lon } }
// no height: the CSS decides; bars: false = rain chance as figures only (the weather card embeds it small)
import { h } from '../core/dom.js';
import { forecast, viaLine } from '../core/forecast.js';
import { smooth } from '../core/history.js';
import { hourShort } from '../core/units.js';

export const panel = true;   // on a page: its own glass panel (core/layout.js)

export default function wxHours(cfg) {
  const el = h(`<div class="wxhours"${cfg.height ? ` style="height:calc(${cfg.height}px * var(--s))"` : ''}><svg></svg><div class="wxvia"></div></div>`);
  const svg = el.querySelector('svg'), via = el.querySelector('.wxvia');
  let H = [];
  const draw = () => {
    const W = el.clientWidth, Hp = el.clientHeight; if (!W || H.length < 2) return;
    const n = H.length, x0 = 18, x1 = W - 18, top = 26, bot = Hp - 46;
    const temps = H.map((x) => x.temperature), lo = Math.min(...temps) - 2, hi = Math.max(...temps) + 2;
    const X = (i) => x0 + (i * (x1 - x0)) / (n - 1), Y = (t) => top + (1 - (t - lo) / (hi - lo)) * (bot - top);
    const bw = Math.max(3, (x1 - x0) / n - 3);
    let o = H.map((x, i) => { const p = x.precipitation_probability || 0, bh = (p / 100) * (Hp - 22 - (bot + 4)); return p && cfg.bars !== false ? `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${(Hp - 22 - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" class="wxrain" rx="2"/>` : ''; }).join('');
    const xy = H.map((x, i) => [X(i), Y(x.temperature)]), path = smooth(xy);
    o += `<defs><linearGradient id="wxfade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(var(--lamp))" stop-opacity=".28"/><stop offset="1" stop-color="rgb(var(--lamp))" stop-opacity="0"/></linearGradient></defs>`;
    o += `<path d="${path} L${X(n - 1)},${bot} L${X(0)},${bot} Z" fill="url(#wxfade)"/><path d="${path}" class="wline"/>`;
    H.forEach((x, i) => {
      if (i % 3) return;
      const d = new Date(x.datetime), lab = i === 0 ? 'Now' : hourShort(d);
      o += `<circle cx="${X(i).toFixed(1)}" cy="${Y(x.temperature).toFixed(1)}" r="3" class="wdot"/><text x="${X(i).toFixed(1)}" y="${(Y(x.temperature) - 9).toFixed(1)}" class="wxt2">${Math.round(x.temperature)}°</text>`;
      o += `<text x="${X(i).toFixed(1)}" y="${Hp - 6}" class="cx">${lab}</text>`;
      if ((x.precipitation_probability || 0) >= 20) o += `<text x="${X(i).toFixed(1)}" y="${Hp - 26}" class="wxrl">${Math.round(x.precipitation_probability)}%</text>`;
    });
    svg.setAttribute('viewBox', `0 0 ${W} ${Hp}`); svg.innerHTML = o;
  };
  // the first hour is labelled Now, so passing hours drop off even while no new forecast arrives
  let all = [];
  const trim = () => { H = all.filter((x) => new Date(x.datetime) > Date.now() - 3600e3).slice(0, cfg.hours || 24); draw(); };
  forecast(cfg.entity, 'hourly', (l, meta) => { via.textContent = viaLine(meta); all = l; trim(); }, cfg.fallback);
  setInterval(() => { if (!document.hidden) trim(); }, 300000);
  new ResizeObserver(draw).observe(el);
  return el;
}
