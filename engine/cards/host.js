// One machine (or VM, container, network device) as a glass panel: status badge + reasons, speedometer meters with a
// 24-hour trace under each, capacity bars, a list of facts, optional Power / Restart.
// { type: 'host', node: { name, icon, up, metrics, checks, updates, page },   // node = the health definition (core/assess.js)
//   sub: () => 'text' (default: "Up 4 months" from node.up), badge: (assessment) => 'text' | { text, tone } (default: OK / Attention / Problem),
//   meters: [{ entity, value: () => number (optional, instead of the entity's state), name, unit: '%', min: 0, max: 100, warn, crit, decimals, detail: () => '3.1 of 4 GB',
//             tone: 'lamp' | (value) => tone (instead of the warn / crit colours) }],
//   bars:   [{ name, entity (percent), detail: () => '68 of 816 GB', warn, crit, tone (instead of the warn / crit colours) }],
//   facts:  [{ label, icon, entities: [...], value: () => 'text' | { text, tone } }],
//   controls: { power, restart, status, impact: 'what stops while it is off / restarting' } | { note: 'text' } (same row, no buttons)
//           | { buttons: [{ icon, text (or () => text: redrawn every second, e.g. a countdown), on: entity (lit while 'on'; also the entity a function action gets), action (core/actions.js run),
//                           admin: true (only for HA admins), show: () => bool (hidden while false), watch: [ids] }] },
//   live: true (re-draw the header every second, for a sub / badge that follows something other than entities),
//   meterRow: true (meters side by side on big screens), meterStyle: 'lines' (one short row each: name, value, trace; a TV), compact: true (big screens drop the status line and facts:
//   the badge and "Needs a look" still show problems), why: false (no status line), okText }
//   Power off and Restart ask first in a dialog naming the machine and the impact; Power on is a tap-again.
// In a growing cell the meters take the spare height, so the traces get taller instead of leaving a gap.
import { h, esc, icon, setText, setHTML } from '../core/dom.js';
import { st, watch, tick } from '../core/store.js';
import { run } from '../core/actions.js';
import { user } from '../core/ha.js';
import { assess, nodeIds, metricLevel, LEVEL_TONE, LEVEL_NAME, LEVEL_ICON } from '../core/assess.js';
import { sparkline } from '../core/spark.js';
import { openTrend } from '../core/trend.js';
import { ago } from './health.js';

export const panel = true;   // on a page: its own glass panel (core/layout.js)

const P = (p) => { const a = Math.PI * (1 - p); return [50 + 40 * Math.cos(a), 48 - 40 * Math.sin(a)]; };
const arc = (p0, p1) => { const [x0, y0] = P(p0), [x1, y1] = P(p1); return `M${x0.toFixed(1)},${y0.toFixed(1)}A40,40 0 0 1 ${x1.toFixed(1)},${y1.toFixed(1)}`; };
// tap -> the history pop-up (core/trend.js); spec() is built at tap time
export function drill(el, spec) { el.classList.add('drill'); el.addEventListener('click', (ev) => { if (ev.target.closest('button')) return; ev.stopPropagation(); openTrend(spec()); }); }
export const fmtNum = (v, d = 0) => (isNaN(v) ? '–' : (+v).toFixed(d));

// speedometer + trace, used by host panels and anything else that wants one
export function meter(m) {
  const min = m.min || 0, max = m.max == null ? 100 : m.max;
  const el = h(`<div class="meter"><div class="mtr-a"><div class="mtr-g"><svg viewBox="0 0 100 52"><path d="${arc(0, 1)}" class="mtr-t"/><path class="mtr-v"/></svg>
    <div class="mtr-n"></div></div><div class="mtr-l">${esc(m.name)}</div><div class="mtr-d"></div></div><div class="mtr-s"><span class="mtr-hi"></span></div></div>`);
  const val = el.querySelector('.mtr-v'), num = el.querySelector('.mtr-n'), det = el.querySelector('.mtr-d');
  const u0 = m.unit != null ? m.unit : '%', hi = el.querySelector('.mtr-hi');
  const sp = sparkline(m.spark || m.entity, { tone: 'sage', scale: m.scale, minRange: m.minRange != null ? m.minRange : u0 === '%' ? 20 : (max - min) / 5,
    stats: (a) => setText(hi, `24 h  ${fmtNum(a.lo, m.decimals || 0)}–${fmtNum(a.hi, m.decimals || 0)}${u0 === '%' ? '%' : u0 ? ' ' + u0 : ''}${m.trend === false ? '' : '  ›'}`) });
  el.querySelector('.mtr-s').appendChild(sp);
  if (m.trend !== false) drill(el, () => ({ title: m.owner ? `${m.owner} · ${m.name}` : m.name, unit: u0, decimals: m.decimals, warn: m.warn, crit: m.crit, tone: 'sage',
    floor: u0 === '%' || !/°/.test(u0) ? 0 : undefined, ceil: u0 === '%' ? 100 : undefined, minSpan: m.minRange != null ? m.minRange : u0 === '%' ? 10 : (max - min) / 8,
    series: [{ entity: m.spark || m.entity, scale: m.scale, name: m.name }], ...(m.trend || {}) }));
  watch([m.entity, ...(m.watch || [])], () => {
    const e = st(m.entity), v = !e ? NaN : m.value ? m.value() : parseFloat(e.state) * (m.scale || 1), u = m.unit != null ? m.unit : '%';
    const lv = metricLevel(m, v), tone = isNaN(v) ? 'stone' : (typeof m.tone === 'function' ? m.tone(v) : m.tone) || LEVEL_TONE[lv];
    el.style.setProperty('--t', `var(--${tone})`); sp.setTone(tone);
    const p = isNaN(v) ? 0 : Math.max(0, Math.min(1, (v - min) / (max - min || 1)));
    val.setAttribute('d', p > 0.005 ? arc(0, p) : '');
    setHTML(num, isNaN(v) ? '–' : `${fmtNum(v, m.decimals || 0)}<small>${esc(u)}</small>`);
    setText(det, m.detail ? m.detail() || '' : '');
  });
  return el;
}

