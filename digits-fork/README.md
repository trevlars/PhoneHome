# Digits soft-fork scope

Upstream: [justinlindh/digits](https://github.com/justinlindh/digits) (AGPL-3.0).

## What we keep from Digits

- Household / line / invite mental model
- Parent web management (allowlists, pairing ethos)
- E2EE WebRTC media (server not in audio path)
- Self-host Docker / appliance path
- Outbound-friendly device story

## What Stage 1 implements here (trevlars)

This repo’s `server/` + `web/` are a **Digits-inspired Stage 1 softphone trunk**:

| Digits | PhoneHome Stage 1 |
| --- | --- |
| `signald` (Go) + Postgres | Node signaling + SQLite (lab-friendly) |
| `digitsd` on Pi Zero handsets | **Browser softphone** line type |
| Vintage phone PCBs | Deferred to Stage 2 |
| Magic-link SMTP auth | Setup codes (offline-friendly) |

## Line types (locked)

| Type | Stage | Notes |
| --- | --- | --- |
| `softphone` | 1 | Browser / future native app |
| `ata` | 2 | Grandstream HT801/HT802 via SIP↔gateway |
| `bt_handset` | 2 | HFP audio + BLE buttons; brain is phone app |
| `hub_fxs` | 2 | Built-in SLIC on Home Hub |
| `wifi_handset` | later | WiPhone-class |

## Future Digits soft-fork steps

1. Vendor or submodule Digits `server/` under `digits-fork/upstream/` when merging features.
2. Add official **softphone** client class next to `digitsd`.
3. Preserve AGPL: publish modifications to signald/web if distributing.
4. Hub-to-Hub federation remains our delta (Digits is one-signald multi-household today).

## Non-goals for fork

- Requiring vintage Digits handset builds for customers
- Replacing Stage 1 softphone MVP with Go rewrite before softphone UX is proven
