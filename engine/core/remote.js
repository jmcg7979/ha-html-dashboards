// TV remote (D-pad) navigation for the `tv` profile. Every tappable thing on screen (or in the open pop-up) can take the
// highlight; the arrows move it to the nearest one in that direction, OK/Enter taps it.
//   Back  (tv:back from the launcher, or Escape/Backspace in a browser) goes up one level, never repeats or undoes anything:
//         a ringing timer stops / a camera alert goes (core/alerts.js), else the open pop-up closes, else from a page's
//         content to its tabs (when it has them), from there to its icon in the rail, from the rail to Home; on Home, to
//         the top. A view with back: 'home' (Now playing) goes there.
//   Home  (tv:home, Home pressed while already home): closes the pop-up and goes back to the top (a take-over stays)
// What can be focused: buttons, links, and the card roots that take a tap (tile, camera, agenda row with details).
// OK sends the item `dash:ok` first: a card that answers it (preventDefault) does its remote action instead of a click
// (a dimmer tile toggles: a tap on its body sets the brightness where you tap). A tile's own buttons (.sb) are reached
// with Right from the tile; Left from the first goes back to it.
// Hold OK (half a second) on an item marked [data-hold] (a dimmer tile): it gets `dash:hold` and takes the arrows while it
// has .adjusting: Left / Right send `dash:adjust` (detail -1 / 1), OK or Back sends `dash:adjust-end`. A short press is OK.
// Held = the key down for half a second, a repeated key down, or `tv:hold` from the launcher (its WebView drops repeats).
// A card can mark anything else with [data-focus]; [data-nofocus] opts out. data-focus-first marks the start item.
// [data-enter="selector"] on a list: arrowing into it from outside lands on that item. [data-backto="selector"]: Back from inside
// it goes to the nearest match (the switch that picked the panel), however far the list is scrolled. [data-menu] (not hidden): a card's menu
// takes the remote like a pop-up; Back sends it `dash:close`.
const FOCUSABLE = 'button:not([disabled]), a[href], [data-focus], .tile:not(.ro), .camera, .aev.tap';
const SKIP = '.camera button, .tile .ic';   // a camera is one stop (OK = full screen), not its small overlay buttons; a tile is one stop (OK = what its icon does)
const DIR = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

let on = false, opener = null;   // the last item focused on the page itself
export function initRemote() {
  if (on) return; on = true;
  document.documentElement.classList.add('remote');
  document.documentElement.dataset.nav = new URLSearchParams(location.search).get('nav') || 'bubble';   // TV rail style (css/cards/remote.css)
  addEventListener('keydown', key, true);
  addEventListener('keyup', keyUp, true);
  addEventListener('tv:back', back);
  addEventListener('tv:hold', () => { if (holdT && document.activeElement === holdEl) { clearTimeout(holdT); holdT = 0; heldPress = okDown; holdEl.dispatchEvent(new CustomEvent('dash:hold')); } });   // the launcher: OK held
  addEventListener('tv:home', home);
  // The rail is where the highlight lives on a TV (most pages are for looking at): Up / Down in it shows each page as you
  // go (preview, below), OK or Right digs into the page. A page with sub-pages (Systems) opens its own menu in the rail on
  // OK instead, and the highlight stays there.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('#rail a[data-v], #rail .rback'); if (!a) return;
    if (previewing) return;
    setTimeout(() => {
      const sub = document.querySelector('#rail.drill .rsub.open');
      if (sub && !a.closest('.rsub')) { const on = sub.querySelector('a.on') || sub.querySelector('a'); if (on) focus(on); return; }
      if (a.classList.contains('rback')) { const on = railHome(); if (on) focus(on); return; }
      const c = enterPage(); if (c) focus(c);
    }, 250);
  });
  // another view opened by the page itself (not from the rail): the highlight goes to its content
  // (not after a preview from the rail or a tab: the highlight stays where it is)
  addEventListener('dash:view', () => setTimeout(() => { if (previewing || Date.now() - previewedAt < 600) return; if (!lastWasRail || !valid(document.activeElement)) first(); }, 120));
  addEventListener('tv:resume', () => { if (!valid(document.activeElement)) first(); });
  // a take-over (timer alarm, camera alert) opens on its content; when it goes, back to where the highlight was
  addEventListener('dash:alert', () => setTimeout(() => { if (valid(document.activeElement)) return; if (onPage() && valid(opener)) focus(opener); else first(); }, 60));
  // a pop-up opens on its content; closing it returns to the item that opened it
  addEventListener('hashchange', () => setTimeout(() => { if (valid(document.activeElement)) return; if (onPage() && valid(opener)) focus(opener); else first(); }, 60));
  // until something is on screen to focus, try again as the page builds
  let n = 0; const t = setInterval(() => { if (valid(document.activeElement) || ++n > 40) { clearInterval(t); return; } first(); }, 250);
}

