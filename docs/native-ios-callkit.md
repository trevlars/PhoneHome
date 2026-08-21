# Native iOS softphone (CallKit + PushKit)

PhoneHome’s Stage‑1 softphone is a PWA. **System incoming-call UI** (lock screen, CarPlay-ish paths, Bluetooth call audio) needs a native shell:

| Layer | Role |
| --- | --- |
| `mobile/` | Capacitor iOS app (`app.phonehome.ios`) |
| `mobile/plugins/phonehome-callkit` | CallKit + PushKit Capacitor plugin |
| `web/` | Existing softphone UI (loaded live from HTTPS or bundled) |
| `server/` | VoIP token store + APNs VoIP push + pending SDP |

## What works in this foundation

1. Xcode project builds with mic + `voip` / `audio` background modes.
2. Plugin registers for **PushKit VoIP** tokens and reports them to JS.
3. Server `POST /api/devices/voip-token` stores tokens per line.
4. On `call.offer` (when not FXS-first), server stores pending SDP and sends a **VoIP push**.
5. Plugin reports **CallKit** incoming from the push; on Answer, JS reconnects WS and receives the pending offer.

## Apple Developer hoops (you do these once)

1. App ID `app.phonehome.ios` with **Push Notifications**.
2. Create an **APNs Auth Key** (.p8) — Keys → Apple Push Notifications service.
3. Enable **Voice over IP** / background modes (already in `Info.plist`).
4. For VoIP pushes, APNs topic is `app.phonehome.ios.voip` (PushKit).
5. In Xcode: signing team, capability **Push Notifications** (and Background Modes if not inherited from plist).

### Server env (CT 122 / lab)

```bash
APNS_KEY_ID=XXXXXXXXXX
APNS_TEAM_ID=XXXXXXXXXX
APNS_BUNDLE_ID=app.phonehome.ios
APNS_KEY_P8=/var/lib/kids-landline/AuthKey_XXX.p8
# APNS_PRODUCTION=1   # TestFlight / App Store; omit for sandbox/dev
```

Without these, pushes are skipped (logged) so lab softphone WS still works.

## Build & run

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

## Next increments

- [ ] Wire `acceptCall` / `hangup` to `PhoneHomeCallKit.setConnected` / `endCall`
- [ ] Outgoing CallKit (`startOutgoing`) when placing a call from iOS
- [ ] App Store listing, privacy nutrition labels, kids/age rating as needed
- [ ] Android `ConnectionService` + FCM (separate track)

## Privacy

VoIP pushes carry **callId + display name + line ids only** — no SDP/media. Audio stays WebRTC DTLS-SRTP after answer. See `docs/privacy-security.md`.
