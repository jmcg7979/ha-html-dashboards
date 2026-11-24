#!/usr/bin/env bash
# Tests of the launcher's plain-Java parts on this machine's JVM: no Android, no TV, no library.
#   tv/launcher/test.sh
# Compiles the classes that use nothing of Android (Origin, Links, Watched, Burst, Lines, Presses) with test/dash/tv/Tests.java and
# runs it. A class that starts to import android.* stops compiling here: keep these plain.
# Needs the JDK only (JAVA_HOME, default ~/.local/opt/jdk17). Exit 1 on a failed check, 2 when the JDK is missing.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
JAVA_HOME="${JAVA_HOME:-$HOME/.local/opt/jdk17}"
[[ -x "$JAVA_HOME/bin/javac" ]] || { echo "missing $JAVA_HOME/bin/javac (README.md, Build)" >&2; exit 2; }
w=$(mktemp -d); trap 'rm -rf "$w"' EXIT
plain=(Origin Links Watched Burst Lines Presses)
src=("$here/test/dash/tv/Tests.java"); for c in "${plain[@]}"; do src+=("$here/src/dash/tv/$c.java"); done
"$JAVA_HOME/bin/javac" -encoding UTF-8 -Xlint:all -Werror -d "$w" "${src[@]}"
"$JAVA_HOME/bin/java" -ea -cp "$w" dash.tv.Tests
