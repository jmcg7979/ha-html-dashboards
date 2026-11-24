// core/session.js: one player as every card sees it. The session is the only thing that reads the player's entities
// for the cards and the only one that moves a song change on; what it shows is one snapshot per change. Music Assistant's
// queue (core/ma.js) and the connection (core/ha.js) are replaced by recorders; the clock is moved by hand.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load, override, frames, fakeTimeouts } from './stub.mjs';

const queues = [], sent = [];   // what was asked of MA's queues: { id, fn, on }; what was sent to HA
override('core/ma.js', { queue: (id, fn) => { const q = { id, fn, on: true }; queues.push(q); return () => { q.on = false; }; }, cmd: () => Promise.resolve(null) });
override('core/ha.js', { connected: () => true, call: (service, data, target) => { sent.push({ service, target }); return true; },
  request: (m) => { sent.push({ service: `${m.domain}.${m.service}`, target: m.target.entity_id }); return Promise.resolve(null); } });
override('core/toast.js', { toast: () => {} });
const timers = fakeTimeouts();
const realNow = Date.now; let ahead = 0; Date.now = () => realNow() + ahead;
const pass = (ms) => { ahead += ms; timers.tick(ms); };   // time goes by: the clock the rules read, and the timers
const ST = await load('core/store.js'), { session, currentOf } = await load('core/session.js');
const settle = () => new Promise((r) => setImmediate(r));

const FEATURES = 1 | 2 | 4 | 8 | 16 | 32 | 4096 | 16384 | 32768 | 262144;   // pause, seek, volume, mute, previous, next, stop, play, shuffle, repeat
let n = 0;
// a speaker with a Music Assistant player; set(state, attributes) changes that player and lets the page hear of it
function player() {
  const id = 'media_player.s' + ++n, p = { entity: id, ma: id + '_ma', name: 'Speaker ' + n };
  const set = (s, a = {}) => { ST.applyEntities({ c: { [p.ma]: { '+': { s, a } } } }); frames.run(); };
  ST.applyEntities({ a: { [p.ma]: { s: 'playing', a: { active_queue: 'q' + n, media_title: 'A', media_artist: 'One', supported_features: FEATURES, group_members: [] }, lc: realNow() / 1000 } } });
  return { p, S: session(p), set, queue: () => queues.filter((q) => q.id === 'q' + n.toString() && q.on) };
}
const item = (id, name) => ({ queue_item_id: id, name, media_item: { name, uri: 'x://' + id, artists: [{ name: 'One' }] } });
const word = (current, items, more = {}) => ({ queue: { current_index: items.indexOf(current), current_item: current, items: items.length, elapsed_time: 10, elapsed_time_last_updated: Date.now() / 1000, ...more }, items, offset: 0 });

test('one snapshot per change: every card is told once and reads the same one; each control names its entity', () => {
  const { p, S, set } = player(); let told = 0;
  const off = S.on(() => { told++; });
  const v = S.snap;
  assert.equal(S.snap, v, 'read again: the same snapshot, nothing is worked out twice');
  assert.equal(Object.isFrozen(v), true);
  assert.deepEqual([v.n.title, v.live, v.rooms, v.music, v.stopped], ['A', p.ma, [p.ma], true, false]);
  assert.deepEqual([v.caps.pause, v.caps.next, v.caps.volume, v.caps.step, v.caps.source], [p.ma, p.ma, p.ma, null, null]);
  told = 0; set('paused');
  assert.equal(told, 1, 'one change, one word to the card');
  assert.notEqual(S.snap, v); assert.equal(S.snap.n.state, 'paused');
  off();
});

test("a word of Music Assistant's clock moves the clock and draws nothing", () => {
  const { S, queue } = player(); let told = 0;
  const off = S.on(() => { told++; });
  const a = item('a', 'A'), b = item('b', 'B'), q = queue()[0];
  q.fn(word(a, [a, b]), false);
  assert.equal(S.snap.item.queue_item_id, 'a'); assert.equal(S.snap.cur, 0);
  told = 0;
  q.fn(word(a, [a, b], { elapsed_time: 42 }), true);
  assert.equal(told, 0);
  assert.equal(Math.round(S.pos(S.snap.n)), 42, 'the position is counted from the new word');
  off();
});

