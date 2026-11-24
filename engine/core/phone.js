// @ts-check
// Phone shell (profile "phone"): a bottom tab bar instead of the rail and a "More" sheet for the other views and links.
// The dashboard says which views get a tab:  tabs: ['home', 'cameras', 'rooms']  (the rest go under More).
// Inside HA's Webpage dashboard the sheet also offers HA's own menu, whose button went with HA's top bar (core/ha-embed.js).
import { h, esc, icon } from './dom.js';
import { layer } from './layers.js';
import { swipeToClose } from './gesture.js';
import { haHost, safeArea, coverHA } from './ha-embed.js';

let bar = null, sheet = null, more = null, tabIds = [];

/**
 * @param {import('./shapes.js').Dashboard} dash
 * @param {string} name the dashboard's, for the links' addresses
 */
export function phoneNav(dash, name) {
  tabIds = dash.tabs || dash.views.slice(0, 4).map((v) => v.id);
  const inBar = tabIds.map((id) => dash.views.find((v) => v.id === id)).filter(Boolean);
  const rest = dash.views.filter((v) => !tabIds.includes(v.id));
  const link = (v) => `<a href="?d=${name}&v=${v.id}" data-v="${v.id}"><i>${icon(v.icon || 'view-dashboard')}</i><span>${esc(v.title || v.id)}</span></a>`;

  bar = h(`<nav id="tabbar">${inBar.map(link).join('')}${rest.length || (dash.links || []).length ? `<button class="more" data-more><i>${icon('dots-horizontal')}</i><span>More</span></button>` : ''}</nav>`);
  document.body.appendChild(bar);

  // More: the remaining views as a grid of big buttons, then the dashboard's links, then HA's own menu when inside HA
  const host = haHost();
  sheet = h(`<div class="pwrap moresheet" hidden><div class="popup" style="--t:var(--mist)"><div class="grab"></div>
    <div class="msgrid">${rest.map((v) => `<a href="?d=${name}&v=${v.id}" data-v="${v.id}" class="mbtn">${icon(v.icon || 'view-dashboard')}<span>${esc(v.title || v.id)}</span></a>`).join('')}</div>
    <div class="mlinks">${(dash.links || []).map((l) => `<a class="mlink" href="${esc(l.url)}" target="_top">${icon(l.icon)}<span>${esc(l.title)}</span></a>`).join('')}
    ${host ? `<button class="mlink" data-hamenu>${icon('menu')}<span>Home Assistant menu</span></button>` : ''}</div></div></div>`);
  document.body.appendChild(sheet);
  more = layer({ el: sheet, kind: 'sheet', scope: sheet.querySelector('.popup'), close: closeMore });

  const go = (id) => window.dispatchEvent(new CustomEvent('dash:view', { detail: id }));
  bar.addEventListener('click', (ev) => {
    const at = /** @type {Element} */ (ev.target), a = /** @type {HTMLElement | null} */ (at.closest('a[data-v]'));
    if (a) { ev.preventDefault(); closeMore(); go(a.dataset.v); return; }
    if (at.closest('[data-more]')) { if (sheet.hidden) openMore(); else closeMore(); }
  });
  sheet.addEventListener('click', (ev) => {
    const at = /** @type {Element} */ (ev.target), a = /** @type {HTMLElement | null} */ (at.closest('a[data-v]'));
    if (a) { ev.preventDefault(); closeMore(); go(a.dataset.v); return; }
    if (at.closest('[data-hamenu]')) { closeMore(); host.dispatchEvent(new CustomEvent('hass-toggle-menu', { bubbles: true, composed: true })); return; }
    if (ev.target === sheet) closeMore();
  });
  swipeToClose(sheet.querySelector('.popup'), closeMore);
  safeArea();
  window.addEventListener('dash:camfull', (e) => camFull(e.detail));
}

// A camera in full screen: hide the tab bar, ask for real full screen (hides the phone's own bars when the app allows it),
// and inside HA make our frame cover HA's whole page (core/ha-embed.js).
function camFull(on) {
  document.documentElement.classList.toggle('camfull', on);
  try {
    if (on && !document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  } catch (e) { /* not allowed here */ }
  coverHA(on);
}

function openMore() { sheet.hidden = false; bar.classList.add('moreopen'); more.open(); }
function closeMore() { if (sheet) sheet.hidden = true; if (bar) bar.classList.remove('moreopen'); if (more) more.shut(); }

// called by the app whenever a view is shown: highlight its tab, or More for a view without one
/** @param {string} id the view's */
export function markView(id) {
  if (!bar) return;
  bar.querySelectorAll('a[data-v]').forEach((a) => a.classList.toggle('on', a.dataset.v === id));
  const more = bar.querySelector('[data-more]'); if (more) more.classList.toggle('on', !tabIds.includes(id));
  if (sheet) sheet.querySelectorAll('a[data-v]').forEach((a) => a.classList.toggle('on', a.dataset.v === id));
}
