// A playlist's page, over the Music card like the sheet: what it is, Play / Shuffle / Pin, its songs (more as the list
// scrolls); OK on a song plays the playlist from it. Spotify's songs come from MA (with their popularity), SoundCloud's
// from the relay (with likes). A layer while it is open (core/layers.js), like the sheet.
//   const P = playlistPage({ el, openSheet })   el: the .mpl element; openSheet(item, opener, opt): the card's sheet
//   P.open(playlist, opener)
import { esc, icon, setHTML } from '../../core/dom.js';
import * as MA from '../../core/ma.js';
import { rating } from '../../core/rank.js';
import { layer } from '../../core/layers.js';
import { domain, source, who, itemOf, pin } from './items.js';
import { numbersOf, rate, sizeText } from './numbers.js';
import { art, row, empty, fillRates } from './rows.js';

export function playlistPage({ el: plist, openSheet }) {
  const PL_PAGE = 50;   // songs drawn at a time (a SoundCloud playlist can hold 500)
  let shown = null, plSongs = [], plDrawn = 0, plSeq = 0;
  const L = layer({ el: plist, kind: 'menu', close: () => closeList() });
  function listSongs(it) {
    const s = domain(it), pm = (it.provider_mappings || []).find((m) => m.provider_domain === s) || {};
    if (s === 'soundcloud') return MA.scPlaylist(it.provider === 'library' ? pm.item_id : it.item_id);
    return MA.cmd('music/playlists/playlist_tracks', { item_id: it.item_id, provider_instance_id_or_domain: it.provider === 'library' ? 'library' : pm.provider_instance || it.provider });
  }
  function drawListHead() {
    const it = shown, r = rating(it, numbersOf(it)), z = plSongs.length ? { count: plSongs.length, duration: plSongs.reduce((t, x) => t + (x.duration || 0), 0) } : null;
    const likes = r ? `<span class="mrate ${r.kind}" title="${esc(r.title)}">${icon('heart')}${esc(r.text)} ${r.kind === 'saves' ? 'saves' : 'likes'}</span>` : '';
    setHTML(plist.querySelector('.mplhead'), `${art(it, 256)}<span class="mtx"><span class="label caption">Playlist${z ? ' · ' + esc(sizeText(z)) : ''}</span><b>${esc(it.name)}</b>
      <small>${esc([who(it), source(it)].filter(Boolean).join(' · '))}</small>${likes}</span>`);
    const pin = plist.querySelector('[data-pa="pin"]');
    setHTML(pin, `${icon(it.favorite ? 'pin-off-outline' : 'pin-outline')}<span>${it.favorite ? 'Unpin' : 'Pin'}</span>`);
  }
  function moreSongs() {
    const out = plist.querySelector('.mpltr'), next = plSongs.slice(plDrawn, plDrawn + PL_PAGE);
    if (!next.length) return;
    const old = out.querySelector('.mmore'); if (old) old.remove(); plMore.disconnect();
    out.insertAdjacentHTML('beforeend', next.map((x, i) => row(x, { n: plDrawn + i + 1, at: plDrawn + i, from: true })).join(''));
    plDrawn += next.length;
    if (plDrawn < plSongs.length) { out.insertAdjacentHTML('beforeend', '<div class="mempty mmore">More songs…</div>'); plMore.observe(out.querySelector('.mmore')); }
    fillRates(out);
  }
  function openList(it, btn) {
    shown = it; plSongs = []; plDrawn = 0;
    const mine = ++plSeq, out = plist.querySelector('.mpltr');
    drawListHead();
    setHTML(out, empty('Getting the songs…'));
    plist.hidden = false; out.scrollTop = 0; L.open(btn);
    plist.querySelector('[data-pa="play"]').focus({ preventScroll: true });
    rate([it]).then(() => { if (mine === plSeq) drawListHead(); });
    listSongs(it).then((list) => {
      if (mine !== plSeq) return;
      plSongs = (Array.isArray(list) ? list : (list && list.items) || []).filter((x) => x && x.uri);
      drawListHead(); setHTML(out, plSongs.length ? '' : empty('This playlist has no songs that play here'));
      moreSongs();
    }, () => { if (mine === plSeq) setHTML(out, empty('Music Assistant didn’t give the songs')); });
  }
  function closeList() { if (plist.hidden) return; plist.hidden = true; plSeq++; L.shut(); }
  const plMore = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) moreSongs(); }, { rootMargin: '0px 0px 400px 0px' });
  plist.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (ev.target.closest('.mclose')) { closeList(); return; }
    const a = ev.target.closest('[data-pa]');
    if (a && shown) {
      if (a.dataset.pa === 'pin') { pin(shown).then(() => { if (!plist.hidden) drawListHead(); }); drawListHead(); return; }
      openSheet(shown, a, { shuffle: a.dataset.pa === 'shuffle' }); return;
    }
    const s = ev.target.closest('[data-k]'), song = s && itemOf(s.dataset.k);
    if (song && shown) openSheet(song, s, { list: shown });
  });
  addEventListener('music:rated', () => { if (!plist.hidden) fillRates(plist); });
  return { open: openList };
}
