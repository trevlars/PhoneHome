# Apple Watch — kid speed dial

**Status:** Not started. Spec only (Oct 2026). Do not start the pad UI until the media spike below passes on a physical watch.

This is a **kid calling endpoint**, not a parent remote and not the Capacitor softphone moved onto the wrist.

## Decision

The watch exists so a child with **Apple Watch For Your Kids** (cellular, no iPhone nearby) can call **house phones**: a younger sibling’s HT801, or a friend’s analog line. The bridge already treats that as a softphone ↔ ATA call ([`analog-media-invariants.md`](./analog-media-invariants.md)). The watch is another encrypted leaf. Allowlist, Quiet Time, and Timeout stay on the server.

A button that hands the call to a nearby iPhone misses the product. Those watches are not paired to a phone in the kid’s pocket. Wi-Fi-only is a weak version: calling from school or a friend’s house needs the watch’s own cellular plan. The first spike may run on a paired watch over Wi-Fi. The ship target is still Family Setup, away from the parent iPhone.

## Who it is for

- Child line, not a parent session.
- Parent installs and signs the kid in once. Credentials live in the watch Keychain.
- The app must place and receive calls with **no iPhone in Bluetooth range**. Do not depend on WatchConnectivity for signaling or media. WatchConnectivity is fine for optional setup help from the parent phone. It is not the call path.

## What the kid sees

The phone pad, cut down. Two to four **full-width** faces (photo + name), in existing speed-dial order. Digital Crown scrolls if the stack is taller than the screen. One tap calls. No keypad, no recents, no search, no TreeHouse, no FamilyRoom, no Parent, no themes, no PIN pad.

**Who appears**

- Default: that child’s Circle contacts whose line has a working ATA (`line.ata` on the same payload the phone already uses).
- Cap at 4. The iPhone pad is the editor. Do not build a contact browser.
- A later parent control may pin an existing Circle softphone onto this pad. That is a display flag on the current allowlist row, **not** a second allowlist. Do not build the flag until outbound and inbound audio work.

**Policy blocks**

Quiet Time and Timeout do not ring the house phone. Show the face disabled with the existing reason (Bedtime, School, Timeout, daily cap). Reuse the server’s unavailable-voice phrases. Do not invent a watch-only copy, and do not start a CallKit session that originates the ATA leg.

**During a call**

Short 1:1 only. Watch speaker or already-connected AirPods. No audio-route screen. No rooms. A watch will get hot, and the speaker is a room announcement.

**Inbound is required**

The kitchen phone must be able to dial this kid back. Outbound-only is a one-way intercom and is not done.

## Call path

Same topologies as today:

- Watch → ATA: softphone → ATA in [`analog-media-invariants.md`](./analog-media-invariants.md) (ExternalMedia, mixing bridge, announce rules).
- ATA → watch: ATA → softphone.

Media is **DTLS-SRTP** into that mix. Cleartext RTP, public SIP UDP 5060, and a “simpler” watch audio hop are not allowed ([`privacy-security.md`](./privacy-security.md)). Do not log SIP passwords, SRTP/DTLS keys, or SDP crypto lines.

watchOS allows the UDP a realtime call needs **only while CallKit has an active call** ([TN3135](https://developer.apple.com/documentation/technotes/tn3135-low-level-networking-on-watchos)). BSD sockets are unavailable. Use Network framework during the CallKit session. `URLSession` is fine for login and the directory. Do not open the signaling WebSocket for presence.

This is a **native** watchOS target (SwiftUI + CallKit + PushKit). Do not load `web/` in a watch webview. The iOS app stays Capacitor (`app.phonehome.ios`).

### Push

`push_devices` already allows more than one `platform = 'ios'` token per line (`server/src/pushDevices.ts`). A watch token must **not** replace the iPhone token.

The watch has its own bundle id and its own VoIP topic. Do not send `app.phonehome.ios.voip` pushes to a watch token. Add a distinct platform (for example `watchos`) and topic. The existing APNs `.p8` can stay the team key. v1 may ring both a registered iPhone and the watch for that line. Do not design fork/join logic beyond “wake each registered token.”

## Spike gate

Do this before any pad UI, complication, or parent-remote work. Physical Apple Watch only — the Simulator cannot prove speaker audio, CallKit, or the HT801.

1. New watchOS app target, runs a CallKit call without the iPhone nearby (Wi-Fi off on the phone, not Control Center).
2. During that call, DTLS-SRTP to the lab bridge. One outbound call rings a lab HT801. Two-way audio. Hangup tears the bridge down (no stuck FXS, no one-way audio). Obey the analog media invariants. Do not debug around them.
3. Reverse: HT801 dials that kid line. Watch rings (PushKit → CallKit). Answer connects. Decline and timeout do not leave a live bridge.
4. Quiet Time or Timeout on the server: ATA does not ring; watch shows the reason.

If step 2 or 3 fails, stop. The speed-dial product fails with the spike. Write what failed into this doc. Do not ship a UI that only works when the iPhone is in range.

`xcodebuild` one at a time on this Mac (see the iOS build rule). Do not start a second `xcodebuild` while one is running.

## Parent wrist remote (later, different root)

Same target, **different root**. Not part of the spike. Do not merge it into the kid pad.

A parent account on a watch is a remote, not a phone:

- Glance: all quiet, or `{kid} · talking`, or new-message count. Rectangular Smart Stack widget plus small complications. Tap opens the app.
- App page **Now**: live kid calls. One destructive control, **Timeout** (`kill_switch`), with `confirmationDialog`.
- App page **Messages**: count plus a few Activity rows. **Play on iPhone.** No watch audio, no voicemail playback.
- No speed dial, no keypad, no Parent accordion, no PIN editor, no Quiet Time schedule editor.

Double Tap and the Action button must not fire Timeout.

## Do not

- Port the Capacitor / WebRTC-in-WKWebView softphone to watchOS.
- Add cleartext RTP or SIP UDP “because the watch is hard.”
- Put TreeHouse, FamilyRoom, listen-in, recents, or a dial pad on the watch.
- Put parent controls on a kid watch, or kid speed dial on a parent watch.
- Build complications, Live Activities, or the parent remote before the spike.
- Treat “opens the call on the iPhone” as the kid feature.
- Add a second allowlist or a watch-only directory.
- Record or transcribe the call.

## Related

- [`analog-media-invariants.md`](./analog-media-invariants.md) — softphone ↔ ATA rules
- [`native-ios-callkit.md`](./native-ios-callkit.md) — iPhone CallKit / PushKit (do not copy the Capacitor path)
- [`privacy-security.md`](./privacy-security.md) — encryption pillar
- [`parent-ux.md`](./parent-ux.md) — Circle, Quiet Time, Timeout, inbound default when a line also has an ATA
- [`portal-spec.md`](./portal-spec.md) — `GET /api/me`, `PATCH /api/households/:id/rules`, `POST /api/devices/voip-token`
