// A map provider's key. Files under /local are served without a login, so keep it out of them: put it in an HA helper and give the
// card { entity: 'input_text.map_key' } instead of the key. A plain string still works.
// keyOf(k) resolves to the key, or '' if the entity has no value after 15 s (the map then shows the provider's "API key required" tiles).
// Call it while the card is being built, so the entity joins the subscription.
import { st, watch } from './store.js';
import { outside } from './scope.js';

const keys = new Map();   // entity -> { value, waiting }: one watcher per entity, shared by every card and kept for the page's life
export function keyOf(k) {
  if (!k || !k.entity) return Promise.resolve(k || '');
  let e = keys.get(k.entity);
  if (!e) {
    e = { value: '', waiting: new Set() }; keys.set(k.entity, e);
    const read = () => { const s = st(k.entity); if (s && s.state && s.state !== 'unknown' && s.state !== 'unavailable') { e.value = s.state; e.waiting.forEach((done) => done(e.value)); e.waiting.clear(); } };
    outside(() => watch([k.entity], read));
  }
  if (e.value) return Promise.resolve(e.value);
  // no value yet: this caller gets '' after 15 s; a later caller waits again, so a key that arrives late (HA was down
  // when the page loaded) is used by the next map that is built
  return new Promise((done) => { e.waiting.add(done); setTimeout(() => { if (e.waiting.delete(done)) done(''); }, 15000); });
}
