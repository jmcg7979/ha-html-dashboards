// Starting music on rooms: the Music page's Play on … / Play next / Add to queue (cards/music.js). One room, or several in
// sync (core/sync.js): a room that already leads others stays the leader, else the first one picked leads. TVs that are
// off are turned on first, and each room's card says "Starting the music…" until it plays (core/wake.js bring); the page
// is told how it went in a toast, and on every way out that fails the rooms stop saying so. "It hasn't started" is said
// only START_LIMIT after Music Assistant answered the play: it answers once it has every song, which for a long playlist
// can take longer than that by itself (core/wake.js answering).
//   playOn(entities, act, item, { W, playerOf, what, how }) -> Promise
//     entities   the MA entities picked           act   'play' | 'next' | 'add'
//     item       MA's item: { uri, media_type }
//     W          core/where.js over the targets (names, which is a speaker group)
//     playerOf   (entity) => the home.js player behind it, or null (a TV has a `power` to turn on)
//     what       what is coming, in words ("Dreamers – Night Bus"), for the rooms' cards
//     how        { start: a song's uri (a playlist from that song), shuffle: true }: both go to MA's own play_media,
//                which takes them (HA's music_assistant.play_media takes neither)
// Playing goes through HA otherwise (music_assistant.play_media), so it works the same everywhere.
// Music that already plays moves with its queue through its session instead (core/session.js moveTo).
import { call } from './ha.js';
import { toast } from './toast.js';
import * as MA from './ma.js';
import { bring, whenPlaying, answering } from './wake.js';
import { membersOf, leaderOf, group, quietMembers } from './sync.js';
import { START_LIMIT, START_SAYS, SAYS_LONG } from './music-timing.js';

export function playOn(entities, act, it, { W, playerOf, what = '', how = {} }) {
  const enqueue = { play: it.media_type === 'track' ? 'play' : 'replace', next: 'next', add: 'add' }[act];
  const label = () => W.label(entities);
  const rooms = bring(entities.map((e) => ({ entity: e, name: W.nameOf(e), player: playerOf(e) })), act === 'play' ? 'Starting the music…' : null, what);
  let over = false;   // it failed and said so: the wait for "it plays" has nothing more to say
  const failed = (text) => { over = true; rooms.clear(); toast(text); };
  // Play now: "Starting on …" stays until the player reports playing (Music Assistant collects the songs first, and a
  // TV's Cast app can take a few seconds to start), so nobody taps again and restarts it; Play next / Add to queue change
  // nothing visible, so they just say so
  const done = () => {
    if (act !== 'play') { toast(`${act === 'next' ? 'Playing next' : 'Added to the queue'} on ${label()}`); return; }
    toast(`Starting on ${label()}…`, START_SAYS);
    whenPlaying(entities[0], START_LIMIT, () => over).then((ok) => { if (ok) toast(`Playing on ${label()}`); else if (!over) { rooms.clear(); toast(`${label()} hasn’t started playing. Check the TV, or try again.`, SAYS_LONG); } });
  };
  // -> Promise, settled when the play has its answer (or never went): the rooms' limits count from then
  const send = (to) => {
    if (act === 'play' && (how.start || how.shuffle)) {
      return MA.playerId(to).then((qid) => {
        if (!qid) throw new Error('not an MA player');
        const a = { queue_id: qid, media: it.uri, option: 'replace' };
        if (how.start) a.start_item = how.start;
        if (how.shuffle) a.shuffle = true;
        const sent = MA.cmd('player_queues/play_media', a); done(); return sent;
      })
        // a playlist so long that even the relay stopped waiting for MA's answer: that is no refusal (Starting… still
        // watches the player)
        .catch((e) => { if (/didn.t answer/i.test(String(e && e.message))) return; console.error(e); failed(`${label()} didn’t take it: Music Assistant refused the play`); });
    }
    return new Promise((res) => {
      // HA refusing it (the player went away) says so, not nothing
      const sent = call('music_assistant.play_media', { media_id: it.uri, media_type: it.media_type, enqueue }, to, () => { failed(`${label()} didn’t take it: Home Assistant refused the play`); res(); }, res);
      if (sent) done(); else { failed('Not connected to Home Assistant'); res(); }
    });
  };
  const play = (to) => answering(entities, send(to));
  return rooms.ready.then((ok) => {
    if (!ok.length) return;   // (a TV that didn't come on: core/wake.js said so)
    entities = ok;
    // Play next / Add to queue on one room: its queue, which is its leader's when it plays in sync with others
    if (act !== 'play' && entities.length === 1) { play(leaderOf(entities[0])); return; }
    // Play now: on exactly these rooms. A room that already leads others stays the leader (its followers that are
    // picked keep playing along); rooms that aren't picked leave, the picked ones join (core/sync.js)
    const lead = entities.find((e) => membersOf(e).length > 1 && leaderOf(e) === e) || entities[0];
    // a speaker group: its rooms' own queues (a TV's Sendspin app) stop first, or they would play beside it
    const quiet = () => Promise.all(entities.filter((e) => W.isGroup(e)).map((g) => quietMembers(g)));
    return quiet().then(() => group(lead, entities.filter((e) => e !== lead))).then(() => play(lead), () => failed('Music Assistant couldn’t play on those rooms together'));
  }).catch((e) => { console.error(e); failed(`Couldn’t start the music on ${label()}`); });   // a mistake of ours says so, not nothing
}
