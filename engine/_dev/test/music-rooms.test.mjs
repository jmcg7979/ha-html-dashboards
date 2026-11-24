// core/sync.js: which Home Assistant actions a change of rooms takes, and in which order (the plans; carryOut sends them),
// and how rooms that play together are named.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load } from './stub.mjs';

const { groupPlan, movePlan, leavePlan, plusRooms, inSyncWith } = await load('core/sync.js');
const K = 'media_player.kitchen', P = 'media_player.porch', O = 'media_player.office', L = 'media_player.living';
// who plays with whom: { leader: [followers] }
const members = (groups) => (e) => { for (const [lead, rest] of Object.entries(groups)) if (lead === e || rest.includes(e)) return [lead, ...rest]; return [e]; };
const said = (steps) => steps.map((s) => (s.call === 'join' ? `join ${s.members.join('+')} -> ${s.entity}` : s.call === 'transfer' ? `queue ${s.from} -> ${s.entity}` : `unjoin ${s.entity}${s.grouped ? ' if grouped' : ''}`));

test('a room is added to one that plays: one join, nothing stops', () => {
  assert.deepEqual(said(movePlan([K], [K, P], members({}))), [`unjoin ${P} if grouped`, `join ${P} -> ${K}`]);
});

test('a follower is dropped while the leader stays: one unjoin', () => {
  assert.deepEqual(said(movePlan([K, P, O], [K, O], members({ [K]: [P, O] }))), [`unjoin ${P}`]);
});

test('the leader is dropped: its rooms let go, the queue moves to one that was playing, the rest join that', () => {
  assert.deepEqual(said(movePlan([K, P, O], [P, O], members({ [K]: [P, O] }))), [`unjoin ${P}`, `unjoin ${O}`, `queue ${K} -> ${P}`, `join ${O} -> ${P}`]);
});

test('the music moves to rooms that had none of it', () => {
  assert.deepEqual(said(movePlan([K], [L], members({}))), [`queue ${K} -> ${L}`]);
  assert.deepEqual(said(movePlan([K], [L, O], members({}))), [`queue ${K} -> ${L}`, `unjoin ${O} if grouped`, `join ${O} -> ${L}`]);
});

test('exactly these rooms, led by one of them', () => {
  assert.deepEqual(said(groupPlan(K, [P], members({ [K]: [O] }))), [`unjoin ${O}`, `unjoin ${P} if grouped`, `join ${P} -> ${K}`]);
  assert.deepEqual(said(groupPlan(P, [O], members({ [K]: [P] }))), [`unjoin ${P}`, `unjoin ${O} if grouped`, `join ${O} -> ${P}`], 'a follower that is to lead leaves first');
  assert.deepEqual(said(groupPlan(K, [P], members({ [K]: [P] }))), [], 'already so');
  assert.deepEqual(said(groupPlan(K, [], members({}))), []);
});

test('a room leaves: a follower just goes; a leader hands its queue to the next room', () => {
  assert.deepEqual(said(leavePlan(P, [K, P, O])), [`unjoin ${P}`]);
  assert.deepEqual(said(leavePlan(K, [K, P, O])), [`unjoin ${P}`, `unjoin ${O}`, `queue ${K} -> ${P}`, `join ${O} -> ${P}`]);
  assert.deepEqual(said(leavePlan(K, [K, P])), [`unjoin ${P}`, `queue ${K} -> ${P}`]);
  assert.deepEqual(leavePlan(K, [K]), []);
});

test('rooms named together: the first one first, three or more as a count', () => {
  assert.deepEqual([[], ['Kitchen'], ['Kitchen', 'Hallway'], ['Kitchen', 'Hallway', 'Porch']].map(plusRooms), ['', 'Kitchen', 'Kitchen + Hallway', 'Kitchen + 2 rooms']);
  assert.deepEqual([[], ['Hallway'], ['Hallway', 'Porch'], ['Hallway', 'Porch', 'Den']].map(inSyncWith), ['', 'In sync with Hallway', 'In sync with Hallway and Porch', 'In sync with 3 rooms']);
});
