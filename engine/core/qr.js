// A QR code as SVG (vendor/qrcode, MIT), dark on white with a quiet zone, so phones read it off a TV.
//   qr(text, label) -> Promise<svg string>   (rejects when the library can't be loaded; the next call tries again)
import { asset } from './asset.js';
import { esc } from './dom.js';

let lib = null;
export function qr(text, label = 'QR code to join the party') {
  if (!lib) lib = new Promise((res, rej) => { if (window.qrcode) return res(window.qrcode); const s = document.createElement('script'); s.src = asset('vendor/qrcode/qrcode.js'); s.onload = () => res(window.qrcode); s.onerror = () => { lib = null; s.remove(); rej(new Error('no QR library')); }; document.head.appendChild(s); });
  return lib.then((Q) => {
    const c = Q(0, 'M'); c.addData(text); c.make();
    const n = c.getModuleCount(), z = 4; let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (c.isDark(y, x)) d += `M${x + z},${y + z}h1v1h-1z`;
    return `<svg viewBox="0 0 ${n + 2 * z} ${n + 2 * z}" shape-rendering="crispEdges" role="img" aria-label="${esc(label)}"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  });
}
