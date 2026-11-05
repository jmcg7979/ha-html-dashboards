// Proxmox page + health rules, shared by every site, so the pages are the same by construction.
// A site supplies only entity ids and its hardware's temperature limits, in home.js `systems.proxmox` (PX) and
// `systems.ha` (HA): see sites/example/dash/home.js for the shape. Optional parts a site may not have (leave them out and their rows go):
//   PX.updates / restart / agent and a VM's guest.updates / reboot / agent (LNXlink agent), a VM's os (packages/vm_os_state.yaml),
//   a VM's power { restart, shut_down, start } (Proxmox button entities; needs VM.PowerMgmt), impact (what stops while it is
//   down), self: true (the VM running this HA: no Shut down, HA couldn't start it again),
//   PX.backup (Proxmox backup stamp; null = "Not set up"), PX.backup_store (backup folder size + count), PX.temps, PX.drive,
//   PX.storage, a VM's guest.disk, net_in / net_out, procs. PX.vms can be one VM.
// Entities come from HA's built-in Proxmox VE integration, the LNXlink agents (host + Ubuntu VM), packages/proxmox_disks.yaml,
// with the same ids at every site (engine/docs/integrations.md, "Proxmox").
import { st, num } from '../core/store.js';
import { cap } from '../core/dom.js';
import { ago } from '../cards/health.js';
import { call } from '../core/ha.js';
import { n0, whole, pct, of, rate, s, okState, upFor, gb, pxTime, mbit, mbps, degOf, tempTrend, meterOf, host, fact } from './common.js';
import { metric } from '../core/units.js';


// health definitions (core/assess.js): the Overview map, the attention list and these cards all use them
export function proxmoxNodes(PX, HA) {
  const L = PX.limits || {}, PT = PX.temps || {};   // in the site's unit, per site hardware: { cpu: [warn, crit], disk: [..], ram: [..], board: [..] } (a temp shows only with its limits)
  const temps = [
    { key: 'cpu', name: 'CPU temp', label: 'Server CPU temp' },
    { key: 'disk', name: 'SSD temp', label: 'SSD temperature' },
    { key: 'ram', name: 'RAM temp', label: 'Server RAM temp' },
    { key: 'board', name: 'Board temp', label: 'Server board temp' },
  ].filter((t) => PT[t.key] && L[t.key]).map((t) => ({ name: t.name, label: t.label, entity: PT[t.key], unit: '°', warn: L[t.key][0], crit: L[t.key][1] }));
  const proxmox = { name: 'Proxmox', icon: 'server', page: 'systems/proxmox', up: PX.up,
    metrics: [{ name: 'CPU', label: 'Server CPU', entity: PX.cpu, warn: 75, crit: 90 }, { name: 'Memory', label: 'Server memory', entity: PX.mem, warn: 85, crit: 95 },
      ...(PX.storage || []).map((x) => ({ name: x.name, entity: x.pct, warn: 80, crit: 92 })), ...temps],
    checks: [{ ...okState(PX.status, 'online'), label: 'Server' },
      ...(PX.drive && PX.drive.health ? [{ entity: PX.drive.health, ok: ['off'], text: () => 'SSD health problem' }] : []),
      // the host's agent: offline while Proxmox answers = no temperatures / packages (MQTT, or the agent itself)
      ...(PX.agent ? [{ entity: PX.agent, ok: (e) => e.state === 'on' || s(PX.status) !== 'online', level: 'warn', text: () => 'Server agent not reporting' }] : []),
      ...(PX.restart ? [{ entity: PX.restart, ok: (e) => e.state !== 'on', level: 'warn', text: () => 'Server needs a restart' }] : [])],
    watch: [PX.status] };
  const vms = PX.vms.map((v) => ({ name: v.name, icon: v.icon, page: 'systems/proxmox', up: v.up,
    metrics: [{ name: 'CPU', label: v.name + ' CPU', entity: v.guest.cpu || v.cpu, warn: 80, crit: 95 }, { name: 'Memory', label: v.name + ' memory', entity: v.guest.mem || v.mem, warn: 85, crit: 95 },
      ...(v.guest.disk ? [{ name: 'Disk', label: v.name + ' disk', entity: v.guest.disk, warn: 80, crit: 92 }] : [])],
    checks: [{ ...okState(v.status, 'running'), label: v.name },
      // the OS inside (packages/vm_os_state.yaml: Proxmox says running, the agent has been silent for minutes)
      ...(v.os ? [{ entity: v.os, ok: (e) => e.state !== 'not_responding', text: () => v.name + ': OS not responding' }] : []),
      // package status from the VM's agent, when the site has it
      ...(v.guest.reboot ? [{ entity: v.guest.reboot, ok: (e) => e.state !== 'on', level: 'warn', text: () => v.name + ' needs a restart' }] : [])],
    updates: v.p === 'haos' ? HA.updates.map(([label, entity]) => ({ entity, label })) : [] }));
  return { proxmox, vms, temps };
}

