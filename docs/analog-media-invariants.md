# Analog media invariants (PhoneHome bridged)

Paying-customer analog and softphone↔analog calls **must** follow these rules. They are enforced in code (`bridged/src/analogMedia.mjs`), unit tests (`analogMediaInvariants.test.mjs`), and post-deploy smoke (`deploy/phonehome-media-smoke.sh`).

## Hard rules

| # | Rule | Why |
|---|------|-----|
| 1 | **Plain `mixing` bridge only** for 1:1 HT801 legs | `proxy_media` / `native_rtp` broke home HT801 uplink (Alex tx≈1) while remote↔remote looked fine |
| 2 | **Bridge join before `answer()`** on every FXS leg | HT801 SDES wedges if answered with no mix peer → one-way silence |
| 3 | **No `channel.play` on a softphone↔ATA FXS leg once ExternalMedia exists, and no bridge prompt before the mix** | Playback on the FXS channel wedges HT801 SDES (`fxsIn` freezes) and leaks full-scale audio to WebRTC. Softphone→ATA **"Call from {name}"** as bridge playback before the mix buzzed every call (Oct 3, removed in `d29244e`; again Oct 4: handset-side frames 86–99.9% active vs 17–32% without it, `call_u33f8zIAcP`). The softphone→ATA handset prompt is instead caller PCMU from the bridge's 20 ms pacer after the mix is armed (`handsetPrompt.mjs`, per line via `HANDSET_CALLER_ANNOUNCE`); Asterisk plays nothing on that leg. Pre-ring early-media **"Calling {name}"** (skipAnswer, finished before any far end rings) is required. ATA↔ATA may still announce "Call from" after both legs are answered. **"Call ended"** is bridge playback after the mix is stopped, then immediate BYE — never `channel.play` on the FXS leg. |
| 4 | **UDP UnicastRTP ExternalMedia** for softphone↔ATA | `chan_websocket` killed home uplink after ~25 RTP packets in lab |
| 5 | **Prep ExternalMedia while FXS rings; join on pickup; arm send after join** | Unbridged injection ages the RTP path (one packet after pickup) |

## Call topologies

### ATA ↔ ATA

1. Early-media **"Calling {name}"** on the caller (`announceDialingOnFxs`, skipAnswer) — finishes before any ring
2. Caller ringback (`channel.ring()`)
3. `createOneToOneBridge`
4. `originateFxsPeerWaitPickup` — **no answer**
5. `addLegsToBridge(caller, callee)`
6. `answerChannelsAfterBridgeJoin([caller, callee])`
7. **"Call from {name}"** on the callee only
8. When one side hangs up after the call is up, bridge playback **"Call ended"** to the handset still off-hook, then BYE (dialtone)

### Softphone → ATA

1. `originateFxsPeerWaitPickup` + `attachExternalMedia(null)` in parallel while FXS rings
2. On pickup: `attachExternalMedia(dest)` joins FXS + ExternalMedia
3. `answerChannelsAfterBridgeJoin([dest])`
4. `armExternalMediaMix(session)` — bidirectional RTP immediately, **no Asterisk playback**
5. If `HANDSET_CALLER_ANNOUNCE` covers the line (default `all`; `off` or a comma list of extensions limits it): `startHandsetCallerPrompt` sends **"Call from {name}"** (Piper, rendered while the handset rings; 200 ms lead-in, ~1.3 s, −6 dBFS peak) through the pacer in place of the softphone mic, then the mic resumes. Skipped if the render is not ready 1 s after pickup.
6. Softphone hangup after connect: bridge playback **"Call ended"** (mix stopped, hold/MOH cleared), then BYE the FXS leg

### ATA → Softphone

1. Early-media **"Calling {name}"** on the caller — finishes before any ring
2. Caller ringback; WebRTC offer to softphone
3. `attachExternalMedia(caller)` joins FXS + ExternalMedia when softphone media ready
4. `answerFxsWhenMediaReady` — answers caller **after** mix + uplink gate
5. `armExternalMediaMix(session)` — bidirectional RTP, no further FXS playback
6. Softphone hangup after connect: same **"Call ended"** bridge playback, then BYE

## What not to do

- Do not share one `originate()` helper that calls `answer()` — ATA↔ATA and softphone↔ATA need the same **wait pickup, defer answer** shape.
- Do not “fix cousin SSRC” with `proxy_media` on the shared ATA↔ATA path — home LAN ATAs (`bind_rtp_to_media_address`) fail differently.
- Do not move the handset prompt to `bridge.play` / `channel.play`, start it before `armExternalMediaMix`, or queue it alongside mic frames (two sources on one SSRC garble the stream).
- Do not merge media experiments in one commit without running `npm test` in `bridged/` and `./deploy/phonehome-media-smoke.sh`.

## Verification

```bash
cd bridged && npm test
./deploy/phonehome-media-smoke.sh
```

After lab deploy, place **home↔home** and **softphone↔home** test calls; bridge logs should show `sustained=yes` on `ATA↔ATA RTP summary` and bidirectional RTP on softphone summaries. With the handset prompt on, softphone→home also logs `handset caller prompt call=… frames=N`, and handset-side activity (`fxsActive` / `fxsIn`) stays in the normal 15–35% range; the old prompt's buzz showed 86–99.9%.
