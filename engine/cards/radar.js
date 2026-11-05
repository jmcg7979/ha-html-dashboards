// Radar that looks forward: the latest NEXRAD mosaic ("Now"), then the HRRR model's forecast radar for the next hours,
// played as a loop on a dark map. Both come as map tiles from the Iowa Environmental Mesonet (free, no key):
//   now:      nexrad-n0q-900913 (base reflectivity mosaic, every 5 minutes)
//   forecast: hrrr::REFD-F<minutes>-<run>  (HRRR simulated reflectivity, 15-minute steps to 18 h, new run hourly ~1 h 50 min after its start)
// Base map: CARTO dark (no labels under the radar, labels above it); CARTO needs an API key (`cartoKey`, from home.js: a string or { entity }, core/mapkey.js).
// lat, lon: optional, default HA's home location (core/location.js)
// { type: 'radar', lat, lon, zoom: 7, height: 452, cartoKey: '…', ranges: [[3, 15], [6, 30], [12, 60]] (hours, minutes per frame), range: 1 (default index) }
// Leaflet (vendor/) and every frame's tiles load once the card is on screen; the loop runs only while it is visible.
import { where } from '../core/location.js';
import { keyOf } from '../core/mapkey.js';
import { h, esc, icon, toggle } from '../core/dom.js';
import { loadLeaflet } from './map.js';
import { timeOpts } from '../core/units.js';

const IEM = 'https://mesonet.agron.iastate.edu';
const NOW = (t) => `${IEM}/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png?_=${t}`;
const HRRR = (f, run) => `${IEM}/cache/tile.py/1.0.0/hrrr::REFD-F${String(f).padStart(4, '0')}-${run}/{z}/{x}/{y}.png`;
const MIN = 60e3, STEP = 15 * MIN;
const clock = (t) => new Date(t).toLocaleTimeString([], timeOpts({ hour: 'numeric', minute: '2-digit' }));
const ahead = (ms) => { const m = Math.round(ms / MIN); return m < 60 ? `+${m} min` : `+${+(m / 60).toFixed(1).replace(/\.0$/, '')} h`; };

// the HRRR run the IEM has finished; if its status file can't be read, assume the usual delay
let runCache = null;
function latestRun() {
  if (runCache && Date.now() - runCache.at < 10 * MIN) return Promise.resolve(runCache.init);
  const guess = () => { const d = new Date(Date.now() - 110 * MIN); d.setUTCMinutes(0, 0, 0); return +d; };
  return fetch(`${IEM}/data/gis/images/4326/hrrr/refd_1080.json`, { cache: 'no-store' }).then((r) => r.json())
    .then((j) => +new Date(j.model_init_utc)).catch(guess)
    .then((init) => { if (!(init > 0)) init = guess(); runCache = { at: Date.now(), init }; return init; });
}
const runId = (init) => new Date(init).toISOString().replace(/[-:T]/g, '').slice(0, 12);   // YYYYMMDDHHMM

