// What is behind the player card (cards/media-detail.js), and how one song gives way to the next.
//   const B = backdrop({ el, page, moving })   el: the card (its .mbg); moving: the elements that change place with the
//                                              layout (the art, the song's lines)
//   B.wash(url, brand)   a blurred, darkened wash of the art behind everything (a pop-up: behind the whole pop-up), or
//                        the app's color when it has no art (core/apps.js)
//   B.photo(who)         large screens: a photo of the artist when there is one (core/artistart.js), the wash otherwise;
//                        the card then sits low and small so the picture shows (css .photo). '' : none
//   B.dim(on)            a song change under way        B.off(): nothing plays
//   B.ghosts()           a cross-fade: what is on screen (the art, the song) stays where it was as a copy that fades out,
//                        while the new song fades in under it, wherever the layout now puts it
//   B.fade()             the new song fades in (art, details, backdrop) rather than snapping in
import { h, toggle } from '../../core/dom.js';
import { onDispose } from '../../core/scope.js';
import { tint } from '../../core/artcolor.js';
import { artistPhoto } from '../../core/artistart.js';
import { GHOST_FOR } from '../../core/music-timing.js';

export function backdrop({ el, page, moving }) {
  const bg = el.querySelector('.mbg'), img = bg.querySelector('img'), ph = bg.querySelector('.mphoto');
  let popup = null, moved = false, brandKey = null, photoFor = null;
  onDispose(() => bg.remove());
  const refade = (e) => { e.classList.remove('fadein'); void e.offsetWidth; e.classList.add('fadein'); };
  const layer = h('<div class="mghosts"></div>'); el.appendChild(layer);
  function ghosts() {
    if (!el.isConnected || el.classList.contains('idle') || document.hidden) return;
    const host = layer.getBoundingClientRect(), k = layer.offsetWidth ? host.width / layer.offsetWidth : 1;   // k: a zoomed view
    if (!host.width) return;
    moving.forEach((e) => { const r = e.getBoundingClientRect(); if (!r.width || !r.height) return;
      const g = e.cloneNode(true); g.classList.remove('fadein'); g.classList.add('mghost');
      g.style.cssText = `left:${(r.left - host.left) / k}px;top:${(r.top - host.top) / k}px;width:${r.width / k}px;height:${r.height / k}px`;
      layer.appendChild(g); setTimeout(() => g.remove(), GHOST_FOR); });
  }
  function wash(url, brand) {
    popup = popup || el.closest('.popup');
    if (popup && !moved) { moved = true; popup.classList.add('amb', 'ambg'); popup.insertBefore(bg, popup.firstChild); }
    if (url && img.getAttribute('src') !== url) img.src = url;
    toggle(bg, 'has', !!url);
    const key = url ? '' : brand ? brand.color : '';
    if (key === brandKey || !(popup || page)) return; brandKey = key;   // (the first draw comes before the card is in its pop-up)
    const c = key ? tint(brand.color) : null;
    if (popup) { popup.classList.toggle('amb-art', !!c); if (c) { popup.style.setProperty('--amb-a', c.a); popup.style.setProperty('--amb-b', c.b); } }
    if (c) el.style.setProperty('--t', c.accent); else el.style.removeProperty('--t');
  }
  // the new picture is loaded before it is swapped in
  const setPhoto = (u) => { if (u) ph.src = u; toggle(bg, 'photo', !!u);
    if (el.classList.contains('photo') !== !!u) { ghosts(); toggle(el, 'photo', !!u); moving.forEach(refade); } };   // the layout changes: as a cross-fade, not a jump
  function photo(who) {
    if (who === photoFor) return; photoFor = who;
    toggle(bg, 'photo', false);   // another artist: the last one's picture goes at once (the layout waits for the answer, so it doesn't jump twice)
    if (!who) { setPhoto(null); return; }
    artistPhoto(who).then((u) => {
      if (photoFor !== who) return;
      if (!u) { setPhoto(null); return; }
      const im = new Image(); im.onload = () => { if (photoFor === who) setPhoto(u); }; im.onerror = () => { if (photoFor === who) setPhoto(null); }; im.src = u;
    });
  }
  return { wash, photo, ghosts, fade: () => [...moving, bg].forEach(refade), dim: (on) => toggle(bg, 'dim', on),
    off() { toggle(bg, 'has', false); toggle(bg, 'dim', false); photo(''); } };
}
