// Live camera: go2rtc MSE through HA's Frigate integration proxy (signed URL).
// Two pipes per tile, each its own <video> + websocket: `sub` (the tile, `stream`) and `main` (full screen, `fullStream`).
// Full screen enlarges the tile with the substream still playing, opens the main stream in a second video on top and
// shows it once it plays (spinner meanwhile); the substream pauses underneath (socket open, no decoding). Back on the
// tile the main stream closes and the substream carries on at its live edge: nothing reconnects.
// The other tiles pause the same way while one camera is full screen, and close GRACE ms into it.
// Streams while the camera is on screen, and for LINGER ms after it leaves (another view, scrolled away, a closed pop-up),
// so flipping between views comes back to a stream that is already playing; after that it stops.
// A substream that has to start fresh shows the tile's own last frame if under FRESH ms old, otherwise a current snapshot
// (HA camera_proxy -> Frigate latest.jpg, fetched at that moment), behind a spinner until its first frame.
// A start that shows no picture (the address refused, the socket closed, nothing played within FIRST_FRAME ms) is tried
// again, each wait twice the last up to RETRY_MAX; a camera that stays down gets a new snapshot every SNAP_EVERY ms at most.
// Tap = full screen (sound on; if the browser refuses unmuted playback it falls back to muted), tap again to return
// (muted). Mute button bottom-right. A camera whose fullStream is its stream (or none) just enlarges the substream.
// { type: 'camera', entity: 'camera.front_doorbell', name, stream: 'front_doorbell_sub', fullStream: 'front_doorbell', fit: 'cover'|'contain'|'fill' (fill = stretch to the tile, for anamorphic 704x576 streams shown 16:9), ratio: '16/9', noFull: true (tap does nothing),
//   alerts: { cameras: [{ entity, name, stream, fullStream, fit }], review: (id) => 'sensor.<id>_review_status' } }
//   history: true -> a button top-right opens this camera's recordings (#recordings pop-up, cards/frigate-player.js)
//   review: (id) => 'sensor.<id>_review_status' -> red ring while this camera's Frigate review is ALERT (the camera wall uses it)
//   with `alerts`, the tile switches to the camera whose Frigate review is ALERT (newest alert wins) and back when it ends.
//   takeover: true -> part of a take-over (core/alerts.js): plays whatever else is full screen, stops the moment it is hidden
import { h, esc, icon, toggle } from '../core/dom.js';
import { onDispose } from '../core/scope.js';
import { layer } from '../core/layers.js';
import { st, watch, metric } from '../core/store.js';
import { signPath, onReady, connected } from '../core/ha.js';
import { origin } from '../core/auth.js';
import { select, instance } from '../core/frigate.js';

const CODECS = ['avc1.640029', 'avc1.64002A', 'avc1.640033', 'hvc1.1.6.L153.B0', 'mp4a.40.2', 'mp4a.40.5', 'flac', 'opus'];
const ALL = [];        // every camera on the page, so full screen can pause the others
const FRESH = 5000;    // ms a held frame counts as current
const LINGER = 60000;  // ms a stream keeps running after its tile leaves the screen
const GRACE = 3000;    // ms the other tiles' streams stay open once one camera is full screen (a quick look and back finds them playing)
const FIRST_FRAME = 20000;               // ms a start may take to show its first frame (a main stream nobody was watching can need many seconds for its first keyframe)
const RETRY = 3000, RETRY_MAX = 30000;   // ms before a failed start is tried again: doubles with every failure in a row, up to the maximum
const SNAP_EVERY = 30000;                // ms between snapshots of a camera that gives no stream
export const retryIn = (fails) => Math.min(RETRY_MAX, RETRY * 2 ** Math.min(fails, 10));
// Live-edge playback: stay CUSHION s behind the newest buffered frame, catching up by playing slightly faster rather than
// seeking (a seek makes the decoder rebuild from the previous keyframe, which on a long-GOP stream shows as a reload).
// 0.5 s is 5 frames at 10 fps: enough for a phone's hardware decoder not to run dry. Only seek when more than JUMP s behind.
const CUSHION = 0.5, JUMP = 5, FAST = 1.15;

