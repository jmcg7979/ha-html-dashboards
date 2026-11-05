// A player's pop-up body (Apple-Music-style "ambient" layout).
// { type: 'media-detail', player: { entity, name, power, remote, ma, apps }, targets: [{ entity, name, icon }], apps: [{ name, pkg }] }
//   left:  big art, title / artist / album, progress (tap to seek), transport, volume, power + stop
//   right: tabs — Up next (Music Assistant queue), Play on (move the music to another MA player/group), Remote (TV d-pad, keys, apps)
// The pop-up's backdrop takes its colours from the art (core/artcolor.js). Every control appears only if an active entity
// supports it (core/players.js picks Music Assistant, then Cast, then the TV remote).
import { h, esc, icon, setText, setHTML, toggle, mmss } from '../core/dom.js';
import { st, watch, tick, optimistic, tapStart } from '../core/store.js';
import { call, request } from '../core/ha.js';
import { run } from '../core/actions.js';
import { F, idsOf, now, pick, maOf, maLive, sources } from '../core/players.js';
import { artColors } from '../core/artcolor.js';
import { artUrl, powerAction } from './media.js';

const REPEAT_NEXT = { off: 'all', all: 'one', one: 'off' };
const KEYS = { up: 'DPAD_UP', down: 'DPAD_DOWN', left: 'DPAD_LEFT', right: 'DPAD_RIGHT', ok: 'DPAD_CENTER', back: 'BACK', home: 'HOME', mute: 'MUTE', vdown: 'VOLUME_DOWN', vup: 'VOLUME_UP' };
const btnI = (a, ic, label, cls = 'rbtn') => `<button class="${cls}" data-a="${a}" aria-label="${esc(label)}">${icon(ic)}</button>`;

