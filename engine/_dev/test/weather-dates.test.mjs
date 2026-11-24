// Reading a forecast list by date (core/forecast.js): which entry is today's, which days are over, what a period is called.
// The answers depend on the screen's time zone, so the whole file runs once per zone below, each in a process of its own
// with TZ set. Times are fixed: every function under test takes "now".
import test from 'node:test'; import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';

const ZONES = ['America/New_York', 'Europe/Berlin', 'Pacific/Auckland'];   // west of UTC, east of it, and a day ahead of it
if (!process.env.WX_ZONE) {
  for (const TZ of ZONES) test(`forecast dates with the clock in ${TZ}`, () => {
    const env = { ...process.env, TZ, WX_ZONE: TZ }; delete env.NODE_TEST_CONTEXT;   // the child reports as a plain run
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
} else {
  const { load } = await import('./stub.mjs');
  const W = await load('core/forecast.js');
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // a local time written the way NWS stamps a period: with the zone's own offset
  const iso = (d) => { const o = -d.getTimezoneOffset(), a = Math.abs(o); return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${o < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`; };
  const at = (day, h, m = 0) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
  const plus = (day, n) => new Date(day.getFullYear(), day.getMonth(), day.getDate() + n);
  // A twice-daily list as NWS gives it: periods change at 6:00 and 18:00; the first one starts at `from` (any time).
  // Day periods are 60 + their day's number after `day0`, night periods 40 + it, so a figure says which day it is from.
  function twice(day0, from, count) {
    const out = []; let t = from;
    while (out.length < count) {
      const h = t.getHours(), isDay = h >= 6 && h < 18, n = Math.round((plus(t, 0) - day0) / 864e5);
      out.push({ datetime: iso(t), is_daytime: isDay, temperature: (isDay ? 60 : 40) + n, condition: isDay ? 'sunny' : 'clear-night', precipitation_probability: 10 * (out.length % 3), detailed_description: `${isDay ? 'day' : 'night'} ${n}` });
      t = isDay ? at(t, 18) : h < 6 ? at(t, 6) : at(plus(t, 1), 6);
    }
    return out;
  }
  // an ordinary day, and the days the clocks change in the United States and in Europe (an ordinary day in the other zones)
  const DAYS = { ordinary: new Date(2026, 10, 13), 'US spring': new Date(2026, 2, 8), 'US autumn': new Date(2026, 10, 1), 'EU spring': new Date(2026, 2, 29), 'EU autumn': new Date(2026, 9, 25) };

  for (const [name, D] of Object.entries(DAYS)) {
    test(`${name}: in the morning, today's high and tonight's low`, () => {
      const list = twice(D, at(D, 6), 14);
      assert.deepEqual(W.todayHiLo(list, at(D, 10)), { hi: 60, lo: 40 });
      assert.deepEqual(W.running(list, +at(D, 10)).slice(0, 2).map((p) => W.periodName(p, at(D, 10))), ['Today', 'Tonight']);
    });
    test(`${name}: in the evening the list starts with tonight; tomorrow's high is not today's`, () => {
      const list = twice(D, at(D, 18), 14), now = at(D, 20);
      assert.equal(list[1].temperature, 61, 'the first daytime entry is tomorrow');
      assert.deepEqual(W.todayHiLo(list, now), { hi: null, lo: 40 });
      const run = W.running(list, +now);
      assert.deepEqual([W.periodName(run[0], now), W.periodName(run[1], now), W.periodName(run[2], now)], ['Tonight', 'Tomorrow', 'Tomorrow night']);
    });
    test(`${name}: after midnight the day ahead is Today, with its own high`, () => {
      const T = plus(D, 1), now = at(T, 1, 30), fresh = twice(D, at(T, 1), 14);   // [overnight, today, tonight, …]
      assert.deepEqual(W.todayHiLo(fresh, now), { hi: 61, lo: 41 });
      assert.deepEqual(fresh.slice(0, 3).map((p) => W.periodName(p, now)), ['Overnight', 'Today', 'Tonight']);
      const kept = twice(D, at(D, 18), 14);   // last evening's list, not refreshed since
      assert.deepEqual(W.todayHiLo(kept, now), { hi: 61, lo: 41 });
      const run = W.running(kept, +now);
      assert.equal(run[0].temperature, 40, "last night's period is still running"); assert.equal(W.periodName(run[1], now), 'Today');
    });
    test(`${name}: a list two days old is read by date, and one that is over gives nothing`, () => {
      const list = twice(plus(D, -2), at(plus(D, -2), 6), 14), now = at(D, 10);
      assert.deepEqual(W.todayHiLo(list, now), { hi: 62, lo: 42 });
      const days = W.byDay(list), ahead = W.fromToday(days, now);
      assert.equal(W.dayLabel(days[0].date, now) === 'Today', false, 'the first row of an old list is not today');
      assert.equal(ahead.length, days.length - 2); assert.equal(W.dayLabel(ahead[0].date, now), 'Today'); assert.equal(ahead[0].hi, 62);
      assert.equal(W.running(list, +now)[0].temperature, 62, 'the period running now, not the first of the list');
      const later = at(plus(D, 9), 10);
      assert.deepEqual(W.todayHiLo(list, later), { hi: null, lo: null }); assert.deepEqual(W.fromToday(days, later), []); assert.deepEqual(W.running(list, +later), []);
    });
    test(`${name}: eight days in a row, each with its high and low, across the clock change`, () => {
      const days = W.byDay(twice(plus(D, -3), at(plus(D, -3), 6), 16));
      assert.deepEqual(days.map((d) => ymd(d.date)), Array.from({ length: 8 }, (x, i) => ymd(plus(D, i - 3))));
      assert.deepEqual(days.map((d) => [d.hi, d.lo]), Array.from({ length: 8 }, (x, i) => [60 + i, 40 + i]));
      assert.deepEqual(days.map((d) => W.dayLabel(d.date, at(D, 12))).map((l) => l === 'Today'), [false, false, false, true, false, false, false, false]);
    });
    // a daily forecast, one entry per day, stamped the four ways sources do it
    const STAMPS = { 'a date only': (d) => ymd(d), 'that date at midnight UTC': (d) => ymd(d) + 'T00:00:00+00:00', 'the same with Z': (d) => ymd(d) + 'T00:00:00Z',
      'local noon': (d) => iso(at(d, 12)), 'local midnight written in UTC': (d) => at(d, 0).toISOString() };
    for (const [how, stamp] of Object.entries(STAMPS)) test(`${name}: a daily list stamped with ${how} is filed under its own day`, () => {
      const list = Array.from({ length: 5 }, (x, i) => ({ datetime: stamp(plus(D, i)), temperature: 70 + i, templow: 50 + i, condition: 'cloudy' }));
      const days = W.byDay(list);
      assert.deepEqual(days.map((d) => ymd(d.date)), Array.from({ length: 5 }, (x, i) => ymd(plus(D, i))));
      for (const h of [1, 5, 7, 13, 20, 23]) assert.deepEqual(W.todayHiLo(list, at(D, h, 30)), { hi: 70, lo: 50 }, `at ${h}:30`);
      assert.deepEqual(W.todayHiLo(list, at(plus(D, 1), 0, 10)), { hi: 71, lo: 51 }, 'ten past midnight it is the next entry');
      assert.equal(W.fromToday(days, at(plus(D, 2), 9)).length, 3);
    });
  }

  test('a night period stamped at midnight UTC is a time, not a date', () => {
    const p = { datetime: '2026-11-14T00:00:00+00:00', is_daytime: false };
    assert.equal(+W.stampDate(p), Date.parse(p.datetime));
  });
  test('running: nothing, one period, a period that has not started', () => {
    const D = DAYS.ordinary;
    assert.deepEqual(W.running([], +at(D, 10)), []);
    const one = twice(D, at(D, 18), 1);
    assert.equal(W.running(one, +at(D, 12)).length, 1, 'not started yet'); assert.equal(W.running(one, +at(D, 23)).length, 1);
    assert.equal(W.running(one, +at(plus(D, 1), 7)).length, 0, 'the last period is over 12 hours after it began');
  });
  test('periodName: later days by their weekday', () => {
    const D = DAYS.ordinary, list = twice(D, at(D, 6), 8), now = at(D, 10);
    assert.equal(W.periodName(list[4], now), at(plus(D, 2), 6).toLocaleDateString([], { weekday: 'long' }));
    assert.match(W.periodName(list[5], now), / night$/);
  });
  test('the source line says when, with the day once it is not today', () => {
    const D = DAYS.ordinary, now = at(D, 15);
    assert.equal(W.viaLine(null, now), '');
    assert.match(W.viaLine({ source: 'weather.gov', updated: at(D, 14, 5) }, now), /^weather\.gov direct .* · 2:05\sPM$/);
    assert.match(W.viaLine({ failed: true, updated: at(D, 9, 30) }, now), /^Forecast not updating · from 9:30\sAM$/);
    assert.match(W.viaLine({ failed: true, updated: at(plus(D, -1), 21, 30) }, now), /^Forecast not updating · from Thu 9:30\sPM$/);
    assert.match(W.viaLine({ failed: true, updated: at(plus(D, -20), 21, 30) }, now), /from Oct 24 9:30\sPM$/);
    assert.equal(W.viaLine({ failed: true, updated: null }, now), 'The forecast didn’t load');
  });
}
