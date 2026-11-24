// cards/camera-wall.js pack(): rows of camera tiles, each at its own shape, that fill a box.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load } from './stub.mjs';

const { pack } = await load('cards/camera-wall.js');
const near = (a, b, what) => assert.ok(Math.abs(a - b) < 0.01, `${what}: ${a} is not ${b}`);
// every tile of a packing, as { i, w, h }
const tiles = (R, p) => p.rows.flatMap((row, k) => row.map((i) => ({ i, w: p.h[k] * R[i], h: p.h[k] })));

test('one camera fills the width, or the height when the box is flatter than the picture', () => {
  const wide = pack([16 / 9], 1600, 2000, 8); assert.deepEqual(wide.rows, [[0]]); near(wide.h[0], 900, 'height'); near(wide.w[0], 1600, 'width');
  const flat = pack([16 / 9], 1600, 450, 8); near(flat.h[0], 450, 'height'); near(flat.w[0], 800, 'width');
});

test('six cameras of mixed shapes: order kept, everything inside the box, shapes kept', () => {
  const R = [8 / 3, 4 / 3, 16 / 9, 16 / 9, 16 / 9, 16 / 9];
  for (const [W, H] of [[960, 540], [1280, 800], [412, 2000], [1000, 700]]) {
    const p = pack(R, W, H, 8);
    assert.deepEqual(p.rows.flat(), [0, 1, 2, 3, 4, 5], `${W}x${H}: reading order`);
    const total = p.h.reduce((a, b) => a + b, 0) + 8 * (p.rows.length - 1);
    assert.ok(total <= H + 0.01, `${W}x${H}: ${total} high`);
    p.w.forEach((w, k) => assert.ok(w <= W + 0.01, `${W}x${H}: row ${k} is ${w} wide`));
    tiles(R, p).forEach((t) => near(t.w / t.h, R[t.i], `${W}x${H}: shape of tile ${t.i}`));
  }
});

test('rows that are not limited by the height use the full width', () => {
  const p = pack([16 / 9, 16 / 9, 16 / 9, 16 / 9], 1000, 5000, 10);
  p.w.forEach((w) => near(w, 1000, 'row width'));
});

test('maxRows limits the rows; equal cameras come out the same size', () => {
  const R = Array(6).fill(16 / 9);
  assert.ok(pack(R, 400, 3000, 8, 2).rows.length <= 2);
  assert.equal(pack(R, 400, 3000, 8, 6).rows.length, 6, 'a tall narrow box: one camera per row when allowed');
  const p = pack(R, 1280, 720, 8); assert.deepEqual(p.rows.map((r) => r.length), [3, 3]);
  const sizes = tiles(R, p).map((t) => Math.round(t.w)); assert.equal(new Set(sizes).size, 1);
});

test('the smallest tile is as large as it can be', () => {
  // two wide pictures and a tall box: stacked beats side by side
  assert.deepEqual(pack([16 / 9, 16 / 9], 800, 1000, 8).rows, [[0], [1]]);
  // a wide flat box: side by side beats stacked
  assert.deepEqual(pack([16 / 9, 16 / 9], 1600, 400, 8).rows, [[0, 1]]);
});

test('no cameras', () => {
  const p = pack([], 1000, 600, 8);
  assert.ok(p, 'a packing with no rows'); assert.deepEqual(p.rows, []);
});
