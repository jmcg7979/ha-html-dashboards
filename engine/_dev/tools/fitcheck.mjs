// Responsive check: every view and page of a dashboard at every target screen size. Run through shot.sh:
//   SHOT_SCRIPT=fitcheck.mjs engine/_dev/tools/shot.sh mock <site> -- --out DIR [--strict: TV rules, scrolling and heavy ellipsis count] [--d main] [--sizes 960x540,1280x800] [--views weather,systems/nas] [--q tv=x]
// Default sizes = the screens the dashboards run on (engine/docs/design-system.md, "Screens"): TV 960x540 (a 1080p Google TV
// at density 2), panel 1280x800, desktop 1920x1080, vertical 1080x1920. Per view and size it reports:
//   scroll   the page is taller than the screen (by how much)
//   overlap  two cards on top of each other
//   past     something running past its card's edge (horizontally or vertically)
//   cut      text cut off without an ellipsis, or (TV, --strict) cut to under 70% of itself with one
//   clash    two parts of one card on top of each other (rows squeezed below their content)
//   crop     a picture (camera, image card) shown in a box much flatter than the picture itself
//   full     a card whose content is taller than the card (it spills over the next one or gets cut)
// Screenshots land in DIR/<size>/<view>.png. Exit 1 when anything but scroll is found.
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';
const require = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../mock') + '/');
const { chromium } = require('playwright');
const { values: o } = parseArgs({ options: { base: { type: 'string' }, out: { type: 'string' }, d: { type: 'string', default: 'main' },
  sizes: { type: 'string', default: '960x540,1280x800,1920x1080,1080x1920' }, views: { type: 'string' }, q: { type: 'string' }, strict: { type: 'boolean', default: false } } });
if (!o.base || !o.out) { console.error('usage: fitcheck.mjs --base URL --out DIR [--d main] [--sizes WxH,...] [--views a,b/c] [--q k=v]'); process.exit(2); }
const base = o.base.replace(/\/$/, ''), token = process.env.HA_TOKEN || 'A';
const b = await chromium.launch();
let bad = 0;

async function open(p, v) {
  const url = `${base}/index.html?d=${o.d}${o.q ? '&' + o.q : ''}${v ? '&v=' + encodeURIComponent(v) : ''}`;
  await p.goto(url);
  await p.evaluate((t) => localStorage.setItem('hassTokens', JSON.stringify({ hassUrl: location.origin, refresh_token: 'unused', access_token: t, expires: Date.now() + 864e5, clientId: location.origin + '/' })), token);
  await p.goto(url); await p.waitForTimeout(2600);
}

