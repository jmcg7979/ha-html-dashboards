// A view that is another page in a frame, next to the rail: { id, title, icon, frame: [{ name, url, ha: true }] }
// Several sources get chips to switch; the choice is remembered on this screen. Frames load the first time they're picked.
// ha: true = a Home Assistant dashboard page (same origin): its header and sidebar are hidden so it reads as part of this dashboard.
// addon: '<slug>' = an HA app's web UI through HA ingress (same origin, signed in as this HA user, no separate login):
//   like HA's own app panels, this creates an ingress session cookie and keeps it valid while the page is open.
import { h, esc } from './dom.js';
import { request, onReady, connected } from './ha.js';

const KEY = 'dash.frame.';

export function frameView(view) {
  const srcs = view.frame;
  const el = h(`<div class="view fview view-${view.id}">${srcs.length > 1 ? `<div class="fbar">${srcs.map((s, i) => `<button class="chip" data-i="${i}">${esc(s.name)}</button>`).join('')}</div>` : ''}<div class="fbox"></div></div>`);
  const box = el.querySelector('.fbox'), chips = [...el.querySelectorAll('.fbar .chip')], frames = [];
  el.style.setProperty('--t', 'var(--plum)');
  const pick = (i) => {
    if (frames[i] && frames[i].failed) { frames[i].remove(); frames[i] = null; }   // try a failed open again
    if (!frames[i]) {
      const f = document.createElement('iframe');
      if (srcs[i].addon) ingress(srcs[i].addon).then((url) => { f.src = url; }).catch((e) => { f.failed = true; f.srcdoc = `<body style="font:15px sans-serif;color:#aaa;background:#0d1017;padding:40px">Couldn't open ${esc(srcs[i].name)} through Home Assistant (${esc(String(e && e.message || e))}).</body>`; });
      else f.src = srcs[i].url;
      f.allow = 'autoplay; fullscreen; clipboard-write'; f.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
      if (srcs[i].ha) f.addEventListener('load', () => { clearInterval(f._tidy); f._tidy = 0; tidyHA(f); });
      box.appendChild(f); frames[i] = f;
    }
    frames.forEach((f, j) => { if (f) f.hidden = j !== i; });
    chips.forEach((c, j) => c.classList.toggle('on', j === i));
    try { localStorage.setItem(KEY + view.id, i); } catch (e) { /* storage blocked */ }
  };
  el.addEventListener('click', (ev) => { const c = ev.target.closest('.fbar .chip'); if (c) pick(+c.dataset.i); });
  let first = 0; try { first = +localStorage.getItem(KEY + view.id) || 0; } catch (e) { /* storage blocked */ }
  pick(first < srcs.length ? first : 0);
  return el;
}

// Hide HA's sidebar and the dashboard header inside a same-origin frame. HA builds these inside shadow roots after load,
// so look for them for a while; if HA's structure changes, the frame simply shows HA's own chrome.
// [element whose shadow root gets the style, css]; checked against HA 2026.10 (2026-10-22)
const STYLES = [
  ['home-assistant-main', 'ha-sidebar{display:none !important}'],
  ['ha-drawer', '.sidebar-shell{display:none !important} .app-content{padding-left:0 !important; margin-left:0 !important}'],
  ['hui-root', ':host{--header-height:0px !important} .header, .toolbar{display:none !important} #view, hui-view-container{padding-top:0 !important; min-height:100vh !important}'],
];
function tidyHA(f) {
  let tries = 0;
  const step = () => {
    let doc; try { doc = f.contentDocument; } catch (e) { return; }   // not same origin: leave it alone
    if (!doc) return;
    let done = 0;
    for (const [host, css] of STYLES) {
      const root = deep(doc, host);
      if (root && root.shadowRoot) { if (!root.shadowRoot.querySelector('style[data-dash]')) { const s = doc.createElement('style'); s.dataset.dash = '1'; s.textContent = css; root.shadowRoot.appendChild(s); } done++; }
    }
    if (done < STYLES.length && ++tries < 60) setTimeout(step, 400);
    else if (done === STYLES.length) watchNav(f, doc);
  };
  step();
}
// HA re-creates hui-root when its dashboard reloads; re-apply then
function watchNav(f, doc) { if (f._tidy) return; f._tidy = setInterval(() => { if (!f.offsetParent) return; const r = deep(doc, 'hui-root'); if (r && r.shadowRoot && !r.shadowRoot.querySelector('style[data-dash]')) tidyHA(f); }, 10000); }
// find an element by tag name through open shadow roots
function deep(root, tag) {
  const q = [root];
  while (q.length) {
    const n = q.shift();
    const hit = n.querySelector && n.querySelector(tag); if (hit) return hit;
    const all = n.querySelectorAll ? n.querySelectorAll('*') : [];
    for (const x of all) if (x.shadowRoot) q.push(x.shadowRoot);
  }
  return null;
}

// ---- HA ingress (what HA's app panels do): session cookie on /api/hassio_ingress/, re-validated every minute ----
let session = null, keep = 0;
const ready = () => new Promise((res) => (connected() ? res() : onReady(res)));
const sup = (endpoint, method, data) => request({ type: 'supervisor/api', endpoint, method, ...(data ? { data } : {}) });
async function newSession() {
  const r = await sup('/ingress/session', 'post');
  session = r.session;
  document.cookie = `ingress_session=${session};path=/api/hassio_ingress/;SameSite=Strict${location.protocol === 'https:' ? ';Secure' : ''}`;
}
async function ingress(slug) {
  await ready();
  const info = await sup(`/addons/${slug}/info`, 'get');
  if (!info || !info.ingress_url) throw new Error('this app has no web UI through ingress');
  if (!session) await newSession();
  if (!keep) keep = setInterval(() => { if (!connected()) return; sup('/ingress/validate_session', 'post', { session }).catch(() => newSession().catch(() => {})); }, 60000);
  return info.ingress_url;
}
