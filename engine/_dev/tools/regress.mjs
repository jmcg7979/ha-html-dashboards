// One-command regression check for the dashboard engine (engine/docs/design-system.md, "Checks"). Run through regress.sh.
// One browser session over the whole site: every dashboard in dashboards/ that is a screen (lib/browser.mjs, dashboards()),
// each at the size and profile it runs at (TV 960x540, phone 412x915, else the panel's 1280x800; a TV dashboard once per
// `tv=<id>` the site lists). Per dashboard: every view and page (screenshot, "must fit the screen" and the layout rules
// of lib/fit.mjs), every pop-up it has and each of their tabs (full height), console errors and warnings per screen,
// nonsense on screen, icon buttons with no name, ids and links in its config; then, with --baseline, a pixel diff against
// an earlier run.
// Prints a short summary; screenshots land in --out as <dashboard>-<view>.png and <dashboard>-pop-<id>[-<tab>].png.
// --styles also saves what every element of each screen is styled as (lib/styles.mjs) and, with --baseline, lists every
// element and property that changed: for a stylesheet change that is meant to change nothing. Both runs need --styles.
// --size WxH opens every dashboard at that size instead of its own (a small phone, a window between phone and panel):
// for the narrow versions of cards, which the usual sizes mostly don't reach.
//   --base URL --out DIR [--baseline DIR] [--threshold 3] [--skip-popups] [--only main,tv] [--entities FILE] [--styles] [--size WxH]
import fs from 'node:fs';
import path from 'node:path';
import { args, launch, newPage, watchErrors, open, settle, dashUrl, LIVE, screenOf, manifest, dashboardFiles, dashboards, viewIds, popupIds,
  openPopup, openTrend, closePopup, popupOnScreen, FULL_HEIGHT_CSS, siteScreens, tvIds, stats } from './lib/browser.mjs';
import { measure, problems } from './lib/fit.mjs';
import { differ } from './lib/pixeldiff.mjs';
import * as styles from './lib/styles.mjs';

const o = args({ base: { type: 'string' }, out: { type: 'string' }, baseline: { type: 'string' }, threshold: { type: 'string', default: '3' }, entities: { type: 'string' },
  only: { type: 'string' }, 'skip-popups': { type: 'boolean', default: false }, styles: { type: 'boolean', default: false }, size: { type: 'string' } },
'regress.mjs --base URL --out DIR [--baseline DIR] [--threshold 3] [--skip-popups] [--only dashboard,...] [--entities FILE] [--styles] [--size WxH]', { required: ['base', 'out'] });
fs.mkdirSync(o.out, { recursive: true });
const base = o.base.replace(/\/$/, ''), root = new URL(base).pathname;
const man = await manifest(base), site = await siteScreens();
const b = await launch();
const STILL = { animations: 'disabled' };   // screenshots with spinners and other endless animations at their first frame, so two runs give the same picture
const errList = [], unfit = [], layout = [], nonsense = [], nameless = new Map(), shots = [], notes = [], rows = [];
// after a screenshot: the styles of the screen it shows, next to it
const keepStyles = async (p, f) => { if (o.styles) styles.save(path.join(o.out, styles.fileOf(f)), await styles.take(p)); };

// nonsense on screen, which throws no error: NaN, undefined, a temperature no sensor could read. Looks at values, not layout.
const sanity = async (p, label) => {
  const hits = await p.evaluate(() => {
    const out = new Set(), w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (/^(SCRIPT|STYLE)$/.test(n.parentElement.tagName)) continue;
      const s = n.nodeValue.trim(); if (!s) continue;
      if (/\bNaN\b|\bundefined\b|\[object |Invalid Date|\bInfinity\b|\b(null|unavailable|unknown)[°%]/.test(s) || [...s.matchAll(/(-?\d+(?:\.\d+)?)°(C?)/g)].some((m) => Math.abs(+m[1]) > (m[2] ? 350 : 250))) out.add(s.slice(0, 60));   // named °C: a printer's nozzle reaches 300
    }
    return [...out].slice(0, 5);
  }).catch(() => []);
  if (hits.length) nonsense.push(`${label}: ${hits.join(' | ')}`);
  // an icon button with no name (core/tips.js): nothing says what it does, to the eye or to a screen reader. Each once, with the first screen it was seen on
  for (const b of await p.evaluate(() => (window.dashUnnamed ? window.dashUnnamed() : [])).catch(() => [])) if (!nameless.has(b)) nameless.set(b, label);
};

