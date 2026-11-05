// Thermostat: a dial (drag a set point along the arc), current temperature and humidity in the middle,
// − / + per set point, HVAC mode and fan mode. Changes are sent 800 ms after the last touch.
// { type: 'thermostat', entity, modes: ['off', 'heat', 'cool', 'heat_cool'], range: [55, 85] (default; [5, 30] for °C) }
import { h, icon, setText, setHTML, toggle, setTone, cap } from '../core/dom.js';
import { st, watch, optimistic, dropOptimistic, tapStart } from '../core/store.js';
import { call } from '../core/ha.js';
import { deg, metric } from '../core/units.js';

const MODE = { off: ['power', 'Off', 'stone'], heat: ['fire', 'Heat', 'ember'], cool: ['snowflake', 'Cool', 'mist'], heat_cool: ['thermostat-auto', 'Auto', 'sage'], fan_only: ['fan', 'Fan', 'mist'], dry: ['water-percent', 'Dry', 'lamp'] };
const ACTION = { heating: ['fire', 'Heating', 'ember'], cooling: ['snowflake', 'Cooling', 'mist'], idle: ['pause-circle-outline', 'Idle', 'stone'], off: ['power', 'Off', 'stone'], fan: ['fan', 'Fan', 'mist'], drying: ['water-percent', 'Drying', 'lamp'] };
const A0 = 135, SWEEP = 270, R = 100, C = 120;   // arc: starts bottom-left, 270° clockwise; viewBox 240x240

