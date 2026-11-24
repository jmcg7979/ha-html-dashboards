// Loader watchdog check (Playwright, via shot.sh: SHOT_SCRIPT=bootcheck.mjs). A build whose app.js doesn't load leaves
// the app's own update check unstarted: the loader (boot.js) must then reload the page once version.json has changed.
// A page that runs must be left to its own check. The loader's minute is shortened to 1.5 s for the run.
//   --base URL
import { args, launch, newPage, dashUrl } from './lib/browser.mjs';
const { base } = args({ base: { type: 'string' } }, 'bootcheck.mjs --base URL', { required: ['base'] });
const b = await launch();
async function run(broken) {
  const p = await newPage(b, { base, size: '1280x800' }); let loads = 0, bump = false;
  await p.addInitScript(() => { const si = window.setInterval; window.setInterval = (f, ms, ...a) => si(f, ms === 60000 ? 1500 : ms, ...a); });   // the loader's minute, shortened
  if (broken) await p.route(/\/app\.js/, (r) => (!bump ? r.fulfill({ contentType: 'text/javascript', body: 'this is not ( javascript' }) : r.continue()));
  await p.route(/version\.json/, async (r) => { const res = await r.fetch(); const j = await res.json(); if (bump) j.v = 'changed'; r.fulfill({ response: res, json: j }); });
  p.on('load', () => loads++);
  await p.goto(dashUrl(base)); await p.waitForTimeout(2500);
  const up = await p.evaluate(() => !!window.DASH_UP);
  const before = loads; bump = true; await p.waitForTimeout(5000);
  const r = { broken, up, reloaded: loads - before, upAfter: await p.evaluate(() => !!window.DASH_UP) }; await p.context().close(); return r;
}
const a = await run(true), c = await run(false);
console.log(JSON.stringify(a), JSON.stringify(c));
const ok = !a.up && a.reloaded >= 1 && a.upAfter && c.up && c.reloaded === 0;
console.log(ok ? 'ok: a build that does not start reloads when a new one is there; a running page is left to its own check' : 'FAIL'); await b.close(); process.exit(ok ? 0 : 1);
