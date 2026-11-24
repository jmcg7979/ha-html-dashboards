// The Music page's Videos (TV): music videos are YouTube's, not MA's (MA plays audio only); OK opens the YouTube app on
// a search. A site can give its own tiles (the card's `videos`: [{ name, q, icon }]).
import { esc, icon, setHTML } from '../../core/dom.js';
import { open as tvOpen, onTV } from '../../core/tvhost.js';
import { hue } from './items.js';

const VIDEOS = [
  { name: 'Pop', q: 'pop music videos playlist' }, { name: 'Hip-hop', q: 'hip hop music videos playlist' }, { name: 'Dance', q: 'dance music videos playlist' },
  { name: '2000s', q: '2000s music videos playlist' }, { name: '90s', q: '90s music videos playlist' }, { name: 'Country', q: 'country music videos playlist' },
  { name: 'Rock', q: 'rock music videos playlist' }, { name: 'Latin', q: 'latin music videos playlist' },
].map((v) => ({ icon: 'youtube', ...v }));

export default function videos({ body, videos: own }) {
  const list = own || VIDEOS;
  setHTML(body, `<div class="label caption mhead">Music videos · opens YouTube</div><div class="mvids">${list.map((v, i) => `<button class="mvid" data-v="${i}" style="--h:${hue(v.name)}">${icon(v.icon)}<b>${esc(v.name)}</b></button>`).join('')}</div>`);
  body.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-v]'); if (!b) return;
    const q = encodeURIComponent(list[+b.dataset.v].q);
    if (onTV) tvOpen(`intent://www.youtube.com/results?search_query=${q}#Intent;scheme=https;package=com.google.android.youtube.tv;end`);
    else window.open('https://www.youtube.com/results?search_query=' + q, '_blank');
  });
}
