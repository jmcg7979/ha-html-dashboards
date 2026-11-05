# Home Assistant HTML dashboards

Fast, custom dashboards for Home Assistant in plain HTML, CSS and JavaScript, with no build step: wall panels, desktops and phones, cameras through Frigate, and a Systems view for your network, Proxmox and Docker.

This is a reference project, shared as-is with no support. You adapt it to your own hardware by editing JavaScript, and it's designed so an AI coding tool can do that for you: point one at this folder and it will start from `AGENTS.md`.

## Try it
No Home Assistant needed, only Node 20+:
```
git clone https://github.com/jmcg7979/ha-html-dashboards.git && cd ha-html-dashboards
cd engine/_dev/mock && npm i
../tools/mock.sh example
```
- Dashboard: http://localhost:8125/local/dash/index.html?d=main
- Phone: http://localhost:8125/local/dash/start.html?d=mobile
- Every card: http://localhost:8125/local/dash/gallery.html

## Use it
1. Copy `sites/example` to `sites/<yours>` and put your entities in `dash/home.js`. `engine/docs/integrations.md` says what each part needs.
2. Build it: `engine/_dev/assemble.sh sites/<yours>/dash /tmp/dash`.
3. Copy `/tmp/dash/` to `/config/www/dash/` on Home Assistant.
4. Open `http://<ha>:8123/local/dash/start.html?d=main`. HA doesn't serve a bare folder URL, so include the file name.
5. On phones, add a Webpage dashboard in the HA app with `/local/dash/start.html?d=mobile`.

## Limits
Text is English. °C and 24-hour time are one setting in `home.js` (`engine/docs/integrations.md`). The Weather view is US-only, but the `weather` card works anywhere. Live cameras need Frigate.

## Licence
MIT: see `LICENSE`. Bundled fonts, icons and libraries keep their own licences: see `THIRD-PARTY-NOTICES.md`.

## Layout
| Path | What |
|---|---|
| `engine/` | The engine: cards, core, pages, styles, tools |
| `engine/docs/` | Integrations, design system |
| `sites/example/` | A complete made-up site, its mock data and HA packages |
