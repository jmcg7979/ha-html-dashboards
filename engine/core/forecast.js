// Shared forecast loader: weather.get_forecasts per entity + type, cached and refreshed every 30 min while a card shows it.
// forecast(entity, 'hourly' | 'daily' | 'twice_daily', (list, meta) => {}, fallback) calls back now (if cached) and on every refresh.
// fallback { lat?, lon? } (left out: HA's home location, core/location.js): when HA returns no forecast (the NWS entity goes unavailable whenever its observation station
// stops reporting, and HA skips unavailable entities), the same NWS forecast is read straight from api.weather.gov in the
// browser, mapped to HA's format; meta = { source: 'weather.gov', updated: Date } then (null = HA). HA is tried again on every refresh.
// Both failing: the last list comes again with meta = { failed: true, updated: Date }, so a card can say how old it is; with
// no list yet the card gets an empty one and meta = { failed: true, updated: null }, and the next try is two minutes later.
// A list can be hours old (a screen that slept, a connection that was down): the cards pick entries by their date, never by
// their place in the list (byDay, todayOf, fromToday, running below).
import { request, onReady, connected } from './ha.js';
import { outside, onDispose } from './scope.js';
import { where } from './location.js';
import { timeOpts } from './units.js';
import { asset } from './asset.js';

const MIN = 60e3;
const cache = {};
let started = false;

// how long until the next try: soon while there is nothing to show; sooner than usual on the fallback or after a failure,
// so HA's entity is picked up again soon after it recovers
const every = (c) => (!c.list ? 2 : c.meta ? 10 : 30) * MIN;
// one card's callback failing must not keep the list from the others
const tell = (c, fn) => { try { fn(c.list || [], c.meta); } catch (e) { console.error(e); } };
const within = (p, ms) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), ms); p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); });

const fromHa = (c) => request({ type: 'call_service', domain: 'weather', service: 'get_forecasts', service_data: { type: c.type }, target: { entity_id: c.entity }, return_response: true })
  .then((x) => ((x.response || {})[c.entity] || {}).forecast || []);
const direct = (c) => (c.fb && (c.type === 'hourly' || c.type === 'twice_daily')
  ? within(where(c.fb).then((at) => (at ? nwsDirect(at, c.type) : Promise.reject(new Error('no location')))), 30e3) : Promise.reject(new Error('no fallback')));

// HA first, weather.gov when HA has nothing; then every card is told once, whatever came of it
async function load(c) {
  const my = ++c.asked; c.tried = Date.now();
  let got = null;
  try { const list = await fromHa(c); if (list.length) got = { list, meta: null }; } catch (e) { /* HA didn't answer: the fallback is next */ }
  if (!got) try { const r = await direct(c); if (r.list.length) got = { list: r.list, meta: { source: 'weather.gov', updated: r.updated } }; } catch (e) { /* neither: said below */ }
  if (my < c.answered) return;   // a later load has answered already
  c.answered = my;
  if (got) { c.list = got.list; c.meta = got.meta; c.at = new Date(); } else c.meta = { failed: true, updated: c.list ? c.at : null };
  c.fns.forEach((fn) => tell(c, fn));
}

// Loads every forecast a card is showing whose time has come. Runs every minute, and at once when the page is shown again
// (a refresh that fell due while it was hidden is made up then). A forecast nobody shows is not fetched.
export function refresh(now = Date.now()) {
  if (document.hidden || !connected()) return;
  Object.values(cache).forEach((c) => { if (c.fns.size && now - c.tried >= every(c)) load(c); });
}
function start() {
  started = true;
  outside(() => {   // shared by every card: these outlive the view that asked first
    onReady(() => Object.values(cache).forEach((c) => { if (c.fns.size) load(c); else c.tried = 0; }));
    setInterval(() => refresh(), MIN);
    document.addEventListener('visibilitychange', () => refresh());
    window.addEventListener('tv:resume', () => refresh());
  });
}

