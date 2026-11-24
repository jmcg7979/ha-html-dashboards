// Generic entity tile (lights, fans, switches, covers, selects, vacuum, scripts...).
// { type: 'tile', entity, name, icon, span,
//   mode: 'slider' | 'toggle' | 'state' | 'button'
//         default: light/number = slider, fan/switch/input_boolean = toggle, else state.
//         slider works for lights (brightness), number/input_number (value) and media players (volume).
//         button = name only, runs `tap`
//   tone: 'lamp' | (entity) => tone         color when active; a function may return [r, g, b] (the light's own color)
//   active: (entity) => bool                 default: state on/open/playing/cleaning...
//   showState: true, state: (entity) => text
//   ring: battery sensor id or [ids]         battery ring around the icon (lowest wins); or (entity) => 0..100
//   tap / iconTap: action                    see core/actions.js
//   subs: [{ icon, label, name, action, on: ['cleaning'] | { attr, eq }, tone, show: { entity, state } }]
//         label: words on the button; name: what a button with only an icon is called (core/tips.js says it beside it)
//   pills: [{ entity, icon, text: (entity) => string | null (null hides it), tone }]   read-only info pills on the right
//   read-only (state mode, no tap / iconTap / subs) gets .ro: a well inside pop-ups (base.css), not a button
//   icon may be a function of the entity (e.g. lock / lock-open). Active non-slider tiles tint the whole tile (.tile.on). }
import { h, esc, icon, setTone, setText, setHTML, toggle, setRing, cap } from '../core/dom.js';
import { st, num, watch, optimistic, dropOptimistic, tapStart } from '../core/store.js';
import { run } from '../core/actions.js';
import { call } from '../core/ha.js';
import { settings } from '../core/settings.js';

const ACTIVE = ['on', 'open', 'opening', 'closing', 'playing', 'cleaning', 'returning', 'unlocked', 'heat', 'cool', 'heat_cool'];
const HIDE = ['unavailable', 'unknown', 'off', '<not connected>', ''];
const pillText = (p, e) => (p.text ? p.text(e) : !e || HIDE.includes(e.state) ? null : p.iconOnly ? '' : cap(e.state));
const DEFAULT_TONE = { number: 'mist', input_number: 'mist', select: 'mist', sensor: 'mist', light: 'lamp', switch: 'lamp', fan: 'mist', cover: 'mist', media_player: 'mist', vacuum: 'mist', input_boolean: 'mist', script: 'mist' };

