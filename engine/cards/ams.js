// AMS (Bambu Lab filament system): one slot per tray drawn as a spool in its filament's colour (several colours = a
// split spool), material and name under it, the slot in use glowing; the external spool below; then the air inside the
// AMS (humidity bar, temperature) and drying. Remaining filament shows as a ring round the spool when the AMS knows it
// (Bambu RFID spools); third-party spools show none.
// { type: 'ams', ams: { name, letter: 'A', trays: [entities], humidity, temp, drying, drying_left, humid: { warn, crit } },
//   external: { entity, active } }
import { h, esc, icon, setText, setHTML } from '../core/dom.js';
import { st, watch } from '../core/store.js';
import { hex, dur } from './print-job.js';

export const panel = true;   // on a page: its own glass panel (core/layout.js)

const val = (id) => { const e = st(id); return !e || ['unknown', 'unavailable', ''].includes(e.state) ? null : e.state; };
const n = (id) => { const v = parseFloat(val(id)); return isNaN(v) ? null : v; };

// a tray's attributes -> what the slot shows
function tray(id) {
  const e = st(id), a = (e && e.attributes) || {};
  const cols = (a.cols && a.cols.length ? a.cols : [a.color]).map(hex).filter(Boolean);
  const empty = !e || a.empty === true || !cols.length || a.type === 'Empty';
  const type = empty ? '' : a.type && a.type !== '?' ? a.type : '';
  const name = empty ? '' : String(e.state || a.name || '').replace(/^\?$/, '');
  return { empty, type, name, cols, active: !!a.active, remain: a.remain_enabled !== false && a.remain >= 0 ? Math.round(a.remain) : null,
    unknown: !empty && !type && !name };
}
const fill = (cols) => (cols.length > 1 ? `conic-gradient(${cols.map((c, i) => `${c} ${(i / cols.length) * 100}% ${((i + 1) / cols.length) * 100}%`).join(', ')})` : cols[0]);

const spool = () => '<span class="ams-ring"><span class="ams-spool"><i class="ams-hub"></i></span></span>';
function paint(el, t) {
  el.classList.toggle('empty', t.empty); el.classList.toggle('active', t.active);
  const sp = el.querySelector('.ams-spool'), rg = el.querySelector('.ams-ring');
  sp.style.setProperty('--fill', t.empty ? 'transparent' : fill(t.cols));
  rg.style.setProperty('--p', t.remain == null ? 0 : t.remain);
  rg.classList.toggle('known', t.remain != null);
}

export default function ams(cfg) {
  const A = cfg.ams, X = cfg.external, W = A.humid || { warn: 35, crit: 50 }, L = A.letter || 'A';
  const el = h(`<div class="ams">
    <div class="hh"><span class="ic on">${icon('tray-full')}</span><span class="tx"><span class="hname">${esc(A.name || 'AMS')}</span><span class="sub ams-sub"></span></span><span class="hbadge ams-badge"></span></div>
    <div class="ams-slots">${A.trays.map((_, i) => `<div class="ams-slot">${spool()}<span class="ams-id">${L}${i + 1}</span><span class="ams-type"></span><span class="ams-name"></span><span class="ams-left"></span></div>`).join('')}</div>
    ${X ? `<div class="ams-ext">${spool()}<span class="ams-etx"><span class="ams-elab">External spool</span><span class="ams-ename"></span></span><span class="ams-etag"></span></div>` : ''}
    <div class="hcap"><div class="cap ams-hum"><span class="clab">Humidity</span><span class="cdet"></span><span class="ctrack"><i></i></span></div></div>
    <div class="hfacts">
      <div class="fact">${icon('thermometer')}<span class="flab">Temperature</span><span class="fval ams-temp"></span></div>
      <div class="fact ams-dry">${icon('heat-wave')}<span class="flab">Drying</span><span class="fval"></span></div>
    </div></div>`);
  const slots = [...el.querySelectorAll('.ams-slot')], badge = el.querySelector('.ams-badge'), sub = el.querySelector('.ams-sub');

  A.trays.forEach((id, i) => watch([id], () => {
    const t = tray(id), s = slots[i]; paint(s, t);
    setText(s.querySelector('.ams-type'), t.empty ? 'Empty' : t.type || '?');
    setText(s.querySelector('.ams-name'), t.empty ? '' : t.name && t.name !== t.type ? t.name : t.unknown ? 'Unknown' : '');
    setText(s.querySelector('.ams-left'), t.active ? 'In use' : t.remain != null ? `${t.remain}% left` : '');
  }));
  if (X) watch([X.entity, X.active], () => {
    const t = tray(X.entity), x = el.querySelector('.ams-ext'), on = (st(X.active) || {}).state === 'on';
    paint(x, { ...t, active: on });
    setText(x.querySelector('.ams-ename'), t.empty ? 'Not loaded' : [t.type, t.name !== t.type ? t.name : ''].filter(Boolean).join(' · ') || 'Loaded');
    setText(x.querySelector('.ams-etag'), on ? 'In use' : '');
  });

  // air inside the AMS, and drying
  const hum = el.querySelector('.ams-hum'), dry = el.querySelector('.ams-dry');
  watch([A.humidity, A.temp, A.drying, A.drying_left], () => {
    const rh = n(A.humidity), t = n(A.temp), drying = (st(A.drying) || {}).state === 'on';
    const lv = rh == null ? -1 : rh > W.crit ? 2 : rh > W.warn ? 1 : 0;
    const tone = drying ? 'lamp' : ['sage', 'lamp', 'ember'][lv] || 'stone';
    el.style.setProperty('--t', `var(--${tone})`);
    const [label, ic] = drying ? ['Drying', 'heat-wave'] : [['Dry', 'water-check-outline'], ['Getting humid', 'water-alert-outline'], ['Humid', 'water-alert']][lv] || ['–', 'water-outline'];
    setHTML(badge, `${icon(ic)}<span>${label}</span>`);
    const tu = (st(A.temp) || {}).attributes, unit = (tu && tu.unit_of_measurement) || '°';
    setText(sub, [t != null ? `${Math.round(t)}${unit}` : '', rh != null ? `${Math.round(rh)}% RH` : ''].filter(Boolean).join(' · '));
    hum.style.setProperty('--t', `var(--${['sage', 'lamp', 'ember'][lv] || 'stone'})`);
    hum.querySelector('i').style.width = (rh == null ? 0 : Math.min(100, rh)) + '%';
    setText(hum.querySelector('.cdet'), rh == null ? '–' : `${Math.round(rh)}%`);
    setText(el.querySelector('.ams-temp'), t == null ? '–' : `${t.toFixed(0)}${unit}`);
    const left = n(A.drying_left);
    dry.classList.toggle('toned', drying); dry.style.setProperty('--t', 'var(--lamp)');
    setText(dry.querySelector('.fval'), drying ? (left ? `${dur(left)} left` : 'On') : 'Off');
  });
  return el;
}
