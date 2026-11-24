# HTML dashboards for Home Assistant

Plain HTML/CSS/JS modules, no build step. Served by HA from `/config/www/dash/` at
`http://<ha>:8123/local/dash/index.html?d=<dashboard>&p=<profile>` (e.g. `?d=main&p=portal`). HA does not serve a folder URL (`/local/dash/`), so `index.html` must be in the link.

## Layout of the code
| Path | What it is |
|---|---|
| `index.html` | Page shell only |
| `app.js` | Boot, as a sequence: loads `dashboards/<d>.js`, applies the profile, builds the shell and the first view, connects |
| `core/profile.js` | Which display profile the page runs with (`?p=`, a narrow screen, the dashboard's own) |
| `core/rail.js` | The rail: clock, a link per view, a paged view's own menu |
| `core/router.js` | Which view is on screen: built on first show, the last navigation asked for wins, `dash:shown` when done, unloaded a while after you leave |
| `core/update.js` | Reloads after a deploy, once the screen is left alone |
| `core/perf.js` | The timing readout (`?perf=1`) |
| `core/remote.js`, `core/remote/` | TV remote: the highlight, the arrows, the rail, OK / hold, Back / Home |
| `home.js` (site) | The site: entity ids and groups shared by every dashboard |
| `dashboards/*.js` (site) | One file per dashboard: views, sections, cards and their options (layout only). `main.js` = wall panel / desktop, `mobile.js` = phones |
| `core/phone.js` | Phone shell: bottom tab bar (`tabs` in the dashboard) and the More sheet |
| `core/gesture.js` | Swipe a bottom sheet down to close it (the More sheet, pop-ups on a phone) |
| `core/ha-embed.js` | Inside HA's Webpage dashboard: hides HA's top bar in every layout (`&chrome=1` keeps it), the phone's safe areas, our frame over HA's page for a full-screen camera |
| `cards/*.js` | One file per card type. `export default (cfg, ctx) => HTMLElement` |
| `core/auth.js` | Sign-in (reuses the browser's HA login, else HA's sign-in page; no tokens in files) |
| `core/ha.js` | Websocket, filtered `subscribe_entities`, service calls, signed paths |
| `core/store.js` | State, optimistic updates, per-entity render scheduling, timing readout |
| `core/actions.js` | Declarative tap actions (`'toggle'`, `{ call }`, `{ nav }`, `confirm`, `expect`) |
| `core/layout.js` | view > section (panel) > card grid; `show` conditions |
| `core/popup.js` | Pop-ups opened by `#hash`, built on first open |
| `popups.js` (site, optional) | Pop-up definitions shared by the site's dashboards |
| `vendor/` | Third-party code served locally (Leaflet for maps and the radar, hls.js for Frigate recordings) |
| `core/frigate.js` | Frigate through HA's Frigate integration: review items, recordings summary, signed media URLs, HLS playback |
| `core/dom.js` | Helpers: icons, tones, battery ring, time formats, confirm-by-second-tap |
| `css/tokens.css` | **Every size, color and font.** `--s` scales everything; profiles override tokens |
| `css/base.css`, `css/cards/*.css` | Layout and card styles, using tokens only |
| `icons.js` | Generated: the MDI icons in use |

## Common changes
- **Bigger/smaller UI on one display:** change `--s` (or any token) in that profile block in `css/tokens.css`.
- **New display type:** add `:root[data-profile="kiosk"] { ... }` in `tokens.css`, open with `&p=kiosk`.
- **New dashboard:** copy `dashboards/main.js` to `dashboards/<name>.js`, open with `?d=<name>`.
- **Move/resize a card:** edit its `span` (grid units, sections default to 12) or move it in the dashboard file.
- **New entity:** add it to `home.js`, reference it from the dashboard.
- **New card type:** add `cards/<type>.js`; use `type: '<type>'` in a dashboard. Cards call `watch(ids, draw)` so they redraw only when their entities change.
- **New pop-up:** add an entry to `popups.js` (or a dashboard's own `popups`), open it with `{ nav: '#<id>' }`.
- **New icon:** use its MDI name anywhere, then `cd _dev && node build-icons.mjs` (after the one-time `npm ci`, below).

## Phones
`start.html?d=mobile` (profile `phone`): one column, bottom tab bar (the dashboard's `tabs` + More), pop-ups as bottom sheets
(drag down to close; a card spanning 40%+ of a pop-up row goes full width). In the HA app, add it as a **Webpage** dashboard with the
URL `/local/dash/start.html?d=mobile`; the page then hides HA's top bar and puts HA's menu in More. Camera alerts and timers come
as notifications on phones; only the doorbell pop-up opens itself (`alerts.popups`).

## Deploy
`_dev/assemble.sh <site dash folder> <out>` builds engine + site; copy the result to `/config/www/dash/` on Home Assistant, the files first and `version.json` last (every file is requested with its content hash from `version.json`, and HA lets browsers keep `/local` files for 31 days).
Open dashboards notice the new `version.json` within 5 minutes and reload when nobody is using them.

## URL options
`?d=main` dashboard · `&p=portal|tablet|phone|tv` profile · `&v=<view id>` · `&perf=1|0` timing readout; the whole list is in `engine/docs/card-contract.md`, "URL parameters".

## Checks (see `engine/docs/design-system.md`, "Checks")
One-time setup: `cd engine/_dev && npm ci` installs the tools the static checks use (ESLint and TypeScript, at the versions in
`package-lock.json`) into `_dev/node_modules`. Node 18 is enough. They only check: nothing is built, and nothing from
`_dev/` is deployed. The browser checks need Playwright too: `cd engine/_dev/mock && npm i && npx playwright install chromium` (Node 20+).
- ESLint, from the repository root: `engine/_dev/node_modules/.bin/eslint -c engine/_dev/eslint.config.mjs engine sites`.
  Rules that find mistakes, none about style: a name that is not defined, an import or variable nobody uses, a key
  written twice, code that can't be reached, a `window` property read where a variable was meant (`eslint.config.mjs`).
- `tools/linkcheck.sh <site dash folder>`: assembles the site and checks that every static import resolves, every imported
  name is exported and every name used is defined. A misspelled import otherwise shows only in a browser, as a blank page or
  a card that fails when its view opens. It runs the TypeScript compiler over the JavaScript and keeps only those errors.
  A file that starts with `// @ts-check` is typed, and every error the compiler has for it counts: a site's `home.js`,
  whose blocks name their shapes from `core/shapes.js` (required keys, optional keys, the kind of each value), and the
  engine's spine (`app.js`, `core/router.js`, `core/rail.js`, `core/profile.js`, the phone shell, `core/layers.js`,
  `core/remote.js` and `core/remote/`), which names `Dashboard`, `View` and the rest from the same file. What the page
  keeps on `window` and the events it sends are declared for the compiler in `_dev/types/page.d.ts`.
- `tools/lint-design.sh`: design lint (tokens, no dead card types, `boot.js` `CARDS` and `css/cards/` list the same stylesheets, every `var(--x)` read without a fallback is defined).
- The browser checks (`tools/regress.sh`, `smoke.mjs`, `unloadcheck.mjs`, `navcheck.mjs`, `bootcheck.mjs`, `resilience.mjs`, `fitcheck.mjs`, `shot.sh`, `diff.mjs`) and the site validator (`tools/check-site.mjs`) are described in `engine/docs/design-system.md`, Checks. They share `tools/lib/browser.mjs` and run through `tools/shot.sh mock|live <site>`, which starts a mock of its own on a free port.
- Unit tests: `node --test engine/_dev/test/` (`test/README.md`).
- The mock HA: `mock/server.mjs` (its header lists variants, faults and what a site's `mock/states.mjs` exports). It listens on this machine only; `MOCK_HOST=0.0.0.0` opens it to the network.