// ---- power operations ----
// What a VM is doing comes from HA (sensor.proxmox_<vm>_os_state: stopping / starting / not responding), so every screen
// shows it. This browser adds only what it alone knows: "… sent" until the first change, and "Restarted · took 52 s" at
// the end. Proxmox's figures reach HA every 60 s, so while an operation runs it asks HA to refresh them every 10 s.
// stopping: the agent dropped and Proxmox hasn't reported a new start yet (it may take 60 s), so a fast restart can be back
// before "starting" shows: the text doesn't claim which one it is unless this browser pressed the button
const OS_TEXT = { stopping: 'OS down · shutting down or restarting', starting: 'Booting · services starting', not_responding: 'OS not responding' };
const OS_OP = { restart: { stopping: 'Restarting · OS down', starting: 'Restarting · booting' }, shut_down: { stopping: 'Shutting down', starting: 'Booting · services starting' }, start: { stopping: 'Starting', starting: 'Booting · services starting' } };
const OS_BADGE = { stopping: 'OS down', starting: 'Starting' };
const ops = new Map();   // vm key -> { kind, t0, moved, done, text }
const POLL = 10e3, GIVE_UP = 6 * 60e3, SHOW_DONE = 90e3;
const dur = (ms) => { const t = Math.round(ms / 1000); return t < 60 ? `${t} s` : `${Math.floor(t / 60)} min ${t % 60} s`; };
const osOf = (v) => (v.os ? s(v.os) : null);
function startOp(v, kind) {
  const key = v.p, op = { kind, t0: Date.now(), text: { restart: 'Restart sent', shut_down: 'Shutdown sent', start: 'Start sent' }[kind] };
  ops.set(key, op);
  const end = (text, ms, failed) => { op.done = true; op.text = text; op.failed = failed; setTimeout(() => { if (ops.get(key) === op) ops.delete(key); }, ms); };
  const step = () => {
    if (ops.get(key) !== op || op.done) return;
    const running = s(v.status) === 'running', os = osOf(v), t = Date.now() - op.t0;
    const bt = new Date(s(v.up)), newBoot = !isNaN(bt) && bt.getTime() > op.t0 - 15e3;   // started after the press
    if (!running || newBoot || (os && os !== 'running')) op.moved = true;
    const up = running && (v.os ? os === 'running' : true);
    if (kind === 'restart' && op.moved && up && (newBoot || v.os)) return end(`Restarted · took ${dur(t)}`, SHOW_DONE);
    if (kind === 'shut_down' && !running) return end(`Shut down · took ${dur(t)}`, SHOW_DONE);
    if (kind === 'start' && op.moved && up) return end(`Started · took ${dur(t)}`, SHOW_DONE);
    if (t > GIVE_UP) return end('No change after 6 min: check Proxmox', 10 * 60e3, true);
    call('homeassistant.update_entity', {}, [v.status, v.up]);
    setTimeout(step, POLL);
  };
  setTimeout(step, 1500);
  if (v.os) watchOs(v, op, step);
}
// react to the OS state at once (it changes within seconds; the poll is for Proxmox's own figures)
function watchOs(v, op, step) { let last = osOf(v); const iv = setInterval(() => { if (ops.get(v.p) !== op || op.done) return clearInterval(iv);
  const now = osOf(v); if (now !== last) { last = now; op.moved = true; step(); } }, 1000); }
const busy = (v) => { const op = ops.get(v.p); return !!op && !op.done; };
// subtitle: the browser's own note while it means something, else HA's OS state, else Proxmox status + uptime
const vmSub = (v) => { const op = ops.get(v.p), os = osOf(v);
  if (op && (op.done || !op.moved)) return op.text;
  if (op && OS_OP[op.kind][os]) return OS_OP[op.kind][os];
  if (OS_TEXT[os]) return OS_TEXT[os];
  return `${s(v.status) === 'running' ? 'Running' : cap(s(v.status) || 'Unknown')} · up ${upFor(v.up)}`; };
