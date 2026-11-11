// Status tile: icon, label and a short live value; lights up in its tone when it matters. Tap opens detail.
// { type: 'stat', size: 'lg' | 'tile', label: 'Lights', icon: 'lightbulb-group', entities: [...], tick: false,
//   value: () => ({ text: '3 on', detail: 'Kitchen, porch', on: true, tone: 'lamp', icon }), tap }
// size 'tile': a square-ish glance tile (TV Home): icon and label on top, the value big, the detail line under it.
import { h, esc, icon, setText, setHTML, setTone, toggle } from '../core/dom.js';
import { watch, tick } from '../core/store.js';
import { run } from '../core/actions.js';

export default function stat(cfg) {
  const el = h(`<button class="stat${cfg.size ? ' ' + cfg.size : ''}"><span class="ic"></span><span class="tx"><span class="slabel">${esc(cfg.label)}</span><span class="svalue"></span><span class="sdetail"></span></span></button>`);
  const ic = el.querySelector('.ic'), val = el.querySelector('.svalue'), det = el.querySelector('.sdetail');
  const draw = () => {
    const v = cfg.value() || {};
    setText(val, v.text || ''); setText(det, v.detail || ''); setHTML(ic, icon(v.icon || cfg.icon));
    setTone(el, v.tone || cfg.tone || 'stone'); toggle(el, 'on', !!v.on); toggle(ic, 'on', !!v.on); toggle(el, 'alert', !!v.alert);
  };
  watch(cfg.entities, draw);
  if (cfg.tick) tick(draw);
  if (cfg.tap) el.addEventListener('click', (ev) => run(cfg.tap, { el, ev }));
  return el;
}
