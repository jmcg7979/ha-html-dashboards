// A made-up Music Assistant behind the relay's websocket API (engine/ha/custom_components/ma_relay), so a page on the
// mock reaches its music the way a real screen does: ma_relay/info, cmd, subscribe, playlist_size, party_player, ratings,
// sc_playlist, sources.
// Names are invented; the shapes follow MA 2.10's API (playlists / tracks / artists with provider, uri, duration,
// metadata.images; a queue with current_index, items, elapsed_time and its stamp).
//
// What it plays: a library of playlists, a search that makes up results from the words asked, and one queue of 18 songs
// for every queue id asked for (each id its own copy, song 3 playing, 63 s in). Commands that change a queue change it
// here and tell the screens that subscribed to it, as MA does. It does not move the players' HA entities: those are the
// site's states, and a check moves them with mock.set (a song change MA knows of before HA does is what the checks test).
// players/all is every media player the site's states give an `active_queue` or a `mass_player_type` (MA's player id =
// the entity id), each able to sync with the others HA marks as able to group.
//
// MOCK_MA=off      an HA without the relay: every ma_relay/* type is refused as unknown
// Test hook:       mock.music { reset: true }     HA's Music Assistant integration was reloaded: every subscription ends
//                                                 with the relay's relay_reset
// The relay's list of commands is checked against the dashboard's code by engine/_dev/test/music-relay.test.mjs; a command
// this file has no answer for is refused as the relay refuses one off its list.

const rnd = (s) => { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) >>> 0; return () => ((x = (x * 1103515245 + 12345) >>> 0) / 4294967296); };
const maps = (provider) => [{ provider_domain: provider, provider_instance: provider + '--demo' }];
const pl = (name, owner, provider = 'spotify', fav = false, id = null) => ({ item_id: id || 'p-' + name, provider: provider === 'spotify' && !id ? 'library' : provider, name, owner, favorite: fav,
  uri: `${provider}://playlist/${encodeURIComponent(id || name)}`, media_type: 'playlist', provider_mappings: maps(provider), metadata: { images: [] } });
const tr = (name, artist, duration, provider = 'soundcloud') => ({ item_id: 't-' + name, provider, name, duration, artists: [{ name: artist }], media_type: 'track',
  uri: `${provider}://track/${encodeURIComponent(name)}`, provider_mappings: maps(provider), metadata: { images: [] } });
const ar = (name, provider = 'spotify') => ({ item_id: 'a-' + name, provider, name, media_type: 'artist', uri: `${provider}://artist/${encodeURIComponent(name)}`,
  provider_mappings: maps(provider), metadata: { images: [] } });

