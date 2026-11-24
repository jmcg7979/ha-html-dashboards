// core/artistart.js: the artist's photo comes through Home Assistant where its relay offers it (the screen then asks
// nobody else); without the relay the screen looks the artist up itself, by the whole credit and then its first artist,
// and only an exact name counts.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load, override } from './stub.mjs';

let relay = null; const fetched = [];
override('core/ma.js', { artistPhotoUrl: (name) => Promise.resolve(relay ? `${relay}?name=${encodeURIComponent(name)}` : null) });
globalThis.fetch = (url) => { const s = decodeURIComponent(String(url).split('s=')[1]); fetched.push(s);
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ artists: s === 'Calvin Harris' ? [{ strArtist: 'Calvin Harris Tribute', strArtistFanart: 'https://x/wrong.jpg' }, { strArtist: 'calvin harris', strArtistFanart2: 'https://x/right.jpg' }] : null }) }); };
const { artistPhoto } = await load('core/artistart.js');

test('with the relay: the picture is Home Assistant\'s, and nobody else is asked', async () => {
  relay = '/api/ma_relay/artist';
  assert.equal(await artistPhoto('Calvin Harris/Kelis'), '/api/ma_relay/artist?name=Calvin%20Harris%2FKelis');
  assert.deepEqual(fetched, []);
  assert.equal(await artistPhoto(''), null);
});

test('without it: the whole credit, then its first artist; the artist of that very name, not one that contains it', async () => {
  relay = null;
  assert.equal(await artistPhoto('Calvin Harris/Kelis'), 'https://x/right.jpg');
  assert.deepEqual(fetched, ['Calvin Harris/Kelis', 'Calvin Harris']);
  assert.equal(await artistPhoto('Nobody Known'), null);
});
