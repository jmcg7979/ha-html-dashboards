// Pull-out drawer: a tab on the right edge of the screen; tap it (or drag it out) and a glass panel slides over the page.
// Close with the tab, a tap outside, dragging it back, Esc or leaving the view. Pop-ups opened from it sit above it, so
// the drawer is still open behind them. Content is any cards; closed, it is off screen, so cards that load only while
// visible (Events) wait until it opens.
// { type: 'drawer', id: 'events' (opened by the action { drawer: 'events' }), tab: false (no edge tab: open it only that way),
//   title: 'Events', icon: 'filmstrip-box-multiple', tone: 'mist', width: 420 (px at --s 1),
//   badge: { count: () => Promise<number> | number, watch: [entities], every: 120 }   number on the tab (0 = hidden)
//   live: { entities: [...], on: (stateObj) => bool }   the tab glows ember while any of them is on
//   cards: [...] }
import { h, esc, icon, toggle, setTone } from '../core/dom.js';
import { st, watch } from '../core/store.js';
import { onReady } from '../core/ha.js';

export default function drawer(cfg, ctx) {
  ctx.cell.classList.add('floating');   // takes no room in the grid
  const el = h(`<div class="drawer" style="--dw:calc(${cfg.width || 420}px * var(--s))">
    <div class="dscrim"></div>
    <div class="dpanel" role="dialog" aria-label="${esc(cfg.title || '')}">
      <button class="dtab" aria-label="${esc(cfg.title || '')}">${icon(cfg.icon || 'chevron-left')}<span class="dlbl">${esc(cfg.title || '')}</span><b class="dbadge" hidden></b></button>
      <div class="dhead"><div class="dtitle">${esc(cfg.title || '')}</div><span class="pill on dcount" hidden></span><button class="rbtn dclose" aria-label="Close">${icon('chevron-right')}</button></div>
      <div class="dbody"></div>
    </div></div>`);
  setTone(el, cfg.tone || 'mist');
  if (cfg.tab === false) el.querySelector('.dtab').hidden = true;
  const panel = el.querySelector('.dpanel'), tab = el.querySelector('.dtab'), badge = el.querySelector('.dbadge'), count = el.querySelector('.dcount');
  el.querySelector('.dbody').appendChild(ctx.grid(cfg.cards || [], 12, ctx.home, undefined, {})   /* a sheet, like a pop-up: no page panels */);

  let open = false;
  const set = (o) => {
    if (o === open) return; open = o;
    panel.style.transform = ''; toggle(el, 'open', o);
    if (!o) refresh();   // events reviewed while it was open
  };
  el.querySelector('.dscrim').addEventListener('click', () => set(false));
  el.querySelector('.dclose').addEventListener('click', () => set(false));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open && !location.hash) set(false); });
  window.addEventListener('dash:view', () => set(false));
  window.addEventListener('dash:drawer', (e) => { if (cfg.id && e.detail === cfg.id) set(true); });

  // drag the tab or the header: the panel follows the finger, then snaps open or shut (a plain tap toggles)
  const travel = () => panel.offsetWidth + parseFloat(getComputedStyle(panel).right || 0);
  let d = null;
  const down = (e) => {
    if (e.button > 0 || (e.target.closest('.dclose') && open)) return;
    d = { tab: e.currentTarget === tab, x: e.clientX, t: e.timeStamp, base: open ? 0 : travel(), off: null, v: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e) => {
    if (!d) return;
    const dx = e.clientX - d.x;
    if (d.off == null && Math.abs(dx) < 6) return;
    if (d.off == null) el.classList.add('dragging');
    const off = Math.max(0, Math.min(travel(), d.base + dx));
    d.v = (off - (d.off == null ? d.base : d.off)) / Math.max(1, e.timeStamp - d.t); d.t = e.timeStamp; d.off = off;
    panel.style.transform = `translateX(${off}px)`;
  };
  const up = () => {
    if (!d) return;
    const x = d; d = null; el.classList.remove('dragging');
    if (x.off == null) { if (x.tab) set(!open); return; }    // tap on the tab
    const shut = Math.abs(x.v) > 0.4 ? x.v > 0 : x.off > travel() / 2;
    panel.style.transform = ''; open = !shut; toggle(el, 'open', open);
    if (shut) refresh();
  };
  [tab, el.querySelector('.dhead')].forEach((t) => {
    t.addEventListener('pointerdown', down); t.addEventListener('pointermove', move);
    t.addEventListener('pointerup', up); t.addEventListener('pointercancel', up);
  });

  // badge: a count on the tab (and beside the title)
  const b = cfg.badge;
  let timer = 0;
  function refresh() {
    if (!b) return;
    clearTimeout(timer); timer = setTimeout(refresh, (b.every || 120) * 1000);
    Promise.resolve().then(b.count).then((n) => {
      n = +n || 0; badge.hidden = count.hidden = !n;
      badge.textContent = n > 99 ? '99+' : String(n); count.textContent = `${n} new`;
    }).catch(() => {});
  }
  if (b) { onReady(refresh); if (b.watch) watch(b.watch, () => { clearTimeout(timer); timer = setTimeout(refresh, 1500); }); }

  const L = cfg.live;
  if (L) watch(L.entities, () => toggle(tab, 'live', L.entities.some((id) => { const e = st(id); return !!e && L.on(e); })));
  return el;
}