export function forecast(entity, type, fn, fallback) {
  const k = entity + '|' + type;
  const c = cache[k] || (cache[k] = { entity, type, list: null, meta: null, at: null, fns: new Set(), fb: fallback, tried: 0, asked: 0, answered: 0 });
  if (!started) start();
  if (fallback && !c.fb) c.fb = fallback;
  if (fallback) where(fallback);   // read it now: the fallback is needed when HA is having trouble
  c.fns.add(fn); onDispose(() => c.fns.delete(fn));   // the card's view unloaded: stop calling it
  if (c.list || c.meta) tell(c, fn);
  refresh();
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
// NWS icon codes -> HA conditions, in the groups HA's nws integration uses (its CONDITION_CLASSES), so a forecast reads
// the same whichever way it arrived; first code in the icon URL wins
const NWS = { sunny: ['skc'], partlycloudy: ['few', 'sct'], cloudy: ['bkn', 'ovc'], fog: ['fog'], windy: ['wind_skc', 'wind_few', 'wind_sct'], 'windy-variant': ['wind_bkn', 'wind_ovc'],
  rainy: ['rain', 'rain_showers', 'rain_showers_hi'], 'lightning-rainy': ['tsra', 'tsra_sct', 'tsra_hi'],
  snowy: ['snow', 'sleet', 'snow_sleet', 'blizzard'], 'snowy-rainy': ['rain_snow', 'rain_sleet', 'fzra', 'rain_fzra', 'snow_fzra'],
  exceptional: ['tornado', 'hurricane', 'tropical_storm', 'dust', 'smoke', 'haze', 'hot', 'cold'] };
export function nwsCondition(icon, day) {
  const m = /\/icons\/land\/(?:day|night)\/([a-z_]+)/.exec(icon || ''), code = m && m[1];
  for (const k in NWS) if (NWS[k].includes(code)) return k === 'sunny' && day === false ? 'clear-night' : k;
  return 'exceptional';
}
// ---- reading a list by date ----
export const sameDay = (a, b) => a.toDateString() === b.toDateString();
const dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const dayDiff = (d, now) => Math.round((dayStart(d) - dayStart(now)) / 864e5);   // rounded: a day with a clock change is 23 or 25 hours
// The moment an entry is for. A daily entry stamped with a date only ("2026-11-14"), or with that date at midnight UTC, means
// that calendar day wherever the screen is; read as a time it would fall on the evening before, anywhere west of UTC.
export function stampDate(p) {
  const s = String(p.datetime), m = /^(\d{4})-(\d\d)-(\d\d)(T00:00(:00(\.0+)?)?(Z|[+-]00:?00))?$/.exec(s);
  return m && (!m[4] || p.is_daytime !== false) ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
}

// "weather.gov direct · 4:52 PM" for a card's source line; with the day when that was not today
const stamp = (d, now) => { const n = dayDiff(d, now);
  return (n === 0 ? '' : d.toLocaleDateString([], n > -7 && n < 0 ? { weekday: 'short' } : { month: 'short', day: 'numeric' }) + ' ') + d.toLocaleTimeString([], timeOpts({ hour: 'numeric', minute: '2-digit' })); };
export const viaLine = (meta, now = new Date()) => (!meta ? '' : !meta.failed ? `weather.gov direct (HA's NWS is down) · ${stamp(meta.updated, now)}`
  : meta.updated ? `Forecast not updating · from ${stamp(meta.updated, now)}` : 'The forecast didn’t load');

// Forecast list -> one entry per calendar day: { date, hi, lo, cond, day (has a daytime period), short, pp, text: [[Day|Night, words]] }.
// Takes both shapes: 'twice_daily' (a day and a night period per date) and 'daily' (one entry, low in templow).
export function byDay(list) {
  const by = new Map();
  list.forEach((p) => { const dt = stampDate(p), k = dt.toDateString(); if (!by.has(k)) by.set(k, { date: dt, text: [] }); const d = by.get(k);
    if (p.is_daytime !== false) { d.hi = p.temperature; d.cond = p.condition; d.day = true; d.short = p.short_description || p.detailed_description; if (p.templow != null) d.lo = p.templow; }
    else { d.lo = p.temperature; if (!d.cond) { d.cond = p.condition; d.short = p.short_description || p.detailed_description; } }
    d.pp = Math.max(d.pp || 0, p.precipitation_probability || 0);
    if (p.detailed_description) d.text.push([p.is_daytime === false ? 'Night' : 'Day', p.detailed_description]); });
  return [...by.values()];
}
// byDay()'s entry for today; none when the list has nothing for today (an old list, or the day part is over)
export const todayOf = (days, now = new Date()) => days.find((d) => sameDay(d.date, now));
// byDay()'s days from today on: an old list starts with days that are over
export const fromToday = (days, now = new Date()) => days.filter((d) => d.date >= dayStart(now));
// today's high and low out of a forecast list (null where the list has none for today: after the day period, only the low is left)
export function todayHiLo(list, now = new Date()) { const d = todayOf(byDay(list || []), now) || {}; return { hi: d.hi ?? null, lo: d.lo ?? null }; }
// "Today" for today's date, else the weekday
export const dayLabel = (date, now = new Date()) => (sameDay(date, now) ? 'Today' : date.toLocaleDateString([], { weekday: 'short' }));
// A twice-daily list from the period that is running now on: a period is over when the next one has started (the last one
// after 12 hours). An old list gives fewer periods, or none.
export function running(list, now = Date.now()) {
  let i = 0; while (i < list.length - 1 && +new Date(list[i + 1].datetime) <= now) i++;
  return list.length && i === list.length - 1 && now - new Date(list[i].datetime) > 12 * 3600e3 ? [] : list.slice(i);
}
// What to call a period, by its date: Today / Tonight / Overnight (a night period that starts after midnight), Tomorrow, else the weekday
export function periodName(p, now = new Date()) {
  const d = new Date(p.datetime), n = dayDiff(d, now), night = p.is_daytime === false;
  if (n <= 0) return !night ? 'Today' : d.getHours() < 6 && n === 0 ? 'Overnight' : 'Tonight';
  return n === 1 ? (night ? 'Tomorrow night' : 'Tomorrow') : d.toLocaleDateString([], { weekday: 'long' }) + (night ? ' night' : '');
}

// HA condition -> Meteocons file (assets/weather) and words
export const ICON = { 'clear-night': 'clear-night', sunny: 'clear-day', partlycloudy: 'partly-cloudy-day', cloudy: 'cloudy', fog: 'fog', rainy: 'rain', pouring: 'rain', lightning: 'thunderstorms', 'lightning-rainy': 'thunderstorms-rain', snowy: 'snow', 'snowy-rainy': 'sleet', hail: 'hail', windy: 'wind', 'windy-variant': 'wind', exceptional: 'not-available' };
export const TEXT = { 'clear-night': 'Clear', sunny: 'Sunny', partlycloudy: 'Partly cloudy', cloudy: 'Cloudy', fog: 'Foggy', rainy: 'Rain', pouring: 'Heavy rain', lightning: 'Thunderstorms', 'lightning-rainy': 'Storms and rain', snowy: 'Snow', 'snowy-rainy': 'Sleet', hail: 'Hail', windy: 'Windy', 'windy-variant': 'Windy', exceptional: 'Unusual weather' };
// the words for a condition; a weather entity with no state is not reporting, never a made-up condition
export const condText = (cond) => TEXT[cond] || (!cond || cond === 'unavailable' || cond === 'unknown' ? 'Not reporting' : cond);
export const wxIcon = (cond, isNight) => (isNight && cond === 'partlycloudy' ? 'partly-cloudy-night' : isNight && cond === 'sunny' ? 'clear-night' : ICON[cond] || 'not-available');
// The icons are animated SVGs. On a TV the still copies (assets/weather/still/, made by _dev/assemble.sh) are used: one
// animated icon, however small, makes the whole screen redraw 60 times a second (measured 2026-11-13 on a Google TV:
// 140% of its four cores with the status bar's 32 px sun on Home, 220% on the forecast page).
const still = () => (document.documentElement.dataset.profile === 'tv' ? 'still/' : '');
export const wxImg = (name) => `<img alt="" src="${asset(`assets/weather/${still()}${name}.svg`)}">`;
// A bearing as one of eight directions. HA may also give the direction as a word already ('NNE'): that is shown as it is.
export function compass(deg) {
  if (deg == null || deg === '') return '';
  if (isNaN(+deg)) { const w = String(deg).trim().toUpperCase(); return /^[NESW]{1,3}$/.test(w) ? w : ''; }
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((((+deg) % 360) + 360) % 360) / 45) % 8];
}
