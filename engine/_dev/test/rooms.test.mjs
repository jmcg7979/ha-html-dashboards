// Music in several rooms: who is in a sync group (core/sync.js) and what a tap in the "Play on" picker selects
// (core/where.js). The connection is replaced by a recorder; Music Assistant is never asked, so "can these two sync"
// comes from what HA says about each player.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load, override, clock } from './stub.mjs';

const asked = [];
override('core/ha.js', { connected: () => true, call: (service, data, target) => { asked.push([service, target, data]); },
  request: (msg) => { if (msg.type === 'call_service') { asked.push([msg.domain + '.' + msg.service, msg.target.entity_id, msg.service_data]); return Promise.resolve({}); } return Promise.reject(new Error('not in this test')); } });
const Y = await load('core/sync.js'), { where } = await load('core/where.js'), S = await load('core/store.js');
const GROUPING = 524288;
let stamp = 1;   // as in HA, every update of an entity carries a later time
const player = (id, members, more = {}) => S.applyEntities({ a: { [id]: { s: 'idle', a: { group_members: members || [], supported_features: GROUPING, volume_level: 0.5, ...more }, lc: ++stamp } } });
const K = 'media_player.kitchen', L = 'media_player.living', B = 'media_player.bedroom', O = 'media_player.old_speaker', G = 'media_player.downstairs_group';
const reset = () => { clock.advance(13000);   // past any volume a test before this one is still showing optimistically
  [K, L, B].forEach((e) => player(e)); player(O, [], { supported_features: 0 }); player(G, [], { supported_features: 0 }); asked.length = 0; };

test('membersOf / leaderOf: the leader first; a room alone is its own group', () => {
  reset(); player(K, [L, K]); player(L, [L, K]);
  assert.deepEqual(Y.membersOf(K), [L, K]); assert.equal(Y.leaderOf(K), L); assert.equal(Y.leaderOf(L), L);
  assert.deepEqual(Y.membersOf(B), [B]); assert.deepEqual(Y.membersOf('media_player.none'), ['media_player.none']);
  player(B, [K, L]); assert.deepEqual(Y.membersOf(B), [B], 'a list it is not in itself is not its group');
});

test('canSync: both must be players HA can group', () => {
  reset();
  assert.equal(Y.canSync(K, L), true); assert.equal(Y.canSync(K, O), false); assert.equal(Y.canSync(O, O), true); assert.equal(Y.canSync(K, 'media_player.none'), false);
});

test('group: exactly these rooms, led by the first', async () => {
  reset();
  await Y.group(K, [L, B]);
  assert.deepEqual(asked, [['media_player.join', K, { group_members: [L, B] }]]);
});
test('group: a room the leader led before and is not wanted leaves; one that is already in stays', async () => {
  reset(); [K, L, B].forEach((e) => player(e, [K, L, B]));
  await Y.group(K, [L]);
  assert.deepEqual(asked, [['media_player.unjoin', B, {}]]);
});
test('group: a follower that becomes the leader leaves its group first; a room taken from another group leaves that', async () => {
  reset(); player(K, [L, K]); player(L, [L, K]); player(B, [B, O]); player(O, [B, O]);
  await Y.group(K, [B]);
  assert.deepEqual(asked, [['media_player.unjoin', K, {}], ['media_player.unjoin', B, {}], ['media_player.join', K, { group_members: [B] }]]);
});
test('group: nothing to change, nothing sent', async () => {
  reset(); player(K, [K, L]); player(L, [K, L]);
  await Y.group(K, [L]); await Y.group(B, []);
  assert.deepEqual(asked, []);
});

test('group volume: the average; a change keeps the balance between rooms', () => {
  reset(); player(K, [], { volume_level: 0.2 }); player(L, [], { volume_level: 0.4 });
  assert.ok(Math.abs(Y.groupVol([K, L]) - 0.3) < 1e-9); assert.equal(Y.groupVol([]), 0); assert.equal(Y.volOf('media_player.none'), 0);
  Y.setGroupVol([K, L], 0.6);
  assert.deepEqual(asked, [['media_player.volume_set', K, { volume_level: 0.4 }], ['media_player.volume_set', L, { volume_level: 0.8 }]]);
  assert.equal(Y.volOf(K), 0.4, 'shown at once');
});
test('group volume: no room goes past full, and silent rooms all come up together', () => {
  reset(); player(K, [], { volume_level: 0.2 }); player(L, [], { volume_level: 0.9 });
  Y.setGroupVol([K, L], 1);
  assert.deepEqual(asked.map((a) => a[2].volume_level), [0.36, 1]);
  reset(); player(K, [], { volume_level: 0 }); player(L, [], { volume_level: 0 });
  Y.setGroupVol([K, L], 0.3);
  assert.deepEqual(asked.map((a) => a[2].volume_level), [0.3, 0.3]);
});

