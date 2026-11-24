// What a dashboard does when Home Assistant goes away and comes back (Playwright on the mock, via shot.sh:
// SHOT_SCRIPT=resilience.mjs). The mock plays the faults (its header: mock.drop, mock.lag, mock.auth); one dashboard is
// taken through them:
//   a blip        the link drops and comes straight back: no "Not connected" bar (it waits 6 s), the page hears changes again
//   an outage     HA gone for 10 s (a restart): the bar comes up, goes when HA is back, the page hears changes again, and
//                 it watches what it watched before: nothing twice, nothing lost
//   a refused     the next sign-in is refused once (HA still starting): the page tries again by itself and asks nobody
//   sign-in       to sign in
//   a slow HA     answers take 1.5 s: a pressed button shows it is working, and stops showing it once HA has answered
//   a press lost  HA goes away right after a press: the button doesn't spin for ever
//   a file lost   a card type's file doesn't arrive (a bad link): the view or pop-up that needs it says so and what was
//                 on screen stays; asked for again once the file does arrive, it opens. Lost while the page starts:
//                 the page starts all the same (it says the dashboard didn't load, HA is connected) and the first view
//                 comes by itself once the file does
// The two about presses need a button on the first view that sends something to HA; without one they are listed as
// not checked. Prints ok / FAIL per line; exit 1 when one fails or the page reports an error of its own.
//   --base URL [--d main] [--q 'k=v&...'] [--size 1280x800]
import { args, launch, newPage, watchErrors, open, settle, dashUrl, needsSignIn, closePopup, stats, viewIds, popupIds, showView, openPopup } from './lib/browser.mjs';

const o = args({ base: { type: 'string' }, d: { type: 'string', default: 'main' }, q: { type: 'string' }, size: { type: 'string', default: '1280x800' } },
  'resilience.mjs --base URL [--d main] [--q k=v] [--size WxH]   (through shot.sh mock <site>)', { required: ['base'] });
if (process.env.HA_TOKEN) { console.log('resilience.mjs runs on the mock only: it breaks the link on purpose'); process.exit(2); }
const b = await launch(), p = await newPage(b, { base: o.base, size: o.size });
// a browser says so itself when a websocket fails to open; that is the test, not a fault of the page
const errors = watchErrors(p, { ignore: [/WebSocket/i] });
await open(p, dashUrl(o.base, { d: o.d, q: `unload=0${o.q ? '&' + o.q : ''}` }), { errors });
if (await needsSignIn(p) || !(await stats(p))) { console.log('NOT CHECKED: the dashboard did not start, or asks for a sign-in'); await b.close(); process.exit(1); }

let bad = 0;
const check = (what, ok, got) => { if (!ok) bad++; console.log((ok ? 'ok   ' : 'FAIL ') + what + (ok || got === undefined ? '' : '   (' + JSON.stringify(got) + ')')); };
const im = "(f) => import(new URL(f, location.href.replace(/[?#].*$/, '')).href)";
const mock = (service, data = {}) => p.evaluate(async ([service, data, im]) => { const HA = await (0, eval)(im)('core/ha.js');
  return HA.request({ type: 'call_service', domain: 'mock', service, service_data: data }).then(() => true, () => false); }, [service, data, im]);
const up = () => p.evaluate(async (im) => (await (0, eval)(im)('core/ha.js')).connected(), im);
const barShown = () => p.evaluate(() => { const e = document.getElementById('offline'); return !!e && !e.hidden; });
const signIn = () => needsSignIn(p);
const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await p.waitForTimeout(100); } return false; };
// the page hears a change again: an entity it watches is set in the mock, and the new state must reach the page's store
const WATCHED = await p.evaluate(async (im) => { const ST = await (0, eval)(im)('core/store.js'); return ST.entityIds().find((id) => ST.st(id) && /^(sensor|binary_sensor|input_boolean)\./.test(id)) || ST.entityIds().find((id) => ST.st(id)); }, im);
let n = 0;
const hears = async () => { const state = 'resilience-' + ++n; if (!(await mock('set', { entity: WATCHED, state }))) return false;
  return until(() => p.evaluate(async ([im, id, s]) => { const e = (await (0, eval)(im)('core/store.js')).st(id); return !!e && e.state === s; }, [im, WATCHED, state]), 2000); };
