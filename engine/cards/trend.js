// History drill-in, the one card in the #trend pop-up: whatever core/trend.js openTrend() was given, over a chosen range.
// Range chips (6 h … 1 y), Now / Low / Average / High, a chart with real axes (values with their unit, times or dates),
// a low–high band behind the average line, warn / crit lines (always shown), touch / hover to read any moment, Y / X zoom for
// troubleshooting (buttons; wheel = Y, Shift + wheel = X; X zooms around the moment last tapped; not remembered), an events list.
// { type: 'trend' }   (no options: the selection comes from openTrend)
import { h, esc, icon, setText } from '../core/dom.js';
import { st, tick } from '../core/store.js';
import { connected, onReady } from '../core/ha.js';
import { sel, RANGES, load, spans } from '../core/trend.js';
import { stripCell } from './strip.js';
import { timeOpts, hourShort } from '../core/units.js';

const css = (tone) => `rgb(var(--${tone}))`;
let rangeKey = '24h';   // remembered between pop-ups
const HOUR = 3600e3, DAY = 864e5;
const MON = (d) => d.toLocaleDateString([], { month: 'short' });
const hr = hourShort;
const tm = (d) => d.toLocaleTimeString([], timeOpts({ hour: 'numeric', minute: '2-digit' }));
const dayName = (d) => d.toLocaleDateString([], { weekday: 'short' });
const dateShort = (d) => `${MON(d)} ${d.getDate()}`;

