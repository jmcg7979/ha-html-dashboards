// Rooms, over the player card (cards/media-detail.js): the Music page's picker (core/where.js) with the rooms the music
// plays on lit, each over its own volume strip, and an All rooms volume on top when there are several. A tap changes the
// rooms at once (core/session.js moveTo): out if the room plays (not the last one), in if it can play in sync; a room
// that can't (or a speaker group) is armed by the first tap and a second one moves the music there.
// A Spotify cast (no MA queue) lists the account's Spotify devices in the same layer; a tap moves the music there.
//   const R = roomsLayer({ o, S, W, targets, playerFor, shown, left, moved })
//     o: the layer's element; shown() -> the layer open over the card ('move': this one)
//     left(entity | null): the music left this room for that one (null: for several, or a group); moved(): a Spotify cast
//     went to another device
//   R.draw(fresh)   fresh: build the tiles again (else only their words, marks and volumes)      R.opened()
//   R.on() -> the rooms shown as playing: what was asked for until Music Assistant has done it, else what plays
//   R.label(view) -> "Kitchen + Patio" | "Kitchen + 2 rooms" | '' (it plays in one room)
//   R.devices() -> core/spotify.js devices() of the cast shown, or null       R.click(ev) -> true when the press was its own
import { esc, icon, setText, setHTMLKeeping } from '../../core/dom.js';
import { toast } from '../../core/toast.js';
import { pending } from '../../core/wake.js';
import { volOf, setVol, groupVol, setGroupVol, plusRooms } from '../../core/sync.js';
import * as SP from '../../core/spotify.js';
import { ROOM_ARMED, ROOMS_WANTED } from '../../core/music-timing.js';
import { dragBar } from './bar.js';

