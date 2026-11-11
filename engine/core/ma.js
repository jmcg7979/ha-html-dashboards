// Music Assistant's own API, for what HA doesn't expose: the whole queue, lyrics, the autoplay and crossfade switches.
// Talks to the MA server's WebSocket (`ws://<host>:8095/ws`) with an MA token. The token comes from the TV launcher
// (tvhost.maToken, tv/launcher/README.md); a screen without one simply has no MA extras (null from available()).
// Site option in home.js: export const music_assistant = { url: 'http://<ma host>:8095' } (default: this page's host, port 8095).
// &tvdemo=1 in a browser: a made-up queue and lyrics, for building the page on the mock.
//   available() -> Promise<boolean>   queue(id, fn) -> unsubscribe; fn({ queue, items }) on every change
//   lyrics(item) -> Promise<{ lines: [{ t, text }] | null, text: string | null }>   cmd(command, args) -> Promise
import * as H from '../home.js';

const DEMO = new URLSearchParams(location.search).has('tvdemo') && !window.tvhost;
let ws = null, ready = null, seq = 0, retry = 0;
const pending = new Map(), subs = new Map();   // message_id -> { ok, fail }; queue_id -> Set(fn)
const cache = new Map();                       // queue_id -> { queue, items }

function token() {
  const B = window.tvhost;
  if (!B || !B.maToken) return Promise.resolve(null);
  return new Promise((res) => {
    const cb = '__maTok' + ++seq;
    window[cb] = (t) => { delete window[cb]; res(t || null); };
    B.maToken(cb);
    setTimeout(() => { if (window[cb]) { delete window[cb]; res(null); } }, 3000);
  });
}
const base = () => ((H.music_assistant && H.music_assistant.url) || `${location.protocol}//${location.hostname}:8095`).replace(/\/$/, '');

function connect() {
  if (ready) return ready;
  ready = token().then((tok) => (!tok ? (ready = null, false) : new Promise((res) => {   // no token (yet): false now, asked again later (again())
    let s; try { s = new WebSocket(base().replace(/^http/, 'ws') + '/ws'); } catch (e) { ready = null; res(false); return; }
    let authed = false;
    setTimeout(() => { if (!authed) s.close(); }, 10000);   // no hello / no answer to the sign-in: give up (onclose), try again later
    s.onmessage = (m) => {
      let d; try { d = JSON.parse(m.data); } catch (e) { return; }
      if (d.server_id && !authed) {   // the server's hello: sign in
        send(s, 'auth', { token: tok }).then(() => { authed = true; ws = s; retry = 0; res(true); for (const id of subs.keys()) refresh(id); }, () => { s.close(); res(false); });
        return;
      }
      if (d.message_id != null && pending.has(d.message_id)) {
        const p = pending.get(d.message_id);
        if (d.partial) { p.part = (p.part || []).concat(d.result || []); return; }   // big results come in parts
        pending.delete(d.message_id);
        if (d.error_code) p.fail(new Error(d.details || 'MA error ' + d.error_code)); else p.ok(p.part ? p.part.concat(d.result || []) : d.result);
        return;
      }
      if (d.event) event(d);
    };
    // closed (MA restarted, network): fail what was waiting, and while a queue is shown keep trying, 5 s then up to a minute apart
    s.onclose = () => { ws = null; ready = null; pending.forEach((p) => p.fail(new Error('closed'))); pending.clear(); if (!authed) res(false); again(); };
    s.onerror = () => {};
  })));
  return ready;
}
function again() {
  if (!subs.size || again.t || !window.tvhost) return;   // only a TV (the launcher holds the token) has anything to retry for
  again.t = setTimeout(() => { again.t = 0; ready = ws ? ready : null; connect().then((ok) => { if (!ok) again(); }); }, Math.min(60000, 5000 * 2 ** retry++));
}
function send(s, command, args) {
  const id = String(++seq);
  return new Promise((ok, fail) => {
    pending.set(id, { ok, fail });
    s.send(JSON.stringify({ message_id: id, command, args: args || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); fail(new Error('timeout')); } }, 15000);
  });
}
export const available = () => (DEMO ? Promise.resolve(true) : connect());
export function cmd(command, args) {
  if (DEMO) { console.info('ma:', command, args); return demoCmd(command, args); }
  return connect().then((ok) => (ok && ws ? send(ws, command, args) : Promise.reject(new Error('no MA'))));
}

