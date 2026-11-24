// Chart readout check (Playwright, via shot.sh: SHOT_SCRIPT=readoutcheck.mjs). A chart card and the history pop-up show a
// value where the mouse is and clear it when the mouse leaves (core/readout.js). Prints one line per problem; exit 1 on one.
//   --base URL [--d main] [--view systems/network]      the view must hold a chart card with an expand button
import { args, launch, newPage, watchErrors, open, settle, dashUrl, needsSignIn, stats } from './lib/browser.mjs';

const o = args({ base: { type: 'string' }, d: { type: 'string', default: 'main' }, view: { type: 'string', default: 'systems/network' }, size: { type: 'string', default: '1280x800' } },
  'readoutcheck.mjs --base URL [--d main] [--view v]', { required: ['base'] });
const b = await launch(), p = await newPage(b, { base: o.base, size: o.size });
const errors = watchErrors(p), problems = [];
await open(p, dashUrl(o.base, { d: o.d, v: o.view }), { errors });
if (await needsSignIn(p) || !(await stats(p))) { console.log('NOT CHECKED: the dashboard did not start, or asks for a sign-in'); await b.close(); process.exit(1); }

// the readout of the plot `sel` under the mouse, then with the mouse away
async function tryPlot(name, sel, tipSel) {
  const box = await p.locator(sel).first().boundingBox();
  if (!box) { problems.push(`${name}: no plot (${sel})`); return; }
  await p.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5); await p.waitForTimeout(150);
  const text = await p.locator(tipSel).first().evaluate((el) => (el.hidden ? '' : el.textContent.trim()));
  if (!text) problems.push(`${name}: no readout under the mouse`); else console.log(`${name}: ${text.replace(/\s+/g, ' ').slice(0, 80)}`);
  await p.mouse.move(2, 2); await p.waitForTimeout(150);
  if (!(await p.locator(tipSel).first().evaluate((el) => el.hidden))) problems.push(`${name}: the readout stays after the mouse has left`);
}
await p.waitForSelector('.chart .csvg path', { timeout: 10000 }).catch(() => {});
await tryPlot('chart card', '.chart .cplot', '.chart .ctip');
await p.locator('.chart .cexp').first().click(); await settle(p, { base: o.base });
await p.waitForSelector('.trend svg path', { timeout: 10000 }).catch(() => {});
const plot = await p.evaluate(() => { const t = document.querySelector('.trend'); const s = t && t.querySelector('svg'); return s && s.parentElement.className.split(' ')[0]; });
if (!plot) problems.push('history pop-up: not opened by the expand button');
else await tryPlot('history pop-up', '.trend .' + plot, '.trend .ctip');

const errs = errors.lines(); errs.forEach((x) => console.log('ERROR ' + x));
problems.forEach((x) => console.log('PROBLEM ' + x));
console.log(problems.length || errs.length ? `readoutcheck: ${problems.length} problem(s), ${errs.length} error(s) in the page` : 'readoutcheck: ok');
await b.close(); process.exit(problems.length || errs.length ? 1 : 0);