export default function mediaDetail(cfg) {
  const p = cfg.player, targets = cfg.targets || [], apps = p.apps || cfg.apps || [];
  const ma = maOf(p), hasRemote = !!p.remote;
  const tabs = [['next', 'Up next', 'playlist-music'], ['on', 'Play on', 'speaker-multiple'], hasRemote && ['remote', 'Remote', 'remote-tv']].filter(Boolean);
  const el = h(`<div class="mdet">
    <div class="mmain">
      <div class="mart"></div>
      <div class="mcol">
        <div class="mmeta"><div class="mapp"></div><div class="mtrack"></div><div class="martist"></div><div class="malbum"></div></div>
        <div class="mprog"><div class="mbar"><i></i><b></b></div><div class="mtimes"><span class="mpos"></span><span class="mdur"></span></div></div>
        <div class="mctl">${btnI('shuffle', 'shuffle-variant', 'Shuffle')}${btnI('prev', 'skip-previous', 'Previous')}${btnI('play', 'play', 'Play or pause', 'rbtn mplay')}${btnI('next', 'skip-next', 'Next')}${btnI('repeat', 'repeat', 'Repeat')}</div>
        <div class="mvol">${btnI('mute', 'volume-high', 'Mute')}${btnI('vdown', 'volume-minus', 'Volume down')}<div class="mvbar"><i></i></div>${btnI('vup', 'volume-plus', 'Volume up')}<span class="mvtxt"></span></div>
        <div class="mfoot"><button class="chip" data-a="power">${icon('power')}<span></span></button><button class="chip" data-a="stop">${icon('stop')}<span>Stop</span></button></div>
      </div>
    </div>
    <div class="mside">
      <div class="mtabs">${tabs.map(([k, t, ic]) => `<button class="mtab" data-tab="${k}">${icon(ic)}<span>${t}</span></button>`).join('')}</div>
      <div class="mpane" data-pane="next"><div class="mq"></div></div>
      <div class="mpane" data-pane="on"><div class="mtargets">${targets.map((t) => `<button class="mtarget" data-target="${esc(t.entity)}">${icon(t.icon || 'speaker')}<span class="mtn">${esc(t.name)}</span><span class="mts"></span></button>`).join('')}</div><div class="mnote" data-note="on"></div></div>
      ${hasRemote ? `<div class="mpane" data-pane="remote">
        <div class="mdpad">${btnI('k-up', 'chevron-up', 'Up', 'dk up')}${btnI('k-left', 'chevron-left', 'Left', 'dk left')}<button class="dk ok" data-a="k-ok">OK</button>${btnI('k-right', 'chevron-right', 'Right', 'dk right')}${btnI('k-down', 'chevron-down', 'Down', 'dk down')}</div>
        <div class="mkeys">${btnI('k-back', 'arrow-left', 'Back')}${btnI('k-home', 'home', 'Home')}${btnI('k-mute', 'volume-off', 'Mute')}${btnI('k-vdown', 'volume-minus', 'Volume down')}${btnI('k-vup', 'volume-plus', 'Volume up')}</div>
        <div class="mapps">${apps.map((a) => `<button class="chip mappb" data-app="${esc(a.pkg)}">${esc(a.name)}</button>`).join('')}</div>
      </div>` : ''}
    </div>
    <div class="midle">${icon(p.power ? 'television-off' : 'music-off')}<span>Nothing playing</span>${p.power ? `<button class="chip" data-a="power">${icon('power')}<span>Turn on TV</span></button>` : ''}</div>
  </div>`);
  const $ = (s) => el.querySelector(s), btn = (a) => el.querySelector(`.mmain [data-a="${a}"]`);
  const art = $('.mart'), bar = $('.mbar'), fill = $('.mbar i'), knob = $('.mbar b'), pos = $('.mpos'), dur = $('.mdur');
  const vol = $('.mvol'), vbar = $('.mvbar'), vfill = $('.mvbar i'), vtxt = $('.mvtxt');
  let tab = null, artKey = null, popup = null, queueKey = null;

  // ---- backdrop from the art ----
  const paint = (url) => {
    popup = popup || el.closest('.popup'); if (!popup || artKey === url) return; artKey = url;
    popup.classList.add('amb');
    artColors(url).then((c) => {
      if (artKey !== url) return;
      popup.classList.toggle('amb-art', !!c);
      if (c) { popup.style.setProperty('--amb-a', c.a); popup.style.setProperty('--amb-b', c.b); popup.style.setProperty('--t', c.accent); }
      else { popup.style.removeProperty('--amb-a'); popup.style.removeProperty('--amb-b'); popup.style.setProperty('--t', 'var(--plum)'); }
    });
  };

  // position now = media_position + time since media_position_updated_at while playing
  const position = (n) => {
    const a = n.a; if (a.media_position == null) return null;
    let s = +a.media_position;
    if (n.state === 'playing' && a.media_position_updated_at) s += (Date.now() - new Date(a.media_position_updated_at)) / 1000;
    return a.media_duration ? Math.min(s, +a.media_duration) : s;
  };
  const drawProgress = () => {
    const n = now(p), d = n && +n.a.media_duration, s = n && position(n);
    const show = !!(n && d && s != null); $('.mprog').hidden = !show; if (!show) return;
    const w = (100 * s / d).toFixed(2) + '%'; fill.style.width = w; knob.style.left = w;
    setText(pos, mmss(s)); setText(dur, '−' + mmss(d - s)); toggle(bar, 'seek', !!pick(p, F.SEEK));
  };

  const showTab = (k) => {
    tab = k;
    el.querySelectorAll('.mtab').forEach((t) => toggle(t, 'on', t.dataset.tab === k));
    el.querySelectorAll('.mpane').forEach((x) => { x.hidden = x.dataset.pane !== k; });
    if (k === 'next') loadQueue(true);
  };

  // ---- Up next: Music Assistant's queue (only when MA is playing it; Spotify Connect etc. has none) ----
  const loadQueue = (force) => {
    const q = $('.mq'), id = maLive(p), n = now(p), key = id + '|' + (n ? n.title : '');
    if (!force && key === queueKey) return; queueKey = key;
    if (!id) { setHTML(q, `<div class="mnote">Up next shows Music Assistant's queue. ${n && n.app ? esc(n.app) + ' is playing here directly.' : 'Nothing from Music Assistant is playing here.'}</div>`); return; }
    request({ type: 'call_service', domain: 'music_assistant', service: 'get_queue', target: { entity_id: id }, return_response: true })
      .then((r) => {
        const d = r && r.response && r.response[id];
        if (!d) throw new Error('no queue');
        const item = (it, label) => {
          if (!it) return '';
          const m = it.media_item || {}, title = m.name || it.name || '', artist = (m.artists || []).map((a) => a.name).join(', ');
          const img = typeof m.image === 'string' ? m.image : typeof it.image === 'string' ? it.image : '';
          return `<div class="mqi"><div class="mqa">${img ? `<img alt="" src="${esc(img)}">` : icon('music')}</div><div class="mqt"><small>${label}</small><b>${esc(title)}</b><span>${esc(artist)}</span></div>${it.duration ? `<em>${mmss(it.duration)}</em>` : ''}</div>`;
        };
        const left = d.items != null && d.current_index != null ? Math.max(0, d.items - d.current_index - 1) : null;
        setHTML(q, `${item(d.next_item, 'Next')}${!d.next_item ? '<div class="mnote">Nothing queued after this track.</div>' : ''}
          ${left != null ? `<div class="mqcount">${left} more in the queue${d.shuffle_enabled ? ' · shuffled' : ''}</div>` : ''}
          <button class="chip mqopen" data-a="open-ma">${icon('playlist-music')}<span>Open Music Assistant</span></button>`);
      })
      .catch(() => setHTML(q, `<div class="mnote">No Music Assistant queue here${n && n.app ? ` — ${esc(n.app)} is playing directly` : ''}.</div><button class="chip mqopen" data-a="open-ma">${icon('playlist-music')}<span>Open Music Assistant</span></button>`));
  };

  const draw = () => {
    const n = now(p);
    el.classList.toggle('idle', !n);
    popup = popup || el.closest('.popup');
    if (!n) { if (popup) popup.classList.remove('amb-art'); artKey = null; return; }
    const url = artUrl(n.pic);
    setHTML(art, url ? `<img alt="" src="${esc(url)}">` : `${icon(p.power ? 'television-play' : 'music')}${n.app || n.title ? `<span>${esc(n.app || n.title)}</span>` : ''}`);
    paint(url);
    setText($('.mapp'), n.app); setText($('.mtrack'), n.title); setText($('.martist'), n.artist); setText($('.malbum'), n.album);
    $('.mapp').hidden = !n.app; $('.malbum').hidden = !n.album; $('.martist').hidden = !n.artist;
    drawProgress();
    const has = (bit) => !!pick(p, bit);
    btn('prev').hidden = !has(F.PREV); btn('next').hidden = !has(F.NEXT);
    btn('play').hidden = !(has(F.PAUSE) || has(F.PLAY));
    setHTML(btn('play'), icon(n.state === 'on' ? 'play-pause' : n.state === 'playing' ? 'pause' : 'play'));
    const sh = pick(p, F.SHUFFLE), rp = pick(p, F.REPEAT);
    btn('shuffle').hidden = !sh; if (sh) toggle(btn('shuffle'), 'on', !!st(sh).attributes.shuffle);
    btn('repeat').hidden = !rp;
    if (rp) { const r = st(rp).attributes.repeat || 'off'; toggle(btn('repeat'), 'on', r !== 'off'); setHTML(btn('repeat'), icon(r === 'one' ? 'repeat-once' : r === 'off' ? 'repeat-off' : 'repeat')); }
    const vs = pick(p, F.VOLUME_SET), vstep = pick(p, F.VOLUME_STEP), vm = pick(p, F.VOLUME_MUTE);
    const onlyRemote = sources(p).every((x) => x.id === p.power);
    vol.hidden = !(vs || vstep || vm) || (hasRemote && onlyRemote && !vs);   // the Remote tab has the TV's volume keys
    vbar.hidden = !vs; vtxt.hidden = !vs; btn('vdown').hidden = btn('vup').hidden = !!vs || !vstep; btn('mute').hidden = !vm;
    if (vs && !vbar.classList.contains('drag')) { const a = st(vs).attributes, v = a.volume_level || 0; vfill.style.width = v * 100 + '%'; setText(vtxt, a.is_volume_muted ? 'Muted' : Math.round(v * 100) + '%'); }
    if (vm) { const m = !!st(vm).attributes.is_volume_muted; setHTML(btn('mute'), icon(m ? 'volume-off' : 'volume-high')); toggle(btn('mute'), 'on', m); }
    setText(btn('power').querySelector('span'), p.power ? 'Turn off TV' : 'Turn off');
    const stopId = pick(p, F.STOP); btn('stop').hidden = !stopId || stopId === p.power;

    // side panel: Play on marks where it's playing; Remote highlights the open app
    const src = maLive(p), title = n.title;
    el.querySelectorAll('.mtarget').forEach((b) => {
      const e = st(b.dataset.target), here = b.dataset.target === src, live = !!e && ['playing', 'paused'].includes(e.state);
      toggle(b, 'on', here); b.disabled = !src || here;
      setText(b.querySelector('.mts'), here ? 'Here' : live ? (e.attributes.media_title === title ? 'Also playing' : 'Busy') : e ? '' : 'Offline');
    });
    setText(el.querySelector('[data-note="on"]'), src ? 'Moves the music and its queue; it stops here.' : 'Play on works when Music Assistant is playing here.');
    if (hasRemote) { const act = (st(p.remote) || { attributes: {} }).attributes.current_activity; el.querySelectorAll('.mappb').forEach((b) => toggle(b, 'on', b.dataset.app === act)); }
    if (!tab) {   // first draw: a TV only on in its own app opens on the remote; otherwise the queue
      showTab(hasRemote && onlyRemote ? 'remote' : 'next');
    } else if (tab === 'next') loadQueue(false);
  };
  watch([...idsOf(p), p.remote, ...targets.map((t) => t.entity)].filter(Boolean), draw);
  new IntersectionObserver((en) => { if (en[en.length - 1].isIntersecting) draw(); }).observe(el);   // the first draw runs before the card is in its pop-up
  tick(() => { if (el.isConnected && !el.classList.contains('idle')) drawProgress(); });

  el.addEventListener('click', (ev) => {
    const t = ev.target.closest('.mtab'); if (t) { showTab(t.dataset.tab); return; }
    const tg = ev.target.closest('.mtarget');
    if (tg) { const src = maLive(p); if (src) run({ call: 'music_assistant.transfer_queue', target: tg.dataset.target, data: { source_player: src, auto_play: true } }, { el: tg, ev }); return; }
    const ap = ev.target.closest('.mappb'); if (ap) { run({ call: 'remote.turn_on', target: p.remote, data: { activity: ap.dataset.app } }, { el: ap, ev }); return; }
    const b = ev.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a, n = now(p), go = (svc, bit, data, expect) => { const id = pick(p, bit); if (id) run({ call: 'media_player.' + svc, target: id, data, expect }, { el: b, ev, entity: id }); };
    if (a.startsWith('k-')) { run({ call: 'remote.send_command', target: p.remote, data: { command: KEYS[a.slice(2)] } }, { el: b, ev }); return; }
    if (a === 'play') go('media_play_pause', pick(p, F.PAUSE) ? F.PAUSE : F.PLAY, undefined, n && n.state === 'playing' ? 'paused' : n && n.state === 'paused' ? 'playing' : undefined);
    if (a === 'prev') go('media_previous_track', F.PREV);
    if (a === 'next') go('media_next_track', F.NEXT);
    if (a === 'stop') go('media_stop', F.STOP);
    if (a === 'shuffle') { const id = pick(p, F.SHUFFLE); if (id) { const v = !st(id).attributes.shuffle; go('shuffle_set', F.SHUFFLE, { shuffle: v }, { attr: 'shuffle', value: v }); } }
    if (a === 'repeat') { const id = pick(p, F.REPEAT); if (id) { const r = REPEAT_NEXT[st(id).attributes.repeat || 'off'] || 'off'; go('repeat_set', F.REPEAT, { repeat: r }, { attr: 'repeat', value: r }); } }
    if (a === 'mute') { const id = pick(p, F.VOLUME_MUTE); if (id) { const m = !st(id).attributes.is_volume_muted; go('volume_mute', F.VOLUME_MUTE, { is_volume_muted: m }, { attr: 'is_volume_muted', value: m }); } }
    if (a === 'vdown') go('volume_down', F.VOLUME_STEP);
    if (a === 'vup') go('volume_up', F.VOLUME_STEP);
    if (a === 'power') run(p.power && !now(p) ? { call: 'media_player.turn_on', target: p.power } : powerAction(p), { el: b, ev });
    if (a === 'open-ma') run({ close: true, view: 'music' }, { el: b, ev });
  });

  // seek: tap the progress bar
  bar.addEventListener('click', (ev) => {
    const id = pick(p, F.SEEK), n = now(p); if (!id || !n || !n.a.media_duration) return;
    const r = bar.getBoundingClientRect(), t = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * n.a.media_duration;
    call('media_player.media_seek', { seek_position: Math.round(t) }, id);
  });

  // volume: drag or tap the bar
  let d = null;
  const at = (ev) => Math.max(0, Math.min(1, (ev.clientX - d.r.left) / d.r.width));
  vbar.addEventListener('pointerdown', (ev) => { d = { r: vbar.getBoundingClientRect(), pid: ev.pointerId, v: 0 }; vbar.classList.add('drag'); try { vbar.setPointerCapture(ev.pointerId); } catch (x) { /* ignore */ } d.v = at(ev); vfill.style.width = d.v * 100 + '%'; });
  vbar.addEventListener('pointermove', (ev) => { if (!d || ev.pointerId !== d.pid) return; d.v = at(ev); vfill.style.width = d.v * 100 + '%'; setText(vtxt, Math.round(d.v * 100) + '%'); });
  const end = (ev, cancel) => {
    if (!d || ev.pointerId !== d.pid) return; const v = +d.v.toFixed(2); d = null; vbar.classList.remove('drag');
    const id = pick(p, F.VOLUME_SET); if (cancel || !id) { draw(); return; }
    optimistic(id, null, { volume_level: v }, (x) => Math.abs((x.attributes.volume_level || 0) - v) < 0.02, tapStart(ev));
    call('media_player.volume_set', { volume_level: v }, id);
  };
  vbar.addEventListener('pointerup', (ev) => end(ev, false));
  vbar.addEventListener('pointercancel', (ev) => end(ev, true));
  return el;
}
