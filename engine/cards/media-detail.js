// The player: one look on every large screen (a TV's Now playing, the panel's and a computer's media pop-up), stacked on phones.
// { type: 'media-detail', player: { entity, name, power, remote, ma, apps }, targets: [{ entity, name, icon }], apps: [{ name, pkg }],
//   follow: (target entity) => 'media-x' | null,    Play on: the pop-up to open for where the music went (none: this one closes)
//   playerFor: (target entity) => player | null,    Play on: the home.js player behind a target, so a TV that's off is turned on first
//   page: true, back: 'home' }                      a TV's own Now playing (cards/nowplaying.js): fills the page, music only, no
//                                                   volume / power / Remote (the TV's remote has them); Stop is beside Rooms
//                                                   (no key of the remote stops the music); Play on then shows `back`.
//                                                   While its music plays in several rooms it has the group's row all the same:
//                                                   All rooms' volume and mute, Leave group (no remote does those)
//   idle: 'Nothing playing on the phone'              what it says with nothing playing, in place of its own words
//   volume: true                                      a page with the volume row all the same (a screen with no remote of its own)
//   sources: true                                     a pill per other source of the player (HA's source_list): a tap plays that one
//   party: true | { when: 'input_boolean.x', follows: true }   large screens: the code of Music Assistant's Party at the right end of the
//                                                     bottom bar while this music is the party's (guest access on, the party's
//                                                     player among its rooms), so guests add songs without the Music page;
//                                                     `when`: only while that entity is on; `follows`: the party comes to
//                                                     the music, so every card of it has the code (media-detail/party.js)
// Large screens (.wide): the artwork and the song on the left over a blurred wash of the art; on the right one panel, picked in
// the bottom row by one button that names the panel it goes to next: Up next (core/queue-ui.js), Lyrics (core/lyrics-ui.js) or,
// for a TV's pop-up, the Remote (d-pad, keys, apps); along the bottom the progress (tap to seek), shuffle / previous /
// play-pause / next / repeat, the Autoplay and Crossfade switches as two small buttons beside them, the panel button and
// Rooms; a pop-up adds volume and Stop under them (a TV's also Turn off TV: a speaker has nothing to turn off). With `party` the party's code stands at the right end of that bar.
// Phones: art on top, the controls under it; Queue, Lyrics and Rooms open over the card.
// One card for the music, wherever it plays: the song, the queue, lyrics, the switches and the transport are
// the session's, the same from any of its rooms (core/sync.js). Rooms (over the card; the Music page's picker, core/where.js)
// is what differs per room: the rooms it plays on are lit, each with its own volume under it; a tap takes a room out or adds
// one at once (a room that can't play in sync, or a speaker group, takes a second tap: the music moves there); with several
// rooms an All rooms volume sits on top, and the card's own volume is that too (every room moves in proportion). The card
// and its pop-up are named after the rooms ("Kitchen + Living Room").
// Every control appears only if an active entity supports it (core/players.js picks Music Assistant, then Cast, then the TV
// remote). The player itself (song changes, the clock, the queue, what each button does) is core/session.js: the card draws
// its snapshot (S.snap) and reads nothing else of the player.
import { h, esc, icon, setText, setHTML, toggle, mmss } from '../core/dom.js';
import { st, watch, tick, soon, tapStart } from '../core/store.js';
import { call } from '../core/ha.js';
import { run } from '../core/actions.js';
import { close as closePopup } from '../core/popup.js';
import { layer } from '../core/layers.js';
import { where as whereOf } from '../core/where.js';
import { setVol, groupVol, setGroupVol, groupMuted, setGroupMuted, inSyncWith } from '../core/sync.js';
import { toast } from '../core/toast.js';
import { onDispose } from '../core/scope.js';
import { maOf, statusLine, artUrl, powerAction } from '../core/players.js';
import { session, titleOf, artistOf, repeatIcon } from '../core/session.js';
import { queueUI } from '../core/queue-ui.js';
import { lyricsUI } from '../core/lyrics-ui.js';
import * as MA from '../core/ma.js';
import { appLogo } from '../core/apps.js';
import { nudge } from '../core/spotify.js';
import { likeable, like, command } from '../core/bridge.js';
import { LEAVES_AFTER_MOVE, PROGRESS_EVERY, RESUME_TAKES } from '../core/music-timing.js';
import { backdrop } from './media-detail/backdrop.js';
import { partyCode } from './media-detail/party.js';
import { upNext } from './media-detail/upnext.js';
import { roomsLayer } from './media-detail/rooms.js';
import { tvRemote } from './media-detail/remote.js';
import { dragBar } from './media-detail/bar.js';
// what Music Assistant can't seek in (the item's content id): SoundCloud (the bar's click handler)
const NO_SEEK = /^soundcloud/i;

