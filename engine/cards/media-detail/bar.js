// A bar that takes a tap or a drag (a volume): dragBar(root, { pick, show, done }).
//   pick(ev) -> the bar that was pressed (an element under root), or null: the press was not on a bar
//   show(bar, v, first)        the level under the finger, 0..1, at the press (first) and on every move
//   done(bar, v | null, ev)    let go at v (two decimals); null: the press was taken away (pointercancel)
export function dragBar(root, { pick, show, done }) {
  let d = null;
  const at = (ev) => Math.max(0, Math.min(1, (ev.clientX - d.r.left) / d.r.width));
  root.addEventListener('pointerdown', (ev) => {
    const bar = pick(ev); if (!bar) return;
    d = { bar, r: bar.getBoundingClientRect(), pid: ev.pointerId, v: 0 };
    try { bar.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    show(bar, (d.v = at(ev)), true);
  });
  root.addEventListener('pointermove', (ev) => { if (d && ev.pointerId === d.pid) show(d.bar, (d.v = at(ev)), false); });
  const end = (ev, cancel) => { if (!d || ev.pointerId !== d.pid) return; const { bar, v } = d; d = null; done(bar, cancel ? null : +v.toFixed(2), ev); };
  root.addEventListener('pointerup', (ev) => end(ev, false));
  root.addEventListener('pointercancel', (ev) => end(ev, true));
}
