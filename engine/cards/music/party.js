// The Music page's Party: Music Assistant's Party plugin. Guests scan the code, add songs and boost them, with MA's limits.
import { esc, toggle, setHTML } from '../../core/dom.js';
import { toast } from '../../core/toast.js';
import * as MA from '../../core/ma.js';
import { qr } from '../../core/qr.js';
import { empty, NO_MA } from './rows.js';

export default function party({ body, W, nameOf }) {
  setHTML(body, `<div class="mparty"><div class="mqr">${empty('…')}</div><div class="mptx"><div class="label caption">Party</div><h2>Scan to add songs</h2>
    <p class="mpwhere"></p><div class="mpplay" hidden><div class="label caption">Plays on</div><div class="mpwho mpick"></div></div>
    <ul class="mprules"></ul><p class="mpnote">Guests join on the house or guest Wi-Fi. The code lasts as long as the party (Music Assistant’s Party settings).</p></div></div>`);
  const picker = body.querySelector('.mpwho');
  const pick = (cur) => setHTML(picker, W.html([cur], 'data-party'));
  picker.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-party]'); if (!b || b.classList.contains('on')) return;
    const was = picker.querySelector('.mpk.on');
    picker.querySelectorAll('.mpk').forEach((x) => toggle(x, 'on', x === b));
    MA.partyPlayer(b.dataset.party).then(() => toast('The party plays on ' + nameOf(b.dataset.party)),
      () => { picker.querySelectorAll('.mpk').forEach((x) => toggle(x, 'on', x === was)); toast('Music Assistant didn’t change the party player'); });
  });
  MA.available().then((ok) => {
    if (!ok) { setHTML(body.querySelector('.mqr'), empty(NO_MA)); return; }
    Promise.all([MA.cmd('party/url'), MA.cmd('party/config').catch(() => ({})), MA.partyPlayer().catch(() => ({}))]).then(([url, c, pp]) => {
      if (!url) { setHTML(body.querySelector('.mqr'), empty('Guest access is off in Music Assistant’s Party settings')); return; }
      qr(String(url)).then((svg) => setHTML(body.querySelector('.mqr'), svg), () => setHTML(body.querySelector('.mqr'), `<p class="mempty">${esc(url)}</p>`));
      if (c.mode === 'remote') body.querySelector('.mpwhere').textContent = 'Silent disco: guests listen on their own phones';
      else { body.querySelector('.mpwhere').hidden = true; body.querySelector('.mpplay').hidden = false; pick((pp || {}).entity_id); }
      const rules = MA.partyRules(c);
      setHTML(body.querySelector('.mprules'), rules.map((r) => `<li>${esc(r)}</li>`).join(''));
    }, () => setHTML(body.querySelector('.mqr'), empty('Music Assistant didn’t answer')));
  });
}
