#!/usr/bin/env bash
# Builds the TV launcher APK without Gradle: aapt2 -> javac -> d8 -> zipalign -> apksigner. No dependencies.
#   tv/launcher/build.sh [out.apk]        default: ~/.cache/dash-tv/dash-tv.apk
# Needs (README.md, Build): JDK 17 (JAVA_HOME, default ~/.local/opt/jdk17), Android SDK (ANDROID_HOME, default
# ~/.local/opt/android-sdk) with platforms;android-34 and build-tools;34.0.0. Signing key: tv-launcher.jks (+ tv-launcher.pass)
# in TV_KEY_DIR (default ~/.config/dash-tv).
# The key is made on first build. Keep it: an APK signed with another key can't update the installed app.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:-$HOME/.cache/dash-tv/dash-tv.apk}"
JAVA_HOME="${JAVA_HOME:-$HOME/.local/opt/jdk17}"
SDK="${ANDROID_HOME:-$HOME/.local/opt/android-sdk}"
BT="$SDK/build-tools/34.0.0" JAR="$SDK/platforms/android-34/android.jar"
KD="${TV_KEY_DIR:-$HOME/.config/dash-tv}"; KEY="$KD/tv-launcher.jks" PASS="$KD/tv-launcher.pass"
export PATH="$JAVA_HOME/bin:$PATH"   # d8 and apksigner run java
for f in "$JAVA_HOME/bin/javac" "$BT/aapt2" "$JAR"; do [[ -e "$f" ]] || { echo "missing $f (README.md, Build)" >&2; exit 1; }; done

# version: commits touching the launcher (code), date + short hash (name)
code=$(git -C "$here" rev-list --count HEAD -- . 2>/dev/null || echo 1); (( code > 0 )) || code=1
name="$(date +%Y.%m.%d)-$(git -C "$here" rev-parse --short HEAD 2>/dev/null || echo dev)"
git -C "$here" diff --quiet -- . 2>/dev/null || { name="$name+dirty"; code=$((code + 1)); }

w=$(mktemp -d); trap 'rm -rf "$w"' EXIT
mkdir -p "$w/res" "$w/gen" "$w/cls" "$w/dex" "$(dirname "$out")"
"$BT/aapt2" compile --dir "$here/res" -o "$w/res.zip"
"$BT/aapt2" link -o "$w/base.apk" -I "$JAR" --manifest "$here/AndroidManifest.xml" -A "$here/assets" \
  --min-sdk-version 28 --target-sdk-version 34 --version-code "$code" --version-name "$name" \
  --java "$w/gen" "$w/res.zip"
"$JAVA_HOME/bin/javac" -Xlint:-options --release 11 -classpath "$JAR" -d "$w/cls" \
  $(find "$here/src" "$w/gen" -name '*.java')
"$BT/d8" --release --min-api 28 --lib "$JAR" --output "$w/dex" $(find "$w/cls" -name '*.class')
cp "$w/base.apk" "$w/unsigned.apk"
python3 -c 'import sys,zipfile; zipfile.ZipFile(sys.argv[1], "a", zipfile.ZIP_DEFLATED).write(sys.argv[2], "classes.dex")' "$w/unsigned.apk" "$w/dex/classes.dex"
"$BT/zipalign" -f -p 4 "$w/unsigned.apk" "$w/aligned.apk"

if [[ ! -f "$KEY" ]]; then
  umask 077; mkdir -p "$(dirname "$KEY")"
  head -c 24 /dev/urandom | base64 | tr -d '/+=' > "$PASS"
  "$JAVA_HOME/bin/keytool" -genkeypair -keystore "$KEY" -storepass:file "$PASS" -alias tv -keyalg RSA -keysize 3072 \
    -validity 36500 -dname "CN=dash-tv" >/dev/null 2>&1
  echo "made signing key $KEY (keep it and back it up: another key can't update the installed app)"
fi
"$BT/apksigner" sign --ks "$KEY" --ks-pass "file:$PASS" --ks-key-alias tv --out "$out" "$w/aligned.apk"
echo "$out  ($name, code $code)"
