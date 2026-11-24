// Pixel diff of two PNG files, done on a canvas in a blank browser page: the share of pixels whose color changed by
// more than a little. Used by diff.mjs (two folders) and regress.mjs (a run against its baseline).
import fs from 'node:fs';
import path from 'node:path';
import { newPage } from './browser.mjs';

function compareInPage([before, after]) {
  const load = (data) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = 'data:image/png;base64,' + data; });
  return Promise.all([load(before), load(after)]).then(([i1, i2]) => {
    if (i1.width !== i2.width || i1.height !== i2.height) return { size: `${i1.width}x${i1.height} -> ${i2.width}x${i2.height}` };
    const c = document.getElementById('c'); c.width = i1.width; c.height = i1.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(i1, 0, 0); const d1 = g.getImageData(0, 0, c.width, c.height).data;
    g.drawImage(i2, 0, 0); const d2 = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let k = 0; k < d1.length; k += 4) if (Math.abs(d1[k] - d2[k]) + Math.abs(d1[k + 1] - d2[k + 1]) + Math.abs(d1[k + 2] - d2[k + 2]) > 40) n++;
    return { pct: (100 * n) / (d1.length / 4) };
  });
}

// differ(browser) -> compare(fileBefore, fileAfter) = { pct } (percent of pixels changed) or { size: 'WxH -> WxH' }
export async function differ(browser) {
  const page = await newPage(browser);
  await page.setContent('<canvas id=c></canvas>');
  return (before, after) => page.evaluate(compareInPage, [fs.readFileSync(before, 'base64'), fs.readFileSync(after, 'base64')]);
}

// every .png under a folder, as paths relative to it (sub-folders included: fitcheck.mjs writes one per size)
export function pngs(dir, sub = '') {
  return fs.readdirSync(path.join(dir, sub), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? pngs(dir, path.join(sub, e.name)) : e.name.endsWith('.png') ? [path.join(sub, e.name)] : [])).sort();
}
