#!/usr/bin/env bash
# Notarize a DMG with Apple notarytool (requires App Store Connect API key or Apple ID).
set -euo pipefail

DMG="${1:?usage: notarize-dmg.sh path.dmg}"

if [[ -n "${NOTARY_API_KEY_PATH:-}" && -n "${NOTARY_API_KEY_ID:-}" && -n "${NOTARY_API_ISSUER:-}" ]]; then
  xcrun notarytool submit "$DMG" \
    --key "$NOTARY_API_KEY_PATH" \
    --key-id "$NOTARY_API_KEY_ID" \
    --issuer "$NOTARY_API_ISSUER" \
    --wait
elif [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]]; then
  xcrun notarytool submit "$DMG" \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_APP_SPECIFIC_PASSWORD" \
    --team-id "${APPLE_TEAM_ID:?}" \
    --wait
else
  echo "Set NOTARY_API_KEY_* or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD" >&2
  exit 1
fi

xcrun stapler staple "$DMG"
echo "==> Notarized and stapled: $DMG"
