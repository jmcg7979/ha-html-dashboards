// The TV launcher's bridge (an Android TV home-screen app, not part of the engine, that shows this dashboard full screen).
// It gives the page what a browser can't: the installed apps, launching them, the TV's identity. In a plain browser
// (the mock, a desktop) there is no bridge: apps() returns null and cards fall back to their own config, launches are logged.
const B = window.tvhost;
export const onTV = !!B;
const json = (f, dflt) => { try { return JSON.parse(f()); } catch (e) { return dflt; } };

// What this launcher can do. A launcher says so itself: caps() = { api, version, overlay, can: [its method names] }.
// One built before it could say so is api 0, and what it can do is read off the bridge object; a browser is api -1.
// api 1: links are limited to the kinds a page uses (tv/launcher Links.java), the bridge answers only the dashboard's own page.
// api 2: the take-over window knows 'aside'.
const CAPS = (B && typeof B.caps === 'function' && json(() => B.caps(), null)) || {};
export const api = !B ? -1 : +CAPS.api || 0;
export const can = (m) => !!B && (Array.isArray(CAPS.can) ? CAPS.can.includes(m) : typeof B[m] === 'function');
// the launcher's method m with these arguments; `without` when this launcher has no such method (an older build, or the
// take-over window's smaller bridge)
const call = (m, without, ...a) => (can(m) ? B[m](...a) : without);

// [{ pkg, label }] every app with a TV launcher entry, or null without the bridge
export const apps = () => (B ? json(() => call('apps', '[]'), []) : null);
// Continue watching: Android TV's Watch Next list, newest first (tv/launcher/README.md). [] when nothing, null without the bridge.
// &tvdemo=1 in a browser gives stand-in items, for building the page on the mock.
export const watchNext = () => (B ? json(() => call('watchNext', '[]'), []) : new URLSearchParams(location.search).has('tvdemo') ? DEMO : null);
const DEMO = [['com.netflix.ninja', 'Somebody Feed Phil', '6', '4', 0.6], ['com.disney.disneyplus', 'Bluey', '3', '12', 0.3], ['com.wbd.stream', 'The Office', '', '', 0.8],
  ['com.hulu.livingroomplus', 'Only Murders in the Building', '4', '2', 0.15], ['tv.emby.embyatv', 'Cars', '', '', 0.5]]
  .map(([p, t, se, ep, f]) => ({ package_name: p, title: t, season_display_number: se, episode_display_number: ep, duration_millis: '3000000', last_playback_position_millis: String(3e6 * f) }));
// true: started. In a browser nothing starts and it is logged.
export function launch(pkg) { if (B) return !!call('launch', false, pkg); console.info('tv: launch', pkg); return true; }
// open(uri): a link Android starts. The launcher takes the kinds listed in tv/launcher Links.java (the Play Store page of
// an app, an app by its package, Android's Settings, a web address in one named app) and a Continue watching item's own link.
export function open(uri) { if (B) return !!call('open', false, uri); console.info('tv: open', uri); return true; }
// the app's TV banner (or icon), served by the launcher on this page's own origin; 404 in a browser
export const banner = (pkg) => `${location.origin}/__tv/banner/${encodeURIComponent(pkg)}`;
// the Play Store page of an app that isn't installed
export const store = (pkg) => open(`market://details?id=${encodeURIComponent(pkg)}`);

// Take-overs over a playing app (the launcher's overlay, tv/launcher/README.md): the TV page tells the launcher which entity states
// start one ([{ entity, state }], core/alerts.js); the launcher then opens this dashboard with &overlay=1 in a see-through
// window over the app, and that page reports 'shown' (take the remote), 'aside' (on screen, the app keeps the remote: api 2)
// and 'done' (close the window).
export const inOverlay = new URLSearchParams(location.search).get('overlay') === '1';
// watch(list, key): entity states the launcher follows natively, while the page itself is stopped behind another app or the
// screensaver: [{ entity, state }] start a take-over (core/alerts.js), [{ entity, state, view }] bring this screen up on that
// view, out of the screensaver (cards/nowplaying.js: music started on this TV). `has: 'attribute'` on a row: the entity is in
// its state only with that attribute set (launcher 2026-11-16 on; an older one goes by the state alone). Each caller's list
// goes under its own key.
// A row without an entity or a state (a config slip) is left out and said in the console; the rest is still watched.
const watched = {};
export function watch(list, key = 'alerts') {
  const rows = (list || []).filter((x) => x && x.entity && x.state);
  if (rows.length !== (list || []).length) console.warn(`tv: ${(list || []).length - rows.length} of the '${key}' watch entries have no entity or no state`);
  watched[key] = rows;
  call('watch', undefined, JSON.stringify(Object.values(watched).flat()));
}
export function overlay(state) { if (can('overlay')) B.overlay(state); else console.info('tv: overlay', state); }

