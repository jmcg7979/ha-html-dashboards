// Frigate playback inside a pop-up (HLS from the recordings, through HA's Frigate proxy).
// mode 'review':     the event picked in the Events list: video of the event (a few seconds either side), ‹ › through the list,
//                    snapshot of the main object, open the recordings at that moment, download the clip. Opening marks it reviewed (like Frigate).
// mode 'recordings': one camera's recordings by day: a 24-hour strip (recorded hours, events as ticks, playhead); tap anywhere to play from there.
// { type: 'frigate-player', mode: 'review' | 'recordings', cameras: [{ entity, name, ratio }] }
import { h, esc, icon, toggle } from '../core/dom.js';
import { sel, select, instance, camId, vodPath, clipPath, snapshotPath, sign, playHls, markViewed, getReviews, getSummary, fmtTime, fmtDay, fmtDur, labels } from '../core/frigate.js';
import { timeOpts } from '../core/units.js';
import { openLink } from '../core/actions.js';

const PAD = 3;   // seconds before/after an event

export default function player(cfg) {
  const cams = cfg.cameras.map((c) => ({ ...c, id: camId(c.entity) }));
  const byId = Object.fromEntries(cams.map((c) => [c.id, c]));
  const rec = cfg.mode === 'recordings';
  const el = h(`<div class="fplayer ${rec ? 'rec' : 'rev'}">
    ${rec ? `<div class="fpcams">${cams.map((c) => `<button class="chip" data-cam="${c.id}">${esc(c.name)}</button>`).join('')}</div>` : ''}
    <div class="fpvid"><video playsinline controls muted></video><img class="fpsnap" alt="" hidden><div class="fpmsg" hidden></div></div>
    <div class="fpinfo"><div class="fptx"><b></b><span class="sub"></span></div><div class="fpbtns"></div></div>
    ${rec ? '<div class="fpday"><button class="rbtn" data-d="-1">' + icon('chevron-left') + '</button><b class="fpdl"></b><button class="rbtn" data-d="1">' + icon('chevron-right') + '</button><span class="sub fpnow"></span></div><div class="fpstrip"><div class="fphours"></div><div class="fpmarks"></div><div class="fphead"></div></div><div class="fpaxis"><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>12a</span></div>' : ''}
  </div>`);
  el.style.setProperty('--t', 'var(--mist)');
  const video = el.querySelector('video'), snap = el.querySelector('.fpsnap'), msg = el.querySelector('.fpmsg');
  const title = el.querySelector('.fptx b'), sub = el.querySelector('.fptx .sub'), btns = el.querySelector('.fpbtns');
  let stop = null, open = false, base = 0;   // base: wall-clock seconds at video time 0

  const fail = (m) => { msg.hidden = false; msg.textContent = /codec|incompatible|buffer/i.test(m || '') ? "This camera's recording format can't play on this screen." : 'Recording not available.'; };
  const play = (camera, start, end, at = 0) => {
    if (stop) stop(); stop = null; msg.hidden = true; snap.hidden = true; base = start;
    const c = byId[camera]; el.style.setProperty('--ratio', (c && c.ratio) || '16/9');
    const gen = (play.gen = (play.gen || 0) + 1);
    sign(vodPath(sel.inst, camera, start, end), 4).then((u) => { if (gen === play.gen && open) stop = playHls(video, u, { at, onError: fail }); }).catch(() => fail());
  };
  const halt = () => { play.gen = (play.gen || 0) + 1; if (stop) stop(); stop = null; };

  // ---------- one event ----------
  function showReview() {
    const r = sel.list[sel.index]; if (!r) return;
    const end = r.end_time || Date.now() / 1000;
    title.textContent = `${labels(r)} · ${sel.names[r.camera] || r.camera}`;
    sub.textContent = `${fmtDay(r.start_time)} ${fmtTime(r.start_time)} · ${r.end_time ? fmtDur(end - r.start_time) : 'still going'}${(r.data.zones || []).length ? ' · ' + r.data.zones.map((z) => z.replace(/_/g, ' ')).join(', ') : ''}`;
    btns.innerHTML = `<button class="sb" data-a="prev"${sel.index <= 0 ? ' disabled' : ''}>${icon('chevron-left')}<span>Newer</span></button>
      <button class="sb" data-a="next"${sel.index >= sel.list.length - 1 ? ' disabled' : ''}><span>Older</span>${icon('chevron-right')}</button>
      ${(r.data.detections || []).length ? `<button class="sb" data-a="snap">${icon('image-outline')}<span>Snapshot</span></button>` : ''}
      <button class="sb" data-a="rec">${icon('history')}<span>Recordings</span></button>
      <a class="sb" data-a="dl" target="_blank" rel="noopener">${icon('download')}<span>Download</span></a>`;
    sign(clipPath(sel.inst, r.camera, r.start_time - PAD, end + PAD), 1).then((u) => { const a = btns.querySelector('[data-a="dl"]'); if (a && sel.list[sel.index] === r) { a.href = u; a.download = `${r.camera}-${new Date(r.start_time * 1000).toISOString().slice(0, 19).replace(/:/g, '')}.mp4`; } });
    play(r.camera, r.start_time - PAD, end + PAD);
    if (!r.has_been_reviewed) { r.has_been_reviewed = true; markViewed(sel.inst, [r.id]); }
  }

  // ---------- recordings by day ----------
  let cam = null, day0 = 0, summary = {}, marks = [], sumFor = null, sumAt = 0;
  const midnight = (t) => { const d = new Date(t * 1000); d.setHours(0, 0, 0, 0); return d.getTime() / 1000; };
  // the strip shows a day by the clock, 24 hours wide; a clock-change day is 23 or 25 real hours, so positions go through the clock, not seconds
  const nextDay = (t) => { const d = new Date(t * 1000); d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); return d.getTime() / 1000; };
  const clockF = (t) => { const d = new Date(t * 1000); return (d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600) / 24; };
  const atClock = (f) => { const d = new Date(day0 * 1000), m = Math.round(f * 1440); d.setHours(Math.floor(m / 60), m % 60, 0, 0); return d.getTime() / 1000; };
  // a seek on its way: currentTime still says the old place, so a second tap counts from here
  let seekTo = null, seekT = 0;
  const go = (t) => { seekTo = t; clearTimeout(seekT); seekT = setTimeout(() => { seekTo = null; }, 5000); playAt(t); };
  const dayKey = (t) => { const d = new Date(t * 1000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  function drawStrip() {
    const hrs = (summary[dayKey(day0)] || {}).hours || [];
    const byH = Object.fromEntries(hrs.map((x) => [+x.hour, x]));
    const maxM = Math.max(1, ...hrs.map((x) => x.motion || 0));
    el.querySelector('.fphours').innerHTML = Array.from({ length: 24 }, (_, i) => { const x = byH[i];
      return `<span class="${x && x.duration > 0 ? 'has' : ''}" style="--m:${x ? (0.25 + 0.75 * (x.motion || 0) / maxM).toFixed(2) : 0};--cov:${x ? Math.min(1, x.duration / 3600).toFixed(2) : 0}"></span>`; }).join('');
    el.querySelector('.fpmarks').innerHTML = marks.map((r) => `<i class="${r.severity === 'alert' ? 'alert' : ''}" style="left:${(clockF(r.start_time) * 100).toFixed(2)}%"></i>`).join('');
    el.querySelector('.fpdl').textContent = fmtDay(day0 + 3600);
    el.querySelector('[data-d="1"]').disabled = nextDay(day0) > Date.now() / 1000;
    [...el.querySelectorAll('.fpcams .chip')].forEach((c) => toggle(c, 'on', c.dataset.cam === cam));
  }
  function loadDay() {
    const c = cam, d = day0;
    if (sumFor !== c || Date.now() - sumAt > 600000) { sumFor = c; sumAt = Date.now(); summary = {}; getSummary(sel.inst, c).then((s) => { if (sumFor === c) { (s || []).forEach((x) => { summary[x.day] = x; }); drawStrip(); } }).catch(() => { if (sumFor === c) sumFor = null; }); }
    marks = []; drawStrip();
    getReviews(sel.inst, { cameras: [c], after: d, before: nextDay(d), limit: 300 }).then((r) => { if (cam === c && day0 === d) { marks = r || []; drawStrip(); } }).catch(() => {});
  }
  function playAt(t) {
    const now = Date.now() / 1000; t = Math.max(day0, Math.min(t, now - 15));
    const start = Math.floor(t / 60) * 60;
    play(cam, start, Math.min(start + 3600, now), t - start);
    head(t);
  }
  function head(t) {
    const hd = el.querySelector('.fphead'); hd.hidden = !(t >= day0 && t < nextDay(day0)); hd.style.left = (clockF(t) * 100).toFixed(3) + '%';
    title.textContent = `${byId[cam] ? byId[cam].name : cam}`;
    sub.textContent = `${fmtDay(t)} · ${new Date(t * 1000).toLocaleTimeString([], timeOpts({ hour: 'numeric', minute: '2-digit', second: '2-digit' }))}`;
  }
  function showRecordings() {
    cam = sel.cam && byId[sel.cam] ? sel.cam : cam || cams[0].id;
    const t = sel.t || Date.now() / 1000 - 600;
    day0 = midnight(t);
    btns.innerHTML = `<button class="sb" data-a="back">${icon('rewind-10')}</button><button class="sb" data-a="fwd">${icon('fast-forward-10')}</button>
      <button class="sb" data-a="latest">${icon('skip-next')}<span>Latest</span></button><a class="sb" data-a="dl" target="_blank" rel="noopener">${icon('download')}<span>Download</span></a>`;
    loadDay(); playAt(t);
  }
  video.addEventListener('timeupdate', () => { if (rec && base) { head(base + video.currentTime); if (seekTo != null && Math.abs(base + video.currentTime - seekTo) < 3) seekTo = null; } });
  video.addEventListener('ended', () => { if (rec && base && base + video.currentTime < Date.now() / 1000 - 60) playAt(Math.max(base + video.currentTime + 1, base + 3600)); });   // keep going into the next hour; a gap in the footage can't send it back

  const show = () => { open = true; if (rec) showRecordings(); else showReview(); };
  window.addEventListener('frigate:sel', () => { if (open) show(); });
  new IntersectionObserver((en) => { const v = en[en.length - 1].isIntersecting; if (v && !open) show(); else if (!v && open) { open = false; halt(); } }).observe(el);

  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-a]');
    if (b) {
      const a = b.dataset.a;
      if (a === 'prev' || a === 'next') { sel.index += a === 'next' ? 1 : -1; showReview(); }
      else if (a === 'snap') { const r = sel.list[sel.index]; if (!snap.hidden) { snap.hidden = true; video.play(); return; }
        video.pause(); sign(snapshotPath(sel.inst, r.data.detections[0]), 1).then((u) => { snap.src = u; snap.hidden = false; }); }
      else if (a === 'rec') { const r = sel.list[sel.index]; select({ cam: r.camera, t: r.start_time - PAD }); location.hash = '#recordings'; }
      else if (a === 'back' || a === 'fwd') { if (base) go((seekTo != null ? seekTo : base + video.currentTime) + (a === 'fwd' ? 10 : -10)); }
      else if (a === 'latest') { day0 = midnight(Date.now() / 1000); loadDay(); playAt(Date.now() / 1000 - 60); }
      else if (a === 'dl') { const t = base + video.currentTime; if (rec && cam) { ev.preventDefault(); sign(clipPath(sel.inst, cam, t - 30, t + 30), 1).then((u) => openLink(u)); } }
      return;
    }
    const c = ev.target.closest('.fpcams .chip'); if (c) { const t = seekTo != null ? seekTo : base + video.currentTime; cam = c.dataset.cam; sel.cam = cam; loadDay(); playAt(t || Date.now() / 1000 - 600); return; }
    const d = ev.target.closest('.fpday [data-d]'); if (d) { day0 += +d.dataset.d * 86400; day0 = midnight(day0 + 7200); loadDay(); playAt(day0 + (+d.dataset.d < 0 ? 12 * 3600 : 0)); return; }
    const s = ev.target.closest('.fpstrip'); if (s) { const r = s.getBoundingClientRect(); playAt(atClock((ev.clientX - r.left) / r.width)); }
  });
  return el;
}
