// core/tvhost.js: the page's side of the TV launcher's bridge (window.tvhost). The module reads the bridge once, while
// it is imported, so each case imports it afresh with the window.tvhost of that case: no launcher (a browser), a
// launcher built before caps() existed, a current one, and the take-over window's smaller bridge.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load } from './stub.mjs';

let n = 0;
const withBridge = async (bridge) => { if (bridge) window.tvhost = bridge; else delete window.tvhost; return load('core/tvhost.js', 'example', 'case=' + (++n)); };
// a bridge as addJavascriptInterface makes one: its methods only work when called on the object itself
function bridge(methods, caps) {
  const calls = [], b = {};
  for (const [name, answer] of Object.entries(methods)) b[name] = function (...a) { assert.equal(this, b, `${name} called on the bridge object`); calls.push([name, ...a]); return typeof answer === 'function' ? answer(...a) : answer; };
  if (caps) b.caps = function () { assert.equal(this, b); return JSON.stringify({ ...caps, can: [...Object.keys(methods), 'caps'] }); };
  return { b, calls };
}
const quiet = async (fn) => { const { info, warn } = console; const said = []; console.info = console.warn = (...a) => said.push(a.join(' ')); try { await fn(); } finally { console.info = info; console.warn = warn; } return said; };

test('a browser: no launcher, nothing throws, launches are only logged', async () => {
  const T = await withBridge(null);
  assert.equal(T.onTV, false); assert.equal(T.api, -1); assert.equal(T.can('launch'), false);
  assert.equal(T.apps(), null, 'cards fall back to their own list'); assert.equal(T.watchNext(), null);
  const said = await quiet(() => { assert.equal(T.launch('a.b'), true); assert.equal(T.open('market://details?id=a.b'), true); T.overlay('shown'); });
  assert.equal(said.length, 3);
  T.watch([{ entity: 'x.y', state: 'on' }]); T.cover('now'); T.show('now'); T.keepAwake(true);
});

test('a launcher from before caps(): api 0, what it has is used, what it lacks is skipped', async () => {
  const { b, calls } = bridge({ info: '{"id":"tv1"}', apps: '[{"pkg":"a.b","label":"A"}]', launch: true, open: false, settings: undefined });
  const T = await withBridge(b);
  assert.equal(T.onTV, true); assert.equal(T.api, 0);
  assert.equal(T.can('launch'), true); assert.equal(T.can('watch'), false); assert.equal(T.can('caps'), false);
  assert.deepEqual(T.apps(), [{ pkg: 'a.b', label: 'A' }]);
  assert.deepEqual(T.watchNext(), [], 'no Watch Next on this launcher: an empty list, not an error');
  assert.equal(T.launch('a.b'), true); assert.equal(T.open('x:y'), false);
  T.watch([{ entity: 'x.y', state: 'on' }]); T.cover('now'); T.show('now'); T.keepAwake(true);
  await quiet(() => T.overlay('shown'));
  assert.deepEqual(calls.map((c) => c[0]), ['apps', 'launch', 'open'], 'only methods this launcher has were called');
});

test('a current launcher: caps() says what it can; every call reaches the bridge with its arguments', async () => {
  const { b, calls } = bridge({ info: '{}', apps: '[]', watchNext: '[{"title":"Bluey"}]', launch: true, open: true, settings: undefined, watch: undefined,
    keepAwake: undefined, show: undefined, cover: undefined }, { api: 1, version: '2026.11.13-abc', overlay: false });
  const T = await withBridge(b);
  assert.equal(T.api, 1); assert.equal(T.can('watch'), true); assert.equal(T.can('overlay'), false);
  assert.deepEqual(T.watchNext(), [{ title: 'Bluey' }]);
  T.cover('now'); T.cover(); T.show('now'); T.keepAwake(1);
  assert.deepEqual(calls, [['watchNext'], ['cover', 'now'], ['cover', ''], ['show', 'now'], ['keepAwake', true]]);
  assert.equal(T.store('com.netflix.ninja'), true);
  assert.deepEqual(calls.at(-1), ['open', 'market://details?id=com.netflix.ninja']);
});

