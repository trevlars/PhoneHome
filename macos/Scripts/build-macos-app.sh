#!/usr/bin/env bash
# Build PhoneHome Mothership.app and optionally a drag-to-install DMG.
#
# Local:        ./macos/Scripts/build-macos-app.sh [--dmg]
# Release (CI): DEVELOPER_ID_APP="Developer ID Application: …" ./macos/Scripts/build-macos-app.sh --dmg
#
# Xcode builds the bundle UNSIGNED (so CI needs no Apple account / automatic signing), the
# server tree + Node are embedded, then the finished bundle is signed with the best identity:
#   Developer ID Application (release)  >  Apple Development (local testing)  >  ad-hoc "-"
# Ad-hoc signing is the floor: Apple silicon refuses to launch unsigned binaries at all.
# Users of ad-hoc builds still get Gatekeeper's one-time right-click → Open prompt.
#
# Version: MOTHERSHIP_VERSION > git tag vX.Y.Z (GitHub Actions) > package.json.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MACOS="$ROOT/macos"
BUILD="$MACOS/build"
APP_NAME="PhoneHome Mothership"
DMG=0

for arg in "$@"; do
  case "$arg" in
    --dmg) DMG=1 ;;
    --sign) ;; # signing is automatic now; accepted for backwards compatibility
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

VERSION="${MOTHERSHIP_VERSION:-}"
if [[ -z "$VERSION" && "${GITHUB_REF_TYPE:-}" == "tag" && "${GITHUB_REF_NAME:-}" == v* ]]; then
  VERSION="${GITHUB_REF_NAME#v}"
fi
if [[ -z "$VERSION" ]]; then
  VERSION="$(node -p "require('$ROOT/package.json').version")"
fi

"$MACOS/Scripts/stage-mothership-resources.sh"

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "Install xcodegen: brew install xcodegen" >&2
  exit 1
fi

cd "$MACOS"
xcodegen generate

echo "==> xcodebuild $APP_NAME $VERSION (unsigned; signed after resources are embedded)"
xcodebuild \
  -project PhoneHomeMothership.xcodeproj \
  -scheme Mothership \
  -configuration Release \
  -derivedDataPath "$BUILD/DerivedData" \
  MARKETING_VERSION="$VERSION" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
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

find_identity() {
  security find-identity -v -p codesigning 2>/dev/null \
    | awk -F'"' -v pat="$1" '$0 ~ pat { print $2; exit }'
}

IDENTITY="${DEVELOPER_ID_APP:-$(find_identity 'Developer ID Application')}"
SIGN_OPTS=(--options runtime --timestamp)
if [[ -z "$IDENTITY" ]]; then
  IDENTITY="$(find_identity 'Apple Development')"
  if [[ -n "$IDENTITY" ]]; then
    echo "==> no Developer ID certificate — signing with Apple Development (local testing only)"
  else
    echo "==> no signing certificate — ad-hoc signing (Gatekeeper: right-click → Open once)"
    IDENTITY="-"
    SIGN_OPTS=()
  fi
fi

# ${arr[@]+"${arr[@]}"} keeps `set -u` happy on the empty array under macOS bash 3.2.
sign_path() {
  codesign --force ${SIGN_OPTS[@]+"${SIGN_OPTS[@]}"} --sign "$IDENTITY" "$@"
}

echo "==> codesign with: $IDENTITY"
ENTITLEMENTS="$MACOS/Mothership/App/Mothership.entitlements"
if [[ -x "$APP_OUT/Contents/Resources/node/bin/node" ]]; then
  sign_path --entitlements "$ENTITLEMENTS" "$APP_OUT/Contents/Resources/node/bin/node"
fi
# Nested native addons / helper executables must be signed before the outer bundle.
if [[ -d "$APP_OUT/Contents/Resources/mothership" ]]; then
  find "$APP_OUT/Contents/Resources/mothership" -type f \( -name "*.node" -o -perm -111 \) -print0 \
    | while IFS= read -r -d '' f; do sign_path "$f" 2>/dev/null || true; done
fi
sign_path --entitlements "$ENTITLEMENTS" "$APP_OUT"
codesign --verify --deep --strict "$APP_OUT"

if [[ "$DMG" -eq 1 ]]; then
  DMG_PATH="$BUILD/PhoneHome-Mothership-$VERSION-macos.dmg"
  DMG_STAGE="$BUILD/dmg-stage"
  rm -rf "$DMG_STAGE" "$DMG_PATH"
  mkdir -p "$DMG_STAGE"
  cp -R "$APP_OUT" "$DMG_STAGE/"
  ln -s /Applications "$DMG_STAGE/Applications"
  hdiutil create -volname "$APP_NAME" -srcfolder "$DMG_STAGE" -ov -format UDZO "$DMG_PATH"
  rm -rf "$DMG_STAGE"
  if [[ "$IDENTITY" != "-" ]]; then
    codesign --force --timestamp --sign "$IDENTITY" "$DMG_PATH"
  fi
  echo "==> $DMG_PATH"
fi

echo "==> $APP_OUT"
