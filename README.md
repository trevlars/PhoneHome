# PhoneHome

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Node 20+](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)
[![Mothership release](https://github.com/trevlars/PhoneHome/actions/workflows/mothership-release.yml/badge.svg)](https://github.com/trevlars/PhoneHome/actions/workflows/mothership-release.yml)
[![GitHub release](https://img.shields.io/github/v/release/trevlars/PhoneHome?include_prereleases)](https://github.com/trevlars/PhoneHome/releases)

**The home phone, reborn.** A private, parent-controlled voice network for kids and extended family — Digits-inspired, self-hostable, encryption-first.

One **Mothership** (always-on server) hosts many **Pods** (families). Each parent curates **Circles** (who their kids can call). Cousins join with your HTTPS link + invite code — **no VPN, no carrier plan, no random internet dialing**.

| | |
| --- | --- |
| **Repo** | [github.com/trevlars/PhoneHome](https://github.com/trevlars/PhoneHome) |
| **License** | [AGPL-3.0-or-later](LICENSE) (Digits-compatible ethos) |
| **Status** | Stage 1 shipped — softphones + analog HT801 lab path; iOS shell in progress |
| **Releases** | [Mothership download bundles](https://github.com/trevlars/PhoneHome/releases) (macOS / Linux / Windows) |

> **Naming:** Product and GitHub repo are **PhoneHome**. Lab deploy paths (`/opt/kids-landline`, `kids-landline.service`, CT hostname) are legacy host names and stay as-is so production boxes don't break.

---

## Why PhoneHome?

Kids need a way to call grandma, cousins, and school friends' parents — without handing them a smartphone, a public number, or an unmoderated chat app.

PhoneHome gives parents:

- **Allowlist-only calling** — mutual approval before anyone rings
- **Parent rules** — Quiet Time, daily caps, household Timeout (kill switch), Parent PIN
- **Kid-friendly phones** — big speed-dial pads, TreeHouse hangout rooms, grandparent-simple mode
- **Real house phones** — Grandstream HT801 analog adapter (SIP TLS + SRTP)
- **Your server** — one Mothership per extended-family network; you host, you control

Inspired by [Digits](https://github.com/justinlindh/digits) (AGPL-3.0). Fork alignment: [`docs/digits-fork-scope.md`](docs/digits-fork-scope.md).

---

## How it fits together

```
                    ┌─────────────────────────────────────┐
                    │           Mothership                │
                    │   (your always-on PhoneHome server) │
                    │   signaling · invites · rules · DB  │
                    └──────────────┬──────────────────────┘
                                   │
           ┌───────────────────────┼───────────────────────┐
           │                       │                       │
     ┌─────▼─────┐           ┌─────▼─────┐           ┌─────▼─────┐
     │  Pod A    │           │  Pod B    │           │  Pod C    │
     │ (Smiths)  │           │ (Joneses) │           │ (Grandma) │
     └─────┬─────┘           └─────┬─────┘           └─────┬─────┘
           │                       │                       │
     Mom's Circle            Dad's Circle            GP Circle
     Kid speed dials         Kid speed dials         Dial 1 = grandkid
           │                       │                       │
     ┌─────▼───────────────────────▼───────────────────────▼─────┐
     │  Leaves — softphones (PWA / iOS) · HT801 wall phones     │
     └──────────────────────────────────────────────────────────┘
```

**Terms:** full definitions in [`docs/glossary.md`](docs/glossary.md).

| Term | Plain English |
| --- | --- |
| **Mothership** | The server — one per extended-family network |
| **Pod** | One household (Mom/Dad + kids) on that Mothership |
| **Circle** | A parent's approved contacts for their kids |
| **Leaves** | Phones on the network (app or analog) — not the server |
| **TreeHouse** | Kid hangout voice room (pad **0** / **1**) |
| **FamilyRoom** | Mixed family talk room (pad **#**) |

Most parents **join** someone else's Mothership as a new Pod. You only run a Mothership if you're the "family IT person."

---

## What's in Stage 1 (shipped)

### For kids & parents

- Mobile-first **PWA softphone** — speed dial, themes, Add to Home Screen
- **Invite flow** — 6-digit code, 48h, single-use; cousins need URL + code only
- **Mutual allowlist** — both sides approve before calls connect
- **Parent controls** — Quiet Time (Bedtime / School / custom + US holiday skip), daily talk cap, Timeout, Parent PIN, Activity log
- **Voicemail / leave-a-message** — audio inbox after missed calls
- **TreeHouse & FamilyRoom** — household voice rooms with parent listen-only (audited, never silent)
- **Grandparent mode** — large buttons, plain language, parent-provisioned accounts
- **Co-parent invites** — share household management

### For hosts

- **Self-host Mothership** — Mac / Linux / Windows background service or Docker
- **[Download bundles](https://github.com/trevlars/PhoneHome/releases)** — no Git or Node install required
- **HTTPS + TURN** guides — Cloudflare Tunnel, Caddy, coturn
- **HT801 analog path** — FreePBX sync, one-tap provision, SIP TLS + SRTP forced
- **Invite card PDF** — [`deploy/invite-card.html`](deploy/invite-card.html) for printing QR + code for relatives

### In progress

- **iOS native shell** ([`mobile/`](mobile/)) — Capacitor + CallKit/PushKit (opt-in lock-screen answer). See [`docs/native-ios-callkit.md`](docs/native-ios-callkit.md).

### Planned (not Stage 1)

| Stage | Focus |
| --- | --- |
| **Stage 2** | Home Hub hardware, Bluetooth landline SKU, phone-as-soft-hub |
| **Stage 3** | Mothership↔Mothership federation, optional PSTN / 911 |

Details: [`docs/family-mesh.md`](docs/family-mesh.md), [`docs/hub-hardware-brief.md`](docs/hub-hardware-brief.md).

---

## Privacy & encryption (product pillar)

Kids' and families' conversations are the product. **Encryption and security are not optional extras** — they are a release pillar.

| Surface | Baseline |
| --- | --- |
| Softphones | HTTPS + WebRTC **DTLS-SRTP** (server brokers ring/setup; no call-audio archive by default) |
| Analog ATA (HT801) | **SIP TLS + SRTP** — cleartext public SIP/RTP is not a supported path |
| Who can call | Allowlists, invites, quiet hours, kill switch |
| Call recording | Off by default; not in Stage 1 |

Doctrine, threats, and contributor rules:

- [`docs/privacy-security.md`](docs/privacy-security.md)
- [`docs/threat-model.md`](docs/threat-model.md)
- [`SECURITY.md`](SECURITY.md)

---

## Get started

### Parents — download a Mothership (easiest)

**No Git or Node.js required.**

1. Download your OS bundle from **[GitHub Releases](https://github.com/trevlars/PhoneHome/releases)**.
2. Run the installer (`Install PhoneHome Mothership.command` on Mac, `install-mothership.sh` on Linux, `install-mothership.ps1` on Windows).
3. Set a **public HTTPS URL** during setup (Cloudflare quick tunnel is the fastest path).
4. Open that URL on your phone → enter the **Mothership setup code** → create your Pod → invite family.

Full guide: **[`docs/download-mothership.md`](docs/download-mothership.md)** · **[`docs/self-host.md`](docs/self-host.md)**

| OS | Archive |
| --- | --- |
| Mac (Apple Silicon) | `phonehome-mothership-v*-darwin-arm64.tar.gz` |
| Mac (Intel) | `phonehome-mothership-v*-darwin-x64.tar.gz` |
| Linux x64 | `phonehome-mothership-v*-linux-x64.tar.gz` |
| Linux ARM64 (Pi) | `phonehome-mothership-v*-linux-arm64.tar.gz` |
| Windows | `phonehome-mothership-v*-win-x64.zip` |

**Share with cousins:** your HTTPS URL + invite code. Print a card from [`deploy/invite-card.html`](deploy/invite-card.html).

### Developers — run from source (lab)

**Requirements:** Node.js **20+**, npm

```bash
git clone https://github.com/trevlars/PhoneHome.git
cd PhoneHome
npm install
npm run build
npm run start
```

Open **http://localhost:8787**. On first boot the Mothership prints a **setup code** (also written to `data/HOST_CODE.txt`).

**Smoke test (two browsers):**

1. Parent A: sign in with setup code → create household → add softphone → **Invite family**
2. Parent B: register (private window) → redeem invite → add softphone
3. Both: allowlist each other's lines → **Call**

For cousins off-LAN, you need HTTPS. Quick tunnel:

```bash
cloudflared tunnel --url http://127.0.0.1:8787
# set PUBLIC_BASE_URL to the printed https://….trycloudflare.com URL
```

Lab runbook: [`lab/README.md`](lab/README.md) · smoke checklist: [`lab/SMOKE.md`](lab/SMOKE.md)

### Install as a background service (from git)

```bash
./deploy/phonehome-init.sh    # writes ~/.phonehome/phonehome.env
./deploy/install-service.sh   # LaunchAgent / systemd / Windows task
```

**Analog (HT801):** after init, run [`deploy/setup-analog.sh`](deploy/setup-analog.sh) and [`deploy/install-freepbx-sync.sh`](deploy/install-freepbx-sync.sh) — see [`docs/self-host.md`](docs/self-host.md) and [`docs/ht801-lab.md`](docs/ht801-lab.md).

---

## iOS app

Capacitor shell around the PWA for notifications and optional CallKit lock-screen answer.

```bash
# from repo root
npm run build -w web
cd mobile && npm install && npx cap sync ios && npx cap open ios
```

Bundle id: `app.phonehome.ios` · Docs: [`docs/native-ios-callkit.md`](docs/native-ios-callkit.md) · [`mobile/README.md`](mobile/README.md)

Default: **in-app calling** (tap notification → Answer in PhoneHome). Lock-screen CallKit is opt-in under Parent → This phone.

---

## Documentation

| Doc | Topic |
| --- | --- |
| [`docs/glossary.md`](docs/glossary.md) | Mothership, Pod, Circle, Leaves |
| [`docs/self-host.md`](docs/self-host.md) | Full Mothership install (HTTPS, TURN, FreePBX, Docker) |
| [`docs/download-mothership.md`](docs/download-mothership.md) | Release bundles for parents |
| [`docs/parent-ux.md`](docs/parent-ux.md) | Onboarding, Parent panel, grandparent mode |
| [`docs/portal-spec.md`](docs/portal-spec.md) | Stage 1 feature parity + API surface |
| [`docs/family-mesh.md`](docs/family-mesh.md) | Invites, TreeHouse, federation roadmap |
| [`docs/privacy-security.md`](docs/privacy-security.md) | Encryption pillar |
| [`docs/threat-model.md`](docs/threat-model.md) | Threats and non-goals |
| [`docs/native-ios-callkit.md`](docs/native-ios-callkit.md) | iOS CallKit + PushKit |
| [`docs/ht801-lab.md`](docs/ht801-lab.md) | Grandstream HT801 analog lab |
| [`docs/hosting.md`](docs/hosting.md) | Proxmox / VPS notes |
| [`docs/listen-in-future.md`](docs/listen-in-future.md) | Future listen-in constraints |
| [`docs/hub-hardware-brief.md`](docs/hub-hardware-brief.md) | Stage 2 hardware SKUs |
| [`docs/digits-fork-scope.md`](docs/digits-fork-scope.md) | Digits alignment path |
| [`SECURITY.md`](SECURITY.md) | Vulnerability reporting |

---

## Repo layout

| Path | Role |
| --- | --- |
| [`server/`](server/) | Mothership — signaling, REST API, WebSocket, SQLite, APNs, FreePBX sync |
| [`web/`](web/) | Parent PWA / softphone UI |
| [`mobile/`](mobile/) | Capacitor iOS app + CallKit plugin |
| [`deploy/`](deploy/) | Init scripts, service installers, Docker Compose, Mothership bundles, invite card |
| [`docs/`](docs/) | Specs, glossary, self-host, privacy, threat model |
| [`bridged/`](bridged/) | SIP↔WebRTC bridge notes (live with FreePBX) |
| [`hardware/`](hardware/) | Stage 2 HW stubs (hub, satellite, bt-landline) |
| [`hub-os/`](hub-os/) | Future appliance image notes |
| [`digits-fork/`](digits-fork/) | Soft-fork scope vs upstream Digits |
| [`lab/`](lab/) | Lab runbook and smoke tests |

---

## Development

```bash
npm run dev          # server with watch
npm run dev:web      # web assets watch
npm run build        # web + server
npm test             # server tests
npm run lab          # build web + start server
```

| Script | Purpose |
| --- | --- |
| `npm run phonehome:init` | Write `~/.phonehome/phonehome.env` |
| `npm run phonehome:install` | Install background service |
| `npm run phonehome:analog` | Analog / FreePBX setup helper |
| `npm run serve` | Supervisor (hub + bridge) |

**Mothership scale defaults** (override in `phonehome.env`): sweet spot ~5–25 Pods / ~50–150 lines; hard cap 50 Pods / 250 lines. See [`docs/glossary.md`](docs/glossary.md#how-big).

---

## Contributing & security

PhoneHome is early but real — family-tested softphone flows, analog lab path, and self-host tooling.

- **Security issues:** do not open public GitHub issues with exploit detail. See [`SECURITY.md`](SECURITY.md).
- **Privacy regressions:** read [`docs/privacy-security.md`](docs/privacy-security.md) before PRs that touch transports, logging, or ATA config.
- **Cursor / agent rules:** [`.cursor/rules/privacy-security-pillar.mdc`](.cursor/rules/privacy-security-pillar.mdc) encodes non-negotiables for automated contributors.

---

## License

**AGPL-3.0-or-later** — same family as upstream [Digits](https://github.com/justinlindh/digits) (`justinlindh/digits`, AGPL-3.0).

Maintained by [trevlars](https://github.com/trevlars).
