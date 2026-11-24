// Home Assistant websocket: one connection, a filtered entity subscription, service calls.
import { sent as pressSent } from './feedback.js';
import { token, forget, origin } from './auth.js';
import { applyEntities, entityIds } from './store.js';
import { onDispose } from './scope.js';

let ws = null, authed = false, needLogin = false, nextId = 1, badAuth = 0, retryT = 0, openT = 0, subId = 0, subscribed = new Set(), resubT = 0, pingT = 0, pongT = 0;
const pending = new Map();       // id -> { cb, ev, rej }
const PING_EVERY = 30000, PONG_WAIT = 10000, OPEN_WAIT = 10000;   // OPEN_WAIT: from opening the socket to HA accepting the sign-in
const statusFns = new Set();     // (online:boolean, needLogin:boolean)
const readyFns = new Set();      // run after every (re)connect
const failFns = new Set();       // (why): a service call that didn't happen: 'offline', 'dropped' (sent, the link went before HA answered) or HA's error message
export let user = null;

export function onStatus(fn) { statusFns.add(fn); onDispose(() => statusFns.delete(fn)); }   // onDispose: dropped with a card's view (core/scope.js)
export function onReady(fn) { readyFns.add(fn); onDispose(() => readyFns.delete(fn)); }
// up() -> Promise, settled once the link is up and signed in (at once when it is): for a module that has something to
// ask as soon as it can, without a card's view to tie the wait to
let upWaiters = [];
export const up = () => (connected() ? Promise.resolve() : new Promise((res) => upWaiters.push(res)));
export function onCallFail(fn) { failFns.add(fn); onDispose(() => failFns.delete(fn)); }
// one listener that throws must not stop the others, or what comes after them (the subscription, the ready listeners)
const safe = (f, ...a) => { try { return f(...a); } catch (x) { console.error(x); } };
const status = (ok, login = false) => statusFns.forEach((f) => safe(f, ok, login));
const failed = (why) => failFns.forEach((f) => safe(f, why));

export function send(msg, cb, ev, rej) {
  if (!connected()) return false;
  msg.id = nextId++;
  pending.set(msg.id, { cb, ev, rej });
  ws.send(JSON.stringify(msg));
  return true;
}
// end a subscription started with send(msg, cb, ev): HA stops sending, and its callbacks go
export function unsubscribe(id) { if (!pending.delete(id)) return; send({ type: 'unsubscribe_events', subscription: id }); }
export const request = (msg) => new Promise((res, rej) => { if (!send(msg, (r, m) => (m.success ? res(r) : rej(m.error)), undefined, rej)) rej('offline'); });

// call('light.turn_on', { brightness_pct: 50 }, 'light.kitchen'): false if nothing was sent. onFail: HA refused it (undo anything optimistic).
// onDone: HA has done it (its answer: for some services long after it was sent, a play waits for Music Assistant).
export function call(service, data, entityIds, onFail, onDone) {
  const [domain, svc] = service.split('.');
  // the button pressed for this shows it is working (core/feedback.js) until its entity changes; a command that changes
  // nothing HA can see (a remote key, a button press, a script, a scene, a notification) is done when HA has taken it
  const done = pressSent(/^(remote|button|input_button|script|scene|notify|tts)\.|\.volume_(up|down)$/.test(service) ? null : entityIds || (data && data.entity_id));
  const sent = send({ type: 'call_service', domain, service: svc, service_data: data || {}, target: entityIds ? { entity_id: entityIds } : undefined },
    (r, m) => { if (done) done(!m.success); if (!m.success) { if (onFail) onFail(); failed((m.error && m.error.message) || ''); } else if (onDone) onDone(); },
    undefined, () => { if (done) done(true); if (onFail) onFail(); failed('dropped'); });   // the link went while HA still had it
  if (!sent) { if (done) done(true); failed('offline'); }
  return sent;
}
export const signPath = (path, expires = 60) => request({ type: 'auth/sign_path', path, expires }).then((r) => r.path);

