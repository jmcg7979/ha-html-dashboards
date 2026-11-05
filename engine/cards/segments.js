// A row of options for a select / input_select, the current one highlighted (e.g. phone Ring / Vibrate / Silent).
// { type: 'segments', entity, options: [{ value, label, icon, tone }] }   options default to the entity's own list
//   other services: { attr: 'fan_speed', optionsAttr: 'fan_speed_list', call: 'vacuum.set_fan_speed', key: 'fan_speed' }
import { h, esc, icon, toggle, setTone } from '../core/dom.js';
import { st, watch } from '../core/store.js';
import { run } from '../core/actions.js';

export default function segments(cfg) {
  const id = cfg.entity, dom = id.split('.')[0];
  const el = h('<div class="segments"></div>');
  let opts = cfg.options;
  const draw = () => {
    const e = st(id);
    if (!opts && e) { opts = (e.attributes[cfg.optionsAttr || 'options'] || []).filter((v) => !(cfg.hide || []).includes(v) && !['unknown', 'unavailable', 'none'].includes(String(v).toLowerCase())).map((v) => ({ value: v, label: (cfg.labels || {})[v] || v[0].toUpperCase() + v.slice(1).replace(/_/g, ' ') })); el.innerHTML = ''; }
    if (!el.children.length && opts) el.innerHTML = opts.map((o, i) => `<button class="chip seg" data-i="${i}">${o.icon ? icon(o.icon) : ''}${o.label ? `<span class="seglbl">${esc(o.label)}</span>` : ''}</button>`).join('');
    [...el.children].forEach((b, i) => { setTone(b, opts[i].tone || cfg.tone || 'mist'); toggle(b, 'on', !!e && (cfg.attr ? e.attributes[cfg.attr] : e.state) === opts[i].value); toggle(b, 'pending', e && e.pending); });
  };
  watch([id], draw);
  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('.seg'); if (!b) return;
    const v = opts[+b.dataset.i].value;
    if (cfg.call) run({ call: cfg.call, data: { [cfg.key]: v }, expect: { attr: cfg.attr, value: v } }, { el: b, ev, entity: id });
    else run({ call: `${dom}.select_option`, data: { option: v }, expect: v }, { el: b, ev, entity: id });
  });
  return el;
}
