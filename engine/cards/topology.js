// Infrastructure as a live map: each device / VM / container is a node placed by its depth in the tree,
// wired to its parent; a node's colour is its health (core/assess.js), its line is one live figure, tap opens its page.
// Links that carry measured traffic show dots travelling from parent to child (GPU transforms along the curve, so they keep
// moving when the page is busy; hidden when the link is idle).
// { type: 'topology', columns: '0.85fr 1fr 1fr 1fr' (optional column widths), root: { name, icon, node (health def), metric: () => 'text', watch: [...], page,
//     flow: { entities: [...], value: () => number (Mbit/s), label: () => 'text' },   // traffic on the link into this node
//     dots: [entity...] (small status dots, e.g. access points), children: [...],
//     inline: true (on a node's only child: drawn directly below it in the same column, e.g. gateway -> switch) } }
//   treeBelow: 600 (optional, px at --s 1): narrower than this (a phone), the map becomes an indented tree, one node per row,
//     wired with elbow lines from the parent's icon; same nodes, health, links and traffic dots.
import { h, esc, icon, setText, setHTML } from '../core/dom.js';
import { st, watch } from '../core/store.js';
import { assess, nodeIds, LEVEL_TONE } from '../core/assess.js';

export const panel = true;   // on a page: its own glass panel (core/layout.js)

