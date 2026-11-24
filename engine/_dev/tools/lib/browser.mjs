// Shared Playwright helpers for the dashboard's browser checks (shot, fitcheck, regress, unloadcheck, smoke, and a site's
// own checks). One place for: finding Playwright, starting the browser, a signed-in page at a screen's size, waiting until
// a view has settled, what counts as an error, hiding tokens in anything printed, and listing a site's dashboards, their
// views, pages and pop-ups. The checks run through shot.sh, which gives them --base (the dashboard folder's URL),
// HA_TOKEN on a live run and DASH_SITE (the site's name).
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEV = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');   // engine/_dev
export const REPO = path.resolve(DEV, '../..');

// ---- command line ----
// One parser for every tool: an unknown option, a missing value or a missing required option prints the usage line and
// exits 2. `positional: n` asks for exactly n plain arguments (returned as `_`).
export function args(options, usage, { required = [], positional = 0 } = {}) {
  const bad = (why) => { console.error((why ? why + '\n' : '') + 'usage: ' + usage); process.exit(2); };
  let parsed;
  try { parsed = parseArgs({ options, allowPositionals: positional > 0 }); } catch (e) { bad(e.message.split('\n')[0]); }
  for (const k of required) if (parsed.values[k] == null || parsed.values[k] === '') bad(`--${k} is required`);
  if (parsed.positionals.length !== positional) bad('');
  return { ...parsed.values, _: parsed.positionals };
}

// ---- Playwright ----
// Playwright is a dev dependency of the mock (engine/_dev/mock/node_modules); a package installed one level up is found too.
export function playwright() {
  try { return createRequire(path.join(DEV, 'mock') + path.sep)('playwright'); }
  catch (e) { console.error('not set up: cd engine/_dev/mock && npm i && npx playwright install chromium'); process.exit(2); }
}
export const launch = (options = {}) => playwright().chromium.launch(options);

