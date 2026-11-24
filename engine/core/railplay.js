// The song that plays, in the rail of every view: its cover (a tap opens the player's view) over a play / pause button.
// Nothing shows while nothing plays. A dashboard asks for it with
//   playing: { player: <a `players` entry of home.js>, view: 'music' }
// For a screen that stays on one dashboard all day (a wall tablet): the music is one tap away from any view.
import { h, icon, setHTML, toggle } from './dom.js';
import { artUrl } from './players.js';
import { session } from './session.js';

export function railPlaying(rail, cfg) {
  const S = session(cfg.player);   // the song as every card shows it, and its play / pause (core/session.js)
  const el = h(`<div class="rplay" hidden><button class="rpart" aria-label="Now playing"></button><button class="rbtn rpgo" aria-label="Play or pause"></button></div>`);
  rail.appendChild(el);   // under the views and under a view's pages alike
  const art = el.querySelector('.rpart'), go = el.querySelector('.rpgo');
  art.addEventListener('click', () => window.dispatchEvent(new CustomEvent('dash:view', { detail: cfg.view })));
  go.addEventListener('click', (ev) => S.act('play', { el: go, ev }));
  const draw = (v) => {
    const n = v.n; el.hidden = !n; if (!n) return;
    const url = artUrl(n.pic);
    if (art.dataset.u !== url) { art.dataset.u = url; setHTML(art, url ? `<img alt="" src="${url.replace(/"/g, '%22')}">` : icon('music')); }
    const playing = n.state === 'playing' || !!n.starting;
    setHTML(go, icon(playing ? 'pause' : 'play')); toggle(go, 'on', playing);
    go.hidden = !(n.stopped || v.caps.pause || v.caps.play);
  };
  S.on(draw, { queue: false });   // for as long as the page: the rail is never unloaded
  draw(S.snap);
}
