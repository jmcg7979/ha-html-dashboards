#!/usr/bin/env bash
# Dashboard screenshots + smoke check. Setup once: cd engine/_dev/mock && npm i && npx playwright install chromium (Node 20+).
#   shot.sh mock [site] [variant] -- <shot.mjs args>     against the mock server; variant = that site's mock variant (MOCK_VARIANT)
#   shot.sh live <site> [PATH] -- <shot.mjs args>        against the real HA (PATH default /local/dash); needs HA_URL and HA_TOKEN
# Examples:
#   engine/_dev/tools/shot.sh mock example -- --view systems/network --d main --size 1280x800 --out /tmp/net.png
#   engine/_dev/tools/shot.sh live mysite -- --view systems --out /tmp/live.png
# Exit status: shot.mjs's (1 = console errors / failed requests). The mock server is started and stopped here.
set -euo pipefail
DEV="$(cd "$(dirname "$0")/.." && pwd)"
L=~/.local/chromium-libs
[[ -d "$L" ]] && export LD_LIBRARY_PATH="$L/usr/lib/x86_64-linux-gnu:$L/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"   # browser libraries unpacked without sudo
NODE=(node); [[ -x ~/.local/bin/uvx ]] && NODE=(~/.local/bin/uvx --from nodejs-wheel node)   # Playwright needs Node 20+
mode="${1:-}"; shift || true
pre=(); while [[ $# -gt 0 && "$1" != "--" ]]; do pre+=("$1"); shift; done; [[ "${1:-}" == "--" ]] && shift
[[ -d "$DEV/mock/node_modules/playwright" ]] || { echo "not set up: cd engine/_dev/mock && npm i && npx playwright install chromium" >&2; exit 2; }

case "$mode" in
  mock)
    site=$(cat "$DEV/../../sites/.default" 2>/dev/null || echo example) variant=""
    for a in "${pre[@]}"; do if [[ -d "$DEV/../../sites/$a" ]]; then site=$a; else variant=$a; fi; done
    [[ -f "$DEV/../../sites/$site/mock/states.mjs" ]] || { echo "$site has no mock data (sites/$site/mock/states.mjs); use live $site" >&2; exit 2; }
    if curl -s -o /dev/null --max-time 1 http://localhost:8125/; then echo "port 8125 is busy: another mock is running, and this run would test that one" >&2; exit 2; fi
    build=$(mktemp -d); "$DEV/assemble.sh" "$DEV/../../sites/$site/dash" "$build" >/dev/null
    log=$(mktemp); (cd "$DEV/mock" && MOCK_DASH="$build" MOCK_SITE="$site" MOCK_VARIANT="$variant" exec node server.mjs >"$log" 2>&1 </dev/null) & srv=$!
    trap 'kill $srv 2>/dev/null || true; rm -rf "$log" "$build"' EXIT
    for _ in $(seq 50); do curl -s -o /dev/null http://localhost:8125/local/dash/index.html && break; sleep 0.2; done
    rc=0; "${NODE[@]}" "$DEV/tools/${SHOT_SCRIPT:-shot.mjs}" --base http://localhost:8125/local/dash "$@" || rc=$?
    grep -q "Error" "$log" && { echo "mock server log:"; grep -v '^\s*at ' "$log" | tail -5; }
    exit $rc ;;
  live)
    site="${pre[0]:-}"; path="${pre[1]:-/local/dash}"
    env=~/.config/ha-dash/$site-ha.env
    if [[ -r $env ]]; then HA_TOKEN=$(. "$env"; echo "$HOMEASSISTANT_TOKEN") HA_URL=$(. "$env"; echo "${HOMEASSISTANT_URL%/}"); fi
    [[ -n "${HA_URL:-}" && -n "${HA_TOKEN:-}" ]] || { echo "set HA_URL and HA_TOKEN" >&2; exit 2; }
    HA_URL="${HA_URL%/}"; HA_TOKEN="$HA_TOKEN" "${NODE[@]}" "$DEV/tools/${SHOT_SCRIPT:-shot.mjs}" --base "$HA_URL$path" "$@" ;;
  *) sed -n 2,8p "$0"; exit 2 ;;
esac
