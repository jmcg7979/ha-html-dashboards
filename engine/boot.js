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
  // Card styles, one file per component in css/cards/. ORDER IS THE CASCADE: a later file wins over an earlier one at
  // equal specificity (it is the old cards.css split at its section headers), so a new file goes where its rules belong.
  // Sizes and colours come from tokens.css.
  var CARDS = [
    'header', 'stat', 'heading', 'tile', 'room-climate', 'camera', 'buttons', 'weather', 'agenda',
    'now-playing', 'people', 'popup-parts', 'timer-list', 'vacuum', 'status-row',
    'contrast', 'tile-pills', 'map-pin', 'popup-tabs', 'confirm', 'chart', 'thermostat', 'time', 'routine', 'frame',
    'timer-alarm', 'camera-alert', 'alarm', 'glass', 'windows', 'view-tabs', 'health',
    'weather-page', 'month', 'weather-now', 'radar', 'frigate', 'camera-wall', 'drawer', 'reviews', 'media-detail',
    'people-portrait', 'forecast-source', 'systems', 'trend', 'printer', 'phone-scroll', 'narrow', 'two-column', 'adapted'
  ];
  var css = ['css/tokens.css', 'css/base.css'].concat(CARDS.map(function (n) { return 'css/cards/' + n + '.css'; }));
  // start the app once every stylesheet has loaded (no flash of unstyled cards on a cold cache); 4 s safety net
  var left = css.length, started = false;
  var start = function () { if (started) return; started = true; var s = document.createElement('script'); s.type = 'module'; s.src = q('app.js'); document.head.appendChild(s); };
  css.forEach(function (p) { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = q(p); l.onload = l.onerror = function () { if (--left === 0) start(); }; document.head.appendChild(l); });
  setTimeout(start, 4000);
  window.DASH_VERSION = j.v || '';
})();
