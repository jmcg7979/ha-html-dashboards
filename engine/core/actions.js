// Declarative tap actions used by every card config:
//   'toggle'                                   toggle the card's entity
//   { call: 'vacuum.start' }                   service call on the card's entity
//   { call: 'script.turn_on', target: 'script.x', data: {...} }
//   { ..., confirm: true }                     a second tap on the same action, 0.3 to 3 s later, required
//   { ..., confirm: { title, text, ok, icon } } a dialog (core/ask.js) for actions that are hard to undo: power off, restart
//   { ..., expect: 'on' }                      optimistic state until HA confirms (or { state, attr, value, entity })
//   { ..., after: () => {} }                   run once the call is sent (after any confirm), e.g. to track a long operation
//   { nav: '#mode' }                           navigate (pop-ups / views)
//   { url: (entity) => 'https://…' }           open a link in a new tab
//   { url, app: 'homeassistant://navigate/…' }  in the HA Companion app use the app link instead (e.g. a page on another server)
//   { close: true }                            close the open pop-up
//   { view: 'cameras' }                        switch to another view of this dashboard
//   { drawer: 'events' }                       open the pull-out drawer with that id (cards/drawer.js)
//   (entity) => action                         pick the action from the current state (e.g. lock when unlocked, unlock when locked)
import { call, connected } from './ha.js';
import { st, optimistic, dropOptimistic, tapStart } from './store.js';
import { toast } from './toast.js';
import { needConfirm } from './dom.js';
import { ask } from './ask.js';
import { settings } from './settings.js';

export function run(action, ctx) {
  if (typeof action === 'function') action = action(st(ctx.entity));
  if (!action || action === 'none') return;
  const a = action === 'toggle' ? { toggle: true } : action;
  // what the dialog promised is what happens, even if the state moves while it is open
  const to = a.toggle && (a.to || ((st(a.entity || ctx.entity) || {}).state === 'on' ? 'off' : 'on'));
  if (a.confirm && typeof a.confirm === 'object') { ask(a.confirm).then((ok) => { if (ok) run({ ...a, confirm: false, to }, ctx); }); return; }
  if (a.confirm && ctx.el && needConfirm(ctx.el, JSON.stringify([a.call, a.toggle && to, a.target === undefined ? ctx.entity : a.target, a.data]))) return;
  if ((a.toggle || a.call) && !connected()) { toast('Not connected. Nothing was sent.'); return; }
  const t0 = tapStart(ctx.ev);

  if (a.toggle) {
    const id = a.entity || ctx.entity, on = to === 'off', dom = id.split('.')[0];
    optimistic(id, to, null, (r) => r.state === to, t0);
    const data = dom === 'light' && on && settings.instantLightOff ? { transition: 0 } : {};
    call(`${['light', 'switch', 'fan', 'input_boolean'].includes(dom) ? dom : 'homeassistant'}.turn_${to}`, data, id, () => dropOptimistic(id));
    return;
  }
  if (a.call) {
    const target = a.target === undefined ? ctx.entity : a.target;
    const was = a.expect != null ? expect(a.expect, target, t0) : null;
    call(a.call, a.data, target || undefined, () => was && dropOptimistic(was));
    if (a.after) a.after();
    if (a.close) closePopup();
    return;
  }
  if (a.nav) { if (a.nav.startsWith('#')) location.hash = a.nav; else location.href = a.nav; }
  // Links to another server: a real link click (window.open is ignored by the HA phone app). In the HA app the
  // dashboard runs in a frame inside HA's page; the app sends a link to the phone's browser only when HA's own top
  // page navigates off-server, so there the link is clicked in the top page (same origin) with target _top.
  if (a.url) { const u = inHaApp && a.app ? a.app : typeof a.url === 'function' ? a.url(st(ctx.entity)) : a.url; if (u) openLink(u); }
  if (a.close) closePopup();
  if (a.drawer) window.dispatchEvent(new CustomEvent('dash:drawer', { detail: a.drawer }));
  if (a.view) window.dispatchEvent(new CustomEvent('dash:view', { detail: a.view }));
}
function closePopup() {
  history.replaceState(null, '', location.pathname + location.search);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

function expect(x, target, t0) {
  const e = typeof x === 'string' ? { state: x } : x;
  const id = e.entity || (Array.isArray(target) ? target[0] : target);
  if (!id) return;
  if (e.attr) optimistic(id, null, { [e.attr]: e.value }, (r) => r.attributes[e.attr] === e.value, t0);
  else optimistic(id, e.state, null, (r) => (e.until ? e.until(r) : r.state === e.state), t0);
  return id;
}

const inHaApp = /Home ?Assistant\//i.test(navigator.userAgent) || !!window.externalApp || (() => { try { return !!window.top.externalApp; } catch (e) { return false; } })();
export function openLink(u) {
  let doc = document, target = '_blank';
  if (inHaApp) { try { if (window.top !== window && window.top.document) { doc = window.top.document; } } catch (e) { /* other origin */ } target = '_top'; }
  const l = doc.createElement('a'); l.href = u; l.target = target; l.rel = 'noopener'; doc.body.appendChild(l); l.click(); l.remove();
}
