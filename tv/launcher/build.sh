#!/usr/bin/env bash
# Builds the TV launcher APK without Gradle: aapt2 -> javac -> d8 -> zipalign -> apksigner. No dependencies.
#   tv/launcher/build.sh [out.apk]        default: ~/.cache/dash-tv/dash-tv.apk
#   tv/launcher/build.sh --new-key [out.apk]   the same, and makes the signing key if there is none yet (a first build)
#   tv/launcher/build.sh version          prints "<version name> <version code>" of what a build would be now; builds nothing.
#                                         A TV's own: adb shell dumpsys package dash.tv | grep -E 'versionName|versionCode'
#   tv/launcher/build.sh check            compiles only, nothing is packaged or signed: every javac lint warning, and
#                                         a compile against the Android library alone, so a class or method that only
#                                         the JDK has is an error here instead of a crash on the TV. Exit 1 on an
#                                         error or a warning other than a deprecation, 2 when the JDK or SDK is missing.
# Needs (README.md, Build): JDK 17 (JAVA_HOME, default ~/.local/opt/jdk17), Android SDK (ANDROID_HOME, default
# ~/.local/opt/android-sdk) with platforms;android-34 and build-tools;34.0.0. Signing key: tv-launcher.jks (+ tv-launcher.pass)
# in TV_KEY_DIR (default ~/.config/dash-tv).
# Without the key the build stops, unless --new-key asks for one: an APK signed with another key can't update the
# installed app, so a key is never made by accident (a wrong TV_KEY_DIR). Keep the key and back it up.
set -euo pipefail
here="$(cd "${APP_DIR:-$(dirname "$0")}" && pwd)"   # APP_DIR: another app laid out like this one (AndroidManifest.xml, res/, src/, assets/ if any)
mode=build newkey=0
case "${1:-}" in check|version) mode=$1; shift ;; --new-key) newkey=1; shift ;; esac
out="${1:-$HOME/.cache/dash-tv/dash-tv.apk}"
JAVA_HOME="${JAVA_HOME:-$HOME/.local/opt/jdk17}"
SDK="${ANDROID_HOME:-$HOME/.local/opt/android-sdk}"
BT="$SDK/build-tools/34.0.0" JAR="$SDK/platforms/android-34/android.jar"
# APP_LIBS: a folder of .jar libraries the app is compiled against and that are packed into it (none for the launcher)
libs=(); [[ -n "${APP_LIBS:-}" ]] && mapfile -d '' libs < <(find "$APP_LIBS" -name '*.jar' -print0 | sort -z)
libcp=""; for l in "${libs[@]}"; do libcp+=":$l"; done
KD="${TV_KEY_DIR:-$HOME/.config/dash-tv}"; KEY="$KD/tv-launcher.jks" PASS="$KD/tv-launcher.pass"
export PATH="$JAVA_HOME/bin:$PATH"   # d8 and apksigner run java

# version: commits touching the launcher (code), date + short hash (name)
code=$(git -C "$here" rev-list --count HEAD -- . 2>/dev/null || echo 1); (( code > 0 )) || code=1
name="$(date +%Y.%m.%d)-$(git -C "$here" rev-parse --short HEAD 2>/dev/null || echo dev)"
# Anything in this folder that differs from the last commit (changed, staged or new files) marks the build dirty, so
# an APK never carries a commit's clean name without being that commit's code. Outside a git checkout: dirty too.
changed=$(git -C "$here" status --porcelain -- . 2>/dev/null) && [[ -z "$changed" ]] || { name="$name+dirty"; code=$((code + 1)); }
[[ $mode == version ]] && { echo "$name $code"; exit 0; }

need=("$JAVA_HOME/bin/javac" "$BT/aapt2" "$JAR"); miss=1
[[ $mode == check ]] && { need+=("$BT/core-lambda-stubs.jar"); miss=2; }
for f in "${need[@]}"; do [[ -e "$f" ]] || { echo "missing $f (README.md, Build)" >&2; exit "$miss"; }; done