const WORDS = ['Golden', 'Late', 'Easy', 'Electric', 'Sunday', 'Velvet', 'Neon', 'Coastal', 'Midnight', 'Open', 'Slow', 'Bright'];
const NOUNS = ['Hours', 'Groove', 'Drive', 'Session', 'Kitchen', 'Lounge', 'Rooftop', 'Mornings', 'Weekend', 'Glow', 'Heat', 'Waves'];
const PEOPLE = ['Mara Quill', 'DJ Halden', 'Low Orbit', 'Tess Avery', 'Copper Fox', 'Nightline', 'Ivo Brandt', 'Sela Moon', 'Kofi Reyes', 'The Paper Kites Club'];
// a search: from one service when `providers` names it (`limit` of each kind from it), else both cut together to `limit`
// as MA does. Spotify's songs carry a popularity; numbers for the rest come from ma_relay/ratings.
function search(q, types, limit = 25, providers = null) {
  const one = (svc) => {
    const r = rnd(q.toLowerCase() + svc), pick = (a) => a[Math.floor(r() * a.length)], T = q.replace(/\b\w/g, (c) => c.toUpperCase());
    const out = { playlists: [], tracks: [], artists: [], albums: [], radio: [] };
    const n = Math.min(limit, { spotify: 95, soundcloud: 60 }[svc] || 40);   // as the real ones: a service runs out somewhere
    if (!types || types.includes('playlist'))
      for (let i = 0; i < Math.min(n, svc === 'soundcloud' ? 30 : n); i++) out.playlists.push(pl(i === 0 && svc === 'spotify' ? T : `${pick(WORDS)} ${T.split(' ').slice(-1)[0]} ${pick(NOUNS)} ${i + 1}`.replace(/\s+/g, ' '), i % 7 === 3 && svc === 'spotify' ? 'Spotify' : pick(PEOPLE), svc, false, `${svc}-${i}-${q}`));
    if (!types || types.includes('track'))
      for (let i = 0; i < n; i++) {
        const set = svc === 'soundcloud' ? i % 3 !== 2 : i % 5 === 0, d = set ? 1500 + Math.floor(r() * 6000) : 150 + Math.floor(r() * 150);
        const t = tr(set ? `${T.replace(/ dj (set|mix)$/i, '')} ${pick(['Mix', 'Set', 'Live Set', 'Sessions Vol. ' + (1 + Math.floor(r() * 9))])} ${i + 1}` : `${pick(WORDS)} ${pick(NOUNS)} ${i + 1}`, pick(PEOPLE), d, svc);
        if (svc === 'spotify') t.metadata.popularity = Math.floor(r() * 90);
        out.tracks.push(t);
      }
    if ((!types || types.includes('artist')) && svc === 'spotify') for (let i = 0; i < Math.min(5, n); i++) out.artists.push(ar(PEOPLE[(i + q.length) % PEOPLE.length]));
    return out;
  };
  const svcs = providers && providers.length ? providers : SOURCES.map((x) => x.domain);
  const all = svcs.map(one);
  if (all.length === 1) return all[0];
  const zip = (k) => { const out = []; for (let i = 0; i < limit * 2; i++) for (const a of all) if (a[k][i]) out.push(a[k][i]); return out.slice(0, limit); };
  return { playlists: zip('playlists'), tracks: zip('tracks'), artists: zip('artists'), albums: [], radio: [] };
}
// the services MA searches (ma_relay/sources): Tidal stands for one added in MA later, which no code names
const SOURCES = [{ domain: 'soundcloud', name: 'Soundcloud' }, { domain: 'tidal', name: 'Tidal' }, { domain: 'spotify', name: 'Spotify' }];
// what others think of an item: made up from its uri, the same every time
function numbers(uri) {
  const r = rnd(uri), m = /^(\w+)(?:--\w+)?:\/\/(playlist|track)\//.exec(uri || '');
  if (!m || (m[1] === 'spotify' && m[2] === 'track')) return null;
  if (m[1] === 'spotify') return /^spotify:\/\/playlist\/(Discover|Release|Daily)/.test(uri) ? null : { saves: Math.floor(10 ** (1 + r() * 6)), count: 20 + Math.floor(r() * 300) };
  const likes = Math.floor(10 ** (r() * 4.5));
  return m[2] === 'playlist' ? { likes, count: 10 + Math.floor(r() * 300), duration: 3600 + Math.floor(r() * 30000) } : { likes, plays: likes * (20 + Math.floor(r() * 80)) };
}

const SONGS = [['Paper Lanterns', 'The Low Tides', 207], ['Dreamers', 'Night Bus', 178], ['Salt and Sun', 'Harbour Lights', 226], ['No Signal', 'Static Garden', 215],
  ['Slow Motion', 'June Avenue', 216], ['Pine Coast', 'The Wanderers', 187], ['After Hours', 'Neon Fields', 244], ['Back Porch', 'Coastline', 201], ['Summer Nights', 'Little Comets', 233]]
  .flatMap((x) => [x, [x[0] + ' (live)', x[1], x[2] + 31]]);   // 18: longer than the panel, like a real queue
const queueItem = ([n, a, d], i, id = 'd' + i) => ({ queue_item_id: id, name: `${a} - ${n}`, duration: d, media_item: { uri: 'demo://' + i, name: n, artists: [{ name: a }], image: '' } });
const LYRICS = ['Dreamers, dreamers', 'Wide awake at night', 'Chasing every light', 'Till the morning comes', 'We were dreamers', 'Running with the sun', 'Every single one', 'Singing on and on']
  .map((l, i) => { const s = 50 + i * 4; return `[0${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.00] ${l}`; }).join('\n');