// ---- tokens never reach the output ----
export const redact = (text) => String(text).replace(/\b(token|authSig|access_token|refresh_token)=[^&\s"']+/g, '$1=x');

// ---- screens ----
// The size and display profile a dashboard is checked at, from its own `profile`: a TV gives the page 960x540 CSS px,
// a phone 412x915 with a phone's user agent, everything else is the wall panel.
export const SCREENS = {
  tv: { size: '960x540', p: 'tv' },
  phone: { size: '412x915', mobile: true },
  portal: { size: '1280x800' },
};
export const screenOf = (profile) => SCREENS[profile] || SCREENS.portal;
export const sizeOf = (size) => { const [width, height] = String(size).split('x').map(Number); return { width, height }; };
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14) Mobile';

// ---- sign-in ----
// The dashboard borrows the HA frontend's login from localStorage (core/auth.js). A live run uses HA_TOKEN; the mock
// accepts any token. The refresh token is a stand-in: the access token outlives the run.
export const TOKEN = process.env.HA_TOKEN || 'A';
export const LIVE = !!process.env.HA_TOKEN;
const hassTokens = (origin, token) => JSON.stringify({ hassUrl: origin, refresh_token: 'unused', access_token: token, expires: Date.now() + 864e5, clientId: origin + '/' });

// A new page in its own browser context, signed in to the HA behind `base` (leave base out for a blank page).
//   size '1280x800'   mobile: a phone's user agent   init: a function run in the page before any of its scripts
export async function newPage(browser, { base, size = '1280x800', mobile = false, token = TOKEN, init } = {}) {
  const origin = base ? new URL(base).origin : null;
  const context = await browser.newContext({
    viewport: sizeOf(size), userAgent: mobile ? PHONE_UA : undefined,
    storageState: origin ? { cookies: [], origins: [{ origin, localStorage: [{ name: 'hassTokens', value: hassTokens(origin, token) }] }] } : undefined,
  });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  track(page);
  return page;
}
export const needsSignIn = (page) => page.evaluate(() => { const l = document.getElementById('login'); return !!l && !l.hidden; }).catch(() => false);

// ---- URLs ----
export const trimBase = (base) => String(base).replace(/\/$/, '');
// index.html?d=<dashboard>[&p=<profile>][&<q>][&v=<view>][#<pop-up>]
export function dashUrl(base, { d = 'main', v, p, q, hash } = {}) {
  return `${trimBase(base)}/index.html?d=${d}${p ? '&p=' + p : ''}${q ? '&' + q : ''}${v ? '&v=' + encodeURIComponent(v) : ''}${hash ? '#' + hash : ''}`;
}
const rootOf = (base) => new URL(trimBase(base)).pathname;   // the dashboard folder as the page sees it: /local/dash

// ---- what counts as an error ----
// One definition for every check: an uncaught error in the page, a console error or warning, a request that failed, an
// HTTP status of 400 or more. Known harmless ones, left out everywhere:
//   - the console's "Failed to load resource": the same failure is reported with its URL by the request itself
//   - a request cut off by leaving the page (net::ERR_ABORTED)
//   - Frigate recordings (/api/frigate/…/vod/…): a stretch with no recording answers 404, and the mock has no recordings
//   - /auth/token: the stand-in refresh token is refused if the page ever tries to renew its login
//   - on the mock, the document of a framed page: a `frame` view shows a page of HA itself, which the mock doesn't have
const HARMLESS_URL = /\/api\/frigate\/.*\/vod\/|\/auth\/token(\?|$)/;
// On a live run a TV page's /__tv/… addresses (app banners) have nobody to answer them: on a TV its launcher does, the mock stands in
const TV_HOST_URL = /\/__tv\//;
const short = (text, n = 300) => redact(text).slice(0, n);
// watchErrors(page) starts listening; mark(label) names the screen the next errors belong to.
//   ignore: more patterns (tested against the reported text) a caller knows to be harmless for its own run
export function watchErrors(page, { ignore = [] } = {}) {
  const found = []; let where = '';
  const add = (text) => { if (!ignore.some((re) => re.test(text))) found.push({ where, text }); };
  const framed = (request) => { try { return request.resourceType() === 'document' && request.frame() !== page.mainFrame(); } catch (e) { return false; } };
  page.on('pageerror', (e) => add('pageerror: ' + short(e.message)));
  page.on('console', (m) => {
    if ((m.type() !== 'error' && m.type() !== 'warning') || /^Failed to load resource/.test(m.text())) return;
    add(m.type() + ': ' + short(m.text()));
  });
  page.on('requestfailed', (r) => {
    const why = (r.failure() || {}).errorText || '';
    if (why === 'net::ERR_ABORTED' || HARMLESS_URL.test(r.url())) return;
    add('failed ' + why + ' ' + short(r.url(), 200));
  });
  page.on('response', (r) => {
    if (r.status() < 400 || HARMLESS_URL.test(r.url()) || (LIVE && TV_HOST_URL.test(r.url())) || (!LIVE && framed(r.request()))) return;
    add(r.status() + ' ' + short(r.url(), 200));
  });
  return {
    mark(label) { where = label; },
    clear() { found.length = 0; },
    get count() { return found.length; },
    texts: () => [...new Set(found.map((f) => f.text))],                                                // without the screen
    lines: () => [...new Set(found.map((f) => (f.where ? f.where + ': ' : '') + f.text))],            // "screen: error", each once
  };
}

// ---- waiting until a screen has settled ----
// Requests still on their way, per page. Streams that never end (a camera's MJPEG, media, sockets) don't count.
const inFlight = new WeakMap();
const ENDLESS = /\/api\/camera_proxy_stream\//;
function track(page) {
  const open = new Set(); inFlight.set(page, open);
  page.on('request', (r) => { if (!ENDLESS.test(r.url()) && !['media', 'websocket', 'eventsource'].includes(r.resourceType())) open.add(r); });
  page.on('requestfinished', (r) => open.delete(r));
  page.on('requestfailed', (r) => open.delete(r));
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) open.clear(); });   // the page left behind never reports back
}