// the open take-over, pop-up (or drawer) is the whole world while it is open; a take-over wins over a pop-up under it
// the rail is part of the page (Left from the first column reaches it)
const OVER = '.alarm:not([hidden]) .alarm-in, .camalert:not([hidden]) .popup, [data-menu]:not([hidden])';   // [data-menu]: a card's own menu (Now playing's song menu)
function scope() { return document.querySelector(OVER) || document.querySelector('.pwrap:not([hidden]) .popup, .drawer.open') || document.querySelector('.shell'); }
const onPage = () => !document.querySelector(OVER + ', .pwrap:not([hidden]) .popup, .drawer.open');
function visible(el) {
  if (!el.isConnected || el.closest('[hidden], [data-nofocus]')) return false;
  const r = el.getBoundingClientRect(); if (!r.width || !r.height) return false;
  if ((r.right <= 0 || r.left >= innerWidth) && !el.closest('.hrow')) return false;   // off the screen sideways (a closed drawer); a sideways row scrolls to it
  const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none';
}
// An item in a scrolling list (a queue, an event list) that is scrolled out of the list's view only counts from inside that
// list (arrowing down it scrolls); from outside, it would be an invisible stop at the same height as the buttons beside it.
const scrollers = new Map();   // per key press (move clears it): getComputedStyle up the tree for every candidate is slow on a TV
function scroller(el) {
  if (scrollers.has(el)) return scrollers.get(el);
  let found = null;
  for (let p = el.parentElement; p && !p.matches('.shell, body') && !found; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if (o === 'auto' || o === 'scroll') found = p; }
  scrollers.set(el, found); return found;
}
function shownFrom(el, cur) {
  const sc = scroller(el); if (!sc || sc.contains(cur)) return true;
  const s = sc.getBoundingClientRect(), q = el.getBoundingClientRect();
  return q.bottom > s.top + 2 && q.top < s.bottom - 2;
}
function candidates() {
  return [...scope().querySelectorAll(FOCUSABLE)].filter((el) => !el.matches(SKIP) && visible(el));
}
function valid(el) { return el && el !== document.body && scope().contains(el) && el.matches(FOCUSABLE) && !el.matches(SKIP) && visible(el); }

