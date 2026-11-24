// Music Assistant's queue, the same on every screen (the TV's Now playing, the media pop-up); styles in css/cards/player-parts.css.
// Laid out like MA's own: what played (dimmed, scroll up to it), Now playing (moving bars on its art while it plays), Up next
// with its count. The list opens with Now playing near the top.
//   const Q = queueUI(S, { backto })   S: core/session.js; backto: selector the remote's Back goes to from the list
//   Q.el        put it in a box with a height; the list scrolls inside
//   Q.draw()    call when the session changes         Q.shown()  call when the box is shown (scrolls to Now playing)
//   Q.close()   close its menu / view                 Q.focus()  the remote's highlight on the next song
// OK / a tap on a song opens its menu over the list, as MA's: Play now / Play next / View endless mix / Move to end / Remove
// from queue / Show info (fewer for played and current songs; a song of an endless mix: Play now / Play next / Add to queue /
// Show info). The menu and those views are layers (core/layers.js): the remote stays in them and Back closes them; touch screens get a close button
// and, on upcoming songs, a handle to drag them to another place (they can't go above the one playing).
import { h, esc, icon, setText, setHTML, toggle, mmss, cap } from './dom.js';
import * as MA from './ma.js';
import { onDispose } from './scope.js';
import { layer } from './layers.js';
import { track, titleOf, artistOf } from './session.js';
import { LIST_LEFT_ALONE } from './music-timing.js';

const PAST = 20;
const M = { play: ['play-circle-outline', 'Play now'], next: ['skip-next-circle-outline', 'Play next'], mix: ['all-inclusive', 'View endless mix'],
  end: ['arrow-collapse-down', 'Move to end'], del: ['delete-outline', 'Remove from queue'], info: ['information-outline', 'Show info'],
  mplay: ['play-circle-outline', 'Play now'], mnext: ['skip-next-circle-outline', 'Play next'], madd: ['playlist-plus', 'Add to queue'] };
const MENUS = { past: ['play', 'mix', 'info'], now: ['mix', 'info'], stopped: ['play', 'mix', 'info'], up: ['play', 'next', 'mix', 'end', 'del', 'info'], mixtrack: ['mplay', 'mnext', 'madd', 'info'] };
// A song in a list, the same wherever one is listed (this queue, an endless mix, another player's up next:
// cards/media-detail/upnext.js): its art (or a note), name and artist, length; eq: the bars over the art of the one playing
export const songArt = (src) => (src ? `<img alt="" loading="lazy" src="${esc(src)}">` : icon('music'));
export const songCells = (s, eq = false) => `<span class="pqart">${songArt(s.pic)}${eq ? '<span class="pqeq"><i></i><i></i><i></i><i></i></span>' : ''}</span>
      <span class="pqtx"><b>${esc(s.title)}</b><small>${esc(s.artist || '')}</small></span><span class="pqdur">${s.duration ? mmss(s.duration) : ''}</span>`;
const cellsOf = (it, eq) => songCells({ pic: MA.image(it, 80), title: titleOf(it), artist: artistOf(it), duration: it.duration }, eq);

