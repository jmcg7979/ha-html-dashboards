
Design rules, tokens, templates and checks: `engine/docs/design-system.md`. What each integration supplies: `engine/docs/integrations.md`.

## Testing without touching HA
`_dev/mock` is a fake Home Assistant (websocket states, service calls, weather forecasts, calendar, history,
logbook, signed paths, a looping test video for cameras) that serves this folder.
```
cd _dev/mock && npm i
../tools/mock.sh [site]              # http://localhost:8125/local/dash/index.html?d=main
node shots.mjs lights,timers,vacuum  # 1280x800 screenshots of Home + those pop-ups, plus console errors
```
Set `CHROMIUM=<path>` to use a specific Chromium. Mock states live in `sites/<site>/mock/states.mjs`; add entities there when a card needs them. `mock.sh example` runs the made-up example site, which has a gallery of every card.

## Styles
- `css/tokens.css`: every size, colour and font (scales: `--sp-*` spacing, `--r-*` radius, `--a-*` tint alpha; `--s` sizes everything).
- `css/base.css`: page shell, layout grid, containers, shared building blocks, pop-up chrome.
- `css/cards/*.css`: one file per component. **Load order is the cascade** and lives in `boot.js` (`CARDS`): a later
  file wins over an earlier one at equal specificity. Add a new component's file where its rules belong in that list.
- Sizing follows the space a card gets (`@container cell / pbody / popup`), not the device; `css/cards/narrow.css`,
  `two-column.css` and `adapted.css` hold the cross-component responsive rules. `core/scale.js` sets `--s` per screen.
- Card options instead of view-specific CSS: `compact: true` (weather, agenda), view `colGap` (Cameras).

## Component gallery

`gallery.html` (served at `/local/dash/gallery.html`) shows every card type the dashboards use, at phone 390, in-between 900, Portal 1280 and desktop 1920.
- The cards come from `dashboards/gallery.js` (`?d=gallery`), which walks Main, Mobile, Systems and the pop-ups and reuses their own configs with live data. Nothing is hand-maintained: a new card type or use shows up on its own. Each type is shown full, half and a third wide so its compact states sit side by side; streams and full-screen cards (cameras, camera wall, map, network map, iframes) are shown once, full width. A type not in a category lands in Other.
- **Find clipping** lists anything that runs past its card's edge, or text cut off without an ellipsis, in every frame. Click a row to outline it.
- **Save baseline / Compare**: save before a style change, deploy, press Reload, then Compare to list every element whose computed style changed, per frame. Baselines live in this browser (IndexedDB), per category. Live data can account for a few colour changes.
- Frames are fixed-size, so each gets that exact width whatever the browser zoom. Checks wait for the frames to settle (up to ~30 s on the camera page).
