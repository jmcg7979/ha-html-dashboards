// Pick rooms and clean them (vacuum.clean_area). Tap rooms to select, then Clean.
// { type: 'area-pick', entity: 'vacuum.x', areas: [['kitchen', 'Kitchen'], ...] }
import { h, esc, icon } from '../core/dom.js';
import { run } from '../core/actions.js';

export default function areaPick(cfg) {
  const picked = new Set();
  const el = h(`<div class="areapick"><div class="areas">${cfg.areas.map(([id, name]) => `<button class="chip" data-a="${id}">${esc(name)}</button>`).join('')}</div>
    <button class="chip go" disabled>${icon('play')}<span>Pick rooms to clean</span></button></div>`);
  const go = el.querySelector('.go'), goText = go.querySelector('span');
  const sync = () => { go.disabled = !picked.size; goText.textContent = picked.size ? `Clean ${picked.size} room${picked.size > 1 ? 's' : ''}` : 'Pick rooms to clean'; go.classList.toggle('on', picked.size > 0); };
  el.style.setProperty('--t', 'var(--mist)');
  el.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-a]');
    if (a) { const id = a.dataset.a; picked.has(id) ? picked.delete(id) : picked.add(id); a.classList.toggle('on', picked.has(id)); sync(); return; }
    if (ev.target.closest('.go') && picked.size) {
      run({ call: 'vacuum.clean_area', data: { cleaning_area_id: [...picked] }, expect: { state: 'cleaning', until: (r) => r.state === 'cleaning' } }, { el: go, ev, entity: cfg.entity });
      picked.clear(); el.querySelectorAll('[data-a]').forEach((b) => b.classList.remove('on')); sync();
    }
  });
  return el;
}
