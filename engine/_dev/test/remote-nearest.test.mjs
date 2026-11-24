// core/remote/nearest.js: which rectangle an arrow key goes to.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load } from './stub.mjs';

const { nearest } = await load('core/remote/nearest.js');
const R = [1, 0], L = [-1, 0], D = [0, 1], U = [0, -1];
const box = (left, top, width = 100, height = 50) => ({ left, top, width, height, right: left + width, bottom: top + height });
// named boxes -> the name of the one chosen from `from` (null: none)
const pick = (boxes, from, d, unusable = []) => { const names = Object.keys(boxes).filter((n) => n !== from);
  const i = nearest(boxes[from], names.map((n) => boxes[n]), d, (k) => !unusable.includes(names[k])); return i < 0 ? null : names[i]; };

test('a grid: each arrow goes to the neighbor on that side', () => {
  const g = { a: box(0, 0), b: box(120, 0), c: box(240, 0), d: box(0, 70), e: box(120, 70), f: box(240, 70) };
  assert.equal(pick(g, 'e', R), 'f'); assert.equal(pick(g, 'e', L), 'd');
  assert.equal(pick(g, 'e', U), 'b'); assert.equal(pick(g, 'e', D), null);
  assert.equal(pick(g, 'a', L), null); assert.equal(pick(g, 'a', U), null);
  assert.equal(pick(g, 'a', D), 'd'); assert.equal(pick(g, 'a', R), 'b');
});

test('Left / Right stay on the row when something on it lies that way, however near another row is', () => {
  // a control row under a list: Right from `play` goes along the row to `next`, far away, not up into the list
  const g = { row1: box(130, 0, 300, 40), play: box(0, 50, 100, 40), next: box(600, 50, 100, 40) };
  assert.equal(pick(g, 'play', R), 'next');
  delete g.next;
  assert.equal(pick(g, 'play', R), 'row1');   // nothing on the row: the nearest that way
});

test('what lies behind is not chosen, but an item that overlaps a little is', () => {
  const cur = box(100, 100);   // 100 x 50: "behind" starts 25 px inside its edge
  assert.equal(pick({ cur, behind: box(0, 100, 60) }, 'cur', R), null);
  assert.equal(pick({ cur, beside: box(180, 100) }, 'cur', D), null);
  assert.equal(pick({ cur, over: box(100, 140) }, 'cur', D), 'over');   // 10 px of overlap: under half of cur's short side
  assert.equal(pick({ cur, far: box(100, 110) }, 'cur', D), null);     // 40 px of overlap: behind
});

test('Up / Down: the one straight above wins over a nearer one off to the side', () => {
  const g = { cur: box(300, 300), above: box(300, 100), side: box(450, 240) };
  assert.equal(pick(g, 'cur', U), 'above');   // the offset across counts three times the distance along
});

test('of two at the same distance, the one whose center is nearer', () => {
  const g = { cur: box(100, 100, 100, 50), wide: box(0, 200, 400, 50), under: box(90, 200, 120, 50) };
  assert.equal(pick(g, 'cur', D), 'under');
});

test('a rectangle that cannot be chosen still holds the row', () => {
  // the row rule sees the item's own container to its right; nothing else is then looked at
  const g = { cur: box(0, 0), holder: box(100, 0, 300, 50), below: box(120, 60) };
  assert.equal(pick(g, 'cur', R, ['holder']), null);
  assert.equal(pick(g, 'cur', D, ['holder']), 'below');
});

test('nothing to go to: -1', () => {
  assert.equal(nearest(box(0, 0), [], R), -1);
});
