// Current conditions from the freshest source, so "now" never shows a reading hours old.
//   1. NWS observation (the HA weather entity): normally every 5–20 min, but the NWS API sometimes falls hours behind.
//   2. Airport METAR from the Iowa Environmental Mesonet (same station, independent feed): hourly + special reports.
//   3. Open-Meteo current conditions (model analysis for this exact spot, every 15 min): only when no observation is recent.
// The freshest observation no older than `maxAge` minutes wins (measured beats modelled); Open-Meteo fills in otherwise.
// current(cfg, (c) => {}) calls back with { source, label, time (ms), condition, temperature, humidity, dew_point,
//   wind_speed, wind_bearing, wind_gust_speed (mph), pressure (inHg), visibility (mi) } whenever anything changes.
// cfg: { entity: 'weather.home_nws', lat, lon, iem: { station: 'ABC', network: 'KS_ASOS', name: 'Local airport' }, maxAge: 75,
//        ha: 'sensor.outdoor_temperature' }
// When HA has the same logic (packages/weather_now.yaml -> `ha` sensor, attributes condition/humidity/…/source/observed),
// that is used and the browser fetches nothing; the browser path stays as the fallback while the sensor is unavailable.
import { st, watch } from './store.js';

const MIN = 60e3;
const kt = (v) => (v == null ? null : v * 1.15078);
const rh = (t, d) => { if (t == null || d == null) return null; const c = (x) => ((x - 32) * 5) / 9, a = 17.625, b = 243.04;
  return 100 * Math.exp((a * c(d)) / (b + c(d)) - (a * c(t)) / (b + c(t))); };

// METAR sky + weather -> HA condition
function metarCondition(o, night) {
  const wx = (o.presentwx || []).join(' '), sky = (o['skycover[code]'] || []).filter(Boolean);
  if (/TS/.test(wx)) return /RA|SH/.test(wx) ? 'lightning-rainy' : 'lightning';
  if (/SN|SG/.test(wx)) return /RA/.test(wx) ? 'snowy-rainy' : 'snowy';
  if (/PL|GR|GS/.test(wx)) return 'hail';
  if (/\+RA/.test(wx)) return 'pouring';
  if (/RA|DZ|SH/.test(wx)) return 'rainy';
  if (/FG/.test(wx)) return 'fog';
  const top = ['OVC', 'VV', 'BKN', 'SCT', 'FEW'].find((c) => sky.includes(c));
  return top === 'OVC' || top === 'VV' ? 'cloudy' : top === 'BKN' || top === 'SCT' ? 'partlycloudy' : night ? 'clear-night' : 'sunny';
}
// WMO weather code (Open-Meteo) -> HA condition
function wmoCondition(c, day) {
  if (c <= 1) return day ? 'sunny' : 'clear-night';
  if (c === 2) return 'partlycloudy';
  if (c === 3) return 'cloudy';
  if (c === 45 || c === 48) return 'fog';
  if (c >= 95) return 'lightning-rainy';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snowy';
  if (c === 65 || c === 82) return 'pouring';
  if (c === 66 || c === 67) return 'snowy-rainy';
  return 'rainy';
}

export function current(cfg, fn) {
  let iem = null, om = null;
  const nws = () => {
    const w = st(cfg.entity); if (!w) return null; const a = w.attributes;
    return { source: 'nws', label: (cfg.iem && cfg.iem.name) || 'NWS station', time: (w.lu || 0) * 1000, condition: w.state, temperature: a.temperature, humidity: a.humidity, dew_point: a.dew_point,
      wind_speed: a.wind_speed, wind_bearing: a.wind_bearing, wind_gust_speed: a.wind_gust_speed, pressure: a.pressure, visibility: a.visibility };
  };
  const fromHa = () => {
    const e = cfg.ha && st(cfg.ha); if (!e || isNaN(parseFloat(e.state))) return null; const a = e.attributes;
    const label = { nws: (cfg.iem && cfg.iem.name) || 'NWS station', metar: (cfg.iem && cfg.iem.name) || 'Airport', model: 'Open-Meteo' }[a.source] || a.source_name || 'Outdoor';
    return { source: a.source, label, time: +new Date(a.observed), condition: a.condition, temperature: +e.state, humidity: a.humidity, dew_point: a.dew_point,
      wind_speed: a.wind_speed, wind_bearing: a.wind_bearing, wind_gust_speed: a.wind_gust_speed, pressure: a.pressure, visibility: a.visibility };
  };
  let browser = false;
  const pick = () => {
    const h = fromHa(); if (h) { fn(h); return; }
    if (!browser) { browser = true; startBrowser(); }
    const max = (cfg.maxAge || 75) * MIN, now = Date.now();
    const obs = [nws(), iem].filter((x) => x && x.temperature != null && now - x.time <= max).sort((a, b) => b.time - a.time);
    const c = obs[0] || om || nws();
    if (c) fn(c);
  };
  function startBrowser() {
    if (cfg.iem) {
      const night = () => (st('sun.sun') || {}).state === 'below_horizon';
      const load = () => fetch(`https://mesonet.agron.iastate.edu/json/current.py?station=${cfg.iem.station}&network=${cfg.iem.network}`, { cache: 'no-store' })
        .then((r) => r.json()).then((j) => { const o = j.last_ob; if (!o) return;
          const wind = /(\d{3}|VRB)(\d{2,3})G(\d{2,3})KT/.exec(o.raw || '');
          iem = { source: 'metar', label: cfg.iem.name || cfg.iem.station, time: +new Date(o.utc_valid), condition: metarCondition(o, night()), temperature: o['airtemp[F]'],
            dew_point: o['dewpointtemp[F]'], humidity: rh(o['airtemp[F]'], o['dewpointtemp[F]']), wind_speed: kt(o['windspeed[kt]']), wind_bearing: o['winddirection[deg]'],
            wind_gust_speed: wind ? kt(+wind[3]) : null, pressure: o['altimeter[in]'], visibility: o['visibility[mile]'] };
          pick(); }).catch(() => {});
      load(); setInterval(() => { if (!document.hidden) load(); }, 5 * MIN);
    }
    if (cfg.lat != null) {
      const load = () => fetch(`https://api.open-meteo.com/v1/forecast?latitude=${cfg.lat}&longitude=${cfg.lon}&current=temperature_2m,relative_humidity_2m,dew_point_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,visibility&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=GMT&timeformat=unixtime`, { cache: 'no-store' })
        .then((r) => r.json()).then((j) => { const c = j.current; if (!c) return;
          om = { source: 'model', label: 'Open-Meteo', time: c.time * 1000, condition: wmoCondition(c.weather_code, c.is_day), temperature: c.temperature_2m, humidity: c.relative_humidity_2m,
            dew_point: c.dew_point_2m, wind_speed: c.wind_speed_10m, wind_bearing: c.wind_direction_10m, wind_gust_speed: c.wind_gusts_10m,
            pressure: c.pressure_msl != null ? c.pressure_msl * 0.02953 : null, visibility: c.visibility != null ? c.visibility / ((j.current_units || {}).visibility === 'ft' ? 5280 : 1609.34) : null };
          pick(); }).catch(() => {});
      load(); setInterval(() => { if (!document.hidden) load(); }, 10 * MIN);
    }
  }
  watch([cfg.entity, cfg.ha].filter(Boolean), pick);
  setInterval(pick, MIN);   // ages roll over
}