const btnI = (a, ic, label, cls = 'rbtn', more = '') => `<button class="${cls}" data-a="${a}" aria-label="${esc(label)}"${more}>${icon(ic)}</button>`;
const pill = (a, ic, text, cls = '') => `<button class="mpill ${cls}" data-a="${a}" hidden>${icon(ic)}<span>${text}</span></button>`;
const PANES = { queue: ['playlist-music', 'Up next'], upnext: ['playlist-music', 'Up next'], lyrics: ['microphone-variant', 'Lyrics'], remote: ['remote', 'Remote'] };
let lastPane = 'queue';   // the panel picked last (Up next / Lyrics / Remote), kept across songs and pop-ups

export default function mediaDetail(cfg) {
  const p = cfg.player, page = !!cfg.page, targets = cfg.targets || [], apps = p.apps || cfg.apps || [];
  const phone = document.documentElement.dataset.profile === 'phone';
  const wide = !phone && (page || innerWidth >= 900);   // a phone gets the stacked layout as a page too (css: .mdet.page:not(.wide))
  const stopInRow = page && !cfg.volume;   // a TV's own page has no row for volume and power: its Stop is beside Rooms, and stays there while the music plays in several rooms
  const playerFor = (e) => (cfg.playerFor ? cfg.playerFor(e) : null);
  const W = whereOf({ targets, playerOf: (t) => playerFor(t.entity), own: page ? maOf(p) : '' });
  const S = session(p), Q = queueUI(S, { backto: '.mpill.pane:not([hidden])' }), L = lyricsUI(S, { eager: page });
  const hasRemote = !!p.remote && !page, RM = hasRemote ? tvRemote({ p, apps, button: btnI }) : null;
  const mini = `<div class="mdqmini"></div>`, x = (a) => `<button class="mclose" data-a="${a}" aria-label="Close">${icon('close')}</button>`;
  const el = h(`<div class="mdet${wide ? ' wide' : ''}${page ? ' page' : ''}${page && cfg.volume ? ' pvol' : ''}${hasRemote ? '' : ' noside'}">
    <div class="mbg"><img alt=""><img class="mphoto" alt=""></div>
    <div class="mmain">
      <div class="mart"></div>
      <div class="mcol">
        <div class="mmeta"><div class="mapp"></div><div class="mtrack"></div><div class="martist"></div><div class="malbum"></div></div>
        <div class="mstarting" hidden><i class="tspin"></i><span>Starting…</span></div>
        <div class="mbot"><div class="mbotl">
          <div class="mprog"><div class="mbar"><i></i><b></b></div><div class="mtimes"><span class="mpos"></span><span class="mdur"></span></div></div>
          <div class="mrowb">
            <div class="mctl">${btnI('shuffle', 'shuffle-variant', 'Shuffle')}${btnI('prev', 'skip-previous', 'Previous')}${btnI('play', 'play', 'Play or pause', 'rbtn mplay', ' data-focus-first')}${btnI('next', 'skip-next', 'Next')}${btnI('repeat', 'repeat', 'Repeat')}${btnI('like', 'heart-outline', 'Like')}${btnI('autoplay', 'all-inclusive', 'Autoplay', 'rbtn msw')}${btnI('crossfade', 'transition', 'Crossfade', 'rbtn msw')}</div>
            <div class="mqrow">${pill('queue-open', 'playlist-music', 'Queue', 'pane')}${pill('upnext-open', 'playlist-music', 'Up next', 'pane')}${pill('lyrics-open', 'microphone-variant', 'Lyrics', 'pane')}${pill('pane-next', 'playlist-music', '', 'pane')}<span class="msrc"></span>${pill('move-open', 'speaker-multiple', 'Rooms')}${stopInRow ? pill('stop', 'stop', 'Stop') : ''}</div>
          </div>
          <div class="mrowc">
            <div class="mvol">${btnI('mute', 'volume-high', 'Mute')}${btnI('vdown', 'volume-minus', 'Volume down')}<div class="mvbar"><i></i></div>${btnI('vup', 'volume-plus', 'Volume up')}<span class="mvtxt"></span></div>
            <div class="mfoot">${p.power && !page ? `<button class="chip" data-a="power">${icon('power')}<span>Turn off TV</span></button>` : ''}${stopInRow ? '' : `<button class="chip" data-a="stop">${icon('stop')}<span>Stop</span></button>`}<button class="chip" data-a="leave" hidden>${icon('minus-circle-outline')}<span>Leave group</span></button></div>
          </div></div>
          <button class="mjoin" data-a="join-open" aria-label="The party's code, large, and how it works" hidden><span class="mjtx"><b>Add songs</b><small>Scan to join</small></span><span class="mjqr"></span></button>
        </div>
      </div>
    </div>
    ${RM ? RM.html : ''}
    <div class="mpend"><i class="tspin"></i><b></b><small></small></div>
    <div class="mdq mover" data-over="queue" hidden><div class="mdqtop">${mini}${btnI('play', 'play', 'Play or pause', 'rbtn mplay')}${btnI('next', 'skip-next', 'Next')}${x('over-close')}</div>
      <div class="mdqchips"><button class="chip" data-qt="autoplay">${icon('all-inclusive')}<span>Autoplay</span></button><button class="chip" data-qt="crossfade">${icon('transition')}<span>Crossfade</span></button><span class="mdqn"></span></div>
      <div class="mdqb"></div></div>
    <div class="mdq mover" data-over="lyrics" hidden><div class="mdqtop">${mini}${btnI('play', 'play', 'Play or pause', 'rbtn mplay')}${btnI('next', 'skip-next', 'Next')}${x('over-close')}</div>
      <div class="mdqb mdlb" data-backto=".mpill.pane:not([hidden])"></div></div>
    <div class="mdq mover" data-over="upnext" hidden><div class="mdqtop">${mini}${btnI('play', 'play', 'Play or pause', 'rbtn mplay')}${btnI('next', 'skip-next', 'Next')}${x('over-close')}</div>
      <div class="mdqb"><div class="pq"><div class="pqlist"></div></div></div></div>
    <div class="mdmove mover" data-over="move" hidden><div class="mdmhead"><span class="mtx"><b>Rooms</b><small data-note="on"></small></span>${x('over-close')}</div>
      <div class="mdmall vrow" data-vol="all" hidden><b>All rooms</b><button class="rbtn" data-vd aria-label="Volume down, all rooms">${icon('volume-minus')}</button><div class="mvbar"><i></i></div><button class="rbtn" data-vu aria-label="Volume up, all rooms">${icon('volume-plus')}</button><span class="mvtxt"></span></div>
      <div class="mpick"></div></div>
    <div class="mdjoin mover" data-over="join" hidden><button class="mjbig" data-a="over-close" aria-label="Close the code"></button>
      <div class="mjcap"><b>Scan to add songs</b><small></small><ul class="mjrules"></ul></div></div>
    <div class="midle">${icon(p.power ? 'television-off' : 'music-off')}<span>${esc(cfg.idle || (page ? 'Nothing playing on this TV.' : 'Nothing playing'))}</span>
      <div class="mresume" hidden><div class="mqi"><div class="mqa"></div><div class="mqt"><small>Stopped at</small><b></b><span></span></div></div>
        <button class="mqbig" data-a="resume" data-focus-first>${icon('play')}<span>Resume</span></button><button class="chip" data-a="queue-open">${icon('playlist-music')}<span>Queue</span></button></div>${p.power && !page ? `<button class="chip" data-a="power">${icon('power')}<span>Turn on TV</span></button>` : ''}</div>
  </div>`);
  const $ = (s) => el.querySelector(s), over = (k) => el.querySelector(`[data-over="${k}"]`);
  const btns = new Map(), btn = (a) => { let b = btns.get(a); if (!b) btns.set(a, (b = el.querySelector(`.mmain [data-a="${a}"]`))); return b; };   // the card's own buttons, looked up once each (a draw asks for most of them)
  over('queue').querySelector('.mdqb').appendChild(Q.el); over('lyrics').querySelector('.mdqb').appendChild(L.el);
  const art = $('.mart'), prog = $('.mprog'), bar = $('.mbar'), fill = $('.mbar i'), knob = $('.mbar b'), pos = $('.mpos'), dur = $('.mdur');
  const vol = $('.mvol'), vbar = $('.mvbar'), vfill = $('.mvbar i'), vtxt = $('.mvtxt'), side = $('.mside');
  let popup = null, lastVol = null;   // popup: the pop-up the card is in, once it is; lastVol: the player the volume went to last (none answers mid song change)

  // ---- the card's parts, each a file of cards/media-detail/ ----
  const B = backdrop({ el, page, moving: [art, $('.mmeta')] });
  const P = partyCode({ el, party: cfg.party, wide, shown: () => open, hide: () => hide() });
  const U = upNext({ list: over('upnext').querySelector('.pqlist'), p, redraw: () => draw() });

  // ---- song changes: the session smooths them for every screen of this player (core/steady.js). While one is under way the
  // card holds still: only the title (the song it's going to) and the progress row ("Starting…") change. ----
  let resumeUp = 0;    // when Resume last came up (it takes no press at once: RESUME_TAKES)
  let view = S.snap;   // what is drawn: the session's snapshot (a TV's own page: without a song that isn't music)
  const blank = wide ? '\u00a0' : '';   // large screens: the row keeps its height with no time to show (or the card jumps at every song change)
  const drawProgress = () => {
    const n = view.n; if (!n) return;
    if (n.bare) setText($('.martist'), statusLine(n));
    $('.mstarting').hidden = wide || !n.starting;
    if (n.held) {   // large screens say Starting… where the time is, over an empty bar
      prog.hidden = !wide; toggle(prog, 'starting', true);
      setText(pos, n.starting ? 'Starting…' : blank); setText(dur, ''); fill.style.width = '0'; toggle(bar, 'seek', false);
      return;
    }
    toggle(prog, 'starting', false);
    const d = +n.a.media_duration || 0, s = S.pos(n), show = d > 0 && s != null;
    prog.hidden = !show && !(wide && view.music); if (prog.hidden) return;
    const w = show ? (100 * Math.min(s, d) / d).toFixed(2) + '%' : '0'; fill.style.width = w; knob.style.left = w;
    setText(pos, s != null ? mmss(s) : blank); setText(dur, d ? mmss(d) : ''); toggle(bar, 'seek', show && !!view.caps.seek);
  };
  // a new song fades in (art, details, backdrop) rather than snapping in; the first draw doesn't fade
  let shownKey = null;
  const changes = (n) => shownKey !== null && (n.title || '') !== shownKey;
  // The song's art. A new song's picture is put in new (it fades in). Another address for the picture that is there (the
  // relay's while a skip is under way, Home Assistant's once the song has settled) goes to the same <img>, which shows
  // the one it has until the other is loaded: nothing blinks at the end of a song change.
  const artHTML = (url) => `<img alt="" src="${esc(url)}">`;
  function setArt(url, fresh) {
    const im = fresh ? null : art.firstElementChild;
    art.dataset.url = url;
    if (im && im.tagName === 'IMG' && !im.nextElementSibling) { if (im.getAttribute('src') !== url) im.src = url; art.__h = artHTML(url); }   // (__h: what setHTML last wrote, core/dom.js)
    else setHTML(art, artHTML(url));
  }
  function fadeOnChange(n) {
    const key = n.title || '';   // the title: MA's entity and its queue write the artists differently
    if (shownKey !== null && key !== shownKey) B.fade();
    shownKey = key;
  }

  // ---- the panel beside the art (large screens, while something plays): Up next, Lyrics or the Remote ----
  let shownPane;
  let upnext = [];   // Spotify's list for this draw
  const panes = () => { const d = !!view.data, live = !!view.live; return [d && 'queue', d && live && 'lyrics', upnext.length && 'upnext', hasRemote && 'remote'].filter(Boolean); };
  // ---- over the card: Play on always; the queue and the lyrics on phones, and the queue of a stopped player. One at a time;
  // its close button, or Back on a remote, closes it: while it is open it is a layer (core/layers.js), which keeps the
  // remote's highlight in it and puts it back where it was ----
  const plain = (k) => k === 'move' || k === 'join';   // layers with no mini player: Rooms, over the card on every screen; the party's code, in the panel's place
  let open = null, locked = null, lockWas = '';
  const layers = {}, layerOf = (k) => layers[k] || (layers[k] = layer({ el: over(k), kind: 'menu', close: () => { hide(); if (k === 'join') draw(); } }));   // (join: the panel comes back where the code was)
  function show(k) {
    hide(); open = k;
    if (k === 'move') R.opened();
    draw();
    if (open !== k) return;   // nothing to show after all (no queue yet)
    const o = over(k); o.hidden = false; layerOf(k).open(); el.classList.add('overed');
    // a card taller than the pop-up shows (a phone's sheet): the layer covers what is on screen, not the whole card, and the
    // sheet stays put under it, so the queue scrolls in view and the sung line sits where the eye is
    const sc = el.closest('.pbody') || el.closest('.popup');
    if (sc && k !== 'join') {
      sc.scrollTop = 0;
      const room = sc.getBoundingClientRect().bottom - el.getBoundingClientRect().top - 12;
      if (room > 200 && el.getBoundingClientRect().height > room + 8) { o.style.bottom = 'auto'; o.style.height = room + 'px'; locked = sc; lockWas = sc.style.overflowY; sc.style.overflowY = 'hidden'; }
    }
    if (k === 'queue') { Q.shown(); Q.focus(); }
    if (k === 'lyrics') L.show(true);
    if (k === 'move') { const f = o.querySelector('.mpk.on') || o.querySelector('.mpk'); if (f) f.focus({ preventScroll: true }); }
    if (k === 'join') o.querySelector('.mjbig').focus({ preventScroll: true });
  }
  function hide() {
    if (!open) return;
    const o = over(open);
    if (open === 'queue') Q.close(); if (open === 'lyrics') L.show(false);
    o.style.height = o.style.bottom = ''; if (locked) { locked.style.overflowY = lockWas; locked = null; }
    o.hidden = true; layerOf(open).shut();
    open = null; el.classList.remove('overed');
  }
  // ---- Rooms, over the card (media-detail/rooms.js). The music left this room: the card follows it to the other room's
  // pop-up, or goes (a TV's own page: back to `back`, whose status line shows what plays elsewhere) ----
  const goBack = () => window.dispatchEvent(new CustomEvent('dash:view', { detail: cfg.back || 'home' }));
  const R = roomsLayer({ o: over('move'), S, W, targets, playerFor, shown: () => open,
    left(e) { const to = e && cfg.follow && cfg.follow(e); hide(); setTimeout(() => { if (page) goBack(); else if (to) location.hash = '#' + to; else closePopup(); }, LEAVES_AFTER_MOVE); },
    moved() { hide(); if (page) setTimeout(goBack, LEAVES_AFTER_MOVE); } });

  function drawLayers(n) {
    const d = view.data, Qd = (d && d.queue) || {}, total = MA.totalOf(d), cur = view.cur, live = !!view.live;
    upnext = n ? U.items(view) : []; if (upnext.length) U.draw(view, upnext); else if (open === 'upnext') hide();
    const paned = wide && !!n, ps = paned ? panes() : [], pane = ps.includes(lastPane) ? lastPane : ps[0] || null;
    toggle(el, 'panes', paned);
    if (paned) {   // one panel in the side column
      if (open && !plain(open)) hide();
      const seen = open === 'join' ? null : pane;   // the party's code has the panel's place while it is open
      over('queue').hidden = seen !== 'queue'; over('lyrics').hidden = seen !== 'lyrics'; over('upnext').hidden = seen !== 'upnext';
      if (side) { side.hidden = false; toggle(side, 'behind', seen !== 'remote'); }   // behind: in the layout, unseen, so the pop-up is as tall with Up next or Lyrics as with the Remote (css)
      toggle(el, 'noside', !pane);
      if (pane !== shownPane) { shownPane = pane; if (pane === 'queue') Q.shown(); L.show(pane === 'lyrics'); }
    } else {
      if (shownPane) { shownPane = null; L.show(open === 'lyrics'); }
      over('queue').hidden = open !== 'queue'; over('lyrics').hidden = open !== 'lyrics'; over('upnext').hidden = open !== 'upnext'; if (side) { side.hidden = false; toggle(side, 'behind', false); }
      toggle(el, 'noside', !hasRemote);
      if (open === 'lyrics' && !(live && d)) hide();
    }
    // the bottom row: which panel (large screens, when there is a choice) or what opens over the card (phones); Play on; switches
    // large screens: one button for the panel, named after the one it goes to next (Up next <-> Lyrics; a TV's pop-up: then the Remote)
    const qb = btn('queue-open'), lb = btn('lyrics-open'), ub = btn('upnext-open'), pb = btn('pane-next');
    if (wide) {
      qb.hidden = lb.hidden = ub.hidden = true;
      const next = ps.length > 1 ? ps[(ps.indexOf(pane) + 1) % ps.length] : '';
      pb.hidden = !next;
      if (next && pb.dataset.k !== next) { pb.dataset.k = next; setHTML(pb, `${icon(PANES[next][0])}<span>${PANES[next][1]}</span>`); }
    } else {
      pb.hidden = true;
      if (!view.queueId) qb.hidden = true;
      else if (d) { qb.hidden = false; setText(qb.querySelector('span'), `Queue (${Math.min(cur + 1, total)}/${total})`); }   // a queue still loading keeps its button (no flicker)
      lb.hidden = !(live && d); ub.hidden = !upnext.length;
    }
    const spd = R.devices();
    btn('move-open').hidden = !((live && targets.length) || spd);   // Rooms: where an MA queue plays; a Spotify cast: the account's devices
    { const k = view.rooms.length; setText(btn('move-open').querySelector('span'), spd ? 'Play on' : k > 1 ? k + ' rooms' : 'Rooms'); toggle(btn('move-open'), 'on', !spd && k > 1); }
    if (open === 'move' && !spd && !live) hide();   // the Spotify cast ended while its devices were listed
    ['autoplay', 'crossfade'].forEach((k) => { const b = btn(k), on = !!Qd[k + '_enabled']; b.hidden = !(wide && live && d); toggle(b, 'on', on); b.setAttribute('aria-pressed', on); });
    if (d) { Q.draw(); L.draw(); }
    if (!open || plain(open)) return;
    // an open layer's mini player and switches
    const o = over(open), it = n ? null : view.item, pic = n ? artUrl(n.pic) : MA.image(it, 80);   // stopped: the song it stopped at
    setHTML(o.querySelector('.mdqmini'), `<span class="mqa">${pic ? `<img alt="" src="${esc(pic)}">` : icon('music')}</span><span class="mqt"><b>${esc(n ? n.title : titleOf(it))}</b><span>${esc(n ? [n.artist, n.album].filter(Boolean).join(' · ') : artistOf(it))}</span></span>`);
    setHTML(o.querySelector('.mplay'), icon(n && n.state === 'playing' ? 'pause' : 'play'));
    if (open !== 'queue') return;
    toggle(o.querySelector('[data-qt="autoplay"]'), 'on', !!Qd.autoplay_enabled); toggle(o.querySelector('[data-qt="crossfade"]'), 'on', !!Qd.crossfade_enabled);
    setText(o.querySelector('.mdqn'), `${Math.min(cur + 1, total)} of ${total}${Qd.shuffle_enabled ? ' · shuffled' : ''}`);
  }
  // our own Stop, MA's queue kept with its song, and nothing else really playing: where it stopped, Resume, the queue
  // (stopped some other way, or paused, the card shows the song paused: core/session.js view)
  function drawResume(stopped) {
    const r = $('.mresume'); if (stopped && r.hidden) resumeUp = Date.now();
    r.hidden = !stopped; if (!stopped) return;
    const it = view.item, d = view.data, total = MA.totalOf(d);
    setHTML(r.querySelector('.mqa'), it && MA.image(it, 80) ? `<img alt="" src="${esc(MA.image(it, 80))}">` : icon('music'));
    setText(r.querySelector('.mqt b'), it ? titleOf(it) : 'Music Assistant queue');
    setText(r.querySelector('.mqt span'), it ? artistOf(it) : '');
    setText(r.querySelector('[data-a="queue-open"] span'), d ? `Queue (${Math.min(view.cur + 1, total)}/${total})` : 'Queue');
  }

  const paint = () => {
    view = S.snap;
    if (page && view.n && !view.music) view = { ...view, n: null };   // a TV's Now playing is for music: a video app isn't shown
    const n = view.n, pd = view.pending;   // pd: music on its way here (core/wake.js): say so, not "Nothing playing"
    el.classList.toggle('pending', !!pd);
    P.draw(view);
    if (pd) { setText($('.mpend b'), pd.text); setText($('.mpend small'), pd.what || ''); }
    el.classList.toggle('idle', !n && !pd);
    const grouped = !!n && view.rooms.length > 1;   // it plays in several rooms: one card for the group, on its own page too
    toggle(el, 'grouped', page && grouped);
    el.classList.toggle('tvon', hasRemote && !!p.power && (st(p.power) || {}).state === 'on');
    drawLayers(n);
    const ip = $('.midle [data-a="power"] span'); if (ip) setText(ip, view.now ? 'Turn off TV' : 'Turn on TV');   // the button does what it says
    if (!n) { el.classList.remove('changing'); B.off(); if (open === 'move') hide(); drawResume(view.stopped); return; }
    const url = artUrl(n.pic);
    const brand = url ? null : n.brand;
    el.classList.toggle('changing', !!n.held); B.dim(!!n.held);
    const who = wide && view.music && !n.bare ? n.artist || '' : '';   // whose photo (large screens, music)
    if (n.held) {   // a song change under way: the song it's going to and "Starting…"; nothing else moves (buttons, app, volume)
      if (n.target) { const fresh = changes(n); if (fresh) B.ghosts(); fadeOnChange(n); setText($('.mtrack'), n.title);
        // large screens: the artist and album lines keep their place while the next song's aren't known yet, or everything
        // above and below them shifts by a line for the length of the change (a pop-up shrank, a TV's page dipped)
        const al = $('.malbum'); setText($('.martist'), n.artist || (wide ? '\u00a0' : ''));
        if (wide && !al.hidden) setText(al, '\u00a0'); else al.hidden = true;
        if (url && art.dataset.url !== url) { setArt(url, fresh); B.wash(url, null); }
        B.photo(who); }
      setHTML(btn('play'), icon('pause')); drawProgress();
      return;
    }
    const fresh = changes(n); if (fresh) B.ghosts();
    if (url) setArt(url, fresh);
    else { art.dataset.url = ''; setHTML(art, brand ? appLogo(brand) : `${icon(p.power ? 'television-play' : 'music')}${n.app || n.title ? `<span>${esc(n.app || n.title)}</span>` : ''}`); }
    toggle(art, 'branded', !!brand); if (brand) art.style.setProperty('--app', brand.color);
    B.wash(url, n.brand); B.photo(who);
    // a pop-up is named after the rooms the music plays on (its own name when that is only this one)
    popup = popup || el.closest('.popup');
    { const hn = popup && popup.querySelector('.phead .name'); if (hn) { if (hn.dataset.own === undefined) hn.dataset.own = hn.textContent; setText(hn, R.label(view) || hn.dataset.own); } }
    fadeOnChange(n);
    // in sync with other rooms (core/sync.js): say which; Stop then stops them all, Leave group takes only this room out
    const src = view.live, others = view.rooms.filter((e) => e !== src).map((e) => W.nameOf(e)).filter(Boolean);
    const sync = inSyncWith(others);
    const from = (st(p.entity) || { attributes: {} }).attributes.context;   // where the music comes from, when the player says (a playlist's name)
    const app = (wide ? ['Now playing', src ? 'Music Assistant' : n.app, from, sync] : [n.app, from, sync]).filter(Boolean).join(' · ');
    setText($('.mapp'), app); setText($('.mtrack'), n.title); setText($('.martist'), n.artist); setText($('.malbum'), n.album);
    $('.mapp').hidden = !app; $('.malbum').hidden = !n.album; $('.martist').hidden = !(n.artist || (n.bare && statusLine(n)));
    drawProgress();
    const caps = view.caps;   // which entity takes each control (core/session.js)
    btn('prev').hidden = n.bare || !caps.prev; btn('next').hidden = n.bare || !caps.next;
    btn('play').hidden = n.screen || !(n.stopped || caps.pause || caps.play);   // stopped: MA's queue kept with its song, Play resumes it
    setHTML(btn('play'), icon(n.state === 'on' ? 'play-pause' : n.state === 'playing' || n.starting ? 'pause' : 'play'));
    // shuffle / repeat: grayed out in a dynamic queue (an endless mix), as in MA: it refuses both
    const sh = caps.shuffle, rp = caps.repeat;
    btn('shuffle').hidden = !sh; if (sh) toggle(btn('shuffle'), 'on', !!st(sh).attributes.shuffle);
    btn('repeat').hidden = !rp;
    if (rp) { const r = st(rp).attributes.repeat || 'off'; toggle(btn('repeat'), 'on', r !== 'off'); setHTML(btn('repeat'), icon(repeatIcon(r))); }
    btn('shuffle').disabled = btn('repeat').disabled = view.dynamic;
    // like: a player that says whether the song is liked (attribute `liked`) and takes the answer (core/bridge.js)
    const pa = (st(p.entity) || { attributes: {} }).attributes, lk = !!n && likeable(pa);
    btn('like').hidden = !lk; if (lk) { toggle(btn('like'), 'on', !!pa.liked); setHTML(btn('like'), icon(pa.liked ? 'heart' : 'heart-outline')); }
    // the player's other sources (a phone's other music apps)
    const srcs = cfg.sources && n && caps.source === p.entity ? (pa.source_list || []).filter((x) => x !== pa.source) : [], sk = srcs.join('|'), sbox = $('.msrc');
    if (sbox.dataset.k !== sk) { sbox.dataset.k = sk; setHTML(sbox, srcs.map((x) => `<button class="mpill" data-a="source" data-src="${esc(x)}">${icon('play')}<span>${esc(x)}</span></button>`).join('')); }
    // the volume row: a pop-up's; a page's only with `volume`, or while its music plays in several rooms (a TV's remote has its own volume)
    if (!page || cfg.volume || grouped) {
      const vs = (lastVol = caps.volume || lastVol), vstep = caps.step, vm = caps.mute;
      vol.hidden = !(vs || vstep || vm) || (hasRemote && view.remoteOnly && !vs);   // the Remote has the TV's volume keys
      const grp = grouped ? view.rooms : null;   // several rooms: the card's volume is all of them (each room's own is under Rooms)
      // − and + beside the bar: a player that only takes steps, and a group (a remote can't drag the bar)
      const gm = grp ? groupMuted(grp) : null, muted = grp ? !!gm : !!vm && !!st(vm).attributes.is_volume_muted;   // several rooms: mute is all of them too
      vbar.hidden = !vs; vtxt.hidden = !vs; btn('vdown').hidden = btn('vup').hidden = grp ? !vs : !!vs || !vstep; btn('mute').hidden = grp ? gm == null : !vm;
      if (vs && !vbar.classList.contains('drag')) { const a = st(vs).attributes, v = grp ? groupVol(grp) : a.volume_level || 0; vfill.style.width = v * 100 + '%'; setText(vtxt, grp ? (muted ? 'All muted' : 'All ' + Math.round(v * 100) + '%') : muted ? 'Muted' : Math.round(v * 100) + '%'); }
      if (!btn('mute').hidden) { setHTML(btn('mute'), icon(muted ? 'volume-off' : 'volume-high')); toggle(btn('mute'), 'on', muted); }
    } else vol.hidden = true;
    btn('stop').hidden = !caps.stop || caps.stop === p.power || !!n.stopped;
    btn('leave').hidden = !grouped; setText(btn('stop').querySelector('span'), grouped ? 'Stop all' : 'Stop');
    if (open === 'move') R.draw(false);
    if (RM) RM.draw(el);
  };
  // A remote's highlight that sat on a button this draw took away (Stop, as the music stops; Resume, as it starts) goes
  // to what the card now starts on, not nowhere.
  const draw = () => {
    const had = document.documentElement.classList.contains('remote') && el.contains(document.activeElement) ? /** @type {HTMLElement} */ (document.activeElement) : null, was = el.classList.contains('idle');
    paint();
    if (!had || was === el.classList.contains('idle') || had.getClientRects().length) return;
    const to = [...el.querySelectorAll('[data-focus-first]')].find((x) => x.getClientRects().length);
    if (to) /** @type {HTMLElement} */ (to).focus({ preventScroll: true });
  };
  // the session says when the player changes; the card itself watches what else it shows: the TV's remote, the party's
  // switch, the other rooms. One draw for all that come together.
  const later = soon(draw);
  onDispose(S.on(later)); watch([p.remote, P.when].filter(Boolean), later); W.watch(later);
  new IntersectionObserver((en) => { if (en[en.length - 1].isIntersecting) draw(); }).observe(el);   // the first draw runs before the card is on screen
  if (wide) setInterval(() => { if (!document.hidden && el.isConnected && !el.classList.contains('idle')) drawProgress(); }, PROGRESS_EVERY);   // dropped with the view (core/scope.js)
  else tick(() => { if (el.isConnected && !el.classList.contains('idle')) drawProgress(); });

  el.addEventListener('click', (ev) => {
    if (R.click(ev) || (RM && RM.click(ev))) return;   // a room, a device, a room's volume; the TV remote's keys and apps
    const qt = ev.target.closest('[data-qt]'); if (qt) { S.toggle(qt.dataset.qt); return; }
    const qj = ev.target.closest('[data-qid]'); if (qj) { command(p.entity, { cmd: 'queue_item', id: +qj.dataset.qid }); return; }   // the player's own queue: a tap plays that song
    if (ev.target.closest('[data-over="join"]') || (open === 'join' && ev.target.closest('.mjoin'))) { hide(); draw(); return; }   // the large code: a tap on it, or on the small one again, closes it
    const b = ev.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'over-close') { hide(); return; }
    if (a === 'pane-next') { if (b.dataset.k) { lastPane = b.dataset.k; draw(); } return; }
    if (a.endsWith('-open')) {
      const k = a.split('-')[0];
      if (!plain(k) && el.classList.contains('panes')) { lastPane = k; draw(); } else show(k);
      return;
    }
    if (a === 'autoplay' || a === 'crossfade') { toast(`${a === 'autoplay' ? 'Autoplay' : 'Crossfade'} ${b.classList.contains('on') ? 'off' : 'on'}`); S.toggle(a); return; }   // an icon alone: the toast names it
    if (a === 'resume') { if (Date.now() - resumeUp >= RESUME_TAKES) S.resume(); return; }
    if (a === 'leave') { S.leave(); return; }
    if (a === 'like') { like(p.entity, st(p.entity).attributes); return; }
    if (a === 'source') { run({ call: 'media_player.select_source', target: p.entity, data: { source: b.dataset.src } }, { el: b, ev }); return; }
    if (a === 'power') { const on = p.power && !S.snap.now; if (!on) S.ending();   // turned off from here: the music ends, no song is held as if another were coming
      run(on ? { call: 'media_player.turn_on', target: p.power } : powerAction(p), { el: b, ev }); return; }
    if (a === 'mute' && S.snap.rooms.length > 1) { const on = S.snap.rooms; setGroupMuted(on, !groupMuted(on)); return; }
    if ((a === 'vdown' || a === 'vup') && S.snap.rooms.length > 1) { const on = S.snap.rooms; setGroupVol(on, Math.max(0, Math.min(1, Math.round(groupVol(on) * 20 + (a === 'vup' ? 1 : -1)) / 20))); return; }   // all rooms, 5% a press
    S.act(a, { el: b, ev });
    // a Spotify account's own player only asks Spotify now and then: after our own press, SpotifyPlus is told to ask now
    if (['next', 'prev', 'play', 'shuffle', 'repeat'].includes(a)) nudge(S.snap.spotify);
  });

  // seek: tap the progress bar. Not on a SoundCloud item: Music Assistant (2.x, 2026-11) can't start SoundCloud's streams
  // partway (ffmpeg gets no audio), gives up after 15 s and skips the item, so the set would be lost; the bar stays put.
  bar.addEventListener('click', (ev) => {
    const id = S.snap.caps.seek, n = S.snap.now; if (!id || !n || !n.a.media_duration || !bar.classList.contains('seek')) return;
    const ids = [n.a, (st(id) || {}).attributes, (st(maOf(p)) || {}).attributes].map((x) => (x && x.media_content_id) || '');   // whichever of its entities shows the item
    if (ids.some((x) => NO_SEEK.test(x))) { toast('Music Assistant can’t skip ahead in SoundCloud yet'); return; }
    const r = bar.getBoundingClientRect(), t = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * n.a.media_duration;
    call('media_player.media_seek', { seek_position: Math.round(t) }, id);
  });

  // volume: drag or tap the bar. Several rooms: all of them, in proportion (each room's own is under Rooms)
  dragBar(vbar, {
    pick: () => vbar,
    show(_bar, v, first) { vbar.classList.add('drag'); vfill.style.width = v * 100 + '%'; if (!first) setText(vtxt, Math.round(v * 100) + '%'); },
    done(_bar, v, ev) {
      vbar.classList.remove('drag');
      const id = S.snap.caps.volume || lastVol, on = S.snap.rooms; if (v == null || !id) { draw(); return; }
      if (on.length > 1) setGroupVol(on, v); else setVol(id, v, tapStart(ev));
    },
  });
  return el;
}
