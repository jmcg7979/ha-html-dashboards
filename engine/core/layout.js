// Builds views and pop-ups from config: view -> sections (panels) -> cards on a column grid.
// A card type is a module in /cards exporting `default (cfg, ctx) => HTMLElement`.
//   view:    { columns: 'minmax(0, 1fr) 240px' } optional: the view's own column widths instead of --view-cols equal columns
//            { zoom: 0.7, s: 1 } optional: draw the view smaller (CSS zoom) at its own --s, e.g. a wall-panel page reused on a TV
//            { zoom: 0.7, s: 1 } optional: draw the view smaller (CSS zoom) at its own --s, e.g. a wall-panel page reused on a TV
//            { colGap: 'calc(28px * var(--s))' } optional: the view's own space between columns
//   section: { span: 1, cols: 12, panel: true, rows: 'auto minmax(0, 1fr)', cards: [...] }   span = view columns, cols = grid units inside
//            rows: the grid's own row template for a multi-column section; it then fills its column's height like grow
//   page / view: { fill: true } the page takes the full screen height, so its sections stretch to the bottom (the cards grow)
//   card:    { type: 'tile', span: 6, show: {...}, class: 'glass', grow: true, ...options } span = grid units (default: full width); class goes on the cell
//            wide: true = full row when a big-screen layout reflows on a phone, even if span is under a third (e.g. 4 cards in a row)
//            grow: the card takes the height left in its column, so the column reaches the bottom of the screen like its neighbours
//            (one-column sections only; the view's tallest column sets the height)
//   show:    { entity, state | not | below | above } or { when: () => bool, entities: [ids] } or a list (all must hold): hides the card otherwise
import { watch, st } from './store.js';
import { resubscribeIfNeeded } from './ha.js';
import { frameView } from './frame.js';
import { icon } from './dom.js';
import { fitGuard } from './fit.js';

// A card type can export `panel = true`: placed straight on a page (a section with panel: false), it sits in its own glass
// panel without each config saying class: 'glass'. Inside a panel section or a pop-up it doesn't (no panel in a panel).
// A config opts out with panel: false, or picks its own look with class.
const loading = new Map(), modules = new Map(), panels = new Set();
function load(type) {
  if (!loading.has(type)) loading.set(type, import(`../cards/${type}.js`).then((m) => { modules.set(type, m.default); if (m.panel) panels.add(type); }));
  return loading.get(type);
}
function typesIn(cards, out = new Set()) { (cards || []).forEach((c) => { out.add(c.type); typesIn(c.cards, out); }); return out; }
// Phone reflow of a big-screen page: one column, no screen-height filling, single-figure tiles (kpi) two to a row, everything
// else (hosts, containers, charts, lists) full width. Mobile dashboards use it, and app.js applies it to a big-screen
// dashboard opened on a phone, so a site without a Mobile dashboard reads the same.
const reflow = (cards) => cards.map((c) => ({ ...c, grow: undefined, fit: c.type === 'chart' ? false : c.fit,
  span: c.type === 'kpi' ? 6 : 12, ...(c.cards ? { cards: reflow(c.cards) } : {}) }));
export const phoneSections = (secs) => secs.map((sec) => ({ ...sec, span: 1, rows: undefined, cols: 12, cards: reflow(sec.cards) }));
export const phoneView = (view) => ({ ...view, pages: view.pages.map((pg) => ({ ...pg, fill: false, reflowed: true, sections: phoneSections(pg.sections) })) });

export const preload = (cards) => Promise.all([...typesIn(cards)].map(load));

export async function renderView(view, home) {
  const el = await renderView0(view, home);
  if (view.zoom) el.style.zoom = view.zoom;
  if (view.s) el.style.setProperty('--s', view.s);
  return el;
}
async function renderView0(view, home) {
  if (view.frame) return frameView(view);   // a page in a frame (e.g. Music)
  if (view.pages) return pagedView(view, home);
  await preload(view.sections.flatMap((s) => s.cards));   // load every card type in parallel, then build synchronously
  const el = document.createElement('div');
  el.className = 'view view-' + view.id;
  if (view.columns) el.style.setProperty('--view-template', view.columns);
  if (view.colGap) el.style.columnGap = view.colGap;   // view option: space between columns (Cameras)
  if (view.fill) el.classList.add('fill');   // view option: the view takes the screen's height, its columns stretch to the bottom (Printer)
  sections(el, view.sections, home);
  fitGuard(el);   // fill only when the content fits (core/fit.js)
  return el;
}

function sections(el, list, home) {
  for (const sec of list) {
    const s = document.createElement('div');
    s.className = 'section' + (sec.panel === false ? '' : ' panel') + (sec.class ? ' ' + sec.class : '');
    s.style.setProperty('--span', sec.span || 1);
    s.dataset.span = sec.span || 1;   // CSS clamps wide sections when the view has fewer columns (2-column state)
    s.appendChild(grid(sec.cards, sec.cols || 12, home, sec.rows, { onPage: sec.panel === false }));
    el.appendChild(s);
  }
}