const opBadge = (v) => { const op = ops.get(v.p), os = osOf(v);
  if (op && op.failed) return 'Check Proxmox';
  if (op && op.done) return op.kind === 'shut_down' ? 'Off' : 'Back up';
  if (OS_BADGE[os]) return op && op.kind === 'restart' ? 'Restarting' : op && op.kind === 'shut_down' ? 'Shutting down' : OS_BADGE[os];
  if (op) return { restart: 'Restarting', shut_down: 'Shutting down', start: 'Starting' }[op.kind];
  return null; };

// VM power buttons (Proxmox VE integration's button entities): Restart / Shut down while running, Start while stopped
const vmButtons = (v) => {
  // hidden while an operation runs, here or seen from another screen (stopping / starting); a hung OS can still be restarted
  const moving = () => busy(v) || !!OS_BADGE[osOf(v)];
  const running = () => s(v.status) === 'running' && !moving(), P = v.power, w = [v.status, v.os].filter(Boolean);
  const also = v.impact ? v.impact + ' ' : '';
  return [
    { icon: 'restart', text: 'Restart', admin: true, show: running, watch: w,
      action: { call: 'button.press', target: P.restart, after: () => startOp(v, 'restart'), confirm: { title: `Restart ${v.name}?`, text: also + 'It shuts down cleanly and is back in a minute or two.', ok: 'Restart', icon: 'restart' } } },
    ...(v.self ? [] : [{ icon: 'power', text: 'Shut down', admin: true, show: running, watch: w,
      action: { call: 'button.press', target: P.shut_down, after: () => startOp(v, 'shut_down'), confirm: { title: `Shut down ${v.name}?`, text: also + 'It stays off until someone starts it again (here, or in Proxmox).', ok: 'Shut down', icon: 'power' } } }]),
    { icon: 'play', text: 'Start', admin: true, show: () => s(v.status) != null && s(v.status) !== 'running' && !moving(), watch: w,
      action: { call: 'button.press', target: P.start, after: () => startOp(v, 'start'), confirm: { title: `Start ${v.name}?`, text: 'It boots and its services come back in a minute or two.', ok: 'Start', icon: 'play' } } },
  ].filter((b) => b.action.target);   // a site may have only some of the three buttons
};

