// What other listeners think of a search result, and the order that follows from it (the Music page; pure, so
// engine/_dev/test/music-rank.test.mjs checks it without a screen).
//   rating(it, numbers) -> { n, kind: 'saves' | 'likes' | 'pop', text, title } | null
//       a Spotify playlist: its saves (numbers.saves, from the relay); a SoundCloud playlist or song: its likes; a Spotify
//       song: its popularity, 0 to 100 (MA's metadata.popularity). `numbers` is the relay's answer for the item's uri.
//   count(n) -> '842', '1.4k', '12k', '8.1M'
//   rank(list, numbersOf) -> the list, most liked first: a service's numbers aren't comparable with another's (Spotify's
//       8 million saves, SoundCloud's 2 thousand likes), so each service's items are ordered among themselves and the
//       services then take turns, as Music Assistant lists them. Spotify's own playlists without saves (Spotify gives
//       other apps none) go first among Spotify's; anything else without a number keeps its place after the rated ones.
//   service(it) -> 'spotify' | 'soundcloud' | …  (the domain of the provider the item came from)
export function service(it) {
  const p = String((it && it.provider) || '');
  return p === 'library' ? ((it.provider_mappings || [])[0] || {}).provider_domain || 'library' : p.split('--')[0];
}

export function count(n) {
  if (!(n >= 0)) return '';
  if (n < 1000) return String(Math.round(n));
  const [d, s] = n < 1e6 ? [1e3, 'k'] : n < 1e9 ? [1e6, 'M'] : [1e9, 'B'];
  const v = n / d;
  return (v < 10 ? Math.floor(v * 10) / 10 : Math.floor(v)) + s;   // floored: 1,999 is 1.9k, never 2k
}

const OWN = /^spotify$/i;   // a playlist Spotify itself made
export const bySpotify = (it) => it && it.media_type === 'playlist' && service(it) === 'spotify' && OWN.test(it.owner || '');

export function rating(it, numbers) {
  if (!it) return null;
  const x = numbers || {}, s = service(it);
  if (s === 'spotify' && it.media_type === 'track') {
    const p = (it.metadata || {}).popularity;
    return typeof p === 'number' ? { n: p, kind: 'pop', text: String(p), title: `Spotify popularity ${p} of 100` } : null;
  }
  if (s === 'spotify' && typeof x.saves === 'number') return { n: x.saves, kind: 'saves', text: count(x.saves), title: `${x.saves.toLocaleString()} saves on Spotify` };
  if (typeof x.likes === 'number') {
    const plays = typeof x.plays === 'number' ? ` · ${x.plays.toLocaleString()} plays` : '';
    return { n: x.likes, kind: 'likes', text: count(x.likes), title: `${x.likes.toLocaleString()} likes on SoundCloud${plays}` };
  }
  return null;
}

// order one service's items: by number (high to low; Spotify's own playlists, which have none for other apps, above all),
// then those without one, in their order
function order(list, numbersOf) {
  const key = (it) => { const r = rating(it, numbersOf(it)); return r ? r.n : bySpotify(it) ? Infinity : null; };
  return list.map((it, i) => ({ it, i, k: key(it) }))
    .sort((a, b) => ((b.k !== null) - (a.k !== null)) || (a.k !== null && b.k !== a.k ? (b.k > a.k ? 1 : -1) : 0) || a.i - b.i)
    .map((x) => x.it);
}

// take turns: the first of each, then the second of each…
export function interleave(lists) {
  const out = [], n = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < n; i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

export function rank(list, numbersOf = () => null) {
  const by = new Map();
  for (const it of list) { const s = service(it); if (!by.has(s)) by.set(s, []); by.get(s).push(it); }
  return interleave([...by.values()].map((l) => order(l, numbersOf)));
}
