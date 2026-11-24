// The month view: where a week starts and which day the grid opens on.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load } from './stub.mjs';
const { localeWeekStart, dayNames, gridStart } = await load('cards/month.js');
const { nwsCondition } = await load('core/forecast.js');

test('a week starts where the language says: Sunday in the US, Monday in Germany', () => {
  assert.equal(localeWeekStart('en-US'), 0);
  assert.equal(localeWeekStart('de-DE'), 1);
  assert.equal(localeWeekStart('not a language'), 0);
});
test('day names start on the first day of the week', () => {
  assert.deepEqual(dayNames(0, 'en-US'), ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  assert.equal(dayNames(1, 'en-US')[0], 'Mon');
});
test('the grid opens on the start of the week the 1st falls in', () => {
  const nov = new Date(2026, 10, 14);   // 1 November 2026 is a Sunday
  assert.equal(gridStart(nov, 0).toDateString(), new Date(2026, 10, 1).toDateString());
  assert.equal(gridStart(nov, 1).toDateString(), new Date(2026, 9, 26).toDateString());
});
test('weather.gov icon codes are grouped as Home Assistant groups them', () => {
  const c = (code, day = true) => nwsCondition(`https://api.weather.gov/icons/land/${day ? 'day' : 'night'}/${code}?size=medium`, day);
  assert.deepEqual(['skc', 'few', 'sct', 'bkn', 'ovc'].map((x) => c(x)), ['sunny', 'partlycloudy', 'partlycloudy', 'cloudy', 'cloudy']);
  assert.equal(c('skc', false), 'clear-night');
  assert.deepEqual(['fzra', 'sleet', 'rain_sleet', 'wind_bkn', 'wind_few'].map((x) => c(x)), ['snowy-rainy', 'snowy', 'snowy-rainy', 'windy-variant', 'windy']);
});
