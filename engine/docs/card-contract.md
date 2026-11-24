# The card contract

What the engine promises a card and what a card must do. The rules here are the ones the code enforces or relies on;
how a card should look is in `design-system.md`, what a site supplies in `integrations.md`.

## A card type
- One module, `cards/<type>.js`, loaded by its name the first time a view or pop-up names it (`core/layout.js`).
- `export default (cfg, ctx) => HTMLElement`. **Synchronous**: it returns its element at once and fills it in later.
  A factory that throws leaves "Card error: <type>" in its cell and the rest of the view stands; a type whose module doesn't load
  fails the view or pop-up that names it: what was on screen stays, the user is told, and the next press asks for it
  again (the first view of a page that is starting is asked for again by itself). "Unknown card: <type>" is a type no list named before it was built (see `preload` below).
- `export const panel = true` (optional): placed straight on a page, the card sits in its own glass panel.
- The header comment of the module lists its options. That comment is the card's documentation.
- A module may export helpers other cards import (`host.js` `meter`, `strip.js` `stripCell`, `media.js` `artUrl`). Shared
  logic with no markup belongs in `core/`.
- Its stylesheet is `css/cards/<type>.css` (`design-system.md`, "Adding something").

## What the factory gets
The shapes below are also written as types in `core/shapes.js` (`CardConfig`, `CardCtx`, `Action`, `View`, `PopupDef`,
`Dashboard`): a file that starts with `// @ts-check` can name them, and the link check then holds it to them.

`cfg` is the card's config object as the dashboard wrote it. The layout reads these keys for every card, so a card must
not give them another meaning:

| Key | Meaning |
|---|---|
| `type` | the module's name |
| `span`, `wide` | width in grid units; `wide`: a full row when a big-screen page reflows on a phone |
| `class` | classes for the cell (`glass`); `panel: false` opts out of the type's own panel |
| `grow` | the card takes the height left in its column |
| `show` | `{ entity, state \| not \| below \| above }`, `{ when, entities, every }`, or a list: the cell is hidden otherwise; a section whose every cell is hidden is hidden too (no empty panel) |
| `tv` | `false` or `{ …options }`: applied by `tvCopy` before the card is built; a card never sees it |
| `cards` | nested cards. Only this key is searched for the types to load before a view is built |

`ctx`:

| Field | Use |
|---|---|
| `home` | the site's `home.js` module |
| `cell` | the grid cell the element goes into (for a class the cell itself needs) |
| `grid(cards, cols, home, rows)` | builds nested cards the way a section does (`stack`, `drawer`); their types are already loaded |
| `preload(cards)` | loads card types for cards built later than the view (a list filled after a fetch) |
| `setVisible(bool)` | the card hides or shows its own cell (nothing to show); works together with `show` |

`run(action, { el, ev, entity })` in `core/actions.js` takes a different object: the pressed element, the event, and the
entity the action is for. A config's `tap` / `hold` / button actions always go through `run`, never through `ha.call`
written in the card, so confirm, optimistic state, navigation and the press feedback work the same on every card.

## Reading Home Assistant
- `watch(ids, draw)` (`core/store.js`): `draw` runs now if states have arrived, and again in the next frame after any of
  `ids` changes. Naming an entity in `watch` is also what subscribes the page to it: an entity that is only read with
  `st()` never arrives.
- `tick(fn)`: once a second while the page is visible, for countdowns and "5 min ago".
- A music player is read through its session, never entity by entity: `const S = session(player)` (`core/session.js`),
  `S.snap` (one frozen snapshot per change: the song as every card shows it, which entity takes each control, the queue)
  and `onDispose(S.on(draw))`. The session watches the player's entities for as long as a card listens, so the card
  watches only what else it shows. A card told by several sources at once wraps its draw in `soon(draw)`
  (`core/store.js`): one draw for all that come together. `watch` returns its own undo, for the rare watch made outside
  a view (`outside()` in `core/scope.js`).
- Read with `st(id)` (state object or null), `state`, `has` (it reports: not missing, `unavailable` or `unknown`), `num`,
  `attr`, `isOn`. A reading that does not report is shown as "Not reporting" (or left out), never as a value, never as
  OK and never as an alarm (`core/states.js`, `core/assess.js`).
- A draw must be cheap and safe to repeat: it runs for every change of every watched entity. Write with `setText` /
  `setHTML` (`core/dom.js`), which touch the page only when the text differs, and put everything that came from Home
  Assistant or a config through `esc()` before it goes into markup.
