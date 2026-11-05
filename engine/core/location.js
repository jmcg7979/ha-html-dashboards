// Where home is, for the weather cards and the radar. Files under /local are served without a login, so a site's files shouldn't hold
// the address: leave lat / lon out and this asks HA over the signed-in connection (Settings > System > General). A card's own lat / lon win.
// where(cfg) resolves to { lat, lon }, or null if HA has no location. It waits for the first connection.
import { request, onReady, connected } from './ha.js';

let home = null;
export function where(cfg) {
  if (cfg && cfg.lat != null) return Promise.resolve({ lat: +cfg.lat, lon: +cfg.lon });
  if (!home) home = new Promise((done) => {
    const ask = () => request({ type: 'get_config' }).then((c) => done(c.latitude != null ? { lat: c.latitude, lon: c.longitude } : null)).catch(() => {});
    onReady(ask); if (connected()) ask();
  });
  return home;
}
