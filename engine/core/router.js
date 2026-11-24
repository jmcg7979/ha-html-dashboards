// @ts-check
// Which view is on screen. Views are built the first time they are shown and removed a while after you leave them.
// A navigation is asked for with show(), by the `dash:view` event (detail 'systems' or 'systems/nas': a page of a view
// with tabs) or by the browser's Back / Forward. Every one asked for ends in `dash:shown` on the window (detail
// { view, changed }: what is on screen, and whether that is another view or page than before), also one that failed:
// whoever waits for it is not left waiting (one that was overtaken ends with the one that overtook it). A view that
// fails to build (a card type that didn't load) leaves what was on screen where it is; the next time it is asked for it
// is built anew. A failure of a navigation that was overtaken meanwhile is nobody's news: it is only logged.
// Nothing is imported here: the caller says how a view is built, so the rules can be tested without a page.

// Unloading: a view you leave is removed a while later, with everything its cards hooked up (core/scope.js), so a screen
// that runs for weeks doesn't carry every page it ever showed. After how many seconds: ?unload=<s> (0 keeps everything),
// else dash.unload.after, else by screen: a computer (8 GB or more) 600 s, a TV 60 s, phones / panels 180 s.
/**
 * @param {import('./shapes.js').Dashboard} dash
 * @param {string} profile the display profile
 * @param {URLSearchParams} q the page's URL parameters
 * @returns {number} seconds; 0 = never
 */
export function unloadSeconds(dash, profile, q) {
  const U = dash.unload || {};
  return q.has('unload') ? +q.get('unload') : U.after != null ? U.after : navigator.deviceMemory >= 8 ? 600 : profile === 'tv' ? 60 : 180;
}

/**
 * A view's element as the router needs it (core/layout.js builds it).
 * @typedef {HTMLElement & { showPage?: (page?: string) => Promise<void>, current?: string, dispose?: () => void }} ViewElement
 */

/**
 * show() rejects when the view fails to build; open() is a press: a history entry, and a failure goes to onError.
 * @typedef {object} Router
 * @property {(full?: string | null, push?: boolean) => Promise<void>} show 'view' or 'view/page'; push: a history entry
 * @property {(full: string) => Promise<void>} open
 * @property {(view: import('./shapes.js').View) => void} prebuild builds a view unseen, unless it is built or being built
 * @property {() => string[]} views the ids of what is built (the leak checks)
 * @property {() => number} busy navigations under way
 */

/**
 * @param {object} o
 * @param {import('./shapes.js').View[]} o.views the dashboard's views; the first is where an unknown or empty id leads, and is never unloaded
 * @param {HTMLElement} o.app the element the views go into
 * @param {(view: import('./shapes.js').View) => Promise<ViewElement>} o.render how a view is built
 * @param {string[]} [o.keep] ids of other views that are never unloaded
 * @param {number} [o.after] seconds a view stays built once left (0: for good)
 * @param {(view: string, here: string) => void} [o.onShown] once a navigation is on screen, before `dash:shown`, with
 *   the view's id and 'view' or 'view/page': the rail and the tab bar mark it
 * @param {(error: any) => void} [o.onError] for a navigation nobody awaits (a press, the browser's Back) that failed:
 *   the caller tells the user
 * @returns {Router}
 */
export function initRouter({ views, app, render, keep = [], after = 0, onShown = (_view, _here) => {}, onError = (e) => console.error(e) }) {
  /** @type {Record<string, ViewElement>} */ const built = {};
  /** @type {Record<string, Promise<void>>} */ const building = {};   // while a view's card types load
  /** @type {Record<string, number>} */ const leaving = {};           // the timer that removes a view
  const kept = new Set([views[0].id, ...(keep || [])]);
  let shownAt = null, asked = 0, showing = 0;

  const unloadLater = (shown) => {
    clearTimeout(leaving[shown]); delete leaving[shown];
    if (!after) return;
    Object.keys(built).forEach((k) => {
      if (k === shown || kept.has(k) || leaving[k]) return;
      leaving[k] = setTimeout(() => {
        delete leaving[k];
        const el = built[k]; if (!el || !el.hidden) return;
        try { if (el.dispose) el.dispose(); } catch (e) { console.error(e); }
        el.remove(); delete built[k];
      }, after * 1000);
    });
  };
  // A view is built once, however often it is asked for while its card types load.
  // View options read here: back: 'home' (Back goes there; core/remote/back.js).
  const build = (view, hidden) => {
    building[view.id] = building[view.id] || render(view).then((el) => {
      if (hidden) el.hidden = true;
      if (view.back) el.dataset.back = view.back;
      app.appendChild(el); built[view.id] = el;
    }).finally(() => { delete building[view.id]; });
    return building[view.id];
  };
  const said = (changed) => window.dispatchEvent(new CustomEvent('dash:shown', { detail: { view: shownAt, changed } }));
  // The navigation asked for last is the one that ends up on screen: an earlier one that finishes later leaves its view
  // built and hidden.
  const go = async (full, push, turn) => {
    const [id, page] = String(full || '').split('/');
    const view = views.find((v) => v.id === id) || views[0];
    const elsewhere = () => !shownAt || shownAt.split('/')[0] !== view.id;   // this view is not the one on screen
    clearTimeout(leaving[view.id]); delete leaving[view.id];   // on its way out, wanted again
    if (!built[view.id]) await build(view);
    const el = built[view.id];
    // (a page that fails to build: its view, just built and never shown, must not stay on screen beside the one that is)
    if (turn === asked && el.showPage) { try { await el.showPage(page); } catch (e) { if (elsewhere()) el.hidden = true; throw e; } }
    if (turn !== asked) { if (elsewhere()) el.hidden = true; return; }   // a later navigation took over
    Object.entries(built).forEach(([k, v]) => { v.hidden = k !== view.id; });
    unloadLater(view.id);
    const here = el.current ? view.id + '/' + el.current : view.id;
    onShown(view.id, here);
    if (push) history.pushState(null, '', `?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(location.search)), v: here })}`);
    // to the top only for a new page: a pop-up's hash also fires popstate, and the page behind it must stay where it is
    if (push || here !== shownAt) window.scrollTo(0, 0);
    const changed = here !== shownAt;
    shownAt = here;
    said(changed);   // done and on screen: the remote places its highlight
  };
  const show = async (full, push) => {
    const turn = ++asked;
    showing++;
    try { await go(full, push, turn); }
    catch (e) { said(false); if (turn !== asked) console.error(e); else throw e; }
    finally { showing--; }
  };
  const open = (full) => show(full, true).catch(onError);
  window.addEventListener('dash:view', (e) => open(e.detail));
  window.addEventListener('popstate', () => show(new URLSearchParams(location.search).get('v')).catch(onError));

  return {
    show, open,
    prebuild(view) { if (!built[view.id] && !building[view.id]) build(view, true).catch((e) => console.error(e)); },
    views: () => Object.keys(built),
    busy: () => showing,
  };
}
