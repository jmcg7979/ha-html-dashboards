#!/usr/bin/env bash
# Builds one site's deployable dashboard: the engine, the site's files on top, version.json. Deploy and the mock both use it.
#   assemble.sh <site dash folder> <output folder> [engine file to leave out ...]
# engine/ha/ (HA custom integrations) is deployed with ha-config, not here. A site folder needs home.js and dashboards/main.js; popups.js, assets/ and more dashboards are optional. Same path = the site's file wins.
set -euo pipefail
engine="$(cd "$(dirname "$0")/.." && pwd)"
site="${1:?site dash folder}"; out="${2:?output folder}"; shift 2
[[ -f "$site/home.js" && -f "$site/dashboards/main.js" ]] || { echo "assemble: $site needs home.js and dashboards/main.js" >&2; exit 2; }
# The output folder is emptied of everything the build doesn't have (rsync --delete): only a new / empty folder or an
# earlier build (it carries .dash-build) is accepted, so a wrong path can't wipe a folder.
if [[ -d "$out" && ! -f "$out/.dash-build" && -n "$(ls -A "$out")" ]]; then echo "assemble: $out is not empty and not an earlier build; refusing to overwrite it" >&2; exit 2; fi
mkdir -p "$out"; : >"$out/.dash-build"
ex=(--exclude=/.dash-build --exclude=/_dev/ --exclude=/docs/ --exclude=/ha/ --exclude=/version.json); for f in "$@"; do ex+=("--exclude=/$f"); done
rsync -a --delete "${ex[@]}" "$engine/" "$out/"
rsync -a --exclude=/_dev/ "$site/" "$out/"
# still copies of the animated weather icons, for screens where anything that never stops moving costs too much (TVs: core/forecast.js)
mkdir -p "$out/assets/weather/still"
for f in "$out"/assets/weather/*.svg; do sed -E 's#<animate[A-Za-z]*[^>]*/>##g; s#<metadata>.*</metadata>##' "$f" >"$out/assets/weather/still/$(basename "$f")"; done
node "$engine/_dev/version.mjs" "$out"
