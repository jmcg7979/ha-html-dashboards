// History chart with real axes: y labels + grid lines, time labels, range chips, optional state bands, touch to read values.
// { type: 'chart', title: 'Temperature', hours: 24, ranges: [12, 24, 72, 168], height: 200, unit: '°', decimals: 0,
//   series: [{ entity, attr, name, tone: 'lamp', dash: false, step: true, area: false, scale: 1 }],
//   warn / crit: threshold lines (always drawn; the axis stretches to show them; passed on to the history pop-up),
//   min: 0 = the axis never goes below it; max: 100 = never above it; fit: true = the plot takes the card's height (in a growing cell) instead of `height`
//   trend: true | { spec overrides } = an expand button opening the series in the history pop-up (core/trend.js; not for attr series),
//   bands: { entity, attr: 'hvac_action', tones: { heating: 'ember', cooling: 'mist' }, names: { heating: 'Heating' } },
//   period: () => { start, end, title, points } | null, follow: [ids]   a run instead of the last `hours` (a cook, a print): recorded
//           history from start (ms) to end (default: now); with points ([[ms, value], …] per series: a finished run its sensor
//           keeps) no history is asked for. title replaces the card's; null = the last `hours`. Asked again when a `follow` id changes,
//   runs: { label: 'Cook', latest: 'Latest', list: () => Promise<[{ id, name }]>, get: (id) => Promise<{ start, end, title, points }> }
//           with a period: a chip in the heading that picks an earlier run instead (core/pick.js). Its first choice, `latest`, is the
//           period; the others come from list() (asked with the period) and get(id) gives the chosen one's lines }
// Drawn in real pixels (re-drawn on resize), so text never stretches.
import { h, esc, icon, setText } from '../core/dom.js';
import { request, onReady, connected } from '../core/ha.js';
import { st, watch } from '../core/store.js';
import { openTrend } from '../core/trend.js';
import { timeOpts } from '../core/units.js';
import { niceStep, stepDecimals, padRange, limitRange, gridRange, timeTicks } from '../core/plot.js';
import { readout } from '../core/readout.js';
import { pick } from '../core/pick.js';
import { unitTag } from '../core/format.js';

export { niceStep, stepDecimals };   // core/plot.js's

export const panel = true;   // on a page: its own glass panel (core/layout.js)

const css = (tone) => `rgb(var(--${tone}))`;
const PAD = { l: 40, r: 10, t: 10, b: 24 };   // room for --fs-axis labels

