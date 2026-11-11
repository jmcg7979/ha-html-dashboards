// Recent activity from HA's logbook, with who did it when HA knows (the user behind a dashboard/app action).
// { type: 'logbook', entities: [...], hours: 168, limit: 15, format: (row) => text }
// Nothing in the period: the first entity's current state, "no changes in N days".
import { h, esc, setHTML, hm, cap } from '../core/dom.js';
import { personName, st } from '../core/store.js';
import { request, onReady, connected } from '../core/ha.js';

export default function logbook(cfg) {
  const el = h('<div class="logbook"><div class="sub">Loading…</div></div>');
  const who = (r) => {
    if (r.context_user_id) { const p = personName(r.context_user_id); if (p) return p; }
    return r.context_entity_id_name || r.context_name || (r.context_event_type === 'automation_triggered' ? 'Automation' : '');
  };
  const quiet = () => {   // no date: HA resets last_changed on a restart, so 'since …' would mislead
    const e = st(cfg.entities[0]);
    if (!e || ['unknown', 'unavailable', ''].includes(e.state)) return '<div class="sub">Nothing in this period</div>';
    return `<div class="lrow"><span class="name">${esc(cfg.format ? cfg.format({ state: e.state }) : cap(e.state))}</span><span class="sub">no changes in ${Math.round((cfg.hours || 168) / 24)} days</span></div>`;
  };
  const load = () => {
    const start = new Date(Date.now() - (cfg.hours || 168) * 3600e3).toISOString();
    request({ type: 'logbook/get_events', start_time: start, entity_ids: cfg.entities })
      .then((rows) => {
        const list = (rows || []).filter((r) => r.state != null).reverse().slice(0, cfg.limit || 15);
        setHTML(el, list.length ? list.map((r) => {
          const by = who(r);
          return `<div class="lrow"><span class="name">${esc(cfg.format ? cfg.format(r) : cap(r.state))}</span><span class="sub">${esc(hm(r.when, true))}${by ? ' · ' + esc(by) : ''}</span></div>`;
        }).join('') : quiet());
      }).catch(() => setHTML(el, '<div class="sub">Couldn’t load activity</div>'));
  };
  if (connected()) load(); else onReady(load);
  return el;
}
