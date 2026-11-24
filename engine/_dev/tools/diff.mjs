// Pixel diff of two screenshot folders (same file names, sub-folders included), for engine changes: % of pixels that
// changed per screen, biggest first.
//   node diff.mjs <before-dir> <after-dir>        (run with Node 20+, e.g. see engine/docs/design-system.md)
// Clocks and moving data give a few %, a layout change gives much more; look at anything above ~3 %.
import fs from 'node:fs';
import path from 'node:path';
import { args, launch } from './lib/browser.mjs';
import { differ, pngs } from './lib/pixeldiff.mjs';

const { _: [before, after] } = args({}, 'diff.mjs <before-dir> <after-dir>', { positional: 2 });
for (const dir of [before, after]) if (!fs.existsSync(dir)) { console.error(`no such folder: ${dir}\nusage: diff.mjs <before-dir> <after-dir>`); process.exit(2); }
const files = pngs(before).filter((f) => fs.existsSync(path.join(after, f)));
const b = await launch(), compare = await differ(b);
const rows = [];
for (const f of files) rows.push({ f, ...(await compare(path.join(before, f), path.join(after, f))) });
rows.sort((x, y) => (y.pct ?? 999) - (x.pct ?? 999)).forEach((r) => console.log((r.size || r.pct.toFixed(2) + '%').padStart(24), r.f));
await b.close();