test('group mute: every room that can be muted, as one; muted only when all of them are', () => {
  const MUTE = 8;
  reset(); player(K, [], { supported_features: GROUPING | MUTE }); player(L, [], { supported_features: GROUPING | MUTE, is_volume_muted: true }); player(O, [], { supported_features: 0 });
  assert.equal(Y.groupMuted([K, L, O]), false, 'one room still sounds');
  assert.equal(Y.groupMuted([O]), null, 'no room that can be muted: no button');
  Y.setGroupMuted([K, L, O], true);
  assert.deepEqual(asked, [['media_player.volume_mute', K, { is_volume_muted: true }], ['media_player.volume_mute', L, { is_volume_muted: true }]]);
  assert.equal(Y.groupMuted([K, L, O]), true, 'shown at once');
  asked.length = 0; Y.setGroupMuted([K, L], false);
  assert.deepEqual(asked.map((a) => a[2].is_volume_muted), [false, false]);
});

const targets = [{ entity: K, name: 'Kitchen', floor: 'Downstairs' }, { entity: L, name: 'Living Room', floor: 'Downstairs' }, { entity: B, name: 'Bedroom', floor: 'Upstairs' },
  { entity: O, name: 'Old speaker' }, { entity: G, name: 'Downstairs', group: true }];

test('picker: rooms that can sync add up, a tap on a picked room takes it out', () => {
  reset(); const W = where({ targets });
  assert.deepEqual(W.choose([], K), [K]); assert.deepEqual(W.choose([K], L), [K, L]); assert.deepEqual(W.choose([K, L], K), [L]); assert.deepEqual(W.choose([K], K), []);
  assert.deepEqual(W.choose([K], 'media_player.not_listed'), [K]);
});
test('picker: a room that can not sync, or a speaker group, stands alone', () => {
  reset(); const W = where({ targets });
  assert.deepEqual(W.choose([K, L], O), [O], 'it replaces the rooms picked'); assert.deepEqual(W.choose([O], K), [K]);
  assert.deepEqual(W.choose([K, L], G), [G]); assert.deepEqual(W.choose([G], K), [K]); assert.deepEqual(W.choose([G], G), []);
});
test('picker: label and sections', () => {
  reset(); const W = where({ targets, own: K });
  assert.equal(W.label([]), ''); assert.equal(W.label([L]), 'Living Room'); assert.equal(W.label([K, L, B]), '3 rooms');
  assert.deepEqual(W.sections().map((s) => [s.title, s.list.map((t) => t.name)]), [['Speaker groups', ['Downstairs']], ['Downstairs', ['Kitchen', 'Living Room']], ['Upstairs', ['Bedroom']], ['Rooms', ['Old speaker']]]);
  assert.equal(W.isGroup(G), true); assert.equal(W.isGroup(K), false);
});
test('picker: what is on in a room', () => {
  reset(); const W = where({ targets });
  S.applyEntities({ c: { [K]: { '+': { s: 'playing', a: { media_title: 'Song', media_artist: 'Band' } } }, [L]: { '+': { s: 'paused', a: { media_title: 'Other' } } }, [B]: { '+': { s: 'unavailable' } } } });
  assert.deepEqual([W.onNow(targets[0]).live, W.onNow(targets[0]).playing, W.onNow(targets[0]).title, W.onNow(targets[0]).sub], [true, true, 'Song', 'Band']);
  assert.deepEqual([W.onNow(targets[1]).playing, W.onNow(targets[1]).sub], [false, 'Paused']);
  assert.deepEqual([W.onNow(targets[2]).off, W.onNow(targets[2]).title], [true, 'Not available']);
  assert.equal(W.onNow(targets[3]).title, 'Nothing playing');
});
