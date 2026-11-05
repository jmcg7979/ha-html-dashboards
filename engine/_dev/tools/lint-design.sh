#!/usr/bin/env bash
# Design lint for the dashboard engine (engine/docs/design-system.md). Run from anywhere; exit 1 on a finding.
#   - card CSS takes sizes and overlays from css/tokens.css: no literal font sizes, icon sizes or white rgba overlays
#   - every card type is used by a dashboard, pop-up or page (no dead cards), and every stylesheet is in boot.js CARDS
# Works as a pre-commit hook for dashboard files.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2   # engine/
fail=0
say() { echo "lint-design: $*"; fail=1; }
css=$(ls css/cards/*.css css/base.css)
# literal font sizes (calc(Npx * var(--s)) or Npx) in font / font-size. A deliberate exception carries /* fixed: why */ on its line.
grep -nE 'font(-size)?:[^;]*(calc\([0-9.]+px|[^-a-z(][0-9]+(\.[0-9]+)?px)' $css | grep -v '/\* fixed:' | while read -r l; do echo "lint-design: literal font size (use a --fs-* token): $l"; done | grep . && fail=1
# literal icon sizes on svg
grep -nE '(^|[ ,>])svg[^{]*\{[^}]*(width|height): calc\([0-9.]+px' $css | grep -v 'csvg\|gsvg' | sed 's/^/lint-design: literal icon size (use --icon-*): /' | grep . && fail=1
# white overlays that have a token
grep -nE 'rgba\(255, ?255, ?255, ?(0?\.0[3-9]|0?\.1[0-8]?|0\.1)\)' $css | sed 's/^/lint-design: white overlay with a token (--veil-faint, --veil, --hairline, --veil-2, --edge-strong): /' | grep . && fail=1
# dead card types
for f in cards/*.js; do t=$(basename "$f" .js)
  grep -rqE "type: '$t'|from '(\./|\.\./cards/)$t\.js'" pages core cards ../sites/*/dash --include=*.js --exclude="$t.js" --exclude=gallery.js || say "card type '$t' is not used anywhere (delete it or use it)"
done
# stylesheets vs boot.js
for f in css/cards/*.css; do t=$(basename "$f" .css); grep -q "'$t'" boot.js || say "css/cards/$t.css is not in boot.js CARDS (never loaded)"; done
exit $fail
