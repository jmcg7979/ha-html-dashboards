// Music Assistant's own API, for what HA's actions don't cover: browsing, the whole queue, lyrics, pins, Party, autoplay /
// crossfade. Every screen reaches it the same way: through HA's WebSocket and the relay integration
// (engine/ha/custom_components/ma_relay), which uses the connection HA's Music Assistant integration already holds.
// So any screen signed in to HA has it, at home or away, with no MA login of its own. Without the relay (or with MA down)
// available() is false and the cards show what HA alone gives.
//   available() -> Promise<boolean>   cmd(command, args) -> Promise
//   queue(id, fn) -> unsubscribe; fn({ queue, items, offset }, tick) on every change (tick: only its clock moved, MA's
//       word every few seconds while it plays). `queue` is MA's queue (current_index,
//       items = how many songs, …); `items` is a part of its songs around the current one, the first of them being number
//       `offset` of the queue. So a song is looked up with itemAt(data, index) and found with indexOf(data, queue_item_id),
//       never with items[index].
//   edit(id, change, sent) -> sent    a change of ours shown before MA confirms it: { set: { autoplay_enabled: true } } or
//       { move: queue_item_id, after: queue_item_id | null }. It stays over what MA sends until `sent` (the command's
//       promise) settles: then it is MA's (resolved) or gone (rejected).
//   recent() -> Promise<[item]>   what the house played last, newest first: what somebody picked, by any MA user (the
//       relay's ma_relay/recent; each item with its service in `domain`, a song with duration and artists). A relay
//       without it: MA's log of HA's own user.
//   artistPhotoUrl(name) -> Promise<address | null>   a photo of the artist through the relay (its /api/ma_relay/artist:
//       looked up and fetched by Home Assistant, once for the house); null when HA has no relay, or one that can't yet.
//       Needs no Music Assistant.
//   lyrics(item, again) -> Promise<{ lines: [{ t, text }] | null, text: string | null, late }>   late: MA didn't answer in
//       time (it looks up one song per 30 s and this one waits its turn): not "none", the next call asks again
//   lyricsKept(item) -> whether its lyrics were asked for already (an answer is here or on its way)
//   kept(key, ms, ask) -> the promise of ask()'s answer, asked again only once the last one under this key is older than
//       ms (a failed one isn't kept); forget(prefix) drops the keys that start so. For browsing: a search, the library.
import { request, send, unsubscribe, connected, up as haUp } from './ha.js';
import { sent as pressSent } from './feedback.js';
import { origin } from './auth.js';
import { REFRESH_WAIT, RETRY_REFUSED, RETRY_UNSENT, PARTY_KEPT } from './music-timing.js';

let info = null, asking = null;   // info: the relay's answer { connected, image_key, time }
// MA stamps a queue's position with its server's clock; this screen counts on from that stamp with its own. `ahead` is how
// far the server's clock is ahead of this screen's (seconds), from the time the relay sends with its info and every
// event; a relay that sends none leaves it 0. localQueue() moves a queue's stamp onto this screen's clock.
let ahead = 0;
const heard = (serverS) => { if (typeof serverS === 'number' && serverS > 0) ahead = serverS - Date.now() / 1000; };
export const localStamp = (queue, aheadS) => (queue && queue.elapsed_time_last_updated && aheadS ? { ...queue, elapsed_time_last_updated: queue.elapsed_time_last_updated - aheadS } : queue);
const localQueue = (queue) => localStamp(queue, ahead);
// queue_id -> Set(fn); queue_id -> { queue, items, offset } as MA last sent it; queue_id -> its subscription (listen); queue_id -> [changes of ours not yet MA's]
const subs = new Map(), cache = new Map(), live = new Map(), edits = new Map();

const BEHIND = 20, AHEAD = 200; // the part of a queue that is kept: this many songs before the current one, and after it
const REFILL = 100;             // fewer songs than this held after the current one: the part is read again
const LYRICS_KEPT = 50;         // songs whose lyrics are kept

