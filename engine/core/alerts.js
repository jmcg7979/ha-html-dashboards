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
//   Tap ✕ or outside to dismiss what is showing: each camera stays away until its own next alert, the grid until its
//   sensor next turns on. The cards of a pop-up are unloaded KEEP ms after it was last on screen (core/scope.js).
//   corner: true (a TV, where an alert comes up over what is being watched): a small picture in the top right corner
//   instead of the pop-up. Nothing behind it is dimmed, it plays the substreams and leaves the remote where it was:
//   Back dismisses it, every other key goes to the page (or, over an app on a TV, to that app: tv/launcher/README.md).
//
// popups: [{ entity, state, open: '#doorbell', closeAfter: 120, when }]   open a pop-up when an entity changes to a state (see popupRules)
import { h, icon } from './dom.js';
import { st, watch, optimistic, dropOptimistic } from './store.js';
import { call, resubscribeIfNeeded } from './ha.js';
import { preload, grid } from './layout.js';
import { close as closePopup } from './popup.js';
import { capture } from './scope.js';
import { watch as tvWatch, inOverlay } from './tvhost.js';
import { layer } from './layers.js';

export function initAlerts(cfg, home) {
  if (!cfg) return;
  if (!inOverlay) tvWatch(triggers(cfg));   // on a TV: the launcher watches these while another app is in front
  if (cfg.timer) timerAlarm(cfg.timer);
  if (cfg.cameras) cameraAlerts(cfg.cameras, home);
  if (cfg.popups) popupRules(cfg.popups);
  resubscribeIfNeeded();   // these may be the only cards watching their entities (the timer on a TV): add them to HA's subscription
}

// the entity states that start a take-over (for the TV launcher's overlay; it opens the page, which then decides)
function triggers(cfg) {
  const t = [];
  if (cfg.timer) t.push({ entity: cfg.timer.ringing, state: 'on' });
  const c = cfg.cameras;
  if (c) {
    c.cameras.forEach((x) => t.push({ entity: c.review(x.id), state: 'ALERT' }));
    if (c.grid) t.push({ entity: c.grid.sensor, state: 'on' });
  }
  return t;
}

