// The Systems and printer cards' own logic: what a tray, a printer, a chart axis and a page's health definitions make of
// their entities, most of all when an entity has nothing to say.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load } from './stub.mjs';

const S = await load('core/store.js'), A = await load('core/assess.js');
const { tray } = await load('cards/ams.js'), { statusOf } = await load('cards/print-job.js'), { niceStep, stepDecimals } = await load('cards/chart.js');
const { jobKey } = await load('cards/prints.js');
const { proxmoxNodes } = await load('pages/proxmox.js'), { dockerNodes, dockerMap } = await load('pages/docker.js');
A.wait.ms = 0;
const set = (states) => S.applyEntities({ a: Object.fromEntries(Object.entries(states).map(([id, v]) => [id, Array.isArray(v) ? { s: String(v[0]), a: v[1], lc: 1 } : { s: String(v), lc: 1 }])) });

test('AMS tray: loaded, empty, and a tray the printer says nothing about', () => {
  set({ 'sensor.t1': ['Bambu PLA Basic', { color: '#00ff00ff', type: 'PLA', active: true, remain: 80 }], 'sensor.t2': ['Empty', { empty: true }], 'sensor.t3': ['unavailable', {}], 'sensor.t4': ['unknown', { type: 'PETG', color: '#112233ff' }] });
  const t1 = tray('sensor.t1'); assert.equal(t1.empty, false); assert.equal(t1.nodata, false); assert.equal(t1.type, 'PLA'); assert.equal(t1.active, true); assert.equal(t1.remain, 80);
  const t2 = tray('sensor.t2'); assert.equal(t2.empty, true); assert.equal(t2.nodata, false, 'a tray that is really empty says Empty');
  for (const id of ['sensor.t3', 'sensor.none']) { const t = tray(id); assert.equal(t.nodata, true, id); assert.equal(t.active, false); assert.equal(t.remain, null); }
  const t4 = tray('sensor.t4'); assert.equal(t4.nodata, false); assert.notEqual(t4.name, 'unknown', 'a state of "unknown" is not a filament name');
});

test('printer status: Ready only when the printer says idle', () => {
  set({ 'sensor.p_idle': 'idle', 'sensor.p_gone': 'unavailable', 'binary_sensor.p_on': 'on', 'binary_sensor.p_off': 'off' });
  assert.equal(statusOf({ status: 'sensor.p_idle' }), 'idle');
  assert.equal(statusOf({ status: 'sensor.p_gone' }), 'unknown'); assert.equal(statusOf({ status: 'sensor.p_missing' }), 'unknown', 'an entity HA does not have');
  assert.equal(statusOf({ status: 'sensor.p_gone', online: 'binary_sensor.p_on' }), 'unknown'); assert.equal(statusOf({ status: 'sensor.p_gone', online: 'binary_sensor.p_off' }), 'offline');
});

test('chart axis: every gridline is at the value its label shows', () => {
  for (const raw of [0.03, 0.12, 0.3, 0.6, 1.2, 2.05, 2.4, 3, 7, 24, 130]) {
    const step = niceStep(raw), sd = stepDecimals(step);
    assert.ok(step >= raw && step <= raw * 2.5 + 1e-9, `${raw} -> ${step}`);
    for (let k = -3; k <= 12; k++) assert.ok(Math.abs(+(k * step).toFixed(sd) - k * step) < 1e-9, `step ${step}: ${k * step} is labeled ${(k * step).toFixed(sd)}`);
  }
  assert.equal(stepDecimals(5), 0); assert.equal(stepDecimals(0.5), 1); assert.equal(stepDecimals(0.02), 2);
});

test('prints: the same print read twice (a second apart) is one print', () => {
  assert.equal(jobKey({ start: 1763000010 }), jobKey({ start: 1763000011 })); assert.notEqual(jobKey({ start: 1763000010 }), jobKey({ start: 1763000300 }));
});

