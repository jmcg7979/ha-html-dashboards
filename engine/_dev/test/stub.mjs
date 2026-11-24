// The browser, as far as importing the dashboard's modules under plain node needs it, plus what every test uses to get
// at them: build() assembles a site the way a deploy does, load() imports a module from that build, override() swaps
// exports of a module for test doubles. README.md here.
//   import { load, frames, clock } from './stub.mjs';
//   const { st, applyEntities } = await load('core/store.js');
// Only what a module touches while it is imported (or what a test here drives) is faked; nothing draws.
// Importing this file sets the globals; engine/_dev/tools/check-site.mjs uses it the same way.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const G = globalThis;
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');   // the repository

// ---- an element that accepts anything: every property is another one, every call returns one ----
const LISTS = new Set(['children', 'childNodes']);
export const elem = () => new Proxy(function () {}, {
  get: (t, k) => (k in t ? t[k] : k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : LISTS.has(k) ? [] : k === 'querySelectorAll' ? () => []
    : k === 'querySelector' || k === 'closest' ? () => null : elem()),
  set: (t, k, v) => { t[k] = v; return true; },
  apply: () => elem(),
});

// ---- time: performance.now() and animation frames move only when a test says so ----
export const clock = { t: 1000, advance(ms) { this.t += ms; } };
const queue = new Map(); let frameId = 0;
export const frames = {
  get waiting() { return queue.size; },
  run() { const list = [...queue.values()]; queue.clear(); list.forEach((f) => f(clock.t)); return list.length; },   // one frame: everything asked for so far
};

// ---- timeouts a test moves by hand: from fakeTimeouts() on, setTimeout only runs when tick(ms) passes its time ----
export function fakeTimeouts() {
  const real = [G.setTimeout, G.clearTimeout], due = new Map(); let now = 0, id = 0;
  G.setTimeout = (fn, ms = 0) => { due.set(++id, { at: now + ms, fn }); return id; };
  G.clearTimeout = (i) => { due.delete(i); };
  return {
    tick(ms) {   // in the order they fall due; one that sets another inside the span runs it too
      const end = now + ms;
      for (;;) {
        const next = [...due].filter(([, d]) => d.at <= end).sort((x, y) => x[1].at - y[1].at || x[0] - y[0])[0];
        if (!next) break;
        due.delete(next[0]); now = next[1].at; next[1].fn();
      }
      now = end;
    },
    restore() { [G.setTimeout, G.clearTimeout] = real; },
  };
}

// ---- listeners on window / document really work, so a test can count what a view leaves behind ----
function target() {
  const L = new Map();
  return { L,
    addEventListener(type, fn) { if (!L.has(type)) L.set(type, new Set()); L.get(type).add(fn); },
    removeEventListener(type, fn) { if (L.has(type)) L.get(type).delete(fn); },
    dispatchEvent(ev) { [...(L.get(ev.type) || [])].forEach((f) => f(ev)); return true; },
    count() { let n = 0; L.forEach((s) => { n += s.size; }); return n; } };
}
const win = target(), doc = target();
export const listeners = { window: () => win.count(), document: () => doc.count() };

const storage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, clear: () => m.clear() }; };
// intervals a module starts when it is imported (the store's clock) must not keep node alive once the tests are done
const realInterval = G.setInterval;
export const intervals = new Set();   // ids of the intervals running now
class Observer { constructor(cb) { this.cb = cb; this.on = false; } observe() { this.on = true; } unobserve() {} disconnect() { this.on = false; } takeRecords() { return []; } }

function define(name, value) { Object.defineProperty(G, name, { value, configurable: true, writable: true }); }
define('window', G);
define('navigator', { userAgent: 'node', language: 'en-US', deviceMemory: 8 });
define('performance', { now: () => clock.t });
define('location', { search: '', hash: '', pathname: '/local/dash/index.html', origin: 'http://ha.test:8123', host: 'ha.test:8123', protocol: 'http:', href: 'http://ha.test:8123/local/dash/index.html' });
define('localStorage', storage()); define('sessionStorage', storage());
define('document', { documentElement: elem(), body: elem(), head: elem(), hidden: false, visibilityState: 'visible', createElement: elem, createElementNS: elem,
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => elem(), addEventListener: doc.addEventListener, removeEventListener: doc.removeEventListener, dispatchEvent: doc.dispatchEvent });
define('addEventListener', win.addEventListener); define('removeEventListener', win.removeEventListener); define('dispatchEvent', win.dispatchEvent);
define('requestAnimationFrame', (fn) => { queue.set(++frameId, fn); return frameId; });
define('cancelAnimationFrame', (id) => { queue.delete(id); });
define('setInterval', (...a) => { const id = realInterval(...a); id.unref(); intervals.add(id); return id; });
{ const clear = G.clearInterval; define('clearInterval', (id) => { intervals.delete(id); clear(id); }); }
define('ResizeObserver', class extends Observer {}); define('IntersectionObserver', class extends Observer {}); define('MutationObserver', class extends Observer {});
define('CustomEvent', class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } });

