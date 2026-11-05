# Home Assistant HTML dashboards

Fast, custom dashboards for Home Assistant in plain HTML, CSS and JavaScript, with no build step: wall panels, desktops and phones, cameras through Frigate, and a Systems view for your network, Proxmox and Docker.

This is a reference project, shared as-is with no support. You adapt it to your own hardware by editing JavaScript, and it's designed so an AI coding tool can do that for you: point one at this folder and it will start from `AGENTS.md`.

## Try it
No Home Assistant needed, only Node 20+. This runs on made-up data on your own machine:
```
git clone https://github.com/jmcg7979/ha-html-dashboards.git && cd ha-html-dashboards
cd engine/_dev/mock && npm i
../tools/mock.sh example
```
- Dashboard: http://localhost:8125/local/dash/index.html?d=main
- Phone: http://localhost:8125/local/dash/start.html?d=mobile
- Every card: http://localhost:8125/local/dash/gallery.html

## Set it up with an AI coding tool
This is the way it's designed to be used. The tool reviews the code, reads your entities, builds your dashboards and checks them. Paste this into Claude Code, Codex, Cursor or similar:

```
Review https://github.com/jmcg7979/ha-html-dashboards before we use it.
Read the code itself, not just its docs. Follow "Review this repo" in AGENTS.md
as a starting point, and report what you find. Don't change anything yet.

If I approve, set it up on my Home Assistant by following "Adapt it to someone's
home" in AGENTS.md. Ask me before writing to my Home Assistant or restarting it.
```

It helps to have:
- **Access to your entities:** an HA MCP server is best. Without one, the tool gives you a template to paste into Developer Tools, and you paste the result back.
- **A way to reach `/config/www/`:** SSH, Samba or the File editor app. The tool can use SSH or an MCP server, or you can copy the files yourself.
- **A login for the live checks (optional):** make a long-lived token in your HA profile, pass it as an environment variable rather than saving it in a file, and delete it when you're done.

Read the `sites/<yours>/dash/home.js` it writes before deploying. Anyone who can reach your HA can read that file (see Security).

## Set it up by hand
You'll be editing JavaScript, though mostly lists of entity ids.
1. **List your entities.** Paste the template from step 1 of "Adapt it to someone's home" in `AGENTS.md` into Developer Tools > Template.
2. **Make your site.** Copy `sites/example` to `sites/<yours>` and leave the example in place.
3. **Map your entities.** Put your ids in `sites/<yours>/dash/home.js`, block by block. `engine/docs/integrations.md` says what each block needs.
4. **Remove what you don't have.** Delete that `home.js` block, then every card and pop-up that used it, and any link to them.
5. **Check it on the mock.** Give each id a made-up state in `sites/<yours>/mock/states.mjs`, then run `engine/_dev/tools/mock.sh <yours>`.
6. **Add the HA packages you need.** Copy them from `sites/<yours>/ha-config/packages/` to `/config/packages/`, set their secrets in `secrets.yaml`, and restart HA. `engine/docs/integrations.md` says which card needs which package.
7. **Build it:** `engine/_dev/assemble.sh sites/<yours>/dash /tmp/dash`.
8. **Copy `/tmp/dash/` to `/config/www/dash/`** on Home Assistant.
9. **Open `http://<ha>:8123/local/dash/start.html?d=main`.** HA doesn't serve a bare folder URL, so include the file name.
10. **On phones,** add a Webpage dashboard in the HA app with `/local/dash/start.html?d=mobile`.

## Security
Don't take this section's word for it: it's a map for checking, and the prompt above asks your tool to do that.

**Files in `/config/www/` have no login.** HA serves that folder at `/local/` to anyone who can reach your HA, so the dashboard's files can be read without signing in, including your `home.js`. Live data and control still need your HA login. Treat `home.js` as readable:
- Expect it to show your entity names, and the names of people, rooms and cameras.
- Keep your address and coordinates out of it. The weather cards and radar read home's location from HA after sign-in, so you don't need to add them.
- Keep tokens, passwords, alarm codes and API keys out of it. A map key goes in an HA helper and is read after sign-in (`engine/docs/integrations.md`, Maps).

**Sign-in.** The dashboard uses HA's normal login, and no token goes in a file. The login is kept in the browser's local storage, as HA's own frontend does, so treat a signed-in wall panel like any other signed-in device.

**Network.** There's no telemetry, and scripts and fonts are bundled, so nothing loads code from elsewhere. The browser fetches only from your HA, and from these services if you use the cards that need them:
- Weather, sending your location: `api.weather.gov`, `api.open-meteo.com`
- Radar and airport weather: `mesonet.agron.iastate.edu`
- Map tiles: `basemaps.cartocdn.com`, `api.maptiler.com`, `tiles.stadiamaps.com`, `tile.thunderforest.com`

**HA packages are optional, and each one needs your review.** `dashboard_helpers.yaml` adds an `alarm_disarm` script that uses your alarm code from `secrets.yaml`, so any HA login that can run scripts can disarm the alarm without typing a code. Leave that script out if that's not what you want.

**Controls.** The dashboard can do whatever your HA login can, such as unlocking a door or opening the garage. Remove any control you don't want on a shared screen.

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
