// Music playing on this screen's player: full-screen "Now playing" (TV) or a slim bar that leads to it.
// { type: 'nowplaying', player: { entity, ma, power, spotify, name },   a `players` entry from home.js (core/players.js decides
//   mode: 'full' | 'bar',                                               what really plays here: stale Spotify sessions, MA mirrors)
//   view: 'now',        bar: OK opens this view
//   auto: 'now' }       open this view when music starts on the player (TV: casting music to it)
// Music = an MA queue, media_content_type music, or an app that only plays music (MUSIC_APPS). Video never counts.
// Full: the artwork large over a blurred wash of itself, title, artist, album, progress, previous / play-pause / next.
import { h, icon, setText, setHTML, toggle, mmss } from '../core/dom.js';
import { watch } from '../core/store.js';
import { origin } from '../core/auth.js';
import { run } from '../core/actions.js';
import { now, idsOf, pick, elapsed, maLive, F } from '../core/players.js';

const MUSIC_APPS = /spotify|music assistant|youtube music|pandora|tidal|deezer|soundcloud|plexamp|apple music/i;
export function musicOn(p) {
  if (!p) return null;
  const n = now(p);
  if (!n || n.screen || n.bare || !['playing', 'paused', 'buffering'].includes(n.state)) return null;
  return maLive(p) || n.a.media_content_type === 'music' || MUSIC_APPS.test(n.app || '') || MUSIC_APPS.test(n.a.app_name || '') ? n : null;
}
const art = (n) => (!n.pic ? '' : /^https?:/.test(n.pic) ? n.pic : origin + n.pic);

export default function nowplaying(cfg, ctx) {
  const P = cfg.player, ids = P ? idsOf(P) : [], full = cfg.mode !== 'bar';
  const el = full
    ? h(`<div class="np"><div class="npbg"><img alt=""></div><div class="npart"><img alt=""></div>
        <div class="nptx"><div class="label caption npsrc"></div><div class="nptitle"></div><div class="npartist"></div><div class="npalbum"></div>
          <div class="npbar"><span class="npcur"></span><span class="nptrack"><i></i></span><span class="npdur"></span></div>
          <div class="npctl"><button class="rbtn" data-a="prev">${icon('skip-previous')}</button><button class="rbtn npplay" data-a="play" data-focus-first></button><button class="rbtn" data-a="next">${icon('skip-next')}</button></div>
        </div><div class="npnone">Nothing playing on this TV.</div></div>`)
    : h(`<button class="npb"><span class="npbart"><img alt=""></span><span class="npbtx"><span class="label caption">Now playing</span><b></b><small></small></span><span class="npbgo">${icon('chevron-right')}</span></button>`);
  const imgs = [...el.querySelectorAll('img')];
  let cur = null, was = null, tick = 0;   // was: null until the first state, so a page opened mid-song stays where it is

  const draw = () => {
    cur = musicOn(P);
    if (!full && ctx && ctx.setVisible) ctx.setVisible(!!cur);
    // music started on this TV: go to the full screen (only on a real start, not when the page loads mid-song)
    if (cfg.auto && cur && cur.state === 'playing' && was === false) window.dispatchEvent(new CustomEvent('dash:view', { detail: cfg.auto }));
    was = !!cur && cur.state === 'playing';
    toggle(el, 'idle', !cur);
    if (!cur) return;
    const src = art(cur);
    imgs.forEach((im) => { if (src && im.getAttribute('src') !== src) im.src = src; im.style.visibility = src ? '' : 'hidden'; });
    if (full) {
      setText(el.querySelector('.npsrc'), ['Now playing', maLive(P) ? 'Music Assistant' : cur.app].filter(Boolean).join(' · '));
      setText(el.querySelector('.nptitle'), cur.title);
      setText(el.querySelector('.npartist'), cur.artist);
      setText(el.querySelector('.npalbum'), cur.album);
      setHTML(el.querySelector('.npplay'), icon(cur.state === 'playing' ? 'pause' : 'play'));
      progress();
    } else {
      setText(el.querySelector('b'), cur.title);
      setText(el.querySelector('small'), cur.artist);
    }
  };
  const progress = () => {
    if (!cur || !full) return;
    const d = +cur.a.media_duration || 0, p = elapsed(cur) || 0;
    setText(el.querySelector('.npcur'), mmss(p)); setText(el.querySelector('.npdur'), d ? mmss(d) : '');
    el.querySelector('.nptrack i').style.width = d ? (100 * p / d).toFixed(2) + '%' : '0';
  };
  watch(ids, draw);
  if (full) { clearInterval(tick); tick = setInterval(() => { if (!document.hidden) progress(); }, 1000); }

  el.addEventListener('click', (ev) => {
    if (!full) { if (cfg.view) window.dispatchEvent(new CustomEvent('dash:view', { detail: cfg.view })); return; }
    const b = ev.target.closest('[data-a]'); if (!b || !cur) return;
    const [svc, bit] = { prev: ['media_previous_track', F.PREV], play: ['media_play_pause', F.PAUSE], next: ['media_next_track', F.NEXT] }[b.dataset.a];
    const id = pick(P, bit) || (bit === F.PAUSE && pick(P, F.PLAY)); if (id) run({ call: 'media_player.' + svc, target: id }, { el: b, ev });
  });
  return el;
}
