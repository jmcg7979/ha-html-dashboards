// People: photo with presence ring (green = home), name, battery chips per device; non-compact also shows "Home · 8:51".
// { type: 'people', compact: true (status-row height), people: [{ entity, name, tap, devices: [{ battery, charging, icon }] }] }
// style: 'portrait' (status row): cut-out portrait (person.portrait, transparent image) standing up out of the tile while home,
//   greyed and sunk while away (round: true = the HA person photo in a presence ring instead); name + status line (Home / zone / Away). Batteries live in the person pop-up. Sizes: --fig-w / --fig-img / --people-sink.
import { h, esc, icon, setTone, setText, setHTML, toggle, hm, battTone } from '../core/dom.js';
import { st, num, watch } from '../core/store.js';
import { origin } from '../core/auth.js';
import { run } from '../core/actions.js';

export default function people(cfg) {
  if (cfg.style === 'portrait') return portraits(cfg);
  const el = h(`<div class="people${cfg.compact ? ' compact' : ''}" style="--n:${cfg.people.length}"></div>`);
  cfg.people.forEach((p) => {
    const d = h(`<div class="person"><div class="photo"><img alt=""></div><div class="pcol"><div class="name">${esc(p.name)}</div>${cfg.compact ? '' : '<div class="sub"></div>'}
      <div class="row">${(p.devices || []).map(() => '<div class="chip"></div>').join('')}</div></div></div>`);
    const img = d.querySelector('img'), sub = d.querySelector('.sub'), chips = [...d.querySelectorAll('.chip')];
    const deps = [p.entity];
    (p.devices || []).forEach((x) => deps.push(x.battery, x.charging));
    watch(deps, () => {
      const e = st(p.entity), s = e ? e.state : 'unknown', pic = e && e.attributes.entity_picture;
      if (pic && img.getAttribute('src') !== origin + pic) img.src = origin + pic;
      d.dataset.where = s === 'home' ? 'home' : s === 'not_home' ? 'away' : 'zone';
      if (sub) setText(sub, (s === 'home' ? 'Home' : s === 'not_home' ? 'Away' : s) + (e && e.lc ? ' · ' + hm(e.lc) : ''));
      (p.devices || []).forEach((x, i) => {
        const v = num(x.battery), chg = String((st(x.charging) || {}).state).toLowerCase() === 'charging', c = chips[i];
        setTone(c, chg ? 'lamp' : battTone(v)); toggle(c, 'on', v != null || chg);
        c.title = v == null ? '' : Math.round(v) + '%';
        setHTML(c, icon(chg ? 'lightning-bolt' : x.icon || 'cellphone'));
      });
    });
    if (p.tap) (cfg.compact ? d : d.querySelector('.photo')).addEventListener('click', (ev) => run(p.tap, { el: d, ev, entity: p.entity }));
    el.appendChild(d);
  });
  return el;
}

function portraits(cfg) {
  const el = h(`<div class="people portrait${cfg.round ? ' round' : ''}" style="--n:${cfg.people.length}"></div>`);
  cfg.people.forEach((p) => {
    const d = h(`<div class="pp"><div class="pglow"></div><div class="pfig"><img alt=""></div>
      <div class="ptxt"><div class="name">${esc(p.name)}</div><div class="pst"><span class="pic"></span><span class="ptext"></span></div>
</div></div>`);
    const img = d.querySelector('img'), pic = d.querySelector('.pic'), txt = d.querySelector('.ptext');
    const cut = p.portrait && !cfg.round;
    if (cut) img.src = p.portrait; else img.classList.add('round');
    watch([p.entity], () => {
      const e = st(p.entity), s = e ? e.state : 'unknown';
      const pic0 = !cut && e && e.attributes.entity_picture;
      if (pic0 && img.getAttribute('src') !== origin + pic0) img.src = origin + pic0;
      if (!cut) img.style.visibility = pic0 ? '' : 'hidden';   // no photo: the ring alone
      const where = s === 'home' ? 'home' : s === 'not_home' ? 'away' : ['unknown', 'unavailable'].includes(s) ? 'unknown' : 'zone';
      d.dataset.where = where;
      setHTML(pic, icon(where === 'home' ? 'home' : 'map-marker'));
      setText(txt, where === 'home' ? 'Home' : where === 'away' ? 'Away' : where === 'unknown' ? 'Unknown' : s);
      d.title = `${p.name}: ${txt.textContent}${e && e.lc ? ' since ' + hm(e.lc) : ''}`;
    });
    if (p.tap) d.addEventListener('click', (ev) => run(p.tap, { el: d, ev, entity: p.entity }));
    el.appendChild(d);
  });
  return el;
}
