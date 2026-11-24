// The TV remote's highlight check (Playwright, via shot.sh: SHOT_SCRIPT=focuscheck.mjs). On the TV dashboard, every view and
// every pop-up: each element the remote can reach is focused in turn (as the remote does: brought into view first) and its
// highlight ring must be whole: nothing around it that crops what it holds (a scroll box, a card with overflow hidden),
// and not the screen's edge, may cut any side of it. The ring is the engine's (css/cards/remote.css); a component that
// moves it outside its element is where this fails (engine/docs/design-system.md, "The remote's highlight").
// Prints one line per kind of problem (where, which element, what cut it, which sides; how many alike); exit 1 if any,
// or on an error in the page. Rounded corners are not looked at: only the four sides; under 1 px (a box measured in whole
// pixels) is not a cut.
//   --base URL [--tv <id>] [--size 960x540] [--only <view>,...] [--no-popups]
import { args, launch, newPage, watchErrors, open, settle, dashUrl, needsSignIn, viewIds, popupIds, showView, openPopup, closePopup, siteScreens, tvIds } from './lib/browser.mjs';

const o = args({ base: { type: 'string' }, tv: { type: 'string' }, size: { type: 'string', default: '960x540' }, only: { type: 'string' }, 'no-popups': { type: 'boolean' } },
  'focuscheck.mjs --base URL [--tv id] [--size WxH] [--only views] [--no-popups]', { required: ['base'] });
const b = await launch(), p = await newPage(b, { base: o.base, size: o.size });
const errors = watchErrors(p, { ignore: [/^failed net::\S+ https?:\/\/(?!localhost|127\.0\.0\.1)/] });   // an outside server's hiccup (radar tiles) isn't this check's business
const tv = o.tv || (await (async () => { await open(p, dashUrl(o.base, { d: 'tv', q: 'p=tv' }), { errors }); return (await tvIds(p, o.base, await siteScreens()))[0] || ''; })());
await open(p, dashUrl(o.base, { d: 'tv', q: `p=tv&unload=0${tv ? '&tv=' + tv : ''}` }), { errors });
if (await needsSignIn(p)) { console.log('NOT CHECKED: the dashboard asks for a sign-in'); await b.close(); process.exit(1); }

