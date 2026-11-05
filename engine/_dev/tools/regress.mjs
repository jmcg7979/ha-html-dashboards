// One-command regression check for the dashboard engine (engine/docs/design-system.md, "Checks"). Run through regress.sh.
// One browser session: every Main view and page at 1280x800 (screenshot + "must fit the screen" check), every Mobile tab at
// 412x915 (house), every pop-up and tab at phone size (full height), console errors per screen; then, with --baseline,
// a pixel diff against an earlier run. Prints a short summary; screenshots land in --out.
//   --base URL --out DIR [--baseline DIR] [--threshold 3] [--skip-popups]
import { createRequire } from 'node:module'; import fs from 'node:fs'; import path from 'node:path'; import { parseArgs } from 'node:util'; import { fileURLToPath } from 'node:url';
const require = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../mock') + '/');
const { chromium } = require('playwright');
const { values: o } = parseArgs({ options: { base: { type: 'string' }, out: { type: 'string' }, baseline: { type: 'string' }, threshold: { type: 'string', default: '3' }, entities: { type: 'string' }, 'skip-popups': { type: 'boolean', default: false } } });
if (!o.base || !o.out) { console.error('usage: regress.mjs --base URL --out DIR [--baseline DIR] [--threshold 3] [--skip-popups] [--entities FILE]'); process.exit(2); }
fs.mkdirSync(o.out, { recursive: true });
const base = o.base.replace(/\/$/, ''), token = process.env.HA_TOKEN || 'A', root = new URL(base).pathname;
const b = await chromium.launch();
const errors = {}, unfit = [], shots = [];
async function page(w, h, mobile) {
  const p = await b.newPage({ viewport: { width: w, height: h }, userAgent: mobile ? 'Mozilla/5.0 (Linux; Android 14) Mobile' : undefined });
  let cur = '';
  p.on('pageerror', (e) => (errors[cur] ||= []).push('pageerror: ' + e.message));
  p.on('requestfailed', (r) => { if (!/\/api\/frigate\/.*\/vod\//.test(r.url()) && r.failure()?.errorText !== 'net::ERR_ABORTED') (errors[cur] ||= []).push('failed ' + r.failure()?.errorText + ' ' + r.url().replace(/(token|authSig)=[^&]+/g, '$1=x').slice(0, 160)); });
  p.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) (errors[cur] ||= []).push(m.text().replace(/(token=)[^&\s"]+/g, '$1x').slice(0, 200)); });
  p.on('response', (r) => { if (r.status() >= 400 && !/\/api\/frigate\/.*\/vod\/|\/auth\/token$|\/popups\.js|\/dashboards\/mobile\.js/.test(r.url())) (errors[cur] ||= []).push(r.status() + ' ' + r.url().replace(/(token|authSig)=[^&]+/g, '$1=x').slice(0, 160)); });
  p.mark = (k) => { cur = k; };
  await p.goto(`${base}/index.html?d=main`);
  await p.evaluate((t) => localStorage.setItem('hassTokens', JSON.stringify({ hassUrl: location.origin, refresh_token: 'unused', access_token: t, expires: Date.now() + 864e5, clientId: location.origin + '/' })), token);
  return p;
}
// nonsense on screen, which throws no error: NaN, undefined, a temperature no sensor could read. Looks at values, not layout.
const sanity = async (p, label) => { const hits = await p.evaluate(() => { const out = new Set(), w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) { if (/^(SCRIPT|STYLE)$/.test(n.parentElement.tagName)) continue; const s = n.nodeValue.trim(); if (!s) continue;
      if (/\bNaN\b|\bundefined\b|\[object |Invalid Date|\bInfinity\b|\b(null|unavailable|unknown)[°%]/.test(s) || [...s.matchAll(/(-?\d+(?:\.\d+)?)°/g)].some((m) => Math.abs(+m[1]) > 250)) out.add(s.slice(0, 60)); }
    return [...out].slice(0, 5); }).catch(() => []);
  if (hits.length) nonsense.push(`${label}: ${hits.join(' | ')}`); };
const nonsense = [];
const viewIds = (d) => (d.views || []).filter((v) => !v.frame).flatMap((v) => (v.pages ? v.pages.map((pg) => v.id + '/' + pg.id) : [v.id]));
const load = async (p, d, v) => { p.mark(`${d}:${v}`); await p.goto(`${base}/index.html?d=${d}&v=${encodeURIComponent(v)}`); await p.waitForTimeout(2500); };

// Main at panel size
const pm = await page(1280, 800, false);
const main = await pm.evaluate(async (r) => (await import(r + '/dashboards/main.js')).default, root).then((d) => viewIds(d)).catch(() => []);
const mainViews = main.length ? main : await (async () => { await load(pm, 'main', ''); return pm.evaluate(() => [...document.querySelectorAll('#rail a[data-v]')].map((a) => a.dataset.v)); })();
for (const v of mainViews) {
  await load(pm, 'main', v);
  const [sh, ih] = await pm.evaluate(() => [document.documentElement.scrollHeight, innerHeight]);
  if (sh > ih) unfit.push(`${v} (${sh - ih} px)`);
  await sanity(pm, 'main:' + v);
  const f = `main-${v.replace(/\//g, '-')}.png`; await pm.screenshot({ path: path.join(o.out, f) }); shots.push(f);
}
// Site audit: ids in home.js and the dashboards that HA doesn't have, and links to a pop-up, view or page that doesn't exist. A card with a wrong id just
// renders empty. Reads config objects, so anything inside a function (a `value`, a tap that returns an action) is not seen. On the mock, "HA" is the site's own mock data:
// --entities FILE (one id at the start of each line) compares against a real entity list instead.
await load(pm, 'main', mainViews[0] || '');
const audit = await pm.evaluate(async (r) => {
  const get = (f) => import(r + f).catch(() => ({}));
  const [home, main, mobile, popups, ha] = await Promise.all(['/home.js', '/dashboards/main.js', '/dashboards/mobile.js', '/popups.js', '/core/ha.js'].map(get));
  const ID = /^(alarm_control_panel|binary_sensor|button|calendar|camera|climate|cover|fan|image|input_[a-z]+|light|lock|media_player|number|person|remote|script|select|sensor|sun|switch|time|timer|update|vacuum|weather)\.[a-z0-9_]+$/;
  const ids = new Set(), navs = new Set(); let seen = new Set(), goes = new Set();
  const walk = (v, key) => {
    if (typeof v === 'string') { if (key === 'nav' && v[0] === '#') navs.add(v.slice(1)); else if (ID.test(v) && key !== 'call') ids.add(v);
      if (key === 'view' || key === 'page' || key === 'tabs' || (key === 'tap' && /^[a-z0-9-]+\/[a-z0-9-]+$/.test(v))) goes.add(v); return; }
    if (!v || typeof v !== 'object' || seen.has(v) || v instanceof RegExp) return;
    seen.add(v); for (const k of Object.keys(v)) walk(v[k], Array.isArray(v) ? key : k);
  };
  walk({ ...home }); walk(popups.default);
  const deadGo = [];   // views and pages differ per dashboard, so each is checked against its own
  for (const [name, d] of [['main', main.default], ['mobile', mobile.default]]) { if (!d) continue;
    seen = new Set(); goes = new Set(); walk(d); walk(popups.default);
    const has = new Set(d.views.flatMap((v) => [v.id, ...(v.pages || []).map((pg) => v.id + '/' + pg.id)]));
    for (const g of goes) if (!has.has(g)) deadGo.push(name + ': ' + g); }
  const known = new Set(['trend', ...Object.keys(popups.default || {}), ...Object.keys((main.default || {}).popups || {}), ...Object.keys((mobile.default || {}).popups || {})]);
  const states = ha.request ? await Promise.race([ha.request({ type: 'get_states' }), new Promise((f) => setTimeout(() => f(null), 5000))]).catch(() => null) : null;
  const have = states && new Set(states.map((e) => e.entity_id));
  return { ids: [...ids].sort(), deadGo, missing: have ? [...ids].filter((i) => !have.has(i)).sort() : null, deadNav: [...navs].filter((n) => !known.has(n) && !/^media-/.test(n)).sort(), checked: ids.size };
}, root).catch((e) => ({ missing: null, deadNav: [], deadGo: [], checked: 0, err: e.message }));
if (o.entities && audit.ids) { const have = new Set(fs.readFileSync(o.entities, 'utf8').split('\n').map((l) => (l.match(/^\s*([a-z_]+\.[a-z0-9_]+)/) || [])[1]).filter(Boolean)); audit.missing = audit.ids.filter((i) => !have.has(i)); audit.src = o.entities; }
// Mobile tabs (sites that have a Mobile dashboard)
const pp = await page(412, 915, true);
// a site without a Mobile dashboard has no dashboards/mobile.js
const hasMobile = await pm.evaluate(async (r) => (await fetch(r + '/dashboards/mobile.js', { method: 'HEAD' })).ok, root).catch(() => false);
if (hasMobile) await load(pp, 'mobile', '');
const mob = !hasMobile ? [] : await pp.evaluate(async (r) => { try { const d = (await import(r + '/dashboards/mobile.js')).default; return (d.views || []).filter((v) => !v.frame).flatMap((v) => (v.pages ? v.pages.map((pg) => v.id + '/' + pg.id) : [v.id])); } catch (e) { return []; } }, root);
for (const v of mob) { await load(pp, 'mobile', v); await sanity(pp, 'mobile:' + v); const f = `mob-${v.replace(/\//g, '-')}.png`; await pp.screenshot({ path: path.join(o.out, f), fullPage: true }); shots.push(f); }
// Pop-ups (engine + site), each tab, full height, at phone size
let popCount = 0;
if (!o['skip-popups']) {
  const d = mob.length ? 'mobile' : 'main';
  await load(pp, d, mob[0] || mainViews[0] || '');
  // the site's pop-ups (the engine's #trend needs a reading to show, so it is checked through the views, not here)
  const ids = await pp.evaluate(async (r) => Object.keys((await import(r + '/popups.js')).default), root).catch(() => []);
  await pp.addStyleTag({ content: '.popup{max-height:none!important}.pbody{overflow:visible!important}.pwrap{position:absolute!important;align-items:flex-start!important;min-height:100%}' });
  for (const id of ids) {
    pp.mark(`popup:${id}`);
    await pp.evaluate((h) => { location.hash = h; }, id); await pp.waitForTimeout(1200);
    const pop = pp.locator('.pwrap:not([hidden]) .popup');
    if (!(await pop.count())) { (errors[`popup:${id}`] ||= []).push('did not open'); continue; }
    const tabs = await pop.locator('.ptab').count();
    for (let t = 0; t < Math.max(1, tabs); t++) {
      if (tabs) { await pop.locator('.ptab').nth(t).click(); await pp.waitForTimeout(700); }
      await sanity(pp, `popup:${id}${tabs ? '-' + (t + 1) : ''}`);
      const f = `pop-${id}${tabs ? '-' + (t + 1) : ''}.png`; await pop.screenshot({ path: path.join(o.out, f) }); shots.push(f); popCount++;
    }
    await pp.evaluate(() => { history.replaceState(null, '', location.pathname + location.search); window.dispatchEvent(new HashChangeEvent('hashchange')); });
  }
}
// pixel diff against a baseline run
const changed = [];
if (o.baseline) {
  const dp = await b.newPage(); await dp.setContent('<canvas id=c></canvas>');
  for (const f of shots) {
    const bf = path.join(o.baseline, f); if (!fs.existsSync(bf)) { changed.push(`${f}: new`); continue; }
    const r = await dp.evaluate(async ([x, y]) => {
      const ld = (s) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = 'data:image/png;base64,' + s; });
      const [i1, i2] = await Promise.all([ld(x), ld(y)]);
      if (i1.width !== i2.width || i1.height !== i2.height) return `size ${i1.width}x${i1.height} -> ${i2.width}x${i2.height}`;
      const c = document.getElementById('c'); c.width = i1.width; c.height = i1.height; const g = c.getContext('2d');
      g.drawImage(i1, 0, 0); const d1 = g.getImageData(0, 0, c.width, c.height).data; g.drawImage(i2, 0, 0); const d2 = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0; for (let k = 0; k < d1.length; k += 4) if (Math.abs(d1[k] - d2[k]) + Math.abs(d1[k + 1] - d2[k + 1]) + Math.abs(d1[k + 2] - d2[k + 2]) > 40) n++;
      return (100 * n) / (d1.length / 4);
    }, [fs.readFileSync(bf, 'base64'), fs.readFileSync(path.join(o.out, f), 'base64')]);
    if (typeof r === 'string') changed.push(`${f}: ${r}`); else if (r > +o.threshold) changed.push(`${f}: ${r.toFixed(1)}%`);
  }
}
await b.close();
const errList = Object.entries(errors).flatMap(([k, l]) => [...new Set(l)].map((e) => `${k}: ${e}`));
console.log(`regress: ${mainViews.length} Main views, ${mob.length} Mobile tabs, ${popCount} pop-up screens -> ${o.out}`);
console.log(`  fit (1280x800): ${unfit.length ? 'SCROLLS ' + unfit.join(', ') : 'all fit'}`);
if (!mainViews.length) console.log('  SITE FAILED TO LOAD: nothing below means anything; see the console errors');
console.log(audit.missing ? `  entities (${audit.checked} named): ${audit.missing.length ? audit.missing.length + ' not in ' + (audit.src || 'HA') + ': ' + audit.missing.slice(0, 15).join(' ') + (audit.missing.length > 15 ? ' …' : '') : 'all exist'}` : `  entities: not checked ${audit.err || ''}`);
console.log(`  links: ${audit.deadNav.length || audit.deadGo.length ? 'NOWHERE TO GO ' + [...audit.deadNav.map((n) => '#' + n), ...audit.deadGo].join(', ') : 'all resolve'}`);
console.log(`  on-screen values: ${nonsense.length ? 'NONSENSE\n    ' + nonsense.join('\n    ') : 'nothing odd'}`);
console.log(`  console errors: ${errList.length ? '\n    ' + errList.join('\n    ') : 'none'}`);
if (o.baseline) console.log(`  changed > ${o.threshold}% vs ${o.baseline}: ${changed.length ? '\n    ' + changed.join('\n    ') : 'none'}`);
process.exit(!mainViews.length || unfit.length || errList.length || nonsense.length || audit.deadNav.length || audit.deadGo.length ? 1 : 0);
