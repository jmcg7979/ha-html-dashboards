// Pictures and video: camera stills, Frigate (reviews, recordings, the live stream), saved media, the TV launcher's app banners.
import fs from 'node:fs';

// a 1x1 picture for every entity_picture and camera still
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
// The test video every camera plays. Not in git: without it, camera tiles stay dark.
const MP4 = fs.existsSync(new URL('test.mp4', import.meta.url)) ? fs.readFileSync(new URL('test.mp4', import.meta.url)) : Buffer.alloc(0);
// Frigate playback test files (hls/, VP9 because test Chromium has no H.264), make them once with:
// ffmpeg -f lavfi -i testsrc=size=640x360:rate=15 -t 30 -c:v libvpx-vp9 -deadline realtime -b:v 400k -g 30 -f hls -hls_time 5 -hls_playlist_type vod -hls_segment_type fmp4 -hls_fmp4_init_filename init.mp4 -hls_segment_filename hls/seg%d.m4s hls/index.m3u8

const svg = (r, body) => { r.setHeader('content-type', 'image/svg+xml'); r.end(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">${body}</svg>`); };

// HTTP: true when the request was one of these and has been answered
export function mediaRoute(q, r) {
  const u = q.url;
  if (u.startsWith('/api/frigate/') && u.includes('/vod/')) {   // a recording as HLS
    const f = u.split('?')[0].split('/').pop();
    try {
      const body = fs.readFileSync(new URL('hls/' + f, import.meta.url));
      r.setHeader('content-type', f.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4'); r.end(body);
    } catch { r.statusCode = 404; r.end(); }
  } else if (u.startsWith('/api/frigate/') && /\/(clips|snapshot|thumbnail)\//.test(u)) {   // a still: a drawing that differs per picture
    // from the path alone: the query (a signature, a time to get past the cache) changes from run to run, the picture must not
    const n = [...u.split('?')[0]].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0);
    svg(r, `<rect width="320" height="180" fill="hsl(${n % 360},25%,30%)"/><circle cx="${n % 320}" cy="${(n >> 9) % 180}" r="30" fill="hsl(${n % 360},40%,60%)"/>`);
  } else if ((u.startsWith('/api/frigate/') && u.includes('/recording/')) || u.startsWith('/media/')) {   // a clip, or a file from HA's media folder
    r.setHeader('content-type', 'video/mp4'); r.end(MP4);
  } else if (u.startsWith('/__tv/banner/')) {   // the TV launcher serves real app banners here (core/tvhost.js); the mock draws a stand-in
    const pkg = decodeURIComponent(u.slice('/__tv/banner/'.length).split('?')[0]);
    const word = pkg.split('.').filter((x) => !['com', 'android', 'tv', 'google', 'apps', 'livingroom', 'ninja', 'stream'].includes(x)).pop() || pkg;
    const hue = [...pkg].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
    svg(r, `<rect width="320" height="180" fill="hsl(${hue},45%,28%)"/><text x="160" y="102" font-family="sans-serif" font-size="30" font-weight="700" fill="#fff" text-anchor="middle">${word.replace(/[<&]/g, '')}</text>`);
  } else if (u.startsWith('/pic') || u.startsWith('/api/camera_proxy')) {
    r.setHeader('content-type', 'image/png'); r.end(PNG);
  } else return false;
  return true;
}

// Frigate's live stream (MSE over a websocket, as go2rtc sends it): the codec line, then the test video in pieces
export function cameraSocket(c, log) {
  c.on('message', (d) => {
    const m = JSON.parse(d);
    log('MSEREQ ' + m.value);
    c.send(JSON.stringify({ type: 'mse', value: 'video/mp4; codecs="vp09.00.10.08"' }));
    let o = 0;
    const t = setInterval(() => {
      if (o >= MP4.length || c.readyState !== 1) { clearInterval(t); return; }
      c.send(MP4.subarray(o, o + 20000)); o += 20000;
    }, 100);
  });
}

const CAMERAS = ['front_door', 'back_yard', 'driveway'];   // when the site names none (its mock's `frigate.cameras`)
const OBJECTS = [['person'], ['dog'], ['person', 'dog'], ['car']];

// frigate/reviews/get: forty reviews going back from ten minutes ago, across the cameras; the newest is still running
export function frigateReviews(m, cameras = CAMERAS) {
  const t0 = Date.now() / 1000;
  let out = Array.from({ length: 40 }, (_, i) => {
    const start = t0 - 600 - i * 5400 - (i % 3) * 700;
    return { id: `${start.toFixed(6)}-r${i}`, camera: cameras[i % cameras.length], start_time: start, end_time: i === 0 && !m.before ? null : start + 8 + (i % 7) * 13,
      severity: i % 3 === 2 ? 'detection' : 'alert', thumb_path: '', has_been_reviewed: i > 3,
      data: { detections: [`${start}-e${i}`], objects: OBJECTS[i % 4], sub_labels: [], zones: i % 2 ? ['porch'] : [], audio: [] } };
  });
  if (m.severity) out = out.filter((x) => x.severity === m.severity);
  if (m.cameras) out = out.filter((x) => m.cameras.includes(x.camera));
  if (m.after) out = out.filter((x) => x.start_time >= m.after);
  if (m.before) out = out.filter((x) => x.start_time < m.before);
  return JSON.stringify(out.slice(0, m.limit || 50));   // Frigate's answers come through HA as text
}

// frigate/recordings/summary: four days of hours, today up to now, one half-recorded hour yesterday
export function frigateSummary() {
  const days = [];
  for (let d = 0; d < 4; d++) {
    const x = new Date(Date.now() - d * 864e5);
    const day = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    const hours = d === 0 ? x.getHours() + 1 : 24;
    days.push({ day, events: 3, hours: Array.from({ length: hours }, (_, h) => ({ hour: String(h).padStart(2, '0'), events: h % 5 === 0 ? 2 : 0, motion: 1000 + ((h * 7919) % 9000), objects: 0,
      duration: h === hours - 1 && d === 0 ? x.getMinutes() * 60 : (h === 3 && d === 1 ? 1800 : 3600) })).reverse() });
  }
  return JSON.stringify(days);
}