test("a card that only names the song doesn't have MA's queue read; the last card to go leaves nothing watched", () => {
  const before = ST.stats().watchers;
  const { S, queue } = player();
  const offRow = S.on(() => {}, { queue: false });
  assert.equal(queue().length, 0, 'a row alone: no queue');
  assert.equal(S.snap.queueId, 'q' + n, 'it still knows which queue it is');
  const offCard = S.on(() => {});
  assert.equal(queue().length, 1, 'the pop-up opens: the queue is read');
  offCard();
  assert.equal(queue().length, 0, 'and let go with it');
  assert.equal(ST.stats().watchers > before, true, 'the row still follows the player');
  offRow();
  assert.equal(ST.stats().watchers, before);
});

test('a song change from elsewhere: the queue names the new song, every card shows it at once', () => {
  const { S, set, queue } = player();
  const off = S.on(() => {});
  const a = item('a', 'A'), b = item('b', 'B'), q = queue()[0];
  q.fn(word(a, [a, b]), false);
  q.fn(word(b, [a, b]), false);   // MA's queue moved on; Home Assistant still says A
  const v = S.snap;
  assert.deepEqual([v.n.title, !!v.n.target, !!v.n.starting, v.cur], ['B', true, false, 1], 'the new song, no Starting… while the sound goes on');
  set('playing', { media_title: 'B' }); pass(4100);
  assert.deepEqual([S.snap.n.title, !!S.snap.n.held], ['B', false], 'settled once Home Assistant has it and the sound never stopped');
  off();
});

test('between songs the last one is held, and let go by the session itself when nothing changes any more', () => {
  const { S, set } = player(); const seen = [];
  const off = S.on((v) => seen.push(v.n ? v.n.title + (v.n.held ? '~' : '') : '-'));
  set('idle', { media_title: null });
  assert.equal(seen.at(-1), 'A~');
  pass(8500);
  assert.equal(seen.at(-1), '-', 'no entity changed: the session looked again by itself');
  const told = seen.length; pass(5000);
  assert.equal(seen.length, told, 'settled: it stops looking');
  off();
});

test('Stop pressed on this screen: nothing is shown as paused; stopped from elsewhere it reads as the song, paused', () => {
  const mine = player(), other = player();
  const off = [mine.S.on(() => {}, { queue: false }), other.S.on(() => {}, { queue: false })];
  sent.length = 0; mine.S.act('stop');
  assert.deepEqual(sent, [{ service: 'media_player.media_stop', target: mine.p.ma }]);
  mine.set('idle'); other.set('idle');
  pass(100);
  assert.deepEqual([mine.S.snap.n, mine.S.snap.stopped, mine.S.snap.song], [null, true, null], 'ours: where it stopped, with Resume');
  pass(9000);
  assert.deepEqual([other.S.snap.n.title, other.S.snap.n.state, other.S.snap.n.stopped, other.S.snap.stopped], ['A', 'paused', true, true]);
  assert.equal(mine.S.snap.n, null, 'still nothing, also once it has been looked at again');
  off.forEach((f) => f());
});

