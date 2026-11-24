// What a player row/pop-up acts on. One configured player can be up to three HA entities:
//   ma     Music Assistant's player for it (queue, shuffle, repeat, volume) — default `<entity>_ma`
//   entity the Cast entity (what's casting, art, seek)
//   power  the Android TV Remote entity: real TV power, native apps, volume steps and mute
//   spotify  optional: HA's Spotify media player. Spotify picked as the device on a Google TV reports nothing through Cast or the
//          remote, so this is the only way to see it. It counts when its `source` (Spotify's device name) is this player's name.
// Each control goes to the first of those that is active and supports it (supported_features bits).
//
// What each one can be trusted for, from watching real TVs:
//   - A TV's remote entity saying off means the TV is off. Cast keeps reporting a session then: Spotify on a Chromecast follows
//     the account, so every TV "plays" whatever a phone plays, for hours, and a Cast reconnect brings a paused track back.
//   - Music Assistant mirrors whatever Cast reports, stale sessions included (source = the app, no active_queue). Only with an
//     active_queue is the playback MA's own. A mirror is never a source; it can still supply art, which Cast lacks for native apps.
//   - A remote saying on only means the Chromecast is awake: it can sit on its screensaver feeding a TV that's off, so nothing but a
//     real session or a real app in front counts as playing.
//   - The remote's app_id can lag (it reads Screensaver while Prime Video plays), so it only overrules an app that `follows`.
import { st } from './store.js';
import { mmss } from './dom.js';
import { appFor, isPackage } from './apps.js';
import * as home from '../home.js';
import { origin } from './auth.js';
import { CONFIRMED_FOR, PAUSED_SHOWS } from './music-timing.js';

export const F = { PAUSE: 1, SEEK: 2, VOLUME_SET: 4, VOLUME_MUTE: 8, PREV: 16, NEXT: 32, VOLUME_STEP: 1024, STOP: 4096, PLAY: 16384, SHUFFLE: 32768, REPEAT: 262144, SOURCE: 2048 };
const LIVE = ['playing', 'paused', 'buffering'];

export const maOf = (p) => (p.ma === undefined ? p.entity + '_ma' : p.ma);
// a picture as an entity names it (entity_picture: a path on Home Assistant, or a whole address) -> an address that loads
// from wherever the dashboard is served
export const artUrl = (pic) => (pic ? (/^https?:/.test(pic) ? pic : origin + pic) : '');
// the one power action of a TV, always off, so a repeated tap or a lagging state can't turn it back on: its real power,
// or, when its remote entity already reads off, the cast (stops the app)
export const powerAction = (p) => (p.power && (st(p.power) || {}).state !== 'off' ? { call: 'media_player.turn_off', target: p.power } : { call: 'media_player.turn_off', target: p.entity, expect: 'off' });
export const idsOf = (p) => [...new Set([...memberMas(p), ...spAll(p), p.entity, p.power, ...(p.group ? [] : groupMas())])].filter(Boolean);

// ---- speaker groups (a group made in the Google Home app: an MA player of type group, `group: true` in players) ----
// While a group plays, Music Assistant gives each member the group's queue as its own active queue (MA's active_group),
// and the member keeps it after the group stops (seen 2026-11-16). A member is MA's player of the room: its
// own (maOf) or, for a TV whose MA music goes through a Sendspin app, the MA player of its Cast side (`castMa`).
//   groupMaOf(p) -> the group's MA entity whose queue this player's MA player follows, or null
//   groupNow(p)  -> that group's MA entity while the group plays (or is paused) and the room plays nothing of its own
//                   (its own MA player on another queue, or anything else on screen with another title). Its screens are
//                   then the group's (one card, as for a sync group). The member's own MA player needn't say it plays:
//                   a speaker's MA "universal" player stays idle while its Cast side plays the group (seen 2026-11-16).
const memberMas = (p) => [...new Set([maOf(p), p.castMa])].filter(Boolean);
const groupMas = () => [].concat(home.players || []).filter((g) => g && g.group).map(maOf).filter(Boolean);
const followsAt = (m, g, get) => { const e = get(m), ge = get(g), q = e && e.attributes.active_queue;
  return !!q && !!ge && e.attributes.mass_player_type !== 'group' && ge.attributes.active_queue === q && (ge.attributes.group_members || []).includes(m); };
