// The shapes of what a site gives the engine: the blocks of its home.js that engine code reads by key and, at the end,
// a dashboard file with its views, cards, pop-ups and actions. Types only, no code.
// A site names one for a block of its home.js:
//   /** @type {import('./core/shapes.js').Player[]} */
//   export const players = [ … ];
// and starts the file with `// @ts-check`. The link check (_dev/tools/linkcheck.sh, run before every deploy) then fails on
// a required key left out, a key these shapes don't have (a misspelled option), and a value of the wrong kind. Nothing here
// runs in a browser. Blocks only a site's own dashboards read (rooms, a network page's sensors) have no shape here.
// An "entity" below is a Home Assistant entity id as a string.

/**
 * Display units (core/units.js). Both optional.
 * @typedef {object} Units
 * @property {'F' | 'C'} [temperature] what the temperature sensors report; default 'F'
 * @property {'12h' | '24h'} [clock] default: the browser's own format
 */

/**
 * The base map of person maps (cards/map.js, which lists each provider's styles).
 * @typedef {object} MapTiles
 * @property {'carto' | 'maptiler' | 'stadia' | 'thunderforest'} provider
 * @property {string} [style] that provider's style id
 * @property {string | { entity: string }} [key] the provider's browser key, or the Text helper that holds it (core/mapkey.js)
 */

/**
 * A TV or speaker (core/players.js): up to three HA entities for one device, and its Spotify accounts.
 * @typedef {object} Player
 * @property {string} entity the Cast media player; its object id names the pop-up, `#media-<object id>`
 * @property {string} name as shown; a Spotify account names this as its device when it plays here
 * @property {string} [power] the Android TV Remote media player: real power, native apps, volume steps
 * @property {string} [remote] the TV's remote.* entity: d-pad, Home / Back, opening apps
 * @property {string | null} [ma] Music Assistant's player; left out = `<entity>_ma`, null = not an MA player
 * @property {string} [castMa] a TV whose `ma` is a player app (Sendspin): MA's player of its Cast side, the one a speaker
 *   group plays it through (core/players.js groupNow)
 * @property {string} [maApp] that player app's Android package: a TV with the launcher sends it Play when its music
 *   starts, so it takes the sound back from an app that had it (cards/nowplaying.js `wake`)
 * @property {string | string[]} [spotify] the Spotify media players of the house's accounts, the ones to believe first
 * @property {string[]} [spotifyQueue] those of them that know a cast's up next (SpotifyPlus: core/spotify.js)
 * @property {string} [appLink] how this TV opens an app, with {pkg} for the package; left out = the app's own `link`
 * @property {TvApp[]} [apps] this TV's own app list for the Remote tab, in place of the card's
 * @property {boolean} [group] a speaker group: its speakers fold into its row while it plays
 */

/**
 * A place music can be sent to ("Play on", Rooms): a Music Assistant player.
 * @typedef {object} PlayTarget
 * @property {string} entity Music Assistant's media player
 * @property {string} name
 * @property {string} icon
 * @property {string} [floor] the heading a room sits under
 * @property {boolean} [group] a speaker group, listed after the rooms
 */

/**
 * A streaming app on a TV (the TV's app row, the Remote tab).
 * @typedef {object} TvApp
 * @property {string} name
 * @property {string} pkg the Android package
 * @property {string} [link] the app's own link, for a TV whose player has no `appLink`
 */

/**
 * A camera (cards/camera.js, cards/camera-wall.js, alerts, recordings).
 * @typedef {object} Camera
 * @property {string} entity
 * @property {string} name
 * @property {string} stream the go2rtc stream a tile plays (the substream)
 * @property {string} [fullStream] what full screen plays; left out = `stream`
 * @property {string} [ratio] the picture's shape, 'w/h'; default '16/9'
 * @property {'cover' | 'contain' | 'fill'} [fit] fill = an anamorphic picture stretched to `ratio`
 * @property {boolean} [recorded] false = live only, the recorder keeps nothing
 */

