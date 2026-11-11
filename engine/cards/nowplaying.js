// Music playing on this screen's player: full-screen "Now playing" (TV) or a slim bar that leads to it.
// { type: 'nowplaying', player: { entity, ma, power, spotify, name },   a `players` entry from home.js (core/players.js decides
//   mode: 'full' | 'bar',                                               what really plays here: stale Spotify sessions, MA mirrors)
//   view: 'now',        bar: OK opens this view
//   auto: 'now' }       open this view when music starts on the player (TV: casting music to it); on a TV the launcher also
//                       brings this screen up over Music Assistant's own cast screen (tvhost.cover)
// Music = an MA queue, media_content_type music, or an app that only plays music (MUSIC_APPS). Video never counts.
// Full: the artwork over a blurred wash of itself, title, artist, album, progress; shuffle / previous / play-pause / next /
// repeat. When Music Assistant plays its own queue and the screen can reach MA's API (core/ma.js, an MA token on TVs), a
// side panel shows Up next (laid out like MA's queue; OK on a song: its menu, with View endless mix and Show info) or Lyrics (synced
// lines follow the song), picked in the bottom row beside the Autoplay / Crossfade switches.
// Playback controls go through HA, so they work without MA's API.
import { h, esc, icon, setText, setHTML, toggle, mmss, cap } from '../core/dom.js';
import { watch, st } from '../core/store.js';
import { origin } from '../core/auth.js';
import { run } from '../core/actions.js';
import { now, idsOf, pick, elapsed, maLive, F } from '../core/players.js';
import * as MA from '../core/ma.js';
import { cover, keepAwake } from '../core/tvhost.js';

const MUSIC_APPS = /spotify|music assistant|youtube music|pandora|tidal|deezer|soundcloud|plexamp|apple music/i;
export function musicOn(p) {
  if (!p) return null;
  const n = now(p);
  if (!n || n.screen || n.bare || !['playing', 'paused', 'buffering'].includes(n.state)) return null;
  return maLive(p) || n.a.media_content_type === 'music' || MUSIC_APPS.test(n.app || '') || MUSIC_APPS.test(n.a.app_name || '') ? n : null;
}
const art = (n) => (!n.pic ? '' : /^https?:/.test(n.pic) ? n.pic : origin + n.pic);
const REPEAT = { off: ['all', 'repeat-off'], all: ['one', 'repeat'], one: ['off', 'repeat-once'] };   // now -> [next, icon]
const mi = (it) => (it && it.media_item) || it || {};   // a queue item wraps its track; a mix's tracks are tracks
const artist = (it) => (mi(it).artists || []).map((a) => a.name).join(', ');
const title = (it) => mi(it).name || it.name || '';
let tab = 'queue';   // the side panel's tab, kept across songs

export default function nowplaying(cfg, ctx) {
  const P = cfg.player, ids = P ? idsOf(P) : [], full = cfg.mode !== 'bar';
  return full ? fullCard(cfg, P, ids) : barCard(cfg, P, ids, ctx);
}

function barCard(cfg, P, ids, ctx) {
  const el = h(`<button class="npb"><span class="npbart"><img alt=""></span><span class="npbtx"><span class="label caption">Now playing</span><b></b><small></small></span><span class="npbgo">${icon('chevron-right')}</span></button>`);
  const img = el.querySelector('img');
  let was = null, covering = '', awakeNow = false;   // was: null until the first state, so a page opened mid-song stays where it is
  watch(ids, () => {
    const cur = musicOn(P);
    if (ctx && ctx.setVisible) ctx.setVisible(!!cur);
    // music started on this TV: go to the full screen (only on a real start, not when the page loads mid-song)
    if (cfg.auto && cur && cur.state === 'playing' && was === false) window.dispatchEvent(new CustomEvent('dash:view', { detail: cfg.auto }));
    was = !!cur && cur.state === 'playing';
    // Music Assistant's cast screen on this TV: the launcher puts this screen over it, on the full view
    const castMA = !!cur && !!maLive(P) && /music assistant/i.test(((st(P.entity) || {}).attributes || {}).app_name || '');
    const want = cfg.auto && castMA ? cfg.auto : '';
    if (want !== covering) { covering = want; cover(want); }
    // music playing on this TV: no screensaver while our screen is in front (Google TV only counts remote presses)
    const awake = !!cfg.auto && !!cur && cur.state === 'playing';
    if (awake !== awakeNow) { awakeNow = awake; keepAwake(awake); }
    toggle(el, 'idle', !cur);
    if (!cur) return;
    const src = art(cur); if (src && img.getAttribute('src') !== src) img.src = src; img.style.visibility = src ? '' : 'hidden';
    setText(el.querySelector('b'), cur.title);
    setText(el.querySelector('small'), cur.artist);
  });
  el.addEventListener('click', () => { if (cfg.view) window.dispatchEvent(new CustomEvent('dash:view', { detail: cfg.view })); });
  return el;
}

