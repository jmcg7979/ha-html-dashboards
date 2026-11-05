// Mobile dashboard: phones (HA app → Webpage dashboard → /local/dash/start.html?d=mobile). Same entities (home.js), tiles (parts.js)
// and pop-ups (popups.js) as Main, laid out for one column.
// Bottom tab bar = `tabs`; any other view and the `links` sit in the More sheet (core/phone.js).
// Section: { panel: false, cards }; cards span 12 grid units = the full width, 6 = half.
import * as H from '../home.js';
import popups from '../popups.js';
import systemsView from './systems.js';
import { top, house, vacuum, printerStat, weatherView, reviewSensor } from './parts.js';
import { phoneView, phoneSections } from '../core/layout.js';

const half = (cfg) => ({ ...cfg, span: 6 });

const home = { id: 'home', title: 'Home', icon: 'home-variant', sections: [
  { panel: false, cards: [
    { type: 'people', compact: true, style: 'portrait', round: true, people: [{ ...H.people.alex, tap: { nav: '#alex' } }, { ...H.people.sam, tap: { nav: '#sam' } }] },
    ...top.map((s) => half({ type: 'stat', ...s })),

    { type: 'heading', title: 'Front door', buttons: [{ icon: 'view-grid-outline', action: { view: 'cameras' } }] },
    { type: 'camera', ...H.cameras[0] },

    { type: 'heading', title: 'Climate', pill: { weather: H.weather, label: 'Outside' } },
    ...H.climate.map((c, i) => half({ type: 'room-climate', ...c, tap: { nav: ['#climate-living', '#climate-bedroom'][i] } })),

    { type: 'heading', title: 'House' },
    ...house.map((s) => half({ type: 'stat', ...s })),
    printerStat,
    vacuum,

    { type: 'media', title: 'Playing', players: H.players },

    { type: 'heading', title: 'Weather', buttons: [{ icon: 'radar', action: { view: 'weather' } }] },
    { type: 'weather', entity: H.weather, sun: 'sun.sun' },
    { type: 'heading', title: 'Coming up', buttons: [{ icon: 'calendar-month', action: { nav: '#calendar' } }] },
    { type: 'agenda', calendars: H.calendars, days: 7, limit: 4, follow: true, empty: 'Nothing this week.', compact: true },
  ] },
] };

// every camera at full width (tap = full screen, history = recordings), then the events
const cameras = { id: 'cameras', title: 'Cameras', icon: 'cctv', sections: [
  { panel: false, cards: [
    { type: 'camera-wall', fit: 'width', cameras: H.cameras, history: H.cameras.map((c) => c.entity), review: reviewSensor },
    { type: 'heading', title: 'Events' },
    { type: 'reviews', cameras: H.cameras, limit: 40 },
  ] },
] };

// Main's views stacked into one column by the engine
const weather = { ...weatherView, sections: phoneSections(weatherView.sections) };
const systems = phoneView(systemsView);

export default {
  title: 'Home',
  profile: 'phone',
  settings: { perf: false },
  tabs: ['home', 'cameras', 'weather', 'systems'],
  links: [{ title: 'HA', icon: 'home-assistant', url: '/lovelace' }],
  popups,
  views: [home, cameras, weather, systems],
};
