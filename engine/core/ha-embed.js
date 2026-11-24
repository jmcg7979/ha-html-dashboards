// @ts-check
// Inside HA's Webpage dashboard: the page is an iframe in HA's <ha-panel-iframe>, its parent document is HA (same
// origin). What the dashboard does to HA's page from in here: HA's own top bar hidden so the dashboard has the whole
// screen (&chrome=1 keeps it), the phone's safe areas measured there, and our frame over HA's whole page while a camera
// is in full screen. Outside HA every function here does nothing.

// Our iframe element (HA's menu event is fired from it), or null when not inside HA.
/** @returns {HTMLElement | null} */
export function haHost() {
  try { const f = /** @type {HTMLElement | null} */ (window.frameElement); return f && f.ownerDocument && f.ownerDocument !== document ? f : null; } catch (e) { return null; }
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
  // every element with a shadow root from our iframe up to the bar's owner: the bar is in one of them
  /** @type {any} an element, or a shadow root on the way up */ let n = frame;
  let panel = false;
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
export function safeArea() {
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

// A camera in full screen: our frame covers HA's whole page, sidebar included (in landscape HA shows its sidebar beside
// us), and gets its own style back after.
let saved = null;
export function coverHA(on, frame = haHost()) {
  if (!frame) return;
  if (on && saved == null) {
    saved = frame.getAttribute('style') || '';
    frame.style.cssText = saved + ';position:fixed !important;left:0 !important;top:0 !important;width:100vw !important;height:100vh !important;z-index:2147483000 !important;max-width:none !important;max-height:none !important';
  } else if (!on && saved != null) { frame.setAttribute('style', saved); saved = null; }
  // HA's sidebar sits in shadow roots above us; a fixed frame can't cover it if an ancestor creates a containing block,
  // so also hide it outright while the camera is full screen
  hideIn(frame, 'home-assistant-main', on ? 'ha-sidebar { display: none !important; }' : '');
  hideIn(frame, 'ha-drawer', on ? '.mdc-drawer, aside { display: none !important; } .mdc-drawer-app-content, .app-content { margin-left: 0 !important; padding-left: 0 !important; }' : '');
}
// our one style element in the shadow root of HA's element with this tag, holding `css`
function hideIn(frame, tag, css) {
  const host = deepFind(frame.ownerDocument, tag);
  if (!host || !host.shadowRoot) return;
  let st = host.shadowRoot.querySelector('style[data-dash-full]');
  if (!st) { st = frame.ownerDocument.createElement('style'); st.dataset.dashFull = '1'; host.shadowRoot.appendChild(st); }
  st.textContent = css;
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
