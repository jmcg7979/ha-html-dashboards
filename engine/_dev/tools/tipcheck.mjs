// The check of the names of buttons that show no words (Playwright, via shot.sh: SHOT_SCRIPT=tipcheck.mjs; core/tips.js).
// With the mouse, on a dashboard for a big screen: the label comes after the mouse has rested on an icon button, says the
// button's aria-label, sits on the screen and beside the button, goes when the mouse leaves and with a press; a finger
// brings none. With the remote, on the TV dashboard: it comes for a button the highlight was moved to with an arrow,
// goes by itself, and does not come for a highlight the page placed. Prints one line per problem; exit 1 on one.
//   --base URL [--d main] [--view v] [--tv <id>] [--tvview v] [--shots DIR]
//     --view / --tvview   a view with an icon button on its first screen, for the remote with another button beside it;
//                         default: the dashboard's first view
//     --shots DIR         a picture of each label as it shows: mouse.png, remote.png
import path from 'node:path';
import { args, launch, newPage, watchErrors, open, dashUrl, needsSignIn, siteScreens, tvIds, manifest, dashboardFiles, SCREENS } from './lib/browser.mjs';

const o = args({ base: { type: 'string' }, d: { type: 'string', default: 'main' }, view: { type: 'string' }, tv: { type: 'string' }, tvview: { type: 'string' }, shots: { type: 'string' } },
  'tipcheck.mjs --base URL [--d main] [--view v] [--tv id] [--tvview v] [--shots DIR]', { required: ['base'] });
const WAIT = 800, STAY = 4000;   // a little over the label's own wait; how long it stays for the remote (core/tips.js)
const b = await launch(), problems = [];
const ignore = [/^failed net::\S+ https?:\/\/(?!localhost|127\.0\.0\.1)/];   // an outside server's hiccup isn't this check's business

// in the page: the label as it shows now (null: hidden), and where its button is
const tipNow = (p) => p.evaluate(() => {
  const t = document.getElementById('tip'); if (!t || t.hidden) return null;
  const r = t.getBoundingClientRect(); return { text: t.textContent, l: r.left, t: r.top, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight };
});
// the icon buttons with a name: no letter or digit shown (core/tips.js wordless), on the screen
const MARK = () => {
  const out = [...document.querySelectorAll('button[aria-label], a[href][aria-label]')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width && r.height && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth && !el.closest('[hidden]') && !/[\p{L}\p{N}]/u.test(el.innerText || '')
      && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) && el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  });
  out.forEach((el, i) => { el.dataset.tipcheck = String(i); });
  return out.map((el) => ({ label: el.getAttribute('aria-label') }));
};
const boxOf = (p, i) => p.locator(`[data-tipcheck="${i}"]`).boundingBox();
function placed(what, tip, box, label) {
  if (!tip) { problems.push(`${what}: no label for the button named '${label}'`); return; }
  if (tip.text !== label) problems.push(`${what}: the label says '${tip.text}', the button is named '${label}'`);
  if (tip.l < 0 || tip.t < 0 || tip.r > tip.w || tip.b > tip.h) problems.push(`${what}: the label of '${label}' is cut by the screen's edge`);
  if (box && tip.l < box.x + box.width && tip.r > box.x && tip.t < box.y + box.height && tip.b > box.y) problems.push(`${what}: the label of '${label}' covers its button`);
  console.log(`${what}: '${tip.text}'`);
}
const shot = async (p, name) => { if (o.shots) await p.screenshot({ path: path.join(o.shots, name) }); };

// ---- the mouse ----
{
  const p = await newPage(b, { base: o.base, size: SCREENS.portal.size }), errors = watchErrors(p, { ignore });
  await open(p, dashUrl(o.base, { d: o.d, v: o.view }), { errors });
  if (await needsSignIn(p)) { console.log('NOT CHECKED: the dashboard asks for a sign-in'); await b.close(); process.exit(1); }
  const found = await p.evaluate(MARK);
  if (!found.length) problems.push(`mouse: no named icon button on the first screen of ${o.d}${o.view ? ':' + o.view : ''} (give --view)`);
  else {
    const { label } = found[0], box = await boxOf(p, 0), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await p.evaluate(() => document.querySelector('[data-tipcheck="0"]').dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'touch' })));
    await p.waitForTimeout(WAIT);
    if (await tipNow(p)) problems.push(`mouse: a finger on '${label}' brought its label`);
    await p.mouse.move(cx, cy); await p.waitForTimeout(150);
    if (await tipNow(p)) problems.push(`mouse: the label of '${label}' came at once, not after a rest`);
    await p.waitForTimeout(WAIT);
    placed('mouse', await tipNow(p), box, label); await shot(p, 'mouse.png');
    await p.mouse.move(cx, cy + box.height * 3); await p.waitForTimeout(150);   // (off the button; another button there would wait before it says anything)
    if (await tipNow(p)) problems.push(`mouse: the label of '${label}' stays after the mouse has left`);
    await p.mouse.move(cx, cy); await p.waitForTimeout(WAIT);
    if (!(await tipNow(p))) problems.push(`mouse: no label for '${label}' the second time`);
    await p.mouse.down(); const after = await tipNow(p); await p.mouse.move(2, 2); await p.mouse.up();   // (released elsewhere: nothing is pressed)
    if (after) problems.push(`mouse: the label of '${label}' stays through a press`);
  }
  errors.lines().forEach((x) => problems.push('error in the page: ' + x));
  await p.context().close();
}

