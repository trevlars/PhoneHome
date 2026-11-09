#!/usr/bin/env bash
# Build + install PhoneHome on the connected iPhone WITHOUT Xcode debugger.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UDID="${DEVICE_UDID:-}"
if [[ -z "$UDID" ]]; then
  echo "Set DEVICE_UDID to the connected iPhone." >&2
  exit 1
fi
TEAM="${DEVELOPMENT_TEAM:-ABG342Z7V2}"
BUNDLE=app.phonehome.ios
DERIVED_DATA="${PHONEHOME_DERIVED_DATA:-$ROOT/build/device-derived-data}"

# xcodebuild -allowProvisioningUpdates needs ASC API auth in headless/CLI runs (not the Xcode GUI account).
ASC_ENV="$ROOT/scripts/asc.env"
if [[ ! -f "$ASC_ENV" && -f "$HOME/path/to/asc.env" ]]; then
  ASC_ENV="$HOME/path/to/asc.env"
fi
XCODE_AUTH_ARGS=()
if [[ -f "$ASC_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$ASC_ENV"
  if [[ -n "${ASC_KEY_ID:-}" && -n "${ASC_ISSUER_ID:-}" && -f "${ASC_KEY_PATH:-}" ]]; then
    XCODE_AUTH_ARGS=(
      -authenticationKeyPath "$ASC_KEY_PATH"
      -authenticationKeyID "$ASC_KEY_ID"
      -authenticationKeyIssuerID "$ASC_ISSUER_ID"
    )
  fi
fi

cd "$ROOT"
# Default: bundled softphone (new-user path) — splash → How it works → Connect, works offline.
# Lab-only: PHONEHOME_CAP_URL=https://your.hub ./scripts/run-on-device.sh
# (still shows Connect; does not skip onboarding).
unset PHONEHOME_CAP_BUNDLED
if [[ -n "${PHONEHOME_CAP_URL:-}" ]]; then
  export PHONEHOME_CAP_URL
  echo "Build note: PHONEHOME_CAP_URL set ($PHONEHOME_CAP_URL) — Connect UI still shown first."
else
  export PHONEHOME_CAP_BUNDLED=1
  echo "Bundled softphone build (no baked Mothership URL)."
fi
npm run build:plugin >/dev/null
# Keep web/public in sync with latest softphone (includes login routing fixes).
if [[ -f "$ROOT/../web/package.json" ]]; then
  (cd "$ROOT/.." && npm run build -w web >/dev/null)
fi
npx cap sync ios >/dev/null

cd "$ROOT/ios/App"
rm -rf "$DERIVED_DATA" 2>/dev/null || true
mkdir -p "$DERIVED_DATA"
xcodebuild \
  -workspace App.xcworkspace \
  -scheme App \
  -configuration Debug \
  -sdk iphoneos \
  -destination "platform=iOS,id=$UDID" \
  -derivedDataPath "$DERIVED_DATA" \
  -jobs 1 \
  ENABLE_ON_DEMAND_RESOURCES=NO \
  -allowProvisioningUpdates \
  "${XCODE_AUTH_ARGS[@]}" \
  DEVELOPMENT_TEAM="$TEAM" \
  CODE_SIGN_STYLE=Automatic \
  build

APP="$DERIVED_DATA/Build/Products/Debug-iphoneos/App.app"
xcrun devicectl device install app --device "$UDID" "$APP"
xcrun devicectl device process launch --device "$UDID" --terminate-existing "$BUNDLE"
echo "PhoneHome launched on device $UDID (no debugger)."
