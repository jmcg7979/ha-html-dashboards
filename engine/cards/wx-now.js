// Weather page, conditions now (NWS). Laid out to fill a tall panel (grow: true):
//   alerts (red banners) · hero: big icon, temperature, condition, today's high/low · tonight (and NWS text when it has some)
//   · eight fact tiles at the bottom: wind, gusts, rain chance, humidity, dew point, pressure, sunrise, sunset.
// If it doesn't all fit the panel (e.g. while an alert banner shows), it drops the NWS text first, then the tonight row, then the alert's headline.
// "Now" comes from the freshest source (core/current.js: NWS observation, airport METAR via IEM, Open-Meteo); a line under the
// condition names the source and the time of the reading, so an old reading is never passed off as current.
// { type: 'wx-now', entity: 'weather.home_nws', alerts: 'sensor.nws_alerts', sun: 'sun.sun', lat, lon, iem: { station, network, name }, maxAge: 75 }   lat, lon: optional, default HA's home location
import { h, esc, icon, setHTML } from '../core/dom.js';
import { st, watch, tick } from '../core/store.js';
import { forecast, TEXT, wxIcon, wxImg, compass } from '../core/forecast.js';
import { current } from '../core/current.js';
import { timeOpts } from '../core/units.js';
import { stripCell } from './strip.js';

export const panel = true;   // on a page: its own glass panel (core/layout.js)

const r = (v) => (v == null || isNaN(v) ? '–' : Math.round(v));
const t = (iso) => (iso ? new Date(iso).toLocaleTimeString([], timeOpts({ hour: 'numeric', minute: '2-digit' })) : '–');

export default function wxNow(cfg) {
  const el = h('<div class="wxnow"><div class="wxalerts"></div><div class="wxhero"></div><div class="wxnext"></div><div class="wxfacts strip"></div></div>');
  let periods = [], hours = [], cur = null;
  const draw = () => {
    const w = st(cfg.entity), sun = st(cfg.sun || 'sun.sun'); if (!w) return;
    const night = sun && sun.state === 'below_horizon';
    const h0 = hours[0], a = cur || { ...w.attributes, condition: w.state, time: (w.lu || 0) * 1000, label: 'NWS station' };
    let cond = a.condition; if (night && cond === 'sunny') cond = 'clear-night';
    const mins = Math.round((Date.now() - a.time) / 60e3);
    const when = a.source === 'model' ? 'estimate for here · ' + t(a.time) : mins < 2 ? 'just now' : mins < 60 ? `${mins} min ago` : t(a.time);
    const day = periods.find((p) => p.is_daytime), nite = periods.find((p) => p.is_daytime === false);
    const today = periods[0] && periods[0].is_daytime ? periods[0] : null;

    setHTML(el.querySelector('.wxhero'), `<div class="wxicon">${wxImg(wxIcon(cond, night))}</div>
      <div class="wxtemp"><div class="wxt">${r(a.temperature)}°</div>
        <div class="wxd"><div class="wxc">${esc(TEXT[cond] || cond)}</div>
          <div class="wxhl">${day && today ? `<span>${icon('arrow-up')}${r(day.temperature)}°</span>` : ''}${nite ? `<span>${icon('arrow-down')}${r(nite.temperature)}°</span>` : ''}</div>
          <div class="wxsrc${mins > 90 ? ' old' : ''}">${esc(a.label)} · ${esc(when)}</div></div></div>`);

    // tonight (or tomorrow once it's night), plus NWS's own words when the integration provides them
    const next = periods.find((p, i) => i > 0) || null, words = periods[0] && (periods[0].detailed_description || periods[0].short_description);
    const nextName = next ? (next.is_daytime ? 'Tomorrow' : 'Tonight') : '';
    setHTML(el.querySelector('.wxnext'), (next ? `<div class="wxnx"><span class="wxni">${wxImg(wxIcon(next.condition, !next.is_daytime))}</span>
        <span class="wxnt"><b>${nextName}</b><span class="sub">${esc(TEXT[next.condition] || next.condition)}${next.precipitation_probability ? ` · ${r(next.precipitation_probability)}% rain` : ''}</span></span>
        <span class="wxnv">${next.is_daytime ? 'High' : 'Low'} <b>${r(next.temperature)}°</b></span></div>` : '') + (words ? `<div class="wxtext">${esc(words)}</div>` : ''));

    const rain = today ? today.precipitation_probability : h0 ? h0.precipitation_probability : null;
    const facts = [
      ['weather-windy', 'Wind', a.wind_speed != null ? (a.wind_speed < 1 ? 'Calm' : `${compass(a.wind_bearing)} ${r(a.wind_speed)} mph`) : '–'],
      ['weather-dust', 'Gusts', a.wind_gust_speed != null && a.wind_gust_speed > (a.wind_speed || 0) + 3 ? r(a.wind_gust_speed) + ' mph' : 'None'],
      ['umbrella-outline', 'Rain today', rain != null ? r(rain) + '%' : '–'],
      ['water-percent', 'Humidity', a.humidity != null ? r(a.humidity) + '%' : '–'],
      ['thermometer-water', 'Dew point', a.dew_point != null ? r(a.dew_point) + '°' : h0 && h0.dew_point != null ? r(h0.dew_point) + '°' : '–'],
      ['gauge', 'Pressure', a.pressure != null ? (+a.pressure).toFixed(2) + ' in' : '–'],
      ['weather-sunset-up', 'Sunrise', sun ? t(sun.attributes.next_rising) : '–'],
      ['weather-sunset-down', 'Sunset', sun ? t(sun.attributes.next_setting) : '–']];
    setHTML(el.querySelector('.wxfacts'), facts.map(([i, n, v]) => stripCell(n, '', v, icon(i))).join(''));

    const al = (((st(cfg.alerts) || {}).attributes || {}).Alerts || []);
    setHTML(el.querySelector('.wxalerts'), al.map((x) => `<div class="wxalert"><b>${esc(x.Event || x.Headline || 'Weather alert')}</b><span>${esc(x.Headline || '')}</span></div>`).join(''));
    fit();
  };
  // drop the least important rows until the panel fits (never the temperature, an alert's name or the facts)
  const fit = () => {
    el.classList.remove('drop1', 'drop2', 'drop3');
    if (!el.clientHeight) return;
    for (const c of ['drop1', 'drop2', 'drop3']) { if (el.scrollHeight <= el.clientHeight + 1) return; el.classList.add(c); }
  };
  new ResizeObserver(fit).observe(el);
  watch([cfg.entity, cfg.alerts, cfg.sun || 'sun.sun'], draw);
  current({ entity: cfg.entity, lat: cfg.lat, lon: cfg.lon, iem: cfg.iem, maxAge: cfg.maxAge, ha: cfg.ha }, (c) => { cur = c; draw(); });
  forecast(cfg.entity, 'twice_daily', (l) => { periods = l; draw(); }, { lat: cfg.lat, lon: cfg.lon });
  forecast(cfg.entity, 'hourly', (l) => { hours = l.filter((x) => new Date(x.datetime) > Date.now() - 3600e3); draw(); }, { lat: cfg.lat, lon: cfg.lon });
  let last = 0; tick(() => { if (Date.now() - last > 60e3) { last = Date.now(); draw(); } });   // staleness and the hour roll over
  return el;
}
