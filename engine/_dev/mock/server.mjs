// Fake Home Assistant for the dashboards: serves an assembled site and plays that site's data, so the browser checks
// (tools/shot.sh, tools/regress.sh) and a person (tools/mock.sh) can run a dashboard without a real HA.
//
// The parts:
//   server.mjs    this file: settings, the site's data, HTTP routes, websocket upgrades
//   static.mjs    the assembled build under /local/dash/
//   ha.mjs        Home Assistant's websocket API: sign-in, entity subscriptions, registries, service calls, test hooks
//   history.mjs   made-up history, statistics, logbook, calendar and forecast answers
//   music.mjs     Music Assistant behind the relay's websocket types (ma_relay/*): a library, a search, a queue per id
//   media.mjs     camera pictures, Frigate (reviews, recordings, live stream), saved media, TV app banners
//
// Settings (environment):
//   MOCK_DASH     the assembled site to serve (_dev/assemble.sh makes one; tools/shot.sh and tools/mock.sh do it for you)
//   MOCK_SITE     whose data to play: sites/<MOCK_SITE>/mock/states.mjs (default house)
//   MOCK_HOST     address to listen on (default 127.0.0.1: this machine only; 0.0.0.0 opens it to the network, for a TV)
//   MOCK_PORT     port (default 8125; tools/shot.sh picks a free one so several checks can run at once)
//   MOCK_LOG      the call log (default calls.log beside this file), one line per event, for checks to read:
//                   {…}            a service call, as the page sent it (not the ones that ask for an answer)
//                   ASK d.s        a service call that asks for an answer (return_response)
//                   FRIGATE {…}    a Frigate review request          CAMWS url / MSEREQ codecs   a live camera stream
//                   MOCK {…}       a fault switched on (below)       UNKNOWN type                a websocket type the mock has no answer for
//                   MA {…}         a Music Assistant command, as the page sent it through the relay
//   MOCK_DOWN     unavailable | unknown: every entity but people and the sun starts in that state
//   MOCK_USER     sign in as this user id, not an admin (a wall panel's account)
//   MOCK_MA       off: an HA without the Music Assistant relay (every screen then shows what HA alone gives)
//   MOCK_PARTY    <entity>: the player Music Assistant's Party plays on from the start (none otherwise)
//   MOCK_VARIANT, other MOCK_*   the site's own variants (see its mock/states.mjs)
//
// A site's mock/states.mjs exports:
//   S             { entity id: { s: state, a: attributes, lc: last changed, seconds } }
//                 swing: how far a number moves in the made-up history (1 = the usual ±22%; 0.1 = a tenth of that)
//   user          the signed-in user's name
//   onCall        optional (msg, changes, { S, push }): what a service call changes at this site. Add to `changes`
//                 ({ id: { '+': { s, a } } }) or call push(id, state) later.
//   responses     optional { 'domain.service': answer | (msg, S) => answer } for service calls that ask for an answer
//   browse        optional (msg, S) => a media player's folder ({ title, children: [...] }, as HA's media_player/browse_media answers)
//   registry      optional { devices: [...], entities: [...] }: HA's device registry and its entity list for display
//                 (ei = entity id, di = device id, pl = platform, tk = translation key), what core/discover.js reads
//   vms           optional { name: { buttons, status, uptime, guest, os?, agent? } }: Proxmox guests whose power buttons
//                 (<buttons>restart | shut_down | start) the mock plays out over a few seconds
//   noStatistics  optional RegExp: entity ids the recorder has no long-term statistics for
//   frigate       optional { cameras: [...] }: the cameras Frigate's reviews come from
//
// Test hooks, as service calls from the page (ha.call('mock.set', { … })) or from a shell (node set.mjs …):
//   mock.set  { entity, state, attributes? }   set an entity; every page that subscribed to it hears the change
//   mock.fail                                  HA refuses this call (what a button does when its action fails)
//   mock.drop { for: seconds }                 close every websocket and refuse new ones for that long (an HA restart);
//                                              0 or nothing = the link drops and can come straight back
//   mock.lag  { ms }                           delay every websocket answer and event by this much from now on; 0 = off
//   mock.auth { invalid: true, times? }        the next sign-in (or the next `times`) is refused with auth_invalid
//   mock.music { reset: true }                 HA's Music Assistant integration was reloaded: the relay ends every queue subscription
import http from 'node:http';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
import { serveDash } from './static.mjs';
import { haSocket } from './ha.mjs';
import { calendarEvents } from './history.mjs';
import { mediaRoute, cameraSocket } from './media.mjs';

const DASH = process.env.MOCK_DASH;
if (!DASH) throw new Error('set MOCK_DASH to an assembled site: _dev/tools/mock.sh [site]');
const HOST = process.env.MOCK_HOST || '127.0.0.1';
const PORT = +process.env.MOCK_PORT || 8125;
const LOG = process.env.MOCK_LOG || new URL('calls.log', import.meta.url);
const log = (line) => fs.appendFileSync(LOG, line + '\n');

const site = await import(new URL(`../../../sites/${process.env.MOCK_SITE || 'house'}/mock/states.mjs`, import.meta.url));
const { S } = site;
// every state has attributes and a time of last change, whatever the site's file left out
for (const k in S) { S[k].a = S[k].a || {}; S[k].lc = S[k].lc || Date.now() / 1000 - 3600; }
if (process.env.MOCK_DOWN) for (const k in S) if (!/^(person|sun)\./.test(k)) S[k].s = process.env.MOCK_DOWN;

const json = (r, body) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(body)); };
const srv = http.createServer((q, r) => {
  if (q.url.startsWith('/local/dash/')) serveDash(DASH, q, r);
  else if (q.url.startsWith('/api/calendars/')) json(r, calendarEvents());
  else if (mediaRoute(q, r)) { /* answered */ }
  else if (q.url.startsWith('/api/ma_relay/artist')) { r.statusCode = 204; r.end(); }   // the relay's artist photo: none on the mock (a check stands in for one: its own route)
  else if (q.url.startsWith('/auth/token')) json(r, { access_token: 'AT', expires_in: 1800, refresh_token: 'RT' });
  else { r.statusCode = 404; r.end(); }
});

const ha = haSocket({ site, S, log });
const homeAssistant = new WebSocketServer({ noServer: true }), cameras = new WebSocketServer({ noServer: true });
homeAssistant.on('connection', ha.connection);
cameras.on('connection', (c) => cameraSocket(c, log));
ha.clients = () => homeAssistant.clients;
srv.on('upgrade', (q, socket, head) => {
  if (q.url.startsWith('/api/frigate/')) { log('CAMWS ' + q.url); cameras.handleUpgrade(q, socket, head, (c) => cameras.emit('connection', c)); return; }
  if (ha.down()) { socket.destroy(); return; }   // mock.drop: as an HA that is restarting
  homeAssistant.handleUpgrade(q, socket, head, (c) => homeAssistant.emit('connection', c));
});

srv.listen(PORT, HOST, () => console.log(`mock on ${HOST}:${PORT}`));
