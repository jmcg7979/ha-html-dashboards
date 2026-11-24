// People in the status row: a portrait, the name and where they are (Home / a zone's name / Away); a tap runs `tap`.
// { type: 'people', round: true, people: [{ entity, name, tap, portrait }] }
// round: true = the person's HA photo in a presence ring (green = home). Without it, `portrait` is a transparent cut-out
// image in the site's assets, standing up out of the tile while home, grayed and sunk while away.
// Sizes: --fig-w / --fig-img / --people-sink. Batteries live in the person's pop-up.
import { h, esc, icon, setText, setHTML, hm } from '../core/dom.js';
import { st, watch } from '../core/store.js';
import { origin } from '../core/auth.js';
import { run } from '../core/actions.js';
import { asset } from '../core/asset.js';

export default function people(cfg) {
  const el = h(`<div class="people portrait${cfg.round ? ' round' : ''}" style="--n:${cfg.people.length}"></div>`);
  cfg.people.forEach((p) => {
    const d = h(`<div class="pp"><div class="pglow"></div><div class="pfig"><img alt=""></div>
      <div class="ptxt"><div class="name">${esc(p.name)}</div><div class="pst"><span class="pic"></span><span class="ptext"></span></div>
</div></div>`);
    const img = d.querySelector('img'), pic = d.querySelector('.pic'), txt = d.querySelector('.ptext');
    const cut = p.portrait && !cfg.round;
    if (cut) img.src = asset(p.portrait); else img.classList.add('round');
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
