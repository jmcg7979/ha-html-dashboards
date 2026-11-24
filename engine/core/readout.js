// Reading a value off a chart: a touch (or a mouse over it) calls `inspect` with the pointer event, and `hide` clears the
// readout when the mouse leaves, or a moment after a touch ends; each new touch starts that moment again.
// Call it while the card is built (the timer goes with the card's view: core/scope.js).
import { onDispose } from './scope.js';

const STAY = 2500;   // ms a readout stays after the finger lifts

export function readout(plot, inspect, hide) {
  let t = 0;
  onDispose(() => clearTimeout(t));
  plot.addEventListener('pointerdown', (ev) => { clearTimeout(t); inspect(ev); });
  plot.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'mouse' || ev.buttons) inspect(ev); });
  plot.addEventListener('pointerleave', hide);
  plot.addEventListener('pointerup', (ev) => { if (ev.pointerType !== 'mouse') { clearTimeout(t); t = setTimeout(hide, STAY); } });
}