const PARTY = { enable_add_queue: true, add_queue_limit: 10, add_queue_refill_minutes: 2, enable_boost: true, boost_limit: 1, boost_refill_minutes: 20, enable_skip_song: false,
  enable_rate_limiting: true, prevent_duplicate_tracks: true, party_name: '', mode: 'venue' };
const GROUPING = 524288;   // HA's MediaPlayerEntityFeature.GROUPING

export function musicAssistant({ S, log, send, ok, refuse, clients }) {
  const off = process.env.MOCK_MA === 'off';
  const now = () => Date.now() / 1000;
  const library = [
    pl('Discover Weekly', 'Spotify'), pl('Release Radar', 'Spotify'), pl('Daily Mix 1', 'Spotify'), pl('Daily Mix 2', 'Spotify'), pl('Daily Mix 3', 'Spotify'),
    pl('daylist • easygoing evening', 'Spotify'), pl('On Repeat', 'Spotify'),
    pl('Porch Evenings', 'Home', 'spotify', true), pl('Saturday Cleanup', 'Home', 'spotify', true),
  ];
  // the house's play log as the relay gives it (ma_relay/recent): each item with its service, enough of them to scroll
  const recent = () => [library[0], tr('Harbour Lights', 'Sela Moon', 214, 'spotify'), ...search('deep house dj set', ['track'], 4, ['soundcloud']).tracks, library[7], library[2], ar('Copper Fox'), library[1],
    ...search('porch', ['track'], 5, ['spotify']).tracks, ...search('evening', ['playlist'], 3, ['soundcloud']).playlists, ar('Sela Moon'), ...search('late night', ['track'], 3, ['tidal']).tracks]
    .map((x) => ({ ...x, domain: x.provider === 'library' ? 'spotify' : String(x.provider).split('--')[0] }));
  let party = process.env.MOCK_PARTY || null, made = 0;   // MOCK_PARTY=<entity>: where the party plays from the start

  // ---- queues: id -> { queue, items } ----
  const queues = new Map();
  function queueOf(id) {
    if (!queues.has(id)) queues.set(id, { items: SONGS.map((x, i) => queueItem(x, i)),
      queue: { queue_id: id, is_dynamic: false, current_index: 2, autoplay_enabled: true, crossfade_enabled: false, shuffle_enabled: false, repeat_mode: 'off', elapsed_time: 63, elapsed_time_last_updated: now() } });
    return queues.get(id);
  }
  const whole = (q) => ({ ...q.queue, items: q.items.length, current_item: q.items[q.queue.current_index] || null });
  // MA's events, to every screen that subscribed to this queue and this kind of event
  function tell(id, event, data) {
    for (const ws of clients()) for (const [sub, s] of ws.maSubs || []) {
      if (s.ids.includes(id) && s.events.includes(event)) send(ws, { id: sub, type: 'event', event: { event, object_id: id, data, time: now() } });
    }
  }
  const moved = (id) => { tell(id, 'queue_items_updated', whole(queueOf(id))); tell(id, 'queue_updated', whole(queueOf(id))); };
  const playing = (q, index) => Object.assign(q.queue, { current_index: index, elapsed_time: 0, elapsed_time_last_updated: now() });
  // a song by its queue item id, or by its number in the queue
  const find = (q, key) => { const i = q.items.findIndex((x) => x.queue_item_id === key); return i >= 0 ? i : Number.isInteger(+key) && q.items[+key] ? +key : -1; };
  // a song goes from `from` to `to`; the current song stays the current song
  function move(q, from, to) {
    const cur = q.items[q.queue.current_index], [it] = q.items.splice(from, 1);
    q.items.splice(Math.max(0, Math.min(q.items.length, to)), 0, it);
    q.queue.current_index = Math.max(0, q.items.indexOf(cur));
  }

  const commands = {
    'music/playlists/library_items': (a) => (a.favorite ? library.filter((p) => p.favorite) : library),
    'music/recently_played_items': () => recent(),
    'music/search': (a) => search(a.search_query || '', a.media_types, a.limit || 25, a.providers),
    'music/favorites/add_item'(a) { const p = library.find((x) => x.uri === a.item) || (/:\/\/playlist\//.test(a.item || '') ? { ...pl(decodeURIComponent(a.item.split('/').pop()), 'Home', a.item.split(':')[0].split('--')[0]), uri: a.item } : null); if (p) { p.favorite = true; if (!library.includes(p)) library.push(p); } return null; },
    'music/favorites/remove_item'(a) { const p = library.find((x) => x.item_id === a.library_item_id); if (p) p.favorite = false; return null; },
    // a playlist's songs: the endless mix behind a queue's song is the queue backwards, any other playlist 20 to 80 songs
    'music/playlists/playlist_tracks'(a) {
      if (/^radio_playlist|demo-mix/.test(a.item_id + '')) return SONGS.slice().reverse().map((x, i) => { const it = queueItem(x, SONGS.length - 1 - i); return { ...it.media_item, duration: it.duration }; });
      const r = rnd(a.item_id || ''), n = 20 + Math.floor(r() * 60);
      return Array.from({ length: n }, (_, i) => { const t = tr(`${WORDS[i % WORDS.length]} ${NOUNS[(i * 5) % NOUNS.length]}`, PEOPLE[i % PEOPLE.length], 150 + Math.floor(r() * 120), 'spotify'); t.uri += '-' + i; t.metadata.popularity = Math.floor(r() * 90); return t; });
    },
    'music/item_by_uri'(a) {
      const i = /^demo:\/\/\d+$/.test(a.uri || '') ? +a.uri.slice(7) : -1, it = SONGS[i] && queueItem(SONGS[i], i);
      return it ? { ...it.media_item, duration: it.duration, album: { name: it.media_item.name, year: 2019 }, track_number: 3, provider_mappings: [{ provider_domain: 'spotify', audio_format: { content_type: 'ogg' } }],
        metadata: { popularity: 42, genres: ['indie'] }, date_added: '2026-10-02T12:00:00Z' } : { uri: a.uri, item_id: 'demo-mix', provider: 'radio_playlist', name: 'Endless mix' };
    },
    'metadata/get_track_lyrics': () => [null, LYRICS],
    'party/url': () => 'http://music.example:8095/?join=DEMO1234',
    'party/config': () => PARTY,
    'players/all'() {
      const ids = Object.keys(S).filter(isPlayer), syncs = (id) => ((S[id].a.supported_features || 0) & GROUPING) === GROUPING;
      return ids.map((id) => ({ player_id: id, name: id, can_group_with: syncs(id) ? ids.filter((x) => x !== id && syncs(x)) : [] }));
    },
    'player_queues/get': (a) => whole(queueOf(a.queue_id)),
    'player_queues/items'(a) { const q = queueOf(a.queue_id), o = a.offset || 0; return q.items.slice(o, o + (a.limit || q.items.length)); },
    'player_queues/play_index'(a) { const q = queueOf(a.queue_id), i = find(q, a.index); if (i >= 0) { playing(q, i); tell(a.queue_id, 'queue_updated', whole(q)); } return null; },
    // replace: the songs backwards as a new queue, playing its first, a moment later (as MA takes one). play: the song
    // goes in after the current one and plays. next / add: it goes in after the current one / at the end.
    'player_queues/play_media'(a) {
      const q = queueOf(a.queue_id), id = a.queue_id;
      if (a.option === 'replace') { setTimeout(() => { q.items = SONGS.slice().reverse().map((x, i) => queueItem(x, SONGS.length - 1 - i, 'm' + i)); playing(q, 0); moved(id); }, 300); return null; }
      const name = decodeURIComponent(String(a.media || 'A song').split('/').pop());
      const it = { queue_item_id: 'a' + made++, name: 'Artist - ' + name, duration: 200, media_item: { uri: String(a.media || ''), name, artists: [{ name: 'Artist' }], image: '' } };
      q.items.splice(a.option === 'add' ? q.items.length : q.queue.current_index + 1, 0, it);
      if (a.option === 'play') playing(q, q.queue.current_index + 1);
      moved(id); return null;
    },
    // pos_shift 0: next after the current song; otherwise that many places down (negative: up)
    'player_queues/move_item'(a) { const q = queueOf(a.queue_id), i = find(q, a.queue_item_id); if (i < 0) throw new Error('no such queue item'); const cur = q.queue.current_index;
      move(q, i, a.pos_shift ? i + a.pos_shift : i < cur ? cur : cur + 1); moved(a.queue_id); return null; },
    'player_queues/move_item_end'(a) { const q = queueOf(a.queue_id), i = find(q, a.queue_item_id); if (i < 0) throw new Error('no such queue item'); move(q, i, q.items.length); moved(a.queue_id); return null; },
    'player_queues/delete_item'(a) { const q = queueOf(a.queue_id), i = find(q, a.item_id_or_index); if (i < 0) throw new Error('no such queue item');
      const cur = q.items[q.queue.current_index]; q.items.splice(i, 1); q.queue.current_index = Math.max(0, q.items.indexOf(cur)); moved(a.queue_id); return null; },
    'player_queues/autoplay'(a) { const q = queueOf(a.queue_id); q.queue.autoplay_enabled = !!a.autoplay_enabled; tell(a.queue_id, 'queue_updated', whole(q)); return null; },
    'player_queues/crossfade'(a) { const q = queueOf(a.queue_id); q.queue.crossfade_enabled = !!a.crossfade_enabled; tell(a.queue_id, 'queue_updated', whole(q)); return null; },
  };

  // an MA player among the site's states (ha.mjs gives these the registry entry HA's Music Assistant integration makes)
  function isPlayer(id) { const a = id.startsWith('media_player.') && S[id] && S[id].a; return !!a && (Object.hasOwn(a, 'active_queue') || Object.hasOwn(a, 'mass_player_type')); }

  const on = off ? {} : {
    'ma_relay/info': (ws, m) => ok(ws, m, { connected: true, image_key: 'mock', time: now(), artist_photo: true }),   // (the photo itself: server.mjs, none)
    'ma_relay/cmd'(ws, m) {
      log('MA ' + JSON.stringify({ command: m.command, args: m.args || {} }));
      if (!Object.hasOwn(commands, m.command)) return refuse(ws, m, 'not_allowed', `${m.command} isn't relayed`);
      try { ok(ws, m, commands[m.command](m.args || {})); } catch (e) { refuse(ws, m, 'ma_error', e.message); }
    },
    'ma_relay/subscribe'(ws, m) { (ws.maSubs || (ws.maSubs = new Map())).set(m.id, { ids: m.ids || [], events: m.events || [] }); ok(ws, m, null); },
    'ma_relay/playlist_size'(ws, m) { log('SIZE ' + JSON.stringify({ item_id: m.item_id, provider: m.provider })); const t = commands['music/playlists/playlist_tracks']({ item_id: m.item_id }); ok(ws, m, { count: t.length, duration: t.reduce((s, x) => s + (x.duration || 0), 0) }); },
    'ma_relay/sources': (ws, m) => ok(ws, m, SOURCES),
    'ma_relay/recent': (ws, m) => ok(ws, m, recent()),
    'ma_relay/ratings'(ws, m) { const out = {}; for (const u of m.uris || []) { const x = numbers(u); if (x) out[u] = x; } setTimeout(() => ok(ws, m, out), 300); },
    'ma_relay/sc_playlist'(ws, m) { const r = rnd(m.item_id), n = 15 + Math.floor(r() * 120);
      ok(ws, m, Array.from({ length: n }, (_, i) => { const t = tr(`${WORDS[(i * 7) % WORDS.length]} ${NOUNS[i % NOUNS.length]} Mix`, PEOPLE[(i * 3) % PEOPLE.length], 1200 + Math.floor(r() * 4000)); t.uri = `soundcloud://track/${m.item_id}${i}`; return { ...t, ...numbers(t.uri) }; })); },
    'ma_relay/party_player'(ws, m) { if (m.entity_id) party = m.entity_id; ok(ws, m, { entity_id: party, player_id: party }); },
  };
  return {
    on, isPlayer: (id) => !off && isPlayer(id),
    unsubscribe: (ws, sub) => !!(ws.maSubs && ws.maSubs.delete(sub)),
    // mock.music { reset: true }
    hook(d) {
      if (d.reset) for (const ws of clients()) { for (const sub of (ws.maSubs || new Map()).keys()) send(ws, { id: sub, type: 'event', event: { event: 'relay_reset', object_id: null, data: null } }); ws.maSubs = new Map(); }
    },
  };
}
