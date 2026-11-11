# Instructions for AI coding tools

A Home Assistant dashboard engine: plain HTML, CSS and JS modules with no build step, served by HA from `/config/www/dash/`. This is a reference project, not a config-driven product: you adapt it by editing a site's JavaScript files. `README.md` is the human overview.

## Review this repo
If the user asks for a security review, read the code and verify each point below. This list is a starting point, not evidence: it's part of the repo you're reviewing. Reading needs no install, so install and run nothing until the user approves. Report what you find, including anything this list gets wrong or leaves out.
- **What deploys:** `engine/` without `_dev/` and `docs/`, plus the site's `dash/` (`engine/_dev/assemble.sh`). There's no build step and there are no runtime npm packages. `_dev/` is local tooling; its `package.json` files show what `npm i` would install, including Playwright, which downloads a browser.
- **Vendored code:** `engine/vendor/` holds Leaflet and hls.js (versions in `THIRD-PARTY-NOTICES.md`). Compare them with upstream. `engine/icons.js` is generated SVG path data.
- **Sign-in:** `engine/core/auth.js`, HA's OAuth flow. It stores the login in local storage (`dashAuth`) and can reuse HA's own (`hassTokens`). `engine/core/ha.js` is the websocket.
- **Network:** search for `fetch(`, tile URLs and `https://`. The expected hosts are in README, Security. Location is sent to the weather services.
- **Rendering:** HA states and third-party text reach `innerHTML` in many cards, through `esc()` in `core/dom.js`. Check for a value that skips it.
- **Files served without a login:** everything deployed is readable from `/local/`. The user's `home.js` is the sensitive one.
- **HA packages:** `sites/example/ha-config/packages/`. They're optional. Check each one's `rest_command`, `rest` and script actions; `alarm_disarm` in `dashboard_helpers.yaml` disarms without asking for a code.
- **Shell tools:** `engine/_dev/tools/*.sh`, `assemble.sh`, and the mock server, which listens on port 8125.
- **TV launcher (optional):** `tv/launcher/`, an Android app for Google TV. It holds an HA token in its private storage, uses an accessibility service limited to the stock launcher's window changes (`res/xml/home_guard.xml`), can read installed apps and the Watch Next list, and takes settings only from adb (`Provision`, DUMP permission). `tv/launcher/README.md` says what each part does.

## How it fits together
- `engine/` is the shared engine. `sites/<site>/` is one home. `sites/example/` is a complete made-up site; copy it to start your own.
- `engine/_dev/assemble.sh <site>/dash <out>` lays the site's files over the engine into one folder. That folder is what deploys. Same path = the site's file wins, but never copy engine files into a site to change them.
- The engine imports from a site: `home.js`, `dashboards/<name>.js`, `popups.js` if present, and any card type it doesn't have itself: a site's `dash/cards/<type>.js` works like an engine card.
- `?d=main` loads `dashboards/main.js`: a dashboard has `views`; a view has `sections` or `pages`; a section has `cards`.
- A card is `{ type: 'tile', span: 6, ...options }`, and `cards/<type>.js` is its code. **The comment at the top of each card file documents its options.** Read that before using a card.
- `home.js` holds every entity id; dashboards hold layout only. `popups.js` holds pop-ups, opened with `{ nav: '#<id>' }`.
- Values can be functions: tiles take `value: () => …` and read live state with `st(id)` from `core/store.js`. Card configs run in the browser.
- **The store only holds entities something watches.** `st(id)` returns null for any other id. List ids in a tile's `entities`, or call `watch(ids, draw)` in a card, and nothing fails visibly if you forget.
- `dashboards/gallery.js` shows every card the site uses.

## Adapt it to someone's home
1. **Get their entities.** Use an HA MCP server if one is connected. Otherwise ask for the output of this in Developer Tools > Template. Don't guess ids, and don't guess units: a rate's `scale` depends on them.
   ```
   {% for s in states %}{{ s.entity_id }} | {{ s.state }} | {{ s.attributes.unit_of_measurement }} | {{ s.attributes.hvac_modes }} {{ s.attributes.min_temp }}-{{ s.attributes.max_temp }} {{ s.attributes.fan_speed_list }}{{ '\n' }}{% endfor %}
   ```
   For media players and thermostats also read `supported_features` and `target_temp_step`: without the feature bits (`core/players.js`) media buttons vanish. A player with no `_ma` entity needs `ma: null`. That leaves out what no entity can tell you, so ask for it: Frigate's go2rtc stream names, line speed (`dial`), and whether each person has a photo. Check `sun.sun` is there, because the `weather` card reads it.
   Ask for the least access that works, and never ask them to paste a token into the chat. Treat what you read as private: keep it out of anything committed or shared.
