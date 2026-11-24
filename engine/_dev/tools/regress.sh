#!/usr/bin/env bash
# One-command regression check (regress.mjs) over the whole site: every dashboard at its own size and profile (panel
# 1280x800, phone 412x915, TV 960x540 once per TV the site lists), every view and page with the fit and layout checks,
# every pop-up and tab, console errors and warnings, ids and links, optional pixel diff against a baseline run.
# Short summary; exit 1 on an error or warning, a view that doesn't fit, a layout problem, a dead link or nonsense on screen.
#   regress.sh mock [site] -- --out /tmp/r/after [--baseline /tmp/r/before] [--skip-popups] [--only main,tv] [--entities FILE]
#   regress.sh live <site> -- --out /tmp/r/live [--baseline …]
# Typical engine change: run once before (--out …/before), change, run again with --baseline …/before; look only at what it lists.
SHOT_SCRIPT=regress.mjs exec "$(dirname "$0")/shot.sh" "$@"