export function connect() {
  clearTimeout(retryT);
  token(badAuth > 0).then(open, (e) => {
    if (e === 'login') { needLogin = true; status(false, true); }
    else retryT = setTimeout(connect, 4000);
  });
}

// The socket is gone or given up on: it may not call back any more, its timers stop, and everything that waited on it is told.
function drop() {
  if (ws) { ws.onclose = ws.onmessage = null; try { ws.close(); } catch (e) { /* ignore */ } ws = null; }
  authed = false; clearTimeout(openT); clearTimeout(pingT); clearTimeout(pongT); pongT = 0; subId = 0;
  const waiting = [...pending.values()]; pending.clear();
  waiting.forEach((p) => { if (p.rej) safe(p.rej, 'offline'); });
}

function open(tk) {
  drop();
  ws = new WebSocket(origin.replace(/^http/, 'ws') + '/api/websocket');
  // a network that swallows packets (Wi-Fi back with no route yet, a TV waking) can leave the socket connecting for minutes
  openT = setTimeout(() => { if (!authed) closed(); }, OPEN_WAIT);
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch (x) { return; }
    if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: tk }));
    else if (m.type === 'auth_invalid') { badAuth++; if (badAuth > 2) { forget(); needLogin = true; status(false, true); } }
    else if (m.type === 'auth_ok') {
      badAuth = 0; authed = true; needLogin = false; clearTimeout(openT);
      send({ type: 'auth/current_user' }, (r) => { user = r; });
      subscribe();   // the data first, then whoever waits for a connection, then the status listeners
      upWaiters.splice(0).forEach((f) => f());
      readyFns.forEach((f) => safe(f));
      status(true); ping();
    } else if (m.type === 'pong') { clearTimeout(pongT); pongT = 0; pending.delete(m.id);
    } else if (m.type === 'result') {
      const p = pending.get(m.id);
      if (p) { if (!p.ev || !m.success) pending.delete(m.id); if (p.cb) safe(p.cb, m.success ? m.result : null, m); }   // (a subscription HA refused is no subscription)
    } else if (m.type === 'event') {
      const p = pending.get(m.id); if (p && p.ev) safe(p.ev, m.event);
    }
  };
  ws.onclose = closed;
}
// needLogin stays with the status: HA closes the socket right after refusing the sign-in, and the prompt must stay up
function closed() {
  drop(); status(false, needLogin);
  clearTimeout(retryT); retryT = setTimeout(connect, badAuth > 2 ? 60000 : 2000);
}

// A dropped link can leave a socket that looks open (a phone waking up, a VPN going away), so ask HA regularly and give up on silence.
function ping() {
  clearTimeout(pingT); pingT = setTimeout(ping, PING_EVERY);
  if (!connected() || pongT || document.hidden) return;
  send({ type: 'ping' });
  pongT = setTimeout(closed, PONG_WAIT);
}

export const connected = () => authed && !!ws && ws.readyState === 1;
// requests and service calls HA has not answered yet (subscriptions are not counted): for the checks, to know the page is still working
export const unanswered = () => { let n = 0; pending.forEach((p) => { if (!p.ev) n++; }); return n; };

// One filtered subscription for every entity any built card watches. Pop-ups and expanders build lazily,
// so after they add entities we subscribe again with the full list and drop the old subscription.
function subscribe() {
  const ids = entityIds(), old = subId;
  if (!ids.length) return;   // HA reads an empty list as "every entity"; the first card that watches something subscribes (resubscribeIfNeeded)
  subscribed = new Set(ids);
  send({ type: 'subscribe_entities', entity_ids: ids }, (r, m) => { if (m.success && old) { pending.delete(old); send({ type: 'unsubscribe_events', subscription: old }); } }, applyEntities);
  subId = nextId - 1;
}
export function resubscribeIfNeeded() {
  clearTimeout(resubT);
  resubT = setTimeout(() => { if (connected() && entityIds().some((id) => !subscribed.has(id))) subscribe(); }, 0);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) return; if (!ws || ws.readyState > 1) connect(); else if (authed) ping(); });
