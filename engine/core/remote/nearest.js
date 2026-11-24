// @ts-check
// Which item an arrow key goes to: the nearest one in that direction, over plain rectangles (no DOM).

/**
 * @typedef {{ left: number, right: number, top: number, bottom: number, width: number, height: number }} Rect
 */

/**
 * @param {Rect} from the rectangle of the item that has the highlight
 * @param {Rect[]} rects the rectangles it could go to (without `from` itself)
 * @param {number[]} d the direction: [1, 0] right, [-1, 0] left, [0, 1] down, [0, -1] up
 * @param {(index: number) => boolean} [usable] false for a rectangle that counts for the row rule but can't be chosen
 *   (it holds `from` or is in it)
 * @returns {number} the index of the one to go to, or -1
 */
export function nearest(from, rects, d, usable = (_index) => true) {
  const r = from, idx = rects.map((_, i) => i);
  // Left / Right stay on the row when something on it lies that way (a control row under a list goes along the row, not up into the list)
  const row = d[0] ? idx.filter((i) => { const q = rects[i]; return q.bottom > r.top && q.top < r.bottom && (d[0] > 0 ? q.left >= r.right - 1 : q.right <= r.left + 1); }) : [];
  let best = -1, bd = Infinity;
  for (const i of row.length ? row : idx) {
    if (!usable(i)) continue;
    const q = rects[i];
    // distance between the nearest edges along the direction, and the offset across it (overlap counts as 0)
    const along = d[0] ? (d[0] > 0 ? q.left - r.right : r.left - q.right) : (d[1] > 0 ? q.top - r.bottom : r.top - q.bottom);
    if (along < -Math.min(r.width, r.height) / 2) continue;   // behind us
    const across = d[0] ? Math.max(0, q.top - r.bottom, r.top - q.bottom) : Math.max(0, q.left - r.right, r.left - q.right);
    const center = d[0] ? Math.abs((q.top + q.bottom) / 2 - (r.top + r.bottom) / 2) : Math.abs((q.left + q.right) / 2 - (r.left + r.right) / 2);
    const score = Math.max(0, along) + across * 3 + center * 0.1;
    if (score < bd) { bd = score; best = i; }
  }
  return best;
}
