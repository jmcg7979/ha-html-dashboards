// core/router.js: a view is built once, the navigation asked for last wins, every navigation ends in dash:shown, and a
// view left behind is removed after its time. The views are stand-ins; each is built when the test says so.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load, fakeTimeouts } from './stub.mjs';

const { initRouter, unloadSeconds } = await load('core/router.js');
const pushed = []; let scrolls = 0;
globalThis.history = { pushState: (_s, _t, url) => pushed.push(url) };
window.scrollTo = () => { scrolls++; };
const shown = []; window.addEventListener('dash:shown', (e) => shown.push(`${e.detail.view}${e.detail.changed ? ' changed' : ''}`));
const tick = () => new Promise((r) => setImmediate(r));

// a router over home, cams, sys (pages a, b) and now (back: 'home'); the listeners of the one before are taken off
let listeners = [];
function router(opts = {}) {
  listeners.forEach(([type, fn]) => window.removeEventListener(type, fn)); listeners = [];
  const add = window.addEventListener; window.addEventListener = (type, fn) => { listeners.push([type, fn]); add(type, fn); };
  const views = [{ id: 'home' }, { id: 'cams' }, { id: 'sys', pages: ['a', 'b'] }, { id: 'now', back: 'home' }];
  const app = { children: [], appendChild(el) { app.children.push(el); } };
  const waiting = {}, renders = [], marks = [];
  const render = (view) => { renders.push(view.id); return new Promise((ok, fail) => { waiting[view.id] = { ok: () => ok(element(view, app)), fail }; }); };
  const r = initRouter({ views, app, render, onShown: (id, here) => marks.push(here), ...opts });
  window.addEventListener = add;
  shown.length = 0; pushed.length = 0; scrolls = 0;
  const built = async (id) => { await tick(); waiting[id].ok(); await tick(); };   // the view's card types have loaded
  return { r, app, renders, marks, waiting, built, el: (id) => app.children.find((c) => c.id === id) };
}
function element(view, app) {
  const el = { id: view.id, hidden: false, dataset: {}, disposed: 0, remove() { app.children.splice(app.children.indexOf(el), 1); }, dispose() { el.disposed++; } };
  // app.failPage: a page that doesn't build
  if (view.pages) { el.showPage = async (p) => { if (p && p === app.failPage) throw new Error('page ' + p); el.current = view.pages.includes(p) ? p : view.pages[0]; }; }
  return el;
}

test('the first view for no id or an unknown one; dash:shown says what is on screen', async () => {
  const x = router();
  const p = x.r.show(null); await x.built('home'); await p;
  assert.deepEqual(shown, ['home changed']);
  await x.r.show('nowhere');
  assert.deepEqual(shown, ['home changed', 'home']);
  assert.deepEqual(x.renders, ['home']);
  assert.deepEqual(x.marks, ['home', 'home']);
  assert.deepEqual(pushed, []);
});

test('a view asked for twice while it loads is built once', async () => {
  const x = router();
  const a = x.r.show('cams'), b = x.r.show('cams');
  assert.equal(x.r.busy(), 2);
  await x.built('cams'); await Promise.all([a, b]);
  assert.deepEqual(x.renders, ['cams']);
  assert.equal(x.app.children.length, 1);
  assert.equal(x.r.busy(), 0);
  assert.deepEqual(shown, ['cams changed']);   // the overtaken one says nothing of its own: it shares the turn's end
});

test('the navigation asked for last wins: an earlier one that finishes later stays built and hidden', async () => {
  const x = router();
  const a = x.r.show('cams'), b = x.r.show('home');
  await x.built('home'); await b;
  await x.built('cams'); await a;
  assert.equal(x.el('home').hidden, false);
  assert.equal(x.el('cams').hidden, true);
  assert.deepEqual(shown, ['home changed']);
  assert.deepEqual(x.r.views().sort(), ['cams', 'home']);
});

test('a page of a view: its address, the mark and the history entry', async () => {
  const x = router();
  const p = x.r.show('sys/b', true); await x.built('sys'); await p;
  assert.deepEqual(shown, ['sys/b changed']);
  assert.deepEqual(x.marks, ['sys/b']);
  assert.deepEqual(pushed, ['?v=sys%2Fb']);
  await x.r.show('sys');   // no page named: the view's first
  assert.deepEqual(shown, ['sys/b changed', 'sys/a changed']);
  assert.deepEqual(pushed, ['?v=sys%2Fb']);   // not pushed: Back / Forward and the first view of a page load
});

