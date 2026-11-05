// Pixel diff of two screenshot folders (same file names), for engine changes: % of pixels that changed per screen.
//   node diff.mjs <before-dir> <after-dir>        (run with Node 20+, e.g. see engine/docs/design-system.md)
// Clocks and moving data give a few %, a layout change gives much more; look at anything above ~3 %.
import { createRequire } from 'node:module'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const require = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../mock') + '/');
const { chromium } = require('playwright');
const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error('usage: diff.mjs <before-dir> <after-dir>'); process.exit(2); }
const files = fs.readdirSync(a).filter((f) => f.endsWith('.png') && fs.existsSync(path.join(b, f)));
const br = await chromium.launch(); const p = await br.newPage(); await p.setContent('<canvas id=c></canvas>');
const rows = [];
for (const f of files) {
  const r = await p.evaluate(async ([x, y]) => {
    const ld = (d) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = 'data:image/png;base64,' + d; });
    const [i1, i2] = await Promise.all([ld(x), ld(y)]);
    if (i1.width !== i2.width || i1.height !== i2.height) return { size: `${i1.width}x${i1.height} -> ${i2.width}x${i2.height}` };
    const c = document.getElementById('c'); c.width = i1.width; c.height = i1.height; const g = c.getContext('2d');
    g.drawImage(i1, 0, 0); const d1 = g.getImageData(0, 0, c.width, c.height).data; g.drawImage(i2, 0, 0); const d2 = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let k = 0; k < d1.length; k += 4) if (Math.abs(d1[k] - d2[k]) + Math.abs(d1[k + 1] - d2[k + 1]) + Math.abs(d1[k + 2] - d2[k + 2]) > 40) n++;
    return { pct: (100 * n) / (d1.length / 4) };
  }, [fs.readFileSync(path.join(a, f), 'base64'), fs.readFileSync(path.join(b, f), 'base64')]);
  rows.push({ f, ...r });
}
rows.sort((x, y) => (y.pct ?? 999) - (x.pct ?? 999)).forEach((r) => console.log((r.size || r.pct.toFixed(2) + '%').padStart(24), r.f));
await br.close();
