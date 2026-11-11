// Dashboard screenshot + smoke check (Playwright). Run through shot.sh, which starts the mock server for mock runs. Prints page size, console errors and failed requests; exit 1 on errors.
//   --base URL       dashboard folder URL, e.g. http://localhost:8125/local/dash or http://<ha>:8123/local/dash
//   --d main|mobile  dashboard (default main)      --view systems/network   (?v=)
//   --size 1280x800  viewport (default 1280x800)   --full                   full-page screenshot
//   --click SEL      click a CSS selector after load, screenshot again as <out>_1.png, _2.png ... (repeatable)
//   --p tablet       display profile (&p=)       --q 'tv=james_office'    more query parameters
//   --press 'ArrowDown ArrowRight Enter'   keys pressed (TV remote) after load, before the screenshot
//   --out FILE       screenshot path (required)
//   --popups [ids]   also every pop-up (comma list, or all from popups.js), each tab, full height: <out>_pop-<id>[-<tab>].png
// Also lists any tab a click opened ("opened tab: URL").
// Live HA: token from env HA_TOKEN; never printed or saved.
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../mock') + '/');
const { chromium } = require('playwright');
const { values: o } = parseArgs({ options: {
  base: { type: 'string' }, d: { type: 'string', default: 'main' }, view: { type: 'string' }, popups: { type: 'string' }, size: { type: 'string', default: '1280x800' }, p: { type: 'string' }, q: { type: 'string' }, press: { type: 'string' },
  full: { type: 'boolean', default: false }, click: { type: 'string', multiple: true, default: [] }, out: { type: 'string' } } });
if (!o.base || !o.out) { console.error('usage: shot.mjs --base URL --out FILE [--d main|mobile] [--view v] [--size WxH] [--full] [--click SEL]...'); process.exit(2); }

const [w, h] = o.size.split('x').map(Number);
const phone = o.d === 'mobile';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: w, height: h }, userAgent: phone ? 'Mozilla/5.0 (Linux; Android 14) Mobile' : undefined });
const errs = [];
const redact = (s) => String(s).replace(/(token=)[^&\s"]+/g, '$1x');
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + redact(m.text()).slice(0, 300)); });
p.on('response', (r) => { if (r.status() >= 400) errs.push(r.status() + ' ' + redact(r.url())); });

const opened = []; p.context().on('page', (np) => opened.push(np));   // tabs a click opens (links, url actions)
const url = `${o.base.replace(/\/$/, '')}/index.html?d=${o.d}${o.p ? '&p=' + o.p : ''}${o.q ? '&' + o.q : ''}`;
const token = process.env.HA_TOKEN || 'A';   // the mock accepts anything
const signIn = async () => {
  await p.goto(url);
  await p.evaluate((t) => localStorage.setItem('hassTokens', JSON.stringify({ hassUrl: location.origin, refresh_token: 'unused', access_token: t, expires: Date.now() + 864e5, clientId: location.origin + '/' })), token);
  await p.goto(url + (o.view ? '&v=' + encodeURIComponent(o.view) : ''));
  await p.waitForTimeout(3500);
};
await signIn();
// the first load after a deploy sometimes lands on the sign-in screen; one retry
if (await p.locator('#login:not([hidden])').count()) { errs.length = 0; await signIn(); }
for (const k of (o.press || '').split(/\s+/).filter(Boolean)) { await p.keyboard.press(k); await p.waitForTimeout(250); }
if (o.press) await p.waitForTimeout(600);

await p.screenshot({ path: o.out, fullPage: o.full });
for (const [i, sel] of o.click.entries()) {
  await p.click(sel); await p.waitForTimeout(1200);
  await p.screenshot({ path: o.out.replace(/(\.png)?$/, `_${i + 1}.png`), fullPage: o.full });
}
// every pop-up (or the listed ones), each tab, at full height (the body's scroll unrolled), one file each
if (o.popups != null) {
  const ids = o.popups && o.popups !== 'all' ? o.popups.split(',') : await p.evaluate(async (b) => ['trend', ...Object.keys((await import(b + '/popups.js').catch(() => ({ default: {} }))).default)], new URL(url).pathname.replace(/\/[^/]*$/, ''));
  await p.addStyleTag({ content: '.popup{max-height:none!important}.pbody{overflow:visible!important}.pwrap{position:absolute!important;align-items:flex-start!important;min-height:100%}' });
  for (const id of ids) {
    await p.evaluate((h) => { location.hash = h; }, id); await p.waitForTimeout(1500);
    const pop = p.locator('.pwrap:not([hidden]) .popup');
    if (!(await pop.count())) { console.log('pop-up', id, 'did not open'); continue; }
    const tabs = await pop.locator('.ptab').count();
    for (let t = 0; t < Math.max(1, tabs); t++) {
      if (tabs) { await pop.locator('.ptab').nth(t).click(); await p.waitForTimeout(900); }
      await pop.screenshot({ path: o.out.replace(/(\.png)?$/, `_pop-${id}${tabs ? '-' + (t + 1) : ''}.png`) });
    }
    await p.evaluate(() => history.replaceState(null, '', location.pathname + location.search)); await p.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
  }
}
const [sw, shh] = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
console.log(`page ${sw}x${shh} (viewport ${w}x${h})${!phone && !o.full && shh > h ? '  SCROLLS: Main views must fit the screen' : ''}`);
for (const np of opened) console.log('opened tab: ' + redact(np.url() === 'about:blank' ? await np.evaluate(() => location.href).catch(() => np.url()) : np.url()));
console.log(errs.length ? 'errors:\n  ' + errs.join('\n  ') : 'errors: none');
await b.close();
process.exit(errs.length ? 1 : 0);