const GRAB = 36;   // how close a touch must be to a knob, in dial units (the dial is 240 across)
const pol = (deg, r = R) => { const a = (deg * Math.PI) / 180; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
const arc = (d0, d1, r = R) => { if (d1 - d0 < 0.5) return ''; const [x0, y0] = pol(d0, r), [x1, y1] = pol(d1, r); return `M${x0.toFixed(1)},${y0.toFixed(1)}A${r},${r} 0 ${d1 - d0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)},${y1.toFixed(1)}`; };

export default function thermostat(cfg) {
  const id = cfg.entity, modes = cfg.modes || ['off', 'heat', 'cool', 'heat_cool'];
  const el = h(`<div class="thermo">
    <div class="tdial"><svg viewBox="0 0 240 240" class="tsvg"></svg>
      <div class="tmid"><div class="tact"></div><div class="tbig"></div><div class="tnow sub"></div></div></div>
    <div class="tsets"></div>
    <div class="segments tmodes">${modes.map((m) => `<button class="chip seg" data-m="${m}">${icon(MODE[m] ? MODE[m][0] : 'thermostat')}${MODE[m] ? MODE[m][1] : cap(m)}</button>`).join('')}</div>
    <div class="tfan"><span class="sub">Fan</span><div class="segments"></div></div></div>`);
  const svg = el.querySelector('.tsvg'), act = el.querySelector('.tact'), big = el.querySelector('.tbig'), now = el.querySelector('.tnow');
  const sets = el.querySelector('.tsets'), segs = [...el.querySelectorAll('.tmodes .seg')], fanRow = el.querySelector('.tfan'), fanSegs = fanRow.querySelector('.segments');
  let local = null, sendT = 0, t0 = 0, drag = null;

  const range = (a) => { const r = cfg.range || (metric() ? [5, 30] : [55, 85]); return [Math.max(r[0], a.min_temp || r[0]), Math.min(r[1], a.max_temp || r[1])]; };
  const vals = (a) => local || { lo: a.target_temp_low, hi: a.target_temp_high, t: a.temperature };
  const keys = (e, v) => (e.state === 'off' ? [] : v.lo != null && v.hi != null ? ['lo', 'hi'] : v.t != null ? ['t'] : []);
  const toneOf = (k, s) => (k === 'lo' || (k === 't' && s !== 'cool') ? 'ember' : 'mist');
  const f = (x, step) => (+x).toFixed(step < 1 || +x % 1 ? 1 : 0);
  const stepOf = (a) => a.target_temp_step || (metric() ? 0.5 : 1);

  const draw = () => {
    const e = st(id); if (!e) return;
    const a = e.attributes, s = e.state, step = stepOf(a), [mn, mx] = range(a), v = vals(a), ks = keys(e, v);
    const ang = (x) => A0 + (Math.max(mn, Math.min(mx, x)) - mn) / (mx - mn) * SWEEP;
    const ac = ['unavailable', 'unknown'].includes(s) ? ['help-circle-outline', 'Unavailable', 'stone'] : ACTION[a.hvac_action] || ACTION[s] || ACTION.idle;
    setTone(el, ac[2]); toggle(el, 'on', a.hvac_action === 'heating' || a.hvac_action === 'cooling');
    let g = `<defs><linearGradient id="tg-${id}" x1="0" x2="1"><stop offset="0" stop-color="rgb(var(--ember))"/><stop offset="1" stop-color="rgb(var(--mist))"/></linearGradient></defs>`;
    g += `<path d="${arc(A0, A0 + SWEEP)}" class="ttrack"/>`;
    for (let i = 0; i <= 30; i++) { const d = A0 + (i / 30) * SWEEP, [x0, y0] = pol(d, R - 16), [x1, y1] = pol(d, R - (i % 5 ? 20 : 23)); g += `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" class="ttick"/>`; }
    if (ks.length === 2) g += `<path d="${arc(ang(v.lo), ang(v.hi))}" class="tband" stroke="url(#tg-${id})"/>`;
    else if (ks.length === 1) g += s === 'cool' ? `<path d="${arc(ang(v.t), A0 + SWEEP)}" class="tband" stroke="rgb(var(--mist))"/>` : `<path d="${arc(A0, ang(v.t))}" class="tband" stroke="rgb(var(--ember))"/>`;
    if (a.current_temperature != null) { const [x0, y0] = pol(ang(a.current_temperature), R - 13), [x1, y1] = pol(ang(a.current_temperature), R + 13); g += `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" class="tcurm"/>`; }
    ks.forEach((k) => { const [x, y] = pol(ang(v[k])); g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" class="tknob${drag && drag.k === k ? ' on' : ''}" style="--t:var(--${toneOf(k, s)})" data-k="${k}"/>`; });
    const [lx, ly] = pol(A0, R + 2), [rx, ry] = pol(A0 + SWEEP, R + 2);
    g += `<text x="${lx - 2}" y="${ly + 18}" class="tlim">${mn}°</text><text x="${rx + 2}" y="${ry + 18}" class="tlim">${mx}°</text>`;
    svg.innerHTML = g;
    setHTML(act, `${icon(ac[0])}<span>${ac[1]}</span>`); act.style.setProperty('--t', `var(--${ac[2]})`);
    setHTML(big, ks.length === 2 ? `<span style="color:rgb(var(--ember))">${f(v.lo, step)}</span><i>–</i><span style="color:rgb(var(--mist))">${f(v.hi, step)}</span>`
      : ks.length === 1 ? `<span style="color:rgb(var(--${toneOf('t', s)}))">${f(v.t, step)}°</span>` : `<span>${a.current_temperature != null ? deg(a.current_temperature) + '°' : '—'}</span>`);
    setText(now, ks.length ? `Now ${a.current_temperature != null ? deg(a.current_temperature) + '°' : '—'}${a.current_humidity != null ? ' · ' + Math.round(a.current_humidity) + '%' : ''}` : (a.current_humidity != null ? Math.round(a.current_humidity) + '% humidity' : ''));
    const row = (k, label) => `<div class="tset" style="--t:var(--${toneOf(k, s)})"><button class="rbtn" data-k="${k}" data-d="-${step}">${icon('minus')}</button><div class="tsl"><span class="sub">${label}</span><span class="tval">${v[k] != null ? f(v[k], step) + '°' : '—'}</span></div><button class="rbtn" data-k="${k}" data-d="${step}">${icon('plus')}</button></div>`;
    setHTML(sets, ks.length === 2 ? row('lo', 'Heat to') + row('hi', 'Cool to') : ks.length ? row('t', s === 'cool' ? 'Cool to' : 'Heat to') : '<div class="sub toff">Thermostat is off</div>');
    segs.forEach((b) => { const m = b.dataset.m; setTone(b, MODE[m] ? MODE[m][2] : 'mist'); toggle(b, 'on', s === m); });
    const fm = a.fan_modes || [];
    fanRow.hidden = !fm.length;
    if (fanSegs.children.length !== fm.length) fanSegs.innerHTML = fm.map((m) => `<button class="chip seg" data-f="${m}">${icon(m === 'on' ? 'fan' : m === 'auto' ? 'fan-auto' : 'fan')}${cap(m)}</button>`).join('');
    [...fanSegs.children].forEach((b) => { setTone(b, 'mist'); toggle(b, 'on', a.fan_mode === b.dataset.f); });
  };
  watch([id], draw);

  const begin = (ev) => { clearTimeout(sendT); const a = st(id).attributes; if (!local) { local = { lo: a.target_temp_low, hi: a.target_temp_high, t: a.temperature }; t0 = tapStart(ev); } };
  const clamp = (e) => { const a = e.attributes, [mn, mx] = range(a);
    ['lo', 'hi', 't'].forEach((k) => { if (local[k] != null) local[k] = Math.max(mn, Math.min(mx, local[k])); });
    if (local.lo != null && local.hi != null) { const gap = 2; if (drag && drag.k === 'lo' && local.lo > local.hi - gap) local.lo = local.hi - gap; if ((!drag || drag.k === 'hi') && local.hi < local.lo + gap) local.hi = local.lo + gap; if (local.lo > local.hi - gap) local.lo = local.hi - gap; } };
  const send = () => {
    clearTimeout(sendT);
    sendT = setTimeout(() => {
      const e = st(id), v = local; local = null; if (!v) return;
      const data = v.lo != null && v.hi != null && e.state === 'heat_cool' ? { target_temp_low: v.lo, target_temp_high: v.hi } : { temperature: v.t };
      if (Object.keys(data).every((x) => e.attributes[x] === data[x])) return;   // touched, not moved
      if (call('climate.set_temperature', data, id, () => dropOptimistic(id))) optimistic(id, null, data, (r) => Object.keys(data).every((x) => r.attributes[x] === data[x]), t0);
    }, 800);
  };

  // drag a knob; a touch anywhere else on the dial does nothing, so a thumb scrolling the pop-up can't move a set point
  const angleTo = (ev) => { const r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) * 240 / r.width - C, y = (ev.clientY - r.top) * 240 / r.height - C;
    let d = (Math.atan2(y, x) * 180) / Math.PI; if (d < 0) d += 360; let rel = d - A0; if (rel < -45) rel += 360; return { rel, dist: Math.hypot(x, y) }; };
  const knobAt = (p) => {
    const e = st(id); if (!e) return null; const a = e.attributes, v = vals(a), ks = keys(e, v), [mn, mx] = range(a), r = svg.getBoundingClientRect();
    const x = (p.clientX - r.left) * 240 / r.width, y = (p.clientY - r.top) * 240 / r.height;
    const off = (k) => { const [kx, ky] = pol(A0 + (Math.max(mn, Math.min(mx, v[k])) - mn) / (mx - mn) * SWEEP); return Math.hypot(kx - x, ky - y); };
    const k = ks.reduce((best, c) => (best == null || off(c) < off(best) ? c : best), null);
    return k != null && off(k) <= GRAB ? k : null;
  };
  svg.addEventListener('touchstart', (ev) => { if (knobAt(ev.touches[0]) != null) ev.preventDefault(); }, { passive: false });
  svg.addEventListener('pointerdown', (ev) => {
    const k = knobAt(ev); if (k == null) return;
    begin(ev); drag = { k, pid: ev.pointerId }; svg.setPointerCapture(ev.pointerId); ev.preventDefault();
  });
  const move = (ev) => {
    if (!drag || ev.pointerId !== drag.pid) return;
    const e = st(id), a = e.attributes, [mn, mx] = range(a), step = stepOf(a), { rel } = angleTo(ev);
    local[drag.k] = Math.round((mn + (Math.max(0, Math.min(SWEEP, rel)) / SWEEP) * (mx - mn)) / step) * step; clamp(e); draw();
  };
  svg.addEventListener('pointermove', move);
  const end = (ev) => { if (!drag || ev.pointerId !== drag.pid) return; drag = null; draw(); send(); };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);

  el.addEventListener('click', (ev) => {
    const seg = ev.target.closest('.tmodes .seg');
    if (seg) { const m = seg.dataset.m, t = tapStart(ev); if (call('climate.set_hvac_mode', { hvac_mode: m }, id, () => dropOptimistic(id))) optimistic(id, m, null, (r) => r.state === m, t); return; }
    const fb = ev.target.closest('[data-f]');
    if (fb) { const m = fb.dataset.f, t = tapStart(ev); if (call('climate.set_fan_mode', { fan_mode: m }, id, () => dropOptimistic(id))) optimistic(id, null, { fan_mode: m }, (r) => r.attributes.fan_mode === m, t); return; }
    const b = ev.target.closest('.rbtn[data-k]'); if (!b) return;
    const e = st(id); begin(ev);
    const k = b.dataset.k; local[k] = Math.round(((+local[k] || 0) + parseFloat(b.dataset.d)) * 10) / 10;
    drag = { k }; clamp(e); drag = null; draw(); send();
  });
  return el;
}