// A view with tabs: { id, title, icon, pages: [{ id, title, icon, sections }] }. Pages are built when first shown;
// open one directly with { view: 'systems/nas' } or ?v=systems/nas.
async function pagedView(view, home) {
  const el = document.createElement('div');
  el.className = 'pview view-' + view.id;
  el.innerHTML = `<div class="vtabs">${view.pages.map((p, i) => `<button class="ptab" data-i="${i}">${p.icon ? icon(p.icon) : ''}<span>${p.title}</span></button>`).join('')}</div>`;
  el.style.setProperty('--t', `var(--${view.tone || 'mist'})`);
  if (view.pages.length === 1) el.querySelector('.vtabs').hidden = true;   // one page: no tab row (it would only cost height)
  const made = [], tabs = [...el.querySelectorAll('.vtabs .ptab')];
  el.showPage = async (k) => {
    let i = view.pages.findIndex((p) => p.id === k); if (i < 0) i = typeof k === 'number' ? k : 0;
    if (!made[i]) { await preload(view.pages[i].sections.flatMap((s) => s.cards)); const pg = document.createElement('div'); pg.className = 'view vpage view-' + view.id + '-' + view.pages[i].id + (view.pages[i].fill ? ' fill' : '') + (view.pages[i].reflowed ? ' reflowed' : ''); sections(pg, view.pages[i].sections, home); el.appendChild(pg); made[i] = pg; fitGuard(pg); }
    made.forEach((m, j) => { if (m) m.hidden = j !== i; });
    tabs.forEach((t, j) => t.classList.toggle('on', j === i));
    el.current = view.pages[i].id;
  };
  el.addEventListener('click', (ev) => { const t = ev.target.closest('.vtabs .ptab'); if (t) { const p = view.pages[+t.dataset.i]; window.dispatchEvent(new CustomEvent('dash:view', { detail: view.id + '/' + p.id })); } });
  await el.showPage(0);
  return el;
}

// Card grid; also used by pop-ups and container cards. Card types must already be loaded (preload).
export function grid(cards, cols, home, rows, opts = {}) {
  const g = document.createElement('div');
  g.className = 'sgrid';
  g.style.setProperty('--cols', cols);
  for (const cfg of cards) {
    const cell = document.createElement('div');
    const cls = cfg.class != null ? cfg.class : opts.onPage && cfg.panel !== false && panels.has(cfg.type) ? 'glass' : '';
    cell.className = 'cell' + (cls ? ' ' + cls : '');
    const span = Math.min(cfg.span || cols, cols);
    cell.style.setProperty('--span', span);
    if (cfg.wide || span * 3 >= cols) cell.dataset.wide = '';   // a third of a row or more (or wide: true): takes the full row when a big-screen dashboard reflows on a phone
    if (span < cols && span * 5 >= cols * 2) cell.classList.add('part');   // 40%+ of the row: goes full width in a phone pop-up
    const factory = modules.get(cfg.type);
    if (!factory) { cell.textContent = 'Unknown card: ' + cfg.type; g.appendChild(cell); continue; }
    let shown = true, wants = true;
    const apply = () => { cell.hidden = !(shown && wants); };
    if (cfg.grow) cell.classList.add('grow');
    const ctx = { home, cell, grid: (c, n, hm, r, o) => grid(c, n, hm, r, o || opts), preload,   // a stack inside a page section is still on the page
      setVisible: (v) => { wants = !!v; apply(); } };
    try { cell.appendChild(factory(cfg, ctx)); } catch (e) { console.error(cfg, e); cell.textContent = 'Card error: ' + cfg.type; }
    if (cfg.show) { const conds = [].concat(cfg.show); watch(conds.flatMap((c) => c.entities || [c.entity]), () => { shown = conds.every(test); apply(); }); }
    g.appendChild(cell);
  }
  // rows: content height, the growing card(s) get the rest
  if (rows) { g.classList.add('grows', 'rows'); g.style.gridTemplateRows = rows; }
  else if (cards.some((c) => c.grow)) { g.classList.add('grows'); g.style.gridTemplateRows = cards.map((c) => (c.grow ? 'minmax(0, 1fr)' : 'auto')).join(' '); }
  resubscribeIfNeeded();
  return g;
}

function test(c) {
  if (c.when) return !!c.when();
  const e = st(c.entity); if (!e) return false;
  const v = parseFloat(e.state);
  if (c.state != null && ![].concat(c.state).includes(e.state)) return false;
  if (c.not != null && [].concat(c.not).includes(e.state)) return false;
  if (c.below != null && !(v < c.below)) return false;
  if (c.above != null && !(v > c.above)) return false;
  return true;
}