// Home Assistant doesn't know the relay's commands: a site without it, or a Home Assistant that has just restarted and
// hasn't loaded it yet (a screen is back before the relay is). Believed for RETRY_REFUSED, then asked again: kept
// for good, a screen that was open over a restart never heard of Music Assistant again (its queue stood still).
let norelayAt = 0;
function connect() {   // -> Promise<boolean>: the relay answers and MA is connected to HA
  if (norelayAt && Date.now() - norelayAt < RETRY_REFUSED) return Promise.resolve(false);
  if (info && info.connected && connected()) return Promise.resolve(true);
  if (!asking) {
    asking = haUp().then(() => request({ type: 'ma_relay/info' })).then((r) => { info = r; heard(r.time); return !!r.connected; }, (e) => { if (e && e.code === 'unknown_command') norelayAt = Date.now(); return false; })
      .then((ok) => { asking = null; return ok; });
  }
  return asking;
}
export const artistPhotoUrl = (name) => (info ? Promise.resolve() : connect()).then(() => (info && info.artist_photo
  ? `${origin}/api/ma_relay/artist?name=${encodeURIComponent(name)}&k=${encodeURIComponent(info.image_key)}` : null));
// where MA's Party plays, as an HA entity; partyPlayer(entity) moves it there (the relay changes that one Party setting)
export function partyPlayer(entity) {
  if (entity) partyAt = 0;   // the party moves: party() asks again
  return connect().then((ok) => (ok ? request(entity ? { type: 'ma_relay/party_player', entity_id: entity } : { type: 'ma_relay/party_player' })
    .then((r) => { if (entity) partyAt = 0; return r; }, (e) => { throw new Error((e && e.message) || String(e)); }) : Promise.reject(new Error('no MA'))));   // (moved: what was asked meanwhile is old)
}
// MA's Party for a card that only shows its code (the player): { url, entity, config } = the guests' join link ('' with guest
// access off, or no MA), the HA entity the party plays on and the Party plugin's settings (partyRules() words them). Asked of
// MA at most every PARTY_KEPT; never rejects.
let partyAt = 0, partyGot = null;
export function party() {
  if (!partyGot || Date.now() - partyAt > PARTY_KEPT) {
    partyAt = Date.now();
    const ask = (command) => request({ type: 'ma_relay/cmd', command, args: {} });
    partyGot = connect().then((ok) => (ok ? Promise.all([ask('party/url'), request({ type: 'ma_relay/party_player' }).catch(() => ({})), ask('party/config').catch(() => ({}))]) : ['', {}, {}]))
      .then(([url, pp, config]) => ({ url: url ? String(url) : '', entity: (pp && pp.entity_id) || '', config: config || {} }), () => ({ url: '', entity: '', config: {} }));
  }
  return partyGot;
}
// what guests may do, in words, from the Party plugin's settings (party/config)
export const partyRules = (c) => [c.enable_add_queue !== false && (c.enable_rate_limiting ? `Add up to ${c.add_queue_limit} songs each, one more every ${c.add_queue_refill_minutes} min` : 'Add songs'),
  c.enable_boost && (c.enable_rate_limiting ? `Boost a song to play sooner: ${c.boost_limit} every ${c.boost_refill_minutes} min` : 'Boost a song to play sooner'),
  c.enable_skip_song ? 'Guests can skip a song' : 'Guests can’t skip songs', c.prevent_duplicate_tracks && 'No song twice in the queue'].filter(Boolean);
export const available = () => connect();
export function cmd(command, args) {
  const done = pressSent() || (() => {});   // the button pressed for this shows it is working until MA answers (core/feedback.js)
  return connect().then((ok) => {
    if (!ok) { done(true); throw new Error('no MA'); }
    return request({ type: 'ma_relay/cmd', command, args: args || {} }).then((r) => { done(); return r; }, (e) => { done(true); throw e; })
      .catch((e) => { if (e && (e.code === 'not_connected' || e.code === 'unknown_command')) info = null; throw new Error((e && e.message) || String(e)); });   // (what the relay said of itself is old: connect() asks again)
  });
}

