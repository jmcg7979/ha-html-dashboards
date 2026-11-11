// TV apps as banner tiles (TV profile; core/tvhost.js). OK on a tile opens the app.
// { type: 'apps', apps: [{ pkg, name }],   pinned apps in this order; one that isn't installed shows "Get" (Play Store)
//   rest: true,                            instead: every installed app NOT in `apps` (the All apps pop-up), A to Z
//   more: '#apps',                         adds an "All apps" tile that opens that pop-up
//   extra: [{ name, icon, run: () => {} }]  more tiles after the apps (e.g. Settings)
//   cols: 5,                               tiles per row
//   row: true }                            one row that scrolls sideways (TV home) instead of a grid
// In a browser (no launcher) every pinned app counts as installed and the banners fall back to the name.
import { h, esc, icon } from '../core/dom.js';
import { apps as installed, launch, banner, store } from '../core/tvhost.js';
import { run } from '../core/actions.js';

export default function appsCard(cfg) {
  const el = h(`<div class="apps${cfg.row ? ' row hrow' : ''}" style="--cols:${cfg.cols || 5}"></div>`);
  const draw = () => {
    const have = installed(), pins = cfg.apps || [];
    let list;
    if (cfg.rest) {
      const pinned = new Set(pins.map((a) => a.pkg));
      list = (have || []).filter((a) => !pinned.has(a.pkg)).map((a) => ({ pkg: a.pkg, name: a.label, ok: true }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } else {
      const names = new Map((have || []).map((a) => [a.pkg, a.label]));
      list = pins.map((a) => ({ ...a, ok: !have || names.has(a.pkg) }));
    }
    el.innerHTML = list.map((a, i) => `<button class="app${a.ok ? '' : ' missing'}" data-i="${i}"${i === 0 && cfg.first ? ' data-focus-first' : ''}>
        <img alt="" loading="lazy" src="${esc(banner(a.pkg))}"><span class="alabel">${esc(a.name)}</span>${a.ok ? '' : '<span class="aget">Get</span>'}</button>`).join('') +
      (cfg.more ? `<button class="app more" data-more>${icon('apps')}<span class="alabel">All apps</span></button>` : '') +
      (cfg.extra || []).map((x, i) => `<button class="app more" data-x="${i}">${icon(x.icon || 'cog-outline')}<span class="alabel">${esc(x.name)}</span></button>`).join('') +
      (cfg.rest && !list.length ? '<div class="anone">No other apps installed.</div>' : '');
    el.querySelectorAll('img').forEach((img) => { img.onerror = () => img.parentElement.classList.add('noimg'); });
    el.list = list;
  };
  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('.app'); if (!b) return;
    if (b.hasAttribute('data-more')) { run({ nav: cfg.more }, { el: b, ev }); return; }
    if (b.dataset.x != null) { cfg.extra[+b.dataset.x].run(); return; }
    const a = el.list[+b.dataset.i];
    if (a.ok) launch(a.pkg); else store(a.pkg);
  });
  draw();
  addEventListener('tv:resume', draw);   // apps installed or removed while away
  return el;
}
