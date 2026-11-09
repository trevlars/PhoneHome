# Phone Soft-Hub mode (Stage 2+)

## Idea

Parent phone app provisions ATA/BT and **is** the signaling brain while on home Wi‑Fi (Android-first). Availability tracks that phone being home + app allowed to run.

## Modes

| Mode | Brain | Kid endpoint |
| --- | --- | --- |
| A Always-on Hub | Pi | ATA / FXS / softphone |
| B Phone Soft-Hub + ATA | Android app | Grandstream SIP → app |
| C Hybrid | Hub | App is remote control |
| D Soft-Hub + BT | Phone app | BT HFP handset |

## Platform

| Platform | Soft-hub |
| --- | --- |
| Android | Foreground service; SIP registrar or WS trunk client |
| iOS | Prefer Mode D (BT + CallKit); weak as SIP server |

## UX requirements

- Clear **“hub phone offline”** state — never silent dead air.  
- Same allowlist / invite APIs as Stage 1 web.  
- Auto-select BT device as kids-line audio when paired.

## Stage 1 relationship

Stage 1 proves invites + WebRTC on a **shared server**. Soft-hub reuses those APIs with the phone hosting a slim brain later.
