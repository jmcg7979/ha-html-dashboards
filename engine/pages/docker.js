// Docker page + container health rules, shared by every site, so the pages are the same by construction.
// A site supplies only `systems.docker` (DK) in home.js: cores (the Docker VM's vCPUs: Portainer reports container CPU per
// core), impact: { <container name>: 'what stops while it is down' }, the Docker host entities, containers (core/discover.js),
// glances (packages/glances_containers.yaml), stats_stale (optional: Glances' Docker stats frozen).
import { st, num } from '../core/store.js';
import { ago } from '../cards/health.js';
import { n0, whole, pct, of, rate, s, okState, mb, mbit, fact, host } from './common.js';

// container traffic (Mbit/s) from the one Glances sensor, by container name; null = no own interface (host networking) or not running
const cNet = (DK, c, dir) => { const a = (st(DK.glances) || {}).attributes, x = a && a.containers && a.containers[c.cname]; return x && typeof x[dir] === 'number' ? Math.max(0, x[dir]) : null; };

// health definitions (core/assess.js): the Overview map, the attention list and these cards all use them
export function dockerNodes(DK) {
  const scale = 1 / DK.cores;   // share of the Docker VM
  return DK.containers.map((c) => ({ name: c.name, icon: 'docker', page: 'systems/docker', up: c.started,
    metrics: [{ name: 'CPU', label: c.name + ' CPU', entity: c.cpu, scale, warn: 75, crit: 95 }, { name: 'Memory', label: c.name + ' memory', entity: c.mem, warn: 85, crit: 95 }],
    checks: [{ ...okState(c.status, 'on'), text: () => c.name + (down(c) === 'Stopped' ? ' stopped' : ' unavailable') }, { entity: c.health, ok: (e) => !['unhealthy'].includes(e.state), text: () => c.name + ' unhealthy' },
      { entity: c.oom, ok: ['off'], text: () => c.name + ' ran out of memory' },
      // Glances' own Docker stats can freeze (every container then shows 0 traffic); the fix is restarting Glances
      ...(c.cname === 'glances' && DK.stats_stale ? [{ entity: DK.stats_stale, ok: (e) => e.state !== 'on', level: 'warn', text: () => 'Glances stats frozen: restart Glances' }] : [])],
    updates: c.update ? [{ entity: c.update, label: c.name + ' image' }] : [] }));
}

// the containers as children of the Docker VM on the Overview map
const down = (c) => (s(c.status) === 'off' ? 'Stopped' : 'Unavailable');

export const dockerMap = (DK, nodes) => DK.containers.map((c, i) => ({ name: c.name, icon: 'docker', node: nodes[i], page: 'systems/docker', watch: [c.cpu, c.mem_mb, DK.glances],
  flow: { entities: [DK.glances], value: () => (cNet(DK, c, 'in') || 0) + (cNet(DK, c, 'out') || 0) },
  metric: () => (s(c.status) === 'on' ? of(c.cpu, (v) => `${Math.round(v / DK.cores)}% CPU`) : down(c)) }));

