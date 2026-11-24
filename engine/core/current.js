// Current conditions for the Now card, from Home Assistant alone: the browser fetches nothing.
// current(cfg, (c) => {}) calls back with { source, label, time (ms), condition, temperature, humidity, dew_point,
//   wind_speed, wind_bearing, wind_gust_speed (mph), pressure (inHg), visibility (mi) } whenever the reading changes,
//   and with null while nothing is reporting.
// cfg: { ha: 'sensor.outdoor_temperature', entity: 'weather.home', iem: { name: 'Local airport' } }
//   ha      the sensor of the weather_now.yaml package (engine/docs/integrations.md, Weather): HA picks the freshest of the
//           NWS observation, the airport's METAR and Open-Meteo, and says which and from when (attributes condition,
//           humidity, …, source, observed). This is the reading to use: it knows how old it is.
//   entity  the weather entity, used while there is no `ha` sensor (or it isn't reporting). It carries no observation
//           time, so its age is the time HA last updated it.
//   iem.name  what to call the station
import { st, watch } from './store.js';

const MIN = 60e3;
const reports = (e) => !!e && e.state !== 'unavailable' && e.state !== 'unknown';
// the package's sensor: null unless it has a temperature
export function fromSensor(e, name) {
  if (!reports(e) || isNaN(parseFloat(e.state))) return null; const a = e.attributes;
  const label = { nws: name || 'NWS station', metar: name || 'Airport', model: 'Open-Meteo' }[a.source] || a.source_name || 'Outdoor';
  return { source: a.source, label, time: +new Date(a.observed), condition: a.condition, temperature: +e.state, humidity: a.humidity, dew_point: a.dew_point,
    wind_speed: a.wind_speed, wind_bearing: a.wind_bearing, wind_gust_speed: a.wind_gust_speed, pressure: a.pressure, visibility: a.visibility };
}
// the weather entity as it is
export function fromWeather(w, name) {
  if (!reports(w)) return null; const a = w.attributes;
  return { source: 'nws', label: name || 'Weather', time: (w.lu || 0) * 1000, condition: w.state, temperature: a.temperature, humidity: a.humidity, dew_point: a.dew_point,
    wind_speed: a.wind_speed, wind_bearing: a.wind_bearing, wind_gust_speed: a.wind_gust_speed, pressure: a.pressure, visibility: a.visibility };
}

export function current(cfg, fn) {
  const name = cfg.iem && cfg.iem.name;
  const pick = () => fn(fromSensor(cfg.ha && st(cfg.ha), name) || fromWeather(cfg.entity && st(cfg.entity), name));
  watch([cfg.ha, cfg.entity].filter(Boolean), pick);
  setInterval(pick, MIN);   // ages roll over
}
