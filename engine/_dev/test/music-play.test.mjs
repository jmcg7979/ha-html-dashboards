// core/play.js playOn(): starting music on rooms from the Music page, and core/wake.js: what a room's card says while
// music is on its way and when that ends. The connection is replaced by a recorder; timers are moved by hand.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load, override, fakeTimeouts } from './stub.mjs';

const sent = [], toasts = []; let online = true, refuse = null, answer = null;   // answer: a function = Home Assistant answers the play only when it is called
override('core/ha.js', { connected: () => online,
  call: (service, data, target, onFail, onDone) => {   // (Home Assistant's yes or no comes back later)
    if (!online) return false;
    sent.push({ service, target, ...data });
    if (refuse === service) setImmediate(onFail); else if (answer) answer = onDone; else setImmediate(onDone);
    return true;
  },
  request: (m) => { sent.push({ service: `${m.domain}.${m.service}`, target: m.target.entity_id, ...m.service_data }); return refuse === m.service ? Promise.reject(new Error('refused')) : Promise.resolve(null); } });
override('core/toast.js', { toast: (text) => { toasts.push(text); }, hideToast: () => {} });
override('core/ma.js', { cmd: (command, args) => { sent.push({ service: command, ...args }); return Promise.resolve(null); }, playerId: (e) => Promise.resolve('id-of-' + e) });
const timers = fakeTimeouts();
const realNow = Date.now; let ahead = 0; Date.now = () => realNow() + ahead;
const pass = async (ms) => { for (let t = 0; t < ms; t += 500) { ahead += 500; timers.tick(500); await settle(); } };   // time goes by, and what waited on it runs
const settle = () => new Promise((r) => setImmediate(r));
const ST = await load('core/store.js'), { playOn } = await load('core/play.js'), { pending } = await load('core/wake.js');

const K = 'media_player.kitchen_ma', L = 'media_player.living_ma';
const NAMES = { [K]: 'Kitchen', [L]: 'Living Room' };
const W = { label: (l) => (l.length > 1 ? l.length + ' rooms' : NAMES[l[0]]), nameOf: (e) => NAMES[e], isGroup: () => false };
const set = (id, s, a = {}) => ST.applyEntities({ a: { [id]: { s, a, lc: 1 } } });
const playlist = { uri: 'spotify://playlist/1', media_type: 'playlist', name: 'Evening' }, song = { uri: 'spotify://track/2', media_type: 'track', name: 'Dreamers' };
const start = async (entities, act, it, how) => { sent.length = 0; toasts.length = 0; const p = playOn(entities, act, it, { W, playerOf: () => null, what: it.name, how }); await settle(); return p; };
const fresh = () => { online = true; refuse = null; answer = null; set(K, 'idle', { group_members: [] }); set(L, 'idle', { group_members: [] }); };

test('Play on a room: its card says so until it plays; the page says Starting, then Playing', async () => {
  fresh();
  await start([K], 'play', playlist);
  assert.deepEqual(sent, [{ service: 'music_assistant.play_media', target: K, media_id: playlist.uri, media_type: 'playlist', enqueue: 'replace' }]);
  assert.deepEqual([pending(K).text, pending(K).what, toasts.at(-1)], ['Starting the music…', 'Evening', 'Starting on Kitchen…']);
  await pass(3000);
  assert.equal(!!pending(K), true, 'not playing yet: still on its way');
  set(K, 'playing'); await pass(1500);
  assert.deepEqual([pending(K), toasts.at(-1)], [null, 'Playing on Kitchen']);
});

test('a song plays now without replacing the queue; Play next goes to the room’s leader and its card says nothing', async () => {
  fresh();
  await start([K], 'play', song);
  assert.equal(sent[0].enqueue, 'play');
  await pass(100000);
  set(K, 'playing', { group_members: [L, K] }); set(L, 'playing', { group_members: [L, K] });
  await start([K], 'next', song);
  assert.deepEqual(sent, [{ service: 'music_assistant.play_media', target: L, media_id: song.uri, media_type: 'track', enqueue: 'next' }]);
  assert.deepEqual([pending(K), toasts.at(-1)], [null, 'Playing next on Kitchen']);
});

test('several rooms: they are put in sync, then it plays on the one that leads', async () => {
  fresh();
  await start([K, L], 'play', playlist); await settle();
  assert.deepEqual(sent.map((m) => `${m.service} ${m.target}`), ['media_player.join ' + K, 'music_assistant.play_media ' + K]);
  assert.deepEqual([sent[0].group_members, toasts.at(-1)], [[L], 'Starting on 2 rooms…']);
  await pass(100000);
});

test('shuffled, or from one song of a playlist: Music Assistant’s own play_media on the room’s queue', async () => {
  fresh();
  await start([K], 'play', playlist, { shuffle: true, start: song.uri }); await settle();
  assert.deepEqual(sent, [{ service: 'player_queues/play_media', queue_id: 'id-of-' + K, media: playlist.uri, option: 'replace', start_item: song.uri, shuffle: true }]);
  await pass(100000);
});

test('every way a start fails takes "Starting the music…" off the room’s card and says why', async () => {
  fresh(); refuse = 'music_assistant.play_media';
  await start([K], 'play', playlist);
  await settle();
  assert.deepEqual([pending(K), toasts.at(-1)], [null, 'Kitchen didn’t take it: Home Assistant refused the play'], 'Home Assistant refused');
  await pass(45000);
  assert.equal(toasts.at(-1), 'Kitchen didn’t take it: Home Assistant refused the play', 'and nothing more is said about it later');
  fresh(); online = false;
  await start([K], 'play', playlist);
  assert.deepEqual([pending(K), toasts.at(-1)], [null, 'Not connected to Home Assistant'], 'no link');
  fresh(); refuse = 'join';
  await start([K, L], 'play', playlist); await settle();
  assert.deepEqual([pending(K), pending(L), toasts.at(-1)], [null, null, 'Music Assistant couldn’t play on those rooms together'], 'the rooms could not be put in sync');
  fresh();
  await start([K], 'play', playlist);
  await pass(39000); assert.equal(!!pending(K), true);
  await pass(3000);
  assert.deepEqual([pending(K), toasts.at(-1)], [null, 'Kitchen hasn’t started playing. Check the TV, or try again.'], 'it never played');
});

test('a long playlist: nothing runs out while Music Assistant collects its songs; "hasn’t started" counts from its answer', async () => {
  fresh(); answer = true;
  await start([K], 'play', playlist);
  await pass(120000);
  assert.deepEqual([pending(K).text, toasts.at(-1)], ['Starting the music…', 'Starting on Kitchen…'], 'two minutes without an answer: still starting, on the card and on the page');
  answer(); await pass(39000);
  assert.equal(toasts.at(-1), 'Starting on Kitchen…', 'answered: it has its 40 s to start');
  set(K, 'playing'); await pass(1500);
  assert.deepEqual([pending(K), toasts.at(-1)], [null, 'Playing on Kitchen']);
  fresh(); answer = true;
  await start([K], 'play', playlist);
  await pass(60000); answer(); await pass(42000);
  assert.deepEqual([pending(K), toasts.at(-1)], [null, 'Kitchen hasn’t started playing. Check the TV, or try again.'], 'answered and never played: said 40 s after the answer');
});
