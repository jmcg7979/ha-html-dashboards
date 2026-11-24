// The site validator (tools/check-site.mjs) against a copy of the example site with one mistake of each kind written
// into it: every mistake is reported, and none of them is reported for the site as it is.
import test from 'node:test'; import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './stub.mjs';

const tool = path.join(ROOT, 'engine/_dev/tools/check-site.mjs');
const check = (...args) => new Promise((done) => execFile(process.execPath, [tool, ...args, '--json'], { encoding: 'utf8', maxBuffer: 1e8 }, (e, stdout, stderr) => done({ code: e ? e.code : 0, out: JSON.parse(stdout), err: stderr })));
const has = (list, check, text) => list.some((f) => f.check === check && (f.file + ': ' + f.path + ': ' + f.message).includes(text));

// a copy of the example site (config and mock, not its pictures) that a test can write mistakes into
function copy() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-site-')), to = path.join(tmp, 'example');
  process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
  for (const part of ['dash', 'mock']) fs.cpSync(path.join(ROOT, 'sites/example', part), path.join(to, part), { recursive: true, filter: (f) => !f.includes(`${path.sep}assets${path.sep}`) });
  return to;
}
const edit = (file, from, to) => { const text = fs.readFileSync(file, 'utf8'); assert.ok(text.includes(from), `${path.basename(file)} still has: ${from}`); fs.writeFileSync(file, text.replace(from, to)); };

// the copies and their mistakes first, then every run at the same time
const seeded = copy(), bare = copy(), listed = copy(), d = (f) => path.join(seeded, 'dash', f);
edit(d('dashboards/main.js'), "{ type: 'heading', title: 'Climate' }", "{ type: 'headign', title: 'Climate' }");   // a card type that doesn't exist
edit(d('popups.js'), "name: 'Front door lock', mode: 'state'", "nmae: 'Front door lock', mode: 'state'");          // an option the card doesn't read
edit(d('dashboards/main.js'), "tap: { nav: '#sam' }", "tap: { nav: '#samm' }");                                    // a pop-up that doesn't exist
edit(d('dashboards/main.js'), "action: { view: 'cameras' }", "action: { view: 'camera' }");                         // a view that doesn't exist
edit(d('dashboards/main.js'), "action: { nav: '#calendar' }", "action: { nav: '#calendar', veiw: 'x' }");           // a key a tap action doesn't read
edit(d('dashboards/main.js'), "buttons: [{ icon: 'calendar-month',", "buttons: [{ icno: 'calendar-month',");        // a nested option nothing reads
edit(d('home.js'), "'light.living_room'", "'light.living_rom'");                                                    // an entity id HA doesn't have
edit(d('home.js'), 'export const weather =', "export const spare = { entity: 'sensor.spare' };\nexport const weather =");   // an export nothing reads
edit(d('dashboards/main.js'), 'H.weather', 'H.security.wether');                                                    // a home.js key that doesn't exist
edit(d('home.js'), "clock: '12h' }", "clock: '12h', clock: '24h' }");                                               // a key written twice
fs.rmSync(path.join(bare, 'mock'), { recursive: true });
edit(path.join(bare, 'dash/dashboards/main.js'), "tap: { nav: '#sam' }", "tap: { nav: '#samm' }");
const ids = Object.keys((await import(pathToFileURL(path.join(listed, 'mock/states.mjs')).href)).S), list = path.join(listed, 'entities.txt');
fs.writeFileSync(list, ids.filter((id) => id !== 'sun.sun').join('\n') + '\n');
const [clean, wrong, noList, withList] = await Promise.all([check('example', '--mock'), check(seeded, '--mock'), check(bare), check(listed, '--entities', list)]);

test('the example site loads: every dashboard, with cards and entity ids found', () => {
  assert.ok(clean.out.dashboards.includes('main') && clean.out.dashboards.includes('mobile') && clean.out.dashboards.includes('tv'), clean.out.dashboards.join(' '));
  assert.ok(clean.out.cards > 100 && clean.out.cardTypes > 30 && clean.out.entityIds > 100);
  assert.equal(clean.code, clean.out.errors ? 1 : 0, 'exit 1 exactly when there are errors');
  for (const kind of ['load', 'type', 'action', 'link']) assert.ok(!clean.out.findings.errors.some((f) => f.check === kind), `${kind}: ` + JSON.stringify(clean.out.findings.errors.filter((f) => f.check === kind)));
});

test('one mistake of each kind is found', () => {
  const r = wrong, E = r.out.findings.errors, W = r.out.findings.warnings;
  assert.equal(r.code, 1);
  assert.ok(has(E, 'type', "card type 'headign' has no module"), 'card type');
  assert.ok(has(E, 'option', "option 'nmae' is never read by the tile card"), 'option');
  assert.ok(has(E, 'link', "opens pop-up '#samm'"), 'pop-up link');
  assert.ok(has(E, 'link', "goes to view 'camera'"), 'view link');
  assert.ok(has(E, 'action', "'veiw' is not something a tap action reads"), 'action key');
  assert.ok(has(E, 'entity', 'light.living_rom is not in'), 'entity id');
  assert.ok(has(E, 'entity', 'sensor.spare is not in'), 'an id only home.js names is checked too');
  assert.ok(has(E, 'home-missing', 'security.wether'), 'missing home.js key');
  assert.ok(has(W, 'nested', "'icno'"), 'nested option');
  assert.ok(has(W, 'home-unread', 'spare'), 'unread export');
  assert.ok(has(W, 'home-duplicate', "key 'clock' is written twice"), 'duplicate key');
  // nothing else became an error because of them: the same errors as the untouched site, plus these eight
  const added = E.filter((f) => !clean.out.findings.errors.some((c) => c.check === f.check && c.message === f.message));
  assert.equal(added.length, 8, added.map((f) => `${f.check}: ${f.message}`).join('\n'));
});

test('without an entity list it still checks types, options and links, and says what it did not check', () => {
  const r = noList;
  assert.ok(has(r.out.findings.errors, 'link', "'#samm'")); assert.ok(!r.out.findings.errors.some((f) => f.check === 'entity'));
  assert.ok(r.out.notChecked.some((x) => /entity ids/.test(x)), r.out.notChecked.join('\n'));
});

test('an entity list on disk: ids that are not in it are errors', () => {
  const E = withList.out.findings.errors.filter((f) => f.check === 'entity');
  assert.ok(has(E, 'entity', 'sun.sun is not in'), JSON.stringify(E).slice(0, 400));
  assert.equal(E.length, 1);
});
