// History chart with real axes: y labels + grid lines, time labels, range chips, optional state bands, touch to read values.
// { type: 'chart', title: 'Temperature', hours: 24, ranges: [12, 24, 72, 168], height: 200, unit: '°', decimals: 0,
//   series: [{ entity, attr, name, tone: 'lamp', dash: false, step: true, area: false, scale: 1 }],
//   warn / crit: threshold lines (always drawn; the axis stretches to show them; passed on to the history pop-up),
//   min: 0 = the axis never goes below it; max: 100 = never above it; fit: true = the plot takes the card's height (in a growing cell) instead of `height`
//   trend: true | { spec overrides } = an expand button opening the series in the history pop-up (core/trend.js; not for attr series),
//   bands: { entity, attr: 'hvac_action', tones: { heating: 'ember', cooling: 'mist' }, names: { heating: 'Heating' } } }
// Drawn in real pixels (re-drawn on resize), so text never stretches.
import { h, esc, icon } from '../core/dom.js';
import { request, onReady, connected } from '../core/ha.js';
import { st, watch } from '../core/store.js';
import { openTrend } from '../core/trend.js';
import { timeOpts, hourShort } from '../core/units.js';

export const panel = true;   // on a page: its own glass panel (core/layout.js)

const css = (tone) => `rgb(var(--${tone}))`;
const PAD = { l: 40, r: 10, t: 10, b: 24 };   // room for --fs-axis labels

