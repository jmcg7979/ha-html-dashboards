// core/gesture.js: a sheet dragged down closes past 90 px and springs back before it; a scroll box that isn't at its
// top, or a control that takes drags itself, keeps the gesture. The panel is a stand-in that holds its listeners.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load } from './stub.mjs';

const { swipeToClose } = await load('core/gesture.js');
globalThis.getComputedStyle = (n) => ({ overflowY: n.overflowY || 'visible' });

function sheet() {
  const on = {}, panel = { style: {}, addEventListener: (type, fn) => { on[type] = fn; } };
  let closed = 0;
  swipeToClose(panel, () => { closed++; });
  // a node inside the panel; `control` = it matches the list of things that take a drag themselves
  const node = (o = {}) => ({ parentElement: panel, scrollTop: 0, scrollHeight: 100, clientHeight: 100, closest: () => (o.control ? {} : null), ...o });
  const touch = (y) => ({ touches: [{ clientY: y }] });
  return { panel, node, closed: () => closed,
    drag(target, from, to) { on.touchstart({ target, ...touch(from) }); on.touchmove(touch(to)); on.touchend({}); },
    start: (target, y) => on.touchstart({ target, ...touch(y) }), move: (y) => on.touchmove(touch(y)), cancel: () => on.touchcancel({}) };
}
const settle = () => new Promise((r) => setTimeout(r, 220));

test('a drag of more than 90 px closes the sheet, once, and leaves no transform behind', async () => {
  const s = sheet();
  s.drag(s.node(), 100, 200);
  assert.equal(s.panel.style.transform, 'translateY(100%)');
  await settle();
  assert.equal(s.closed(), 1);
  assert.equal(s.panel.style.transform, '');
  assert.equal(s.panel.style.transition, '');
});

test('a shorter drag, an upward one and a canceled one spring back', async () => {
  const s = sheet();
  s.drag(s.node(), 100, 180);
  s.drag(s.node(), 200, 50);
  s.start(s.node(), 100); s.move(400); s.cancel();
  await settle();
  assert.equal(s.closed(), 0);
  assert.equal(s.panel.style.transform, '');
});

test('the sheet follows the finger while it is dragged', () => {
  const s = sheet();
  s.start(s.node(), 100); s.move(140);
  assert.equal(s.panel.style.transform, 'translateY(40px)');
  assert.equal(s.panel.style.transition, 'none');
  s.cancel();
});

test('a list scrolled down keeps the gesture; at its top the sheet takes it', async () => {
  const s = sheet();
  s.drag(s.node({ overflowY: 'auto', scrollTop: 30, scrollHeight: 500 }), 100, 300);
  await settle();
  assert.equal(s.closed(), 0);
  s.drag(s.node({ overflowY: 'auto', scrollTop: 0, scrollHeight: 500 }), 100, 300);
  await settle();
  assert.equal(s.closed(), 1);
});

test('a slider, a map or a chart under the finger keeps the gesture', async () => {
  const s = sheet();
  s.drag(s.node({ control: true }), 100, 300);
  await settle();
  assert.equal(s.closed(), 0);
  assert.equal(s.panel.style.transform, undefined);
});
