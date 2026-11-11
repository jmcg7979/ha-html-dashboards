// Continue watching: what the TV's apps say you're in the middle of (Android TV's Watch Next list, core/tvhost.js), as a
// row of artwork with the title, the episode and how far in you are. OK opens that exact episode in its app.
// Hidden while the list is empty (and in a browser without &tvdemo=1). Refreshed whenever the screen comes back (tv:resume).
// { type: 'watchnext', title: 'Continue watching', limit: 12 }
import { h, esc } from '../core/dom.js';
import { watchNext, open, launch, banner } from '../core/tvhost.js';

const APP = { 'com.netflix.ninja': 'Netflix', 'com.disney.disneyplus': 'Disney+', 'com.wbd.stream': 'HBO Max', 'com.hulu.livingroomplus': 'Hulu',
  'tv.emby.embyatv': 'Emby', 'com.plexapp.android': 'Plex', 'com.amazon.amazonvideo.livingroom': 'Prime Video', 'com.apple.atve.androidtv.appletv': 'Apple TV' };

export default function watchnextCard(cfg, ctx) {
  const el = h(`<div class="wnext"><div class="label caption">${esc(cfg.title || 'Continue watching')}</div><div class="wnrow hrow"></div></div>`);
  const row = el.querySelector('.wnrow');
  let items = [];
  const draw = () => {
    const all = watchNext() || [], seen = new Set();
    // one card per show: apps keep an entry per episode
    items = all.filter((x) => !x.error && x.title && !seen.has(x.package_name + '|' + x.title) && seen.add(x.package_name + '|' + x.title)).slice(0, cfg.limit || 12);
    if (ctx && ctx.setVisible) ctx.setVisible(items.length > 0);
    row.innerHTML = items.map((x, i) => {
      const pos = +x.last_playback_position_millis || 0, dur = +x.duration_millis || 0, pct = dur ? Math.min(100, Math.round((pos / dur) * 100)) : 0;
      const ep = x.season_display_number && x.episode_display_number ? `S${x.season_display_number} · E${x.episode_display_number}` : '';
      const sub = [ep, x.episode_title].filter(Boolean).join('  ') || APP[x.package_name] || '';
      const art = x.thumbnail_uri || x.poster_art_uri;
      return `<button class="wn" data-i="${i}"><span class="wnart">${art ? `<img alt="" loading="lazy" src="${esc(art)}">` : `<img alt="" src="${esc(banner(x.package_name))}">`}
        <img class="wnapp" alt="" src="${esc(banner(x.package_name))}">${pct ? `<i style="--p:${pct}%"></i>` : ''}</span>
        <span class="wntitle">${esc(x.title)}</span><span class="wnsub">${esc(sub)}</span></button>`;
    }).join('');
    row.querySelectorAll('img').forEach((im) => { im.onerror = () => { im.style.visibility = 'hidden'; }; });
  };
  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('.wn'); if (!b) return;
    const x = items[+b.dataset.i];
    if (!(x.intent_uri && open(x.intent_uri))) launch(x.package_name);
  });
  draw();
  addEventListener('tv:resume', draw);
  return el;
}
