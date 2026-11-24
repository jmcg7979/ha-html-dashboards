// What others think of an item, and how big a playlist is: the relay's numbers by uri (core/ma.js ratings: a Spotify
// playlist's saves and song count, SoundCloud's likes and plays), kept for the session. core/rank.js words and orders them.
//   rate(items) -> Promise, resolved once their numbers are here (or RATE_WAIT has passed); `music:rated` on window when
//                  numbers came in, for rows drawn before them
//   numbersOf(it) -> { saves | likes, plays, count, duration } | null      rateable(it): the relay has numbers for its kind
//   sizeOf(playlist) -> Promise<'42 songs · 2 h 10' | ''>     sizeText({ count, duration })
import * as MA from '../../core/ma.js';
import { RATE_WAIT } from '../../core/music-timing.js';
import { SET, domain, length } from './items.js';

const nums = new Map(), NUMS_KEPT = 4000;
// the uri the relay knows an item by: its service's, also for an item of MA's library (library://playlist/12)
function rateUri(it) {
  if (it.provider !== 'library') return it.uri;
  const pm = (it.provider_mappings || [])[0] || {};
  return pm.item_id ? `${pm.provider_domain}://${it.media_type}/${pm.item_id}` : it.uri;
}
export const numbersOf = (it) => nums.get(rateUri(it)) || (typeof it.likes === 'number' ? { likes: it.likes, plays: it.plays } : null);
export const rateable = (it) => { const s = domain(it); return (s === 'spotify' && it.media_type === 'playlist') || (s === 'soundcloud' && (it.media_type === 'playlist' || it.media_type === 'track')); };
// -> Promise, resolved once the numbers of these items are here (or RATE_WAIT has passed)
export function rate(list) {
  const want = [...new Set(list.filter((it) => rateable(it) && !nums.has(rateUri(it)) && !numbersOf(it)).map(rateUri))];
  if (!want.length) return Promise.resolve();
  const got = Promise.all(Array.from({ length: Math.ceil(want.length / 100) }, (_, i) => MA.ratings(want.slice(i * 100, i * 100 + 100)))).then((all) => {
    if (nums.size > NUMS_KEPT) [...nums.keys()].slice(0, NUMS_KEPT / 2).forEach((k) => nums.delete(k));
    want.forEach((u) => nums.set(u, Object.assign({}, ...all.map((r) => r[u])) || {}));
    window.dispatchEvent(new CustomEvent('music:rated'));
  });
  return Promise.race([got, new Promise((r) => setTimeout(r, RATE_WAIT))]);
}

// a playlist's size and length, asked when it is on screen (MA's search doesn't say); counted in Home Assistant
// (core/ma.js playlistSize) and kept here for the session. A lookup that failed is not kept: the next showing asks again.
const sizes = new Map(), SIZES_KEPT = 400;
export const sizeText = (z) => (z && z.count ? `${z.count} songs${z.duration ? ' · ' + length(Math.max(z.duration, SET)) : ''}` : '');
export function sizeOf(it) {
  if (sizes.has(it.uri)) return sizes.get(it.uri);
  // Spotify and SoundCloud: the service's own count, with its likes, from the relay. Never MA's: it reads every song to
  // count them, and its Spotify takes one request every 2 s, so a list of 25 counted held up a playlist opened meanwhile.
  // Another service: no count in lists (its page has one, from its songs).
  const own = domain(it) === 'spotify' || domain(it) === 'soundcloud';
  if (!own) return Promise.resolve('');
  const p = rate([it]).then(() => { const x = numbersOf(it); return x && x.count ? x : null; })
    .then(sizeText, () => { sizes.delete(it.uri); return ''; });
  if (sizes.size >= SIZES_KEPT) sizes.delete(sizes.keys().next().value);
  sizes.set(it.uri, p);
  return p;
}
