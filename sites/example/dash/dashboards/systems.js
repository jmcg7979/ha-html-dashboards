// Systems view: a router, access points, a NAS, one Proxmox host with a Home Assistant VM and a Docker VM, HA's updates and backups.
// Layout only: entities and limits are in home.js; the Proxmox and Docker pages and all formatters are the engine's (engine/pages/);
// health rules live once, in `nodes`.
import * as H from '../home.js';
import { num } from '../core/store.js';
import { degUnit } from '../core/units.js';
import { n0, whole, pct, of, rate, s, okState, upFor, pxTime, bytes, mbit, fmt1, mbps, fwText, meterOf, host, fact } from '../pages/common.js';
import { proxmoxNodes, proxmoxPage } from '../pages/proxmox.js';
import { dockerNodes, dockerMap, dockerPage } from '../pages/docker.js';

const Y = H.systems, NW = Y.network, R = NW.router, W = NW.wan, PX = Y.proxmox, DK = Y.docker, HA = Y.ha, NAS = Y.nas;
const UB = PX.vms[1].guest, HO = PX.vms[0].guest, haNet = [...HO.net_in, ...HO.net_out], ubNet = [UB.rx, UB.tx], hostNet = [...haNet, ...ubNet];
const down = () => rate(W.down, W.scale), up = () => rate(W.up, W.scale);   // Mbit/s

// ---- health definitions (core/assess.js) ----
const PN = proxmoxNodes(PX, HA);
const nodes = {
  router: { name: 'Router', icon: 'router-wireless', page: 'systems/network', up: R.up, watch: [W.status],
    metrics: [{ name: 'Memory', label: 'Router memory', entity: R.mem, warn: R.limits.mem[0], crit: R.limits.mem[1] }, { name: 'Temp', label: 'Router temp', entity: R.temp, unit: '°', warn: R.limits.temp[0], crit: R.limits.temp[1] }],
    checks: [{ entity: W.status, ok: ['Up'], text: () => 'Internet is down' }],
    updates: [{ entity: R.fw, label: 'Router firmware' }] },
  aps: NW.aps.map((a) => ({ name: a.name, icon: 'access-point', page: 'systems/network', up: a.up, metrics: [], checks: [okState(a.state, 'connected')], updates: [{ entity: a.fw, label: `${a.name} AP firmware` }] })),
  proxmox: PN.proxmox,
  vms: PN.vms,
  containers: dockerNodes(DK),
};
const allNodes = [nodes.router, ...nodes.aps, nodes.proxmox, ...nodes.vms, ...nodes.containers];

// ---- Overview: the map, four figures, what needs attention ----
const map = {
  name: 'Router', icon: 'router-wireless', node: nodes.router, page: 'systems/network', metric: () => `↓ ${fmt1(down())}  ↑ ${fmt1(up())}`, watch: [W.down, W.up],
  children: [
    ...NW.aps.map((a, i) => ({ name: a.name, icon: 'access-point', node: nodes.aps[i], page: 'systems/network', watch: [a.clients], metric: () => `${whole(a.clients)} clients` })),
    { name: 'Proxmox', icon: 'server', node: nodes.proxmox, page: 'systems/proxmox', watch: [PX.mem, ...hostNet],
      flow: { entities: hostNet, value: () => mbps(hostNet) },
      metric: () => `RAM ${pct(PX.mem)}`,
      children: [
        { name: 'Home Assistant', icon: 'home-assistant', node: nodes.vms[0], page: 'systems/proxmox', watch: haNet, flow: { entities: haNet, value: () => mbps(haNet) }, metric: () => mbit(mbps(haNet)) },
        { name: 'Ubuntu', icon: 'ubuntu', node: nodes.vms[1], page: 'systems/proxmox', watch: ubNet, flow: { entities: ubNet, value: () => mbps(ubNet) }, metric: () => mbit(mbps(ubNet)),
          children: dockerMap(DK, nodes.containers) },
      ] },
  ],
};
const kpis = [
  { type: 'kpi', span: 3, label: 'Clients', icon: 'devices', tone: 'mist', spark: R.clients, tap: 'systems/network',
    value: () => ({ text: whole(R.clients), detail: 'on the network' }), entities: [R.clients] },
  { type: 'kpi', span: 3, label: 'Internet', icon: 'web', tone: 'plum', tap: 'systems/network', minRange: W.floor.down,
    pair: [{ entity: W.down, tone: 'plum', arrow: '↓', scale: W.scale }, { entity: W.up, tone: 'mist', arrow: '↑', scale: W.scale }],
    value: () => ({ pair: [down(), up()].map(fmt1), detail: 'Mbit/s' }) },
  { type: 'kpi', span: 3, label: 'NAS', icon: 'nas', tone: 'lamp', spark: NAS.vol, tap: { nav: '#nas' },
    value: () => ({ text: whole(NAS.vol), unit: '%', detail: 'volume used' }), entities: [NAS.vol] },
  { type: 'kpi', span: 3, label: 'Server CPU', icon: 'cpu-64-bit', tone: 'sage', spark: PX.cpu, tap: 'systems/proxmox',
    value: () => ({ text: whole(PX.cpu), unit: '%', detail: `RAM ${pct(PX.mem)}` }), entities: [PX.cpu, PX.mem] },
];
const summary = { id: 'summary', title: 'Overview', icon: 'view-dashboard-outline', fill: true, sections: [
  { span: 2, panel: false, rows: 'minmax(0, 1fr) auto', cards: [
    { type: 'topology', root: map, columns: '1fr 1fr 1.15fr 0.85fr', class: 'glass topo-cell' },
    ...kpis,
  ] },
  { span: 1, panel: false, cards: [
    { type: 'attention', nodes: allNodes, grow: true, backups: [
      { name: 'Home Assistant', icon: 'home-assistant', entity: HA.backup_last, next: HA.backup_next, stale: 26 },
      { name: 'Proxmox VMs', icon: 'server', entity: PX.backup, parse: pxTime, stale: 26 },
    ] },
  ] },
] };

