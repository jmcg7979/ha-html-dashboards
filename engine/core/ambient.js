// The sky behind the dashboard: glow colours follow the sun's elevation (night, dawn/dusk, golden hour, day)
// and turn greyer under cloud or rain. Writes --sky-a / --sky-b / --sky-strength on <html>; tokens.css draws them.
import { st, watch } from './store.js';

// [elevation, upper glow rgb, horizon glow rgb, strength]
const KEYS = [
  [-18, [34, 44, 92], [24, 32, 70], 0.5],
  [-6, [86, 66, 140], [176, 92, 76], 0.55],
  [2, [118, 96, 164], [236, 140, 78], 0.6],
  [12, [96, 128, 196], [222, 170, 110], 0.62],
  [35, [74, 134, 206], [120, 160, 190], 0.6],
];
const GREY = [104, 112, 126];
const CLOUDY = { cloudy: 0.55, fog: 0.6, rainy: 0.6, pouring: 0.7, lightning: 0.5, 'lightning-rainy': 0.65, snowy: 0.45, 'snowy-rainy': 0.6, hail: 0.6, partlycloudy: 0.25, windy: 0.15 };
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

export function ambient(sun = 'sun.sun', weather) {
  const apply = () => {
    const s = st(sun), el = s ? +s.attributes.elevation : -20, w = weather && st(weather);
    let i = KEYS.findIndex((k) => el < k[0]); if (i === -1) i = KEYS.length; 
    const lo = KEYS[Math.max(0, i - 1)], hi = KEYS[Math.min(KEYS.length - 1, i)];
    const t = hi[0] === lo[0] ? 0 : Math.max(0, Math.min(1, (el - lo[0]) / (hi[0] - lo[0])));
    let a = mix(lo[1], hi[1], t), b = mix(lo[2], hi[2], t);
    const grey = w ? CLOUDY[w.state] || 0 : 0;
    if (grey) { a = mix(a, GREY, grey); b = mix(b, GREY, grey); }
    const r = document.documentElement.style;
    r.setProperty('--sky-a', a.join(',')); r.setProperty('--sky-b', b.join(','));
    r.setProperty('--sky-strength', (lo[3] + (hi[3] - lo[3]) * t).toFixed(2));
  };
  document.documentElement.classList.add('sky');
  watch([sun, weather].filter(Boolean), apply);
}
