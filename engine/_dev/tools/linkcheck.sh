#!/usr/bin/env bash
# Link check for one site's assembled dashboard: every static import resolves to a file, every imported name is
# exported by it, and every name the code uses is defined. A broken link otherwise shows only in a browser, as a blank
# page or as a card that fails when its view opens.
#   linkcheck.sh <site dash folder> [engine file to leave out ...]   assembles the site (as assemble.sh does, same
#                                                                    arguments) into a temporary folder and checks it
#   linkcheck.sh --build <assembled folder>                          checks a build that already exists
# It runs the TypeScript compiler over the plain JavaScript (nothing is emitted) and keeps only the errors that mean a
# broken link; its type errors are ignored, the code is not typed. The exception is a file that starts with the line
# "// @ts-check" (a site's home.js, whose blocks name their shapes from core/shapes.js; the engine's spine: app.js, the
# router, the rail, the remote): every error in it counts, so a required key left out, a misspelled one or a value of the
# wrong kind fails here. The page's own globals and events are declared for it in _dev/types/page.d.ts.
# Exit 0 clean, 1 on a finding, 2 when it can't run.
# One-time setup: cd engine/_dev && npm ci
set -uo pipefail
dev="$(cd "$(dirname "$0")/.." && pwd)"
tsc="$dev/node_modules/typescript/bin/tsc"
[[ -f "$tsc" ]] || { echo "linkcheck: not set up: run  cd engine/_dev && npm ci" >&2; exit 2; }
[[ $# -gt 0 ]] || { sed -n 5,7p "$0" >&2; exit 2; }
if [[ "$1" == --build ]]; then
  build="${2:-}"; [[ -f "$build/app.js" ]] || { echo "linkcheck: '$build' is not an assembled build" >&2; exit 2; }
else
  site="$1"; shift
  build=$(mktemp -d); trap 'rm -rf "$build"' EXIT
  "$dev/assemble.sh" "$site" "$build" "$@" >/dev/null || exit 2
fi
cd "$build" || exit 2

# The codes that mean a broken link:
#   a file that isn't there        TS2307 TS2792 TS2306
#   a name the file doesn't export TS2305 TS2614 TS2724 TS2459 TS2460 TS1192 TS2613
#   a name nothing defines         TS2304 TS2552 TS2662 TS2663 TS18004 TS2580-TS2584 TS2591-TS2593
#   a member of "import * as m"    TS2339 / TS2551 on 'typeof import(…)'
# home.js is left out of the last one: a site may omit exports the engine reads from it.
codes='TS(2307|2792|2306|2305|2614|2724|2459|2460|1192|2613|2304|2552|2662|2663|18004|258[0-4]|259[1-3]):'
member="TS(2339|2551): .* on type 'typeof import\\(\"[^\"]*\"\\)'"
home="on type 'typeof import\\(\"(.*/)?home\"\\)'"

mapfile -d '' files < <(find . -name '*.js' -not -path './vendor/*' -print0 | sort -z)
out=$(node "$tsc" --noEmit --allowJs --checkJs --target es2022 --module esnext --moduleResolution bundler \
  --moduleDetection force --lib es2022,dom,dom.iterable --skipLibCheck --pretty false "$dev/types/page.d.ts" "${files[@]}" 2>&1)
# A line that starts with "error" is the compiler refusing to run (a bad option, a file it can't read), not a finding.
if broken=$(grep -E '^error ' <<<"$out"); then echo "linkcheck: the compiler did not run:" >&2; echo "$broken" >&2; exit 2; fi
grep -qE '\): error TS[0-9]+:' <<<"$out" || [[ -z "$out" ]] || { echo "linkcheck: unexpected compiler output:" >&2; head -5 <<<"$out" >&2; exit 2; }
out=${out//"$(pwd -P)/"/}   # the compiler names modules by their full path; the path inside the build is enough
# the typed files: every error in one of them counts
typed=(); for f in "${files[@]}"; do IFS= read -r first <"$f" || true; [[ "$first" == '// @ts-check'* ]] && typed+=("${f#./}"); done
in_typed() { (( ${#typed[@]} )) && awk -F'(' 'NR == FNR { typed[$0]; next } { f = $1; sub(/^\.\//, "", f) } f in typed && /\): error TS/' <(printf '%s\n' "${typed[@]}") - <<<"$out"; }
hits=$( { grep -E "\\): error $codes" <<<"$out"; grep -E "\\): error $member" <<<"$out" | grep -vE "$home"; in_typed; } | sort -u -t'(' -k1,1 -k2,2n -k2)
if [[ -n "$hits" ]]; then
  sed -E 's/^\.\///; s/^/linkcheck: /; s/: error TS[0-9]+:/:/' <<<"$hits"
  echo "linkcheck: $(wc -l <<<"$hits") finding(s). Paths are those of the assembled build (engine files + the site's)."
  exit 1
fi
echo "linkcheck: clean (${#files[@]} files, ${#typed[@]} of them typed)"