export function queueUI(S, opt = {}) {
  const isRemote = () => document.documentElement.classList.contains('remote');   // asked when used: the class comes with the dashboard, after the first cards
  const ahead = () => (isRemote() ? 40 : 200);   // a TV keeps the list short (memory); a touch screen scrolls through all MA sends
  const el = h(`<div class="pq"><div class="pqlist" data-enter=".pqi.up"${opt.backto ? ` data-backto="${esc(opt.backto)}"` : ''}></div>
    <div class="pqsub" hidden><div class="pqsh"><button class="rbtn pqsx" data-x aria-label="Back">${icon('arrow-left')}</button><span class="pqtx"><b></b><small></small></span></div><div class="pqsb"></div></div>
    <div class="pqmenu" hidden><div class="pqmt"><span class="pqart"></span><span class="pqtx"><b></b><small></small></span><button class="rbtn pqmx" data-x aria-label="Close">${icon('close')}</button></div><div class="pqmb"></div></div></div>`);
  const list = el.querySelector('.pqlist'), menu = el.querySelector('.pqmenu'), subv = el.querySelector('.pqsub');
  let key = '', nowId = null, top = true, drag = null, touched = 0;   // touched: when a finger, the wheel or a key was last in the list

  const row = (it, kind, ix) => `<div class="pqr ${kind}" data-qi="${esc(it.queue_item_id)}" data-ix="${ix}"><button class="pqi ${kind}">${cellsOf(it, kind === 'now')}</button>${kind === 'up' && !isRemote() ? `<i class="pqh" aria-label="Drag to move">${icon('drag')}</i>` : ''}</div>`;

  function draw() {
    const v = S.snap, d = v.data, n = v.n;
    toggle(el, 'playing', !!n && n.state === 'playing');   // the bars on Now playing's art move
    if (!d || drag) return;
    // the songs around the current one, each with its number in the whole queue (the session holds a part of a long queue)
    const at = v.cur, remote = isRemote(), L = MA.listAround(d, at, PAST, ahead());
    const k = [at, v.stopped && !n ? 's' : '', L.left, ...L.past.map((x) => x.it.queue_item_id), L.now ? L.now.it.queue_item_id : '', ...L.up.map((x) => x.it.queue_item_id)].join('|');
    if (k === key) return;
    const id = L.now ? L.now.it.queue_item_id : undefined, moved = nowId !== id; key = k; nowId = id;
    const had = document.activeElement && list.contains(document.activeElement) && document.activeElement.closest('.pqr').dataset.qi;
    if (!(d.items || []).length) { setHTML(list, '<div class="pempty">The queue is empty</div>'); return; }
    setHTML(list, L.past.map((x) => row(x.it, 'past', x.ix)).join('')
      + `<div class="pqh2 nowh">${v.stopped && !n ? 'Stopped at' : 'Now playing'}</div>${L.now ? row(L.now.it, 'now', L.now.ix) : ''}`
      + `<div class="pqh2">Up next <span>${L.left}</span></div>`
      + L.up.map((x) => row(x.it, 'up', x.ix)).join('')
      + (L.more ? `<div class="pqmore">${L.more} more</div>` : ''));
    // the highlight stays on its song; if that song is gone (Play mix replaced the queue), back to Now playing with the next song lit
    const kept = had && list.querySelector(`.pqr[data-qi="${CSS.escape(had)}"] .pqi`);
    if (kept) { kept.focus({ preventScroll: true }); inView(kept); }
    else if (had) { top = true; toTop(true); focus(); return; }
    // a new song: Now playing is back at its place. A list somebody is scrolling or tapping stays where they left it,
    // until it has been left alone a while (never following, the songs played piled up above and pushed Now playing out below)
    if (moved && (remote || Date.now() - touched > LIST_LEFT_ALONE)) top = true;
    toTop();
  }
  function inView(r0) {
    const p = list.getBoundingClientRect(), r = r0.getBoundingClientRect();
    if (r.top < p.top) list.scrollTop += r.top - p.top; else if (r.bottom > p.bottom) list.scrollTop += r.bottom - p.bottom;
  }
  // Now playing near the top of the list, with the last played song and most of the one before it showing above it, as MA does
  // (on a new song, and when the list is shown), unless the remote's highlight is in it or somebody has just scrolled it
  function toTop(force) {
    const hd = list.querySelector('.nowh');
    if (!top || !hd || !list.clientHeight || (!force && isRemote() && list.contains(document.activeElement))) return;   // (a remote's highlight; a mouse leaves the focus on the last row clicked)
    const past = list.querySelectorAll('.pqr.past'), rowH = past.length ? past[past.length - 1].offsetHeight : 0;
    top = false; list.scrollTop += hd.getBoundingClientRect().top - list.getBoundingClientRect().top - Math.min(past.length, 1.7) * rowH;
  }
  ['wheel', 'touchmove', 'pointerdown', 'keydown'].forEach((t) => list.addEventListener(t, () => { touched = Date.now(); }, { passive: true }));
  function focus() { const r = list.querySelector('.pqi.up') || list.querySelector('.pqi.now'); if (r) r.focus({ preventScroll: true }); }
  const itemOf = (r) => ((S.snap.data || {}).items || []).find((x) => x.queue_item_id === r.dataset.qi);

  // ---- a song's menu, and the views it opens (endless mix, info), over the list ----
  // (from: the row it is for. When it closes, the remote's highlight is back there: core/layers.js)
  let menuIt = null, mixTracks = [], subSeq = 0;   // subSeq: an answer for a view since closed is dropped
  const menuL = layer({ el: menu, kind: 'menu', close: () => closeMenu() }), subL = layer({ el: subv, kind: 'menu', close: () => closeSub() });
  function openMenu(it, kind, from) {
    menuIt = it;
    setHTML(menu.querySelector('.pqart'), songArt(MA.image(it, 80)));
    setText(menu.querySelector('b'), titleOf(it)); setText(menu.querySelector('small'), artistOf(it));
    setHTML(menu.querySelector('.pqmb'), MENUS[kind].map((k) => `<button data-m="${k}">${icon(M[k][0])}<span>${M[k][1]}</span></button>`).join(''));
    menu.hidden = false; menuL.open(from); if (isRemote()) menu.querySelector('.pqmb button').focus({ preventScroll: true });
  }
  function closeMenu() { if (menu.hidden) return; menu.hidden = true; menuL.shut(); }
  function openSub(head, sub2, body, from) {
    const n = ++subSeq;
    setText(subv.querySelector('.pqsh b'), head); setText(subv.querySelector('.pqsh small'), sub2);
    setHTML(subv.querySelector('.pqsb'), body); subv.hidden = false; subL.open(from);
    if (isRemote()) (subv.querySelector('.pqsb button') || subv.querySelector('[data-x]')).focus({ preventScroll: true });
    return () => n === subSeq && !subv.hidden;   // still this view?
  }
  function closeSub() { if (subv.hidden) return; subv.hidden = true; subSeq++; subL.shut(); }
  menu.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (ev.target.closest('[data-x]')) { closeMenu(); return; }
    const b = ev.target.closest('[data-m]'); if (!b || !menuIt) return;
    const it = menuIt, uri = track(it).uri, m = b.dataset.m;
    if (m === 'mix' || m === 'info') { const from = menuL.opener(); closeMenu(); (m === 'mix' ? openMix : openInfo)(it, from); return; }   // the view is opened for the song the menu was for
    if (M[m] && m[0] === 'm') { if (uri) S.playMedia(uri, { mplay: 'play', mnext: 'next', madd: 'add' }[m]); } else S.itemAct(m, it);
    closeMenu();   // back to the song (gone after Play now / Remove: the next one)
  });
  subv.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (ev.target.closest('[data-x]')) { closeSub(); return; }
    const b = ev.target.closest('[data-mixall]'); if (b) { S.playMedia(b.dataset.uri, b.dataset.mixall); closeSub(); return; }
    const r = ev.target.closest('[data-mi]'); if (r) { const t = mixTracks[+r.dataset.mi]; if (t) openMenu(t, 'mixtrack', r); }
  });
  // View endless mix: MA's dynamic playlist seeded by the song (radio_playlist://playlist/<song>)
  function openMix(it, from) {
    const uri = track(it).uri; if (!uri) return;
    const mix = 'radio_playlist://playlist/' + uri;
    const mine = openSub(titleOf(it) + ' · Endless mix', 'Songs like this one, without end', '<div class="pempty">Making the mix…</div>', from);
    MA.cmd('music/item_by_uri', { uri: mix }).then((pl) => MA.cmd('music/playlists/playlist_tracks', { item_id: pl.item_id, provider_instance_id_or_domain: pl.provider }))
      .then((tracks) => {
        if (!mine()) return;
        mixTracks = (tracks || []).slice(0, 50);
        setHTML(subv.querySelector('.pqsb'), `<div class="pqsbtns"><button class="pqbtn on" data-mixall="replace" data-uri="${esc(mix)}">${icon('play')}<span>Play mix</span></button><button class="pqbtn" data-mixall="add" data-uri="${esc(mix)}">${icon('playlist-plus')}<span>Add to queue</span></button></div>`
          + mixTracks.map((t, i) => `<button class="pqi mixt" data-mi="${i}">${cellsOf(t)}</button>`).join(''));
        if (isRemote()) subv.querySelector('.pqsb button').focus({ preventScroll: true });
      }, () => { if (mine()) setHTML(subv.querySelector('.pqsb'), '<div class="pempty">MA couldn’t make a mix for this song</div>'); });
  }
  // Show info: what MA knows about the song
  function openInfo(it, from) {
    const m0 = track(it);
    const mine = openSub(titleOf(it), artistOf(it), '<div class="pempty">…</div>', from);
    (m0.uri ? MA.cmd('music/item_by_uri', { uri: m0.uri }) : Promise.resolve(m0)).catch(() => m0).then((t) => {
      if (!mine()) return;
      const al = t.album || m0.album || {}, md = t.metadata || {}, sd = it.streamdetails || it.stream_details || {}, pm = (t.provider_mappings || [])[0] || {}, af = pm.audio_format || {};
      const fmt = (x) => [x.content_type && String(x.content_type).toUpperCase(), x.sample_rate && `${(x.sample_rate / 1000).toFixed(1)} kHz`, x.bit_depth && `${x.bit_depth}-bit`].filter(Boolean).join(' · ');
      const when = (v) => { if (!v) return ''; const d = new Date(typeof v === 'number' ? v * 1000 : v); return isNaN(d) ? '' : d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }); };
      const rows = [['Artists', artistOf(t) || artistOf(it)], ['Album', [al.name, al.year].filter(Boolean).join(' · ')], ['Length', t.duration || it.duration ? mmss(t.duration || it.duration) : ''],
        ['Track', t.track_number ? (t.disc_number > 1 ? `Disc ${t.disc_number} · ` : '') + `Track ${t.track_number}` : ''], ['Version', t.version],
        ['Source', [pm.provider_domain && cap(pm.provider_domain), fmt(sd.content_type ? sd : af)].filter(Boolean).join(' · ')], ['Explicit', md.explicit ? 'Yes' : ''],
        ['Popularity', md.popularity != null ? md.popularity + ' / 100' : ''], ['Genres', (md.genres || []).join(', ')], ['Added', when(t.date_added)], ['Last played', when(t.last_played)]]
        .filter(([, v]) => v);
      setHTML(subv.querySelector('.pqsb'), `<dl class="pqinfo">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(String(v))}</dd>`).join('')}</dl>`);
    });
  }

  list.addEventListener('click', (ev) => {
    const r = ev.target.closest('.pqr'); if (!r || ev.target.closest('.pqh')) return;
    const it = itemOf(r); if (!it) return;
    const kind = r.classList.contains('now') ? (S.snap.stopped ? 'stopped' : 'now') : r.classList.contains('past') ? 'past' : 'up';
    openMenu(it, kind, r.querySelector('.pqi'));
  });

  // ---- drag a song by its handle to move it (MA's player_queues/move_item, pos_shift = places moved). The row follows the
  // finger, the others make room; the list scrolls when the finger nears its top or bottom edge. ----
  list.addEventListener('pointerdown', (ev) => {
    const hd = ev.target.closest('.pqh'); if (!hd) return;
    ev.preventDefault();
    const r = hd.closest('.pqr'), rows = [...list.querySelectorAll('.pqr.up')], from = rows.indexOf(r);
    drag = { row: r, rows, from, to: from, y0: ev.clientY, s0: list.scrollTop, h: r.offsetHeight, pid: ev.pointerId };
    r.classList.add('dragging'); el.classList.add('sorting');
    try { hd.setPointerCapture(ev.pointerId); } catch (x) { /* ignore */ }
  });
  list.addEventListener('pointermove', (ev) => {
    if (!drag || ev.pointerId !== drag.pid) return;
    const box = list.getBoundingClientRect(), edge = 56;
    if (ev.clientY < box.top + edge) list.scrollTop -= 8; else if (ev.clientY > box.bottom - edge) list.scrollTop += 8;
    const dy = ev.clientY - drag.y0 + (list.scrollTop - drag.s0);
    drag.to = Math.max(0, Math.min(drag.rows.length - 1, drag.from + Math.round(dy / drag.h)));
    drag.row.style.transform = `translateY(${dy}px)`;
    drag.rows.forEach((r, i) => { if (r === drag.row) return;
      const shift = drag.to > drag.from && i > drag.from && i <= drag.to ? -drag.h : drag.to < drag.from && i < drag.from && i >= drag.to ? drag.h : 0;
      r.style.transform = shift ? `translateY(${shift}px)` : ''; });
  });
  const dragEnd = (ev) => {
    if (!drag || ev.pointerId !== drag.pid) return;
    const { from, to, row: r, rows } = drag; drag = null; el.classList.remove('sorting');
    rows.forEach((x) => { x.style.transform = ''; x.classList.remove('dragging'); });
    const it = itemOf(r);
    if (to !== from && it) S.shift(it, to - from); else draw();
  };
  list.addEventListener('pointerup', dragEnd);
  list.addEventListener('pointercancel', dragEnd);
  onDispose(() => { drag = null; });

  return { el, draw, focus, shown() { top = true; toTop(); }, close() { closeMenu(); closeSub(); } };
}
