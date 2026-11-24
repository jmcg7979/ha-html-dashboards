// core/layers.js: which layer is on top, what Back closes, what goes with what. The elements are stand-ins that answer
// only what the registry asks of one (on the page? hidden? what is inside it?).
import test from 'node:test'; import assert from 'node:assert/strict';
import { load } from './stub.mjs';

const L = await load('core/layers.js');
let focused = null;
Object.defineProperty(document, 'activeElement', { get: () => focused, configurable: true });
const events = [];
addEventListener('dash:layers', (e) => events.push(e.detail));

// an element: `inside` = the element it is in; hidden when it or anything around it is
function el(name, inside = null) {
  const x = { name, isConnected: true, hidden: false, inside,
    closest: (sel) => { assert.equal(sel, '[hidden]'); for (let p = x; p; p = p.inside) if (p.hidden) return p; return null; },
    contains: (o) => { for (let p = o; p; p = p.inside) if (p === x) return true; return false; },
  };
  return x;
}
// a layer whose close() shuts it, as an owner's does
function make(name, kind, more = {}) {
  const e = more.el || el(name, more.inside), l = L.layer({ el: e, kind, aside: more.aside, rank: more.rank, close: () => { l.closedBy = (l.closedBy || 0) + 1; e.hidden = true; l.shut(); } });
  return l;
}
const names = () => L.layers().map((l) => l.el.name);
const reset = () => { L.closeAll(); focused = null; events.length = 0; assert.deepEqual(names(), []); };

test('the one opened last is on top; the alarm, the confirm dialog and a camera alert go above whatever opens after them, in that order', () => {
  reset();
  const drawer = make('drawer', 'drawer'), popup = make('popup', 'popup'), alarm = make('alarm', 'takeover', { rank: 4 }), ask = make('ask', 'dialog'), cam = make('camalert', 'takeover');
  drawer.open(); popup.open();
  assert.deepEqual(names(), ['popup', 'drawer']);
  alarm.open(); cam.open(); ask.open();
  const later = make('later', 'popup'); later.open();
  assert.deepEqual(names(), ['alarm', 'ask', 'camalert', 'later', 'popup', 'drawer']);
  assert.equal(L.top(), alarm);
  assert.equal(L.any(), true);
});

test('Back closes one layer at a time, the top one first', () => {
  reset();
  const popup = make('popup', 'popup'), ask = make('ask', 'dialog'), alarm = make('alarm', 'takeover', { rank: 4 });
  popup.open(); ask.open(); alarm.open();
  assert.equal(L.back(), true); assert.deepEqual(names(), ['ask', 'popup']);
  assert.equal(L.back(), true); assert.deepEqual(names(), ['popup']);
  assert.equal(L.back(), true); assert.deepEqual(names(), []);
  assert.equal(L.back(), false, 'nothing open: Back is the page\'s');
  assert.deepEqual([popup.closedBy, ask.closedBy, alarm.closedBy], [1, 1, 1]);
});

test('a take-over in the corner never holds the screen, and Back still closes it first', () => {
  reset();
  const popup = make('popup', 'popup'), corner = make('corner', 'takeover', { aside: true });
  assert.equal(L.top(), null);
  corner.open();
  assert.equal(L.top(), null, 'the page keeps the highlight');
  assert.equal(L.any(), true);
  popup.open();
  assert.equal(L.top(), popup);
  L.back();
  assert.deepEqual(names(), ['popup']);
});

test('a hidden layer does not count, and counts again when it shows; one taken off the page is forgotten', () => {
  reset();
  const popup = make('popup', 'popup'), menu = make('menu', 'menu');
  popup.open(); menu.open();
  menu.el.hidden = true;
  assert.equal(L.top(), popup);
  menu.el.hidden = false;
  assert.equal(L.top(), menu);
  menu.el.isConnected = false;
  assert.equal(L.top(), popup);
  assert.equal(menu.on, false);
});

test('a card\'s own menus are layers like any other: the innermost opened last, each closed by Back in turn, its opener given', () => {
  reset();
  const popup = make('popup', 'popup'), queue = make('queue', 'menu', { inside: popup.el }), song = make('song-menu', 'menu', { inside: queue.el });
  const pill = el('queue-button', popup.el), row = el('song-row', queue.el), other = el('somewhere-else', popup.el);
  popup.open(); focused = pill; queue.open(); focused = other; song.open(row);   // opened for the row that was tapped, wherever the focus is
  assert.deepEqual(names(), ['song-menu', 'queue', 'popup']);
  events.length = 0; L.back();
  assert.deepEqual([names(), events[0].closed, events[0].opener], [['queue', 'popup'], song, row]);
  song.open(row); queue.el.hidden = true;   // a layer that is hidden without a word does not count, nor what is in it
  assert.deepEqual(names(), ['popup']);
  queue.el.hidden = false; events.length = 0; queue.close();
  assert.deepEqual(events.map((e) => [e.closed.el.name, e.opener && e.opener.name]), [['song-menu', 'song-row'], ['queue', 'queue-button']], 'the menu inside goes with it, first');
});

