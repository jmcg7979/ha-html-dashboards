// Playing: a heading plus one row per player that is playing, paused, or (TVs) on in a native app; the card hides when none is.
// While a speaker group plays, the speakers in it are folded into the group's row (its pop-up lists them).
// { type: 'media', title: 'Playing', buttons: [...heading buttons],
//   players: [{ entity, name, power: 'media_player.x_remote', ma: 'media_player.x_ma' }] }   (core/players.js)
// Row: art, name, title, artist; one power button (the TV's real power when it has a remote entity, else stop casting),
// next, play/pause. Tap the row for the player's pop-up (#media-<object id>: cards/media-detail.js).
import { h, esc, icon, setText, setHTML, toggle } from '../core/dom.js';
import { st, watch } from '../core/store.js';
import { run } from '../core/actions.js';
import { origin } from '../core/auth.js';
import { F, idsOf, isLive, now, pick, slug, collapse } from '../core/players.js';
import heading from './heading.js';

export const artUrl = (pic) => (pic ? (pic.startsWith('http') ? pic : origin + pic) : '');

// the one power action, always off, so a repeated tap or a lagging state can't turn a TV back on: real TV power if there is a remote entity, else turn the cast off (stops the app)
export const powerAction = (p) => (p.power && (st(p.power) || {}).state !== 'off' ? { call: 'media_player.turn_off', target: p.power } : { call: 'media_player.turn_off', target: p.entity, expect: 'off' });

export default function media(cfg, ctx) {
  const el = h('<div class="media"></div>');
  el.appendChild(heading({ title: cfg.title || 'Playing', buttons: cfg.buttons }));
  const list = h('<div class="mlist"></div>'); el.appendChild(list);
  ctx.setVisible(false);
  const rows = cfg.players.map((p) => {
    const r = h(`<div class="mrow" hidden><div class="mbg"></div><div class="art"></div><div class="tx"><div class="mname">${esc(p.name)}</div><div class="mtrack"></div><div class="martist"></div></div>
      <div class="subs"><button class="sb" data-a="power">${icon('power')}</button><button class="sb" data-a="next">${icon('skip-next')}</button><button class="sb play" data-a="play" style="--t:var(--plum)"></button></div></div>`);
    r.addEventListener('click', (ev) => {
      const b = ev.target.closest('.sb');
      if (!b) { location.hash = '#media-' + slug(p); return; }
      const a = b.dataset.a, n = now(p);
      if (a === 'power') run(powerAction(p), { el: b, ev });
      if (a === 'next') { const id = pick(p, F.NEXT); if (id) run({ call: 'media_player.media_next_track', target: id }, { el: b, ev }); }
      if (a === 'play') { const id = pick(p, F.PAUSE) || pick(p, F.PLAY); if (id) run({ call: 'media_player.media_play_pause', target: id, expect: n && n.state === 'playing' ? 'paused' : n && n.state === 'paused' ? 'playing' : undefined }, { el: b, ev, entity: id }); }
    });
    list.appendChild(r);
    return { p, r, art: r.querySelector('.art'), bg: r.querySelector('.mbg'), title: r.querySelector('.mtrack'), artist: r.querySelector('.martist'), play: r.querySelector('.play'), next: r.querySelector('[data-a="next"]') };
  });
  watch(cfg.players.flatMap(idsOf), () => {
    let any = false;
    const { hidden, members } = collapse(cfg.players);   // speakers inside a playing group fold into the group's row
    rows.forEach((x) => {
      const live = isLive(x.p) && !hidden.has(x.p.entity); x.r.hidden = !live; if (!live) return; any = true;
      const m = members.get(x.p.entity); x.r.style.order = m ? -1 : 0;   // a playing group goes to the top
      const n = now(x.p), url = artUrl(n.pic);
      setHTML(x.art, url ? `<img alt="" src="${esc(url)}">` : icon(x.p.power ? 'television-play' : 'music'));
      if (x.bg.dataset.u !== url) { x.bg.dataset.u = url; x.bg.style.backgroundImage = url ? `url("${url.replace(/"/g, '%22')}")` : ''; }
      setText(x.title, n.title); setText(x.artist, n.artist || n.app);
      const canPlay = !!(pick(x.p, F.PAUSE) || pick(x.p, F.PLAY));
      x.play.hidden = !canPlay; x.next.hidden = !pick(x.p, F.NEXT);
      setHTML(x.play, icon(n.state === 'on' ? 'play-pause' : n.state === 'playing' ? 'pause' : 'play')); toggle(x.play, 'on', true);
    });
    ctx.setVisible(any);
  });
  return el;
}
