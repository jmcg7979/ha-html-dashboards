// The control cards' own logic: timer rows, segment options, thermostat and slider values. The connection (core/ha.js)
// is replaced by a recorder, so nothing is sent anywhere.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load, override, frames } from './stub.mjs';

const sent = []; let accept = true;
override('core/ha.js', { call: (service, data, target, onFail) => { sent.push({ service, data, target, onFail }); return accept; } });
const S = await load('core/store.js');
const { secs, left, rowOf } = await load('cards/timer-list.js');
const { optionsOf } = await load('cards/segments.js');
const { snap, same, noSetPoint } = await load('cards/thermostat.js');
const { numberAt, MODELS } = await load('cards/tile.js');
const { stepTo } = await load('cards/stepper.js');
const set = (id, s, a) => { S.applyEntities({ a: { [id]: { s, a, lc: 1 } } }); frames.run(); };

test('timer: a length HA gives as H:MM:SS, and anything else', () => {
  assert.equal(secs('0:05:00'), 300); assert.equal(secs('1:00:01'), 3601);
  for (const bad of [undefined, null, '', 'unknown', '5:00', 'a:b:c']) assert.equal(secs(bad), null, String(bad));
});

test('timer: a row never shows a time that is not one', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  const active = { state: 'active', attributes: { duration: '0:05:00', finishes_at: '2026-01-01T12:02:05Z' } };
  assert.equal(left(active, now), 125);
  assert.deepEqual(rowOf(active, { state: 'Pasta' }, now), { paused: false, pct: (125 / 300) * 100, time: '2:05', label: 'Pasta' });
  const paused = rowOf({ state: 'paused', attributes: { duration: '0:10:00', remaining: '0:02:30' } }, { state: 'unknown' }, now);
  assert.deepEqual(paused, { paused: true, pct: 25, time: '2:30', label: 'Timer' });
  for (const a of [{}, { remaining: 'unknown' }, { finishes_at: 'never' }]) {
    const r = rowOf({ state: a.finishes_at ? 'active' : 'paused', attributes: a }, null, now);
    assert.equal(r.time, '—', JSON.stringify(a)); assert.equal(r.pct, 0); assert.equal(r.label, 'Timer');
  }
});

test('segments: the options come from the entity as it is now', () => {
  const cfg = { entity: 'select.mode', hide: ['secret'], labels: { eco: 'Saver' } };
  assert.equal(optionsOf(cfg, undefined), null, 'no entity: no list');
  assert.equal(optionsOf(cfg, { state: 'unavailable', attributes: {} }), null, 'unavailable: no list, the chips drawn stay');
  assert.deepEqual(optionsOf(cfg, { state: 'eco', attributes: { options: ['eco', 'deep_clean', 'secret', 'unknown', 5] } }),
    [{ value: 'eco', label: 'Saver' }, { value: 'deep_clean', label: 'Deep clean' }, { value: 5, label: '5' }]);
  const own = [{ value: 'a', label: 'A' }];
  assert.equal(optionsOf({ entity: 'select.mode', options: own }, undefined), own, "the config's own list wins");
  assert.deepEqual(optionsOf({ entity: 'fan.x', optionsAttr: 'preset_modes' }, { state: 'on', attributes: { preset_modes: ['low'] } }), [{ value: 'low', label: 'Low' }]);
});

test('thermostat: values stay on the step, and one that is not reporting says so', () => {
  assert.equal(snap(20.9, 0.1), 20.9); assert.equal(snap(20.94, 0.1), 20.9); assert.equal(snap(71.4, 1), 71); assert.equal(snap(20.3, 0.5), 20.5);
  assert.ok(same(20.900000000000002, 20.9)); assert.ok(!same(20.9, 21)); assert.ok(!same(undefined, 21)); assert.ok(same(undefined, undefined));
  assert.equal(noSetPoint('off'), 'Thermostat is off');
  assert.equal(noSetPoint('unavailable'), 'Thermostat is not reporting'); assert.equal(noSetPoint('unknown'), 'Thermostat is not reporting');
});

test('number slider: steps count from the minimum and never pass the maximum', () => {
  const r = { min: 5, max: 95, step: 10 };
  assert.equal(numberAt(r, 0), 5); assert.equal(numberAt(r, 50), 55); assert.equal(numberAt(r, 100), 95);
  assert.equal(numberAt({ min: 0, max: 100, step: 30 }, 100), 90, 'the last whole step');
  assert.equal(numberAt({ min: 0, max: 1, step: 0.1 }, 70), 0.7);
  assert.equal(MODELS.number.at({ state: '5', attributes: { min: 5, max: 95, step: 10, unit_of_measurement: 'min' } }, 50), '55 min');
  assert.equal(MODELS.light.at({}, 41.6), '42%');
});

test('slider: a value HA refuses, or that could not be sent, is not left on the tile', () => {
  set('input_number.n', '20', { min: 0, max: 100, step: 5 });
  accept = true; sent.length = 0; MODELS.number.set('input_number.n', 62, 0);
  assert.deepEqual(sent[0].data, { value: 60 }); assert.equal(S.st('input_number.n').state, '60', 'shown at once');
  sent[0].onFail(); assert.equal(S.st('input_number.n').state, '20', 'refused: back to the real value');
  accept = false; MODELS.number.set('input_number.n', 80, 0);
  assert.equal(S.st('input_number.n').state, '20', 'not connected: never shown');
  set('light.l', 'on', { brightness: 255 }); accept = true; sent.length = 0;
  MODELS.light.set('light.l', 0, 0); assert.equal(S.st('light.l').state, 'off'); sent[0].onFail(); assert.equal(S.st('light.l').state, 'on');
  set('media_player.m', 'playing', { volume_level: 0.2 }); sent.length = 0;
  MODELS.media_player.set('media_player.m', 50, 0); assert.equal(S.st('media_player.m').attributes.volume_level, 0.5); sent[0].onFail(); assert.equal(S.st('media_player.m').attributes.volume_level, 0.2);
});

test('stepper: a press moves one step on the grid, inside the entity\'s limits; with no value yet it lands on `from`', () => {
  const grill = { step: 5, min: 150, max: 700, from: 250 };
  assert.equal(stepTo(250, 1, grill), 255); assert.equal(stepTo(250, -1, grill), 245);
  assert.equal(stepTo(252, 1, grill), 255, 'off the grid: to the grid first'); assert.equal(stepTo(248, -1, grill), 245);
  assert.equal(stepTo(700, 1, grill), 700); assert.equal(stepTo(150, -1, grill), 150);
  for (const none of [null, undefined, NaN]) { assert.equal(stepTo(none, 1, grill), 250); assert.equal(stepTo(none, -1, grill), 250); }
  assert.equal(stepTo(null, 1, { step: 5, min: 32, max: 300 }), 32, 'no `from`: the lowest value');
  assert.equal(stepTo(null, 1, { step: 5, min: 150, max: 700, from: 90 }), 150, '`from` outside the limits is held to them');
  assert.equal(stepTo(20.4, 1, { step: 0.1 }), 20.5, 'no float noise');
});