export function roomsLayer({ o, S, W, targets, playerFor, shown, left, moved }) {
  const pk = o.querySelector('.mpick'), all = o.querySelector('.mdmall'), note = o.querySelector('[data-note="on"]');
  // want: the rooms asked for, shown until Music Assistant has done it: for ROOMS_WANTED, and for as long as one of them is
  // still on its way (a TV being turned on takes longer: core/wake.js)
  let want = null, armed = null, armT = 0;
  const actual = () => S.snap.rooms.filter((e) => targets.some((t) => t.entity === e));
  const on = () => {
    const now = actual();
    if (want && ((Date.now() > want.until && !want.list.some((e) => pending(e))) || (want.list.length === now.length && want.list.every((e) => now.includes(e))))) want = null;
    return want ? want.list : now;
  };
  // the name of the music's rooms, this one first
  const label = (view) => { const src = view.live, list = view.rooms, names = [src, ...list.filter((e) => e !== src)].map((e) => W.nameOf(e)).filter(Boolean);
    return list.length < 2 || names.length < 2 ? '' : plusRooms(names); };
  const devices = () => { const v = S.snap; return SP.devices(!v.live && v.spotify); };
  // the account's devices under the same headings as the rooms (speaker groups, each floor), by name
  const rooms = () => targets.map((t) => { const pl = playerFor(t.entity); return { key: pl ? pl.name : t.name, name: t.name, icon: t.icon, title: t.group ? 'Speaker groups' : t.floor || 'Rooms' }; });
  function draw(fresh) {
    const list = on(), spd = devices();
    setText(o.querySelector('.mdmhead b'), spd ? 'Play on' : 'Rooms');
    if (spd) {
      const key = spd.list.join('|') + '>' + spd.cur;
      if (fresh || pk.dataset.sp !== key) { pk.dataset.sp = key;
        const tile = (x) => `<button class="mpk${x.dev === spd.cur ? ' on' : ''}" data-spdev="${esc(x.dev)}"><span class="mpki">${icon(x.icon)}</span><span class="mtx"><b>${esc(x.name)}</b><small>${x.dev === spd.cur ? 'Playing here' : x.name === x.dev ? '' : esc(x.dev)}</small></span><i class="mpkc">${icon('check-circle')}</i></button>`;
        setHTMLKeeping(pk, SP.deviceSections(spd.list, rooms()).map((sec) => `<div class="mpsec"><div class="label caption">${esc(sec.title)}</div><div class="mpgrid">${sec.list.map(tile).join('')}</div></div>`).join(''), 'data-spdev'); }
      all.hidden = true;
      setText(note, 'Your Spotify devices. Tap one to move the music there.');
      return;
    }
    delete pk.dataset.sp;
    if (fresh) setHTMLKeeping(pk, W.html(list, 'data-target', { volume: true, mark: (t) => (armed === t.entity ? 'Tap again to move the music here' : null) }), 'data-target');
    else { W.update(pk); W.mark(pk, 'data-target', list); }
    W.volumes(pk);
    all.hidden = list.length < 2;
    if (!all.hidden && !all.classList.contains('drag')) { const v = groupVol(list); all.querySelector('.mvbar i').style.width = v * 100 + '%'; setText(all.querySelector('.mvtxt'), Math.round(v * 100) + '%'); }
    setText(note, 'Tap a room to add it or take it out. A dimmed room can’t play in sync with these: tap it twice to move the music there.');
  }
  function tap(e) {
    const list = on(), next = W.choose(list, e);
    if (!next.length) { toast('It only plays here. Stop ends the music.'); return; }
    const moves = !list.includes(e) && next.length === 1 && next[0] === e && (list.length > 0 || !!S.snap.live);   // it would replace the rooms it plays on (also when this player isn't itself among the rooms listed)
    if (moves && armed !== e) { armed = e; clearTimeout(armT); armT = setTimeout(() => { armed = null; if (shown() === 'move') draw(true); }, ROOM_ARMED); draw(true); return; }
    armed = null; clearTimeout(armT);
    const stays = next.includes(S.snap.live);
    if (!S.moveTo(next, W, playerFor)) return;   // a TV that's off is turned on first (core/wake.js)
    want = { list: next, until: Date.now() + ROOMS_WANTED };
    if (stays) draw(true); else left(next.length === 1 ? next[0] : null);
  }
  // a room's volume (data-vol="<entity>"), or all rooms' ("all"): the − / + buttons step 5%, the bar takes a tap or a drag
  const volGet = (k) => (k === 'all' ? groupVol(on()) : volOf(k)), volSet = (k, v) => (k === 'all' ? setGroupVol(on(), Math.max(0, Math.min(1, v))) : setVol(k, v));
  dragBar(o, {
    pick: (ev) => ev.target.closest('.vrow .mvbar'),
    show(bar, v) { const row = bar.closest('.vrow'); row.classList.add('drag'); bar.querySelector('i').style.width = v * 100 + '%'; setText(row.querySelector('.mvtxt'), Math.round(v * 100) + '%'); },
    done(bar, v) { const row = bar.closest('.vrow'); row.classList.remove('drag'); if (v != null) volSet(row.dataset.vol, v); else draw(false); },
  });
  function click(ev) {
    const tg = ev.target.closest('.mpick [data-target]');
    if (tg) { tap(tg.dataset.target); return true; }
    const sd = ev.target.closest('.mpick [data-spdev]');
    if (sd) { const spd = devices(); if (spd && sd.dataset.spdev !== spd.cur) { SP.moveTo(spd, sd.dataset.spdev); toast(`Moving the music to ${sd.dataset.spdev}…`); moved(); } return true; }
    const vb = ev.target.closest('.vrow [data-vd], .vrow [data-vu]');
    if (vb) { const k = vb.closest('[data-vol]').dataset.vol; volSet(k, Math.round(volGet(k) * 20 + (vb.hasAttribute('data-vu') ? 1 : -1)) / 20); return true; }
    return false;
  }
  return { draw, on, label, devices, click, opened() { armed = null; draw(true); } };
}