/**
 * What the Systems pages the engine builds need (pages/proxmox.js, pages/docker.js). Every other key (a network page's
 * sensors, a NAS) is the site's own.
 * @typedef {{ proxmox: Proxmox, docker: Docker, ha: HaSystem, [part: string]: any }} Systems
 */

/**
 * Limits are [attention, problem], in the unit the sensor reports.
 * @typedef {[number, number]} Limits
 */

/**
 * The Proxmox host (pages/proxmox.js). A part left out takes its rows off the page.
 * @typedef {object} Proxmox
 * @property {string} status
 * @property {string} up
 * @property {string} cpu
 * @property {string} mem percent
 * @property {string} mem_total
 * @property {Vm[]} vms
 * @property {string | null} [backup] the time of the last backup; null = "Not set up"
 * @property {{ name: string, size: string, count: string }} [backup_store] the backup folder: its size and archive count
 * @property {string} [updates] packages waiting (the host's agent)
 * @property {string} [restart] a restart is needed
 * @property {string} [agent] the agent is online
 * @property {{ [part: string]: string }} [temps] a temperature sensor per part (cpu, disk, ram, board)
 * @property {{ [part: string]: Limits }} [limits] by the same parts; a temperature shows only with its limits
 * @property {{ health?: string, wear?: string, hours?: string }} [drive]
 * @property {{ name: string, pct: string, used: string, total: string }[]} [storage]
 */

/**
 * A virtual machine (pages/proxmox.js).
 * @typedef {object} Vm
 * @property {string} name
 * @property {string} p its key in the Proxmox integration's entity ids
 * @property {string} icon
 * @property {string} status
 * @property {string} up
 * @property {string} cpu
 * @property {string} mem percent, as Proxmox counts it (page cache included)
 * @property {string} ram
 * @property {VmGuest} guest what the guest itself reports; {} when nothing runs inside it
 * @property {{ restart: string, shut_down: string, start: string }} [power] the buttons; left out = no controls
 * @property {string} [os] the guest system's state
 * @property {string} [impact] what stops while it is down (the confirm dialog)
 * @property {boolean} [self] the VM this Home Assistant runs in: no Shut down, and HA's updates are listed with it
 */

/**
 * @typedef {object} VmGuest
 * @property {string} [cpu]
 * @property {string} [mem]
 * @property {string} [disk] percent
 * @property {string} [disk_used]
 * @property {string} [disk_free] with disk_used, when there is no disk_size
 * @property {string} [disk_size]
 * @property {string[]} [net_in] a sensor per network card
 * @property {string[]} [net_out]
 * @property {string} [rx]
 * @property {string} [tx]
 * @property {string} [procs]
 * @property {string} [updates]
 * @property {string} [reboot]
 * @property {string} [agent]
 */

/**
 * The Docker host (pages/docker.js).
 * @typedef {object} Docker
 * @property {number} cores the Docker VM's vCPUs: container CPU is reported per core
 * @property {Container[]} containers cachedContainers() of core/discover.js, or written out
 * @property {string} running
 * @property {string} stopped
 * @property {string} images
 * @property {string} image_size
 * @property {string} reclaim
 * @property {string} cpu
 * @property {string} mem_used
 * @property {string} mem_total
 * @property {string} glances every container's traffic: attributes.containers { <name>: { in, out } }, Mbit/s
 * @property {string} [stats_stale] the container figures have stopped moving
 * @property {{ [cname: string]: string }} [impact] what stops while a container is down, by its own name
 */

/**
 * A container: its names, then one entity per reading (core/discover.js finds them in HA's registries).
 * @typedef {object} Container
 * @property {string} cname the container's own name
 * @property {string} name as shown
 * @property {boolean} [controls] false = read-only on the page
 * @property {string} [state]
 * @property {string} [health]
 * @property {string} [started]
 * @property {string} [cpu]
 * @property {string} [mem]
 * @property {string} [mem_mb]
 * @property {string} [mem_limit]
 * @property {string} [restarts]
 * @property {string} [image]
 * @property {string} [version]
 * @property {string} [status]
 * @property {string} [oom]
 * @property {string} [power]
 * @property {string} [restart]
 * @property {string} [update]
 */

