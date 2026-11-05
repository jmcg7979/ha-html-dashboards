// Live camera: go2rtc MSE through HA's Frigate integration proxy (signed URL).
// Two pipes per tile, each its own <video> + websocket: `sub` (the tile, `stream`) and `main` (full screen, `fullStream`).
// Full screen enlarges the tile with the substream still playing, opens the main stream in a second video on top and
// shows it once it plays (spinner meanwhile); the substream pauses underneath (socket open, no decoding). Back on the
// tile the main stream closes and the substream carries on at its live edge: nothing reconnects.
// The other tiles pause the same way while one camera is full screen, and close after LINGER ms of it.
// Streams while the camera is on screen, and for LINGER ms after it leaves (another view, scrolled away, a closed pop-up),
// so flipping between views comes back to a stream that is already playing; after that it stops.
// A substream that has to start fresh shows the tile's own last frame if under FRESH ms old, otherwise a current snapshot
// (HA camera_proxy -> Frigate latest.jpg, fetched at that moment), behind a spinner until its first frame.
// Tap = full screen (sound on; if the browser refuses unmuted playback it falls back to muted), tap again to return
// (muted). Mute button bottom-right. A camera whose fullStream is its stream (or none) just enlarges the substream.
// { type: 'camera', entity: 'camera.front_doorbell', name, stream: 'front_doorbell_sub', fullStream: 'front_doorbell', fit: 'cover'|'contain'|'fill' (fill = stretch to the tile, for anamorphic 704x576 streams shown 16:9), ratio: '16/9', noFull: true (tap does nothing),
//   alerts: { cameras: [{ entity, name, stream, fullStream, fit }], review: (id) => 'sensor.<id>_review_status' } }
//   history: true -> a button top-right opens this camera's recordings (#recordings pop-up, cards/frigate-player.js)
//   review: (id) => 'sensor.<id>_review_status' -> red ring while this camera's Frigate review is ALERT (the camera wall uses it)
//   with `alerts`, the tile switches to the camera whose Frigate review is ALERT (newest alert wins) and back when it ends.
import { h, esc, icon, toggle } from '../core/dom.js';
import { st, watch, metric } from '../core/store.js';
import { signPath, onReady, connected } from '../core/ha.js';
import { origin } from '../core/auth.js';
import { select, instance } from '../core/frigate.js';

const CODECS = ['avc1.640029', 'avc1.64002A', 'avc1.640033', 'hvc1.1.6.L153.B0', 'mp4a.40.2', 'mp4a.40.5', 'flac', 'opus'];
const ALL = [];        // every camera on the page, so full screen can pause the others
const FRESH = 5000;    // ms a held frame counts as current
const LINGER = 60000;  // ms a stream keeps running after its tile leaves the screen (or another camera goes full screen)
// Live-edge playback: stay CUSHION s behind the newest buffered frame, catching up by playing slightly faster rather than
// seeking (a seek makes the decoder rebuild from the previous keyframe, which on a long-GOP stream shows as a reload).
// 0.5 s is 5 frames at 10 fps: enough for a phone's hardware decoder not to run dry. Only seek when more than JUMP s behind.
const CUSHION = 0.5, JUMP = 5, FAST = 1.15;

const anyFull = () => ALL.some((c) => c.full);
const hasMain = (c) => !!c.cfg.fullStream && c.cfg.fullStream !== c.cfg.stream;
const soundV = (c) => (c.full && hasMain(c) ? c.main.v : c.sub.v);   // the video whose sound the mute button controls
// should this pipe be streaming right now?
const wanted = (c, p) => (p === c.main ? c.full && hasMain(c) : c.full || (c.visible && !anyFull()));

