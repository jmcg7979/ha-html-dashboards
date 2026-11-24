#!/usr/bin/env bash
# Dashboard screenshots + smoke check. Setup once: cd engine/_dev/mock && npm i && npx playwright install chromium (Node 20+).
#   shot.sh mock [site] [variant] -- <shot.mjs args>     against the mock server; variant = that site's mock variant (MOCK_VARIANT)
#   shot.sh live <site> [PATH] -- <shot.mjs args>        against the real HA (PATH default /local/dash); needs HA_URL and HA_TOKEN
# Examples:
#   engine/_dev/tools/shot.sh mock example -- --view systems/network --d main --size 1280x800 --out /tmp/net.png
#   engine/_dev/tools/shot.sh live mysite -- --view systems --out /tmp/live.png
# Exit status: shot.mjs's (1 = console errors / failed requests). The mock server is started and stopped here.
# SHOT_SCRIPT=<file> runs another Playwright script the same way (a path from this folder, or an absolute one): fitcheck.mjs,
# regress.mjs, unloadcheck.mjs, smoke.mjs, a site's own checks. The script gets --base URL, DASH_SITE (the site's name),
# HA_TOKEN on a live run, and on the mock MOCK_PORT and MOCK_LOG (the mock's call log).
set -euo pipefail
DEV="$(cd "$(dirname "$0")/.." && pwd)"
L=~/.local/chromium-libs
[[ -d "$L" ]] && export LD_LIBRARY_PATH="$L/usr/lib/x86_64-linux-gnu:$L/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"   # browser libraries unpacked without sudo
NODE=(node); [[ -x ~/.local/bin/uvx ]] && NODE=(~/.local/bin/uvx --from nodejs-wheel node)   # Playwright needs Node 20+
mode="${1:-}"; shift || true
# One browser run at a time on this machine (a browser and a mock take about a gigabyte; two long runs side by side have
# crashed the browser on a 3 GB box). A second run waits for the first. SHOT_PARALLEL=1 skips the wait.
if [[ -z "${SHOT_PARALLEL:-}" && -z "${SHOT_LOCKED:-}" ]] && command -v flock >/dev/null; then
  exec 8>"${TMPDIR:-/tmp}/dash-browser-checks.lock"; flock 8; export SHOT_LOCKED=1
fi
pre=(); while [[ $# -gt 0 && "$1" != "--" ]]; do pre+=("$1"); shift; done; [[ "${1:-}" == "--" ]] && shift
script="${SHOT_SCRIPT:-shot.mjs}"; [[ "$script" == /* ]] || script="$DEV/tools/$script"
[[ -d "$DEV/mock/node_modules/playwright" ]] || { echo "not set up: cd engine/_dev/mock && npm i && npx playwright install chromium" >&2; exit 2; }

case "$mode" in
  mock)
    site=$(cat "$DEV/../../sites/.default" 2>/dev/null || echo example) variant=""
    for a in "${pre[@]}"; do if [[ -d "$DEV/../../sites/$a" ]]; then site=$a; else variant=$a; fi; done
    [[ -f "$DEV/../../sites/$site/mock/states.mjs" ]] || { echo "$site has no mock data (sites/$site/mock/states.mjs); use live $site" >&2; exit 2; }
    # its own mock on a free port (MOCK_PORT to choose one), so several checks can run at the same time
    port="${MOCK_PORT:-$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')}"
    build= log= calls= srv=; trap '[[ -n "$srv" ]] && kill "$srv" 2>/dev/null; rm -rf "$log" "$calls" "$build"' EXIT
    build=$(mktemp -d); "$DEV/assemble.sh" "$DEV/../../sites/$site/dash" "$build" >/dev/null
    log=$(mktemp); calls=$(mktemp); export MOCK_LOG="$calls"   # the mock's call log, read by checks that assert on what was sent
    (cd "$DEV/mock" && MOCK_PORT="$port" MOCK_DASH="$build" MOCK_SITE="$site" MOCK_VARIANT="$variant" exec node server.mjs >"$log" 2>&1 </dev/null) & srv=$!
    up=0; for _ in $(seq 50); do curl -s -o /dev/null "http://localhost:$port/local/dash/index.html" && { up=1; break; }; sleep 0.2; done
    [[ $up -eq 1 ]] || { echo "the mock did not start on port $port:" >&2; tail -5 "$log" >&2; exit 2; }
    rc=0; MOCK_PORT="$port" DASH_SITE="$site" "${NODE[@]}" "$script" --base "http://localhost:$port/local/dash" "$@" || rc=$?
    grep -q "Error" "$log" && { echo "mock server log:"; grep -v '^\s*at ' "$log" | tail -5; }
    exit $rc ;;
  live)
    site="${pre[0]:-}"; path="${pre[1]:-/local/dash}"
    env=~/.config/ha-dash/$site-ha.env
    if [[ -r $env ]]; then HA_TOKEN=$(. "$env"; echo "$HOMEASSISTANT_TOKEN") HA_URL=$(. "$env"; echo "${HOMEASSISTANT_URL%/}"); fi
    [[ -n "${HA_URL:-}" && -n "${HA_TOKEN:-}" ]] || { echo "set HA_URL and HA_TOKEN" >&2; exit 2; }
    HA_URL="${HA_URL%/}"; HA_TOKEN="$HA_TOKEN" DASH_SITE="$site" "${NODE[@]}" "$script" --base "$HA_URL$path" "$@" ;;
  *) sed -n 2,11p "$0"; exit 2 ;;
esac