export default function trend() {
  const el = h(`<div class="trend">
    <div class="tr-bar"><span class="cranges">${RANGES.map((r) => `<button class="crange" data-k="${r.key}">${r.key}</button>`).join('')}</span><span class="tr-zoom"><span>Y</span><button class="crange" data-z="y-" title="Larger Y range">−</button><button class="crange" data-z="y+" title="Smaller Y range">+</button><span>X</span><button class="crange" data-z="x-" title="Zoom time out">−</button><button class="crange" data-z="x+" title="Zoom time in">+</button><button class="crange" data-z="reset" hidden>Reset</button></span><span class="tr-src"></span></div>
    <div class="strip tr-stats"></div>
    <div class="tr-plot"><svg class="csvg"></svg><div class="ctip" hidden></div></div>
    <div class="tr-note"></div><div class="tr-ev" hidden></div></div>`);
  const plot = el.querySelector('.tr-plot'), svg = el.querySelector('svg'), tip = el.querySelector('.ctip'), statsEl = el.querySelector('.tr-stats');
  const srcEl = el.querySelector('.tr-src'), note = el.querySelector('.tr-note');
  const evEl = el.querySelector('.tr-ev'), resetBtn = el.querySelector('[data-z="reset"]');
  let spec = null, data = null, seq = 0, loadedAt = 0, geo = null;
  let zy = 1, zx = 1, focus = null;   // this view's zoom: Y and X factors, the moment X zooms around; gone with the range or the pop-up
  const zoomed = () => { resetBtn.hidden = zy === 1 && zx === 1; };
  const unzoom = () => { zy = 1; zx = 1; focus = null; zoomed(); };
  const zoom = (k) => { if (k === 'reset') unzoom(); else if (k[0] === 'y') zy = Math.max(0.25, Math.min(64, zy * (k[1] === '+' ? 1.5 : 1 / 1.5)));
    else zx = Math.max(1, Math.min(32, zx * (k[1] === '+' ? 1.5 : 1 / 1.5))); if (Math.abs(zy - 1) < 0.01) zy = 1; if (zx < 1.01) zx = 1; zoomed(); draw(); };

  const dec = () => (spec.decimals != null ? spec.decimals : 0);
  const unit = () => spec.unit || '';
  // '%' and degrees go on every number; any other unit gets a space in values and one caption above the axis
  const tag = () => (unit() === '%' ? '%' : /^°/.test(unit()) ? '°' : '');
  const fmt = (v, d = dec()) => (v == null || isNaN(v) ? '–' : (+v).toFixed(d) + (tag() || (unit() ? ' ' + unit() : '')));
  const range = () => RANGES.find((r) => r.key === rangeKey) || RANGES[1];
  const nowOf = (s) => { let t = 0; for (const id of [].concat(s.entity)) { const v = parseFloat((st(id) || {}).state); if (isNaN(v)) return null; t += v; } return t * (s.scale || 1); };

  // header of the pop-up this card lives in
  // the live reading sits in the header (it doesn't depend on the range); several series: their own strip has it
  const subhead = () => { const pop = el.closest('.popup'); if (!pop || !spec) return;
    setText(pop.querySelector('.phead .sub'), spec.series.length === 1 && nowOf(spec.series[0]) != null ? `${fmt(nowOf(spec.series[0]))} now` : 'History'); };
  const header = () => {
    const pop = el.closest('.popup'); if (!pop) return;
    pop.style.setProperty('--t', `var(--${spec.tone || 'mist'})`);
    setText(pop.querySelector('.phead .name'), spec.title || 'History');
    subhead();
    pop.querySelector('.phead .ic').innerHTML = icon(spec.icon || 'chart-line');
  };

  const fetch = () => {
    if (!spec) return;
    const my = ++seq; plot.classList.add('loading'); loadedAt = Date.now();
    el.querySelectorAll('.crange').forEach((b) => b.classList.toggle('on', b.dataset.k === rangeKey));
    const n = Math.max(60, Math.min(360, Math.round((plot.clientWidth || 720) / 3)));
    load(spec, range(), n).then((d) => { if (my !== seq) return; data = d; plot.classList.remove('loading'); summary(); draw(); })
      .catch(() => { if (my !== seq) return; plot.classList.remove('loading'); data = null; svg.innerHTML = ''; setText(note, 'Could not load the history.'); });
  };

  // the events list: what history still has, plus the site's own log for older ones (overlapping = the same event: history's, it has the true start), newest first
  const when = (t) => { const d = new Date(t); return `${dateShort(d)}, ${tm(d)}`; };
  const length = (ms) => { const m = Math.round(ms / 60e3), hh = Math.floor(m / 60); return !m ? 'under 1 min' : hh ? `${hh} h ${m % 60} min` : `${m} min`; };
  const events = () => {
    const ev = spec.events; evEl.hidden = !ev; if (!ev) return; const my = seq;
    spans(ev.entity, 10 * DAY).then((rows) => { if (my !== seq) return;
      const log = ((st(ev.log) || {}).attributes || {}).log || [];
      const old = log.map((x) => ({ start: +new Date(x.start), end: +new Date(x.end) })).filter((x) => !rows.some((r) => x.start < (r.end || Infinity) && x.end > r.start));
      const all = [...old, ...rows].sort((a, b) => b.start - a.start), row = (a, b, c) => `<span>${esc(a)}</span><span>${esc(b)}</span><span>${esc(c)}</span>`;
      evEl.innerHTML = `<div class="label">${esc(ev.title)}</div>` + (all.length ? `<div class="tr-evs"><div class="tr-evr head">${row('Started', 'Ended', 'Length')}</div>${all.map((x) =>
        `<div class="tr-evr">${row(when(x.start), x.end ? when(x.end) : 'Still going', length((x.end || Date.now()) - x.start))}</div>`).join('')}</div>` : '<div class="sub">None recorded</div>');
    }).catch(() => { evEl.innerHTML = '<div class="sub">Could not load the list.</div>'; });
  };

  // Now / Low / Average / High for one series; a legend with now + average for several
  const summary = () => {
    const r = range(), src = data.fallback ? 'raw' : data.src;
    setText(srcEl, src === 'raw' ? (r.ms <= DAY ? 'Every reading' : 'Recorded readings') : src === 'hour' ? 'Hourly average · band: hourly low–high' : 'Daily average · band: daily low–high');
    const notes = [];
    if (data.fallback) notes.push('This sensor has no long-term statistics, so only the last 10 days of readings are kept.');
    if (data.first && data.first - data.start > r.ms * 0.04) notes.push(`History starts ${new Date(data.first).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}.`);
    setText(note, notes.join(' '));
    // one strip under the range chips: Low · Average · High for the range (several series: each one's now + average)
    const cell = (k, label, sub, v, key = '', aside = '') => stripCell(label, sub, fmt(v), key, aside).replace('class="sti"', `class="sti" data-k="${k}"`);
    if (spec.series.length === 1) {
      const b = data.series[0].filter((x) => x.mean != null);
      if (!b.length) { statsEl.innerHTML = ''; return; }
      const lo = b.reduce((a, x) => ((x.lo != null ? x.lo : x.mean) < (a.lo != null ? a.lo : a.mean) ? x : a)), hi = b.reduce((a, x) => ((x.hi != null ? x.hi : x.mean) > (a.hi != null ? a.hi : a.mean) ? x : a));
      const avg = b.reduce((a, x) => a + x.mean, 0) / b.length;
      const when = (x) => { const d = new Date(x.t); return src === 'day' ? dateShort(d) : r.ms <= DAY ? tm(d) : `${dayName(d)} ${hr(d)}`; };
      // statistics end at the last full hour / day, so the reading now can be outside them: it counts too
      const nv = nowOf(spec.series[0]); let lv = lo.lo != null ? lo.lo : lo.mean, hv = hi.hi != null ? hi.hi : hi.mean, lw = when(lo), hw = when(hi);
      if (nv != null && nv < lv) { lv = nv; lw = 'now'; } if (nv != null && nv > hv) { hv = nv; hw = 'now'; }
      statsEl.style.setProperty('--n', 3);
      statsEl.innerHTML = cell('lo', 'Low', lw, lv) + cell('avg', 'Average', r.key, avg) + cell('hi', 'High', hw, hv);
    } else {
      statsEl.style.setProperty('--n', Math.min(3, spec.series.length));
      statsEl.innerHTML = spec.series.map((s, i) => { const b = data.series[i].filter((x) => x.mean != null), avg = b.length ? b.reduce((a, x) => a + x.mean, 0) / b.length : null;
        return cell('s' + i, s.name, '', nowOf(s), `<i style="--t:var(--${s.tone || 'mist'})"></i>`, 'avg ' + fmt(avg)).replace('class="sti"', `class="sti leg" data-i="${i}"`); }).join('');
    }
  };
  const live = () => {
    if (!spec || el.offsetParent == null) return;
    subhead();
    if (spec.series.length > 1) statsEl.querySelectorAll('.leg').forEach((x) => { const b = x.querySelector('b'); if (b.firstChild) b.firstChild.textContent = fmt(nowOf(spec.series[+x.dataset.i])); });
  };

  function draw() {
    if (!data || !spec) return;
    const W = plot.clientWidth, Hp = plot.clientHeight; if (!W || !Hp) return;
    // the moments on screen: all of them, or the X zoom's window around the last moment tapped
    const fs = data.start, fe = data.end, vw = (fe - fs) / zx, start = Math.max(fs, Math.min(fe - vw, (focus != null ? focus : (fs + fe) / 2) - vw / 2)), end = start + vw;
    const period = data.src === 'hour' ? HOUR : data.src === 'day' ? DAY : (fe - fs) / Math.max(1, data.series[0].length);
    const inView = data.series.flat().filter((b) => b.t >= start && b.t <= end);
    const vals = (inView.some((b) => b.mean != null) ? inView : data.series.flat()).flatMap((b) => [b.mean, b.lo, b.hi]).filter((v) => v != null);
    if (!vals.length) { svg.setAttribute('viewBox', `0 0 ${W} ${Hp}`); svg.innerHTML = `<text x="${W / 2}" y="${Hp / 2}" class="cnone">No history in this period</text>`; geo = null; return; }
    let lo = Math.min(...vals), hi = Math.max(...vals);
    // Y zoom centres on the average in view, where the line lives, so one spike doesn't push it off the chart
    const means = (inView.some((b) => b.mean != null) ? inView : data.series.flat()).map((b) => b.mean).filter((v) => v != null), dataMid = means.reduce((x, v) => x + v, 0) / means.length;
    // thresholds are always on the chart: the axis stretches to show them, either way (higher or lower can be the bad side)
    const lines = [['warn', 'lamp'], ['crit', 'ember']].filter(([k]) => spec[k] != null).map(([k, t]) => [spec[k], t]);
    lines.forEach(([v]) => { lo = Math.min(lo, v); hi = Math.max(hi, v); });
    const span = Math.max(hi - lo, spec.minSpan || 1), mid = (hi + lo) / 2;
    lo = mid - span / 2 - span * 0.08; hi = mid + span / 2 + span * 0.08;
    const limit = () => { if (spec.floor != null && lo < spec.floor) { hi += spec.floor - lo; lo = spec.floor; }
      if (spec.ceil != null && hi > spec.ceil) { lo = Math.max(spec.floor != null ? spec.floor : -Infinity, lo - (hi - spec.ceil)); hi = spec.ceil; } };
    limit();
    // Y zoom: around the data, not the thresholds (a line outside the new range leaves the chart)
    if (zy !== 1) { const half = (hi - lo) / 2 / zy; lo = dataMid - half; hi = dataMid + half; limit(); }
    const step = niceStep((hi - lo) / 5); lo = Math.floor(lo / step + 1e-9) * step; hi = Math.ceil(hi / step - 1e-9) * step;
    const sd = Math.min(3, (String(+step.toPrecision(6)).split('.')[1] || '').length);   // 2.5 -> 1 decimal, 0.25 -> 2
    const yl = (v) => (+v.toFixed(sd)).toLocaleString([], { minimumFractionDigits: sd, maximumFractionDigits: sd }) + tag();
    const labW = Math.max(...[lo, hi].map((v) => yl(v).length)) * 7.4 + 12;   // --fs-axis digits
    const P = { l: Math.max(30, labW), r: 14, t: tag() || !unit() ? 10 : 22, b: 26 };
    const x0 = P.l, x1 = W - P.r, y0 = P.t, y1 = Hp - P.b;
    const X = (t) => x0 + ((t - start) / (end - start)) * (x1 - x0), Y = (v) => y1 - ((v - lo) / (hi - lo)) * (y1 - y0);
    const t0 = spec.series[0].tone || spec.tone || 'mist';
    let out = `<defs><linearGradient id="trg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${css(t0)}" stop-opacity=".26"/><stop offset="1" stop-color="${css(t0)}" stop-opacity="0"/></linearGradient><clipPath id="trc"><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}"/></clipPath></defs>`;
    // y grid + labels (the unit on each label, or one caption above the axis)
    for (let v = lo; v <= hi + step / 2; v += step) { const y = Y(v).toFixed(1); out += `<line x1="${x0}" x2="${x1}" y1="${y}" y2="${y}" class="cgrid"/><text x="${x0 - 7}" y="${y}" class="cy">${yl(v)}</text>`; }
    if (!tag() && unit()) out += `<text x="${x0 - 7}" y="8" class="cy cunit">${esc(unit())}</text>`;
    // time axis
    xTicks(start, end, x1 - x0).forEach(({ t, label, major }) => { const x = X(t); if (x < x0 + 16 || x > x1 - 16) return;
      out += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${y0}" y2="${y1}" class="cgrid v${major ? ' major' : ''}"/><text x="${x.toFixed(1)}" y="${Hp - 7}" class="cx${major ? ' major' : ''}">${label}</text>`; });
    out += '<g clip-path="url(#trc)">';
    // where the data starts, when that's inside the range
    if (data.first && X(data.first) > x0 + 24) { const x = X(data.first).toFixed(1); out += `<rect x="${x0}" y="${y0}" width="${(x - x0).toFixed(1)}" height="${y1 - y0}" class="tr-none"/>`; }
    // series: low–high band, then the average line; a gap longer than 1.5 buckets breaks both
    const runs = (list) => { const rs = []; let r = []; list.forEach((b, i) => { const gap = i && b.t - list[i - 1].t > period * 1.5;
      if (b.mean == null || gap) { if (r.length) rs.push(r); r = []; } if (b.mean != null) r.push(b); }); if (r.length) rs.push(r); return rs; };
    data.series.forEach((list, i) => {
      const s = spec.series[i], tone = s.tone || spec.tone || 'mist';
      runs(list).forEach((r) => {
        if (r.length === 1) { out += `<circle cx="${X(r[0].t).toFixed(1)}" cy="${Y(r[0].mean).toFixed(1)}" r="2.5" fill="${css(tone)}"/>`; return; }
        if (r.every((b) => b.lo != null && b.hi != null) && r.some((b) => b.hi - b.lo > 1e-9))
          out += `<path d="${r.map((b, k) => `${k ? 'L' : 'M'}${X(b.t).toFixed(1)},${Y(b.hi).toFixed(1)}`).join('')}${r.slice().reverse().map((b) => `L${X(b.t).toFixed(1)},${Y(b.lo).toFixed(1)}`).join('')}Z" fill="${css(tone)}" class="tr-band"/>`;
        const line = r.map((b, k) => `${k ? 'L' : 'M'}${X(b.t).toFixed(1)},${Y(b.mean).toFixed(1)}`).join('');
        // one series: the same soft fill under the line as the traces on the pages (core/spark.js)
        if (spec.series.length === 1) out += `<path d="${line}L${X(r[r.length - 1].t).toFixed(1)},${y1}L${X(r[0].t).toFixed(1)},${y1}Z" fill="url(#trg)"/>`;
        out += `<path d="${line}" stroke="${css(tone)}" class="tr-line"/>`;
      });
    });
    out += '</g>';
    // warn / crit lines over the data, labelled at the right end
    lines.filter(([v]) => v >= lo && v <= hi).forEach(([v, t]) => { const y = Y(v).toFixed(1), lab = fmt(v, 0), w = lab.length * 6.2 + 8;
      out += `<line x1="${x0}" x2="${x1}" y1="${y}" y2="${y}" stroke="${css(t)}" class="tr-th"/><rect x="${(x1 - w).toFixed(1)}" y="${(Y(v) - 8).toFixed(1)}" width="${w.toFixed(1)}" height="16" rx="8" class="tr-thb" stroke="${css(t)}"/><text x="${(x1 - w / 2).toFixed(1)}" y="${y}" class="tr-thl">${esc(lab)}</text>`; });
    out += '<line class="ccur" hidden/>' + data.series.map((_, i) => `<circle class="tr-dot" data-i="${i}" r="4" hidden/>`).join('');
    svg.setAttribute('viewBox', `0 0 ${W} ${Hp}`); svg.setAttribute('width', W); svg.setAttribute('height', Hp);
    svg.innerHTML = out;
    geo = { X, Y, x0, x1, y0, y1, start, end };
  }

  // touch / hover: snap to the nearest bucket, every series at that moment
  const inspect = (ev) => {
    if (!geo || !data) return;
    const r = plot.getBoundingClientRect(), px = Math.max(geo.x0, Math.min(geo.x1, ev.clientX - r.left));
    const t = geo.start + ((px - geo.x0) / (geo.x1 - geo.x0)) * (geo.end - geo.start);
    const near = data.series.map((list) => { let best = null; for (const b of list) if (b.mean != null && (!best || Math.abs(b.t - t) < Math.abs(best.t - t))) best = b; return best; });
    const ref = near.find(Boolean); if (!ref) return;
    focus = ref.t;
    const x = geo.X(ref.t), line = svg.querySelector('.ccur'); line.removeAttribute('hidden');
    ['x1', 'x2'].forEach((a) => line.setAttribute(a, x)); line.setAttribute('y1', geo.y0); line.setAttribute('y2', geo.y1);
    svg.querySelectorAll('.tr-dot').forEach((d) => { const b = near[+d.dataset.i]; if (!b) return d.setAttribute('hidden', ''); d.removeAttribute('hidden');
      d.setAttribute('cx', geo.X(b.t)); d.setAttribute('cy', geo.Y(b.mean)); d.setAttribute('fill', css(spec.series[+d.dataset.i].tone || spec.tone || 'mist')); });
    const d = new Date(ref.t), src = data.fallback ? 'raw' : data.src;
    const head = src === 'day' ? `${dayName(d)} ${dateShort(d)}` : src === 'hour' ? `${dayName(d)} ${dateShort(d)}, ${hr(new Date(ref.t - HOUR / 2))}–${hr(new Date(ref.t + HOUR / 2))}` : `${dayName(d)} ${dateShort(d)}, ${tm(d)}`;
    tip.innerHTML = `<b>${esc(head)}</b>` + spec.series.map((s, i) => { const b = near[i]; if (!b) return '';
      const band = b.lo != null && b.hi != null && b.hi - b.lo > 1e-9 ? `<em>${esc(fmt(b.lo))} – ${esc(fmt(b.hi))}</em>` : '';
      return `<span style="--t:var(--${s.tone || spec.tone || 'mist'})"><i></i><strong>${esc(fmt(b.mean))}</strong>${spec.series.length > 1 ? esc(s.name) : ''}${band}</span>`; }).join('');
    tip.hidden = false;
    const w = tip.offsetWidth; tip.style.left = (x + 12 + w > r.width ? x - 12 - w : x + 12) + 'px';
  };
  const hideTip = () => { tip.hidden = true; svg.querySelectorAll('.ccur, .tr-dot').forEach((x) => x.setAttribute('hidden', '')); };
  plot.addEventListener('pointerdown', inspect); plot.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'mouse' || ev.buttons) inspect(ev); });
  plot.addEventListener('pointerleave', hideTip); plot.addEventListener('pointerup', (ev) => { if (ev.pointerType !== 'mouse') setTimeout(hideTip, 2500); });

  plot.addEventListener('wheel', (ev) => { ev.preventDefault(); zoom((ev.shiftKey ? 'x' : 'y') + ((ev.deltaY || ev.deltaX) < 0 ? '+' : '-')); }, { passive: false });
  el.addEventListener('click', (ev) => { const b = ev.target.closest('.crange'); if (!b) return;
    if (b.dataset.z) zoom(b.dataset.z); else if (b.dataset.k !== rangeKey) { rangeKey = b.dataset.k; unzoom(); fetch(); } });
  const select = () => { spec = sel.spec; if (!spec) return; data = null; svg.innerHTML = ''; statsEl.innerHTML = ''; setText(note, ''); setText(srcEl, ''); evEl.hidden = true; evEl.innerHTML = ''; hideTip(); unzoom(); header();
    const go = () => { fetch(); events(); }; connected() ? go() : onReady(go); };
  window.addEventListener('trend:sel', select);
  new ResizeObserver(draw).observe(plot);
  new IntersectionObserver((e) => { if (e[0].isIntersecting && spec) { header(); if (Date.now() - loadedAt > 60e3) fetch(); } }).observe(el);
  tick(live);
  if (sel.spec) setTimeout(select);   // the pop-up was opened before this card existed
  return el;
}

