// core/assess.js: OK / Attention / Problem for one system, from its metrics, checks and updates.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load, frames } from './stub.mjs';

const { metricLevel, assess, nodeIds, wait } = await load('core/assess.js'), S = await load('core/store.js');
wait.ms = 0;   // an entity HA has nothing for counts as not reporting at once (a page gives it a few seconds to arrive)
const set = (states) => S.applyEntities({ a: Object.fromEntries(Object.entries(states).map(([id, v]) => [id, Array.isArray(v) ? { s: String(v[0]), a: v[1], lc: 1 } : { s: String(v), lc: 1 }])) });

test('metricLevel: at the limit counts; a missing reading is not a problem', () => {
  const m = { warn: 80, crit: 90 };
  assert.equal(metricLevel(m, 79.9), 0); assert.equal(metricLevel(m, 80), 1); assert.equal(metricLevel(m, 89.9), 1); assert.equal(metricLevel(m, 90), 2); assert.equal(metricLevel(m, NaN), 0);
  assert.equal(metricLevel({ warn: 80 }, 99), 1, 'no crit limit: never more than attention'); assert.equal(metricLevel({}, 99), 0);
});
test('metricLevel: invert = low is bad (a battery, free space)', () => {
  const m = { warn: 20, crit: 10, invert: true };
  assert.equal(metricLevel(m, 21), 0); assert.equal(metricLevel(m, 20), 1); assert.equal(metricLevel(m, 10), 2); assert.equal(metricLevel(m, 0), 2);
});

test('assess: the worst reason sets the level, each reason says what and how much', () => {
  set({ 'sensor.cpu': 93.4, 'sensor.mem': 85, 'sensor.temp': 40, 'sensor.raw': 0.97, 'sensor.off': 'unavailable' });
  const r = assess({ name: 'NAS', metrics: [
    { name: 'CPU', entity: 'sensor.cpu', warn: 70, crit: 90 }, { name: 'Memory', label: 'NAS memory', entity: 'sensor.mem', warn: 80, crit: 92 },
    { name: 'Temp', entity: 'sensor.temp', unit: '°', warn: 60, crit: 70 }, { name: 'Disk', entity: 'sensor.raw', scale: 100, warn: 90, crit: 99 },
    { name: 'Gone', entity: 'sensor.off', warn: 1, crit: 2 }, { name: 'Never', entity: 'sensor.none', warn: 1, crit: 2 }] });
  assert.equal(r.level, 2);
  assert.deepEqual(r.reasons, [{ level: 2, kind: 'metric', text: 'CPU 93%' }, { level: 1, kind: 'metric', text: 'NAS memory 85%' }, { level: 1, kind: 'metric', text: 'Disk 97%' },
    { level: 1, kind: 'silent', text: 'NAS: Gone, Never not reporting' }]);
  assert.deepEqual(assess({ name: 'x', metrics: [{ name: 'Temp', entity: 'sensor.temp', unit: '°', warn: 30, crit: 70 }] }).reasons, [{ level: 1, kind: 'metric', text: 'Temp 40°' }]);
});

test('assess: checks by list or by function', () => {
  set({ 'sensor.vol': 'degraded', 'binary_sensor.link': 'off', 'sensor.raid': 'normal', 'sensor.count': 3 });
  const r = assess({ name: 'NAS', checks: [
    { entity: 'sensor.vol', ok: ['normal'], label: 'Volume' }, { entity: 'binary_sensor.link', ok: ['on'], level: 'warn' }, { entity: 'sensor.raid', ok: ['normal'] },
    { entity: 'sensor.count', ok: (e) => +e.state === 0, text: (e) => `${e.state} stopped` }, { entity: undefined, ok: ['on'] }] });
  assert.deepEqual(r, { level: 2, reasons: [{ level: 2, kind: 'check', text: 'Volume degraded' }, { level: 1, kind: 'check', text: 'NAS off' }, { level: 2, kind: 'check', text: '3 stopped' }] });
});

