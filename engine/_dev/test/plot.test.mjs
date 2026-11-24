// core/plot.js: the value axis every chart shares.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load } from './stub.mjs';

const { padRange, limitRange, gridRange } = await load('core/plot.js');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

test('room around the readings: 8 % each side, a least height, thresholds always inside', () => {
  let [lo, hi] = padRange(10, 20); near(lo, 9.2); near(hi, 20.8);
  [lo, hi] = padRange(15, 15, { minSpan: 4 }); near(lo, 15 - 2 - 0.32); near(hi, 15 + 2 + 0.32);
  [lo, hi] = padRange(10, 20, { lines: [50, 5] }); assert.ok(lo < 5 && hi > 50, 'a threshold above and one below are both on the chart');
});

test('a fixed floor or ceiling moves the range and keeps its height where it can', () => {
  assert.deepEqual(limitRange(-2, 8, 0), [0, 10]); assert.deepEqual(limitRange(95, 105, null, 100), [90, 100]);
  assert.deepEqual(limitRange(-5, 105, 0, 100), [0, 100], 'between both: no taller than the two allow');
  assert.deepEqual(limitRange(3, 8, 0, 100), [3, 8]); assert.deepEqual(limitRange(3, 8), [3, 8]);
});

test('gridlines: whole steps that hold the range, and the decimals their labels need', () => {
  assert.deepEqual(gridRange(9.2, 20.8, 4), { step: 5, lo: 5, hi: 25, decimals: 0 });
  const g = gridRange(0.11, 0.29, 4); near(g.step, 0.05); near(g.lo, 0.1); near(g.hi, 0.3); assert.equal(g.decimals, 2);
  const whole = gridRange(0, 40, 4); assert.deepEqual([whole.lo, whole.hi, whole.step], [0, 40, 10], 'a range already on its gridlines is not widened');
  const tiny = gridRange(0.1 + 0.2, 0.9, 3); near(tiny.lo, 0.2); assert.ok(tiny.hi >= 0.9 - 1e-9);   // 0.30000000000000004 is on the 0.2 grid's 0.2..0.4, not pushed a step down
});

test('time ticks: on round hours of the local clock, fewer when narrow, midnight named and major', async () => {
  const { timeTicks } = await load('core/plot.js');
  const start = +new Date(2026, 10, 13, 14, 37), end = start + 24 * 3600e3;
  const wide = timeTicks(start, end, 1000), narrow = timeTicks(start, end, 300);
  assert.ok(wide.length > narrow.length && narrow.length >= 3);
  for (const k of [...wide, ...narrow]) { const d = new Date(k.t); assert.equal(d.getMinutes(), 0); assert.ok(k.t >= start && k.t <= end); }
  const midnight = wide.find((k) => new Date(k.t).getHours() === 0); assert.equal(midnight.major, true); assert.equal(midnight.label, 'Sat');
  assert.deepEqual(wide.map((k) => new Date(k.t).getHours()), [16, 18, 20, 22, 0, 2, 4, 6, 8, 10, 12, 14]);
  // the day the clocks go back (1 November 2026 in the US): still one label per round local hour, none twice
  const dst = timeTicks(+new Date(2026, 9, 31, 12, 30), +new Date(2026, 10, 1, 12, 30), 1000).map((k) => new Date(k.t).getHours());
  assert.deepEqual(dst, [...new Set(dst)].length === dst.length ? dst : null, 'no hour is labeled twice');
  const week = timeTicks(start, start + 7 * 864e5, 700); assert.ok(week.every((k) => new Date(k.t).getHours() === 0), 'days at midnight for a week');
});
