// Music: find something to play first, then choose where it plays. One card per tab of the Music page (this file is the
// card: its frame, the sheet and the playlist page over it, what a press on an item does; each tab and each part is a file
// of cards/music/):
// { type: 'music', tab: 'foryou' | 'moods' | 'dj' | 'search' | 'rooms' | 'party' | 'videos',
//   here: 'media_player.x_ma',                       this screen's own Music Assistant player: the default "where"
//   targets: [{ entity, name, icon }],               where music can play (MA players and groups; H.playTargets)
//   player: (entity) => player | null,              Rooms: the home.js player behind an MA entity (a TV): what's on comes from
//                                                    core/players.js, as in its pop-up (MA alone keeps a TV's last song as paused)
//   popup: (entity) => 'media-x' | null,             Rooms: the pop-up OK opens for a player (the panel's media pop-up)
//   now: 'now',                                      Rooms on a TV: the view OK opens for the TV itself (its Now playing), not a pop-up
//   moods / dj: [{ name, q, icon }],                 the tiles of those tabs (defaults below; a site can give its own)
//   videos: [{ name, q, icon }] }                    TV only: YouTube searches opened in the YouTube app
// Browsing goes through Music Assistant's API (core/ma.js: through HA's relay on every screen).
// Playing goes through HA (music_assistant.play_media), so it works the same everywhere.
// OK on a playlist opens its page: its songs, with Play, Shuffle and Pin; OK on a song there plays the playlist from it.
// OK on anything else opens the sheet: where (the rooms used last lit; tap rooms to add or drop them) and how (Play on … /
// Play next / Add to queue; playlists also Pin). Hold OK on a playlist pins or unpins it (MA favorites, so every screen shares the pins).
// Results (Moods, DJ sets, Search) come from each service apart, 25 at first, more as the list is scrolled (up to 100 a
// service; the 100 asked once the list is scrolled past its first page), each page most liked first (core/rank.js; the numbers from the relay's ma_relay/ratings) or as the services
// matched them (the Sort chip; kept on this screen).
import { h, icon } from '../core/dom.js';
import { run } from '../core/actions.js';
import { playOn } from '../core/play.js';
import { where as whereOf } from '../core/where.js';
import { who, itemOf, pin } from './music/items.js';
import { playSheet } from './music/sheet.js';
import { playlistPage } from './music/playlist.js';
import foryou from './music/foryou.js';
import { moods, dj } from './music/moods.js';
import search from './music/search.js';
import rooms from './music/rooms.js';
import party from './music/party.js';
import videos from './music/videos.js';

const TABS = { foryou, moods, dj, search, rooms, party, videos };

export default function music(cfg) {
  const tab = cfg.tab || 'foryou';
  const targets = cfg.targets || [];
  const el = h(`<div class="music m-${tab}"><div class="mbody"></div>
    <div class="mpl" hidden><button class="mclose" aria-label="Close">${icon('close')}</button><div class="mplhead"></div>
      <div class="mplbar"><button class="mact prim" data-pa="play">${icon('play')}<span>Play</span></button><button class="mact" data-pa="shuffle">${icon('shuffle-variant')}<span>Shuffle</span></button><button class="mact" data-pa="pin"></button></div>
      <div class="mlist mpltr" data-enter=".mrow"></div></div>
    <div class="msheet" hidden><button class="mclose" aria-label="Close">${icon('close')}</button><div class="mshead"></div>
      <div class="mswho"></div><div class="msbar"></div></div></div>`);
  const body = el.querySelector('.mbody'), sheet = el.querySelector('.msheet'), plist = el.querySelector('.mpl');
  const own = cfg.here && targets.find((t) => t.entity === cfg.here) ? cfg.here : '';   // this screen's player; a phone has none
  const here = own || (targets[0] || {}).entity;   // the default "where"
  const nameOf = (e) => ((targets.find((t) => t.entity === e) || {}).name || '');

  // ---- where music plays: the shared picker (core/where.js) ----
  const playerOf = (t) => (cfg.player && cfg.player(t.entity)) || null;
  const W = whereOf({ targets, playerOf, own });
  W.watch(() => W.update(el));

  // Play on … / Play next / Add to queue: core/play.js (TVs that are off are turned on first, several rooms play in sync)
  const play = (entities, act, it, how) => playOn(entities, act, it, { W, playerOf: (e) => playerOf({ entity: e }), what: [it.name, who(it)].filter(Boolean).join(' – '), how });

  const { open: openSheet } = playSheet({ el: sheet, W, targets, here, play });
  const { open: openList } = playlistPage({ el: plist, openSheet });

  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('.mbody [data-k]'); if (!b) return;
    const it = itemOf(b.dataset.k); if (!it) return;
    if (it.media_type === 'playlist') openList(it, b); else openSheet(it, b);
  });
  el.addEventListener('dash:hold', (ev) => {   // hold OK on a playlist: pin / unpin it (core/remote.js sends dash:hold to [data-hold])
    const b = ev.target.closest && ev.target.closest('[data-k]'); const it = b && itemOf(b.dataset.k);
    if (it && it.media_type === 'playlist') {   // the pin shows at once, and goes back if MA refuses
      const mark = (on) => { const p = b.querySelector('.mpin'); if (on && !p) b.insertAdjacentHTML('beforeend', `<i class="mpin">${icon('pin')}</i>`); else if (!on && p) p.remove(); };
      const done = pin(it); mark(it.favorite); done.then((on) => { if (b.isConnected) mark(on); });
    }
  }, true);

  // Rooms: OK on a room opens its pop-up; a TV's own tile opens the TV's Now playing
  const openRoom = (e, ctx) => {
    const id = cfg.popup && cfg.popup(e);
    if (own && e === own && (cfg.now || !id)) window.dispatchEvent(new CustomEvent('dash:view', { detail: cfg.now || 'now' }));
    else if (id) run({ nav: '#' + id }, ctx);
  };
  // each tab gets the card's frame and what it needs of the card's options (which are all read here)
  (TABS[tab] || foryou)({ el, body, W, targets, own, here, playerOf, nameOf, openRoom, moods: cfg.moods, dj: cfg.dj, videos: cfg.videos });
  return el;
}
