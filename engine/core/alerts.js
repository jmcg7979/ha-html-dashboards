// Things that take over the screen, driven by HA state (configured per dashboard as `alerts`).
//
// timer: { ringing: 'input_boolean.voice_timer_ringing', last: 'input_text.voice_timer_last_ended',
//          sound: { player: 'media_player.wall_panel', url: 'assets/sounds/timer-alarm.wav', volume: 1, on: () => bool } }
//   While the voice timer rings: a full-screen red alarm with a big Stop (stopping = ringing off, which also ends HA's
//   announcements). On the panel it also plays a loud alarm through its own media player at `volume` and puts the
//   volume back afterwards.
//
// cameras: { cameras: [{ id: 'front_doorbell', entity, name, stream, fullStream, ratio, fit }], review: (id) => sensor,
//            timeout: 300, linger: { back_yard: 120 }, party: { entity, block: ['front_doorbell', 'back_yard'] },
//            grid: { sensor, cameras: [ids], title, closeAfter: 60 }, wake: 'switch.wall_panel_screen' }
//   Same rules as an HA automation would use:
//   a camera whose Frigate review status is ALERT pops up (main stream) for the duration of the alert (max `timeout` s,
//   `linger` s longer for some cameras); chosen cameras show together as one grid while `grid.sensor` is on
//   (closes after it has been off for `closeAfter` s). Party Mode blocks the doorbell and back yard popups and the grid.
//   Tap ✕ or outside to dismiss until the next alert.
//
// popups: [{ entity, state, open: '#doorbell', closeAfter: 120 }]   open a pop-up when an entity changes to a state (see popupRules)
import { h, esc, icon } from './dom.js';
import { st, watch } from './store.js';
import { call } from './ha.js';
import { preload, grid } from './layout.js';
import { close as closePopup } from './popup.js';

export function initAlerts(cfg, home) {
  if (!cfg) return;
  if (cfg.timer) timerAlarm(cfg.timer);
  if (cfg.cameras) cameraAlerts(cfg.cameras, home);
  if (cfg.popups) popupRules(cfg.popups);
}

// ---------------- pop-ups that open themselves ----------------
// popups: [{ entity: 'binary_sensor.doorbell_visitor', state: 'on', open: '#doorbell', closeAfter: 120 }]
//   opens the pop-up when the entity changes to `state` (not on page load), closes it after `closeAfter` s if it is still the one open
function popupRules(list) {
  for (const r of list) {
    let prev, timer = 0;
    watch([r.entity], () => {
      const e = st(r.entity), s = e ? e.state : undefined;
      if (s === undefined) return;
      if (prev !== undefined && s === r.state && prev !== s) {
        location.hash = r.open; clearTimeout(timer);
        if (r.closeAfter) timer = setTimeout(() => { if (location.hash === r.open) closePopup(); }, r.closeAfter * 1000);
      }
      prev = s;
    });
  }
}

// ---------------- timer alarm ----------------
function timerAlarm(c) {
  const el = h(`<div class="alarm" hidden><div class="alarm-in"><div class="alarm-ic">${icon('bell-ring')}</div>
    <div class="alarm-t">Timer done</div><div class="alarm-l"></div><button class="alarm-stop">${icon('stop')}<span>Stop</span></button>
    <div class="alarm-h sub">Tap anywhere to stop</div></div></div>`);
  document.body.appendChild(el);
  const label = el.querySelector('.alarm-l');
  let ringing = false, saved = null;
  const sound = c.sound && (!c.sound.on || c.sound.on()) ? c.sound : null;

  const startSound = () => {
    if (!sound) return;
    const p = st(sound.player); if (!p || p.state === 'unavailable') return;
    saved = p.attributes.volume_level;
    call('media_player.volume_set', { volume_level: sound.volume == null ? 1 : sound.volume }, sound.player);
    const url = new URL(sound.url, location.href); url.searchParams.set('t', Date.now());
    call('media_player.play_media', { media_content_id: url.href, media_content_type: 'music' }, sound.player);
  };
  const stopSound = () => {
    if (!sound) return;
    call('media_player.media_stop', {}, sound.player);
    if (saved != null) { const v = saved; saved = null; setTimeout(() => call('media_player.volume_set', { volume_level: v }, sound.player), 400); }
  };

  // the player is watched too: the store only subscribes to entities something watches, and startSound needs its volume
  watch([c.ringing, c.last].concat(sound ? [sound.player] : []), () => {
    const on = (st(c.ringing) || {}).state === 'on';
    let l = ''; try { const j = JSON.parse((st(c.last) || {}).state); if ((j.o === 'done' || !j.o) && j.l) l = `${j.l[0].toUpperCase()}${j.l.slice(1)} timer`; } catch (e) { /* no record */ }
    label.textContent = l;
    if (on === ringing) return;
    ringing = on; el.hidden = !on;
    document.documentElement.classList.toggle('alarm-open', on);
    if (on) startSound(); else stopSound();
  });
  el.addEventListener('click', () => {
    if (!ringing) return;
    call('input_boolean.turn_off', {}, c.ringing);
    ringing = false; el.hidden = true; document.documentElement.classList.remove('alarm-open'); stopSound();
  });
}

