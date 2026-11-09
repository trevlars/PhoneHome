#!/usr/bin/env bash
# Export Developer ID cert + upload GitHub secrets for signed Mothership DMG builds.
# Run once after creating "Developer ID Application" in Xcode or developer.apple.com.
set -euo pipefail

TEAM="${APPLE_TEAM_ID:-ABG342Z7V2}"
REPO="${GITHUB_REPO:-trevlars/PhoneHome}"

IDENTITY="$(security find-identity -v -p codesigning | awk -F'"' '/Developer ID Application/{print $2; exit}')"
if [[ -z "$IDENTITY" ]]; then
  echo "No Developer ID Application certificate in Keychain." >&2
  echo "Create one: Xcode → Settings → Accounts → Manage Certificates → + → Developer ID Application" >&2
  exit 1
fi

read -r -s -p "P12 export password: " P12_PASS
echo ""
read -r -s -p "Confirm password: " P12_PASS2
echo ""
[[ "$P12_PASS" == "$P12_PASS2" ]] || { echo "Passwords differ" >&2; exit 1; }

P12="$HOME/Desktop/PhoneHome-DeveloperID.p12"
security find-identity -v -p codesigning | grep "Developer ID Application"
security export -k ~/Library/Keychains/login.keychain-db -t identities -f pkcs12 -o "$P12" -P "$P12_PASS"

B64="$(base64 < "$P12" | tr -d '\n')"
gh secret set APPLE_TEAM_ID -b "$TEAM" -R "$REPO"
gh secret set DEVELOPER_ID_APP -b "$IDENTITY" -R "$REPO"
gh secret set DEVELOPER_ID_CERTIFICATE_BASE64 -b "$B64" -R "$REPO"
gh secret set DEVELOPER_ID_CERTIFICATE_PASSWORD -b "$P12_PASS" -R "$REPO"

echo "✓ GitHub secrets set for $REPO"
echo "  Optional: add NOTARY_API_KEY_* for stapled DMGs (App Store Connect → Keys)"
echo "  Then: git tag vX.Y.Z && git push origin vX.Y.Z"
rm -f "$P12"