export default function topology(cfg) {
  const el = h(`<div class="topo"><svg class="tlinks"></svg></div>`);
  const svg = el.querySelector('.tlinks'), all = [];
  // place: column = depth, row = centre of its leaves
  let leaf = 0, depth = 0;
  (function place(n, d) {
    depth = Math.max(depth, d); n._d = d;
    const kids = n.children || [];
    if (kids.length === 1 && kids[0].inline) { kids[0]._p = n; place(kids[0], d); n._r = kids[0]._r - 1; }
    else if (kids.length) { kids.forEach((c) => { c._p = n; place(c, d + 1); }); n._r = (kids[0]._r + kids[kids.length - 1]._r) / 2; }
    else n._r = leaf++;
    all.push(n);
  })(cfg.root, 0);
  const lo = Math.min(...all.map((n) => n._r)); if (lo < 0) { all.forEach((n) => { n._r -= lo; }); leaf -= lo; }
  // a chain in the first column (gateway -> switch) sits in the middle of the map's height
  const chain = all.filter((n) => n._d === 0);
  if (chain.length > 1) { const mid = chain.reduce((a, n) => a + n._r, 0) / chain.length, want = (leaf - 1) / 2; chain.forEach((n) => { n._r += want - mid; }); }
  
  const rows = Math.ceil(leaf), cols = depth + 1;

  // tree order (parent before children) for the narrow layout
  const pre = []; (function walk(n, d) { n._td = d; pre.push(n); (n.children || []).forEach((c) => walk(c, c.inline ? d : d + 1)); })(cfg.root, 0);
  let tree = null;
  const layout = (narrow) => {
    if (narrow === tree) return false;
    tree = narrow; el.classList.toggle('tree', narrow);
    el.style.gridTemplateColumns = narrow ? 'minmax(0, 1fr)' : cfg.columns || `repeat(${cols}, minmax(0, 1fr))`;
    el.style.gridTemplateRows = narrow ? '' : `repeat(${rows * 2}, minmax(0, 1fr))`;
    all.forEach((n) => {
      n._el.style.gridColumn = narrow ? '1' : String(n._d + 1);
      n._el.style.gridRow = narrow ? String(pre.indexOf(n) + 1) : `${n._r * 2 + 1} / span 2`;
      n._el.style.setProperty('--d', narrow ? n._td : 0);
    });
    return true;
  };

  all.forEach((n) => {
    n._el = h(`<button class="tnode${n.page ? ' tap' : ''}"><span class="tic">${icon(n.icon)}</span><span class="ttx"><span class="tname">${esc(n.name)}</span><span class="tmet"></span></span>
      ${n.dots ? `<span class="tdots">${n.dots.map(() => '<i></i>').join('')}</span>` : ''}</button>`);
    if (n.page) n._el.addEventListener('click', () => window.dispatchEvent(new CustomEvent('dash:view', { detail: n.page })));
    el.appendChild(n._el);
    const met = n._el.querySelector('.tmet'), dots = [...n._el.querySelectorAll('.tdots i')];
    watch([...nodeIds(n.node || {}), ...(n.watch || []), ...(n.dots || [])], () => {
      const a = assess(n.node || {});
      n._el.style.setProperty('--t', `var(--${LEVEL_TONE[a.level]})`); n._el.classList.toggle('warn', a.level > 0);
      n._level = a.level;
      setText(met, n.metric ? n.metric() : '');
      dots.forEach((d, i) => { const e = st(n.dots[i]); d.className = e && e.state === 'connected' ? 'ok' : 'bad'; });
      if (n._link) n._link.setAttribute('class', 'tl' + (a.level ? ' l' + a.level : '') + (n._link.classList.contains('flow') ? ' flow' : ''));
    });
  });

  // links: drawn from the real node boxes, so they follow any size the tokens give
  const draw = () => {
    const box = el.getBoundingClientRect(); if (!box.width) return;
    svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    svg.innerHTML = '';
    all.forEach((n) => {
      if (!n._p) return;
      const a = n._p._el.getBoundingClientRect(), b = n._el.getBoundingClientRect();
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      if (tree) {   // elbow from under the parent's icon down to the child's left edge (an inline child: straight down)
        // Each child owns only its own stretch of the shared trunk: from the sibling above's elbow (or the parent) down to its row.
        // No two links overlap, so the traffic dots and health colours of siblings never sit on top of each other.
        const ic = n._p._el.querySelector('.tic').getBoundingClientRect(), x0 = ic.left + ic.width / 2 - box.left, x1 = b.left - box.left, y1 = b.top + b.height / 2 - box.top;
        const sib = n._p.children.filter((c) => !c.inline), prev = sib[sib.indexOf(n) - 1];
        const r = Math.min(10, Math.max(0, x1 - x0), b.height / 2);
        const y0 = prev && !n.inline ? (() => { const pb = prev._el.getBoundingClientRect(); return pb.top + pb.height / 2 - box.top - r; })() : a.bottom - box.top;
        p.setAttribute('d', n.inline || x1 <= x0 ? `M${x0},${y0}L${x0},${b.top - box.top}` : `M${x0},${y0}L${x0},${y1 - r}Q${x0},${y1} ${x0 + r},${y1}L${x1},${y1}`);
      } else if (n.inline) { const x = a.left + a.width / 2 - box.left; p.setAttribute('d', `M${x},${a.bottom - box.top}L${x},${b.top - box.top}`); }
      else { const sib = n._p.children.filter((c) => !c.inline), k = sib.length, i = sib.indexOf(n), step = Math.min(7, a.height / (k + 1));
        const x0 = a.right - box.left, y0 = a.top + a.height / 2 - box.top + (i - (k - 1) / 2) * step,   // fanned out along the parent's edge
          x1 = b.left - box.left, y1 = b.top + b.height / 2 - box.top, mx = (x0 + x1) / 2;
        p.setAttribute('d', `M${x0},${y0}C${mx},${y0} ${mx},${y1} ${x1},${y1}`); }
      p.setAttribute('class', 'tl' + (n._level ? ' l' + n._level : ''));
      svg.appendChild(p); n._link = p;
      if (n.flow) dots(n, p);
    });
  };
  // dots: one per DOT_GAP px of path, all on the same keyframes (points sampled along the path), staggered by negative delays
  // busier links carry more dots (same speed): px between dots by Mbit/s
  const SPEED = 34, gapFor = (v) => (v < 1 ? 60 : v < 10 ? 38 : v < 50 ? 26 : 17);
  const dots = (n, path) => {
    (n._dots || []).forEach((d) => d.remove());
    const len = path.getTotalLength(), steps = Math.max(8, Math.round(len / 6));
    const frames = Array.from({ length: steps + 1 }, (_, i) => { const pt = path.getPointAtLength((len * i) / steps); return { transform: `translate(${pt.x.toFixed(1)}px, ${pt.y.toFixed(1)}px)` }; });
    n._gap = gapFor(n.flow.value()); n._path = path;
    const dur = (len / SPEED) * 1000, count = Math.max(1, Math.floor(len / n._gap));
    n._dots = Array.from({ length: count }, (_, i) => {
      const d = document.createElement('i'); d.className = 'tdot'; el.appendChild(d);
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) d.animate(frames, { duration: dur, iterations: Infinity, delay: -(dur * i) / count, easing: 'linear' });
      return d;
    });
    n._dots.forEach((d) => { d.hidden = !(n.flow.value() > 0.05); });
  };
  // traffic on or off
  const flow = (n) => {
    const v = n.flow.value();
    if (n._path && gapFor(v) !== n._gap) return dots(n, n._path);   // traffic moved to another band: re-space the dots
    (n._dots || []).forEach((d) => { d.hidden = !(v > 0.05); });
  };
  all.filter((n) => n.flow).forEach((n) => watch(n.flow.entities, () => flow(n)));
  // the layout follows the space the card has, not the device
  const scale = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s')) || 1;
  const TREE = cfg.treeBelow || 600;
  new ResizeObserver(() => { const w = el.getBoundingClientRect().width; if (!w) return; if (!layout(w < TREE * scale())) draw(); else requestAnimationFrame(draw); }).observe(el);
  layout(false);
  return el;
}
