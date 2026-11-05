// Colours from album art for the media pop-up's backdrop (Apple Music style).
// The art must be same-origin (HA's media_player_proxy) or the canvas can't be read; then this resolves null.
// Returns { a, b, accent } as 'r, g, b' strings: a = the art's most vivid colour, darkened for white text;
// b = a deep shade of the darker half; accent = a light tint of a for active buttons. Cached per URL.
const cache = new Map();

export function artColors(url) {
  if (!url) return Promise.resolve(null);
  if (!cache.has(url)) cache.set(url, new Promise((done) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { try { done(analyse(img)); } catch (e) { done(null); } };
    img.onerror = () => done(null);
    img.src = url;
  }));
  return cache.get(url);
}

// The same three colours from a single 'r, g, b' colour (an app's, when it has no art).
export function tint(color) {
  const [r, g, b] = color.split(',').map(Number), [h, s] = hsl(r, g, b), sat = Math.min(0.75, Math.max(0.25, s));
  return { a: rgb(h, sat, 0.34), b: rgb(h, Math.min(0.5, sat), 0.1), accent: rgb(h, Math.min(0.85, sat + 0.15), 0.74) };
}

function analyse(img) {
  const n = 24, c = document.createElement('canvas'); c.width = c.height = n;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, n, n);
  const d = x.getImageData(0, 0, n, n).data;
  let best = null, bw = -1, dark = [0, 0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    const [h, s, l] = hsl(d[i], d[i + 1], d[i + 2]);
    const w = s * (1 - Math.abs(l - 0.5) * 1.6);          // vivid, not near black/white
    if (w > bw) { bw = w; best = [h, s, l]; }
    if (l < 0.5) { dark[0] += d[i]; dark[1] += d[i + 1]; dark[2] += d[i + 2]; dark[3]++; }
  }
  if (!best || bw < 0.05) best = [0.62, 0.15, 0.4];          // greyscale art: a quiet blue-grey
  const [h, s] = best, sat = Math.min(0.75, Math.max(0.25, s));
  const db = dark[3] ? hsl(dark[0] / dark[3], dark[1] / dark[3], dark[2] / dark[3]) : [h, sat, 0.1];
  return {
    a: rgb(h, sat, 0.34),
    b: rgb(db[0], Math.min(0.5, db[1]), 0.1),
    accent: rgb(h, Math.min(0.85, sat + 0.15), 0.74),
  };
}

function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const dd = mx - mn, s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
  const h = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
  return [h / 6, s, l];
}
function rgb(h, s, l) {
  const f = (t) => { t = (t + 1) % 1; const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255)).join(', ');
}
