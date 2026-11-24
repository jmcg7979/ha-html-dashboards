// Playing: a heading plus one row per player that is playing, paused (a Music Assistant queue that stopped with a song counts
// as paused for two hours: players.js stoppedLong), or (TVs) on in a native app; the card hides when none is.
// While a speaker group plays, the speakers in it are folded into the group's row (its pop-up lists them).
// { type: 'media', title: 'Playing', buttons: [...heading buttons],
//   players: [{ entity, name, power: 'media_player.x_remote', ma: 'media_player.x_ma' }] }   (core/players.js)
// A TV is only listed with something really playing or an app open: not when it's off, and not for a Chromecast that's merely awake (core/players.js).
// Row: art, name, title, artist; an app that publishes no title and art (Hulu, Netflix…) gets its logo, color and playing state instead (core/apps.js).
// Buttons: power on a TV with a remote entity (the TV's real power; a speaker has none: on one it repeated Stop, or did
// nothing), next, play/pause. Tap the row for the player's pop-up (#media-<object id>: cards/media-detail.js).
// A row shows its player's session (core/session.js: the song as every screen shows it, smoothed through song changes;
// nothing after this screen's own Stop) and its buttons are the session's.
import { h, esc, icon, setText, setHTML, toggle } from '../core/dom.js';
import { watch, tick, soon } from '../core/store.js';
import { run } from '../core/actions.js';
import { onDispose } from '../core/scope.js';
import { idsOf, mediaPopupId, collapse, statusLine, stoppedLong, artUrl, powerAction } from '../core/players.js';
import { plusRooms } from '../core/sync.js';
import { session } from '../core/session.js';
import { appLogo } from '../core/apps.js';
import heading from './heading.js';

// what a row shows of its player: the session's song, unless it is only a screen that is awake or a queue that stopped long ago
const shownOf = (S) => { const n = S.snap.n; return n && !n.screen && !stoppedLong(n) ? n : null; };

export default function media(cfg, ctx) {
  const el = h('<div class="media"></div>');
  el.appendChild(heading({ title: cfg.title || 'Playing', buttons: cfg.buttons }));
  const list = h('<div class="mlist"></div>'); el.appendChild(list);
  ctx.setVisible(false);
  const rows = cfg.players.map((p) => {
    const S = session(p);
    const r = h(`<div class="mrow" data-focus data-subs hidden><div class="mrbg"></div><div class="art"></div><div class="tx"><div class="mname">${esc(p.name)}</div><div class="mtrack"></div><div class="martist"></div></div>
      <div class="subs">${p.power ? `<button class="sb" data-a="power" aria-label="Turn off TV">${icon('power')}</button>` : ''}<button class="sb" data-a="next" aria-label="Next">${icon('skip-next')}</button><button class="sb play" data-a="play" aria-label="Play or pause" style="--t:var(--plum)"></button></div></div>`);
    r.addEventListener('click', (ev) => {
      const b = ev.target.closest('.sb');
      if (!b) { location.hash = '#' + mediaPopupId(p); return; }
      const a = b.dataset.a;
      if (a === 'power') { S.ending(); run(powerAction(p), { el: b, ev }); }   // turned off from here: the music ends, no song is held as if another were coming
      else S.act(a, { el: b, ev });   // play (a stopped queue plays on) / next, as in the player's pop-up
    });
    list.appendChild(r);
    return { p, S, r, art: r.querySelector('.art'), bg: r.querySelector('.mrbg'), title: r.querySelector('.mtrack'), artist: r.querySelector('.martist'), play: r.querySelector('.play'), next: r.querySelector('[data-a="next"]') };
  });
  const line = (x, n) => setText(x.artist, n.artist || (n.bare ? statusLine(n) : n.app));
  tick(() => rows.forEach((x) => { const n = !x.r.hidden && shownOf(x.S); if (n && n.bare) line(x, n); }));   // the "18:52 in" counts up
  const update = () => {
    let any = false;
    const { hidden, members } = collapse(cfg.players);   // speakers inside a playing group fold into the group's row
    rows.forEach((x) => {
      const v = x.S.snap, n = shownOf(x.S), live = !!n && !hidden.has(x.p.entity);
      x.r.hidden = !live; x.paused = live && !!n.stopped; if (!live) return; any = true;
      const m = members.get(x.p.entity); x.r.style.order = m ? -1 : 0;   // a playing group goes to the top
      // rooms in sync (core/sync.js) are one row, named after them: "Kitchen + Living Room", "Kitchen + 2 rooms"
      setText(x.r.querySelector('.mname'), m && !x.p.group ? plusRooms([x.p.name, ...m]) : x.p.name);
      const url = artUrl(n.pic), brand = url ? null : n.brand;
      setHTML(x.art, url ? `<img alt="" src="${esc(url)}">` : brand ? appLogo(brand) : icon(x.p.power ? 'television-play' : 'music'));
      toggle(x.r, 'branded', !!brand); if (brand) x.r.style.setProperty('--app', brand.color);
      if (x.bg.dataset.u !== url) { x.bg.dataset.u = url; x.bg.style.backgroundImage = url ? `url("${url.replace(/"/g, '%22')}")` : ''; }
      setText(x.title, n.title); line(x, n);
      // paused the way MA pauses a player that can't (stopped, the song kept): Play takes it up again, nothing to skip
      x.play.hidden = !n.stopped && !(v.caps.pause || v.caps.play); x.next.hidden = !!n.stopped || n.bare || !v.caps.next;
      setHTML(x.play, icon(n.state === 'on' ? 'play-pause' : n.state === 'playing' || n.starting ? 'pause' : 'play')); toggle(x.play, 'on', true);
    });
    ctx.setVisible(any);
  };
  // every player's entities (which rows fold into which) and each player's session (its song settling): one update a burst
  const later = soon(update);
  watch(cfg.players.flatMap(idsOf), later);
  rows.forEach((x) => onDispose(x.S.on(later, { queue: false })));
  tick(() => { if (rows.some((x) => x.paused && stoppedLong(x.S.snap.n))) update(); });   // paused for too long: the row goes with no change of state to say so
  return el;
}
