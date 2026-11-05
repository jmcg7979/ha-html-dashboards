// Small DOM and formatting helpers shared by every card.
import ICONS from '../icons.js';
import { hmParts } from './units.js';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// icon('lightbulb') -> inline SVG; accepts 'mdi:lightbulb' too
export function icon(name) {
  const n = String(name || '').replace(/^mdi:/, '');
  if (!ICONS[n] && n) console.warn('icon missing from icons.js:', n);
  return `<svg viewBox="0 0 24 24"><path d="${ICONS[n] || ''}"/></svg>`;
}

export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
export const q = (el, sel) => el.querySelector(sel);

// tone names map to the r,g,b tokens in tokens.css
const TONES = ['lamp', 'mist', 'sage', 'ember', 'plum', 'stone'];   // tokens.css meaning colours
// tone: a palette name ('lamp', 'sage'...) or a light's own colour as [r, g, b] (e.g. a lamp tinted with what it shows)
export function setTone(el, tone) {
  if (Array.isArray(tone) && tone.length === 3) { el.style.setProperty('--t', tone.map((x) => Math.round(+x || 0)).join(', ')); return; }
  if (tone != null && !TONES.includes(tone)) console.warn('setTone: unknown tone', tone);
  el.style.setProperty('--t', TONES.includes(tone) ? `var(--${tone})` : 'var(--stone)');
}

export function setText(el, text) { if (el.textContent !== text) el.textContent = text; }
export function setHTML(el, html) { if (el.__h !== html) { el.__h = html; el.innerHTML = html; } }
export function toggle(el, cls, on) { el.classList.toggle(cls, !!on); }

// battery level -> ring colour + fill on an .ic element
export function battTone(v) { return v == null ? null : v < 25 ? 'ember' : v < 40 ? 'lamp' : 'sage'; }
export function setRing(el, v) {
  if (v == null) { el.classList.remove('ring'); return; }
  el.classList.add('ring');
  el.style.setProperty('--ring-p', Math.max(0, Math.min(100, v)) + '%');
  el.style.setProperty('--ring-c', `rgb(var(--${battTone(v)}))`);
}

// "8:51" today, "Tue 8:51" otherwise; ampm adds " PM"
export function hm(t, ampm = false) {
  const d = typeof t === 'number' ? new Date(t * 1000) : new Date(t), n = new Date();
  if (isNaN(d)) return '';
  const [time, pm] = hmParts(d.getHours(), d.getMinutes()), s = time + (ampm && pm ? ' ' + pm : '');
  return d.toDateString() === n.toDateString() ? s : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' + s;
}
export const cap = (s) => (s ? (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, ' ') : '');
export function mmss(sec) { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h ? h + ':' + ('0' + m).slice(-2) : m) + ':' + ('0' + s).slice(-2); }

// Confirm by a second tap on the same action (no blocking dialogs): not a double-tap or a bouncing touch (0.3 s), not later than 3 s.
// `key` names the action, so a button that now means something else starts over. Returns true when the tap should wait.
let pendingConfirm = null;
export function needConfirm(el, key) {
  if (pendingConfirm && pendingConfirm.el === el && pendingConfirm.key === key && performance.now() - pendingConfirm.t < 300) return true;
  if (pendingConfirm && pendingConfirm.el === el && pendingConfirm.key === key && performance.now() - pendingConfirm.t < 3000) { clearTimeout(pendingConfirm.tm); el.classList.remove('confirm'); pendingConfirm = null; return false; }
  if (pendingConfirm) { clearTimeout(pendingConfirm.tm); pendingConfirm.el.classList.remove('confirm'); }
  el.classList.add('confirm');
  pendingConfirm = { el, key, t: performance.now(), tm: setTimeout(() => { el.classList.remove('confirm'); pendingConfirm = null; }, 3000) };
  return true;
}
