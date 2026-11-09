# App Store & TestFlight listing assets

Generated screenshots and copy for **App Store Connect** — iPhone 6.7″, iPad 12.9″, and Mac (Apple silicon).

**Price:** Free · **Go-live checklist:** [`docs/app-store-go-live.md`](../../docs/app-store-go-live.md)

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
| `mac/` | Local Mac marketing preview (not uploaded to the iOS version) | 1280 × 800 |

Upload order matches filenames (`01-hero.png` … `07-private-by-design.png`).

## Upload via App Store Connect API (fastlane)

Reuses the same **App Store Connect API key** as another app (`~/path/to/asc.env`: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH`).

Prefer API over the ASC website for listing fields — see [`docs/app-store-go-live.md`](../../docs/app-store-go-live.md).

```bash
cd mobile
# optional: cp scripts/asc.env.example scripts/asc.env
./scripts/asc-upload.sh              # metadata + screenshots (default)
./scripts/asc-upload.sh upload_listing   # screenshots only
./scripts/asc-upload.sh upload_metadata  # Free + category + age rating + copy + review contact/demo
./scripts/asc-upload.sh upload_testflight # What to Test + beta description on latest build
./scripts/asc-upload.sh release_testflight # Archive + upload + PhoneHomers + attach to App Store version
fastlane ios asc_info                # verify app.phonehome.ios record
fastlane ios testflight_info         # beta groups, builds, current What to Test
```

`upload_metadata` also sets **price Free**, **Social Networking** (+ Lifestyle), and age rating from `app-store/age_rating.json`.
Set `ASC_REVIEW_DEMO_PASSWORD` in `asc.env` so the review demo password is uploaded (gitignored `demo_password.txt`).

Lanes live in `mobile/fastlane/`. `upload_all` runs metadata then screenshots separately (fastlane quirk on first App Store version).
The upload lane sends the 6.7″ iPhone and 12.9″ iPad sets. Designed-for-iPhone/iPad availability on Apple silicon inherits the iOS listing; `mac/` is not a valid screenshot set for the iOS App Store version.

**User-facing brand:** `PhoneHome`. The App Store title is `PhoneHome: Family Calling` because the exact global title `PhoneHome` is unavailable. The installed app, Home Screen label, and CallKit UI all use `PhoneHome` via `CFBundleDisplayName` in `Info.plist`. Bundle ID: `app.phonehome.ios`.

## Manual upload in App Store Connect

Only needed for **App Privacy** nutrition labels (no lane yet) or if you prefer the website for a one-off check. Everything else should go through the API commands above.

## Metadata files (`metadata/en-US/`)

| File | App Store Connect field |
| --- | --- |
| `name.txt` | App Store title (`PhoneHome: Family Calling`; exact global `PhoneHome` is unavailable) |
| `app_icon.png` | 1024×1024 marketing icon (synced from `web/public/icon-1024.png`) |
| `subtitle.txt` | Subtitle |
| `promotional_text.txt` | Promotional Text (170 chars, editable anytime) |
| `description.txt` | Description |
| `keywords.txt` | Keywords |
| `release_notes.txt` | What’s New (per version) |
| `testflight_what_to_test.txt` | TestFlight → What to Test (per build; `upload_testflight`) |
| `testflight_beta_description.txt` | TestFlight → Beta App Description |
| `testflight_feedback_email.txt` | TestFlight → Feedback email |
| `marketing_url.txt` | Marketing URL (`https://…/` softphone splash) |
| `support_url.txt` | Support URL (`/support.html` on the Mothership) |
| `privacy_url.txt` | Privacy Policy URL (`/privacy.html` on the Mothership) |

Lab canonicals for **App Store Connect** use port **443** (ASC rejects `:8443`): `https://mothership.example/{privacy,support}.html` and `/phonehome` — Caddy proxies those to the Mothership. Softphone Connect/review still uses `PUBLIC_BASE_URL` (`https://mothership.example:8443`). Every Mothership also serves the same pages from `web/src/privacy.html` and `web/src/support.html` on its own base URL.

## Review contact (`metadata/review_information/`)

Uploaded with `upload_metadata`. Update `phone_number.txt` to your real contact number (`+1 …` format) before App Review submission.

- Sign in with your Mothership **HTTPS** URL (same as the PWA), or paste a full share link on Connect.
- Review account: username `test` — hard-locked to contact Cameron only (`server/src/api.ts`).
- Mic permission is required on first call; Face ID is optional (Parent → Account).
- Full submit checklist: [`docs/app-store-go-live.md`](../../docs/app-store-go-live.md).
