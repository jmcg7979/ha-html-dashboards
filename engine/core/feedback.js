// Every press is answered. At once: the button flashes (.tapped). And when the press was sent to Home Assistant and nothing
// has come of it after a third of a second, the button shows it is working (.working: dimmed, a small spinner) until the
// entity it acted on changes (or, for a command with nothing to change, HA has taken it), HA refuses, or 3 s have passed since HA took it (8 s in all). Quick things (a light) only flash; slow ones (stopping music
// in several rooms, a TV turning on) no longer leave you guessing whether the press was taken.
// It needs nothing from the cards: the press is noted here (initFeedback), core/ha.js says what was sent for it (sent),
// core/store.js says which entities changed (changed).
const SEL = 'button, a, [role="button"], .tap';
const SHOW = 330, MAX = 8000, AFTER = 3000;
let pressed = null;
const waiting = new Set();
const positions = new WeakMap();   // button -> its own inline position, while ours (relative, for the spinner) is on it

export function initFeedback() {
  document.addEventListener('click', (ev) => {
    const b = ev.target && ev.target.closest ? ev.target.closest(SEL) : null; if (!b) return;
    pressed = b; setTimeout(() => { if (pressed === b) pressed = null; }, 0);   // "this press" lasts as long as its click handlers
    b.classList.remove('tapped'); void b.offsetWidth; b.classList.add('tapped'); setTimeout(() => b.classList.remove('tapped'), 300);
  }, true);
}

// A message went out because of the press being handled right now. ids: the entities it acts on (none: done when HA answers).
// Returns done(failed) for the sender to call with HA's answer, or null when no press is behind it (an automation of the page).
export function sent(ids) {
  const b = pressed; if (!b) return null;
  const w = { b, ids: [].concat(ids || []).filter(Boolean) };
  waiting.add(w);
  w.show = setTimeout(() => { if (!b.isConnected) return end(w);
    if (getComputedStyle(b).position === 'static' && !positions.has(b)) { positions.set(b, b.style.position); b.style.position = 'relative'; }
    b.classList.add('working'); }, SHOW);
  w.max = setTimeout(() => end(w), MAX);
  // HA has answered: done if it refused or there is nothing to wait for; else the change gets AFTER ms more (an entity that
  // doesn't report what was asked, e.g. a TV remote's player, would otherwise spin the full 8 s)
  return (failed) => { if (failed || !w.ids.length) end(w); else { clearTimeout(w.max); w.max = setTimeout(() => end(w), AFTER); } };
}
export function changed(ids) { if (waiting.size) waiting.forEach((w) => { if (w.ids.some((i) => ids.includes(i))) end(w); }); }
function end(w) {
  if (!waiting.delete(w)) return;
  clearTimeout(w.show); clearTimeout(w.max);
  if ([...waiting].some((x) => x.b === w.b)) return;   // another call of the same press is still out
  w.b.classList.remove('working'); if (positions.has(w.b)) { w.b.style.position = positions.get(w.b); positions.delete(w.b); }
}
