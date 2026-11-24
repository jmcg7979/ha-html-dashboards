// Finding music: Moods, DJ sets and Search ask each of Music Assistant's services apart and list the answers a page at a
// time (docs: Music, "Results").
//   servicesNow() -> Promise<[domain]> the services MA searches, in the page's order    inOrder(domains)   names(domains) -> 'Spotify and SoundCloud'
//   KINDS[kind](answer) -> the items of that kind in one service's answer (playlist | set | song | artist)
//   lister(out, says) -> { show, kind, clear, resort, first, services }: one list of one kind, more as it scrolls
//   ordered(page: [[items of a service]]) -> one list, as the Sort chip says      sorting(slot, redraw): that chip
//   sourcePick(key, changed) -> { el, offer(domains), on(domains) }: the Source chip, its choice kept on this screen
import { esc, setHTML } from '../../core/dom.js';
import * as MA from '../../core/ma.js';
import { rank, interleave } from '../../core/rank.js';
import { pick } from '../../core/pick.js';
import { SEARCH_KEPT, MORE_AGAIN } from '../../core/music-timing.js';
import { SET, SRC } from './items.js';
import { numbersOf, rate } from './numbers.js';
import { row, empty, NO_MA, fillRates, fillSizes } from './rows.js';

// ---- searching: each service apart (MA's own search cuts the services' answers together to `limit` in all, and has no
// "next page"), 25 first, then 100 for the pages after; the order of each page: most liked first, or as matched ----
export const PAGE = 25;
const MORE = 100;
// the services to search (MA's, core/ma.js sources): Spotify and SoundCloud first as before, any other after them by name.
// A service MA adds later shows up by itself; its name is learned here for the rows' source.
const FIRST = ['spotify', 'soundcloud'];
export function inOrder(domains) {
  const at = (d) => { const i = FIRST.indexOf(d); return i < 0 ? FIRST.length : i; };
  return [...domains].sort((a, b) => at(a) - at(b) || (SRC[a] || a).localeCompare(SRC[b] || b));
}
export function servicesNow() {
  return MA.sources().then((l) => {
    l.forEach((x) => { if (!SRC[x.domain]) SRC[x.domain] = x.name; });
    return inOrder(l.map((x) => x.domain));
  });
}
export const names = (list) => { const n = list.map((d) => SRC[d] || d); return n.length > 1 ? n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1] : n[0] || ''; };
export const KINDS = { playlist: (r) => r.playlists || [], set: (r) => (r.tracks || []).filter((x) => x.duration >= SET),
  song: (r) => (r.tracks || []).filter((x) => !(x.duration >= SET)), artist: (r) => r.artists || [] };
