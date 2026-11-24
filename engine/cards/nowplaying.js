// Music playing on this screen's player: full-screen "Now playing" (TV) or a slim bar that leads to it.
// { type: 'nowplaying', player: { entity, ma, power, spotify, name },   a `players` entry from home.js (core/players.js decides
//   mode: 'full' | 'bar',                                               what really plays here: stale Spotify sessions, MA mirrors)
//   view: 'now',        bar: OK opens this view
//   wake: 'media_player.x',  with auto: the launcher brings the view up, out of the screensaver or from behind an app, when this
//                       entity (a Music Assistant player) starts playing its own queue: the page is stopped there, so it can't ask for itself (a player app that shows
//                       nothing, or a cast screen that came up meanwhile and would stay in front)
//   auto: 'now',        open this view when music starts on the player (TV: casting music to it); on a TV the launcher also
//                       brings this screen up over Music Assistant's own cast screen (tvhost.cover), unless cover: false
//   idle: '…',          full: what it says with nothing playing (cards/media-detail.js) }
//   targets, playerFor, back: 'home',    full: Play on (the Music page's picker; the TV goes to `back` once the music has left)
//   party: true | { when: entity }       full: the code of MA's Party in the bottom bar while this music is the party's (cards/media-detail.js) }
// Music = an MA queue, media_content_type music, or an app that only plays music (players.js isMusic). Video never counts.
// Full is the player every large screen shows (cards/media-detail.js, as a page: this screen's own music, no volume, power
// or Remote), so the TV, the panel and a computer look and behave the same.
import { h, icon, setText, toggle } from '../core/dom.js';
import { st } from '../core/store.js';
import { maOf, artUrl } from '../core/players.js';
import { session } from '../core/session.js';
import { cover, keepAwake, show, watch as hostWatch } from '../core/tvhost.js';
import { onDispose } from '../core/scope.js';
import mediaDetail from './media-detail.js';

// the music that plays on a player, as its session smooths it through song changes (held / starting while MA flips and
// the Cast restarts), or null: a video, a stopped queue, nothing
export const musicOn = (p) => (p ? session(p).snap.musicOn : null);

export default function nowplaying(cfg, ctx) {
  const P = cfg.player;
  if (cfg.mode === 'bar') return barCard(cfg, P, ctx);
  return P ? mediaDetail({ ...cfg, page: true }) : h('<div class="mdet idle"><div class="midle"><span>Nothing playing on this TV.</span></div></div>');
}

function barCard(cfg, P, ctx) {
  const el = h(`<button class="npb"><span class="npbart"><img alt=""></span><span class="npbtx"><span class="label caption">Now playing</span><b></b><small></small></span><span class="npbgo">${icon('chevron-right')}</span></button>`);
  const img = el.querySelector('img');
  let was = null, covering = '', awakeNow = false;   // was: null until the first state, so a page opened mid-song stays where it is
  // wake: the launcher itself watches this entity and brings `auto` up when it starts playing. The page can't be relied on
  // behind the screensaver or another app: it is stopped there, so it neither hears the music start (a player app that
  // shows nothing: Sendspin) nor asks to cover a cast screen that came up meanwhile.
  // has: only Music Assistant's own music. Its player mirrors the TV's Cast and says "playing" for a YouTube video too,
  // without an active_queue (maLive in core/players.js is the same rule): that pulled this screen over the video.
  // (and the MA player of the TV's Cast side, castMa: a speaker group plays the TV through that, core/players.js groupNow)
  // play: the player app behind `wake` (the player's maApp). The launcher sends it a Play key when the music starts: after
  // another app took the sound for good (a video in YouTube) the app plays its server's music muted until Play is asked
  // on the TV itself, while Music Assistant shows the queue playing (seen with SendSpin Player, 2026-11-17).
  if (cfg.auto && cfg.wake) hostWatch([cfg.wake, P && P.castMa].filter(Boolean).map((entity) => ({ entity, state: 'playing', has: 'active_queue', view: cfg.auto, ...(entity === cfg.wake && P && P.maApp ? { play: P.maApp } : {}) })), 'music');
  const S = P ? session(P) : null;
  // Nothing is known of the player until its entities have come: a page that starts on another view builds this bar
  // unseen, before they have. Music that is already playing then is not music starting (the page stays where it is).
  const known = () => !P || !!st(maOf(P)) || !!st(P.entity);
  const update = () => {
    if (!known()) return;
    const cur = musicOn(P), live = S ? S.snap.live : null;
    if (ctx && ctx.setVisible) ctx.setVisible(!!cur);
    // Music Assistant's music started on this TV: go to the full screen (only on a real start, not when the page loads
    // mid-song). An app playing its own music (Spotify opened on the TV) has its own screen and keeps it.
    if (cfg.auto && cur && cur.state === 'playing' && was === false && live) { window.dispatchEvent(new CustomEvent('dash:view', { detail: cfg.auto })); show(cfg.auto); }   // show: out of the screensaver too
    was = !!cur && (cur.state === 'playing' || !!cur.held);
    // Music Assistant's cast screen on this TV (its own Cast app, or "Sendspin over Cast" when the TV plays in sync with
    // other rooms): the launcher puts this screen over it, on the full view
    const castMA = !!cur && !!live && /music assistant|sendspin over cast/i.test(((st(P.entity) || {}).attributes || {}).app_name || '');
    const want = cfg.auto && cfg.cover !== false && castMA ? cfg.auto : '';   // cover: false = leave MA's cast screen in front (a 2 GB TV can't hold both: Android kills the hidden Cast app)
    if (want !== covering) { covering = want; cover(want); }
    // music playing on this TV: no screensaver while our screen is in front (Google TV only counts remote presses)
    const awake = !!cfg.auto && !!cur && (cur.state === 'playing' || !!cur.held);
    if (awake !== awakeNow) { awakeNow = awake; keepAwake(awake); }
    toggle(el, 'idle', !cur);
    if (!cur) return;
    const src = artUrl(cur.pic); if (src && img.getAttribute('src') !== src) img.src = src; img.style.visibility = src ? '' : 'hidden';
    setText(el.querySelector('b'), cur.title);
    setText(el.querySelector('small'), cur.artist);
  };
  // the session follows the player and MA's queue (a song change shows the same on every screen) and says when either changes
  if (S) onDispose(S.on(update));
  update();
  // the bar goes (its view is unloaded): what it asked of the launcher goes with it
  onDispose(() => { if (covering) cover(''); if (awakeNow) keepAwake(false); if (cfg.auto && cfg.wake) hostWatch([], 'music'); });
  el.addEventListener('click', () => { if (cfg.view) window.dispatchEvent(new CustomEvent('dash:view', { detail: cfg.view })); });
  return el;
}

