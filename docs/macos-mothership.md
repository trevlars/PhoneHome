# macOS Mothership (menu bar app)

The Mac install is a **menu bar app** shipped as a DMG — not shell scripts.

## What you get

- **PhoneHome Mothership.app** in `/Applications`
- **UFO icon** in the menu bar — like other server tools
- **Start at login** via System Settings (registered by the app)
- Opens **http://127.0.0.1:8787** for setup; config in `~/.phonehome/`
- **No Gatekeeper prompt** when the release was signed + notarized with our Developer ID (see below); otherwise a one-time right-click → Open

## Install (parents)

1. Download **`PhoneHome-Mothership-*-macos.dmg`** from [GitHub Releases](https://github.com/trevlars/PhoneHome/releases)
2. Open the DMG → drag **PhoneHome Mothership** to **Applications**
3. Launch from Applications (if macOS asks: right-click → **Open**, once)
4. Click the **UFO icon** in the menu bar → **Preferences** → paste HTTPS URL (optional) → **Save & restart**

HTTPS for phones (when ready):

```bash
brew install cloudflared
cloudflared tunnel --url http://127.0.0.1:8787
```

Paste the `https://….trycloudflare.com` URL in Preferences.

## Build locally

```bash
brew install xcodegen
./macos/Scripts/build-macos-app.sh --dmg
open macos/build/PhoneHome-Mothership-*.dmg
```

Xcode builds the bundle unsigned, the server tree + Node.js are embedded, then the finished
app is signed with the best identity in your keychain: **Developer ID Application** →
**Apple Development** → **ad-hoc**. Ad-hoc builds launch fine (Apple silicon requires at least
that) but show Apple’s “unidentified developer” prompt once.

Version comes from `MOTHERSHIP_VERSION`, else the `vX.Y.Z` git tag on CI, else `package.json`.

## Release signing (maintainers)

Requires [Apple Developer Program](https://developer.apple.com/programs/) and a **Developer ID Application** certificate. `./macos/Scripts/upload-signing-secrets.sh` exports the cert and sets the GitHub secrets.

| Secret | Purpose |
| --- | --- |
| `APPLE_TEAM_ID` | 10-char Team ID |
| `DEVELOPER_ID_APP` | `Developer ID Application: Your Name (TEAMID)` |
| `DEVELOPER_ID_CERTIFICATE_BASE64` | `.p12` export, base64 |
| `DEVELOPER_ID_CERTIFICATE_PASSWORD` | `.p12` password |
| `NOTARY_API_KEY_ID` | App Store Connect API key (preferred) |
| `NOTARY_API_ISSUER` | Issuer UUID |
| `NOTARY_API_KEY_BASE64` | App Store Connect API `.p8`, base64 |

Without these secrets CI still produces a working **ad-hoc signed** DMG. With them the DMG is
Developer ID signed and notarized.

Tag `v*` triggers both the zip/tar bundles (Linux / Windows / Mac zip) and the macOS DMG
workflow. To test the Mac build without tagging, run **macOS Mothership app** from the Actions
tab (`workflow_dispatch`) — the DMG is attached as a workflow artifact.

## App icon

The UFO app icon and menu bar glyph are generated from `web/src/ufo.svg`:

```bash
pip3 install cairosvg pillow
python3 web/scripts/generate-icons.py
```

This also regenerates the rotary-phone web/iOS icons from `web/src/rotary-phone-source.svg`.

## Dev: run from Xcode without bundling

```bash
export PHONEHOME_DEV_ROOT="$PWD"
open macos/PhoneHomeMothership.xcodeproj
```

Uses system `node` and repo `deploy/phonehome-supervisor.mjs`.

## Legacy zip installer

The `.zip` + `.command` bundle remains for CI/Linux parity but is **deprecated on Mac** — use the DMG.
