// A few figures side by side in one well, split by hairlines: small label (+ a quiet detail) over the value.
// The engine's way to show several read-only numbers (instead of one box each); the history pop-up uses the same look.
// { type: 'strip', cols: 3 (default: the number of items, at most 3; more wrap),
//   items: [{ label, entity, value: (entity) => text, detail: (entity) => text, deps: [more ids that redraw it] }] }
// An item with no entity is a fixed figure: its value() is shown as it is. Without value(), a state that is
// unavailable or unknown shows –.
import { h, esc, setText } from '../core/dom.js';
import { st, watch } from '../core/store.js';

export const stripCell = (label, detail, value, key = '', aside = '') =>
  `<div class="sti"><span class="stl">${key}<span>${esc(label)}</span><em>${esc(detail || '')}</em></span><b>${esc(value)}${aside ? `<small>${esc(aside)}</small>` : ''}</b></div>`;

export default function strip(cfg) {
  const items = cfg.items || [];
  const el = h(`<div class="strip" style="--n:${cfg.cols || Math.min(3, items.length)}">${items.map((it) => stripCell(it.label, '', '–')).join('')}</div>`);
  const cells = [...el.querySelectorAll('.sti')];
  items.forEach((it, i) => {
    const ids = [it.entity, ...(it.deps || [])].filter(Boolean);
    const show = () => {
      const e = it.entity ? st(it.entity) : null, has = e || !it.entity;
      const text = !has ? '–' : it.value ? it.value(e) : e && e.state !== 'unavailable' && e.state !== 'unknown' ? e.state : '–';
      setText(cells[i].querySelector('b'), text == null ? '–' : String(text));
      setText(cells[i].querySelector('em'), has && it.detail ? it.detail(e) || '' : '');
    };
    if (ids.length) watch(ids, show); else show();   // nothing to watch: drawn once (a watch on no entities never runs)
  });
  return el;
}
