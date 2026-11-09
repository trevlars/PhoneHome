# App Store go-live (PhoneHome)

Bundle ID: `app.phonehome.ios` · App Store title: **PhoneHome: The Landline Reborn** · App name: **PhoneHome**
**Price: Free** (web softphone works in Safari; iOS adds CallKit + Face ID).

**Live listing:** https://apps.apple.com/app/id6804245868 (seller name on the page is still the Apple Developer legal name until Apple updates it — see **Developer display name** below).

Listing assets + fastlane: [`mobile/app-store/README.md`](../mobile/app-store/README.md).
Native CallKit / APNs: [`native-ios-callkit.md`](./native-ios-callkit.md).

## Your checklist (Cameron) — human / hub only

Everything else goes through the **App Store Connect API** (see below).

### Hub / review readiness

- [ ] Mothership HTTPS up 24/7 during review (`https://mothership.example:8443`)
- [x] Production **APNs** on the hub (`APNS_*` env; Store/TestFlight production host) — verified 2026-09-28 on CT122: KEY_ID/TEAM_ID/BUNDLE_ID/`APNS_KEY_P8` set, `APNS_PRODUCTION=1`, `/api/bridge/health` → `apnsVoipConfigured` + `iosCallKitPush` true
- [x] App privacy manifest (`PrivacyInfo.xcprivacy`, UserDefaults reason `CA92.1`, tracking off)
- [x] Debug install + launch verified on physical iPhone 15 Pro Max (PrivacyInfo in binary)
- [x] Spot-check: `test` only sees/calls Cameron
- [x] Review demo password synced to ASC (`test` / fixture password; `ASC_REVIEW_DEMO_PASSWORD` in local `asc.env`)
- [x] Production **APNs** re-verified on lab hub after managed-launch deploy (lab was unreachable mid-cut)

### Final gate (after API push + binary)

- [x] Spot-check screenshots / What’s New in ASC UI if you want eyes on it
- [ ] **App Privacy nutrition labels** in ASC UI (`mobile/app-store/app-privacy-answers.md`)
- [ ] **Submit for Review** (or ask agent: `submit_appstore` once APNs + privacy labels are done)
- [ ] After approve: phased or manual release

### Social / marketing launch (parallel)

Repo marketing stack: [`docs/marketing/`](../docs/marketing/). Community URLs: `web/storefront-pages/community-urls.json`.

- [ ] Cameron: create social accounts — [`account-setup-checklist.md`](../docs/marketing/account-setup-checklist.md)
- [ ] Cameron: film 8 launch videos — [`video-scripts.md`](../docs/marketing/video-scripts.md)
- [x] Storefront social footer, press page, README community section
- [x] GitHub Discussions enabled on `trevlars/PhoneHome`
- [x] Discord invite in `community-urls.json` (`https://discord.gg/QWmCcnJn2Q`)
- [ ] Deploy storefront after URL updates: `npx wrangler pages deploy web/storefront-pages --project-name=phonehome --branch=main`

### Optional

- [ ] First paid cloud pilots (`docs/managed-pilot.md`) after Stripe live prices + legal sign-off

---

## API / agent checklist (do via fastlane — not the ASC website)

Uses the same key as another app (`~/path/to/asc.env`).

```bash
cd mobile
./scripts/asc-upload.sh upload_metadata   # category + age rating + copy + URLs + review contact/demo user + Free price
./scripts/asc-upload.sh upload_listing    # Screenshots (iPhone / iPad)
./scripts/asc-upload.sh upload_testflight # What to Test on latest build
./scripts/asc-upload.sh release_testflight # Archive + upload + PhoneHomers + attach to App Store version
./scripts/asc-upload.sh set_price_free    # Free via appPriceSchedules (also runs inside upload_metadata)
./scripts/asc-upload.sh submit_appstore   # Submit attached version; manual release
```

