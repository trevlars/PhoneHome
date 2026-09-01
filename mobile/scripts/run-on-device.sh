#!/usr/bin/env bash
# Build + install PhoneHome on the connected iPhone WITHOUT Xcode debugger.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UDID="${DEVICE_UDID:-00008130-000A24222483401C}"
TEAM="${DEVELOPMENT_TEAM:-ABG342Z7V2}"
BUNDLE=app.phonehome.ios

cd "$ROOT"
npm run build:plugin >/dev/null
npx cap sync ios >/dev/null

cd "$ROOT/ios/App"
xcodebuild \
  -workspace App.xcworkspace \
  -scheme App \
  -configuration Debug \
  -destination "id=$UDID" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM" \
  CODE_SIGN_STYLE=Automatic \
  build

APP="$(ls -d ~/Library/Developer/Xcode/DerivedData/App-*/Build/Products/Debug-iphoneos/App.app | head -1)"
xcrun devicectl device install app --device "$UDID" "$APP"
xcrun devicectl device process launch --device "$UDID" --terminate-existing "$BUNDLE"
echo "PhoneHome launched on device $UDID (no debugger)."
