# PhoneHome Mothership (HAOS add-on)

Self-hosted PhoneHome for Home Assistant OS.

## Model

- **30-day trial** from first add-on start (same local license checker as Docker).
- After trial: paste a **$25/year** signed license (buy on the PhoneHome website — not in the iOS app).
- You host the family database; PhoneHome does not.

## Networking (honest)

Softphones need **HTTPS** to your mothership (DuckDNS + Caddy, Cloudflare Tunnel, or HA ingress).

**Analog HT801** needs SIP TLS + RTP ranges. This add-on starts with a published API port (`8787`). Full ATA on the same HA box often needs `host_network: true` or a separate FreePBX/Asterisk VM — see [`docs/self-host.md`](../../docs/self-host.md). Do not expect one-click ATA without opening those ports.

## Options

| Option | Purpose |
| --- | --- |
| `host_license` | Paste signed license blob after Stripe |
| `host_license_enforce` | Leave on for production; off only for lab |
| `host_license_buy_url` | Website buy/renew link shown in the UI |
| `public_base_url` | Public HTTPS URL clients use |

## Install

1. Add this repository (or copy `haos/phonehome` into a local add-on path).
2. Install **PhoneHome Mothership**, start it.
3. Open the UI / API, complete first-boot setup.
4. Before day 30: [buy](https://phonehome.pages.dev/buy.html) → paste license in add-on options → restart if needed.

Trial download landing: [`web/src/trial.html`](../../web/src/trial.html). License details: [`docs/host-license.md`](../../docs/host-license.md).
