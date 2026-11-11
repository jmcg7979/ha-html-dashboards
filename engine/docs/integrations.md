# Integrations

What each part of a dashboard needs from Home Assistant, which `home.js` block it fills, and what to do if you don't have it. `sites/example/dash/home.js` shows every block in full.

Nothing here is required by the engine itself: a card only reads the entities its config names. If you don't have something, delete its block from `home.js` and the cards, tiles and pop-ups that use it, then run the checks in `AGENTS.md`. The exception is Systems: `dashboards/systems.js` reads its blocks when it loads, so see "Systems without Proxmox or Docker". Entity ids in the example are placeholders; yours will differ.

HA packages are in `sites/example/ha-config/packages/`. Copy the ones you need to `/config/packages/` with `homeassistant: packages: !include_dir_named packages` in `configuration.yaml`, then set the `secrets.yaml` entries named in each file's header.

Text is English. Temperatures default to °F and times to 12-hour; see "Outside the US and °C".

## Summary
| Feature | Needs | Install | Package | `home.js` |
|---|---|---|---|---|
| Sign-in | HA user | built in | | |
| People | Person, Companion app | built in | | `people` |
| Alarm | Alarmo | HACS | `dashboard_helpers.yaml` | `security` |
| Doors, windows, lock, garage | any binary sensor, lock, cover | your hardware | `dashboard_helpers.yaml` for the counts (optional) | `security` |
| Climate | any `climate` entity | your hardware | | `climate` |
| Lights | any `light` entity | your hardware | | `lights` |
| Cameras | Frigate + its HA integration | Docker + HACS | | `cameras` |
| Media | Cast, Android TV Remote, Music Assistant, Spotify (each optional) | built in / add-on | | `players`, `playTargets`, `tvApps` |
| Vacuum | any `vacuum`; rooms need `vacuum.clean_area` | your hardware | | `vacuum` |
| Timers | helpers | YAML | `dashboard_helpers.yaml` | `timers` |
| Weather | any `weather` entity | built in | | `weather` |
| Weather view | National Weather Service (US only) | built in | `weather_now.yaml` (optional) | `nws` |
| Calendar | any `calendar` entity | built in | | `calendars` |
| Maps | a tile provider key | | | `map_tiles`, `carto_key` |
| 3D printer | ha-bambulab (Bambu Lab) | HACS | | `printer` |
| Router, access points | any, see Network | yours | | `systems.network` |
| NAS | any, built for Synology DSM | built in | `long_term_stats.yaml` | `systems.nas` |
| Proxmox | Proxmox VE | built in | `proxmox_disks.yaml`, `vm_os_state.yaml` | `systems.proxmox` |
| Docker | Portainer, Glances | HACS / built in | `glances_containers.yaml` | `systems.docker` |
| HA updates, backups | Update and Backup, System Monitor | built in | | `systems.ha` |

## Sign-in
`core/auth.js` reuses the browser's HA login, or sends you to HA's sign-in page. No tokens go in files.

Displays: a wall panel or tablet opens `/local/dash/start.html?d=main`, phones `?d=mobile`. The default `portal` profile suits 1280×800. `&p=tablet` scales the UI up by 12% for a bigger screen, so it overflows at 1280×800. Profiles are in `css/tokens.css`, and you can add your own. Main views must fit the screen, and `regress.sh` checks 1280×800 only, so check your real size: `shot.sh mock <site> -- --size 1024x768 --out x.png`, then read its `page` line.

## People
`people.<key>`: `entity` (a `person`), `name`, `devices: [{ battery, charging, icon }]`. `style: 'portrait'` with `round: true` uses the person's HA photo in a presence ring. Without `round`, `portrait` is a transparent cut-out image in the site's `assets/`.

## Alarm, doors, windows
- `alarm` card: Alarmo's `alarm_control_panel`. `home: true` adds a Home button. Arming sends no code, so turn off "require code for arming" in Alarmo. Away is blocked while windows are open; Night also while an entry door is open.
- `household`: `person` entities whose own login may disarm with one tap, through `disarm`. That script holds a code, so leave `disarm` out to always ask. Other logins get a keypad and Alarmo checks the code.
- `alarm` options you leave out lose their row: `windows`, `garage`, `battery`. `windows` must be a count sensor. **Without it, open windows don't block Away**, so keep the sensor if you have window contacts.
- `open_doors` and `open_windows` are count sensors from `dashboard_helpers.yaml`, which also holds timers and the disarm script: copy only the parts you want. A tile can count in the browser instead, reading each door with `st(id)` as long as it lists them in `entities`, but the `alarm` card can't. `window_floors` lists your window sensors by floor and room.
- Lock and garage are one button each: see the `doors` pop-up in the example. Keep `confirm`, or leave `tap` out for read-only, on a panel anyone can reach.