// ---- answers kept a while. One past its time goes when the next one is kept ----
const keep = new Map();
export function kept(k, ms, ask) {
  const c = keep.get(k), t = Date.now();
  if (c && t - c.t < ms) return c.p;
  keep.forEach((v, key) => { if (t - v.t >= v.ms) keep.delete(key); });
  const p = ask().catch((e) => { keep.delete(k); throw e; });
  keep.set(k, { t, ms, p });
  return p;
}
export const forget = (prefix) => [...keep.keys()].forEach((k) => { if (k.startsWith(prefix)) keep.delete(k); });

// How many songs a playlist has and how long they run: { count, duration }. The relay counts them in Home Assistant; a
// relay that can't yet (an older one) has this screen fetch the songs and count, as before.
export function playlistSize(item_id, provider) {
  const count = (t) => ({ count: (t || []).length, duration: (t || []).reduce((s, x) => s + (x.duration || 0), 0) });
  const here = () => cmd('music/playlists/playlist_tracks', { item_id, provider_instance_id_or_domain: provider }).then(count);
  return connect().then((ok) => { if (!ok) throw new Error('no MA'); return request({ type: 'ma_relay/playlist_size', item_id: String(item_id), provider: String(provider) }); })
    .catch((e) => { if (e && e.code === 'unknown_command') return here(); throw e; });
}

// What other listeners think of these playlists and songs (their MA uris): { uri: { saves | likes, plays, count, duration } },
// from the relay (Spotify playlists' saves, SoundCloud's likes and plays). A relay without it, or MA down: {}.
export function ratings(uris) {
  if (!uris.length) return Promise.resolve({});
  return connect().then((ok) => (ok ? request({ type: 'ma_relay/ratings', uris }) : {})).catch(() => ({}));
}
// A SoundCloud playlist's songs (MA's shape, with likes and plays), read by the relay from SoundCloud in batches: MA reads
// them one at a time. A relay that can't yet: MA's own list.
export function scPlaylist(item_id) {
  return connect().then((ok) => { if (!ok) throw new Error('no MA'); return request({ type: 'ma_relay/sc_playlist', item_id: String(item_id) }); })
    .catch((e) => { if (e && e.code === 'unknown_command') return cmd('music/playlists/playlist_tracks', { item_id, provider_instance_id_or_domain: 'soundcloud' }); throw e; });
}
// The music services MA searches for songs and playlists: [{ domain, name }] (the relay's ma_relay/sources, asked once a
// session). A relay that can't yet: Spotify and SoundCloud.
const SOURCES_KNOWN = [{ domain: 'spotify', name: 'Spotify' }, { domain: 'soundcloud', name: 'SoundCloud' }];
let sourcesP = null;
export function sources() {
  if (!sourcesP) {
    sourcesP = connect().then((ok) => { if (!ok) throw new Error('no MA'); return request({ type: 'ma_relay/sources' }); })
      .then((l) => (Array.isArray(l) && l.length ? l : SOURCES_KNOWN), (e) => { if (e && e.code === 'unknown_command') return SOURCES_KNOWN; sourcesP = null; throw e; });
  }
  return sourcesP;
}

export function recent() {
  return connect().then((ok) => { if (!ok) throw new Error('no MA'); return request({ type: 'ma_relay/recent' }); })
    .catch((e) => { if (e && e.code === 'unknown_command') return cmd('music/recently_played_items', { limit: 40, fully_played_only: false, user_initiated_only: true }); throw e; });
}

// an HA entity of HA's Music Assistant integration -> its MA player id (= its queue id), from HA's entity registry
const maIds = new Map();
export function playerId(entity) {
  if (maIds.has(entity)) return Promise.resolve(maIds.get(entity));
  return request({ type: 'config/entity_registry/get_entries', entity_ids: [entity] }).then((reg) => {
    const r = (reg || {})[entity], id = r && r.platform === 'music_assistant' ? r.unique_id : null;
    if (id) maIds.set(entity, id);
    return id;
  });
}

