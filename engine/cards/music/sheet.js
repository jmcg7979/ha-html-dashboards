// The Music page's sheet: what you picked, where it plays (the rooms used last lit: tap rooms to add or drop them) and how
// (Play on … / Play next / Add to queue; a playlist also Pin). While it is open it is a layer (core/layers.js): Back closes
// it and the remote's highlight goes back to what it was opened for.
//   const S = playSheet({ el, W, targets, here, play })   el: the .msheet element; W: core/where.js over the targets;
//                                                          here: the room it starts with when none was used yet;
//                                                          play(entities, act, item, how): core/play.js through the card
//   S.open(item, opener, { list: the playlist a song was picked from, shuffle: true })
import { esc, icon, setHTML, setHTMLKeeping } from '../../core/dom.js';
import { membersOf } from '../../core/sync.js';
import { layer } from '../../core/layers.js';
import { SET, KIND, source, who, length, pin } from './items.js';
import { art } from './rows.js';

let where = null;   // the rooms picked last on this screen (entities, comma separated; kept in localStorage)
try { where = localStorage.getItem('music.where'); } catch (e) { /* private mode */ }

export function playSheet({ el: sheet, W, targets, here, play }) {
  const { onNow, queueOn } = W;
  const whereNow = () => { const l = String(where || '').split(',').filter((e) => targets.some((t) => t.entity === e)); return l.length ? l : here ? [here] : []; };
  // sel: what was picked; inList: the playlist it was picked from (Play then plays that playlist from it); how: { shuffle }
  let sel = null, picked = [], inList = null, how = {};
  const L = layer({ el: sheet, kind: 'menu', close: () => closeSheet() });
  function drawWho() {
    const live = targets.filter((t) => !t.group && queueOn(t));
    const nowRows = live.length ? `<div class="mpsec"><div class="label caption">Playing now</div>${live.map((t) => { const o = onNow(t);
      return `<div class="mnow">${o.pic ? `<img class="mnowi" alt="" src="${esc(o.pic)}">` : `<span class="mnowi">${icon(t.icon || 'speaker')}</span>`}<span class="mtx"><b>${esc(t.name)}</b><small>${esc([o.title, o.sub].filter(Boolean).join(' · '))}</small></span>
        <button class="mact" data-join="${esc(t.entity)}">${icon('playlist-plus')}<span>Add here</span></button></div>`; }).join('')}</div>` : '';
    setHTML(sheet.querySelector('.mswho'), `<div class="mswhohead"><div class="label caption">Play on</div><small class="mswhint">Pick one room, or several that play in sync</small></div>
      ${nowRows}${W.html(picked, 'data-w')}`);
    drawBar();
  }
  function drawBar() {
    const n = picked.length, label = n ? (how.shuffle ? 'Shuffle on ' : 'Play on ') + W.label(picked) : 'Pick a room';
    const acts = [['play', how.shuffle ? 'shuffle-variant' : 'play', label, 'prim'], ['next', 'skip-next-circle-outline', 'Play next'], ['add', 'playlist-plus', 'Add to queue']];
    if (sel && sel.media_type === 'playlist' && !how.shuffle) acts.push(['pin', sel.favorite ? 'pin-off-outline' : 'pin-outline', sel.favorite ? 'Unpin' : 'Pin']);
    setHTMLKeeping(sheet.querySelector('.msbar'), acts.map(([a, ic, t, c]) => `<button class="mact${c ? ' ' + c : ''}" data-act="${a}"${a !== 'pin' && !n ? ' disabled' : ''}>${icon(ic)}<span>${esc(t)}</span></button>`).join(''), 'data-act');
  }
  // opt: { list: the playlist a song was picked from, shuffle: true }
  function openSheet(it, btn, opt = {}) {
    sel = it; picked = whereNow(); inList = opt.list || null; how = { shuffle: !!opt.shuffle };
    if (picked.length === 1 && !W.isGroup(picked[0])) { const m = membersOf(picked[0]).filter((e) => targets.some((t) => t.entity === e)); if (m.length > 1) picked = m; }   // the rooms it plays in sync with come along, lit
    const kind = it.media_type, set = kind === 'track' && it.duration >= SET;
    const cap = [set ? 'DJ set' : KIND[kind] || '', it.duration ? length(it.duration) : '', inList ? 'plays ' + inList.name + ' from here' : '', how.shuffle ? 'shuffled' : ''].filter(Boolean).join(' · ');
    setHTML(sheet.querySelector('.mshead'), `${art(it, 160)}<span class="mtx"><span class="label caption">${esc(cap)}</span><b>${esc(it.name)}</b><small>${esc([who(it), source(it)].filter(Boolean).join(' · '))}</small></span>`);
    drawWho();
    sheet.hidden = false; sheet.scrollTop = 0; L.open(btn);
    sheet.querySelector('[data-act="play"]').focus({ preventScroll: true });
  }
  function closeSheet() { if (sheet.hidden) return; sheet.hidden = true; L.shut(); }
  sheet.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (ev.target.closest('.mclose')) { closeSheet(); return; }   // touch screens; a remote uses Back
    const j = ev.target.closest('[data-join]');
    if (j && sel) { play([j.dataset.join], 'add', sel); closeSheet(); return; }
    const w = ev.target.closest('[data-w]');
    if (w) {   // a tap adds the room or takes it out (core/where.js); the last choice is where the next sheet starts
      picked = W.choose(picked, w.dataset.w);
      if (picked.length) { where = picked.join(','); try { localStorage.setItem('music.where', where); } catch (x) { /* private mode */ } }
      W.mark(sheet, 'data-w', picked);
      drawBar(); return;
    }
    const b = ev.target.closest('[data-act]'); if (!b || !sel) return;
    if (b.dataset.act === 'pin') { pin(sel); closeSheet(); return; }
    if (!picked.length) return;
    if (b.dataset.act === 'play' && inList) play(picked.slice(), 'play', inList, { start: sel.uri });
    else play(picked.slice(), b.dataset.act, sel, b.dataset.act === 'play' ? how : {});
    closeSheet();
  });
  return { open: openSheet };
}
