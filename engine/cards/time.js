// A time of day you can nudge: input_datetime (time only) or time.* entities. − / + by `step` minutes, sent after a short pause.
// { type: 'time', entity, name, icon, step: 15, big: true (a pop-up's main control: label on top, large − time +),
//   state: () => text, deps: [ids] }         optional line under the name (e.g. "Next Wed 6:30 AM"); deps = what it reads
// nudge() is the tile itself, for any value that is nudged this way (cards/stepper.js: a number).
import { h, esc, icon, setText } from '../core/dom.js';
import { st, watch, optimistic, dropOptimistic, tapStart } from '../core/store.js';
import { call } from '../core/ha.js';
import { hmParts } from '../core/units.js';

const toMin = (s) => { const p = String(s || '').split(':').map(Number); return p.length >= 2 && !isNaN(p[0]) ? p[0] * 60 + p[1] : null; };
const label = (m) => (m == null ? '—' : hmParts(Math.floor(m / 60), m % 60).join(' ').trim());
const hhmmss = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;

// The tile: icon, name, − value +. The value is held here while it is nudged and sent 0.9 s after the last press.
// M: { icon, less, more (what − and + are called), get: (entity) => value | null, text: (value) => what is shown,
//      next: (value, -1 | 1, entity) => value, send: (value) => [service, data, the state HA then reports],
//      same: (state, sent) => bool (optional: HA's state is the one sent; default: the same text) }
export function nudge(cfg, M) {
  const id = cfg.entity;
  const el = h(`<div class="tile timecard${cfg.big ? ' big' : ''}"><div class="ic">${icon(cfg.icon || M.icon)}</div><div class="tx"><div class="name">${esc(cfg.name || '')}</div>${cfg.state ? '<div class="sub"></div>' : ''}</div>
    <div class="subs"><button class="sb" data-d="-1" aria-label="${M.less}">${icon('minus')}</button><span class="tclock"></span><button class="sb" data-d="1" aria-label="${M.more}">${icon('plus')}</button></div></div>`);
  const clock = el.querySelector('.tclock'), sub = el.querySelector('.sub');
  let local = null, sendT = 0, t0 = 0;
  const show = () => { if (local == null) { const e = st(id); setText(clock, M.text(e ? M.get(e) : null)); } };
  watch([id], show);
  if (sub) watch([id].concat(cfg.deps || []), () => setText(sub, cfg.state(st(id)) || ''));
  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('.sb'); if (!b) return;
    const e = st(id); if (!e) return;
    if (local == null) t0 = tapStart(ev);
    local = M.next(local == null ? M.get(e) : local, +b.dataset.d, e);
    setText(clock, M.text(local));
    clearTimeout(sendT);
    sendT = setTimeout(() => {
      const [service, data, s] = M.send(local); local = null;
      // shown at once; back to the real value when nothing was sent (not connected) or HA refuses it
      if (call(service, data, id, () => dropOptimistic(id))) optimistic(id, s, null, (r) => (M.same ? M.same(r.state, s) : r.state === s), t0);
      show();
    }, 900);
  });
  return el;
}

export default function time(cfg) {
  const step = cfg.step || 15, service = cfg.entity.split('.')[0] === 'time' ? 'time.set_value' : 'input_datetime.set_datetime';
  return nudge(cfg, { icon: 'clock-outline', less: 'Earlier', more: 'Later', get: (e) => toMin(e.state), text: label,
    next: (m, d) => (((Math.round((m || 0) / step) * step + d * step) % 1440) + 1440) % 1440,
    send: (m) => [service, { time: hhmmss(m) }, hhmmss(m)] });
}
