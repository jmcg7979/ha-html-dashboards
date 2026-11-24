// The assembled dashboard under /local/dash/, as HA serves /config/www: plain files, no cache headers, query ignored.
import fs from 'node:fs';
import path from 'node:path';

const MIME = { js: 'text/javascript', css: 'text/css', html: 'text/html', svg: 'image/svg+xml', woff2: 'font/woff2', json: 'application/json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', ico: 'image/x-icon',
  wav: 'audio/wav', mp3: 'audio/mpeg', mp4: 'video/mp4', txt: 'text/plain' };

// Only files inside the build are served: the URL path is resolved and refused when it leaves the build ('..', an absolute path).
function inDash(dash, f) {
  let d; try { d = decodeURIComponent(f); } catch { return null; }
  const root = path.resolve(dash), full = path.resolve(root, d);
  return full.startsWith(root + path.sep) ? full : null;
}

export function serveDash(dash, q, r) {
  const f = q.url.split('?')[0].slice('/local/dash/'.length) || 'index.html';
  try {
    const full = inDash(dash, f); if (!full) throw new Error('outside the build');
    const body = fs.readFileSync(full);
    r.setHeader('content-type', MIME[f.split('.').pop()] || 'application/octet-stream');
    r.end(body);
  } catch { r.statusCode = 404; r.end(); }
}
