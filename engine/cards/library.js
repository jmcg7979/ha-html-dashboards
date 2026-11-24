// A media player's library, through Home Assistant's media browser (media_player/browse_media): folders and things to
// play, as a grid of covers. Any player with a media browser works; made for a phone's music apps (the Media Bridge
// integration: Spotify's playlists, SoundCloud's own library).
// { type: 'library', player: 'media_player.x',
//   played: 'now',               the view (or view/page) to show once something was started from here (left out: stay)
//   away: 'The phone isn't connected' }   what it says while the player is unavailable
// The player's top folders are the tabs. Inside one, a tap on a folder opens it (Back goes up), a tap on anything else
// plays it. Fills the page; the grid scrolls.
import { h, esc, icon, setHTML, setText, toggle } from '../core/dom.js';
import { request } from '../core/ha.js';
import { st, watch } from '../core/store.js';
import { run } from '../core/actions.js';
import { artUrl } from '../core/players.js';

const ICON = { playlist: 'playlist-music', directory: 'playlist-music', app: 'music' };

export default function library(cfg) {
  const id = cfg.player;
  const el = h(`<div class="lib"><div class="libtop"><button class="rbtn libback" hidden aria-label="Back">${icon('chevron-left')}</button><div class="libtabs"></div><b class="libtitle"></b></div>
    <div class="libgrid"></div><div class="libnote" hidden></div></div>`);
  const $ = (s) => el.querySelector(s), grid = $('.libgrid'), note = $('.libnote');
  let tabs = [], tab = 0, path = [], kids = [], turn = 0, loaded = false;
  const here = () => path[path.length - 1] || tabs[tab];
  const say = (text) => { note.hidden = !text; setText(note, text || ''); grid.hidden = !!text; };
  const ask = (node) => request({ type: 'media_player/browse_media', entity_id: id, ...(node && node.media_content_id ? { media_content_id: node.media_content_id, media_content_type: node.media_content_type || 'library' } : {}) });

  function top() {
    setHTML($('.libtabs'), tabs.map((t, i) => `<button class="chip${i === tab ? ' on' : ''}" data-tab="${i}">${esc(t.title)}</button>`).join(''));
    $('.libback').hidden = !path.length; $('.libtabs').hidden = !!path.length; setText($('.libtitle'), path.length ? here().title : '');
  }
  function draw() {
    top();
    setHTML(grid, kids.map((k, i) => `<button class="libt${k.can_expand ? ' dir' : ''}" data-i="${i}"><span class="libart">${k.thumbnail ? `<img alt="" loading="lazy" src="${esc(artUrl(k.thumbnail))}">` : icon(ICON[k.media_class] || 'music')}</span><span class="libname">${esc(k.title)}</span></button>`).join(''));
    grid.scrollTop = 0;
    say(kids.length ? '' : 'Nothing here');
  }
  function open() {
    const mine = ++turn, node = here(); top(); toggle(el, 'busy', true);
    ask(node).then((r) => { if (mine !== turn) return; kids = (r && r.children) || []; draw(); },
      (e) => { if (mine !== turn) return; kids = []; setHTML(grid, ''); say((e && e.message) || 'The library did not answer'); })
      .then(() => { if (mine === turn) toggle(el, 'busy', false); });
  }
  function start() {
    const mine = ++turn; loaded = true;
    ask(null).then((r) => { if (mine !== turn) return; tabs = ((r && r.children) || []).filter((c) => c.can_expand); tab = 0; path = [];
      if (tabs.length) open(); else { top(); say('This player has nothing to browse'); } },
    () => { if (mine !== turn) return; loaded = false; say(cfg.away || 'The player is not available'); });
  }

  el.addEventListener('click', (ev) => {
    if (ev.target.closest('.libback')) { path.pop(); open(); return; }
    const tb = ev.target.closest('[data-tab]'); if (tb) { tab = +tb.dataset.tab; path = []; open(); return; }
    const t = ev.target.closest('.libt'); if (!t) return;
    const k = kids[+t.dataset.i]; if (!k) return;
    if (k.can_expand) { path.push(k); open(); return; }
    if (!k.can_play) return;
    run({ call: 'media_player.play_media', target: id, data: { media_content_id: k.media_content_id, media_content_type: k.media_content_type || 'music' } }, { el: t, ev });
    if (cfg.played) setTimeout(() => window.dispatchEvent(new CustomEvent('dash:view', { detail: cfg.played })), 700);
  });

  // the player comes and goes (a phone leaves the network): load when it is there, say so when it isn't
  watch([id], () => {
    const s = st(id), there = !!s && s.state !== 'unavailable';
    if (there && !loaded) start();
    if (!there) { loaded = false; turn++; tabs = []; path = []; kids = []; setHTML(grid, ''); top(); say(cfg.away || 'The player is not available'); }
  });
  return el;
}
