// The parts of the weather and TV-home cards that decide what is shown: the status bar's alarm item, the radar's frames,
// the app tiles and the Watch Next row.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load } from './stub.mjs';

const { alarmView } = await load('cards/statusbar.js'), R = await load('cards/radar.js');
const { tiles } = await load('cards/apps.js'), { cards } = await load('cards/watchnext.js');
const MIN = 60e3;

test('status bar: an alarm that is not reporting is neither armed nor off', () => {
  for (const s of ['unavailable', 'unknown', '', undefined, null]) assert.deepEqual(alarmView(s), { s: 'none', text: 'Not reporting', icon: 'shield-alert' }, String(s));
  assert.deepEqual(alarmView('disarmed'), { s: 'off', text: 'Off', icon: 'shield-off-outline' });
  for (const s of ['armed_away', 'armed_home', 'armed_night', 'armed_vacation', 'armed_custom_bypass', 'arming', 'disarming']) { const v = alarmView(s); assert.equal(v.s, 'armed', s); assert.equal(v.icon, 'shield-lock'); assert.doesNotMatch(v.text, /_/); }
  assert.equal(alarmView('pending').s, 'alert'); assert.equal(alarmView('triggered').s, 'alert');
  assert.deepEqual(alarmView('some_new_state'), { s: 'none', text: 'some new state', icon: 'shield-alert' }, 'a state it does not know is shown as it is, without the lock');
});

test('radar: the frames are the radar now, then one model frame per step that the run covers', () => {
  const now = Date.UTC(2026, 10, 14, 15, 7), init = Date.UTC(2026, 10, 14, 13, 0);
  const list = R.frameList(now, init, 3, 30);
  assert.equal(list.length, 7); assert.equal(list[0].now, true); assert.equal(list[0].t, now);
  assert.deepEqual(list.slice(1).map((f) => f.ahead / MIN), [30, 60, 90, 120, 150, 180]);
  assert.equal(list[1].t, Date.UTC(2026, 10, 14, 15, 30), 'the model minute nearest to half an hour from now');
  assert.match(list[1].url, /REFD-F0150-202611141300\//);
  assert.equal(R.frameList(now, now - 20 * 3600e3, 3, 30).length, 1, 'a run that ended before now: only the radar');
  assert.equal(R.frameList(now, now - 17 * 3600e3, 3, 30).length, 3, 'a run with an hour left: the frames it has');
  assert.equal(R.ahead(45 * MIN), '+45 min'); assert.equal(R.ahead(90 * MIN), '+1.5 h'); assert.equal(R.ahead(120 * MIN), '+2 h');
});

test('apps: pinned tiles in their order, the rest A to Z, and no launcher means everything counts as installed', () => {
  const cfg = { apps: [{ pkg: 'b', name: 'Bee' }, { pkg: 'gone', name: 'Gone' }] }, have = [{ pkg: 'z', label: 'Zed' }, { pkg: 'b', label: 'Bee' }, { pkg: 'a', label: 'Ay' }];
  assert.deepEqual(tiles(cfg, have).map((a) => [a.pkg, a.ok]), [['b', true], ['gone', false]]);
  assert.deepEqual(tiles(cfg, null).map((a) => a.ok), [true, true]);
  assert.deepEqual(tiles({ ...cfg, rest: true }, have).map((a) => a.name), ['Ay', 'Zed']);
  assert.deepEqual(tiles({ rest: true }, null), []);
});

test('watch next: one card per show, with how far in it is', () => {
  const ep = (title, n, pos, dur) => ({ package_name: 'p', title, season_display_number: 1, episode_display_number: n, last_playback_position_millis: pos, duration_millis: dur });
  const list = cards([ep('Show', 2, 30, 60), ep('Show', 3, 0, 60), { error: 'x' }, { package_name: 'com.plexapp.android', title: 'Film', last_playback_position_millis: 90, duration_millis: 60 }, { package_name: 'p' }]);
  assert.deepEqual(list.map((c) => [c.key, c.pct, c.sub]), [['p|Show', 50, 'S1 · E2'], ['com.plexapp.android|Film', 100, 'Plex']]);
  assert.deepEqual(cards(null), []); assert.equal(cards(Array.from({ length: 20 }, (x, i) => ep('S' + i, 1, 0, 0)), 5).length, 5);
});