test('a TV that is off is off, not paused, whatever its stopped queue still holds', async () => {
  const { stopped, stoppedNow, stoppedLong } = await load('core/players.js');
  const p = { entity: 'media_player.offtv', ma: 'media_player.offtv_ma', power: 'media_player.offtv_remote', name: 'Off TV' }, t = Date.now();
  const queue = { s: 'idle', a: { active_queue: 'q', media_title: 'Song', media_position_updated_at: new Date(t).toISOString() }, lc: t / 1000 };
  ST.applyEntities({ a: { 'media_player.offtv_ma': queue, 'media_player.offtv_remote': { s: 'on', a: {}, lc: t / 1000 } } });
  assert.equal(stopped(p), true, 'the TV on its home screen with a stopped queue: paused');
  assert.equal(session(p).snap.n.title, 'Song');
  assert.equal(stoppedLong(stoppedNow(p), t + 3600e3), false, 'an hour on: still listed under Playing');
  assert.equal(stoppedLong(stoppedNow(p), t + 3 * 3600e3), true, 'three hours on: not any more');
  ST.applyEntities({ a: { 'media_player.offtv_remote': { s: 'off', a: {}, lc: t / 1000 + 1 } } });
  assert.equal(stopped(p), false);
  assert.deepEqual([session(p).snap.n, session(p).snap.stopped], [null, false], 'no row under Playing, no Resume');
});

test('a queue that was just handed on has no current song, whatever songs are still held of it', () => {
  const a = item('a', 'A'), b = item('b', 'B');
  assert.equal(currentOf(word(b, [a, b])).queue_item_id, 'b');
  assert.equal(currentOf({ queue: { current_index: 1, items: 2 }, items: [a, b], offset: 0 }).queue_item_id, 'b', 'MA names none: the one at its number');
  assert.equal(currentOf({ queue: { current_index: 0, current_item: null, items: 0 }, items: [a, b], offset: 0 }), null, 'emptied');
  assert.equal(currentOf({ queue: { current_index: null, current_item: null, items: 2 }, items: [a, b], offset: 0 }), null, 'no current number');
});

test('Leave group on the room that leads: the music ends here at once, and the emptied queue is not taken for a song change', async () => {
  const { p, S, set, queue } = player(), other = 'media_player.other_ma';
  const off = S.on(() => {});
  const a = item('a', 'A'), b = item('b', 'B'), q = queue()[0];
  set('playing', { group_members: [p.ma, other] });
  q.fn(word(b, [a, b]), false);
  assert.deepEqual(S.snap.rooms, [p.ma, other]);
  sent.length = 0; S.leave();
  // MA hands the queue to the other room: this one's is empty, with its old songs still held here, while HA still says playing
  q.fn({ queue: { current_index: 0, current_item: null, items: 0 }, items: [a, b], offset: 0 }, false);
  assert.deepEqual([S.snap.n.title, !!S.snap.n.target], ['A', false], 'no song "starting": the first of the old songs is not where it is going');
  set('idle', { media_title: null, group_members: [] });
  assert.equal(S.snap.n, null, 'quiet: nothing is held here');
  await settle();
  assert.deepEqual(sent.map((m) => `${m.service} ${m.target}`), ['media_player.unjoin ' + other, 'music_assistant.transfer_queue ' + other]);
  off();
});

test('Resume on a TV that sits on its home screen: the song at once, as music, never the screen', async () => {
  const id = 'media_player.tvr', p = { entity: id, ma: id + '_ma', power: id + '_remote', name: 'TV' }, t = realNow();
  ST.applyEntities({ a: { [p.ma]: { s: 'idle', a: { active_queue: 'qr', media_title: 'A', media_artist: 'One', media_content_type: 'music', supported_features: FEATURES, group_members: [], media_position_updated_at: new Date(t).toISOString() }, lc: t / 1000 },
    [p.power]: { s: 'on', a: {}, lc: t / 1000 } } });
  const S = session(p), off = S.on(() => {});
  const a = item('a', 'A'), q = queues.filter((x) => x.id === 'qr' && x.on)[0];
  q.fn(word(a, [a]), false);
  assert.deepEqual([S.snap.n.title, S.snap.n.stopped, S.snap.musicOn], ['A', true, null], 'paused: the song, and no bar');
  S.resume();
  const v = S.snap;
  assert.deepEqual([v.n.title, !!v.n.target, !!v.n.starting, !!v.n.screen, v.music, !!v.musicOn], ['A', true, true, false, true, true]);
  await settle(); pass(2100); await settle();
  off();
});