export function groupMaOfAt(p, groups, get) {
  if (p.group) return null;
  for (const m of memberMas(p)) { const g = groups.find((x) => followsAt(m, x, get)); if (g) return g; }
  return null;
}
export const groupMaOf = (p) => groupMaOfAt(p, groupMas(), st);
export function groupNowAt(p, groups, get, n = null) {
  if (p.group) return null;
  for (const m of memberMas(p)) {
    const g = groups.find((x) => followsAt(m, x, get)), ge = g && get(g);
    if (!g || !LIVE.includes(ge.state)) continue;
    const own = get(maOf(p));   // the room's own MA player playing something else: that is what the room shows
    if (own && LIVE.includes(own.state) && own.attributes.active_queue && own.attributes.active_queue !== ge.attributes.active_queue) return null;
    if (n && !n.screen && n.title && n.title !== ge.attributes.media_title) return null;   // something else on it (an app)
    return g;
  }
  return null;
}
export const groupNow = (p, n = now(p)) => groupNowAt(p, groupMas(), st, n);
// the members of a group (its MA entity) whose room plays a queue of its own on another MA player (a TV's Sendspin app):
// those MA entities. Music started on the group plays on the member's Cast player beside it, both at once, so they are
// stopped first (core/sync.js quietMembers).
export function ownQueuesIn(groupMa, players = home.players || []) {
  const members = ((st(groupMa) || { attributes: {} }).attributes.group_members) || [];
  return players.filter((p) => !p.group && memberMas(p).some((m) => members.includes(m)))
    .map(maOf).filter((m) => { const e = st(m); return !members.includes(m) && !!e && LIVE.includes(e.state) && !!e.attributes.active_queue; });
}
// `spotify`: HA's player of a Spotify account, or a list of them (one per account in the house: HA's Spotify integration,
// SpotifyPlus). spHere: the one whose account is playing on this player now (it names the player as its source).
const spAll = (p) => [].concat(p.spotify || []);
const spHereAt = (p, get) => spAll(p).find((id) => { const e = get(id); return !!e && LIVE.includes(e.state) && e.attributes.source === p.name; }) || null;
const spHere = (p) => spHereAt(p, st);
export const slug = (p) => p.entity.split('.')[1];
// a player's own pop-up: its id (a site names the pop-up so; the Playing card opens it), and both lookups by the Music
// Assistant entity the music is on: the home.js player behind it, and that player's pop-up (null: a group, or no player)
export const mediaPopupId = (p) => 'media-' + slug(p);
export const byMa = (players) => (ma) => players.find((x) => maOf(x) === ma) || null;
// (a room playing its speaker group's music opens the group's pop-up: groupNow)
export const popupByMa = (players) => { const find = byMa(players); return (ma) => { let p = find(ma); const g = p && groupNow(p); if (g) p = find(g) || p; return p ? mediaPopupId(p) : null; }; };