function focus(el) {
  if (!el) return;
  if (!el.hasAttribute('tabindex') && !el.matches('button, a[href]')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
  lastWasRail = !!el.closest('#rail');
  if (onPage() && !lastWasRail) opener = el;
  // keep the highlight away from the screen's edges, so the row below or above it shows too
  const r = el.getBoundingClientRect(), top = innerHeight * 0.15, bottom = innerHeight * 0.9;
  // a row that scrolls sideways (.hrow): keep the item in it, with the previous one peeking in when there is one
  const row = el.closest('.hrow');
  if (row) {
    const rr = row.getBoundingClientRect(), er = el.getBoundingClientRect(), peek = er.width * 0.35;
    if (er.left < rr.left) row.scrollBy({ left: er.left - rr.left - peek, behavior: 'smooth' });
    else if (er.right > rr.right) row.scrollBy({ left: er.right - rr.right + peek, behavior: 'smooth' });
  }
  if (el.closest('#rail')) return;   // the rail doesn't scroll
  // a list that scrolls inside its card (a queue): keep the item in it, with the next one showing
  const sc = scroller(el);
  if (sc && onPage()) {
    const sr = sc.getBoundingClientRect(), er = el.getBoundingClientRect(), pad = er.height * 0.6;
    if (er.top < sr.top) sc.scrollBy({ top: er.top - sr.top - pad, behavior: 'smooth' });
    else if (er.bottom > sr.bottom) sc.scrollBy({ top: er.bottom - sr.bottom + pad, behavior: 'smooth' });
    return;
  }
  if (!onPage()) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  else if (r.top < top) scrollBy({ top: r.top - top, behavior: 'smooth' });
  else if (r.bottom > bottom) scrollBy({ top: Math.min(r.top - top, r.bottom - bottom), behavior: 'smooth' });
}
export function first() {
  const c = candidates();
  let f = c.find((el) => el.matches('[data-focus-first]') && !el.closest('[hidden]')) || c.find((el) => el.closest('.pbody')) || c.find((el) => el.closest('#app')) || c[0];
  if (f && f.matches('.vtabs .ptab')) f = f.parentElement.querySelector('.ptab.on') || f;   // a page with tabs: the one shown
  focus(f);   // in a pop-up: its content, not the close button
}

// The rail (#rail) is its own column: Up / Down stay in it, Right goes back into the page where you left it,
// and Left from the page's first column opens it on the page you are on.
const railItems = () => candidates().filter((el) => el.closest('#rail'));
const railHome = () => { const r = railItems(); return r.find((el) => el.classList.contains('on')) || r[0]; };
let lastWasRail = false, previewing = false, previewedAt = 0, pt = 0;
// into the page shown: its sub-page tabs when it has them (on the one shown), else its first item
function enterPage() {
  const view = [...document.querySelectorAll('#app > .pview, #app > .view')].find((x) => !x.hidden);
  const tab = view && view.querySelector('.vtabs:not([hidden]) .ptab.on');
  return tab && visible(tab) ? tab : candidates().find((el) => el.closest('#app'));
}
// show the page of the rail item the highlight rests on (a quarter second, so running down the rail doesn't build every page);
// a page with sub-pages shows its first one without opening its menu (that takes OK)
function preview(el) {
  clearTimeout(pt);
  pt = setTimeout(() => {
    if (document.activeElement !== el || el.classList.contains('on')) return;
    previewing = true; previewedAt = Date.now();
    if (el.matches('.ptab')) el.click();   // a sub-page tab: the view switches its page itself
    else if (el.dataset.v) dispatchEvent(new CustomEvent('dash:view', { detail: el.dataset.v }));
    else { previewing = false; return; }
    setTimeout(() => {
      const rail = document.getElementById('rail');
      if (!el.closest('.rsub')) rail.classList.remove('drill');
      if (document.activeElement !== el) focus(el);
      previewing = false;
    }, 60);
  }, 250);
}
function move(d) {
  scrollers.clear();
  const cur = document.activeElement;
  if (!valid(cur)) { if (lastWasRail && onPage() && railHome()) focus(railHome()); else first(); return; }   // e.g. the rail swapped to a view's own menu
  if (cur.closest('#rail')) {
    if (d[0] > 0) { const back = valid(opener) && opener.closest('#app') ? opener : enterPage(); if (back) focus(back); return; }
    if (d[0] < 0) return;
    const r = railItems(), i = r.indexOf(cur), n = r[i + d[1]]; if (n) { focus(n); preview(n); }
    return;
  }
  // into a tile's own buttons and back (the nearest-item search never picks something inside the item you are on)
  const subsOf = (t) => [...t.querySelectorAll('.sb')].filter(visible);
  if (cur.matches('.tile') && d[0] > 0 && subsOf(cur).length) { focus(subsOf(cur)[0]); return; }
  if (cur.matches('.tile .sb') && d[0]) {
    const t = cur.closest('.tile'), list = subsOf(t), n = list[list.indexOf(cur) + d[0]];
    if (n) { focus(n); return; }
    if (d[0] < 0) { focus(t); return; }
  }
  if (cur.matches('.vtabs .ptab') && d[0]) {
    const tabs = [...cur.parentElement.querySelectorAll('.ptab')].filter(visible), n = tabs[tabs.indexOf(cur) + d[0]];
    if (n) { focus(n); preview(n); } else if (d[0] < 0 && railHome()) focus(railHome());
    return;
  }
  let c = candidates().filter((el) => !el.closest('#rail') && shownFrom(el, cur));
  const r = cur.getBoundingClientRect();
  // Left / Right stay on the row when something on it lies that way (a control row under a list goes along the row, not up into the list)
  if (d[0]) {
    const row = c.filter((el) => { if (el === cur) return false; const q = el.getBoundingClientRect(); return q.bottom > r.top && q.top < r.bottom && (d[0] > 0 ? q.left >= r.right - 1 : q.right <= r.left + 1); });
    if (row.length) c = row;
  }
  let best = null, bd = Infinity;
  for (const el of c) {
    if (el === cur || cur.contains(el) || el.contains(cur)) continue;
    const q = el.getBoundingClientRect();
    // distance between the nearest edges along the direction, and the offset across it (overlap counts as 0)
    const along = d[0] ? (d[0] > 0 ? q.left - r.right : r.left - q.right) : (d[1] > 0 ? q.top - r.bottom : r.top - q.bottom);
    if (along < -Math.min(r.width, r.height) / 2) continue;   // behind us
    const across = d[0] ? Math.max(0, q.top - r.bottom, r.top - q.bottom) : Math.max(0, q.left - r.right, r.left - q.right);
    const centre = d[0] ? Math.abs((q.top + q.bottom) / 2 - (r.top + r.bottom) / 2) : Math.abs((q.left + q.right) / 2 - (r.left + r.right) / 2);
    const score = Math.max(0, along) + across * 3 + centre * 0.1;
    if (score < bd) { bd = score; best = el; }
  }
  if (best && best.matches('.vtabs .ptab') && !cur.closest('.vtabs')) best = best.parentElement.querySelector('.ptab.on') || best;   // up into the tabs: the one shown
  const ent = best && best.closest('[data-enter]');   // into a list from outside: its entry point (Up next: the next song), not whichever row is nearest
  if (ent && !ent.contains(cur)) { const f = ent.querySelector(ent.dataset.enter); if (f && visible(f)) best = f; }
  if (best) focus(best);
  else if (d[0] < 0 && onPage() && railHome()) focus(railHome());   // nothing further left: the rail
  else if (d[1]) (onPage() ? window : scope()).scrollBy({ top: d[1] * innerHeight * 0.6, behavior: 'smooth' });   // nothing above / below to select: scroll (charts at a page's foot)
}

// hold OK: the item being adjusted, the pending hold
const adjusting = () => { const el = document.activeElement; return el && el.classList && el.classList.contains('adjusting') ? el : null; };
let holdT = 0, holdEl = null, heldPress = false, okDown = false;   // heldPress: the OK that started adjusting was still down
function ok(el) {   // OK on an item: its own remote action if it has one (dash:ok answered), else a tap
  const ev = new CustomEvent('dash:ok', { cancelable: true });
  el.dispatchEvent(ev);
  if (!ev.defaultPrevented) el.click();
}
function keyUp(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  okDown = false;
  const adj = adjusting();
  if (adj) { e.preventDefault(); if (heldPress) heldPress = false; else adj.dispatchEvent(new CustomEvent('dash:adjust-end')); return; }
  if (!holdT) return;
  e.preventDefault();
  const el = holdEl;   // a short press, unless the launcher's tv:hold is just behind this key up
  setTimeout(() => { if (!holdT || holdEl !== el) return; clearTimeout(holdT); holdT = 0; if (document.activeElement === el) ok(el); }, 80);
}

function key(e) {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if ((tag === 'input' || tag === 'textarea' || tag === 'select') && !DIR[e.key]) return;
  const adj = adjusting();
  if (adj) {   // adjusting: the arrows change the value, OK / Back finish
    e.preventDefault(); e.stopPropagation();
    if (DIR[e.key]) { if (DIR[e.key][0]) adj.dispatchEvent(new CustomEvent('dash:adjust', { detail: DIR[e.key][0] })); return; }
    if (['Escape', 'Backspace', 'GoBack', 'BrowserBack'].includes(e.key)) adj.dispatchEvent(new CustomEvent('dash:adjust-end'));
    return;   // OK finishes on its key up (below): the held press's own repeats and release don't
  }
  if (DIR[e.key]) { e.preventDefault(); e.stopPropagation(); move(DIR[e.key]); return; }
  if (e.key === 'Enter' || e.key === ' ') {
    const el = document.activeElement;
    if (!valid(el)) { e.preventDefault(); first(); return; }
    if (!e.repeat) okDown = true;
    if (e.repeat) {   // held: the first press decides; an item waiting for a hold gets it now (the TV repeats a held key)
      e.preventDefault();
      if (holdT && el === holdEl) { clearTimeout(holdT); holdT = 0; heldPress = okDown; el.dispatchEvent(new CustomEvent('dash:hold')); }
      return;
    }
    if (el.matches('[data-hold]')) {   // short press = OK (on key up), held = adjust
      e.preventDefault(); clearTimeout(holdT); holdEl = el;
      holdT = setTimeout(() => { holdT = 0; if (document.activeElement === el) { heldPress = okDown; el.dispatchEvent(new CustomEvent('dash:hold')); } }, 500);
      return;
    }
    if (el.matches('button, a[href]')) { const o = new CustomEvent('dash:ok', { cancelable: true }); el.dispatchEvent(o); if (o.defaultPrevented) e.preventDefault(); return; }   // else the browser clicks it itself
    e.preventDefault(); ok(el);
    return;
  }
  if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack' || e.key === 'BrowserBack') { e.preventDefault(); back(); }
}

function closeOverlay(takeovers = true) {   // Home leaves a take-over up (it is what the home screen should show), Back answers it
  const al = takeovers && document.querySelector('.alarm:not([hidden])'); if (al) { al.click(); return true; }   // the timer alarm: Stop
  const ca = takeovers && document.querySelector('.camalert:not([hidden]) .pclose'); if (ca) { ca.click(); return true; }   // a camera alert: dismiss
  const mn = document.querySelector('[data-menu]:not([hidden])'); if (mn) { mn.dispatchEvent(new CustomEvent('dash:close')); return true; }   // a card's menu: the card closes it
  const cf = document.querySelector('.camera.full'); if (cf) { cf.click(); return true; }   // full-screen camera: its own tap toggles it back
  const dr = document.querySelector('.drawer.open');
  if (dr) { dr.dispatchEvent(new CustomEvent('dash:close')); dr.classList.remove('open'); return true; }
  if (location.hash.length > 1) { history.replaceState(null, '', location.pathname + location.search); dispatchEvent(new HashChangeEvent('hashchange')); return true; }
  return false;
}
function back() {
  const adj = adjusting(); if (adj) { adj.dispatchEvent(new CustomEvent('dash:adjust-end')); return; }   // the launcher's Back while adjusting
  if (closeOverlay()) return;
  const bt = document.activeElement && document.activeElement.closest('[data-backto]');   // in a list that names where Back goes (its tabs): there
  let to = null; for (let p = bt && bt.parentElement; p && !to; p = p.parentElement) to = p.querySelector(bt.dataset.backto);   // the nearest match up the tree
  if (to && visible(to)) { focus(to); return; }
  const v = [...document.querySelectorAll('#app > [data-back]')].find((x) => !x.hidden);   // a view with back: 'home' (app.js)
  if (v) { dispatchEvent(new CustomEvent('dash:view', { detail: v.dataset.back })); return; }
  const cur = document.activeElement, view = [...document.querySelectorAll('#app > .pview, #app > .view')].find((x) => !x.hidden);
  const onHome = !!railItems()[0] && railItems()[0].classList.contains('on');   // the first rail item is Home
  const tab = view && view.querySelector('.vtabs:not([hidden]) .ptab.on');
  if (cur && cur.closest('#app') && !cur.closest('.vtabs') && tab && visible(tab)) { focus(tab); return; }   // content -> its tabs
  if (cur && cur.closest('#app') && !onHome && railHome()) { focus(railHome()); return; }                    // the page -> its icon in the rail
  if (cur && cur.closest('#rail') && !onHome) { dispatchEvent(new CustomEvent('dash:view', { detail: '' })); setTimeout(() => { scrollTo({ top: 0 }); first(); }, 150); return; }   // the rail -> Home
  scrollTo({ top: 0, behavior: 'smooth' }); first();   // Home: back to the top
}
function home() { closeOverlay(false); dispatchEvent(new CustomEvent('dash:view', { detail: '' })); scrollTo({ top: 0 }); setTimeout(first, 150); }   // Home: the first view, at the top