function fullCard(cfg, P, ids) {
  const btn = (a, ic, cls = '', label = '') => `<button class="rbtn ${cls}" data-a="${a}" aria-label="${label}">${icon(ic)}</button>`;
  const el = h(`<div class="np"><div class="npbg"><img alt=""></div>
    <div class="npmain"><div class="npart"><img alt=""></div>
      <div class="nptx"><div class="label caption npsrc"></div><div class="nptitle"></div><div class="npartist"></div><div class="npalbum"></div></div></div>
    <div class="npside">
      <div class="nppane npq" data-pane="queue" data-enter=".npqi.up" data-backto=".nptog.panel.on"></div><div class="nppane nplyr" data-pane="lyrics" data-backto=".nptog.panel.on"></div>
      <div class="npmenu" data-menu hidden><div class="npmt"><span class="npqart"></span><span class="npqtx"><b></b><small></small></span></div><div class="npmb"></div></div>
      <div class="npsub" data-menu hidden><div class="npsh"><button class="rbtn npsx" data-x aria-label="Back">${icon('arrow-left')}</button><span class="npqtx"><b></b><small></small></span></div><div class="npsb"></div></div></div>
    <div class="npfoot">
      <div class="npbar"><span class="npcur"></span><span class="nptrack"><i></i></span><span class="npdur"></span></div>
      <div class="npctl">${btn('shuffle', 'shuffle-variant', 'npsm npshuf', 'Shuffle')}${btn('prev', 'skip-previous', '', 'Previous')}<button class="rbtn npplay" data-a="play" data-focus-first aria-label="Play or pause"></button>${btn('next', 'skip-next', '', 'Next')}${btn('repeat', 'repeat-off', 'npsm nprep', 'Repeat')}
        <span class="npgap"></span>
        <button class="nptog panel" data-a="queue">${icon('playlist-music')}<span>Up next</span></button><button class="nptog panel" data-a="lyrics">${icon('microphone-variant')}<span>Lyrics</span></button><button class="nptog" data-a="autoplay">${icon('all-inclusive')}<span>Autoplay</span></button><button class="nptog" data-a="crossfade">${icon('transition')}<span>Crossfade</span></button></div></div>
    <div class="npnone">Nothing playing on this TV.</div></div>`);
  const imgs = [...el.querySelectorAll('.npbg img, .npart img')], q = (s) => el.querySelector(s);
  let cur = null, queueId = null, unsub = () => {}, data = null, lyrLines = null, lyrUri = null, lyrOn = -2;

  // ---- the HA side: what plays, progress, transport ----
  const draw = () => {
    cur = musicOn(P);
    toggle(el, 'idle', !cur);
    if (!cur) { setQueue(null); return; }
    const src = art(cur);
    imgs.forEach((im) => { if (src && im.getAttribute('src') !== src) im.src = src; im.style.visibility = src ? '' : 'hidden'; });
    const live = maLive(P);
    setText(q('.npsrc'), ['Now playing', live ? 'Music Assistant' : cur.app].filter(Boolean).join(' · '));
    setText(q('.nptitle'), cur.title); setText(q('.npartist'), cur.artist); setText(q('.npalbum'), cur.album);
    setHTML(q('.npplay'), icon(cur.state === 'playing' ? 'pause' : 'play'));
    toggle(el, 'playing', cur.state === 'playing');   // the bars on Now playing's art move
    const a = cur.a, can = (bit) => !!pick(P, bit);
    toggle(q('.npshuf'), 'on', !!a.shuffle); q('.npshuf').hidden = !can(F.SHUFFLE);
    const rep = REPEAT[a.repeat] || REPEAT.off; setHTML(q('.nprep'), icon(rep[1])); toggle(q('.nprep'), 'on', !!a.repeat && a.repeat !== 'off'); q('.nprep').hidden = !can(F.REPEAT);
    progress();
    setQueue(live ? (st(live) || { attributes: {} }).attributes.active_queue : null);
  };
  // where the song is: MA's own position when its queue is here (HA's copy runs ~0.3 s behind it, 2026-11-11), else HA's
  const pos = () => {
    if (!cur) return 0;
    const Q = data && data.queue;
    if (Q && Q.elapsed_time != null && Q.elapsed_time_last_updated) {
      const p = +Q.elapsed_time + (cur.state === 'playing' ? Date.now() / 1000 - Q.elapsed_time_last_updated : 0), d = +cur.a.media_duration || 0;
      return Math.max(0, d ? Math.min(p, d) : p);
    }
    return elapsed(cur) || 0;
  };
  const progress = () => {
    if (!cur) return;
    const d = +cur.a.media_duration || 0, p = pos();
    setText(q('.npcur'), mmss(p)); setText(q('.npdur'), d ? mmss(d) : '');
    q('.nptrack i').style.width = d ? (100 * Math.min(p, d) / d).toFixed(2) + '%' : '0';
    follow();
  };

  // ---- the MA side: queue, lyrics, switches ----
  function setQueue(id) {
    if (id === queueId) return;
    queueId = id; unsub(); data = null; toggle(el, 'ma', false); q('.npshuf').disabled = q('.nprep').disabled = false;
    if (!id) return;
    // the queue arrives once MA is reachable (now, or after core/ma.js's retries); a screen without an MA token just never gets one
    unsub = MA.queue(id, (d) => { const first = !data; data = d; if (first) toggle(el, 'ma', true); drawQueue(); if (first) showTab(); });
  }
  function drawQueue() {
    const Q = data.queue || {}, items = data.items || [], at = Math.max(0, Q.current_index || 0);
    toggle(q('[data-a="autoplay"]'), 'on', !!Q.autoplay_enabled);
    toggle(q('[data-a="crossfade"]'), 'on', !!Q.crossfade_enabled);
    // a dynamic queue (an endless mix) shuffles itself and has no repeat: MA refuses both, so they're greyed out, as in MA
    q('.npshuf').disabled = q('.nprep').disabled = !!Q.is_dynamic;
    const key = [at, Q.autoplay_enabled, items.length, ...items.slice(Math.max(0, at - PAST), at + AHEAD).map((it) => it.queue_item_id)].join('|');
    const nowId = (items[at] || {}).queue_item_id;
    if (key !== qKey) { const moved = qNow !== nowId; qKey = key; qNow = nowId; drawRows(Q, items, at, moved); }
    const item = Q.current_item || items[at];
    const uri = item && item.media_item && item.media_item.uri;
    if (uri !== lyrUri) { lyrUri = uri; lyrItem = item; lyrTries = 0; lyrLines = null; lyrOn = -2; setHTML(q('.nplyr'), '<div class="npempty">Looking for lyrics…</div>'); loadLyrics(false); }
  }
  // Up next, laid out like MA's own queue: what played (dimmed, scroll up to it), Now playing (moving bars on its art while it
  // plays), Up next with its count (Autoplay shows on its switch below). The list opens with Now playing at the top.
  const PAST = 20, AHEAD = 40;
  let qKey = '', qNow = null, qTop = true;
  const qrow = (it, kind) => {
    const img = MA.image(it, 80);
    return `<button class="npqi ${kind}" data-qi="${esc(it.queue_item_id)}"><span class="npqart">${img ? `<img alt="" src="${esc(img)}">` : icon('music')}${kind === 'now' ? '<span class="npeq"><i></i><i></i><i></i><i></i></span>' : ''}</span>
      <span class="npqtx"><b>${esc(title(it))}</b><small>${esc(artist(it))}</small></span><span class="npqdur">${it.duration ? mmss(it.duration) : ''}</span></button>`;
  };
  function drawRows(Q, items, at, moved) {
    const pane = q('.npq'), had = document.activeElement && pane.contains(document.activeElement) && document.activeElement.dataset.qi;
    if (!items.length) { setHTML(pane, '<div class="npempty">The queue is empty</div>'); return; }
    const past = items.slice(Math.max(0, at - PAST), at), now = items[at], up = items.slice(at + 1, at + 1 + AHEAD), left = items.length - at - 1;
    setHTML(pane, past.map((it) => qrow(it, 'past')).join('')
      + `<div class="npqh nowh">Now playing</div>${now ? qrow(now, 'now') : ''}`
      + `<div class="npqh">Up next <span>${left}</span></div>`
      + up.map((it) => qrow(it, 'up')).join('')
      + (left > AHEAD ? `<div class="npqmore">${left - AHEAD} more</div>` : ''));
    // the highlight stays on its song; if that song is gone (Play mix replaced the queue), back to Now playing with the next song lit
    const kept = had && pane.querySelector(`[data-qi="${CSS.escape(had)}"]`);
    if (kept) { kept.focus({ preventScroll: true }); inView(pane, kept); }
    else if (had) { const r = pane.querySelector('.npqi.up') || pane.querySelector('.npqi.now'); qTop = true; toTop(true); if (r) { r.focus({ preventScroll: true }); return; } }
    if (moved) qTop = true;
    toTop();
  }
  function inView(pane, row) {
    const p = pane.getBoundingClientRect(), r = row.getBoundingClientRect();
    if (r.top < p.top) pane.scrollTop += r.top - p.top; else if (r.bottom > p.bottom) pane.scrollTop += r.bottom - p.bottom;
  }
  // Now playing near the top of the list, with the last played song and most of the one before it showing above it, as MA does
  // (on a new song, and when the list is shown), unless the highlight is in it
  function toTop(force) {
    const pane = q('.npq'), hd = pane.querySelector('.nowh');
    if (!qTop || !hd || pane.hidden || !pane.clientHeight || (!force && pane.contains(document.activeElement))) return;
    const past = pane.querySelectorAll('.npqi.past'), rowH = past.length ? past[past.length - 1].offsetHeight : 0;
    qTop = false; pane.scrollTop += hd.getBoundingClientRect().top - pane.getBoundingClientRect().top - Math.min(past.length, 1.7) * rowH;
  }

  // ---- a song's menu: over the panel; the remote stays in it, Back closes it (core/remote.js, [data-menu]) ----
  // past: Play now / View endless mix / Show info; now: View endless mix / Show info; up: as MA, Play now, Play next, View
  // endless mix, Move to end, Remove, Show info; a song in an endless mix: Play now / Play next / Add to queue / Show info.
  const M = { play: ['play-circle-outline', 'Play now'], next: ['skip-next-circle-outline', 'Play next'], mix: ['all-inclusive', 'View endless mix'],
    end: ['arrow-collapse-down', 'Move to end'], del: ['delete-outline', 'Remove from queue'], info: ['information-outline', 'Show info'],
    mplay: ['play-circle-outline', 'Play now'], mnext: ['skip-next-circle-outline', 'Play next'], madd: ['playlist-plus', 'Add to queue'] };
  const MENUS = { past: ['play', 'mix', 'info'], now: ['mix', 'info'], up: ['play', 'next', 'mix', 'end', 'del', 'info'], mixtrack: ['mplay', 'mnext', 'madd', 'info'] };
  const menu = q('.npmenu'), subv = q('.npsub');
  let menuIt = null, menuFrom = null, subFrom = null, mixTracks = [], subSeq = 0;   // subSeq: an answer for a view since closed is dropped
  const back = (el2) => { if (el2 && el2.isConnected && !el2.closest('[hidden]')) el2.focus({ preventScroll: true }); else { const r = q('.npq .npqi.up') || q('.npplay'); if (r) r.focus({ preventScroll: true }); } };
  function openMenu(it, kind, from) {
    menuIt = it; menuFrom = from;
    const img = MA.image(it, 80);
    setHTML(menu.querySelector('.npqart'), img ? `<img alt="" src="${esc(img)}">` : icon('music'));
    setText(menu.querySelector('b'), title(it)); setText(menu.querySelector('small'), artist(it));
    setHTML(menu.querySelector('.npmb'), MENUS[kind].map((k) => `<button data-m="${k}">${icon(M[k][0])}<span>${M[k][1]}</span></button>`).join(''));
    menu.hidden = false; menu.querySelector('.npmb button').focus({ preventScroll: true });
  }
  function closeMenu(refocus = true) { if (menu.hidden) return; menu.hidden = true; if (refocus) back(menuFrom); }
  function openSub(head, sub2, body, from) {
    subFrom = from; const n = ++subSeq;
    setText(subv.querySelector('.npsh b'), head); setText(subv.querySelector('.npsh small'), sub2);
    setHTML(subv.querySelector('.npsb'), body); subv.hidden = false;
    (subv.querySelector('.npsb button') || subv.querySelector('[data-x]')).focus({ preventScroll: true });
    return () => n === subSeq && !subv.hidden;   // still this view?
  }
  function closeSub() { if (subv.hidden) return; subv.hidden = true; subSeq++; back(subFrom); }
  menu.addEventListener('dash:close', () => closeMenu());
  subv.addEventListener('dash:close', closeSub);
  const play = (media, option) => MA.cmd('player_queues/play_media', { queue_id: queueId, media, option }).catch(() => {});
  menu.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const b = ev.target.closest('[data-m]'); if (!b || !queueId || !menuIt) return;
    const it = menuIt, id = it.queue_item_id, uri = mi(it).uri, m = b.dataset.m;
    if (m === 'mix') { closeMenu(false); openMix(it, menuFrom); return; }
    if (m === 'info') { closeMenu(false); openInfo(it, menuFrom); return; }
    const call = { play: ['player_queues/play_index', { index: id }], next: ['player_queues/move_item', { queue_item_id: id, pos_shift: 0 }],
      end: ['player_queues/move_item_end', { queue_item_id: id }], del: ['player_queues/delete_item', { item_id_or_index: id }] }[m];
    if (call) MA.cmd(call[0], { queue_id: queueId, ...call[1] }).catch(() => {});
    else if (uri) play(uri, { mplay: 'play', mnext: 'next', madd: 'add' }[m]);
    closeMenu();   // back to the song (gone after Play now / Remove: the next one)
  });
  subv.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (ev.target.closest('[data-x]')) { closeSub(); return; }
    const b = ev.target.closest('[data-mixall]'); if (b && queueId) { play(b.dataset.uri, b.dataset.mixall); closeSub(); return; }
    const r = ev.target.closest('[data-mi]'); if (r) { const t = mixTracks[+r.dataset.mi]; if (t) openMenu(t, 'mixtrack', r); }
  });
  // View endless mix: MA's dynamic playlist seeded by the song (radio_playlist://playlist/<song>)
  function openMix(it, from) {
    const uri = mi(it).uri; if (!uri) return;
    const mix = 'radio_playlist://playlist/' + uri;
    const mine = openSub(title(it) + ' · Endless mix', 'Songs like this one, without end', '<div class="npempty">Making the mix…</div>', from);
    MA.cmd('music/item_by_uri', { uri: mix }).then((pl) => MA.cmd('music/playlists/playlist_tracks', { item_id: pl.item_id, provider_instance_id_or_domain: pl.provider }))
      .then((tracks) => {
        if (!mine()) return;
        mixTracks = (tracks || []).slice(0, 50);
        setHTML(subv.querySelector('.npsb'), `<div class="npsbtns"><button class="nptog on" data-mixall="replace" data-uri="${esc(mix)}">${icon('play')}<span>Play mix</span></button><button class="nptog" data-mixall="add" data-uri="${esc(mix)}">${icon('playlist-plus')}<span>Add to queue</span></button></div>`
          + mixTracks.map((t, i) => { const img = MA.image(t, 80); return `<button class="npqi mixt" data-mi="${i}"><span class="npqart">${img ? `<img alt="" src="${esc(img)}">` : icon('music')}</span><span class="npqtx"><b>${esc(title(t))}</b><small>${esc(artist(t))}</small></span><span class="npqdur">${t.duration ? mmss(t.duration) : ''}</span></button>`; }).join(''));
        subv.querySelector('.npsb button').focus({ preventScroll: true });
      }, () => { if (mine()) setHTML(subv.querySelector('.npsb'), '<div class="npempty">MA couldn’t make a mix for this song</div>'); });
  }
  // Show info: what MA knows about the song
  function openInfo(it, from) {
    const m0 = mi(it);
    const mine = openSub(title(it), artist(it), '<div class="npempty">…</div>', from);
    (m0.uri ? MA.cmd('music/item_by_uri', { uri: m0.uri }) : Promise.resolve(m0)).catch(() => m0).then((t) => {
      if (!mine()) return;
      const al = t.album || m0.album || {}, md = t.metadata || {}, sd = it.streamdetails || it.stream_details || {}, pm = (t.provider_mappings || [])[0] || {}, af = pm.audio_format || {};
      const fmt = (x) => [x.content_type && String(x.content_type).toUpperCase(), x.sample_rate && `${(x.sample_rate / 1000).toFixed(1)} kHz`, x.bit_depth && `${x.bit_depth}-bit`].filter(Boolean).join(' · ');
      const when = (v) => { if (!v) return ''; const d = new Date(typeof v === 'number' ? v * 1000 : v); return isNaN(d) ? '' : d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }); };
      const rows = [['Artists', artist(t) || artist(it)], ['Album', [al.name, al.year].filter(Boolean).join(' · ')], ['Length', t.duration || it.duration ? mmss(t.duration || it.duration) : ''],
        ['Track', t.track_number ? (t.disc_number > 1 ? `Disc ${t.disc_number} · ` : '') + `Track ${t.track_number}` : ''], ['Version', t.version],
        ['Source', [pm.provider_domain && cap(pm.provider_domain), fmt(sd.content_type ? sd : af)].filter(Boolean).join(' · ')], ['Explicit', md.explicit ? 'Yes' : ''],
        ['Popularity', md.popularity != null ? md.popularity + ' / 100' : ''], ['Genres', (md.genres || []).join(', ')], ['Added', when(t.date_added)], ['Last played', when(t.last_played)]]
        .filter(([, v]) => v);
      setHTML(subv.querySelector('.npsb'), `<dl class="npinfo">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(String(v))}</dd>`).join('')}</dl>`);
    });
  }
  // lyrics for the song playing; "none" is asked again 10 s and 30 s later, and whenever Lyrics is opened
  let lyrItem = null, lyrTries = 0, lyrFound = false, lyrT = 0;
  function loadLyrics(again) {
    const uri = lyrUri; clearTimeout(lyrT);
    MA.lyrics(lyrItem, again).then((L) => {
      if (lyrUri !== uri) return;
      lyrLines = L.lines; lyrFound = !!(L.lines || L.text); lyrOn = -2;
      toggle(q('.nplyr'), 'lrc', !!L.lines);
      if (L.lines) setHTML(q('.nplyr'), `<div class="nplin"><div class="npintro">${`<i>${icon('music-note')}</i>`.repeat(7)}</div>${L.lines.map((l, i) => `<p data-i="${i}">${l.text ? esc(l.text) : icon('music-note')}</p>`).join('')}</div>`);
      else if (L.text) setHTML(q('.nplyr'), `<div class="nplplain">${esc(L.text)}</div>`);
      else {
        setHTML(q('.nplyr'), '<div class="npempty">No lyrics for this song</div>');
        if (lyrTries < 2) lyrT = setTimeout(() => { lyrTries++; loadLyrics(true); }, lyrTries ? 30000 : 10000);
      }
      follow();
    });
  }
  // synced lyrics: the line being sung, kept in the middle of the panel
  function follow() {
    if (!lyrLines || tab !== 'lyrics') return;
    const t = pos() + 0.15; let i = -1;   // a hair early, so the line is up as the singing starts
    for (let k = 0; k < lyrLines.length && lyrLines[k].t <= t; k++) i = k;
    // before the first line: the intro's notes light up one by one until the singing starts (as MA's own panel does)
    const intro = q('.npintro');
    if (intro) { const n = i < 0 ? Math.floor(7 * Math.min(1, t / Math.max(1, lyrLines[0].t))) : 7; intro.querySelectorAll('i').forEach((x, k) => toggle(x, 'lit', k < n)); toggle(intro, 'on', i < 0); }
    if (i === lyrOn) return;
    lyrOn = i;
    const pane = q('.nplyr'), lin = pane.querySelector('.nplin'); if (!lin) return;
    // the lines glide (a transform, not a scroll) so the one being sung sits a little above the middle; it grows and
    // brightens, its neighbours are half lit, the rest fade (css/cards/nowplaying.css)
    lin.querySelectorAll('p').forEach((p) => { const k = Math.abs(+p.dataset.i - i); p.className = i < 0 ? '' : k === 0 ? 'on' : k === 1 ? 'near' : ''; });
    const p = i < 0 ? lin.querySelector('.npintro') : lin.querySelector(`p[data-i="${i}"]`);   // the line sung (or the intro) sits a little above the middle, from the very first line
    if (p) lin.style.transform = `translateY(${Math.round(pane.clientHeight * 0.42 - (p.offsetTop + p.offsetHeight / 2))}px)`;
  }
  function showTab() {
    el.querySelectorAll('.nptog.panel').forEach((b) => toggle(b, 'on', b.dataset.a === tab));   // the bottom row says which panel shows
    el.querySelectorAll('.nppane').forEach((p) => { p.hidden = p.dataset.pane !== tab; });
    if (tab === 'queue') toTop();
    lyrOn = -2; follow();
  }

  watch(ids, draw);
  const tick = setInterval(() => { if (!document.hidden && el.isConnected) progress(); else if (!el.isConnected) { clearInterval(tick); clearInterval(fast); unsub(); } }, 500);
  const fast = setInterval(() => { if (tab === 'lyrics' && lyrLines && !document.hidden && el.isConnected) follow(); }, 100);   // lyrics: on the beat

  el.addEventListener('click', (ev) => {
    const qi = ev.target.closest('.npq [data-qi]');
    if (qi && queueId) { const it = ((data && data.items) || []).find((x) => x.queue_item_id === qi.dataset.qi); if (it) openMenu(it, qi.classList.contains('now') ? 'now' : qi.classList.contains('past') ? 'past' : 'up', qi); return; }
    const b = ev.target.closest('[data-a]'); if (!b || !cur) return;
    const a = b.dataset.a, A = cur.a;
    if (a === 'queue' || a === 'lyrics') { tab = a; showTab(); if (tab === 'lyrics' && lyrItem && !lyrFound) loadLyrics(true); return; }
    if (a === 'autoplay' || a === 'crossfade') {
      if (!queueId || !data) return;
      const k = a + '_enabled', v = !(data.queue || {})[k];
      toggle(b, 'on', v);   // shown at once; MA's queue_updated confirms
      MA.cmd('player_queues/' + a, { queue_id: queueId, [k]: v }).catch(() => toggle(b, 'on', !v));
      return;
    }
    if (a === 'shuffle') { const id = pick(P, F.SHUFFLE); if (id) run({ call: 'media_player.shuffle_set', target: id, data: { shuffle: !A.shuffle } }, { el: b, ev }); return; }
    if (a === 'repeat') { const id = pick(P, F.REPEAT); if (id) run({ call: 'media_player.repeat_set', target: id, data: { repeat: (REPEAT[A.repeat] || REPEAT.off)[0] } }, { el: b, ev }); return; }
    const [svc, bit] = { prev: ['media_previous_track', F.PREV], play: ['media_play_pause', F.PAUSE], next: ['media_next_track', F.NEXT] }[a] || [];
    if (!svc) return;
    const id = pick(P, bit) || (bit === F.PAUSE && pick(P, F.PLAY)); if (id) run({ call: 'media_player.' + svc, target: id }, { el: b, ev });
  });
  showTab();
  return el;
}
