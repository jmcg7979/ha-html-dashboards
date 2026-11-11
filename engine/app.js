// Boot: pick the dashboard (?d=main), display profile (?p=portal) and view (?v=home), build it, connect to HA.
import * as home from './home.js';
import { renderView, phoneView } from './core/layout.js';
import { connect, onStatus } from './core/ha.js';
import { completeLogin, login } from './core/auth.js';
import { M, onPerf } from './core/store.js';
import { applySettings, settings } from './core/settings.js';
import { initPopups } from './core/popup.js';
import { initAlerts, alertCardTypes } from './core/alerts.js';
import { ambient } from './core/ambient.js';
import { icon, esc } from './core/dom.js';
import { phoneNav, markView, hideHAChrome } from './core/phone.js';
import { fluidScale } from './core/scale.js';
import { reloadWhenIdle, usedSince } from './core/reload.js';
import { startDiscovery } from './core/discover.js';
import { timeOpts } from './core/units.js';
import { initToast, showOffline } from './core/toast.js';
import { initRemote } from './core/remote.js';
import { inOverlay, overlay } from './core/tvhost.js';

const q = new URLSearchParams(location.search);
const name = (q.get('d') || 'main').replace(/[^a-z0-9_-]/gi, '');
const built = {};   // view id -> element; views are built the first time they are shown, then kept

async function boot() {
  const dash = (await import(`./dashboards/${name}.js`)).default;
  applySettings(dash.settings);
  if (q.has('perf')) settings.perf = q.get('perf') !== '0';
  // display profile: ?p= wins; otherwise a screen under 600 CSS px gets the phone shell whatever the dashboard asks for
  // (Main opened on a phone), else the dashboard's own profile
  // a TV dashboard never takes the phone shell: the TV launcher can start it while the screen is asleep (a 0 px window)
  const profile = document.documentElement.dataset.profile = q.get('p') || (innerWidth < 600 && dash.profile !== 'tv' ? 'phone' : dash.profile) || 'portal';
  if (profile === 'phone' && dash.profile !== 'phone' && dash.profile !== 'tv' && !q.get('p')) {   // big-screen layout on a phone: cells reflow (css/cards/adapted.css), screen-filling pages as on a Mobile dashboard
    document.documentElement.dataset.adapted = 'phone'; dash.views = dash.views.map((v) => (v.pages ? phoneView(v) : v)); }
  fluidScale(profile, parseFloat(q.get('s')) || 0);   // --s follows the screen (core/scale.js); ?s= forces it
  document.title = dash.title || 'Home';
  hideHAChrome();   // inside a Webpage dashboard: no HA top bar above ours (core/phone.js)
  await completeLogin();
  if (inOverlay) return overlayOnly(dash);
  if (dash.ambient) ambient(dash.ambient.sun, dash.ambient.weather);

  const app = document.getElementById('app'), rail = document.getElementById('rail');
  // Drill-in rail: a view with several pages (Systems) swaps the rail for its own menu while it is open: Back, the view's
  // name, then its pages as full-size rail buttons. Back shows the main rail again without leaving the page.
  // (a TV keeps its rail as it is and shows a paged view's tabs on the page instead: core/remote.js)
  const paged = profile === 'tv' ? [] : dash.views.filter((v) => v.pages && v.pages.length > 1);
  rail.innerHTML = '<div class="rclock"><b></b><small></small></div><div class="rmain">' +
    dash.views.filter((v) => v.rail !== false).map((v) => `<a href="?d=${name}&v=${v.id}" data-v="${v.id}">${icon(v.icon || 'view-dashboard')}<span>${esc(v.title || v.id)}</span></a>`).join('') +
    '<div class="spacer"></div>' + (dash.links || []).map((l) => `<a href="${esc(l.url)}">${icon(l.icon)}<span>${esc(l.title)}</span></a>`).join('') + '</div>' +
    paged.map((v) => `<div class="rsub" data-for="${v.id}"><button class="rback">${icon('chevron-left')}<span>Back</span></button>` +
      `<div class="rtitle">${esc(v.title || v.id)}</div>` +
      v.pages.map((p) => `<a href="?d=${name}&v=${v.id}/${p.id}" data-v="${v.id}/${p.id}">${icon(p.icon || 'circle-small')}<span>${esc(p.short || p.title)}</span></a>`).join('') + '</div>').join('');

  // clock in the rail: time over a short date, updated on the minute
  const ck = rail.querySelector('.rclock');
  const clock = () => { const d = new Date(); ck.firstChild.textContent = d.toLocaleTimeString([], timeOpts({ hour: 'numeric', minute: '2-digit' })).replace(/\s?[ap]\.?\s?m\.?$/i, '');
    ck.lastChild.textContent = d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.getDate(); setTimeout(clock, 60000 - (Date.now() % 60000) + 50); };
  clock();
  if (profile === 'phone') phoneNav(dash, name);   // bottom tab bar + More sheet instead of the rail (core/phone.js)

  let shownAt = null;
  const show = async (full, push) => {
    const [id, page] = String(full || '').split('/');   // 'systems/nas' = a page of a view with tabs
    const view = dash.views.find((v) => v.id === id) || dash.views[0];
    if (!built[view.id]) { built[view.id] = await renderView(view, home); if (view.back) built[view.id].dataset.back = view.back; app.appendChild(built[view.id]); }   // view options: rail: false (not in the rail), back: 'home' (Back goes there; TV)
    if (built[view.id].showPage) await built[view.id].showPage(page);
    Object.entries(built).forEach(([k, el]) => { el.hidden = k !== view.id; });
    const here = built[view.id].current ? view.id + '/' + built[view.id].current : view.id;
    rail.querySelectorAll('a[data-v]').forEach((a) => a.classList.toggle('on', a.dataset.v === view.id || a.dataset.v === here));
    rail.querySelectorAll('.rsub').forEach((s) => s.classList.toggle('open', s.dataset.for === view.id));
    rail.classList.toggle('drill', !!rail.querySelector('.rsub.open'));   // opening a paged view drills in (again)
    markView(view.id);
    if (push) history.pushState(null, '', `?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(location.search)), v: built[view.id].current ? view.id + '/' + built[view.id].current : view.id })}`);
    // to the top only for a new page: a pop-up's hash also fires popstate, and the page behind it must stay where it is
    if (push || here !== shownAt) window.scrollTo(0, 0);
    shownAt = here;
  };
  rail.addEventListener('click', (ev) => {
    if (ev.target.closest('.rback')) { rail.classList.remove('drill'); return; }   // main rail again; the page stays
    const a = ev.target.closest('a[data-v]'); if (!a) return; ev.preventDefault();
    // the paged view already on screen: just open its menu again, on the same page
    if (rail.querySelector(`.rsub.open[data-for="${a.dataset.v}"]`)) { rail.classList.add('drill'); return; }
    show(a.dataset.v, true);
  });
  window.addEventListener('dash:view', (e) => show(e.detail, true));
  window.addEventListener('popstate', () => show(new URLSearchParams(location.search).get('v')));
  await show(q.get('v'));
  initPopups(dash.popups, home);
  if (dash.remote || profile === 'tv') initRemote();   // D-pad navigation (TV launcher, core/remote.js)
  if (dash.alerts) alertCardTypes().then(() => initAlerts(dash.alerts, home));
  autoUpdate();

  const perf = document.getElementById('perf'), dot = perf.querySelector('i'), txt = perf.querySelector('span');
  perf.hidden = !settings.perf;
  const med = (a) => { if (!a.length) return '–'; const b = [...a].sort((x, y) => x - y); return Math.round(b[b.length >> 1]) + ' ms'; };
  const showPerf = () => { txt.textContent = `tap→paint ${med(M.paint)} · tap→HA ${med(M.confirm)}` + (M.cam.length ? ` · cam ${M.cam.map((x) => (x / 1000).toFixed(1) + 's').join('/')}` : '') + (M.camFull ? ` · main ${(M.camFull / 1000).toFixed(1)}s` : ''); };
  onPerf(showPerf);
  initToast();
  onStatus((ok, needLogin) => { showOffline(!ok && !needLogin); dot.className = ok ? 'ok' : ''; if (!ok) txt.textContent = 'offline'; else showPerf(); document.getElementById('login').hidden = !needLogin; });
  document.getElementById('loginBtn').onclick = login;
  startDiscovery();   // Docker containers from HA's registries (core/discover.js)
  connect();
}

