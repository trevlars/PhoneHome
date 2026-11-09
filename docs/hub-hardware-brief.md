# Home Hub / Grandstream / hardware brief (Stage 2+)

## SKU A — Home Hub (hero, later)

| Item | Choice |
| --- | --- |
| SoC | Raspberry Pi 4 2GB / CM4 class |
| Role | Runs this Stage 1 server image (compose / appliance) |
| FXS | KS0835F or Silvertel AG1171 + codec (ES8388) **or** external HT801 |
| Network | Ethernet preferred + WiFi |
| ESP32 | Optional SLIC co-processor only — not the server |

Target BOM: aim under ~$80–120 prototype.

## SKU B — Grandstream satellite (pragmatic Stage 2)

| Item | Choice |
| --- | --- |
| Device | HT801 (1 FXS) or HT802 (2 FXS) |
| Uplink | Ethernet to router |
| Role | SIP UA → Hub / soft-hub gateway (`bridged/`) |
| Parent UX | Auto-provision from Hub; hide Grandstream admin |

This is the Ring Ring Bridge hardware class.

## SKU C — Integrated SLIC Hub

weeBell / AG1171 reference for custom enclosure when ready.

## Not in Stage 1

No PCB purchase required — softphones only.
