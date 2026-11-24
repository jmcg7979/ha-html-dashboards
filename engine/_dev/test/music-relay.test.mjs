// The relay (engine/ha/custom_components/ma_relay) passes on exactly the Music Assistant commands the dashboard sends:
// its ALLOWED list and the commands in the dashboard's code are compared, both ways, so neither drifts from the other.
// The mock's made-up Music Assistant (engine/_dev/mock/music.mjs) answers the same list.
import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
import { ROOT } from './stub.mjs';

const py = fs.readFileSync(path.join(ROOT, 'engine/ha/custom_components/ma_relay/__init__.py'), 'utf8');
const block = (name) => { const m = py.match(new RegExp(name + ' = frozenset\\(\\{([^}]*)\\}\\)')); assert.ok(m, name + ' is a frozenset in the relay'); return new Set([...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])); };
const ALLOWED = block('ALLOWED'), EVENTS = block('EVENTS');
// every MA command written in the dashboard's code
const used = new Set(), FAMILY = /['"`]((?:music|player_queues|players|metadata|party)\/[a-z_/]*)['"`]/g;
for (const dir of ['engine/core', 'engine/cards', 'engine/pages']) for (const f of fs.readdirSync(path.join(ROOT, dir), { recursive: true })) {   // (a card's parts are in a folder of its own)
  if (!f.endsWith('.js')) continue;
  for (const m of fs.readFileSync(path.join(ROOT, dir, f), 'utf8').matchAll(FAMILY)) used.add(m[1]);
}
// 'player_queues/' + k is the two switches of the queue (core/session.js toggle)
if (used.delete('player_queues/')) { used.add('player_queues/autoplay'); used.add('player_queues/crossfade'); }

test('every command the dashboard sends is relayed', () => {
  assert.ok(used.size >= 15, 'the commands were found in the code');
  assert.deepEqual([...used].filter((c) => !ALLOWED.has(c)), []);
});

test('nothing is relayed that the dashboard does not send', () => {
  assert.deepEqual([...ALLOWED].filter((c) => !used.has(c)), []);
  for (const c of ALLOWED) assert.ok(!/^(config|providers|auth|players\/cmd|music\/(library|sync|playlists\/(create|add|remove)))/.test(c), c + ': no settings, accounts, player commands or library edits');
});

test('the events a screen subscribes to are the ones the relay passes on', () => {
  const ma = fs.readFileSync(path.join(ROOT, 'engine/core/ma.js'), 'utf8'), m = ma.match(/events: \[([^\]]*)\]/);
  assert.deepEqual([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort(), [...EVENTS].sort());
});

test('the mock answers every relayed command, and no other', () => {
  const mock = fs.readFileSync(path.join(ROOT, 'engine/_dev/mock/music.mjs'), 'utf8').split('const commands = {')[1].split('\n  };')[0];
  const answered = new Set([...mock.matchAll(/^ {4}'([a-z_/]+)'/gm)].map((x) => x[1]));
  assert.deepEqual([...answered].sort(), [...ALLOWED].sort());
});
