// Main dashboard (?d=main): wall panel and desktop. Layout only; entities come from home.js, pop-ups from popups.js.
// Section: { span: view columns, cols: grid units inside, panel: false | class: 'glass', cards }. Card span is in grid units.
import * as H from '../home.js';
import popups from '../popups.js';
import systemsView from './systems.js';
import { top, house, vacuum, printerStat, weatherView, reviewSensor } from './parts.js';

const home = {
  id: 'home', title: 'Home', icon: 'home-variant',
  sections: [
    { span: 3, panel: false, cards: [
      { type: 'people', span: 4, compact: true, style: 'portrait', round: true, people: [{ ...H.people.alex, tap: { nav: '#alex' } }, { ...H.people.sam, tap: { nav: '#sam' } }] },
      ...top.map((s) => ({ type: 'stat', span: 2, size: 'lg', ...s })),
    ] },
    { span: 1, panel: false, cards: [
      { type: 'heading', title: 'Cameras', buttons: [{ icon: 'view-grid-outline', action: { view: 'cameras' } }] },
      { type: 'camera', ...H.cameras[0] },
      { type: 'heading', title: 'Vacuum' },
      vacuum,
    ] },
    { span: 1, panel: false, cards: [
      { type: 'heading', title: 'Climate' },
      ...H.climate.map((c, i) => ({ type: 'room-climate', span: 6, ...c, tap: { nav: ['#climate-living', '#climate-bedroom'][i] } })),
      { type: 'heading', title: 'House' },
      ...house.map((s) => ({ type: 'stat', span: 6, ...s })),
      printerStat,
      { type: 'media', title: 'Playing', players: H.players },
    ] },
    { span: 1, panel: false, cards: [
      { type: 'heading', title: 'Weather', buttons: [{ icon: 'radar', action: { view: 'weather' } }] },
      { type: 'weather', entity: H.weather, sun: 'sun.sun', compact: true },
      { type: 'heading', title: 'Calendar', buttons: [{ icon: 'calendar-month', action: { nav: '#calendar' } }] },
      { type: 'agenda', calendars: H.calendars, days: 7, limit: 3, follow: true, compact: true },
    ] },
  ],
};

// every camera at its own shape; recent alerts beside it; the full Events list in a pull-out drawer
const cameras = {
  id: 'cameras', title: 'Cameras', icon: 'cctv', columns: 'minmax(0, 1fr) calc(240px * var(--s))', colGap: 'var(--sp-28)',
  sections: [
    { span: 1, panel: false, cards: [
      { type: 'camera-wall', cameras: H.cameras, history: H.cameras.map((c) => c.entity), review: reviewSensor },
      { type: 'drawer', id: 'events', tab: false, title: 'Events', width: 420, cards: [{ type: 'reviews', cameras: H.cameras, grow: true }] },
    ] },
    { span: 1, panel: false, cards: [{ type: 'reviews', cameras: H.cameras, compact: { title: 'Alerts', more: { drawer: 'events' } }, grow: true }] },
  ],
};

export default {
  title: 'Home',
  profile: 'portal',
  settings: { perf: false },
  links: [{ title: 'HA', icon: 'home-assistant', url: '/lovelace' }],
  popups,
  // screen takeovers (core/alerts.js): the timer alarm. cameras: { … } adds Frigate alerts; see engine/docs/integrations.md
  alerts: { timer: { ringing: H.timers.ringing, last: H.timers.last } },
  views: [home, cameras, weatherView, systemsView],
};
