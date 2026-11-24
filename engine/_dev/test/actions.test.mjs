// core/actions.js run(): what a tap sends to Home Assistant and what the card shows meanwhile. The connection
// (core/ha.js) is replaced by a recorder, so nothing is sent anywhere.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load, override, frames, clock } from './stub.mjs';

const sent = [], toasts = []; let online = true;
override('core/ha.js', { connected: () => online, call: (service, data, target, onFail) => { sent.push({ service, data, target, onFail }); } });
override('core/toast.js', { toast: (text) => { toasts.push(text); } });
const { run } = await load('core/actions.js'), S = await load('core/store.js'), { settings } = await load('core/settings.js');
const set = (id, s, a) => S.applyEntities({ a: { [id]: { s, a, lc: 1 } } });
const tap = (action, entity) => { sent.length = 0; run(action, { entity }); frames.run(); return sent.map(({ service, data, target }) => ({ service, data, target })); };
const events = []; window.addEventListener('dash:view', (e) => events.push(['view', e.detail])); window.addEventListener('dash:drawer', (e) => events.push(['drawer', e.detail]));

test('toggle: a light that is on goes off at once, one that is off goes on', () => {
  set('light.a', 'on'); settings.instantLightOff = true;
  assert.deepEqual(tap('toggle', 'light.a'), [{ service: 'light.turn_off', data: { transition: 0 }, target: 'light.a' }]);
  assert.equal(S.st('light.a').state, 'off', 'shown off before HA answers'); assert.equal(S.st('light.a').pending, true);
  S.applyEntities({ c: { 'light.a': { '+': { s: 'off' } } } });
  assert.deepEqual(tap('toggle', 'light.a'), [{ service: 'light.turn_on', data: {}, target: 'light.a' }]);
  settings.instantLightOff = false; S.applyEntities({ c: { 'light.a': { '+': { s: 'on' } } } });
  assert.deepEqual(tap('toggle', 'light.a'), [{ service: 'light.turn_off', data: {}, target: 'light.a' }], 'with the setting off the light fades as HA likes');
});

test('toggle: switches, fans and helpers use their own service, anything else the general one', () => {
  set('switch.s', 'off'); set('fan.f', 'on'); set('input_boolean.b', 'off'); set('media_player.tv', 'off'); set('light.gone', 'unavailable');
  assert.equal(tap('toggle', 'switch.s')[0].service, 'switch.turn_on'); assert.equal(tap('toggle', 'fan.f')[0].service, 'fan.turn_off');
  assert.equal(tap('toggle', 'input_boolean.b')[0].service, 'input_boolean.turn_on'); assert.equal(tap('toggle', 'media_player.tv')[0].service, 'homeassistant.turn_on');
  assert.equal(tap('toggle', 'light.gone')[0].service, 'light.turn_on', 'anything that is not on is turned on');
});

test('toggle: a cover opens when closed and closes when open', () => {
  set('cover.c', 'open', { current_position: 100 });
  assert.deepEqual(tap('toggle', 'cover.c'), [{ service: 'cover.close_cover', data: {}, target: 'cover.c' }]);
  assert.equal(S.st('cover.c').state, 'closed');
  S.applyEntities({ c: { 'cover.c': { '+': { s: 'closed' } } } });
  assert.deepEqual(tap('toggle', 'cover.c'), [{ service: 'cover.open_cover', data: {}, target: 'cover.c' }]);
  S.applyEntities({ c: { 'cover.c': { '+': { s: 'opening' } } } });
  assert.equal(tap('toggle', 'cover.c')[0].service, 'cover.close_cover', 'while it opens, a tap closes it');
});

test('toggle: the action can name another entity than the card', () => {
  set('light.b', 'off');
  assert.deepEqual(tap({ toggle: true, entity: 'light.b' }, 'sensor.x'), [{ service: 'light.turn_on', data: {}, target: 'light.b' }]);
});

