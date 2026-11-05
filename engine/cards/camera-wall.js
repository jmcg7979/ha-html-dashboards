// Camera wall: every feed at its own shape (no letterbox bars, no cropping), packed in justified rows that fill the space.
// The row split is worked out for the screen it is on: of every way to break the list (kept in order) into rows, the one
// whose smallest tile is biggest wins (ties: most picture overall). A wide panorama and a 4:3 doorbell can share a row.
// Height = the viewport below the wall's top, so the whole wall shows without scrolling; when the best split is still too
// tall, the wall scales down and centres. Tiles are the normal camera card (tap = full screen, history button, mute).
// { type: 'camera-wall', cameras: [{ entity, name, stream, fullStream, fit, ratio: '8/3' }],
//   history: [entities] (or true = all)   cameras with a recordings button
//   review: (id) => 'sensor.<id>_review_status'   red ring on a tile while its Frigate review is ALERT
//   fit: 'screen' (default) | 'width' (rows at full width, the page scrolls: phones), maxRows: 4 }
// ratio: the stream's shape. Once a stream plays its real shape replaces it, so a wrong or missing ratio corrects itself
// (except fit: 'fill' cameras, whose anamorphic pixels are meant to be stretched to the configured ratio).
import camera from './camera.js';

const parse = (r) => { const [a, b] = String(r || '16/9').split('/').map(Number); return b ? a / b : a || 16 / 9; };

// best rows for ratios R in a W x H box: { rows: [[i…]], h: [row height], w: [row width] }
export function pack(R, W, H, gap, maxRows = 4) {
  const n = R.length; let best = null;
  for (let mask = 0; mask < 1 << (n - 1); mask++) {
    const rows = [[0]];
    for (let i = 1; i < n; i++) { if ((mask >> (i - 1)) & 1) rows.push([i]); else rows[rows.length - 1].push(i); }
    if (rows.length > maxRows) continue;
    const sum = rows.map((r) => r.reduce((a, i) => a + R[i], 0));
    const full = rows.map((r, k) => (W - gap * (r.length - 1)) / sum[k]);            // row heights at full width
    const s = Math.min(1, (H - gap * (rows.length - 1)) / full.reduce((a, b) => a + b, 0));
    let min = Infinity, tot = 0;
    rows.forEach((r, k) => r.forEach((i) => { const a = (s * full[k]) ** 2 * R[i]; min = Math.min(min, a); tot += a; }));
    if (!best || min > best.min * 1.001 || (min > best.min * 0.999 && tot > best.tot))
      best = { rows, min, tot, h: full.map((x) => x * s), w: rows.map((r, k) => full[k] * s * sum[k] + gap * (r.length - 1)) };
  }
  return best;
}

export default function cameraWall(cfg) {
  const el = document.createElement('div');
  el.className = 'cwall';
  const cams = cfg.cameras.slice(0, 12);   // 2^11 splits to try at most
  const hist = (c) => cfg.history === true || (cfg.history || []).includes(c.entity);
  const tiles = cams.map((c) => {
    const t = camera({ ...c, history: hist(c), review: cfg.review });
    el.appendChild(t);
    return t;
  });
  const R = cams.map((c) => parse(c.ratio));

  // real shape from the stream (substream), once
  tiles.forEach((t, i) => {
    if (cams[i].fit === 'fill') return;
    t.querySelector('video').addEventListener('loadedmetadata', (ev) => {
      const v = ev.target; if (t.classList.contains('full') || !v.videoWidth || !v.videoHeight) return;
      const r = v.videoWidth / v.videoHeight;
      if (Math.abs(r - R[i]) / R[i] > 0.03) { R[i] = r; layout(); }
    });
  });

  let last = '';
  function layout() {
    const W = el.clientWidth; if (!W) return;   // view hidden
    const gap = parseFloat(getComputedStyle(el).columnGap) || 8;
    let H = Infinity;
    if ((cfg.fit || 'screen') === 'screen') {
      const view = el.closest('.view'), pad = view ? parseFloat(getComputedStyle(view).paddingBottom) || 0 : 0;
      H = Math.max(200, window.innerHeight - (el.getBoundingClientRect().top + window.scrollY) - pad);
    }
    const p = pack(R, W, H, gap, cfg.maxRows || 4);
    const key = JSON.stringify([p.rows, p.h.map(Math.round), W]);
    if (key === last) return; last = key;
    let y = 0;
    p.rows.forEach((r, k) => {
      const h = p.h[k], sum = r.reduce((a, i) => a + R[i], 0), free = p.w[k] - gap * (r.length - 1);
      let x = (W - p.w[k]) / 2;
      r.forEach((i) => {
        const w = (free * R[i]) / sum, s = tiles[i].style;
        s.setProperty('--x', x.toFixed(1) + 'px'); s.setProperty('--y', y.toFixed(1) + 'px');
        s.setProperty('--w', w.toFixed(1) + 'px'); s.setProperty('--h', h.toFixed(1) + 'px');
        x += w + gap;
      });
      y += h + gap;
    });
    el.style.height = Math.max(0, y - gap).toFixed(1) + 'px';
  }
  new ResizeObserver(layout).observe(el);
  window.addEventListener('resize', layout);
  return el;
}