export default function tile(cfg) {
  const id = cfg.entity, dom = id ? id.split('.')[0] : '';
  const mode = cfg.mode || (['light', 'number', 'input_number'].includes(dom) ? 'slider' : ['fan', 'switch', 'input_boolean'].includes(dom) ? 'toggle' : id ? 'state' : 'button');
  const model = mode === 'slider' ? MODELS[dom] || MODELS.light : null;
  const subs = cfg.subs || [], pills = cfg.pills || [], icoFn = typeof cfg.icon === 'function' ? cfg.icon : null;
  const ro = mode === 'state' && !cfg.tap && !cfg.iconTap && !subs.length;
  const el = h(`<div class="tile${mode === 'slider' ? ' slider' : ''}${cfg.vertical ? ' vert' : ''}${ro ? ' ro' : ''}">
    <div class="fill"></div>
    <button class="ic">${icon(icoFn ? 'help-circle-outline' : cfg.icon || 'help-circle-outline')}</button>
    <div class="tx"><div class="name">${esc(cfg.name || '')}</div>${cfg.showState === false ? '' : '<div class="sub"></div>'}</div>
    ${pills.length ? `<div class="pills">${pills.map((p) => `<span class="pill" hidden>${p.icon ? icon(p.icon) : ''}<span></span></span>`).join('')}</div>` : ''}
    ${subs.length ? `<div class="subs">${subs.map((s, i) => `<button class="sb" data-i="${i}"${s.name ? ` aria-label="${esc(s.name)}"` : ''}>${s.icon ? icon(s.icon) : ''}${s.label ? esc(s.label) : ''}</button>`).join('')}</div>` : ''}
  </div>`);
  const icEl = el.querySelector('.ic'), fill = el.querySelector('.fill'), sub = el.querySelector('.sub'), sbs = [...el.querySelectorAll('.sb')], pls = [...el.querySelectorAll('.pill')];

  const deps = [id].concat(cfg.ring && typeof cfg.ring !== 'function' ? [].concat(cfg.ring) : []).concat(cfg.deps || []).concat(subs.map((s) => s.show && s.show.entity)).concat(pills.map((p) => p.entity));
  watch(deps, () => {
    const e = st(id), active = cfg.active ? cfg.active(e) : !!e && ACTIVE.includes(e.state);
    const tone = typeof cfg.tone === 'function' ? cfg.tone(e) : cfg.tone || DEFAULT_TONE[dom] || 'mist';
    setTone(el, tone); toggle(icEl, 'on', active); toggle(el, 'on', active && !model); toggle(el, 'pending', e && e.pending);
    if (icoFn) setHTML(icEl, icon(icoFn(e)));
    pls.forEach((b, i) => { const p = pills[i], t = pillText(p, st(p.entity)); b.hidden = t == null; if (t != null) { setText(b.lastChild, t); toggle(b, 'on', !!p.tone); if (p.tone) setTone(b, p.tone); } });
    if (model && !el.classList.contains('drag')) fill.style.width = (e ? model.pct(e) : 0) + '%';
    if (sub && !el.classList.contains('drag')) setText(sub, cfg.state ? cfg.state(e) : model && e && e.state !== 'unavailable' ? model.text(e) : stateText(e, dom));
    if (typeof cfg.ring === 'function') setRing(icEl, cfg.ring(e));
    else if (cfg.ring) { const v = [].concat(cfg.ring).map(num).filter((x) => x != null); setRing(icEl, v.length ? Math.min(...v) : null); }
    sbs.forEach((b, i) => {
      const s = subs[i];
      if (s.show) { const se = st(s.show.entity); b.hidden = !se || se.state !== s.show.state; }
      let on = false;
      if (Array.isArray(s.on)) on = !!e && s.on.includes(e.state);
      else if (s.on && e) on = e.attributes[s.on.attr] === s.on.eq;
      toggle(b, 'on', on); setTone(b, s.tone || tone);
    });
  });

  // taps
  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('.sb');
    if (b) { run(subs[+b.dataset.i].action, { el: b, ev, entity: id }); return; }
    if (ev.target.closest('.ic')) { run(cfg.iconTap || (mode === 'slider' || mode === 'toggle' ? 'toggle' : cfg.tap), { el: icEl, ev, entity: id }); return; }
    if (mode === 'toggle') run(cfg.tap || 'toggle', { el, ev, entity: id });
    else if ((mode === 'state' || mode === 'button') && cfg.tap) run(cfg.tap, { el, ev, entity: id });
  });
  // TV remote OK (core/remote.js): what the icon does (a dimmer can't be tapped at a point)
  el.addEventListener('dash:ok', (ev) => {
    const a = cfg.iconTap || (mode === 'slider' || mode === 'toggle' ? 'toggle' : cfg.tap);
    if (a) { ev.preventDefault(); run(a, { el: icEl, ev, entity: id }); }
  });
  if (model) slider(el, fill, sub, id, model, (e) => (cfg.state ? cfg.state(e) : e.state !== 'unavailable' ? model.text(e) : stateText(e, dom)));
  return el;
}

function stateText(e, dom) {
  if (!e) return '';
  if (e.state === 'unavailable') return 'Unavailable';
  if (dom === 'light') return e.state === 'on' ? (e.attributes.brightness != null ? Math.round(e.attributes.brightness / 2.55) + '%' : 'On') : 'Off';
  if (dom === 'cover') {
    const p = e.attributes.current_position;
    if (e.pending && p != null) return 'Moving to ' + p + '%';
    return e.state === 'closed' ? 'Closed' : e.state === 'open' && p != null && p < 100 ? 'Open · ' + p + '%' : cap(e.state);
  }
  const u = e.attributes.unit_of_measurement;
  return u ? (isNaN(parseFloat(e.state)) ? cap(e.state) : e.state + (u === '%' ? '%' : ' ' + u)) : cap(e.state);
}

