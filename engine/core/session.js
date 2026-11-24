// One player, as every screen sees it: the one model behind the media pop-up (cards/media-detail.js), the TV's Now playing
// (cards/nowplaying.js), the shared queue / lyrics parts (core/queue-ui.js, core/lyrics-ui.js) and everything that only
// names the song (the Home rows, the picker's tiles, the rail, a pop-up's header). One session per player, shared by
// whatever shows it on this screen, so they agree on the song, the clock, the queue and what a button does. The session is
// the only thing that reads the player's entities for them and the only one that moves a song change on (core/steady.js).
//   const S = session(p)            p: a `players` entry from home.js (core/players.js says which entity does what)
//   S.on(fn, { queue }) -> off      fn(snapshot) after every change: the player's entities, MA's queue, a song change
//                                   settling, music on its way (core/wake.js). While somebody listens the session watches
//                                   the entities itself; a card watches only what else it shows. queue: false for a card
//                                   that only names the song (a row, a tile): MA's queue is not read for it
//   S.snap -> the snapshot, frozen, worked out once per change (with nobody listening: when it is read):
//       n          the song as shown: smoothed through song changes (core/steady.js: held, target, starting), a stopped
//                  queue's song as paused (players.js stoppedNow: MA's Pause on a Sendspin TV is a stop); null: nothing to
//                  show, also after this screen's own Stop (the card then says where it stopped, with Resume)
//       song       what plays, smoothed, without the stopped queue: null as soon as the music has ended
//       stopped    MA kept a stopped queue with a song, and nothing else plays here
//       pending    { text, what } while music is on its way here
//       now        what the entities say this moment, not smoothed (players.js now)
//       live       the MA entity whose queue plays here (the room's own, or its speaker group's), or null
//       rooms      the MA entities that queue plays on: this room and the rooms in sync with it ([] without MA)
//       spotify    the Spotify account player of what plays here, or null (players.js spotifyOf)
//       music      n is music, not a video app (players.js isMusic; the song MA's queue is going to is music before
//                  the player says so)
//       musicOn    `song` when it is music, else null: what a bar that only shows while music plays goes by
//       caps       the entity that takes each control, or null: pause, play, prev, next, stop, seek, shuffle, repeat,
//                  volume (set), step (volume up / down), mute, source
//       remoteOnly nothing but the TV's remote entity is active
//       queueId    MA's queue here (playing or stopped), or null
//       data       { queue, items, offset } | null: that queue once core/ma.js has it; `items` is the part of the queue
//                  around the current song (core/ma.js itemAt / indexOf / listAround read it)
//       cur        the number of the current song in the queue (the skip's target while one is under way)
//       item       the queue's current item         dynamic: an endless mix (MA refuses shuffle and repeat)
//   S.pos(n) -> seconds into the song: MA's own clock when its queue plays here (HA's copy runs ~0.3 s behind), else HA's
//   S.act(a, ctx)                   play | prev | next | stop | shuffle | repeat | mute | vdown | vup; ctx = { el, ev } of the tap
//   S.ending()                      the music is being ended from here another way (the TV turned off): as after Stop,
//                                   the last song isn't held as if another one were coming
//   S.toggle('autoplay' | 'crossfade')
//   S.itemAct(a, item)              play | next | end | del on a queue item      S.shift(item, places)   S.playMedia(uri, option)
//   S.resume()                      a stopped queue plays on (a TV that's off is turned on first)
//   S.moveTo(entities, W, playerFor)   the music and its queue play on these rooms (one, or several in sync: core/sync.js;
//                                   TVs that are off are turned on first)
//   S.leave()                       this room drops out of the rooms it plays in sync with; the others play on
// In a sync group the queue is the leader's: play / pause / skip / stop / shuffle / repeat from any of its rooms go to the
// leader and so act on all of them; volume and mute stay the room's own.
// Song changes this screen didn't make (the next song of the queue, Next pressed on another screen, a voice command) are
// seen in MA's queue and shown like our own (core/steady.js, soft skips), so every screen changes the same way.
import { st, watch } from './store.js';
import { outside } from './scope.js';
import { call, connected } from './ha.js';
import { run } from './actions.js';
import { toast } from './toast.js';
import * as MA from './ma.js';
import { wake, bring, pending, onPending } from './wake.js';
import { F, idsOf, sources, now, pick, maOf, maLive, elapsed, observe, isMusic, spotifyOf, tvOff, stoppedQueue, stopped, stoppedNow, groupNow } from './players.js';
import { fresh, steadyStep, beginSkip, skipTarget, retarget, noteStop, ended } from './steady.js';
import { membersOf, leaderOf, movePlan, leavePlan, carryOut, quietMembers } from './sync.js';
import { LOOK_UNSETTLED, QUEUE_ELSEWHERE, CHECK_SKIP, MINE_FOR } from './music-timing.js';

