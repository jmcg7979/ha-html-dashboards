// A time of day you can nudge: input_datetime (time only) or time.* entities. − / + by `step` minutes, sent after a short pause.
// { type: 'time', entity, name, icon, step: 15, big: true (a pop-up's main control: label on top, large − time +),
//   state: () => text, deps: [ids]           optional line under the name (e.g. "Next Wed 6:30 AM"); deps = what it reads
//   subs: [{ icon, label, action, on: () => bool, tone, show: () => bool }] }   buttons after the clock (run now, skip...)
import { h, esc, icon, setText, setTone, toggle } from '../core/dom.js';
import { st, watch, optimistic, tapStart } from '../core/store.js';
import { call } from '../core/ha.js';
import { run } from '../core/actions.js';
import { hmParts } from '../core/units.js';

const toMin = (s) => { const p = String(s || '').split(':').map(Number); return p.length >= 2 && !isNaN(p[0]) ? p[0] * 60 + p[1] : null; };
const label = (m) => (m == null ? '—' : hmParts(Math.floor(m / 60), m % 60).join(' ').trim());
const hhmmss = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;

export default function time(cfg) {
  const id = cfg.entity, dom = id.split('.')[0], step = cfg.step || 15;
  const el = h(`<div class="tile timecard${(cfg.subs || []).length ? ' has-x' : ''}${cfg.big ? ' big' : ''}"><div class="ic">${icon(cfg.icon || 'clock-outline')}</div><div class="tx"><div class="name">${esc(cfg.name || '')}</div>${cfg.state ? '<div class="sub"></div>' : ''}</div>
    <div class="subs"><button class="sb" data-d="-1">${icon('minus')}</button><span class="tclock"></span><button class="sb" data-d="1">${icon('plus')}</button>${(cfg.subs || []).map((x, i) => `<button class="sb xs${i ? '' : ' x0'}${x.label ? ' lbl' : ''}" data-i="${i}">${x.icon ? icon(x.icon) : ''}${x.label ? `<span>${esc(x.label)}</span>` : ''}</button>`).join('')}</div></div>`);
  const clock = el.querySelector('.tclock'), sub = el.querySelector('.sub'), xs = [...el.querySelectorAll('.sb.xs')], subs = cfg.subs || [];
  let local = null, sendT = 0, t0 = 0;
  watch([id], () => { if (local == null) { const e = st(id); setText(clock, label(e ? toMin(e.state) : null)); } });
  if (sub || xs.length) watch([id].concat(cfg.deps || []), () => {
    if (sub) setText(sub, cfg.state(st(id)) || '');
    xs.forEach((b, i) => { const x = subs[i]; setTone(b, x.tone || 'mist'); toggle(b, 'on', !!(x.on && x.on())); b.hidden = !!(x.show && !x.show()); });
  });
  el.addEventListener('click', (ev) => {
    const x = ev.target.closest('.sb.xs'); if (x) { run(subs[+x.dataset.i].action, { el: x, ev, entity: id }); return; }
    const b = ev.target.closest('.sb'); if (!b) return;
    const e = st(id); if (!e) return;
    if (local == null) { local = toMin(e.state) || 0; t0 = tapStart(ev); }
    local = (((Math.round(local / step) * step + +b.dataset.d * step) % 1440) + 1440) % 1440;
    setText(clock, label(local));
    clearTimeout(sendT);
    sendT = setTimeout(() => {
      const v = hhmmss(local); local = null;
      optimistic(id, v, null, (r) => r.state === v, t0);
      call(dom === 'time' ? 'time.set_value' : 'input_datetime.set_datetime', { time: v }, id);
    }, 900);
  });
  return el;
}
