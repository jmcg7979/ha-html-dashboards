// Home Assistant's websocket API, as far as the dashboards use it: sign-in, the entity subscription, registries, history,
// service calls with the state changes they cause, and the test hooks (mock.*) that break things on purpose.
// A type the mock has no answer for is refused the way HA refuses one (unknown_command) and named in the call log.
import { history, statistics, logbook, forecast } from './history.mjs';
import { frigateReviews, frigateSummary } from './media.mjs';
import { musicAssistant } from './music.mjs';

export function haSocket({ site, S, log }) {
  const { user, onCall, responses = {}, registry = {}, vms = {}, noStatistics, frigate = {}, browse } = site;
  const api = { clients: () => [], down: () => Date.now() < downUntil, connection };
  let downUntil = 0, lagMs = 0, refuseAuth = 0;   // the faults: mock.drop, mock.lag, mock.auth

  const now = () => Date.now() / 1000;
  const list = (v) => [].concat(v || []);
  // everything goes out through here, so mock.lag delays answers and events alike and keeps their order
  const send = (ws, msg) => { const go = () => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }; if (lagMs) setTimeout(go, lagMs); else go(); };
  const ok = (ws, m, result) => send(ws, { id: m.id, type: 'result', success: true, result });
  const refuse = (ws, m, code, message) => send(ws, { id: m.id, type: 'result', success: false, error: { code, message } });

  const music = musicAssistant({ S, log, send, ok, refuse, clients: () => api.clients() });

  // As with HA: every connection hears a change to the entities it subscribed (a TV page and its launcher's watcher), and only those.
  function broadcast(changes) {
    for (const ws of api.clients()) {
      if (ws.subId == null || !ws.ids) continue;
      const mine = Object.fromEntries(Object.entries(changes).filter(([id]) => ws.ids.has(id)));
      if (Object.keys(mine).length) send(ws, { id: ws.subId, type: 'event', event: { c: mine } });
    }
  }
  // set a state and tell every subscriber
  function push(id, state, attributes) {
    S[id] = Object.assign(S[id] || { a: {} }, { s: state, lc: now() }, attributes ? { a: attributes } : {});
    broadcast({ [id]: { '+': Object.assign({ s: state, lc: now() }, attributes ? { a: attributes } : {}) } });
  }

  // ---- service calls ----
  // what HA's own services do to the entities they are aimed at
  function effect(m) {
    const d = m.service_data || {};
    if (m.service === 'turn_on') return { s: 'on', a: d.brightness_pct ? { brightness: Math.round(d.brightness_pct * 2.55) } : {} };
    if (m.service === 'turn_off') return { s: 'off' };
    if (m.service === 'select_option') return { s: d.option };
    if (m.service === 'lock') return { s: 'locked' };
    if (m.service === 'unlock') return { s: 'unlocked' };
    if (m.service.startsWith('alarm_arm')) return { s: 'arming' };
    return null;
  }
  // A Proxmox guest's power button (site.vms): the guest's own sensor drops out, a new start time, the guest comes back.
  // A guest with an agent also reports its operating system's state and whether the agent is online.
  function vmPower(m, ids) {
    if (m.domain !== 'button' || m.service !== 'press') return;
    for (const vm of Object.values(vms)) {
      const act = ['restart', 'shut_down', 'start'].find((a) => ids[0] === vm.buttons + a);
      if (!act) continue;
      const os = (state, agent) => { if (vm.os) push(vm.os, state); if (vm.agent && agent) push(vm.agent, agent); };
      const at = (ms, fn) => setTimeout(fn, ms);
      if (act === 'restart') { at(3000, () => { push(vm.guest, 'unavailable'); os('stopping', 'off'); }); at(9000, () => { push(vm.uptime, new Date().toISOString()); os('starting'); }); at(15000, () => { push(vm.guest, '12.5'); os('running', 'on'); }); }
      if (act === 'shut_down') { at(3000, () => { push(vm.guest, 'unavailable'); os('stopping', 'off'); }); at(8000, () => { push(vm.status, 'stopped'); os('stopped'); }); }
      if (act === 'start') { at(4000, () => { push(vm.status, 'running'); push(vm.uptime, new Date().toISOString()); os('starting'); }); at(10000, () => { push(vm.guest, '10'); os('running', 'on'); }); }
    }
  }
  // a call that asks for an answer: forecasts from the mock, the rest from the site's `responses`, anything else an empty answer
  function answer(ws, m) {
    const name = `${m.domain}.${m.service}`, d = m.service_data || {};
    log('ASK ' + name);
    if (name === 'weather.get_forecasts') {
      const id = list((m.target || {}).entity_id || d.entity_id)[0];
      if ((S[id] || {}).s === 'unavailable') return ok(ws, m, { response: {} });   // like HA: unavailable entities are skipped
      return ok(ws, m, { response: { [id]: { forecast: forecast(d.type) } } });
    }
    const r = responses[name];
    return ok(ws, m, { response: (typeof r === 'function' ? r(m, S) : r) || {} });
  }
  // the test hooks that break the link; true when the call was one of them
  function fault(ws, m) {
    const d = m.service_data || {};
    if (m.service === 'fail') { refuse(ws, m, 'test', 'refused for a test'); return true; }
    if (!['drop', 'lag', 'auth', 'music'].includes(m.service)) return false;
    log('MOCK ' + JSON.stringify({ service: m.service, ...d }));
    ok(ws, m, {});
    if (m.service === 'music') music.hook(d);
    if (m.service === 'lag') lagMs = Math.max(0, +d.ms || 0);
    if (m.service === 'auth') refuseAuth = d.invalid === false ? 0 : Math.max(1, +d.times || 1);
    if (m.service === 'drop') { downUntil = Date.now() + (+d.for || 0) * 1000; setTimeout(() => { for (const c of api.clients()) c.terminate(); }, 50); }
    return true;
  }
  function callService(ws, m) {
    if (m.return_response) return answer(ws, m);
    if (m.domain === 'mock' && fault(ws, m)) return;
    log(JSON.stringify(m));
    ok(ws, m, {});
    setTimeout(() => {   // HA answers at once; the state follows a moment later
      const ids = list((m.target || {}).entity_id), changes = {};
      for (const id of ids) {
        const p = effect(m); if (!p) continue;
        changes[id] = { '+': Object.assign({ lc: now() }, p) };
        S[id] = Object.assign(S[id] || { a: {} }, { s: p.s, lc: now() }, p.a ? { a: Object.assign({}, (S[id] || {}).a, p.a) } : {});
      }
      vmPower(m, ids);
      if (m.domain === 'mock' && m.service === 'set') {
        const d = m.service_data;
        S[d.entity] = Object.assign(S[d.entity] || { a: {} }, { s: d.state, lc: now() }, d.attributes ? { a: d.attributes } : {});
        changes[d.entity] = { '+': Object.assign({ s: d.state, lc: now() }, d.attributes ? { a: d.attributes } : {}) };
      }
      if (onCall) onCall(m, changes, { S, push });
      broadcast(changes);
    }, 150);
  }

  // ---- one handler per message type ----
  const on = {
    auth(ws) {
      if (refuseAuth > 0) { refuseAuth--; send(ws, { type: 'auth_invalid', message: 'Invalid access token or password' }); setTimeout(() => ws.close(), lagMs + 20); return; }
      send(ws, { type: 'auth_ok' });
    },
    'auth/current_user': (ws, m) => ok(ws, m, { id: process.env.MOCK_USER || 'u1', name: process.env.MOCK_USER ? 'Wall Panel' : user, is_admin: !process.env.MOCK_USER }),
    'auth/sign_path': (ws, m) => ok(ws, m, { path: m.path + (m.path.includes('?') ? '&' : '?') + 'authSig=abc' }),
    ping: (ws, m) => send(ws, { id: m.id, type: 'pong' }),
    get_config: (ws, m) => ok(ws, m, { latitude: 39.05, longitude: -95.68 }),
    get_states: (ws, m) => ok(ws, m, Object.keys(S).map((k) => ({ entity_id: k, state: S[k].s, attributes: S[k].a || {}, last_changed: new Date((S[k].lc || now()) * 1000).toISOString() }))),
    // the compressed subscription HA's own frontend uses: every asked entity once ({ a }), then only changes ({ c })
    subscribe_entities(ws, m) {
      ws.subId = m.id; ws.ids = new Set(m.entity_ids);
      ok(ws, m, null);
      const a = {}; for (const k of m.entity_ids) if (S[k]) a[k] = { s: S[k].s, a: S[k].a, lc: S[k].lc };
      send(ws, { id: m.id, type: 'event', event: { a } });
    },
    subscribe_events: (ws, m) => ok(ws, m, null),   // registry changes and the like: accepted, and nothing ever happens
    unsubscribe_events: (ws, m) => { music.unsubscribe(ws, m.subscription); ok(ws, m, null); },
    'config/device_registry/list': (ws, m) => ok(ws, m, registry.devices || []),
    'config/entity_registry/list_for_display': (ws, m) => ok(ws, m, { entity_categories: { 0: 'config', 1: 'diagnostic' }, entities: registry.entities || [] }),
    // the full registry entry of each asked entity; null for one HA doesn't have
    'config/entity_registry/get_entries': (ws, m) => ok(ws, m, Object.fromEntries(list(m.entity_ids).map((id) => {
      const e = (registry.entities || []).find((x) => x.ei === id);
      return [id, S[id] ? { entity_id: id, platform: (e && e.pl) || (music.isPlayer(id) ? 'music_assistant' : id.split('.')[0]), unique_id: (e && e.uid) || id, device_id: (e && e.di) || null } : null];
    }))),
    'history/history_during_period': (ws, m) => ok(ws, m, history(m, S)),
    'recorder/statistics_during_period': (ws, m) => ok(ws, m, statistics(m, S, noStatistics)),
    'logbook/get_events': (ws, m) => ok(ws, m, logbook(m)),
    'frigate/reviews/get': (ws, m) => { log('FRIGATE ' + JSON.stringify(m)); ok(ws, m, frigateReviews(m, frigate.cameras)); },
    'frigate/reviews/viewed': (ws, m) => { log('FRIGATE ' + JSON.stringify(m)); ok(ws, m, { success: true }); },
    'frigate/recordings/summary': (ws, m) => ok(ws, m, frigateSummary()),
    // a file in HA's media folder: the mock plays its test video for every one
    'media_source/resolve_media': (ws, m) => ok(ws, m, { url: '/media/' + encodeURIComponent(String(m.media_content_id || '').split('/').pop()) + '?authSig=abc', mime_type: 'video/mp4' }),
    // a player's media browser: the site's own tree (browse(msg, S) -> the folder with its children; null = refused)
    'media_player/browse_media': (ws, m) => { const r = browse ? browse(m, S) : null; if (r) ok(ws, m, r); else refuse(ws, m, 'browse_error', 'Nothing to browse'); },
    call_service: callService,
    ...music.on,   // Music Assistant through the relay (music.mjs)
  };

  function connection(ws) {
    ws.send(JSON.stringify({ type: 'auth_required' }));
    ws.on('message', (data) => {
      const m = JSON.parse(data);
      if (Object.hasOwn(on, m.type)) return on[m.type](ws, m);
      // (MOCK_MA=off: an HA without Music Assistant's relay, which is no gap in the mock)
      if (!String(m.type).startsWith('ma_relay/')) { log('UNKNOWN ' + m.type); console.log('no answer for websocket type ' + m.type); }
      refuse(ws, m, 'unknown_command', 'Unknown command.');
    });
  }
  return api;
}
