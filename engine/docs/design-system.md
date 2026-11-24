# Dashboard design system

_Applies to every dashboard built on the engine. The engine enforces most of it; `engine/_dev/tools/lint-design.sh` checks the rest. Your AI tool should read this before changing cards or styles._

## How a site gets these rules
- One engine, many sites. `engine/` = engine (core, cards, css, pages, boot/app); `sites/<site>/dash/` = that site's files (`home.js`, `popups.js`, `dashboards/`). `engine/_dev/assemble.sh` lays a site's files over the engine; the result is what you deploy.
- **Everything below lives in the engine, so a site gets it on its next deploy.** A site's job is only its config: entity map (`home.js`), views (`dashboards/*.js`), its own pop-ups (`popups.js`, optional). Never copy engine CSS or cards into a site; shared pages are imported, not copied: `pages/proxmox.js`, `pages/docker.js` (page + health rules), `pages/common.js` (Systems formatters and builders: `mbit`, `mbps`, `gb`, `fwText`, `degOf`, `host`, `fact` …). A site's Systems file is layout only; entity ids, limits, dial ranges, unit scales and impact texts are in its `home.js`.
- Engine-owned pop-ups (registered for every site by `core/popup.js`): `#trend` (history drill-in). A site's `popups.js` can't lose them.
- No site specifics in the engine: no entity ids, names, addresses or IPs in `core/`, `cards/`, `css/`, `pages/` (examples in comments are fine). The engine reads site data only through `home.js` and the dashboard configs.

## Principles
- Dark mode only; dark quiet palette; Bricolage (display) + Figtree (text).
- Headings above panels. Columns end together; no dead space; symmetry (sections hold equal content).
- Main and Mobile: same design language, different density ("think like Apple").
- Status changes never shift layout (doors / windows open is normal, no red alarms for it).
- Visible confirmations. Locks / garage = one button. Alerts unmissable.
- Never show stale data as current: show source and age.
- Speedometer gauges for what moves, bars for capacity. No fixed card heights.
- Same pop-up for a device from any view; its detail grouped in sections (pop-up tabs). On Main, near-full-screen pop-ups. Battery devices: battery ring around the icon. People: round photo + presence ring. Spinner, not a stale image, while a camera loads.
- Look at it like a designer: no box per number, no text stranded in empty space, every element earns its height (see Templates).

## Materials
- **Page** `--ink` → **glass panel** (`--glass` on `--ink`, 1 px `--hairline`, `--panel-radius`) → **wells** inside it (`--pit` + 1 px `--edge`): meters, charts, read-outs.
- **Raised** (`--veil`, `--veil-2`) = something you tap: buttons, toggles, sliders, tappable tiles. **Well** (`--pit`) = something that only shows information. Highlighted states keep their tone tint.
- Pop-ups are the same glass panel as the page (not a lighter sheet), tone glow from the header; inside them the raised / well rule applies (base.css lists the read-only classes: charts, thermostat, read-only tiles, door rows, windows rooms, alarm card, image). A tile with `mode: 'state'` and no tap / iconTap / subs gets `.ro` and becomes a well automatically.
- Traces (sparklines, history lines) carry a soft gradient fill under the line.

## Tokens (`engine/css/tokens.css`)
Card CSS never uses literal sizes or white overlays; the lint fails on them. A deliberate exception carries `/* fixed: why */` on its line (today: SVG text in viewBox units; fixed-size phone chrome: login, tab bar, More menu, phone pop-up title).

