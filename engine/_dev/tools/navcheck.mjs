// Navigation race check (Playwright, via shot.sh: SHOT_SCRIPT=navcheck.mjs). Views and pop-ups are built the first time
// they are shown, and building waits for the card modules to load: a second request that arrives during that wait must
// not build a second copy. Two things are tried on one dashboard:
//   views     every view not on screen yet is asked for twice in a row (as two quick taps on the rail do): exactly one
//             element for it must exist afterwards
//   pop-ups   two pop-ups not opened yet are asked for one right after the other (two hash changes): exactly one pop-up
//             must be on screen afterwards, and none once it is closed (up to three pairs)
// Also: no card may register a clean-up after it was built (onDispose outside a capture is dropped: it would never run).
// Prints one line per problem; exit 1 if there is one, or on an error in the page.
//   --base URL [--d main] [--q 'k=v&...'] [--size 1280x800]        a TV dashboard: --d tv --q 'tv=<id>&p=tv' --size 960x540
import { args, launch, newPage, watchErrors, open, settle, dashUrl, needsSignIn, viewIds, popupIds, closePopup, stats } from './lib/browser.mjs';

const o = args({ base: { type: 'string' }, d: { type: 'string', default: 'main' }, q: { type: 'string' }, size: { type: 'string', default: '1280x800' } },
  'navcheck.mjs --base URL [--d main] [--q k=v] [--size WxH]', { required: ['base'] });
const b = await launch(), p = await newPage(b, { base: o.base, size: o.size });
const errors = watchErrors(p), problems = [];
const url = dashUrl(o.base, { d: o.d, q: `unload=0${o.q ? '&' + o.q : ''}` });   // unload=0: nothing is removed while we count
await open(p, url, { errors });
if (await needsSignIn(p) || !(await stats(p))) { console.log('NOT CHECKED: the dashboard did not start, or asks for a sign-in'); await b.close(); process.exit(1); }

const droppedAtStart = (await stats(p)).dropped;   // clean-ups registered with nobody to run them (core/scope.js): start-up's own are meant

// ---- views: asked for twice in the same moment ----
const ids = [...new Set((await viewIds(p, o.base, o.d, { frames: true })).map((v) => v.split('/')[0]))].slice(1);   // the first view is on screen already
for (const id of ids) {
  errors.mark(id);
  await p.evaluate((v) => { for (let i = 0; i < 2; i++) window.dispatchEvent(new CustomEvent('dash:view', { detail: v })); }, id);
  await settle(p, { base: o.base });
  const n = await p.evaluate((v) => [...document.querySelectorAll('#app > *')].filter((el) => el.classList.contains('view-' + v)).length, id);
  if (n !== 1) problems.push(`view ${id}: asked for twice, ${n} copies of it in the page`);
}
const shown = await p.evaluate(() => [...document.querySelectorAll('#app > *')].filter((el) => !el.hidden).length);
if (shown !== 1) problems.push(`${shown} views visible at once after the last view change`);

// ---- pop-ups: two in a row, each pair on a freshly loaded page (a pop-up left behind must not count against the next pair) ----
const pops = (await popupIds(p, o.base, o.d)).filter((id) => id !== 'trend');
const starts = [...new Set([0, 2 * Math.floor(pops.length / 4), 2 * Math.floor(pops.length / 2) - 2])].filter((i) => i >= 0 && i + 1 < pops.length);   // up to three pairs: first, middle, last
for (const i of starts) {
  const [first, second] = [pops[i], pops[i + 1]];
  errors.mark(`#${first} then #${second}`);
  await open(p, url, { errors });
  await p.evaluate(([x, y]) => { location.hash = x; location.hash = y; }, [first, second]);
  await settle(p, { base: o.base });
  const visible = () => p.evaluate(() => document.querySelectorAll('.pwrap:not([hidden])').length);
  const up = await visible();
  if (up !== 1) problems.push(`pop-ups #${first} then #${second}: ${up} pop-ups on screen`);
  await closePopup(p);
  await settle(p, { base: o.base, patience: 300, video: 0 });
  const left = await visible();
  if (left) problems.push(`pop-ups #${first} then #${second}: ${left} still on screen after closing`);
}
{ const n = (await stats(p)).dropped - droppedAtStart; if (n > 0) problems.push(`${n} clean-up(s) were registered after a card was built, where nothing will run them (onDispose outside a capture: core/scope.js)`); }
const errs = errors.lines();
for (const line of problems) console.log('X ' + line);
console.log(`${ids.length} views asked for twice, ${starts.length} pairs of pop-ups; errors: ${errs.length ? errs.slice(0, 8).join(' | ') : 'none'}`);
console.log(problems.length ? `${problems.length} navigation problems` : 'ok: one copy of every view, one pop-up at a time');
await b.close();
process.exit(problems.length || errs.length ? 1 : 0);