// &overlay=1: only the take-overs, on a see-through page (the TV launcher's window over a playing app, tv/launcher/README.md).
// The launcher keeps it loaded while another app is in front; the page says 'shown' when one is on screen (the launcher
// gives it the remote) and 'done' when none is left (see-through again).
function overlayOnly(dash) {
  document.documentElement.classList.add('overlay');
  initRemote();
  const up = () => !!document.querySelector('.alarm:not([hidden]), .camalert:not([hidden])');
  let was = false;
  addEventListener('dash:alert', () => { const u = up(); if (u === was) return; was = u; overlay(u ? 'shown' : 'done'); });
  alertCardTypes().then(() => initAlerts(dash.alerts, home));
  connect();
}

// After a deploy (version.json changed), reload once the screen has been left alone (core/reload.js). A page coming back
// to the screen (a phone app reopened, a TV woken) checks at once: a new version then loads before anyone uses the page,
// instead of a few seconds into using it.
function autoUpdate() {
  const check = (back) => fetch('version.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => {
    if (j && j.v && window.DASH_VERSION && j.v !== window.DASH_VERSION) reloadWhenIdle(back && Date.now() - shown < 3000 && !usedSince(shown));
  }).catch(() => {});
  let shown = 0;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { shown = Date.now(); check(true); } });
  setInterval(check, 5 * 60000);
}

boot().catch((e) => { console.error(e); document.getElementById('app').textContent = 'The dashboard didn’t load: ' + e; });
