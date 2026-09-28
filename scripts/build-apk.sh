#!/usr/bin/env bash
# Builds the HakDaar Android app (android/) into frontend/public/downloads/HakDaar.apk,
# which the website serves at /downloads/HakDaar.apk.
#
# Needs: JDK 17+, aapt, dalvik-exchange (dx), zipalign, apksigner
#   (Ubuntu: apt-get install aapt dalvik-exchange zipalign apksigner)
# and an Android platform jar (API 33):  ANDROID_JAR=/path/to/android.jar
# Signing key: KEYSTORE (created on first run; keep it: updates must use the same key).
set -euo pipefail
cd "$(dirname "$0")/.."

ANDROID_JAR="${ANDROID_JAR:?Set ANDROID_JAR to an Android API 33 android.jar}"
KEYSTORE="${KEYSTORE:-$HOME/.hakdaar-release.keystore}"
KEYPASS="${KEYPASS:-hakdaar-local}"
OUT=frontend/public/downloads/HakDaar.apk
BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"' EXIT

mkdir -p "$BUILD/classes" "$(dirname "$OUT")"

echo "1/5 resources"
aapt package -f -M android/AndroidManifest.xml -S android/res -I "$ANDROID_JAR" -F "$BUILD/unsigned.apk"

echo "2/5 compile"
javac --release 8 -nowarn -classpath "$ANDROID_JAR" -d "$BUILD/classes" $(find android/src -name '*.java') 2>&1 \
  | grep -v "bootstrap classpath\|^warning: \[options\]\|^1 warning" || true

echo "3/5 dex"
dalvik-exchange --dex --min-sdk-version=24 --output="$BUILD/classes.dex" "$BUILD/classes"
(cd "$BUILD" && aapt add unsigned.apk classes.dex >/dev/null)

echo "4/5 align"
zipalign -f -p 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"

echo "5/5 sign"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KEYPASS" -keypass "$KEYPASS" -alias hakdaar \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=HakDaar, O=HakDaar, C=IN" 2>/dev/null
fi
apksigner sign --ks "$KEYSTORE" --ks-pass "pass:$KEYPASS" --ks-key-alias hakdaar --out "$OUT" "$BUILD/aligned.apk"
rm -f "$OUT.idsig"
apksigner verify "$OUT"
echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