test('Proxmox: the VM that runs this HA is the one flagged self, whatever it is called', () => {
  set({ 'update.core': ['on', { latest_version: '2026.12.0' }], 'sensor.px_status': 'online', 'sensor.vm1': 'running', 'sensor.vm2': 'running' });
  const vm = (name, p, extra) => ({ name, p, icon: 'x', status: p === 'ha' ? 'sensor.vm1' : 'sensor.vm2', guest: {}, ...extra });
  const { vms } = proxmoxNodes({ status: 'sensor.px_status', vms: [vm('HA', 'ha', { self: true }), vm('Other', 'haos')] }, { updates: [['Core', 'update.core']] });
  assert.deepEqual(vms[0].updates, [{ entity: 'update.core', label: 'Core' }]); assert.deepEqual(vms[1].updates, []);
  assert.deepEqual(A.assess(vms[0]).reasons.map((r) => r.text), ['Core 2026.12.0 available']);
});

test('Proxmox: a host with nothing reporting is one Attention line, not "SSD health problem"', () => {
  set({ 'sensor.h_status': 'unavailable', 'sensor.h_cpu': 'unavailable', 'sensor.h_mem': 'unavailable', 'binary_sensor.h_ssd': 'unavailable', 'binary_sensor.h_agent': 'unavailable', 'binary_sensor.h_restart': 'unavailable' });
  const { proxmox } = proxmoxNodes({ status: 'sensor.h_status', cpu: 'sensor.h_cpu', mem: 'sensor.h_mem', drive: { health: 'binary_sensor.h_ssd' }, agent: 'binary_sensor.h_agent', restart: 'binary_sensor.h_restart', vms: [] }, { updates: [] });
  assert.deepEqual(A.assess(proxmox), { level: 1, reasons: [{ level: 1, kind: 'silent', text: 'Proxmox not reporting' }] });
  set({ 'sensor.h_status': 'online', 'sensor.h_cpu': 12, 'sensor.h_mem': 40, 'binary_sensor.h_agent': 'on', 'binary_sensor.h_restart': 'off' });
  assert.deepEqual(A.assess(proxmox).reasons.map((r) => r.text), ['Proxmox SSD health not reporting']);
});

test('Docker: a container nothing is known of is "not reporting"; a stopped one says stopped and no more', () => {
  const c = (n) => ({ name: n, cname: n.toLowerCase(), status: `switch.${n}`, health: `sensor.${n}_health`, oom: `binary_sensor.${n}_oom`, cpu: `sensor.${n}_cpu`, mem: `sensor.${n}_mem` });
  const DK = { containers: [c('Gone'), c('Stopped'), c('Fine')], glances: 'sensor.glances' };   // no `cores`: one is assumed
  set({ 'switch.Gone': 'unavailable', 'sensor.Gone_health': 'unavailable', 'binary_sensor.Gone_oom': 'unavailable', 'sensor.Gone_cpu': 'unavailable', 'sensor.Gone_mem': 'unavailable',
    'switch.Stopped': 'off', 'sensor.Stopped_health': 'unavailable', 'binary_sensor.Stopped_oom': 'unavailable', 'sensor.Stopped_cpu': 'unavailable', 'sensor.Stopped_mem': 'unavailable',
    'switch.Fine': 'on', 'sensor.Fine_health': 'healthy', 'binary_sensor.Fine_oom': 'off', 'sensor.Fine_cpu': 40, 'sensor.Fine_mem': 20,
    'sensor.glances': ['unavailable', { containers: { fine: { in: 3, out: 1 } } }] });
  const nodes = dockerNodes(DK);
  assert.deepEqual(A.assess(nodes[0]), { level: 1, reasons: [{ level: 1, kind: 'silent', text: 'Gone not reporting' }] });
  assert.deepEqual(A.assess(nodes[1]), { level: 2, reasons: [{ level: 2, kind: 'check', text: 'Stopped stopped' }] });
  assert.deepEqual(A.assess(nodes[2]), { level: 0, reasons: [] });
  const map = dockerMap(DK, nodes);
  assert.equal(map[0].metric(), 'Not reporting'); assert.equal(map[1].metric(), 'Stopped'); assert.equal(map[2].metric(), '40% CPU');
  assert.equal(map[2].flow.value(), 0, 'no traffic figure from a Glances sensor that is unavailable');
});
