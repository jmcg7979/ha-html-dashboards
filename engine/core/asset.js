// The address of a file of the build that isn't a module or a stylesheet: a picture, a font, a vendored script.
// Home Assistant lets a browser keep /local files for 31 days, so every file is asked for as file?v=<its content hash>
// (version.json, as boot.js does for modules and stylesheets): a replaced file is a new address, an unchanged one stays
// cached. A file version.json doesn't list (a site's own address, an older build) gets its plain address.
//   asset('vendor/hls/hls.light.min.js') -> 'https://…/local/dash/vendor/hls/hls.light.min.js?v=1a2b3c4d5e'
const ROOT = new URL('../', import.meta.url);
export function asset(path) {
  if (/^([a-z]+:|\/)/i.test(path)) return path;   // an address of its own (https:, data:, /local/…)
  const files = (window.DASH_MANIFEST || {}).files || {}, u = new URL(path, ROOT);
  if (files[path]) u.search = '?v=' + files[path];
  return u.href;
}
