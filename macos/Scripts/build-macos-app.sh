#!/usr/bin/env bash
# Build PhoneHome Mothership.app and optional signed/notarized DMG.
#
# Local (unsigned):  ./macos/Scripts/build-macos-app.sh
# Release (signed):  APPLE_TEAM_ID=… DEVELOPER_ID_APP=… ./macos/Scripts/build-macos-app.sh --dmg --sign
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MACOS="$ROOT/macos"
BUILD="$MACOS/build"
APP_NAME="PhoneHome Mothership"
SIGN=0
DMG=0

for arg in "$@"; do
  case "$arg" in
    --sign) SIGN=1 ;;
    --dmg) DMG=1 ;;
  esac
done

"$MACOS/Scripts/stage-mothership-resources.sh"

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "Install xcodegen: brew install xcodegen" >&2
  exit 1
fi

cd "$MACOS"
xcodegen generate

TEAM="${APPLE_TEAM_ID:-ABG342Z7V2}"
export DEVELOPMENT_TEAM="$TEAM"

xcodebuild \
  -project PhoneHomeMothership.xcodeproj \
  -scheme Mothership \
  -configuration Release \
  -derivedDataPath "$BUILD/DerivedData" \
  -allowProvisioningUpdates \
  MARKETING_VERSION="$(node -p "require('$ROOT/package.json').version")" \
  DEVELOPMENT_TEAM="$TEAM" \
  build

APP_SRC="$BUILD/DerivedData/Build/Products/Release/$APP_NAME.app"
APP_OUT="$BUILD/$APP_NAME.app"
rm -rf "$APP_OUT"
cp -R "$APP_SRC" "$APP_OUT"

# XcodeGen often skips large resource trees — copy explicitly.
if [[ -d "$MACOS/Mothership/Resources/mothership" ]]; then
  echo "==> embed server resources into app bundle"
  mkdir -p "$APP_OUT/Contents/Resources"
  rm -rf "$APP_OUT/Contents/Resources/mothership" "$APP_OUT/Contents/Resources/node"
  cp -R "$MACOS/Mothership/Resources/mothership" "$APP_OUT/Contents/Resources/"
  cp -R "$MACOS/Mothership/Resources/node" "$APP_OUT/Contents/Resources/"
fi

sign_app() {
  local identity="$1"
  echo "==> codesign with: $identity"
  codesign --force --options runtime --timestamp \
    --entitlements "$MACOS/Mothership/App/Mothership.entitlements" \
    --sign "$identity" \
    "$APP_OUT/Contents/Resources/node/bin/node"
  find "$APP_OUT/Contents/Resources/mothership" -type f \( -name "*.node" -o -perm -111 \) -print0 2>/dev/null \
    | xargs -0 -I{} codesign --force --options runtime --timestamp --sign "$identity" "{}" 2>/dev/null || true
  codesign --force --options runtime --timestamp \
    --entitlements "$MACOS/Mothership/App/Mothership.entitlements" \
    --sign "$identity" \
    "$APP_OUT"
  codesign --verify --deep --strict "$APP_OUT"
}

IDENTITY="${DEVELOPER_ID_APP:-$(security find-identity -v -p codesigning | awk -F'"' '/Developer ID Application/{print $2; exit}')}"
if [[ -z "$IDENTITY" ]]; then
  IDENTITY="$(security find-identity -v -p codesigning | awk -F'"' '/Apple Development/{print $2; exit}')"
  if [[ -n "$IDENTITY" ]]; then
    echo "==> no Developer ID cert — signing with Apple Development (local/testing only)"
  fi
fi

if [[ -n "$IDENTITY" ]]; then
  sign_app "$IDENTITY"
else
  echo "==> warning: app not re-signed after embedding resources"
fi

if [[ "$DMG" -eq 1 ]]; then
  DMG_PATH="$BUILD/PhoneHome-Mothership-$(node -p "require('$ROOT/package.json').version")-macos.dmg"
  rm -f "$DMG_PATH"
  hdiutil create -volname "$APP_NAME" -srcfolder "$APP_OUT" -ov -format UDZO "$DMG_PATH"
  echo "==> $DMG_PATH"
fi

echo "==> $APP_OUT"