// ---- the build: engine + site files on top, exactly as assemble.sh makes it for a deploy or the mock ----
// The engine imports ../home.js, which only a site has, so modules are imported from a build, never from engine/ itself.
// A build is made once per state of the source files and shared by the test files of a run (they are separate
// processes): it sits in the system's temporary folder under a name made from every file's size and time, so any edit
// gives a new one; older builds of the same site are removed. Nothing writes into a shared build (see override()).
// A site is a name under sites/ or the path of a site folder (one that holds dash/home.js): a test's own copy of a site,
// which gets a build of its own that is removed when the process ends.
const CACHE = path.join(os.tmpdir(), 'dash-test-builds'), ASSEMBLE = path.join(ROOT, 'engine/_dev/assemble.sh');
const builds = new Map(), mine = new Set(), loaded = new Set();
export const siteFolder = (site) => (fs.existsSync(path.join(site, 'dash/home.js')) ? path.resolve(site) : path.join(ROOT, 'sites', site));
function assemble(dash, into) {   // into/dash = the build, into/package.json says its .js files are ES modules
  fs.writeFileSync(path.join(into, 'package.json'), '{ "type": "module" }\n');
  execFileSync('bash', [ASSEMBLE, dash, path.join(into, 'dash')], { stdio: ['ignore', 'ignore', 'inherit'] });
}
function temporary() { const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-test-')); process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true })); return tmp; }
function stamp(dash) {
  const h = crypto.createHash('md5');
  const walk = (d, skip) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!skip.includes(e.name)) walk(p, []); } else { const s = fs.statSync(p); h.update(`${p}|${s.size}|${s.mtimeMs}\n`); } } };
  walk(path.join(ROOT, 'engine'), ['_dev', 'docs', 'ha']); walk(dash, []);
  for (const f of [ASSEMBLE, path.join(ROOT, 'engine/_dev/version.mjs')]) h.update(`${f}|${fs.statSync(f).mtimeMs}\n`);
  return h.digest('hex').slice(0, 12);
}
export function build(site = 'example') {
  if (builds.has(site)) return builds.get(site);
  const folder = siteFolder(site), dash = path.join(folder, 'dash');
  if (!fs.existsSync(path.join(dash, 'home.js'))) throw new Error(`no site '${site}' (looked for ${path.relative(ROOT, dash)}/home.js)`);
  let dir;
  if (path.dirname(folder) !== path.join(ROOT, 'sites')) { dir = temporary(); assemble(dash, dir); mine.add(site); }
  else {
    const name = path.basename(folder) + '-'; dir = path.join(CACHE, name + stamp(dash));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(CACHE, { recursive: true });
      const fresh = fs.mkdtempSync(path.join(CACHE, 'new-'));
      assemble(dash, fresh);
      try { fs.renameSync(fresh, dir); } catch (e) { fs.rmSync(fresh, { recursive: true, force: true }); }   // another test file made the same build first
      for (const old of fs.readdirSync(CACHE)) { const p = path.join(CACHE, old);   // builds of earlier states of the files (a run still using one is over in seconds)
        if ((old.startsWith(name) || old.startsWith('new-')) && p !== dir && Date.now() - fs.statSync(p).mtimeMs > 10 * 60000) fs.rmSync(p, { recursive: true, force: true }); }
    }
  }
  builds.set(site, path.join(dir, 'dash'));
  return builds.get(site);
}
// import a module of the build by its path in the deployed folder: load('core/store.js'), load('dashboards/main.js', 'example').
// again: any text; the same file with another one is evaluated afresh (a dashboard that reads the page address while it loads)
export const load = (file, site = 'example', again = '') => { loaded.add(site); return import(pathToFileURL(path.join(build(site), file)).href + (again ? '?' + again : '')); };

// Test doubles: replace some exports of one module, before anything is loaded. Every other module then gets the
// doubles; the real module stays importable as <name>.real.js. The process gets a copy of the build to do this in.
//   const sent = []; override('core/ha.js', { connected: () => true, call: (...a) => sent.push(a) });
export function override(file, doubles, site = 'example') {
  if (loaded.has(site)) throw new Error(`override('${file}') must come before the first load()`);
  if (!mine.has(site)) { const tmp = temporary(); fs.cpSync(path.dirname(build(site)), tmp, { recursive: true }); builds.set(site, path.join(tmp, 'dash')); mine.add(site); }
  const dir = build(site), real = file.replace(/\.js$/, '.real.js'), key = '__double:' + file;
  if (!fs.existsSync(path.join(dir, real))) fs.renameSync(path.join(dir, file), path.join(dir, real));
  G[key] = doubles;
  fs.writeFileSync(path.join(dir, file), `export * from './${path.basename(real)}';\n` +
    Object.keys(doubles).map((n) => `export const ${n} = (...a) => globalThis[${JSON.stringify(key)}].${n}(...a);`).join('\n') + '\n');
}