test('caps() that names fewer methods than the object has wins: the launcher decides', async () => {
  const b = { caps: () => JSON.stringify({ api: 1, can: ['caps', 'launch'] }), launch: () => true, open: () => { throw new Error('not offered'); } };
  const T = await withBridge(b);
  assert.equal(T.can('open'), false); assert.equal(T.open('x:y'), false); assert.equal(T.launch('a.b'), true);
});

test('caps() that fails or answers nonsense reads as api 0', async () => {
  for (const caps of [() => { throw new Error('refused'); }, () => 'not json', () => '{}', () => 'null']) {
    const T = await withBridge({ caps, launch: () => true });
    assert.equal(T.api, 0); assert.equal(T.can('launch'), true); assert.equal(T.can('open'), false);
  }
});

test('watch: each caller has its own key, the launcher gets one list; a row without an entity or a state is left out', async () => {
  const { b, calls } = bridge({ watch: undefined }, { api: 1 });
  const T = await withBridge(b);
  T.watch([{ entity: 'input_boolean.timer', state: 'on' }]);
  T.watch([{ entity: 'media_player.tv', state: 'playing', view: 'now' }], 'music');
  assert.deepEqual(JSON.parse(calls.at(-1)[1]), [{ entity: 'input_boolean.timer', state: 'on' }, { entity: 'media_player.tv', state: 'playing', view: 'now' }]);
  const said = await quiet(() => T.watch([{ entity: undefined, state: 'ALERT' }, { entity: 'sensor.grid' }, null, { entity: 'sensor.ok', state: 'on' }]));
  assert.deepEqual(JSON.parse(calls.at(-1)[1]), [{ entity: 'sensor.ok', state: 'on' }, { entity: 'media_player.tv', state: 'playing', view: 'now' }], 'the good rows are still watched');
  assert.equal(said.length, 1); assert.match(said[0], /3 of the 'alerts' watch entries/);
  T.watch(null, 'music');
  assert.deepEqual(JSON.parse(calls.at(-1)[1]), [{ entity: 'sensor.ok', state: 'on' }]);
});

test("the take-over window's bridge (overlay, info, caps): the other calls answer 'no' instead of throwing", async () => {
  const { b, calls } = bridge({ overlay: undefined, info: '{"overlay":true}' }, { api: 1, overlay: true });
  const T = await withBridge(b);
  assert.equal(T.launch('a.b'), false); assert.equal(T.open('x:y'), false); assert.deepEqual(T.apps(), []); assert.deepEqual(T.watchNext(), []);
  T.watch([{ entity: 'x.y', state: 'on' }]); T.cover('now');
  T.overlay('shown'); T.overlay('done');
  assert.deepEqual(calls, [['overlay', 'shown'], ['overlay', 'done']]);
});

test("the launcher's tv:view becomes the page's dash:view", async () => {
  const { b } = bridge({}, { api: 1 });
  await withBridge(b);
  const seen = []; const on = (e) => seen.push(e.detail); window.addEventListener('dash:view', on);
  window.dispatchEvent(new CustomEvent('tv:view', { detail: 'now' }));
  window.dispatchEvent(new CustomEvent('tv:view', { detail: '' }));
  window.removeEventListener('dash:view', on);
  assert.ok(seen.length >= 1 && seen.every((v) => v === 'now'), 'the view is passed on; an empty one is not');
});

test("a view the page asked the launcher to show is not switched to a second time by the launcher's answer", async () => {
  const { b } = bridge({ show: undefined }, { api: 1 });
  const T = await withBridge(b);
  // the modules of the cases above still listen on this window, so this one's part is what changes after show()
  const count = (view) => { let n = 0; const on = (e) => { if (e.detail === view) n++; }; window.addEventListener('dash:view', on); window.dispatchEvent(new CustomEvent('tv:view', { detail: view })); window.removeEventListener('dash:view', on); return n; };
  const before = count('now'), other = count('home');
  T.show('now');
  assert.equal(count('now'), before - 1, "the launcher's answer to show() is not passed on");
  assert.equal(count('home'), other, 'another view still is');
});
