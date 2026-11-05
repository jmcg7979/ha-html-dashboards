// Phone shell (profile "phone"): a bottom tab bar instead of the rail, a "More" sheet for the other views and links,
// and, when the page runs inside HA's Webpage dashboard (same origin), HA's own top bar hidden so the dashboard has the
// whole screen. The dashboard says which views get a tab:  tabs: ['home', 'cameras', 'rooms']  (the rest go under More).
//   &chrome=1 keeps HA's top bar.
import { h, esc, icon } from './dom.js';

let bar = null, sheet = null, tabIds = [];

export function phoneNav(dash, name) {
  tabIds = dash.tabs || dash.views.slice(0, 4).map((v) => v.id);
  const inBar = tabIds.map((id) => dash.views.find((v) => v.id === id)).filter(Boolean);
  const rest = dash.views.filter((v) => !tabIds.includes(v.id));
  const link = (v) => `<a href="?d=${name}&v=${v.id}" data-v="${v.id}"><i>${icon(v.icon || 'view-dashboard')}</i><span>${esc(v.title || v.id)}</span></a>`;

  bar = h(`<nav id="tabbar">${inBar.map(link).join('')}${rest.length || (dash.links || []).length ? `<button class="more" data-more><i>${icon('dots-horizontal')}</i><span>More</span></button>` : ''}</nav>`);
  document.body.appendChild(bar);

  // More: the remaining views as a grid of big buttons, then the dashboard's links, then HA's own menu when inside HA
  const host = haHost();
  sheet = h(`<div class="pwrap msheet" hidden><div class="popup" style="--t:var(--mist)"><div class="grab"></div>
    <div class="msgrid">${rest.map((v) => `<a href="?d=${name}&v=${v.id}" data-v="${v.id}" class="mbtn">${icon(v.icon || 'view-dashboard')}<span>${esc(v.title || v.id)}</span></a>`).join('')}</div>
    <div class="mlinks">${(dash.links || []).map((l) => `<a class="mlink" href="${esc(l.url)}" target="_top">${icon(l.icon)}<span>${esc(l.title)}</span></a>`).join('')}
    ${host ? `<button class="mlink" data-hamenu>${icon('menu')}<span>Home Assistant menu</span></button>` : ''}</div></div></div>`);
  document.body.appendChild(sheet);

  const go = (id) => window.dispatchEvent(new CustomEvent('dash:view', { detail: id }));
  bar.addEventListener('click', (ev) => {
    const a = ev.target.closest('a[data-v]');
    if (a) { ev.preventDefault(); closeMore(); go(a.dataset.v); return; }
    if (ev.target.closest('[data-more]')) { if (sheet.hidden) openMore(); else closeMore(); }
  });
  sheet.addEventListener('click', (ev) => {
    const a = ev.target.closest('a[data-v]');
    if (a) { ev.preventDefault(); closeMore(); go(a.dataset.v); return; }
    if (ev.target.closest('[data-hamenu]')) { closeMore(); host.dispatchEvent(new CustomEvent('hass-toggle-menu', { bubbles: true, composed: true })); return; }
    if (ev.target === sheet) closeMore();
  });
  swipeToClose(sheet.querySelector('.popup'), closeMore);
  safeArea();
  window.addEventListener('dash:camfull', (e) => camFull(e.detail, host));
}

