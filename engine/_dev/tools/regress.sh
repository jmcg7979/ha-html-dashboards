#!/usr/bin/env bash
# One-command regression check (regress.mjs): Main views at panel size + fit check, Mobile tabs, every pop-up, console errors,
# optional pixel diff against a baseline run. Short summary; exit 1 on errors or a view that doesn't fit.
#   regress.sh mock [site] -- --out /tmp/r/after [--baseline /tmp/r/before] [--skip-popups]
#   regress.sh live <site> -- --out /tmp/r/live [--baseline …]
# Typical engine change: run once before (--out …/before), change, run again with --baseline …/before; look only at what it lists.
SHOT_SCRIPT=regress.mjs exec "$(dirname "$0")/shot.sh" "$@"