export function proxmoxPage(PX, HA, nodes) {
  const T = Object.fromEntries(nodes.temps.map((m) => [m.entity, m]));
  const D = PX.drive || {}, TP = PX.temps || {};
  const hostCard = host(nodes.proxmox, {
    sub: () => `${s(PX.status) === 'online' ? 'Online' : cap(s(PX.status) || 'Offline')} · up ${upFor(PX.up)}`, subWatch: [PX.status, PX.up],
    // one rule on every Systems card: gauges + 24 h trace for what moves (CPU, memory, temperature), bars for capacity
    meters: [meterOf(nodes.proxmox.metrics[0]), meterOf(nodes.proxmox.metrics[1], { detail: () => { const t = num(PX.mem_total); return t ? `of ${t.toFixed(1)} GB` : ''; } }),
      ...(T[TP.cpu] ? [meterOf(T[TP.cpu], metric() ? { min: 15, max: 105, unit: '°C' } : { min: 60, max: 220, unit: '°F' })] : [])],
    bars: (PX.storage || []).map((x) => ({ name: x.name, entity: x.pct, warn: 80, crit: 92, watch: [x.used, x.total], detail: () => `${of(x.used, gb)} of ${of(x.total, gb)}` })),
    facts: [
      fact('Last backup', 'backup-restore', [PX.backup || PX.status], () => { if (!PX.backup) return { text: 'Not set up', tone: 'lamp' };
        const t = pxTime(s(PX.backup)); return isNaN(t) ? '–' : Date.now() - t > 26 * 3600e3 ? { text: ago(t) + ' ago', tone: 'lamp' } : ago(t) + ' ago'; }),
      ...(PX.backup_store ? [fact(PX.backup_store.name, 'folder-network', [PX.backup_store.size, PX.backup_store.count], () => { const g = num(PX.backup_store.size), n = num(PX.backup_store.count);
        return g == null ? '–' : `${g >= 1000 ? (g / 1000).toFixed(2) + ' TB' : Math.round(g) + ' GB'}${n == null ? '' : ` · ${n} backup${n === 1 ? '' : 's'}`}`; })] : []),
      ...(D.health ? [fact('SSD', 'harddisk', [D.health, D.wear], () => (s(D.health) === 'on' ? { text: 'Health problem', tone: 'ember' }
        : s(D.health) !== 'off' ? '–' : `Healthy · ${pct(D.wear)} worn`))] : []),
      ...(T[TP.disk] ? [fact('SSD temp', 'thermometer', [TP.disk], () => degOf(T[TP.disk]), { trend: tempTrend(T[TP.disk]) })] : []),
      ...(D.hours ? [fact('SSD hours', 'timer-outline', [D.hours], () => (num(D.hours) == null ? '–' : `${whole(D.hours, true)} h`))] : []),
      ...(T[TP.ram] ? [fact('RAM temp', 'memory', [TP.ram], () => degOf(T[TP.ram]), { trend: tempTrend(T[TP.ram]) })] : []),
      ...(T[TP.board] ? [fact('Board temp', 'thermometer', [TP.board], () => degOf(T[TP.board]), { trend: tempTrend(T[TP.board]) })] : []),
      ...(PX.updates ? [fact('Packages', 'update', [PX.updates, PX.restart].filter(Boolean), () => { const n = num(PX.updates), rb = PX.restart && s(PX.restart) === 'on';
        if (n == null) return '–';
        const t = [n ? `${n} update${n === 1 ? '' : 's'}` : 'Up to date', rb ? 'restart needed' : ''].filter(Boolean).join(' · ');
        return n || rb ? { text: t, tone: 'lamp' } : t; })] : [])] });

  const vmCard = (v, i, nIn = v.guest.net_in || [], nOut = v.guest.net_out || []) => host(nodes.vms[i], {
    sub: () => vmSub(v), subWatch: [v.status, v.up, v.os].filter(Boolean), live: true,
    badge: (a) => opBadge(v) || ['OK', 'Attention', 'Problem'][a.level],
    meters: [meterOf(nodes.vms[i].metrics[0]), meterOf(nodes.vms[i].metrics[1], { detail: () => { const r = num(v.ram); return r ? `of ${r.toFixed(0)} GB` : ''; } })],
    bars: v.guest.disk ? [{ name: 'Disk', entity: v.guest.disk, warn: 80, crit: 92, watch: [v.guest.disk_used, v.guest.disk_size, v.guest.disk_free].filter(Boolean),
      detail: () => { const u = num(v.guest.disk_used), t = v.guest.disk_size ? num(v.guest.disk_size) : u != null && num(v.guest.disk_free) != null ? u + num(v.guest.disk_free) : null;
        return u != null && t ? `${gb(u)} of ${gb(t)}` : `${pct(v.guest.disk)}`; } }] : [],
    facts: [...(nIn.length + nOut.length ? [fact('Network', 'swap-vertical', [...nIn, ...nOut], () => `↓ ${mbit(mbps(nIn))}  ↑ ${mbit(mbps(nOut))}`)] : []),
      ...(v.p === 'haos'
        ? [fact('Last backup', 'backup-restore', [HA.backup_last], () => { const t = s(HA.backup_last); return t && !isNaN(new Date(t)) ? ago(t) + ' ago' : '–'; }),
          fact('Updates', 'update', HA.updates.map((u) => u[1]), () => { const n = HA.updates.filter((u) => s(u[1]) === 'on').map((u) => u[0]); return n.length ? { text: n.length === 1 ? n[0] : `${n.length} available`, tone: 'lamp' } : 'Up to date'; })]
        : [...(v.guest.procs ? [fact('Processes', 'format-list-bulleted', [v.guest.procs], () => whole(v.guest.procs))] : []),
          ...(v.guest.updates ? [fact('Packages', 'update', [v.guest.updates, v.guest.reboot], () => {
            const n = num(v.guest.updates), rb = s(v.guest.reboot) === 'on';
            if (n == null) return '–';
            const t = [n ? `${n} update${n === 1 ? '' : 's'}` : 'Up to date', rb ? 'restart needed' : ''].filter(Boolean).join(' · ');
            return n || rb ? { text: t, tone: 'lamp' } : t; })] : [])])],
    // power: HA admins only, each behind a confirm naming what stops (core/ask.js via the action's confirm)
    ...(v.power ? { controls: { buttons: vmButtons(v) } } : {}),
  });

  return { id: 'proxmox', title: 'Proxmox', icon: 'server', fill: true, sections: [
    { span: 1, panel: false, cards: [hostCard] },
    ...PX.vms.map((v, i) => ({ span: 1, panel: false, cards: [vmCard(v, i)] })),
  ] };
}
