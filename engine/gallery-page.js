// gallery.html: the gallery dashboard (?d=gallery, dashboards/gallery.js) in frames at real screen sizes, plus two design checks:
//   Clipping  - anything that runs past its card's edge, in every frame
//   Baseline / Compare - saves every element's computed style per frame (IndexedDB), then lists what changed after an edit
// Frames are fixed-size iframes (display:block; flex:none), so each one gets exactly that innerWidth whatever the browser zoom.
const SIZES = [
  { id: 'phone', label: 'Phone 390', w: 390, h: 844 },
  { id: 'mid', label: 'In-between 900', w: 900, h: 800 },
  { id: 'portal', label: 'Portal 1280', w: 1280, h: 800 },
  { id: 'desk', label: 'Desktop 1920', w: 1920, h: 1080 },
];
const P = ['display', 'position', 'visibility', 'width', 'height', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-left',
  'grid-template-columns', 'grid-column', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'column-gap', 'row-gap', 'font-size', 'font-weight',
  'line-height', 'white-space', 'text-overflow', 'overflow-x', '-webkit-line-clamp', 'color', 'background-color', 'border-radius', 'border-top-width', 'opacity', 'transform'];
const q = new URLSearchParams(location.search);
let view = q.get('v') || 'controls', zoom = +(q.get('z') || 0.5);

document.head.insertAdjacentHTML('beforeend', `<style>
:root { color-scheme: dark; font: 14px/1.4 system-ui, sans-serif; }
body { margin: 0; background: #14110f; color: #eee6dc; }
header { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 16px; background: #1f1a16; border-bottom: 1px solid #3a322b; }
header b { margin-right: 8px; }
button, select { font: inherit; color: inherit; background: #2c251f; border: 1px solid #4a4037; border-radius: 8px; padding: 6px 10px; cursor: pointer; }
button:hover { background: #3a3028; }
.frames { display: flex; flex-wrap: wrap; gap: 20px; padding: 16px; align-items: flex-start; }
.fr { flex: none; }
.fr h3 { margin: 0 0 6px; font-size: 13px; font-weight: 600; color: #b9ad9f; }
.fr .box { overflow: hidden; border: 1px solid #3a322b; border-radius: 10px; }
.fr iframe { display: block; flex: none; border: 0; transform-origin: 0 0; }
#out { margin: 0 16px 24px; padding: 12px; background: #1f1a16; border-radius: 10px; white-space: pre-wrap; font: 12px/1.5 ui-monospace, monospace; max-height: 50vh; overflow: auto; }
#out:empty { display: none; }
#out .row { cursor: pointer; } #out .row:hover { color: #fff; text-decoration: underline; }
</style>`);
document.body.innerHTML = `<header><b>Component gallery</b>
  <select id="view"></select>
  <select id="zoom">${[1, 0.75, 0.5, 0.33].map((z) => `<option value="${z}">${Math.round(z * 100)}%</option>`).join('')}</select>
  <button id="reload">Reload</button>
  <span style="flex:1"></span>
  <button id="clip">Find clipping</button><button id="save">Save baseline</button><button id="cmp">Compare</button>
</header><div class="frames"></div><div id="out"></div>`;
const $ = (s) => document.querySelector(s);
const out = $('#out'), framesEl = $('.frames');
$('#zoom').value = String(zoom);