// Over a cast screen (Music Assistant's Cast receiver, which takes the TV's screen when MA plays to it): while a view id is
// set, the launcher brings this screen up on that view whenever the cast screen comes to the front; '' leaves cast screens be.
// The launcher answers with `tv:view` (detail = the view), passed on as dash:view.
export function cover(view) { call('cover', undefined, view || ''); }
// show(view): this screen comes to the front on that view, out of the screensaver or from behind another app (music started on
// this TV through a player app with no screen of its own, e.g. Sendspin)
// The launcher answers show() with `tv:view` too. The caller has already gone to that view itself, so that answer is not
// passed on: a second switch a moment later would pull back someone who has moved on in between.
let asked = { view: '', at: 0 };
export function show(view) { asked = { view: view || '', at: Date.now() }; call('show', undefined, view || ''); }
if (B) addEventListener('tv:view', (e) => {
  if (!e.detail || (e.detail === asked.view && Date.now() - asked.at < 3000)) return;
  dispatchEvent(new CustomEvent('dash:view', { detail: e.detail }));
});

// saver(cfg): the weather line under the launcher's screensaver clock, over the photos (tv/launcher Saver.java):
// { weather: 'weather.x', conditions: { condition: words } }. The screensaver reads the entity itself (the page is stopped
// behind it).
let saverSent = '';
export function saver(cfg) { const j = JSON.stringify(cfg || {}); if (j !== saverSent) { saverSent = j; call('saver', undefined, j); } }

// Keep the TV's screen on (no screensaver) while true; the launcher sets it on its window, so it only holds while this screen
// is in front. Google TV's screensaver counts only remote presses, not music playing (core: cards/nowplaying.js sets it).
export function keepAwake(on) { call('keepAwake', undefined, !!on); }

// Voice (launcher 2026-11-17 on, with the microphone allowed: tv/launcher README.md, Voice). The remote's own mic button
// never reaches a page (Google TV sends it to Assistant), so a page that wants voice shows its own mic when canListen().
// listen(on) starts Android's speech recognizer; on(detail) gets each step: { state: 'listening' | 'words' | 'done' |
// 'error', text, error }. 'done' and 'error' end it. Returns stop(), which ends it with no 'done'.
// &tvdemo=1 in a browser: a stand-in that "hears" the words of &tvsay= (default 'taylor swift'), for building on the mock.
const demoVoice = !B && new URLSearchParams(location.search).has('tvdemo');
export const canListen = () => demoVoice || (can('canListen') && !!call('canListen', false));
// warmListen(on): the launcher keeps its recognizer ready (a search with a mic is open), so the first press doesn't wait ~3 s
// for Google's recognizer to start; it lets it go by itself when the screen leaves the front (launcher 2026-11-17 on).
export function warmListen(on) { if (!demoVoice) call('warmListen', undefined, !!on); }
let hearing = null;
export function listen(on) {
  if (hearing) hearing.stop();
  const me = { stop() { if (hearing !== me) return; hearing = null; removeEventListener('tv:hear', got); timers.forEach(clearTimeout); if (!demoVoice) call('stopListening'); } };
  const timers = [];
  const got = (e) => { if (hearing !== me) return; const d = e.detail || {}; if (d.state === 'done' || d.state === 'error') { hearing = null; removeEventListener('tv:hear', got); } on(d); };
  hearing = me;
  addEventListener('tv:hear', got);
  if (demoVoice) {
    const say = new URLSearchParams(location.search).get('tvsay') || 'taylor swift', fire = (d) => dispatchEvent(new CustomEvent('tv:hear', { detail: d }));
    timers.push(setTimeout(() => fire({ state: 'listening' }), 300), setTimeout(() => fire({ state: 'words', text: say.split(' ')[0] }), 1200),
      setTimeout(() => fire(say === '-' ? { state: 'error', error: 'nomatch' } : { state: 'done', text: say }), 2200));
  } else if (!call('listen', false)) { me.stop(); setTimeout(() => on({ state: 'error', error: 'mic' })); }
  return () => me.stop();
}