- A draw that throws is logged and the other cards go on.

## Files of the build
A picture, a sound or a vendored script is addressed with `asset('assets/…')` (`core/asset.js`), which adds the file's
content hash from `version.json`: Home Assistant lets browsers keep `/local` files for 31 days, and only a new address
gets a replaced file onto a screen. Modules and stylesheets get theirs from the loader.

## Being unloaded
A view or pop-up that has been hidden for a while is removed with everything its cards hooked up (TV 60 s, panel and
phone 180 s, a computer with 8 GB or more 600 s; `dash.unload`, `?unload=`). The first view and `dash.unload.keep` stay.

**Undone for the card**, when it is set up synchronously inside the factory call (`core/scope.js` records it):
`watch`, `tick`, `onStatus`, `onReady`, `onCallFail`, `onPerf`, `setInterval`, `addEventListener` on `window` and
`document`, `ResizeObserver` / `IntersectionObserver` / `MutationObserver`, and every `onDispose(fn)`.

**The card's own job**, with `onDispose(fn)` called in the factory body: `setTimeout` chains, `requestAnimationFrame`
loops and script-started animations, listeners on `document.body` or any other node that outlives the card, websockets
and subscriptions of its own (a Music Assistant queue, a camera stream), media elements, object URLs, Leaflet maps.

Three rules follow:
1. **Hook up in the factory body, never in a draw or after a wait.** The first draw of a page's first view runs after
   the factory returned (states arrive later), so a listener added there is recorded on one screen and not on another.
   What can only be set up later (after a fetch, on a click) registers its clean-up up front: `let stop = null;
   onDispose(() => stop && stop());` in the body, `stop = …` later; and it checks `el.isConnected` before it touches
   the page.
2. **`onDispose` after the factory returned is lost.** Nothing would ever run it. `scope.dropped()` counts these and
   the navigation check fails when the count rises after start-up.
3. **A thing shared between cards is started inside `outside(fn)`** (a poller every weather card reads, a cache's own
   watcher): otherwise it is recorded with the first view that happened to use it and ends with that view.

Listeners on the card's own element and its children need nothing: they go with the element.

## Presses
- Every button and tappable card is a `<button>`, a link, or an element the remote can reach (below). A press is
  answered by `core/feedback.js` for every button on every card (`design-system.md`, "A press is always answered"): a
  card adds no spinner or flash of its own. The spinner belongs to what is sent while the click is being handled: a
  call sent later (after a dialog or a fetch) gets only the flash, so send in the handler where that is possible.
- A button that shows no words (an icon, a bare − or +) has an `aria-label` saying what a press does. The engine shows
  it beside the button after a rest of the mouse or the remote's highlight (`core/tips.js`; `design-system.md`, "A
  button without words says its name"), and a screen reader says it. No `title`, no label of the card's own.
- State shown before Home Assistant confirms goes through `expect` on the action or `optimistic()` in the store, which
  give way to the real state (or after 12 s), never through a value the card keeps on the side.
- Navigation is an action (`{ nav: '#popup' }`, `{ view }`, `{ drawer }`) or one of the events below. A card never
  changes `location` itself.

## Events
On `window`, for anything that is not an entity change:

| Event | Sent by | Meaning |
|---|---|---|
| `dash:view` (detail: `'view'` or `'view/page'`) | any card | show that view |
| `dash:drawer` (detail: id) | actions | open the pull-out drawer with that id |
| `dash:camfull` (detail: true / false) | camera cards | a camera went to or left full screen |
| `dash:shown` (detail: `{ view, changed }`) | `core/router.js` | a navigation is done and on screen; `changed`: to another view or page than before |
| `dash:layers` (detail: `{ opened }`, `{ closed, opener }` or `{ changed }`) | `core/layers.js` | a layer opened or closed (below) |
| `dash:calendars` | `core/calendars.js` | a calendar was shown or hidden on some card: the others follow |
| `tv:resume` | the TV launcher | the screen is shown again after an app: refresh what may be old |

## Layers: what is on top of the page
A pop-up, the drawer, a chip's menu, a full-screen camera, the confirm dialog and the take-overs (the timer's alarm, a
camera alert) are layers, and `core/layers.js` is the one place that knows which are open and which is on top: a
the timer's alarm, then the confirm dialog, then a camera alert, then the rest, the one opened last first. The top layer holds the remote's
highlight; Back on a TV and Escape on a keyboard close it, one layer per press; when it goes, the highlight returns to
where it was when it opened. Home closes every layer but a take-over. The page does not reload for a new version under
a pop-up, a full-screen camera, the dialog or a take-over.

