// What the dashboard's code puts on the page's globals and sends as events, for the link check's compiler
// (../tools/linkcheck.sh): a file that starts with `// @ts-check` may read these. Types only; nothing here ships to a
// screen. The events in words: ../../docs/card-contract.md, Events.

interface Window {
  /** set by the loader (boot.js): the build this page runs */
  DASH_VERSION?: string;
  /** true once the app runs (app.js): its own update check takes over from the loader's */
  DASH_UP?: boolean;
  /** for the checks: the page's own counters */
  dashStats?: () => { watchers: number, ticks: number, views: string[], popups: number, dropped: number };
  /** for the checks: views, pages and pop-ups still being built plus requests HA has not answered */
  dashBusy?: () => number;
  /** for the checks: the icon buttons on screen that have no name (core/tips.js) */
  dashUnnamed?: () => string[];
}

interface Navigator {
  /** GB of memory, rounded down to a power of two, 8 at most (Chromium only) */
  readonly deviceMemory?: number;
}

interface WindowEventMap {
  /** show that view: 'view' or 'view/page' */
  'dash:view': CustomEvent<string>;
  /** a navigation is done and on screen; `changed`: to another view or page than before */
  'dash:shown': CustomEvent<{ view: string | null, changed: boolean }>;
  /** open the pull-out drawer with that id */
  'dash:drawer': CustomEvent<string>;
  /** a camera went to or left full screen */
  'dash:camfull': CustomEvent<boolean>;
  /** a layer opened, closed or changed what it shows (core/layers.js) */
  'dash:layers': CustomEvent<{ opened?: object, closed?: object, opener?: Element | null, changed?: object }>;
}