test('a refused toggle puts the real state back', () => {
  set('light.r', 'off'); sent.length = 0; run('toggle', { entity: 'light.r' });
  assert.equal(S.st('light.r').state, 'on');
  sent[0].onFail();
  assert.equal(S.st('light.r').state, 'off'); assert.equal(S.st('light.r').pending, undefined);
});

test('call: on the card entity unless a target is named; target null = no entity', () => {
  set('vacuum.v', 'docked');
  assert.deepEqual(tap({ call: 'vacuum.start' }, 'vacuum.v'), [{ service: 'vacuum.start', data: undefined, target: 'vacuum.v' }]);
  assert.deepEqual(tap({ call: 'script.turn_on', target: 'script.x', data: { variables: { a: 1 } } }, 'vacuum.v'), [{ service: 'script.turn_on', data: { variables: { a: 1 } }, target: 'script.x' }]);
  assert.deepEqual(tap({ call: 'script.alarm_disarm', target: null }, 'vacuum.v'), [{ service: 'script.alarm_disarm', data: undefined, target: undefined }]);
});

test('call with expect: the expected state or attribute shows until HA confirms', () => {
  set('lock.l', 'locked'); set('cover.blind', 'open', { current_position: 100 }); let after = 0;
  tap({ call: 'lock.unlock', expect: 'unlocked', after: () => { after++; } }, 'lock.l');
  assert.equal(S.st('lock.l').state, 'unlocked'); assert.equal(after, 1);
  tap({ call: 'script.move', target: null, data: { position: 30 }, expect: { entity: 'cover.blind', attr: 'current_position', value: 30 } }, 'sensor.x');
  assert.equal(S.st('cover.blind').attributes.current_position, 30); assert.equal(S.st('cover.blind').state, 'open');
  S.applyEntities({ c: { 'cover.blind': { '+': { a: { current_position: 30 } } } } });
  assert.equal(S.st('cover.blind').pending, undefined);
});

test('a function picks the action from the state; nothing and "none" do nothing', () => {
  set('lock.f', 'unlocked');
  const pick = (e) => (e.state === 'locked' ? { call: 'lock.unlock' } : { call: 'lock.lock' });
  assert.equal(tap(pick, 'lock.f')[0].service, 'lock.lock');
  assert.deepEqual(tap('none', 'lock.f'), []); assert.deepEqual(tap(undefined, 'lock.f'), []); assert.deepEqual(tap(() => null, 'lock.f'), []);
});

test('not connected: nothing is sent and nothing pretends to have changed', () => {
  set('light.n', 'off'); online = false; toasts.length = 0;
  try { assert.deepEqual(tap('toggle', 'light.n'), []); assert.equal(S.st('light.n').state, 'off'); assert.deepEqual(tap({ call: 'light.turn_on' }, 'light.n'), []); } finally { online = true; }
  assert.equal(toasts.length, 2, 'and the screen says so each time'); assert.match(toasts[0], /Not connected/);
});

test('view, drawer and pop-up links', () => {
  events.length = 0; location.hash = '';
  run({ view: 'systems/nas' }, {}); run({ drawer: 'events' }, {}); run({ nav: '#lights' }, {});
  assert.deepEqual(events, [['view', 'systems/nas'], ['drawer', 'events']]); assert.equal(location.hash, '#lights');
  assert.equal(sent.length, 0);
});

test('confirm: true needs a second tap on the same button, not a bounce and not much later', () => {
  set('switch.c', 'off'); sent.length = 0;
  const el = { classList: { add() {}, remove() {} } }, go = () => run({ call: 'switch.turn_on', confirm: true }, { entity: 'switch.c', el });
  go(); assert.equal(sent.length, 0, 'the first tap only arms it');
  clock.advance(100); go(); assert.equal(sent.length, 0, 'a bounce 0.1 s later is not a confirmation');
  clock.advance(1000); go(); assert.equal(sent.length, 1, 'a second tap sends it');
  clock.advance(500); go(); clock.advance(5000); go(); assert.equal(sent.length, 1, 'too late: it starts over');
  clock.advance(1000); go(); assert.equal(sent.length, 2);
});