const anyFull = () => ALL.some((c) => c.full);
const hasMain = (c) => !!c.cfg.fullStream && c.cfg.fullStream !== c.cfg.stream;
const soundV = (c) => (c.full && hasMain(c) ? c.main.v : c.sub.v);   // the video whose sound the mute button controls
// does another camera's full screen pause this one? (not a take-over's camera: it shows on top of everything)
const yields = (c) => !c.cfg.takeover && anyFull();
// should this pipe be streaming right now?
const wanted = (c, p) => (p === c.main ? c.full && hasMain(c) : c.full || (c.visible && !yields(c)));

export default function camera(cfg) {
  const el = h(`<div class="camera${['contain', 'fill'].includes(cfg.fit) ? ' ' + cfg.fit : ''}" style="--ratio:${cfg.ratio || '16/9'}">
    <video class="vsub" muted playsinline autoplay disablepictureinpicture></video><video class="vmain" muted playsinline autoplay disablepictureinpicture></video><canvas class="cposter"></canvas><span class="cspin"></span><span class="clabel">${esc(cfg.name || '')}</span>
    <button class="mute" aria-label="Sound on">${icon('volume-off')}</button>${cfg.history ? `<button class="hist" aria-label="Recordings">${icon('history')}</button>` : ''}</div>`);
  const pipe = (sel, main) => ({ v: el.querySelector(sel), main, ws: null, gen: 0, retry: 0, first: 0, fails: 0, on: false, live: false });
  const cam = { cfg, el, sub: pipe('.vsub', false), main: pipe('.vmain', true), full: false, visible: false, snapAt: 0 };
  cam.layer = layer({ el, kind: 'camera', close: () => { if (cam.full) fullscreen(cam); } });   // full screen: Back leaves it, the remote stays on it
  ALL.push(cam);
  onDispose(() => {   // its view unloaded: streams closed, their buffers and the held frame given back, out of the list
    cam.visible = false; clearTimeout(cam.linger); stop(cam, cam.sub); stop(cam, cam.main); cam.poster.width = cam.poster.height = 0;
    const i = ALL.indexOf(cam); if (i >= 0) ALL.splice(i, 1); });
  new IntersectionObserver((en) => {
    const v = en[en.length - 1].isIntersecting; if (v) cam.w = en[en.length - 1].boundingClientRect.width;
    if (v === cam.visible) return; cam.visible = v;
    if (v) { if (!yields(cam)) resume(cam); }
    else if (!cam.full) leave(cam);
    else fullscreen(cam);   // its pop-up closed underneath it: nothing could reach the tile any more
  }).observe(el);

  // held frame: a canvas rather than the video poster, because Chrome letterboxes posters whatever the object-fit
  cam.poster = el.querySelector('.cposter'); cam.frameAt = 0;
  [cam.sub, cam.main].forEach((p) => p.v.addEventListener('playing', () => {
    if (p.live || !p.ws) return;   // no socket: nothing of this start can play yet, the event is a stopped stream's
    p.live = true; p.fails = 0; clearTimeout(p.first);
    if (!p.main) cam.snapAt = 0;   // the next time it is down starts with a new snapshot
    if (p.main && cam.full) cam.sub.v.pause();   // main stream showing: stop decoding the substream underneath
    paint(cam);
  }));
  onReady(() => wake(cam));

  if (cfg.alerts) followAlerts(cam);
  else if (cfg.review) { const id = cfg.review(cfg.entity.split('.')[1]); watch([id], () => toggle(el, 'alerting', ((st(id) || {}).state || '').toUpperCase() === 'ALERT')); }

  el.addEventListener('click', (ev) => {
    if (ev.target.closest('.hist')) { select({ cam: cam.cfg.entity.split('.')[1], inst: instance(cam.cfg.entity), t: null }); location.hash = '#recordings'; return; }
    const m = ev.target.closest('.mute');
    if (m) { setMuted(cam, !soundV(cam).muted); return; }
    if (!cfg.noFull) fullscreen(cam);
  });
  return el;
}

// classes from the pipes: live = substream playing; mainlive = main stream showing; upg = full screen, main still connecting
function paint(c) {
  toggle(c.el, 'live', c.sub.live);
  toggle(c.el, 'mainlive', c.full && c.main.live);
  toggle(c.el, 'upg', c.full && hasMain(c) && !c.main.live);
}

