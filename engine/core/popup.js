// Pop-ups opened by URL hash (#person), so any action can open one with { nav: '#person' }.
// Defined per dashboard: popups: { person: { title, icon, tone: 'sage', entity, deps: [more ids that redraw the header], state: (e) => text, width: 'wide' | 'max' | 'wide cam' (sized so its camera fills the screen height, see fitCam), cols: 12, cards: [...], onOpen: () => {} } }
// onOpen runs every time the pop-up is shown (e.g. ask a phone for a fresh location).
// Multi-page: pages: [{ title, icon, cols, cards }] instead of cards -> tabs in the header; each page is built the first time it is shown.
// #vacuum/schedule opens a page directly. Re-opening a pop-up starts on its first page.
// Content is built the first time a pop-up opens (keeps start-up light), kept while it is used and removed a while after
// it closes (unloadAfter, set by app.js to the views' time), with everything its cards hooked up (core/scope.js).
import { grid, preload } from './layout.js';
import { h, esc, icon, setText, setHTML, cap } from './dom.js';
import { st, watch } from './store.js';
import { swipeToClose } from './gesture.js';
import { trendPopup } from './trend.js';
import { capture } from './scope.js';
import { layer } from './layers.js';
import { toast } from './toast.js';

// pop-ups the engine's own cards open, present at every site (a site's popups can't remove them, but may override one by id)
const ENGINE_POPUPS = { trend: trendPopup };

let defs = {}, home = null, current = null, after = 0, routed = 0;
const built = {}, building = {}, leaving = {};
export function unloadAfter(seconds) { after = seconds || 0; }
export const popupsBuilding = () => Object.keys(building).length;

export function initPopups(popups, homeRef) {
  defs = { ...ENGINE_POPUPS, ...(popups || {}) }; home = homeRef;
  window.addEventListener('hashchange', route);
  route();
}

// The hash decides which pop-up is open. A pop-up is built once, however often it is asked for while its card types
// load, and the hash seen last wins: one that finishes loading after the hash has moved on stays hidden.
const hashed = () => { try { return decodeURIComponent(location.hash.slice(1)).split('/'); } catch (e) { return ['']; } };   // [id, page]; a hash that isn't ours: none
async function route() {
  const [id, page] = hashed();
  const turn = ++routed;
  if (current && current.id !== id) hide();
  if (!Object.hasOwn(defs, id) || (current && current.id === id)) { if (current && page != null) current.el.showPage(page); return; }
  clearTimeout(leaving[id]); delete leaving[id];
  if (!built[id]) {
    building[id] = building[id] || preload(defs[id].pages ? defs[id].pages.flatMap((p) => p.cards) : defs[id].cards)
      .then(() => { built[id] = build(id, defs[id]); }).finally(() => { delete building[id]; });
    // a card type that didn't load: said, and the address given back, so the same press can ask again
    try { await building[id]; } catch (e) { console.error(e); if (turn === routed && hashed()[0] === id) { toast('That didn’t open. Try again.'); close(); } return; }
    if (turn !== routed) { unloadLater(id); return; }
  }
  current = { id, el: built[id] };
  if (current.el.showPage) current.el.showPage(page || 0);
  current.el.hidden = false;
  current.el.layer.open();   // Back and Escape close it, the remote's highlight stays in it (core/layers.js)
  if (current.el.fit) current.el.fit();
  if (defs[id].onOpen) { try { defs[id].onOpen(); } catch (x) { console.error(x); } }
  document.documentElement.classList.add('modal-open');
}

function hide() {
  if (!current) return;
  const { id, el } = current; current = null;
  el.hidden = true;
  unloadLater(id);
  document.documentElement.classList.remove('modal-open');
  el.layer.shut();
}
// closed (or built and never shown) for a while: removed, and built again the next time it opens
function unloadLater(id) {
  clearTimeout(leaving[id]); delete leaving[id];
  if (after) leaving[id] = setTimeout(() => {
    delete leaving[id];
    const el = built[id]; if (!el || !el.hidden || (current && current.id === id)) return;
    try { el.dispose(); } catch (e) { console.error(e); }
    el.remove(); delete built[id];
  }, after * 1000);
}

// Close the pop-up, whoever asks (its button, an action's `close`, Back): the hash goes, and one still loading stays hidden.
export function close() {
  history.replaceState(null, '', location.pathname + location.search);
  route();
}

