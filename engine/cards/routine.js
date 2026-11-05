// A scheduled routine as a card: name, the time it runs (big, read-only), a status line; tap opens its pop-up, where the
// time is changed and the routine can be run now (so a stray tap on the dashboard never moves a time).
// While the routine is running the card lights up in its tone, with a progress bar along the bottom when it has a length.
// { type: 'routine', name, icon, tone, entities: [ids it reads], tick: true (redraw every minute: countdowns),
//   time: () => 'HH:MM[:SS]', status: () => text, on: () => bool (running), progress: () => 0..1 | null,
//   skip: () => bool (next run skipped: time struck through), dim: () => bool (paused), tap, tall: true (Main: time on its own line) }
import { h, esc, icon, setText, setTone, toggle } from '../core/dom.js';
import { watch, tick } from '../core/store.js';
import { run } from '../core/actions.js';
import { hmParts } from '../core/units.js';

const parts = (s) => { const p = String(s || '').split(':').map(Number); if (p.length < 2 || isNaN(p[0])) return ['–', ''];
  return hmParts(p[0], p[1]); };

export default function routine(cfg) {
  const el = h(`<button class="routine${cfg.tall ? ' tall' : ''}"><span class="ic">${icon(cfg.icon)}</span>
    <span class="rname">${esc(cfg.name)}</span><span class="rgo">${icon('chevron-right')}</span>
    <span class="rtime"><b></b><small></small></span><span class="rstat"></span><span class="rbar"><i></i></span></button>`);
  const ic = el.querySelector('.ic'), b = el.querySelector('.rtime b'), sm = el.querySelector('.rtime small'), stat = el.querySelector('.rstat'),
    bar = el.querySelector('.rbar'), fill = bar.querySelector('i');
  setTone(el, cfg.tone || 'mist');
  const draw = () => {
    const [t, ap] = parts(cfg.time()), on = !!(cfg.on && cfg.on()), p = cfg.progress ? cfg.progress() : null;
    setText(b, t); setText(sm, ap); setText(stat, cfg.status ? cfg.status() || '' : '');
    toggle(el, 'on', on); toggle(ic, 'on', on || !(cfg.dim && cfg.dim()));
    toggle(el, 'skip', !!(cfg.skip && cfg.skip())); toggle(el, 'dim', !!(cfg.dim && cfg.dim()));
    bar.hidden = p == null; if (p != null) fill.style.width = Math.max(0, Math.min(1, p)) * 100 + '%';
  };
  watch(cfg.entities || [], draw);
  if (cfg.tick) tick(draw);
  if (cfg.tap) el.addEventListener('click', (ev) => run(cfg.tap, { el, ev }));
  return el;
}