for (const size of o.sizes.split(',')) {
  const [w, h] = size.split('x').map(Number), dir = path.join(o.out, size); fs.mkdirSync(dir, { recursive: true });
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await open(p, '');
  const views = o.views ? o.views.split(',') : await p.evaluate(async (d) => {
    const dash = (await import(new URL(`dashboards/${d}.js`, location.href).href)).default;
    return dash.views.filter((v) => !v.frame).flatMap((v) => (v.pages ? v.pages.map((pg) => v.id + '/' + pg.id) : [v.id]));
  }, o.d);
  console.log(`== ${size}`);
  for (const v of views) {
    await open(p, v);
    const r = await p.evaluate((STRICT) => {
      const vis = (el) => { const s = getComputedStyle(el); const q = el.getBoundingClientRect(); return q.width > 0 && q.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[hidden]'); };
      // in normal flow: not positioned out of it, and not inside something that is (decorations bleed on purpose)
      const flow = (e) => { if (!vis(e)) return false; for (let x = e; x && !x.classList.contains('cell'); x = x.parentElement) { const p = getComputedStyle(x).position; if (p === 'absolute' || p === 'fixed') return false; } return true; };
      const view = [...document.querySelectorAll('#app > .view, #app > .pview')].find((x) => !x.hidden);
      const root = view && (view.querySelector('.vpage:not([hidden])') || view);
      const out = { scroll: Math.max(0, document.documentElement.scrollHeight - innerHeight), overlap: [], past: [], cut: [] };
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
      out.full = []; out.clash = []; out.crop = [];
      for (const im of root.querySelectorAll('.cell img, .cell video')) {   // (blurred backdrops are cropped on purpose)
        if (im.closest('.npbg')) continue;
        if (!vis(im) || !im.naturalWidth && !im.videoWidth) continue;
        const r = im.getBoundingClientRect(), nat = (im.naturalWidth || im.videoWidth) / (im.naturalHeight || im.videoHeight), box = r.width / r.height;
        if (getComputedStyle(im).objectFit === 'cover' && box > nat * 1.6) out.crop.push(`${name(im)} shows ${Math.round(100 * nat / box)}% of the picture's height`);
      }
      for (const box of root.querySelectorAll('.cell *')) {
        if (box.children.length < 2 || box.closest('svg, .camera, .cwall, .leaflet-container, .hrow') || !vis(box)) continue;
        const kids = [...box.children].filter(flow);
        for (let i = 0; i < kids.length - 1; i++) {
          const a = kids[i].getBoundingClientRect(), c = kids[i + 1].getBoundingClientRect();
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
          const d = kids.length ? Math.round(Math.max(...kids.map((k) => k.getBoundingClientRect().bottom)) - er.bottom) : 0;
          if (d > 10 && er.height > 0) {   /* icons bleed a few px on purpose */ out.full.push(`${name(e)} ${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} ${d}px`); break; }
        }
        for (const el of cell.querySelectorAll('*')) {
          if (!vis(el) || el.closest('.camera, .cwall, .drawer, iframe, .mart, .leaflet-container, svg, .hrow, :focus') || el.matches('.hrow') || inner(el, cell) || !flow(el)) continue;   // a sideways row reaches past its column on purpose (room for the highlight); the focused item is enlarged
          const q = el.getBoundingClientRect();
          const over = Math.round(Math.max(q.right - cr.right, cr.left - q.left, q.bottom - cr.bottom, cr.top - q.top));
          if (over > 2) { out.past.push(`${name(el)} ${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${over}px`); continue; }
          const s = getComputedStyle(el);
          if (el.children.length === 0 && el.scrollWidth - el.clientWidth > 1 && /hidden|clip/.test(s.overflowX) && (s.textOverflow !== 'ellipsis' || (STRICT && el.clientWidth / el.scrollWidth < 0.7))) out.cut.push(`${name(el)} "${el.textContent.trim().slice(0, 20)}"${s.textOverflow === 'ellipsis' ? ` (${Math.round(100 * el.clientWidth / el.scrollWidth)}% shown)` : ''}`);
        }
      }
      const uniq = (a) => [...new Set(a)].slice(0, 6);
      return { scroll: out.scroll, overlap: uniq(out.overlap), past: uniq(out.past), cut: uniq(out.cut), full: uniq(out.full), clash: uniq(out.clash), crop: uniq(out.crop) };
    }, !!o.strict);
    await p.screenshot({ path: path.join(dir, v.replace(/\//g, '-') + '.png') });
    const issues = [r.crop.length && `crop: ${r.crop.join('; ')}`, r.clash.length && `clash: ${r.clash.join('; ')}`, r.full.length && `full: ${r.full.join('; ')}`, r.overlap.length && `overlap: ${r.overlap.join('; ')}`, r.past.length && `past: ${r.past.join('; ')}`, r.cut.length && `cut: ${r.cut.join('; ')}`].filter(Boolean);
    if (o.strict && r.scroll) issues.push(`scroll: ${r.scroll}px (no scrolling on a TV)`);
    if (issues.length) bad++;
    console.log(`  ${issues.length ? 'X' : r.scroll ? '~' : 'ok'} ${v}${r.scroll ? ` (scrolls ${r.scroll}px)` : ''}${issues.length ? '\n      ' + issues.join('\n      ') : ''}`);
  }
  await p.close();
}
await b.close();
console.log(bad ? `${bad} view/size combinations with problems` : 'no overlaps, nothing past its card, nothing cut');
process.exit(bad ? 1 : 0);
