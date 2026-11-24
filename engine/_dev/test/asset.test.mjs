// core/asset.js: the address of a picture, font or vendored script, with its content hash from version.json.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load } from './stub.mjs';

const { asset } = await load('core/asset.js');

test('a file of the build is asked for by its hash; one the build does not list by its plain address', () => {
  globalThis.window.DASH_MANIFEST = { v: 'x', files: { 'assets/weather/rain.svg': 'abc123' } };
  assert.match(asset('assets/weather/rain.svg'), /\/assets\/weather\/rain\.svg\?v=abc123$/);
  assert.match(asset('assets/people/someone.webp'), /\/assets\/people\/someone\.webp$/);
  delete globalThis.window.DASH_MANIFEST;
  assert.match(asset('assets/weather/rain.svg'), /\/assets\/weather\/rain\.svg$/, 'no version.json at all');
});

test('an address of its own is left alone', () => {
  for (const u of ['https://example.org/a.png', '/local/photos/a.webp', 'data:image/png;base64,AAAA']) assert.equal(asset(u), u);
});
