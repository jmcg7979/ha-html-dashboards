// core/spark.js: the one history request a screen's traces share. The connection is replaced, so nothing is sent.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load, override } from './stub.mjs';

const asked = []; let fail = true, online = true; const ready = new Set();
override('core/ha.js', { connected: () => online, onReady: (fn) => ready.add(fn),
  request: (msg) => { asked.push(msg.entity_ids); return fail ? Promise.reject(new Error('offline')) : Promise.resolve(Object.fromEntries(msg.entity_ids.map((id) => [id, [{ s: '5', lu: Date.now() / 1000 - 60 }]]))); } });
const { want, retry } = await load('core/spark.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// However a test ends, no request is left failing: a failed one is asked again on a timer, for ever, and this file's
// process would never end (a failed assertion would show as a run that hangs, not as a failure).
test.after(() => { fail = false; online = false; ready.clear(); });

test('a history request that fails is made again, and the traces waiting for it are drawn then', async () => {
  retry.ms = 40; let drawn = 0;
  want('sensor.a', () => drawn++); want('sensor.b', () => drawn++);
  await wait(60);
  assert.deepEqual(asked, [['sensor.a', 'sensor.b']], 'one request for both'); assert.equal(drawn, 0);
  fail = false; await wait(80);
  assert.deepEqual(asked[1], ['sensor.a', 'sensor.b'], 'asked again after the wait'); assert.equal(drawn, 2);
});

test('with the connection down it is asked again when the connection is back, not before', async () => {
  retry.ms = 20; fail = true; asked.length = 0; let drawn = 0;
  want('sensor.c', () => drawn++);
  await wait(50); assert.equal(asked.length, 1);
  online = false; await wait(60);
  assert.equal(asked.length >= 1 && drawn === 0, true); const n = asked.length;
  await wait(60); assert.equal(asked.length, n, 'no requests while offline');
  online = true; fail = false; ready.forEach((fn) => fn()); await wait(10);
  assert.equal(drawn, 1);
});

test('thinning keeps each bucket\'s lowest and highest reading, so a short spike counts in the day\'s low and high', async () => {
  const { thin, extremes } = await load('core/spark.js');
  const pts = Array.from({ length: 1000 }, (_, i) => [i * 1000, i === 500 ? 100 : 20]);
  const out = thin(pts, 96);
  assert.equal(out.length <= 96, true);
  assert.deepEqual(extremes(out), { lo: 20, hi: 100 });
  assert.equal(Math.max(...out.map((p) => p[1])) < 100, true);   // the drawn averages alone would have lost it
  assert.deepEqual(extremes(thin(out, 10)), { lo: 20, hi: 100 });   // and thinning again keeps it
});
