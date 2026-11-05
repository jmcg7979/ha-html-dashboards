// Weather: conditions now, the next 24 hours (the same chart as the Weather page) and the next five days.
// { type: 'weather', entity: 'weather.forecast_home', sun: 'sun.sun', forecast: 'daily' | 'twice_daily', days: 5, fallback: { lat, lon } }
// forecast: the type the entity supports (default daily); fallback: see core/forecast.js.
import { h, esc, setText, setHTML } from '../core/dom.js';
import { st, watch } from '../core/store.js';
import { forecast, byDay, TEXT, wxIcon, wxImg, compass } from '../core/forecast.js';
import { stripCell } from './strip.js';
import wxHours from './wx-hours.js';

export const panel = true;   // on a page: its own glass panel (core/layout.js)

const r = (v) => (v == null || isNaN(v) ? '–' : Math.round(v));

export default function weather(cfg) {
  const el = h(`<div class="weather">
    <div class="wnow"><div class="wicon"></div><div class="wtemp"></div><div class="wdesc"><div class="name wcond"></div><div class="sub whilo"></div></div></div>
    <div class="wfacts strip"></div>
    <div class="wdays" style="--n:${cfg.days || 5}"></div></div>`);
  const q = (s) => el.querySelector(s);
  el.insertBefore(wxHours({ entity: cfg.entity, hours: 24, bars: false, fallback: cfg.fallback }), q('.wdays'));
  let days = [];

  const drawNow = () => {
    const w = st(cfg.entity); if (!w) return;
    const a = w.attributes, isNight = (st(cfg.sun || 'sun.sun') || {}).state === 'below_horizon';
    setHTML(q('.wicon'), wxImg(wxIcon(w.state, isNight)));
    setText(q('.wtemp'), r(a.temperature) + '°');
    setText(q('.wcond'), TEXT[w.state] || w.state);
    const today = days.find((d) => d.date.toDateString() === new Date().toDateString());
    setText(q('.whilo'), today ? [today.hi != null ? `High ${r(today.hi)}°` : '', today.lo != null ? `Low ${r(today.lo)}°` : ''].filter(Boolean).join(' · ') : '');
    // three figures whatever the source reports: not every source has a feels-like
    const facts = [a.apparent_temperature != null ? ['Feels like', r(a.apparent_temperature) + '°'] : a.dew_point != null ? ['Dew point', r(a.dew_point) + '°'] : null,
      a.humidity != null ? ['Humidity', r(a.humidity) + '%'] : null,
      a.wind_speed != null ? ['Wind', a.wind_speed < 1 ? 'Calm' : `${compass(a.wind_bearing)} ${r(a.wind_speed)} ${a.wind_speed_unit || ''}`.trim()] : null].filter(Boolean);
    q('.wfacts').style.setProperty('--n', facts.length);
    setHTML(q('.wfacts'), facts.map((f) => stripCell(f[0], '', f[1])).join(''));
  };

  const drawDays = () => {
    const end = new Date(); end.setHours(23, 59, 59, 999);
    setHTML(q('.wdays'), days.filter((d) => d.date > end).slice(0, cfg.days || 5).map((d) => `<div class="wday"><span class="wdn">${esc(d.date.toLocaleDateString(undefined, { weekday: 'short' }))}</span>${wxImg(wxIcon(d.cond, !d.day))}
      <span class="wdt"><b>${r(d.hi ?? d.lo)}°</b>${d.hi != null && d.lo != null ? `<span>${r(d.lo)}°</span>` : ''}</span><span class="wpp">${d.pp >= 20 ? r(d.pp) + '%' : ''}</span></div>`).join(''));
  };

  watch([cfg.entity, cfg.sun || 'sun.sun'], drawNow);
  forecast(cfg.entity, cfg.forecast || 'daily', (list) => { days = byDay(list); drawNow(); drawDays(); }, cfg.fallback);
  return el;
}