## Climate
Any `climate` entity. `room-climate` reads `current_temperature`, `target_temp_low` and `target_temp_high` or `temperature`, `hvac_action`, and `humidity` if you give it a sensor.
- `thermostat`: set `modes` to what the device offers, because the card doesn't read `hvac_modes`. The default includes cool and heat_cool.
- `range` sets the dial's limits; the default follows `units` (`[55, 85]`, or `[5, 30]` for °C).
- Heat-only devices use `temperature`, not `target_temp_low` and `target_temp_high`: in the example's `climate` pop-up, chart `temperature` instead, or those lines stay blank. The legend shows `–` while the device is off.

## Cameras (Frigate)
Live video, events and recordings all go through the [Frigate integration](https://github.com/blakeblackshear/frigate-hass-integration) over HA's websocket and its `/api/frigate/<instance>/…` proxy, so no Frigate address or login goes in the dashboard.
- `stream`, `fullStream`: go2rtc stream names in Frigate's config. A low-resolution substream for tiles and the main stream for full screen is best; they can be the same.
- `sensor.<camera>_review_status` comes from the integration and rings a tile while an alert is active.
- `#review` and `#recordings` must exist in `popups.js` for events and recordings to open.
- Without Frigate, `camera` and `camera-wall` have no video source: there is no live video. Use `sites/example/dash/cards/snapshot.js`, a still every few seconds with its time on it, and remove `camera`, `camera-wall`, `reviews`, the Cameras view and those two pop-ups. `image` also works, but it reloads only when the entity updates.

## Media
`core/players.js`. One entry in `players` can be up to three HA entities: `entity` (Cast: what's playing, art), `power` (Android TV Remote: real power, apps, volume), `ma` (Music Assistant: queue; defaults to `<entity>_ma`). Controls appear only if an entity supports them, so a plain `media_player` works with `{ entity, name }`. `spotify: 'media_player.spotify'` (optional, HA's Spotify integration) shows Spotify on a Google TV, which reports nothing through Cast or the remote; the Spotify device name must match the player's `name`. `group: true` marks a speaker group. Each player needs its `#media-<object id>` pop-up; the example builds them in a loop.

What's shown depends on what each app tells Cast: Spotify, YouTube, SoundCloud give title and artist; HBO Max a title; Hulu, Netflix and Prime Video nothing beyond playing or paused, and Hulu a position. `core/apps.js` gives those a logo and colour instead; add an app there (Cast `app_name`, Android TV Remote package, colour, logo).

**Music Assistant's own API (optional).** HA exposes an MA player's current and next song only. With MA's API the full-screen Now playing (`cards/nowplaying.js`) adds the whole queue (Up next; OK plays that song), lyrics (synced when MA has LRC lyrics) and the Autoplay / Crossfade switches. `core/ma.js` talks to MA's WebSocket (`ws://<host>:8095/ws`) with an MA token; on a TV the launcher holds it (`tv/launcher/README.md`, `ma_token`), so a screen without the launcher just shows the HA-only version. MA on another host: `export const music_assistant = { url: 'http://<host>:8095' }` in `home.js`. Make the token for a non-admin MA user. `&tvdemo=1` on the mock fills in a made-up queue and lyrics.

Which entity is believed: a TV's `power` entity reading `off` overrides Cast, because Spotify on a Chromecast follows the account and reports a session while the TV is off. Music Assistant counts only with an `active_queue`; without one it is mirroring Cast. It supplies art but is not a source. An app marked `follows` in `core/apps.js` counts on a TV only when it's in front or truly casting. The `power` entity reading `on` only proves the Chromecast is awake, since it can sit on its screensaver with the TV off, so a screensaver or home screen isn't listed under Playing; its pop-up still shows it.

## Vacuum
The `vacuum` tile and the buttons work with any `vacuum`. The `area-pick` card calls `vacuum.clean_area`, so `areas` (`[[id, 'Name'], …]`) must use ids your integration accepts. `image` shows a map if you have an `image` entity for it. `fan_speed` and `fan_speed_list` are standard attributes.

## Timers and alerts
`alerts` in a dashboard (`core/alerts.js`) takes over the screen: `timer: { ringing, last, sound }` for a finished timer, `cameras: { cameras, review, timeout }` for Frigate alerts, `popups: [{ entity, state, open }]` to open a pop-up by itself. The example sets `timer` on Main. Phones usually get notifications instead.

`timer-list` runs `script.voice_timer_start` with `seconds` and `label`. `count` and `prefix` name the `timer.<prefix>_<n>` and `input_text.<prefix>_<n>_label` slots. The package has 4; add more slots to the package, the script and the automation, and raise `count`. It sets the ringing helper when a timer ends, which is what `alerts.timer` shows; `sound` plays one on a media player.

## Weather
- `weather` card: any `weather` entity that supports forecasts through `weather.get_forecasts`, anywhere in the world.
- `wx-now`, `wx-days`, `wx-hours` and `radar` are built for the US: the NWS integration, api.weather.gov, and radar and METAR from the Iowa Environmental Mesonet. Outside the US, remove the Weather view and keep the `weather` card.
- These cards fetch from the browser when HA has no data: `api.weather.gov`, `api.open-meteo.com`, `mesonet.agron.iastate.edu`.
- Location comes from HA after sign-in (Settings > System > General), so leave `lat` / `lon` out: files under `/local` are readable without a login. A card's own `lat` / `lon` override it.
- The `weather` card shows HA's own numbers and units. `wx-*` is °F and mph.
- `nws.iem` (`{ station, network, name }`) adds an airport's METAR. `nws.now` is `sensor.outdoor_temperature` from `weather_now.yaml`; leave it out and the browser picks the freshest source itself.

## Maps
`map_tiles`: `{ provider: 'carto' | 'maptiler' | 'stadia' | 'thunderforest', style, key }` for person maps; `carto_key` for the radar's base map. Without a key these show "API key required" tiles. `home.js` has no login, so keep the key out of it: create a Text helper in HA (Settings > Devices & services > Helpers, password mode) named `Map key`, paste the key in, and use `{ entity: 'input_text.map_key' }` as the key. Don't expose it to voice assistants. Signed-in users can still read it, and browsers send it to the map provider.

## Calendar
Any `calendar` entity. `agenda` and `month` read `/api/calendars`. `calendars` gives each a `name`, `tone` and `color`. An `agenda` card can take `filter` (a regular expression) to show only some events.

## 3D printer
`printer` follows [ha-bambulab](https://github.com/greghesp/ha-bambulab) sensor names, prefixed with your printer's name. `camera` is optional. `rec` (the `prints` card) needs Frigate recording the printer and your own job-tracking helpers; remove `rec`, the `prints` card and the `#prints` pop-up if you don't want it. `controls` buttons appear only when those entities exist.

## Network
The Systems Network page is site code (`dashboards/systems.js`), because routers differ. Keep the shape and map your sensors in `systems.network`:
- `wan.scale` converts your rate sensors to Mbit/s: `8e-6` for B/s, `8e-3` for kB/s, `8` for MB/s, `1` for Mbit/s. Check the sensor's `unit_of_measurement`; a wrong guess is out by a large factor and nothing flags it. The history pop-up uses it too. `dial` is your line speed.
- `limits` are `[attention, problem]`.
- `wan.status` must read `Up`; change the check in `nodes.router` if yours doesn't. With no such sensor, remove the check, and there's no "Internet is down" alert. `load`, `total_down`, `total_up` and the access points' `cpu` and `fw` are read in `systems.js`, so remove those lines if you don't have them.

## NAS
`systems.nas` drives the `health` and `bays` cards in the `#nas` pop-up, using Synology DSM integration names. `drives`: `{ name, status, temp, bad, life }`. Any other NAS works if you can map those sensors; `bad` and `life` are `binary_sensor`s.

## Proxmox
`engine/pages/proxmox.js` is shared, and only `systems.proxmox` and `systems.ha` are site data.
- Required: the built-in Proxmox VE integration, whose ids are `sensor.proxmox_<x>` and `sensor.proxmox_<vm>_<x>`. Its token needs `VM.PowerMgmt` for the restart buttons.
- Inside each guest: `guest.cpu`, `mem` and so on. Use System Monitor in HA, and Glances for other VMs (Proxmox's memory figure includes page cache).
- Leave out any of these and its row goes: `updates`, `restart`, `agent`, `temps` from a [LNXlink](https://github.com/bkbilly/lnxlink) agent on the host; `drive` from `proxmox_disks.yaml`; a VM's `os` from `vm_os_state.yaml`; `backup` (a sensor with the last backup's time, null shows "Not set up"); `impact` (shown in the confirm dialog); `self: true` for the VM running HA, which hides Shut down.
- Also optional: `storage`; a VM's `guest.net_in`, `net_out`, `procs`, and any of the three `power` buttons. The `vm` helper in the example assumes all three, so trim it to the buttons you have.
- `vms` can be a single VM.
- The mock's restart demo only works with VM keys `haos` and `ubuntu`.

## Docker
`engine/pages/docker.js` is shared.
- Portainer integration: containers are found in HA's registries, so a real site uses `containers: cachedContainers().map((c) => ({ ...c, p: c.cname, controls: c.cname !== 'portainer' }))`, imported from `./core/discover.js`. The example lists them by hand because the mock has no registries. A new stack then shows up with no deploy.
- Power and Restart show only to HA admins, like a VM's power buttons, so a wall panel on a normal user can't stop a container.
- `cores`: the host's vCPUs, since Portainer reports CPU per core.
- Without `image`, `update`, `restarts`, `power` or `restart` on a container, that row or button goes. The figures across the top need `running`, `cpu`, `mem_used` and `image_size`; each is left out if unset.
- `glances`: `glances_containers.yaml`. Without Glances, the Network line reads "Host network".
- `cpu`, `mem_used`: Glances' container totals for the host.

## HA updates and backups
`systems.ha.updates`: `[['Name', 'update.x'], …]`. `backup_last` and `backup_next` come from the built-in Backup integration's automatic backups. These updates reach "Needs a look" through the node of the VM marked `self: true`, so without Proxmox they need a node of their own (next section).

## Systems without Proxmox or Docker
`dashboards/systems.js` is your code, and it assumes those blocks exist: it reads `PX.vms[1].guest` at load, and the map, the figures and `attention` use them. Rewrite it rather than deleting lines:
1. Remove the `proxmox` and `docker` imports, `PX`, `DK`, `UB`, `HO`, the `*Net` lists, and their pages from the default export. Remove the same blocks from `home.js`.
2. Give each remaining system a health node in `nodes`, with `metrics`, `checks` and `updates`. A node's `page` is where its map tile goes.
3. Add a node for HA's updates: `ha: { name: 'Home Assistant', icon: 'home-assistant', page: 'systems/summary', updates: HA.updates.map(([label, entity]) => ({ entity, label })) }`.
4. List the nodes in `allNodes`, and rebuild `map` and `kpis` from them.
`topology` and `attention` open pages, not pop-ups: to link a NAS from the map, make it a Systems page with its own `id`.

With Proxmox but one VM and no Docker, keep `proxmoxNodes` and `proxmoxPage`. Remove the second VM from `home.js` and, in `systems.js`, `UB`, `ubNet`, the Ubuntu map entry and everything Docker. Page columns are fixed, so a single VM leaves the third column empty.

## Outside the US and °C
Set `export const units = { temperature: 'C', clock: '24h' };` in `home.js`. Without it a site gets °F and 12-hour times. `temperature` names what your sensors report; nothing is converted, because HA's numbers are shown as they are. It sets the °C labels, one decimal place on temperatures, and defaults for the `thermostat` dial (`[5, 30]`), `bays` limits and the Proxmox CPU meter.

Your own numbers don't change with it, so set these in your unit: `systems.network.router.limits.temp` and `temp_range`, `systems.proxmox.limits`, and any `warn` or `crit` on a temperature. A °F limit never triggers on a °C reading, and nothing warns you.

The Weather view (`wx-now`, `wx-days`, `wx-hours`, `radar`) stays US-only, in °F and mph, whatever `units` says, apart from its times. Outside the US, remove it and use the `weather` card, which shows HA's own units.

## History
Every sensor with a history drill-in needs long-term statistics for ranges over 10 days: `long_term_stats.yaml`.
