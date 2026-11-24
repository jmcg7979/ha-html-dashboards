// Responsive check: every view and page of a dashboard at every target screen size. Run through shot.sh:
//   SHOT_SCRIPT=fitcheck.mjs engine/_dev/tools/shot.sh mock <site> -- --out DIR [--strict: TV rules, scrolling and heavy ellipsis count] [--d main] [--sizes 960x540,1280x800] [--views weather,systems/nas] [--q tv=x]
// Default sizes = the screens the dashboards run on (engine/docs/design-system.md, "Screens"): TV 960x540 (a 1080p Google TV
// at density 2), panel 1280x800, desktop 1920x1080, vertical 1080x1920. Per view and size it reports (lib/fit.mjs):
//   scroll   the page is taller than the screen (by how much)
//   overlap  two cards on top of each other
//   past     something running past its card's edge (horizontally or vertically)
//   cut      text cut off without an ellipsis, or (TV, --strict) cut to under 70% of itself with one
//   clash    two parts of one card on top of each other (rows squeezed below their content)
//   crop     a picture (camera, image card) shown in a box much flatter than the picture itself
//   full     a card whose content is taller than the card (it spills over the next one or gets cut)
// Screenshots land in DIR/<size>/<view>.png. Exit 1 when anything but scroll is found.
import fs from 'node:fs';
import path from 'node:path';
import { args, launch, newPage, open, dashUrl, viewIds } from './lib/browser.mjs';
import { measure, problems } from './lib/fit.mjs';

const o = args({ base: { type: 'string' }, out: { type: 'string' }, d: { type: 'string', default: 'main' },
  sizes: { type: 'string', default: '960x540,1280x800,1920x1080,1080x1920' }, views: { type: 'string' }, q: { type: 'string' }, strict: { type: 'boolean', default: false } },
'fitcheck.mjs --base URL --out DIR [--d main] [--sizes WxH,...] [--views a,b/c] [--q k=v] [--strict]', { required: ['base', 'out'] });
const b = await launch();
let bad = 0;

for (const size of o.sizes.split(',')) {
  const dir = path.join(o.out, size); fs.mkdirSync(dir, { recursive: true });
  const p = await newPage(b, { base: o.base, size });
  let views = o.views ? o.views.split(',') : null;
  if (!views) { await open(p, dashUrl(o.base, { d: o.d, q: o.q })); views = await viewIds(p, o.base, o.d); }
  console.log(`== ${size}`);
  for (const v of views) {
    await open(p, dashUrl(o.base, { d: o.d, q: o.q, v }));
    const r = await measure(p, o.strict);
    await p.screenshot({ path: path.join(dir, v.replace(/\//g, '-') + '.png') });
    const issues = problems(r, o.strict);
    if (issues.length) bad++;
    console.log(`  ${issues.length ? 'X' : r.scroll ? '~' : 'ok'} ${v}${r.scroll ? ` (scrolls ${r.scroll}px)` : ''}${issues.length ? '\n      ' + issues.join('\n      ') : ''}`);
  }
  await p.context().close();
}
await b.close();
console.log(bad ? `${bad} view/size combinations with problems` : 'no overlaps, nothing past its card, nothing cut');
process.exit(bad ? 1 : 0);