// a queue item's artwork, small, through MA's image proxy (MA images are { path, proxy_id, remotely_accessible })
export function image(it, size = 80) {   // MA's proxy sizes: 80, 160, 256, 512, 1024
  const m = it && (it.media_item || it), im = it && (it.image || m.image || ((m.metadata || {}).images || []).find((x) => x.type === 'thumb') || (m.album || {}).image);
  if (!im) return '';
  if (typeof im === 'string') return /^https?:/.test(im) ? im : '';
  if (im.proxy_id && !DEMO) return `${base()}/imageproxy/${im.proxy_id}?size=${size}&fmt=jpg`;
  return im.remotely_accessible && /^https?:/.test(im.path || '') ? im.path : '';
}

// ---- queues ----
function emit(id) { const c = cache.get(id); if (c) (subs.get(id) || []).forEach((f) => f(c)); }
const timer = {};
function refresh(id, itemsToo = true) {
  clearTimeout(timer[id]);
  timer[id] = setTimeout(() => {
    Promise.all([cmd('player_queues/get', { queue_id: id }), itemsToo || !cache.get(id) ? cmd('player_queues/items', { queue_id: id, limit: 200, offset: 0 }) : null])
      .then(([queue, items]) => { cache.set(id, { queue, items: items || (cache.get(id) || {}).items || [] }); emit(id); }, () => {});
  }, 150);
}
function event(d) {
  const id = d.object_id; if (!subs.has(id)) return;
  if (d.event === 'queue_items_updated') refresh(id, true);
  else if (d.event === 'queue_updated' && d.data) { const c = cache.get(id) || { items: [] }; const moved = !c.queue || c.queue.current_index !== d.data.current_index; cache.set(id, { ...c, queue: d.data }); emit(id); if (moved) refresh(id, true); }
  else if (d.event === 'queue_time_updated') { const c = cache.get(id); if (c && c.queue) { c.queue = { ...c.queue, elapsed_time: d.data, elapsed_time_last_updated: Date.now() / 1000 }; emit(id); } }
}
export function queue(id, fn) {
  if (!id) return () => {};
  if (!subs.has(id)) subs.set(id, new Set());
  subs.get(id).add(fn);
  if (cache.has(id)) fn(cache.get(id));
  available().then((ok) => { if (ok) refresh(id); else again(); });
  return () => { const s = subs.get(id); if (s) { s.delete(fn); if (!s.size) subs.delete(id); } };
}

