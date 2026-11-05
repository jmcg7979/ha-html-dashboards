// What a player row/pop-up acts on. One configured player can be up to three HA entities:
//   ma     Music Assistant's player for it (queue, shuffle, repeat, volume) — default `<entity>_ma`
//   entity the Cast entity (what's casting, art, seek)
//   power  the Android TV Remote entity: real TV power, native apps, volume steps and mute
// Each control goes to the first of those that is active and supports it (supported_features bits).
import { st } from './store.js';

export const F = { PAUSE: 1, SEEK: 2, VOLUME_SET: 4, VOLUME_MUTE: 8, PREV: 16, NEXT: 32, VOLUME_STEP: 1024, STOP: 4096, PLAY: 16384, SHUFFLE: 32768, REPEAT: 262144 };
const LIVE = ['playing', 'paused', 'buffering'];

export const maOf = (p) => (p.ma === undefined ? p.entity + '_ma' : p.ma);
export const idsOf = (p) => [maOf(p), p.entity, p.power].filter(Boolean);
export const slug = (p) => p.entity.split('.')[1];

// active entities, most capable first; a TV that is on in a native app (not casting) only has its remote
export function sources(p) {
  const out = [];
  [maOf(p), p.entity].forEach((id) => { const e = id && st(id); if (e && LIVE.includes(e.state)) out.push({ id, e }); });
  if (p.power && p.power !== p.entity) { const e = st(p.power); if (e && e.state === 'on') out.push({ id: p.power, e }); }
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
  const app = list.map((x) => x.e.attributes.app_name).find(Boolean) || '', title = a.media_title || app || (s.id === p.power ? 'TV on' : '');
  return {
    // state 'on' = only the TV remote is active: it can't tell playing from paused
    id: s.id, state: playing ? 'playing' : s.e.state, a, title,
    artist: a.media_artist || a.media_series_title || '',
    album: a.media_album_name || '',
    app: app === title ? '' : app,
    // the same-origin proxy first: it loads on the LAN and lets the pop-up read the art's colours
    pic: a.entity_picture_local || a.entity_picture || list.map((x) => x.e.attributes.entity_picture_local || x.e.attributes.entity_picture).find(Boolean) || '',
  };
}

// Music Assistant's player when it is the one playing (queue, Play on)
export function maLive(p) { const id = maOf(p), e = id && st(id); return e && LIVE.includes(e.state) ? id : null; }

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