export function dockerPage(DK, nodes) {
  const CORES = DK.cores, scale = 1 / CORES, GL = DK.glances, IMPACT = DK.impact || {};
  const ctrCard = (c, i) => host(nodes[i], {
    sub: () => { const on = s(c.status) === 'on', t = s(c.started); return on ? (t && !isNaN(new Date(t)) ? 'Started ' + ago(t) + ' ago' : 'Running') : down(c); }, subWatch: [c.status, c.started],
    badge: (a) => (a.level ? (a.level === 2 ? 'Problem' : 'Attention') : s(c.health) === 'healthy' ? 'Healthy' : s(c.status) === 'on' ? 'Running' : down(c)),
    meters: [{ entity: c.cpu, name: 'CPU', scale, warn: 75, crit: 95, detail: () => `${of(c.cpu, (v) => (v / 100).toFixed(1))} of ${CORES} cores` },
      { entity: c.mem, name: 'Memory', warn: 85, crit: 95, watch: [c.mem_mb], detail: () => { const m = num(c.mem_mb); return m == null ? '' : mb(m); } }],
    // no own network data while running = host networking (its traffic is the VM's own, shown on Ubuntu)
    facts: [fact('Network', 'swap-vertical', [GL, c.status, DK.stats_stale].filter(Boolean), () => { const x = cNet(DK, c, 'in');
        return x != null && DK.stats_stale && s(DK.stats_stale) === 'on' ? { text: 'Stats frozen', tone: 'lamp' } : x != null ? `↓ ${mbit(x)}  ↑ ${mbit(cNet(DK, c, 'out') || 0)}` : s(c.status) === 'on' ? 'Host network' : '–'; }),
      ...(c.image ? [fact('Image', 'layers-outline', [c.image, c.version], () => { const v = s(c.version), im = (s(c.image) || '').split('/').pop(); return v && v !== 'unknown' ? `${im.split(':')[0]} ${v}` : im; })] : []),
      ...(c.update ? [fact('Update', 'update', [c.update], () => (s(c.update) === 'on' ? { text: 'Available', tone: 'lamp' } : 'Up to date'))] : []),
      ...(c.restarts ? [fact('Restarts', 'restart', [c.restarts], () => { const r = n0(c.restarts); return r ? { text: String(r), tone: r >= 3 ? 'ember' : 'lamp' } : 'None'; })] : [])],
    controls: !c.controls ? { note: 'Read-only: HA reaches Docker through it' } : c.power || c.restart ? { power: c.power, restart: c.restart, status: c.status, impact: IMPACT[c.cname] } : undefined,
  });
  // host-wide figures, for what the site has
  const kpis = [
      DK.running && { type: 'kpi', span: 3, label: 'Containers', icon: 'package-variant', tone: 'sage', spark: DK.running, entities: [DK.running, DK.stopped],
        trend: { title: 'Docker · Containers', unit: 'running', floor: 0, minSpan: 4, series: [{ entity: DK.running, name: 'Running', tone: 'sage' }, { entity: DK.stopped, name: 'Stopped', tone: 'stone' }] },
        value: () => ({ text: whole(DK.running), unit: 'running', detail: n0(DK.stopped) ? `${whole(DK.stopped)} stopped` : '' }) },
      DK.cpu && { type: 'kpi', span: 3, label: 'Container CPU', icon: 'cpu-64-bit', tone: 'mist', spark: DK.cpu, scale,
        trend: { title: 'Docker · Container CPU', unit: '%', decimals: 1, floor: 0, ceil: 100, minSpan: 10, series: [{ entity: DK.cpu, name: 'CPU', scale }] },
        value: () => ({ text: of(DK.cpu, (v) => String(Math.round(v / CORES))), unit: '%', detail: `${of(DK.cpu, (v) => (v / 100).toFixed(1))} of ${CORES} cores` }) },
      DK.mem_used && { type: 'kpi', span: 3, label: 'Container memory', icon: 'memory', tone: 'plum', spark: DK.mem_used, entities: [DK.mem_used, DK.mem_total],
        trend: { title: 'Docker · Container memory', unit: 'GB', decimals: 1, floor: 0, minSpan: 1, series: [{ entity: DK.mem_used, name: 'Used', scale: 1 / 1024 }] },
        value: () => ({ text: of(DK.mem_used, (v) => (v / 1024).toFixed(1)), unit: 'GB', detail: `of ${of(DK.mem_total, (v) => (v / 1024).toFixed(1))} GB` }) },
      DK.image_size && { type: 'kpi', span: 3, label: 'Images', icon: 'layers-outline', tone: 'lamp', spark: DK.image_size, scale: 1 / 1024, entities: [DK.images, DK.image_size, DK.reclaim],
        trend: { title: 'Docker · Image disk use', unit: 'GB', decimals: 1, floor: 0, minSpan: 1, series: [{ entity: DK.image_size, name: 'Images', scale: 1 / 1024 }] },
        value: () => ({ text: of(DK.image_size, (v) => (v / 1024).toFixed(1)), unit: 'GB', detail: `${whole(DK.images)} · ${of(DK.reclaim, (v) => (v / 1024).toFixed(1))} GB unused` }) },
  ].filter(Boolean);
  kpis.forEach((k) => { k.span = 12 / kpis.length; });
  // container cards: up to 4 share one row; more go 3 to a row. Rows share the height left under the KPIs.
  const perRow = DK.containers.length <= 4 ? Math.max(1, DK.containers.length) : 3, ctrRows = Math.max(1, Math.ceil(DK.containers.length / perRow));
  return { id: 'docker', title: 'Docker', icon: 'docker', fill: true, sections: [
    { span: 3, panel: false, cols: 12, rows: `${kpis.length ? 'auto ' : ''}repeat(${ctrRows}, minmax(0, 1fr))`, cards: [
      ...kpis,
      ...DK.containers.map((c, i) => ({ ...ctrCard(c, i), span: 12 / perRow, grow: undefined, wide: true })),   // wide: a full row each when reflowed on a phone
    ] },
  ] };
}