/**
 * Home Assistant itself on the Systems pages.
 * @typedef {object} HaSystem
 * @property {[label: string, entity: string][]} updates the update entities worth showing
 * @property {string} backup_last
 * @property {string} [backup_next]
 */

// ---- What a dashboard file (dashboards/<name>.js) exports, and what the engine hands a card ----
// The contract in words: engine/docs/card-contract.md. The engine's own spine names these (`// @ts-check` in app.js,
// core/router.js, core/rail.js, core/profile.js); a dashboard file may too:
//   /** @type {import('../core/shapes.js').Dashboard} */
//   export default { … };

/**
 * An entity as Home Assistant sends it (core/store.js `st(id)`).
 * @typedef {object} EntityState
 * @property {string} entity_id
 * @property {string} state
 * @property {Record<string, any>} attributes
 * @property {string} [last_changed]
 * @property {string} [last_updated]
 */

/**
 * What a press does (run() in core/actions.js): 'toggle', an action object, or a function that picks one of them from the
 * entity's state (lock when unlocked, unlock when locked).
 * @typedef {'toggle' | ActionObject | ((entity: EntityState | null) => 'toggle' | ActionObject)} Action
 */

/**
 * @typedef {object} ActionObject
 * @property {string} [call] a service ('vacuum.start') on the card's entity, or on `target`
 * @property {string} [target] the entity the call is for, when it isn't the card's
 * @property {Record<string, any>} [data] the service's data
 * @property {boolean | { title?: string, text?: string, ok?: string, icon?: string }} [confirm] true: a second tap;
 *   an object: a dialog (core/ask.js), for what is hard to undo
 * @property {string | { state?: string, attr?: string, value?: any, entity?: string }} [expect] the state to show until
 *   HA confirms
 * @property {() => void} [after] runs once the call is sent
 * @property {string} [nav] '#popup' or '#popup/page'
 * @property {string | ((entity: EntityState | null) => string)} [url] a link, opened in a new tab
 * @property {string} [app] with `url`: the link to use inside the HA Companion app
 * @property {boolean} [close] close the open pop-up
 * @property {string} [view] another view of this dashboard ('systems', 'systems/nas')
 * @property {string} [drawer] open the drawer with that id (cards/drawer.js)
 */

/**
 * When a card is shown (core/layout.js); a list: all must hold.
 * @typedef {{ entity: string, state?: string | string[], not?: string | string[], below?: number, above?: number }
 *   | { when: () => boolean, entities?: string[], every?: number }} ShowRule
 * @typedef {ShowRule | ShowRule[]} ShowCond
 */

/**
 * A card as a dashboard writes it. The keys below are read by the layout for every card; the rest are the card type's
 * own options (the header comment of cards/<type>.js).
 * @typedef {object} CardBase
 * @property {string} type the module's name: cards/<type>.js
 * @property {number} [span] width in grid units (default: the full width)
 * @property {boolean} [wide] a full row when a big-screen page reflows on a phone
 * @property {string} [class] classes for the cell ('glass')
 * @property {boolean} [panel] false: not in the type's own panel
 * @property {boolean} [grow] the card takes the height left in its column
 * @property {ShowCond} [show] the cell is hidden when this doesn't hold
 * @property {false | Record<string, any>} [tv] on a TV: left out, or these options on top (`tvCopy`); a card never sees it
 * @property {CardConfig[]} [cards] nested cards
 * @typedef {CardBase & Record<string, any>} CardConfig
 */

