// Frigate events (review items) newest first, grouped by day: thumbnail, camera, what was seen, time and length.
// Chips: Alerts / All, and one per camera. Tap an event = play it (#review pop-up), with previous/next through this list.
// Refreshes when any camera's review status changes (Frigate pushes it), and every 2 minutes while on screen.
// { type: 'reviews', cameras: [{ entity, name }], review: (id) => `sensor.${id}_review_status`, limit: 60, nav: '#review' }
// compact: { title: 'Alerts', more: { drawer: 'events' } } -> a narrow column: alerts only, no chips, slim rows (small
//   thumbnail, what + camera · time); `more` (any action) is a button in its header, e.g. to open the full list in a drawer
import { h, esc, icon, toggle, setHTML } from '../core/dom.js';
import { run } from '../core/actions.js';
import { watch } from '../core/store.js';
import { onReady } from '../core/ha.js';
import { instance, camId, getReviews, sign, thumbPath, select, sel, fmtTime, fmtDay, fmtDur, labels } from '../core/frigate.js';

export const panel = true;   // on a page: its own glass panel (core/layout.js)

export default function reviews(cfg) {
  const cams = cfg.cameras.map((c) => ({ ...c, id: camId(c.entity) }));
  const names = Object.fromEntries(cams.map((c) => [c.id, c.name]));
  const inst = () => instance(cams[0].entity);
  let sev = 'alert', cam = null, list = [], prev = null, visible = false, t = 0, loading = 0, failed = false, seq = 0;
  const C = cfg.compact;
  const el = h(C ? `<div class="reviews compact"><div class="rvhead"><b>${esc(C.title || 'Alerts')}</b>${C.more ? `<button class="rbtn rvmore">${icon(C.icon || 'filmstrip-box-multiple')}</button>` : ''}</div><div class="rvlist"></div></div>` : `<div class="reviews">
    <div class="rvf"><button class="chip" data-sev="alert">${icon('alert-circle-outline')}Alerts</button><button class="chip" data-sev="">${icon('format-list-bulleted')}All</button></div>
    <div class="rvc"><button class="chip on" data-cam="">All cameras</button>${cams.map((c) => `<button class="chip" data-cam="${c.id}">${esc(c.name)}</button>`).join('')}</div>
    <div class="rvlist"></div></div>`);
  el.style.setProperty('--t', 'var(--mist)');
  const box = el.querySelector('.rvlist');

  const draw = () => {
    [...el.querySelectorAll('.rvf .chip')].forEach((c) => toggle(c, 'on', c.dataset.sev === sev));
    [...el.querySelectorAll('.rvc .chip')].forEach((c) => toggle(c, 'on', c.dataset.cam === (cam || '')));
    if (!list.length) { setHTML(box, `<div class="rvempty">${loading ? 'Loading…' : failed ? 'Couldn’t load events.' : sev ? 'No alerts this week.' : 'Nothing recorded yet.'}</div>`); return; }
    let day = '', html = '';
    list.forEach((r, i) => {
      const d = fmtDay(r.start_time); if (d !== day) { day = d; html += `<div class="rvday">${esc(d)}</div>`; }
      const len = (r.end_time || Date.now() / 1000) - r.start_time;
      html += C ? `<button class="rvi slim${r.has_been_reviewed ? '' : ' new'}" data-i="${i}">
        <span class="rvth"><img data-id="${esc(r.id)}" alt=""></span>
        <span class="rvtx"><b>${esc(labels(r))}</b><span>${esc(names[r.camera] || r.camera)}</span><span>${r.end_time ? fmtTime(r.start_time) : 'Now'}</span></span></button>` : `<button class="rvi${r.has_been_reviewed ? '' : ' new'}${r.severity === 'alert' ? ' alert' : ''}" data-i="${i}">
        <span class="rvth"><img data-id="${esc(r.id)}" alt=""></span>
        <span class="rvtx"><b>${esc(labels(r))}</b><span>${esc(names[r.camera] || r.camera)}</span><span class="sub">${fmtTime(r.start_time)} · ${r.end_time ? fmtDur(len) : 'Now'}</span></span></button>`;
    });
    box.__h = null; box.innerHTML = html;
    const ins = inst();
    box.querySelectorAll('img[data-id]').forEach((img) => { const r = list.find((x) => x.id === img.dataset.id); sign(thumbPath(ins, r), 12).then((u) => { img.src = u; }).catch(() => {}); });
  };

  const load = () => {
    clearTimeout(t); t = setTimeout(load, 120e3);
    if (!visible) return;
    loading++; if (!list.length) draw();
    const my = ++seq;
    const after = Date.now() / 1000 - 7 * 86400;
    getReviews(inst(), { after, limit: cfg.limit || 60, ...(sev ? { severity: sev } : {}), ...(cam ? { cameras: [cam] } : {}) })
      .then((r) => { if (my !== seq) return; failed = false; list = (r || []).filter((x) => names[x.camera]).sort((a, b) => b.start_time - a.start_time); })
      .catch(() => { if (my === seq) failed = true; }).finally(() => { loading--; draw();
        // an open event keeps playing: the selection follows its id, not its old position in the list
        if (sel.list === prev) { const cur = prev && prev[sel.index], i = cur ? list.findIndex((x) => x.id === cur.id) : -1; if (!cur || i >= 0) { sel.list = list; if (cur) sel.index = i; } }
        prev = list; });
  };

  el.addEventListener('click', (ev) => {
    if (ev.target.closest('.rvmore')) { run(C.more, { el: ev.target.closest('.rvmore'), ev }); return; }
    const f = ev.target.closest('.rvf .chip'); if (f) { sev = f.dataset.sev; list = []; draw(); load(); return; }
    const c = ev.target.closest('.rvc .chip'); if (c) { cam = c.dataset.cam || null; list = []; draw(); load(); return; }
    const it = ev.target.closest('.rvi'); if (!it) return;
    // the player marks it reviewed in Frigate (frigate/reviews/viewed) when it plays; setting the flag here first made the
    // player think it was already reviewed, so Frigate was never told and the dot came back on the next refresh
    const i = +it.dataset.i; it.classList.remove('new');
    select({ list, index: i, inst: inst(), names }); prev = list;
    location.hash = cfg.nav || '#review';
  });
  watch(cams.map((c) => (cfg.review || ((id) => `sensor.${id}_review_status`))(c.id)), () => { clearTimeout(t); t = setTimeout(load, 1500); });
  new IntersectionObserver((en) => { const v = en[en.length - 1].isIntersecting; if (v && !visible) { visible = true; load(); } visible = v; }).observe(el);
  onReady(() => { if (visible) load(); });
  draw();
  return el;
}