test('to the top for a new page or a pushed one, not when the same one is shown again (a pop-up closing)', async () => {
  const x = router();
  const p = x.r.show('home'); await x.built('home'); await p;
  assert.equal(scrolls, 1);
  await x.r.show('home');
  assert.equal(scrolls, 1);
  await x.r.show('home', true);
  assert.equal(scrolls, 2);
});

test('the dash:view event navigates and pushes; view.back is written on the element', async () => {
  const x = router();
  window.dispatchEvent(new CustomEvent('dash:view', { detail: 'now' }));
  await x.built('now'); await tick();
  assert.deepEqual(shown, ['now changed']);
  assert.deepEqual(pushed, ['?v=now']);
  assert.equal(x.el('now').dataset.back, 'home');
});

test('a view that fails to build: dash:shown all the same, the error to the caller, and it is tried again next time', async () => {
  const x = router();
  const h = x.r.show('home'); await x.built('home'); await h;
  const p = x.r.show('cams'); await tick(); x.waiting.cams.fail(new Error('no such card'));
  await assert.rejects(p, /no such card/);
  assert.deepEqual(shown, ['home changed', 'home']);
  assert.equal(x.r.busy(), 0);
  assert.equal(x.el('home').hidden, false);
  const again = x.r.show('cams'); await x.built('cams'); await again;
  assert.deepEqual(x.renders, ['home', 'cams', 'cams']);
  assert.deepEqual(shown, ['home changed', 'home', 'cams changed']);
});

test('a press on a view that fails to build: the error goes to onError, nothing is left unhandled, dash:shown all the same', async () => {
  const failed = [], x = router({ onError: (e) => failed.push(e.message) });
  const h = x.r.show('home'); await x.built('home'); await h;
  window.dispatchEvent(new CustomEvent('dash:view', { detail: 'cams' }));
  await tick(); x.waiting.cams.fail(new Error('no such card')); await tick();
  assert.deepEqual(failed, ['no such card']);
  assert.deepEqual(shown, ['home changed', 'home']);
  assert.deepEqual(pushed, []);
  const p = x.r.open('sys'); await tick(); x.waiting.sys.fail(new Error('offline')); await p;
  assert.deepEqual(failed, ['no such card', 'offline']);
});

test('a navigation that was overtaken and then fails is only logged: no error for anyone, the one on screen stays', async (t) => {
  const err = console.error; const logged = []; console.error = (e) => logged.push(e.message);
  t.after(() => { console.error = err; });
  const failed = [], x = router({ onError: (e) => failed.push(e.message) });
  const a = x.r.open('cams'), b = x.r.show('home');
  await x.built('home'); await b;
  x.waiting.cams.fail(new Error('too late')); await a;
  assert.deepEqual(failed, []);
  assert.deepEqual(logged, ['too late']);
  assert.equal(x.el('home').hidden, false);
  assert.deepEqual(shown, ['home changed', 'home']);
});

test('a page that fails to build: its view, built for it, does not stay on screen beside the one that is', async () => {
  const x = router();
  const h = x.r.show('home'); await x.built('home'); await h;
  x.app.failPage = 'b';
  const p = x.r.show('sys/b'); await tick(); x.waiting.sys.ok();
  await assert.rejects(p, /page b/);
  assert.equal(x.el('sys').hidden, true);
  assert.equal(x.el('home').hidden, false);
  assert.deepEqual(shown, ['home changed', 'home']);
  // from another page of the same view, which is on screen: it stays
  await x.r.show('sys/a');
  await assert.rejects(x.r.show('sys/b'), /page b/);
  assert.equal(x.el('sys').hidden, false);
  assert.equal(x.el('sys').current, 'a');
});

test('a view built unseen that fails: logged, a navigation waiting on it gets the error, and it is built again when asked', async (t) => {
  const err = console.error; let logged = 0; console.error = () => { logged++; };
  t.after(() => { console.error = err; });
  const x = router();
  const n = x.r.show('now'); await x.built('now'); await n;
  x.r.prebuild({ id: 'home' });
  const p = x.r.show('home'); await tick();
  x.waiting.home.fail(new Error('no home'));
  await assert.rejects(p, /no home/);
  assert.equal(logged, 1);
  assert.equal(x.el('now').hidden, false);
  const again = x.r.show('home'); await x.built('home'); await again;
  assert.deepEqual(x.renders, ['now', 'home', 'home']);
  assert.equal(x.el('home').hidden, false);
});

