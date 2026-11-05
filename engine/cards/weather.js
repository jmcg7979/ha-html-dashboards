// Weather: conditions now, the next 24 hours as a temperature curve with rain chances, and the next five days.
// { type: 'weather', entity: 'weather.forecast_home', sun: 'sun.sun', hours: 24, days: 5 }
// Forecasts come from the weather.get_forecasts service (refreshed every 30 min).
import { h, esc, setText, setHTML } from '../core/dom.js';
import { st, watch } from '../core/store.js';
import { request, onReady, connected } from '../core/ha.js';
import { smooth } from '../core/history.js';
import { timeOpts } from '../core/units.js';

export const panel = true;   // on a page: its own glass panel (core/layout.js)

const ICON = { 'clear-night': 'clear-night', sunny: 'clear-day', partlycloudy: 'partly-cloudy-day', cloudy: 'cloudy', fog: 'fog', rainy: 'rain', pouring: 'rain', lightning: 'thunderstorms', 'lightning-rainy': 'thunderstorms-rain', snowy: 'snow', 'snowy-rainy': 'sleet', hail: 'hail', windy: 'wind', 'windy-variant': 'wind', exceptional: 'not-available' };
const TEXT = { 'clear-night': 'Clear', sunny: 'Sunny', partlycloudy: 'Partly cloudy', cloudy: 'Cloudy', fog: 'Foggy', rainy: 'Rain', pouring: 'Heavy rain', lightning: 'Thunderstorms', 'lightning-rainy': 'Storms and rain', snowy: 'Snow', 'snowy-rainy': 'Sleet', hail: 'Hail', windy: 'Windy', 'windy-variant': 'Windy', exceptional: 'Unusual weather' };
const night = (cond, isNight) => (isNight && cond === 'partlycloudy' ? 'partly-cloudy-night' : isNight && cond === 'sunny' ? 'clear-night' : ICON[cond] || 'not-available');
const img = (name) => `<img alt="" src="${new URL(`../assets/weather/${name}.svg`, import.meta.url).href}">`;
const r = (v) => (v == null || isNaN(v) ? '–' : Math.round(v));

export default function weather(cfg) {
  const el = h(`<div class="weather${cfg.compact ? ' compact' : ''}">
    <div class="wnow"><div class="wicon"></div><div class="wtemp"></div><div class="wdesc"><div class="name wcond"></div><div class="sub whilo"></div></div></div>
    <div class="wfacts"></div>
    <svg class="wcurve" viewBox="0 0 320 98" preserveAspectRatio="none"></svg>
    <div class="wdays"></div></div>`);
  const q = (s) => el.querySelector(s);
  let hourly = [], daily = [];

  const drawNow = () => {
    const w = st(cfg.entity); if (!w) return;
    const a = w.attributes, isNight = (st(cfg.sun || 'sun.sun') || {}).state === 'below_horizon';
    setHTML(q('.wicon'), img(night(w.state, isNight)));
    setText(q('.wtemp'), r(a.temperature) + '°');
    setText(q('.wcond'), TEXT[w.state] || w.state);
    const today = daily[0];
    setText(q('.whilo'), today ? `High ${r(today.temperature)}°, low ${r(today.templow)}°` : '');
    setHTML(q('.wfacts'), [['Feels like', a.apparent_temperature != null ? r(a.apparent_temperature) + '°' : null], ['Humidity', a.humidity != null ? r(a.humidity) + '%' : null], ['Wind', a.wind_speed != null ? r(a.wind_speed) + ' ' + (a.wind_speed_unit || '') : null]]
      .filter((f) => f[1]).map((f) => `<div><span class="sub">${f[0]}</span><b>${esc(f[1])}</b></div>`).join(''));
  };

  const drawCurve = () => {
    const H = hourly.filter((x, i) => i % 3 === 0).slice(0, 9); if (H.length < 2) return;
    const temps = H.map((x) => x.temperature), lo = Math.min(...temps) - 1, hi = Math.max(...temps) + 1;
    const X = (i) => 14 + (i * 292) / (H.length - 1), Y = (t) => 22 + (1 - (t - lo) / (hi - lo)) * 40;
    const xy = H.map((x, i) => [X(i), Y(x.temperature)]), path = smooth(xy);
    const rain = H.map((x, i) => { const p = Math.round(x.precipitation_probability || 0); return p >= 20 ? `<text x="${X(i)}" y="80" class="wrain">${p}%</text>` : ''; }).join('');
    q('.wcurve').innerHTML = `<defs><linearGradient id="wg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(var(--lamp))" stop-opacity=".28"/><stop offset="1" stop-color="rgb(var(--lamp))" stop-opacity="0"/></linearGradient></defs>` +
      `<path d="${path} L${X(H.length - 1)},70 L${X(0)},70 Z" fill="url(#wg)"/><path d="${path}" class="wline"/>` + rain +
      H.map((x, i) => `<circle cx="${X(i)}" cy="${Y(x.temperature)}" r="2.6" class="wdot"/><text x="${X(i)}" y="${Y(x.temperature) - 8}" class="wt">${r(x.temperature)}°</text>` +
        `<text x="${X(i)}" y="94" class="wh">${i === 0 ? 'Now' : new Date(x.datetime).toLocaleTimeString(undefined, timeOpts({ hour: 'numeric' })).replace(/\s?([ap])\.?\s?m\.?/i, (m, p) => p.toLowerCase())}</text>`).join('');
  };

  const drawDays = () => {
    setHTML(q('.wdays'), daily.slice(1, 1 + (cfg.days || 5)).map((d) => `<div class="wday"><span class="sub">${new Date(d.datetime).toLocaleDateString(undefined, { weekday: 'short' })}</span>${img(ICON[d.condition] || 'not-available')}<b>${r(d.temperature)}°</b><span class="sub">${r(d.templow)}°</span>${d.precipitation_probability >= 20 ? `<span class="wpp">${r(d.precipitation_probability)}%</span>` : ''}</div>`).join(''));
  };

  const load = async () => {
    const get = (type) => request({ type: 'call_service', domain: 'weather', service: 'get_forecasts', service_data: { type }, target: { entity_id: cfg.entity }, return_response: true })
      .then((x) => ((x.response || {})[cfg.entity] || {}).forecast || []).catch(() => []);
    [hourly, daily] = await Promise.all([get('hourly'), get('daily')]);
    drawNow(); drawCurve(); drawDays();
  };
  watch([cfg.entity, cfg.sun || 'sun.sun'], drawNow);
  onReady(load); if (connected()) load();
  setInterval(() => { if (connected() && !document.hidden) load(); }, 30 * 60e3);
  return el;
}
