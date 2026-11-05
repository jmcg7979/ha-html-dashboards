// Map of a person/device tracker (Leaflet, bundled in /vendor, loaded only when a map is first shown).
// Base map: chosen in home.js `map_tiles` (provider + style + key); presets below. Small attribution kept, as every provider's terms require. Not tile.openstreetmap.org: OSM's volunteer servers 403 any
// request that fails their tile-usage policy (Referer/User-Agent checks), which some desktop browsers trip and phones don't.
// { type: 'map', entity: 'person.x', zoom: 15, height: 320, tiles: { provider, style, key } (defaults to home.js map_tiles) }   marker = the person's photo (or an account icon), accuracy circle under it
import { h, esc, icon } from '../core/dom.js';
import { st, watch } from '../core/store.js';
import { origin } from '../core/auth.js';
import * as home from '../home.js';

const OSM = '&copy; OpenStreetMap';
const PROVIDERS = {
  carto: (st, k) => [`https://basemaps.cartocdn.com/rastertiles/${st}/{z}/{x}/{y}{r}.png?key=${k}`, `&copy; CARTO ${OSM}`],
  maptiler: (st, k) => [`https://api.maptiler.com/maps/${st}/256/{z}/{x}/{y}{r}.png?key=${k}`, `&copy; MapTiler ${OSM}`],
  stadia: (st, k) => [`https://tiles.stadiamaps.com/tiles/${st}/{z}/{x}/{y}{r}.png?api_key=${k}`, `&copy; Stadia Maps ${OSM}`],
  thunderforest: (st, k) => [`https://tile.thunderforest.com/${st}/{z}/{x}/{y}{r}.png?apikey=${k}`, `&copy; Thunderforest ${OSM}`],
};
function tiles(t) {
  t = t || home.map_tiles || { provider: 'carto', style: 'voyager' }; const f = PROVIDERS[t.provider] || PROVIDERS.carto;
  return f(t.style || 'voyager', encodeURIComponent(t.key || ''));
}

let leaflet = null;
export function loadLeaflet() {
  if (!leaflet) leaflet = new Promise((res, rej) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('../vendor/leaflet/leaflet.css', import.meta.url).href; document.head.appendChild(css);
    const js = document.createElement('script'); js.src = new URL('../vendor/leaflet/leaflet.js', import.meta.url).href; js.onload = () => res(window.L); js.onerror = rej; document.head.appendChild(js);
  });
  return leaflet;
}

const pinSize = 46;
const pin = (L, a) => L.divIcon({ className: 'mpin', iconSize: [pinSize, pinSize], iconAnchor: [pinSize / 2, pinSize / 2],
  html: a.entity_picture ? `<img src="${esc(origin + a.entity_picture)}" alt="">` : icon('account') });

export default function map(cfg) {
  const el = h(`<div class="map" style="height:calc(${cfg.height || 320}px * var(--s))"></div>`);
  let m = null, marker = null, ring = null, pic;
  const draw = () => {
    const e = st(cfg.entity), a = e && e.attributes; if (!a || a.latitude == null) return;
    const ll = [a.latitude, a.longitude];
    loadLeaflet().then((L) => {
      if (!m) {
        m = L.map(el, { zoomControl: false }).setView(ll, cfg.zoom || 15); m.attributionControl.setPrefix(false);
        const [url, attribution] = tiles(cfg.tiles); L.tileLayer(url, { maxZoom: 19, attribution }).addTo(m);
        ring = L.circle(ll, { radius: a.gps_accuracy || 0, color: '#7fb2e5', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(m);
        marker = L.marker(ll, { icon: pin(L, a), interactive: false, keyboard: false }).addTo(m); pic = a.entity_picture;
      } else { marker.setLatLng(ll); if (pic !== a.entity_picture) { pic = a.entity_picture; marker.setIcon(pin(L, a)); } ring.setLatLng(ll).setRadius(a.gps_accuracy || 0); m.panTo(ll); }
      setTimeout(() => m.invalidateSize(), 50);   // pop-ups are hidden when built
    }).catch(() => { el.textContent = 'Map unavailable'; });
  };
  watch([cfg.entity], draw);
  new IntersectionObserver(() => { if (m) m.invalidateSize(); }).observe(el);
  return el;
}