// a queue item's artwork, small, through MA's image proxy (MA images are { path, proxy_id, remotely_accessible })
export function image(it, size = 80) {   // MA's proxy sizes: 80, 160, 256, 512, 1024
  const m = it && (it.media_item || it), im = it && (it.image || m.image || ((m.metadata || {}).images || []).find((x) => x.type === 'thumb') || (m.album || {}).image);
  if (!im) return '';
  if (typeof im === 'string') return /^https?:/.test(im) ? im : '';
  if (im.proxy_id && info) return `${origin}/api/ma_relay/image/${encodeURIComponent(im.proxy_id)}?size=${size}&k=${encodeURIComponent(info.image_key)}`;
  return im.remotely_accessible && /^https?:/.test(im.path || '') ? im.path : '';
}

// ---- a queue as it is kept: { queue, items, offset }. These read it; nothing here asks or remembers anything ----
// the part to fetch around song number `index` of `total`: -> { offset, limit } for player_queues/items
export function windowFor(index, total) {
  const at = Math.max(0, +index || 0), offset = Math.max(0, at - BEHIND), end = total > 0 ? Math.min(total, at + 1 + AHEAD) : at + 1 + AHEAD;
  return { offset, limit: Math.max(1, end - offset) };
}
// the song at number `index` of the queue (undefined when that part isn't held), and the number of the song with this id (-1)
export const itemAt = (d, index) => (d && d.items && index != null ? d.items[index - (d.offset || 0)] : undefined);
export const indexOf = (d, id) => { const i = d && d.items ? d.items.findIndex((x) => x.queue_item_id === id) : -1; return i < 0 ? -1 : i + (d.offset || 0); };
// how many songs the queue has: MA's count, or what is held when it doesn't say
export const totalOf = (d) => (!d ? 0 : d.queue && d.queue.items > 0 ? d.queue.items : (d.offset || 0) + (d.items || []).length);
// What the list shows around song number `at`: up to `past` songs before it, the song itself, up to `ahead` after it; each
// as { it, ix } with its number in the queue. left: songs after it in the whole queue; more: those of them not listed.
export function listAround(d, at, past, ahead) {
  const off = (d && d.offset) || 0, items = (d && d.items) || [], rel = at - off, total = Math.max(totalOf(d), off + items.length);
  const part = (from, to) => items.slice(Math.max(0, from), Math.max(0, to)).map((it, i) => ({ it, ix: off + Math.max(0, from) + i }));
  const cur = rel >= 0 ? items[rel] : undefined, up = part(rel + 1, rel + 1 + ahead), left = Math.max(0, total - at - 1);
  return { past: part(rel - past, rel), now: cur ? { it: cur, ix: at } : null, up, left, more: Math.max(0, left - up.length) };
}
// MA's queue with our changes that it hasn't confirmed over it. A move puts the song right after another one (null: first
// of the part held), so it changes nothing when MA's list already has it there.
export function withEdits(c, list) {
  if (!c || !list || !list.length) return c;
  let queue = c.queue, items = c.items || [];
  for (const e of list) {
    if (e.set) queue = { ...(queue || {}), ...e.set };
    if (e.move != null) {
      const from = items.findIndex((x) => x.queue_item_id === e.move); if (from < 0) continue;
      const rest = items.slice(), [it] = rest.splice(from, 1), k = e.after == null ? -1 : rest.findIndex((x) => x.queue_item_id === e.after);
      if (e.after != null && k < 0) continue;
      rest.splice(k + 1, 0, it); items = rest;
    }
  }
  return { ...c, queue, items };
}
// The part held is still enough around song number `index`: the song is in it, and so are the next REFILL songs (or the
// queue's last). While that holds, a new current song needs no new read of the songs (MA says so when the list changes).
export function holds(d, index) {
  const off = (d && d.offset) || 0, n = ((d && d.items) || []).length, total = totalOf(d);
  if (!d || !d.queue || index == null || index < off || index >= off + n) return false;
  return off + n >= total || off + n - 1 - index >= REFILL;
}
// One MA event for a queue kept as `c` (undefined: nothing yet), at `nowS` (seconds, this screen's clock)
// -> { c: what is kept now, emit: tell the listeners, refresh: read the queue again }
export function onEvent(c, d, nowS) {
  if (d.event === 'queue_items_updated') return { c, refresh: true };
  if (d.event === 'queue_updated' && d.data) {
    const was = c || { items: [], offset: 0 }, moved = !was.queue || was.queue.current_index !== d.data.current_index;
    return { c: { ...was, queue: d.data }, emit: true, refresh: moved && !holds({ ...was, queue: d.data }, d.data.current_index) };
  }
  if (d.event === 'queue_time_updated' && c && c.queue) return { c: { ...c, queue: { ...c.queue, elapsed_time: d.data, elapsed_time_last_updated: nowS } }, emit: true };
  return { c };
}

