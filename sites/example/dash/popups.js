// Pop-ups of the example site. Open one from any action with { nav: '#<id>' }.
// Each: { title, icon, entity (header state), state: (e) => text, width: 'wide' | 'max', cols, cards | pages: [{ title, icon, cards }] }
import * as H from './home.js';
import { cap } from './core/dom.js';
import { st } from './core/store.js';
import { now as mediaNow, idsOf } from './core/players.js';
import { nasHealth } from './dashboards/parts.js';

const S = H.security, V = H.vacuum, L = H.lights;
const ALARM_TEXT = { disarmed: 'Off', armed_away: 'Armed away', armed_night: 'Armed night', armed_home: 'Armed home', arming: 'Arming', pending: 'Entry delay', triggered: 'Triggered' };
const count = (e) => (!e || isNaN(e.state) ? 'Unknown' : +e.state ? `${e.state} open` : 'All closed');

const climate = (c) => ({ title: c.name, entity: c.entity, icon: 'thermostat', width: 'wide', state: (e) => (e ? cap(e.attributes.hvac_action || e.state) : ''), pages: [
  { title: 'Control', icon: 'thermostat', cards: [
    { type: 'thermostat', span: 5, entity: c.entity },
    { type: 'stack', span: 7, cards: [
      { type: 'chart', title: 'Temperature', hours: 24, ranges: [12, 24, 72, 168], height: 250, unit: '°',
        bands: { entity: c.entity, attr: 'hvac_action', tones: { heating: 'ember', cooling: 'mist' } }, series: [
          { entity: c.entity, attr: 'current_temperature', name: 'Inside', tone: 'lamp', width: 2.5 },
          { entity: c.entity, attr: 'target_temp_low', name: 'Heat to', tone: 'ember', dash: true, width: 1.5 },
          { entity: c.entity, attr: 'target_temp_high', name: 'Cool to', tone: 'mist', dash: true, width: 1.5 }] },
      { type: 'chart', title: 'Humidity', hours: 24, ranges: [24, 168], height: 120, unit: '%', minSpan: 10, series: [{ entity: c.humidity, name: 'Humidity', tone: 'mist', area: true, step: false }] },
    ] },
  ] },
  { title: 'Activity', icon: 'format-list-bulleted', cards: [{ type: 'logbook', entities: [c.entity], hours: 168, limit: 30, format: (r) => cap(r.state) }] },
] });

const person = (p) => ({ title: p.name, entity: p.entity, icon: 'account', width: 'wide', state: (e) => (e ? cap(e.state.replace('_', ' ')) : ''), cards: [
  { type: 'map', span: 6, entity: p.entity, zoom: 15, height: 340 },
  { type: 'stack', span: 6, cards: [
    { type: 'strip', items: [
      { label: 'Phone', entity: p.devices[0].battery, value: (e) => (e && !isNaN(e.state) ? `${e.state}%` : '–') },
      { label: 'Battery', entity: p.devices[0].charging, value: (e) => (e ? cap(e.state) : '–') }] },
  ] },
] });

