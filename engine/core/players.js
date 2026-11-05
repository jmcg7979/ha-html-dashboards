// What a player row/pop-up acts on. One configured player can be up to three HA entities:
//   ma     Music Assistant's player for it (queue, shuffle, repeat, volume) — default `<entity>_ma`
//   entity the Cast entity (what's casting, art, seek)
//   power  the Android TV Remote entity: real TV power, native apps, volume steps and mute
// Each control goes to the first of those that is active and supports it (supported_features bits).
//
// What each one can be trusted for, from watching real TVs:
//   - A TV's remote entity saying off means the TV is off. Cast keeps reporting a session then: Spotify on a Chromecast follows
//     the account, so every TV "plays" whatever a phone plays, for hours, and a Cast reconnect brings a paused track back.
//   - Music Assistant mirrors whatever Cast reports, stale sessions included (source = the app, no active_queue). Only with an
//     active_queue is the playback MA's own. A mirror is never a source; it can still supply art, which Cast lacks for native apps.
//   - The remote's app_id can lag (it reads Screensaver while Prime Video plays), so it only overrules an app that `follows`.
import { st } from './store.js';
import { mmss } from './dom.js';
import { appFor, isPackage } from './apps.js';

export const F = { PAUSE: 1, SEEK: 2, VOLUME_SET: 4, VOLUME_MUTE: 8, PREV: 16, NEXT: 32, VOLUME_STEP: 1024, STOP: 4096, PLAY: 16384, SHUFFLE: 32768, REPEAT: 262144 };
const LIVE = ['playing', 'paused', 'buffering'];

export const maOf = (p) => (p.ma === undefined ? p.entity + '_ma' : p.ma);
export const idsOf = (p) => [maOf(p), p.entity, p.power].filter(Boolean);
export const slug = (p) => p.entity.split('.')[1];

// false for an account-following app (Spotify) that isn't what this TV is doing: paused needs the app in front; playing is only
// believed if the TV isn't known to be in another app (it can really play behind the screensaver)
function believed(p, e, remote) {
  const a = appFor(e.attributes.app_name);
  if (!remote || !a || !a.follows) return true;
  const fg = remote.attributes.app_id || '', other = appFor(fg);
  return fg === a.pkg || (e.state === 'playing' && !(other && !other.idle));
}

// active entities, most capable first; a TV that is on in a native app (not casting) only has its remote
export function sources(p) {
  const out = [], ma = maOf(p), me = ma && st(ma), ce = st(p.entity);
  const remote = p.power && p.power !== p.entity ? st(p.power) : null, off = !!remote && remote.state === 'off';
  if (me && LIVE.includes(me.state) && me.attributes.active_queue) out.push({ id: ma, e: me });
  if (ce && LIVE.includes(ce.state) && !off && believed(p, ce, remote)) out.push({ id: p.entity, e: ce });
  if (remote && remote.state === 'on') out.push({ id: p.power, e: remote });
  return out;
}
export const isLive = (p) => sources(p).length > 0;

// first active entity supporting `bit`
export function pick(p, bit) {
  const s = sources(p).find((x) => ((x.e.attributes.supported_features || 0) & bit) === bit);
  return s ? s.id : null;
}

// what to show: the first active entity that knows the title, else the first active one
export function now(p) {
  const list = sources(p), s = list.find((x) => x.e.attributes.media_title) || list[0];
  if (!s) return null;
  const a = s.e.attributes, playing = list.some((x) => x.e.state === 'playing');
  const raw = list.map((x) => x.e.attributes.app_name).find(Boolean) || '', info = appFor(raw);
  const app = info ? info.name : isPackage(raw) ? '' : raw, title = a.media_title || app || (s.id === p.power ? 'TV on' : '');
  const mirror = maOf(p) && st(maOf(p)), ma = mirror && a.media_title && mirror.attributes.media_title === a.media_title ? mirror.attributes : {};
  return {
    // state 'on' = only the TV remote is active: it can't tell playing from paused
    id: s.id, state: playing ? 'playing' : s.e.state, a, title,
    // bare = the app published no title (Hulu, Netflix, Prime Video): only its logo and playing state are known
    bare: !a.media_title, brand: info && info.color ? info : null, screen: !!(info && info.idle),
    artist: a.media_artist || a.media_series_title || '',
    album: a.media_album_name || '',
    app: app === title ? '' : app,
    // the same-origin proxy first: it loads on the LAN and lets the pop-up read the art's colours
    pic: a.entity_picture_local || a.entity_picture || list.map((x) => x.e.attributes.entity_picture_local || x.e.attributes.entity_picture).find(Boolean) || ma.entity_picture_local || ma.entity_picture || '',
  };
}

// seconds into the media now: media_position + time since media_position_updated_at while playing; null if unknown
export function elapsed(n) {
  const a = n.a; if (a.media_position == null) return null;
  let s = +a.media_position;
  if (n.state === 'playing' && a.media_position_updated_at) s += (Date.now() - new Date(a.media_position_updated_at)) / 1000;
  return a.media_duration > 0 ? Math.min(s, +a.media_duration) : s;
}

// the line under an app that published no title: "Playing · 18:52 in"
export function statusLine(n) {
  const word = { playing: 'Playing', paused: 'Paused', buffering: 'Loading' }[n.state] || '', s = word ? elapsed(n) : null;
  return [word, s != null ? mmss(s) + ' in' : ''].filter(Boolean).join(' · ');
}

// Music Assistant's player when it is the one playing (queue, Play on): an MA queue, not MA mirroring an app
export function maLive(p) { const id = maOf(p), e = id && st(id); return e && LIVE.includes(e.state) && e.attributes.active_queue ? id : null; }

// Cast/MA speaker groups: while a group plays, its member speakers report the same track. collapse() hides those members
// under the group so the Playing card shows one row. Groups are matched in `players` order, so list bigger groups first
// (a whole-home group before a floor group); a member row is only hidden while it plays exactly what the group plays.
const trackKey = (p) => { const n = now(p); return n ? n.a.media_content_id || `${n.title}|${n.artist}` : null; };
export function collapse(players) {
  const hidden = new Set(), members = new Map(), keys = new Map(players.map((p) => [p.entity, trackKey(p)]));
  players.filter((p) => p.group && keys.get(p.entity) && !hidden.has(p.entity)).forEach((g) => {
    const k = keys.get(g.entity), list = [];
    players.forEach((p) => { if (p !== g && !hidden.has(p.entity) && keys.get(p.entity) === k) { hidden.add(p.entity); if (!p.group) list.push(p.name); } });
    members.set(g.entity, list);
  });
  return { hidden, members };
}