// ---- queues ----
// listeners are told one by one: one that throws doesn't stop the others, or the event handler they are called from
function emit(id, tick = false) {
  const c = cache.get(id); if (!c) return;
  const d = withEdits(c, edits.get(id));
  [...(subs.get(id) || [])].forEach((f) => { try { f(d, tick); } catch (x) { console.error(x); } });
}
const timer = {}, asked = {}, wrote = {};   // per queue: the pending reload, the number of the last one asked, how many events changed it
// Read the queue again: MA's queue first (it says which song is current), then the songs around that one. Only the
// answer to the last reload asked for counts, and only while the queue is shown.
function refresh(id) {
  clearTimeout(timer[id]);
  const n = (asked[id] = (asked[id] || 0) + 1);
  timer[id] = setTimeout(() => {
    const w0 = wrote[id] || 0;
    cmd('player_queues/get', { queue_id: id }).then((queue) => {
      const w = windowFor(queue && queue.current_index, queue && queue.items);
      return cmd('player_queues/items', { queue_id: id, limit: w.limit, offset: w.offset }).then((items) => {
        if (asked[id] !== n || !subs.has(id)) return;
        // an event that came while this was on its way is newer than the queue asked for before it
        const had = cache.get(id), q = had && had.queue && (wrote[id] || 0) !== w0 ? had.queue : localQueue(queue);
        cache.set(id, { queue: q, items: items || [], offset: w.offset }); emit(id);
      });
    }).catch(() => {});
  }, REFRESH_WAIT);
}
function event(d) {
  // the relay's own word: HA's Music Assistant integration was reloaded (or MA went away) and none of this screen's
  // subscriptions hears anything any more. Each queue shown is subscribed to again once MA is back.
  if (d.event === 'relay_reset') { info = null; [...live.keys()].forEach((q) => { unlisten(q); setTimeout(() => listen(q), RETRY_UNSENT); }); return; }
  heard(d.time);
  const id = d.object_id; if (!subs.has(id)) return;
  const r = onEvent(cache.get(id), d.event === 'queue_updated' && d.data ? { ...d, data: localQueue(d.data) } : d, Date.now() / 1000);
  if (r.emit) { cache.set(id, r.c); wrote[id] = (wrote[id] || 0) + 1; emit(id, d.event === 'queue_time_updated'); }
  if (r.refresh) refresh(id);
}
// A queue's songs and MA's events for it, while it is shown: as soon as MA can be reached, which is now, or later (Home
// Assistant still starting, the relay not loaded yet, MA down: asked again every RETRY_REFUSED until it is). HA dropping
// the link drops the subscription: wait for HA, then again, and what the relay said of itself before is old.
// live: queue_id -> this attempt, { sub: its HA subscription's id once it is sent }: one that was overtaken (the queue
// went off screen, a reset) does nothing more.
function listen(id) {
  if (live.has(id) || !subs.has(id)) return;
  const mine = { sub: 0 }; live.set(id, mine);
  const retry = (ms) => { if (live.get(id) !== mine) return; live.delete(id); setTimeout(() => listen(id), ms); };
  connect().then((ok) => {
    if (live.get(id) !== mine) return;
    if (!ok) { retry(RETRY_REFUSED); return; }
    refresh(id);
    const msg = { type: 'ma_relay/subscribe', ids: [id], events: ['queue_updated', 'queue_items_updated', 'queue_time_updated'] };
    const sent = send(msg, (r, m) => { if (!m.success) { info = null; retry(RETRY_REFUSED); } }, event, () => { info = null; haUp().then(() => retry(0)); });
    if (sent) mine.sub = msg.id; else retry(RETRY_UNSENT);
  });
}
function unlisten(id) {
  const k = live.get(id); live.delete(id);
  if (k && k.sub) unsubscribe(k.sub);
}
export function queue(id, fn) {
  if (!id) return () => {};
  if (!subs.has(id)) subs.set(id, new Set());
  subs.get(id).add(fn);
  if (cache.has(id)) fn(withEdits(cache.get(id), edits.get(id)), false);
  if (live.has(id)) refresh(id); else listen(id);
  return () => {
    const s = subs.get(id); if (!s) return;
    s.delete(fn); if (s.size) return;
    // the last one showing this queue has gone: nothing is kept (what was kept would be old when it is next shown), and
    // a reload on its way is dropped
    subs.delete(id); unlisten(id); cache.delete(id); edits.delete(id); clearTimeout(timer[id]); asked[id] = (asked[id] || 0) + 1;
  };
}
export function edit(id, change, sent) {
  if (!edits.has(id)) edits.set(id, []);
  edits.get(id).push(change); emit(id);
  const drop = () => { const l = edits.get(id), i = l ? l.indexOf(change) : -1; if (i < 0) return false; l.splice(i, 1); return true; };
  sent.then(() => { if (drop() && cache.has(id)) cache.set(id, withEdits(cache.get(id), [change])); emit(id); }, () => { drop(); emit(id); });
  return sent;
}

