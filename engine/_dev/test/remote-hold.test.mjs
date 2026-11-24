// core/remote/hold.js: OK as a press, a hold and the end of adjusting. Time is the test's (the stub's fakeTimeouts); the items
// are stand-ins that record what they are sent.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load, fakeTimeouts } from './stub.mjs';

const H = await load('core/remote/hold.js');
let focused = null;
Object.defineProperty(document, 'activeElement', { get: () => focused, configurable: true });

// an item: `is` = the selectors it matches; `answers` = it takes dash:ok for itself (preventDefault)
function item(is = [], answers = false) {
  const x = { got: [], clicks: 0, classList: { on: new Set(), contains: (c) => x.classList.on.has(c) },
    matches: (sel) => sel.split(',').some((s) => is.includes(s.trim())),
    click: () => { x.clicks++; },
    dispatchEvent: (ev) => { x.got.push(ev.detail === undefined ? ev.type : `${ev.type}:${ev.detail}`);
      if (ev.type === 'dash:ok' && answers) ev.defaultPrevented = true;
      if (ev.type === 'dash:hold') x.classList.on.add('adjusting');      // as a dimmer tile does
      if (ev.type === 'dash:adjust-end') x.classList.on.delete('adjusting'); } };
  return x;
}
const down = (el, repeat = false) => { const e = { key: 'Enter', repeat, prevented: false, preventDefault() { e.prevented = true; } }; H.okKey(e, el); return e; };
const up = () => { const e = { key: 'Enter', prevented: false, preventDefault() { e.prevented = true; } }; H.okUp(e); return e; };
const timed = (t) => { const f = fakeTimeouts(); t.after(f.restore); return f.tick; };

test('OK on a card root: dash:ok, then a click; no click when the card answers', () => {
  const tile = item(['.tile']); focused = tile;
  assert.equal(down(tile).prevented, true); up();
  assert.deepEqual(tile.got, ['dash:ok']); assert.equal(tile.clicks, 1);
  const dimmer = item(['.tile'], true); focused = dimmer;
  down(dimmer); up();
  assert.deepEqual(dimmer.got, ['dash:ok']); assert.equal(dimmer.clicks, 0);
});

test('OK on a button: the browser clicks it, unless the card answers dash:ok', () => {
  const b = item(['button']); focused = b;
  assert.equal(down(b).prevented, false); up();
  assert.equal(b.clicks, 0);   // not ours to click
  const own = item(['button'], true); focused = own;
  assert.equal(down(own).prevented, true); up();
});

test('a short press on a [data-hold] item is OK, on its key up', (t) => {
  const tick = timed(t), el = item(['[data-hold]', '.tile']); focused = el;
  down(el); tick(200);
  assert.deepEqual(el.got, []);
  assert.equal(up().prevented, true);
  assert.deepEqual(el.got, []);   // the launcher's tv:hold may still follow
  tick(80);
  assert.deepEqual(el.got, ['dash:ok']); assert.equal(el.clicks, 1);
  tick(1000);
  assert.deepEqual(el.got, ['dash:ok']);   // and no hold after it
});

test('half a second down is a hold; the release of that press does not end adjusting, the next OK does', (t) => {
  const tick = timed(t), el = item(['[data-hold]', '.tile']); focused = el;
  down(el); tick(499);
  assert.deepEqual(el.got, []);
  tick(1);
  assert.deepEqual(el.got, ['dash:hold']);
  assert.equal(H.adjusting(), el);
  up(); tick(200);
  assert.deepEqual(el.got, ['dash:hold']);
  up();   // the next press's release (its key down is the remote's, while adjusting)
  assert.deepEqual(el.got, ['dash:hold', 'dash:adjust-end']);
  assert.equal(H.adjusting(), null); assert.equal(el.clicks, 0);
});

test('a repeated key down is a hold at once (a TV repeats a held key)', (t) => {
  const tick = timed(t), el = item(['[data-hold]']); focused = el;
  down(el); tick(100);
  assert.equal(down(el, true).prevented, true);
  assert.deepEqual(el.got, ['dash:hold']);
  down(el, true); tick(1000);
  assert.deepEqual(el.got, ['dash:hold']);   // once
  up(); up();
  assert.deepEqual(el.got, ['dash:hold', 'dash:adjust-end']);
});

test('the launcher\'s tv:hold just behind the key up is a hold, not a press', (t) => {
  const tick = timed(t), el = item(['[data-hold]']); focused = el;
  down(el); tick(30); up(); tick(40);
  H.launcherHold();
  assert.deepEqual(el.got, ['dash:hold']);
  tick(500);
  assert.deepEqual(el.got, ['dash:hold']); assert.equal(el.clicks, 0);
  up();   // OK was already up when the hold came: this release ends adjusting
  assert.deepEqual(el.got, ['dash:hold', 'dash:adjust-end']);
});

test('the highlight gone elsewhere: no hold and no press for the item left behind', (t) => {
  const tick = timed(t), el = item(['[data-hold]']), other = item(['.tile']); focused = el;
  down(el); focused = other; tick(600);
  assert.deepEqual(el.got, []);
  focused = el; down(el); focused = other; up(); tick(100);
  assert.deepEqual(el.got, []); assert.equal(el.clicks, 0);
  H.launcherHold(); tick(600);
  assert.deepEqual(el.got, []);
});

test('tv:hold with nothing pending does nothing; adjust sends the step', () => {
  const el = item(['.tile']); focused = el;
  H.launcherHold();
  H.adjust(el, -1); H.endAdjust(el);
  assert.deepEqual(el.got, ['dash:adjust:-1', 'dash:adjust-end']);
});