// Ids and links in one dashboard's config, read in its own page (a dashboard may depend on the page's address: which TV).
// ids: entity ids named in home.js, the site's popups.js and the dashboard. navs: pop-ups a { nav: '#id' } opens.
// deadGo: a view, page or tab the dashboard links to and doesn't have. A card with a wrong id just renders empty.
// Reads config objects, so anything inside a function (a `value`, a tap that returns an action) is not seen.
const auditInPage = async ([root, d, hasPopups]) => {
  const [home, dash, popups] = await Promise.all([import(root + '/home.js'), import(`${root}/dashboards/${d}.js`), hasPopups ? import(root + '/popups.js') : {}]);
  const ID = /^(alarm_control_panel|binary_sensor|button|calendar|camera|climate|cover|fan|image|input_[a-z]+|light|lock|media_player|number|person|remote|script|select|sensor|sun|switch|time|timer|update|vacuum|weather)\.[a-z0-9_]+$/;
  const ids = new Set(), navs = new Set(); let seen = new Set(), goes = new Set();
  const walk = (v, key) => {
    if (typeof v === 'string') {
      if (key === 'nav' && v[0] === '#') navs.add(v.slice(1)); else if (ID.test(v) && key !== 'call') ids.add(v);
      if (key === 'view' || key === 'page' || key === 'tabs' || (key === 'tap' && /^[a-z0-9-]+\/[a-z0-9-]+$/.test(v))) goes.add(v);
      return;
    }
    if (!v || typeof v !== 'object' || seen.has(v) || v instanceof RegExp) return;
    seen.add(v); for (const k of Object.keys(v)) walk(v[k], Array.isArray(v) ? key : k);
  };
  walk({ ...home }); walk(popups.default);
  seen = new Set(); goes = new Set(); walk(dash.default);   // views and pages differ per dashboard, so each is checked against its own
  const has = new Set(dash.default.views.flatMap((v) => [v.id, ...(v.pages || []).map((pg) => v.id + '/' + pg.id)]));
  return { ids: [...ids], navs: [...navs], known: ['trend', ...Object.keys(popups.default || {}), ...Object.keys(dash.default.popups || {})], deadGo: [...goes].filter((g) => !has.has(g)).map((g) => d + ': ' + g) };
};
const audit = { ids: new Set(), navs: new Set(), known: new Set(), deadGo: [], have: null, err: '' };

// Pop-ups of this dashboard that an earlier dashboard on the same kind of screen has as the very same definition
// (a dashboard that spreads another's pop-ups): they were checked there.
const samePopups = (p, d, earlier) => p.evaluate(async ([root, d, earlier]) => {
  const pops = async (n) => (await import(`${root}/dashboards/${n}.js`)).default.popups || {};
  const seen = new Set(); for (const e of earlier) Object.values(await pops(e)).forEach((x) => seen.add(x));
  return Object.entries(await pops(d)).filter(([, def]) => seen.has(def)).map(([k]) => k);
}, [root, d, earlier]);

// ---- which dashboards, at which screens ----
const first = await newPage(b, { base });
const firstErrors = watchErrors(first); firstErrors.mark('main');
await open(first, dashUrl(base), { errors: firstErrors, patience: 0 });
const started = !!(await stats(first).catch(() => null));
const kinds = started ? await dashboards(first, base, dashboardFiles(man)) : [];
for (const k of kinds) if (k.error) errList.push(`dashboards/${k.name}.js: ${k.error}`);
const order = (k) => ['main', 'mobile', 'tv'].indexOf(k.name) + 1 || 9;
let todo = kinds.filter((k) => k.screen).sort((x, y) => order(x) - order(y) || x.name.localeCompare(y.name));
if (o.only) { const want = o.only.split(','); const unknown = want.filter((w) => !todo.some((k) => k.name === w)); if (unknown.length) notes.push(`--only: no such dashboard: ${unknown.join(', ')}`); todo = todo.filter((k) => want.includes(k.name)); }
const parts = kinds.filter((k) => !k.screen && !k.error).map((k) => k.name);
if (started) audit.have = await first.evaluate(async (root) => {   // the entity ids HA has
  const ha = await import(root + '/core/ha.js');
  const states = await Promise.race([ha.request({ type: 'get_states' }), new Promise((f) => setTimeout(() => f(null), 5000))]);
  return states && states.map((e) => e.entity_id);
}, root).catch((e) => { audit.err = e.message; return null; });
errList.push(...firstErrors.lines());
const tvs = todo.some((k) => k.profile === 'tv') ? await tvIds(first, base, site) : [];
await first.context().close();