export default {
  alarm: { title: 'Alarm', entity: S.alarm, icon: 'shield-home', tone: 'sage', width: 'wide', state: (e) => (e ? ALARM_TEXT[e.state] || cap(e.state) : ''), cards: [
    { type: 'alarm', span: 6, entity: S.alarm, battery: S.siren_battery, doors: S.entry_doors, windows: S.open_windows, garage: S.garage, household: S.household, disarm: S.disarm },
    { type: 'stack', span: 6, cards: [{ type: 'label', text: 'Recent events' }, { type: 'logbook', entities: [S.alarm], hours: 168, limit: 10, format: (r) => ALARM_TEXT[r.state] || cap(r.state) }] },
  ] },

  doors: { title: 'Doors', entity: S.open_doors, icon: 'door', tone: 'lamp', width: 'wide', state: count, cards: [
    // one button each: the tile shows the state, tap does the opposite; confirm: true = tap again to confirm
    { type: 'tile', span: 6, entity: S.lock, name: 'Front door lock', mode: 'state', tone: 'sage', icon: (e) => (e && e.state === 'locked' ? 'lock' : 'lock-open-variant'),
      tap: (e) => ({ call: e && e.state === 'locked' ? 'lock.unlock' : 'lock.lock', target: S.lock, confirm: true }) },
    { type: 'tile', span: 6, entity: S.garage, name: 'Garage', mode: 'state', tone: 'lamp', icon: (e) => (e && e.state === 'closed' ? 'garage' : 'garage-open'),
      tap: { call: 'cover.toggle', target: S.garage, confirm: true } },
    { type: 'snapshot', entity: H.cameras[2].entity, name: 'Driveway', every: 10 },   // a site's own card: dash/cards/snapshot.js
    { type: 'label', text: 'Doors' },
    { type: 'openings', items: Object.fromEntries(Object.entries(S.entry_doors).map(([k, v]) => [k, v + ' Door'])) },
  ] },

  windows: { title: 'Windows', entity: S.open_windows, icon: 'window-closed-variant', tone: 'lamp', width: 'wide', state: count, cards: [
    { type: 'windows', floor: 'Downstairs', floors: S.window_floors },
  ] },

  lights: { title: 'Lights', icon: 'lightbulb-group', tone: 'lamp', cards: [
    ...Object.values(L).map((l) => ({ type: 'tile', span: 6, ...l, tone: 'lamp' })),
    { type: 'label', text: 'Accent strip' },
    { type: 'select', span: 6, entity: L.accent.entity, attr: 'effect', name: 'Effect', icon: 'auto-fix' },
    { type: 'swatches', entity: L.accent.entity },
  ] },

  timers: { title: 'Timers', icon: 'timer-outline', tone: 'lamp', cards: [{ type: 'timer-list', ...H.timers, start: 'script.voice_timer_start' }] },

  vacuum: { title: 'Vacuum', entity: V.entity, icon: 'robot-vacuum', width: 'wide', state: (e) => (e ? cap(e.state) : ''), pages: [
    { title: 'Clean', icon: 'play', cards: [
      { type: 'image', span: 6, entity: V.map, ratio: '1/1' },
      { type: 'stack', span: 6, cards: [
        { type: 'buttons', columns: 3, labels: true, buttons: [
          { icon: 'play', name: 'Start', tap: { call: 'vacuum.start', target: V.entity } },
          { icon: 'home-import-outline', name: 'Dock', tap: { call: 'vacuum.return_to_base', target: V.entity } },
          { icon: 'map-marker-radius', name: 'Locate', tap: { call: 'vacuum.locate', target: V.entity } }] },
        { type: 'label', text: 'Suction' },
        { type: 'segments', entity: V.entity, attr: 'fan_speed', optionsAttr: 'fan_speed_list', call: 'vacuum.set_fan_speed', key: 'fan_speed' },
        { type: 'label', text: 'Clean rooms' },
        { type: 'area-pick', entity: V.entity, areas: V.areas },
      ] },
    ] },
    { title: 'Schedule', icon: 'calendar-clock', cards: [
      { type: 'tile', span: 6, entity: V.schedule, name: 'Daily schedule', icon: 'calendar-clock', mode: 'toggle', tone: 'mist' },
      { type: 'time', span: 6, entity: V.morning, name: 'Morning', icon: 'weather-sunset-up', show: { entity: V.schedule, state: 'on' } },
      { type: 'routine', name: 'Morning clean', icon: 'robot-vacuum', tone: 'mist', entities: [V.morning, V.schedule],
        time: () => (st(V.morning) || {}).state, status: () => 'Every day', tap: { nav: '#vacuum' } },
    ] },
  ] },

  calendar: { title: 'Calendar', icon: 'calendar-month', width: 'max', cards: [{ type: 'month', calendars: H.calendars }] },
  printer: { title: H.printer.name, icon: 'printer-3d', width: 'max', cards: [
    { type: 'print-job', span: 7, printer: H.printer },
    { type: 'ams', span: 5, ams: H.printer.ams, external: H.printer.external },
  ] },
  prints: { title: '3D prints', icon: 'printer-3d', width: 'max', cards: [{ type: 'prints', printer: H.printer }] },
  nas: { title: 'NAS', icon: 'nas', width: 'wide', cards: [
    nasHealth,
    { type: 'bays', drives: H.systems.nas.drives, warm: 122, hot: 131 },
  ] },

  // Frigate: one event, and a camera's recordings by day (cards/frigate-player.js)
  review: { title: 'Event', icon: 'cctv', width: 'max', cards: [{ type: 'frigate-player', mode: 'review', cameras: H.cameras }] },
  recordings: { title: 'Recordings', icon: 'history', width: 'max', cards: [{ type: 'frigate-player', mode: 'recordings', cameras: H.cameras }] },

  'climate-living': climate(H.climate[0]),
  'climate-bedroom': climate(H.climate[1]),
  alex: person(H.people.alex),
  sam: person(H.people.sam),

  // one per player: #media-<object id>, opened by tapping its row in the Playing card
  ...Object.fromEntries(H.players.map((p) => [`media-${p.entity.split('.')[1]}`, {
    title: p.name, icon: p.power ? 'television-play' : 'music', tone: 'plum', width: 'max', entity: p.entity, deps: idsOf(p),
    state: () => { const n = mediaNow(p); return n ? (n.state === 'playing' ? 'Playing' : n.state === 'paused' ? 'Paused' : 'On') : 'Off'; },
    cards: [{ type: 'media-detail', player: p, targets: H.playTargets, apps: H.tvApps }] }])),
};