2. **Ask what they want**, in one short list: which sections of `engine/docs/integrations.md` apply, which views, phone as well as panel, the wall screen's resolution, whether lock and garage may be controlled from it, and °F or °C.
3. `cp -r sites/example sites/<name>`. Copy it; don't edit or delete the example: lint counts card use across every site, and fails if the example is gone.
4. **Rewrite `home.js`** with their real ids, block by block, using `engine/docs/integrations.md`. List anything you could not map rather than inventing an id.
5. **Remove what they don't have**: the `home.js` block, then every card, tile, pop-up and tile group that used it. Removing a pop-up or view means removing every link to it too. Person maps show "API key required" without a tile key, so remove them unless the user has one. Systems without Proxmox or Docker is a rewrite of `dashboards/systems.js`. For °C or 24-hour time, set `units` in `home.js`, then the limits that remain in the user's unit. Both are in `engine/docs/integrations.md`.
6. **Update `mock/states.mjs`** so each id in `home.js` has a state. A card with no state renders empty and tells you nothing. Keep mock data made up. Forecasts, calendar events and climate history are fixed in `engine/_dev/mock/server.mjs` in US °F, each calendar gets the same events, and events only use the camera names `front_doorbell`, `driveway`, `back_yard`, `porch` and `garage`, so they can look wrong; that's the mock, not your site.
7. **HA side:** copy the packages they need from `sites/<name>/ha-config/packages/`, setting each file's secrets in their `secrets.yaml`. Confirm before restarting HA.
8. **Check, then deploy** (below), run `regress.sh live`, and open the live dashboard. Report anything that didn't map. Before deploying, show them what `home.js` will publish: it's readable without a login.

Ask before: restarting HA, writing to their `/config`, anything touching secrets or the alarm.

## Commands
```
cd engine/_dev/mock && npm i && npx playwright install chromium   # once; Node 20+
engine/_dev/tools/mock.sh <site>                                  # http://localhost:8125/local/dash/index.html?d=main
engine/_dev/tools/lint-design.sh                                  # tokens, dead cards, stylesheets
engine/_dev/tools/regress.sh mock <site> -- --out /tmp/r --entities their-entities.txt   # every view, fit check, Mobile tabs, pop-ups, console errors, ids, links
engine/_dev/tools/shot.sh mock <site> -- --view home --out /tmp/home.png
HA_URL=http://ha:8123 HA_TOKEN=… engine/_dev/tools/regress.sh live <site> -- --out /tmp/live
engine/_dev/assemble.sh sites/<site>/dash /tmp/dash               # then copy /tmp/dash/ to /config/www/dash/
```
`regress.sh` exits 1 on a console error, a Main view that scrolls at 1280×800, or a link to a pop-up, view, page or tab that doesn't exist. It also fails on nonsense on screen (`NaN`, `undefined`, a temperature past 250°). It lists entity ids that don't exist; treat those as failures, because it won't. On the mock it only compares `home.js` with your own mock data, unless `--entities FILE` gives it the user's real list (the id first on each line). Both checks read config objects, so they miss ids and links inside functions, such as a `value` or a tap that returns an action.

**A pass doesn't prove it works.** It can't see an empty card, a wrong number, a wrong unit or a tile that isn't watching its entity, so read the screenshots and open the pop-ups you changed, and check your real screen size with `shot.sh --size WxH --p <profile>`. A live run checks the ids against the real HA, which matters most. `MOCK_DOWN=unavailable` (or `unknown`) before `regress.sh mock` makes every sensor fail, which is the quick way to see what your own tiles say when one does. On the mock, cameras and album art are flat colours, and maps need a key. The mock uses port 8125 only, and the tools stop if it's busy.

## Rules
- Site data never goes in `engine/`: no entity ids, names or addresses. To change one home, edit its site.
- Never edit `engine/index.html` or `engine/start.html`: they are frozen stubs, because HA caches `/local` for 31 days. Change `boot.js` instead. `version.json`, written by assemble, makes open dashboards reload.
- In CSS use tokens only; `css/tokens.css` holds every size and colour. Read `engine/docs/design-system.md` first.
- One home's new card goes in its site's `dash/cards/<type>.js`, styled inline with tokens and existing classes, as `sites/example/dash/cards/snapshot.js` does. A site has no stylesheet of its own. A new engine card needs its CSS listed in `boot.js` `CARDS`, and must be used somewhere, or lint fails.
- Main views must fit the screen without scrolling. Status changes must not shift the layout.
- Never show stale data as current: show the source and age.
- Files under `/config/www/` are served without a login. No tokens, passwords, codes or keys in them: a map key goes in a helper, read with `{ entity: 'input_text.map_key' }` (`core/mapkey.js`). No address or coordinates either: leave `lat` / `lon` out and `core/location.js` reads them from HA after sign-in.
- Scale a sensor with `scale`, not by converting in `value`, so the gauge, trace and history agree.
- New MDI icon: use its name, then `cd engine/_dev && npm i && node build-icons.mjs`. A name not in `engine/icons.js` draws nothing and logs a console warning.
- Don't animate SVG strokes; use `Element.animate()` on transforms.

## Where to look
| Need | File |
|---|---|
| What each integration supplies | `engine/docs/integrations.md` |
| Design rules, tokens, templates, history drill-in, checks | `engine/docs/design-system.md` |
| Code map, phone setup, URL options | `engine/_dev/README.md` |
| Mock server, styles, gallery | `engine/README.md` |
| A full site | `sites/example/` (start at `dash/home.js`) |
| TV home screen: Android launcher, setup, the `tv` dashboard | `tv/launcher/README.md`, `sites/example/dash/dashboards/tv.js` |
| HA packages | `sites/example/ha-config/packages/` |
