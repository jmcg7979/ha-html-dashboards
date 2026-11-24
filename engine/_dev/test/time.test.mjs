// core/time.js: times of day, days and durations as text.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load } from './stub.mjs';

const T = await load('core/time.js');
const at = (h, m = 0, day = 14) => new Date(2026, 10, day, h, m);   // November 2026; the 1st is the day the clocks go back in the US

test('a time of day from an input_datetime: minutes, and as the clock shows it', () => {
  assert.equal(T.minutesOf('18:30:00'), 1110); assert.equal(T.minutesOf('00:00:00'), 0); assert.equal(T.minutesOf('6:05'), 365);
  for (const x of [null, undefined, '', 'unavailable', 'unknown', '18']) { assert.equal(T.minutesOf(x), null); assert.equal(T.clockOf(x), '–'); }
  assert.equal(T.clockOf('18:30:00'), '6:30 PM'); assert.equal(T.clockOf('00:05:00'), '12:05 AM'); assert.equal(T.clockOf('12:00:00'), '12:00 PM');
});

test('a duration: milliseconds, and what is left in words', () => {
  assert.equal(T.msOf('0:45:00'), 2700e3); assert.equal(T.msOf('1:00:30'), 3630e3); assert.equal(T.msOf('45:00'), null); assert.equal(T.msOf('unavailable'), null);
  assert.equal(T.leftWord(0), ''); assert.equal(T.leftWord(-5), ''); assert.equal(T.leftWord(NaN), '');
  assert.equal(T.leftWord(1), '1 min left'); assert.equal(T.leftWord(60e3), '1 min left'); assert.equal(T.leftWord(60e3 + 1), '2 min left');
  assert.equal(T.leftWord(59 * 60e3 + 1), '1 h 00 m left'); assert.equal(T.leftWord(65 * 60e3), '1 h 05 m left');
});

test('when a time of day comes next: today while it is ahead, tomorrow from that minute on', () => {
  assert.equal(T.nextDayWord('18:30:00', false, at(18, 29)), 'Today'); assert.equal(T.nextDayWord('18:30:00', false, at(18, 30)), 'Tomorrow');
  assert.equal(T.nextDayWord('18:30:00', true, at(9)), 'Tonight'); assert.equal(T.nextDayWord('18:30:00', true, at(23)), 'Tomorrow night');
  assert.equal(T.nextDayWord('unknown', true, at(9)), '');
});

test('the day a moment falls on: by the calendar, also across midnight and a clock change', () => {
  assert.equal(T.dayWord(at(23, 59), at(0, 1)), 'Today'); assert.equal(T.dayWord(at(0, 1, 15), at(23, 59)), 'Tomorrow');
  assert.equal(T.dayWord(at(9, 0, 13), at(9)), 'Today', 'a day that has passed');
  assert.equal(T.dayWord(at(9, 0, 17), at(9)), 'Tuesday');
  assert.equal(T.dayWord(new Date(2026, 10, 1, 9), new Date(2026, 9, 31, 23)), 'Tomorrow', 'into the 25-hour day');
  assert.equal(T.dayWord(new Date(2026, 10, 2, 0, 30), new Date(2026, 10, 1, 0, 30)), 'Tomorrow', 'out of the 25-hour day');
});

test("a short weekday at the start of a text is spelled out", () => {
  assert.equal(T.weekdayOf('Wed 6:30 AM'), 'Wednesday'); assert.equal(T.weekdayOf('Sun'), 'Sunday'); assert.equal(T.weekdayOf(''), ''); assert.equal(T.weekdayOf(null), '');
});

test('how long since a moment, and until one', () => {
  const back = (s) => Date.now() - s * 1000;
  assert.equal(T.ago(back(20)), 'under 1 min'); assert.equal(T.ago(back(65)), '1 min'); assert.equal(T.ago(back(5 * 60 + 5)), '5 mins');
  assert.equal(T.ago(back(3 * 3600 + 5)), '3 hours'); assert.equal(T.ago(back(2 * 86400 + 5)), '2 days'); assert.equal(T.ago('nonsense'), '');
  assert.equal(T.ago(Date.now() + 5000), 'under 1 min', 'a moment a little ahead of this clock counts as now');
  assert.equal(T.since(back(20)), 'just now'); assert.equal(T.since(back(5 * 60 + 5)), '5 mins ago'); assert.equal(T.since('nonsense'), '');
  assert.equal(T.until(Date.now() + 5 * 60e3 + 5000), 'in 5 mins'); assert.equal(T.until(back(120)), 'due'); assert.equal(T.until('nonsense'), '');
});
