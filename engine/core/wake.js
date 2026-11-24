// Turn a TV on before music goes to it (the Music page's Play on, the media pop-up's Play on). Cast only wakes a TV in light
// standby; asleep, a Chromecast closes Cast and its Music Assistant player goes unavailable, so the TV is turned on through
// its remote entity (the player's `power` in home.js) and the music waits until its MA player is back (~10-15 s when the
// TV keeps a fixed address), up to a minute.
//   wake([{ entity: MA entity, name, player }]) -> Promise<[MA entities that can play]>; a TV still unavailable after a
//   minute is left out, and the toast says so. Players without `power` (speakers, groups) pass straight through.
// Music on its way: setPending(MA entity, 'Moving the music here…', what) while a play or move is under way, so the player's
// pop-up shows that step (and what's coming) instead of "Nothing playing"; it clears itself once the player plays, or after
// 90 s. pending(entity) -> { text, what } | null; onPending(fn) -> unsubscribe.
//   whenPlaying(entity, limit, stop) -> Promise<boolean>: true once the entity plays, false after `limit` ms (or as soon
//   as stop() says nobody waits any more). The one "has it started" of a play or a move.
//   answering(entities, promise): a play was sent for these rooms and `promise` settles with its answer. Music Assistant
//   answers once it has every song of what it is to play (a long SoundCloud playlist took it 46 s), so until then no
//   limit runs for these rooms: not whenPlaying's, and so not the 90 s of a card's pending text either.
//   bring(list, text, what) -> { ready: Promise<[MA entities that can play]>, clear() }: both of the above for rooms about
//   to get music: each one's card says `text` (null: nothing) until it plays, TVs that are off are turned on first, one
//   that didn't come on stops saying so; clear(): the start failed, every room stops saying so.
import { st } from './store.js';
import { call } from './ha.js';
import { toast, hideToast } from './toast.js';
import { LOOK_EVERY, PENDING_FOR, WAKE_LIMIT, WAKE_SAYS_WAITING, WAKE_STEP_SAYS, CAST_SETTLES, SAYS_LONG, SAYS_SHORT } from './music-timing.js';

const pend = new Map(), fns = new Set(), polling = new Set();   // polling: entities whose pending text has its 1 s check running
export const pending = (e) => pend.get(e) || null;
export function onPending(fn) { fns.add(fn); return () => fns.delete(fn); }
export function setPending(e, text, what) {
  const was = pend.get(e);
  if (text) pend.set(e, { text, what: what !== undefined ? what : was && was.what, t: was ? was.t : Date.now() }); else pend.delete(e);
  fns.forEach((f) => { try { f(e); } catch (x) { console.error(x); } });
  if (text && !polling.has(e)) { polling.add(e); whenPlaying(e, PENDING_FOR, () => !pend.has(e)).then(() => { polling.delete(e); if (pend.has(e)) setPending(e, null); }); }
}
const unanswered = new Map();   // entity -> the plays sent for it that have no answer yet
export function answering(entities, p) {
  const step = (n) => entities.forEach((e) => { const c = (unanswered.get(e) || 0) + n; if (c > 0) unanswered.set(e, c); else unanswered.delete(e); });
  step(1); const end = () => step(-1); p.then(end, end);
}
export function whenPlaying(e, limit, stop = () => false) {
  let t0 = Date.now();
  return new Promise((res) => {
    const k = () => {
      if (unanswered.has(e)) t0 = Date.now();   // the limit counts from the answer
      if (stop()) res(false); else if ((st(e) || {}).state === 'playing') res(true); else if (Date.now() - t0 > limit) res(false); else setTimeout(k, LOOK_EVERY);
    };
    setTimeout(k, LOOK_EVERY);
  });
}

// a step on the way (turning on, waiting, on): as a toast, unless a player on screen is already showing it (its pop-up's
// "Turning on the TV…": the same thing twice); then any older toast of ours goes, so it can't outstay the step
const shown = () => [...document.querySelectorAll('.mdet.pending')].some((x) => x.getClientRects().length);
const say = (text, ms, kind) => (shown() ? hideToast() : toast(text, ms, kind));
const ready = (e) => { const s = (st(e) || {}).state; return s != null && s !== 'unavailable'; };
export function wake(list) {
  const all = list.map((x) => x.entity);
  const tvs = list.filter((x) => x.player && x.player.power && ((st(x.player.power) || {}).state === 'off' || !ready(x.entity)));
  if (!tvs.length) return Promise.resolve(all);
  const names = (xs) => xs.map((x) => x.name).join(', ');
  const off = tvs.filter((x) => (st(x.player.power) || {}).state === 'off');
  off.forEach((x) => setPending(x.entity, 'Turning on the TV…'));
  if (off.length) say('Turning on ' + names(off) + '…', WAKE_STEP_SAYS);   // stays until the next step says what's happening
  off.forEach((x) => call('media_player.turn_on', {}, x.player.power));
  return new Promise((res) => {
    const t0 = Date.now(); let told = false;
    const k = () => {
      const waiting = tvs.filter((x) => !((st(x.player.power) || {}).state === 'on' && ready(x.entity)));
      if (!waiting.length) {   // on and ready: say so (the "Turning on…" toast would stay its 70 s when the caller has nothing to add: Resume)
        tvs.forEach((x) => setPending(x.entity, 'Starting the music…')); say(`${names(tvs)} ${tvs.length > 1 ? 'are' : 'is'} on`, SAYS_SHORT, 'ok');
        setTimeout(() => res(all), CAST_SETTLES); return;   // a moment for Cast to settle
      }
      if (Date.now() - t0 > WAKE_LIMIT) {
        toast(`${names(waiting)} ${waiting.length > 1 ? 'are' : 'is'} on, but not taking music (its Cast hasn’t come back). Try again in a minute.`, SAYS_LONG);
        waiting.forEach((x) => setPending(x.entity, null));
        res(all.filter((e) => !waiting.some((x) => x.entity === e))); return;
      }
      if (Date.now() - t0 > WAKE_SAYS_WAITING && !told) { told = true; waiting.forEach((x) => setPending(x.entity, 'Waiting for the TV to be ready…')); say('Waiting for ' + names(waiting) + ' to be ready…', WAKE_STEP_SAYS); }
      setTimeout(k, LOOK_EVERY);
    };
    k();
  });
}
export function bring(list, text, what) {
  const all = list.map((x) => x.entity), say = (es) => { if (text) es.forEach((e) => setPending(e, text, what)); };
  say(all);
  return {
    clear: () => all.forEach((e) => setPending(e, null)),
    // (wake() words the steps of a TV coming on in the same place: the room's own words are put back after it)
    ready: wake(list).then((ok) => { all.filter((e) => !ok.includes(e)).forEach((e) => setPending(e, null)); say(ok); return ok; }),
  };
}
