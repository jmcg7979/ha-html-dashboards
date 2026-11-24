// core/trend.js: readings (a state holds until the next one) into the buckets the history pop-up draws, and several
// entities summed into one series.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load } from './stub.mjs';

const { bucket, sumRaw } = await load('core/trend.js');

test('bucket: a time-weighted mean with the low and high of each bucket', () => {
  // 10 until t=5, then 30: the first bucket (0-10) is half and half, the second holds 30
  const out = bucket([[0, 10], [5, 30]], 0, 20, 2);
  assert.deepEqual(out, [{ t: 5, mean: 20, lo: 10, hi: 30 }, { t: 15, mean: 30, lo: 30, hi: 30 }]);
});

test('bucket: the reading before the period holds into it; a short spike counts in the high, hardly in the mean', () => {
  const out = bucket([[-100, 4], [50, 100], [51, 4]], 0, 100, 1);
  assert.equal(out[0].lo, 4); assert.equal(out[0].hi, 100);
  assert.ok(Math.abs(out[0].mean - 4.96) < 1e-9, String(out[0].mean));
});

test('bucket: no reading yet, or a stretch of "no value", is a bucket with no mean', () => {
  assert.deepEqual(bucket([], 0, 10, 2).map((b) => b.mean), [null, null]);
  // nothing before t=10; unavailable (null) from 20 to 30
  const out = bucket([[10, 5], [20, null], [30, 7]], 0, 40, 4);
  assert.deepEqual(out.map((b) => b.mean), [null, 5, null, 7]);
  assert.deepEqual(out.map((b) => b.t), [5, 15, 25, 35]);
});

test('bucket: a period that ends inside the last bucket counts only up to its end', () => {
  const out = bucket([[0, 2], [8, 10]], 0, 10, 1);
  assert.equal(out[0].mean, (2 * 8 + 10 * 2) / 10);
});

test('sumRaw: one list is itself; several are summed at every change, once each has a reading', () => {
  const a = [[0, 1], [10, 2]];
  assert.equal(sumRaw([a]), a);
  assert.deepEqual(sumRaw([[[0, 1], [10, 2]], [[5, 10], [15, 20]]]), [[5, 11], [10, 12], [15, 22]]);
});

test('sumRaw: while one of them has no value, the sum has none', () => {
  assert.deepEqual(sumRaw([[[0, 1]], [[0, 5], [3, null], [6, 5]]]), [[0, 6], [3, null], [6, 6]]);
});