const size = (r) => ['playlists', 'tracks', 'artists'].reduce((n, k) => n + ((r && r[k]) || []).length, 0);
const findKey = (q, types, s, limit) => `q:${s}:${limit}:${types.join(',')}:${q}`;
const find = (q, types, s, limit) => MA.kept(findKey(q, types, s, limit), SEARCH_KEPT, () => MA.cmd('music/search', { search_query: q, media_types: types, limit, providers: [s] }));
// the bigger search. MA gives a service 8 s, then answers without it and lets it finish in the background (SoundCloud
// takes longer than that for 100): an answer smaller than the first one is asked again a little later (MA has it by then)
const MORE_TRIES = 4;
function findMore(q, types, s, first, tries = MORE_TRIES) {
  return find(q, types, s, MORE).then((r) => {
    if (size(r) >= size(first) || tries <= 1) return size(r) >= size(first) ? r : first;
    MA.forget(findKey(q, types, s, MORE));
    return new Promise((ok) => setTimeout(ok, MORE_AGAIN)).then(() => findMore(q, types, s, first, tries - 1));
  }, () => first);
}
let sortBy = 'top';   // 'top': most liked first; 'match': as the services matched the words
try { sortBy = localStorage.getItem('music.sort') === 'match' ? 'match' : 'top'; } catch (e) { /* private mode */ }
const SORTS = [{ id: 'top', name: 'Most liked' }, { id: 'match', name: 'Best match' }];
// a page ([[one service's items], …]) as one list, in the order chosen
export const ordered = (page) => (sortBy === 'top' ? rank(page.flat(), numbersOf) : interleave(page));
// the Sort chip (core/pick.js), put in `slot`: it chooses between the two for every Music tab of this screen, and calls redraw()
export function sorting(slot, redraw) {
  const p = pick({ label: 'Sort', options: SORTS, value: sortBy, cls: 'mchip msort', tone: 'plum', onChange: (v) => {
    sortBy = v;
    try { localStorage.setItem('music.sort', sortBy); } catch (e) { /* private mode */ }
    window.dispatchEvent(new CustomEvent('music:sort')); } });
  slot.replaceWith(p.el);
  addEventListener('music:sort', () => { if (p.el.isConnected) { p.set({ value: sortBy }); redraw(); } });
}
// the services chosen in a Source chip, kept on this screen under `key`; none chosen = all of them
export function sourcePick(key, changed) {
  let only = [];
  try { only = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { /* private mode */ }
  const p = pick({ label: 'Source', multi: true, values: only, cls: 'mchip', tone: 'plum', onChange: (v) => {
    try { localStorage.setItem(key, JSON.stringify([...v])); } catch (e) { /* private mode */ }
    changed(); } });
  p.el.hidden = true;
  return { el: p.el,
    // the services there are: the chip shows with two or more
    offer(list) { p.set({ options: list.map((d) => ({ id: d, name: SRC[d] || d.replace(/_/g, ' ') })) }); p.el.hidden = list.length < 2; },
    // of `list`, the ones chosen (all of it when none is)
    on(list) { const v = p.value(), x = list.filter((d) => v.has(d)); return x.length ? x : list; } };
}

// ---- results a page at a time: one list (`out`) of one kind, from each service apart ----
// show(q, types, kind) starts a search; kind(k) shows another kind of the same search; resort() draws the pages again in
// the order the Sort chip says. The first page is each service's first 25; the next pages come from a search for 100
// (asked as soon as the first is in), each page ordered on its own, so what is on screen never moves.
export function lister(out, says) {
  // R: the search (its two answers); V: what is listed of it (one kind, its pages). A new search or kind is a new V,
  // so a page still on its way for the last one is dropped.
  let R = null, V = null;
  function rows(page) { return ordered(page).map((x) => row(x)).join(''); }
  function draw() {
    const v = V;
    setHTML(out, v.pages.map(rows).join('') || empty(v.done ? says.none : 'Looking…'));
    if (v.pages.length) out.insertAdjacentHTML('beforeend', v.done ? `<div class="mempty mend">${esc(says.end(names(R.svcs)))}</div>` : '<div class="mempty mmore">Getting more…</div>');
    seen.disconnect(); const more = out.querySelector('.mmore'); if (more) seen.observe(more);
    fillSizes(out);
  }
  // the next page: from each service, the next PAGE of this kind not listed yet (from the bigger search once it is in)
  function next() {
    const v = V, r = R; if (!v || !r || !r.first || v.busy || v.done) return;
    const src = r.big || r.first;
    const page = r.svcs.map((s) => KINDS[v.kind](src[s] || {}).filter((x) => !v.seen.has(x.uri)).slice(0, PAGE));
    if (!page.some((l) => l.length)) {
      if (r.big || r.bigFailed) { v.done = true; draw(); return; }
      v.busy = true; r.more().then(() => { v.busy = false; if (v === V) next(); });   // the bigger search isn't in yet
      return;
    }
    if (v.pages.length) r.more();   // past the first page: the bigger search now (not before: MA's Spotify is slow to share)
    v.busy = true;
    page.flat().forEach((x) => v.seen.add(x.uri));
    rate(page.flat()).then(() => {
      v.busy = false; if (v !== V) return;
      v.pages.push(page);
      const keep = out.scrollTop; draw(); out.scrollTop = keep;
    });
  }
  const list = (kind) => { V = kind ? { kind, pages: [], seen: new Set(), busy: false, done: false } : null; };
  // the next page when "Getting more…" comes into view, however the list scrolls (inside the card; the page on a phone)
  const seen = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) next(); }, { rootMargin: '0px 0px 400px 0px' });
  addEventListener('music:rated', () => { if (out.isConnected) fillRates(out); });
  return {
    // -> Promise of the first answers ({ service: MA's search result }); kind null: list nothing yet (Search's All).
    // only(services) -> the services to search, of all MA has (default: all)
    show(q, types, kind, only = (l) => l) {
      const r = R = { first: null, big: null, svcs: [] }; list(kind);
      setHTML(out, empty('Looking…')); out.scrollTop = 0;
      return MA.available().then((ok) => {
        if (!ok) throw new Error('no MA');
        return servicesNow();
      }).then((all) => {
        r.svcs = only(all);
        return Promise.all(r.svcs.map((s) => find(q, types, s, PAGE).catch(() => ({}))));
      }).then((a) => {
        if (r !== R) return null;
        r.first = Object.fromEntries(r.svcs.map((s, i) => [s, a[i]]));
        // the bigger search, asked once the list is scrolled past its first page: MA's Spotify takes a request every 2 s,
        // and a playlist opened from the first page shouldn't wait behind it
        r.more = () => r.bigP || (r.bigP = Promise.all(r.svcs.map((s, i) => findMore(q, types, s, a[i]))).then((b) => { r.big = Object.fromEntries(r.svcs.map((s, i) => [s, b[i]])); }, () => { r.bigFailed = true; }));
        next();
        return r.first;
      }, (e) => { if (r === R) setHTML(out, empty(e && e.message === 'no MA' ? NO_MA : 'Music Assistant didn’t answer')); return null; });
    },
    kind(k) { list(k); if (!k) return; setHTML(out, empty(R ? 'Looking…' : says.hint || '')); out.scrollTop = 0; next(); },
    // nothing searched: the hint, as at first (the box was cleared)
    clear() { R = null; V = null; seen.disconnect(); setHTML(out, empty(says.hint || '')); out.scrollTop = 0; },
    resort() { if (V && V.pages.length) { const keep = out.scrollTop; draw(); out.scrollTop = keep; } },
    first: () => R && R.first, services: () => (R ? R.svcs : []),
  };
}
