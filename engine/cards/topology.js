// Infrastructure as a live map: each device / VM / container is a node placed by its depth in the tree,
// wired to its parent; a node's color is its health (core/assess.js), its line is one live figure, tap opens its page.
// Links that carry measured traffic show dots traveling from parent to child (GPU transforms along the curve, so they keep
// moving when the page is busy; hidden when the link is idle; none at all for someone who asked for reduced motion).
// What the card works out per node (its place, element, link and dots) lives in the card, never on the config: the
// config outlives the view, and anything left on it would keep the unloaded view's elements in memory.
// { type: 'topology', columns: '0.85fr 1fr 1fr 1fr' (optional column widths), root: { name, icon, node (health def), metric: () => 'text', watch: [...], page,
//     flow: { entities: [...], value: () => number (Mbit/s), label: () => 'text' },   // traffic on the link into this node
//     dots: [entity...] (small status dots, e.g. access points), children: [...],
//     inline: true (on a node's only child: drawn directly below it in the same column, e.g. gateway -> switch) } }
//   treeBelow: 600 (optional, px at --s 1): narrower than this (a phone), the map becomes an indented tree, one node per row,
//     wired with elbow lines from the parent's icon; same nodes, health, links and traffic dots.
import { h, esc, icon, setText } from '../core/dom.js';
import { onDispose } from '../core/scope.js';
import { st, watch } from '../core/store.js';
import { assess, nodeIds, LEVEL_TONE } from '../core/assess.js';

export const panel = true;   // on a page: its own glass panel (core/layout.js)