export default function camera(cfg) {
  const el = h(`<div class="camera${['contain', 'fill'].includes(cfg.fit) ? ' ' + cfg.fit : ''}" style="--ratio:${cfg.ratio || '16/9'}">
    <video class="vsub" muted playsinline autoplay disablepictureinpicture></video><video class="vmain" muted playsinline autoplay disablepictureinpicture></video><canvas class="cposter"></canvas><span class="cspin"></span><span class="clabel">${esc(cfg.name || '')}</span>
    <button class="mute">${icon('volume-off')}</button>${cfg.history ? `<button class="hist">${icon('history')}</button>` : ''}</div>`);
  const pipe = (sel, main) => ({ v: el.querySelector(sel), main, ws: null, gen: 0, retry: 0, on: false, live: false });
  const cam = { cfg, el, sub: pipe('.vsub', false), main: pipe('.vmain', true), full: false, visible: false };
  ALL.push(cam);
  new IntersectionObserver((en) => {
    const v = en[en.length - 1].isIntersecting; if (v === cam.visible) return; cam.visible = v;
    if (v) { if (!anyFull()) resume(cam); }
    else if (!cam.full) leave(cam);
    else fullscreen(cam);   // its pop-up closed underneath it: nothing could reach the tile any more
  }).observe(el);

  // held frame: a canvas rather than the video poster, because Chrome letterboxes posters whatever the object-fit
  cam.poster = el.querySelector('.cposter'); cam.frameAt = 0;
  [cam.sub, cam.main].forEach((p) => p.v.addEventListener('playing', () => {
    if (p.live) return; p.live = true;
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
  if (c.sub.on) { liveEdge(c.sub.v); play(c.sub.v); } else start(c, c.sub);
}
// off screen (or paused by another camera's full screen): keep the substream for LINGER ms, then close it
function leave(c) {
  clearTimeout(c.linger);
  c.linger = setTimeout(() => { if (!wanted(c, c.sub)) stop(c, c.sub); }, LINGER);
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
    cam.frameAt = 0;   // after stop, which keeps a frame: the held frame is the other camera's
    paint(cam);
    wake(cam);
  });
}

function fullscreen(cam) {
  const on = !cam.full;
  cam.full = on; toggle(cam.el, 'full', on);
  window.dispatchEvent(new CustomEvent('dash:camfull', { detail: on }));   // the page shell hides its chrome (core/phone.js)
  ALL.forEach((c) => {
    if (c === cam) return;
    if (on) { c.sub.v.pause(); leave(c); }   // paused while one camera is full screen; closed if that lasts LINGER ms
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
// timestamp), so its next start can show it while it connects
function grab(c) {
  const v = c.sub.v;
  if (!c.sub.ws || !c.sub.live || v.readyState < 2 || !v.videoWidth) return;
  try {
    const p = c.poster; if (p.width !== v.videoWidth || p.height !== v.videoHeight) { p.width = v.videoWidth; p.height = v.videoHeight; }
    p.getContext('2d').drawImage(v, 0, 0, p.width, p.height); c.frameAt = Date.now();
  } catch (e) { /* ignore */ }
}
// every start/stop bumps p.gen; async steps from an older start see the change and quit,
// so a quick stop+start can't leave a stale socket or MediaSource behind
function stop(c, p) {
  if (!p.main) grab(c);
  p.on = false; p.live = false; p.gen++; clearTimeout(p.retry);
  if (p.ws) { p.ws.onclose = null; try { p.ws.close(); } catch (e) { /* ignore */ } p.ws = null; }
  if (p.main) { p.v.removeAttribute('src'); p.v.load(); }   // release the main stream's decoder
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
  const m = c.el.querySelector('.mute'); toggle(m, 'on', !muted); m.innerHTML = icon(muted ? 'volume-off' : 'volume-high');
  if (v.src) play(v);
}

function start(c, p) {
  stop(c, p); paint(c);
  if (document.hidden || !connected() || !wanted(c, p)) return;
  const e = st(c.cfg.entity), cid = (e && e.attributes.client_id) || 'frigate';
  const stream = p.main ? c.cfg.fullStream : c.cfg.stream, gen = p.gen;
  p.on = true;   // a stream is open or on its way (cleared by stop)
  if (!p.main) {
    const fresh = Date.now() - c.frameAt < FRESH;
    toggle(c.el, 'held', fresh);
    if (!fresh) snapshot(c, gen);   // no recent frame of its own: spinner + a current snapshot
  }
  signPath(`/api/frigate/${cid}/mse/api/ws?src=${encodeURIComponent(stream)}`)
    .then((path) => { if (p.gen === gen) open(c, p, origin.replace(/^http/, 'ws') + path, gen); })
    .catch(() => { if (p.gen === gen) p.retry = setTimeout(() => start(c, p), 5000); });
}

// a current still for the wait: HA's camera proxy (Frigate latest.jpg) via a signed path (camera entities aren't in the
// state subscription, so no entity_picture token here), sized to the tile; ignored once the substream plays or if the
// tile's own frame is newer
function snapshot(c, gen) {
  const hgt = Math.round(c.el.clientHeight * (window.devicePixelRatio || 1)) || 360;
  signPath(`/api/camera_proxy/${c.cfg.entity}`, 30).then((path) => {
    if (c.sub.gen !== gen) return;
    const img = new Image();
    img.onload = () => {
      if (c.sub.gen !== gen || c.sub.live || Date.now() - c.frameAt < FRESH) return;
      const pc = c.poster; pc.width = img.naturalWidth; pc.height = img.naturalHeight;
      try { pc.getContext('2d').drawImage(img, 0, 0); } catch (x) { return; }
      c.el.classList.add('held');
    };
    img.src = origin + path + '&height=' + hgt;
  }).catch(() => {});
}

function open(c, p, url, gen) {
  const v = p.v, ms = new MediaSource(), buf = new Uint8Array(4 * 1024 * 1024);
  let sb = null, len = 0, t0 = performance.now();
  const blob = v.src = URL.createObjectURL(ms);
  ms.addEventListener('sourceopen', () => {
    URL.revokeObjectURL(blob);   // this stream's own URL: after a quick restart v.src is already the next stream's
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
              if (len) { const d = buf.slice(0, len); len = 0; sb.appendBuffer(d); return; }
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
      if (sb.updating || len) { const a = new Uint8Array(ev.data); if (len + a.byteLength <= buf.length) { buf.set(a, len); len += a.byteLength; } }
      else { try { sb.appendBuffer(ev.data); } catch (x) { /* ignore */ } }
    };
    sock.onclose = () => { if (p.ws === sock) { p.ws = null; p.live = false; paint(c); p.retry = setTimeout(() => start(c, p), 3000); } };
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