export default function host(cfg) {
  const n = cfg.node || {};
  const el = h(`<div class="host${cfg.compact ? ' compact' : ''}"><div class="hh"><span class="ic on">${icon(n.icon || 'server')}</span><span class="tx"><span class="hname">${esc(n.name || cfg.title || '')}</span><span class="sub hsub"></span></span><span class="hbadge"></span></div>
    ${cfg.why === false ? '' : '<div class="hwhy"></div>'}
    ${cfg.meters && cfg.meters.length ? `<div class="hmeters${cfg.meterRow ? ' row' : ''}${cfg.meterStyle === 'lines' ? ' lines' : ''}" style="--n:${cfg.meters.length}"></div>` : ''}
    ${cfg.bars && cfg.bars.length ? `<div class="hcap">${cfg.bars.map((b) => `<div class="cap"><span class="clab">${esc(b.name)}</span><span class="cdet"></span><span class="ctrack"><i></i></span></div>`).join('')}</div>` : ''}
    ${cfg.facts && cfg.facts.length ? `<div class="hfacts">${cfg.facts.map((f) => `<div class="fact">${f.icon ? icon(f.icon) : ''}<span class="flab">${esc(f.label)}</span><span class="fval"></span></div>`).join('')}</div>` : ''}
    ${cfg.controls ? (cfg.controls.note ? `<div class="hctl note">${icon('lock-outline')}<span>${esc(cfg.controls.note)}</span></div>` : cfg.controls.buttons ? `<div class="hctl">${cfg.controls.buttons.map((b, i) => `<button class="sb cbtn" data-i="${i}">${icon(b.icon)}<span>${esc(typeof b.text === 'function' ? b.text() : b.text)}</span></button>`).join('')}</div>` : `<div class="hctl">${cfg.controls.power ? `<button class="sb cpow">${icon('power')}<span>Power</span></button>` : ''}${cfg.controls.restart ? `<button class="sb crst">${icon('restart')}<span>Restart</span></button>` : ''}</div>`) : ''}</div>`);
  const ms = el.querySelector('.hmeters'); (cfg.meters || []).forEach((m) => ms.appendChild(meter({ owner: n.name, ...m })));
  const badge = el.querySelector('.hbadge'), why = el.querySelector('.hwhy'), sub = el.querySelector('.hsub');
  const caps = [...el.querySelectorAll('.cap')], facts = [...el.querySelectorAll('.fact')];

  const head = () => {
    const a = assess(n), b = cfg.badge ? cfg.badge(a) : LEVEL_NAME[a.level], bt = typeof b === 'object' ? b : { text: b };
    // a badge { text, tone } with a warning tone colours the header without being a health problem (e.g. a weak 5G signal)
    const tone = bt.tone || LEVEL_TONE[a.level], lv = bt.tone && bt.tone !== 'sage' ? Math.max(a.level, 1) : a.level;
    el.style.setProperty('--t', `var(--${tone})`); el.classList.toggle('warn', lv > 0);
    setHTML(badge, `${icon(LEVEL_ICON[lv])}<span>${esc(bt.text)}</span>`);
    if (why) why.classList.toggle('ok', !a.reasons.length); if (why) setText(why, a.reasons.length ? a.reasons.map((r) => r.text).join(' · ') : cfg.okText || 'No issues');
    const u = n.up && st(n.up);
    setText(sub, cfg.sub ? cfg.sub() || '' : u && !isNaN(new Date(u.state)) ? 'Up ' + ago(u.state) : '');
  };
  watch([...nodeIds(n), ...(cfg.subWatch || [])], head); tick(() => { if (!cfg.sub || cfg.live) head(); });

  // capacity bars and facts with a `trend` open the history too (bars: unless trend: false)
  (cfg.bars || []).forEach((b, i) => { if (b.trend !== false) drill(caps[i], () => ({ title: `${n.name || ''} · ${b.name}`, unit: '%', floor: 0, ceil: 100, minSpan: 5,
    warn: b.warn != null ? b.warn : 80, crit: b.crit != null ? b.crit : 92, tone: 'mist', series: [{ entity: b.entity, name: b.name }], ...(b.trend || {}) })); });
  (cfg.facts || []).forEach((f, i) => { if (f.trend) { drill(facts[i], () => ({ title: `${n.name || ''} · ${f.label}`, ...f.trend })); facts[i].querySelector('.fval').insertAdjacentHTML('afterend', '<span class="chev">›</span>'); } });
  (cfg.bars || []).forEach((b, i) => watch([b.entity, ...(b.watch || [])], () => {
    const v = parseFloat((st(b.entity) || {}).state), lv = metricLevel({ warn: b.warn != null ? b.warn : 80, crit: b.crit != null ? b.crit : 92 }, v);
    caps[i].style.setProperty('--t', `var(--${b.tone || LEVEL_TONE[lv]})`);
    caps[i].querySelector('i').style.width = (isNaN(v) ? 0 : Math.min(100, v)) + '%';
    setText(caps[i].querySelector('.cdet'), b.detail ? b.detail() : isNaN(v) ? '–' : Math.round(v) + '%');
  }));
  (cfg.facts || []).forEach((f, i) => {
    const show = () => {
      let r = f.value(); if (typeof r !== 'object' || r == null) r = { text: r };
      const fv = facts[i].querySelector('.fval'); setText(fv, r.text == null || r.text === '' ? '–' : String(r.text));
      facts[i].classList.toggle('toned', !!r.tone); if (r.tone) facts[i].style.setProperty('--t', `var(--${r.tone})`);
    };
    // a fact with no entities (a fixed value, e.g. the internet plan) is drawn once: watch([]) never fires
    if ((f.entities || []).length) watch(f.entities, show); else show();
  });
  if (cfg.facts && cfg.facts.some((f) => f.tick)) tick(() => cfg.facts.forEach((f, i) => { if (f.tick) { const r = f.value(); setText(facts[i].querySelector('.fval'), typeof r === 'object' ? r.text : r); } }));

  const C = cfg.controls;
  if (C && C.buttons) {
    const bs = [...el.querySelectorAll('.cbtn')];
    // admin-only and state-dependent buttons: the row hides when none is left
    const row = el.querySelector('.hctl');
    const vis = () => { let any = false; C.buttons.forEach((b, i) => { const v = (!b.admin || !!(user && user.is_admin)) && (!b.show || !!b.show()); bs[i].hidden = !v; any = any || v; }); row.hidden = !any; };
    if (C.buttons.some((b) => b.admin || b.show)) { watch(C.buttons.flatMap((b) => b.watch || []), vis); tick(vis); }
    C.buttons.forEach((b, i) => { if (typeof b.text === 'function') tick(() => { if (!bs[i].hidden) setText(bs[i].lastChild, b.text()); }); });
    C.buttons.forEach((b, i) => { if (b.on) watch([b.on], () => { bs[i].classList.toggle('on', (st(b.on) || {}).state === 'on'); bs[i].style.setProperty('--t', `var(--${b.tone || 'sage'})`); }); });
    el.addEventListener('click', (ev) => { const x = ev.target.closest('.cbtn'); if (x) { const b = C.buttons[+x.dataset.i]; run(b.action, { el: x, ev, entity: b.on }); } });
  } else if (C && !C.note) {
    // stopping or restarting a container is for HA admins, like a VM's power buttons
    const row = el.querySelector('.hctl'), admin = () => !!(user && user.is_admin), gate = () => { if (row) row.hidden = !admin(); };
    gate(); tick(gate);
    const pw = el.querySelector('.cpow');
    if (pw) watch([C.power, C.status], () => { const on = (st(C.power) || st(C.status) || {}).state === 'on'; pw.classList.toggle('on', on); pw.style.setProperty('--t', 'var(--sage)'); });
    el.addEventListener('click', (ev) => {
      if (!admin()) return;
      const p = ev.target.closest('.cpow'), r = ev.target.closest('.crst');
      const name = n.name || 'it', on = (st(C.power) || {}).state === 'on';
      if (p) run({ call: on ? 'switch.turn_off' : 'switch.turn_on', target: C.power,
        confirm: on ? { title: `Power off ${name}?`, text: (C.impact ? C.impact + ' ' : '') + 'It stays off until you turn it back on.', ok: 'Power off', icon: 'power' } : true }, { el: p, ev });
      if (r) run({ call: 'button.press', target: C.restart,
        confirm: { title: `Restart ${name}?`, text: (C.impact ? C.impact + ' ' : '') + 'It is back in about a minute.', ok: 'Restart', icon: 'restart' } }, { el: r, ev });
    });
  }
  if (n.page && cfg.tap !== false) { el.classList.add('tappable'); el.addEventListener('click', (ev) => { if (!ev.target.closest('button')) window.dispatchEvent(new CustomEvent('dash:view', { detail: n.page })); }); }
  return el;
}
