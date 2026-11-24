// What every element on a page ends up styled as, saved and compared: the check for a change to the stylesheets that is
// meant to change nothing (rules moved between files, a file wrapped in a cascade layer, a selector rewritten). A pixel
// diff sees only what is on screen at the size tried; this sees every element, hidden ones too, and names the property.
// Used by regress.mjs --styles: take(page) after each screenshot, save() next to it, compare() against the baseline run.
import fs from 'node:fs';
import zlib from 'node:zlib';

// In the page: every element under <html>, in document order, as { keys, ids, table }. keys[i] names the element by its
// path (tag, id, classes, and its place among siblings that look the same); table holds each distinct computed style
// once, as property and value pairs for every standard property the browser lists; ids[i] is the element's entry in it,
// and `pseudo` those of its ::before / ::after when they have content. Custom properties (--x) are left out: one matters
// through the standard property that reads it, which is here, and they are half of the work. The page's own address is
// taken out of the values (the mock listens on another port every run).
// Animations are put at their end (an endless one at its start) first, so two runs read the same moment.
function takeInPage() {
  for (const a of document.getAnimations()) {
    try { const t = a.effect && a.effect.getComputedTiming(); if (t && t.endTime === Infinity) a.cancel(); else a.finish(); } catch (e) { /* an animation that can't be moved stays as it is */ }
  }
  const seen = new Map(), table = [], keys = [], ids = [], pseudo = {};
  const names = [...getComputedStyle(document.documentElement)].filter((n) => !n.startsWith('--')), here = location.origin;
  // inline: the element's own style attribute. What a script wrote there is not the stylesheets' doing (and is often a
  // live value: a progress, a place), so those properties are left out for that element.
  const idOf = (cs, inline) => {
    let s = ''; for (const n of names) if (!inline || !inline.getPropertyValue(n)) s += n + '\u0002' + cs.getPropertyValue(n) + '\u0001';
    if (s.includes(here)) s = s.split(here).join('');
    if (s.includes('url("#')) s = s.replace(/url\("#[^"]*"\)/g, 'url("#")');   // ids made up per page load (a chart's gradient)
    let n = seen.get(s); if (n === undefined) { n = table.length; table.push(s); seen.set(s, n); }
    return n;
  };
  const walk = (el, parent) => {
    const counts = new Map();
    for (const c of el.children) {
      if (/^(SCRIPT|STYLE|LINK|META|TITLE|HEAD)$/.test(c.tagName)) continue;
      const cls = typeof c.className === 'string' ? c.className.trim().split(/\s+/).filter(Boolean).sort().join('.') : '';
      const desc = c.tagName.toLowerCase() + (c.id && !(c instanceof SVGElement) ? '#' + c.id : '') + (cls ? '.' + cls : '');   // ids inside a drawing are made up per page load
      const n = (counts.get(desc) || 0) + 1; counts.set(desc, n);
      const key = parent + ' > ' + desc + (n > 1 ? ':' + n : '');
      const i = keys.length; keys.push(key); ids.push(idOf(getComputedStyle(c), c.style && c.style.length ? c.style : null));
      for (const which of ['::before', '::after']) {
        const cs = getComputedStyle(c, which);
        if (cs.content && cs.content !== 'none' && cs.content !== 'normal') (pseudo[i] ||= {})[which] = idOf(cs);
      }
      walk(c, key);
    }
  };
  keys.push('html'); ids.push(idOf(getComputedStyle(document.documentElement)));
  walk(document.documentElement, 'html');
  return { keys, ids, pseudo, table };
}

export const take = (page) => page.evaluate(takeInPage);
export const fileOf = (shot) => shot.replace(/\.png$/, '') + '.styles.json.gz';
export const save = (file, snap) => fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(snap)));
const load = (file) => JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString());

// element key (with ::before / ::after as their own entries) -> its style text
function byKey(snap) {
  const m = new Map();
  snap.keys.forEach((k, i) => { m.set(k, snap.table[snap.ids[i]]); for (const [which, id] of Object.entries(snap.pseudo[i] || {})) m.set(k + which, snap.table[id]); });
  return m;
}
const props = (text) => { const m = new Map(); for (const d of text.split('\u0001')) { const c = d.indexOf('\u0002'); if (c > 0) m.set(d.slice(0, c), d.slice(c + 1)); } return m; };
// Properties whose computed value is a measured size or place once the element is on screen: they follow the content (a
// clock's width, a live value's), so a difference in one of these alone can be the mock's data and is listed apart.
const MEASURED = /^(width|height|inline-size|block-size|top|right|bottom|left|inset-(block|inline)-(start|end)|perspective-origin|transform-origin)$/;
const last = (key) => key.slice(key.lastIndexOf(' > ') + 3 || 0).replace(/:\d+(?=(::\w+)?$)/, '');

// compare(before file, after file) -> { same: true } or { elements, only: [n before, n after], changes: [{ el, prop, from, to }], sizes: [the same] }
// One entry per element and property whose value changed; `sizes` holds those of the measured properties. Elements that exist in one run only are counted, not listed:
// they mean the two runs didn't show the same content, which this check can't judge.
export function compare(beforeFile, afterFile) {
  const a = byKey(load(beforeFile)), b = byKey(load(afterFile));
  const changes = [], sizes = []; let elements = 0, onlyA = 0, onlyB = 0;
  const cache = new Map();   // a pair of style texts is taken apart once, however many elements have it
  // Inside a drawing only the first of the siblings that look the same is compared: a chart has as many gridlines and
  // labels as its data asks for, so the fifth <line> of one run is not the fifth of the other. The path's shape (d) is data.
  const repeat = (key) => { const i = key.indexOf(' > svg'); return i >= 0 && /:\d+( >|$|::)/.test(key.slice(i)); };
  for (const [key, sa] of a) {
    if (repeat(key)) continue;
    const sb = b.get(key); if (sb === undefined) { onlyA++; continue; }
    if (sa === sb) continue;
    const pair = sa + '\n' + sb; let d = cache.get(pair);
    if (!d) { d = []; const pa = props(sa), pb = props(sb);
      for (const [p, v] of pa) if (pb.get(p) !== v && p !== 'd') d.push([p, v, pb.has(p) ? pb.get(p) : '(not set)']);
      for (const [p, v] of pb) if (!pa.has(p)) d.push([p, '(not set)', v]);
      cache.set(pair, d); }
    if (d.length) elements++;
    for (const [prop, from, to] of d) (MEASURED.test(prop) ? sizes : changes).push({ el: last(key), prop, from, to });
  }
  for (const key of b.keys()) if (!a.has(key) && !repeat(key)) onlyB++;
  return elements || onlyA || onlyB ? { elements, only: [onlyA, onlyB], changes, sizes } : { same: true };
}

// The changes of a whole run in few lines: the same change on the same kind of element is one line with a count and the
// first screen it was seen on. groups(list of { shot, changes }) -> lines, most frequent first.
export function groups(found, max = 40) {
  const g = new Map();
  for (const { shot, changes } of found) for (const c of changes) {
    const k = `${c.el}  ${c.prop}: ${c.from} -> ${c.to}`; const e = g.get(k);
    if (e) e.n++; else g.set(k, { n: 1, shot });
  }
  const lines = [...g].sort((x, y) => y[1].n - x[1].n).map(([k, e]) => `${e.n}x ${k.length > 260 ? k.slice(0, 260) + '…' : k}  (first: ${e.shot})`);
  return lines.length > max ? [...lines.slice(0, max), `… ${lines.length - max} more kinds of change`] : lines;
}