export default function chart(cfg) {
  const ranges = cfg.ranges || [], H = cfg.height || 200;
  let hours = cfg.hours || 24, data = null, seq = 0, lastLoad = 0;
  const el = h(`<div class="chart${cfg.fit ? ' fit' : ''}">
    <div class="chead"><span class="ctitle">${esc(cfg.title || '')}</span><span class="clegend">${cfg.series.map((s, i) => `<span class="cleg" data-i="${i}" style="--t:var(--${s.tone || 'mist'})"><i class="${s.dash ? 'dash' : ''}"></i>${esc(s.name)} <b></b></span>`).join('')}</span>
      ${cfg.trend ? `<button class="rbtn cexp" aria-label="More history">${icon('arrow-expand')}</button>` : ''}
      ${ranges.length ? `<span class="cranges">${ranges.map((r) => `<button class="crange${r === hours ? ' on' : ''}" data-h="${r}">${r < 48 ? r + 'h' : r / 24 + 'd'}</button>`).join('')}</span>` : ''}</div>
    <div class="cplot" style="${cfg.fit ? '' : `height:calc(${H}px * var(--s))`}"><svg class="csvg"></svg><div class="ctip" hidden></div></div></div>`);
  const plot = el.querySelector('.cplot'), svg = el.querySelector('.csvg'), tip = el.querySelector('.ctip'), legs = [...el.querySelectorAll('.cleg b')];
  const title = el.querySelector('.ctitle');
  const dec = cfg.decimals || 0, unit = cfg.unit || '';
  const fmt = (v) => (v == null || isNaN(v) ? '–' : (+v).toFixed(dec) + unitTag(unit));

  // current values in the legend, live
  const ids = [...new Set(cfg.series.map((s) => s.entity))];
  // (not beside a run that is over: its lines are that run's, the entities' values are now's)
  const legend = () => cfg.series.forEach((s, i) => { const e = data && data.pts ? null : st(s.entity); legs[i].textContent = e ? fmt((s.attr ? e.attributes[s.attr] : parseFloat(e.state)) * (s.scale || 1)) : ''; });
  watch(ids, legend);

  // an earlier run, picked with the chip ('' = the period itself)
  const R = cfg.runs, first = R && { id: '', name: R.latest || 'Latest' };
  let run = '';
  const chip = R ? pick({ label: R.label, options: [first], value: '', onChange: (id) => { run = id; load(); } }) : null;
  if (chip) title.after(chip.el);
  // the runs to choose from; one that is no longer listed gives way to the latest
  const runs = () => R.list().then((l) => { if (!el.isConnected) return; chip.set({ options: [first, ...l] }); if (chip.value() !== run) { run = chip.value(); load(); } }, () => {});

  // again: a refresh of a chart that is up; if it fails the chart stays as it is and the next refresh asks again
  const load = (again) => {
    lastLoad = Date.now();
    const my = ++seq;
    if (run) {
      if (again) return;   // a run that is over doesn't change
      data = null; message('Loading…');
      R.get(run).then((r) => { if (my !== seq) return; if (!r || !r.points.some((l) => l.length)) return message('Nothing was kept of it');
        setText(title, r.title || cfg.title || ''); data = { pts: r.points, start: r.start, end: r.end }; legend(); draw(); })
        .catch(() => { if (my !== seq) return; message('Could not load the history'); });   // asked again at the next refresh
      return;
    }
    const p = cfg.period ? cfg.period() : null;
    const end = (p && p.end) || lastLoad, start = p ? p.start : end - hours * 3600e3;
    setText(title, (p && p.title) || cfg.title || '');
    if (p && p.points) { data = { pts: p.points, start, end }; legend(); draw(); return; }
    const ents = [...new Set(ids.concat(cfg.bands ? [cfg.bands.entity] : []))];
    const needAttrs = cfg.series.some((s) => s.attr) || !!(cfg.bands && cfg.bands.attr);
    request({ type: 'history/history_during_period', start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(), entity_ids: ents,
      minimal_response: !needAttrs, no_attributes: !needAttrs, significant_changes_only: false })
      .then((res) => { if (my !== seq) return; data = { res, start, end }; legend(); draw(); })
      // nothing came: no old chart left to be redrawn or read from, a line that says so, and the next showing asks again
      .catch(() => { if (my !== seq) return; if (again && data) { lastLoad = Date.now() - REFRESH + 60e3; return; } data = null; lastLoad = 0; message('Could not load the history'); });
  };

  const message = (text) => { el._geo = null; tip.hidden = true; const W = plot.clientWidth, Hp = plot.clientHeight;
    svg.setAttribute('viewBox', `0 0 ${W} ${Hp}`); svg.setAttribute('width', W); svg.setAttribute('height', Hp);
    svg.innerHTML = `<text x="${W / 2}" y="${Hp / 2}" class="cnone">${esc(text)}</text>`; };

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
    const all = data.pts ? cfg.series.map((s, i) => data.pts[i] || []) : cfg.series.map((s) => points(res[s.entity], s, start, end));
    const vals = all.flat().map((p) => p[1]).filter((v) => v != null);
    if (!vals.length) return message('No history in this period');
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const lines = [[cfg.warn, 'lamp'], [cfg.crit, 'ember']].filter(([v]) => v != null);
    [lo, hi] = limitRange(...padRange(lo, hi, { lines: lines.map(([v]) => v), minSpan: cfg.minSpan || 4 }), cfg.min, cfg.max);
    const grid = gridRange(lo, hi, 4), step = grid.step; lo = grid.lo; hi = cfg.max != null ? Math.min(grid.hi, cfg.max) : grid.hi;
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
    // y grid + labels, with the decimals the step needs: a line is never labeled with a value it isn't at
    const sd = grid.decimals;
    for (let v = lo; v <= hi + step / 2; v += step) {
      const y = Y(v).toFixed(1);
      out += `<line x1="${x0}" x2="${x1}" y1="${y}" y2="${y}" class="cgrid"/><text x="${x0 - 6}" y="${y}" class="cy">${v.toFixed(sd)}${unit}</text>`;
    }
    // time labels on round hours / days (core/plot.js), as many as the width has room for
    timeTicks(start, end, x1 - x0).forEach(({ t, label, major }) => {
      const x = X(t); if (x < x0 + 14 || x > x1 - 14) return;
      out += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${y0}" y2="${y1}" class="cgrid v${major ? ' major' : ''}"/><text x="${x.toFixed(1)}" y="${Hp - 6}" class="cx${major ? ' major' : ''}">${label}</text>`;
    });
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
    const line = svg.querySelector('.ccur'); if (!line) return; line.removeAttribute('hidden');
    line.setAttribute('x1', x); line.setAttribute('x2', x); line.setAttribute('y1', g.y0); line.setAttribute('y2', g.y1);
    const d = new Date(t);
    tip.innerHTML = `<b>${d.toLocaleDateString([], { weekday: 'short' })} ${d.toLocaleTimeString([], timeOpts({ hour: 'numeric', minute: '2-digit' }))}</b>` +
      cfg.series.map((s, i) => `<span style="--t:var(--${s.tone || 'mist'})"><i></i>${esc(s.name)} ${fmt(at(g.all[i]))}</span>`).join('');
    tip.hidden = false; tip.style.left = Math.min(x + 10, r.width - tip.offsetWidth - 4) + 'px';
  };
  const hideTip = () => { tip.hidden = true; const l = svg.querySelector('.ccur'); if (l) l.setAttribute('hidden', ''); };
  readout(plot, inspect, hideTip);   // touch / hover, and the moment it stays after a touch (core/readout.js)

  el.addEventListener('click', (ev) => {
    if (ev.target.closest('.cexp')) { openTrend({ title: cfg.title, unit: cfg.unit, decimals: cfg.decimals, floor: cfg.min, minSpan: cfg.minSpan,
      series: cfg.series.map((s) => ({ entity: s.entity, name: s.name, tone: s.tone, scale: s.scale })), warn: cfg.warn, crit: cfg.crit, ...cfg.trend }); return; }
    const b = ev.target.closest('.crange'); if (!b) return;
    hours = +b.dataset.h; el.querySelectorAll('.crange').forEach((x) => x.classList.toggle('on', x === b)); load();
  });
  new ResizeObserver(draw).observe(plot);
  // Kept current: asked again every REFRESH ms while it is on screen (a chart left open on a wall panel would otherwise end
  // at the moment it was loaded), and at once when it is shown again after longer than that. Not while someone reads a
  // value off it (the readout is up), and not while the page is hidden or the connection is down.
  let seen = false;
  const due = () => seen && !document.hidden && connected() && tip.hidden && Date.now() - lastLoad > REFRESH;
  new IntersectionObserver((e) => { seen = e[e.length - 1].isIntersecting; if (due()) load(!!data); }).observe(el);
  setInterval(() => { if (due()) load(!!data); }, 30e3);
  // a period is read off entities: asked once they have arrived, and again whenever one of them changes
  if (cfg.period) watch(cfg.follow || [], () => { if (R) runs(); load(!!data); });
  else if (connected()) load(); else onReady(() => { if (!data) load(); });
  return el;
}

const REFRESH = 5 * 60e3;   // ms between refreshes of a chart that stays on screen
