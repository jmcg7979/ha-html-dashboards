// core/steady.js: the rules that smooth a song change (steadyStep: the memo so far, what the entities say, the time), and
// core/players.js: the rules for which entity to believe (sourcesAt), run on made-up states. The times are the ones the rules were tuned
// to on real speakers and TVs; a test that fails after a constant was changed is the point.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load } from './stub.mjs';

const P = await load('core/players.js'), T = await load('core/steady.js');
const fresh = T.fresh;
const n = (title, state = 'playing', more = {}) => ({ state, title, artist: '', a: {}, screen: false, ...more });
// feed a list of [ms, observation] to the rules; -> what each step shows, as 'title' / 'title~' (held) / 'title…' (starting) / '-'
function run(memo, steps) {
  const out = [];
  for (const [t, obs] of steps) { const r = T.steadyStep(memo, obs, t); memo = r.memo; out.push(!r.show ? '-' : r.show.title + (r.show.starting ? '…' : r.show.held ? '~' : '')); }
  return { out, memo };
}
const skip = (t0, target) => ({ ...fresh(), skip: { t0, sawStop: false, okSince: 0, ...target } });

test('between songs the last one stays for 8 s while the player is idle, then nothing', () => {
  const { out } = run(fresh(), [[0, { n: n('A') }], [1000, { n: null }], [7000, { n: null }], [9100, { n: null }]]);
  assert.deepEqual(out, ['A', 'A~', 'A~', '-']);
});

test('our own Stop: once the player is quiet nothing is held', () => {
  const a = run(fresh(), [[0, { n: n('A') }]]);
  const stopped = { ...a.memo, stop: 500, skip: null, cand: null };   // what noteStop leaves
  assert.deepEqual(run(stopped, [[900, { n: n('A') }], [1500, { n: null }], [2500, { n: null }]]).out, ['A', '-', '-'], 'still playing for a moment, then gone at once');
  const old = { ...a.memo, stop: 500 };
  assert.deepEqual(run(old, [[20000, { n: n('A') }], [21000, { n: null }]]).out, ['A', 'A~'], 'a Stop long ago does not end a later song change');
});

test('a title this screen did not ask for shows once it has held 1.5 s', () => {
  const { out } = run(fresh(), [[0, { n: n('A') }], [2000, { n: n('B') }], [3000, { n: n('B') }], [3600, { n: n('B') }]]);
  assert.deepEqual(out, ['A', 'A~', 'A~', 'B']);
  assert.deepEqual(run(fresh(), [[0, { n: n('A') }], [2000, { n: n('B') }], [2400, { n: n('A') }], [2500, { n: n('A') }]]).out, ['A', 'A~', 'A', 'A'], 'a flip back is never shown');
});

test('our Next on a Cast speaker: Starting… until Cast has stopped and played a steady second', () => {
  const cast = (cplay, now) => ({ n: now, cplay, castMA: true });
  const { out } = run(skip(0, { title: 'B' }), [
    [200, cast(true, n('A'))],              // MA still names the old song, Cast still plays it
    [900, cast(true, n('B'))],              // the title is there, the sound isn't
    [2100, cast(false, n('B', 'idle'))],    // Cast stops
    [3900, cast(true, n('B'))],             // a blip while it buffers
    [4200, cast(false, n('B', 'buffering'))],
    [4800, cast(true, n('B'))],
    [5500, cast(true, n('B'))],             // 0.7 s of playing: not yet
    [5900, cast(true, n('B'))],             // 1.1 s: heard
  ]);
  assert.deepEqual(out, ['B…', 'B…', 'B…', 'B…', 'B…', 'B…', 'B…', 'B']);
});

test('our Next on a player app (not Cast): the song is there within a second', () => {
  const app = (now) => ({ n: now, cplay: true, castMA: false });
  assert.deepEqual(run(skip(0, { title: 'B' }), [[300, app(n('A'))], [600, app(n('B'))], [1000, app(n('B'))], [1500, app(n('B'))]]).out, ['B…', 'B…', 'B…', 'B']);
});

test('a skip that never settles ends after 20 s with what the player says', () => {
  const o = { n: n('A'), cplay: true, castMA: true };
  assert.deepEqual(run(skip(0, { title: 'B' }), [[1000, o], [19000, o], [20500, o]]).out, ['B…', 'B…', 'A']);
});

test('a change from elsewhere: the new song at once, no Starting… while the sound goes on', () => {
  const o = (now) => ({ n: now, cplay: true, castMA: true });
  const r = run(skip(0, { soft: true, title: 'B' }), [[100, o(n('A'))], [600, o(n('B'))], [3000, o(n('B'))], [4500, o(n('B'))]]);
  assert.deepEqual(r.out, ['B~', 'B', 'B', 'B']); assert.equal(r.memo.skip, null);
  const stops = run(skip(0, { soft: true, title: 'B' }), [[600, o(n('B'))], [1500, { n: n('B', 'idle'), cplay: false, castMA: true }], [3000, o(n('B'))], [4200, o(n('B'))]]);
  assert.deepEqual(stops.out, ['B', 'B…', 'B…', 'B'], 'it stopped the sound after all: like our own skip from there');
});

