// Pull-out drawer: a glass panel that slides over the page from the right edge, opened by the action { drawer: '<id>' }.
// Close with its button, a tap outside, dragging its header back, Escape or the remote's Back (core/layers.js) or leaving the view. Pop-ups opened from it sit above
// it, so the drawer is still open behind them. Content is any cards; closed, it is off screen, so cards that load only
// while visible (Events) wait until it opens.
// { type: 'drawer', id: 'events', title: 'Events', tone: 'mist', width: 420 (px at --s 1), cards: [...] }
import { h, esc, icon, toggle, setTone } from '../core/dom.js';
import { layer } from '../core/layers.js';

export default function drawer(cfg, ctx) {
  ctx.cell.classList.add('floating');   // takes no room in the grid
  const el = h(`<div class="drawer" style="--dw:calc(${cfg.width || 420}px * var(--s))">
    <div class="dscrim"></div>
    <div class="dpanel" role="dialog" aria-label="${esc(cfg.title || '')}">
      <div class="dhead"><div class="dtitle">${esc(cfg.title || '')}</div><button class="rbtn dclose" aria-label="Close">${icon('chevron-right')}</button></div>
      <div class="dbody"></div>
    </div></div>`);
  setTone(el, cfg.tone || 'mist');
  const panel = el.querySelector('.dpanel'), head = el.querySelector('.dhead');
  el.querySelector('.dbody').appendChild(ctx.grid(cfg.cards || [], 12, ctx.home, undefined, {})   /* a sheet, like a pop-up: no page panels */);

  let open = false;
  const L = layer({ el, kind: 'drawer', scope: panel, close: () => set(false) });
  // (closed, nothing in it takes the remote's highlight, also while it still slides out)
  const show = (o) => { open = o; panel.style.transform = ''; toggle(el, 'open', o); panel.toggleAttribute('data-nofocus', !o); if (o) L.open(); else L.shut(); };
  panel.toggleAttribute('data-nofocus', true);
  const set = (o) => { if (o !== open) show(o); };
  el.querySelector('.dscrim').addEventListener('click', () => set(false));
  el.querySelector('.dclose').addEventListener('click', () => set(false));
  window.addEventListener('dash:view', () => set(false));
  window.addEventListener('dash:drawer', (e) => { if (cfg.id && e.detail === cfg.id) set(true); });

  // drag the header: the panel follows the finger, then stays open or snaps shut
  const travel = () => panel.offsetWidth + parseFloat(getComputedStyle(panel).right || 0);
  let d = null;
  const down = (e) => {
    if (e.button > 0 || e.target.closest('.dclose')) return;
    d = { x: e.clientX, t: e.timeStamp, base: open ? 0 : travel(), off: null, v: 0 };
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
    if (x.off == null) return;   // a tap, not a drag
    const shut = Math.abs(x.v) > 0.4 ? x.v > 0 : x.off > travel() / 2;
    show(!shut);
  };
  head.addEventListener('pointerdown', down); head.addEventListener('pointermove', move);
  head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
  return el;
}
