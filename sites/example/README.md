# Example site

A small made-up home for the dashboard engine: Home, Cameras, Weather and Systems on a wall panel or desktop and on phones, with pop-ups, and a gallery of every card. All data is fake and comes from the mock Home Assistant, so it runs without one.

```
cd engine/_dev/mock && npm i
../tools/mock.sh example
```
- Dashboard: http://localhost:8125/local/dash/index.html?d=main
- Phone layout: http://localhost:8125/local/dash/start.html?d=mobile (narrow the window or use phone emulation)
- Gallery: http://localhost:8125/local/dash/gallery.html

| File | What |
|---|---|
| `dash/home.js` | Every entity id, grouped; start here for your own hardware |
| `dash/dashboards/main.js` | Panel and desktop views: layout only |
| `dash/dashboards/mobile.js` | Phone views and tab bar: layout only |
| `dash/dashboards/parts.js` | Tiles and views both share |
| `dash/dashboards/systems.js` | Systems: health rules (`nodes`), the map, the Network page; Proxmox and Docker pages come from `engine/pages/` |
| `dash/popups.js` | Pop-ups, opened with `{ nav: '#<id>' }` |
| `dash/dashboards/gallery.js` | Finds every card type in the views and pop-ups (`gallery.html` shows them at four screen sizes) |
| `dash/cards/snapshot.js` | A site's own card: camera stills without Frigate |
| `mock/states.mjs` | The fake states |
| `ha-config/packages/` | Generic HA packages (`engine/docs/integrations.md`) |

The history pop-up (`trend` card) has no gallery frame of its own: tap any figure or chart. Without `test.mp4` in `engine/_dev/mock` the camera tiles stay dark. Radar and person maps need a CARTO key (`engine/docs/integrations.md`, Maps); weather uses US sources.