// ---- not reporting: unavailable, unknown, or an entity HA does not have ----
const silentOf = (node) => assess(node).reasons.filter((r) => r.kind === 'silent');
test('not reporting: never OK, never the check\'s own problem text, always Attention', () => {
  set({ 'binary_sensor.oom': 'unavailable', 'binary_sensor.restart': 'unknown', 'sensor.cpu2': 'unavailable', 'sensor.ok': 5, 'update.gone': 'unavailable' });
  const seen = [];
  const oom = { entity: 'binary_sensor.oom', ok: ['off'], name: 'memory check', text: () => 'ran out of memory' };
  const restart = { entity: 'binary_sensor.restart', name: 'restart check', ok: (e) => { seen.push(e.state); return e.state !== 'on'; }, text: () => 'needs a restart' };
  for (const [what, node, text] of [
    ['a list check with its own text', { name: 'Box', checks: [oom], metrics: [{ name: 'Load', entity: 'sensor.ok', warn: 9 }] }, 'Box memory check not reporting'],
    ['a function check', { name: 'Box', checks: [restart], metrics: [{ name: 'Load', entity: 'sensor.ok', warn: 9 }] }, 'Box restart check not reporting'],
    ['a check with only a label', { name: 'Box', checks: [{ entity: 'binary_sensor.oom', ok: ['off'], label: 'Volume' }], metrics: [{ name: 'Load', entity: 'sensor.ok', warn: 9 }] }, 'Volume not reporting'],
    ['a check with no name at all', { name: 'Box', checks: [{ entity: 'binary_sensor.oom', ok: ['off'] }], metrics: [{ name: 'Load', entity: 'sensor.ok', warn: 9 }] }, 'Box status not reporting'],
    ['a metric', { name: 'Box', metrics: [{ name: 'CPU', label: 'Box CPU', entity: 'sensor.cpu2', warn: 1 }, { name: 'Load', entity: 'sensor.ok', warn: 9 }] }, 'Box CPU not reporting'],
    ['an entity HA does not have', { name: 'Box', metrics: [{ name: 'CPU', entity: 'sensor.nowhere', warn: 1 }, { name: 'Load', entity: 'sensor.ok', warn: 9 }] }, 'CPU not reporting'],
    ['an update', { name: 'Box', updates: [{ entity: 'update.gone', label: 'Box firmware' }], metrics: [{ name: 'Load', entity: 'sensor.ok', warn: 9 }] }, 'Box firmware update not reporting'],
  ]) assert.deepEqual(assess(node), { level: 1, reasons: [{ level: 1, kind: 'silent', text }] }, what);
  assert.deepEqual(seen, [], 'a check function only ever sees a real state');
});
test('not reporting: one line per node, by name when all of it is silent', () => {
  set({ 'sensor.a': 'unavailable', 'sensor.b': 'unavailable', 'sensor.c': 'unknown', 'sensor.d': 'unavailable', 'sensor.e': 'unavailable', 'binary_sensor.s': 'unavailable', 'sensor.fine': 3 });
  const m = (name, entity) => ({ name, entity, warn: 50, crit: 90 });
  const all = { name: 'Proxmox', metrics: [m('CPU', 'sensor.a'), m('Memory', 'sensor.b'), m('Disk', 'sensor.c')], checks: [{ entity: 'binary_sensor.s', ok: ['on'], text: () => 'Server offline' }], updates: [{ entity: 'update.never', label: 'Packages' }] };
  assert.deepEqual(assess(all), { level: 1, reasons: [{ level: 1, kind: 'silent', text: 'Proxmox not reporting' }] });
  assert.deepEqual(silentOf({ name: 'Proxmox', metrics: [m('CPU', 'sensor.a'), m('Memory', 'sensor.b'), m('Load', 'sensor.fine')] }).map((r) => r.text), ['Proxmox: CPU, Memory not reporting']);
  assert.deepEqual(silentOf({ name: 'Proxmox', metrics: [m('CPU', 'sensor.a'), m('Memory', 'sensor.b'), m('Disk', 'sensor.c'), m('Temp', 'sensor.d'), m('Fan', 'sensor.e'), m('Load', 'sensor.fine')] }).map((r) => r.text),
    ['Proxmox: CPU, Memory, Disk and 2 more not reporting']);
  assert.deepEqual(silentOf({ metrics: [m('CPU', 'sensor.a'), m('Memory', 'sensor.b')] }).map((r) => r.text), ['CPU, Memory not reporting'], 'a node without a name');
});
test('not reporting: a machine that says it is off does not also list what went silent with it', () => {
  set({ 'binary_sensor.run': 'off', 'sensor.cpu3': 'unavailable', 'sensor.mem3': 'unavailable', 'binary_sensor.warn': 'on', 'sensor.hot': 99 });
  const metrics = [{ name: 'CPU', entity: 'sensor.cpu3', warn: 50 }, { name: 'Memory', entity: 'sensor.mem3', warn: 50 }];
  assert.deepEqual(assess({ name: 'Frigate', metrics, checks: [{ entity: 'binary_sensor.run', ok: ['on'], text: () => 'Frigate stopped' }] }),
    { level: 2, reasons: [{ level: 2, kind: 'check', text: 'Frigate stopped' }] });
  // an Attention check or a metric over its limit is no reason to keep quiet about the rest
  assert.equal(silentOf({ name: 'Frigate', metrics, checks: [{ entity: 'binary_sensor.warn', ok: ['off'], level: 'warn', text: () => 'needs a restart' }] }).length, 1);
  assert.equal(silentOf({ name: 'Frigate', metrics: [...metrics, { name: 'Temp', entity: 'sensor.hot', warn: 50, crit: 90 }] }).length, 1);
});
test('not reporting: an entity that has not arrived yet gets a moment before it counts', async () => {
  set({ 'sensor.here': 1 });
  const node = { name: 'Box', metrics: [{ name: 'Late', entity: 'sensor.late', warn: 50 }, { name: 'Here', entity: 'sensor.here', warn: 50 }] };
  let redrawn = 0; S.watch(['sensor.late'], () => { redrawn++; }); redrawn = 0;
  wait.ms = 60;
  try {
    assert.deepEqual(assess(node), { level: 0, reasons: [] }, 'within the wait: nothing yet');
    await new Promise((r) => setTimeout(r, 120)); frames.run();
    assert.equal(redrawn, 1, 'the cards watching it are redrawn when the wait is over');
    assert.deepEqual(assess(node).reasons.map((r) => r.text), ['Late not reporting']);
    set({ 'sensor.late': 7 });
    assert.deepEqual(assess(node), { level: 0, reasons: [] }, 'it arrived');
  } finally { wait.ms = 0; }
});

