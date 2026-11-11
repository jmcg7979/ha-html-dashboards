// The TV launcher's bridge (an Android TV home-screen app, not part of the engine, that shows this dashboard full screen).
// It gives the page what a browser can't: the installed apps, launching them, the TV's identity. In a plain browser
// (the mock, a desktop) there is no bridge: apps() returns null and cards fall back to their own config, launches are logged.
const B = window.tvhost;
export const onTV = !!B;
const json = (f, dflt) => { try { return JSON.parse(f()); } catch (e) { return dflt; } };

// { id, name, version, url, fallback } of this TV ({} in a browser)
export const info = () => (B ? json(() => B.info(), {}) : {});
// [{ pkg, label }] every app with a TV launcher entry, or null without the bridge
export const apps = () => (B ? json(() => B.apps(), []) : null);
// Continue watching: Android TV's Watch Next list, newest first (tv/launcher/README.md). [] when nothing, null without the bridge.
// &tvdemo=1 in a browser gives stand-in items, for building the page on the mock.
export const watchNext = () => (B ? json(() => B.watchNext ? B.watchNext() : '[]', []) : new URLSearchParams(location.search).has('tvdemo') ? DEMO : null);
const DEMO = [['com.netflix.ninja', 'Somebody Feed Phil', '6', '4', 0.6], ['com.disney.disneyplus', 'Bluey', '3', '12', 0.3], ['com.wbd.stream', 'The Office', '', '', 0.8],
  ['com.hulu.livingroomplus', 'Only Murders in the Building', '4', '2', 0.15], ['tv.emby.embyatv', 'Cars', '', '', 0.5]]
  .map(([p, t, se, ep, f]) => ({ package_name: p, title: t, season_display_number: se, episode_display_number: ep, duration_millis: '3000000', last_playback_position_millis: String(3e6 * f) }));
export function launch(pkg) { if (B) return B.launch(pkg); console.info('tv: launch', pkg); return true; }
export function open(uri) { if (B) return B.open(uri); console.info('tv: open', uri); return true; }
export function settings() { if (B) B.settings(); else console.info('tv: settings'); }
// the app's TV banner (or icon), served by the launcher on this page's own origin; 404 in a browser
export const banner = (pkg) => `${location.origin}/__tv/banner/${encodeURIComponent(pkg)}`;
// the Play Store page of an app that isn't installed
export const store = (pkg) => open(`market://details?id=${encodeURIComponent(pkg)}`);

// Take-overs over a playing app (the launcher's overlay, tv/launcher/README.md): the TV page tells the launcher which entity states
// start one ([{ entity, state }], core/alerts.js); the launcher then opens this dashboard with &overlay=1 in a see-through
// window over the app, and that page reports 'shown' (take the remote) and 'done' (close the window).
export const inOverlay = new URLSearchParams(location.search).get('overlay') === '1';
export function watch(list) { if (B && B.watch) B.watch(JSON.stringify(list)); }
export function overlay(state) { if (B && B.overlay) B.overlay(state); else console.info('tv: overlay', state); }

// Over a cast screen (Music Assistant's Cast receiver, which takes the TV's screen when MA plays to it): while a view id is
// set, the launcher brings this screen up on that view whenever the cast screen comes to the front; '' leaves cast screens be.
// The launcher answers with `tv:view` (detail = the view), passed on as dash:view.
export function cover(view) { if (B && B.cover) B.cover(view || ''); }
if (B) addEventListener('tv:view', (e) => { if (e.detail) dispatchEvent(new CustomEvent('dash:view', { detail: e.detail })); });

// Keep the TV's screen on (no screensaver) while true; the launcher sets it on its window, so it only holds while this screen
// is in front. Google TV's screensaver counts only remote presses, not music playing (core: cards/nowplaying.js sets it).
export function keepAwake(on) { if (B && B.keepAwake) B.keepAwake(!!on); }
