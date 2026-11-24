// core/scope.js: everything a view hooks up while it is built is undone when the view is unloaded.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load, listeners, intervals } from './stub.mjs';

const { capture, outside, onDispose, current } = await load('core/scope.js');
const S = await load('core/store.js');
const base = { win: listeners.window(), doc: listeners.document(), timers: intervals.size };
const left = () => ({ win: listeners.window() - base.win, doc: listeners.document() - base.doc, timers: intervals.size - base.timers });

test('capture records listeners, intervals, observers and onDispose, and dispose undoes them all', () => {
  const observers = [], order = [];
  const scope = capture(() => {
    window.addEventListener('resize', () => {}); document.addEventListener('visibilitychange', () => {});
    setInterval(() => {}, 60000);
    const o = new ResizeObserver(() => {}); o.observe({}); observers.push(o);
    const m = new MutationObserver(() => {}); m.observe({}); observers.push(m);
    onDispose(() => order.push('first')); onDispose(() => order.push('second'));
    return 'built';
  });
  assert.equal(scope.value, 'built');
  assert.deepEqual(left(), { win: 1, doc: 1, timers: 1 }); assert.deepEqual(observers.map((o) => o.on), [true, true]);
  scope.dispose();
  assert.deepEqual(left(), { win: 0, doc: 0, timers: 0 }); assert.deepEqual(observers.map((o) => o.on), [false, false]);
  assert.deepEqual(order, ['first', 'second']);
  scope.dispose();   // a second call has nothing left to do
  assert.deepEqual(order, ['first', 'second']);
});

test('after capture the page is as it was: what is hooked up later is not recorded', () => {
  const scope = capture(() => {});
  assert.equal(current(), null);
  const f = () => {}; window.addEventListener('late', f); const id = setInterval(() => {}, 60000);
  scope.dispose();
  assert.deepEqual(left(), { win: 1, doc: 0, timers: 1 }, 'still there: it was not made while the view was built');
  window.removeEventListener('late', f); clearInterval(id);
});

test('watch and tick made while a view is built go with the view', () => {
  const was = S.stats();
  const scope = capture(() => { S.watch(['light.x', 'light.y'], () => {}); S.tick(() => {}); });
  assert.deepEqual(S.stats(), { watchers: was.watchers + 2, ticks: was.ticks + 1 });
  scope.dispose();
  assert.deepEqual(S.stats(), was);
});

test('outside: something shared, started by the first card that needs it, outlives that card', () => {
  let id;
  const scope = capture(() => { outside(() => { window.addEventListener('shared', () => {}); id = setInterval(() => {}, 60000); onDispose(() => assert.fail('not recorded')); });
    window.addEventListener('own', () => {}); });
  assert.equal(left().win, 2);
  scope.dispose();
  assert.deepEqual(left(), { win: 1, doc: 0, timers: 1 }, 'the shared listener and interval stay');
  base.win++; clearInterval(id);
});

test('a capture inside a capture (a pop-up a card builds) is undone with its owner', () => {
  let inner;
  const outer = capture(() => { window.addEventListener('a', () => {}); inner = capture(() => { window.addEventListener('b', () => {}); }); window.addEventListener('c', () => {}); });
  assert.equal(left().win, 3);
  outer.dispose();
  assert.equal(left().win, 0);
  inner.dispose();   // already undone
  assert.equal(left().win, 0);
});

test('a build that throws leaves the page as it was', () => {
  const si = window.setInterval, wa = window.addEventListener, RO = window.ResizeObserver;
  assert.throws(() => capture(() => { throw new Error('card failed'); }), /card failed/);
  assert.equal(window.setInterval, si); assert.equal(window.addEventListener, wa); assert.equal(window.ResizeObserver, RO); assert.equal(current(), null);
});

test('one cleanup that throws does not stop the rest', () => {
  const done = [], quiet = console.error; console.error = () => {};
  try { const scope = capture(() => { onDispose(() => done.push(1)); onDispose(() => { throw new Error('x'); }); onDispose(() => done.push(3)); }); scope.dispose(); } finally { console.error = quiet; }
  assert.deepEqual(done, [1, 3]);
});