export default function topology(cfg) {
  const el = h(`<div class="topo"><svg class="tlinks"></svg></div>`);
  const svg = el.querySelector('.tlinks'), all = [];
  const S = new Map(), of = (n) => S.get(n);   // node -> { d: column, r: row, p: parent, td: depth in the tree, el, level, link, dots, gap }
  // place: column = depth, row = center of its leaves
  let leaf = 0, depth = 0;
  (function place(n, d, p) {
    depth = Math.max(depth, d); const me = { d, p }; S.set(n, me);
    const kids = n.children || [];
    if (kids.length === 1 && kids[0].inline) { place(kids[0], d, n); me.r = of(kids[0]).r - 1; }
    else if (kids.length) { kids.forEach((c) => place(c, d + 1, n)); me.r = (of(kids[0]).r + of(kids[kids.length - 1]).r) / 2; }
    else me.r = leaf++;
    all.push(n);
  })(cfg.root, 0, null);
  const lo = Math.min(...all.map((n) => of(n).r)); if (lo < 0) { all.forEach((n) => { of(n).r -= lo; }); leaf -= lo; }
  // a chain in the first column (gateway -> switch) sits in the middle of the map's height
  const chain = all.filter((n) => of(n).d === 0);
  if (chain.length > 1) { const mid = chain.reduce((a, n) => a + of(n).r, 0) / chain.length, want = (leaf - 1) / 2; chain.forEach((n) => { of(n).r += want - mid; }); }

  const rows = Math.ceil(leaf), cols = depth + 1;

  // tree order (parent before children) for the narrow layout
  const pre = []; (function walk(n, d) { of(n).td = d; pre.push(n); (n.children || []).forEach((c) => walk(c, c.inline ? d : d + 1)); })(cfg.root, 0);
  let tree = null;
  const layout = (narrow) => {
    if (narrow === tree) return false;
    tree = narrow; el.classList.toggle('tree', narrow);
    el.style.gridTemplateColumns = narrow ? 'minmax(0, 1fr)' : cfg.columns || `repeat(${cols}, minmax(0, 1fr))`;
    el.style.gridTemplateRows = narrow ? '' : `repeat(${rows * 2}, minmax(0, 1fr))`;
    all.forEach((n) => {
      const me = of(n);
      me.el.style.gridColumn = narrow ? '1' : String(me.d + 1);
      // a parent sits midway between its first and last child: with an even number of leaves under one of them that is a
      // quarter row, which a grid line can't be (the node would be placed by itself, at the top): the nearest half row
      me.el.style.gridRow = narrow ? String(pre.indexOf(n) + 1) : `${Math.round(me.r * 2) + 1} / span 2`;
      me.el.style.setProperty('--d', narrow ? me.td : 0);
    });
    return true;
  };
  const linkClass = (me) => 'tl' + (me.level ? ' l' + me.level : '');

  all.forEach((n) => {
    const me = of(n);
    me.el = h(`<button class="tnode${n.page ? ' tap' : ''}"><span class="tic">${icon(n.icon)}</span><span class="ttx"><span class="tname">${esc(n.name)}</span><span class="tmet"></span></span>
      ${n.dots ? `<span class="tdots">${n.dots.map(() => '<i></i>').join('')}</span>` : ''}</button>`);
    if (n.page) me.el.addEventListener('click', () => window.dispatchEvent(new CustomEvent('dash:view', { detail: n.page })));
    el.appendChild(me.el);
    const met = me.el.querySelector('.tmet'), dots = [...me.el.querySelectorAll('.tdots i')];
    watch([...nodeIds(n.node || {}), ...(n.watch || []), ...(n.dots || [])], () => {
      const a = assess(n.node || {});
      me.el.style.setProperty('--t', `var(--${LEVEL_TONE[a.level]})`); me.el.classList.toggle('warn', a.level > 0);
      me.level = a.level;
      setText(met, n.metric ? n.metric() : '');
      dots.forEach((d, i) => { const e = st(n.dots[i]); d.className = e && e.state === 'connected' ? 'ok' : 'bad'; });
      if (me.link) me.link.setAttribute('class', linkClass(me));
    });
  });

  // links: drawn from the real node boxes, so they follow any size the tokens give
  const draw = () => {
    const box = el.getBoundingClientRect(); if (!box.width) return;
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    svg.innerHTML = '';
    all.forEach((n) => {
      const me = of(n); if (!me.p) return;
      const a = of(me.p).el.getBoundingClientRect(), b = me.el.getBoundingClientRect();
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      if (tree) {   // elbow from under the parent's icon down to the child's left edge (an inline child: straight down)
        // Each child owns only its own stretch of the shared trunk: from the sibling above's elbow (or the parent) down to its row.
        // No two links overlap, so the traffic dots and health colors of siblings never sit on top of each other.
        const ic = of(me.p).el.querySelector('.tic').getBoundingClientRect(), x0 = ic.left + ic.width / 2 - box.left, x1 = b.left - box.left, y1 = b.top + b.height / 2 - box.top;
        const sib = me.p.children.filter((c) => !c.inline), prev = sib[sib.indexOf(n) - 1];
        const r = Math.min(10, Math.max(0, x1 - x0), b.height / 2);
        const y0 = prev && !n.inline ? (() => { const pb = of(prev).el.getBoundingClientRect(); return pb.top + pb.height / 2 - box.top - r; })() : a.bottom - box.top;
        p.setAttribute('d', n.inline || x1 <= x0 ? `M${x0},${y0}L${x0},${b.top - box.top}` : `M${x0},${y0}L${x0},${y1 - r}Q${x0},${y1} ${x0 + r},${y1}L${x1},${y1}`);
      } else if (n.inline) { const x = a.left + a.width / 2 - box.left; p.setAttribute('d', `M${x},${a.bottom - box.top}L${x},${b.top - box.top}`); }
      else { const sib = me.p.children.filter((c) => !c.inline), k = sib.length, i = sib.indexOf(n), step = Math.min(7, a.height / (k + 1));
        const x0 = a.right - box.left, y0 = a.top + a.height / 2 - box.top + (i - (k - 1) / 2) * step,   // fanned out along the parent's edge
          x1 = b.left - box.left, y1 = b.top + b.height / 2 - box.top, mx = (x0 + x1) / 2;
        p.setAttribute('d', `M${x0},${y0}C${mx},${y0} ${mx},${y1} ${x1},${y1}`); }
      p.setAttribute('class', linkClass(me));
      svg.appendChild(p); me.link = p;
      if (n.flow) dots(n);
    });
  };
  // dots: one per DOT_GAP px of path, all on the same keyframes (points sampled along the path), staggered by negative delays
  // busier links carry more dots (same speed): px between dots by Mbit/s
  // An endless animation has to be ended by hand: one left on a removed dot keeps the whole page drawing 60 frames a
  // second for good (a third of a TV's processor). They also stand still while the card is out of sight.
  let seen = true;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;   // a dot that can't travel would sit at the map's corner: no dots then
  const drop = (d) => { if (d._a) d._a.cancel(); d.remove(); };
  const every = (f) => S.forEach((me) => (me.dots || []).forEach((d) => { if (d._a) f(d._a); }));
  onDispose(() => every((a) => a.cancel()));
  new IntersectionObserver((en) => { seen = en[en.length - 1].isIntersecting; every((a) => (seen ? a.play() : a.pause())); }).observe(el);
  const SPEED = 34, gapFor = (v) => (v < 1 ? 60 : v < 10 ? 38 : v < 50 ? 26 : 17);
  const traffic = (n) => +n.flow.value() || 0;   // Mbit/s; no figure (nothing reporting) is no traffic
  const dots = (n) => {
    const me = of(n), path = me.link, v = traffic(n);
    (me.dots || []).forEach(drop); me.dots = []; me.gap = gapFor(v);
    if (still) return;
    const len = path.getTotalLength(), steps = Math.max(8, Math.round(len / 6));
    const frames = Array.from({ length: steps + 1 }, (_, i) => { const pt = path.getPointAtLength((len * i) / steps); return { transform: `translate(${pt.x.toFixed(1)}px, ${pt.y.toFixed(1)}px)` }; });
    const dur = (len / SPEED) * 1000, count = Math.max(1, Math.floor(len / me.gap));
    me.dots = Array.from({ length: count }, (_, i) => {
      const d = document.createElement('i'); d.className = 'tdot'; d.hidden = !(v > 0.05); el.appendChild(d);
      d._a = d.animate(frames, { duration: dur, iterations: Infinity, delay: -(dur * i) / count, easing: 'linear' }); if (!seen) d._a.pause();
      return d;
    });
  };
  // traffic on or off
  const flow = (n) => {
    const me = of(n), v = traffic(n);
    if (me.link && gapFor(v) !== me.gap) return dots(n);   // traffic moved to another band: re-space the dots
    (me.dots || []).forEach((d) => { d.hidden = !(v > 0.05); });
  };
  all.filter((n) => n.flow).forEach((n) => watch(n.flow.entities, () => flow(n)));
  // the layout follows the space the card has, not the device
  const scale = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s')) || 1;
  const TREE = cfg.treeBelow || 600;
  new ResizeObserver(() => { const w = el.getBoundingClientRect().width; if (!w) return; if (!layout(w < TREE * scale())) draw(); else requestAnimationFrame(draw); }).observe(el);
  layout(false);
  return el;
}
