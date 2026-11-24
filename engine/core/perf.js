// @ts-check
// The timing readout in the corner (#perf; settings.perf, ?perf=1): how long a tap takes to show and to be confirmed by
// HA, how long the cameras took to start; its dot says whether HA is connected.
import { M, onPerf } from './store.js';
import { settings } from './settings.js';

const med = (a) => { if (!a.length) return '–'; const b = [...a].sort((x, y) => x - y); return Math.round(b[b.length >> 1]) + ' ms'; };

/** @returns {(ok: boolean) => void} to call with the connection's state */
export function initPerf() {
  const perf = document.getElementById('perf'), dot = perf.querySelector('i'), txt = perf.querySelector('span');
  perf.hidden = !settings.perf;
  const show = () => { txt.textContent = `tap→paint ${med(M.paint)} · tap→HA ${med(M.confirm)}` + (M.cam.length ? ` · cam ${M.cam.map((x) => (x / 1000).toFixed(1) + 's').join('/')}` : '') + (M.camFull ? ` · main ${(M.camFull / 1000).toFixed(1)}s` : ''); };
  onPerf(show);
  return (ok) => { dot.className = ok ? 'ok' : ''; if (!ok) txt.textContent = 'offline'; else show(); };
}
