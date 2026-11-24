// The queue as the music cards read it: core/ma.js keeps a part of Music Assistant's queue around the current song
// (windowFor, itemAt, indexOf, totalOf, listAround), lays our unconfirmed changes over it (withEdits) and applies MA's
// events (onEvent); core/session.js says what the queue's numbers mean (currentOf, atEnd, queuePos, queueSays, moveAfter).
import test from 'node:test'; import assert from 'node:assert/strict';
import { load } from './stub.mjs';

const MA = await load('core/ma.js'), SE = await load('core/session.js');
const song = (i) => ({ queue_item_id: 'q' + i, name: 'Song ' + i });
// a queue of `total` songs of which those from `offset` on are held, playing number `at`
const held = (total, offset, n, at) => ({ queue: { items: total, current_index: at }, items: Array.from({ length: n }, (_, i) => song(offset + i)), offset });

test('the part of a queue that is fetched: 20 songs back, 200 ahead, inside the queue', () => {
  assert.deepEqual(MA.windowFor(0, 50), { offset: 0, limit: 50 });
  assert.deepEqual(MA.windowFor(300, 1000), { offset: 280, limit: 221 });
  assert.deepEqual(MA.windowFor(995, 1000), { offset: 975, limit: 25 });
  assert.deepEqual(MA.windowFor(undefined, 0), { offset: 0, limit: 201 }, 'a queue that says nothing yet');
  assert.equal(MA.windowFor(30, 3).limit, 1, 'never an empty ask (a song number past a queue that just shrank)');
});

test('a song is found by its number in the whole queue, wherever the held part starts (song 300 of 1000)', () => {
  const d = held(1000, 280, 221, 300);
  assert.equal(MA.itemAt(d, 300).queue_item_id, 'q300');
  assert.equal(MA.itemAt(d, 279), undefined, 'before the part held'); assert.equal(MA.itemAt(d, 501), undefined, 'after it');
  assert.equal(MA.indexOf(d, 'q301'), 301); assert.equal(MA.indexOf(d, 'nope'), -1);
  assert.equal(MA.totalOf(d), 1000);
  assert.equal(MA.totalOf({ items: [song(0), song(1)], offset: 0 }), 2, "MA's count missing: what is held");
  assert.equal(SE.currentOf(d).queue_item_id, 'q300');
  assert.equal(SE.currentOf({ ...d, queue: { ...d.queue, current_item: song(7) } }).queue_item_id, 'q7', "MA's own word first");
  assert.equal(SE.currentOf(null), null);
});

test('the list around the current song: numbers of the whole queue, the count of what is left, what is not listed', () => {
  const L = MA.listAround(held(1000, 280, 221, 300), 300, 20, 40);
  assert.deepEqual([L.past.length, L.past[0].ix, L.past.at(-1).ix], [20, 280, 299]);
  assert.deepEqual([L.now.ix, L.now.it.queue_item_id], [300, 'q300']);
  assert.deepEqual([L.up.length, L.up[0].ix, L.up.at(-1).it.queue_item_id], [40, 301, 'q340']);
  assert.equal(L.left, 699); assert.equal(L.more, 659);
  const short = MA.listAround(held(3, 0, 3, 2), 2, 20, 40);
  assert.deepEqual([short.past.length, short.up.length, short.left, short.more], [2, 0, 0, 0]);
  const early = MA.listAround(held(1000, 280, 221, 300), 100, 20, 40);   // a skip's target outside the part held, for a moment
  assert.deepEqual([early.past.length, early.now, early.up.length], [0, null, 0]);
});

test('the part held is enough while the current song is in it with 100 more after it, or the queue ends there', () => {
  const d = held(1000, 280, 221, 300);
  assert.equal(MA.holds(d, 300), true); assert.equal(MA.holds(d, 400), true); assert.equal(MA.holds(d, 401), false);
  assert.equal(MA.holds(d, 279), false); assert.equal(MA.holds(d, 501), false);
  assert.equal(MA.holds(held(30, 0, 30, 5), 29), true, 'the last song of a short queue');
  assert.equal(MA.holds(null, 0), false); assert.equal(MA.holds({ items: [], offset: 0 }, 0), false);
});

test("MA's time stamp is moved onto this screen's clock", () => {
  const Q = { elapsed_time: 30, elapsed_time_last_updated: 1000 };
  assert.equal(MA.localStamp(Q, 2).elapsed_time_last_updated, 998, 'a server 2 s ahead: the stamp is 2 s earlier here');
  assert.equal(MA.localStamp(Q, -1.5).elapsed_time_last_updated, 1001.5);
  assert.equal(MA.localStamp(Q, 0), Q, 'no difference known: as it came'); assert.equal(MA.localStamp(null, 2), null);
  assert.equal(Q.elapsed_time_last_updated, 1000, 'not changed in place');
  // with it the song's clock reads the same on a screen whose clock is 2 s behind the server's
  assert.equal(SE.queuePos(MA.localStamp(Q, 2), { state: 'playing', a: { media_duration: 200 } }, 1008), 40);
});

