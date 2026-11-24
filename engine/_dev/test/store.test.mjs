// core/store.js: HA's subscribe_entities stream applied to the state table, optimistic values, and watchers that are
// called once per frame however many of their entities changed.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load, frames, clock } from './stub.mjs';

const S = await load('core/store.js'), { capture } = await load('core/scope.js');
const add = (id, s, a, lc = 100) => S.applyEntities({ a: { [id]: { s, a, lc } } });

test('added, changed and removed entities', () => {
  add('light.a', 'off', { brightness: 10, color: 'red' });
  assert.deepEqual(S.st('light.a'), { state: 'off', attributes: { brightness: 10, color: 'red' }, lc: 100, lu: 100 });
  const before = S.st('light.a');
  S.applyEntities({ c: { 'light.a': { '+': { s: 'on', a: { brightness: 200 }, lc: 150 }, '-': { a: ['color'] } } } });
  assert.deepEqual(S.st('light.a'), { state: 'on', attributes: { brightness: 200 }, lc: 150, lu: 150 });
  assert.equal(before.state, 'off', 'a state object a card already holds is never changed in place');
  S.applyEntities({ c: { 'light.a': { '+': { a: { brightness: 180 }, lu: 160 } } } });   // only an attribute: last-changed stays, last-updated moves
  assert.equal(S.st('light.a').lc, 150); assert.equal(S.st('light.a').lu, 160); assert.equal(S.st('light.a').state, 'on');
  S.applyEntities({ c: { 'light.unknown': { '+': { s: 'on' } } } });   // a change for an entity that was never added is ignored
  assert.equal(S.st('light.unknown'), null);
  S.applyEntities({ r: ['light.a'] });
  assert.equal(S.st('light.a'), null);
});

test('isOn, num and attr on missing, unavailable and real values', () => {
  add('sensor.t', '21.5', { unit_of_measurement: '°C' }); add('sensor.gone', 'unavailable'); add('switch.s', 'on');
  assert.equal(S.num('sensor.t'), 21.5); assert.equal(S.num('sensor.gone'), null); assert.equal(S.num('sensor.none'), null);
  assert.equal(S.isOn('switch.s'), true); assert.equal(S.isOn('sensor.t'), false); assert.equal(S.isOn('switch.none'), false);
  assert.equal(S.attr('sensor.t', 'unit_of_measurement'), '°C'); assert.equal(S.attr('sensor.none', 'x'), undefined);
});

test('a watcher is called once per frame, however many of its entities changed', () => {
  add('light.w1', 'off'); add('light.w2', 'off'); frames.run();
  let calls = 0; const scope = capture(() => S.watch(['light.w1', 'light.w2', null], () => { calls++; }));
  assert.equal(calls, 1, 'drawn at once when the store already has states');
  S.applyEntities({ c: { 'light.w1': { '+': { s: 'on' } }, 'light.w2': { '+': { s: 'on' } } } });
  S.applyEntities({ c: { 'light.w1': { '+': { s: 'off' } } } });
  assert.equal(calls, 1, 'nothing until the next frame');
  frames.run();
  assert.equal(calls, 2);
  frames.run();
  assert.equal(calls, 2, 'and not again without a change');
  add('light.other', 'on'); frames.run();
  assert.equal(calls, 2, 'another entity changing is not its business');
  scope.dispose();
  S.applyEntities({ c: { 'light.w1': { '+': { s: 'on' } } } }); frames.run();
  assert.equal(calls, 2, 'not called after its view is unloaded');
  assert.equal(S.stats().watchers, 0);
});

test('a watcher that throws does not stop the others', () => {
  add('light.t', 'off'); frames.run();
  const seen = [], quiet = console.error; console.error = () => {};
  try {
    let built = false;   // the first call is the card drawing itself while it is built; a failure there is the card's own
    const scope = capture(() => { S.watch(['light.t'], () => { if (built) throw new Error('broken card'); }); S.watch(['light.t'], () => seen.push(S.st('light.t').state)); });
    built = true;
    S.applyEntities({ c: { 'light.t': { '+': { s: 'on' } } } }); frames.run();
    scope.dispose();
  } finally { console.error = quiet; }
  assert.deepEqual(seen, ['off', 'on']);
});

test('an optimistic value shows until HA confirms it', () => {
  add('light.o', 'off', { brightness: 0 });
  S.optimistic('light.o', 'on', null, (r) => r.state === 'on');
  assert.equal(S.st('light.o').state, 'on'); assert.equal(S.st('light.o').pending, true);
  S.applyEntities({ c: { 'light.o': { '+': { a: { brightness: 5 } } } } });   // HA says something else first: still waiting
  assert.equal(S.st('light.o').state, 'on'); assert.equal(S.st('light.o').pending, true);
  S.applyEntities({ c: { 'light.o': { '+': { s: 'on' } } } });
  assert.equal(S.st('light.o').state, 'on'); assert.equal(S.st('light.o').pending, undefined, 'confirmed: the real state again');
});

test('an optimistic value HA never confirms goes away after 12 seconds', () => {
  add('cover.o', 'closed', { current_position: 0 });
  S.optimistic('cover.o', null, { current_position: 50 }, (r) => r.attributes.current_position === 50);
  assert.deepEqual([S.st('cover.o').state, S.st('cover.o').attributes.current_position], ['closed', 50], 'only the attribute is overridden');
  clock.advance(11000); assert.equal(S.st('cover.o').attributes.current_position, 50);
  clock.advance(1500); assert.equal(S.st('cover.o').attributes.current_position, 0);
  assert.equal(S.st('cover.o').pending, undefined);
});

test('dropOptimistic: a refused call puts the real state back and redraws', () => {
  add('switch.d', 'off'); frames.run();
  let calls = 0; const scope = capture(() => S.watch(['switch.d'], () => { calls++; }));
  S.optimistic('switch.d', 'on', null, (r) => r.state === 'on'); frames.run();
  assert.equal(S.st('switch.d').state, 'on'); assert.equal(calls, 2);
  S.dropOptimistic('switch.d'); frames.run();
  assert.equal(S.st('switch.d').state, 'off'); assert.equal(calls, 3);
  scope.dispose();
});

test('an optimistic value for an entity the store does not have yet', () => {
  S.optimistic('light.later', 'on', { brightness: 255 }, () => false);
  assert.deepEqual(S.st('light.later'), { state: 'on', attributes: { brightness: 255 }, lc: 0, lu: 0, pending: true });
  S.dropOptimistic('light.later');
  assert.equal(S.st('light.later'), null);
});

test('a new subscription re-adds every entity: one HA has not updated since is not a change', async () => {
  const drawn = [];
  S.applyEntities({ a: { 'sensor.same': { s: '5', a: { unit: 'W' }, lc: 100, lu: 100 }, 'sensor.moved': { s: '1', lc: 100, lu: 100 } } });
  S.watch(['sensor.same'], () => drawn.push('same')); S.watch(['sensor.moved'], () => drawn.push('moved'));
  drawn.length = 0;
  S.applyEntities({ a: { 'sensor.same': { s: '5', a: { unit: 'W' }, lc: 100, lu: 100 }, 'sensor.moved': { s: '1', a: { unit: 'V' }, lc: 100, lu: 140 } } });
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(drawn, ['moved']);
  assert.equal(S.st('sensor.moved').attributes.unit, 'V');
});