function build() {
  framesEl.innerHTML = SIZES.map((s) => `<div class="fr" data-id="${s.id}"><h3>${s.label} × ${s.h}</h3><div class="box" style="width:${s.w * zoom}px;height:${s.h * zoom}px">
    <iframe src="start.html?d=gallery&v=${encodeURIComponent(view)}" style="width:${s.w}px;height:${s.h}px;transform:scale(${zoom})"></iframe></div></div>`).join('');
  const f = framesEl.querySelector('iframe');
  f.addEventListener('load', () => fillPicker(f), { once: true });
  history.replaceState(null, '', `?v=${encodeURIComponent(view)}&z=${zoom}`);
}
// view list comes from the dashboard itself (its rail), so new categories appear on their own
async function fillPicker(f) {
  const doc = await ready(f, 15000).catch(() => null); if (!doc) return;
  const links = [...doc.querySelectorAll('#rail a[data-v]')];
  $('#view').innerHTML = links.map((a) => `<option value="${a.dataset.v}">${a.textContent.trim()}</option>`).join('');
  $('#view').value = view;
}
const frames = () => [...framesEl.querySelectorAll('.fr')].map((el) => ({ id: el.dataset.id, f: el.querySelector('iframe') }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// a frame is ready when its view has cells and the element count has settled (live charts keep redrawing, so "settled" = within 2%
// for a second, or 8 s after the cells appeared)
async function ready(f, limit = 30000) {
  const t0 = Date.now(); let last = -1, still = 0, seen = 0;
  while (Date.now() - t0 < limit) {
    const d = f.contentDocument, n = d ? d.querySelectorAll('#app .view:not([hidden]) *').length : 0;
    if (n > 20) { seen = seen || Date.now(); if (Math.abs(n - last) <= n * 0.02) { if (++still >= 4) return d; } else still = 0; if (Date.now() - seen > 8000) return d; }
    last = n; await sleep(250);
  }
  throw new Error('frame not ready');
}
const visible = (el, win) => { const cs = win.getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length; };
const pathOf = (el, root) => { const p = []; for (let e = el; e && e !== root; e = e.parentElement) { const i = e.parentElement ? [...e.parentElement.children].indexOf(e) : 0; p.unshift(e.tagName.toLowerCase() + (e.classList[0] ? '.' + e.classList[0] : '') + ':' + i); } return p.join('>'); };
const label = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
const cardOf = (el) => { const c = el.closest('.cell'); const sec = el.closest('.section'); const lab = sec && sec.querySelector('.label'); return (lab ? lab.textContent.split('·')[0].trim() : '?') + (c ? ' [' + Math.round(c.getBoundingClientRect().width) + 'px]' : ''); };
const rnd = (v) => v.replace(/-?\d+\.\d+px/g, (m) => (Math.round(parseFloat(m) * 2) / 2) + 'px');

function snap(doc) {
  const win = doc.defaultView, root = doc.querySelector('#app .view:not([hidden])'), map = {};
  if (!root) return map;
  for (const el of root.querySelectorAll('*')) {
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
    const cs = win.getComputedStyle(el); map[pathOf(el, root)] = P.map((p) => rnd(cs.getPropertyValue(p)));
  }
  return map;
}
// IndexedDB: one record per view|frame
const db = () => new Promise((res, rej) => { const r = indexedDB.open('dashGallery', 1); r.onupgradeneeded = () => r.result.createObjectStore('base'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const put = async (k, v) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('base', 'readwrite'); t.objectStore('base').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); };
const get = async (k) => { const d = await db(); return new Promise((res, rej) => { const r = d.transaction('base').objectStore('base').get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); };

let targets = [];
const say = (lines) => { targets = []; out.innerHTML = ''; lines.forEach((l) => { const d = document.createElement('div'); if (typeof l === 'string') d.textContent = l; else { d.textContent = l.text; d.className = 'row'; d.onclick = () => flash(l.el); } out.appendChild(d); }); };
function flash(el) { if (!el || !el.isConnected) return; el.scrollIntoView({ block: 'center' }); const o = el.style.outline; el.style.outline = '3px solid #ff5a36'; setTimeout(() => { el.style.outline = o; }, 2500); }

// content cut off by a scrolling / clipping box inside the card is that box's job (a map, a scroller), not a layout overflow
const clippedInside = (el, cell, win) => { for (let e = el.parentElement; e && e !== cell; e = e.parentElement) if (win.getComputedStyle(e).overflowX !== 'visible') return true; return false; };
$('#clip').onclick = async () => {
  say(['Checking…']); const lines = [];
  for (const { id, f } of frames()) {
    const doc = await ready(f).catch(() => null); if (!doc) { lines.push(id + ': not ready'); continue; }
    const win = doc.defaultView; let n = 0;
    for (const cell of doc.querySelectorAll('#app .view:not([hidden]) .cell')) {
      if (!visible(cell, win)) continue;
      const cr = cell.getBoundingClientRect();
      for (const el of cell.querySelectorAll('*')) {
        if (!visible(el, win) || el.closest('.camera, .cwall, .drawer, iframe, .mart, .leaflet-container') || clippedInside(el, cell, win)) continue;
        const r = el.getBoundingClientRect(); if (!r.width) continue;
        const over = Math.round(Math.max(r.right - cr.right, cr.left - r.left));
        const cut = el.scrollWidth - el.clientWidth > 1 && /hidden|clip/.test(win.getComputedStyle(el).overflowX) && win.getComputedStyle(el).textOverflow !== 'ellipsis' && el.children.length === 0;
        if (over > 1 || cut) { lines.push({ text: `${id}  ${cardOf(el)}  ${label(el)}  ${over > 1 ? 'runs ' + over + 'px past the card' : 'text cut ' + (el.scrollWidth - el.clientWidth) + 'px (no ellipsis)'}`, el }); n++; }
      }
    }
    if (!n) lines.push(id + ': nothing runs past its card');
  }
  say(lines);
};
$('#save').onclick = async () => {
  say(['Saving…']); const lines = [];
  for (const { id, f } of frames()) { const doc = await ready(f).catch(() => null); if (!doc) { lines.push(id + ': not ready'); continue; } const m = snap(doc); await put(view + '|' + id, { at: Date.now(), m }); lines.push(`${id}: ${Object.keys(m).length} elements saved`); }
  say([`Baseline for "${view}" saved ${new Date().toLocaleString()}`, ...lines, 'Edit, deploy, press Reload, then Compare.']);
};
$('#cmp').onclick = async () => {
  say(['Comparing…']); const lines = [];
  for (const { id, f } of frames()) {
    const base = await get(view + '|' + id); if (!base) { lines.push(id + ': no baseline (press Save baseline first)'); continue; }
    const doc = await ready(f).catch(() => null); if (!doc) { lines.push(id + ': not ready'); continue; }
    const now = snap(doc), root = doc.querySelector('#app .view:not([hidden])');
    const byPath = new Map([...root.querySelectorAll('*')].map((el) => [pathOf(el, root), el]));
    let changed = 0, added = 0, gone = 0; const rows = [];
    for (const [k, v] of Object.entries(now)) {
      const b = base.m[k]; if (!b) { added++; continue; }
      const d = P.map((p, i) => (b[i] !== v[i] ? `${p}: ${b[i]} → ${v[i]}` : null)).filter(Boolean);
      if (d.length) { changed++; if (rows.length < 150) { const el = byPath.get(k); rows.push({ text: `  ${el ? cardOf(el) + '  ' + label(el) : k}\n     ${d.join('; ')}`, el }); } }
    }
    for (const k of Object.keys(base.m)) if (!now[k]) gone++;
    lines.push(`${id}: ${changed} changed, ${added} new, ${gone} removed (baseline ${new Date(base.at).toLocaleString()})`, ...rows);
  }
  lines.push('', 'Live data can change some colours and sizes (a light turning on, a longer name). Click a row to find it.');
  say(lines);
};
// one check at a time; the buttons are disabled while it runs
for (const id of ['clip', 'save', 'cmp']) { const b = $('#' + id), fn = b.onclick; b.onclick = async () => { const all = document.querySelectorAll('header button, header select'); all.forEach((x) => { x.disabled = true; }); try { await fn(); } catch (e) { say(['Failed: ' + e.message]); } finally { all.forEach((x) => { x.disabled = false; }); } }; }
$('#view').onchange = (e) => { view = e.target.value; build(); };
$('#zoom').onchange = (e) => { zoom = +e.target.value; build(); };
$('#reload').onclick = () => { say([]); build(); };
build();