- [x] Push **metadata** — Social Networking + Lifestyle, age rating, URLs (:443), description, review notes, demo user `test`
- [x] Set **price Free** (`set_price_free` / appPriceSchedules)
- [x] Push **screenshots** (`upload_listing`) — verified in ASC: 7 iPhone + 7 iPad, all complete
- [x] Refresh **TestFlight What to Test** on build 13 (`upload_testflight`)
- [x] **Archive + upload** build 13; distributed to PhoneHomers
- [x] Attach build **1.0 (13)** to App Store version 1.0
- [ ] **Submit for Review** (deliver `submit_for_review: true` when ready — ask agent)

**Still ASC UI:** App Privacy nutrition labels. Use
`mobile/app-store/app-privacy-answers.md`; the privacy manifest does not update
these answers automatically.
**Review demo:** username `test` — password from local `ASC_REVIEW_DEMO_PASSWORD` (gitignored); already uploaded with metadata.

---

## Done in-repo

- [x] Price positioning: Free (no paid door for CallKit)
- [x] Listing metadata + review notes in `mobile/app-store/metadata/`
- [x] Age rating JSON + category / Free wired into deliver
- [x] Privacy + support pages (`web/src/privacy.html`, `support.html`) — live on lab hub
- [x] Seamless onboarding: Splash → How it works → Connect (share links OK)
- [x] Device-scoped How it works completion (survives Cap → hub hop)
- [x] CallKit + PushKit; account hard-delete
- [x] Review account `test` hard-locked to Cameron
- [x] TestFlight public link + screenshots/fastlane
- [x] Debug install verified on physical iPhone

## Price & positioning

- App Store price tier: **Free**
- No IAP required for calling on a self-hosted Mothership
- Host license ($25/yr, 30-day trial) is sold only on the website — never in-app
- Guideline 3.1.3(f) (free companion to a paid web service) bans calls to action for off-app purchase, **except on the US storefront** (3.1.1(a) / 3.1.3, 2025 update)
- iOS shell reads the App Store storefront via StoreKit (`getStorefront`). `purchaseLinksAllowed()` in `web/src/app.js` shows prices, trial/buy links, referral codes, and Circle billing only when the storefront is `USA`; unknown or non-US → neutral "host on a Mac or home server" copy + Support link only
- Keep the App Store description/promo text free of prices and buy links (metadata is shown in every storefront)
- Amazon/eBay links for the HT801 adapter are physical goods (3.1.3(e)) — fine everywhere

## Public URLs (App Store Connect)

Served from every Mothership (static files in `web/`):

| ASC field      | Lab canonical URL (port 443 — ASC rejects :8443) |
| -------------- | ------------------------------------------------ |
| Privacy Policy | `https://phonehome.pages.dev/privacy.html` |
| Support        | `https://phonehome.pages.dev/support.html` |
| Marketing      | `https://phonehome.pages.dev/trial.html`   |
| Terms          | `https://phonehome.pages.dev/terms.html`   |

Fastlane metadata under `mobile/app-store/metadata/en-US/` should match. Lab softphone for Connect/review stays `https://mothership.example:8443`. Alternate ASC-safe paths on `:443` (`/privacy.html`, `/support.html`) still proxy via PVE Caddy if needed.

## Share tokens (invite / Grandma / join)

| Link              | Purpose                                           |
| ----------------- | ------------------------------------------------- |
| `/?join=…`        | One-tap parent join (family / friend / co-parent) |
| `/?gp=…`          | Grandma one-tap claim                             |
| `/?invite=123456` | 6-digit code in a URL                             |

Built from `PUBLIC_BASE_URL`. Mothership admin → Connection shows App URL + Copy.
**iOS Connect** accepts a full share link: saves the hub origin and opens with the token so invites survive the Cap → hub hop.

## Onboarding (app ≈ web)

1. **Splash** → **How it works** (same slides as the website; last slide says Connect is next).
2. **Connect** — paste Mothership HTTPS or `/?join=` / `/?gp=` / `/?invite=` share link.
3. Hub loads → **Welcome / Sign in** (walkthrough not replayed; device flag via Cap plugin).

