// Running timers with controls (−/+1 min, pause/resume, cancel), quick-start presets, and the last finished timer.
// { type: 'timer-list', count: 8, prefix: 'voice_timer', last: 'input_text.voice_timer_last_ended', start: 'script.x', presets: [60, 300, 600, 900] }
import { h, icon, setHTML, setText, toggle, mmss, hm } from '../core/dom.js';
import { st, watch, tick } from '../core/store.js';
import { run } from '../core/actions.js';

// 'H:MM:SS' as seconds; null when it isn't a time
export const secs = (hms) => { const p = String(hms == null ? '' : hms).split(':').map(Number); return p.length === 3 && !p.some(isNaN) ? p[0] * 3600 + p[1] * 60 + p[2] : null; };
// seconds left on a timer (null: the entity doesn't say)
export function left(e, now = Date.now()) {
  if (e.state === 'active' && e.attributes.finishes_at) { const t = (new Date(e.attributes.finishes_at) - now) / 1000; if (!isNaN(t)) return t; }
  return secs(e.attributes.remaining);
}
// what a running timer's row shows: e = the timer, l = its label helper
export function rowOf(e, l, now) {
  const total = secs(e.attributes.duration) || 1, lv = left(e, now);
  return { paused: e.state === 'paused', pct: lv == null ? 0 : Math.max(0, Math.min(100, (lv / total) * 100)), time: lv == null ? '—' : mmss(lv),
    label: l && l.state && !['unknown', 'unavailable', ''].includes(l.state) ? l.state : 'Timer' };
}

export default function timerList(cfg) {
  const n = cfg.count || 8, pre = cfg.prefix || 'voice_timer';
  const slots = Array.from({ length: n }, (_, i) => ({ t: `timer.${pre}_${i + 1}`, l: `input_text.${pre}_${i + 1}_label` }));
  const presets = cfg.presets || [60, 300, 600, 900, 1800];
  const el = h(`<div class="timerlist"><div class="tlist"><div class="anone">No timers running. Start one below, or ask the voice assistant.</div></div><div class="label">Start a timer</div>
    <div class="tpresets">${presets.map((s) => `<button class="chip" data-s="${s}">${s < 60 ? s + ' sec' : s / 60 + ' min'}</button>`).join('')}</div><div class="sub tlast"></div></div>`);
  const list = el.querySelector('.tlist'), none = el.querySelector('.anone'), last = el.querySelector('.tlast');
  // One row per running timer, made when the timer starts and kept until it ends: every second only its time and bar
  // change, so a button that has the remote's focus (or a finger on it) is still the same button after the tick.
  const rows = new Map();   // timer id -> { el, bar, name, time, pause }
  const make = (id, v) => {
    const r = h(`<div class="trow" data-t="${id}"><div class="tbar" style="width:${v.pct}%"></div>
      <div class="tx"><div class="name"></div><div class="tleft"></div></div>
      <button class="sb" data-a="sub">−1m</button><button class="sb" data-a="add">+1m</button>
      <button class="sb" data-a="pause" aria-label="Pause"></button><button class="sb" data-a="cancel" aria-label="Cancel">${icon('close')}</button></div>`);
    return { el: r, bar: r.querySelector('.tbar'), name: r.querySelector('.name'), time: r.querySelector('.tleft'), pause: r.querySelector('[data-a="pause"]') };
  };
  const draw = () => {
    const now = Date.now(), run_ = slots.map((s) => ({ s, e: st(s.t), l: st(s.l) })).filter((x) => x.e && ['active', 'paused'].includes(x.e.state));
    rows.forEach((r, id) => { if (!run_.some((x) => x.s.t === id)) { r.el.remove(); rows.delete(id); } });
    let prev = none;
    run_.forEach((x) => {
      const v = rowOf(x.e, x.l, now); let r = rows.get(x.s.t);
      if (!r) { r = make(x.s.t, v); rows.set(x.s.t, r); list.insertBefore(r.el, prev.nextSibling); }   // in slot order; the rows already there are not moved
      toggle(r.el, 'paused', v.paused); r.bar.style.width = v.pct + '%';
      setText(r.name, v.label); setText(r.time, v.time); setHTML(r.pause, icon(v.paused ? 'play' : 'pause')); r.pause.setAttribute('aria-label', v.paused ? 'Resume' : 'Pause');
      prev = r.el;
    });
    none.hidden = run_.length > 0;
    try { const j = JSON.parse((st(cfg.last) || {}).state); const t = typeof j.t === 'number' && j.t < 1e11 ? j.t : new Date(j.t).getTime() / 1000; last.textContent = j.l ? `Last finished: ${j.l}${t ? ', ' + hm(t, true) : ''}` : ''; } catch (e) { last.textContent = ''; }
  };
  watch(slots.flatMap((s) => [s.t, s.l]).concat([cfg.last]), draw);
  tick(() => { if (el.isConnected && el.offsetParent && slots.some((s) => (st(s.t) || {}).state === 'active')) draw(); });
  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.s) { run({ call: cfg.start, target: null, data: { seconds: +b.dataset.s, label: '' } }, { el: b, ev }); return; }
    const row = b.closest('.trow'); if (!row) return; const id = row.dataset.t, e = st(id), a = b.dataset.a; if (!e) return;
    if (a === 'cancel') run({ call: 'timer.cancel' }, { el: b, ev, entity: id });
    if (a === 'pause') run({ call: e.state === 'paused' ? 'timer.start' : 'timer.pause' }, { el: b, ev, entity: id });
    if (a === 'add') run({ call: 'timer.change', data: { duration: '00:01:00' } }, { el: b, ev, entity: id });
    if (a === 'sub') run({ call: 'timer.change', data: { duration: '-00:01:00' } }, { el: b, ev, entity: id });
  });
  return el;
}