// ---- Network ----
const [tempLo, tempHi] = R.temp_range;
const network = { id: 'network', title: 'Network', icon: 'router-wireless', fill: true, sections: [
  { span: 1, panel: false, cards: [
    host(nodes.router, { sub: () => `Internet ${String(s(W.status) || '–').toLowerCase()} · up ${upFor(R.up)}`, subWatch: [W.status, R.up],
      meters: [meterOf(nodes.router.metrics[1], { min: tempLo, max: tempHi, unit: degUnit() }), meterOf(nodes.router.metrics[0]),
        { entity: W.down, scale: W.scale, name: 'Download', unit: 'Mbit/s', max: W.dial.down, tone: 'plum', minRange: W.floor.down, trend: { decimals: 1 } },
        { entity: W.up, scale: W.scale, name: 'Upload', unit: 'Mbit/s', max: W.dial.up, tone: 'mist', minRange: W.floor.up, trend: { decimals: 1 } }],
      facts: [fact('Firmware', 'update', [R.fw], () => fwText(R.fw)),
        fact('Clients', 'devices', [R.clients], () => whole(R.clients), { trend: { unit: '', series: [{ entity: R.clients, name: 'Clients' }], floor: 0, minSpan: 4 } }),
        fact('Load (15 min)', 'speedometer', [R.load], () => (num(R.load) == null ? '–' : num(R.load).toFixed(2)), { trend: { decimals: 2, floor: 0, minSpan: 0.5, series: [{ entity: R.load, name: 'Load' }] } }),
        fact('Data (since boot)', 'swap-vertical', [W.total_down, W.total_up], () => `↓ ${of(W.total_down, bytes)}  ↑ ${of(W.total_up, bytes)}`)] }),
  ] },
  { span: 1, panel: false, cards: [
    { type: 'devices', title: 'Access points', columns: 1, watch: NW.aps.map((a) => a.state),
      summary: () => `${NW.aps.filter((a) => s(a.state) === 'connected').length} of ${NW.aps.length} online`,
      items: NW.aps.map((a, i) => ({ name: a.name, icon: 'access-point', node: nodes.aps[i], spark: a.clients, watch: [a.cpu, a.clients],
        sub: () => `Up ${upFor(a.up)} · CPU ${pct(a.cpu)}`, value: () => `${whole(a.clients)} clients`,
        trend: { title: `${a.name} AP · Clients`, unit: '', floor: 0, minSpan: 4, series: [{ entity: a.clients, name: 'Clients' }] } })) },
    { type: 'chart', title: 'Wi-Fi clients', hours: 24, ranges: [24, 168], minSpan: 6, min: 0, grow: true, fit: true, trend: { icon: 'wifi' },
      series: NW.aps.map((a, i) => ({ entity: a.clients, name: a.name, tone: ['mist', 'lamp'][i], width: 2 })) },
  ] },
  { span: 1, panel: false, cards: [
    { type: 'chart', title: 'Internet (Mbit/s)', hours: 24, ranges: [24, 168], minSpan: 1, min: 0, grow: true, fit: true, trend: { title: 'Internet', unit: 'Mbit/s', decimals: 1, icon: 'web' },
      series: [{ entity: W.down, name: 'Down', tone: 'plum', width: 2, area: true, step: false, scale: W.scale }, { entity: W.up, name: 'Up', tone: 'mist', width: 2, area: true, step: false, scale: W.scale }] },
  ] },
] };

// ---- Proxmox and Docker: engine/pages/ ----
const proxmox = proxmoxPage(PX, HA, PN);
const docker = dockerPage(DK, nodes.containers);

export default { id: 'systems', title: 'Systems', icon: 'server-network', tone: 'mist', pages: [summary, network, proxmox, docker] };
