// The Music page's Moods and DJ sets: a row of tiles, the results of the one picked under it (find.js lister).
// A site can give its own tiles (the card's `moods` / `dj`: [{ name, q, icon }]).
import { esc, icon, toggle, setHTML } from '../../core/dom.js';
import { lister, sorting } from './find.js';

const MOODS = [
  { name: 'Upbeat party', q: 'upbeat party', icon: 'party-popper' }, { name: 'Chill', q: 'chill', icon: 'weather-night' },
  { name: 'Dinner', q: 'dinner music', icon: 'silverware-fork-knife' }, { name: 'Focus', q: 'focus music', icon: 'head-lightbulb-outline' },
  { name: 'Workout', q: 'workout', icon: 'dumbbell' }, { name: 'Kids', q: 'kids party songs', icon: 'teddy-bear' },
  { name: 'Road trip', q: 'road trip', icon: 'car-outline' }, { name: 'Rainy day', q: 'rainy day', icon: 'weather-pouring' },
];
const DJ = [
  { name: 'Deep house', q: 'deep house dj set', icon: 'waveform' }, { name: 'Techno', q: 'techno dj set', icon: 'waveform' },
  { name: 'Afro house', q: 'afro house dj set', icon: 'waveform' }, { name: 'Melodic', q: 'melodic techno dj set', icon: 'waveform' },
  { name: 'Hip-hop', q: 'hip hop dj mix', icon: 'waveform' }, { name: 'Open format', q: 'open format dj set', icon: 'waveform' },
  { name: 'Disco house', q: 'disco house dj set', icon: 'waveform' }, { name: 'Drum & bass', q: 'drum and bass dj set', icon: 'waveform' },
];
function results({ body }, list, types, kind, what) {
  setHTML(body, `<div class="mchips hrow">${list.map((m, i) => `<button class="mchip${i ? '' : ' on'}" data-c="${i}">${icon(m.icon || 'music')}<span>${esc(m.name)}</span></button>`).join('')}</div>
    <div class="mheadrow"><div class="label caption mhead"></div><i data-slot="sort"></i></div><div class="mlist" data-enter=".mrow" data-backto=".mchip.on"></div>`);
  const L = lister(body.querySelector('.mlist'), { none: kind === 'set' ? 'No sets of 20 minutes or more' : 'Nothing found', end: (n) => `That’s all ${n} have for this` });
  const show = (i) => {
    const m = list[i];
    body.querySelectorAll('.mchip[data-c]').forEach((c) => toggle(c, 'on', +c.dataset.c === i));
    body.querySelector('.mhead').textContent = `${m.name} · ${what}`;
    L.show(m.q, types, kind);
  };
  body.querySelector('.mchips').addEventListener('click', (ev) => { const c = ev.target.closest('[data-c]'); if (c) show(+c.dataset.c); });
  sorting(body.querySelector('[data-slot="sort"]'), () => L.resort());
  show(0);
}

export const moods = (c) => results(c, c.moods || MOODS, ['playlist'], 'playlist', 'Playlists');
export const dj = (c) => results(c, c.dj || DJ, ['track'], 'set', 'Sets of 20 minutes or more');
