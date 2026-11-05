// A map provider's key. Files under /local are served without a login, so keep it out of them: put it in an HA helper and give the
// card { entity: 'input_text.map_key' } instead of the key. A plain string still works.
// keyOf(k) resolves to the key, or '' if the entity has no value after 15 s (the map then shows the provider's "API key required" tiles).
// Call it while the card is being built, so the entity joins the subscription.
import { st, watch } from './store.js';

const keys = new Map();
export function keyOf(k) {
  if (!k || !k.entity) return Promise.resolve(k || '');
  if (!keys.has(k.entity)) keys.set(k.entity, new Promise((done) => {
    const read = () => { const e = st(k.entity); if (e && e.state !== 'unknown' && e.state !== 'unavailable') done(e.state); };
    watch([k.entity], read); setTimeout(() => done(''), 15000);
  }));
  return keys.get(k.entity);
}
