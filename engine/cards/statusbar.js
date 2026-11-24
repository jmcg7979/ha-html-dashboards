// Status line for a screen without the rail (TV): the time and date on the left; on the right, in one line and without
// boxes, who's home (photo rings), the alarm, the weather now with today's high / low, then round buttons.
// { type: 'statusbar', weather: 'weather.home', sun: 'sun.sun', forecast: 'twice_daily', fallback: { lat, lon },
//   people: [{ entity, name, tap }], alarm: 'alarm_control_panel.x', alarmTap, weatherTap,
//   playing: { players: [...home.js players], skip: 'media_player.this_tv', tap },   what plays elsewhere in the house:
//     shown only while something does (the room, or how many, and the song); skip = this screen's own player
//   notes: [{ icon, tone: 'ember', entities: [ids], value: () => ({ title, text }) | null, tap }]   something else going on in the
//     house, there only while it is (value() gives null otherwise): a cook on the grill
//   On a TV the launcher's screensaver gets the weather too (core/tvhost.js saver).
//   buttons: [{ icon, label, action }] }   label: what the button is called (core/tips.js says it beside the button);
//     action / tap: see core/actions.js, or a function run as is
// The right side's items spread over the width after the clock; with a tap they are buttons (TV: selectable with the remote).
import { h, esc, icon, setText, setHTML } from '../core/dom.js';
import { st, watch, tick } from '../core/store.js';
import { origin } from '../core/auth.js';
import { run } from '../core/actions.js';
import { timeOpts } from '../core/units.js';
import { forecast, todayHiLo, wxIcon, wxImg, condText, TEXT } from '../core/forecast.js';
import { idsOf, isLive, now } from '../core/players.js';
import * as tv from '../core/tvhost.js';
import { alarmView } from '../core/states.js';

const deg = (v) => (v == null || isNaN(v) ? '–' : Math.round(v) + '°');

export { alarmView };   // the rule is core/states.js's

