// core/layout.js: a big-screen page reflowed for a phone.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load } from './stub.mjs';

const { phoneSections, phoneView } = await load('core/layout.js');

test('phoneSections: one column, single figures two to a row, everything else full width', () => {
  const before = [{ span: 2, cols: 24, rows: 'auto minmax(0, 1fr)', panel: false, cards: [
    { type: 'kpi', span: 3, label: 'CPU' }, { type: 'chart', span: 8, fit: true, grow: true, title: 'Load' }, { type: 'host', span: 4, grow: true, fit: 'x' },
    { type: 'stack', span: 6, cards: [{ type: 'kpi', span: 2 }, { type: 'tile', span: 2, grow: true }] }] }];
  const [sec] = phoneSections(before);
  assert.deepEqual([sec.span, sec.cols, sec.rows, sec.panel], [1, 12, undefined, false]);
  assert.deepEqual(sec.cards.map((c) => c.span), [6, 12, 12, 12]);
  assert.deepEqual(sec.cards.map((c) => c.grow), [undefined, undefined, undefined, undefined], 'nothing stretches to the screen height');
  assert.equal(sec.cards[1].fit, false, 'a chart keeps its own height'); assert.equal(sec.cards[2].fit, 'x'); assert.equal(sec.cards[1].title, 'Load');
  assert.deepEqual(sec.cards[3].cards.map((c) => [c.span, c.grow]), [[6, undefined], [12, undefined]], 'cards inside a stack too');
  assert.deepEqual([before[0].span, before[0].cards[0].span, before[0].cards[1].grow, before[0].cards[3].cards[1].grow], [2, 3, true, true], 'the big-screen config is left as it was');
});

test('phoneView: every page of a view with tabs, no screen filling', () => {
  const view = { id: 'systems', title: 'Systems', pages: [{ id: 'a', title: 'A', fill: true, sections: [{ span: 3, cards: [{ type: 'kpi', span: 2 }] }] }, { id: 'b', title: 'B', sections: [] }] };
  const v = phoneView(view);
  assert.deepEqual([v.id, v.title, v.pages.length], ['systems', 'Systems', 2]);
  assert.deepEqual([v.pages[0].id, v.pages[0].fill, v.pages[0].reflowed, v.pages[0].sections[0].span, v.pages[0].sections[0].cards[0].span], ['a', false, true, 1, 6]);
  assert.equal(view.pages[0].fill, true);
});

// ---- show rules: what decides whether a card's cell is shown ----
const { test: shows } = await load('core/layout.js'), ST = await load('core/store.js');
ST.applyEntities({ a: { 'sensor.t': { s: '21.5', a: {} }, 'binary_sensor.door': { s: 'on', a: {} }, 'sensor.gone': { s: 'unavailable', a: {} } } });

test('show: state and not take one state or a list', () => {
  assert.equal(shows({ entity: 'binary_sensor.door', state: 'on' }), true);
  assert.equal(shows({ entity: 'binary_sensor.door', state: ['off', 'unavailable'] }), false);
  assert.equal(shows({ entity: 'binary_sensor.door', not: 'off' }), true);
  assert.equal(shows({ entity: 'binary_sensor.door', not: ['on', 'unavailable'] }), false);
});

test('show: below and above compare the number, and never hold at the limit itself', () => {
  assert.equal(shows({ entity: 'sensor.t', above: 21 }), true);
  assert.equal(shows({ entity: 'sensor.t', above: 21.5 }), false);
  assert.equal(shows({ entity: 'sensor.t', below: 21.5 }), false);
  assert.equal(shows({ entity: 'sensor.t', above: 20, below: 22 }), true);
});

test('show: an entity that is missing, or reports no number, shows nothing', () => {
  assert.equal(shows({ entity: 'sensor.nowhere', not: 'off' }), false, 'no such entity');
  assert.equal(shows({ entity: 'sensor.gone', above: 0 }), false);
  assert.equal(shows({ entity: 'sensor.gone', below: 100 }), false);
  assert.equal(shows({ entity: 'sensor.gone', state: 'unavailable' }), true, 'its state can still be asked for by name');
});

test('show: when is the config\'s own answer', () => {
  assert.equal(shows({ when: () => 1 }), true);
  assert.equal(shows({ when: () => '' }), false);
});