// ---- lyrics: synced (LRC) when MA has them, else plain text ----
// Found lyrics are kept; "none" is not: MA's first lookup for a song can come back empty while it is still fetching the
// song's metadata (seen 2026-11-11: none on the TV, 2 KB of synced lyrics a minute later), so `again` asks once more.
const lyr = new Map();
export function lyrics(item, again = false) {
  const uri = item && item.media_item && item.media_item.uri;
  if (!uri) return Promise.resolve({ lines: null, text: null });
  const had = lyr.get(uri);
  if (!had || (again && !had.found)) {
    const p = cmd('music/item_by_uri', { uri }).then((track) => cmd('metadata/get_track_lyrics', { track }))
      .then((r) => { const [text, lrc] = r || []; return { lines: lrc ? parseLrc(lrc) : null, text: text || null }; }, () => ({ lines: null, text: null }));
    const entry = { p, found: false };
    p.then((L) => { entry.found = !!(L.lines || L.text); });
    lyr.set(uri, entry);
    if (lyr.size > 50) lyr.delete(lyr.keys().next().value);   // the oldest song: a TV runs for weeks
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

// ---- &tvdemo=1 ----
const DQ = 'demo-queue';
const demoItems = [['Paper Lanterns', 'The Low Tides', 207], ['Dreamers', 'Night Bus', 178], ['Salt and Sun', 'Harbour Lights', 226], ['No Signal', 'Static Garden', 215],
  ['Slow Motion', 'June Avenue', 216], ['Pine Coast', 'The Wanderers', 187], ['After Hours', 'Neon Fields', 244], ['Back Porch', 'Coastline', 201], ['Summer Nights', 'Little Comets', 233]]
  .flatMap((x) => [x, [x[0] + ' (live)', x[1], x[2] + 31]])   // 18: longer than the panel, like a real queue
  .map(([n, a, d], i) => ({ queue_item_id: 'd' + i, name: `${a} - ${n}`, duration: d, media_item: { uri: 'demo://' + i, name: n, artists: [{ name: a }], image: '' } }));
const demoQ = { queue_id: DQ, is_dynamic: new URLSearchParams(location.search).has('tvdemodyn'), current_index: 2, items: demoItems.length, autoplay_enabled: true, crossfade_enabled: false, shuffle_enabled: false, repeat_mode: 'off', elapsed_time: +(new URLSearchParams(location.search).get('tvdemopos') || 63), elapsed_time_last_updated: Date.now() / 1000 };
function demoCmd(command, args) {
  if (command === 'player_queues/get') return Promise.resolve({ ...demoQ, current_item: demoItems[demoQ.current_index] });
  if (command === 'player_queues/items') return Promise.resolve(demoItems);
  if (command === 'music/item_by_uri') { const it = demoItems.find((x) => x.media_item.uri === args.uri);
    return Promise.resolve(it ? { ...it.media_item, duration: it.duration, album: { name: it.media_item.name, year: 2019 }, track_number: 3, provider_mappings: [{ provider_domain: 'spotify', audio_format: { content_type: 'ogg' } }], metadata: { popularity: 42, genres: ['indie'] }, date_added: '2026-10-02T12:00:00Z' }
      : { uri: args.uri, item_id: 'demo-mix', provider: 'radio_playlist', name: 'Endless mix' }); }
  if (command === 'music/playlists/playlist_tracks') return Promise.resolve(demoItems.slice().reverse().map((x) => ({ ...x.media_item, duration: x.duration })));
  if (command === 'metadata/get_track_lyrics') return Promise.resolve([null, ['Dreamers, dreamers', 'Wide awake at night', 'Chasing every light', 'Till the morning comes', 'We were dreamers', 'Running with the sun', 'Every single one', 'Singing on and on']
    .map((l, i) => `[00:${String(50 + i * 4).padStart(2, '0')}.00] ${l}`).join('\n').replace(/\[00:(\d\d)/g, (m, s) => (+s >= 60 ? `[01:${String(+s - 60).padStart(2, '0')}` : m))]);
  if (command === 'player_queues/play_media' && args.option === 'replace') {   // Play mix: a new queue, playing its first song
    const items = demoItems.slice().reverse().map((x, i) => ({ ...x, queue_item_id: 'm' + i }));
    setTimeout(() => { cache.set(DQ, { queue: { ...demoQ, current_index: 0, current_item: items[0] }, items }); emit(DQ); }, 300); return Promise.resolve(null); }
  if (command === 'player_queues/autoplay') { demoQ.autoplay_enabled = args.autoplay_enabled; cache.set(DQ, { ...cache.get(DQ), queue: { ...cache.get(DQ).queue, autoplay_enabled: args.autoplay_enabled } }); emit(DQ); }
  if (command === 'player_queues/crossfade') { demoQ.crossfade_enabled = args.crossfade_enabled; cache.set(DQ, { ...cache.get(DQ), queue: { ...cache.get(DQ).queue, crossfade_enabled: args.crossfade_enabled } }); emit(DQ); }
  return Promise.resolve(null);
}