| Kind | Tokens (size at `--s: 1`) |
|---|---|
| Text | `--fs-micro` 10.5 · `--fs-small` 11.5 · `--fs-sub` 13 · `--fs-body` 14 · `--fs-name` 15.5 · `--fs-title` 19 (`--section-font` = the section heading) · `--fs-popup-title` 24 |
| Figures (readings) | `--fs-figure` 22 (meters, strips, list values) · `--fs-figure-m` 26 (a reading that leads its card) · `--fs-big` 30 · `--fs-hero` 44 · named heroes `--fs-display-s` 38, `--fs-hero-l` 52, `--fs-hero-xl` 72, `--fs-takeover` 84 · chart axis `--fs-axis` 12 |
| Icon circles (`.ic`) | `--ic-xs` 32 · `--ic-s` 36 · `--icon-circle` 40 (default) · `--ic-l` 44 (panel headers) · `--ic-xl` 52 (pop-up header) · `--ic-hero` 76 |
| Icons | `--icon-inline` 13 · `--icon-xs` 16 · `--icon-sm` 19 · `--icon` 21 · `--icon-lg` 26 · `--icon-btn` 28 · `--icon-hero` 38 · `--icon-empty` 48 · `--icon-art` 64 |
| Spacing / radius | `--sp-2 … --sp-32` · `--r-8 … --r-22`, `--r-pill`, `--tile-radius`, `--panel-radius`, `--popup-radius` |
| Overlays | `--veil-faint` .04 · `--veil` .08 · `--edge` .085 · `--hairline` .10 · `--veil-2` .11 · `--edge-strong` .16 · `--grid-line` .08 |
| Materials | `--glass` (panel) · `--pit` (well) |
| Controls | `--chip-h`, `--range-h` (range chips), `--pill-h`, `--rbtn`, `--tile-h`, `--bar-h` / `--bar-track`, `--chart-min` (smallest pop-up chart) |