// ---- every dashboard ----
const done = [];   // { name, key } of dashboards already checked, for samePopups
for (const k of todo) {
  const scr = o.size ? { ...screenOf(k.profile), size: o.size } : screenOf(k.profile), key = scr.size + (scr.p || '') + (scr.mobile ? 'm' : '');
  const variants = k.profile === 'tv' ? (tvs.length ? tvs.map((id) => ({ label: `${k.name}-${id}`, q: 'tv=' + id, say: `tv=${id}, ` })) : [{ label: k.name, q: '', say: '' }]) : [{ label: k.name, q: '', say: '' }];
  if (k.profile === 'tv' && !tvs.length) notes.push(`${k.name}: opened without tv=<id> (the site lists no TVs in mock/screens.mjs or home.js)`);
  const showcase = (site.showcase || []).includes(k.name);   // long lists of cards from the other dashboards: no fit, layout or link checks
  for (const va of variants) {
    const p = await newPage(b, { base, size: scr.size, mobile: scr.mobile });
    const errors = watchErrors(p);
    const url = (v) => dashUrl(base, { d: k.name, p: scr.p, q: va.q, v });
    errors.mark(va.label);
    await open(p, url(), { errors, patience: 0 });
    const views = (await stats(p).catch(() => null)) ? await viewIds(p, base, k.name) : [];
    if (!views.length) errList.push(`${va.label}: did not start`);
    for (const v of views) {
      errors.mark(`${va.label}:${v}`);
      await open(p, url(v), { errors });
      if (!showcase) {
        const r = await measure(p, k.profile === 'tv');
        if (r.scroll && k.profile !== 'phone') unfit.push(`${va.label}:${v} (${r.scroll} px)`);
        const found = problems(r, false); if (found.length) layout.push(`${va.label}:${v}: ${found.join('; ')}`);
      }
      await sanity(p, `${va.label}:${v}`);
      const f = `${va.label}-${v.replace(/\//g, '-')}.png`; await p.screenshot({ path: path.join(o.out, f), fullPage: !!scr.mobile, ...STILL }); shots.push(f); await keepStyles(p, f);
    }
    let popCount = 0, same = [];
    if (views.length) {
      errors.mark(`${va.label}:audit`);
      const a = await p.evaluate(auditInPage, [root, k.name, 'popups.js' in man.files]).catch((e) => { audit.err = e.message; return null; });
      if (a) { a.ids.forEach((i) => audit.ids.add(i)); a.navs.forEach((n) => audit.navs.add(n)); a.known.forEach((n) => audit.known.add(n)); if (!showcase) audit.deadGo.push(...a.deadGo); }
    }
    // pop-ups (engine + dashboard), each tab, full height, at this dashboard's size
    if (views.length && !o['skip-popups']) {
      const earlier = done.filter((x) => x.key === key && x.name !== k.name).map((x) => x.name);
      same = earlier.length ? ['trend', ...await samePopups(p, k.name, earlier)] : [];
      const ids = (await popupIds(p, base, k.name)).filter((id) => !same.includes(id));
      if (ids.length) { errors.mark(`${va.label}:${views[0]}`); await open(p, url(views[0]), { errors }); await p.addStyleTag({ content: FULL_HEIGHT_CSS }); }   // every pop-up over the first view
      for (const id of ids) {
        const label = `${va.label}:popup:${id}`; errors.mark(label);
        if (id === 'trend') await openTrend(p, base); else await openPopup(p, id);
        await settle(p, { base });
        const pop = popupOnScreen(p);
        if (!(await pop.count())) { errList.push(`${label}: did not open`); continue; }
        const tabs = await pop.locator('.ptab').count();
        for (let t = 0; t < Math.max(1, tabs); t++) {
          if (tabs) { await pop.locator('.ptab').nth(t).click(); await settle(p, { base }); }
          await sanity(p, `${label}${tabs ? '-' + (t + 1) : ''}`);
          const f = `${va.label}-pop-${id}${tabs ? '-' + (t + 1) : ''}.png`; await pop.screenshot({ path: path.join(o.out, f), ...STILL }); shots.push(f); popCount++; await keepStyles(p, f);
        }
        await closePopup(p);
      }
    }
    errList.push(...errors.lines());
    rows.push({ label: va.label, text: `${k.name} (${va.say}${scr.size}): ${views.length} views, ${popCount} pop-up screens${same.length ? `; ${same.length} pop-ups are the same as on a dashboard above, checked there` : ''}`, views: views.length, pops: popCount });
    await p.context().close();
  }
  done.push({ name: k.name, key });
}