export default function statusbar(cfg) {
  const ppl = cfg.people || [], btns = cfg.buttons || [], notes = cfg.notes || [];
  const el = h(`<div class="sbar">
    <div class="sbclock"><b></b><span></span></div>
    <div class="sbright">
      ${cfg.playing ? `<button class="sbi sbplay" hidden><span class="sbic">${icon('music')}</span><span class="sbt"><b></b><small></small></span></button>` : ''}
      ${notes.map((n, i) => `<${n.tap ? 'button' : 'div'} class="sbi sbnote" data-n="${i}" style="--t:var(--${n.tone || 'mist'})" hidden><span class="sbic">${icon(n.icon)}</span><span class="sbt"><b></b><small></small></span></${n.tap ? 'button' : 'div'}>`).join('')}
      ${ppl.map((p, i) => `<${p.tap ? 'button' : 'div'} class="sbi sbperson" data-p="${i}"><span class="sbp"><img alt=""></span><span class="sbt"><b>${esc(p.name)}</b><small></small></span></${p.tap ? 'button' : 'div'}>`).join('')}
      ${cfg.alarm ? `<${cfg.alarmTap ? 'button' : 'div'} class="sbi sbalarm"><span class="sbic"></span><span class="sbt"></span></${cfg.alarmTap ? 'button' : 'div'}>` : ''}
      ${cfg.weather ? `<${cfg.weatherTap ? 'button' : 'div'} class="sbi sbwx"><span class="sbimg"></span><span class="sbt"><b></b><small></small></span></${cfg.weatherTap ? 'button' : 'div'}>` : ''}
      ${btns.length ? `<div class="sbbtns">${btns.map((b, i) => `<button class="rbtn" data-i="${i}" aria-label="${esc(b.label || '')}">${icon(b.icon)}</button>`).join('')}</div>` : ''}
    </div></div>`);
  const [time, date] = el.querySelector('.sbclock').children;
  // on the store's clock (looked at once a second, stopped with this view), written when the minute changes
  const clock = () => {
    const n = new Date();
    setText(time, n.toLocaleTimeString([], timeOpts({ hour: 'numeric', minute: '2-digit' })).replace(/\s?[ap]\.?\s?m\.?$/i, ''));
    setText(date, n.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
  };
  let minute = -1;
  const everyMinute = () => { const m = Math.floor(Date.now() / 60000); if (m !== minute) { minute = m; clock(); } };
  everyMinute(); tick(everyMinute);

  [...el.querySelectorAll('.sbperson')].forEach((d, i) => watch([ppl[i].entity], () => {
    const e = st(ppl[i].entity), pic = e && e.attributes.entity_picture, img = d.querySelector('img');
    if (pic && img.getAttribute('src') !== origin + pic) img.src = origin + pic;
    d.querySelector('.sbp').dataset.where = !e ? 'unknown' : e.state === 'home' ? 'home' : 'away';
    setText(d.querySelector('small'), !e ? '–' : e.state === 'home' ? 'Home' : e.state === 'not_home' ? 'Away' : e.state);
  }));

  if (cfg.alarm) {
    const a = el.querySelector('.sbalarm');
    watch([cfg.alarm], () => {
      const v = alarmView((st(cfg.alarm) || {}).state);
      a.dataset.s = v.s;
      setHTML(a.querySelector('.sbic'), icon(v.icon));
      setHTML(a.querySelector('.sbt'), `<b>Alarm</b><small>${esc(v.text)}</small>`);
    });
  }

  if (cfg.playing) {
    const b = el.querySelector('.sbplay'), list = (cfg.playing.players || []).filter((p) => p.entity !== cfg.playing.skip && !p.group);
    const draw = () => {
      const live = list.filter(isLive).map((p) => ({ p, n: now(p) })).sort((x, y) => (y.n.state === 'playing') - (x.n.state === 'playing'));
      b.hidden = !live.length; if (!live.length) return;
      const short = (name) => name.replace(/\s+(TV|Speakers?|Display)$/i, '') || name, f = live[0];
      setText(b.querySelector('b'), live.length === 1 ? short(f.p.name) : `${live.length} rooms`);
      setText(b.querySelector('small'), (f.n.state === 'playing' || f.n.state === 'on' ? '' : 'Paused · ') + (f.n.title || f.n.app || 'Playing'));
      b.dataset.s = live.some((x) => x.n.state === 'playing') ? 'on' : 'off';
    };
    watch([...new Set(list.flatMap(idsOf))], draw);
  }

  if (cfg.weather) {
    const w = el.querySelector('.sbwx'), type = cfg.forecast || 'daily';
    let list = [], drawn = '';
    const draw = () => {
      const e = st(cfg.weather); if (!e) return;
      const night = cfg.sun && (st(cfg.sun) || {}).state === 'below_horizon';
      setHTML(w.querySelector('.sbimg'), wxImg(wxIcon(e.state, night)));
      const silent = !e.state || e.state === 'unavailable' || e.state === 'unknown';   // not reporting: no temperature is shown as current
      setText(w.querySelector('b'), silent ? '–' : deg(e.attributes.temperature));
      // today's figures by their date: in the evening the list starts with tonight, and an old list with a day that is over
      const { hi, lo } = todayHiLo(list); drawn = new Date().toDateString();
      setText(w.querySelector('small'), [condText(e.state), hi != null && 'H ' + deg(hi), lo != null && 'L ' + deg(lo)].filter(Boolean).join(' · '));
    };
    watch([cfg.weather, cfg.sun].filter(Boolean), draw);
    forecast(cfg.weather, type, (l) => { list = l || []; draw(); }, cfg.fallback);
    tick(() => { if (new Date().toDateString() !== drawn) draw(); });   // midnight: yesterday's figures go even if nothing else changes
  }

  // On a TV: the launcher's screensaver shows this line's weather too (core/tvhost.js saver)
  notes.forEach((n, i) => { const b = el.querySelector(`.sbnote[data-n="${i}"]`);
    watch(n.entities, () => { const v = n.value(); b.hidden = !v; if (!v) return; setText(b.querySelector('b'), v.title); setText(b.querySelector('small'), v.text || ''); }); });

  if (tv.onTV && !tv.inOverlay) tv.saver({ weather: cfg.weather || '', conditions: TEXT });

  el.addEventListener('click', (ev) => {
    const go = (a, x) => (typeof a === 'function' ? a() : run(a, { el: x, ev }));
    const pe = ev.target.closest('button.sbperson'); if (pe) { go(ppl[+pe.dataset.p].tap, pe); return; }
    if (ev.target.closest('button.sbalarm')) { go(cfg.alarmTap, ev.target); return; }
    if (ev.target.closest('button.sbplay')) { go(cfg.playing.tap, ev.target); return; }
    if (ev.target.closest('button.sbwx')) { go(cfg.weatherTap, ev.target); return; }
    const nt = ev.target.closest('button.sbnote'); if (nt) { go(notes[+nt.dataset.n].tap, nt); return; }
    const b = ev.target.closest('.sbbtns .rbtn'); if (!b) return;
    go(btns[+b.dataset.i].action, b);
  });
  return el;
}
