// 3D prints pop-up: a player and the list of prints. Two lists:
//   Not saved — every print still in Frigate's printer buffer (7 days), oldest ones flagged as they near deletion. Play it,
//               Save it (rec.script: real speed + timelapse exports, kept until deleted), or Download it.
//   Saved     — the Frigate exports. Real speed plays from the recordings while they're still in the buffer; older ones and the
//               timelapses play from the exports folder once it's reachable from HA (`rec.media`, a media-source path), else
//               they open in Frigate.
// { type: 'prints', printer: H.printer }   (printer.rec: started, ended, name, save script, buffer_days, frigate, media)
import { h, esc, icon, setText } from '../core/dom.js';
import { request } from '../core/ha.js';
import { run } from '../core/actions.js';
import { watch } from '../core/store.js';
import { sign, vodPath, clipPath, playHls, instance, fmtTime, fmtDay } from '../core/frigate.js';
import { load, savedPairs, invalidate } from '../core/prints.js';

const dur = (s) => { const m = Math.round(s / 60); return m < 60 ? `${Math.max(1, m)} min` : `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}`; };
const bare = (n) => String(n || '').replace(/\s+–\s+[A-Z][a-z]{2} \d{1,2} \d{1,2}:\d{2} [AP]M.*$/, '').replace(/\s*\(timelapse\)$/, '') || '3D print';