test('keep: null is no list', async () => {
  const x = router({ keep: null, after: 5 });
  const p = x.r.show('home'); await x.built('home'); await p;
  assert.deepEqual(x.r.views(), ['home']);
});

test('a view left behind is removed after its time; the first view and the kept ones stay', async (t) => {
  const time = fakeTimeouts(); t.after(time.restore);
  const x = router({ after: 60, keep: ['now'] });
  for (const id of ['home', 'now', 'cams', 'sys']) { const p = x.r.show(id); await x.built(id); await p; }
  const cams = x.el('cams');
  time.tick(59000);
  assert.deepEqual(x.r.views().sort(), ['cams', 'home', 'now', 'sys']);
  time.tick(1000);
  assert.deepEqual(x.r.views().sort(), ['home', 'now', 'sys']);
  assert.equal(cams.disposed, 1);
  assert.equal(x.app.children.includes(cams), false);
});

test('a view on its way out that is wanted again stays, and is not built again', async (t) => {
  const time = fakeTimeouts(); t.after(time.restore);
  const x = router({ after: 60 });
  for (const id of ['home', 'cams', 'home']) { const p = x.r.show(id); if (!x.el(id)) await x.built(id); await p; }
  time.tick(30000);
  await x.r.show('cams');
  time.tick(120000);
  assert.deepEqual(x.r.views().sort(), ['cams', 'home']);
  assert.deepEqual(x.renders, ['home', 'cams']);
  await x.r.show('home');
  time.tick(60000);
  assert.deepEqual(x.r.views(), ['home']);
});

test('a dispose that throws does not keep the view', async (t) => {
  const time = fakeTimeouts(); t.after(time.restore);
  const err = console.error; let said = 0; console.error = () => { said++; };
  t.after(() => { console.error = err; });
  const x = router({ after: 10 });
  for (const id of ['home', 'cams', 'home']) { const p = x.r.show(id); if (!x.el(id)) await x.built(id); await p; }
  x.el('cams').dispose = () => { throw new Error('a card'); };
  time.tick(10000);
  assert.deepEqual(x.r.views(), ['home']);
  assert.equal(said, 1);
});

test('after: 0 keeps everything', async (t) => {
  const time = fakeTimeouts(); t.after(time.restore);
  const x = router();
  for (const id of ['home', 'cams', 'home']) { const p = x.r.show(id); if (!x.el(id)) await x.built(id); await p; }
  time.tick(3600e3);
  assert.deepEqual(x.r.views().sort(), ['cams', 'home']);
});

test('prebuild: built unseen, once, and shown when asked for', async () => {
  const x = router();
  const p = x.r.show('now'); await x.built('now'); await p;
  x.r.prebuild({ id: 'home' }); x.r.prebuild({ id: 'home' });
  await x.built('home');
  assert.deepEqual(x.renders, ['now', 'home']);
  assert.equal(x.el('home').hidden, true);
  assert.deepEqual(shown, ['now changed']);
  x.r.prebuild({ id: 'home' });
  assert.deepEqual(x.renders, ['now', 'home']);
  await x.r.show('home');
  assert.equal(x.el('home').hidden, false);
  assert.equal(x.el('now').hidden, true);
});

test('how long a view stays: the address, the dashboard, then the screen', () => {
  const q = (s) => new URLSearchParams(s);
  assert.equal(unloadSeconds({ unload: { after: 30 } }, 'tv', q('unload=5')), 5);
  assert.equal(unloadSeconds({ unload: { after: 30 } }, 'tv', q('unload=0')), 0);
  assert.equal(unloadSeconds({ unload: { after: 30 } }, 'tv', q('')), 30);
  assert.equal(unloadSeconds({ unload: { after: 0 } }, 'tv', q('')), 0);
  assert.equal(unloadSeconds({}, 'tv', q('')), 600);   // the stub's machine has 8 GB
  navigator.deviceMemory = 2;
  assert.equal(unloadSeconds({}, 'tv', q('')), 60);
  assert.equal(unloadSeconds({}, 'phone', q('')), 180);
  navigator.deviceMemory = 8;
});
