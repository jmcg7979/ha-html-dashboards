// A chip that opens its choices: one control in the place of a row of chips (a filter, a sort, a camera). The chip says
// what it is and what is chosen ("Source  All ⌄"); a press opens a small menu under it (above it when there is no room; a
// sheet from the bottom on a phone) and the choice is applied as it is made.
//   pick({ label, options, value | values, multi, all, icon, cls, tone, onChange }) -> { el, set(), value(), close() }
//     label     what the chip chooses ('Source'); also the menu's title on a phone
//     options   [{ id, name, icon? }]
//     multi     false: one of the options, always (give an 'All' option of your own when there is one). The menu closes
//               on the choice. `value` = the chosen id (default: the first option's)
//               true: any of the options, or none = all of them (the row `all`, default 'All', first in the menu). The menu
//               stays open; choosing every option is the same as all. `values` = the chosen ids (default: none = all)
//     cls       the chip's own look ('chip' by default; a card with chips of its own gives theirs, e.g. 'mchip')
//     tone      a tone's name ('plum'): the color of what is chosen. Default: the --t where the chip stands
//     onChange  (value) or (values: Set) after every choice made in the menu (not after set())
//   set({ options, value, values })   new options and / or a new choice, from the card (a list that arrived). A chosen id that
//               is no longer an option is dropped (single: the first option).
//   value()     the chosen id, or a Set of the chosen ids (empty = all)
// The chip is tinted (.set) while it narrows something: multi with a choice made, single away from its first option.
// The menu is a layer (core/layers.js): it takes the remote like a pop-up, the highlight starts on what is chosen, Back or
// Escape closes it and the highlight returns to the chip. Call pick() in the card's factory body: it closes its menu when the
// card is unloaded.
import { h, esc, icon } from './dom.js';
import { onDispose } from './scope.js';
import { layer } from './layers.js';

const GAP = 6, EDGE = 8;   // px between the chip and its menu, and kept free at the screen's edges
const SETTLE = 350;         // ms after opening in which a press beside the menu doesn't close it (the tail of the press that opened it)