/**
 * What a card's factory gets beside its config: `export default (cfg, ctx) => HTMLElement`.
 * @typedef {object} CardCtx
 * @property {Record<string, any>} home the site's home.js module
 * @property {HTMLElement} cell the grid cell the card's element goes into
 * @property {(cards: CardConfig[], cols: number, home: Record<string, any>, rows?: string) => HTMLElement} grid builds
 *   nested cards the way a section does; their types are already loaded
 * @property {(cards: CardConfig[]) => Promise<any>} preload loads the types of cards built later than the view
 * @property {(visible: boolean) => void} setVisible the card hides or shows its own cell
 */

/**
 * A section of a view or page: a panel with a grid of cards.
 * @typedef {object} Section
 * @property {CardConfig[]} cards
 * @property {number} [span] width in view columns (default 1)
 * @property {number} [cols] grid units inside (default 12)
 * @property {boolean} [panel] false: the cards sit straight on the page
 * @property {string} [class]
 * @property {string} [rows] the grid's own row template; the section then fills its column's height
 */

/**
 * A page of a view with tabs.
 * @typedef {object} Page
 * @property {string} id
 * @property {string} title
 * @property {Section[]} sections
 * @property {string} [short] its name in the rail's menu, when the title is too long there
 * @property {string} [icon]
 * @property {boolean} [fill] the page takes the screen's height
 */

/**
 * A view: `sections`, or `pages` (tabs; opened with 'view/page'), or `frame` (another page in a frame: core/frame.js).
 * @typedef {object} View
 * @property {string} id
 * @property {string} [title]
 * @property {string} [icon]
 * @property {Section[]} [sections]
 * @property {Page[]} [pages]
 * @property {Record<string, any>} [frame]
 * @property {boolean} [rail] false: no link in the rail
 * @property {string} [back] the view the remote's Back leads to from here ('home')
 * @property {string} [tone] a paged view's color (a token's name; default 'mist')
 * @property {string} [columns] its own column widths
 * @property {string} [colGap] its own space between columns
 * @property {boolean} [fill] the view takes the screen's height
 * @property {number} [zoom] drawn smaller, with `s` as its own scale (a wall-panel page reused on a TV)
 * @property {number} [s]
 */

/**
 * A pop-up, opened by its id as the address's hash (core/popup.js): `cards`, or `pages` for tabs in its header.
 * @typedef {object} PopupDef
 * @property {string | ((entity: EntityState | null) => string)} [title]
 * @property {string} [icon]
 * @property {string} [tone]
 * @property {string} [entity] the entity its header shows
 * @property {string[]} [deps] more entities that redraw the header
 * @property {(entity: EntityState | null) => string} [state] the header's second line
 * @property {string} [width] 'wide', 'max', 'wide cam'
 * @property {number} [cols]
 * @property {CardConfig[]} [cards]
 * @property {{ id?: string, title: string, icon?: string, cols?: number, cards: CardConfig[] }[]} [pages]
 * @property {() => void} [onOpen] runs every time it is shown
 */

/**
 * A dashboard: the default export of dashboards/<name>.js.
 * @typedef {object} Dashboard
 * @property {View[]} views the first is Home: where an unknown address leads, and never unloaded
 * @property {string} [title] the browser tab's
 * @property {'portal' | 'phone' | 'tv' | string} [profile] the display profile (css/tokens.css); `?p=` and a narrow screen come first
 * @property {Record<string, PopupDef>} [popups]
 * @property {{ title: string, icon: string, url: string }[]} [links] at the foot of the rail / in the More sheet
 * @property {string[]} [tabs] a phone's tab bar: view ids (default: the first four); the rest go under More
 * @property {Record<string, any>} [settings] over the defaults of core/settings.js
 * @property {Record<string, any>} [alerts] what takes over the screen (core/alerts.js)
 * @property {Record<string, any>} [playing] the song that plays, in the rail (core/railplay.js)
 * @property {boolean} [remote] the TV remote's navigation on another profile than 'tv'
 * @property {{ after?: number, keep?: string[] }} [unload] seconds a view stays built once left, and views that always stay
 */

export {};
