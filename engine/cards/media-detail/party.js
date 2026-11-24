// The party's code on the player card (cards/media-detail.js, its `party` option), at the right end of the bottom
// bar: shown while this music is Music Assistant's Party. Where the party plays and its link are MA's (core/ma.js
// party(), asked again every half minute, so a party moved or ended elsewhere shows).
// `follows`: the party comes to the music. A card that shows music playing on rooms the party isn't on moves MA's Party
// there (its player becomes this music's leader), unless the party's own room is playing: then that music is the
// party's and this one has no code (a guest's song would land in the other queue). So with one music in the house
// every card of it has the code, and nobody sets where the party plays.
// OK or a tap on it shows the code
// large in the panel's place (where Up next and Lyrics are), with what guests may do (a small screen, a far seat); OK or a
// tap again, or Back, brings the panel back.
//   const P = partyCode({ el, party, wide, shown, hide })   party: the card's option (true | { when: entity, follows });
//                                                           shown() -> the layer open over the card ('join': the large code)
//   P.draw(view)   view: the session's snapshot as the card draws it      P.when: the entity that switches it, or ''
import { esc, setText, setHTML } from '../../core/dom.js';
import { st } from '../../core/store.js';
import * as MA from '../../core/ma.js';
import { qr } from '../../core/qr.js';
import { PARTY_ASK } from '../../core/music-timing.js';

const playing = (e) => (st(e) || {}).state === 'playing';

export function partyCode({ el, party: wanted, wide, shown, hide }) {
  const $ = (s) => el.querySelector(s), join = $('.mjoin'), when = (wanted && wanted.when) || '';
  const on = () => !!wanted && wide && (!when || (st(when) || {}).state === 'on');
  let party = { url: '', entity: '', config: {} }, joinFor = '', view = null;   // party: MA's, as last asked
  let asked = '', askedAt = 0;   // the room the party was last asked to come to, and when (a refusal isn't asked again at every draw)
  function paint() {
    const here = on() && !!view.n && !!party.url && !!party.entity && [view.live, ...view.rooms].includes(party.entity);
    if (here && joinFor !== party.url) { const u = (joinFor = party.url); setHTML($('.mjqr'), '');
      qr(u).then((svg) => { if (joinFor === u) { setHTML($('.mjqr'), svg); setHTML($('.mjbig'), svg); paint(); } }, () => { if (joinFor === u) joinFor = ''; }); }
    join.hidden = !here || !$('.mjqr').firstChild;   // nothing until the code is drawn
    if (join.hidden && shown() === 'join') hide();
    if (shown() === 'join') { const c = party.config || {}, k = JSON.stringify(c), cap = $('.mjcap');
      if (cap.dataset.k !== k) { cap.dataset.k = k; setText(cap.querySelector('small'), c.mode === 'remote' ? 'Silent disco: you listen on your own phone' : 'Point your phone’s camera at the code, on the house or guest Wi-Fi');
        setHTML(cap.querySelector('.mjrules'), MA.partyRules(c).map((r) => `<li>${esc(r)}</li>`).join('')); } }
  }
  function follow() {
    const to = view.rooms[0];   // this music's leader: its queue is the one guests add to
    if (!wanted.follows || !on() || !party.url || !view.n || !view.queueId || !to || !playing(to)) return;
    if ([view.live, ...view.rooms].includes(party.entity) || (party.entity && playing(party.entity))) return;
    if (asked === to && Date.now() - askedAt < PARTY_ASK) return;
    asked = to; askedAt = Date.now();
    MA.partyPlayer(to).then(ask, () => {});   // (refused: no admin token on the relay; the code stays away)
  }
  const ask = () => { if (on() && view && view.live && !document.hidden && el.isConnected) MA.party().then((x) => { party = x; paint(); follow(); }); };
  if (wanted && wide) setInterval(ask, PARTY_ASK);   // dropped with the view (core/scope.js)
  return { when, draw(v) { view = v; paint(); ask(); } };
}