// on screen again (or full screen ended): carry on with the running substream at its live edge, or start one
function resume(c) {
  clearTimeout(c.linger);
  // a substream with its socket open carries on; one still waiting to be tried again is started now instead
  if (c.sub.on && c.sub.ws) { liveEdge(c.sub.v); play(c.sub.v); if (!c.sub.live) deadline(c, c.sub); } else start(c, c.sub);
}
// off screen (or paused by another camera's full screen): keep the substream for a while, then close it
function leave(c, ms = c.cfg.takeover ? 0 : LINGER) {
  clearTimeout(c.linger);
  c.linger = setTimeout(() => { if (!wanted(c, c.sub)) stop(c, c.sub); }, ms);
}
// (re)connect after HA reconnects or the page is shown again
function wake(c) { if (wanted(c, c.sub)) start(c, c.sub); if (wanted(c, c.main)) start(c, c.main); }
function liveEdge(v) { try { const b = v.buffered; if (b.length) v.currentTime = Math.max(0, b.end(b.length - 1) - CUSHION); v.playbackRate = 1; } catch (x) { /* ignore */ } }
// called as data arrives: far behind -> jump; a little behind -> play FAST until back at the cushion; otherwise normal speed
function pace(v, end) {
  const lag = end - v.currentTime;
  if (lag > JUMP) { v.currentTime = end - CUSHION; v.playbackRate = 1; }
  else v.playbackRate = lag > CUSHION * 2 ? FAST : lag <= CUSHION ? 1 : v.playbackRate;
}

// switch the tile to whichever camera has a Frigate alert, newest first; back to the default when none has
function followAlerts(cam) {
  const base = cam.cfg, a = base.alerts, ids = a.cameras.map((x) => x.entity.split('.')[1]), since = {};
  const label = cam.el.querySelector('.clabel');
  watch(ids.map(a.review), () => {
    ids.forEach((id) => { const on = ((st(a.review(id)) || {}).state || '').toUpperCase() === 'ALERT'; if (on && !since[id]) since[id] = Date.now(); if (!on) delete since[id]; });
    const pick = Object.keys(since).sort((x, y) => since[y] - since[x])[0];
    const next = pick ? { ...base, ...a.cameras[ids.indexOf(pick)] } : base;
    toggle(cam.el, 'alerting', !!pick);
    label.textContent = next.name + (pick ? ' · Alert' : '');
    if (cam.cfg.entity === next.entity) return;
    cam.cfg = next;
    toggle(cam.el, 'contain', next.fit === 'contain'); toggle(cam.el, 'fill', next.fit === 'fill');
    stop(cam, cam.sub); stop(cam, cam.main);
    cam.frameAt = cam.snapAt = 0;   // after stop, which keeps a frame: the held frame (or snapshot) is the other camera's
    paint(cam);
    wake(cam);
  });
}

function fullscreen(cam) {
  const on = !cam.full;
  cam.full = on; toggle(cam.el, 'full', on);
  window.dispatchEvent(new CustomEvent('dash:camfull', { detail: on }));   // the page shell hides its chrome (core/phone.js)
  if (on) cam.layer.open(); else cam.layer.shut();
  ALL.forEach((c) => {
    if (c === cam || c.cfg.takeover) return;
    if (on) { c.sub.v.pause(); leave(c, GRACE); }   // paused while one camera is full screen; closed GRACE ms into it
    else if (c.visible) resume(c);
  });
  if (on) {
    if (!cam.sub.on) start(cam, cam.sub);
    if (hasMain(cam)) start(cam, cam.main);
  } else {
    stop(cam, cam.main);
    if (cam.visible) resume(cam); else leave(cam);
  }
  setMuted(cam, !on);    // sound on in full screen, off on the tile
  if (!on) cam.main.v.muted = true;
  paint(cam);
}