A card that shows something over the page, or over itself (a song's menu, a sheet, a list that takes the remote for a
while), makes a layer and says when it opens and closes. `close` is the card's own way to close it and ends in `shut()`:

```js
import { layer } from '../core/layers.js';
const L = layer({ el, kind: 'menu', close: () => hide() });   // kind: 'popup' | 'drawer' | 'menu' | 'camera' | 'sheet' | 'dialog' | 'takeover'
const show = () => { el.hidden = false; L.open(); };
const hide = () => { el.hidden = true; L.shut(); };
```

`L.open(from)` names the element it was opened for when that is not where the focus is (a row that was tapped with a
finger, the row behind a menu that has just closed); it is where the highlight returns. The card never puts the focus
back itself. It may put it somewhere *inside* the layer right after `open()` (the first choice of a menu); otherwise the
remote picks the first thing in it. Layers that close together (a menu with the list it is in) are one return of the
highlight, to where the outermost one was opened from.

`scope` (an element inside `el`) narrows where the highlight may go; `aside: true` is for what is shown beside the page
and never holds the highlight (a camera alert in a TV's corner), which Back still closes first. A layer closes the menus
and the full-screen camera opened from inside it. `L.changed()` says its content was replaced while it stayed open. Nothing else should listen for Escape or look for `.popup`, `.alarm` and the like to know what
is open: ask `top()`, `layers()` or `any()`.

## The TV remote
On the `tv` profile every `<button>`, link, tile and camera takes the highlight (`core/remote.js`); a card needs to do
something only when the default is wrong:

| On an element | Meaning |
|---|---|
| `data-focus` / `data-nofocus` | it takes the highlight / it does not |
| `data-subs` | an item with buttons of its own (`.sb`): one stop, OK is the item's own tap; Right goes into its buttons, Left from the first comes back |
| `data-focus-first` | where the highlight starts on a page or pop-up |
| `data-enter="selector"` | on a list: arrowing in from outside lands on that item |
| `data-backto="selector"` | Back from inside goes to the nearest match (the switch that chose this panel) |
| `data-hold` | OK held sends `dash:hold`; while the element has `.adjusting`, Left / Right send `dash:adjust` (detail -1 / 1) and OK or Back `dash:adjust-end` |

OK sends the element `dash:ok` before the click: a card that calls `preventDefault()` on it does its remote action
instead (a dimmer tile toggles). Back never repeats or undoes an action. Nothing on a TV page animates without end
(`design-system.md`, Screens).

## Before a card is done
- It is used by a dashboard, pop-up or page, and listed in a gallery category (`pages/gallery.js`).
- The deploy checks pass (lint, links, the site validator, every dashboard loads), and after a change to how it hooks
  things up, the unload and navigation checks (`design-system.md`, Checks).
- Logic that can be wrong without looking wrong (a rule, a unit, a time) is a plain function with a unit test in
  `_dev/test/`.

## URL parameters
`index.html` / `start.html` take:

| Parameter | Meaning |
|---|---|
| `d=<name>` | the dashboard (`dashboards/<name>.js`; default `main`) |
| `p=portal\|tablet\|phone\|tv` | the profile, instead of the dashboard's own (a narrow window is `phone` unless the dashboard is a TV's) |
| `v=<view>` or `<view>/<page>` | the view to open on; kept up to date as you move, so Back and a reload return to it |
| `#<popup>` or `#<popup>/<page>` | the pop-up to open |
| `s=<number>` | the scale `--s`, instead of the one worked out from the screen |
| `unload=<seconds>` | when a hidden view is unloaded; `0` keeps everything |
| `perf=1\|0` | the timing readout |
| `chrome=1` | inside Home Assistant's Webpage dashboard: keep HA's top bar |
| `musicq=<words>` | the Music page's Search opens with these words (links, screenshots) |
| `overlay=1` | set by the TV launcher: this page is the take-over page (alerts and timers only, over another app) |
| `tvdemo=1` | in a browser, a TV page's Continue watching gets made-up shows (on a TV the launcher supplies them) |
| `code`, `state` | Home Assistant's sign-in coming back; removed from the address once read |

A site's own dashboards may read more (a TV dashboard's `tv=<id>`). `gallery.html` takes `v=<category>` and `z=<zoom>`.