// ---------------- pop-ups that open themselves ----------------
// popups: [{ entity: 'binary_sensor.doorbell_visitor', state: 'on', open: '#doorbell', closeAfter: 120 }]
//   opens the pop-up when the entity changes to `state` (not on page load), closes it after `closeAfter` s if it is still the one open
//   when: () => bool   only then (a change that means something only in some case: a grill gone silent while it is on)
function popupRules(list) {
  for (const r of list) {
    let prev, timer = 0;
    watch([r.entity], () => {
      const e = st(r.entity), s = e ? e.state : undefined;
      if (s === undefined) return;
      if (prev !== undefined && s === r.state && prev !== s && (!r.when || r.when())) {
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
  const L = layer({ el, kind: 'takeover', rank: 4, scope: el.querySelector('.alarm-in'), close: () => el.click() });   // Back = Stop; drawn over everything
  let ringing = false, saved = null;
  const sound = c.sound && (!c.sound.on || c.sound.on()) ? c.sound : null;

  const startSound = () => {
    if (!sound) return;
    const p = st(sound.player); if (!p || p.state === 'unavailable') return;
    if (saved == null) saved = p.attributes.volume_level;   // a volume still waiting to be put back is the one to keep, not the alarm's own
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
    el.querySelector('.alarm-h').textContent = document.documentElement.classList.contains('remote') ? 'Press OK or Back to stop' : 'Tap anywhere to stop';
    if (on) L.open(); else L.shut();
    if (on) startSound(); else stopSound();
  });
  el.addEventListener('click', () => {
    if (!ringing) return;
    // shown as off from the tap: HA's own "off" comes a moment later, and an update of the player in between must not
    // find the timer still ringing and start the alarm again
    if (call('input_boolean.turn_off', {}, c.ringing, () => dropOptimistic(c.ringing))) optimistic(c.ringing, 'off', null, (r) => r.state === 'off');
    ringing = false; el.hidden = true; stopSound(); L.shut();
  });
}

// ---------------- camera alert popups ----------------
const KEEP = 20000;   // ms the cards of a pop-up are kept after it was last on screen (the same cameras alerting again reuse them)
// what the pop-up shows: what is up ({ grid, ids } from active()) less what the viewer closed (camera ids and 'grid')
export const showing = (a, dismissed) => ({ grid: a.grid && !dismissed.has('grid'), ids: a.ids.filter((id) => !dismissed.has(id)) });

function cameraAlerts(c, home) {
  const cams = Object.fromEntries(c.cameras.map((x) => [x.id, x]));
  const gridIds = (c.grid && c.grid.cameras) || [];
  const single = c.cameras.filter((x) => !gridIds.includes(x.id));
  const state = {};          // id -> { since, closeT }
  const dismissed = new Set();   // closed by the viewer: a camera until its next alert starts, 'grid' until its sensor next turns on
  let gridOn = false, gridBlocked = false, gridOffT = 0, shown = '';   // Party Mode is checked when an alert starts, like HA

  const el = h(`<div class="pwrap camalert" hidden><div class="popup wide" style="--t:var(--ember)">
    <div class="phead"><div class="ic on">${icon('cctv')}</div><div class="tx"><div class="name"></div><div class="sub">Camera alert</div></div>
    <button class="rbtn pclose" aria-label="Close">${icon('close')}</button></div><div class="pbody"></div></div></div>`);
  // corner: nothing in it takes the remote's highlight, so it says how it is closed
  if (c.corner) { el.classList.add('corner'); el.dataset.nofocus = ''; el.querySelector('.popup').appendChild(h('<div class="chint">Press the back button to close</div>')); }
  document.body.appendChild(el);
  const title = el.querySelector('.phead .name'), body = el.querySelector('.pbody');
  const dismiss = () => { const a = active(); a.ids.forEach((id) => dismissed.add(id)); if (a.grid) dismissed.add('grid'); render(); };
  el.addEventListener('click', (ev) => { if (ev.target === el || ev.target.closest('.pclose')) dismiss(); });
  // a take-over; in a TV's corner it leaves the highlight where it is, and Back still dismisses it first (core/layers.js)
  const L = layer({ el, kind: 'takeover', scope: el.querySelector('.popup'), aside: !!c.corner, close: dismiss });

  const party = () => c.party && (st(c.party.entity) || {}).state === 'on';
  const blocked = (id) => party() && c.party.block.includes(id);

  // which cameras should be up right now
  const active = () => {
    const now = Date.now(), ids = [];
    single.forEach((x) => { const s = state[x.id]; if (s && !s.blocked && (s.alert || s.closeT > now) && now - s.since < (c.timeout || 300) * 1000) ids.push(x.id); });
    return { grid: gridOn && !gridBlocked, ids };
  };

  // One view (a grid of camera cards) per combination of cameras, built when it first shows. Each is built inside a
  // capture, so everything its cameras hooked up goes with it when it is unloaded, KEEP ms after it was hidden.
  const views = {};   // key -> { el, dispose, t }
  const hideViews = (but) => Object.keys(views).forEach((k) => {
    const v = views[k]; if (k === but || v.el.hidden) return;
    v.el.hidden = true;
    v.t = setTimeout(() => { delete views[k]; try { v.dispose(); } catch (e) { console.error(e); } v.el.remove(); }, KEEP);
  });
  const showView = (key, cards) => {
    let v = views[key];
    if (!v) { const made = capture(() => grid(cards, 12, home)); v = views[key] = { el: made.value, dispose: made.dispose, t: 0 }; v.el.classList.add('ppage'); body.appendChild(v.el); }
    clearTimeout(v.t); v.el.hidden = false;
  };
  // takeover: the camera plays whatever else is full screen, and stops the moment its pop-up is hidden (cards/camera.js)
  const camCard = (x, sub) => ({ type: 'camera', entity: x.entity, name: x.name, stream: sub ? x.stream : x.fullStream || x.stream, ratio: x.ratio, fit: 'contain', noFull: true, takeover: true });

  function render() {
    const a = showing(active(), dismissed), key = (a.grid ? 'grid' : '') + a.ids.join(',');
    if (!key) { el.hidden = true; shown = ''; hideViews(); L.shut(); return; }
    if (key !== shown) {
      const names = (a.grid ? [c.grid.title || 'Cameras'] : []).concat(a.ids.map((id) => cams[id].name));
      title.textContent = names.join(' · ');
      const cards = []
        .concat(a.grid ? gridIds.map((id, i) => ({ ...camCard(cams[id], true), span: i === 0 ? 12 : 6 })) : [])
        .concat(a.ids.map((id) => ({ ...camCard(cams[id], a.grid || a.ids.length > 1 || c.corner), span: a.grid || a.ids.length > 1 ? 6 : 12 })));
      hideViews(key); showView(key, cards);
      el.querySelector('.popup').classList.toggle('single', !a.grid && a.ids.length === 1);
      el.querySelector('.popup').style.setProperty('--cam-ratio', !a.grid && a.ids.length === 1 ? ratio(cams[a.ids[0]].ratio) : 1.523);
      if (c.wake && !shown) call('switch.turn_on', {}, c.wake);
      shown = key; el.hidden = false;
      if (L.on) L.changed(); else L.open();   // (other cameras than before: the remote's highlight was on one that is gone)
    }
    el.hidden = false;
  }

  // review sensors (the grid's cameras show while the grid's own sensor is on, so theirs are not followed here)
  setInterval(render, 5000);   // timeouts and lingering closes
  single.forEach((x) => {
    const id = x.id, sensor = c.review(id);
    watch([sensor], () => {
      const on = ((st(sensor) || {}).state || '').toUpperCase() === 'ALERT', s = state[id];
      if (on && !(s && s.alert)) { state[id] = { alert: true, since: Date.now(), closeT: 0, blocked: blocked(id) }; dismissed.delete(id); }
      else if (!on && s && s.alert) { s.alert = false; s.closeT = Date.now() + ((c.linger || {})[id] || 0) * 1000; }
      render();
    });
  });
  if (c.party) watch([c.party.entity], () => {});   // keep Party Mode subscribed (read when an alert starts)
  if (c.grid) watch([c.grid.sensor], () => {
    const on = (st(c.grid.sensor) || {}).state === 'on';
    clearTimeout(gridOffT);
    if (on && !gridOn) { gridOn = true; gridBlocked = party(); dismissed.delete('grid'); }
    else if (!on && gridOn) gridOffT = setTimeout(() => { gridOn = false; render(); }, (c.grid.closeAfter || 60) * 1000);
    render();
  });
}
const ratio = (r) => { const p = String(r || '16/9').split('/'); return (+p[0] / +p[1]) || 1.7778; };

// load the camera card type before any alert can need it
export const alertCardTypes = () => preload([{ type: 'camera' }]);
