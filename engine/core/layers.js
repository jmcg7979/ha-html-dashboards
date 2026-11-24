// @ts-check
// What is on top of the page, in one place: a pop-up, the drawer, a chip's menu, a card's own menu, a full-screen
// camera, the confirm dialog, a take-over (the timer's alarm, a camera alert). Whoever shows one says so here, and
// everything that has to know asks here: the TV remote (which layer holds the highlight, what Back closes:
// core/remote.js), Escape on a keyboard, the reload after a deploy (not while something is open: core/reload.js), the
// TV launcher's take-over page (app.js).
//
//   const L = layer({ el, kind, close, scope, aside })   made once by the owner of what opens
//     el      the element that is the layer (hidden, or off the page, it does not count, whatever was said)
//     kind    'popup' | 'drawer' | 'menu' | 'camera' | 'sheet' | 'dialog' | 'takeover'
//     close   () => the owner's own way to close it, as its close button would (it ends in L.shut())
//     scope   the element the remote's highlight is kept in while this is the top layer; default: el
//     aside   true: it is shown beside what goes on (a camera alert in a TV's corner): it never holds the highlight,
//             and Back still closes it first
//     rank    only to put one kind's layer above the others, as it is drawn (the timer's alarm: 4)
//   L.open(from)   it is on screen now. What had the focus is remembered as its opener (or `from`: the element it was
//              opened for, when the focus is elsewhere: a row that was tapped, the row behind a menu that just closed)
//   L.shut()   it is gone. What was opened from inside it closes with it: a menu, a camera in full screen (never a
//              dialog or a take-over: closing those is somebody's answer)
//   L.changed()   what it shows was replaced while it stayed open: the remote places its highlight again
//   L.on       whether it is open
//
// A card's own menu or sheet (a song's menu in the queue, the Music page's sheet) is one of these too, of kind 'menu'.
//
// Which is on top, as they are drawn: the timer's alarm, then the confirm dialog, then a camera alert, then the others,
// the one opened last first.
//   top()        the layer that holds the screen (never an `aside` one), or null: the page itself
//   layers()     every layer showing, top first
//   any()        whether anything is
//   back()       closes the top one, an `aside` take-over before anything else -> whether there was one
//   closeAll(keep)   closes all of them, top first, but those `keep(layer)` says to leave
//   holding()    whether one is open that somebody is looking at or has to answer (not a menu, the drawer or a sheet
//                left open): the page does not reload under it
//   initLayers() once per page: Escape closes the top layer (a key the remote has not taken), a menu whose opener left
//                the screen with its view is closed
// Every open(), shut() and changed() sends `dash:layers` on window: detail { opened: layer }, { closed: layer, opener:
// element | null } or { changed: layer }.
const RANK = { dialog: 3, takeover: 2 };
const stack = [];   // the layers opened here and not shut, in the order they opened
let count = 0;

const live = (el) => !!el && el.isConnected && !el.closest('[hidden]');
const emit = (detail) => dispatchEvent(new CustomEvent('dash:layers', { detail }));
const within = (el, l) => !!el && l.el !== el && l.el.contains(el);
const weak = (el) => (typeof WeakRef === 'function' ? new WeakRef(el) : { deref: () => el });
// an owner's close() that throws must not leave the others open or unsaid
const closing = (l) => { try { l.close(); } catch (e) { console.error(e); } };

export function layer(def) {
  const L = {
    el: def.el, kind: def.kind, scope: def.scope || def.el, aside: !!def.aside, rank: def.rank || RANK[def.kind] || 1, close: def.close, n: 0, from: null,
    get on() { return stack.includes(L); },
    open(from) {
      if (L.on) return;
      const a = from || document.activeElement;
      L.n = ++count; L.from = a && a !== document.body ? weak(a) : null;
      stack.push(L); emit({ opened: L });
    },
    shut() {
      const i = stack.indexOf(L); if (i < 0) return;
      stack.splice(i, 1);
      const opener = L.opener(); L.from = null;
      // what was opened from inside it goes with it: a camera in full screen in a pop-up, a chip's menu (on the body: its
      // opener says where it came from)
      stack.filter((x) => x.rank === 1 && (within(x.el, L) || (x.kind === 'menu' && within(x.opener(), L)))).forEach(closing);
      emit({ closed: L, opener });
    },
    changed() { if (L.on) emit({ changed: L }); },
    opener: () => (L.from && L.from.deref()) || null,
  };
  return L;
}

export function layers() {
  for (let i = stack.length - 1; i >= 0; i--) if (!stack[i].el.isConnected) stack.splice(i, 1);   // taken off the page without a word
  return stack.filter((l) => live(l.el)).sort((a, b) => b.rank - a.rank || b.n - a.n);
}
export const top = () => layers().find((l) => !l.aside) || null;
export const any = () => layers().length > 0;
export function back() {
  const l = layers()[0]; if (!l) return false;
  closing(l); return true;
}
/** @param {(layer: { kind: string, aside: boolean }) => boolean} [keep] */
export function closeAll(keep = (_layer) => false) {
  layers().filter((l) => !keep(l)).forEach((l) => { if (l.on) closing(l); });
}
const HOLDS = ['popup', 'camera', 'dialog', 'takeover'];
export const holding = () => layers().some((l) => HOLDS.includes(l.kind));

let started = false;
export function initLayers() {
  if (started) return; started = true;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented && back()) e.preventDefault(); });
  addEventListener('dash:shown', () => stack.filter((l) => l.kind === 'menu' && l.opener() && !live(l.opener())).forEach(closing));
}
