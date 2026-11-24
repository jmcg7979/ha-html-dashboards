// Smoke check of a build, meant to run before every deploy (Playwright, via shot.sh: SHOT_SCRIPT=smoke.mjs). In one browser:
//   1. every dashboard of the site (lib/browser.mjs, dashboards()) opens at its own size and profile, shows its first
//      view and reports no error or warning (lib/browser.mjs, "what counts as an error");
//   2. every .js file in the build's version.json is imported once in the page, through the page's import map, so a
//      syntax error or a broken import in a card no view on screen uses is caught without opening its view. A file with
//      no import or export statement is a page script (boot.js writes the import map, gallery-page.js builds its own
//      page): importing it would run it a second time, so it is only parsed.
// Prints one line per failure and exits 1; one summary line and exit 0 when the build is clean.
//   --base URL
import { args, launch, newPage, watchErrors, open, dashUrl, screenOf, manifest, dashboardFiles, dashboards, siteScreens, tvIds, stats, redact } from './lib/browser.mjs';

const o = args({ base: { type: 'string' } }, 'smoke.mjs --base URL', { required: ['base'] });
const base = o.base.replace(/\/$/, ''), root = new URL(base).pathname;
const t0 = Date.now(), failures = [];
const man = await manifest(base).catch((e) => { console.log('smoke: ' + redact(e.message)); process.exit(1); });
const site = await siteScreens();
const b = await launch();
const WAIT = { patience: 1500, video: 0 };   // a first view is enough here; nobody looks at the picture

// Opens one dashboard; returns its page (or null when it didn't come up). Errors land in `failures` as "<label>: <error>".
async function load(label, name, screen, q) {
  const p = await newPage(b, { base, size: screen.size, mobile: screen.mobile });
  const errors = watchErrors(p);
  const r = await open(p, dashUrl(base, { d: name, p: screen.p, q }), { errors, ...WAIT });
  const up = !r.signIn && !!(await stats(p).catch(() => null));
  if (r.signIn) failures.push(`${label}: asks for a sign-in`);
  else if (!up) failures.push(`${label}: did not start`);
  // known: errors already reported another way (a failed import is also an uncaught error in the page)
  return { p, errors, up, done: async (known = []) => { failures.push(...errors.texts().filter((e) => !known.includes(e)).map((e) => `${label}: ${e}`)); await p.context().close(); } };
}

// Runs in the page: imports (or, for a page script, parses) every file; returns [{ file, error, at }] for the ones that fail.
// `at` is where the browser says the mistake is (file:line:column), which a failed import() alone doesn't tell: the file
// is imported once more from a module script, whose failure the window's error event reports with its place.
async function importAll([root, files]) {
  const place = (url) => new Promise((done) => {
    const s = document.createElement('script'); let timer = 0;
    const end = (at) => { removeEventListener('error', seen, true); clearTimeout(timer); s.remove(); done(at); };
    const seen = (e) => { if (e.filename) end(`${new URL(e.filename).pathname.replace(root + '/', '')}:${e.lineno}:${e.colno}`); };
    addEventListener('error', seen, true); timer = setTimeout(() => end(''), 1500);
    s.type = 'module'; s.textContent = `import ${JSON.stringify(url)};`; document.head.appendChild(s);
  });
  const failed = [];
  await Promise.all(files.map(async (file) => {
    const url = `${root}/${file}`;
    try {
      const source = await (await fetch(url)).text();
      if (/^\s*(?:import(?!\s*\()|export\s)/m.test(source)) await import(url); else new Function(source);
    } catch (e) { failed.push({ file, error: String((e && e.message) || e) }); }
  }));
  for (const f of failed) f.at = /^Failed to fetch/.test(f.error) ? '' : await place(`${root}/${f.file}`);
  return failed;
}

// ---- Main first: it tells which dashboards are screens, and its page imports every file ----
const names = dashboardFiles(man);
const main = await load('main', 'main', screenOf('portal'));
let kinds = [], imported = 0; const broken = [];
if (await main.p.evaluate(() => !!document.querySelector('script[type=importmap]')).catch(() => false)) {
  main.errors.mark('import');
  const files = Object.keys(man.files).filter((f) => f.endsWith('.js') && !f.startsWith('vendor/')).sort();   // vendored scripts are not modules
  const failed = await main.p.evaluate(importAll, [root, files]);
  // one mistake breaks every file that imports the broken one: one line per mistake, with how many files it takes down
  const by = new Map();
  for (const f of failed) { const k = (f.at || f.file) + ': ' + f.error.replace(new RegExp(`https?://[^/]+${root}/`, 'g'), '').replace(/\?v=\w+/g, ''); by.set(k, [...(by.get(k) || []), f.file]); }
  for (const [k, list] of by) failures.push(`import ${k}${list.length > 1 ? ` (${list.length} files fail to load: ${list.slice(0, 4).join(', ')}${list.length > 4 ? ', …' : ''})` : ''}`);
  if (main.up) kinds = (await dashboards(main.p, base, names)).filter((k) => k.screen);
  imported = files.length - failed.length; broken.push(...failed.map((f) => 'pageerror: ' + f.error));
} else failures.push('main: the page never wrote its import map (boot.js did not run)');
const tv = kinds.some((k) => k.profile === 'tv') ? (await tvIds(main.p, base, site))[0] : '';
await main.done(broken);

// ---- every other dashboard ----
for (const k of kinds.filter((k) => k.name !== 'main')) {
  const d = await load(k.name, k.name, screenOf(k.profile), k.profile === 'tv' && tv ? 'tv=' + tv : '');
  await d.done();
}
await b.close();

const secs = ((Date.now() - t0) / 1000).toFixed(1);
if (failures.length) { for (const f of [...new Set(failures)]) console.log('smoke: ' + f); console.log(`smoke: FAILED (${new Set(failures).size} problems, ${secs} s)`); process.exit(1); }
console.log(`smoke: ${kinds.length} dashboards load clean (${kinds.map((k) => k.name).join(', ')}), ${imported} files import; build ${man.v}, ${secs} s`);