Web/PWA skips Connect (already on the hub) and uses the same splash → How it works → Welcome path.

## Developer display name (“TrevLars”)

The App Store page shows **seller / developer** from your Apple Developer **legal entity**, not from repo metadata. Today the public API reports **Cameron East** for `app.phonehome.ios`.

- **Individual membership:** seller name is your legal name; it does not follow your Apple ID display name. To show **TrevLars** or a company brand, enroll as an **organization** (e.g. the operator) or ask Apple Developer Support to update the legal entity / trade name (documentation required; can take ~2 weeks).
- **Organization membership:** trade/DBA names are set when the **first** app record is created and generally **cannot** be edited later — contact Apple if the live seller must change.

Website and support copy can say **TrevLars**; the App Store seller line must match Apple’s contracts (Guideline 1.2).

## App Store marketing icon

`mobile/app-store/metadata/app_icon.png` (and `en-US/app_icon.png`) must match `web/public/icon-1024.png`. After syncing, upload via **App Store Connect → App Information → App Icon**, or `./scripts/asc-upload.sh upload_metadata` once an **editable** App Store version exists (create **1.0.1** after 1.0 goes live).

## 1.0.1 ship list (post–1.0 review)

| Change | Where |
| --- | --- |
| Connect Join/Host layout (WebKit `button` + grid bug) | `web/src/app.css`, `web/src/app.js` |
| CallKit “Call Failed” crash on answer | `mobile/plugins/phonehome-callkit` (build 18+) |
| Locked-phone hold/hangup latency | native wake + hub signaling (build 18+) |
| App Store links on website | `web/storefront-pages/`, `PHONEHOME_IOS_APP_URL` |

Bump `CURRENT_PROJECT_VERSION`, rebuild web (`npm run build -w web`), `npx cap sync ios`, archive, upload, attach to **1.0.1** in ASC.

## Reviewer path

1. Install PhoneHome — splash → How it works → Connect.
2. Paste review Mothership HTTPS (or share link) → Welcome / Sign in.
3. Sign in as `test` → call Cameron only.
4. Mic on first call; Face ID optional under Parent → Account.

---

## Google Play (Android) — internal / closed testing

Package: `app.phonehome.android` · Upload: `cd mobile && ./scripts/play-upload.sh release_internal`

### Console state (2026-10-10)

- **Internal testing:** Active — release **1.0** (version code **20**) available to testers. Opt-in: `https://play.google.com/apps/internaltest/4701450517892842095`
- **Closed testing (Alpha):** US + testers configured; draft release **1.0** (v19) on review step — **blocked** until Foreground service permissions declaration is saved
- **Store listing URL** `https://play.google.com/store/apps/details?id=app.phonehome.android` returns **404** until the app has a reviewed release (closed/open/production). That is why web **Download test app** 404s; testers should install from the **Play Store app** after opt-in (Profile → Manage apps & device → Testing)

### Cameron gate — FGS declaration (required to publish closed test)

Play Console → **App content** → **Foreground service permissions** (`FOREGROUND_SERVICE_PHONE_CALL` in manifest).

1. Select **VoIP / telecom APIs** (PhoneHome ongoing family calls).
2. Upload a **short screen recording** to YouTube (unlisted is fine) showing: place or receive a call, ongoing-call notification visible, user can leave the app without dropping audio.
3. Paste the **YouTube URL** in **Video link**, save declaration.
4. **Closed testing → Alpha** → finish **Preview and confirm** → **Save and publish** / send for review.
5. After approval, `https://play.google.com/apps/testing/app.phonehome.android` and store details links should work for testers.

Fastlane uploads to a **draft** Play app must use `release_status: "draft"` in `mobile/fastlane/Fastfile`; roll out in Console (API `completed` is rejected on draft apps).
