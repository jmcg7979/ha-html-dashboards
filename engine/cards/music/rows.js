// How the Music page draws an item: a list row, a tile, its artwork, and the numbers and sizes that are filled in when
// they come. Styles: css/cards/music.css.
//   row(it, { kind, from, n, at }) tile(it) art(it, size) -> html (the element carries data-k: items.js itemOf)
//   empty(text) -> the line a list shows in place of rows      NO_MA: what it says with Music Assistant away
//   fillSizes(root)  fillRates(root): the playlist sizes and the ratings of the rows under root, as they arrive
import { esc, icon, setHTML } from '../../core/dom.js';
import * as MA from '../../core/ma.js';
import { rating } from '../../core/rank.js';
import { SET, KIND, source, who, length, hue, put, itemOf } from './items.js';
import { numbersOf, rateable, sizeOf } from './numbers.js';

// artwork: MA's (through its image proxy), else a color from the name with the kind's icon
export function art(it, size = 160) {
  const src = MA.image(it, size);
  if (src) return `<span class="mart"><img alt="" loading="lazy" src="${esc(src)}"></span>`;
  const ic = it.media_type === 'artist' ? 'account-music' : it.media_type === 'track' ? (it.duration >= SET ? 'waveform' : 'music') : 'playlist-music';
  return `<span class="mart gen" style="--h:${hue(it.name)}">${icon(ic)}</span>`;
}

// a row's number: a heart with saves / likes, a flame with Spotify's popularity
function rateHTML(it, k) {
  const r = rating(it, numbersOf(it));
  if (r) return `<b class="mrate ${r.kind}" title="${esc(r.title)}">${icon(r.kind === 'pop' ? 'fire' : 'heart')}${esc(r.text)}</b>`;
  return rateable(it) && k ? `<b class="mrate" data-rate="${k}"></b>` : '';
}
export function fillRates(root) {   // numbers that came after their rows were drawn
  root.querySelectorAll('[data-rate]').forEach((el) => { const it = itemOf(el.dataset.rate); if (!it) return; const r = rating(it, numbersOf(it)); if (!r) return;
    el.removeAttribute('data-rate'); el.className = 'mrate ' + r.kind; el.title = r.title; setHTML(el, icon(r.kind === 'pop' ? 'fire' : 'heart') + esc(r.text)); });
}

export function fillSizes(root) {   // one at a time, so a list of 20 doesn't ask MA for 20 playlists at once
  const todo = [...root.querySelectorAll('[data-size]')];
  const next = () => { const el = todo.shift(); if (!el || !el.isConnected) return; const it = itemOf(el.dataset.size); if (!it) return next(); sizeOf(it).then((t) => { el.textContent = t; next(); }); };
  next();
}

// a list row: art, name, who / source, and on the right what others think of it and what you need to choose (a set's
// length; a playlist's size)
export function row(it, opt = {}) {
  const k = put(it), t = it.media_type, set = t === 'track' && it.duration >= SET;
  const meta = t === 'track' ? `<span class="mlen${set ? ' set' : ''}">${esc(length(it.duration))}</span>` : t === 'playlist' ? `<span class="msize" data-size="${k}"></span>` : `<span class="mkind">${esc(KIND[t] || '')}</span>`;
  const sub = [opt.kind ? (set ? 'DJ set' : KIND[t]) : '', who(it), opt.from ? '' : source(it)].filter(Boolean).join(' · ');
  const num = opt.n ? `<span class="mnum">${opt.n}</span>` : '';
  return `<button class="mrow" data-k="${k}"${opt.at != null ? ` data-at="${opt.at}"` : ''}${t === 'playlist' ? ' data-hold' : ''}>${num}${art(it, 80)}<span class="mtx"><b>${esc(it.name)}</b><small>${esc(sub)}</small></span><span class="mrmeta">${rateHTML(it, k)}${meta}</span>${it.favorite ? `<i class="mpin">${icon('pin')}</i>` : ''}</button>`;
}
export function tile(it) {
  const k = put(it);
  return `<button class="mtile" data-k="${k}"${it.media_type === 'playlist' ? ' data-hold' : ''}>${art(it, 160)}<span class="mtx"><b>${esc(it.name)}</b><small>${esc([who(it), source(it)].filter(Boolean).join(' · '))}</small></span></button>`;
}
export const empty = (text) => `<div class="mempty">${esc(text)}</div>`;
export const NO_MA = 'Music Assistant isn’t reachable right now (Music Assistant, or Home Assistant’s link to it, is down).';