// keep the substream's frame on screen now (only while it is connected and playing, so a frozen frame never gets a new
// timestamp), so its next start can show it while it connects. No larger than the tile shows it: a canvas the size of the
// stream is 2-4 MB of graphics memory per camera for a picture drawn a few hundred pixels wide.
function grab(c) {
  const v = c.sub.v;
  if (!c.sub.ws || !c.sub.live || v.readyState < 2 || !v.videoWidth) return;
  try {
    const k = Math.min(1, Math.max(c.full ? innerWidth : c.w || 0, 240) * (window.devicePixelRatio || 1) / v.videoWidth);
    const p = c.poster, w = Math.round(v.videoWidth * k), hh = Math.round(v.videoHeight * k);
    if (p.width !== w || p.height !== hh) { p.width = w; p.height = hh; }
    p.getContext('2d').drawImage(v, 0, 0, p.width, p.height); c.frameAt = Date.now();
  } catch (e) { /* ignore */ }
}
// every start/stop bumps p.gen; async steps from an older start see the change and quit,
// so a quick stop+start can't leave a stale socket or MediaSource behind
function stop(c, p) {
  if (!p.main) grab(c);
  p.on = false; p.live = false; p.gen++; clearTimeout(p.retry); clearTimeout(p.first);
  // a socket being closed is kept by the browser until the other side answers: without its handlers it holds nothing of this camera
  if (p.ws) { p.ws.onclose = p.ws.onmessage = p.ws.onopen = null; try { p.ws.close(); } catch (e) { /* ignore */ } p.ws = null; }
  if (p.url) { URL.revokeObjectURL(p.url); p.url = null; }   // stopped before its source opened: the address would keep the source for the page's life
  // release the decoder and what the stream had buffered: always for the main stream; for the substream only while its
  // tile is out of sight (on screen its last frame stays up until the next start)
  if ((p.main || !c.visible || document.hidden) && p.v.hasAttribute('src')) { p.v.removeAttribute('src'); p.v.load(); }
}
function play(v) {
  const pr = v.play();
  if (pr && pr.catch) pr.catch((e) => { if (e && e.name === 'NotAllowedError' && !v.muted) { const c = ALL.find((x) => soundV(x) === v); if (c) setMuted(c, true); else { v.muted = true; play(v); } } });
}
// mute state and its button together; browsers that block sound without a fresh tap fall back to muted (play() above)
function setMuted(c, muted) {
  const v = soundV(c);
  [c.sub.v, c.main.v].forEach((x) => { if (x !== v) x.muted = true; });
  v.muted = muted;
  const m = c.el.querySelector('.mute'); toggle(m, 'on', !muted); m.innerHTML = icon(muted ? 'volume-off' : 'volume-high'); m.setAttribute('aria-label', muted ? 'Sound on' : 'Sound off');
  if (v.src) play(v);
}

// retry: this start is a failed one tried again (again(), below); any other start begins without waiting for earlier failures
function start(c, p, retry) {
  stop(c, p); paint(c);
  if (!retry) p.fails = 0;
  if (document.hidden || !connected() || !wanted(c, p)) return;
  const e = st(c.cfg.entity), cid = (e && e.attributes.client_id) || 'frigate';
  const stream = p.main ? c.cfg.fullStream : c.cfg.stream, gen = p.gen;
  p.on = true;   // a stream is open or on its way (cleared by stop)
  deadline(c, p);
  if (!p.main) {
    // the tile's own recent frame; otherwise a spinner and a current snapshot (while the camera stays down, the snapshot
    // of the last SNAP_EVERY ms stays up and no new one is asked for)
    if (Date.now() - c.frameAt < FRESH) c.el.classList.add('held');
    else if (Date.now() - c.snapAt > SNAP_EVERY) { if (!retry || !c.snapAt) c.el.classList.remove('held'); c.snapAt = Date.now(); snapshot(c); }   // a newer snapshot replaces the one that is up
  }
  signPath(`/api/frigate/${cid}/mse/api/ws?src=${encodeURIComponent(stream)}`)
    .then((path) => { if (p.gen === gen) open(c, p, origin.replace(/^http/, 'ws') + path, gen); })
    .catch(() => { if (p.gen === gen) again(c, p); });
}
// A start has FIRST_FRAME ms to show its first frame: a socket that opens and never delivers a picture would otherwise
// sit behind the spinner for good. A pipe paused on purpose (the substream under a playing main stream) is left alone:
// it is given the same time again when it is asked to play (resume).
function deadline(c, p) {
  clearTimeout(p.first);
  p.first = setTimeout(() => { if (p.on && !p.live && !p.v.paused) again(c, p); }, FIRST_FRAME);
}
// this start gave no picture: close what it opened and try again, after a wait that doubles with every failure in a row
function again(c, p) {
  stop(c, p); paint(c);
  p.on = true;   // the next try is booked
  p.retry = setTimeout(() => start(c, p, true), retryIn(p.fails++));
}

