// 3D printer job: what's on the plate, how far along, when it's done. One layout for every state, so nothing moves when
// a print starts or ends: idle it shows the last model with "Ready", printing it fills in progress, layers, time and filament.
// Pictures: the printer's camera at its own shape (never cropped; the normal camera tile, so tap = full screen), and under
// it the model's plate preview filling the rest of the panel; with no camera the model takes the whole space.
// Saving prints: Record (while a job runs) marks it to be exported from Frigate when it ends. Prints opens the #prints pop-up
// (cards/prints.js: every print in Frigate's buffer to play / save, and the saved ones); its badge = prints not saved yet.
// { type: 'print-job', printer: H.printer }   (home.js: status, stage, progress, remaining, end, task, layer, layers,
//   weight, length, camera: { camera card config }, cover, light, door, controls: { pause, resume, stop }, rec, ams.trays, external)
// Pause / Resume / Stop appear only when those entities exist; Stop asks first.
import { h, esc, icon, setText, setHTML, hm, cap } from '../core/dom.js';
import { st, watch, tick } from '../core/store.js';
import { run } from '../core/actions.js';
import { origin } from '../core/auth.js';
import camera from './camera.js';
import { load, invalidate } from '../core/prints.js';

// print_status -> label, tone, icon
export const panel = true;   // on a page: its own glass panel (core/layout.js)

const STATUS = {
  running: ['Printing', 'lamp', 'printer-3d-nozzle'], prepare: ['Preparing', 'lamp', 'printer-3d-nozzle-heat'], slicing: ['Slicing', 'lamp', 'printer-3d-nozzle-heat'],
  init: ['Starting', 'lamp', 'printer-3d-nozzle-heat'], pause: ['Paused', 'plum', 'pause-circle'], finish: ['Finished', 'sage', 'check-circle'],
  failed: ['Failed', 'ember', 'alert-octagon'], idle: ['Ready', 'sage', 'check-circle'], unknown: ['No status', 'stone', 'help-circle-outline'], offline: ['Offline', 'stone', 'cloud-off-outline'],
};
const ACTIVE = ['running', 'prepare', 'slicing', 'init', 'pause'];
// stage names that read badly through cap()
const STAGE = { m400_pause: 'Paused (G-code)', paused_user: 'Paused', paused_user_gcode: 'Paused (G-code)', check_plaform: 'Checking platform',
  heatbed_preheating: 'Preheating bed', heated_bedcooling: 'Cooling bed', auto_bed_leveling: 'Auto bed levelling', bed_level_phase_1: 'Bed levelling',
  bed_level_phase_2: 'Bed levelling', bed_level_high_temperature: 'Bed levelling (hot)', active_arc_fitting: 'Arc fitting', idle: '' };
