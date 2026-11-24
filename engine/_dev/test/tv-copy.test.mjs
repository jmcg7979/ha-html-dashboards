// core/layout.js tvCopy: a TV's copy of a view, section, card or pop-up, from what each says of itself as `tv`.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load } from './stub.mjs';

const { tvCopy } = await load('core/layout.js');

test('tv: false drops, tv: { } overrides, at any depth; nothing else changes and the source is left alone', () => {
  const view = { id: 'v', pages: [{ id: 'p', sections: [
    { span: 2, rows: 'auto 1fr', tv: { rows: '1fr' }, cards: [
      { type: 'kpi', label: 'A', tv: false },
      { type: 'chart', title: 'B', height: 250, tv: { height: 320 } },
      { type: 'stack', cards: [{ type: 'label', text: 'x', tv: false }, { type: 'tile', name: 'y' }] },
      { type: 'host', controls: { a: 1 }, tv: { controls: undefined, compact: true }, facts: [{ label: 'Temps (CPU · board)', tv: { label: 'Temps' } }, { label: 'Gone', tv: false }, { label: 'Kept' }] },
    ] },
    { span: 1, tv: false, cards: [{ type: 'tile' }] }] }] };
  const before = JSON.stringify(view), out = tvCopy(view);
  assert.equal(JSON.stringify(view), before, 'the big-screen config is not touched');
  assert.deepEqual(out, { id: 'v', pages: [{ id: 'p', sections: [{ span: 2, rows: '1fr', cards: [
    { type: 'chart', title: 'B', height: 320 },
    { type: 'stack', cards: [{ type: 'tile', name: 'y' }] },
    { type: 'host', controls: undefined, compact: true, facts: [{ label: 'Temps' }, { label: 'Kept' }] }] }] }] });
  assert.equal(JSON.stringify(out).includes('"tv"'), false, 'no tag is left on the copy');
});

test('a pop-up with pages or cards, a thing with no tag, and nothing at all', () => {
  assert.deepEqual(tvCopy({ title: 'P', pages: [{ title: 'One', cards: [{ type: 'chart', tv: false }, { type: 'dial' }] }] }), { title: 'P', pages: [{ title: 'One', cards: [{ type: 'dial' }] }] });
  const plain = { title: 'Q', cards: [{ type: 'tile', tap: { nav: '#x' } }] }; assert.deepEqual(tvCopy(plain), plain);
  assert.equal(tvCopy({ type: 'kpi', tv: false }), null); assert.equal(tvCopy(null), null); assert.equal(tvCopy(undefined), undefined);
});
