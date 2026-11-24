// Map of a person/device tracker (Leaflet, bundled in /vendor, loaded only when a map is first shown).
// Base map: chosen in home.js `map_tiles` (provider + style + key); presets below. Small attribution kept, as every provider's terms require. Not tile.openstreetmap.org: OSM's volunteer servers 403 any
// request that fails their tile-usage policy (Referer/User-Agent checks), which some desktop browsers trip and phones don't.
// { type: 'map', entity: 'person.x', zoom: 15, height: 320, tiles: { provider, style, key } (defaults to home.js map_tiles; key: a string or { entity }, core/mapkey.js) }   marker = the person's photo (or an account icon), accuracy circle under it
import { h, esc, icon } from '../core/dom.js';
import { st, watch } from '../core/store.js';
import { onDispose } from '../core/scope.js';
import { origin } from '../core/auth.js';
import { keyOf } from '../core/mapkey.js';
import * as home from '../home.js';
import { asset } from '../core/asset.js';

const OSM = '&copy; OpenStreetMap';
const PROVIDERS = {
  carto: (st, k) => [`https://basemaps.cartocdn.com/rastertiles/${st}/{z}/{x}/{y}{r}.png?key=${k}`, `&copy; CARTO ${OSM}`],
  maptiler: (st, k) => [`https://api.maptiler.com/maps/${st}/256/{z}/{x}/{y}{r}.png?key=${k}`, `&copy; MapTiler ${OSM}`],
  stadia: (st, k) => [`https://tiles.stadiamaps.com/tiles/${st}/{z}/{x}/{y}{r}.png?api_key=${k}`, `&copy; Stadia Maps ${OSM}`],
  thunderforest: (st, k) => [`https://tile.thunderforest.com/${st}/{z}/{x}/{y}{r}.png?apikey=${k}`, `&copy; Thunderforest ${OSM}`],
};
const tileSet = (cfg) => cfg.tiles || home.map_tiles || { provider: 'carto', style: 'voyager' };
function tiles(t, key) {
  const f = PROVIDERS[t.provider] || PROVIDERS.carto;
  return f(t.style || 'voyager', encodeURIComponent(key));
}

// Leaflet, loaded once. A load that fails is forgotten, so the next map or radar that asks tries again (a screen stays up for weeks).
let leaflet = null;
export function loadLeaflet() {
  if (window.L && window.L.map) return Promise.resolve(window.L);
  if (!leaflet) leaflet = new Promise((res, rej) => {
    // a TV never drags or zooms a map: without Leaflet's 3D transforms its tiles are painted into the page, not each kept as its
    // own layer on the GPU (the radar's 13 frames were 190 layers, ~200 MB of graphics memory on a 2 GB TV)
    if (document.documentElement.dataset.profile === 'tv') window.L_DISABLE_3D = true;
    // Leaflet's stylesheet goes into the `vendor` cascade layer (css/tokens.css), under every rule of ours
    const css = document.createElement('style'); css.textContent = `@import url("${asset('vendor/leaflet/leaflet.css')}") layer(vendor);`; document.head.appendChild(css);
    const js = document.createElement('script'); js.src = asset('vendor/leaflet/leaflet.js'); js.onload = () => res(window.L);
    js.onerror = () => { leaflet = null; js.remove(); css.remove(); rej(new Error('Leaflet did not load')); }; document.head.appendChild(js);
  });
  return leaflet;
}

const pinSize = 46;
const pin = (L, a) => L.divIcon({ className: 'map-pin', iconSize: [pinSize, pinSize], iconAnchor: [pinSize / 2, pinSize / 2],
  html: a.entity_picture ? `<img src="${esc(origin + a.entity_picture)}" alt="">` : icon('account') });

export default function map(cfg) {
  const el = h(`<div class="map" style="height:calc(${cfg.height || 320}px * var(--s))"></div>`);
  let m = null, marker = null, ring = null, pic, gone = false;
  onDispose(() => { gone = true; if (m) { m.remove(); m = null; } });   // its view / pop-up unloaded: Leaflet's own listeners and tiles go too
  const t = tileSet(cfg), key = keyOf(t.key);
  const draw = () => {
    const e = st(cfg.entity), a = e && e.attributes;
    if (!a || a.latitude == null) { if (!m) el.textContent = 'No location reported'; return; }   // a map already drawn keeps its last place
    const ll = [a.latitude, a.longitude];
    Promise.all([loadLeaflet(), key]).then(([L, k]) => {
      if (gone) return;
      if (!m) {
        el.textContent = '';
        m = L.map(el, { zoomControl: false }).setView(ll, cfg.zoom || 15); m.attributionControl.setPrefix(false);
        const [url, attribution] = tiles(t, k); L.tileLayer(url, { maxZoom: 19, attribution }).addTo(m);
        ring = L.circle(ll, { radius: a.gps_accuracy || 0, color: '#7fb2e5', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(m);
        marker = L.marker(ll, { icon: pin(L, a), interactive: false, keyboard: false }).addTo(m); pic = a.entity_picture;
      } else { marker.setLatLng(ll); if (pic !== a.entity_picture) { pic = a.entity_picture; marker.setIcon(pin(L, a)); } ring.setLatLng(ll).setRadius(a.gps_accuracy || 0); m.panTo(ll); }
      setTimeout(() => { if (m) m.invalidateSize(); }, 50);   // pop-ups are hidden when built
    }).catch((x) => { console.error(x); if (!m && !gone) el.textContent = 'Map unavailable'; });   // a map that is up stays up; the next change of the person tries again
  };
  watch([cfg.entity], draw);
  new IntersectionObserver(() => { if (m) m.invalidateSize(); }).observe(el);
  return el;
}