// a current still for the wait: HA's camera proxy (Frigate latest.jpg) via a signed path (camera entities aren't in the
// state subscription, so no entity_picture token here), sized to the tile; ignored once the substream plays, if the
// tile's own frame is newer, or if the tile shows another camera by then (or is gone)
function snapshot(c) {
  const entity = c.cfg.entity, hgt = Math.round(c.el.clientHeight * (window.devicePixelRatio || 1)) || 360;
  const late = () => c.cfg.entity !== entity || !ALL.includes(c) || c.sub.live || Date.now() - c.frameAt < FRESH;
  const failed = () => { if (c.cfg.entity === entity) c.snapAt = 0; };   // the next start asks again
  signPath(`/api/camera_proxy/${entity}`, 30).then((path) => {
    if (late()) return;
    const img = new Image();
    img.onload = () => {
      if (late()) return;
      const pc = c.poster; pc.width = img.naturalWidth; pc.height = img.naturalHeight;
      try { pc.getContext('2d').drawImage(img, 0, 0); } catch (x) { return; }
      c.el.classList.add('held');
    };
    img.onerror = failed;
    img.src = origin + path + '&height=' + hgt;
  }).catch(failed);
}

function open(c, p, url, gen) {
  const v = p.v, ms = new MediaSource(), late = [];   // late: data that arrived while the buffer was busy (4 MB at most)
  let sb = null, len = 0, t0 = performance.now();
  const blob = p.url = v.src = URL.createObjectURL(ms);
  ms.addEventListener('sourceopen', () => {
    URL.revokeObjectURL(blob); if (p.url === blob) p.url = null;   // this stream's own URL: after a quick restart v.src is already the next stream's
    if (p.gen !== gen) return;
    const sock = p.ws = new WebSocket(url); sock.binaryType = 'arraybuffer';
    sock.onopen = () => sock.send(JSON.stringify({ type: 'mse', value: CODECS.filter((x) => MediaSource.isTypeSupported(`video/mp4; codecs="${x}"`)).join() }));
    sock.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        const m = JSON.parse(ev.data);
        if (m.type === 'mse' && !sb) {
          if (ms.readyState !== 'open') { sock.close(); return; }
          sb = ms.addSourceBuffer(m.value); sb.mode = 'segments';
          sb.addEventListener('updateend', () => {
            if (sb.updating) return;
            try {
              if (len) { const d = new Uint8Array(len); let o = 0; late.splice(0).forEach((a) => { d.set(a, o); o += a.byteLength; }); len = 0; sb.appendBuffer(d); return; }
              const b = sb.buffered; if (!b.length) return;
              const end = b.end(b.length - 1);
              if (!v.paused) pace(v, end);                                            // stay near the live edge
              if (b.start(0) < end - 15) sb.remove(b.start(0), end - 10);              // keep memory low on weak devices
            } catch (x) { /* buffer busy */ }
          });
        } else if (m.type === 'error') console.warn('go2rtc', m.value);
        return;
      }
      if (!sb) return;
      if (sb.updating || len) { const a = new Uint8Array(ev.data); if (len + a.byteLength <= 4 << 20) { late.push(a); len += a.byteLength; } }
      else { try { sb.appendBuffer(ev.data); } catch (x) { /* ignore */ } }
    };
    sock.onclose = () => { if (p.ws === sock) { p.ws = null; again(c, p); } };
  }, { once: true });
  v.onplaying = () => { if (t0) { metric(p.main ? 'camFull' : 'cam', performance.now() - t0); t0 = 0; } };
  play(v);
}

// A stream that stops moving while its socket stays open looks live for ever, so restart it: the tile shows the spinner until real frames come back.
const STALL = 15000;
setInterval(() => { if (document.hidden) return; const now = performance.now();
  ALL.forEach((c) => [c.sub, c.main].forEach((p) => {
    if (!p.on || !p.live || p.v.paused) { p.seenT = null; return; }
    if (p.v.currentTime !== p.seenT) { p.seenT = p.v.currentTime; p.seenAt = now; }
    if (p.v.error || now - p.seenAt > STALL) { p.seenT = null; stop(c, p); paint(c); start(c, p); }
  })); }, 5000);

document.addEventListener('visibilitychange', () => ALL.forEach((c) => { if (document.hidden) { stop(c, c.sub); stop(c, c.main); paint(c); } else wake(c); }));