// time labels: hours for a day or less, days for a week, dates for a month, months for longer; the first of a bigger unit is bolder
function xTicks(start, end, width) {
  const span = end - start, want = Math.max(3, Math.floor(width / 80)), raw = span / want;
  const steps = [[HOUR, 'h'], [2 * HOUR, 'h'], [3 * HOUR, 'h'], [6 * HOUR, 'h'], [12 * HOUR, 'h'], [DAY, 'd'], [2 * DAY, 'd'], [7 * DAY, 'w'], [14 * DAY, 'w'], [1, 'm'], [2, 'm'], [3, 'm']];
  const [n, kind] = steps.find(([s, k]) => (k === 'm' ? s * 30.4 * DAY : s) >= raw * 0.7) || steps[steps.length - 1];
  const out = [], d = new Date(start);
  if (kind === 'h') { d.setMinutes(0, 0, 0); const k = n / HOUR; while (+d < start || d.getHours() % k) d.setHours(d.getHours() + 1); }
  else if (kind === 'd' || kind === 'w') { d.setHours(0, 0, 0, 0); if (+d < start) d.setDate(d.getDate() + 1); if (kind === 'w') while (d.getDay() !== 1) d.setDate(d.getDate() + 1); }
  else { d.setHours(0, 0, 0, 0); d.setDate(1); d.setMonth(d.getMonth() + 1); while (d.getMonth() % n) d.setMonth(d.getMonth() + 1); }
  for (let guard = 0; +d <= end && guard < 60; guard++) {
    const t = new Date(d);
    if (kind === 'h') out.push(t.getHours() === 0 ? { t: +t, label: dayName(t), major: true } : { t: +t, label: hr(t) });
    else if (kind === 'd') out.push(span <= 8 * DAY ? { t: +t, label: `${dayName(t)} ${t.getDate()}`, major: t.getDay() === 1 } : { t: +t, label: dateShort(t), major: t.getDate() === 1 });
    else if (kind === 'w') out.push({ t: +t, label: dateShort(t) });
    else out.push(t.getMonth() === 0 ? { t: +t, label: String(t.getFullYear()), major: true } : { t: +t, label: MON(t) });
    if (kind === 'h') d.setHours(d.getHours() + n / HOUR); else if (kind === 'd') d.setDate(d.getDate() + n / DAY); else if (kind === 'w') d.setDate(d.getDate() + n / DAY); else d.setMonth(d.getMonth() + n);
  }
  return out;
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;   // no 2.5: whole numbers read better (112.5° vs 112°)
}
