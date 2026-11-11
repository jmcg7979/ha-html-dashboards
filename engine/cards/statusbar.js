// Status line for a screen without the rail (TV): the time and date on the left; on the right, in one line and without
// boxes, who's home (photo rings), the alarm, the weather now with today's high / low, then round buttons.
// { type: 'statusbar', weather: 'weather.home', sun: 'sun.sun', forecast: 'twice_daily', fallback: { lat, lon },
//   people: [{ entity, name, tap }], alarm: 'alarm_control_panel.x', alarmTap, weatherTap,
//   buttons: [{ icon, label, action }] }   action / tap: see core/actions.js, or a function run as is
// The right side's items spread over the width after the clock; with a tap they are buttons (TV: selectable with the remote).
import { h, esc, icon, setText, setHTML } from '../core/dom.js';
import { st, watch } from '../core/store.js';
import { origin } from '../core/auth.js';
import { run } from '../core/actions.js';
import { timeOpts } from '../core/units.js';
import { forecast, wxIcon, wxImg, TEXT } from '../core/forecast.js';

const deg = (v) => (v == null || isNaN(v) ? '–' : Math.round(v) + '°');

export default function statusbar(cfg) {
  const ppl = cfg.people || [], btns = cfg.buttons || [];
  const el = h(`<div class="sbar">
    <div class="sbclock"><b></b><span></span></div>
    <div class="sbright">
      ${ppl.map((p, i) => `<${p.tap ? 'button' : 'div'} class="sbi sbperson" data-p="${i}"><span class="sbp"><img alt=""></span><span class="sbt"><b>${esc(p.name)}</b><small></small></span></${p.tap ? 'button' : 'div'}>`).join('')}
      ${cfg.alarm ? `<${cfg.alarmTap ? 'button' : 'div'} class="sbi sbalarm"><span class="sbic"></span><span class="sbt"></span></${cfg.alarmTap ? 'button' : 'div'}>` : ''}
      ${cfg.weather ? `<${cfg.weatherTap ? 'button' : 'div'} class="sbi sbwx"><span class="sbimg"></span><span class="sbt"><b></b><small></small></span></${cfg.weatherTap ? 'button' : 'div'}>` : ''}
      ${btns.length ? `<div class="sbbtns">${btns.map((b, i) => `<button class="rbtn" data-i="${i}" aria-label="${esc(b.label || '')}">${icon(b.icon)}</button>`).join('')}</div>` : ''}
    </div></div>`);
  const [time, date] = el.querySelector('.sbclock').children;
  const tick = () => {
    const n = new Date();
    setText(time, n.toLocaleTimeString([], timeOpts({ hour: 'numeric', minute: '2-digit' })).replace(/\s?[ap]\.?\s?m\.?$/i, ''));
    setText(date, n.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
    setTimeout(tick, 60000 - (Date.now() % 60000) + 50);
  };
  tick();

  [...el.querySelectorAll('.sbperson')].forEach((d, i) => watch([ppl[i].entity], () => {
    const e = st(ppl[i].entity), pic = e && e.attributes.entity_picture, img = d.querySelector('img');
    if (pic && img.getAttribute('src') !== origin + pic) img.src = origin + pic;
    d.querySelector('.sbp').dataset.where = !e ? 'unknown' : e.state === 'home' ? 'home' : 'away';
    setText(d.querySelector('small'), !e ? '–' : e.state === 'home' ? 'Home' : e.state === 'not_home' ? 'Away' : e.state);
  }));

  if (cfg.alarm) {
    const a = el.querySelector('.sbalarm');
    watch([cfg.alarm], () => {
      const s = (st(cfg.alarm) || {}).state || '', armed = s && s !== 'disarmed';
      a.dataset.s = s === 'triggered' || s === 'pending' ? 'alert' : armed ? 'armed' : 'off';
      setHTML(a.querySelector('.sbic'), icon(armed ? 'shield-lock' : 'shield-off-outline'));
      setHTML(a.querySelector('.sbt'), `<b>Alarm</b><small>${{ disarmed: 'Off', armed_away: 'Armed away', armed_home: 'Armed home', armed_night: 'Armed night', arming: 'Arming', pending: 'Entry delay', triggered: 'Triggered!' }[s] || s || '–'}</small>`);
    });
  }

  if (cfg.weather) {
    const w = el.querySelector('.sbwx'), type = cfg.forecast || 'daily';
    let list = [];
    const draw = () => {
      const e = st(cfg.weather); if (!e) return;
      const night = cfg.sun && (st(cfg.sun) || {}).state === 'below_horizon';
      setHTML(w.querySelector('.sbimg'), wxImg(wxIcon(e.state, night)));
      setText(w.querySelector('b'), deg(e.attributes.temperature));
      const hi = list.find((f) => f.is_daytime !== false), lo = type === 'twice_daily' ? list.find((f) => f.is_daytime === false) : list[0];
      const low = lo && (type === 'twice_daily' ? lo.temperature : lo.templow);
      setText(w.querySelector('small'), [TEXT[e.state], hi && 'H ' + deg(hi.temperature), low != null && 'L ' + deg(low)].filter(Boolean).join(' · '));
    };
    watch([cfg.weather, cfg.sun].filter(Boolean), draw);
    forecast(cfg.weather, type, (l) => { list = (l || []).filter((f) => new Date(f.datetime) > Date.now() - 6 * 36e5); draw(); }, cfg.fallback);
  }

  el.addEventListener('click', (ev) => {
    const go = (a, x) => (typeof a === 'function' ? a() : run(a, { el: x, ev }));
    const pe = ev.target.closest('button.sbperson'); if (pe) { go(ppl[+pe.dataset.p].tap, pe); return; }
    if (ev.target.closest('button.sbalarm')) { go(cfg.alarmTap, ev.target); return; }
    if (ev.target.closest('button.sbwx')) { go(cfg.weatherTap, ev.target); return; }
    const b = ev.target.closest('.sbbtns .rbtn'); if (!b) return;
    const a = btns[+b.dataset.i].action;
    if (typeof a === 'function') a(); else run(a, { el: b, ev });
  });
  return el;
}