export default function prints(cfg) {
  const P = cfg.printer, R = P.rec, CAM = P.camera.entity, cam = CAM.split('.')[1];
  const el = h(`<div class="prints">
    <div class="prpl"><div class="fpvid prvid"><video playsinline controls muted></video><div class="fpmsg" hidden></div>
      <div class="prnone">${icon('printer-3d-nozzle-outline')}<span>Pick a print to play it</span></div></div>
      <div class="fpinfo"><div class="fptx"><b></b><span class="sub"></span></div><div class="fpbtns"></div></div></div>
    <div class="prls"><div class="prtabs"><button class="chip" data-t="new"></button><button class="chip" data-t="saved"></button><button class="rbtn prref" title="Refresh">${icon('refresh')}</button></div>
      <div class="prnote" hidden></div><div class="rvlist prlist"></div></div></div>`);
  el.style.setProperty('--ratio', (P.camera.ratio || '16/9'));
  const video = el.querySelector('video'), msg = el.querySelector('.fpmsg'), none = el.querySelector('.prnone');
  const title = el.querySelector('.fptx b'), sub = el.querySelector('.fptx .sub'), btns = el.querySelector('.fpbtns');
  const listEl = el.querySelector('.prlist'), note = el.querySelector('.prnote'), tabs = [...el.querySelectorAll('.prtabs .chip')];
  const inst = () => instance(CAM);
  let data = null, tab = 'new', cur = null, stop = null, open = false, gen = 0;

  // every pick or close bumps gen: a sign or file lookup still on its way sees that and drops out
  const halt = () => { gen++; if (stop) stop(); stop = null; };
  const fail = (m) => { msg.hidden = false; msg.textContent = m || 'Recording not available.'; };
  const inBuffer = (end) => end > Date.now() / 1000 - (R.buffer_days || 7) * 86400 + 60;
  const playRange = (s, e) => { halt(); msg.hidden = true; none.hidden = true; const g = gen;
    sign(vodPath(inst(), cam, s, e), 4).then((u) => { if (g === gen && open) stop = playHls(video, u, { onError: () => fail() }); }).catch(() => fail()); };
  const playFile = async (x) => {
    halt(); msg.hidden = true; none.hidden = true; const g = gen;
    if (!R.media) { fail('Timelapses and prints older than the buffer play in Frigate (Open in Frigate).'); return; }
    try { const r = await request({ type: 'media_source/resolve_media', media_content_id: `${R.media}/${x.file}`, expires: 4 * 3600 });
      if (g !== gen || !open) return;
      video.src = r.url.startsWith('http') ? r.url : location.origin + r.url; video.play().catch(() => {}); stop = () => { video.removeAttribute('src'); video.load(); };
    } catch (e) { if (g === gen) fail("Couldn't open the saved file."); }
  };

  // ---- the player's header and buttons for the picked print ----
  // keepPlaying: new details for the print already on screen; the player and its position stay
  const showJob = (j, keepPlaying) => {
    const pick = cur = { kind: 'job', j }; setText(title, j.name); setText(sub, `${fmtDay(j.start)} ${fmtTime(j.start)}${j.lost ? ' · end not recorded' : ' · ' + dur(j.end - j.start)}${j.open ? ' · printing now' : ''}`);
    btns.innerHTML = (j.open ? '' : j.saved ? `<span class="sb on prok">${icon('check-circle')}<span>Saved</span></span>`
      : `<button class="sb prsave" data-a="save">${icon('content-save-outline')}<span>Save</span></button>`)
      + `<a class="sb" data-a="dl" target="_blank" rel="noopener">${icon('download')}<span>Download</span></a>`;
    sign(clipPath(inst(), cam, j.start - 15, j.end + 15), 1).then((u) => { const a = btns.querySelector('[data-a="dl"]'); if (a && cur === pick) { a.href = u; a.download = `${bare(j.name)}-${new Date(j.start * 1000).toISOString().slice(0, 16).replace(/:/g, '')}.mp4`; } });
    if (!keepPlaying) playRange(j.start - 15, j.end + 15);
    mark();
  };
  const showSaved = (p, which) => {
    cur = { kind: 'saved', p, which }; setText(title, bare(p.name)); setText(sub, `${fmtDay(p.start + 15)} ${fmtTime(p.start + 15)} · ${dur(p.end - p.start)} · saved`);
    const fr = R.frigate ? `<a class="sb" href="${esc(R.frigate)}/export" target="_blank" rel="noopener">${icon('open-in-new')}<span>Open in Frigate</span></a>` : '';
    btns.innerHTML = `<div class="seg prseg">${p.real ? `<button class="sb${which === 'real' ? ' on' : ''}" data-a="real"><span>Real speed</span></button>` : ''}${p.timelapse ? `<button class="sb${which === 'tl' ? ' on' : ''}" data-a="tl"><span>Timelapse</span></button>` : ''}</div>${fr}`;
    const x = which === 'tl' ? p.timelapse : p.real;
    if (which === 'real' && inBuffer(p.end) && !R.mediaFirst) playRange(p.start, p.end); else playFile(x);
    mark();
  };

  // ---- lists ----
  const row = (key, th, name, line, meta, cls = '') => `<button class="rvi pri ${cls}" data-k="${key}"><span class="rvth prth">${th}</span>
    <span class="rvtx"><b>${esc(name)}</b><span>${esc(line)}</span></span><span class="prmeta">${meta}</span></button>`;
  const draw = () => {
    if (!data) { listEl.innerHTML = '<div class="rvempty">Loading prints…</div>'; return; }
    const unsaved = data.jobs.filter((j) => !j.saved), pairs = savedPairs(data.exports);
    setText(tabs[0], `Not saved · ${unsaved.length}`); setText(tabs[1], `Saved · ${pairs.length}`);
    tabs.forEach((t) => t.classList.toggle('on', t.dataset.t === tab));
    note.hidden = data.exportsOk && data.historyOk; if (!data.historyOk) note.textContent = 'Can\'t read the print history right now, so this list may be incomplete.'; else if (!data.exportsOk) note.textContent = `Can't read the saved prints from Frigate right now${data.error ? ' (' + data.error + ')' : ''}, so prints show as not saved.`;
    const days = R.buffer_days || 7, nowS = Date.now() / 1000;
    if (tab === 'new') {
      listEl.innerHTML = unsaved.length ? unsaved.map((j, i) => {
        const left = (j.end + days * 86400 - nowS) / 86400, soon = left < 1.5;
        const meta = j.open ? `<span class="prtag live">${icon('record-circle-outline')}Printing</span>` : `<span class="prtag${soon ? ' soon' : ''}">${left < 1 ? Math.max(1, Math.round(left * 24)) + ' h left' : Math.round(left) + ' d left'}</span>`;
        return row('j' + data.jobs.indexOf(j), `${icon('printer-3d-nozzle-outline')}<i>${dur(j.end - j.start)}</i>`, j.name, `${fmtDay(j.start)} · ${fmtTime(j.start)}`, meta);
      }).join('') : `<div class="rvempty">${data.jobs.length ? `Every print from the last ${days} days is saved.` : `No prints in the last ${days} days.`}</div>`;
    } else {
      listEl.innerHTML = pairs.length ? pairs.map((p, i) => row('s' + i, `<img alt="">${p.timelapse ? '<i>TL</i>' : ''}`, bare(p.name), `${fmtDay(p.start + 15)} · ${fmtTime(p.start + 15)} · ${dur(p.end - p.start)}`,
        `<span class="prtag ok">${icon('check-circle')}Saved</span>`)).join('') : '<div class="rvempty">No saved prints yet.</div>';
      pairs.forEach((p, i) => { const x = p.real || p.timelapse; if (!x || !x.thumb) return; sign(`/api/frigate/${inst()}/clips/${x.thumb}`, 4).then((u) => { const im = listEl.querySelector(`[data-k="s${i}"] img`); if (im) im.src = u; }).catch(() => {}); });
      el._pairs = pairs;
    }
    mark();
  };
  const mark = () => listEl.querySelectorAll('.pri').forEach((b) => {
    const k = b.dataset.k; b.classList.toggle('sel', !!cur && ((cur.kind === 'job' && k === 'j' + data.jobs.indexOf(cur.j)) || (cur.kind === 'saved' && el._pairs && k === 's' + el._pairs.indexOf(cur.p))));
  });
  const refresh = (force) => load(R, force, P.status).then((d) => { data = d; draw(); }).catch(() => { listEl.innerHTML = '<div class="rvempty">Couldn\'t load the prints.</div>'; });

  el.addEventListener('click', (ev) => {
    const t = ev.target.closest('.prtabs .chip'); if (t) { tab = t.dataset.t; draw(); return; }
    if (ev.target.closest('.prref')) { invalidate(); refresh(true); return; }
    const r = ev.target.closest('.pri');
    if (r) { const k = r.dataset.k; if (k[0] === 'j') showJob(data.jobs[+k.slice(1)]); else showSaved(el._pairs[+k.slice(1)], el._pairs[+k.slice(1)].real ? 'real' : 'tl'); return; }
    const b = ev.target.closest('.fpbtns [data-a]'); if (!b || !cur) return;
    const a = b.dataset.a;
    if (a === 'save' && cur.kind === 'job') {
      const j = cur.j; if (b.disabled) return; b.disabled = true; b.innerHTML = `${icon('content-save-outline')}<span>Saving…</span>`;
      run({ call: 'script.turn_on', target: R.script, data: { variables: { start: j.start, end: j.end, name: j.name } } }, { el: b, ev });
      // exports take a few seconds to appear (the timelapse longer); refresh twice
      // the button stays on Saving… until the export is listed, so a second tap can't start a second export
      const settle = () => refresh(true).then(() => { if (cur && cur.kind === 'job' && Math.abs(cur.j.start - j.start) < 2) { const n = data.jobs.find((x) => Math.abs(x.start - j.start) < 2); if (n && n.saved) showJob(n, true); } });
      setTimeout(() => { invalidate(); settle(); }, 6000);
      setTimeout(() => { invalidate(); settle(); }, 30000);
    }
    if ((a === 'real' || a === 'tl') && cur.kind === 'saved') showSaved(cur.p, a);
  });

  // open = on screen (the pop-up is shown); stop playback when it closes
  new IntersectionObserver((en) => { const v = en[en.length - 1].isIntersecting;
    if (v && !open) { open = true; refresh(); } else if (!v && open) { open = false; halt(); } }).observe(el);
  watch([R.ended, R.saved], () => { invalidate(); if (open) refresh(true); });
  draw();
  return el;
}
