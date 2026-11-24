// Lyrics for the song playing, the same on every screen (the TV's Now playing, the media pop-up); styles in
// css/cards/player-parts.css. Synced lines (LRC) follow the song: an intro of notes until the singing starts, the sung line a
// little above the middle, bigger and brighter; plain text when that's all Music Assistant has.
//   const L = lyricsUI(S)   S: core/session.js      L.el: put it in a box with a height
//   L.draw()        call when the session changes (a new song loads its lyrics)
//   L.show(on)      the box is shown / hidden: lines are only followed while shown; "none" is asked again when it opens
// "None" is also asked again 10 s and 30 s later: MA's first lookup can come back empty while it is still fetching the song.
// The point is the words being there when the song starts. Music Assistant looks lyrics up one song at a time (one a
// second, or one per 30 s: core/music-timing.js), so the two songs after this one are asked for as soon as this one's are
// in; a song that wasn't asked ahead is asked for once it has stayed current a moment (one skipped past never is); and an
// answer that is late is waited for, not read as "none".
import { h, esc, icon, setHTML, toggle } from './dom.js';
import * as MA from './ma.js';
import { onDispose } from './scope.js';
import { LYRICS_AGAIN, LYRICS_BEAT, LYRICS_LEAD_S, LYRICS_SETTLE, LYRICS_AHEAD_SONGS, LYRICS_LATE_AGAIN, LYRICS_LATE_TRIES } from './music-timing.js';

export function lyricsUI(S, opt = {}) {   // opt.eager: load a song's lyrics before the box is shown (the TV, so Lyrics opens at once)
  const el = h('<div class="plyr"></div>');
  let shown = false, lines = null, uri = null, item = null, tries = 0, late = 0, found = false, retry = 0, on = -2;
  const NONE = '<div class="pempty">No lyrics for this song</div>', LOOKING = '<div class="pempty">Looking for lyrics…</div>';
  const later = (ms, again) => { clearTimeout(retry); retry = setTimeout(() => { if (el.isConnected) load(again); }, ms); };

  // the songs after this one: asked for now, so their lyrics are there when each starts (one that is kept isn't asked again)
  const askAhead = () => { const v = S.snap; for (let k = 1; k <= LYRICS_AHEAD_SONGS; k++) { const next = MA.itemAt(v.data, v.cur + k); if (next) MA.lyrics(next); } };

  function load(again) {
    const mine = uri; clearTimeout(retry);
    MA.lyrics(item, again).then((L) => {
      if (uri !== mine) return;
      // MA is still looking (a lookup waits its turn there, up to 30 s): not "none" yet
      if (L.late && late < LYRICS_LATE_TRIES) { late++; later(LYRICS_LATE_AGAIN, true); return; }
      lines = L.lines; found = !!(L.lines || L.text); on = -2;
      toggle(el, 'lrc', !!L.lines);
      if (L.lines) setHTML(el, `<div class="plin"><div class="pintro">${`<i>${icon('music-note')}</i>`.repeat(7)}</div>${L.lines.map((l, i) => `<p data-i="${i}">${l.text ? esc(l.text) : icon('music-note')}</p>`).join('')}</div>`);
      else if (L.text) setHTML(el, `<div class="plplain">${esc(L.text)}</div>`);
      else {
        setHTML(el, NONE);
        if (tries < LYRICS_AGAIN.length) later(LYRICS_AGAIN[tries++], true);
      }
      follow();
      askAhead();
    });
  }
  // the line being sung; the lines glide (a transform, not a scroll) so it sits a little above the middle
  function follow() {
    if (!lines || !shown) return;
    const t = (S.pos(S.snap.n) || 0) + LYRICS_LEAD_S; let i = -1;   // a hair early, so the line is up as the singing starts
    for (let k = 0; k < lines.length && lines[k].t <= t; k++) i = k;
    // before the first line: the intro's notes light up one by one until the singing starts (as MA's own panel does)
    const intro = el.querySelector('.pintro');
    if (intro) { const n = i < 0 ? Math.floor(7 * Math.min(1, t / Math.max(1, lines[0].t))) : 7; intro.querySelectorAll('i').forEach((x, k) => toggle(x, 'lit', k < n)); toggle(intro, 'on', i < 0); }
    if (i === on) return;
    on = i;
    const lin = el.querySelector('.plin'); if (!lin) return;
    lin.querySelectorAll('p').forEach((p) => { const k = Math.abs(+p.dataset.i - i); p.className = i < 0 ? '' : k === 0 ? 'on' : k === 1 ? 'near' : ''; });
    const p = i < 0 ? intro : lin.querySelector(`p[data-i="${i}"]`);
    if (p) lin.style.transform = `translateY(${Math.round(el.clientHeight * 0.42 - (p.offsetTop + p.offsetHeight / 2))}px)`;
  }
  function draw(now = false) {   // now: ask at once (the box was just opened: the song didn't just start)
    if (!shown && !opt.eager) return;
    const it = S.snap.item, u = it && it.media_item && it.media_item.uri;
    if (u === uri) return;
    uri = u; item = it; tries = 0; late = 0; lines = null; found = false; on = -2;
    clearTimeout(retry);
    setHTML(el, u ? LOOKING : NONE);
    if (!u) return;
    // asked at once when the answer is here or on its way (it was asked ahead); else once the song has stayed a moment:
    // each lookup holds up the next one in Music Assistant, so a song skipped past isn't asked for
    if (now || MA.lyricsKept(it)) load(false); else later(LYRICS_SETTLE, false);
  }
  const fast = setInterval(() => { if (shown && lines && !document.hidden && el.isConnected) follow(); }, LYRICS_BEAT);   // on the beat
  onDispose(() => { clearInterval(fast); clearTimeout(retry); });
  return { el, draw, show(v) { shown = !!v; const was = uri; draw(true); if (shown && uri && uri === was && !found) load(true); on = -2; follow(); } };
}
