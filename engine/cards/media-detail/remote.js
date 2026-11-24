// The TV remote on a TV's media pop-up (cards/media-detail.js): a d-pad, keys and the app buttons, sent through the TV's
// Android TV Remote entity (the player's `remote`).
//   const R = tvRemote({ p, apps, button })   button(action, icon, label, class): the card's icon button
//   R.html          the panel's markup (.mside)
//   R.click(ev) -> true when the press was one of its buttons      R.draw(el): the app in front is lit
import { esc, toggle } from '../../core/dom.js';
import { st } from '../../core/store.js';
import { run } from '../../core/actions.js';

const KEYS = { up: 'DPAD_UP', down: 'DPAD_DOWN', left: 'DPAD_LEFT', right: 'DPAD_RIGHT', ok: 'DPAD_CENTER', back: 'BACK', home: 'HOME', mute: 'MUTE', vdown: 'VOLUME_DOWN', vup: 'VOLUME_UP' };

export function tvRemote({ p, apps, button }) {
  // What opens an app on the TV (remote.turn_on's activity): the player's own link pattern (`appLink: 'dashtv://launch/{pkg}'`
  // on a TV with our launcher), else the app's own link (`link` in the apps list), else its package: HA then asks the Play
  // Store to open it (market://launch), which Google TV stopped answering in November 2026.
  const appLink = (pkg) => (p.appLink ? p.appLink.replace('{pkg}', pkg) : (apps.find((a) => a.pkg === pkg) || {}).link || pkg);
  const html = `<div class="mside"><div class="label caption">Remote</div>
        <div class="mdpad">${button('k-up', 'chevron-up', 'Up', 'dk up')}${button('k-left', 'chevron-left', 'Left', 'dk left')}<button class="dk ok" data-a="k-ok">OK</button>${button('k-right', 'chevron-right', 'Right', 'dk right')}${button('k-down', 'chevron-down', 'Down', 'dk down')}</div>
        <div class="mkeys">${button('k-back', 'arrow-left', 'Back')}${button('k-home', 'home', 'Home')}${button('k-mute', 'volume-off', 'Mute')}${button('k-vdown', 'volume-minus', 'Volume down')}${button('k-vup', 'volume-plus', 'Volume up')}</div>
        <div class="mapps">${apps.map((a) => `<button class="chip mappb" data-app="${esc(a.pkg)}">${esc(a.name)}</button>`).join('')}</div>
      </div>`;
  function click(ev) {
    const ap = ev.target.closest('.mappb');
    if (ap) { run({ call: 'remote.turn_on', target: p.remote, data: { activity: appLink(ap.dataset.app) } }, { el: ap, ev }); return true; }
    const b = ev.target.closest('[data-a^="k-"]');
    if (b) { run({ call: 'remote.send_command', target: p.remote, data: { command: KEYS[b.dataset.a.slice(2)] } }, { el: b, ev }); return true; }
    return false;
  }
  const draw = (el) => { const act = (st(p.remote) || { attributes: {} }).attributes.current_activity; el.querySelectorAll('.mappb').forEach((b) => toggle(b, 'on', b.dataset.app === act)); };
  return { html, click, draw };
}