// false for an account-following app (Spotify) that isn't what this TV is doing. The app reports what the account plays from
// every TV it is signed in on, whatever plays it (a phone; Music Assistant, which streams through the same account), and not
// only from the background (AndroidNativeApp): under its own Cast id too (2026-11-16: two TVs "played"
// Music Assistant's song under Spotify's Cast id while HBO Max was in front). So it counts only with the app in front on the
// TV, or with the account naming this TV as where it plays (a real cast from a phone: confirmedAt).
// The rules themselves read entities through `get(id)` and the time through `t` (ms), and remember one thing in `conf`
// (a Map: player -> when its Cast and Spotify titles last matched), so they can be run on made-up states
// (engine/_dev/test/music-steady.test.mjs). sources(p) below is the same rules on the live states.
export function believedAt(p, e, remote, get, conf, t) {
  const a = appFor(e.attributes.app_name);
  if (!remote || !a || !a.follows) return true;
  return remote.attributes.app_id === a.pkg || confirmedAt(p, e, get, conf, t);
}
// HA's Spotify player names this TV as the account's device and plays the same track: the Cast session is this TV's own.
// Cast then leads: it changes at once, while the Spotify integration polls the cloud and lags 5-30 s (play / pause seen late).
// At a song change Cast has the new title at once and the Spotify player still the old one, for up to 30 s: the session
// stays confirmed through that (2 min since the titles last matched), or the old title would be shown until the poll.
const CONF = new Map();
export function confirmedAt(p, e, get, conf, t) {
  const sp = get(spHereAt(p, get) || '');
  if (!sp || !/spotify/i.test(e.attributes.app_name || '')) return false;
  if (e.attributes.media_title && sp.attributes.media_title === e.attributes.media_title) { conf.set(p.entity, t); return true; }
  return t - (conf.get(p.entity) || 0) < CONFIRMED_FOR;   // (a title missing for a moment mid-change doesn't end it)
}

// active entities, most capable first; a TV that is on in a native app (not casting) only has its remote
export function sourcesAt(p, get, conf, t) {
  const out = [], ma = maOf(p), me = ma && get(ma), ce = get(p.entity);
  const remote = p.power && p.power !== p.entity ? get(p.power) : null, off = !!remote && remote.state === 'off';
  if (me && LIVE.includes(me.state) && me.attributes.active_queue) out.push({ id: ma, e: me });
  // a Sendspin player app on the TV (MA's way to it instead of Cast): Cast only mirrors that app's media session, and keeps
  // it "paused" after MA stopped. MA's own player says what plays, so the mirror is never a source.
  const cast = !!ce && LIVE.includes(ce.state) && !off && believedAt(p, ce, remote, get, conf, t) && !/sendspin/i.test(ce.attributes.app_name || '');
  // the room plays its speaker group (groupNowAt): the group's MA player is its source, first, so every screen of the room
  // shows the group's song, queue and controls (a TV's Now playing and the launcher's cover too). Not while Cast shows
  // another app in front (the room left the group's music for it).
  if (!out.length && !(cast && !/music assistant/i.test(ce.attributes.app_name || ''))) {
    const g = groupNowAt(p, groupMas(), get); if (g) out.push({ id: g, e: get(g), group: true });
  }
  const spId = spHereAt(p, get), sp = spId && get(spId);   // playing here beats a remote that says off; paused on a TV that's off is a leftover
  // left out while Cast carries the same session (confirmed): its state would lag Cast's
  // nor while Cast shows Spotify with a title at all: Cast is the TV's own word, the account player may be several songs behind
  const castSays = cast && /spotify/i.test(ce.attributes.app_name || '') && !!ce.attributes.media_title;
  if (sp && (sp.state === 'playing' || !off) && !(cast && confirmedAt(p, ce, get, conf, t)) && !castSays) out.push({ id: spId, e: sp });
  if (cast) out.push({ id: p.entity, e: ce });
  if (remote && remote.state === 'on') out.push({ id: p.power, e: remote });
  return out;
}
export const sources = (p) => sourcesAt(p, st, CONF, Date.now());
// listed under Playing: something is playing or an app is open, not just a Chromecast that's awake
export const isLive = (p) => { const n = now(p); return !!n && !n.screen; };

