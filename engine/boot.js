// Loader, requested by index.html as boot.js?v=<version> so it is never stale. HA serves /local with a 31-day cache:
// every stylesheet and module (static and dynamic imports, through an import map) is requested as file?v=<content hash>
// from version.json, so a changed file is a new URL and an unchanged one stays cached.
(function () {
  var base = location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  var j = window.DASH_MANIFEST || {}, files = j.files || {};
  var q = function (p) { return files[p] ? p + '?v=' + files[p] : p; };
  var map = { imports: {} };
  Object.keys(files).forEach(function (p) { if (/\.js$/.test(p)) map.imports[base + p] = base + q(p); });
  var im = document.createElement('script'); im.type = 'importmap'; im.textContent = JSON.stringify(map); document.head.appendChild(im);
  // Card styles, one file per component in css/cards/, each inside a cascade layer (css/tokens.css lists them): `cards`,
  // or `profile` for what one kind of screen does differently (remote). Inside a layer ORDER IS STILL THE
  // CASCADE: a later file wins over an earlier one at equal specificity, so a new file goes where its rules belong.
  // Sizes and colors come from tokens.css.
  var CARDS = [
    'header', 'stat', 'heading', 'tile', 'room-climate', 'camera', 'buttons', 'weather', 'agenda',
    'media', 'people', 'label', 'select', 'pick', 'segments', 'swatches', 'openings', 'logbook', 'strip', 'map', 'timer-list', 'vacuum',
    'popup-tabs', 'confirm', 'chart', 'thermostat', 'time', 'routine', 'frame',
    'timer-alarm', 'camera-alert', 'alarm', 'glass', 'windows', 'view-tabs', 'health',
    'weather-page', 'month', 'weather-now', 'radar', 'frigate-player', 'camera-wall', 'drawer', 'reviews', 'media-detail-backdrop', 'media-detail', 'media-detail-remote', 'media-detail-overlays',
    'people-portrait', 'forecast-source', 'systems', 'trend', 'print-job', 'ams', 'prints', 'apps', 'watchnext', 'player-parts', 'nowplaying', 'music', 'picker', 'music-sheet', 'library', 'statusbar', 'two-column', 'adapted', 'remote'
  ];
  var css = ['css/tokens.css', 'css/base.css'].concat(CARDS.map(function (n) { return 'css/cards/' + n + '.css'; }));
  // start the app once every stylesheet has loaded (no flash of unstyled cards on a cold cache); 4 s safety net
  var left = css.length, started = false;
  var start = function () { if (started) return; started = true; var s = document.createElement('script'); s.type = 'module'; s.src = q('app.js'); document.head.appendChild(s); };
  css.forEach(function (p) { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = q(p); l.onload = l.onerror = function () { if (--left === 0) start(); }; document.head.appendChild(l); });
  setTimeout(start, 4000);
  window.DASH_VERSION = j.v || '';
  // A build that doesn't start (a module that fails to load) would leave the screen blank for good: the app checks for new
  // builds itself, and it never got to run. Until the app says it is up (window.DASH_UP, app.js) the loader looks once a
  // minute and reloads when version.json has changed, so the fix reaches the screen without anyone touching it.
  var watch = setInterval(function () {
    if (window.DASH_UP) { clearInterval(watch); return; }
    fetch('version.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (n) { if (n && n.v && j.v && n.v !== j.v) location.reload(); }).catch(function () {});
  }, 60000);
})();
