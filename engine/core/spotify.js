// Spotify's "up next", for a Spotify cast (cards/media-detail.js). HA's own Spotify integration doesn't have it; the
// SpotifyPlus custom integration does (spotifyplus.get_player_queue_info), asked through HA like any action that answers.
// A player names its account's SpotifyPlus entity as `spotifyQueue` (home.js); without it there is no list.
//   want(entity, title, fn)   keep the list fresh for the song now playing: asked when the title changes (and once more a
//                             few seconds on: Spotify's own answer lags the cast), and every 30 s; fn() when it changed
//   get(entity) -> { items: [{ name, artist, duration, pic, uri }], title, fresh }   title: the song Spotify said was
//                             playing with that list; fresh: asked for less than 20 s ago, or an answer is on its way
// Read-only: Spotify lets an app add to the queue, not reorder it or jump into it.
// And the account's other side of a cast: its devices, to move the music between them.
//   devices(sp) -> { id, list: [device name], cur } | null   sp: the account's player (players.js spotifyOf); null with
//                             fewer than two devices
//   deviceSections(list, rooms) -> [{ title, list: [{ dev, name, icon }] }]   the devices under the rooms' headings, by
//                             name; rooms: [{ key: the name Spotify would know the room by, name, icon, title: its heading }]
//   moveTo(devices, dev)      the music plays on that device from now on
//   nudge(sp, delays)         SpotifyPlus only asks Spotify now and then: after a press of ours it is told to ask now
import { st } from './store.js';
import { request, call } from './ha.js';
import { SPOTIFY_AGAIN, SPOTIFY_EVERY, SPOTIFY_FRESH, SPOTIFY_NUDGE, SPOTIFY_MOVED } from './music-timing.js';

const Q = new Map();   // entity -> { items, title, at, asked, asking, timer }
const slot = (e) => { let s = Q.get(e); if (!s) Q.set(e, (s = { items: [], title: '', at: 0, asked: '', asking: false, timer: 0 })); return s; };
// a row's art: the 300 px cover, not the 640 px one (twenty of those are 30 MB decoded, on a TV with 2 GB)
const thumb = (t) => { const im = ((t.album || t.show || {}).images || t.images || []).filter((i) => i && i.url).sort((x, y) => (x.width || 0) - (y.width || 0));
  return (im.find((i) => (i.width || 0) >= 200) || im[im.length - 1] || {}).url || t.image_url || (t.album || {}).image_url || ''; };
const item = (t) => ({ name: t.name || '', artist: (t.artists || []).map((a) => a.name).filter(Boolean).join(', ') || ((t.show || {}).name || ''), duration: Math.round((t.duration_ms || 0) / 1000),
  pic: thumb(t), uri: t.uri || '' });

function ask(e, fn) {
  const s = slot(e); if (s.asking) return; s.asking = true;
  request({ type: 'call_service', domain: 'spotifyplus', service: 'get_player_queue_info', service_data: { entity_id: e }, return_response: true })
    .then((r) => { const d = ((r && r.response) || {}).result || {}; s.items = (d.queue || []).map(item); s.title = (d.currently_playing || {}).name || ''; s.at = Date.now(); }, () => { s.at = Date.now(); })
    .then(() => { s.asking = false; if (fn) fn(); });
}
export function want(e, title, fn) {
  const s = slot(e);
  if (title !== s.asked) { s.asked = title; ask(e, fn); clearTimeout(s.timer); s.timer = setTimeout(() => ask(e, fn), SPOTIFY_AGAIN); }
  else if (Date.now() - s.at > SPOTIFY_EVERY) ask(e, fn);
}
export function get(e) { const s = slot(e); return { items: s.items, title: s.title, fresh: s.asking || Date.now() - s.at < SPOTIFY_FRESH }; }

export function devices(sp) {
  const a = sp && st(sp) ? st(sp).attributes : null, list = a ? [...new Set(a.source_list || [])] : [];   // (SpotifyPlus lists a device once per way of reaching it)
  return list.length > 1 ? { id: sp, list, cur: a.source } : null;
}
const deviceIcon = (name) => (/tv\b|television/i.test(name) ? 'television' : /speaker|display|hub|mini|nest|echo/i.test(name) ? 'speaker' : /phone|pixel|iphone|galaxy/i.test(name) ? 'cellphone' : 'laptop');
// a room's player is named as Spotify names the device ("+" for "and"; "Hallway" finds "Hallway Display"); what's left
// (computers, phones) comes last
const dkey = (x) => String(x || '').toLowerCase().replace(/[+&]/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
export function deviceSections(list, rooms) {
  const rest = new Set(list), out = [];
  const add = (title, dev, r) => { let sec = out.find((x) => x.title === title); if (!sec) out.push((sec = { title, list: [] })); sec.list.push({ dev, name: r ? r.name : dev, icon: r ? r.icon || 'speaker' : deviceIcon(dev) }); rest.delete(dev); };
  const named = rooms.map((r) => ({ r, k: dkey(r.key) })), open = [];
  for (const x of named) { const dev = [...rest].find((d) => dkey(d) === x.k); if (dev) add(x.r.title, dev, x.r); else open.push(x); }
  for (const x of open) { const dev = [...rest].find((d) => dkey(d).startsWith(x.k + ' ')); if (dev) add(x.r.title, dev, x.r); }
  const others = out.length ? 'Other devices' : 'Devices';   // (named once: the first of them must not make the rest "other")
  [...rest].forEach((d) => add(others, d, null));
  const rank = (sec) => (sec.title === 'Speaker groups' ? 0 : /^(Other d|D)evices$/.test(sec.title) ? 2 : 1);
  return out.sort((x, y) => rank(x) - rank(y));
}
export function nudge(sp, delays = [SPOTIFY_NUDGE]) {
  if (sp && st(sp) && st(sp).attributes.sp_user_id !== undefined) delays.forEach((ms) => setTimeout(() => call('spotifyplus.trigger_scan_interval', { entity_id: sp }), ms));
}
export function moveTo(d, dev) { call('media_player.select_source', { source: dev }, d.id); nudge(d.id, SPOTIFY_MOVED); }