// a queue item wraps its track; a mix's tracks are tracks
export const track = (it) => (it && it.media_item) || it || {};
// the title as MA's HA entity gives it: the name, with the version when it has one ("One More Time (Radio Edit)")
export const titleOf = (it) => { const t = track(it), n = t.name || (it && it.name) || ''; return t.version && !n.includes(t.version) ? `${n} (${t.version})` : n; };
export const artistOf = (it) => (track(it).artists || []).map((a) => a.name).join(', ');
const target = (it) => ({ title: titleOf(it), artist: artistOf(it), pic: MA.image(it, 512), uri: track(it).uri || '', qid: (it && it.queue_item_id) || '' });
const REPEAT_NEXT = { off: 'all', all: 'one', one: 'off' };
export const repeatIcon = (r) => (r === 'one' ? 'repeat-once' : r === 'all' ? 'repeat' : 'repeat-off');

// ---- what the queue's numbers mean; nothing here reads a player or the clock ----
// the queue's current song: MA names it, else the one at its current number. A queue that says it is empty, or has no
// current number, has none, whatever songs are still held of it (it was just handed to another room: the songs held are
// read again a moment after MA's word)
export const currentOf = (d) => {
  const Q = d && d.queue; if (!Q) return null;
  return Q.current_item || (Q.items !== 0 && Q.current_index != null ? MA.itemAt(d, Math.max(0, Q.current_index)) : null) || null;
};
// Next has nowhere to go: the last song, and nothing that would bring another (repeat all, an endless mix, autoplay)
export function atEnd(d, at) {
  const Q = d && d.queue; if (!Q || !(Q.items > 0)) return false;
  return at + 1 >= Q.items && Q.repeat_mode !== 'all' && !Q.is_dynamic && !Q.autoplay_enabled;
}
// Seconds into the song by MA's queue clock at `nowS` (seconds): the time it last reported, plus the time since while it
// plays; null when the queue has no clock. n: what plays (its state, and the song's length to stop at).
export function queuePos(Q, n, nowS) {
  if (!Q || Q.elapsed_time == null || !Q.elapsed_time_last_updated) return null;
  const d = n ? +n.a.media_duration || 0 : 0, s = +Q.elapsed_time + (n && n.state === 'playing' ? nowS - Q.elapsed_time_last_updated : 0);
  return Math.max(0, d ? Math.min(s, d) : s);
}
// What a word from MA's queue means for the song change on screen. sk: the skip under way (the memo's, core/steady.js) or null;
// it / index: the queue's current song and its number; last: the id of the song before this word; canSoft(): MA plays
// here and isn't paused (asked only when it matters).
//   'target'   our own skip didn't know where it was going (Previous): the queue says where
//   'retarget' a change from elsewhere, and the queue has moved again: follow it
//   'verify'   our own skip, but the queue is on another song: if it stays there, the queue is right
//   'soft'     no skip under way and the song is another one: a change from elsewhere begins
export function queueSays(sk, it, index, last, canSoft) {
  const id = it && it.queue_item_id;
  if (sk && !sk.title && it && index !== sk.from) return 'target';
  if (sk && sk.soft && it && id !== sk.qid) return 'retarget';
  if (sk && it && sk.qid && id !== sk.qid) return 'verify';
  if (!sk && last && id && id !== last && canSoft()) return 'soft';
  return null;
}
// a song moved `places` down (negative: up) in the part of the queue held: the song it ends up right after (null: first)
export function moveAfter(items, id, places) {
  const from = items.findIndex((x) => x.queue_item_id === id); if (from < 0) return undefined;
  const rest = items.filter((x) => x.queue_item_id !== id), to = Math.max(0, Math.min(rest.length, from + places));
  return to ? rest[to - 1].queue_item_id : null;
}