// ---------------- camera alert popups ----------------
function cameraAlerts(c, home) {
  const cams = Object.fromEntries(c.cameras.map((x) => [x.id, x]));
  const gridIds = (c.grid && c.grid.cameras) || [];
  const single = c.cameras.filter((x) => !gridIds.includes(x.id));
  const state = {};          // id -> { since, closeT }
  let gridOn = false, gridBlocked = false, gridOffT = 0, dismissed = '', shown = '';   // Party Mode is checked when an alert starts, like HA

  const el = h(`<div class="pwrap camalert" hidden><div class="popup wide" style="--t:var(--ember)">
    <div class="phead"><div class="ic on">${icon('cctv')}</div><div class="tx"><div class="name"></div><div class="sub">Camera alert</div></div>
    <button class="rbtn pclose">${icon('close')}</button></div><div class="pbody"></div></div></div>`);
  document.body.appendChild(el);
  const title = el.querySelector('.phead .name'), body = el.querySelector('.pbody'), views = {};
  el.addEventListener('click', (ev) => { if (ev.target === el || ev.target.closest('.pclose')) { dismissed = shown; render(); } });

  const party = () => c.party && (st(c.party.entity) || {}).state === 'on';
  const blocked = (id) => party() && c.party.block.includes(id);

  // which cameras should be up right now
  const active = () => {
    const now = Date.now(), ids = [];
    single.forEach((x) => { const s = state[x.id]; if (s && !s.blocked && (s.alert || s.closeT > now) && now - s.since < (c.timeout || 300) * 1000) ids.push(x.id); });
    return { grid: gridOn && !gridBlocked, ids };
  };

  const view = (key, cards) => {
    if (!views[key]) { views[key] = grid(cards, 12, home); views[key].classList.add('ppage'); body.appendChild(views[key]); }
    return views[key];
  };
  const camCard = (x, sub) => ({ type: 'camera', entity: x.entity, name: x.name, stream: sub ? x.stream : x.fullStream || x.stream, ratio: x.ratio, fit: 'contain', noFull: true });

  function render() {
    const a = active(), key = (a.grid ? 'grid' : '') + a.ids.join(',');
    if (!key) dismissed = '';
    if (!key || key === dismissed) { el.hidden = true; shown = ''; Object.values(views).forEach((v) => { v.hidden = true; }); return; }
    if (key !== shown) {
      const names = (a.grid ? [c.grid.title || 'Backyard'] : []).concat(a.ids.map((id) => cams[id].name));
      title.textContent = names.join(' · ');
      const cards = []
        .concat(a.grid ? gridIds.map((id, i) => ({ ...camCard(cams[id], true), span: i === 0 ? 12 : 6 })) : [])
        .concat(a.ids.map((id) => ({ ...camCard(cams[id], a.grid || a.ids.length > 1), span: a.grid || a.ids.length > 1 ? 6 : 12 })));
      Object.values(views).forEach((v) => { v.hidden = true; });
      view(key, cards).hidden = false;
      el.querySelector('.popup').classList.toggle('single', !a.grid && a.ids.length === 1);
      el.querySelector('.popup').style.setProperty('--cam-ratio', !a.grid && a.ids.length === 1 ? ratio(cams[a.ids[0]].ratio) : 1.523);
      if (c.wake && !shown) call('switch.turn_on', {}, c.wake);
      shown = key;
    }
    el.hidden = false;
  }

  // review sensors
  const tickT = setInterval(render, 5000);   // timeouts and lingering closes
  single.concat(gridIds.map((id) => cams[id])).forEach((x) => {
    const id = x.id, sensor = c.review(id);
    watch([sensor], () => {
      const on = ((st(sensor) || {}).state || '').toUpperCase() === 'ALERT', s = state[id];
      if (on && !(s && s.alert)) { state[id] = { alert: true, since: Date.now(), closeT: 0, blocked: blocked(id) }; dismissed = ''; }
      else if (!on && s && s.alert) { s.alert = false; s.closeT = Date.now() + ((c.linger || {})[id] || 0) * 1000; }
      render();
    });
  });
  if (c.party) watch([c.party.entity], () => {});   // keep Party Mode subscribed (read when an alert starts)
  if (c.grid) watch([c.grid.sensor], () => {
    const on = (st(c.grid.sensor) || {}).state === 'on';
    clearTimeout(gridOffT);
    if (on && !gridOn) { gridOn = true; gridBlocked = party(); dismissed = ''; }
    else if (!on && gridOn) gridOffT = setTimeout(() => { gridOn = false; render(); }, (c.grid.closeAfter || 60) * 1000);
    render();
  });
  return tickT;
}
const ratio = (r) => { const p = String(r || '16/9').split('/'); return (+p[0] / +p[1]) || 1.7778; };

// load the camera card type before any alert can need it
export const alertCardTypes = () => preload([{ type: 'camera' }]);
