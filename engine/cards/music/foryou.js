// The Music page's For you: three labeled groups, each says what it is. Made for you and Pinned are one row each;
// Recently played wraps and fills the rest of the card, scrolling in it. It is what the house picked to play (a playlist, an
// artist, a song chosen itself; not each song a playlist went through), finished or not, whoever started it (MA.recent()).
// Its heading has Search's filters, for what is in the list: the kind, and a chip for each service.
import { setHTML } from '../../core/dom.js';
import * as MA from '../../core/ma.js';
import { pick } from '../../core/pick.js';
import { LIBRARY_KEPT, RECENT_KEPT } from '../../core/music-timing.js';
import { domain, kindOf } from './items.js';
import { tile, empty, NO_MA } from './rows.js';
import { servicesNow, inOrder, sourcePick } from './find.js';

const MADE = /^(discover weekly|release radar|daily mix|daylist|on repeat|repeat rewind|time capsule|your top songs)/i;
// Recently played's kinds, in Search's order
const RKINDS = [['playlist', 'Playlists'], ['set', 'DJ sets'], ['song', 'Songs'], ['artist', 'Artists'], ['album', 'Albums'], ['radio', 'Radio']];
function order(n) { return [/^discover/i, /^release/i, /^daylist/i, /^daily mix/i, /^on repeat/i].findIndex((r) => r.test(n)) + 1 || 9; }

export default function foryou({ el, body }) {
  const head = (k, t) => (k === 'recent' ? `<div class="mheadrow mrecent"><div class="label caption mhead">${t}</div><span class="mpicks"></span></div>` : `<div class="label caption">${t}</div>`);
  setHTML(body, `<div class="mrows">${[['made', 'Made for you'], ['pins', 'Pinned'], ['recent', 'Recently played']].map(([k, t]) => `<div class="mgroup${k === 'recent' ? ' mfill' : ''}">${head(k, t)}<div class="mline ${k === 'recent' ? 'mwrap' : 'hrow'}" data-g="${k}"><div class="mempty">…</div></div></div>`).join('')}</div>`);
  const g = (k) => body.querySelector(`[data-g="${k}"]`);
  // Recently played: the list as the relay gave it; a chip for the kinds shown (of the kinds in the list; any of them, or all) and one for the
  // services (kept on this screen), each there when it has something to choose between
  let played = [];
  const services = () => inOrder(new Set(played.map(domain)));
  const drawRecent = () => {
    const use = srcP.on(services()), kinds = kindP.value(), list = played.filter((x) => use.includes(domain(x)) && (!kinds.size || kinds.has(kindOf(x))));
    setHTML(g('recent'), list.map(tile).join('') || empty(played.length ? 'Nothing played lately fits these filters' : 'Nothing played yet'));
    g('recent').scrollTop = 0;
  };
  const kindP = pick({ label: 'Type', multi: true, cls: 'mchip', tone: 'plum', onChange: drawRecent });
  const srcP = sourcePick('music.recentSrc', drawRecent);
  kindP.el.hidden = true;
  body.querySelector('.mpicks').append(kindP.el, srcP.el);
  const offer = () => {
    const kinds = RKINDS.filter(([k]) => played.some((x) => kindOf(x) === k));
    kindP.set({ options: kinds.map(([id, name]) => ({ id, name })) }); kindP.el.hidden = kinds.length < 2;
    srcP.offer(services());
  };
  const draw = () => MA.available().then((ok) => {
    if (!ok) { setHTML(body, empty(NO_MA)); return; }
    MA.kept('lib:all', LIBRARY_KEPT, () => MA.cmd('music/playlists/library_items', { limit: 500 })).then((all) => {
      const list = (all && all.items) || all || [];
      const made = list.filter((p) => MADE.test(p.name) && /spotify/i.test(p.owner || '') && domain(p) === 'spotify')
        .sort((a, b) => order(a.name) - order(b.name) || a.name.localeCompare(b.name));
      setHTML(g('made'), made.map(tile).join('') || empty('Spotify’s made-for-you playlists show up once the account has listened for a while'));
      const pins = list.filter((p) => p.favorite);
      setHTML(g('pins'), pins.map(tile).join('') || empty(document.documentElement.classList.contains('remote') ? 'Nothing pinned yet. Hold OK on any playlist to pin it here.' : 'Nothing pinned yet. Tap any playlist, then Pin.'));
    }, () => setHTML(g('made'), empty('Music Assistant didn’t answer')));
    Promise.all([MA.kept('recent', RECENT_KEPT, () => MA.recent()), servicesNow().catch(() => [])]).then(([r]) => {   // servicesNow: the services' names
      const seen = new Set();
      // a library item says its service the way the other lists' items do (provider_mappings)
      played = (r || []).filter((x) => x && x.uri && !seen.has(x.uri) && seen.add(x.uri))
        .map((x) => (x.provider === 'library' && x.domain && !x.provider_mappings ? { ...x, provider_mappings: [{ provider_domain: x.domain }] } : x));
      offer(); drawRecent();
    }, () => { if (g('recent')) setHTML(g('recent'), empty('Music Assistant didn’t answer')); });
  });
  draw();
  addEventListener('music:pins', () => { if (el.isConnected) draw(); });
}
