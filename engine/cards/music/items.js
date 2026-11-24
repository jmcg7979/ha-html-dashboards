// The Music page's items: what Music Assistant's playlists, songs, artists and sets say about themselves, the same in
// every list and on the sheet, and the items now on screen (a row or tile carries a key, not the item).
//   SET (seconds: a track this long is a DJ set)   SRC (a service's name; a service MA adds later is learned: find.js)   KIND
//   domain(it) source(it) who(it) length(seconds) kindOf(it) hue(name)
//   put(it) -> key for data-k      itemOf(key) -> the item, while it is among the newest on screen
//   pin(it) -> Promise<pinned now>: a pin is an MA favorite, so every screen shares the pins
import { mmss } from '../../core/dom.js';
import { toast } from '../../core/toast.js';
import * as MA from '../../core/ma.js';
import { service } from '../../core/rank.js';

export const SET = 20 * 60;   // a track this long or longer is a DJ set
export const SRC = { spotify: 'Spotify', soundcloud: 'SoundCloud', ytmusic: 'YouTube Music', builtin: 'Music Assistant', somafm: 'SomaFM', radiobrowser: 'Radio', library: 'Library' };
export const KIND = { playlist: 'Playlist', track: 'Song', album: 'Album', artist: 'Artist', radio: 'Radio' };

export const domain = service;
export const source = (it) => SRC[domain(it)] || (domain(it) ? domain(it).replace(/_/g, ' ') : '');
export const who = (it) => { const w = (it.artists || []).map((a) => a.name).join(', ') || it.owner || ''; return w.toLowerCase() === (SRC[domain(it)] || '').toLowerCase() ? '' : w; };   // not "Spotify · Spotify"
export function length(sec) {   // 3:45 for a song, 58 min, 1 h 02 for a set, 4 h 10 for a playlist
  if (!sec) return '';
  if (sec < SET) return mmss(sec);
  const hr = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return hr ? `${hr} h ${String(m).padStart(2, '0')}` : `${m} min`;
}
// a color of its own for a name with no picture: a hue, the same for the same name
export const hue = (name) => { let x = 0; for (const c of name || '') x = (x * 31 + c.charCodeAt(0)) % 360; return x; };
export const kindOf = (x) => (x.media_type === 'track' ? (x.duration >= SET ? 'set' : 'song') : x.media_type);

// key -> item, for whatever is on screen. Rows are drawn again and again on a screen that runs for weeks, so only the
// newest are kept: far more than one screen shows, and a row old enough to have lost its item is long off screen.
const items = new Map(), ITEMS_KEPT = 1500;
let seq = 0;
export function put(it) {
  const k = 'm' + ++seq; items.set(k, it);
  if (items.size > ITEMS_KEPT) { let drop = items.size - ITEMS_KEPT / 2; for (const old of items.keys()) { if (drop-- <= 0) break; items.delete(old); } }
  return k;
}
export const itemOf = (k) => items.get(k);

// pin = an MA favorite; For you's Pinned row shows them
// -> a promise of whether it is pinned now
export function pin(it) {
  const was = !!it.favorite;
  // Unpin names the playlist by its number in MA's library. An item that came from a search carries its provider's
  // id instead (and was only marked pinned here), so the library's copy is looked up first.
  const libId = () => (it.provider === 'library' ? Promise.resolve(it.item_id)
    : MA.cmd('music/item_by_uri', { uri: it.uri }).then((x) => { if (x && x.provider === 'library') return x.item_id; throw new Error('not in the library'); }));
  const p = was ? libId().then((id) => MA.cmd('music/favorites/remove_item', { media_type: 'playlist', library_item_id: id })) : MA.cmd('music/favorites/add_item', { item: it.uri });
  it.favorite = !was;
  return p.then(() => { MA.forget('lib'); toast(was ? 'Unpinned' : 'Pinned to For you'); window.dispatchEvent(new CustomEvent('music:pins')); return !was; },
    () => { it.favorite = was; toast('Music Assistant didn’t take that'); return was; });
}