export default function chart(cfg) {
  const ranges = cfg.ranges || [], H = cfg.height || 200;
  let hours = cfg.hours || 24, data = null, seq = 0;
  const el = h(`<div class="chart${cfg.fit ? ' fit' : ''}">
    <div class="chead"><span class="ctitle">${esc(cfg.title || '')}</span><span class="clegend">${cfg.series.map((s, i) => `<span class="cleg" data-i="${i}" style="--t:var(--${s.tone || 'mist'})"><i class="${s.dash ? 'dash' : ''}"></i>${esc(s.name)} <b></b></span>`).join('')}</span>
      ${cfg.trend ? `<button class="rbtn cexp" title="More history">${icon('arrow-expand')}</button>` : ''}
      ${ranges.length ? `<span class="cranges">${ranges.map((r) => `<button class="crange${r === hours ? ' on' : ''}" data-h="${r}">${r < 48 ? r + 'h' : r / 24 + 'd'}</button>`).join('')}</span>` : ''}</div>
    <div class="cplot" style="${cfg.fit ? '' : `height:calc(${H}px * var(--s))`}"><svg class="csvg"></svg><div class="ctip" hidden></div></div></div>`);
  const plot = el.querySelector('.cplot'), svg = el.querySelector('.csvg'), tip = el.querySelector('.ctip'), legs = [...el.querySelectorAll('.cleg b')];
  const dec = cfg.decimals || 0, unit = cfg.unit || '';
  const fmt = (v) => (v == null || isNaN(v) ? '–' : (+v).toFixed(dec) + unit);

  // current values in the legend, live
  const ids = [...new Set(cfg.series.map((s) => s.entity))];
  watch(ids, () => cfg.series.forEach((s, i) => { const e = st(s.entity); legs[i].textContent = e ? fmt((s.attr ? e.attributes[s.attr] : parseFloat(e.state)) * (s.scale || 1)) : ''; }));

  const load = () => {
    const my = ++seq, end = Date.now(), start = end - hours * 3600e3;
    const ents = [...new Set(ids.concat(cfg.bands ? [cfg.bands.entity] : []))];
    const needAttrs = cfg.series.some((s) => s.attr) || !!(cfg.bands && cfg.bands.attr);
    request({ type: 'history/history_during_period', start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(), entity_ids: ents,
      minimal_response: !needAttrs, no_attributes: !needAttrs, significant_changes_only: false })
      .then((res) => { if (my !== seq) return; data = { res, start, end }; draw(); }).catch(() => { svg.innerHTML = ''; });
  };

  // [t, v] points of one series from the compressed history rows
  const points = (rows, s, start, end) => {
    const pts = []; let attrs = {};
    (rows || []).forEach((r) => { if (r.a) attrs = r.a; const raw = s.attr ? (r.a || attrs)[s.attr] : r.s, v = parseFloat(raw) * (s.scale || 1), t = (r.lu || r.lc) * 1000;
      if (t) pts.push([Math.max(t, start), isNaN(v) ? null : v]); });
    if (pts.length) pts.push([end, pts[pts.length - 1][1]]);
    return pts;
  };

  function draw() {
    if (!data) return;
    const W = plot.clientWidth, Hp = plot.clientHeight; if (!W || !Hp) return;
    const { res, start, end } = data;
    const all = cfg.series.map((s) => points(res[s.entity], s, start, end));
    const vals = all.flat().map((p) => p[1]).filter((v) => v != null);
    if (!vals.length) { svg.innerHTML = `<text x="${W / 2}" y="${Hp / 2}" class="cnone">No history in this period</text>`; return; }
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const lines = [[cfg.warn, 'lamp'], [cfg.crit, 'ember']].filter(([v]) => v != null);
    lines.forEach(([v]) => { lo = Math.min(lo, v); hi = Math.max(hi, v); });
    const span = Math.max(hi - lo, cfg.minSpan || 4), mid = (hi + lo) / 2; lo = mid - span / 2 - span * 0.08; hi = mid + span / 2 + span * 0.08;
    if (cfg.min != null) { hi += Math.max(0, cfg.min - lo); lo = Math.max(lo, cfg.min); }
    if (cfg.max != null && hi > cfg.max) { lo = Math.max(cfg.min != null ? cfg.min : -Infinity, lo - (hi - cfg.max)); hi = cfg.max; }
    const step = niceStep((hi - lo) / 4); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step; if (cfg.max != null) hi = Math.min(hi, cfg.max);
    const x0 = PAD.l, x1 = W - PAD.r, y0 = PAD.t, y1 = Hp - PAD.b;
    const X = (t) => x0 + ((t - start) / (end - start)) * (x1 - x0), Y = (v) => y1 - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (y1 - y0);   // clamped: a value past a fixed min / max stays inside the plot
    let out = '';

    // state bands (e.g. heating / cooling) behind everything
    if (cfg.bands) {
      const b = cfg.bands, rows = res[b.entity] || []; let attrs = {};
      const segs = rows.map((r) => { if (r.a) attrs = r.a; return [Math.max((r.lu || r.lc) * 1000, start), b.attr ? (r.a || attrs)[b.attr] : r.s]; });
      segs.forEach(([t, v], i) => { const tone = b.tones[v]; if (!tone) return; const t2 = i + 1 < segs.length ? segs[i + 1][0] : end;
        out += `<rect x="${X(t).toFixed(1)}" y="${y0}" width="${Math.max(1, X(t2) - X(t)).toFixed(1)}" height="${y1 - y0}" fill="${css(tone)}" opacity=".13"/>`; });
    }
    // y grid + labels
    for (let v = lo; v <= hi + step / 2; v += step) {
      const y = Y(v).toFixed(1);
      out += `<line x1="${x0}" x2="${x1}" y1="${y}" y2="${y}" class="cgrid"/><text x="${x0 - 6}" y="${y}" class="cy">${+v.toFixed(step < 1 ? 1 : 0)}${unit}</text>`;
    }
    // time labels on round hours / days
    const hrs = hours, tick = hrs <= 12 ? 2 : hrs <= 24 ? 4 : hrs <= 72 ? 12 : 24;
    const first = new Date(start); first.setMinutes(0, 0, 0); first.setHours(Math.ceil((first.getHours() + (start > +first ? 1 : 0)) / tick) * tick);
    for (let t = +first; t < end; t += tick * 3600e3) {
      const d = new Date(t), x = X(t); if (x < x0 + 14 || x > x1 - 14) continue;
      const label = tick >= 24 || (d.getHours() === 0 && hrs > 24) ? d.toLocaleDateString([], { weekday: 'short' }) : hourShort(d);
      out += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${y0}" y2="${y1}" class="cgrid v"/><text x="${x.toFixed(1)}" y="${Hp - 6}" class="cx">${label}</text>`;
    }
    // series
    cfg.series.forEach((s, i) => {
      // one run per stretch of values (a gap = unavailable breaks the line); the area is filled per run, so a gap stays empty
      const pts = all[i], runs = []; let cur = null, prev = null;
      pts.forEach(([t, v]) => {
        if (v == null) { cur = null; prev = null; return; }
        const x = X(t).toFixed(1), y = Y(v).toFixed(1);
        if (!cur) { cur = { d: `M${x},${y}`, xs: x, xe: x }; runs.push(cur); } else { cur.d += s.step === false ? `L${x},${y}` : `L${x},${Y(prev).toFixed(1)}L${x},${y}`; cur.xe = x; }
        prev = v;
      });
      const d = runs.map((r) => r.d).join('');
      if (s.area) runs.forEach((r) => { out += `<path d="${r.d}L${r.xe},${y1}L${r.xs},${y1}Z" fill="${css(s.tone || 'mist')}" opacity=".10"/>`; });
      out += `<path d="${d}" fill="none" stroke="${css(s.tone || 'mist')}" stroke-width="${s.width || 2}" ${s.dash ? 'stroke-dasharray="5 4" opacity=".85"' : ''} stroke-linejoin="round"/>`;
    });
    lines.forEach(([v, t]) => { const y = Y(v).toFixed(1), lab = `${v}${unit}`, w = lab.length * 6.2 + 8;
      out += `<line x1="${x0}" x2="${x1}" y1="${y}" y2="${y}" stroke="${css(t)}" class="tr-th"/><rect x="${(x1 - w).toFixed(1)}" y="${(Y(v) - 8).toFixed(1)}" width="${w.toFixed(1)}" height="16" rx="8" class="tr-thb" stroke="${css(t)}"/><text x="${(x1 - w / 2).toFixed(1)}" y="${y}" class="tr-thl">${esc(lab)}</text>`; });
    out += '<line class="ccur" y1="0" y2="0" hidden/>';
    svg.setAttribute('viewBox', `0 0 ${W} ${Hp}`); svg.setAttribute('width', W); svg.setAttribute('height', Hp);
    svg.innerHTML = out;
    el._geo = { X, Y, x0, x1, y0, y1, all, start, end };
  }

  // touch / hover: vertical line + values at that moment
  const inspect = (ev) => {
    const g = el._geo; if (!g) return;
    const r = plot.getBoundingClientRect(), x = Math.max(g.x0, Math.min(g.x1, ev.clientX - r.left));
    const t = g.start + ((x - g.x0) / (g.x1 - g.x0)) * (g.end - g.start);
    const at = (pts) => { let v = null; for (const p of pts) { if (p[0] > t) break; v = p[1]; } return v; };
    const line = svg.querySelector('.ccur'); line.removeAttribute('hidden');
    line.setAttribute('x1', x); line.setAttribute('x2', x); line.setAttribute('y1', g.y0); line.setAttribute('y2', g.y1);
    const d = new Date(t);
    tip.innerHTML = `<b>${d.toLocaleDateString([], { weekday: 'short' })} ${d.toLocaleTimeString([], timeOpts({ hour: 'numeric', minute: '2-digit' }))}</b>` +
      cfg.series.map((s, i) => `<span style="--t:var(--${s.tone || 'mist'})"><i></i>${esc(s.name)} ${fmt(at(g.all[i]))}</span>`).join('');
    tip.hidden = false; tip.style.left = Math.min(x + 10, r.width - tip.offsetWidth - 4) + 'px';
  };
  const hideTip = () => { tip.hidden = true; const l = svg.querySelector('.ccur'); if (l) l.setAttribute('hidden', ''); };
  plot.addEventListener('pointerdown', inspect); plot.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'mouse' || ev.buttons) inspect(ev); });
  plot.addEventListener('pointerleave', hideTip); plot.addEventListener('pointerup', () => setTimeout(hideTip, 2500));

  el.addEventListener('click', (ev) => {
    if (ev.target.closest('.cexp')) { openTrend({ title: cfg.title, unit: cfg.unit, decimals: cfg.decimals, floor: cfg.min, minSpan: cfg.minSpan,
      series: cfg.series.map((s) => ({ entity: s.entity, name: s.name, tone: s.tone, scale: s.scale })), warn: cfg.warn, crit: cfg.crit, ...cfg.trend }); return; }
    const b = ev.target.closest('.crange'); if (!b) return;
    hours = +b.dataset.h; el.querySelectorAll('.crange').forEach((x) => x.classList.toggle('on', x === b)); load();
  });
  new ResizeObserver(draw).observe(plot);
  // refresh when shown again after a while (pop-ups are kept hidden)
  let lastLoad = 0;
  new IntersectionObserver((e) => { if (e[0].isIntersecting && Date.now() - lastLoad > 5 * 60e3) { lastLoad = Date.now(); load(); } }).observe(el);
  if (connected()) { lastLoad = Date.now(); load(); } else onReady(() => { lastLoad = Date.now(); load(); });
  return el;
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
