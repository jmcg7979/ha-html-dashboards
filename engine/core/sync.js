// Several rooms in sync: Music Assistant's sync groups. One player leads, the others follow its clock and play its queue
// (the same protocol on all of them: Sendspin, AirPlay, Snapcast…). Made and changed with HA's media_player.join / unjoin
// on MA's players, so it needs nothing beyond HA's Music Assistant integration.
//   membersOf(e) -> [leader, …the rest]  ([e] when it plays alone)      leaderOf(e)
//   canSync(a, b): MA can sync these two (its can_group_with, once load() has it; before that, and without the relay: both
//                  are players HA says can be grouped)
//   load(entities) -> Promise      ask MA which of these players sync with which (kept a minute)
//   group(leader, others) -> Promise    exactly these rooms in sync, led by `leader` (rooms it led before and aren't in
//                                       `others` leave; a room that followed or led something else leaves that first)
//   unjoin(e) -> Promise           a follower leaves its group; a leader lets its followers go
//   volOf(e) -> 0..1   setVol(e, v, t0)   one room's volume (shown at once)
//   groupVol(list) -> the rooms' average   setGroupVol(list, v): every room moves in proportion, so the balance between
//                                  rooms stays (as Sonos does); a room already at 0 or 100% stays there
//   groupMuted(list) -> true | false | null   every room that can be muted is; null: none of them can
//   setGroupMuted(list, on)        mute, or bring back, every room that can be
//   svc('media_player.join', data, entity) -> Promise    an HA action whose result is waited for
//   plusRooms(names) -> 'Kitchen + Patio' | 'Kitchen + 2 rooms'   the rooms one music plays on, the first one's name first
//   inSyncWith(names) -> 'In sync with Kitchen and Hallway' | 'In sync with 3 rooms' | ''
// Which actions a change of rooms takes is worked out apart from sending them (groupPlan, movePlan, leavePlan -> steps;
// carryOut(steps) sends them one after the other), so the plans can be checked without a player
// (engine/_dev/test/music-rooms.test.mjs). A step: { call: 'unjoin', entity, grouped } (grouped: only if the room is
// still in a group when its turn comes), { call: 'join', entity: leader, members }, { call: 'transfer', entity: to, from }.
// A speaker group made in the Google Home app (an MA player of type group) is something else: one player, Google's to sync.
import { st, optimistic } from './store.js';
import { request, call } from './ha.js';
import * as MA from './ma.js';
import { ownQueuesIn } from './players.js';
import { SYNC_MAP_KEPT, QUIET_FOR, LOOK_EVERY } from './music-timing.js';

const GROUPING = 524288;   // HA's MediaPlayerEntityFeature.GROUPING: MA sets it on players that can sync
const MUTE = 8;            // HA's MediaPlayerEntityFeature.VOLUME_MUTE
const attrs = (e) => (st(e) || { attributes: {} }).attributes;

export const plusRooms = (names) => (names.length < 2 ? names[0] || '' : names.length === 2 ? names.join(' + ') : `${names[0]} + ${names.length - 1} rooms`);
export const inSyncWith = (names) => (names.length ? 'In sync with ' + (names.length > 2 ? names.length + ' rooms' : names.join(' and ')) : '');

export function membersOf(e) { const m = attrs(e).group_members || []; return m.length > 1 && m.includes(e) ? m.slice() : [e]; }
export const leaderOf = (e) => membersOf(e)[0];

let map = null, at = 0, asking = null;
export function load(entities) {
  if (asking) return asking;
  if (map && Date.now() - at < SYNC_MAP_KEPT && entities.every((e) => map.has(e))) return Promise.resolve();
  // MA first: its command waits for Home Assistant's link (a page builds its first view before it is up), so the
  // registry is asked once there is a link to ask on
  asking = MA.cmd('players/all').then((all) => request({ type: 'config/entity_registry/get_entries', entity_ids: entities }).then((reg) => {
    const ent = new Map();   // MA player id -> HA entity (the entity's unique id is MA's player id)
    Object.entries(reg || {}).forEach(([e, r]) => { if (r && r.platform === 'music_assistant') ent.set(r.unique_id, e); });
    const m = new Map(entities.map((e) => [e, new Set()]));
    (all || []).forEach((x) => { const e = ent.get(x.player_id); if (e) m.set(e, new Set((x.can_group_with || []).map((i) => ent.get(i)).filter(Boolean))); });
    map = m; at = Date.now();
  })).catch(() => {}).then(() => { asking = null; });
  return asking;
}
export function canSync(a, b) {
  if (a === b) return true;
  if (map && map.has(a) && map.has(b)) return map.get(a).has(b) || map.get(b).has(a);
  const g = (e) => ((attrs(e).supported_features || 0) & GROUPING) === GROUPING;
  return g(a) && g(b);
}

export function svc(service, data, entity) {
  const [domain, s] = service.split('.');
  return request({ type: 'call_service', domain, service: s, service_data: data || {}, target: { entity_id: entity } });
}
export const unjoin = (e) => svc('media_player.unjoin', {}, e);