const CAPS = { pause: F.PAUSE, play: F.PLAY, prev: F.PREV, next: F.NEXT, stop: F.STOP, seek: F.SEEK, shuffle: F.SHUFFLE, repeat: F.REPEAT,
  volume: F.VOLUME_SET, step: F.VOLUME_STEP, mute: F.VOLUME_MUTE, source: F.SOURCE };

const ALL = new Map();
export function session(p) { let s = ALL.get(p.entity); if (!s) ALL.set(p.entity, (s = make(p))); return s; }

function make(p) {
  const fns = new Map(), ma = maOf(p);   // fns: listener -> it wants MA's queue
  let memo = fresh();   // the song change under way, and the song held through it (core/steady.js)
  let qid = null, unsub = null, data = null, lastItem = null, laterT = 0, fixT = 0, offPending = null, offWatch = null, wrongId = null;
  // mine: Pause or Stop pressed here ({ by: 'pause' | 'stop', at, seen: the queue has stopped since }), until it plays again
  let mine = null;
  let snap = null, stale = true;
  // The cards are told one by one: one that throws doesn't stop the others. A change that comes while they are being
  // told (a card's draw made the session look at another queue) is one more round after this one, not a draw inside a draw.
  let telling = false, again = false;
  const tell = () => {
    if (telling) { again = true; return; }
    telling = true;
    try { let rounds = 0; do { again = false; const v = S.snap; [...fns.keys()].forEach((f) => { try { f(v); } catch (x) { console.error(x); } }); } while (again && ++rounds < 3); } finally { telling = false; }
  };
  // something changed: the snapshot is worked out again, and whoever listens is told
  const changed = () => { stale = true; if (fns.size) tell(); };
  const wantsQueue = () => [...fns.values()].some(Boolean);
  let subscribing = false;   // a queue that is already known answers while it is being subscribed to: the cards hear of it right after

  // one step of the song-change rules on what the entities say now -> the song, smoothed
  function step(n = now(p)) {
    if (!n && tvOff(p)) { ended(memo); return null; }   // a screen that isn't drawn again when the hold ends (a pop-up's header) would go on saying Playing
    const r = steadyStep(memo, observe(p, n), Date.now());
    memo = r.memo;
    return r.show;
  }
  const cur = () => { const sk = memo.skip; return sk && sk.index != null ? sk.index : data && data.queue ? Math.max(0, data.queue.current_index || 0) : 0; };

  function onQueue(d, tick) {
    data = d;
    if (tick) return;   // only its clock moved: pos() counts from it, nothing is drawn again
    const Q = d.queue || {}, it = currentOf(d), id = it && it.queue_item_id;
    step();   // a skip that has run its course goes now, not at the next look
    const sk = memo.skip, where = it && { index: Q.current_index, ...target(it) };
    // (not after our own Stop or Leave: what the queue says next is its end here, not another song)
    const says = queueSays(sk, it, Q.current_index, lastItem, () => !!maLive(p) && (now(p) || {}).state !== 'paused' && !(mine && mine.by === 'stop'));
    if (says === 'target') skipTarget(memo, where);   // our Previous: MA says where it went
    else if (says === 'retarget') retarget(memo, where);   // more changes from elsewhere: follow them
    // our own skip, but the queue is somewhere else (MA dropped a press, or took one more): once the queue has stayed there
    // 2.5 s (it flips back to the last song for up to 1.5 s on its way), it is right and the screen follows it. The wait
    // starts when the queue gets there, not again with every word from it while it stays.
    else if (says === 'verify') { if (wrongId !== id) { wrongId = id; verify(QUEUE_ELSEWHERE); } }
    else if (says === 'soft') beginSkip(memo, { soft: true, ...where }, Date.now());
    if (says !== 'verify') wrongId = null;
    if (id) lastItem = id;
    stale = true;
    if (subscribing) queueMicrotask(tell); else tell();
  }
  // a while after a skip of ours (or a queue event that disagrees with it): is the queue on the song the screen shows?
  function verify(ms) {
    clearTimeout(fixT);
    fixT = setTimeout(() => {
      wrongId = null;
      const sk = memo.skip, Q = data && data.queue, it = currentOf(data);
      if (sk && sk.qid && it && it.queue_item_id !== sk.qid) { retarget(memo, { index: Q.current_index, ...target(it) }); changed(); }
    }, ms);
  }
  const listen = (id) => { subscribing = true; try { unsub = MA.queue(id, onQueue); } finally { subscribing = false; } };
  // MA's queue is let go, and nothing of it is kept (it would be old, and taken for a song change, when it is next read)
  const letGo = () => { if (unsub) unsub(); unsub = null; data = null; lastItem = null; wrongId = null; };
  const follow = (id) => { qid = id; letGo(); if (id && wantsQueue()) listen(id); };

  // One look at the player: every entity of it is read here, once, and the song change moves one step.
  function look() {
    const t = Date.now(), list = sources(p), raw = now(p, list), live = maLive(p, list), le = live && st(live);
    // which queue: MA's while it plays here, or the one it stopped with (while nothing else plays here: not a stopped
    // queue beside an app that plays its own). Followed as the player's state changes.
    const was = stopped(p, raw), id = (le && le.attributes.active_queue) || (was && stoppedQueue(p)) || null;
    if (id && id !== qid) follow(id);
    const song = step(raw);
    if (!id && qid && !(song && song.held)) follow(null);   // (held: MA's player is idle for a moment between two songs, the queue isn't gone)
    if (mine) { if (was) mine.seen = true; else if (song && song.state === 'playing' && !song.held && (mine.seen || t - mine.at > MINE_FOR)) mine = null; }
    // a song held through a change: a skip under way, or (unless we paused it here) MA idle for a moment between two songs
    const stop = was && !(song && song.held && (song.target || !mine));
    const n = stop ? (mine && mine.by === 'stop' ? null : stoppedNow(p, raw)) : song;
    clearTimeout(laterT);
    if (fns.size && song && song.unsettled) laterT = setTimeout(changed, LOOK_UNSETTLED);
    const caps = {}; for (const k of Object.keys(CAPS)) caps[k] = pick(p, CAPS[k], list);
    const Q = data && data.queue;
    const musical = (x) => isMusic(p, x, live) || (!!x && !!x.target && !!qid);   // (a skip's target: a song of MA's queue, before any entity plays it)
    return Object.freeze({ n, song, stopped: stop, pending: pending(ma), now: raw, live, rooms: live ? membersOf(live) : [], spotify: spotifyOf(p),
      music: musical(n), musicOn: musical(song) ? song : null, caps: Object.freeze(caps), remoteOnly: list.every((s) => s.id === p.power),
      queueId: qid, data, cur: cur(), item: currentOf(data), dynamic: !!(Q && Q.is_dynamic) });
  }
  // `own`: the room's own (volume, mute). Anything else of an MA player that follows another goes to its leader, shown here at once.
  // -> true when the action went out (there is a player that takes it, and a link to send it on)
  const go = (action, bit, ctx, d, expect, own) => {
    const id = pick(p, bit); if (!id) return false;
    const to = !own && id === ma ? leaderOf(id) : id, up = connected();
    const ex = expect == null || to === id ? expect : { ...(typeof expect === 'string' ? { state: expect } : expect), entity: id };
    run({ call: 'media_player.' + action, target: to, data: d, expect: ex }, { ...ctx, entity: to });   // (no link: it says so)
    return up;
  };
  const cmd = (c, args, fail) => MA.cmd(c, { queue_id: qid, ...args }).catch((e) => { if (fail) toast(fail); throw e; });
  const dynamic = () => !!(data && data.queue && data.queue.is_dynamic);

  const S = {
    get snap() { if (stale || !offWatch) { stale = false; snap = look(); } return snap; },   // (a queue's first word, heard inside look(), leaves it stale: read again)
    on(fn, opt = {}) {
      const had = wantsQueue();
      fns.set(fn, opt.queue !== false);
      if (!offWatch) {
        offPending = onPending((e) => { if (e === ma) changed(); });
        let built = false;   // watch() calls back at once when the states are in: nothing has changed then
        offWatch = outside(() => watch(idsOf(p), () => { if (built) changed(); }));
        built = true;
      }
      if (!had && wantsQueue() && qid && !unsub) listen(qid);
      stale = true; void S.snap;   // the queue is followed from now on, whenever the card first draws
      return () => {
        if (!fns.delete(fn)) return;
        if (!wantsQueue()) { letGo(); clearTimeout(fixT); stale = true; }
        if (fns.size) return;
        // nobody shows this player any more: nothing is watched and nothing is kept
        offPending(); offPending = null; offWatch(); offWatch = null; clearTimeout(laterT);
        qid = null; stale = true;
      };
    },
    pos(n) {
      const s = S.snap.live ? queuePos(data && data.queue, n, Date.now() / 1000) : null;
      return s != null ? s : n ? elapsed(n) : null;
    },
    // our own skip: the song it's going to shows at once (item: where to, when known)
    skipTo(it, index) {
      const from = data && data.queue ? data.queue.current_index : null;
      beginSkip(memo, it ? { index, from, ...target(it) } : { index, from }, Date.now());
      wrongId = null; verify(CHECK_SKIP);   // MA can drop a press made while it is still loading the last one
      changed();
    },
    ending() { noteStop(memo, Date.now()); mine = { by: 'stop', at: Date.now() }; stale = true; },
    act(a, ctx = {}) {
      const n = now(p);
      if (a === 'play') {
        if (stopped(p, n)) { S.resume(); return; }   // a stopped MA queue: play resumes it (not the TV remote's play key)
        if (n && n.state === 'playing') mine = { by: 'pause', at: Date.now() };
        else { const g = p.group ? ma : groupNow(p, n); if (g) quietMembers(g); }   // a speaker group starting (from its own card, or from a room that plays it): its rooms' own queues stop (core/sync.js)
        go('media_play_pause', pick(p, F.PAUSE) ? F.PAUSE : F.PLAY, ctx, undefined, n && n.state === 'playing' ? 'paused' : n && n.state === 'paused' ? 'playing' : undefined);
      }
      // a song change shows only when the press went out, and Next only when the queue has somewhere to go
      if (a === 'prev') { if (go('media_previous_track', F.PREV, ctx) && qid) S.skipTo(null, null); }
      if (a === 'next') { const at = cur(), i = at + 1, it = MA.itemAt(data, i); if (go('media_next_track', F.NEXT, ctx) && qid && !atEnd(data, at)) S.skipTo(it, it ? i : null); }
      if (a === 'stop') { if (go('media_stop', F.STOP, ctx)) { S.ending(); changed(); } }
      if (a === 'shuffle') { const id = pick(p, F.SHUFFLE); if (id && !dynamic()) { const v = !st(id).attributes.shuffle; go('shuffle_set', F.SHUFFLE, ctx, { shuffle: v }, { attr: 'shuffle', value: v }); } }
      if (a === 'repeat') { const id = pick(p, F.REPEAT); if (id && !dynamic()) { const r = REPEAT_NEXT[st(id).attributes.repeat || 'off'] || 'off'; go('repeat_set', F.REPEAT, ctx, { repeat: r }, { attr: 'repeat', value: r }); } }
      if (a === 'mute') { const id = pick(p, F.VOLUME_MUTE); if (id) { const m = !st(id).attributes.is_volume_muted; go('volume_mute', F.VOLUME_MUTE, ctx, { is_volume_muted: m }, { attr: 'is_volume_muted', value: m }, true); } }
      if (a === 'vdown') go('volume_down', F.VOLUME_STEP, ctx, undefined, undefined, true);
      if (a === 'vup') go('volume_up', F.VOLUME_STEP, ctx, undefined, undefined, true);
    },
    // Shown at once; the queue itself stays core/ma.js's, which keeps the change over what MA sends until MA has taken it
    // (or refused: then it is gone again).
    toggle(k) {
      if (!qid || !data) return;
      const key = k + '_enabled', v = !(data.queue || {})[key];
      MA.edit(qid, { set: { [key]: v } }, MA.cmd('player_queues/' + k, { queue_id: qid, [key]: v })).catch(() => {});
    },
    itemAct(a, it) {
      if (!qid || !it) return;
      const id = it.queue_item_id, c = { play: ['player_queues/play_index', { index: id }], next: ['player_queues/move_item', { queue_item_id: id, pos_shift: 0 }],
        end: ['player_queues/move_item_end', { queue_item_id: id }], del: ['player_queues/delete_item', { item_id_or_index: id }] }[a];
      if (!c) return;
      if (a === 'play') { const ix = MA.indexOf(data, id); S.skipTo(it, ix < 0 ? null : ix); }
      cmd(c[0], c[1], 'Music Assistant didn’t take that').catch(() => {});
    },
    // move a song `places` down (negative: up); the list moves now, MA's queue update confirms (or puts it back)
    shift(it, places) {
      if (!qid || !data || !places) return;
      const after = moveAfter(data.items || [], it.queue_item_id, places); if (after === undefined) return;
      MA.edit(qid, { move: it.queue_item_id, after }, cmd('player_queues/move_item', { queue_item_id: it.queue_item_id, pos_shift: places }, 'Music Assistant didn’t move that')).catch(() => {});
    },
    playMedia: (uri, option) => (qid ? MA.cmd('player_queues/play_media', { queue_id: qid, media: uri, option }).catch(() => toast('Music Assistant didn’t take that')) : Promise.resolve()),
    resume() {
      mine = null;
      if (p.group) quietMembers(ma);   // a speaker group: its rooms' own queues stop (core/sync.js)
      const it = currentOf(data); S.skipTo(it, it ? cur() : null);
      wake([{ entity: ma, name: p.name, player: p }]).then((ok) => { if (ok.length) call('media_player.media_play', {}, leaderOf(ma), () => toast(`${p.name} didn’t take it: Home Assistant refused`)); });
    },
    // The music and its queue play on exactly these rooms from now on (W: core/where.js, for names and what is a speaker
    // group). Several rooms play in sync, led by one of them; which actions that takes, and in which order: core/sync.js movePlan.
    moveTo(dests, W, playerFor) {
      const src = maLive(p), q = src && st(src).attributes.active_queue;
      if (!src || !q || !dests.length) return false;
      const cur = membersOf(src);
      if (dests.length === cur.length && dests.every((e) => cur.includes(e))) return false;   // it plays on exactly these already
      const what = (() => { const n = now(p); return n ? [n.title, n.artist].filter(Boolean).join(' – ') : ''; })();
      // the rooms new to it say so on their cards until they play; TVs among them that are off are turned on first (core/wake.js)
      const rooms = bring(dests.filter((e) => !cur.includes(e)).map((e) => ({ entity: e, name: W.nameOf(e), player: playerFor(e) })), 'Moving the music here…', what);
      rooms.ready.then(async (ok) => {
        const list = dests.filter((e) => cur.includes(e) || ok.includes(e)); if (!list.length) return;
        try {
          await Promise.all(list.filter((e) => W.isGroup(e)).map((g) => quietMembers(g, cur)));   // a speaker group: its rooms' own queues stop, not the one moving there (core/sync.js)
          await carryOut(movePlan(cur, list));
          toast((list.length === 1 && !cur.includes(list[0]) ? 'Music moved to ' : 'Playing on ') + W.label(list));
        } catch (e) { rooms.clear(); toast(`${W.label(dests)} didn’t take it: Music Assistant couldn’t play it there`); }
      });
      return true;
    },
    leave() {
      const src = maLive(p), cur = src ? membersOf(src) : [];
      if (cur.length < 2) return;
      // The music ends in this room: once its player is quiet nothing of it is held here, and what its queue says on the
      // way (handed to the next room, emptied) is no song change.
      S.ending();
      carryOut(leavePlan(src, cur)).then(() => toast(`${p.name} left the group`),
        () => { mine = null; toast(cur[0] !== src ? `${p.name} is still playing: Home Assistant refused` : 'Music Assistant couldn’t carry on without this room'); }).then(changed);
    },
  };
  return S;
}