export default function radar(cfg) {
  const tileKey = keyOf(cfg.cartoKey);
  const ranges = cfg.ranges || [[3, 15], [6, 30], [12, 60]];
  let ri = cfg.range != null ? cfg.range : 1;
  const el = h(`<div class="radar" style="height:calc(${cfg.height || 450}px * var(--s))">
    <div class="rmap"></div>
    <div class="rtop"><span class="rbadge"></span><span class="rsrc">NEXRAD · HRRR forecast · IEM</span></div>
    <div class="rbar"><button class="rbtn rplay">${icon('pause')}</button>
      <div class="rtl"><div class="rlbl"><b></b><span class="sub"></span></div><div class="rticks"></div></div>
      <div class="rrng">${ranges.map((r, i) => `<button class="chip" data-i="${i}">${r[0]} h</button>`).join('')}</div></div></div>`);
  el.style.setProperty('--t', 'var(--mist)');
  const mapEl = el.querySelector('.rmap'), ticks = el.querySelector('.rticks'), playBtn = el.querySelector('.rplay');
  let L = null, map = null, frames = [], cur = 0, playing = true, timer = 0, visible = false, built = 0, refreshT = 0;

  const show = (i) => {
    cur = (i + frames.length) % frames.length;
    frames.forEach((f, j) => f.layer.setOpacity(j === cur ? 0.72 : 0));
    const f = frames[cur];
    el.querySelector('.rlbl b').textContent = f.now ? 'Now' : ahead(f.ahead);
    el.querySelector('.rlbl .sub').textContent = clock(f.t);
    el.querySelector('.rbadge').textContent = f.fails >= 3 ? 'No data' : f.now ? 'Radar' : 'Forecast';
    toggle(el.querySelector('.rbadge'), 'fc', !f.now);
    [...ticks.children].forEach((t, j) => { toggle(t, 'on', j === cur); toggle(t, 'past', j < cur); });
  };
  const loop = () => {
    clearTimeout(timer); if (!playing || !visible || document.hidden || !frames.length) return;
    timer = setTimeout(() => { show(cur + 1); loop(); }, cur === frames.length - 1 ? 1800 : cur === 0 ? 1200 : 650);
  };
  const setPlaying = (p) => { playing = p; playBtn.innerHTML = icon(p ? 'pause' : 'play'); loop(); };

  async function build() {
    const [hrs, step] = ranges[ri], gen = ++built;
    [...el.querySelectorAll('.rrng .chip')].forEach((c, i) => toggle(c, 'on', i === ri));
    const init = await latestRun(); if (gen !== built) return;
    const now = Date.now(), list = [{ now: true, t: now, url: NOW(Math.floor(now / (5 * MIN))) }];
    for (let k = 1; k * step <= hrs * 60; k++) {
      const f = Math.round((now + k * step * MIN - init) / STEP) * 15;   // forecast minute nearest to now + k steps
      if (f < 0 || f > 1080) continue;
      list.push({ t: init + f * MIN, ahead: k * step * MIN, url: HRRR(f, runId(init)) });
    }
    frames.forEach((f) => map.removeLayer(f.layer));
    frames = list.map((f) => { const fr = { ...f, fails: 0 };
      fr.layer = L.tileLayer(f.url, { opacity: 0, maxNativeZoom: 10, maxZoom: 12, pane: 'radar', crossOrigin: false, updateWhenIdle: true })
        .on('tileerror', () => { if (++fr.fails === 3 && frames[cur] === fr) show(cur); }).addTo(map);   // a frame that didn't load mustn't read as clear skies
      return fr; });
    ticks.innerHTML = frames.map((f, i) => `<button class="rtick${f.now ? ' now' : ''}" data-i="${i}"></button>`).join('');
    show(0); loop();
    clearTimeout(refreshT); refreshT = setTimeout(() => { if (visible && !document.hidden) build(); }, 10 * MIN);   // new radar mosaic / new model run; a hidden radar rebuilds when it comes back
  }

  function start() {
    Promise.all([loadLeaflet(), where(cfg), tileKey]).then(([lf, at, key]) => {
      if (!at) throw new Error('no location');
      L = lf;
      map = L.map(mapEl, { zoomControl: false, attributionControl: false, zoomSnap: 0.5 }).setView([at.lat, at.lon], cfg.zoom || 7);
      map.createPane('radar').style.zIndex = 350; map.createPane('labels').style.zIndex = 450; map.getPane('labels').style.pointerEvents = 'none';
      const carto = (style) => `https://basemaps.cartocdn.com/rastertiles/${style}/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`;
      L.tileLayer(carto('dark_nolabels'), { maxZoom: 12 }).addTo(map);
      L.tileLayer(carto('dark_only_labels'), { maxZoom: 12, pane: 'labels' }).addTo(map);
      L.circleMarker([at.lat, at.lon], { radius: 6, color: '#0d1017', weight: 2, fillColor: '#f2b35e', fillOpacity: 1, interactive: false, pane: 'labels' }).addTo(map);
      build();
    }).catch(() => { mapEl.innerHTML = `<div class="rerr">${esc('Radar unavailable')}</div>`; });
  }

  el.addEventListener('click', (ev) => {
    const t = ev.target.closest('.rtick'); if (t) { setPlaying(false); show(+t.dataset.i); return; }
    const c = ev.target.closest('.rrng .chip'); if (c && map) { ri = +c.dataset.i; setPlaying(true); build(); return; }
    if (ev.target.closest('.rplay')) setPlaying(!playing);
  });
  new IntersectionObserver((en) => {
    visible = en[en.length - 1].isIntersecting;
    if (visible && !map) start();
    if (visible && map) { map.invalidateSize(); if (frames.length && Date.now() - frames[0].t > 10 * MIN) build(); }
    loop();
  }).observe(el);
  document.addEventListener('visibilitychange', loop);
  return el;
}
