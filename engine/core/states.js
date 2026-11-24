// What a state means, said once: rules on plain values that cards and site files share. No DOM, no store.
const cap = (s) => (s ? (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, ' ') : '');

// an entity that reports: it exists and its state is neither unavailable nor unknown
export const known = (e) => !!e && e.state != null && e.state !== '' && e.state !== 'unavailable' && e.state !== 'unknown';

// The alarm for a state: its look (s: off / armed / alert / none), icon and words. `off`: the word for disarmed where
// "Off" is too short (a pop-up's header, the log). No state, unavailable or unknown is "Not reporting": never the lock, never "Off".
const ALARM = { disarmed: ['off', 'Off'], armed_away: ['armed', 'Armed away'], armed_home: ['armed', 'Armed home'], armed_night: ['armed', 'Armed night'],
  armed_vacation: ['armed', 'Armed vacation'], armed_custom_bypass: ['armed', 'Armed'], arming: ['armed', 'Arming'], disarming: ['armed', 'Disarming'],
  pending: ['alert', 'Entry delay'], triggered: ['alert', 'Triggered!'] };
export function alarmView(state, off) {
  const [s, text] = ALARM[state] || ['none', !state || state === 'unavailable' || state === 'unknown' ? 'Not reporting' : String(state).replace(/_/g, ' ')];
  return { s, text: s === 'off' && off ? off : text, icon: s === 'none' ? 'shield-alert' : s === 'off' ? 'shield-off-outline' : 'shield-lock' };
}

// A lock. jam: the state of its "jammed" sensor, if it has one: the bolt couldn't throw, and the lock then reports neither
// locked nor unlocked. key: locked / unlocked / jammed / none (not reporting) / the state itself while it moves.
export function lockView(e, jam) {
  const s = e ? e.state : null, settled = s === 'locked' || s === 'unlocked';
  const key = settled ? s : jam === 'on' ? 'jammed' : known(e) ? s : 'none';
  return { key, locked: key === 'locked', word: key === 'none' ? 'Not reporting' : cap(key), icon: key === 'jammed' || key === 'none' ? 'lock-alert' : key === 'locked' ? 'lock' : 'lock-open-variant' };
}

// A garage door (a cover). key: closed / open / opening / closing / none (not reporting).
export function garageView(e) {
  const key = known(e) ? e.state : 'none';
  return { key, closed: key === 'closed', moving: key === 'opening' || key === 'closing', word: key === 'none' ? 'Not reporting' : cap(key), icon: key === 'closed' ? 'garage' : 'garage-open' };
}

// "3 open" / "All closed" for a count; null = the sensor that counts isn't reporting, never "All closed"
export const countWord = (n, some, none) => (n == null || isNaN(n) ? 'Not reporting' : n ? `${n} ${some}` : none);
