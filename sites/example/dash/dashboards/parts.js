// Tiles and views shared by Main, Mobile and the pop-ups (no layout: the place that uses one adds its span).
import * as H from '../home.js';
import { st } from '../core/store.js';
import { cap } from '../core/dom.js';

const NAS = H.systems.nas;
// { type: 'health' } is one system at a glance; the Systems pages build on the same rules (core/assess.js)
export const nasHealth = { type: 'health', title: 'NAS', icon: 'nas', up: NAS.up,
  metrics: [{ name: 'CPU', entity: NAS.cpu, unit: '%', warn: 80, crit: 95 }, { name: 'Memory', entity: NAS.mem, unit: '%', warn: 85, crit: 95 }, { name: 'Volume', entity: NAS.vol, unit: '%', warn: 75, crit: 90 }],
  checks: [{ entity: NAS.status, ok: ['normal'], label: 'Volume', level: 'crit' }],
  updates: [{ entity: NAS.fw, label: 'NAS firmware' }] };

const S = H.security, state = (id) => (st(id) || {}).state;
const timerIds = Array.from({ length: H.timers.count }, (_, i) => `timer.${H.timers.prefix}_${i + 1}`);
const lightIds = Object.values(H.lights).map((l) => l.entity);
const openCount = (id) => { const v = state(id), n = +v; return { text: v == null || isNaN(n) ? 'Unknown' : n ? `${n} open` : 'Closed', on: n > 0, tone: 'lamp' }; };

// status row: alarm, front door, lights, timers
export const top = [
  { label: 'Alarm', icon: 'shield-home', entities: [S.alarm], tap: { nav: '#alarm' },
    value: () => { const s = state(S.alarm), armed = !!s && s !== 'disarmed'; return { text: s === 'disarmed' ? 'Off' : cap((s || '–').replace('_', ' ')), on: armed, tone: 'sage', icon: armed ? 'shield-lock' : 'shield-home' }; } },
  { label: 'Front door', icon: 'lock', entities: [S.lock], tap: { nav: '#doors' },
    value: () => { const s = state(S.lock); return { text: s ? cap(s) : '–', on: s === 'locked', tone: 'sage', icon: s === 'locked' ? 'lock' : 'lock-open-variant' }; } },
  { label: 'Lights', icon: 'lightbulb-group', entities: lightIds, tap: { nav: '#lights' },
    value: () => { const n = lightIds.filter((id) => state(id) === 'on').length; return { text: n ? `${n} on` : 'Off', on: !!n, tone: 'lamp' }; } },
  { label: 'Timers', icon: 'timer-outline', entities: timerIds, tap: { nav: '#timers' },
    value: () => { const n = timerIds.filter((id) => ['active', 'paused'].includes(state(id))).length; return { text: n ? `${n} running` : 'None', on: !!n, tone: 'lamp' }; } },
];
export const house = [
  { label: 'Doors', icon: 'door', entities: [S.open_doors], tap: { nav: '#doors' }, value: () => openCount(S.open_doors) },
  { label: 'Windows', icon: 'window-closed-variant', entities: [S.open_windows], tap: { nav: '#windows' }, value: () => openCount(S.open_windows) },
];
export const printerStat = { type: 'stat', label: '3D printer', icon: 'printer-3d', entities: [H.printer.status], tap: { nav: '#printer' },
  value: () => ({ text: cap(state(H.printer.status) || '–'), on: state(H.printer.status) === 'running', tone: 'plum' }) };
export const vacuum = { type: 'tile', entity: H.vacuum.entity, name: 'Robot', icon: 'robot-vacuum', mode: 'state', tone: 'mist', ring: H.vacuum.battery, tap: { nav: '#vacuum' } };
export const reviewSensor = (id) => `sensor.${id}_review_status`;

// US National Weather Service now / 7 days / 24 hours, and the radar
const N = H.nws;
export const weatherView = { id: 'weather', title: 'Weather', icon: 'weather-partly-cloudy', sections: [
  { span: 1, panel: false, cards: [
    { type: 'heading', title: 'Now' }, { type: 'wx-now', entity: N.entity, alerts: N.alerts, sun: 'sun.sun', lat: N.lat, lon: N.lon, ha: N.now, grow: true },
    { type: 'heading', title: 'Next 7 days' }, { type: 'wx-days', entity: N.entity, days: 7, fallback: { lat: N.lat, lon: N.lon } },
  ] },
  { span: 2, panel: false, cards: [
    { type: 'heading', title: 'Radar' }, { type: 'radar', lat: N.lat, lon: N.lon, zoom: 7, height: 452, cartoKey: H.carto_key },
    { type: 'heading', title: 'Next 24 hours' }, { type: 'wx-hours', entity: N.entity, hours: 24, height: 176, fallback: { lat: N.lat, lon: N.lon } },
  ] },
] };

