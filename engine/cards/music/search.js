// The Music page's Search: a big box, filters, one list with what you need to tell things apart (kind, length, size,
// likes). All: the best few of each kind; a filter: that kind, a page at a time as the list scrolls (find.js lister).
import { esc, icon, toggle, setHTML } from '../../core/dom.js';
import { toast } from '../../core/toast.js';
import * as MA from '../../core/ma.js';
import { onTV, canListen, listen, warmListen } from '../../core/tvhost.js';
import { layer } from '../../core/layers.js';
import { TYPED_WAIT } from '../../core/music-timing.js';
import { rate } from './numbers.js';
import { row, empty, fillSizes } from './rows.js';
import { PAGE, KINDS, servicesNow, names, lister, ordered, sorting, sourcePick } from './find.js';

export default function search({ body }) {
  const F = [['all', 'All'], ['playlist', 'Playlists'], ['set', 'DJ sets'], ['song', 'Songs'], ['artist', 'Artists']];
  // In the box: the words, × to clear them and, where the launcher can hear (core/tvhost.js listen), a mic, highlighted first
  // on a TV. The remote's own mic button goes to Google's Assistant, never here. The browser's own × is hidden: the remote
  // can't reach it.
  const voice = canListen();
  const HINT = voice ? 'Type, or press the mic and say what you want' : onTV ? 'Type, or use the mic on the TV keyboard' : 'Type to search';
  setHTML(body, `<div class="msearch"${voice ? ' data-enter=".mmic"' : ''}><span class="mbox">${icon('magnify')}<input type="search" data-focus${voice ? '' : ' data-focus-first'} placeholder="Search" enterkeyhint="search" autocomplete="off">
    <button class="mboxbtn mclr" aria-label="Clear" hidden>${icon('close')}</button>${voice ? `<button class="mboxbtn mmic" aria-label="Search by voice" data-focus-first>${icon('microphone')}</button>` : ''}</span></div>
    <div class="mchips">${F.map(([k, t], i) => `<button class="mchip${i ? '' : ' on'}" data-f="${k}">${esc(t)}</button>`).join('')}<span class="mpicks"><i data-slot="sort"></i></span></div>
    <div class="mlist" data-enter=".mrow" data-backto="${voice ? '.mmic' : 'input'}">${empty(HINT)}</div>`);
  const inp = body.querySelector('input'), out = body.querySelector('.mlist'), clr = body.querySelector('.mclr');
  const L = lister(out, { none: 'Nothing found', end: (n) => `That’s all ${n} have for this search`, hint: HINT });
  let f = 'all', n = 0, t = 0, all = [];
  // the services searched: the Source chip (MA's services, so one added in MA shows up by itself), all of them at first;
  // the choice is kept on this screen
  const srcP = sourcePick('music.src', () => { drawSources(); go(true); });
  const on = (l) => srcP.on(l);
  body.querySelector('.mpicks').prepend(srcP.el);
  const drawSources = () => { inp.placeholder = 'Search ' + names(on(all)); };
  MA.available().then((ok) => (ok ? servicesNow() : [])).then((l) => { all = l; srcP.offer(all); drawSources(); }, () => {});
  const TOP = { playlist: 5, set: 5, song: 5, artist: 3 }, TITLE = { playlist: 'Playlists', set: 'DJ sets', song: 'Songs', artist: 'Artists' };
  // All: each kind's first page from each service, ordered, its best few
  const drawAll = () => {
    const res = L.first(); if (!res) return;
    const pages = Object.keys(TOP).map((k) => [k, L.services().map((v) => KINDS[k](res[v] || {}).slice(0, PAGE))]);
    const mine = n;
    rate(pages.flatMap(([, p]) => p.flat())).then(() => {
      if (mine !== n || f !== 'all') return;
      const html = pages.map(([k, p]) => [k, ordered(p).slice(0, TOP[k])]).filter(([, l]) => l.length)
        .map(([k, l]) => `<div class="label caption mhead">${TITLE[k]}</div>` + l.map((x) => row(x, { kind: true })).join('')).join('');
      setHTML(out, html || empty('Nothing found')); out.scrollTop = 0; fillSizes(out);
    });
  };
  // again: the services changed (the words didn't); nothing typed yet: nothing to do
  function go(again = false) {
    const s = inp.value.trim(); if (s.length < 2) return;
    if (again && !L.first()) return;
    const mine = ++n;
    const shown = L.show(s, ['playlist', 'track', 'artist'], f === 'all' ? null : f, on);
    if (f === 'all') Promise.resolve(shown).then(() => { if (mine === n && f === 'all') drawAll(); });
  }
  const showClear = () => { clr.hidden = !inp.value; };
  inp.addEventListener('input', () => { showClear(); clearTimeout(t); t = setTimeout(go, TYPED_WAIT); });
  // ×: the words and the results go; the highlight to the mic (or the box), not lost with the hidden ×
  clr.addEventListener('click', () => {
    clearTimeout(t); n++; inp.value = ''; showClear(); L.clear();
    const to = body.querySelector('.mmic') || inp; to.focus({ preventScroll: true });
  });
  // Speak: the words show in the box as they are heard; the last ones search. While listening the search row keeps the
  // remote and Back stops it, putting back what was typed.
  const mic = body.querySelector('.mmic'), bar = body.querySelector('.msearch');
  let ear = null, typed = '';
  const NOT_HEARD = { nomatch: 'Didn’t catch that. Try again', silence: 'Didn’t hear anything', mic: 'The TV’s microphone isn’t available', network: 'Voice needs the internet', busy: 'The TV is still listening to something else' };
  const hearing = (on) => {
    toggle(bar, 'hearing', on); toggle(mic, 'on', on); toggle(mic, 'live', false);
    if (on) hears.open(); else hears.shut();
    mic.setAttribute('aria-label', on ? 'Stop listening' : 'Search by voice');
    showClear();
    if (!on) { ear = null; drawSources(); }   // the placeholder back
  };
  const stopEar = () => { if (!ear) return; ear(); inp.value = typed; hearing(false); };
  const hears = layer({ el: bar, kind: 'menu', close: stopEar });   // while it listens the search row is a layer: it keeps the remote, and Back stops it
  if (mic) {
    mic.addEventListener('click', () => {
      if (ear) { stopEar(); return; }
      typed = inp.value; inp.value = ''; inp.placeholder = 'Starting the mic…';   // 'Listening…' once the recognizer says it hears
      hearing(true);
      ear = listen((d) => {
        if (!mic.getClientRects().length) { stopEar(); return; }   // another tab or view meanwhile: hearing ends (it also ends by itself after a few quiet seconds)
        if (d.state === 'listening') { inp.placeholder = 'Listening…'; toggle(mic, 'live', true); }
        else if (d.state === 'words') { inp.value = d.text || ''; showClear(); }
        else if (d.state === 'done') { inp.value = d.text; hearing(false); clearTimeout(t); go(); }
        else if (d.state === 'error') { inp.value = typed; hearing(false); toast(NOT_HEARD[d.error] || 'Voice didn’t work this time'); }
      });
    });
    warmListen(true);   // the recognizer ready before the first press; again when the screen comes back to the front
    addEventListener('tv:resume', () => { if (mic.isConnected) warmListen(true); });
  }
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(t); go(); inp.blur(); const r = out.querySelector('.mrow'); if (r) r.focus(); } });
  body.querySelector('.mchips').addEventListener('click', (ev) => { const c = ev.target.closest('[data-f]'); if (!c) return; f = c.dataset.f; body.querySelectorAll('[data-f]').forEach((x) => toggle(x, 'on', x === c));
    L.kind(f === 'all' ? null : f); if (f === 'all') drawAll(); });
  sorting(body.querySelector('[data-slot="sort"]'), () => (f === 'all' ? drawAll() : L.resort()));
  const qs = new URLSearchParams(location.search).get('musicq'); if (qs) { inp.value = qs; showClear(); go(); }   // screenshots / links: &musicq=
  const qf = new URLSearchParams(location.search).get('musicf'); if (qf) { const c = body.querySelector(`[data-f="${CSS.escape(qf)}"]`); if (c) c.click(); }   // and a filter: &musicf=playlist
}
