# macOS Mothership (menu bar app)

The proper Mac install is a **signed, notarized** menu bar app — not shell scripts.

## What you get

- **PhoneHome Mothership.app** in `/Applications`
- **Menu bar icon** (phone) — like other server tools
- **Start at login** via System Settings (registered by the app)
- **No Gatekeeper / quarantine warnings** when signed with our Developer ID
- Opens **http://127.0.0.1:8787** for setup; config in `~/.phonehome/`

## Install (parents)

1. Download **`PhoneHome-Mothership-*-macos.dmg`** from [GitHub Releases](https://github.com/trevlars/PhoneHome/releases)
2. Open the DMG → drag **PhoneHome Mothership** to **Applications**
3. Launch from Applications (first open: right-click → Open if macOS asks once)
4. Click the **phone icon** in the menu bar → **Preferences** → paste HTTPS URL (optional) → **Save & restart**

HTTPS for phones (when ready):

```bash
brew install cloudflared
cloudflared tunnel --url http://127.0.0.1:8787
```

Paste the `https://….trycloudflare.com` URL in Preferences.

## Build locally (unsigned)

```bash
brew install xcodegen
./macos/Scripts/build-macos-app.sh --dmg
open macos/build/PhoneHome-Mothership-*.dmg
```

Unsigned builds will show Apple’s “unidentified developer” prompt — expected until signing secrets are configured.

## Release signing (maintainers)

Requires [Apple Developer Program](https://developer.apple.com/programs/) and a **Developer ID Application** certificate.

GitHub Actions secrets:

| Secret | Purpose |
| --- | --- |
| `APPLE_TEAM_ID` | 10-char Team ID |
| `DEVELOPER_ID_APP` | `Developer ID Application: Your Name (TEAMID)` |
| `DEVELOPER_ID_CERTIFICATE_BASE64` | `.p12` export, base64 |
| `DEVELOPER_ID_CERTIFICATE_PASSWORD` | `.p12` password |
| `NOTARY_API_KEY_ID` | App Store Connect API key (preferred) |
| `NOTARY_API_ISSUER` | Issuer UUID |
| `NOTARY_API_KEY_BASE64` | App Store Connect API `.p8`, base64 |

Tag `v*` triggers both the zip bundles (Linux/Windows) and the macOS DMG workflow.

## Dev: run from Xcode without bundling

```bash
export PHONEHOME_DEV_ROOT="$PWD"
open macos/PhoneHomeMothership.xcodeproj
```

Uses system `node` and repo `deploy/phonehome-supervisor.mjs`.

## Legacy zip installer

The `.zip` + `.command` bundle remains for CI/Linux parity but is **deprecated on Mac** — use the DMG.