w=$(mktemp -d); trap 'rm -rf "$w"' EXIT
mkdir -p "$w/gen" "$w/cls" "$w/dex"
# resources -> res.zip; link them with the manifest into base.apk and write R.java, which the sources need to compile
link() {
  "$BT/aapt2" compile --dir "$here/res" -o "$w/res.zip"
  local assets=(); [[ -d "$here/assets" ]] && assets=(-A "$here/assets")
  "$BT/aapt2" link -o "$w/base.apk" -I "$JAR" --manifest "$here/AndroidManifest.xml" "${assets[@]}" \
    --min-sdk-version 28 --target-sdk-version 34 "$@" --java "$w/gen" "$w/res.zip"
  mapfile -d '' src < <(find "$here/src" "$w/gen" -name '*.java' -print0)
}

if [[ $mode == check ]]; then
  link
  # -bootclasspath replaces the JDK's own library with Android's (plus the stubs lambdas compile against), which
  # needs -source 8; the real build's --release 11 would put the JDK's library first.
  rc=0; log=$("$JAVA_HOME/bin/javac" -encoding UTF-8 -source 8 -target 8 -bootclasspath "$JAR:$BT/core-lambda-stubs.jar" \
    ${libcp:+-classpath "${libcp#:}"} -Xlint:all -d "$w/cls" "${src[@]}" 2>&1) || rc=$?
  dep=$(grep -c 'warning: \[deprecation\]' <<<"$log" || true)
  other=$(grep 'warning: ' <<<"$log" | grep -vc 'warning: \[deprecation\]' || true)
  if (( rc != 0 || other > 0 )); then
    # the log without the deprecation warnings (each is a headline plus the source lines under it)
    awk '/: warning: \[deprecation\]/ { skip = 1; next } /\.java:[0-9]+: |^[0-9]+ (error|warning)s?$/ { skip = 0 } !skip' <<<"$log" | sed "s#$here/##" >&2
    echo "launcher check: failed (compile errors or lint warnings above)" >&2; exit 1
  fi
  echo "launcher check: clean ($(find "$w/cls" -name '*.class' | wc -l) classes, $dep deprecation warnings: javac -Xlint:deprecation lists them)"
  exit 0
fi

if [[ ! -f "$KEY" || ! -f "$PASS" ]]; then
  (( newkey )) || { echo "no signing key in $KD (tv-launcher.jks + tv-launcher.pass). The TVs' key is elsewhere: set TV_KEY_DIR to its folder." >&2
    echo "A first build with no key anywhere: $0 --new-key (an APK signed with a new key can't update an installed app)." >&2; exit 1; }
  [[ ! -e "$KEY" && ! -e "$PASS" ]] || { echo "$KD holds only one of tv-launcher.jks / tv-launcher.pass: not making a new key over it" >&2; exit 1; }
  ( umask 077; mkdir -p "$KD"
    head -c 24 /dev/urandom | base64 | tr -d '/+=' > "$PASS"
    "$JAVA_HOME/bin/keytool" -genkeypair -keystore "$KEY" -storepass:file "$PASS" -alias tv -keyalg RSA -keysize 3072 \
      -validity 36500 -dname "CN=dash-tv" >/dev/null 2>&1 )
  echo "made signing key $KEY (keep it and back it up: another key can't update the installed app)"
fi

mkdir -p "$(dirname "$out")"
link --version-code "$code" --version-name "$name"
"$JAVA_HOME/bin/javac" -encoding UTF-8 -Xlint:-options --release 11 -classpath "$JAR$libcp" -d "$w/cls" "${src[@]}"
mapfile -d '' cls < <(find "$w/cls" -name '*.class' -print0)
"$BT/d8" --release --min-api 28 --lib "$JAR" --output "$w/dex" "${cls[@]}" "${libs[@]}"
cp "$w/base.apk" "$w/unsigned.apk"
python3 -c 'import sys,zipfile; zipfile.ZipFile(sys.argv[1], "a", zipfile.ZIP_DEFLATED).write(sys.argv[2], "classes.dex")' "$w/unsigned.apk" "$w/dex/classes.dex"
"$BT/zipalign" -f -p 4 "$w/unsigned.apk" "$w/aligned.apk"

"$BT/apksigner" sign --ks "$KEY" --ks-pass "file:$PASS" --ks-key-alias tv --out "$out" "$w/aligned.apk"
echo "$out  ($name, code $code)"
