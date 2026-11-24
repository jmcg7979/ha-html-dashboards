// Dashboard screenshot + smoke check (Playwright). Run through shot.sh, which starts the mock server for mock runs. Prints page size, console errors and failed requests; exit 1 on errors.
//   --base URL       dashboard folder URL, e.g. http://localhost:8125/local/dash or http://<ha>:8123/local/dash
//   --d main|mobile  dashboard (default main)      --view systems/network   (?v=)
//   --size 1280x800  viewport (default 1280x800)   --full                   full-page screenshot
//   --click SEL      click a CSS selector after load, screenshot again as <out>_1.png, _2.png ... (repeatable)
//   --p tablet       display profile (&p=)       --q 'tv=<id>'            more query parameters
//   --press 'ArrowDown ArrowRight Enter'   keys pressed (TV remote) after load, before the screenshot
//   --out FILE       screenshot path (required)
//   --popups all|ids also every pop-up the dashboard has (or a comma list), each tab, full height: <out>_pop-<id>[-<tab>].png
// Also lists any tab a click opened ("opened tab: URL").
// Live HA: token from env HA_TOKEN; never printed or saved.
import { args, launch, newPage, watchErrors, open, settle, dashUrl, redact, sizeOf, popupIds, openPopup, closePopup, popupOnScreen, FULL_HEIGHT_CSS } from './lib/browser.mjs';

const o = args({
  base: { type: 'string' }, d: { type: 'string', default: 'main' }, view: { type: 'string' }, popups: { type: 'string' }, size: { type: 'string', default: '1280x800' }, p: { type: 'string' }, q: { type: 'string' }, press: { type: 'string' },
  full: { type: 'boolean', default: false }, click: { type: 'string', multiple: true, default: [] }, out: { type: 'string' },
}, 'shot.mjs --base URL --out FILE [--d main|mobile] [--view v] [--size WxH] [--p profile] [--q k=v] [--full] [--press KEYS] [--click SEL]... [--popups all|ids]', { required: ['base', 'out'] });

const { width: w, height: h } = sizeOf(o.size);
const phone = o.d === 'mobile';
const b = await launch();
const p = await newPage(b, { base: o.base, size: o.size, mobile: phone });
const errors = watchErrors(p);
const opened = []; p.context().on('page', (np) => opened.push(np));   // tabs a click opens (links, url actions)

await open(p, dashUrl(o.base, { d: o.d, p: o.p, q: o.q, v: o.view }), { errors });
for (const k of (o.press || '').split(/\s+/).filter(Boolean)) { await p.keyboard.press(k); await p.waitForTimeout(250); }
if (o.press) await settle(p, { base: o.base });

const file = (suffix) => o.out.replace(/(\.png)?$/, `${suffix}.png`);
await p.screenshot({ path: o.out, fullPage: o.full });
for (const [i, sel] of o.click.entries()) {
  await p.click(sel); await p.waitForTimeout(150); await settle(p, { base: o.base });
  await p.screenshot({ path: file(`_${i + 1}`), fullPage: o.full });
}
// every pop-up (or the listed ones), each tab, at full height (the body's scroll unrolled), one file each
if (o.popups != null) {
  const ids = o.popups && o.popups !== 'all' ? o.popups.split(',') : await popupIds(p, o.base, o.d);
  await p.addStyleTag({ content: FULL_HEIGHT_CSS });
  for (const id of ids) {
    await openPopup(p, id); await settle(p, { base: o.base });
    const pop = popupOnScreen(p);
    if (!(await pop.count())) { console.log('pop-up', id, 'did not open'); continue; }
    const tabs = await pop.locator('.ptab').count();
    for (let t = 0; t < Math.max(1, tabs); t++) {
      if (tabs) { await pop.locator('.ptab').nth(t).click(); await settle(p, { base: o.base }); }
      await pop.screenshot({ path: file(`_pop-${id}${tabs ? '-' + (t + 1) : ''}`) });
    }
    await closePopup(p);
  }
}
const [sw, shh] = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
console.log(`page ${sw}x${shh} (viewport ${w}x${h})${!phone && !o.full && shh > h ? '  SCROLLS: Main views must fit the screen' : ''}`);
for (const np of opened) console.log('opened tab: ' + redact(np.url() === 'about:blank' ? await np.evaluate(() => location.href).catch(() => np.url()) : np.url()));
const errs = errors.texts();
console.log(errs.length ? 'errors:\n  ' + errs.join('\n  ') : 'errors: none');
await b.close();
process.exit(errs.length ? 1 : 0);