const before = await stats(p), was = await p.evaluate(async ([im, id]) => (await (0, eval)(im)('core/store.js')).st(id).state, [im, WATCHED]);
check(`start: the page hears a change of ${WATCHED}`, await hears());

// ---- a blip ----
await mock('drop', { for: 0 });
check('a blip: the link is back within 5 s', (await until(async () => !(await up()), 1500)) && (await until(up, 5000)));
check('a blip: no "Not connected" bar', !(await barShown()));
check('a blip: the page hears changes again', await hears());

// ---- an outage ----
await mock('drop', { for: 10 });
check('an outage: the "Not connected" bar comes up', await until(barShown, 9000));
check('an outage: no sign-in is asked for', !(await signIn()));
check('an outage: the link is back once HA is', await until(up, 9000));
check('an outage: the bar goes', await until(async () => !(await barShown()), 2000));
check('an outage: the page hears changes again', await hears());
{ const s = await stats(p); check('an outage: it watches what it watched before', s.watchers === before.watchers && s.ticks === before.ticks, { before: [before.watchers, before.ticks], after: [s.watchers, s.ticks] }); }

// ---- a refused sign-in ----
await mock('auth', { invalid: true, times: 1 }); await mock('drop', { for: 0 });
check('a refused sign-in: the page tries again and is back within 8 s', (await until(async () => !(await up()), 1500)) && (await until(up, 8000)));
check('a refused sign-in: nobody is asked to sign in', !(await signIn()));
check('a refused sign-in: the page hears changes again', await hears());

// ---- presses ----
// a button on the first view whose press sends something to HA: with slow answers it shows .working (core/feedback.js)
const working = () => p.evaluate(() => !!document.querySelector('.working'));
await mock('lag', { ms: 1500 }); await p.waitForTimeout(1600);
let pressed = null;
// pressed from script, so a pop-up or a dialog an earlier candidate opened can't be in the way; then whatever it opened is closed
const press = (i) => p.evaluate((i) => { const e = document.querySelector(`[data-resilience="${i}"]`); if (e) e.click(); }, i);
const tidy = async () => { await p.keyboard.press('Escape'); if (await p.evaluate(() => location.hash.length > 1)) await closePopup(p); await p.waitForTimeout(200); };
const candidates = await p.evaluate(() => { const view = document.querySelector('#app > :not([hidden])'); if (!view) return 0;
  const all = [...view.querySelectorAll('button:not([disabled]), .tile:not(.ro)')].filter((e) => e.getClientRects().length && !e.closest('#rail, .vtabs'));
  all.forEach((e, i) => { e.dataset.resilience = i; }); return Math.min(all.length, 12); });
for (let i = 0; i < candidates && pressed == null; i++) {
  await press(i);
  if (await until(working, 900)) pressed = i;
  else await tidy();
}
if (pressed == null) console.log('not checked: no button on the first view sends something to HA (a slow HA, a press lost)');
else {
  check('a slow HA: the pressed button shows it is working', true);
  check('a slow HA: and stops once HA has answered', await until(async () => !(await working()), 9000));
  await p.waitForTimeout(1700);   // the state change that press caused has arrived
  await press(pressed);
  await p.waitForTimeout(100);
  await mock('drop', { for: 3 });
  check('a press lost: the button does not spin for ever', await until(async () => !(await working()), 12000));
  check('a press lost: the link is back', await until(up, 9000));
}
await until(up, 5000); await mock('lag', { ms: 0 });
await tidy();
await mock('set', { entity: WATCHED, state: was });

const errs = errors.lines();   // read here: the next part makes the browser and the page report errors on purpose

