// Sign-in. Order:
//   1. inside HA (a Webpage dashboard, same origin): the HA page around us is already signed in, so use its login.
//      This is what makes the HA phone app work: the app signs HA in through its own bridge and never puts a token in
//      localStorage, and HA's sign-in page can't run inside the app's frame.
//   2. opened directly in the HA app's WebView: ask the app for a token (its external-auth bridge, as HA's frontend does)
//   3. this page's own saved login -> the HA frontend's login in this browser (same origin) -> HA's sign-in page (OAuth code flow).
// No long-lived token is ever stored in a file.
const ORIGIN = location.origin;
const CLIENT = ORIGIN + '/';
const KEY = 'dashAuth', STATE_KEY = 'dashAuthState';

let auth = load();
let noBorrow = false;

function load() { try { const a = JSON.parse(localStorage.getItem(KEY) || 'null'); return a && a.refresh_token ? a : null; } catch (e) { return null; } }
function save() { try { if (auth && !auth.borrowed) localStorage.setItem(KEY, JSON.stringify(auth)); else if (!auth) localStorage.removeItem(KEY); } catch (e) { /* storage blocked */ } }
function borrow() {
  try {
    const t = JSON.parse(localStorage.getItem('hassTokens') || 'null');
    if (t && t.refresh_token && String(t.hassUrl || '').replace(/\/$/, '') === ORIGIN) {
      return { refresh_token: t.refresh_token, access_token: t.access_token, expires: t.expires || 0, clientId: t.clientId || CLIENT, borrowed: true };
    }
  } catch (e) { /* ignore */ }
  return null;
}
function rand() { const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a, (b) => ('0' + b.toString(16)).slice(-2)).join(''); }
function backUrl() { return ORIGIN + location.pathname + location.search.replace(/([?&])(code|state)=[^&]*/g, '$1').replace(/[?&]+$/, ''); }

export function login() {
  const s = rand();
  try { localStorage.setItem(STATE_KEY, s); } catch (e) { /* ignore */ }
  let w = window; try { if (window.top !== window && window.top.location.origin === ORIGIN) w = window.top; } catch (e) { /* other origin */ }
  w.location.href = `${ORIGIN}/auth/authorize?response_type=code&client_id=${encodeURIComponent(CLIENT)}&redirect_uri=${encodeURIComponent(backUrl())}&state=${encodeURIComponent(s)}`;
}

// Back from HA's sign-in page with ?code=&state=: swap the one-time code for tokens.
export async function completeLogin() {
  const q = new URLSearchParams(location.search), code = q.get('code'), state = q.get('state');
  if (!code) return;
  let want = null;
  try { want = localStorage.getItem(STATE_KEY); localStorage.removeItem(STATE_KEY); } catch (e) { /* ignore */ }
  history.replaceState(null, '', backUrl() + location.hash);
  if (!want || state !== want) return;
  try {
    const r = await fetch(`${ORIGIN}/auth/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: CLIENT }) });
    const j = await r.json();
    if (j.refresh_token) { auth = { refresh_token: j.refresh_token, access_token: j.access_token, expires: Date.now() + (j.expires_in || 1800) * 1000, clientId: CLIENT }; save(); }
  } catch (e) { /* show login again */ }
}

// 1. the HA frontend around this page (home-assistant-js-websocket Auth or the app's ExternalAuth: accessToken, expired, refreshAccessToken)
function parentAuth() {
  try {
    if (window.parent === window) return null;
    const ha = window.parent.document.querySelector('home-assistant'), a = ha && ha.hass && ha.hass.auth;
    return a && typeof a.refreshAccessToken === 'function' ? a : null;
  } catch (e) { return null; }   // another origin: not HA
}
// 2. the HA app's bridge when this page is the app's own page (Android: externalApp, iOS: webkit message handler)
function appBridge() {
  if (window.externalApp && window.externalApp.getExternalAuth) return (msg) => window.externalApp.getExternalAuth(JSON.stringify(msg));
  const w = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.getExternalAuth;
  return w ? (msg) => w.postMessage(msg) : null;
}
let appTok = null;
function appToken(send, force) {
  if (!force && appTok && appTok.expires - 60000 > Date.now()) return Promise.resolve(appTok.token);
  return new Promise((res, rej) => {
    const cb = 'dashAuth' + rand();
    const done = (t) => { delete window[cb]; clearTimeout(t); };
    const t = setTimeout(() => { done(t); rej('net'); }, 10000);
    window[cb] = (ok, data) => { done(t); if (ok && data && data.access_token) { appTok = { token: data.access_token, expires: Date.now() + (data.expires_in || 1800) * 1000 }; res(appTok.token); } else rej('login'); };
    send({ callback: cb, force: !!force });
  });
}

// A valid access token. Rejects with 'login' (needs sign-in) or 'net' (retry later).
export async function token(force = false) {
  const pa = parentAuth();
  if (pa) {
    try { if (force || pa.expired) await pa.refreshAccessToken(); } catch (e) { throw 'net'; }
    if (pa.accessToken) return pa.accessToken;
  }
  const bridge = appBridge();
  if (bridge) return appToken(bridge, force);
  if (!auth && !noBorrow) auth = borrow();
  if (!auth) throw 'login';
  if (!force && auth.access_token && auth.expires - 60000 > Date.now()) return auth.access_token;
  let r;
  try { r = await fetch(`${ORIGIN}/auth/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: auth.refresh_token, client_id: auth.clientId }) }); }
  catch (e) { throw 'net'; }
  if ([400, 401, 403].includes(r.status)) { if (auth.borrowed) noBorrow = true; auth = null; save(); throw 'login'; }
  if (!r.ok) throw 'net';
  const j = await r.json();
  auth.access_token = j.access_token; auth.expires = Date.now() + (j.expires_in || 1800) * 1000; save();
  return auth.access_token;
}

export function forget() { if (auth && auth.borrowed) noBorrow = true; auth = null; save(); }
export const origin = ORIGIN;