// ---- the remote ----
if (!dashboardFiles(await manifest(o.base)).includes('tv')) console.log('remote: not checked (the site has no TV dashboard)');
else {
  const p = await newPage(b, { base: o.base, size: SCREENS.tv.size }), errors = watchErrors(p, { ignore });
  const tv = o.tv || (await (async () => { await open(p, dashUrl(o.base, { d: 'tv', q: 'p=tv' }), { errors }); return (await tvIds(p, o.base, await siteScreens()))[0] || ''; })());
  await open(p, dashUrl(o.base, { d: 'tv', v: o.tvview, q: `p=tv${tv ? '&tv=' + tv : ''}` }), { errors });
  // an icon button and a button beside it in the same row or column: the highlight is put on the neighbor and moved
  // over with the arrow, as a hand on the remote would
  const pairs = await p.evaluate(() => {
    const on = (el) => { const r = el.getBoundingClientRect(); return r.width && r.height && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth && !el.closest('[hidden], #rail'); };
    const all = [...document.querySelectorAll('button:not([disabled]), a[href]')].filter(on), out = [];
    all.forEach((el, i) => { el.dataset.tipcheck = String(i); });
    all.forEach((t, ti) => {
      const label = t.getAttribute('aria-label'); if (!label || /[\p{L}\p{N}]/u.test(t.innerText || '')) return;
      const a = t.getBoundingClientRect();
      all.forEach((n, ni) => {
        const c = n.getBoundingClientRect(); if (n === t) return;
        const key = c.top < a.bottom && c.bottom > a.top ? (c.right <= a.left ? 'ArrowRight' : c.left >= a.right ? 'ArrowLeft' : null) : c.left < a.right && c.right > a.left ? (c.bottom <= a.top ? 'ArrowDown' : c.top >= a.bottom ? 'ArrowUp' : null) : null;
        if (key) out.push({ t: ti, n: ni, key, label, d: Math.hypot(a.left - c.left, a.top - c.top) });
      });
    });
    return out.sort((x, y) => x.d - y.d).slice(0, 12);
  });
  let label = null, at = null;
  for (const x of pairs) {
    await p.evaluate((n) => document.querySelector(`[data-tipcheck="${n}"]`).focus(), x.n);
    await p.keyboard.press(x.key); await p.waitForTimeout(80);
    if (await p.evaluate((t) => document.activeElement === document.querySelector(`[data-tipcheck="${t}"]`), x.t)) { label = x.label; at = x.t; break; }
  }
  if (!label) problems.push(`remote: no named icon button the arrows reach from a button beside it on the TV dashboard${o.tvview ? ':' + o.tvview : ''} (give --tvview)`);
  else {
    await p.waitForTimeout(WAIT);
    placed('remote', await tipNow(p), await boxOf(p, at), label); await shot(p, 'remote.png');
    await p.waitForTimeout(STAY);
    if (await tipNow(p)) problems.push(`remote: the label of '${label}' is still there ${(WAIT + STAY) / 1000} s after the highlight came`);
    // a highlight the page placed (as a pop-up that opens does): away and back with no arrow
    await p.evaluate(() => { const el = document.activeElement; el.blur(); el.focus(); });
    await p.waitForTimeout(WAIT);
    if (await tipNow(p)) problems.push(`remote: a highlight placed without an arrow brought the label of '${label}'`);
  }
  errors.lines().forEach((x) => problems.push('error in the page: ' + x));
}

problems.forEach((x) => console.log('PROBLEM ' + x));
console.log(problems.length ? `tipcheck: ${problems.length} problem(s)` : 'tipcheck: ok');
await b.close(); process.exit(problems.length ? 1 : 0);
