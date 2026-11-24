// Three colors for the media pop-up's backdrop from one 'r, g, b' color (an app's own color).
// -> { a, b, accent } as 'r, g, b' strings: a = the color darkened for white text, b = a deep shade of it,
// accent = a light tint for active buttons.
export function tint(color) {
  const [r, g, b] = color.split(',').map(Number), [h, s] = hsl(r, g, b), sat = Math.min(0.75, Math.max(0.25, s));
  return { a: rgb(h, sat, 0.34), b: rgb(h, Math.min(0.5, sat), 0.1), accent: rgb(h, Math.min(0.85, sat + 0.15), 0.74) };
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