// Send a slider's value and show it at once. When nothing was sent (not connected) or HA refuses it, the tile goes back
// to the real value instead of showing the new one until it times out.
function put(id, service, data, state, attrs, ok, t0) {
  if (call(service, data, id, () => dropOptimistic(id))) optimistic(id, state, attrs, ok, t0);
}
// the value a number slider sets at p (0..100): on the entity's own steps counted from its minimum, never past its maximum
export function numberAt(r, p) {
  const steps = Math.round(((p / 100) * (r.max - r.min)) / r.step), top = Math.floor((r.max - r.min) / r.step + 1e-9);
  return +(r.min + Math.max(0, Math.min(top, steps)) * r.step).toFixed(4);
}
const withUnit = (v, u) => v + (u ? (u === '%' ? '%' : ' ' + u) : '');
// How a slider reads and sets each kind of entity (pct = 0..100 fill; at = the text while the slider is held at p)
export const MODELS = {
  light: {
    pct: (e) => (e.state === 'on' ? (e.attributes.brightness != null ? e.attributes.brightness / 2.55 : 100) : 0),
    text: (e) => (e.state === 'on' ? (e.attributes.brightness != null ? Math.round(e.attributes.brightness / 2.55) + '%' : 'On') : 'Off'),
    at: (e, p) => Math.round(p) + '%',
    set(id, p, t0) {
      if (p < 2) { put(id, 'light.turn_off', settings.instantLightOff ? { transition: 0 } : {}, 'off', null, (r) => r.state === 'off', t0); return; }
      const bri = Math.round(p * 2.55);
      put(id, 'light.turn_on', { brightness_pct: p }, 'on', { brightness: bri }, (r) => r.state === 'on' && Math.abs((r.attributes.brightness || 0) - bri) <= 4, t0);
    },
  },
  number: {
    range: (e) => { const a = e.attributes, min = +a.min || 0, max = a.max != null ? +a.max : 100; return { min, max, step: +a.step || 1 }; },
    pct(e) { const r = this.range(e), v = parseFloat(e.state); return isNaN(v) ? 0 : ((v - r.min) / (r.max - r.min || 1)) * 100; },
    text: (e) => stateText(e, 'number'),
    at(e, p) { return withUnit(numberAt(this.range(e), p), e.attributes.unit_of_measurement); },
    set(id, p, t0) {
      const e = st(id); if (!e) return;
      const r = this.range(e), val = numberAt(r, p);
      put(id, id.split('.')[0] + '.set_value', { value: val }, String(val), null, (x) => Math.abs(parseFloat(x.state) - val) < r.step / 2, t0);
    },
  },
  media_player: {
    pct: (e) => (e.attributes.volume_level || 0) * 100,
    text: (e) => (e.attributes.is_volume_muted ? 'Muted' : Math.round((e.attributes.volume_level || 0) * 100) + '%'),
    at: (e, p) => Math.round(p) + '%',
    set(id, p, t0) { const v = p / 100; put(id, 'media_player.volume_set', { volume_level: v }, null, { volume_level: v }, (r) => Math.abs((r.attributes.volume_level || 0) - v) < 0.02, t0); },
  },
};
MODELS.input_number = MODELS.number;

// Drag anywhere on the tile to set brightness (tap = set to that point). Vertical moves scroll the page.
function slider(el, fill, sub, id, model, text) {
  let d = null;
  el.addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('.ic, .sb')) return;
    d = { x0: ev.clientX, y0: ev.clientY, r: el.getBoundingClientRect(), moved: false, pid: ev.pointerId, pct: 0 };
  });
  el.addEventListener('pointermove', (ev) => {
    if (!d || ev.pointerId !== d.pid) return;
    const dx = Math.abs(ev.clientX - d.x0), dy = Math.abs(ev.clientY - d.y0);
    if (!d.moved) {
      if (dy > 12 && dy > dx) { d = null; return; }
      if (dx < 8) return;
      d.moved = true; el.classList.add('drag'); try { el.setPointerCapture(ev.pointerId); } catch (x) { /* ignore */ }
    }
    d.pct = pct(ev, d.r); fill.style.width = d.pct + '%'; const e = st(id); if (sub && e) sub.textContent = model.at(e, d.pct);
  });
  // the fill and the text as the entity has them (with the value just sent, while HA has not answered)
  const real = () => { const e = st(id); if (!e) return; fill.style.width = model.pct(e) + '%'; if (sub) sub.textContent = text(e); };
  const end = (ev, cancel) => {
    if (!d || ev.pointerId !== d.pid) return;
    const x = d; d = null; el.classList.remove('drag');
    if (!cancel) model.set(id, Math.round(x.moved ? x.pct : pct(ev, x.r)), tapStart(ev));
    if (x.moved) real();   // a drag that was canceled, or whose value could not be sent, must not leave its own figure on the tile
  };
  el.addEventListener('pointerup', (ev) => end(ev, false));
  el.addEventListener('pointercancel', (ev) => end(ev, true));

  // TV remote (core/remote.js): hold OK to adjust, Left / Right in 10% steps, OK / Back (or moving away) to finish.
  // The fill and the % follow each press; HA gets the value once the presses pause.
  el.dataset.hold = '';
  let a = null;
  const send = () => { clearTimeout(a.t); a.t = 0; model.set(id, a.pct, performance.now()); };
  el.addEventListener('dash:hold', () => {
    const e = st(id); if (!e || e.state === 'unavailable') return;
    a = { pct: Math.round(model.pct(e) / 10) * 10, t: 0 };
    el.classList.add('drag', 'adjusting'); show();
  });
  const show = () => { fill.style.width = a.pct + '%'; const e = st(id); if (sub && e) sub.textContent = `‹  ${model.at(e, a.pct)}  ›`; };
  el.addEventListener('dash:adjust', (ev) => {
    if (!a) return;
    a.pct = Math.max(0, Math.min(100, a.pct + ev.detail * 10)); show();
    clearTimeout(a.t); a.t = setTimeout(send, 400);
  });
  const done = () => {
    if (!a) return;
    if (a.t) send();
    a = null; el.classList.remove('drag', 'adjusting');
    real();
  };
  el.addEventListener('dash:adjust-end', done);
  el.addEventListener('focusout', done);
}
const pct = (ev, r) => Math.max(0, Math.min(100, ((ev.clientX - r.left) / r.width) * 100));
