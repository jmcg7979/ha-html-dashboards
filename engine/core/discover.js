// Docker containers, found in HA's registries instead of listed by hand: every Portainer device with model "Container"
// is a container, and its entities are matched by Portainer's translation keys, which do not change when a device or
// entity is renamed (entity ids do). Pages are built synchronously at load, so the last list found is kept in
// localStorage and used at the next load; when the list changes (a stack added or removed, an entity renamed) the page
// reloads itself once it is idle. Registry changes are pushed by HA, so a new container shows up without a deploy.
import { request, send, onReady } from './ha.js';
import { reloadWhenIdle } from './reload.js';

const KEY = 'dash.docker.containers.v1';
// domain -> Portainer translation key -> field name used by the Systems cards
const MAP = {
  sensor: { container_state: 'state', container_health_state: 'health', container_started_at: 'started', cpu_usage_total: 'cpu',
    memory_usage_percentage: 'mem', memory_usage: 'mem_mb', memory_limit: 'mem_limit', container_restart_count: 'restarts', image: 'image', image_version: 'version' },
  binary_sensor: { status: 'status', container_out_of_memory: 'oom' },
  switch: { container: 'power' }, button: { restart_container: 'restart' }, update: { container_image_update: 'update' },
};

export function cachedContainers() {
  try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

async function scan() {
  const [devs, reg] = await Promise.all([request({ type: 'config/device_registry/list' }), request({ type: 'config/entity_registry/list_for_display' })]);
  const found = new Map();
  devs.filter((d) => d.manufacturer === 'Portainer' && d.model === 'Container' && !d.disabled_by)
    // cname = the container's own name (Portainer names the device after it; matches Glances); name = what HA shows, without " Container"
    .forEach((d) => found.set(d.id, { cname: d.name, name: (d.name_by_user || d.name).replace(/\s+container$/i, '') }));
  for (const e of reg.entities || []) {
    const c = e.pl === 'portainer' && found.get(e.di); if (!c) continue;
    const k = (MAP[e.ei.split('.')[0]] || {})[e.tk]; if (k) c[k] = e.ei;
  }
  return [...found.values()].filter((c) => c.status).sort((a, b) => a.name.localeCompare(b.name));
}

let timer = 0;
function check() {
  scan().then((list) => {
    const was = localStorage.getItem(KEY), now = JSON.stringify(list);
    if (was === now) return;
    try { localStorage.setItem(KEY, now); } catch (e) { return; }   // no storage: keep what was built rather than reloading forever
    reloadWhenIdle(!was || was === '[]');   // first discovery: reload straight away
  }).catch((e) => console.warn('container discovery failed', e));
}
const soon = () => { clearTimeout(timer); timer = setTimeout(check, 3000); };   // registry events come in bursts (a new stack = ~25 entities)

export function startDiscovery() {
  onReady(() => {
    check();
    ['device_registry_updated', 'entity_registry_updated'].forEach((t) => send({ type: 'subscribe_events', event_type: t }, null, soon));
  });
}
