// TV home screen (`?d=tv&p=tv`): what the TV launcher (tv/launcher) shows full screen on a Google TV, moved with the remote
// (core/remote.js). In a browser it runs too: the apps show their names, and Continue watching stays hidden (&tvdemo=1 fills it).
// Home: the time, who's home, the alarm and the weather; the streaming apps; Continue watching; a strip of house tiles.
// The rail has Cameras and Weather. A TV gives the page 960×540 CSS px and can't scroll: check each page with fitcheck.mjs.
import * as H from '../home.js';
import main from './main.js';
import popups from '../popups.js';
import { st } from '../core/store.js';

// the streaming apps, in this order (a missing one shows "Get" and opens the Play Store)
const APPS = [
  ['Netflix', 'com.netflix.ninja'], ['YouTube', 'com.google.android.youtube.tv'], ['Prime Video', 'com.amazon.amazonvideo.livingroom'],
  ['Disney+', 'com.disney.disneyplus'], ['Apple TV', 'com.apple.atve.androidtv.appletv'], ['Plex', 'com.plexapp.android'],
].map(([name, pkg]) => ({ name, pkg }));

const S = H.security, num = (id) => { const v = parseFloat((st(id) || {}).state); return isNaN(v) ? 0 : v; };
const status = { type: 'statusbar', span: 12, weather: H.weather, sun: 'sun.sun', forecast: 'twice_daily',
  people: Object.entries(H.people).map(([k, p]) => ({ ...p, tap: { nav: '#' + k } })),
  alarm: S.alarm, alarmTap: { nav: '#alarm' }, weatherTap: { view: 'weather' } };
const tile = (o) => ({ type: 'stat', size: 'strip', span: 3, ...o });
const lightIds = Object.values(H.lights).map((l) => l.entity);
const tiles = [
  tile({ label: 'Lights', icon: 'lightbulb-group', entities: lightIds, tap: { nav: '#lights' },
    value: () => { const n = lightIds.filter((id) => (st(id) || {}).state === 'on').length; return { text: n ? `${n} on` : 'All off', on: n > 0, tone: 'lamp' }; } }),
  tile({ label: 'House', icon: 'home-outline', entities: [S.open_doors, S.open_windows], tap: { nav: '#doors' },
    value: () => { const n = num(S.open_doors) + num(S.open_windows); return { text: n ? `${n} open` : 'All closed', on: n > 0, tone: 'lamp' }; } }),
  tile({ label: 'Climate', icon: 'thermostat', entities: [H.climate[0].entity],
    value: () => { const a = (st(H.climate[0].entity) || {}).attributes || {}; return { text: a.current_temperature == null ? '–' : Math.round(a.current_temperature) + '°', detail: H.climate[0].name }; } }),
  tile({ label: 'Timers', icon: 'timer-outline', entities: [H.timers.ringing], tap: { nav: '#timers' }, value: () => ({ text: 'Timers', detail: 'Start or stop' }) }),
];

// Weather: two tabs instead of one long page: the forecast, then the radar full size
const wxCards = main.views.find((v) => v.id === 'weather').sections.flatMap((sec) => sec.cards), byType = (t) => wxCards.find((c) => c.type === t);
const weatherTv = { id: 'weather', title: 'Weather', icon: 'weather-partly-cloudy', pages: [
  { id: 'forecast', title: 'Forecast', icon: 'weather-partly-cloudy', fill: true, sections: [
    { span: 1, panel: false, cards: [{ type: 'heading', title: 'Now' }, { ...byType('wx-now'), grow: true }] },
    { span: 2, panel: false, cards: [{ type: 'heading', title: 'Next 24 hours' }, { ...byType('wx-hours'), height: 120 }, { type: 'heading', title: 'Next 5 days' }, { ...byType('wx-days'), days: 5 }] },
  ] },
  { id: 'radar', title: 'Radar', icon: 'radar', fill: true, sections: [{ span: 3, panel: false, cards: [{ ...byType('radar'), height: undefined, grow: true }] }] },
] };

const home = { id: 'home', title: 'Home', icon: 'home-variant', sections: [
  { span: 3, panel: false, cards: [status] },
  { span: 3, panel: false, cards: [{ type: 'apps', span: 12, apps: APPS, cols: 6, row: true, first: true, more: '#apps' }] },
  { span: 3, panel: false, cards: [{ type: 'watchnext', limit: 12 }] },
  { span: 3, panel: false, class: 'glance', cols: 8, rows: 'minmax(0, 1fr)', cards: tiles.map((t) => ({ ...t, span: 2 })) },   // as a site's TV strip: takes what's left
] };

export default {
  title: 'Home',
  profile: 'tv',
  settings: { perf: false },
  remote: true,
  alerts: main.alerts,   // the timer take-over; the launcher also shows it over a playing app
  links: [{ title: 'Settings', icon: 'cog', url: 'intent:#Intent;action=android.settings.SETTINGS;end' }],
  popups: { ...popups, apps: { title: 'All apps', icon: 'apps', tone: 'mist', width: 'max', cards: [{ type: 'apps', apps: APPS, rest: true, cols: 5 }] } },
  // Cameras as on Main; Weather split in two tabs so it fits. Main's Systems pages are too tall for 540 px: a TV version
  // drops or shortens cards per page (keep each page to the screen, fitcheck.mjs --strict).
  views: [home, main.views.find((v) => v.id === 'cameras'), weatherTv],
};