// A camera in full screen: hide the tab bar, ask for real full screen (hides the phone's own bars when the app allows it),
// and inside HA make our frame cover HA's whole page, sidebar included (in landscape HA shows its sidebar beside us).
let saved = null;
function camFull(on, frame) {
  document.documentElement.classList.toggle('camfull', on);
  try {
    if (on && !document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  } catch (e) { /* not allowed here */ }
  if (!frame) return;
  if (on && saved == null) {
    saved = frame.getAttribute('style') || '';
    frame.style.cssText = saved + ';position:fixed !important;left:0 !important;top:0 !important;width:100vw !important;height:100vh !important;z-index:2147483000 !important;max-width:none !important;max-height:none !important';
  } else if (!on && saved != null) { frame.setAttribute('style', saved); saved = null; }
  // HA's sidebar sits in shadow roots above us; a fixed frame can't cover it if an ancestor creates a containing block,
  // so also hide it outright while the camera is full screen
  const main = deepFind(frame.ownerDocument, 'home-assistant-main');
  if (main && main.shadowRoot) {
    let st = main.shadowRoot.querySelector('style[data-dash-full]');
    if (!st) { st = frame.ownerDocument.createElement('style'); st.dataset.dashFull = '1'; main.shadowRoot.appendChild(st); }
    st.textContent = on ? 'ha-sidebar { display: none !important; }' : '';
  }
  const drawer = deepFind(frame.ownerDocument, 'ha-drawer');
  if (drawer && drawer.shadowRoot) {
    let st = drawer.shadowRoot.querySelector('style[data-dash-full]');
    if (!st) { st = frame.ownerDocument.createElement('style'); st.dataset.dashFull = '1'; drawer.shadowRoot.appendChild(st); }
    st.textContent = on ? '.mdc-drawer, aside { display: none !important; } .mdc-drawer-app-content, .app-content { margin-left: 0 !important; padding-left: 0 !important; }' : '';
  }
}
// first element with this tag, looking through open shadow roots
function deepFind(root, tag) {
  const q = [root];
  while (q.length) {
    const n = q.shift(), hit = n.querySelector && n.querySelector(tag); if (hit) return hit;
    for (const x of n.querySelectorAll ? n.querySelectorAll('*') : []) if (x.shadowRoot) q.push(x.shadowRoot);
  }
  return null;
}

function openMore() { sheet.hidden = false; bar.classList.add('moreopen'); }
function closeMore() { if (sheet) sheet.hidden = true; if (bar) bar.classList.remove('moreopen'); }

// called by the app whenever a view is shown: highlight its tab, or More for a view without one
export function markView(id) {
  if (!bar) return;
  bar.querySelectorAll('a[data-v]').forEach((a) => a.classList.toggle('on', a.dataset.v === id));
  const more = bar.querySelector('[data-more]'); if (more) more.classList.toggle('on', !tabIds.includes(id));
  if (sheet) sheet.querySelectorAll('a[data-v]').forEach((a) => a.classList.toggle('on', a.dataset.v === id));
}

// Drag a bottom sheet down to close it (only when its content is scrolled to the top). Used by the More sheet and pop-ups.
export function swipeToClose(panel, onClose) {
  let y0 = null, dy = 0;
  panel.addEventListener('touchstart', (e) => {
    // any scroll box between the finger and the sheet that isn't at its top owns the gesture (not just .pbody)
    for (let n = e.target; n && n !== panel; n = n.parentElement) {
      if (n.scrollTop > 0 && n.scrollHeight > n.clientHeight && /auto|scroll/.test(getComputedStyle(n).overflowY)) { y0 = null; return; }
    }
    if (e.target.closest('input, .slider, .tslider, .mvbar, .mbar, .leaflet-container, .dial, svg, canvas, video, .ptabs')) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  panel.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    panel.style.transition = 'none'; panel.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  panel.addEventListener('touchcancel', () => { if (y0 == null) return; panel.style.transition = 'transform .2s ease-out'; panel.style.transform = ''; y0 = null; });
  panel.addEventListener('touchend', () => {
    if (y0 == null) return;
    panel.style.transition = 'transform .2s ease-out';
    if (dy > 90) { panel.style.transform = 'translateY(100%)'; setTimeout(() => { panel.style.transform = ''; panel.style.transition = ''; onClose(); }, 180); }
    else panel.style.transform = '';
    y0 = null;
  });
}

// ---- inside HA's Webpage dashboard ----
// The page is an iframe in HA's <ha-panel-iframe>; its parent document is HA (same origin). Returns our iframe element
// (HA's menu event is fired from it), or null when not inside HA.
export function haHost() {
  try { const f = window.frameElement; return f && f.ownerDocument && f.ownerDocument !== document ? f : null; } catch (e) { return null; }
}

// HA's top bar for a Webpage dashboard lives in a shadow root above our iframe: hui-root in a Lovelace panel view, or hass-subpage /
// a top-app-bar in ha-panel-iframe. Style it away from in here, in every layout; &chrome=1 keeps it, and if HA's structure changes,
// nothing happens and HA's bar simply stays. A Webpage card inside a normal dashboard is left alone: that bar belongs to the dashboard.
// On a phone, the More sheet's "Home Assistant menu" replaces the bar's menu button.
export function hideHAChrome(frame = haHost()) {
  if (!frame || new URLSearchParams(location.search).get('chrome') === '1') return;
  const css = `.toolbar, .header, ha-top-app-bar-fixed .mdc-top-app-bar, .top-app-bar { display: none !important; }
    :host { --header-height: 0px !important; } .content, .main-content { top: 0 !important; padding-top: 0 !important; height: 100% !important; }
    #view, hui-view-container { padding-top: 0 !important; min-height: 0 !important; height: 100vh !important; max-height: 100vh !important; overflow: hidden !important; }`;
  const hosts = [];
  let n = frame, panel = false;   // every element with a shadow root from our iframe up to the bar's owner: the bar is in one of them
  for (let hops = 0; n && hops < 16; hops++) {
    const p = n.parentNode;
    n = p && p.nodeType === 11 ? p.host : p;          // 11 = a shadow root: continue from its host
    if (!n || n.nodeType !== 1) break;
    if (n.localName === 'hui-panel-view') panel = true;
    if (n.shadowRoot) hosts.push(n);
    if (n.localName === 'ha-panel-iframe') { panel = true; break; }
    if (n.localName === 'hui-root') break;
  }
  if (!panel) return;
  hosts.forEach(({ shadowRoot: root }) => { if (root.querySelector('style[data-dash]')) return; const s = frame.ownerDocument.createElement('style'); s.dataset.dash = '1'; s.textContent = css; root.appendChild(s); });
  frame.style.height = '100%'; frame.style.display = 'block';   // an inline iframe leaves a gap under it, which gives HA's page a scrollbar of its own
}

// Safe areas: inside an iframe env(safe-area-inset-*) is 0, so measure them in HA's document (the app's WebView) and
// hand them to our CSS as --safe-top / --safe-bottom. Outside HA our own env() values apply (tokens.css).
function safeArea() {
  let doc; try { doc = haHost() ? window.parent.document : null; } catch (e) { doc = null; }
  if (!doc) return;
  const m = doc.createElement('div');
  m.style.cssText = 'position:fixed;top:0;left:0;width:0;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);visibility:hidden;pointer-events:none';
  doc.body.appendChild(m);
  const cs = getComputedStyle(m), top = parseFloat(cs.paddingTop) || 0, bottom = parseFloat(cs.paddingBottom) || 0;
  m.remove();
  const r = document.documentElement.style;
  r.setProperty('--safe-top', top + 'px'); r.setProperty('--safe-bottom', bottom + 'px');
}