export function pick(cfg) {
  const multi = !!cfg.multi, allName = cfg.all || 'All';
  let options = cfg.options || [], one = cfg.value, many = new Set(cfg.values || []), wrap = null, L = null, openedAt = 0;
  const el = h(`<button class="${esc(cfg.cls || 'chip')} pick" aria-haspopup="listbox" aria-expanded="false">${cfg.icon ? icon(cfg.icon) : ''}<span class="pk-l">${esc(cfg.label)}</span><span class="pk-v"></span><i class="pk-chev">${icon('chevron-down')}</i></button>`);
  if (cfg.tone) el.style.setProperty('--t', `var(--${cfg.tone})`);

  const has = (id) => options.some((o) => o.id === id);
  const tidy = () => {
    if (multi) { if (options.length) { many = new Set([...many].filter(has)); if (many.size >= options.length) many.clear(); } }   // no options yet (they arrive later): the choice waits for them
    else if (!has(one)) one = options.length ? options[0].id : undefined;
  };
  const nameOf = (id) => (options.find((o) => o.id === id) || {}).name || '';
  const summary = () => {
    if (!multi) return nameOf(one);
    if (!many.size) return allName;
    const names = options.filter((o) => many.has(o.id)).map((o) => o.name);
    return names.length <= 2 ? names.join(', ') : `${names.length} of ${options.length}`;
  };
  const narrowed = () => (multi ? many.size > 0 : options.length > 0 && one !== options[0].id);
  const draw = () => {
    tidy();
    el.querySelector('.pk-v').textContent = summary();
    el.classList.toggle('set', narrowed());
    el.setAttribute('aria-label', `${cfg.label}: ${summary()}`);
    if (wrap) rows();
  };

  // the menu's rows: multi has the row for all, a line, then a box to tick on each; single has a check on the chosen one
  const row = (id, name, on, ic, all) => `<button class="pk-o${on ? ' on' : ''}" role="option" aria-selected="${on}" ${all ? 'data-all' : `data-id="${esc(id)}"`}>${multi && !all ? `<i class="pk-box">${icon(on ? 'checkbox-marked' : 'checkbox-blank-outline')}</i>` : ''}${ic ? icon(ic) : ''}<span>${esc(name)}</span>${multi && !all ? '' : `<i class="pk-c">${icon('check')}</i>`}</button>`;
  function rows() {
    const list = wrap.querySelector('.pk-list'), at = document.activeElement, key = at && list.contains(at) ? (at.dataset.id != null ? `[data-id="${CSS.escape(at.dataset.id)}"]` : '[data-all]') : null;
    list.innerHTML = (multi ? row('', allName, !many.size, null, true) + '<div class="pk-sep"></div>' : '') + options.map((o) => row(o.id, o.name, multi ? many.has(o.id) : o.id === one, o.icon)).join('');
    const again = key && list.querySelector(key); if (again) again.focus({ preventScroll: true });   // the rows were drawn again: the highlight stays
  }

  // under the chip, its left edge on the chip's (its right edge when that runs off the screen); above when under has no room
  function place() {
    const r = el.getBoundingClientRect(), m = wrap.querySelector('.pickmenu'), s = wrap.style;
    s.setProperty('--pk-w', Math.round(r.width) + 'px');
    const w = m.offsetWidth, under = innerHeight - r.bottom - GAP - EDGE, over = r.top - GAP - EDGE, up = m.scrollHeight > under && over > under;
    s.setProperty('--pk-x', Math.round(Math.max(EDGE, Math.min(r.left + w > innerWidth - EDGE ? r.right - w : r.left, innerWidth - EDGE - w))) + 'px');
    s.setProperty('--pk-y', Math.round(up ? innerHeight - r.top + GAP : r.bottom + GAP) + 'px');
    s.setProperty('--pk-h', Math.round(Math.max(120, up ? over : under)) + 'px');
    wrap.classList.toggle('up', up);
  }

  function close(back = true) {
    if (!wrap) return;
    const inside = wrap.contains(document.activeElement);
    wrap.remove(); wrap = null; L.shut();
    el.setAttribute('aria-expanded', 'false');
    if (back && inside && el.isConnected) el.focus({ preventScroll: true });
  }
  function choose(o) {
    if (o.dataset.all != null) many.clear();
    else if (multi) { const id = o.dataset.id; if (many.has(id)) many.delete(id); else many.add(id); }
    else one = o.dataset.id;
    if (!multi) close();
    draw();
    if (cfg.onChange) cfg.onChange(multi ? new Set(many) : one);
  }
  function open() {
    if (wrap && !wrap.isConnected) wrap = null;   // taken off the page by something else: not open
    if (wrap || !options.length) return;
    openedAt = performance.now();
    wrap = h(`<div class="pickwrap${multi ? ' multi' : ''}"><div class="pickmenu" role="listbox" aria-label="${esc(cfg.label)}"${multi ? ' aria-multiselectable="true"' : ''}><div class="pk-title">${esc(cfg.label)}</div><div class="pk-list"></div></div></div>`);
    const t = getComputedStyle(el).getPropertyValue('--t').trim(); if (t) wrap.style.setProperty('--t', t);
    wrap.addEventListener('click', (ev) => { const o = ev.target.closest('.pk-o'); if (o) choose(o); else if (!ev.target.closest('.pickmenu') && performance.now() - openedAt > SETTLE) close(); });
    document.body.appendChild(wrap);
    L = layer({ el: wrap, kind: 'menu', close });
    L.open();
    el.setAttribute('aria-expanded', 'true');
    rows(); place();
    const first = wrap.querySelector('.pk-o.on') || wrap.querySelector('.pk-o');
    if (first) { first.focus({ preventScroll: true }); first.scrollIntoView({ block: 'nearest' }); }
  }
  el.addEventListener('click', () => (wrap && wrap.isConnected ? close() : open()));
  onDispose(() => close(false));
  draw();

  return {
    el,
    set(next = {}) {
      if (next.options) options = next.options;
      if ('value' in next) one = next.value;
      if (next.values) many = new Set(next.values);
      draw(); if (wrap) place();
    },
    value: () => (multi ? new Set(many) : one),
    close,
  };
}