test('what was opened from inside a layer closes with it', () => {
  reset();
  const popup = make('popup', 'popup');
  popup.open();
  const chip = el('chip', popup.el); focused = chip;
  const pick = make('pick', 'menu');   // its element is on the body: only its opener says where it came from
  pick.open();
  const cam = make('cam', 'camera', { inside: popup.el }); cam.open();
  const other = make('other', 'drawer'); focused = null; other.open();
  popup.close();
  assert.deepEqual(names(), ['other']);
  assert.deepEqual([pick.closedBy, cam.closedBy, other.closedBy], [1, 1, undefined]);
});

test('open and shut are told once each, with the element that had the focus as the opener', () => {
  reset();
  const tile = el('tile'), popup = make('popup', 'popup');
  focused = tile;
  popup.open(); popup.open();
  popup.shut(); popup.shut();
  assert.equal(events.length, 2);
  assert.equal(events[0].opened, popup);
  assert.equal(events[1].closed, popup);
  assert.equal(events[1].opener, tile);
});

test('Home: everything closes but what is kept', () => {
  reset();
  const popup = make('popup', 'popup'), alarm = make('alarm', 'takeover'), menu = make('menu', 'menu', { inside: popup.el });
  popup.open(); alarm.open(); menu.open();
  L.closeAll((l) => l.kind === 'takeover');
  assert.deepEqual(names(), ['alarm']);
  assert.equal(menu.closedBy, 1);
});

test('a take-over or the dialog that came up while the highlight was in a layer stays when that layer closes', () => {
  reset();
  const popup = make('popup', 'popup');
  popup.open();
  focused = el('button', popup.el);
  const alarm = make('alarm', 'takeover', { rank: 4 }), cam = make('camalert', 'takeover'), ask = make('ask', 'dialog');
  alarm.open(); cam.open(); ask.open();
  L.closeAll((l) => l.kind === 'takeover' || l.kind === 'dialog');   // Home, say
  assert.deepEqual(names(), ['alarm', 'ask', 'camalert']);
  assert.deepEqual([alarm.closedBy, cam.closedBy, ask.closedBy], [undefined, undefined, undefined], 'nobody answered them');
  focused = el('stop', alarm.el);
  const again = make('camalert2', 'takeover'); again.open();
  alarm.close();
  assert.equal(again.closedBy, undefined, 'stopping the timer does not dismiss the camera alert that came during it');
});

test('a layer does not remember its opener past its closing', () => {
  reset();
  const popup = make('popup', 'popup'), pick = make('pick', 'menu');
  popup.open();
  focused = el('chip', popup.el); pick.open(); pick.close();
  focused = null; pick.el.hidden = false; pick.open();   // opened again, from the page this time
  popup.close();
  assert.deepEqual(names(), ['pick']);
});

test('holding: a pop-up, a camera, the dialog or a take-over keeps the page from reloading; a menu or the drawer left open does not', () => {
  reset();
  const drawer = make('drawer', 'drawer'), menu = make('menu', 'menu'), sheet = make('more', 'sheet');
  drawer.open(); menu.open(); sheet.open();
  assert.equal(L.any(), true); assert.equal(L.holding(), false);
  for (const kind of ['popup', 'camera', 'dialog', 'takeover']) { const l = make(kind, kind); l.open(); assert.equal(L.holding(), true, kind); l.close(); }
  assert.equal(L.holding(), false);
});

test('an owner whose close throws does not stop the others from closing, and the closing is still told', () => {
  reset();
  const popup = make('popup', 'popup'), bad = L.layer({ el: el('bad', popup.el), kind: 'camera', close: () => { throw new Error('close failed (this test means it to)'); } });
  const cam = make('cam', 'camera', { inside: popup.el });
  popup.open(); bad.open(); cam.open(); events.length = 0;
  const say = console.error; console.error = () => {};
  const alone = L.layer({ el: el('alone'), kind: 'menu', close: () => { throw new Error('close failed (this test means it to)'); } });
  try {
    popup.close();
    alone.open(); assert.equal(L.back(), true, 'Back on one that throws is still Back, not the page\'s');
  } finally { console.error = say; }
  assert.equal(cam.closedBy, 1);
  assert.ok(events.some((e) => e.closed === popup));
  alone.shut();
});

test('changed is told only while the layer is open', () => {
  reset();
  const cam = make('camalert', 'takeover');
  cam.changed(); assert.equal(events.length, 0);
  cam.open(); cam.changed();
  assert.equal(events[1].changed, cam);
});
