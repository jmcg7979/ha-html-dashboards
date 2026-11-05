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

Tones are colour channels (`--sage` OK, `--lamp` warn, `--ember` problem, `--mist`, `--plum`, `--stone`); a component colours itself with `--t` and `rgb(var(--t))` / `rgba(var(--t), var(--a-NN))`.

## Templates (use these instead of styling a card)
- **Panels:** a card type that sits in its own panel exports `panel = true` (host, devices, chart, topology, attention, weather, wx-now / wx-days / wx-hours, month, agenda, reviews, print-job, ams). Placed straight on a page (a `panel: false` section, also through a `stack`) it gets the glass panel; never inside a panel section, a pop-up or a drawer. Configs don't write `class: 'glass'` (opt out: `panel: false`; a card with extra layout classes, e.g. `'glass topo-cell'`, keeps its own class).
- **Section heading:** one size everywhere (`--section-font`): page headings (heading card), pop-up section labels (`{ type: 'label' }`), chart titles. A footnote is `{ type: 'label', note: true }` (small, muted), never a heading.
- **Several read-only figures:** one `strip` card (`cards/strip.js`): figures side by side in one well, hairlines between, small label + quiet detail over the value. Never one box per number. The history pop-up's summary uses the same cells (`stripCell`).
- **Lists of events:** `logbook` = one list in one well, rows split by hairlines.
- **Progress / capacity bars:** one template (`.ctrack` / `.pj-bar` / `.htrack` in base.css: `--bar-h`, track `--bar-track`, tone gradient fill with glow).
- **Selects:** options HA reports as unknown / unavailable / none are not offered as choices (segments card).
- **Charts:** `chart` card for in-page charts (real axes, range chips, legend, touch readout). A pop-up chart is never shorter than `--chart-min`; `min` / `max` clamp the axis and lines stay inside the plot; a gap in the data (unavailable) leaves the area empty.
- **Header badge:** `badge: () => 'text'` or `{ text, tone }`; a tone colours the header without being a health problem (a weak signal is not a "Needs a look" item, but isn't green either).
- **Sensor in another unit:** give the meter / chart / KPI `pair` a `scale` (never `value` alone), so gauge, trace caption and history pop-up all agree.
- **Pop-ups on phones:** tabs on their own full-width row under the title (labels for up to 3 tabs; 4+ = icons + the open tab's label). Pop-ups and tabs size to their content.

## History drill-in (`#trend`)
- Anything tracked over time opens the history pop-up: every meter (gauge + trace) and capacity bar in a `host` card automatically (owner name + metric name as the title); `devices` rows, `bays`, facts and KPIs with a `trend` spec; `chart` cards with `trend: {}` get an expand button. In code: `openTrend(spec)` (core/trend.js) or `drill(el, () => spec)` (cards/host.js).
- Spec: `{ title, icon, tone, unit, decimals, warn, crit, floor, ceil, minSpan, series: [{ entity | [entities summed], name, tone, scale }] }`.
- Pop-up: range chips 6h · 24h · 7d · 30d · 90d · 1y (last choice remembered), the live value in the header ("181° now"), Low · Average · High strip for the range (several series: each one's now + average), chart with value axis (unit on each label for % and °, one caption for other units) and time axis (hours → days → dates → months), low–high band, touch / hover readout, Y and X zoom (below).
- **Thresholds are standard:** any metric with limits passes `warn` / `crit` (lower-is-bad metrics too: `warn` > `crit`). They are always drawn with their value pill, in pop-ups and `chart` cards, and the axis stretches to show them. The same limits colour the reading (sage OK, lamp, ember). Signal bands: `home.js`.
- **Zoom:** Y − / + and X − / + beside the range chips; wheel = Y, Shift + wheel = X. X zooms around the moment last tapped; no extra data is fetched, so for finer detail pick a shorter range. Reset, a new range or closing the pop-up clears it.
- **Events list:** spec `events: { title, entity, log }` adds started / ended / length under the chart (history 10 days + the sensor's `log` attribute).
- Data: 6h / 24h = recorded history (every reading); 7d / 30d = HA long-term statistics, hourly; 90d / 1y = daily. Statistics are kept forever for sensors with a `state_class`; raw history 10 days. A sensor without statistics falls back to 10 days with a note. **Every sensor given a drill-in must have statistics** (`recorder/list_statistic_ids`); if not, give it `state_class: measurement` in the site's `packages/long_term_stats.yaml`.

## Adding something
- **A new card type:** CSS in `css/cards/<type>.css` listed in `boot.js` CARDS, tokens only; `export const panel = true` if it is a content panel; read-only content in pop-ups → add its class to the well list in base.css; add it to a gallery category (`dashboards/gallery.js`). It must be used by a dashboard, pop-up or page (lint: no dead cards).
- **A new pop-up:** cards and templates above, nothing styled per pop-up; check it at phone size (`--popups <id>`).
- **A new reading:** gauge + trace (host meter) for what moves, bar for capacity; it drills in automatically in a host card, otherwise give it a `trend` spec; check its statistics.
- **A new site:** its own `home.js` + `dashboards/`; reuse shared pages; run the checks below against it (`shot.sh live <site>`).

## Checks
Keep verification proportionate (it costs turns and tokens, not just time):
- **Small change** (one card, page, style or config): `engine/_dev/tools/lint-design.sh`, then a screenshot of the affected view(s) at the sizes it affects (`shot.sh mock|live <site> -- --view <v> --size 1280x800 --out x.png`; phone: add `--d mobile --size 412x915`, or only `--size 412x915` for a site without a Mobile dashboard). Read its `page …` line: `SCROLLS: Main views must fit the screen` = a Main view overflows the panel.
- **Engine-wide change** (tokens, base.css, layout, shared cards): one regression run before and one after, and look only at what it lists:
  1. `engine/_dev/tools/regress.sh mock <site> -- --out /tmp/r/before`
  2. make the change
  3. `engine/_dev/tools/regress.sh mock <site> -- --out /tmp/r/after --baseline /tmp/r/before`
  One browser session: every Main view and page at 1280×800 with the fit check, every Mobile tab at 412×915, every pop-up and tab at phone size, console errors per screen, pixel diff against the baseline (screens changed more than `--threshold`, default 3 %). It also lists entity ids HA doesn't have, and checks links and on-screen values (`NaN`, `undefined`, impossible temperatures). Exit 1 on an error, a view that doesn't fit, a dead link or nonsense on screen. About a minute on the mock. Clocks, cameras and moving data change a few screens a few % on every run.
- `lint-design.sh` checks tokens, no dead card types (usage counted across the engine and every `sites/*/dash`), every stylesheet loaded.
- Other tools: `shot.sh … --popups all` (one pop-up's tabs at full height, for a close look), `diff.mjs <before> <after>` (diff two screenshot folders), gallery (`gallery.html`: every card type at four sizes, clipping finder, style baseline / compare).
- Side issues found while checking: note them with a one-line diagnosis and ask before chasing them, unless they block the task.
- The rail fits ten views + HA in 800 px with `--icon-rail`; screenshots are viewport-sized, so only the fit check (not a diff) shows a view that overflows.
