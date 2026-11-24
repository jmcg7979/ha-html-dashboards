// What comes next on the player card (cards/media-detail.js) for a player that isn't Music Assistant's, read-only, where
// an MA queue would be: the player's own `queue` attribute ([{ title, artist, image, uri, id }]: a phone through Media
// Bridge; a tap on a song plays it), else Spotify's list for the account playing here (core/spotify.js, SpotifyPlus: a
// player names it as `spotifyQueue`).
//   const U = upNext({ list, p, redraw })   list: the .pqlist element; redraw(): Spotify's list came in
//   U.items(view) -> [{ name, artist, duration, pic, uri, qid }]      U.draw(view, items)
import { esc, setHTML, toggle } from '../../core/dom.js';
import { st } from '../../core/store.js';
import * as SP from '../../core/spotify.js';
import { songCells } from '../../core/queue-ui.js';
import { artUrl } from '../../core/players.js';

export function upNext({ list, p, redraw }) {
  const own = (view) => { const q = view.n && !view.live && (st(p.entity) || { attributes: {} }).attributes.queue;
    return Array.isArray(q) ? q.map((t) => ({ name: t.title || '', artist: t.artist || '', duration: 0, pic: artUrl(t.image || ''), uri: t.uri || String(t.id), qid: t.id })) : []; };
  function items(view) {
    const mine = own(view); if (mine.length) return mine;
    const n = view.n, e = n && !view.live && view.spotify; if (!e || ![].concat(p.spotifyQueue || []).includes(e)) return [];   // the account playing here has SpotifyPlus
    SP.want(e, n.title, redraw);
    const g = SP.get(e); return g.title === n.title || g.fresh ? g.items : [];
  }
  // laid out as Music Assistant's queue (core/queue-ui.js): Now playing, lit, with the bars on its art, then Up next
  function draw(view, songs) {
    const n = view.n, now = n && n.title ? n : null, pic = now && artUrl(now.pic);
    toggle(list.parentElement, 'playing', !!now && now.state === 'playing');
    const key = [now ? now.title + '\n' + (now.artist || '') + '\n' + (pic || '') : '', ...songs.map((i) => i.uri)].join('|');
    if (list.dataset.k === key) return; list.dataset.k = key;
    setHTML(list, (now ? `<div class="pqh2 nowh">Now playing</div><div class="pqr now"><div class="pqi now">${songCells({ pic, title: now.title, artist: now.artist }, true)}</div></div>` : '')
      + `<div class="pqh2">Up next <span>${songs.length}</span></div>` + songs.map((t) => `<div class="pqr"><div class="pqi up${t.qid != null ? ' jump' : ''}"${t.qid != null ? ` data-qid="${esc(String(t.qid))}"` : ''}>${songCells({ pic: t.pic, title: t.name, artist: t.artist, duration: t.duration })}</div></div>`).join(''));
  }
  return { items, draw };
}