// ---- lyrics: synced (LRC) when MA has them, else plain text ----
// Found lyrics are kept; "none" is not: MA's first lookup for a song can come back empty while it is still fetching the
// song's metadata (none at first, synced lyrics a minute later), so `again` asks once more. An answer that didn't come in
// the relay's time is not "none" either (`late`): MA goes on looking, and the next call asks again whatever `again` says.
const lyr = new Map();
const uriOf = (item) => (item && item.media_item && item.media_item.uri) || '';
export const lyricsKept = (item) => { const had = lyr.get(uriOf(item)); return !!had && !had.late; };
export function lyrics(item, again = false) {
  const uri = uriOf(item);
  if (!uri) return Promise.resolve({ lines: null, text: null });
  const had = lyr.get(uri);
  if (!had || had.late || (again && !had.found)) {
    const p = cmd('music/item_by_uri', { uri }).then((track) => cmd('metadata/get_track_lyrics', { track }))
      .then((r) => { const [text, lrc] = r || []; return { lines: lrc ? parseLrc(lrc) : null, text: text || null }; },
        (e) => ({ lines: null, text: null, late: /didn.t answer/i.test(String(e && e.message)) }));
    const entry = { p, found: false, late: false };
    p.then((L) => { entry.found = !!(L.lines || L.text); entry.late = !!L.late; });
    lyr.set(uri, entry);
    if (lyr.size > LYRICS_KEPT) lyr.delete(lyr.keys().next().value);   // the oldest song: a TV runs for weeks
    return p;
  }
  return had.p;
}
export function parseLrc(s) {
  const out = [];
  s.split(/\r?\n/).forEach((ln) => {
    const tags = [...ln.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)]; if (!tags.length) return;
    const text = ln.replace(/\[[^\]]*\]/g, '').trim();
    tags.forEach((m) => out.push({ t: +m[1] * 60 + +m[2], text }));
  });
  return out.length ? out.sort((a, b) => a.t - b.t) : null;
}