**Text roles** (use these, not raw sizes, for content): `--fs-item` (the name of a thing / a row's label and value: tile names, facts, list rows, meter labels, door and log rows, agenda events) · `--fs-detail` (the line under or beside it) · `--fs-meta` (captions: 24 h range, times, tags). Rows inside a panel use `--fs-row` / `--fs-row-detail` / `--row-pad` / `--icon-row`: the item roles everywhere, one step denser on a screen-filling page (`.view.fill`: e.g. Systems on the panel and desktop), whose content has to fit the screen height. On a phone those pages don't fill, so Systems reads at the same size as Home (2026-11-03).

Tones are color channels (`--sage` OK, `--lamp` warn, `--ember` problem, `--mist`, `--plum`, `--stone`); a component colors itself with `--t` and `rgb(var(--t))` / `rgba(var(--t), var(--a-NN))`.

## Templates (use these instead of styling a card)
- **Panels:** a card type that sits in its own panel exports `panel = true` (host, devices, chart, topology, attention, weather, wx-now / wx-days / wx-hours, month, agenda, reviews, print-job, ams). Placed straight on a page (a `panel: false` section, also through a `stack`) it gets the glass panel; never inside a panel section, a pop-up or a drawer. Configs don't write `class: 'glass'` (opt out: `panel: false`; a card with extra layout classes, e.g. `'glass topo-cell'`, keeps its own class).
- **Section heading:** one size everywhere (`--section-font`): page headings (heading card), pop-up section labels (`{ type: 'label' }`), chart titles. A footnote is `{ type: 'label', note: true }` (small, muted), never a heading.
- **Several read-only figures:** one `strip` card (`cards/strip.js`): figures side by side in one well, hairlines between, small label + quiet detail over the value. Never one box per number. The history pop-up's summary and the weather cards use the same cells (`stripCell`).
- **Main vs Mobile density:** a Main page has to fit the screen, a phone page scrolls. A card that packs tight on Main may take more room on a phone (`:root[data-profile="phone"]`: bigger hero and chart, figures at reading size); see `weather.css`.
- **Lists of events:** `logbook` = one list in one well, rows split by hairlines.
- **Progress / capacity bars:** one template (`.ctrack` / `.pj-bar` / `.htrack` in base.css: `--bar-h`, track `--bar-track`, tone gradient fill with glow).
- **A chip that opens its choices** (`core/pick.js`, `css/cards/pick.css`): one chip in the place of a row of them, for a choice that narrows or orders what a card shows (a filter, a sort, which camera). It reads "Source  All ⌄": what it chooses, what is chosen; it is tinted while it narrows something. A press opens a small menu under it (above when there is no room; a sheet from the bottom on a phone), applied as chosen: one choice closes the menu, a multi-choice menu stays open and has All as its first row (nothing ticked = all). With the remote the menu is a pop-up: the highlight starts on the choice, Back closes it. Use it when the choices are secondary to the content, or too many for a row (three or more services, a camera list). Keep a row of chips when the choice is the card's main control and fits (a page's tabs, a thermostat's modes, a chart's ranges, Search's kinds), and when the chips are also the key to what is shown (a calendar's colors). A chip with nothing to choose between is hidden.
- **Selects:** options HA reports as unknown / unavailable / none are not offered as choices (segments card). An empty name is not a choice either (select card: some integrations list '' among a light's effects).
- **Charts:** `chart` card for in-page charts (real axes, range chips, legend, touch readout). A pop-up chart is never shorter than `--chart-min`; `min` / `max` clamp the axis and lines stay inside the plot; a gap in the data (unavailable) leaves the area empty.
- **Header badge:** `badge: () => 'text'` or `{ text, tone }`; a tone colors the header without being a health problem (a weak signal is not a "Needs a look" item, but isn't green either).
- **Sensor in another unit:** give the meter / chart / KPI `pair` a `scale` (never `value` alone), so gauge, trace caption and history pop-up all agree.
- **Pop-ups on phones:** tabs on their own full-width row under the title (labels for up to 3 tabs; 4+ = icons + the open tab's label). Pop-ups and tabs size to their content.

## History drill-in (`#trend`)
- Anything tracked over time opens the history pop-up: every meter (gauge + trace) and capacity bar in a `host` card automatically (owner name + metric name as the title); `devices` rows, `bays`, facts and KPIs with a `trend` spec; `chart` cards with `trend: {}` get an expand button. In code: `openTrend(spec)` (core/trend.js) or `drill(el, () => spec)` (cards/host.js).
- Spec: `{ title, icon, tone, unit, decimals, warn, crit, floor, ceil, minSpan, series: [{ entity | [entities summed], name, tone, scale }] }`.
- Pop-up: range chips 6h · 24h · 7d · 30d · 90d · 1y (last choice remembered), the live value in the header ("181° now"), Low · Average · High strip for the range (several series: each one's now + average), chart with value axis (unit on each label for % and °, one caption for other units) and time axis (hours → days → dates → months), low–high band, touch / hover readout, Y and X zoom (below).
- **Thresholds are standard:** any metric with limits passes `warn` / `crit` (lower-is-bad metrics too: `warn` > `crit`). They are always drawn with their value pill, in pop-ups and `chart` cards, and the axis stretches to show them. The same limits color the reading (sage OK, lamp, ember). Signal bands: `home.js`.
- **Zoom:** Y − / + and X − / + beside the range chips; wheel = Y, Shift + wheel = X. X zooms around the moment last tapped; no extra data is fetched, so for finer detail pick a shorter range. Reset, a new range or closing the pop-up clears it.
- **Events list:** spec `events: { title, entity, log }` adds started / ended / length under the chart (history 10 days + the sensor's `log` attribute).
- Data: 6h / 24h = recorded history (every reading); 7d / 30d = HA long-term statistics, hourly; 90d / 1y = daily. Statistics are kept forever for sensors with a `state_class`; raw history 10 days. A sensor without statistics falls back to 10 days with a note. **Every sensor given a drill-in must have statistics** (`recorder/list_statistic_ids`); if not, give it `state_class: measurement` in the site's `packages/long_term_stats.yaml`.

## A press is always answered
`core/feedback.js`, for every button on every card, nothing to do in a card: the button flashes at once, and if the press was sent to Home Assistant and nothing has come of it after a third of a second it shows a spinner until the entity it acted on changes, or for a command with nothing to change (a remote key, a button, a script, a scene) until HA has taken it (8 s at most; HA refusing ends it and shows the toast). A card that sends something later than its click handler (after a dialog or a fetch) gets only the flash.

## A button without words says its name
`core/tips.js`, for every card: a button that shows only an icon carries an `aria-label`, and the engine shows those words in one small label beside the button (its own element on the page, so no card can cut it; above the button, under it when there is no room, never off the screen). A button that shows words gets none, whatever its `aria-label`.
- **TV:** once the highlight, moved there with an arrow, has rested half a second on the button; the label goes after four seconds or with the next press. A highlight the page placed itself (a pop-up opening on Play) names nothing.
- **Computer:** while the mouse rests on the button, after the same wait.
- **Touch:** nothing (a held finger already means other things).

A card never draws a label of its own and never uses `title` (the browser's own tooltip would come on top). The name says what a press does, in a word or two ("Next", "All cameras"), and follows the button when that changes ("Pause" / "Resume"). Buttons a config supplies take their name there: `label` on a heading's or the status line's button, `name` on a tile's `subs` and on a `buttons` card's button. The regression check lists every icon button on screen that has no name.

## Adding something
- **A new card type:** what its module must do is in `card-contract.md` (what it gets, reading Home Assistant, being unloaded, presses, the remote). CSS in `css/cards/<type>.css`, wrapped in `@layer cards { … }`, listed in `boot.js` CARDS, tokens only; `export const panel = true` if it is a content panel; read-only content in pop-ups → add its class to the well list in base.css; add it to a gallery category (`dashboards/gallery.js`). It must be used by a dashboard, pop-up or page (lint: no dead cards).
- **A new pop-up:** cards and templates above, nothing styled per pop-up; check it at phone size (`--popups <id>`).
- **A new reading:** gauge + trace (host meter) for what moves, bar for capacity; it drills in automatically in a host card, otherwise give it a `trend` spec; check its statistics.
- **A new site:** its own `home.js` + `dashboards/`; reuse shared pages; run the checks below against it (`shot.sh live <site>`).

## Screens
Pages are shared; each dashboard is a thin shell for a kind of screen (its Home, its navigation) and picks the pages it shows (no screen is the reference). Every big-screen page must work on all of these, in CSS px:

| Screen | Size | Notes |
|---|---|---|
| TV | 960×540 | a 1080p Google TV at density 2: little room, read from across the room (`tv` profile, remote) |
| Panel | 1280×800 | a wall panel (the Portal today) |
| Desktop | 1920×1080 | a browser window |
| Vertical | 1080×1920 | a portrait wall screen (16–21") |

- **The rail fits its views** (`core/rail.js`): ten views and the site's link fit an 800 px screen at the rail's own spacing; with more, the links give up padding (`--rail-pad`) before the rail has to scroll. The cover of the song that plays is not counted: with it a full rail scrolls.
- **Fill only when it fits** (`core/fit.js`): a page that fills the screen (`fill`, `grow`, row templates) keeps doing so while every squeezed card has room for its content; otherwise it gets `.nofill`: natural heights, and the page scrolls. Never squeeze cards on top of each other. Portrait screens never fill. A card that normally takes the height it's given (charts, meters) needs a size of its own under `.nofill`.
- **Cards fold by their own width** (`@container cell`), never by device or profile: a narrow card on a TV needs the same layout as one on a phone.
- On a TV the remote scrolls a page (Down with nothing below to select).
- **What a TV leaves out is written with the card.** A view, page, section, card, fact or pop-up may carry `tv: false` (not on a TV) or `tv: { ...options }` (these options instead); a site's TV dashboard builds its pages from the big-screen ones with `tvCopy` (`core/layout.js`). Never find a card to trim by its title or its position.
- **Nothing on a TV page moves without end.** A Google TV redraws its whole 1080p screen for any change, at up to 170% of its four cores for as long as something animates (measured 2026-11-13: one 32 px animated weather icon, a progress bar gliding through a song, the queue's playing bars). So on the `tv` profile: weather icons are the still copies (`core/forecast.js`), progress steps instead of gliding, and an animation started from script is canceled with its element and paused out of sight (`cards/topology.js`). A spinner or an alert pulse that ends by itself is fine. One exception by choice: the radar loop keeps playing on a TV (a radar that stands still isn't a radar). Check a new TV page over adb (`tv/launcher/README.md`, Looking inside a TV's page) or with Chrome's Performance panel: an idle page draws no frames.
- **The remote's highlight** is the engine's: one rule in `css/cards/remote.css` draws it just inside the focused item's edge (`outline-offset` minus its width), so a scroll box, a card with `overflow: hidden` or the screen's edge can't cut it. A component never moves it outside (the only ones outside are the media tiles that grow when focused: apps, Continue watching, whose rows leave room). Where a box should wear the ring for the button inside it (a Rooms tile, the search box), the box draws it (`:has(> x:focus)` / `:focus-within`, the button's own ring off) and carries `data-ring-box`: the remote then brings the whole box into view, not just the button. `focuscheck.mjs` (Checks) fails on a cut ring; it ran clean on 2026-11-16 after the change (before it: Rooms tiles, the music rows, Party, the printer camera, the queue).
- **Leaflet maps on a TV** load with 3D transforms off (`cards/map.js`): with them every tile is its own GPU layer (the radar's frames were ~200 MB of graphics memory).

## Checks
The tools are in `engine/_dev/tools/` and each says how to call it in its first lines. The When column names three levels: `fast` = every commit (a pre-commit hook), `deploy` = before every dashboard deploy, `full` = before and after an engine-wide change. The author's own repository has one script that runs each level; it is not part of this one, so run the tools themselves. Set-up: `engine/_dev/README.md`, Checks. Keep verification proportionate (it costs turns and tokens, not just time): run what proves the change.

| Check | What it finds | When |
|---|---|---|
| ESLint (`eslint.config.mjs`) | a name that isn't defined, an import or variable nobody uses, a key written twice | every commit |
| `lint-design.sh` | literal sizes and white overlays in card CSS (a deliberate one carries `/* fixed: why */`), a card type nothing uses, a stylesheet not loaded or with no file, a custom property nothing defines | every commit |
| unit tests (`node --test engine/_dev/test/`) | the engine's logic without a browser: store, scope, actions, formats, health rules, rooms in sync. A test marked `todo` is a known mistake waiting for its fix | every commit: the test files that cover what is staged (`engine/_dev/tools/tests-for.mjs` reads it off the imports); all of them in `fast --all` and before every deploy |
| `linkcheck.sh` | an import that doesn't resolve, a name a module doesn't export, in the assembled site; in a file that starts with `// @ts-check` (a site's `home.js`, with the shapes of `core/shapes.js`; the engine's spine: `app.js`, the router, the rail, the phone shell, the layers, the remote), also a required key left out, a misspelled key, a value of the wrong kind, a call with the wrong arguments | every deploy |
| `check-site.mjs <site>` | a site's config: a card type that doesn't exist, an option the card never reads, a link to a pop-up or view that isn't there, a `home.js` key that doesn't exist, an entity id HA doesn't have (`--entities FILE`, or `--mock`) | every deploy |
| `smoke.mjs` | every dashboard of the site loads on the mock with no error or warning, and every module of the build imports | every deploy |
| `regress.sh mock\|live <site> -- --out DIR [--baseline DIR] [--only <dashboard>]` | every dashboard at its own size (TV 960×540, phone 412×915, else 1280×800), every view, page and pop-up: views that scroll, cards that overlap or cut their content, console errors and warnings, `NaN` / `undefined` on screen, an icon button with no name, dead links, entity ids, pixel diff against a baseline run | an engine-wide change, before and after |
| `unloadcheck.mjs` | what an unloaded view or pop-up leaves behind: watchers, ticks, intervals, timeouts, listeners, sockets, media sources (two rounds; growth fails) | a change to a card's timers, listeners, observers or streams |
| `focuscheck.mjs` | on the TV dashboard (`--tv <id>`, else the site's first), every view and pop-up: each element the remote reaches is focused as the remote does it, and its highlight ring must be whole: no scroll box, card that crops what it holds, or screen edge may cut a side of it (rounded corners aren't looked at) | `deploy` when engine styles, cards, `core/remote.js` or the site's dashboards changed since the site's last dashboard deploy (~75 s for the house); every `full` |
| `navcheck.mjs` | a view or pop-up asked for twice in a row is built once, and one pop-up is up at a time | a change to navigation |
| `readoutcheck.mjs` | a chart card and the history pop-up show a value under the mouse and clear it when the mouse leaves (`--view` names a view with a chart that has the expand button) | a change to the charts or `core/readout.js` |
| `tipcheck.mjs` | an icon button's name shows after a rest (the mouse on a big-screen dashboard, the remote's highlight on the TV dashboard), says the button's `aria-label`, sits on the screen beside the button, and goes again; none for a finger or for a highlight the page placed (`--view` / `--tvview` name a view with an icon button in reach) | a change to `core/tips.js` or its style |
| `bootcheck.mjs` | a build that doesn't start reloads itself once a new one is deployed | a change to `boot.js` or the start of `app.js` |
| `resilience.mjs` | Home Assistant away and back (a blip, a 10 s outage, a refused sign-in, slow answers, a press whose answer is lost): the "Not connected" bar, the page hearing changes again, nothing watched twice, no button left spinning; and a card type's file that doesn't arrive: the view or pop-up says so, what was on screen stays, the next press opens it; lost while the page starts, the page runs all the same and its first view comes by itself | a change to `core/ha.js`, `core/store.js`, `core/feedback.js`, `core/router.js`, the start in `app.js`, the loading in `core/layout.js` / `core/popup.js` or the offline bar |
| `fitcheck.mjs` | one dashboard at several sizes, with screenshots per size (`--sizes`, `--views`, `--strict`) | a close look at one page across screens |
| `shot.sh mock\|live <site> -- --view <v> --size WxH --out x.png` | one screenshot (`--popups <id>`, `--press 'ArrowDown Enter'`) and that view's errors; look at the picture | any visible change |

- **Small change** (one card, page, style or config): the commit's checks, then a screenshot of the affected view at the sizes it affects. Read its `page …` line: `SCROLLS` = a Main view overflows the panel.
- **A stylesheet change meant to change nothing** (rules moved between files, a file put in a cascade layer, a selector rewritten): both runs with `--styles`. Each screen's elements are saved with everything they are styled as (`lib/styles.mjs`; hidden elements too), and the second run lists every element and property that differs, the measured sizes apart (those follow the mock's clocks and live values, as do a recording's progress and a timer). `--size WxH` opens every dashboard at another size (320x800, 250x800, 800x700): the narrow versions of cards, each in its card's file inside `@container`, are mostly out of reach at the usual sizes. Compare runs of the same dashboards (`--only` the same on both): where the TV's focus starts depends on what was opened before. About six minutes for the house.
- **Cascade layers** (`tokens.css` declares their order, weakest first): `reset, vendor, parts, shell, cards, context, profile, state`. A rule in a later layer wins over one in an earlier layer whatever their selectors, so a file's layer says what it may override. `base.css` holds reset, parts (`.ic .name .sub .pill .chip`, bars), shell (page, grid, pop-up chrome, toast), context (the well rule inside a pop-up), profile (the phone) and state (`.confirm`, `.pending`, `.tapped`, `.working`); every file in `css/cards/` is wrapped in `@layer cards { … }`, except `remote.css` (`profile`). Leaflet's stylesheet is loaded into `vendor` (`cards/map.js`), under all of ours. Every rule is in a layer: one outside would win over all of them. An `!important` reverses the order (an earlier layer's wins), so there are few and each says why. A card's rule that must win over a pop-up's or the phone's generic rule goes in a `@layer context` / `@layer profile` block in the card's own file (as in `popup-tabs.css`).
- **Engine-wide change** (tokens, `base.css`, layout, shared cards, `core/`): `regress.sh … --out before`, the change, `regress.sh … --out after --baseline before`; look only at what it lists. About three minutes for a site with five dashboards. Clocks, cameras and moving data change a few screens a few % on every run.
- **Unloading**: views and pop-ups are removed a while after you leave them, with everything their cards hooked up (`core/scope.js`). A card that hooks something up later (after a fetch) must check `el.isConnected` or call `onDispose` while it is built; a timer it re-arms needs an `onDispose` that stops it; a shared poller a card starts goes in `outside()`.
- The mock (`engine/_dev/mock/`, data in `sites/<site>/mock/states.mjs`) stands in for HA; its header lists the variants (`MOCK_VARIANT`) and the faults it can play (a dropped link, slow answers, a refused sign-in). It plays a made-up Music Assistant behind the relay's websocket types (`mock/music.mjs`; `MOCK_MA=off` is an HA without the relay). Each check run starts its own mock on a free port, so runs don't disturb each other; on a small machine run the long ones one at a time.
- The gallery (`gallery.html`: every card type at four sizes, clipping finder, style baseline / compare) is for looking, not for a verdict.
- Side issues found while checking: note them with a one-line diagnosis and ask before chasing them, unless they block the task.
