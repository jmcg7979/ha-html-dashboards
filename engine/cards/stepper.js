// A number you can nudge: number / input_number entities (a set point, a target). − / + by `step`, sent after a short pause.
// { type: 'stepper', entity, name, icon, step: 5 (default: the entity's own step), unit: '°' (default: the entity's unit),
//   from: 250 (where the first press lands while the entity has no value: a target that isn't set),
//   big: true (a pop-up's main control), state: (entity) => text, deps: [ids] }      as the time card
// The entity's own min and max hold. Looks and behaves like the time card (cards/time.js nudge; css/cards/time.css).
import { nudge } from './time.js';
import { unitTag } from '../core/format.js';

// the value after a press: on the step grid, inside min..max; with no value yet, `from` itself (else min)
export function stepTo(v, d, { step = 1, min = -Infinity, max = Infinity, from } = {}) {
  const dec = (String(step).split('.')[1] || '').length;
  const x = v == null || isNaN(v) ? (from != null ? from : isFinite(min) ? min : 0) : Math.round(v / step) * step + d * step;
  return +Math.min(max, Math.max(min, x)).toFixed(dec);
}

export default function stepper(cfg) {
  const lim = (e) => { const a = e.attributes; return { step: cfg.step || a.step || 1, min: a.min, max: a.max, from: cfg.from }; };
  let unit = cfg.unit;
  return nudge(cfg, { icon: 'numeric', less: 'Lower', more: 'Higher',
    get: (e) => { if (cfg.unit == null) unit = unitTag(e.attributes.unit_of_measurement); const v = parseFloat(e.state); return isNaN(v) ? null : v; },
    text: (v) => (v == null ? '—' : v + (unit || '')),
    next: (v, d, e) => stepTo(v, d, lim(e)),
    send: (v) => [cfg.entity.split('.')[0] + '.set_value', { value: v }, String(v)],
    same: (state, sent) => parseFloat(state) === parseFloat(sent) });
}
