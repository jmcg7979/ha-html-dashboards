// The shared weather loaders: core/forecast.js (one list per entity and type, HA first, weather.gov as the fallback) and
// core/current.js (the browser's own feeds for "now", running only while a card needs them). HA, the location and the
// network are doubles; a test says what each of them answers.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load, override } from './stub.mjs';

const ha = { up: true, answer: () => Promise.reject(new Error('no answer')), asked: 0, ids: [] };
override('core/ha.js', { connected: () => ha.up, onReady: () => {}, request: (msg) => { ha.asked++; ha.ids.push(msg.target && msg.target.entity_id); return ha.answer(msg); } });
override('core/location.js', { where: () => Promise.resolve({ lat: 1, lon: 2 }) });
const net = { urls: [], answer: () => null };   // answer(url) -> the JSON to give, or null for a failed request
globalThis.fetch = (url) => { net.urls.push(String(url)); const j = net.answer(String(url)); return j ? Promise.resolve({ ok: true, json: async () => j }) : Promise.reject(new Error('offline')); };

const F = await load('core/forecast.js'), C = await load('core/current.js'), S = await load('core/store.js'), { capture } = await load('core/scope.js');
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
const haList = (entity, list) => () => Promise.resolve({ response: { [entity]: { forecast: list } } });
const MIN = 60e3;

test('forecast: one card failing does not cost the others HA\'s list, and the fallback is not asked', async () => {
  const list = [{ datetime: new Date().toISOString(), temperature: 60 }];
  ha.answer = haList('weather.a', list); net.urls.length = 0;
  const got = []; const errors = console.error; console.error = () => {};
  F.forecast('weather.a', 'hourly', () => { throw new Error('a card that breaks'); }, {});
  F.forecast('weather.a', 'hourly', (l, meta) => got.push([l, meta]), {});
  await settle(); console.error = errors;
  assert.deepEqual(got, [[list, null]]);
  assert.deepEqual(net.urls, [], 'weather.gov was not needed');
});

test('forecast: HA and weather.gov both down with nothing to show: the card is told, weather.gov is asked once, the next try is two minutes on', async () => {
  ha.answer = () => Promise.reject(new Error('down')); net.answer = () => null; net.urls.length = 0;
  const got = [];
  F.forecast('weather.b', 'hourly', (l, meta) => got.push([l, meta]), {});
  await settle();
  assert.deepEqual(got, [[[], { failed: true, updated: null }]]);
  assert.equal(net.urls.length, 1);
  assert.equal(F.viaLine(got[0][1]), 'The forecast didn’t load');
  const asked = ha.asked;
  F.refresh(Date.now() + 1 * MIN); await settle(); assert.equal(ha.asked, asked, 'not yet');
  const list = [{ datetime: new Date().toISOString(), temperature: 61 }]; ha.answer = haList('weather.b', list);
  F.refresh(Date.now() + 2 * MIN + 1000); await settle();
  assert.deepEqual(got[1], [list, null]);
});

test('forecast: a list that can no longer be refreshed comes again, marked with its age', async () => {
  const list = [{ datetime: new Date().toISOString(), temperature: 62 }]; ha.answer = haList('weather.c', list);
  const got = [];
  F.forecast('weather.c', 'daily', (l, meta) => got.push([l, meta]));
  await settle();
  ha.answer = () => Promise.reject(new Error('down'));
  F.refresh(Date.now() + 31 * MIN); await settle();
  assert.equal(got.length, 2); assert.equal(got[1][0], list); assert.equal(got[1][1].failed, true); assert.ok(got[1][1].updated instanceof Date);
  assert.match(F.viaLine(got[1][1]), /^Forecast not updating · from /);
});

test('forecast: a refresh that falls due while the page is hidden or HA is away is made when the page is shown again; a forecast nobody shows is not fetched', async () => {
  const list = [{ datetime: new Date().toISOString(), temperature: 63 }]; ha.answer = haList('weather.d', list);
  let calls = 0; const scope = capture(() => F.forecast('weather.d', 'hourly', () => { calls++; }));
  await settle(); assert.equal(calls, 1);
  const real = Date.now; Date.now = () => real() + 45 * MIN;
  try {
    document.hidden = true; F.refresh(); await settle(); assert.equal(calls, 1, 'hidden: nothing is fetched');
    document.hidden = false; ha.up = false; F.refresh(); await settle(); assert.equal(calls, 1, 'not connected: nothing is fetched');
    ha.up = true; document.dispatchEvent({ type: 'visibilitychange' }); await settle(); assert.equal(calls, 2, 'shown again: made up at once');
    scope.dispose(); ha.ids.length = 0;
    Date.now = () => real() + 120 * MIN; F.refresh(); await settle();
    assert.equal(ha.ids.includes('weather.d'), false, 'the card is gone: no fetch'); assert.equal(ha.ids.includes('weather.a'), true, 'the ones still shown are'); assert.equal(calls, 2);
  } finally { Date.now = real; document.hidden = false; }
});

test('current: the weather package sensor is the reading; without it the weather entity; nothing reporting is null', () => {
  const seen = [];
  S.applyEntities({ a: { 'sensor.out': { s: '51', a: { source: 'metar', observed: '2026-11-14T10:00:00Z', condition: 'cloudy', humidity: 40 }, lc: 1 }, 'weather.x': { s: 'sunny', a: { temperature: 49 }, lc: 2, lu: 2 } } });
  const c = capture(() => C.current({ ha: 'sensor.out', entity: 'weather.x', iem: { name: 'Local airport' } }, (x) => seen.push(x)));
  assert.equal(seen.at(-1).temperature, 51); assert.equal(seen.at(-1).label, 'Local airport'); assert.equal(seen.at(-1).time, Date.parse('2026-11-14T10:00:00Z'));
  assert.equal(C.fromSensor({ state: 'unavailable', attributes: {} }), null);
  assert.equal(C.fromWeather({ state: 'sunny', attributes: { temperature: 49 }, lu: 2 }).temperature, 49);
  assert.equal(C.fromWeather({ state: 'unavailable', attributes: {} }), null);
  assert.equal(C.fromWeather(null), null);
  c.dispose();
});
