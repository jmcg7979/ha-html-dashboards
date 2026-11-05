// Alarm (Alarmo): big status, readiness checklist (doors, windows, garage, siren battery), Away / Night / Disarm.
// { type: 'alarm', entity, battery, doors: { id: 'Front', ... }, windows: 'sensor.open_windows', garage, home: true (a Home button, for Alarmo's Home mode),
//   household: ['person.x'], disarm: { call: 'script.alarm_disarm', target: null } }
// Away is blocked while windows are open; Night also while an entry door is open, and needs a second tap.
// Disarm: one tap for a household member's own login (runs cfg.disarm); any other login, e.g. a wall panel's
// shared user, gets a PIN keypad and the code goes to Alarmo, which checks it (so someone walking in during
// the entry delay can't just tap Off).
import { h, esc, icon, setTone, setText, setHTML, toggle, setRing } from '../core/dom.js';
import { st, num, watch, tick } from '../core/store.js';
import { run } from '../core/actions.js';
import { request, user, connected } from '../core/ha.js';
import { toast } from '../core/toast.js';

const ICON = { disarmed: 'shield-off-outline', armed_away: 'shield-lock', armed_night: 'shield-moon', armed_home: 'shield-home', armed_vacation: 'shield-lock', arming: 'shield-sync', pending: 'shield-alert', triggered: 'bell-ring' };
const LABEL = { disarmed: 'Disarmed', armed_away: 'Armed away', armed_night: 'Armed night', armed_home: 'Armed home', armed_vacation: 'Armed vacation', armed_custom_bypass: 'Armed', unavailable: 'Unavailable', unknown: 'Unknown', arming: 'Arming', pending: 'Entry delay', triggered: 'Triggered' };