test('our changes lie over what MA sends until MA has them', () => {
  const c = held(5, 0, 5, 0), ids = (x) => x.items.map((i) => i.queue_item_id).join(' ');
  assert.equal(MA.withEdits(c, []), c);
  assert.equal(MA.withEdits(c, [{ set: { autoplay_enabled: true } }]).queue.autoplay_enabled, true);
  assert.equal(ids(MA.withEdits(c, [{ move: 'q1', after: 'q3' }])), 'q0 q2 q3 q1 q4');
  assert.equal(ids(MA.withEdits(c, [{ move: 'q4', after: null }])), 'q4 q0 q1 q2 q3');
  assert.equal(ids(MA.withEdits(c, [{ move: 'gone', after: 'q3' }, { move: 'q1', after: 'gone' }])), 'q0 q1 q2 q3 q4', 'a song MA no longer has changes nothing');
  const done = MA.withEdits(c, [{ move: 'q1', after: 'q3' }]);
  assert.equal(ids(MA.withEdits(done, [{ move: 'q1', after: 'q3' }])), ids(done), 'nothing more once MA has it there');
  assert.equal(SE.moveAfter(c.items, 'q1', 2), 'q3'); assert.equal(SE.moveAfter(c.items, 'q3', -3), null); assert.equal(SE.moveAfter(c.items, 'x', 1), undefined);
  assert.equal(SE.moveAfter(c.items, 'q3', 9), 'q4', 'past the end: last');
});

test("MA's events: a new song reloads the songs, the clock ticks on this screen's time, a list change reloads", () => {
  const c = held(10, 0, 10, 2);
  let r = MA.onEvent(c, { event: 'queue_updated', data: { items: 10, current_index: 3 } }, 50);
  assert.deepEqual([r.emit, r.refresh, r.c.queue.current_index, r.c.items.length], [true, false, 3, 10], 'the next song of a queue held whole: nothing to read');
  const long = held(1000, 280, 221, 300), at = (i) => MA.onEvent(long, { event: 'queue_updated', data: { items: 1000, current_index: i } }, 50).refresh;
  assert.deepEqual([at(301), at(400), at(401), at(279), at(700)], [false, false, true, true, true], 'read again once fewer than 100 songs are held ahead, or the song is outside the part held');
  r = MA.onEvent(c, { event: 'queue_updated', data: { items: 10, current_index: 2, shuffle_enabled: true } }, 50);
  assert.deepEqual([r.emit, r.refresh], [true, false], 'the same song: nothing is fetched again');
  r = MA.onEvent(c, { event: 'queue_time_updated', data: 42 }, 50);
  assert.deepEqual([r.c.queue.elapsed_time, r.c.queue.elapsed_time_last_updated, r.emit], [42, 50, true]);
  assert.equal(c.queue.elapsed_time, undefined, 'what a card holds is not changed in place');
  assert.deepEqual(MA.onEvent(c, { event: 'queue_items_updated' }, 50), { c, refresh: true });
  assert.equal(MA.onEvent(undefined, { event: 'queue_time_updated', data: 1 }, 50).emit, undefined, 'a tick for a queue not read yet');
  assert.equal(MA.onEvent(undefined, { event: 'queue_updated', data: { current_index: 0 } }, 50).refresh, true);
});

test('Next has nowhere to go only on the last song with nothing to follow', () => {
  const q = (o) => ({ queue: { items: 3, repeat_mode: 'off', ...o } });
  assert.equal(SE.atEnd(q({}), 2), true); assert.equal(SE.atEnd(q({}), 1), false);
  assert.equal(SE.atEnd(q({ repeat_mode: 'all' }), 2), false); assert.equal(SE.atEnd(q({ is_dynamic: true }), 2), false); assert.equal(SE.atEnd(q({ autoplay_enabled: true }), 2), false);
  assert.equal(SE.atEnd(null, 0), false); assert.equal(SE.atEnd({ queue: { items: 0 } }, 0), false);
});

test("the song's clock: MA's last word plus the time since, while it plays, never past the song's end", () => {
  const Q = { elapsed_time: 30, elapsed_time_last_updated: 100 }, n = (state, d) => ({ state, a: { media_duration: d } });
  assert.equal(SE.queuePos(Q, n('playing', 200), 112), 42);
  assert.equal(SE.queuePos(Q, n('paused', 200), 112), 30);
  assert.equal(SE.queuePos(Q, n('playing', 35), 112), 35);
  assert.equal(SE.queuePos({}, n('playing', 200), 112), null); assert.equal(SE.queuePos(null, null, 1), null);
});

test("what a word from MA's queue means for the song change on screen", () => {
  const it = (i) => song(i), yes = () => true, no = () => false;
  assert.equal(SE.queueSays({ from: 2 }, it(1), 1, 'q2', yes), 'target', 'our Previous learns where it went');
  assert.equal(SE.queueSays({ from: 2 }, it(2), 2, 'q2', yes), null, 'not yet moved');
  assert.equal(SE.queueSays({ soft: true, title: 'x', qid: 'q3' }, it(4), 4, 'q3', yes), 'retarget');
  assert.equal(SE.queueSays({ title: 'x', qid: 'q3' }, it(4), 4, 'q2', yes), 'verify', 'our skip, the queue elsewhere');
  assert.equal(SE.queueSays({ title: 'x', qid: 'q3' }, it(3), 3, 'q2', yes), null, 'our skip, the queue agrees');
  assert.equal(SE.queueSays(null, it(3), 3, 'q2', yes), 'soft', 'a change from elsewhere');
  assert.equal(SE.queueSays(null, it(3), 3, 'q2', no), null, 'MA not playing here, or paused');
  assert.equal(SE.queueSays(null, it(3), 3, 'q3', yes), null); assert.equal(SE.queueSays(null, it(3), 3, null, yes), null, 'the first word');
});
