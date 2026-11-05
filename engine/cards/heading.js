// Panel heading: title, optional status pill, optional round action buttons.
// { type: 'heading', title: 'Lights',
//   pill: { count: [ids], tone: 'lamp', zero: 'All off' }          "4 on" / "All off"
//      or { weather: 'weather.home', label: 'Outside' }               "Outside 68°" with condition icon
//      or { value: () => ({ text, tone, on }) | 'text' | null, entities: [ids], tick: true }   any short live text (null = hidden)
//   buttons: [{ icon: 'lightbulb-group-off', action: {...} }]
//            icon may be (entity) => name with entity: id (e.g. a camera on / off switch); on: (entity) => bool lights it,
//            show: (entity) => bool hides it otherwise (e.g. while its switch is unavailable) }
import { h, esc, icon, setTone, setHTML, toggle } from '../core/dom.js';
import { st, watch, tick } from '../core/store.js';
import { run } from '../core/actions.js';

const WX = { 'clear-night': 'weather-night', sunny: 'weather-sunny', partlycloudy: 'weather-partly-cloudy', cloudy: 'weather-cloudy', rainy: 'weather-rainy', pouring: 'weather-pouring', snowy: 'weather-snowy', 'snowy-rainy': 'weather-snowy-rainy', fog: 'weather-fog', hail: 'weather-hail', lightning: 'weather-lightning', 'lightning-rainy': 'weather-lightning-rainy', windy: 'weather-windy', 'windy-variant': 'weather-windy-variant', exceptional: 'alert-circle-outline' };

export default function heading(cfg) {
  const el = h(`<div class="heading"><div class="htitle">${esc(cfg.title)}</div><span class="pill" hidden></span>${(cfg.buttons || []).map((b, i) => `<button class="rbtn" data-i="${i}">${icon(typeof b.icon === 'function' ? 'help-circle-outline' : b.icon)}</button>`).join('')}</div>`);
  const rb = [...el.querySelectorAll('.rbtn')];
  (cfg.buttons || []).forEach((b, i) => { if (b.entity && (typeof b.icon === 'function' || b.on || b.show)) watch([b.entity], () => {
    const e = st(b.entity); if (b.show) rb[i].hidden = !b.show(e); if (typeof b.icon === 'function') setHTML(rb[i], icon(b.icon(e))); if (b.on) { setTone(rb[i], b.tone || 'mist'); toggle(rb[i], 'on', !!b.on(e)); }
  }); });
  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('.rbtn'); if (!b) return;
    const btn = cfg.buttons[+b.dataset.i]; run(btn.action, { el: b, ev, entity: btn.entity });
  });
  const pill = el.querySelector('.pill'), p = cfg.pill;
  if (p && p.count) {
    setTone(pill, p.tone || 'lamp');
    watch(p.count, () => {
      const n = p.count.filter((id) => { const e = st(id); return e && e.state === 'on'; }).length;
      pill.hidden = false; toggle(pill, 'on', n);
      setHTML(pill, n ? `<span class="dot"></span>${n} on` : esc(p.zero || 'All off'));
    });
  } else if (p && p.weather) {
    watch([p.weather], () => {
      const w = st(p.weather), t = w && w.attributes.temperature;
      pill.hidden = t == null;
      if (t != null) setHTML(pill, `${icon(WX[w.state] || 'thermometer')}${esc(p.label || 'Outside')} ${Math.round(t)}°`);
    });
  } else if (p && p.value) {
    const draw = () => {
      let r = p.value(); if (typeof r === 'string') r = { text: r };
      pill.hidden = !r || !r.text; if (!r || !r.text) return;
      setTone(pill, r.tone || 'stone'); toggle(pill, 'on', !!r.on); setHTML(pill, esc(r.text));
    };
    watch(p.entities || [], draw); if (p.tick) tick(draw);
  }
  return el;
}
