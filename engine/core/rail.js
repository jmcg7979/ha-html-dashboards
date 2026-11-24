// @ts-check
// The rail: the clock, a link per view (a view with rail: false has none), the dashboard's links and the song that plays.
// Drill-in: a view with several pages (Systems) swaps the rail for its own menu while it is open: Back, the view's
// name, then its pages as full-size rail buttons. Back shows the main rail again without leaving the page.
// (a TV keeps its rail as it is and shows a paged view's tabs on the page instead: core/remote/rail.js)
import { icon, esc } from './dom.js';
import { timeOpts } from './units.js';
import { railPlaying } from './railplay.js';

/**
 * @param {HTMLElement} rail the #rail element
 * @param {object} o
 * @param {import('./shapes.js').Dashboard} o.dash
 * @param {string} o.name the dashboard's, for the links' addresses
 * @param {string} o.profile the display profile
 * @param {(view: string) => void} o.open called for a view or page chosen in the rail ('systems', 'systems/nas')
 * @returns {{ mark: (view: string, here: string) => void }} mark: the router says what is on screen
 */
export function initRail(rail, { dash, name, profile, open }) {
  const paged = profile === 'tv' ? [] : dash.views.filter((v) => v.pages && v.pages.length > 1);
  rail.innerHTML = '<div class="rclock"><b></b><small></small></div><div class="rmain">' +
    dash.views.filter((v) => v.rail !== false).map((v) => `<a href="?d=${name}&v=${v.id}" data-v="${v.id}">${icon(v.icon || 'view-dashboard')}<span>${esc(v.title || v.id)}</span></a>`).join('') +
    '<div class="spacer"></div>' + (dash.links || []).map((l) => `<a href="${esc(l.url)}">${icon(l.icon)}<span>${esc(l.title)}</span></a>`).join('') + '</div>' +
    paged.map((v) => `<div class="rsub" data-for="${v.id}"><button class="rback">${icon('chevron-left')}<span>Back</span></button>` +
      `<div class="rtitle">${esc(v.title || v.id)}</div>` +
      v.pages.map((p) => `<a href="?d=${name}&v=${v.id}/${p.id}" data-v="${v.id}/${p.id}">${icon(p.icon || 'circle-small')}<span>${esc(p.short || p.title)}</span></a>`).join('') + '</div>').join('');

  // the clock: time over a short date, updated on the minute
  const ck = rail.querySelector('.rclock');
  const clock = () => { const d = new Date(); ck.firstChild.textContent = d.toLocaleTimeString([], timeOpts({ hour: 'numeric', minute: '2-digit' })).replace(/\s?[ap]\.?\s?m\.?$/i, '');
    ck.lastChild.textContent = d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.getDate(); setTimeout(clock, 60000 - (Date.now() % 60000) + 50); };
  clock();
  if (dash.playing && profile !== 'tv') railPlaying(rail, dash.playing);   // the song that plays (core/railplay.js)

  // More views than the screen is high: the links give up padding before the rail has to scroll (`--rail-pad`, base.css).
  // The song's cover is not counted: with it a full rail scrolls, as it always did. A TV lays its rail out itself.
  if (profile !== 'tv') {
    const main = /** @type {HTMLElement} */ (rail.querySelector('.rmain'));
    const fit = () => {
      if (!main.offsetParent) return;   // drilled into a view's own menu: the links aren't laid out, keep what they had
      rail.style.removeProperty('--rail-pad');
      const links = main.querySelectorAll('a'), play = /** @type {HTMLElement | null} */ (rail.querySelector('.rplay'));
      const over = main.scrollHeight - main.clientHeight - (play && !play.hidden ? play.offsetHeight : 0);
      if (over <= 0 || !links.length) return;
      const pad = parseFloat(getComputedStyle(links[0]).paddingTop);
      rail.style.setProperty('--rail-pad', Math.max(2, pad - over / (2 * links.length)).toFixed(2) + 'px');
    };
    requestAnimationFrame(fit); addEventListener('resize', fit);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  }

  rail.addEventListener('click', (ev) => {
    const at = /** @type {Element} */ (ev.target);
    if (at.closest('.rback')) { rail.classList.remove('drill'); return; }   // main rail again; the page stays
    const a = /** @type {HTMLElement | null} */ (at.closest('a[data-v]')); if (!a) return; ev.preventDefault();
    // the paged view already on screen: just open its menu again, on the same page
    if (rail.querySelector(`.rsub.open[data-for="${a.dataset.v}"]`)) { rail.classList.add('drill'); return; }
    open(a.dataset.v);
  });
  return {
    mark(view, here) {
      rail.querySelectorAll('a[data-v]').forEach((a) => { const v = a.getAttribute('data-v'); a.classList.toggle('on', v === view || v === here); });
      rail.querySelectorAll('.rsub').forEach((s) => s.classList.toggle('open', s.getAttribute('data-for') === view));
      rail.classList.toggle('drill', !!rail.querySelector('.rsub.open'));   // opening a paged view drills in (again)
    },
  };
}
