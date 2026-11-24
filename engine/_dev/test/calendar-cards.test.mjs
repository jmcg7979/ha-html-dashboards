// Calendars: what core/calendars.js makes of HA's answers (a calendar that did not load is said, never an empty one),
// and the parts of the agenda and the month view that decide what is shown.
import test from 'node:test'; import assert from 'node:assert/strict';
import { load, override } from './stub.mjs';

override('core/auth.js', { token: async () => 'token' });
const net = { answer: () => null };   // answer(calendar) -> its events, or null for a failed request
globalThis.fetch = async (url) => { const j = net.answer(/calendars\/([^?]+)/.exec(String(url))[1]); return j ? { ok: true, json: async () => j } : { ok: false, status: 500 }; };
const { events } = await load('core/calendars.js'), A = await load('cards/agenda.js'), M = await load('cards/month.js');
const D = (d, h = 0, m = 0) => new Date(2026, 10, d, h, m);

test('events: all calendars failing is an error; some failing is said on the list; none asked is an empty list', async () => {
  const day = { summary: 'Trip', start: { date: '2026-11-14' }, end: { date: '2026-11-16' } }, timed = { start: { dateTime: D(14, 9).toISOString() }, end: { dateTime: D(14, 10).toISOString() } };
  net.answer = () => null;
  await assert.rejects(events(['calendar.a', 'calendar.b'], D(1), D(30)));
  net.answer = (c) => (c === 'calendar.a' ? [timed, day] : null);
  const got = await events(['calendar.a', 'calendar.b'], D(1), D(30));
  assert.deepEqual(got.failed, ['calendar.b']);
  assert.deepEqual(got.map((e) => [e.title, e.allDay, e.cal]), [['Trip', true, 'calendar.a'], ['Busy', false, 'calendar.a']], 'an all-day event first, on its local day');
  assert.equal(+got[0].s, +D(14)); assert.equal(+got[0].en, +D(16));
  const none = await events([], D(1), D(30)); assert.equal(none.length, 0); assert.deepEqual(none.failed, []);
});

test('events: a calendar\'s skip leaves matching titles out, of that calendar only', async () => {
  const ev = (summary, h) => ({ summary, start: { dateTime: D(14, h).toISOString() }, end: { dateTime: D(14, h + 1).toISOString() } });
  net.answer = () => [ev('Pill', 6), ev('Dentist', 9), ev('pill', 18)];
  const got = await events([{ entity: 'calendar.a', skip: /^pill$/i }, 'calendar.b'], D(1), D(30));
  assert.deepEqual(got.map((e) => [e.title, e.cal]), [['Pill', 'calendar.b'], ['Dentist', 'calendar.a'], ['Dentist', 'calendar.b'], ['pill', 'calendar.b']]);
  assert.deepEqual(got.failed, []);
});

test('agenda: a description keeps its links and reads its entities once', () => {
  assert.equal(A.rich('Join: <https://meet.example.com/abc>'), 'Join: <a href="https://meet.example.com/abc" target="_blank" rel="noopener">https://meet.example.com/abc</a>');
  assert.equal(A.rich('Tom &amp; Ann<br>second <b>line</b>'), 'Tom &amp; Ann\nsecond line');
  assert.equal(A.rich('1 &lt; 2 &#38; 3 &#x26; 4'), '1 &lt; 2 &amp; 3 &amp; 4');
  assert.equal(A.rich('<a href="https://x.example/a?b=1&amp;c=2">here</a>'), 'here');
  assert.equal(A.rich('see "https://x.example/a" now'), 'see &quot;<a href="https://x.example/a" target="_blank" rel="noopener">https://x.example/a</a>&quot; now', 'a link ends before a quote');
  assert.doesNotMatch(A.rich('&lt;script&gt;alert(1)&lt;/script&gt; <img src=x onerror=1>'), /<script|<img/);
});

test('agenda: day names by date, and an event\'s times', () => {
  const now = D(14, 23, 30);
  assert.equal(A.dayName(D(14, 0, 5), false, now), 'Today'); assert.equal(A.dayName(D(15, 0, 5), false, now), 'Tomorrow');
  assert.equal(A.dayName(D(17), false, now), D(17).toLocaleDateString(undefined, { weekday: 'long' }));
  assert.equal(A.dayName(D(17), true, now), D(17).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }));
  assert.equal(A.when({ allDay: true, s: D(14), en: D(15) }), 'All day');
  assert.match(A.when({ allDay: true, s: D(14), en: D(17) }), /Nov 14 – .*Nov 16/);
});

test('month: an event is on every day it touches, and an all-day event not on the day after', () => {
  const evs = [{ id: 'trip', allDay: true, s: D(14), en: D(16) }, { id: 'late', s: D(14, 22), en: D(15, 1) }, { id: 'noon', s: D(16, 12), en: D(16, 13) }];
  const on = (d) => M.onDay(evs, D(d)).map((e) => e.id);
  assert.deepEqual(on(13), []); assert.deepEqual(on(14), ['trip', 'late']); assert.deepEqual(on(15), ['trip', 'late']); assert.deepEqual(on(16), ['noon']);
});
