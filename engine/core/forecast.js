// Shared forecast loader: weather.get_forecasts per entity + type, cached and refreshed every 30 min.
// forecast(entity, 'hourly' | 'daily' | 'twice_daily', (list, meta) => {}, fallback) calls back now (if cached) and on every refresh.
// fallback { lat, lon }: when HA returns no forecast (the NWS entity goes unavailable whenever its observation station
// stops reporting, and HA skips unavailable entities), the same NWS forecast is read straight from api.weather.gov in the
// browser, mapped to HA's format; meta = { source: 'weather.gov', updated: Date } then (null = HA). HA is tried again on every refresh.
// Both failing: the last list comes again with meta = { failed: true, updated: Date }, so a card can say how old it is.
import { request, onReady, connected } from './ha.js';
import { timeOpts } from './units.js';

const cache = {};
export function forecast(entity, type, fn, fallback) {
  const k = entity + '|' + type;
  let c = cache[k];
  if (!c) {
    c = cache[k] = { list: null, meta: null, fns: new Set(), fb: fallback };
    const done = (list, meta) => { c.list = list; c.meta = meta; c.at = new Date(); c.fns.forEach((f) => f(list, meta)); };
    const lost = () => { if (c.list) { c.meta = { failed: true, updated: c.at }; c.fns.forEach((f) => f(c.list, c.meta)); } };
    const direct = () => (c.fb && (type === 'hourly' || type === 'twice_daily') ? nwsDirect(c.fb, type).then((r) => done(r.list, { source: 'weather.gov', updated: r.updated })) : Promise.reject());
    const load = () => request({ type: 'call_service', domain: 'weather', service: 'get_forecasts', service_data: { type }, target: { entity_id: entity }, return_response: true })
      .then((x) => { const list = ((x.response || {})[entity] || {}).forecast || []; if (list.length) done(list, null); else return direct(); })
      .catch(() => direct().catch(lost));
    onReady(load); if (connected()) load();
    // every 30 min; every 10 min while on the fallback, so HA's entity is picked up again soon after it recovers
    let last = 0;
    setInterval(() => { if (document.hidden || !connected()) return; if (Date.now() - last >= (c.meta ? 10 : 30) * 60e3) { last = Date.now(); load(); } }, 60e3);
    last = Date.now();
  }
  if (fallback && !c.fb) c.fb = fallback;
  c.fns.add(fn); if (c.list) fn(c.list, c.meta);
}

// ---- api.weather.gov (CORS open, no key): points -> forecast / forecastHourly ----
let points = null;
const nwsGet = (url) => fetch(url, { headers: { Accept: 'application/geo+json' }, cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
function nwsDirect({ lat, lon }, type) {
  if (!points) points = nwsGet(`https://api.weather.gov/points/${(+lat).toFixed(4)},${(+lon).toFixed(4)}`).then((j) => j.properties).catch((e) => { points = null; throw e; });
  return points.then((p) => nwsGet(type === 'hourly' ? p.forecastHourly : p.forecast)).then((j) => {
    const pr = j.properties || {};
    return { updated: new Date(pr.updateTime || pr.generatedAt || Date.now()), list: (pr.periods || []).map((x) => ({
      datetime: x.startTime, is_daytime: x.isDaytime, temperature: x.temperature,
      condition: nwsCondition(x.icon, x.isDaytime),
      precipitation_probability: (x.probabilityOfPrecipitation || {}).value ?? null,
      short_description: x.shortForecast, detailed_description: type === 'twice_daily' ? x.detailedForecast : undefined,
    })) };
  });
}
// NWS icon codes -> HA conditions (same groups as HA's nws integration); first code in the icon URL wins
const NWS = { sunny: ['skc', 'few'], partlycloudy: ['sct', 'bkn'], cloudy: ['ovc'], fog: ['fog'], windy: ['wind_skc', 'wind_few', 'wind_sct', 'wind_bkn', 'wind_ovc'],
  rainy: ['rain', 'rain_showers', 'rain_showers_hi', 'fzra', 'rain_fzra', 'snow_fzra'], 'lightning-rainy': ['tsra', 'tsra_sct', 'tsra_hi'],
  snowy: ['snow', 'blizzard'], 'snowy-rainy': ['rain_snow', 'rain_sleet', 'snow_sleet', 'sleet'],
  exceptional: ['tornado', 'hurricane', 'tropical_storm', 'dust', 'smoke', 'haze', 'hot', 'cold'] };
function nwsCondition(icon, day) {
  const m = /\/icons\/land\/(?:day|night)\/([a-z_]+)/.exec(icon || ''), code = m && m[1];
  for (const k in NWS) if (NWS[k].includes(code)) return k === 'sunny' && day === false ? 'clear-night' : k;
  return 'exceptional';
}
// "weather.gov · 4:52 PM" for a card's source line
export const viaLine = (meta) => (meta && meta.failed ? `Forecast not updating · from ${meta.updated.toLocaleTimeString([], timeOpts({ hour: 'numeric', minute: '2-digit' }))}` : meta ? `weather.gov direct (HA's NWS is down) · ${meta.updated.toLocaleTimeString([], timeOpts({ hour: 'numeric', minute: '2-digit' }))}` : '');

// HA condition -> Meteocons file (assets/weather) and words
export const ICON = { 'clear-night': 'clear-night', sunny: 'clear-day', partlycloudy: 'partly-cloudy-day', cloudy: 'cloudy', fog: 'fog', rainy: 'rain', pouring: 'rain', lightning: 'thunderstorms', 'lightning-rainy': 'thunderstorms-rain', snowy: 'snow', 'snowy-rainy': 'sleet', hail: 'hail', windy: 'wind', 'windy-variant': 'wind', exceptional: 'not-available' };
export const TEXT = { 'clear-night': 'Clear', sunny: 'Sunny', partlycloudy: 'Partly cloudy', cloudy: 'Cloudy', fog: 'Foggy', rainy: 'Rain', pouring: 'Heavy rain', lightning: 'Thunderstorms', 'lightning-rainy': 'Storms and rain', snowy: 'Snow', 'snowy-rainy': 'Sleet', hail: 'Hail', windy: 'Windy', 'windy-variant': 'Windy', exceptional: 'Unusual weather' };
export const wxIcon = (cond, isNight) => (isNight && cond === 'partlycloudy' ? 'partly-cloudy-night' : isNight && cond === 'sunny' ? 'clear-night' : ICON[cond] || 'not-available');
export const wxImg = (name) => `<img alt="" src="${new URL(`../assets/weather/${name}.svg`, import.meta.url).href}">`;
export const compass = (deg) => (deg == null ? '' : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((+deg % 360) / 45)) % 8]);
