#!/usr/bin/env bash
# Design lint for the dashboard engine (engine/docs/design-system.md). Run from anywhere; exit 1 on a finding.
#   - card CSS takes sizes and overlays from css/tokens.css: no literal font sizes, icon sizes or white rgba overlays
#   - every card type is used by a dashboard, pop-up or page (no dead cards)
#   - boot.js CARDS and css/cards/ list the same stylesheets, each once (a missing file would load as an empty sheet)
#   - every rule of base.css and the card files is inside a cascade layer that css/tokens.css declares
#   - every var(--name) a stylesheet reads without a fallback is defined, by a stylesheet or page or set from JS
# Works as a pre-commit hook for dashboard files.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2   # engine/
fail=0
say() { echo "lint-design: $*"; fail=1; }
css=(css/cards/*.css css/base.css)
# literal font sizes (calc(Npx * var(--s)) or Npx) in font / font-size. A deliberate exception carries /* fixed: why */ on its line.
grep -nE 'font(-size)?:[^;]*(calc\([0-9.]+px|[^-a-z(][0-9]+(\.[0-9]+)?px)' "${css[@]}" | grep -v '/\* fixed:' | while read -r l; do echo "lint-design: literal font size (use a --fs-* token): $l"; done | grep . && fail=1
# literal icon sizes on svg
grep -nE '(^|[ ,>])svg[^{]*\{[^}]*(width|height): calc\([0-9.]+px' "${css[@]}" | grep -v 'csvg\|gsvg' | sed 's/^/lint-design: literal icon size (use --icon-*): /' | grep . && fail=1
# white overlays that have a token
grep -nE 'rgba\(255, ?255, ?255, ?(0?\.0[3-9]|0?\.1[0-8]?|0\.1)\)' "${css[@]}" | sed 's/^/lint-design: white overlay with a token (--veil-faint, --veil, --hairline, --veil-2, --edge-strong): /' | grep . && fail=1
# dead card types. A public copy of the engine has only the example site, which doesn't show every card: it carries the
# names of the types the author's other sites use in _dev/tools/used-elsewhere.txt (written when the copy is made).
for f in cards/*.js; do t=$(basename "$f" .js)
  grep -rqE "type: '$t'|from '(\./|\.\./cards/)$t\.js'" pages core cards ../sites/*/dash --include=*.js --exclude="$t.js" --exclude=gallery.js || grep -qxF "$t" _dev/tools/used-elsewhere.txt 2>/dev/null || say "card type '$t' is not used anywhere (delete it or use it)"
done
# stylesheets vs boot.js, both ways
cards=$(sed -n '/var CARDS = \[/,/\];/p' boot.js | grep -oE "'[a-z0-9-]+'" | tr -d "'")
[[ -n "$cards" ]] || say "can't find the CARDS list in boot.js (var CARDS = [ ... ];)"
for f in css/cards/*.css; do t=$(basename "$f" .css); grep -qxF "$t" <<<"$cards" || say "css/cards/$t.css is not in boot.js CARDS (never loaded)"; done
for t in $cards; do [[ -f "css/cards/$t.css" ]] || say "boot.js CARDS names '$t', and css/cards/$t.css does not exist"; done
for t in $(sort <<<"$cards" | uniq -d); do say "boot.js CARDS names '$t' twice"; done
# cascade layers: every rule is in one (css/tokens.css lists them). A rule outside wins over every layer, whatever it says.
# Counts braces: at depth 0 only "@layer name {" and comments belong.
layers=$(grep -oE '^@layer [a-z, ]+;' css/tokens.css | sed 's/^@layer //; s/;$//; s/,//g')
[[ -n "$layers" ]] || say "css/tokens.css doesn't declare the cascade layers (@layer a, b, …;)"
for f in "${css[@]}"; do
  awk -v f="$f" -v layers=" $layers " '
    { line = $0; gsub(/\/\*[^*]*\*\//, "", line) }                 # comments that end on their line are not counted
    depth == 0 && c { if ($0 ~ /\*\//) c = 0; next }               # inside a comment that runs over lines
    depth == 0 && line ~ /^[ \t]*$/ { next }
    depth == 0 && line ~ /^\/\*/ { c = 1; next }
    depth == 0 && line ~ /^@layer [a-z]+ \{/ { if (index(layers, " " $2 " ") == 0) print f ":" NR ": layer \"" $2 "\" is not declared in css/tokens.css" }
    depth == 0 && line !~ /^@layer [a-z]+ \{/ { print f ":" NR ": a rule outside every cascade layer (wrap it in @layer cards { … } or the layer it belongs to)" }
    { depth += gsub(/\{/, "{", line) - gsub(/\}/, "}", line) }' "$f"
done | sed 's/^/lint-design: /' | grep . && fail=1
# custom properties: var(--x) with no fallback, where nothing defines --x, makes its whole declaration invalid.
# Defined = "--x:" in a stylesheet or page of the engine or a site, or the name written in JS (style.setProperty, inline style).
nocomment() { perl -0pe 's#/\*.*?\*/##gs' "$@"; }
defined=$( { nocomment css/*.css css/cards/*.css ./*.html | grep -oE -e '--[A-Za-z0-9_-]+[[:space:]]*:' | grep -oE -e '--[A-Za-z0-9_-]+'
  grep -rhoE --include='*.js' --include='*.css' --include='*.html' --exclude-dir=vendor --exclude-dir=_dev --exclude=icons.js \
    -e '--[A-Za-z][A-Za-z0-9_-]*' ./*.js cards core pages ../sites/*/dash; } | sort -u)
while read -r f v; do say "$f reads var($v), which nothing defines (a typo, or a token that is gone)"; done < <(
  perl -0ne 's#/\*.*?\*/##gs; while (/var\(\s*(--[\w-]+)\s*\)/g) { print "$ARGV $1\n" }' css/*.css css/cards/*.css | sort -u |
  awk 'NR == FNR { d[$1]; next } !($2 in d)' <(echo "$defined") -)
exit $fail
