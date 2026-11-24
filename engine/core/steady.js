// What a screen shows while a song changes. Music Assistant 2.10.9 shows the new title at once, flips back to the old song
// ~1.4 s later and forward again (music-assistant/support#7060), and on Chromecast the audio starts 4-6 s after the title,
// passing through idle (#6756). These rules smooth that for every screen of a player (its pop-up, its header, the TV):
//  - after our own Next / Previous / Play now (beginSkip): the song it's going to, `starting`, until the player has gone round
//    to playing on that song and the sound is back (Cast stopped, then played a steady second; a Cast that never stopped, or
//    wasn't playing: 2 s of playing; without Cast: 0.8 s of playing, 1.2 s after the press at the earliest); 20 s at most;
//  - a change this screen didn't make (beginSkip with soft: true, from MA's queue saying its current song changed:
//    core/session.js): the new song at once. If the player keeps playing (the next song of the queue, a crossfade) that's
//    all; if it stops within 4 s (someone pressed Next elsewhere) it goes on like our own skip, `starting` and all;
//  - our own Stop (noteStop): once the player is quiet nothing is held, the music has ended;
//  - otherwise: the last song while the player is idle / buffering (8 s at most); a new title once it has held 1.5 s.
// How long each of those waits is: core/music-timing.js.
// The rules are steadyStep(memo, what the entities say, the time): nothing else is read, so recorded song changes can be
// replayed through it (engine/_dev/test/music-steady.test.mjs). The memo is one player's, kept by its session
// (core/session.js), the only thing that takes a step: what it shows is the session's snapshot, the same for every card.
//   fresh() -> a memo with nothing in it
//   steadyStep(memo, obs, t) -> { memo, show }   obs: core/players.js observe(p); show: now(p) as is when settled, else a
//       copy with held: true (target: true when it shows the song a skip is going to, starting: true while that song isn't
//       heard yet); `unsettled` asks for another look soon
//   beginSkip(memo, target, t)   skipTarget(memo, target)   retarget(memo, target)   noteStop(memo, t): these change the memo given
import { SOFT_ARMED, CAST_BACK, CAST_NO_STOP, CAST_WAS_IDLE, PLAYING_FOR, DIRECT_AGE, DIRECT_PLAYING, SKIP_GIVES_UP, HOLD, TITLE_HOLDS } from './music-timing.js';

export const fresh = () => ({ last: null, at: 0, cand: null, skip: null, stop: 0 });
// a skip begins: target = { title, artist, pic, uri, qid, index, from, soft } as far as known
export function beginSkip(m, target, t) { m.skip = { t0: t, sawStop: false, okSince: 0, ...target }; m.stop = 0; }
// MA announces the new song in its queue at once (current_index, ~0.1 s after Next): a skip that didn't know where it was going
// (Previous) takes its title / artist / art from there
export function skipTarget(m, target) { const sk = m.skip; if (sk && !sk.title && target && target.title) Object.assign(sk, target); }
// MA's queue says the song is another one than the skip is showing (presses it dropped, a change from elsewhere): the queue is right
export function retarget(m, target) { const sk = m.skip; if (sk && target && target.title) Object.assign(sk, target); }
// Our own Stop (or the TV turned off from here): when the player goes quiet next, within the time a song change may take,
// that is the end of the music. A skip under way ends with it.
export function noteStop(m, t) { m.stop = t; m.skip = null; m.cand = null; }
// a player that is off with nothing left playing: the music has ended, whoever ended it; no last song is held
export function ended(m) { m.last = null; m.cand = null; m.skip = null; }
// One look at the player: (the memo so far, observe(p), the time in ms) -> { memo, show }. The memo given is not changed.
export function steadyStep(m0, obs, t) {
  const m = { ...m0, skip: m0.skip ? { ...m0.skip } : null }, n = obs.n, playing = !!n && n.state === 'playing';
  const out = (show) => ({ memo: m, show });
  if (m.skip) {
    // on the song: MA's HA entity names it as the queue does (uri), or by title (the entity adds the version: "One More Time (Radio Edit)")
    const s = m.skip, age = t - s.t0, onIt = !s.title || (!!n && (n.title === s.title || (!!s.uri && n.a.media_content_id === s.uri)));
    if (!playing) { s.sawStop = true; s.okSince = 0; } else if (!s.okSince) s.okSince = t;
    // The Cast entity is the nearest thing to the sound (seen on a speaker): MA's own entity often stays "playing" right
    // through a skip, while Cast goes idle ~2 s after it, blips playing for up to 0.7 s while it buffers, and plays for
    // good ~4 s after the press. So when Cast was playing at the skip: it must have stopped, then played for a steady second.
    const cplay = !!obs.cplay;
    if (s.c0 === undefined) { s.cast = !!obs.castMA; s.c0 = s.cast && cplay; }
    if (s.c0) { if (!cplay) { s.cStop = true; s.cOk = 0; s.sawStop = true; } else if (s.cStop && !s.cOk) s.cOk = t; }
    const quiet = !!s.soft && !s.sawStop;   // a change from elsewhere that hasn't interrupted the sound
    if (quiet && playing && onIt && age < SOFT_ARMED) { m.last = n; m.at = t; m.cand = null; return out(n); }   // it may still stop: the skip stays armed
    const heard = s.cStop ? cplay && !!s.cOk && t - s.cOk >= CAST_BACK   // Cast stopped and is back
      : s.cast || s.sawStop ? (s.sawStop || age > (s.c0 ? CAST_NO_STOP : CAST_WAS_IDLE)) && t - s.okSince >= PLAYING_FOR   // Cast that never stopped, or wasn't playing
      : age > DIRECT_AGE && t - s.okSince >= DIRECT_PLAYING;   // not Cast (Sendspin; seen in HA's history of a Sendspin TV)
    const settled = !quiet && playing && onIt && heard;
    if (!settled && age < (quiet ? SOFT_ARMED : SKIP_GIVES_UP)) {
      // what the song it is going to is drawn over: the last song, else what plays; never a TV's home screen (a queue
      // resumed on a TV that was sitting there: the song is no screen, and has an app's name for nothing)
      const base = m.last || (n && !n.screen ? n : null) || { a: {}, state: 'buffering' };
      return out({ ...base, title: s.title || base.title, artist: s.title ? s.artist : base.artist, album: s.title ? '' : base.album, pic: s.pic || base.pic, state: quiet ? base.state : 'buffering', held: true, target: true, starting: !quiet, unsettled: true });
    }
    m.skip = null; m.cand = null;
    if (n) { m.last = n; m.at = t; }
    return out(n);
  }
  if (n && !n.screen) {
    if (m.last && n.title !== m.last.title && t - m.at < HOLD) {
      if (!m.cand || m.cand.title !== n.title) m.cand = { title: n.title, at: t };
      if (t - m.cand.at < TITLE_HOLDS || !playing) return out({ ...m.last, held: true, unsettled: true });
    }
    m.cand = null;
    if (playing || n.state === 'paused') { m.last = n; m.at = t; }
    else if (m.last && t - m.at < HOLD) return out({ ...m.last, held: true, unsettled: true });   // buffering / idle between songs
    return out(n);
  }
  if (m.stop) { const ours = t - m.stop < HOLD; m.stop = 0; if (ours) { m.last = null; m.cand = null; return out(n); } }
  if (m.last && t - m.at < HOLD) return out({ ...m.last, held: true, unsettled: true });
  m.last = null; return out(n);
}
