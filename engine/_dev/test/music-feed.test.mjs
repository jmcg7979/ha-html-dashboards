// core/ma.js: a queue that is shown keeps its feed (its songs, and Music Assistant's events for it) over a Home Assistant
// restart. A screen is back seconds before Home Assistant has loaded the relay, so for a while its commands are unknown:
// that used to be read as "this site has no relay" for the rest of the page's life, and the queue on screen stood still.
// Home Assistant is replaced by one that can drop its link and not know the relay; timers are moved by hand.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load, override, fakeTimeouts } from './stub.mjs';

let relay = 'loaded', nextId = 1; const asked = [], feeds = new Map();   // feeds: subscription id -> { ev, rej } as HA holds it
const answer = (msg) => {
  if (msg.type.startsWith('ma_relay/') && relay === 'unknown') return { error: { code: 'unknown_command', message: 'Unknown command.' } };
  if (msg.type === 'ma_relay/info') return { result: { connected: relay === 'loaded', image_key: 'k', time: Date.now() / 1000 } };
  if (msg.type.startsWith('ma_relay/') && relay === 'down') return { error: { code: 'not_connected', message: 'Music Assistant isn’t connected' } };
  if (msg.type === 'ma_relay/cmd') return { result: msg.command === 'player_queues/get' ? { current_index: 0, items: 1 } : [{ queue_item_id: 'a' }] };
  return { result: null };
};
override('core/ha.js', {
  connected: () => true, up: () => Promise.resolve(), unsubscribe: (id) => { feeds.delete(id); },
  send: (msg, cb, ev, rej) => {
    msg.id = nextId++; asked.push(msg.type); const a = answer(msg);
    setImmediate(() => { if (!a.error && ev) feeds.set(msg.id, { ev, rej }); if (cb) cb(a.error ? null : a.result, { success: !a.error, error: a.error }); });
    return true;
  },
  request: (msg) => { asked.push(msg.command || msg.type); const a = answer(msg); return new Promise((res, rej) => setImmediate(() => (a.error ? rej(a.error) : res(a.result)))); },
});
const timers = fakeTimeouts(); const realNow = Date.now; let ahead = 0; Date.now = () => realNow() + ahead;
const settle = () => new Promise((r) => setImmediate(r));
const pass = async (ms) => { for (let t = 0; t < ms; t += 50) { ahead += 50; timers.tick(50); await settle(); await settle(); } };
// Home Assistant restarts: its link drops (everyone waiting on it is told) and is back at once
const restart = (then) => { relay = then; const dead = [...feeds.values()]; feeds.clear(); asked.length = 0; dead.forEach((s) => s.rej('offline')); };
const MA = await load('core/ma.js'), { RETRY_REFUSED } = await load('core/music-timing.js');

test('a queue on screen has its feed again after Home Assistant restarts, though the screen is back before the relay is loaded', async () => {
  let reads = 0; const off = MA.queue('q1', () => { reads++; });
  await pass(1000);
  assert.deepEqual([feeds.size, reads], [1, 1], 'shown: one subscription, the queue read once');
  restart('unknown');
  await pass(RETRY_REFUSED - 1000);
  assert.deepEqual([feeds.size, asked], [0, ['ma_relay/info']], 'the relay is unknown: asked once, not again and again');
  relay = 'loaded'; asked.length = 0;
  await pass(RETRY_REFUSED + 1000);
  assert.deepEqual([feeds.size, asked], [1, ['ma_relay/info', 'ma_relay/subscribe', 'player_queues/get', 'player_queues/items']], 'the relay is there: within one more wait it is subscribed again, once, and the queue read again');
  await pass(60000);
  assert.equal(asked.length, 4, 'and nothing more is asked');
  assert.equal(reads, 2);
  assert.equal(await MA.available(), true);
  off(); assert.equal(feeds.size, 0, 'off screen: the subscription is ended');
});

test('a queue shown while Music Assistant can’t be reached gets its feed once it can', async () => {
  restart('down'); await pass(100);
  let reads = 0; const off = MA.queue('q2', () => { reads++; });
  await pass(45000);
  assert.deepEqual([feeds.size, reads], [0, 0], 'Music Assistant is down: nothing to show yet');
  relay = 'loaded';
  await pass(60000);
  assert.deepEqual([feeds.size, reads], [1, 1]);
  off();
});

test('a site without the relay is asked about it only once per wait', async () => {
  restart('unknown'); await pass(100);
  const off = MA.queue('q3', () => {});
  await pass(1000); asked.length = 0;   // (the first try, on what the relay said before it went)
  await pass(5 * 60000);
  assert.ok(asked.length <= 5 * 60000 / RETRY_REFUSED && asked.every((a) => a === 'ma_relay/info'), `asked ${asked.length} times in 5 minutes: ${[...new Set(asked)]}`);
  off(); relay = 'loaded';
});
