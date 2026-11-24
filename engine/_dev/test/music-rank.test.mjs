// core/rank.js: what others think of a search result, and the order the Music page lists results in.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load } from './stub.mjs';

const { rating, rank, count, interleave } = await load('core/rank.js');
const sp = (name, extra = {}) => ({ name, provider: 'spotify--abc', media_type: 'playlist', uri: 'spotify--abc://playlist/' + name, ...extra });
const sc = (name, extra = {}) => ({ name, provider: 'soundcloud', media_type: 'playlist', uri: 'soundcloud://playlist/' + name, ...extra });
const names = (l) => l.map((x) => x.name);

test('counts read short, and never round up past what is there', () => {
  assert.deepEqual([0, 842, 1000, 1999, 12345, 999999, 8124366, 2.5e9].map(count), ['0', '842', '1k', '1.9k', '12k', '999k', '8.1M', '2.5B']);
  assert.equal(count(undefined), '');
});

test('each service rates its own way', () => {
  assert.equal(rating(sp('a'), { saves: 8124366 }).text, '8.1M');
  assert.equal(rating(sp('a'), { saves: 8124366 }).kind, 'saves');
  assert.equal(rating(sc('b'), { likes: 1549, plays: 9000 }).kind, 'likes');
  assert.match(rating(sc('b'), { likes: 1549, plays: 9000 }).title, /9,000 plays/);
  const song = { name: 's', provider: 'spotify--abc', media_type: 'track', metadata: { popularity: 54 } };
  assert.deepEqual([rating(song, null).kind, rating(song, null).n], ['pop', 54]);
  assert.equal(rating(sp('none'), {}), null);
  assert.equal(rating({ ...song, metadata: {} }, null), null);
});

test('most liked first within each service, then the services take turns', () => {
  const nums = { 'spotify--abc://playlist/s1': { saves: 10 }, 'spotify--abc://playlist/s2': { saves: 5000 }, 'spotify--abc://playlist/s3': { saves: 300 },
    'soundcloud://playlist/c1': { likes: 2 }, 'soundcloud://playlist/c2': { likes: 90 } };
  const list = [sp('s1'), sc('c1'), sp('s2'), sc('c2'), sp('s3')];
  assert.deepEqual(names(rank(list, (it) => nums[it.uri])), ['s2', 'c2', 's3', 'c1', 's1']);
});

test("Spotify's own playlists lead Spotify's; items without a number keep their order after the rated ones", () => {
  const nums = { 'spotify--abc://playlist/rated': { saves: 1 } };
  const list = [sp('plain1'), sp('rated'), sp('mine', { owner: 'Spotify' }), sp('plain2')];
  assert.deepEqual(names(rank(list, (it) => nums[it.uri])), ['mine', 'rated', 'plain1', 'plain2']);
  // one of Spotify's own that does have saves is ranked by them like any other
  const n2 = { 'spotify--abc://playlist/big': { saves: 9000 }, 'spotify--abc://playlist/mine': { saves: 3 } };
  assert.deepEqual(names(rank([sp('mine', { owner: 'Spotify' }), sp('big')], (it) => n2[it.uri])), ['big', 'mine']);
});

test('with no numbers at all the order is the services taking turns, each in its own order', () => {
  assert.deepEqual(names(rank([sp('a'), sp('b'), sc('x'), sp('c')])), ['a', 'x', 'b', 'c']);
  assert.deepEqual(interleave([[1, 2, 3], [9]]), [1, 9, 2, 3]);
});
