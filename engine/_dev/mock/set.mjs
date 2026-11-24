// Change the running mock from a shell (every connected page sees it):
//   node set.mjs <entity> <state> [host:port]     set an entity's state
//   node set.mjs --drop [seconds] [host:port]     close every websocket and refuse new ones for that long (an HA restart)
//   node set.mjs --lag <ms> [host:port]           delay every websocket answer by that much; 0 = off
//   node set.mjs --auth-fail [times] [host:port]  refuse the next sign-in (or the next `times`)
// e.g. a take-over on a TV pointed at the mock: node set.mjs input_boolean.voice_timer_ringing on
import { WebSocket } from 'ws';
const args = process.argv.slice(2), isHost = (v) => /^[\w.-]+:\d+$/.test(v || '');
// 127.0.0.1, not localhost: the mock listens on IPv4 only and Node may try ::1 first
const host = isHost(args[args.length - 1]) ? args.pop() : '127.0.0.1:' + (process.env.MOCK_PORT || 8125);
const [what, value] = args;
const FAULTS = { '--drop': ['drop', { for: +value || 0 }], '--lag': ['lag', { ms: +value || 0 }], '--auth-fail': ['auth', { invalid: true, times: +value || 1 }] };
if (!what || (what.startsWith('--') ? !FAULTS[what] : value === undefined)) { console.error('usage: node set.mjs <entity> <state> | --drop [seconds] | --lag <ms> | --auth-fail [times]   [host:port]'); process.exit(2); }
const [service, service_data] = FAULTS[what] || ['set', { entity: what, state: value }];
const ws = new WebSocket(`ws://${host}/api/websocket`);
ws.on('error', (e) => { console.error(`no mock on ${host}: ${e.message}`); process.exit(1); });
ws.on('close', () => process.exit());   // --drop closes this connection too
ws.on('message', (d) => { const m = JSON.parse(d);
  if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: 'x' }));
  else if (m.type === 'auth_invalid') { console.error('the mock refused the sign-in (a mock.auth test is on): run it again'); process.exitCode = 1; }
  else if (m.type === 'auth_ok') ws.send(JSON.stringify({ id: 1, type: 'call_service', domain: 'mock', service, service_data }));
  else if (m.id === 1) setTimeout(() => process.exit(0), 400); });