// ---- the plans. members(e) -> [leader, …the rest] as membersOf gives it ----
// exactly these rooms in sync, led by `leader`
export function groupPlan(leader, others, members = membersOf) {
  const steps = [], cur = members(leader);
  if (cur.length > 1 && cur[0] !== leader) steps.push({ call: 'unjoin', entity: leader });
  const mine = cur[0] === leader ? cur.slice(1) : [];
  for (const e of mine) if (!others.includes(e)) steps.push({ call: 'unjoin', entity: e });
  const add = others.filter((e) => e !== leader && !mine.includes(e));
  for (const e of add) steps.push({ call: 'unjoin', entity: e, grouped: true });   // a room that follows or leads something else leaves that first
  if (add.length) steps.push({ call: 'join', entity: leader, members: add });
  return steps;
}
// The music that plays on `cur` ([leader, …]) plays on exactly `list` from now on. While the room that leads stays, rooms
// just join or leave it and the music doesn't stop; otherwise the queue moves to one of the new rooms (one that is
// already playing it, if any) and the others join that.
export function movePlan(cur, list, members = membersOf) {
  const lead = cur[0];
  if (list.includes(lead)) return groupPlan(lead, list.filter((e) => e !== lead), members);
  const to = list.find((e) => cur.includes(e)) || list[0], steps = [];
  for (const e of cur.slice(1)) steps.push({ call: 'unjoin', entity: e });   // the old leader's rooms let go; the ones that stay join the new one
  steps.push({ call: 'transfer', entity: to, from: lead });
  const add = list.filter((e) => e !== to);   // (all let go above; rooms new to it may follow something else)
  for (const e of add) if (!cur.includes(e)) steps.push({ call: 'unjoin', entity: e, grouped: true });
  if (add.length) steps.push({ call: 'join', entity: to, members: add });
  return steps;
}
// `src` drops out of the rooms it plays in sync with (cur: [leader, …]); the others play on. A leader hands its queue to
// the next room, and the rest follow that.
export function leavePlan(src, cur) {
  if (cur.length < 2) return [];
  if (cur[0] !== src) return [{ call: 'unjoin', entity: src }];
  const rest = cur.slice(1), steps = rest.map((e) => ({ call: 'unjoin', entity: e }));
  steps.push({ call: 'transfer', entity: rest[0], from: src });
  if (rest.length > 1) steps.push({ call: 'join', entity: rest[0], members: rest.slice(1) });
  return steps;
}
// send a plan's steps in order, each once Home Assistant has answered the one before; the first refusal ends it (rejects)
export async function carryOut(steps) {
  for (const s of steps) {
    if (s.call === 'unjoin') { if (!s.grouped || membersOf(s.entity).length > 1) await unjoin(s.entity); }
    else if (s.call === 'join') await svc('media_player.join', { group_members: s.members }, s.entity);
    else if (s.call === 'transfer') await svc('music_assistant.transfer_queue', { source_player: s.from, auto_play: true }, s.entity);
  }
}
export const group = (leader, others) => carryOut(groupPlan(leader, others));
// Music on a speaker group (an MA player of type group): a member room that plays a queue of its own on another MA player
// (a TV's Sendspin app) would play both at once, so that queue stops. MA names a group's members
// once it has them (some groups only while they play): those known now stop at once, and the group is watched for 20 s
// after the start for the rest. keep: MA entities left alone (the queue being moved onto the group).
export function quietMembers(groupMa, keep = []) {
  const done = new Set(), t0 = Date.now();
  const once = () => ownQueuesIn(groupMa).filter((m) => !done.has(m) && !keep.includes(m)).map((m) => { done.add(m); return svc('media_player.media_stop', {}, leaderOf(m)).catch(() => {}); });
  const later = () => { once(); if (Date.now() - t0 < QUIET_FOR) setTimeout(later, LOOK_EVERY); };
  setTimeout(later, LOOK_EVERY);
  return Promise.all(once());
}

const VOL_NEAR = 0.02;   // a volume HA reports within this of the one asked for is that one
export const volOf = (e) => +attrs(e).volume_level || 0;
export function setVol(e, v, t0) {   // t0: when the press began (core/store.js tapStart), for the timing readout
  v = Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
  optimistic(e, null, { volume_level: v }, (r) => Math.abs((r.attributes.volume_level || 0) - v) < VOL_NEAR, t0);
  call('media_player.volume_set', { volume_level: v }, e);
}
export const groupVol = (list) => (list.length ? list.reduce((a, e) => a + volOf(e), 0) / list.length : 0);
export function setGroupVol(list, v) {
  const avg = groupVol(list);
  list.forEach((e) => setVol(e, avg > 0.005 ? volOf(e) * v / avg : v));
}
const mutable = (list) => list.filter((e) => attrs(e).supported_features & MUTE);
export const groupMuted = (list) => { const l = mutable(list); return l.length ? l.every((e) => !!attrs(e).is_volume_muted) : null; };
export function setGroupMuted(list, on) {
  mutable(list).forEach((e) => { optimistic(e, null, { is_volume_muted: on }, (r) => !!r.attributes.is_volume_muted === on); call('media_player.volume_mute', { is_volume_muted: on }, e); });
}