function build(id, d) {
  const pages = d.pages || [{ cards: d.cards, cols: d.cols }];
  const el = h(`<div class="pwrap" hidden><div class="popup${d.width ? ' ' + d.width : ''}${d.pages ? ' paged' : ''}" style="--t:var(--${d.tone || 'mist'})">
    <div class="phead"><div class="ic on">${icon(d.icon || 'information-outline')}</div><div class="tx"><div class="name">${esc(d.title || '')}</div><div class="sub"></div></div>
    ${d.pages ? `<div class="ptabs">${d.pages.map((p, i) => `<button class="ptab" data-i="${i}" aria-label="${esc(p.title)}">${p.icon ? icon(p.icon) : ''}<span>${esc(p.title)}</span></button>`).join('')}</div>` : ''}
    <button class="rbtn pclose" aria-label="Close">${icon('close')}</button></div><div class="pbody"></div></div></div>`);
  const body = el.querySelector('.pbody'), tabs = [...el.querySelectorAll('.ptab')], made = [], parts = [];
  el.dispose = () => parts.forEach((d) => d());
  el.layer = layer({ el, kind: 'popup', scope: el.querySelector('.popup'), close });
  el.showPage = (k) => {
    let i = typeof k === 'number' ? k : pages.findIndex((p) => p.title && p.title.toLowerCase() === String(k).toLowerCase());
    if (!(i >= 0 && i < pages.length)) i = isNaN(+k) ? 0 : Math.min(+k, pages.length - 1);
    if (!made[i]) { const c = capture(() => grid(pages[i].cards, pages[i].cols || 12, home)); parts.push(c.dispose); made[i] = c.value; made[i].classList.add('ppage'); body.appendChild(made[i]); }
    made.forEach((m, j) => { if (m) m.hidden = j !== i; });
    tabs.forEach((t, j) => t.classList.toggle('on', j === i));
    body.scrollTop = 0;
  };
  el.addEventListener('click', (ev) => {
    const t = ev.target.closest('.ptab'); if (t) { el.showPage(+t.dataset.i); return; }
    if (ev.target === el || ev.target.closest('.pclose')) close();
  });
  const sub = el.querySelector('.phead .sub');
  parts.push(capture(() => {
  if (d.entity) watch([d.entity, ...(d.deps || [])], () => { const e = st(d.entity); setText(sub, d.state ? d.state(e) : e ? cap(e.state) : ''); });
  if (d.headerIcon) watch([d.entity], () => setHTML(el.querySelector('.phead .ic'), icon(d.headerIcon(st(d.entity)))));
  if (document.documentElement.dataset.profile === 'phone') swipeToClose(el.querySelector('.popup'), close);   // drag down to close
  if (!d.pages) el.showPage(0);
  document.body.appendChild(el);
  if (el.querySelector('.popup.cam')) {   // re-fit whenever the screen (or the pop-up's own content) changes size
    el.fit = () => fitCam(el);
    const ro = new ResizeObserver(() => { if (!el.hidden) el.fit(); });
    ro.observe(el); ro.observe(el.querySelector('.pbody'));
  }
  }).dispose);
  return el;
}

// Camera pop-up sizing, measured rather than guessed: everything that isn't video (header, tiles, padding) is measured live,
// and the pop-up is made exactly wide enough that the camera, at its own aspect ratio, uses the height that's left.
// Works on any resolution / --s scale / number of cards under the camera; no pixel constants.
function fitCam(wrap) {
  const pop = wrap.querySelector('.popup'), cam = pop.querySelector('.camera');
  if (!cam || !cam.offsetHeight) return;
  const cs = getComputedStyle(wrap);
  const availH = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const ratio = cam.offsetWidth / cam.offsetHeight;                  // the camera card's own --ratio, as rendered
  const body = pop.querySelector('.pbody');                          // the body scrolls, so use its full content height, not what's visible
  const chromeH = pop.offsetHeight - body.clientHeight + body.scrollHeight - cam.offsetHeight;
  const chromeW = pop.offsetWidth - cam.offsetWidth;
  const w = Math.floor(Math.max(0, availH - chromeH) * ratio + chromeW);
  if (Math.abs(w - parseFloat(pop.style.getPropertyValue('--cam-fit') || 0)) > 1) pop.style.setProperty('--cam-fit', w + 'px');
}
