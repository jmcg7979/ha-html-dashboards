// @ts-check
// Boot: pick the dashboard (?d=main), display profile (?p=portal) and view (?v=home), build it, connect to HA.
import * as home from './home.js';
import { renderView } from './core/layout.js';
import { connect, onStatus, unanswered } from './core/ha.js';
import { completeLogin, login } from './core/auth.js';
import { stats as storeStats } from './core/store.js';
import { applySettings, settings } from './core/settings.js';
import { initPopups, unloadAfter, popupsBuilding } from './core/popup.js';
import { initAlerts, alertCardTypes } from './core/alerts.js';
import { applyProfile } from './core/profile.js';
import { initRail } from './core/rail.js';
import { initRouter, unloadSeconds } from './core/router.js';
import { phoneNav, markView } from './core/phone.js';
import { hideHAChrome } from './core/ha-embed.js';
import { startDiscovery } from './core/discover.js';
import { initToast, showOffline, toast } from './core/toast.js';
import { initFeedback } from './core/feedback.js';
import { initTips, unnamed } from './core/tips.js';
import { initRemote } from './core/remote.js';
import { inOverlay, overlay, api as tvApi } from './core/tvhost.js';
import { dropped } from './core/scope.js';
import { initLayers, layers } from './core/layers.js';
import { initPerf } from './core/perf.js';
import { autoUpdate } from './core/update.js';

const q = new URLSearchParams(location.search);
const name = (q.get('d') || 'main').replace(/[^a-z0-9_-]/gi, '');

async function boot() {
  const dash = /** @type {import('./core/shapes.js').Dashboard} */ ((await import(`./dashboards/${name}.js`)).default);
  applySettings(dash.settings);
  if (q.has('perf')) settings.perf = q.get('perf') !== '0';
  const profile = applyProfile(dash, q);
  document.title = dash.title || 'Home';
  hideHAChrome();   // inside a Webpage dashboard: no HA top bar above ours (core/ha-embed.js)
  await completeLogin();
  initLayers();
  if (inOverlay) return overlayOnly(dash);

  // the shell: the rail (on a phone the bottom tab bar + More sheet instead: core/phone.js) and the views it leads to
  const rail = initRail(document.getElementById('rail'), { dash, name, profile, open: (view) => router.open(view) });
  if (profile === 'phone') phoneNav(dash, name);
  const after = unloadSeconds(dash, profile, q);
  const router = initRouter({ views: dash.views, app: document.getElementById('app'), render: (view) => renderView(view, home),
    keep: (dash.unload || {}).keep, after, onShown: (view, here) => { rail.mark(view, here); markView(view); },
    onError: (e) => { console.error(e); toast('That page didn’t load. Try again.'); } });
  await firstView(router, q.get('v'));
  // A TV that starts on another view (it reloaded itself on Now playing after a deploy) builds its first view too, unseen:
  // Home is where the launcher is told what to follow while the page is stopped (cards/nowplaying.js: music starting on
  // this TV brings the screen up, out of the screensaver). Without it that waited until someone went Home.
  if (profile === 'tv') router.prebuild(dash.views[0]);
  unloadAfter(after); initPopups(dash.popups, home);
  // for the checks (engine/_dev/tools): what is built (leak checks), and whether the page is still busy building a view or
  // a pop-up or waiting for an answer from HA (so a check knows when a screen is done, without guessing a wait)
  window.dashStats = () => ({ ...storeStats(), views: router.views(), popups: document.querySelectorAll('.pwrap').length, dropped: dropped() });
  window.dashBusy = () => router.busy() + popupsBuilding() + unanswered();
  window.dashUnnamed = unnamed;   // the icon buttons on screen with no name (core/tips.js)
  window.DASH_UP = true;   // the app runs: its own update check takes over from the loader's (boot.js)
  if (dash.remote || profile === 'tv') initRemote();   // D-pad navigation (TV launcher, core/remote.js)
  if (dash.alerts) insist(alertCardTypes).then(() => initAlerts(dash.alerts, home));
  autoUpdate();   // a new version after a deploy (core/update.js)

  const online = initPerf();
  initToast(); initFeedback(); initTips();
  onStatus((ok, needLogin) => { showOffline(!ok && !needLogin); online(ok); document.getElementById('login').hidden = !needLogin; });
  document.getElementById('loginBtn').onclick = login;
  startDiscovery();   // Docker containers from HA's registries (core/discover.js)
  connect();
}

// A file that didn't arrive while the page started (a screen on a bad link, right after a deploy) must not cost the page
// a part of itself until the next deploy: what failed is asked for again every RETRY_MS until it comes.
const RETRY_MS = 10000;
/** @template T @param {() => Promise<T>} load @returns {Promise<T>} */
const insist = (load) => load().catch((e) => { console.error(e); return new Promise((ok) => setTimeout(ok, RETRY_MS)).then(() => insist(load)); });
// The first view. When it fails to build the rest of the page starts all the same (HA's link, the pop-ups, the remote,
// the other views), a line says so, and it is asked for again until it, or a view the user went to meanwhile, is shown.
/**
 * @param {import('./core/router.js').Router} router
 * @param {string | null} view
 */
function firstView(router, view) {
  const note = document.createElement('p');
  note.textContent = 'The dashboard didn’t load. Trying again…';
  let done = false, timer = 0;
  const shown = (/** @type {WindowEventMap['dash:shown']} */ e) => {
    if (e.detail.view == null) return;
    done = true; clearTimeout(timer); note.remove(); removeEventListener('dash:shown', shown);
  };
  addEventListener('dash:shown', shown);
  const attempt = () => router.show(view).catch((e) => {
    console.error(e); if (done) return;
    document.getElementById('app').prepend(note); timer = setTimeout(attempt, RETRY_MS);
  });
  return attempt();
}

// &overlay=1: only the take-overs, on a see-through page (the TV launcher's window over a playing app, tv/launcher/README.md).
// The launcher keeps it loaded while another app is in front; the page says 'shown' when one is on screen (the launcher
// gives it the remote), 'aside' when all that is up is a camera alert in its corner (alerts.cameras.corner: the app keeps
// the remote, the launcher sends only Back; a launcher before api 2 doesn't know it and is told 'shown') and 'done' when
// none is left (see-through again).
/** @param {import('./core/shapes.js').Dashboard} dash */
function overlayOnly(dash) {
  document.documentElement.classList.add('overlay');
  window.DASH_UP = true;
  initRemote();
  addEventListener('dash:view', () => dispatchEvent(new CustomEvent('dash:shown', { detail: { view: '', changed: false } })));   // no views here: answered at once
  const up = () => { const t = layers().filter((l) => l.kind === 'takeover'); return t.some((l) => !l.aside) || (t.length && tvApi < 2) ? 'shown' : t.length ? 'aside' : 'done'; };
  let was = 'done';
  addEventListener('dash:layers', () => { const u = up(); if (u === was) return; was = u; overlay(u); });
  // connect once the take-overs watch their entities: the subscription then asks for those, not for nothing
  insist(alertCardTypes).then(() => initAlerts(dash.alerts, home)).catch((e) => console.error(e)).then(connect);
}

boot().catch((e) => { console.error(e); document.getElementById('app').textContent = 'The dashboard didn’t load: ' + e; });
