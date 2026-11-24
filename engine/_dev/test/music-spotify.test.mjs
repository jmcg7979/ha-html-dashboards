// core/spotify.js: a Spotify cast's other side. The account's devices are listed under the rooms' own headings, matched
// by name; what is no room of the house comes last.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load } from './stub.mjs';

const { deviceSections, devices } = await load('core/spotify.js'), ST = await load('core/store.js');
const rooms = [
  { key: 'Kitchen Speaker', name: 'Kitchen', icon: 'speaker', title: 'Downstairs' },
  { key: 'Hallway', name: 'Hallway', title: 'Downstairs' },
  { key: 'Office TV', name: 'Office TV', icon: 'television', title: 'Upstairs' },
  { key: 'Den and Patio', name: 'Den and Patio', icon: 'speaker-multiple', title: 'Speaker groups' },
];
const short = (secs) => secs.map((s) => [s.title, s.list.map((x) => `${x.name}=${x.dev} (${x.icon})`)]);

test('the devices under the rooms’ headings: groups first, each floor, then what is no room', () => {
  const got = short(deviceSections(['Pixel 9', 'kitchen speaker', 'Hallway Display', 'Den + Patio', 'Sam’s MacBook', 'Bedroom TV'], rooms));
  assert.deepEqual(got, [
    ['Speaker groups', ['Den and Patio=Den + Patio (speaker-multiple)']],   // "+" is "and"
    ['Downstairs', ['Kitchen=kitchen speaker (speaker)', 'Hallway=Hallway Display (speaker)']],   // the same name whatever its case; "Hallway" finds "Hallway Display"
    ['Other devices', ['Pixel 9=Pixel 9 (cellphone)', 'Sam’s MacBook=Sam’s MacBook (laptop)', 'Bedroom TV=Bedroom TV (television)']],
  ]);
});

test('no room among them: one list of devices; a device is taken by one room only', () => {
  assert.deepEqual(short(deviceSections(['Pixel 9', 'Office iMac'], rooms)), [['Devices', ['Pixel 9=Pixel 9 (cellphone)', 'Office iMac=Office iMac (laptop)']]]);
  const twice = [{ key: 'Hallway', name: 'Hallway', title: 'Downstairs' }, { key: 'Hallway', name: 'Hallway again', title: 'Downstairs' }];
  assert.deepEqual(short(deviceSections(['Hallway'], twice)), [['Downstairs', ['Hallway=Hallway (speaker)']]]);
});

test('the account’s devices: each once, and only when there is somewhere else to play', () => {
  ST.applyEntities({ a: { 'media_player.sp': { s: 'playing', a: { source: 'Kitchen', source_list: ['Kitchen', 'Pixel 9', 'Kitchen'] }, lc: 1 }, 'media_player.sp1': { s: 'playing', a: { source: 'Kitchen', source_list: ['Kitchen'] }, lc: 1 } } });
  assert.deepEqual(devices('media_player.sp'), { id: 'media_player.sp', list: ['Kitchen', 'Pixel 9'], cur: 'Kitchen' });
  assert.equal(devices('media_player.sp1'), null);
  assert.equal(devices(null), null);
});
