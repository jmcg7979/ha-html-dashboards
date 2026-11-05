// Running timers with controls (−/+1 min, pause/resume, cancel), quick-start presets, and the last finished timer.
// { type: 'timer-list', count: 8, prefix: 'voice_timer', last: 'input_text.voice_timer_last_ended', start: 'script.x', presets: [60, 300, 600, 900] }
import { h, esc, icon, setHTML, mmss, hm } from '../core/dom.js';
import { st, watch, tick } from '../core/store.js';
import { run } from '../core/actions.js';

const secs = (hms) => { const p = String(hms || '').split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : NaN; };

export default function timerList(cfg) {
  const n = cfg.count || 8, pre = cfg.prefix || 'voice_timer';
  const slots = Array.from({ length: n }, (_, i) => ({ t: `timer.${pre}_${i + 1}`, l: `input_text.${pre}_${i + 1}_label` }));
  const presets = cfg.presets || [60, 300, 600, 900, 1800];
  const el = h(`<div class="timerlist"><div class="tlist"></div><div class="label">Start a timer</div>
    <div class="tpresets">${presets.map((s) => `<button class="chip" data-s="${s}">${s < 60 ? s + ' sec' : s / 60 + ' min'}</button>`).join('')}</div><div class="sub tlast"></div></div>`);
  const list = el.querySelector('.tlist'), last = el.querySelector('.tlast');
  const left = (e) => (e.state === 'active' && e.attributes.finishes_at ? (new Date(e.attributes.finishes_at) - Date.now()) / 1000 : secs(e.attributes.remaining));
  const draw = () => {
    const run_ = slots.map((s) => ({ s, e: st(s.t), l: st(s.l) })).filter((x) => x.e && ['active', 'paused'].includes(x.e.state));
    setHTML(list, run_.length ? run_.map((x) => {
      const total = secs(x.e.attributes.duration) || 1, lv = left(x.e), pct = Math.max(0, Math.min(100, (lv / total) * 100));
      const label = x.l && x.l.state && !['unknown', ''].includes(x.l.state) ? x.l.state : 'Timer';
      return `<div class="trow${x.e.state === 'paused' ? ' paused' : ''}" data-t="${x.s.t}"><div class="tbar" style="width:${pct}%"></div>
        <div class="tx"><div class="name">${esc(label)}</div><div class="tleft">${mmss(lv)}</div></div>
        <button class="sb" data-a="sub">−1m</button><button class="sb" data-a="add">+1m</button>
        <button class="sb" data-a="pause">${icon(x.e.state === 'paused' ? 'play' : 'pause')}</button><button class="sb" data-a="cancel">${icon('close')}</button></div>`;
    }).join('') : '<div class="anone">No timers running. Start one below, or ask the voice assistant.</div>');
    try { const j = JSON.parse((st(cfg.last) || {}).state); const t = typeof j.t === 'number' && j.t < 1e11 ? j.t : new Date(j.t).getTime() / 1000; last.textContent = j.l ? `Last finished: ${j.l}${t ? ', ' + hm(t, true) : ''}` : ''; } catch (e) { last.textContent = ''; }
  };
  watch(slots.flatMap((s) => [s.t, s.l]).concat([cfg.last]), draw);
  tick(() => { if (el.isConnected && el.offsetParent && slots.some((s) => (st(s.t) || {}).state === 'active')) draw(); });
  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.s) { run({ call: cfg.start, target: null, data: { seconds: +b.dataset.s, label: '' } }, { el: b, ev }); return; }
    const row = b.closest('.trow'); if (!row) return; const id = row.dataset.t, e = st(id), a = b.dataset.a;
    if (a === 'cancel') run({ call: 'timer.cancel' }, { el: b, ev, entity: id });
    if (a === 'pause') run({ call: e.state === 'paused' ? 'timer.start' : 'timer.pause' }, { el: b, ev, entity: id });
    if (a === 'add') run({ call: 'timer.change', data: { duration: '00:01:00' } }, { el: b, ev, entity: id });
    if (a === 'sub') run({ call: 'timer.change', data: { duration: '-00:01:00' } }, { el: b, ev, entity: id });
  });
  return el;
}
