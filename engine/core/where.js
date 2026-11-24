// Where music plays: one picker for every "Play on" (the Music page's sheet and Party, the media pop-up), styles in
// css/cards/picker.css (.mpk…). Speaker groups first, then each floor in the order the site lists them; a tile per player
// with what's on it: its session's song for a player of home.js (core/session.js: off / home screen / an app / a cast, as
// its pop-up shows it, smoothed through song changes), its own entity for a target with no player behind it.
//   const W = where({ targets: [{ entity, name, icon, floor, group }], playerOf: (target) => home.js player | null, own })
//   W.html(picked, attr, { mark, volume }) tiles carry attr="<entity>" (data-w, data-party, data-target);
//                                          volume: true puts a volume strip (data-vol="<entity>": − bar + %) under each tile,
//                                          shown while the tile is lit; W.volumes(root) fills them in
//                                          mark: (target) => 'Playing here' etc. in place of the status line
//   W.choose(picked, entity) -> the new selection after a tap: rooms that can play in sync add up (core/sync.js); a room
//                                          that can't sync with the ones picked, or a speaker group, stands alone. Such a
//                                          room is dimmed (.solo) while others are picked: a tap switches to it
//   W.label(picked) -> 'Kitchen' | '3 rooms'      W.mark(root, attr, picked): light the picked tiles
//   W.update(root)  refresh the status lines under root
//   W.watch(fn)     fn() when anything a tile shows changes: the targets' entities and their players' songs (call it
//                   while the card is built: it is undone with the card's view)
//   W.onNow(target) -> { live, playing, title, sub, pic (an address that loads from anywhere), pp, off, stopped }  (stopped: MA kept a stopped queue with a song here, shown as paused; pp resumes it)
//      W.queueOn(target): playing an MA queue (not a TV app)
import { esc, icon, toggle } from './dom.js';
import { st, watch, soon } from './store.js';
import { onDispose } from './scope.js';
import { idsOf, maOf, stoppedNow, groupNow, artUrl } from './players.js';
import { session } from './session.js';
import { canSync, load, volOf } from './sync.js';

