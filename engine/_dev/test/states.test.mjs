// core/states.js: what a lock, a garage door, the alarm and a count say for a state. Plain values in, plain values out.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load } from './stub.mjs';

const { known, alarmView, lockView, garageView, countWord } = await load('core/states.js');
const e = (state) => ({ state, attributes: {} });

test('known: an entity that is missing, unavailable or unknown does not report', () => {
  for (const x of [null, undefined, e('unavailable'), e('unknown'), e(''), e(null)]) assert.equal(known(x), false);
  for (const s of ['on', 'off', '0', 'locked']) assert.equal(known(e(s)), true);
});

test('a lock: locked, unlocked, moving, jammed, not reporting', () => {
  assert.deepEqual(lockView(e('locked'), 'off'), { key: 'locked', locked: true, word: 'Locked', icon: 'lock' });
  assert.deepEqual(lockView(e('unlocked')), { key: 'unlocked', locked: false, word: 'Unlocked', icon: 'lock-open-variant' });
  assert.equal(lockView(e('locking'), 'off').word, 'Locking');
  // jammed: the sensor says so and the lock is neither locked nor unlocked (it then reports unknown)
  for (const s of ['unknown', 'unavailable', 'locking']) assert.deepEqual(lockView(e(s), 'on'), { key: 'jammed', locked: false, word: 'Jammed', icon: 'lock-alert' });
  assert.equal(lockView(e('locked'), 'on').key, 'locked', 'a stale jam flag does not override a lock that reports locked');
  for (const x of [null, e('unavailable'), e('unknown')]) { const v = lockView(x, 'off'); assert.equal(v.word, 'Not reporting'); assert.equal(v.locked, false); }
});

test('a garage door: closed, open, moving, not reporting', () => {
  assert.deepEqual(garageView(e('closed')), { key: 'closed', closed: true, moving: false, word: 'Closed', icon: 'garage' });
  assert.equal(garageView(e('open')).closed, false); assert.equal(garageView(e('opening')).moving, true); assert.equal(garageView(e('closing')).word, 'Closing');
  for (const x of [null, e('unavailable'), e('unknown')]) { const v = garageView(x); assert.equal(v.word, 'Not reporting'); assert.equal(v.closed, false); }
});

test('the alarm: a longer word for disarmed where asked; not reporting is neither armed nor off', () => {
  assert.equal(alarmView('disarmed').text, 'Off'); assert.equal(alarmView('disarmed', 'Disarmed').text, 'Disarmed');
  assert.equal(alarmView('armed_away', 'Disarmed').text, 'Armed away');
  for (const s of [null, 'unavailable', 'unknown']) assert.deepEqual(alarmView(s, 'Disarmed'), { s: 'none', text: 'Not reporting', icon: 'shield-alert' });
});

test('a count: no number is not reporting, never "All closed"', () => {
  assert.equal(countWord(0, 'open', 'All closed'), 'All closed'); assert.equal(countWord(3, 'open', 'All closed'), '3 open');
  for (const n of [null, undefined, NaN]) assert.equal(countWord(n, 'open', 'All closed'), 'Not reporting');
});
