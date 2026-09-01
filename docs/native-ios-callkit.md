# Native iOS softphone (in-app UI + optional CallKit)

PhoneHome’s Stage‑1 softphone is a PWA. Cap iOS wraps it for notifications and (optionally) system CallKit.

## TestFlight

**[Join the beta](https://testflight.apple.com/join/4SWCTNec)** — iPhone, iPad, and Apple silicon Mac (M-series). Install from TestFlight, open PhoneHome, and sign in to your Mothership **HTTPS** URL (same as the browser PWA).

| Layer | Role |
| --- | --- |
| `mobile/` | Capacitor iOS app (`app.phonehome.ios`) |
| `mobile/plugins/phonehome-callkit` | CallKit + PushKit + **alert APNs** Capacitor plugin |
| `web/` | Softphone UI (loaded live from HTTPS or bundled) |
| `server/` | Device token store + APNs (alert and/or VoIP) + pending SDP |

## Current default: CallKit **OFF** (opt-in)

Preference: **in-app calling only**. Incoming call = a **notification you tap** that opens PhoneHome’s regular call card / Answer buttons.

| Flag | Where | Default |
| --- | --- | --- |
| `PhoneHomeCallKitEnabled` | iOS `Info.plist` | `false` |
| `kl_callkit` | JS `localStorage` + native UserDefaults | unset → **off** |
| `IOS_CALLKIT` / `CALLKIT_ENABLED` | Hub server env | unset → **auto** |

**Apple constraint:** PushKit VoIP pushes **require** reporting to CallKit. With CallKit off we **do not register PushKit**. Wake uses **standard APNs alert** notifications instead. Killed-app delivery is **less reliable** than VoIP+CallKit; in-app two-way audio (once the app is open) still works.

### Turn Lock-screen Answer on (no `localStorage` poking)

1. Rebuild the iOS app so the native plugin includes the CallKit fixes (`cd mobile && ./scripts/run-on-device.sh`).
2. In the app: **Parent → This phone → Answer from the lock screen**.
3. That writes UserDefaults immediately so the **next** killed-app launch starts PushKit in `attach()` before any VoIP push arrives. The hub sends VoIP automatically once this phone registers a VoIP token — no `IOS_CALLKIT=1` on the server.

Hub kill switch: `IOS_CALLKIT=0` forces alert APNs even if a VoIP token exists.

## What works (in-app path)

1. Xcode project builds with mic + background audio (voip mode retained for future CallKit revive).
2. Plugin registers for **standard APNs** (`registerAlertPush`) and reports `apnsToken` to JS.
3. Server `POST /api/devices/apns-token` stores tokens per line (`platform=ios-alert`).
4. On `call.offer` (when not FXS-first), server stores pending SDP and sends an **alert push** (“PhoneHome — Call from X”).
5. Tap opens the app → WS / `/api/calls/pending` → **`paintCallLayer`** softphone ring/answer UI → Answer → WebRTC.

## CallKit + PushKit path (opt-in)

When flags are on:

1. Plugin registers **PushKit VoIP** and reports tokens to `POST /api/devices/voip-token`.
2. Server sends VoIP pushes (`apns-topic` `….voip`).
3. Plugin reports **CallKit** incoming; Answer drives JS accept.

## Apple Developer hoops (you do these once)

1. App ID `app.phonehome.ios` with **Push Notifications**.
2. Create an **APNs Auth Key** (.p8) — Keys → Apple Push Notifications service.
3. Enable Background Modes (already in `Info.plist`).
4. VoIP topic (CallKit path only): `app.phonehome.ios.voip`. Alert topic: `app.phonehome.ios`.
5. In Xcode: signing team, capability **Push Notifications**.

### Server env (CT 122 / lab)

```bash
APNS_KEY_ID=XXXXXXXXXX
APNS_TEAM_ID=XXXXXXXXXX
APNS_BUNDLE_ID=app.phonehome.ios
APNS_KEY_P8=/var/lib/kids-landline/AuthKey_XXX.p8
# APNS_PRODUCTION=1   # prefer production first; omit to prefer sandbox/dev
# IOS_CALLKIT=0       # hub kill switch: never send VoIP (alert only)
```

The hub retries the other APNs host on `BadDeviceToken` so a TestFlight/production phone and an Xcode/sandbox phone can share the same hub. The working host is stored on the token.

Without APNs keys, pushes are skipped (logged) so lab softphone WS still works when the app is open.

## Build & run

**Preferred (no Xcode debugger — avoids iOS‑beta symbol / pause pain):**

```bash
cd mobile && ./scripts/run-on-device.sh
```

Or manually:

```bash
npm run build -w web
cd mobile
npm install
npx cap sync ios
npx cap open ios
```

Default Capacitor config loads **`https://y5876647.eero.online:8443`** inside the WebView so cookies/sessions match the hub. For offline bundled assets:

```bash
PHONEHOME_CAP_BUNDLED=1 npx cap sync ios
```

**iOS 26/27 note:** the app uses a `SceneDelegate` (required). Running under the Xcode debugger with incomplete device symbols can still “pause”; prefer `run-on-device.sh` or **Run Without Debugging**.

## App icon badge (missed + voicemail)

The softphone sets the **iOS home-screen badge** from real product counts (no FreePBX MWI yet):

| Count | Source | Clears when |
| --- | --- | --- |
| Unread voicemail | `voicemails.listened = 0` for the active line | Message is played (existing listen API) |
| Unseen missed | Inbound `call_logs` with `outcome = missed` newer than a per-line localStorage cursor | User opens **Activity** |

Native API (plugin): `requestBadgePermission`, `setBadge({ count })`, `clearBadge`.

JS syncs on `/api/me` refresh, `voicemail.new`, CallKit decline/timeout (if CallKit on), app foreground, and line switch.

### How to test on device (in-app path)

1. Rebuild native + sync: `cd mobile && ./scripts/run-on-device.sh`.
2. Allow notifications when prompted.
3. Background or kill the app → place inbound softphone call → **notification** (not CallKit).
4. Tap notification → app opens to ring/answer card → Answer → two-way with analog.
5. Confirm **no** system CallKit Answer / lock-screen native call UI.

### How to test Lock-screen Answer (opt-in)

1. Rebuild native (required for the PushKit-completion + audio-session fixes).
2. Parent → This phone → **Answer from the lock screen**.
3. Kill the app → place inbound call → system incoming UI (not just a banner).
4. Answer from the lock screen → two-way audio. If it’s silent or the app dies, turn the toggle back off.

### Known gaps / residual limits

- **Killed / background (CallKit off):** alert APNs is not as reliable as VoIP+CallKit; iOS may delay or coalesce notifications.
- **Lock-screen Answer (opt-in):** native plugin now waits for CallKit to accept the incoming report before finishing the PushKit completion, and does not `setActive(false)` on mid-call `didDeactivate` (route-change silence). Still experimental — leave the toggle off if it misbehaves.
- **No badge-only silent push yet** for voicemail when fully killed (same as before).
- FreePBX MWI / analog mailbox LED sync is a follow-up.

## Sign-in (session + Face ID)

WKWebView `localStorage` is not a reliable password vault. After a successful username/password sign-in the iOS shell stores:

- **Session token** in Keychain (`AfterFirstUnlockThisDeviceOnly`) so a WebView storage wipe doesn’t dump you at login.
- **Username + password** in Keychain. **Face ID / Touch ID** (or device passcode) is required to read the password.

**Confirmed working** on the lab iPhone (15 Pro Max) with the Keychain plugin on-device. Rebuild the native app after plugin changes (`mobile/scripts/run-on-device.sh` or Xcode). The live HTTPS UI can ship first; Face ID only works once that native plugin is on the phone.

A session-only restore does **not** write a password. If Face ID never prompted after a rebuild, open **Parent → Account → Save for Face ID** and type your password once. Sign-in with username/password (or set/change password) also writes Keychain.

Sign-out keeps the saved password for Face ID next time. **Forget saved sign-in** on the login screen, **Forget Face ID** under Account, or deleting the account, clears Keychain login.

## Privacy

Pushes carry **callId + display name + line ids only** — no SDP/media. Audio stays WebRTC DTLS-SRTP after answer. See `docs/privacy-security.md`.