const stageText = (s) => (s == null || s === 'unknown' || s === 'offline' ? '' : STAGE[s] != null ? STAGE[s] : cap(s).replace(/\bams\b/i, 'AMS'));
const val = (id) => { const e = st(id); return !e || ['unknown', 'unavailable', ''].includes(e.state) ? null : e.state; };
const n = (id) => { const v = parseFloat(val(id)); return isNaN(v) ? null : v; };
export const dur = (hours) => { if (hours == null || hours <= 0) return '–'; const m = Math.round(hours * 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}`; };
const ago = (t) => { const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
// "#161616FF" -> "#161616"; fully transparent = no colour
export const hex = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}/i.test(c) && !/00$/i.test(c.slice(7, 9)) ? c.slice(0, 7) : null);

export default function printJob(cfg) {
  const P = cfg.printer, C = P.controls || {};
  const el = h(`<div class="pjob">
    <div class="hh"><span class="ic on">${icon(P.icon || 'printer-3d')}</span><span class="tx"><span class="hname pj-title"></span><span class="sub pj-stage"></span></span><span class="hbadge pj-badge"></span></div>
    <div class="pj-pic" hidden></div>
    <div class="pj-mbox"><img class="pj-model" alt="" hidden><div class="pj-none">${icon('cube-outline')}<span>No model yet</span></div><span class="pj-tag">${icon('cube-outline')}Model</span></div>
    <div class="pj-prog"><span class="pj-pct"></span><div class="pj-bar"><i></i></div><span class="pj-layer"></span></div>
    <div class="pj-stats">
      <div class="pj-st"><span class="pj-k">${icon('timer-sand')}Remaining</span><span class="pj-v pj-left"></span></div>
      <div class="pj-st"><span class="pj-k">${icon('flag-checkered')}Done at</span><span class="pj-v pj-end"></span></div>
      <div class="pj-st"><span class="pj-k">${icon('printer-3d-nozzle-outline')}Filament</span><span class="pj-v pj-fil"></span></div>
    </div>
    <div class="hctl pj-ctl">
      <button class="sb pj-light">${icon('lightbulb-outline')}<span>Light</span></button>
      <button class="sb pj-rec" hidden><i class="pj-recdot"></i><span>Record</span></button>
      <button class="sb pj-prints">${icon('filmstrip-box-multiple')}<span>Prints</span><b class="pj-count" hidden></b></button>
      <button class="sb pj-pause" hidden>${icon('pause')}<span>Pause</span></button>
      <button class="sb pj-resume" hidden>${icon('play')}<span>Resume</span></button>
      <button class="sb pj-stop" hidden>${icon('stop')}<span>Stop</span></button>
    </div></div>`);
  const $ = (s) => el.querySelector(s);
  const title = $('.pj-title'), stage = $('.pj-stage'), badge = $('.pj-badge');
  const model = $('.pj-model'), none = $('.pj-none'), picBox = $('.pj-pic');
  const pct = $('.pj-pct'), bar = $('.pj-bar i'), layer = $('.pj-layer'), left = $('.pj-left'), end = $('.pj-end'), fil = $('.pj-fil');
  const bLight = $('.pj-light'), bPause = $('.pj-pause'), bResume = $('.pj-resume'), bStop = $('.pj-stop');
  const status = () => val(P.status) || (st(P.online) && st(P.online).state === 'off' ? 'offline' : st(P.status) ? 'unknown' : 'idle');

  // ---- header, progress, numbers ----
  const draw = () => {
    const s = status(), [label, tone, ic] = STATUS[s] || [cap(s), 'stone', 'printer-3d'], active = ACTIVE.includes(s);
    el.style.setProperty('--t', `var(--${tone})`); el.classList.toggle('active', active);
    setHTML(el.querySelector('.hh .ic'), icon(ic));
    setHTML(badge, `${icon(STATUS[s] ? STATUS[s][2] : 'information-outline')}<span>${esc(label)}</span>`);
    const task = val(P.task);
    setText(title, task || (s === 'offline' ? 'Printer offline' : active ? 'Printing' : 'Nothing printing'));
    const cov = st(P.cover), door = st(P.door);
    const sub = active ? stageText(val(P.stage)) || label
      : s === 'finish' || s === 'failed' ? `${label}${val(P.end) ? ' ' + hm(val(P.end), true) : ''}`
      : [cov && cov.state && !isNaN(new Date(cov.state)) ? 'Last model ' + ago(cov.state) : '', door && door.state === 'on' ? 'Door open' : ''].filter(Boolean).join(' · ') || 'Ready';
    setText(stage, sub);

    const p = active || s === 'finish' ? Math.max(0, Math.min(100, n(P.progress) || 0)) : 0;
    setHTML(pct, active || s === 'finish' ? `${Math.round(p)}<small>%</small>` : '–');
    bar.style.width = p + '%';
    const L = n(P.layer), T = n(P.layers);
    setText(layer, T ? `Layer ${L || 0} of ${T}` : active ? 'Layer –' : 'No job');
    setText(left, active ? dur(n(P.remaining)) : '–');
    const e = val(P.end); setText(end, active && e && !isNaN(new Date(e)) ? hm(e, true) : '–');
    // filament this job uses, with a dot per tray in the tray's colour
    const w = n(P.weight), lm = n(P.length), wa = (st(P.weight) || {}).attributes || {};
    const dots = Object.keys(wa).map((k) => { const m = /AMS\s*(\d+)\s*Tray\s*(\d+)/i.exec(k); if (!m) return /external/i.test(k) ? P.external && P.external.entity : null; return P.ams && +m[1] === 1 ? P.ams.trays[+m[2] - 1] : null; })
      .filter(Boolean).map((id) => hex((st(id) || {}).attributes && st(id).attributes.color)).filter(Boolean);
    const showFil = (active || s === 'finish') && w;
    setHTML(fil, showFil ? `${dots.map((c) => `<i class="pj-dot" style="--c:${c}"></i>`).join('')}${Math.round(w)} g${lm ? ` · ${lm.toFixed(1)} m` : ''}` : '–');
  };
  watch([P.status, P.stage, P.progress, P.task, P.layer, P.layers, P.remaining, P.end, P.weight, P.length, P.online, P.cover, P.door, ...(P.ams ? P.ams.trays : [])], draw);
  tick(draw);   // "x min ago"

  // ---- pictures: live camera (the standard camera tile) + the model ----
  const CAM = P.camera && P.camera.entity;
  if (CAM) picBox.appendChild(camera({ ...P.camera, name: '' }));
  const pic = () => {
    // Frigate camera off (printer powered off: the job automation disables it) = 'idle': no tile, the model takes the space
    const e = CAM && st(CAM), ok = !!e && ['streaming', 'recording'].includes(e.state);
    picBox.hidden = !ok; el.classList.toggle('hascam', ok);
    const cov = st(P.cover), u = cov && cov.attributes.entity_picture;
    const mu = u ? origin + u + (u.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(cov.state || '') : '';
    if (mu && model.getAttribute('src') !== mu) { model.hidden = false; none.hidden = true; model.src = mu; }
    if (!mu) { model.hidden = true; none.hidden = false; }
  };
  model.onerror = () => { model.hidden = true; none.hidden = false; };
  watch([CAM, P.cover].filter(Boolean), pic);

  // ---- controls ----
  bLight.hidden = !P.light;
  watch([P.light], () => { const on = (st(P.light) || {}).state === 'on'; bLight.classList.toggle('on', on); bLight.style.setProperty('--t', 'var(--lamp)'); setHTML(bLight, `${icon(on ? 'lightbulb-on' : 'lightbulb-outline')}<span>Light</span>`); });
  bLight.addEventListener('click', (ev) => run('toggle', { el: bLight, ev, entity: P.light }));
  bPause.addEventListener('click', (ev) => run({ call: 'button.press', target: C.pause }, { el: bPause, ev }));
  bResume.addEventListener('click', (ev) => run({ call: 'button.press', target: C.resume }, { el: bResume, ev }));
  bStop.addEventListener('click', (ev) => run({ call: 'button.press', target: C.stop, confirm: { title: 'Stop this print?', text: 'It can’t be resumed.', ok: 'Stop', icon: 'stop' } }, { el: bStop, ev }));
  const ctl = () => {
    const s = status(), has = (id) => !!id && !!st(id);
    bPause.hidden = !(has(C.pause) && ['running', 'prepare'].includes(s));
    bResume.hidden = !(has(C.resume) && s === 'pause');
    bStop.hidden = !(has(C.stop) && ACTIVE.includes(s));
  };
  watch([P.status, C.pause, C.resume, C.stop].filter(Boolean), ctl);

  // ---- saving prints ----
  const R = P.rec, bRec = $('.pj-rec'), bPrints = $('.pj-prints'), count = $('.pj-count');
  if (R) {
    watch([P.status, R.save], () => {
      const active = ACTIVE.includes(status()), marked = (st(R.save) || {}).state === 'on';
      bRec.hidden = !active;
      bRec.classList.toggle('on', marked); bRec.style.setProperty('--t', 'var(--ember)');
      setText(bRec.querySelector('span'), marked ? 'Saving when done' : 'Record');
    });
    bRec.addEventListener('click', (ev) => run('toggle', { el: bRec, ev, entity: R.save }));
    bPrints.addEventListener('click', () => { location.hash = '#prints'; });
    // badge: finished prints in the buffer that aren't saved (refreshed when a job ends or is saved, and every 10 minutes)
    const badge = () => load(R, false, P.status).then((d) => { const n = d.jobs.filter((j) => !j.saved && !j.open).length; count.hidden = !n; setText(count, String(n)); }).catch(() => {});
    watch([R.ended, R.saved], () => { invalidate(); badge(); });
    setInterval(() => { invalidate(); badge(); }, 600000);
  } else bPrints.hidden = true;
  return el;
}