export function where({ targets, playerOf = () => null, own = '' }) {
  load(targets.filter((t) => !t.group).map((t) => t.entity));
  const onNow = (t) => {
    const p = playerOf(t);
    if (p) {
      const v = session(p).snap, n = v.song, r = p.power && st(p.power);
      // playing its speaker group's music: that, named after the group; play / pause goes to the group
      const g = groupNow(p, v.now), ge = g && st(g);
      if (ge) { const a = ge.attributes, gt = targets.find((x) => x.entity === g), gn = gt ? gt.name : a.friendly_name || '';
        return { live: true, playing: ge.state === 'playing', title: a.media_title || gn, sub: [a.media_artist, gn ? 'With ' + gn : '', ge.state === 'paused' ? 'Paused' : ''].filter(Boolean).join(' · '), pic: artUrl(a.entity_picture_local || a.entity_picture), pp: g }; }
      // MA stopped with its queue kept (and nothing else playing): that, not the remote's "TV on"
      if (v.stopped) { const s = stoppedNow(p, v.now); return { live: false, stopped: true, title: s.title, sub: [s.artist, 'Paused'].filter(Boolean).join(' · '), pic: artUrl(s.pic), pp: maOf(p) }; }
      if (n && !n.screen) return { live: true, playing: n.state === 'playing' || !!n.starting, title: n.title, sub: [n.artist || n.app, n.state === 'paused' ? 'Paused' : ''].filter(Boolean).join(' · '), pic: artUrl(n.pic), pp: v.caps.pause || v.caps.play };
      const e = st(t.entity);
      return { live: false, off: !!r && r.state === 'off', title: n ? 'Home screen' : r && r.state === 'off' ? 'Off' : !e || e.state === 'unavailable' ? 'Not available' : 'Nothing playing' };
    }
    const e = st(t.entity), a = (e && e.attributes) || {};
    if (e && ['playing', 'paused', 'buffering'].includes(e.state) && a.media_title) return { live: true, playing: e.state === 'playing', title: a.media_title, sub: [a.media_artist, e.state === 'paused' ? 'Paused' : ''].filter(Boolean).join(' · '), pic: artUrl(a.entity_picture_local || a.entity_picture), pp: t.entity };
    if (e && e.state === 'idle' && a.active_queue && a.media_title) return { live: false, stopped: true, title: a.media_title, sub: [a.media_artist, 'Paused'].filter(Boolean).join(' · '), pic: artUrl(a.entity_picture_local || a.entity_picture), pp: t.entity };
    return { live: false, off: !e || e.state === 'unavailable', title: !e || e.state === 'unavailable' ? 'Not available' : 'Nothing playing' };
  };
  const queueOn = (t) => { const p = playerOf(t); if (p) return !!session(p).snap.live; const e = st(t.entity); return !!e && ['playing', 'paused'].includes(e.state) && !!e.attributes.active_queue; };
  const ids = targets.flatMap((t) => { const p = playerOf(t); return p ? [t.entity, ...idsOf(p)] : [t.entity]; });
  // the entities say most of it; a player's session says the rest (a song held through a change and then let go)
  const watchAll = (fn) => { const later = soon(fn); watch(ids, later); targets.forEach((t) => { const p = playerOf(t); if (p) onDispose(session(p).on(later, { queue: false })); }); };
  const shortNow = (o) => (o.live || o.stopped ? (o.playing ? '' : 'Paused · ') + o.title : o.title);
  function sections() {
    const out = [], groups = targets.filter((t) => t.group);
    if (groups.length) out.push({ title: 'Speaker groups', list: groups, grp: true });
    for (const t of targets.filter((x) => !x.group)) {
      const f = t.floor || 'Rooms', s = out.find((x) => x.title === f && !x.grp);
      if (s) s.list.push(t); else out.push({ title: f, list: [t] });
    }
    return out;
  }
  let marks = null;
  const isGroup = (e) => !!(targets.find((t) => t.entity === e) || {}).group;
  const fits = (picked, e) => picked.filter((x) => !isGroup(x)).every((r) => canSync(r, e));
  const solo = (picked, e) => !picked.includes(e) && !isGroup(e) && !fits(picked, e);   // picking it drops the rooms picked now
  const tile = (t, on, attr, alone) => { const o = onNow(t), m = marks && marks(t);
    return `<button class="mpk${on ? ' on' : ''}${o.live ? ' live' : ''}${o.off ? ' off' : ''}${alone ? ' solo' : ''}" ${attr}="${esc(t.entity)}"><span class="mpki">${icon(t.icon || 'speaker')}</span>
      <span class="mtx"><b>${esc(t.entity === own ? t.name + ' (here)' : t.name)}</b><small data-st="${esc(t.entity)}"${m ? ' data-mark="1"' : ''}>${esc(m || shortNow(o))}</small></span><i class="mpkc">${icon('check-circle')}</i></button>`; };
  const strip = (e) => `<div class="mpkv vrow" data-vol="${esc(e)}"><button class="rbtn" data-vd aria-label="Volume down">${icon('volume-minus')}</button><div class="mvbar"><i></i></div><button class="rbtn" data-vu aria-label="Volume up">${icon('volume-plus')}</button><span class="mvtxt"></span></div>`;
  const html = (picked, attr, opt = {}) => { marks = opt.mark || null;
    const one = (t) => { const b = tile(t, picked.includes(t.entity), attr, solo(picked, t.entity)); return opt.volume ? `<div class="mpkw">${b}${strip(t.entity)}</div>` : b; };
    return sections().map((s) => `<div class="mpsec"><div class="label caption">${esc(s.title)}</div>
    <div class="mpgrid${s.grp ? ' grp' : ''}">${s.list.map(one).join('')}</div></div>`).join(''); };
  const volumes = (root) => root.querySelectorAll('.mpkv[data-vol]').forEach((x) => { if (x.classList.contains('drag')) return; const v = volOf(x.dataset.vol);
    x.querySelector('.mvbar i').style.width = v * 100 + '%'; x.querySelector('.mvtxt').textContent = Math.round(v * 100) + '%'; });
  const update = (root) => root.querySelectorAll('[data-st]').forEach((x) => { const t = targets.find((y) => y.entity === x.dataset.st); if (!t) return;
    const o = onNow(t), b = x.closest('.mpk'); if (!x.dataset.mark) x.textContent = shortNow(o); if (b) { toggle(b, 'live', o.live); toggle(b, 'off', !!o.off); } });
  // Picking is the same everywhere (the Music page's sheet, a player's Play on): a tap adds a room or takes it out. Rooms
  // add up only when Music Assistant can play them in sync; a room that can't join the ones picked replaces them, and so
  // does a speaker group (its rooms are Google's to know), and the other way round.
  const nameOf = (e) => (targets.find((t) => t.entity === e) || {}).name || '';
  const choose = (picked, e) => {
    if (!targets.some((t) => t.entity === e)) return picked;
    if (isGroup(e)) return picked.length === 1 && picked[0] === e ? [] : [e];
    const rooms = picked.filter((x) => !isGroup(x));
    if (rooms.includes(e)) return rooms.filter((x) => x !== e);
    return fits(rooms, e) ? [...rooms, e] : [e];
  };
  const label = (picked) => (picked.length > 1 ? picked.length + ' rooms' : picked.length ? nameOf(picked[0]) : '');
  const mark = (root, attr, picked) => root.querySelectorAll(`.mpk[${attr}]`).forEach((b) => { const e = b.getAttribute(attr); toggle(b, 'on', picked.includes(e)); toggle(b, 'solo', solo(picked, e)); });
  return { html, update, onNow, queueOn, sections, watch: watchAll, choose, label, mark, isGroup, nameOf, volumes };
}
