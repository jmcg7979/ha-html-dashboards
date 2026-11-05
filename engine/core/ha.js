// Home Assistant websocket: one connection, a filtered entity subscription, service calls.
import { token, forget, origin } from './auth.js';
import { applyEntities, entityIds } from './store.js';

let ws = null, authed = false, nextId = 1, badAuth = 0, retryT = 0, subId = 0, subscribed = new Set(), resubT = 0, pingT = 0, pongT = 0;
const pending = new Map();       // id -> { cb, ev, rej }
const PING_EVERY = 30000, PONG_WAIT = 10000;
const statusFns = new Set();     // (online:boolean, needLogin:boolean)
const readyFns = new Set();      // run after every (re)connect
const failFns = new Set();       // (why): a service call that didn't happen: 'offline' or HA's error message
export let user = null;

export function onStatus(fn) { statusFns.add(fn); }
export function onReady(fn) { readyFns.add(fn); }
export function onCallFail(fn) { failFns.add(fn); }
const status = (ok, login = false) => statusFns.forEach((f) => f(ok, login));

export function send(msg, cb, ev, rej) {
  if (!connected()) return false;
  msg.id = nextId++;
  pending.set(msg.id, { cb, ev, rej });
  ws.send(JSON.stringify(msg));
  return true;
}
export const request = (msg) => new Promise((res, rej) => { if (!send(msg, (r, m) => (m.success ? res(r) : rej(m.error)), undefined, rej)) rej('offline'); });

// call('light.turn_on', { brightness_pct: 50 }, 'light.kitchen'): false if nothing was sent. onFail: HA refused it (undo anything optimistic).
export function call(service, data, entityIds, onFail) {
  const [domain, svc] = service.split('.');
  const sent = send({ type: 'call_service', domain, service: svc, service_data: data || {}, target: entityIds ? { entity_id: entityIds } : undefined },
    (r, m) => { if (!m.success) { if (onFail) onFail(); failFns.forEach((f) => f((m.error && m.error.message) || '')); } });
  if (!sent) failFns.forEach((f) => f('offline'));
  return sent;
}
export const signPath = (path, expires = 60) => request({ type: 'auth/sign_path', path, expires }).then((r) => r.path);

export function connect() {
  clearTimeout(retryT);
  token(badAuth > 0).then(open, (e) => {
    if (e === 'login') status(false, true);
    else retryT = setTimeout(connect, 4000);
  });
}

function open(tk) {
  if (ws) { ws.onclose = null; try { ws.close(); } catch (e) { /* ignore */ } }
  authed = false; ws = new WebSocket(origin.replace(/^http/, 'ws') + '/api/websocket');
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: tk }));
    else if (m.type === 'auth_invalid') { badAuth++; if (badAuth > 2) { forget(); status(false, true); } }
    else if (m.type === 'auth_ok') {
      badAuth = 0; authed = true; status(true); ping();
      send({ type: 'auth/current_user' }, (r) => { user = r; });
      subscribe();
      readyFns.forEach((f) => { try { f(); } catch (x) { console.error(x); } });
    } else if (m.type === 'pong') { clearTimeout(pongT); pongT = 0; pending.delete(m.id);
    } else if (m.type === 'result') {
      const p = pending.get(m.id);
      if (p) { if (p.cb) p.cb(m.success ? m.result : null, m); if (!p.ev) pending.delete(m.id); }
    } else if (m.type === 'event') {
      const p = pending.get(m.id); if (p && p.ev) p.ev(m.event);
    }
  };
  ws.onclose = closed;
}
function closed() {
  authed = false; clearTimeout(pingT); clearTimeout(pongT); pongT = 0;
  pending.forEach((p) => { if (p.rej) p.rej('offline'); });
  pending.clear(); subId = 0; status(false); retryT = setTimeout(connect, badAuth > 2 ? 60000 : 2000);
}

// A dropped link can leave a socket that looks open (a phone waking up, a VPN going away), so ask HA regularly and give up on silence.
function ping() {
  clearTimeout(pingT); pingT = setTimeout(ping, PING_EVERY);
  if (!connected() || pongT || document.hidden) return;
  send({ type: 'ping' });
  pongT = setTimeout(() => { pongT = 0; if (ws) { ws.onclose = null; try { ws.close(); } catch (e) { /* ignore */ } } closed(); }, PONG_WAIT);
}

export const connected = () => authed && !!ws && ws.readyState === 1;

// One filtered subscription for every entity any built card watches. Pop-ups and expanders build lazily,
// so after they add entities we subscribe again with the full list and drop the old subscription.
function subscribe() {
  const ids = entityIds(), old = subId;
  subscribed = new Set(ids);
  send({ type: 'subscribe_entities', entity_ids: ids }, (r, m) => { if (m.success && old) { pending.delete(old); send({ type: 'unsubscribe_events', subscription: old }); } }, applyEntities);
  subId = nextId - 1;
}
export function resubscribeIfNeeded() {
  clearTimeout(resubT);
  resubT = setTimeout(() => { if (connected() && entityIds().some((id) => !subscribed.has(id))) subscribe(); }, 0);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) return; if (!ws || ws.readyState > 1) connect(); else if (authed) ping(); });
