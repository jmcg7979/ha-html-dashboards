#!/usr/bin/env bash
# Builds one site's deployable dashboard: the engine, the site's files on top, version.json. Deploy and the mock both use it.
#   assemble.sh <site dash folder> <output folder> [engine file to leave out ...]
# A site folder needs home.js and dashboards/main.js; popups.js, assets/ and more dashboards are optional. Same path = the site's file wins.
set -euo pipefail
engine="$(cd "$(dirname "$0")/.." && pwd)"
site="${1:?site dash folder}"; out="${2:?output folder}"; shift 2
[[ -f "$site/home.js" && -f "$site/dashboards/main.js" ]] || { echo "assemble: $site needs home.js and dashboards/main.js" >&2; exit 2; }
ex=(--exclude=/_dev/ --exclude=/docs/ --exclude=/version.json); for f in "$@"; do ex+=("--exclude=/$f"); done
rsync -a --delete "${ex[@]}" "$engine/" "$out/"
rsync -a --exclude=/_dev/ "$site/" "$out/"
node "$engine/_dev/version.mjs" "$out"