// ---- a file lost ----
// Card files not loaded yet are refused; the first view (then pop-up) that needs one is the one tried.
{
  const toast = () => p.evaluate(() => { const t = document.getElementById('toast'); return t && !t.hidden ? t.textContent : ''; });
  // the view on screen, and its page when it has several
  const onScreen = () => p.evaluate(() => { const v = [...document.querySelectorAll('#app > *')].find((x) => !x.hidden), pg = v && v.querySelector('.vpage:not([hidden])'); return v ? v.className + (pg ? ' / ' + pg.className : '') : ''; });
  const popups = () => p.evaluate(() => document.querySelectorAll('.pwrap:not([hidden]):not(.moresheet)').length);
  let refused = 0; const refuse = (r) => { refused++; r.abort(); };
  const FILES = '**/cards/*.js*';
  // asks for each of `ids` with the files refused until one needed a file (and the page has had the time to say
  // `said`): that id, or '' when none did
  const lose = async (ids, ask, undo, said) => {
    await p.route(FILES, refuse);
    let hit = '';
    for (const id of ids) { refused = 0; was = await onScreen(); await ask(id); await until(async () => refused > 0 && said.test(await toast()), 800); if (refused) { hit = id; break; } await undo(); }
    await p.unroute(FILES, refuse);
    return hit;
  };
  let was = '';   // what was on screen before the one that lost its file was asked for (a view tried before it and found whole is shown by then)
  const view = await lose((await viewIds(p, o.base, o.d)).slice(1), (v) => showView(p, v), async () => {}, /didn’t load/);
  if (!view) console.log('not checked: no other view needs a card file the first one did not (a file lost: a view)');
  else {
    check(`a file lost: ${view} says it didn't load`, /didn’t load/.test(await toast()), await toast());
    check('a file lost: what was on screen stays', (await onScreen()) === was, await onScreen());
    await showView(p, view); await settle(p, { base: o.base });
    check(`a file lost: ${view} opens when asked again`, (await onScreen()) !== was, await onScreen());
  }
  const popup = await lose((await popupIds(p, o.base, o.d)).filter((id) => id !== 'trend'), (id) => openPopup(p, id), () => closePopup(p), /didn’t open/);
  if (!popup) console.log('not checked: every pop-up\'s card files were loaded already (a file lost: a pop-up)');
  else {
    check(`a file lost: #${popup} says it didn't open`, /didn’t open/.test(await toast()), await toast());
    check('a file lost: no pop-up, and the address has no hash left', !(await popups()) && !(await p.evaluate(() => location.hash)));
    await openPopup(p, popup); await settle(p, { base: o.base });
    check(`a file lost: #${popup} opens when asked again`, (await popups()) === 1);
  }
  // while the page starts: a second page, every card file refused until it is up
  const p2 = await newPage(b, { base: o.base, size: o.size });
  await p2.route(FILES, refuse);
  await open(p2, dashUrl(o.base, { d: o.d, q: o.q }), { patience: 0 });
  const note = () => p2.evaluate(() => { const n = document.querySelector('#app > p'); return n ? n.textContent : ''; });
  const views = () => p2.evaluate(() => document.querySelectorAll('#app > .view, #app > .pview').length);
  check('a file lost at the start: the page says the dashboard didn’t load', /didn’t load/.test(await note()) && !(await views()), await note());
  check('a file lost at the start: the page runs all the same (HA connected)', await until(() => p2.evaluate(async (im) => window.DASH_UP === true && (await (0, eval)(im)('core/ha.js')).connected(), im), 5000));
  await p2.unroute(FILES, refuse);
  check('a file lost at the start: the first view comes by itself within 15 s', await until(async () => (await views()) > 0 && !(await note()), 15000));
  await p2.context().close();
}

console.log('errors:', errs.length ? errs : 'none', bad ? `\n${bad} FAILED` : '\nall passed');
await b.close();
process.exit(bad || errs.length ? 1 : 0);
