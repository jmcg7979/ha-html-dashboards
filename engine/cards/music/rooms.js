// The Music page's Rooms: every player and group, what's on it. OK = its pop-up (a TV's own tile: its Now playing);
// play / pause is the player's session's; Move here brings its music, with its queue, to this screen's player.
import { esc, icon, toggle, setHTML } from '../../core/dom.js';
import { st } from '../../core/store.js';
import { run } from '../../core/actions.js';
import { toast } from '../../core/toast.js';
import { membersOf, leaderOf, quietMembers, inSyncWith } from '../../core/sync.js';
import { session } from '../../core/session.js';

export default function rooms({ body, W, targets, own, here, playerOf, nameOf, openRoom }) {
  const { onNow, queueOn, sections } = W;
  const card = (t) => `<div class="mroom${t.group ? ' group' : ''}" data-ring-box data-r="${esc(t.entity)}"><button class="mrmain" data-open="${esc(t.entity)}"><span class="mrart"></span>
    <span class="mtx"><span class="label caption">${icon(t.icon || 'speaker')}<span class="mrname">${esc(t.name)}</span>${t.entity === own ? '<span class="mhere">Here</span>' : ''}</span><b></b><small></small></span></button>
    <span class="mrbtns"><button class="rbtn" data-pp="${esc(t.entity)}" aria-label="Play or pause"></button>${!own || t.entity === own ? '' : `<button class="mact" data-move="${esc(t.entity)}" aria-label="Move here">${icon('arrow-down-bold-box-outline')}<span>Move here</span></button>`}</span></div>`;
  setHTML(body, `<div class="mroomsw">${sections().map((s) => `<div class="mpsec"><div class="label caption">${esc(s.title)}</div><div class="mrooms">${s.list.map(card).join('')}</div></div>`).join('')}</div>`);
  W.watch(() => {
    targets.forEach((t) => {
      const r = body.querySelector(`[data-r="${CSS.escape(t.entity)}"]`); if (!r) return;
      const o = onNow(t);
      toggle(r, 'live', o.live); toggle(r, 'playing', !!o.playing); toggle(r, 'stopped', !!o.stopped);
      r.querySelector('b').textContent = o.title;
      // in sync with other rooms (core/sync.js): which, after the artist
      const mates = o.live ? membersOf(t.entity).filter((e) => e !== t.entity).map(nameOf).filter(Boolean) : [];
      r.querySelector('small').textContent = [o.sub, inSyncWith(mates)].filter(Boolean).join(' · ');
      setHTML(r.querySelector('.mrart'), o.pic ? `<img alt="" src="${esc(o.pic)}">` : icon(t.icon || 'speaker'));
      const pp = r.querySelector('[data-pp]');
      setHTML(pp, icon(o.playing ? 'pause' : 'play')); pp.hidden = !(o.live || o.stopped) || !o.pp; pp.dataset.pp = o.pp || t.entity;
      pp.dataset.resume = o.stopped ? t.entity : '';   // a stopped MA queue: play resumes it
      const mv = r.querySelector('[data-move]'); if (mv) mv.hidden = !queueOn(t) || membersOf(t.entity).includes(here);   // Move here moves an MA queue, not a TV app; not one this screen already plays along with
    });
  });
  body.addEventListener('click', (ev) => {
    const o = ev.target.closest('[data-open]'), pp = ev.target.closest('[data-pp]'), mv = ev.target.closest('[data-move]');
    if (pp) {
      // a player of home.js: its session's play / pause, as in its pop-up (a stopped queue plays on, a room that follows
      // goes to its leader, a speaker group starting stops its rooms' own queues: core/session.js)
      const p = playerOf({ entity: pp.closest('[data-r]').dataset.r }), g = pp.dataset.pp;
      if (p) session(p).act('play', { el: pp, ev });
      else if (pp.dataset.resume) run({ call: 'media_player.media_play', target: g }, { el: pp, ev });
      else { if (W.isGroup(g) && (st(g) || {}).state !== 'playing') quietMembers(g); run({ call: 'media_player.media_play_pause', target: leaderOf(g) }, { el: pp, ev }); }
    } else if (mv) {   // its music comes here with its queue (a TV that's off is turned on first: core/session.js moveTo)
      const p = playerOf({ entity: mv.dataset.move });
      if (p) { if (session(p).moveTo([here], W, (e) => playerOf({ entity: e }))) toast('Moving the music here…'); }
      else { run({ call: 'music_assistant.transfer_queue', target: here, data: { source_player: leaderOf(mv.dataset.move), auto_play: true } }, { el: mv, ev }); toast('Moving the music here…'); }
    }
    else if (o) openRoom(o.dataset.open, { el: o, ev });
  });
}