test('assess: an update is attention, named by version unless the version is an image digest', () => {
  set({ 'update.a': ['on', { latest_version: '2026.11.2' }], 'update.b': ['on', { latest_version: 'sha256:0a1b2c' }], 'update.c': ['off', { latest_version: '1.0' }], 'update.d': ['on', { latest_version: 'Core 17' }] });
  const r = assess({ name: 'HA', updates: [{ entity: 'update.a', label: 'Core' }, { entity: 'update.b', label: 'Frigate' }, { entity: 'update.c', label: 'OS' }, { entity: 'update.d', label: 'Core' }, { entity: undefined, label: 'X' }] });
  assert.equal(r.level, 1);
  assert.deepEqual(r.reasons.map((x) => x.text), ['Core 2026.11.2 available', 'Frigate update available', 'Core 17 available']);
});

test('assess: nothing wrong', () => {
  set({ 'sensor.fine': 10 });
  assert.deepEqual(assess({ name: 'x', metrics: [{ name: 'CPU', entity: 'sensor.fine', warn: 70, crit: 90 }], checks: [], updates: [] }), { level: 0, reasons: [] });
  assert.deepEqual(assess({ name: 'bare' }), { level: 0, reasons: [] });
});

test('nodeIds: every entity a node depends on', () => {
  assert.deepEqual(nodeIds({ up: 'sensor.up', metrics: [{ entity: 'sensor.cpu' }], checks: [{ entity: 'sensor.vol' }], updates: [{ entity: 'update.a' }], watch: ['sensor.extra', null] }),
    ['sensor.up', 'sensor.cpu', 'sensor.vol', 'update.a', 'sensor.extra']);
  assert.deepEqual(nodeIds({}), []);
});
