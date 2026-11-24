// core/format.js (sizes, rates) and core/time.js lengthWord: numbers as text.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load } from './stub.mjs';

const F = await load('core/format.js'), { lengthWord } = await load('core/time.js');

test('sizes and rates: no reading is a dash, never 0', () => {
  for (const f of [F.gb, F.mb, F.mbit, F.fmt1]) assert.equal(f(NaN), '–');
  assert.equal(F.gb(0.5), '0.5 GB'); assert.equal(F.gb(12.4), '12 GB'); assert.equal(F.gb(1536), '1.5 TB');
  assert.equal(F.mb(512.4), '512 MB'); assert.equal(F.mb(1500), '1.5 GB');
  assert.equal(F.mbit(0.44), '0.4 Mbit/s'); assert.equal(F.mbit(12.4), '12 Mbit/s'); assert.equal(F.mbit(940.2), '940 Mbit/s');
  assert.equal(F.fmt1(4.25), '4.3'); assert.equal(F.fmt1(42.4), '42');
});

test('decimal and binary sizes, and what follows a number', () => {
  assert.equal(F.gbDec(301.11), '301 GB'); assert.equal(F.gbDec(2250), '2.25 TB'); assert.equal(F.gbDec(NaN), '–');
  assert.equal(F.mibGb(4941.9), '4.8'); assert.equal(F.mibGb(NaN), '–'); assert.equal(19081.9 * F.MIB_GB > 18.6, true);
  assert.equal(F.unitTag('%'), '%'); assert.equal(F.unitTag('°'), '°'); assert.equal(F.unitTag('°F'), '°'); assert.equal(F.unitTag('°C', true), '°C');
  assert.equal(F.unitTag('Mbit/s'), ' Mbit/s'); assert.equal(F.unitTag(' ms'), ' ms'); assert.equal(F.unitTag(''), ''); assert.equal(F.unitTag(undefined), '');
});

test('a length of time in words', () => {
  assert.equal(lengthWord(45), '45 min'); assert.equal(lengthWord(59.4), '59 min'); assert.equal(lengthWord(60), '1 h'); assert.equal(lengthWord(125), '2 h 5 min');
  assert.equal(lengthWord(0.2), '1 min'); assert.equal(lengthWord(0), '1 min'); assert.equal(lengthWord(0.2, 'under 1 min'), 'under 1 min'); assert.equal(lengthWord(NaN, '–'), '–');
});