// Runs in the page: why it is still busy ('' = nothing left to wait for) and how long its DOM has been unchanged.
// Uses what the page shows of itself: window.dashStats exists once the first view is on screen (app.js), the store says
// when HA's states have arrived, fonts / pictures / video / finite animations and transitions are the browser's own.
// window.dashBusy(), if the engine has it, is the number of views, pages and pop-ups still being built or requests still
// unanswered; it is used when present.
// While a pop-up is open only the pop-up is looked at: the view behind it may keep moving (a camera, a progress bar).
// Something that changes again and again (a clock, a progress bar, a radar loop) is not waited for: after a few
// repeats its changes no longer count.
async function pageState(root) {
  const w = window, d = document, top = () => d.querySelector('.pwrap:not([hidden])');
  if (!w.__checkQuiet) {
    const q = w.__checkQuiet = { last: performance.now(), seen: new WeakMap() };
    new MutationObserver((records) => {
      const now = performance.now(), layer = top(), batch = new Set();
      for (const r of records) { const t = r.target.nodeType === 1 ? r.target : r.target.parentElement; if (t && (!layer || layer.contains(t))) batch.add(t); }
      for (const t of batch) {
        const s = q.seen.get(t) || { at: 0, repeats: 0, times: 0 };
        s.times++; if (s.at && now - s.at > 100) s.repeats++;   // again after a pause: a ticker; many times in a row: something animated by script
        s.at = now; q.seen.set(t, s);
        if (s.repeats < 3 && s.times < 20) q.last = now;
      }
    }).observe(d.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  }
  const login = d.getElementById('login'), app = d.getElementById('app'), scope = top() || d;
  const asksSignIn = !!login && !login.hidden, gaveUp = !!app && /^The dashboard didn’t load/.test(app.textContent || '');
  // on screen, or about to be: a lazy picture outside the window is not asked for until it is scrolled to
  const shown = (el) => { const r = el.getBoundingClientRect(); return el.getClientRects().length > 0 && (el.loading !== 'lazy' || (r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth)); };
  let why = '';
  if (app && typeof w.dashStats !== 'function' && !asksSignIn && !gaveUp && !d.documentElement.classList.contains('overlay')) why = 'starting';
  else if (typeof w.dashBusy === 'function' && w.dashBusy()) why = 'building';
  else if (typeof w.dashStats === 'function' && !asksSignIn && !(await import(root + '/core/store.js')).isReady()) why = 'waiting for states';
  else if (d.fonts.status !== 'loaded') why = 'fonts';
  else if ([...scope.querySelectorAll('img')].some((i) => !i.complete && shown(i))) why = 'pictures';
  else if ([...scope.querySelectorAll('video')].some((v) => shown(v) && (v.currentSrc || v.srcObject) && v.readyState < 2 && !v.error)) why = 'video';
  else if (d.getAnimations().some((a) => a.playState === 'running' && Number.isFinite(a.effect && a.effect.getComputedTiming().endTime) && (scope === d || (a.effect.target && scope.contains(a.effect.target))))) why = 'animation';
  return { why, quiet: performance.now() - w.__checkQuiet.last };
}

// Waits until the page is up, nothing is loading and its DOM has not changed for `quiet` ms.
// Returns { ms, why }: why is '' when it settled, else what it was still waiting for when the time ran out:
//   max       how long the page may take to come up at all (start, sign in, receive HA's states)
//   patience  how long, once it is up, to wait for the rest (requests, pictures, animations, a DOM that keeps
//             changing); 0 = only wait for it to come up
//   video     how long, once it is up, to wait for a camera's first picture. Short on the mock: its cameras only
//             play where the mock's media files are installed, and elsewhere every camera would cost the full wait
// HA's answers come over the websocket, which no request shows: the quiet time is what covers them, so a live run
// (answers from a real HA) gets a longer one than the mock (answers at once).
export async function settle(page, { base, quiet = LIVE ? 1200 : 350, patience = LIVE ? 5000 : 2500, video = LIVE ? patience : Math.min(patience, 1000), max = 10000 } = {}) {
  const t0 = Date.now(), root = base ? rootOf(base) : await page.evaluate(() => location.pathname.replace(/\/[^/]*$/, '')).catch(() => '');
  let upAt = 0;
  for (;;) {
    const s = await page.evaluate(pageState, root).catch(() => null);   // null: the page is between two documents
    const open = (inFlight.get(page) || new Set()).size, now = Date.now();
    const comingUp = !s || s.why === 'starting' || s.why === 'waiting for states';
    if (!comingUp && !upAt) upAt = now;
    const why = !s ? 'loading' : s.why || (open ? 'requests' : s.quiet < quiet ? 'changing' : '');
    if (!why || now - (comingUp ? t0 : upAt) >= (comingUp ? max : why === 'video' ? video : patience)) {
      if (process.env.SETTLE_TRACE) console.error(`settle ${now - t0} ms${why ? ' (gave up: ' + why + ')' : ''} ${redact(page.url()).replace(/^.*\//, '')}`);   // for tuning the waits
      return { ms: now - t0, why };
    }
    await page.waitForTimeout(50);
  }
}

// Opens a URL and waits until it has settled. A first load that lands on the sign-in screen is tried once more
// (errors.clear() is called so the first try's errors don't count). Returns settle()'s result plus signIn: true when
// the page still asks for a sign-in.
export async function open(page, url, { errors, ...wait } = {}) {
  const base = url.replace(/\/[^/]*$/, '');
  // A page can reload itself while or just after it comes up (on a browser profile's first visit it stores what HA's
  // registries hold and starts again): the document that was loaded is remembered, HA is given the time to answer what
  // the page asked while starting, and if the document was replaced at any point since, the new one is waited for.
  // Otherwise the next step would run into the reload, or into a page that has not started yet.
  const born = () => page.evaluate(() => performance.timeOrigin).catch(() => 0);
  await page.goto(url);
  let was = await born(), r = await settle(page, { base, ...wait });
  if (await needsSignIn(page)) { if (errors) errors.clear(); await page.goto(url); was = await born(); r = await settle(page, { base, ...wait }); }
  await page.waitForFunction(() => typeof window.dashBusy !== 'function' || !window.dashBusy(), null, { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(50);
  if ((await born()) !== was) r = await settle(page, { base, ...wait });
  return { ...r, signIn: await needsSignIn(page) };
}

// ---- a site's dashboards, views, pages and pop-ups ----
// version.json of the build: { v, files: { 'cards/x.js': hash, … } }
export async function manifest(base) {
  const r = await fetch(trimBase(base) + '/version.json', { cache: 'no-store' });
  if (!r.ok) throw new Error(`${r.status} for version.json at ${redact(base)}`);
  return r.json();
}
export const dashboardFiles = (man) => Object.keys(man.files || {}).map((f) => (f.match(/^dashboards\/([^/]+)\.js$/) || [])[1]).filter(Boolean).sort();

// Which files in dashboards/ are screens. A dashboard is a module whose default export has a `views` list; the others
// are parts that dashboards import (a shared view, helper exports) and are never opened by ?d=. Asked of a page that
// has started (its import map is in place): { name, screen, profile, error }.
export const dashboards = (page, base, names) => page.evaluate(async ([root, names]) => Promise.all(names.map(async (name) => {
  try { const d = (await import(`${root}/dashboards/${name}.js`)).default; return { name, screen: !!d && Array.isArray(d.views), profile: (d && d.profile) || '' }; }
  catch (e) { return { name, screen: false, error: String(e && e.message || e) }; }
})), [rootOf(base), names]);

// Views of the dashboard the page shows, as ?v= takes them: 'home', or 'systems/nas' for a page of a view with pages.
// A `frame` view (a page of HA itself in a frame) is left out unless frames: true.
export const viewIds = (page, base, d, { frames = false } = {}) => page.evaluate(async ([root, d, frames]) => {
  const dash = (await import(`${root}/dashboards/${d}.js`)).default;
  return (dash.views || []).filter((v) => frames || !v.frame).flatMap((v) => (v.pages ? v.pages.map((pg) => v.id + '/' + pg.id) : [v.id]));
}, [rootOf(base), d, frames]);

// Pop-ups the dashboard can open by hash: the engine's own (#trend) and the dashboard's `popups` (which normally
// spread the site's popups.js).
export const popupIds = (page, base, d) => page.evaluate(async ([root, d]) => {
  const dash = (await import(`${root}/dashboards/${d}.js`)).default;
  return [...new Set(['trend', ...Object.keys(dash.popups || {})])];
}, [rootOf(base), d]);

// in the page: show a view / page (as the rail does), open a pop-up by hash, close the open pop-up
export const showView = (page, id) => page.evaluate((v) => { window.dispatchEvent(new CustomEvent('dash:view', { detail: v })); }, id);
export const openPopup = (page, id) => page.evaluate((h) => { location.hash = h; }, id);
// The engine's history pop-up (#trend) shows whatever reading it was opened for (core/trend.js): opened here for the
// first numeric sensor a card on the page watches, so its chart has something to draw. By hash alone when there is none.
export const openTrend = (page, base) => page.evaluate(async (root) => {
  const [trend, store] = await Promise.all([import(root + '/core/trend.js'), import(root + '/core/store.js')]);
  const id = store.entityIds().find((i) => i.startsWith('sensor.') && Number.isFinite(parseFloat((store.st(i) || {}).state)));
  if (id) trend.openTrend({ title: 'History', series: [{ entity: id }] }); else location.hash = 'trend';
  return id || '';
}, rootOf(base));
export const closePopup = (page) => page.evaluate(() => { history.replaceState(null, '', location.pathname + location.search); window.dispatchEvent(new HashChangeEvent('hashchange')); });
// the open pop-up, if any (a locator)
export const popupOnScreen = (page) => page.locator('.pwrap:not([hidden]) .popup');
// a pop-up at its full height for a screenshot: the body's scroll unrolled
export const FULL_HEIGHT_CSS = '.popup{max-height:none!important}.pbody{overflow:visible!important}.pwrap{position:absolute!important;align-items:flex-start!important;min-height:100%}';

// the page's own leak counters (app.js): watchers, ticks, built views, pop-ups
export const stats = (page) => page.evaluate(() => (typeof window.dashStats === 'function' ? window.dashStats() : null));

// Sets an entity in the page's store, as a state change from HA would (state null = attributes only).
export const setState = (page, id, state, attributes) => page.evaluate(async ([id, s, a]) => {
  const store = await import(new URL('core/store.js', location.href.replace(/[?#].*$/, '')).href);
  store.applyEntities({ c: { [id]: { '+': { ...(s ? { s } : {}), a: a || {} } } } });
}, [id, state, attributes]);

// ---- what a check can't work out from the dashboards ----
// sites/<site>/mock/screens.mjs (optional), default export:
//   tv: ['<id>', …]        the `tv=<id>` values a TV dashboard is opened with (one file serves every TV)
//   showcase: ['gallery']  dashboards that show cards taken from the others, as long lists: opened and checked for
//                          errors and nonsense, not for fit or links (a copied card keeps the links of its own dashboard)
// The site is DASH_SITE (set by shot.sh). Without the file, TV ids come from the site's home.js when it lists them
// (`tvs`, read in the page by tvIds()).
export async function siteScreens(site = process.env.DASH_SITE) {
  const file = site && path.join(REPO, 'sites', site, 'mock', 'screens.mjs');
  if (!file || !fs.existsSync(file)) return {};
  return (await import(pathToFileURL(file).href)).default || {};
}
export const tvIds = async (page, base, screens) => (screens.tv && screens.tv.length ? screens.tv : page.evaluate(async (root) => {
  const tvs = (await import(root + '/home.js')).tvs;
  return Array.isArray(tvs) ? tvs.map((t) => (typeof t === 'string' ? t : t.id)).filter(Boolean) : tvs && typeof tvs === 'object' ? Object.keys(tvs) : [];
}, rootOf(base)).catch(() => []));