// first active entity supporting `bit`
// (a Spotify cast: what Cast itself doesn't offer, shuffle and repeat, comes from HA's Spotify player of the same session)
// list: sources(p), for a caller that asks several things of one look at the player (core/session.js); so too below
export function pick(p, bit, list = sources(p)) {
  const has = (e) => ((e.attributes.supported_features || 0) & bit) === bit, s = list.find((x) => has(x.e));
  if (s) return s.id;
  const sp = spotifyOf(p);
  return sp && has(st(sp)) ? sp : null;
}
// The Spotify account player (HA's Spotify, SpotifyPlus) whose account is playing on this player: the account's side of
// it (shuffle, repeat, the account's other devices, up next). Cast showing Spotify, or no Cast session at all (Spotify
// Connect straight to the TV's app); null while Cast shows another app (the account's "playing here" is then stale).
export function spotifyOf(p) { const id = spHere(p), ce = st(p.entity); return id && (!ce || !LIVE.includes(ce.state) || /spotify/i.test(ce.attributes.app_name || '')) ? id : null; }

// what to show: the first active entity that knows the title, else the first active one
export function now(p, list = sources(p)) {
  const s = list.find((x) => x.e.attributes.media_title) || list[0];
  if (!s) return null;
  const a = s.e.attributes, playing = list.some((x) => x.e.state === 'playing');
  // Music that doesn't come through the app in front (MA by a player app in the background, e.g. Sendspin; Spotify Connect)
  // plays while the TV sits on its home screen or screensaver: that screen is then not what the TV is doing.
  const own = s.id === maOf(p) || spAll(p).includes(s.id), names = list.map((x) => x.e.attributes.app_name).filter(Boolean);
  const raw = spAll(p).includes(s.id) ? 'Spotify' : names.find((x) => !own || !(appFor(x) || {}).idle) || '', info = appFor(raw);
  const app = info ? info.name : isPackage(raw) ? '' : raw, title = a.media_title || app || (s.id === p.power ? 'TV on' : '');
  const mirror = maOf(p) && st(maOf(p)), ma = mirror && a.media_title && mirror.attributes.media_title === a.media_title ? mirror.attributes : {};
  return {
    // state 'on' = only the TV remote is active: it can't tell playing from paused
    id: s.id, state: playing ? 'playing' : s.e.state, a, title,
    // bare = the app published no title (Hulu, Netflix, Prime Video): only its logo and playing state are known
    bare: !a.media_title, brand: info && info.color ? info : null,
    // screen = awake on the screensaver, the home screen or nothing known: the TV behind it may be off
    screen: !!(info && info.idle) || (!raw && s.id === p.power),
    artist: a.media_artist || a.media_series_title || '',
    album: a.media_album_name || '',
    app: app === title ? '' : app,
    // the same-origin proxy first: it loads on the LAN, away from home too
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

// Music = an MA queue, media_content_type music, or an app that only plays music. Video never counts (a TV's Now playing is for music).
const MUSIC_APPS = /spotify|music assistant|youtube music|pandora|tidal|deezer|soundcloud|plexamp|apple music/i;
export function isMusic(p, n, live = maLive(p)) {
  if (!n || n.screen || n.bare || !LIVE.includes(n.state)) return false;
  return !!live || n.a.media_content_type === 'music' || MUSIC_APPS.test(n.app || '') || MUSIC_APPS.test(n.a.app_name || '');
}

// Music Assistant's player when it is the one playing (queue, Play on): an MA queue, not MA mirroring an app
// (or its speaker group's, while the room plays the group: sourcesAt)
export function maLive(p, list) { const id = maOf(p), e = id && st(id); if (e && LIVE.includes(e.state) && e.attributes.active_queue) return id; const s = (list || sources(p))[0]; return s && s.group ? s.id : null; }

// Cast/MA speaker groups: while a group plays, its member speakers report the same track. collapse() hides those members
// under the group so the Playing card shows one row. Groups are matched in `players` order, so list bigger groups first
// (a whole-home group before a floor group); a member row is only hidden while it plays exactly what the group plays.
const trackKey = (p) => { const n = now(p); return n ? n.a.media_content_id || `${n.title}|${n.artist}` : null; };
// The same for Music Assistant's sync groups (core/sync.js): the rooms that follow fold into the row of the one that leads.
export function collapse(players) {
  const hidden = new Set(), members = new Map(), keys = new Map(players.map((p) => [p.entity, trackKey(p)]));
  players.forEach((g) => {
    const id = maLive(g), m = id ? st(id).attributes.group_members || [] : [];
    if (m.length < 2 || m[0] !== id) return;
    const list = players.filter((p) => p !== g && m.includes(maOf(p)) && maLive(p));
    list.forEach((p) => hidden.add(p.entity)); if (list.length) members.set(g.entity, list.map((p) => p.name));
  });
  players.filter((p) => p.group && keys.get(p.entity) && !hidden.has(p.entity)).forEach((g) => {
    const k = keys.get(g.entity), list = [], gm = maOf(g);
    // the same track, or a room playing this group (groupNow: its Cast side may name the group's stream, not the track)
    players.forEach((p) => { if (p !== g && !hidden.has(p.entity) && (keys.get(p.entity) === k || (!p.group && groupNow(p) === gm))) { hidden.add(p.entity); if (!p.group) list.push(p.name); } });
    members.set(g.entity, list);
  });
  return { hidden, members };
}

// Music Assistant stopped (idle) with a song to go back to: its queue kept, and the song named on its entity. Every idle MA
// player names a queue (active_queue), an empty one too; only a queue with a current song names a title, so without one
// there is nothing to resume and the player is just not playing. On a Sendspin TV MA's Pause is such a stop (the entity
// goes idle and the queue keeps the place), so this is also how a paused TV looks: screens show it as paused
// (stoppedNow), not as "Nothing playing". stoppedQueue(p) -> the queue id; stopped(p): that, with nothing else really
// playing (only the TV remote's "TV on" / home screen)
// A group's queue that the room's player still names after the group stopped is the group's, not the room's: no Resume
// here (it would start the whole group under this room's name).
// A TV that is off (its remote entity says so: the one thing it can be trusted for) is off, whatever its queue still holds:
// not paused, no row under Playing, no Turn off.
export const tvOff = (p) => { const r = p.power && p.power !== p.entity ? st(p.power) : null; return !!r && r.state === 'off'; };
export function stoppedQueue(p) { const id = maOf(p), e = id && st(id); return e && e.state === 'idle' && e.attributes.active_queue && e.attributes.media_title && !groupMas().some((g) => followsAt(id, g, st)) ? e.attributes.active_queue : null; }
export function stopped(p, n = now(p)) { if (tvOff(p) || !stoppedQueue(p)) return false; return !n || n.id === p.power || !!n.screen; }
// the song a stopped queue holds, as now(p) would give it, paused (stopped: true; since: when it stopped, ms): Play
// resumes it (core/session.js)
export function stoppedNow(p, n = now(p)) {
  if (!stopped(p, n)) return null;
  const id = maOf(p), e = st(id), a = e.attributes;
  return { id, state: 'paused', a, title: a.media_title, bare: false, brand: null, screen: false, artist: a.media_artist || '', album: a.media_album_name || '', app: '', pic: a.entity_picture_local || a.entity_picture || '', stopped: true,
    since: Date.parse(a.media_position_updated_at || '') || (e.lc || 0) * 1000 };
}
// In a list of what plays in the house (cards/media.js) a paused player keeps its row, but a queue that stopped long ago
// is not "paused" any more (MA keeps the song for days): stoppedLong(n) once it stopped PAUSED_SHOWS ago. `since` is the
// position's own time (it outlives a restart of Home Assistant, which makes every state look new).
export const stoppedLong = (n, t = Date.now()) => !!n && !!n.stopped && t - n.since > PAUSED_SHOWS;

// what core/steady.js steadyStep needs to know of the entities: n = now(p); cplay: the Cast entity plays; castMA: Cast is
// Music Assistant's own way to the player (with another way, a Sendspin app on a TV, Cast just mirrors that app)
export function observe(p, n = now(p)) {
  const ce = st(p.entity);
  return { n, cplay: !!ce && ce.state === 'playing', castMA: !!ce && p.entity !== maOf(p) && /music assistant/i.test(ce.attributes.app_name || '') };
}
