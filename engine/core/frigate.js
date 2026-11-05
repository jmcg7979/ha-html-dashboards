// Frigate through Home Assistant's Frigate integration: review items, recordings, signed media URLs, HLS playback.
// Everything goes over the dashboard's HA websocket (frigate/* commands) and the integration's /api/frigate/<instance>/… proxy,
// so it works wherever the dashboard works (no Frigate login, no direct Frigate address).
// Shared selection: the Events list sets `sel` and opens #review; a camera's history button sets sel.cam and opens #recordings.
import { request, signPath } from './ha.js';
import { st } from './store.js';
import { origin } from './auth.js';
import { timeOpts } from './units.js';

export const instance = (entity) => (((st(entity) || {}).attributes || {}).client_id) || 'frigate';
export const camId = (entity) => entity.split('.')[1];
const parse = (r) => (typeof r === 'string' ? JSON.parse(r) : r);

// review items, newest first: { id, camera, start_time, end_time, severity: 'alert'|'detection', has_been_reviewed, data: { objects, zones, detections } }
export const getReviews = (inst, opts = {}) => request({ type: 'frigate/reviews/get', instance_id: inst, limit: 60, ...opts }).then(parse);
// how many review items (alerts by default) in the last `hours` nobody has looked at, on these cameras
export const unreviewed = (cameras, { hours = 24, severity = 'alert' } = {}) => {
  const ids = cameras.map((c) => camId(c.entity));
  return getReviews(instance(cameras[0].entity), { after: Date.now() / 1000 - hours * 3600, limit: 100, cameras: ids, ...(severity ? { severity } : {}) })
    .then((r) => (r || []).filter((x) => !x.has_been_reviewed && ids.includes(x.camera)).length);
};
export const markViewed = (inst, ids) => request({ type: 'frigate/reviews/viewed', instance_id: inst, ids }).catch(() => {});
// per day (local time zone): [{ day: 'YYYY-MM-DD', events, hours: [{ hour: '14', duration, motion, objects, events }] }]
export const getSummary = (inst, camera) => request({ type: 'frigate/recordings/summary', instance_id: inst, camera, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }).then(parse);

// signed media URLs (the browser can't send the HA token with <img>/<video>); cached until shortly before they expire
const signed = new Map();
export function sign(path, hours = 4) {
  const c = signed.get(path); if (c && c.until > Date.now()) return c.p;
  const p = signPath(path, hours * 3600).then((x) => origin + x);
  signed.set(path, { p, until: Date.now() + (hours * 3600 - 300) * 1000 });
  p.catch(() => signed.delete(path));
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

// hls.js (vendor/, light build) loaded on first playback
let hlsP = null;
function loadHls() {
  if (!hlsP) hlsP = new Promise((res, rej) => { const s = document.createElement('script'); s.src = new URL('../vendor/hls/hls.light.min.js', import.meta.url).href; s.onload = () => res(window.Hls); s.onerror = rej; document.head.appendChild(s); });
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
export const fmtDur = (s) => (s < 60 ? Math.max(1, Math.round(s)) + ' s' : Math.floor(s / 60) + ' min' + (s % 60 >= 30 && s < 600 ? ' ' + Math.round(s % 60) + ' s' : ''));
export const labels = (r) => [...new Set([...(r.data.objects || []), ...(r.data.audio || []), ...(r.data.sub_labels || []).map((x) => (Array.isArray(x) ? x[0] : x))])]
  .map((x) => x.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())).join(', ') || 'Motion';
