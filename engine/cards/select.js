// Pick one option from a list (select / input_select, or a light's effect). Tap to open the list in place.
// { type: 'select', entity, name, icon, attr: 'effect' (light effects: options from effect_list) }
import { h, esc, icon, setText, setHTML, toggle, setTone } from '../core/dom.js';
import { st, watch } from '../core/store.js';
import { run } from '../core/actions.js';

export default function select(cfg) {
  const id = cfg.entity, dom = id.split('.')[0], isEffect = cfg.attr === 'effect';
  const el = h(`<div class="select"><div class="tile"><div class="ic">${icon(cfg.icon || 'format-list-bulleted')}</div>
    <div class="tx"><div class="name">${esc(cfg.name)}</div><div class="sub"></div></div><div class="chev">${icon('chevron-down')}</div></div><div class="opts" hidden></div></div>`);
  const sub = el.querySelector('.sub'), opts = el.querySelector('.opts'), ic = el.querySelector('.ic');
  setTone(el, cfg.tone || 'mist');
  const options = (e) => (!e ? [] : isEffect ? e.attributes.effect_list || [] : e.attributes.options || []);
  const current = (e) => (!e ? '' : isEffect ? e.attributes.effect || '' : e.state);
  watch([id], () => {
    const e = st(id), cur = current(e);
    setText(sub, cur || '—'); toggle(ic, 'on', !!cur && cur !== 'unknown');
    setHTML(opts, options(e).map((o) => `<button class="sb${o === cur ? ' on' : ''}" data-v="${esc(o)}">${esc(o)}</button>`).join(''));
  });
  el.querySelector('.tile').addEventListener('click', () => { opts.hidden = !opts.hidden; toggle(el, 'open', !opts.hidden); });
  opts.addEventListener('click', (ev) => {
    const b = ev.target.closest('.sb'); if (!b) return;
    const v = b.dataset.v;
    if (isEffect) run({ call: 'light.turn_on', data: { effect: v }, expect: { attr: 'effect', value: v } }, { el: b, ev, entity: id });
    else run({ call: `${dom}.select_option`, data: { option: v }, expect: v }, { el: b, ev, entity: id });
    opts.hidden = true; toggle(el, 'open', false);
  });
  return el;
}
