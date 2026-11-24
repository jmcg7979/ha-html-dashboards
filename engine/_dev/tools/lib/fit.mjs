// Geometry of the view on screen: what fitcheck.mjs reports per view and size, and what regress.mjs runs on every
// dashboard at its own size.
//   scroll   the page is taller than the screen (by how much)
//   overlap  two cards on top of each other
//   past     something running past its card's edge (horizontally or vertically)
//   cut      text cut off without an ellipsis, or (strict) cut to under 70% of itself with one
//   clash    two parts of one card on top of each other (rows squeezed below their content)
//   crop     a picture (camera, image card) shown in a box much flatter than the picture itself
//   full     a card whose content is taller than the card (it spills over the next one or gets cut)

// Runs in the page; returns { scroll, overlap, past, cut, full, clash, crop } (lists hold up to six findings each).
function measureInPage(STRICT) {
  const vis = (el) => { const s = getComputedStyle(el); const q = el.getBoundingClientRect(); return q.width > 0 && q.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[hidden]'); };
  // in normal flow: not positioned out of it, and not inside something that is (decorations bleed on purpose)
  const flow = (e) => { if (!vis(e)) return false; for (let x = e; x && !x.classList.contains('cell'); x = x.parentElement) { const p = getComputedStyle(x).position; if (p === 'absolute' || p === 'fixed') return false; } return true; };
  const view = [...document.querySelectorAll('#app > .view, #app > .pview')].find((x) => !x.hidden);
  const root = view && (view.querySelector('.vpage:not([hidden])') || view);
  const out = { scroll: Math.max(0, document.documentElement.scrollHeight - innerHeight), overlap: [], past: [], cut: [], full: [], clash: [], crop: [] };
  if (!root) return out;
  const name = (el) => { const c = el.closest('.cell'); const t = c && (c.querySelector('.htitle, .name, .label, .clabel') || {}).textContent; return ((c && c.firstElementChild && c.firstElementChild.className.split(' ')[0]) || '?') + (t ? ` "${t.trim().slice(0, 24)}"` : ''); };
  // cards of the same grid on top of each other
  const cells = [...root.querySelectorAll('.cell')].filter(vis).filter((c) => !c.parentElement.closest('.cell'));
  for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
    const a = cells[i].getBoundingClientRect(), c = cells[j].getBoundingClientRect();
    const x = Math.min(a.right, c.right) - Math.max(a.left, c.left), y = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
    if (x > 2 && y > 2) out.overlap.push(`${name(cells[i])} / ${name(cells[j])} (${Math.round(x)}x${Math.round(y)})`);
  }
  // content past its card, text cut without an ellipsis (not inside a box that scrolls / clips on purpose: maps, cameras, rows)
  // only real scrollers (a row that scrolls, a list) may hold content beyond their box; hidden overflow still counts
  const inner = (el, cell) => { for (let e = el.parentElement; e && e !== cell; e = e.parentElement) { const s = getComputedStyle(e); if (/auto|scroll/.test(s.overflowX + s.overflowY) || e.classList.contains('hrow')) return true; } return false; };
  for (const im of root.querySelectorAll('.cell img, .cell video')) {
    if (im.closest('.mbg')) continue;   // the player's backdrop (the art's wash, the artist's photo: cards/media-detail/backdrop.js) fills its box on purpose
    if (!vis(im) || !im.naturalWidth && !im.videoWidth) continue;
    const r = im.getBoundingClientRect(), nat = (im.naturalWidth || im.videoWidth) / (im.naturalHeight || im.videoHeight), box = r.width / r.height;
    if (getComputedStyle(im).objectFit === 'cover' && box > nat * 1.6) out.crop.push(`${name(im)} shows ${Math.round(100 * nat / box)}% of the picture's height`);
  }
  // a sideways row (.hrow) is padded and pulled out by negative margins to give the highlight room: measure its content
  const rect = (el) => { const r = el.getBoundingClientRect(); if (!el.matches('.hrow')) return r; const cs = getComputedStyle(el), pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
    return { left: r.left, right: r.right, top: r.top + pt, bottom: r.bottom - pb }; };
  for (const box of root.querySelectorAll('.cell *')) {
    if (box.children.length < 2 || box.closest('svg, .camera, .cwall, .leaflet-container, .hrow') || !vis(box)) continue;
    const kids = [...box.children].filter(flow);
    for (let i = 0; i < kids.length - 1; i++) {
      const a = rect(kids[i]), c = rect(kids[i + 1]);
      const x = Math.min(a.right, c.right) - Math.max(a.left, c.left), y = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
      if (x > 4 && y > 4) { out.clash.push(`${name(box)} ${String(kids[i].className).split(' ')[0]}/${String(kids[i + 1].className).split(' ')[0]} ${Math.round(y)}px`); break; }
    }
  }
  for (const cell of root.querySelectorAll('.cell')) {
    if (!vis(cell)) continue;
    const cr = cell.getBoundingClientRect(), card = cell.firstElementChild;
    // any box in the card whose content is taller than the box (squeezed rows, a card shorter than its content)
    for (const e of [card, ...(card ? card.querySelectorAll('*') : [])]) {
      if (!e || !flow(e) || e.closest('svg, .camera, .cwall, .leaflet-container, .hrow') || /auto|scroll/.test(getComputedStyle(e).overflowY) || getComputedStyle(e).display === 'contents' || e.children.length === 0) continue;
      // how far its in-flow children reach below it (decorations positioned absolutely may bleed on purpose)
      const er = e.getBoundingClientRect(), kids = [...e.children].filter(flow);
      const d = kids.length ? Math.round(Math.max(...kids.map((k) => rect(k).bottom)) - er.bottom) : 0;
      if (d > 10 && er.height > 0) {   /* icons bleed a few px on purpose */ out.full.push(`${name(e)} ${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} ${d}px`); break; }
    }
    for (const el of cell.querySelectorAll('*')) {
      if (!vis(el) || el.closest('.camera, .cwall, .drawer, iframe, .mart, .leaflet-container, svg, .hrow, :focus') || el.matches('.hrow') || inner(el, cell) || !flow(el)) continue;   // a sideways row reaches past its column on purpose (room for the highlight); the focused item is enlarged
      const q = el.getBoundingClientRect();
      const over = Math.round(Math.max(q.right - cr.right, cr.left - q.left, q.bottom - cr.bottom, cr.top - q.top));
      // a box that reaches past by its own negative margin and is padded back by as much holds its content inside the
      // card: the room is the highlight's (a list whose rows keep their ring)
      const cs = getComputedStyle(el), bleed = Math.max(...['Top', 'Right', 'Bottom', 'Left'].map((s) => { const m = -parseFloat(cs['margin' + s]) || 0; return m > 0 && parseFloat(cs['padding' + s]) >= m ? m : 0; }));
      if (over > 2 + bleed) { out.past.push(`${name(el)} ${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${over}px`); continue; }
      const s = getComputedStyle(el);
      if (el.children.length === 0 && el.scrollWidth - el.clientWidth > 1 && /hidden|clip/.test(s.overflowX) && (s.textOverflow !== 'ellipsis' || (STRICT && el.clientWidth / el.scrollWidth < 0.7))) out.cut.push(`${name(el)} "${el.textContent.trim().slice(0, 20)}"${s.textOverflow === 'ellipsis' ? ` (${Math.round(100 * el.clientWidth / el.scrollWidth)}% shown)` : ''}`);
    }
  }
  const uniq = (a) => [...new Set(a)].slice(0, 6);
  return { scroll: out.scroll, overlap: uniq(out.overlap), past: uniq(out.past), cut: uniq(out.cut), full: uniq(out.full), clash: uniq(out.clash), crop: uniq(out.crop) };
}

// measure(page, strict): the view the page shows now. strict = TV rules (heavy ellipsis counts).
export const measure = (page, strict = false) => page.evaluate(measureInPage, !!strict);

// The findings as lines ('crop: …', 'full: …'); strict adds scrolling (a TV can't scroll). Empty = the view is fine.
export function problems(r, strict = false) {
  const lines = ['crop', 'clash', 'full', 'overlap', 'past', 'cut'].filter((k) => r[k].length).map((k) => `${k}: ${r[k].join('; ')}`);
  if (strict && r.scroll) lines.push(`scroll: ${r.scroll}px (no scrolling on a TV)`);
  return lines;
}
