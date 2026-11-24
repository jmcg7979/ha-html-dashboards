// @ts-check
// The display profile a dashboard runs with (<html data-profile>, which the styles and a few modules read).
import { phoneView } from './layout.js';
import { fluidScale } from './scale.js';

// ?p= wins; otherwise a screen under 600 CSS px gets the phone shell whatever the dashboard asks for (Main opened on a
// phone), else the dashboard's own profile.
// A TV dashboard never takes the phone shell: the TV launcher can start it while the screen is asleep (a 0 px window).
/**
 * @param {import('./shapes.js').Dashboard} dash its views are replaced by their phone form when a big-screen dashboard runs on a phone
 * @param {URLSearchParams} q the page's URL parameters
 * @returns {string} the profile
 */
export function applyProfile(dash, q) {
  const root = document.documentElement;
  const profile = root.dataset.profile = q.get('p') || (innerWidth < 600 && dash.profile !== 'tv' ? 'phone' : dash.profile) || 'portal';
  if (profile === 'phone' && dash.profile !== 'phone' && dash.profile !== 'tv' && !q.get('p')) {   // big-screen layout on a phone: cells reflow (css/cards/adapted.css), screen-filling pages as on a Mobile dashboard
    root.dataset.adapted = 'phone'; dash.views = dash.views.map((v) => (v.pages ? phoneView(v) : v)); }
  fluidScale(profile, parseFloat(q.get('s')) || 0);   // --s follows the screen (core/scale.js); ?s= forces it
  return profile;
}