// in the page: focus each reachable element under `root` and measure its ring against everything that crops it
const probe = (rootSel) => p.evaluate(async (rootSel) => {
  const FOCUSABLE = 'button:not([disabled]), a[href], [data-focus], .tile:not(.ro), .camera, .aev.tap', SKIP = '.camera button, .tile .ic';
  const root = typeof rootSel === 'string' ? document.querySelector(rootSel) : [...document.querySelectorAll('#app > .pview, #app > .view')].find((x) => !x.hidden);
  if (!root) return [];
  // what the remote can reach (core/remote/focus.js visible): not hidden, not empty, not wholly off the screen sideways (a closed drawer)
  const shown = (el) => { if (!el.isConnected || el.closest('[hidden], [data-nofocus]')) return false; const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false;
    if ((r.right <= 0 || r.left >= innerWidth) && !el.closest('.hrow')) return false;
    const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const name = (el) => el.tagName.toLowerCase() + (el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : '') + (el.dataset.a ? `[data-a=${el.dataset.a}]` : '');
  const path = (el) => { const out = []; for (let x = el; x && x !== root && out.length < 3; x = x.parentElement) out.unshift(name(x)); return out.join(' > '); };
  // into view as the remote brings it (core/remote/focus.js focus, without the smooth scrolling): a sideways row with the
  // previous item peeking in, a list that scrolls in its card with the next item showing, else the page
  const scroller = (el) => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (/auto|scroll/.test(s.overflowY) && a.scrollHeight > a.clientHeight + 1) return a; } return null; };
  const bring = (focused) => {
    const el = focused.closest('[data-ring-box]') || focused, row = el.closest('.hrow');
    if (row) { const rr = row.getBoundingClientRect(), er = el.getBoundingClientRect(), peek = er.width * 0.35;
      if (er.left < rr.left) row.scrollBy({ left: er.left - rr.left - peek, behavior: 'instant' }); else if (er.right > rr.right) row.scrollBy({ left: er.right - rr.right + peek, behavior: 'instant' }); }
    const sc = scroller(el), onPage = !el.closest('.pwrap');
    if (sc && onPage) { const sr = sc.getBoundingClientRect(), er = el.getBoundingClientRect(), pad = er.height * 0.6;
      if (er.top < sr.top) sc.scrollBy({ top: er.top - sr.top - pad, behavior: 'instant' }); else if (er.bottom > sr.bottom) sc.scrollBy({ top: er.bottom - sr.bottom + pad, behavior: 'instant' }); return; }
    if (!onPage) { el.scrollIntoView({ block: 'nearest', behavior: 'instant' }); return; }
    const r = el.getBoundingClientRect(), top = innerHeight * 0.15, bottom = innerHeight * 0.9;
    if (r.top < top) scrollBy({ top: r.top - top, behavior: 'instant' }); else if (r.bottom > bottom) scrollBy({ top: Math.min(r.top - top, r.bottom - bottom), behavior: 'instant' });
  };
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const list = [...root.querySelectorAll(FOCUSABLE)].filter((el) => !el.matches(SKIP) && shown(el));
  const found = [];
  for (const el of list) {
    if (!shown(el)) continue;
    el.focus({ preventScroll: true }); bring(el); await frame();
    if (document.activeElement !== el) continue;
    // the ring: on the element, or on a box around it that draws it for it (:focus-within, :has(:focus))
    let ringEl = null;
    for (let x = el, i = 0; x && i < 4; x = x.parentElement, i++) { const c = getComputedStyle(x); if (c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0) { ringEl = x; break; } }
    if (!ringEl) continue;   // no ring (the rail's own highlight)
    const cs = getComputedStyle(ringEl), w = parseFloat(cs.outlineWidth) || 0;
    const out = (parseFloat(cs.outlineOffset) || 0) + w, r = ringEl.getBoundingClientRect();
    const ring = { l: r.left - out, t: r.top - out, r: r.right + out, b: r.bottom + out };
    // what crops it: each container with overflow other than visible (its inside, borders off), then the screen
    const cuts = [];
    for (let a = ringEl.parentElement; a; a = a.parentElement) {
      const s = getComputedStyle(a), x = s.overflowX !== 'visible', y = s.overflowY !== 'visible';
      if (!x && !y) continue;
      const q = a.getBoundingClientRect(), bl = parseFloat(s.borderLeftWidth) || 0, bt = parseFloat(s.borderTopWidth) || 0;
      const box = { l: q.left + bl, t: q.top + bt, r: q.left + bl + a.clientWidth, b: q.top + bt + a.clientHeight };
      const sides = [x && ring.l < box.l - 1 && 'left', y && ring.t < box.t - 1 && 'top', x && ring.r > box.r + 1 && 'right', y && ring.b > box.b + 1 && 'bottom'].filter(Boolean);
      if (sides.length) cuts.push({ by: a === document.documentElement || a === document.body ? a.tagName.toLowerCase() : name(a), sides });
    }
    const vs = [ring.l < -0.5 && 'left', ring.t < -0.5 && 'top', ring.r > innerWidth + 1 && 'right', ring.b > innerHeight + 1 && 'bottom'].filter(Boolean);
    if (vs.length) cuts.push({ by: 'the screen', sides: vs });
    if (cuts.length) found.push({ el: path(el), cuts });
  }
  document.activeElement && document.activeElement.blur && document.activeElement.blur();
  return found;
}, rootSel);

const problems = new Map();   // one line per kind: where + element + what cut it
const note = (where, list) => list.forEach((f) => f.cuts.forEach((c) => {
  const k = `${where}: ${f.el} — cut by ${c.by} (${c.sides.join(', ')})`; problems.set(k, (problems.get(k) || 0) + 1); }));

let views = await viewIds(p, o.base, 'tv', { frames: true });
if (o.only) { const want = o.only.split(','); views = views.filter((v) => want.includes(v) || want.includes(v.split('/')[0])); }
for (const v of views) {
  errors.mark(v); await showView(p, v); await settle(p, { base: o.base });
  note('view ' + v, await probe(null));
}
if (!o['no-popups'] && !o.only) {
  for (const id of (await popupIds(p, o.base, 'tv')).filter((x) => x !== 'trend')) {
    errors.mark('#' + id); await openPopup(p, id); await settle(p, { base: o.base });
    if (await p.locator('.pwrap:not([hidden]) .popup').count()) note('#' + id, await probe('.pwrap:not([hidden]) .popup'));
    await closePopup(p); await settle(p, { base: o.base });
  }
}
for (const [k, n] of problems) console.log(k + (n > 1 ? `  ×${n}` : ''));
const errs = errors.lines();
if (errs.length) console.log('errors in the page:', errs);
console.log(problems.size ? `${problems.size} kinds of cut highlight` : `highlight whole everywhere (${views.length} views${o['no-popups'] || o.only ? '' : ' and the pop-ups'}, tv=${tv})`);
await b.close();
process.exit(problems.size || errs.length ? 1 : 0);
