// Frigate through Home Assistant's Frigate integration: review items, recordings, signed media URLs, HLS playback.
// Everything goes over the dashboard's HA websocket (frigate/* commands) and the integration's /api/frigate/<instance>/… proxy,
// so it works wherever the dashboard works (no Frigate login, no direct Frigate address).
// Shared selection: the Events list sets `sel` and opens #review; a camera's history button sets sel.cam and opens #recordings.
import { request, signPath } from './ha.js';
import { st } from './store.js';
import { origin } from './auth.js';
import { timeOpts } from './units.js';
import { asset } from './asset.js';

export const instance = (entity) => (((st(entity) || {}).attributes || {}).client_id) || 'frigate';
export const camId = (entity) => entity.split('.')[1];
const parse = (r) => (typeof r === 'string' ? JSON.parse(r) : r);

// review items, newest first: { id, camera, start_time, end_time, severity: 'alert'|'detection', has_been_reviewed, data: { objects, zones, detections } }
export const getReviews = (inst, opts = {}) => request({ type: 'frigate/reviews/get', instance_id: inst, limit: 60, ...opts }).then(parse);
export const markViewed = (inst, ids) => request({ type: 'frigate/reviews/viewed', instance_id: inst, ids }).catch(() => {});
// per day (local time zone): [{ day: 'YYYY-MM-DD', events, hours: [{ hour: '14', duration, motion, objects, events }] }]
export const getSummary = (inst, camera) => request({ type: 'frigate/recordings/summary', instance_id: inst, camera, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }).then(parse);

// signed media URLs (the browser can't send the HA token with <img>/<video>); cached until shortly before they expire.
// Expired ones are dropped as new ones are made (once a minute at most), so a screen that stays up for weeks keeps only
// the addresses that still work.
const signed = new Map();
let swept = 0;
export const signedCount = () => signed.size;   // for the checks
export function sign(path, hours = 4) {
  const now = Date.now(), c = signed.get(path); if (c && c.until > now) return c.p;
  if (now - swept > 60000) { swept = now; signed.forEach((v, k) => { if (v.until <= now) signed.delete(k); }); }
  const p = signPath(path, hours * 3600).then((x) => origin + x);
  const mine = { p, until: now + (hours * 3600 - 300) * 1000 };
  signed.set(path, mine);
  p.catch(() => { if (signed.get(path) === mine) signed.delete(path); });
  return p;
}
export const thumbPath = (inst, r) => `/api/frigate/${inst}/clips/review/thumb-${r.camera}-${r.id}.webp`;
export const snapshotPath = (inst, eventId) => `/api/frigate/${inst}/snapshot/${eventId}`;
// HLS of a time range (Frigate's VOD); the playlist's segment links carry the signature, so they need nothing extra
export const vodPath = (inst, camera, start, end) => `/api/frigate/${inst}/vod/${camera}/start/${Math.floor(start)}/end/${Math.ceil(end)}/index.m3u8`;
export const clipPath = (inst, camera, start, end) => `/api/frigate/${inst}/recording/${camera}/start/${Math.floor(start)}/end/${Math.ceil(end)}`;

// shared selection + change events
export const sel = { list: [], index: -1, inst: 'frigate', cam: null, t: null, names: {} };
export function select(patch) { Object.assign(sel, patch); window.dispatchEvent(new CustomEvent('frigate:sel')); }

// hls.js (vendor/, light build) loaded on first playback; a load that failed is tried again by the next playback
let hlsP = null;
function loadHls() {
  if (!hlsP) {
    const mine = hlsP = new Promise((res, rej) => { const s = document.createElement('script'); s.src = asset('vendor/hls/hls.light.min.js');
      s.onload = () => (window.Hls ? res(window.Hls) : rej(new Error('hls.js did not load'))); s.onerror = () => { s.remove(); rej(new Error('hls.js did not load')); }; document.head.appendChild(s); });
    mine.catch(() => { if (hlsP === mine) hlsP = null; });
  }
  return hlsP;
}
// play a signed HLS URL in a <video>; returns a stop function. onError(msg) when the stream can't play (e.g. codec).
export function playHls(video, url, { at = 0, onError } = {}) {
  let hls = null, dead = false;
  const seek = () => { if (at > 0) { try { video.currentTime = at; } catch (e) { /* ignore */ } } const p = video.play(); if (p && p.catch) p.catch(() => {}); };
  if (video.canPlayType('application/vnd.apple.mpegurl') && !window.MediaSource) { video.src = url; video.addEventListener('loadedmetadata', seek, { once: true }); }
  else loadHls().then((Hls) => {
    if (dead) return;
    hls = new Hls({ maxBufferLength: 20, backBufferLength: 30, enableWorker: true });
    hls.on(Hls.Events.MANIFEST_PARSED, seek);
    hls.on(Hls.Events.ERROR, (e, d) => { if (d.fatal) { if (onError) onError(d.details || d.type); hls.destroy(); hls = null; } });
    hls.loadSource(url); hls.attachMedia(video);
  }).catch(() => onError && onError('player failed to load'));
  return () => { dead = true; if (hls) { hls.destroy(); hls = null; } video.removeAttribute('src'); video.load(); };
}

export const fmtTime = (t) => new Date(t * 1000).toLocaleTimeString([], timeOpts({ hour: 'numeric', minute: '2-digit' }));
export function fmtDay(t) {
  const d = new Date(t * 1000), today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
// a length in words: whole seconds under a minute; minutes above, with the seconds when they are half a minute or more and the whole is under ten minutes
export function fmtDur(s) {
  const t = Math.max(1, Math.round(s)), m = Math.floor(t / 60), r = t % 60;
  return t < 60 ? t + ' s' : m + ' min' + (r >= 30 && t < 600 ? ' ' + r + ' s' : '');
}
export const labels = (r) => [...new Set([...(r.data.objects || []), ...(r.data.audio || []), ...(r.data.sub_labels || []).map((x) => (Array.isArray(x) ? x[0] : x))])]
  .map((x) => x.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())).join(', ') || 'Motion';
