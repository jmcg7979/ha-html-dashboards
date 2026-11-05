# HTML dashboards for Home Assistant

Plain HTML/CSS/JS modules, no build step. Served by HA from `/config/www/dash/` at
`http://<ha>:8123/local/dash/index.html?d=<dashboard>&p=<profile>` (e.g. `?d=main&p=portal`). HA does not serve a folder URL (`/local/dash/`), so `index.html` must be in the link.

## Layout of the code
| Path | What it is |
|---|---|
| `index.html` | Page shell only |
| `app.js` | Boot: loads `dashboards/<d>.js`, applies the profile, builds the view, connects |
| `home.js` (site) | The site: entity ids and groups shared by every dashboard |
| `dashboards/*.js` (site) | One file per dashboard: views, sections, cards and their options (layout only). `main.js` = wall panel / desktop, `mobile.js` = phones |
| `core/phone.js` | Phone shell: bottom tab bar (`tabs` in the dashboard), More sheet, swipe-down sheets, hides HA's top bar inside a Webpage dashboard (`&chrome=1` keeps it) |
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
| `css/tokens.css` | **Every size, colour and font.** `--s` scales everything; profiles override tokens |
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
- **New icon:** use its MDI name anywhere, then `cd _dev && npm i @mdi/js@7.4.47 && node build-icons.mjs`.

## Phones
`start.html?d=mobile` (profile `phone`): one column, bottom tab bar (the dashboard's `tabs` + More), pop-ups as bottom sheets
(drag down to close; a card spanning 40%+ of a pop-up row goes full width). In the HA app, add it as a **Webpage** dashboard with the
URL `/local/dash/start.html?d=mobile`; the page then hides HA's top bar and puts HA's menu in More. Camera alerts and timers come
as notifications on phones; only the doorbell pop-up opens itself (`alerts.popups`).

## Deploy
`_dev/assemble.sh <site dash folder> <out>` builds engine + site; copy the result to `/config/www/dash/` on Home Assistant.
Browsers can cache modules briefly; refresh the panel after deploying.

## URL options
`?d=main` dashboard · `&p=portal|tablet|phone` profile · `&v=<view id>` · `&perf=1|0` timing readout

## Checks (see `engine/docs/design-system.md`, "Checks")
- `tools/lint-design.sh`: design lint (tokens, no dead card types, every stylesheet loaded).
- `tools/regress.sh mock|live <site> -- --out DIR [--baseline DIR] [--skip-popups]`: one-command regression (Main views at 1280×800 + fit check, Mobile tabs, every pop-up, console errors, pixel diff vs a baseline run).
- `tools/shot.sh`: single screenshots, clicks, `--popups` (full-height pop-ups); `tools/diff.mjs`: diff two screenshot folders.
