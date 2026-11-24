// Units (a site's °F / °C and 12 / 24 hour choice) and the text helpers in core/dom.js.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load } from './stub.mjs';

const home = await load('home.js'), U = await load('core/units.js'), D = await load('core/dom.js');
// the example site says { temperature: 'F', clock: '12h' }; the engine reads it at each call, so a test can switch it
const site = (o, fn) => { const was = { ...home.units }; Object.assign(home.units, o); try { return fn(); } finally { Object.assign(home.units, was); } };

test('temperatures: whole degrees in °F, tenths in °C', () => {
  site({ temperature: 'F' }, () => { assert.equal(U.deg(71.6), '72'); assert.equal(U.deg(-0.4), '0'); assert.equal(U.degUnit(), '°F'); assert.equal(U.metric(), false); });
  site({ temperature: 'C' }, () => { assert.equal(U.deg(19.46), '19.5'); assert.equal(U.deg(20), '20'); assert.equal(U.degUnit(), '°C'); assert.equal(U.metric(), true); });
});

test('clock: 12-hour parts with AM / PM, 24-hour parts without', () => {
  site({ clock: '12h' }, () => {
    assert.deepEqual(U.hmParts(0, 5), ['12:05', 'AM']); assert.deepEqual(U.hmParts(12, 0), ['12:00', 'PM']); assert.deepEqual(U.hmParts(23, 59), ['11:59', 'PM']);
    assert.equal(U.hourShort(new Date(2026, 0, 5, 16)), '4p'); assert.equal(U.hourShort(new Date(2026, 0, 5, 0)), '12a');
    assert.deepEqual(U.timeOpts({ hour: 'numeric' }), { hour: 'numeric', hourCycle: 'h12' });
  });
  site({ clock: '24h' }, () => {
    assert.deepEqual(U.hmParts(0, 5), ['00:05', '']); assert.deepEqual(U.hmParts(16, 30), ['16:30', '']);
    assert.equal(U.hourShort(new Date(2026, 0, 5, 16)), '16'); assert.equal(U.hourShort(new Date(2026, 0, 5, 7)), '07');
    assert.deepEqual(U.timeOpts({ hour: 'numeric' }), { hour: 'numeric', hourCycle: 'h23' });
  });
  site({ clock: undefined }, () => assert.deepEqual(U.timeOpts({ hour: 'numeric' }), { hour: 'numeric' }));   // the browser's own format
});

test('esc: text from HA can not become markup', () => {
  assert.equal(D.esc('<img src=x onerror="a()">'), '&lt;img src=x onerror=&quot;a()&quot;&gt;');
  assert.equal(D.esc("Tom & Jerry's"), 'Tom &amp; Jerry&#39;s');
  assert.equal(D.esc(null), ''); assert.equal(D.esc(undefined), ''); assert.equal(D.esc(0), '0');
});

test('cap: a state as words', () => {
  assert.equal(D.cap('armed_away'), 'Armed away'); assert.equal(D.cap('on'), 'On'); assert.equal(D.cap(''), ''); assert.equal(D.cap(undefined), '');
});

test('mmss: countdowns', () => {
  assert.equal(D.mmss(0), '0:00'); assert.equal(D.mmss(59.4), '0:59'); assert.equal(D.mmss(59.6), '1:00'); assert.equal(D.mmss(125), '2:05');
  assert.equal(D.mmss(3600), '1:00:00'); assert.equal(D.mmss(3725), '1:02:05'); assert.equal(D.mmss(-5), '0:00');
});

test('hm: the time today, the weekday in front on another day', () => {
  const at = (days, h, m) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d; };
  site({ clock: '12h' }, () => {
    assert.equal(D.hm(at(0, 8, 51)), '8:51'); assert.equal(D.hm(at(0, 20, 5), true), '8:05 PM'); assert.equal(D.hm(at(0, 0, 0), true), '12:00 AM');
    const y = at(-1, 8, 51); assert.equal(D.hm(y), ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][y.getDay()] + ' 8:51');
    assert.equal(D.hm(at(0, 8, 51).getTime() / 1000), '8:51');   // a number is seconds since 1970
    assert.equal(D.hm(at(0, 8, 51).toISOString()), '8:51');
  });
  site({ clock: '24h' }, () => { assert.equal(D.hm(at(0, 20, 5), true), '20:05'); assert.equal(D.hm(at(0, 0, 7)), '00:07'); });
  assert.equal(D.hm('not a time'), '');
});

test('battTone: ember under 25 %, lamp under 40 %, else sage', () => {
  assert.equal(D.battTone(null), null); assert.equal(D.battTone(24), 'ember'); assert.equal(D.battTone(25), 'lamp'); assert.equal(D.battTone(39), 'lamp'); assert.equal(D.battTone(40), 'sage');
});
