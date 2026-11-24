// Cameras and Frigate: when a failed stream is tried again, what a camera alert shows, the signed-address cache.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load, override } from './stub.mjs';

let asked = 0, refuse = false;
override('core/ha.js', { signPath: (path) => { asked++; return refuse ? Promise.reject('offline') : Promise.resolve(path + '?authSig=x'); } });
const { retryIn } = await load('cards/camera.js');
const { showing } = await load('core/alerts.js');
const F = await load('core/frigate.js');

test('camera: a start that fails is tried again after 3 s, then twice as long each time, 30 s at most', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 50, 5000].map(retryIn), [3000, 6000, 12000, 24000, 30000, 30000, 30000, 30000]);
});

test('camera alert: what the viewer closed stays away, the rest shows', () => {
  const none = new Set();
  assert.deepEqual(showing({ grid: true, ids: ['a', 'b'] }, none), { grid: true, ids: ['a', 'b'] });
  // a and b alerting, closed; a's alert ends: b does not come back
  const closed = new Set(['a', 'b']);
  assert.deepEqual(showing({ grid: false, ids: ['b'] }, closed), { grid: false, ids: [] });
  // a new camera's alert shows by itself, the grid closed earlier stays closed
  closed.add('grid');
  assert.deepEqual(showing({ grid: true, ids: ['b', 'c'] }, closed), { grid: false, ids: ['c'] });
  // b's next alert takes it off the list (the card does that when the alert starts)
  closed.delete('b');
  assert.deepEqual(showing({ grid: false, ids: ['b'] }, closed), { grid: false, ids: ['b'] });
});

test('signed addresses: one request per path while it lasts, expired ones are dropped, a failure is not kept', async () => {
  const real = Date.now; let now = real.call(Date); Date.now = () => now;
  try {
    const n0 = F.signedCount(); asked = 0;
    const a = F.sign('/thumb/1', 1), again = F.sign('/thumb/1', 1);
    assert.equal(a, again); assert.equal(asked, 1); assert.match(await a, /\/thumb\/1\?authSig=x$/);
    for (let i = 2; i <= 50; i++) F.sign('/thumb/' + i, 1);
    F.sign('/vod/long', 4);
    assert.equal(F.signedCount(), n0 + 51);
    now += 2 * 3600e3;   // the one-hour addresses are over, the four-hour one is not
    F.sign('/thumb/new', 1);
    assert.equal(F.signedCount(), n0 + 2, 'only the addresses that still work are kept');
    asked = 0; F.sign('/vod/long', 4); assert.equal(asked, 0, 'still cached');
    F.sign('/thumb/1', 1); assert.equal(asked, 1, 'asked for again once it has expired');
    refuse = true; const before = F.signedCount();
    await assert.rejects(F.sign('/thumb/fails', 1)); await new Promise((r) => setImmediate(r));
    assert.equal(F.signedCount(), before, 'a refused address is not cached');
  } finally { Date.now = real; refuse = false; }
});

test('fmtDur: whole seconds, then minutes', () => {
  assert.equal(F.fmtDur(0.2), '1 s'); assert.equal(F.fmtDur(59.4), '59 s'); assert.equal(F.fmtDur(59.7), '1 min');
  assert.equal(F.fmtDur(80), '1 min'); assert.equal(F.fmtDur(95), '1 min 35 s'); assert.equal(F.fmtDur(119.6), '2 min'); assert.equal(F.fmtDur(599.9), '10 min');
});
