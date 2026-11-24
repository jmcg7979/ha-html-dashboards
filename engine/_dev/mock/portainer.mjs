// What HA's registries hold for Docker containers that the Portainer integration found: one device per container and its
// entities by translation key. A site's mock builds its `registry` with this from the container entities it has states for,
// so the Docker page (core/discover.js) finds its containers on the mock the way it does on a real HA.
//   portainer(S, { frigate: 'Frigate Container', mqtt: ['Mosquitto Container', 'mosquitto'] })
//     the container's own name -> the device's name in HA, and (when it differs from the container's name) what its entity
//     ids start with: <domain>.<that>_container_<suffix>
//   -> { devices, entities }
const KEYS = {
  sensor: { state: 'container_state', health: 'container_health_state', started: 'container_started_at', cpu_usage: 'cpu_usage_total', cpu_usage_total: 'cpu_usage_total', memory_usage_percentage: 'memory_usage_percentage',
    memory_usage: 'memory_usage', memory_limit: 'memory_limit', restart_count: 'container_restart_count', image: 'image', image_version: 'image_version' },
  binary_sensor: { status: 'status', out_of_memory: 'container_out_of_memory' },
  switch: { '': 'container' },
  button: { restart: 'restart_container' },
  update: { image_update_available: 'container_image_update' },
};

export function portainer(S, containers, host = 'docker_host') {
  // the Docker host is a Portainer device too, but not a container: discovery must leave it out
  const devices = [{ id: 'mock-' + host, manufacturer: 'Portainer', model: 'Endpoint', name: host, name_by_user: null, disabled_by: null }];
  const entities = Object.keys(S).filter((id) => id.split('.')[1].startsWith(host + '_')).map((id) => ({ ei: id, pl: 'portainer', di: 'mock-' + host, tk: id.split('.')[1].slice(host.length + 1) }));
  for (const [name, as] of Object.entries(containers)) {
    const [shown, ids = name] = [].concat(as), di = 'mock-' + name;
    devices.push({ id: di, manufacturer: 'Portainer', model: 'Container', name, name_by_user: shown, disabled_by: null });
    for (const [domain, keys] of Object.entries(KEYS)) for (const [suffix, tk] of Object.entries(keys)) {
      const ei = `${domain}.${ids}_container${suffix && '_' + suffix}`;
      if (S[ei]) entities.push({ ei, pl: 'portainer', di, tk });
    }
  }
  return { devices, entities };
}
