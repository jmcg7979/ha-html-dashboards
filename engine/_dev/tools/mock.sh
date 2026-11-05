#!/usr/bin/env bash
# Runs the fake Home Assistant on http://localhost:8125/local/dash/index.html?d=main until Ctrl-C.
#   mock.sh [site]     (MOCK_* variables pass through)
set -euo pipefail
DEV="$(cd "$(dirname "$0")/.." && pwd)"
site="${1:-$(cat "$DEV/../../sites/.default" 2>/dev/null || echo example)}"; build=$(mktemp -d); trap 'rm -rf "$build"' EXIT
"$DEV/assemble.sh" "$DEV/../../sites/$site/dash" "$build"
cd "$DEV/mock" && MOCK_DASH="$build" MOCK_SITE="$site" node server.mjs