// ---- ids, links, pixel diff ----
const ids = [...audit.ids].sort();
let missing = audit.have && ids.filter((i) => !audit.have.includes(i)), src = 'HA';
// --entities FILE (one id at the start of each line) compares against a real entity list instead of what the page's HA has
if (o.entities) { const have = new Set(fs.readFileSync(o.entities, 'utf8').split('\n').map((l) => (l.match(/^\s*([a-z_]+\.[a-z0-9_]+)/) || [])[1]).filter(Boolean)); missing = ids.filter((i) => !have.has(i)); src = o.entities; }
const deadNav = [...audit.navs].filter((n) => !audit.known.has(n) && !/^media-/.test(n)).sort(), deadGo = [...new Set(audit.deadGo)];
const changed = [], restyled = [], resized = [], unlike = [];
if (o.baseline && o.styles) {
  for (const f of shots) {
    const bf = path.join(o.baseline, styles.fileOf(f)); if (!fs.existsSync(bf)) continue;
    const r = styles.compare(bf, path.join(o.out, styles.fileOf(f)));
    if (r.same) continue;
    if (r.changes.length) restyled.push({ shot: f, changes: r.changes });
    if (r.sizes.length) resized.push({ shot: f, changes: r.sizes });
    if (r.only[0] || r.only[1]) unlike.push(`${f} (${r.only[0]} gone, ${r.only[1]} new)`);
  }
}
if (o.baseline) {
  const compare = await differ(b);
  for (const f of shots) {
    const bf = path.join(o.baseline, f); if (!fs.existsSync(bf)) { changed.push(`${f}: new`); continue; }
    const r = await compare(bf, path.join(o.out, f));
    if (r.size) changed.push(`${f}: size ${r.size}`); else if (r.pct > +o.threshold) changed.push(`${f}: ${r.pct.toFixed(1)}%`);
  }
}
await b.close();

const list = (items) => '\n    ' + items.join('\n    ');
const views = rows.reduce((n, r) => n + r.views, 0), pops = rows.reduce((n, r) => n + r.pops, 0);
console.log(`regress: ${rows.length} dashboards, ${views} views, ${pops} pop-up screens -> ${o.out}`);
for (const r of rows) console.log('  ' + r.text);
if (parts.length) console.log(`  not screens (no views of their own; other dashboards import them): ${parts.join(' ')}`);
for (const n of notes) console.log('  note: ' + n);
if (!views) console.log('  SITE FAILED TO LOAD: nothing below means anything; see the console errors');
console.log(`  fit: ${unfit.length ? 'SCROLLS ' + unfit.join(', ') : 'all fit'}`);
console.log(`  layout: ${layout.length ? 'PROBLEMS' + list(layout) : 'nothing overlaps, runs past its card or is cut'}`);
console.log(missing ? `  entities (${ids.length} named): ${missing.length ? missing.length + ' not in ' + src + ': ' + missing.slice(0, 15).join(' ') + (missing.length > 15 ? ' …' : '') : 'all exist'}` : `  entities: not checked ${audit.err}`);
console.log(`  links: ${deadNav.length || deadGo.length ? 'NOWHERE TO GO ' + [...deadNav.map((n) => '#' + n), ...deadGo].join(', ') : 'all resolve'}`);
console.log(`  on-screen values: ${nonsense.length ? 'NONSENSE' + list(nonsense) : 'nothing odd'}`);
console.log(`  icon buttons: ${nameless.size ? 'WITHOUT A NAME' + list([...nameless].map(([b, at]) => `${b} (${at})`)) : 'all named'}`);
console.log(`  console errors and warnings: ${errList.length ? list([...new Set(errList)]) : 'none'}`);
if (o.baseline) console.log(`  changed > ${o.threshold}% vs ${o.baseline}: ${changed.length ? list(changed) : 'none'}`);
if (o.baseline && o.styles) {
  console.log(`  styles: ${restyled.length ? `CHANGED on ${restyled.length} of ${shots.length} screens` + list(styles.groups(restyled)) : `the same on every element of ${shots.length} screens`}`);
  if (resized.length) console.log(`  styles, measured sizes that differ on ${resized.length} screens (a real change, or only the mock's clocks and live values):` + list(styles.groups(resized, 12)));
  if (unlike.length) console.log(`  styles, not compared (elements in one run only): ${unlike.slice(0, 8).join(', ')}${unlike.length > 8 ? ` … ${unlike.length - 8} more screens` : ''}`);
}
// ids HA doesn't have fail the run when the list they were checked against is the real one (a live run, or --entities FILE);
// on the mock the list is the mock's own data, so a gap there is only printed
const realIds = !!(o.entities || LIVE);
process.exit(!views || unfit.length || layout.length || errList.length || nonsense.length || nameless.size || deadNav.length || deadGo.length || (realIds && missing && missing.length) ? 1 : 0);
