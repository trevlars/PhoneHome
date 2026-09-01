# App Store & TestFlight listing assets

Generated screenshots and copy for **App Store Connect** — iPhone 6.7″, iPad 12.9″, and Mac (Apple silicon).

**TestFlight public link:** https://testflight.apple.com/join/4SWCTNec

## Regenerate screenshots

```bash
npm run app-store:screenshots
# or everything (README + App Store):
npm run screenshots
```

Output: `mobile/app-store/screenshots/`

| Folder | App Store Connect slot | Size |
| --- | --- | --- |
| `iphone-6.7/` | iPhone 6.7″ Display | 1290 × 2796 |
| `ipad-12.9/` | iPad 12.9″ Display | 2048 × 2732 |
| `mac/` | Mac (Designed for iPhone/iPad) | 1280 × 800 |

Upload order matches filenames (`01-hero.png` … `07-private-by-design.png`).

## Upload via App Store Connect API (fastlane)

Reuses the same **App Store Connect API key** as GameSphere (`~/GameSphere/Scripts/asc.env`: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH`).

```bash
cd mobile
# optional: cp scripts/asc.env.example scripts/asc.env
./scripts/asc-upload.sh              # metadata + screenshots (default)
./scripts/asc-upload.sh upload_listing   # screenshots only
./scripts/asc-upload.sh upload_metadata  # copy + review contact only
fastlane ios asc_info                # verify app.phonehome.ios record
```

Lanes live in `mobile/fastlane/`. `upload_all` runs metadata then screenshots separately (fastlane quirk on first App Store version).

**ASC app name:** `Phone.Home` (global `PhoneHome` is taken). Bundle ID: `app.phonehome.ios`.

## Manual upload in App Store Connect

1. [App Store Connect](https://appstoreconnect.apple.com) → **Apps** → **Phone.Home** (`app.phonehome.ios`)
2. **Distribution** → version → **App Store** tab (screenshots apply to App Store and TestFlight listing preview)
3. **iPhone 6.7″** — drag all files from `screenshots/iphone-6.7/`
4. **iPad 12.9″** — drag all files from `screenshots/ipad-12.9/`
5. **Mac** — drag all files from `screenshots/mac/` (required when offering the iOS app on Apple silicon Mac)
6. **Metadata** — paste from `metadata/en-US/` (see below)
7. **TestFlight** → external group uses the same build; optional **Test Details** / **What to Test** from `metadata/en-US/testflight_what_to_test.txt`

## Metadata files (`metadata/en-US/`)

| File | App Store Connect field |
| --- | --- |
| `name.txt` | Name (`Phone.Home`) |
| `subtitle.txt` | Subtitle |
| `promotional_text.txt` | Promotional Text (170 chars, editable anytime) |
| `description.txt` | Description |
| `keywords.txt` | Keywords |
| `release_notes.txt` | What’s New (per version) |
| `testflight_what_to_test.txt` | TestFlight → Test Information |
| `marketing_url.txt` | Marketing URL |
| `support_url.txt` | Support URL |
| `privacy_url.txt` | Privacy Policy URL (set in App Privacy / Privacy Policy field) |

Update `privacy_url.txt` when a public privacy policy page is live.

## Review contact (`metadata/review_information/`)

Uploaded with `upload_metadata`. Update `phone_number.txt` to your real contact number (`+1 …` format) before App Review submission.

- Sign in with your Mothership **HTTPS** URL (same as the PWA).
- Server-side review account: see `server/src/api.ts` (`APP_STORE_REVIEW_*` env on the hub).
- Mic permission is required on first call; Face ID is optional (Parent → Account).
