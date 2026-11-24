// core/ma.js lyrics(): an answer that doesn't come in the relay's time is not "no lyrics". Music Assistant looks up one
// song's lyrics per 30 s; one that waits its turn there is asked for again, and found.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load, override } from './stub.mjs';

const asked = []; let answers = [];
override('core/ha.js', { connected: () => true, up: () => Promise.resolve(),
  request: (m) => {
    if (m.type === 'ma_relay/info') return Promise.resolve({ connected: true, image_key: 'k' });
    asked.push(m.command);
    if (m.command === 'music/item_by_uri') return Promise.resolve({ uri: m.args.uri });
    const a = answers.shift();
    return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
  } });
const MA = await load('core/ma.js');
const song = (id) => ({ queue_item_id: id, media_item: { uri: 'x://' + id } });
const LATE = new Error('Music Assistant didn’t answer metadata/get_track_lyrics within 30 s');

test('late is not none: the next call asks again and gets them; found lyrics are kept', async () => {
  const s = song('a'); answers = [LATE, ['plain words', '[00:01.50]first line\n[00:04.00]second']];
  assert.equal(MA.lyricsKept(s), false);
  const first = await MA.lyrics(s);
  assert.deepEqual([first.lines, first.text, first.late], [null, null, true]);
  assert.equal(MA.lyricsKept(s), false, 'nothing is kept of an answer that never came');
  const second = await MA.lyrics(s);
  assert.deepEqual([second.lines.map((l) => l.text), second.late], [['first line', 'second'], undefined]);
  asked.length = 0; await MA.lyrics(s); await MA.lyrics(s, true);
  assert.deepEqual(asked, [], 'found: not asked again');
  assert.equal(MA.lyricsKept(s), true);
});

test('"none" is kept until it is asked again on purpose; a refusal is none, not late', async () => {
  const s = song('b'); answers = [[null, null], new Error('unknown item'), ['words', null]];
  assert.deepEqual(await MA.lyrics(s), { lines: null, text: null });
  asked.length = 0; await MA.lyrics(s);
  assert.deepEqual(asked, [], 'kept');
  const refused = await MA.lyrics(s, true);
  assert.deepEqual([refused.text, refused.late], [null, false]);
  assert.equal((await MA.lyrics(s, true)).text, 'words');
});