export default function alarm(cfg) {
  const el = h(`<div class="alarmcard">
    <div class="ahero"><div class="ic ashield"></div><div class="tx"><div class="astate"></div><div class="aready"></div></div></div>
    <div class="achecks">
      <div class="achk" data-k="doors"><span class="ic"></span><span class="tx"><span class="slabel">Entry doors</span><span class="svalue"></span></span></div>
      <div class="achk" data-k="windows"><span class="ic"></span><span class="tx"><span class="slabel">Windows</span><span class="svalue"></span></span></div>
      <div class="achk" data-k="garage"><span class="ic"></span><span class="tx"><span class="slabel">Garage</span><span class="svalue"></span></span></div>
      <div class="achk" data-k="siren"><span class="ic"></span><span class="tx"><span class="slabel">Siren battery</span><span class="svalue"></span></span></div>
    </div>
    <div class="amodes">
      ${cfg.home ? `<button class="amode" data-m="armed_home">${icon('shield-home')}<span>Home</span></button>` : ''}
      <button class="amode" data-m="armed_away">${icon('shield-lock')}<span>Away</span></button>
      <button class="amode" data-m="armed_night">${icon('shield-moon')}<span>Night</span></button>
      <button class="amode" data-m="disarmed">${icon('shield-off')}<span>Disarm</span></button>
    </div>
    <div class="akeypad" hidden><div class="akhead"><span class="sub">Enter your alarm code</span><span class="adots"></span></div>
      <div class="akeys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button class="akey" data-d="${n}">${n}</button>`).join('')}
        <button class="akey" data-x="cancel">${icon('close')}</button><button class="akey" data-d="0">0</button><button class="akey ok" data-x="ok">${icon('check')}</button></div></div>
  </div>`);
  const $ = (s) => el.querySelector(s);
  const shield = $('.ashield'), stateEl = $('.astate'), ready = $('.aready'), pad = $('.akeypad'), dots = $('.adots'), modes = $('.amodes');
  const chk = Object.fromEntries([...el.querySelectorAll('.achk')].map((x) => [x.dataset.k, x]));
  const btn = Object.fromEntries([...el.querySelectorAll('.amode')].map((x) => [x.dataset.m, x]));
  setTone(btn.armed_away, 'mist'); setTone(btn.armed_night, 'plum'); setTone(btn.disarmed, 'sage'); if (btn.armed_home) setTone(btn.armed_home, 'mist');
  const doors = Object.keys(cfg.doors || {});
  const openDoors = () => doors.filter((d) => (st(d) || {}).state === 'on').map((d) => cfg.doors[d]);
  const garageOpen = () => ['open', 'opening', 'closing'].includes((st(cfg.garage) || {}).state);
  // a sensor that can't say is not a closed door
  const lost = (id) => { const e = st(id); return !id ? false : !e || ['unknown', 'unavailable'].includes(e.state); };
  const household = () => !!user && (cfg.household || []).some((p) => { const e = st(p); return e && e.attributes.user_id === user.id; });
  // a row with nothing behind it goes, rather than reading "All closed"
  Object.entries({ doors: Object.keys(cfg.doors || {}).length, windows: cfg.windows, garage: cfg.garage, siren: cfg.battery }).forEach(([k, on]) => { if (!on) { chk[k].remove(); delete chk[k]; } });
  const setChk = (k, ico, text, bad, tone = 'ember') => { const c = chk[k]; if (!c) return; setHTML(c.querySelector('.ic'), icon(ico)); setText(c.querySelector('.svalue'), text); setTone(c, bad ? tone : 'sage'); toggle(c, 'bad', bad); };
  let can = {}, code = '', padT = 0;

  const draw = () => {
    const e = st(cfg.entity), s = e ? e.state : 'unknown', a = (e && e.attributes) || {};
    const od = openDoors(), g = garageOpen(), win = num(cfg.windows) || 0, bat = num(cfg.battery), dis = s === 'disarmed', noState = !e || ['unknown', 'unavailable'].includes(s), armed = !dis && !noState;
    const lostDoors = doors.filter(lost), lostWin = lost(cfg.windows), lostGarage = lost(cfg.garage), blind = lostDoors.length > 0 || lostWin || lostGarage;
    const tone = s === 'triggered' || s === 'pending' ? 'ember' : s === 'arming' ? 'lamp' : noState ? 'stone' : !dis ? 'mist' : od.length || g || win || blind ? 'stone' : 'sage';
    setTone(el, tone); toggle(el, 'armed', armed); toggle(el, 'alerting', s === 'triggered' || s === 'pending');   // not 'alarm': that class is the full-screen timer overlay
    setHTML(shield, icon(ICON[s] || 'shield-outline')); setRing(shield, bat);
    let left = '';
    if ((s === 'arming' || s === 'pending') && a.delay && e.lc) { const r = Math.ceil(a.delay - (Date.now() / 1000 - e.lc)); if (r > 0) left = ` · ${r}s`; }
    setText(stateEl, (LABEL[s] || s) + left);
    const issues = [...od.map((d) => `${d} door`), ...(g ? ['garage'] : []), ...(win ? [`${win} window${win > 1 ? 's' : ''}`] : [])];
    setText(ready, noState ? 'No status from the alarm' : s === 'triggered' ? 'Alarm going off' : s === 'pending' ? 'Disarm now' : !dis ? (a.changed_by ? `By ${a.changed_by}` : 'Protected') : issues.length ? `Not ready: ${issues.join(', ')} open` : blind ? 'Some sensors are offline' : 'Ready to arm');
    setChk('doors', od.length ? 'door-open' : 'door-closed', od.length ? `${od.join(', ')} open` : lostDoors.length ? 'Unknown' : 'All closed', od.length > 0 || lostDoors.length > 0);
    setChk('windows', win ? 'window-open-variant' : 'window-closed-variant', win ? `${win} open` : lostWin ? 'Unknown' : 'All closed', win > 0 || lostWin);
    setChk('garage', g ? 'garage-open' : 'garage', g ? 'Open' : lostGarage ? 'Unknown' : 'Closed', g || lostGarage);
    setChk('siren', 'battery', bat == null ? '–' : Math.round(bat) + '%', bat != null && bat < 25);
    can = { home: dis, away: dis && !win, night: dis && !win && !od.length, off: !dis && !noState };
    Object.entries(btn).forEach(([m, b]) => { toggle(b, 'on', s === m || (m !== 'disarmed' && s === 'arming' && a.next_state === m)); });
    toggle(btn.armed_away, 'dim', dis && !can.away); toggle(btn.armed_night, 'dim', dis && !can.night); toggle(btn.disarmed, 'dim', false);
    if (dis) closePad();
  };
  watch([cfg.entity, cfg.battery, cfg.windows, cfg.garage, ...doors, ...(cfg.household || [])], draw);
  tick(() => { const s = (st(cfg.entity) || {}).state; if (s === 'arming' || s === 'pending') draw(); });

  // a typed code never outlives the keypad: gone when the pop-up closes or after 30 s of nothing
  const padIdle = () => { clearTimeout(padT); padT = setTimeout(closePad, 30000); };
  const openPad = () => { code = ''; setText(dots, ''); toggle(el, 'wrong', false); pad.hidden = false; modes.hidden = true; padIdle(); };
  function closePad() { clearTimeout(padT); pad.hidden = true; modes.hidden = false; code = ''; setText(dots, ''); }
  new IntersectionObserver((e) => { if (!e[e.length - 1].isIntersecting && !pad.hidden) closePad(); }).observe(el);
  const sendCode = (b, ev) => {
    if (!code) return;
    if (!connected()) { toast('Not connected. Nothing was sent.'); return; }
    const c = code; setText(dots, '…');
    request({ type: 'call_service', domain: 'alarm_control_panel', service: 'alarm_disarm', service_data: { code: c }, target: { entity_id: cfg.entity } }).catch(() => {});
    // Alarmo doesn't always report a wrong code as an error: judge by the state a moment later
    setTimeout(() => { if ((st(cfg.entity) || {}).state !== 'disarmed') { code = ''; setText(dots, ''); toggle(el, 'wrong', true); setTimeout(() => toggle(el, 'wrong', false), 600); } }, 2500);
  };

  el.addEventListener('click', (ev) => {
    const k = ev.target.closest('.akey');
    if (k) {
      padIdle();
      if (k.dataset.d != null && code.length < 10) { code += k.dataset.d; setText(dots, '•'.repeat(code.length)); }
      else if (k.dataset.x === 'cancel') closePad();
      else if (k.dataset.x === 'ok') sendCode(k, ev);
      return;
    }
    const b = ev.target.closest('.amode'); if (!b) return;
    const m = b.dataset.m, until = (r) => r.state !== 'disarmed';
    if (m === 'armed_home' && can.home) run({ call: 'alarm_control_panel.alarm_arm_home', expect: { state: 'arming', until } }, { el: b, ev, entity: cfg.entity });
    if (m === 'armed_away' && can.away) run({ call: 'alarm_control_panel.alarm_arm_away', expect: { state: 'arming', until } }, { el: b, ev, entity: cfg.entity });
    if (m === 'armed_night' && can.night) run({ call: 'alarm_control_panel.alarm_arm_night', confirm: true, expect: { state: 'arming', until } }, { el: b, ev, entity: cfg.entity });
    if (m === 'disarmed' && can.off) { if (household() && cfg.disarm) run(Object.assign({ expect: { entity: cfg.entity, state: 'disarmed' } }, cfg.disarm), { el: b, ev, entity: cfg.entity }); else openPad(); }
  });
  return el;
}