test('which entity is believed: Music Assistant with a queue first; a Sendspin mirror on Cast never; an off TV has nothing', () => {
  const p = { entity: 'media_player.tv', ma: 'media_player.tv_ma', power: 'remote.tv', name: 'TV' };
  const world = (o) => (id) => o[id] || null, conf = new Map();
  const ids = (o) => P.sourcesAt(p, world(o), conf, 1000).map((x) => x.id);
  const ma = { state: 'playing', attributes: { active_queue: 'q', media_title: 'A' } }, on = { state: 'on', attributes: {} }, off = { state: 'off', attributes: {} };
  assert.deepEqual(ids({ [p.ma]: ma, [p.entity]: { state: 'playing', attributes: { app_name: 'Music Assistant', media_title: 'A' } }, [p.power]: on }), [p.ma, p.entity, p.power]);
  assert.deepEqual(ids({ [p.ma]: ma, [p.entity]: { state: 'paused', attributes: { app_name: 'SendSpin Player' } }, [p.power]: on }), [p.ma, p.power]);
  assert.deepEqual(ids({ [p.entity]: { state: 'paused', attributes: { app_name: 'YouTube' } }, [p.power]: off }), []);
  assert.deepEqual(ids({ [p.ma]: { state: 'idle', attributes: {} }, [p.power]: on }), [p.power]);
});

test('Spotify on a TV counts only in front, or when the account names this TV (not the account playing elsewhere)', () => {
  const p = { entity: 'media_player.tv', ma: null, power: 'media_player.tv_remote', name: 'TV', spotify: 'media_player.spotify' };
  const world = (o) => (id) => o[id] || null;
  const ids = (o) => P.sourcesAt(p, world(o), new Map(), 1000).map((x) => x.id);
  const cast = { state: 'playing', attributes: { app_name: 'Spotify', app_id: 'CAD366A1', media_title: 'A' } };   // Spotify's Cast id
  const front = (pkg) => ({ state: 'on', attributes: { app_id: pkg } });
  const account = (where) => ({ state: 'playing', attributes: { source: where, media_title: 'A' } });
  // 2026-11-16, a TV: HBO Max in front, the account playing on Music Assistant: only the TV is on
  assert.deepEqual(ids({ [p.entity]: cast, [p.power]: front('com.wbd.stream'), 'media_player.spotify': account('Music Assistant Playback') }), [p.power]);
  // the Spotify app in front: its session is this TV's
  assert.deepEqual(ids({ [p.entity]: cast, [p.power]: front('com.spotify.tv.android'), 'media_player.spotify': account('Music Assistant Playback') }), [p.entity, p.power]);
  // cast from a phone, our launcher in front: the account names this TV
  assert.deepEqual(ids({ [p.entity]: cast, [p.power]: front('dash.tv'), 'media_player.spotify': account('TV') }), [p.entity, p.power]);
});

test('speaker groups: a room follows its group while the group plays it; a stopped group\'s queue isn\'t the room\'s', () => {
  // as seen 2026-11-16: every member of a group names the group's queue, and keeps it after the group stops
  const tv = { entity: 'media_player.gs_tv', name: 'Bedroom TV' }, jo = { entity: 'media_player.jo_tv', name: 'Study TV', ma: 'media_player.jo_sendspin', castMa: 'media_player.jo_tv_ma' };
  const g = 'media_player.inside_ma', groups = [g];
  const grp = (state) => ({ state, attributes: { mass_player_type: 'group', active_queue: 'G', group_members: ['media_player.gs_tv_ma', 'media_player.jo_tv_ma'], media_title: 'A' } });
  const member = (state) => ({ state, attributes: { mass_player_type: 'player', active_queue: 'G', media_title: 'A' } });
  const own = (state) => ({ state, attributes: { mass_player_type: 'player', active_queue: 'own', source: 'Music Assistant Queue', media_title: 'B' } });
  const world = (o) => (id) => o[id] || null;
  // playing: the room is the group's
  assert.equal(P.groupNowAt(tv, groups, world({ [g]: grp('playing'), 'media_player.gs_tv_ma': member('playing') })), g);
  // stopped: still a member, but not playing the group now
  const stoppedW = world({ [g]: grp('idle'), 'media_player.gs_tv_ma': member('idle') });
  assert.equal(P.groupMaOfAt(tv, groups, stoppedW), g);
  assert.equal(P.groupNowAt(tv, groups, stoppedW), null);
  // a TV through Sendspin: its Cast player is the member; its own queue playing something else is what the room shows
  assert.equal(P.groupNowAt(jo, groups, world({ [g]: grp('playing'), 'media_player.jo_tv_ma': member('playing'), 'media_player.jo_sendspin': own('idle') })), g);
  assert.equal(P.groupNowAt(jo, groups, world({ [g]: grp('playing'), 'media_player.jo_tv_ma': member('playing'), 'media_player.jo_sendspin': own('playing') })), null);
  // a speaker whose MA player stays idle while its Cast side plays the group: still the group's
  assert.equal(P.groupNowAt(tv, groups, world({ [g]: grp('playing'), 'media_player.gs_tv_ma': member('idle') })), g);
  // another app in front with another title: the room shows that, not the group
  assert.equal(P.groupNowAt(tv, groups, world({ [g]: grp('playing'), 'media_player.gs_tv_ma': member('idle') }), { title: 'A film', screen: false }), null);
  // a room the group doesn't list isn't in it, whatever queue it names
  assert.equal(P.groupMaOfAt({ entity: 'media_player.kitchen' }, groups, world({ [g]: grp('playing'), 'media_player.kitchen_ma': member('playing') })), null);
});
