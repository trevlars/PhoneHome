# Kids Landline (trevlars)

Open, Digits-inspired private family voice network. **Stage 1** ships now: a shared signaling server (“Minecraft clubhouse”) plus mobile-friendly **web softphones** with households, invites, allowlists, quiet hours, kill switch, and encrypted WebRTC calls.

Hardware (Grandstream / BT landline / Home Hub) is Stage 2+ — see `docs/`.

## Quick start (lab)

```bash
npm install
npm run build -w web
npm run start -w server
```

Open **http://localhost:8787**. On first boot the server prints a **HOST SETUP CODE** (also written to `data/bootstrap.json`).

1. Parent A: sign in with setup code → create household → add softphone → **Invite family**.
2. Parent B: register (or second browser/profile) → redeem invite → add softphone.
3. Both: allowlist each other’s lines → **Call**.

Cousins need **no VPN** — only the server URL + invite code.

## Host for other parents

Remote phones need **HTTPS**. Run the Stage 1 server on a always-on host (Pi / VPS / Proxmox LXC), then put a Cloudflare Tunnel (or any reverse proxy with TLS) in front. See **`docs/hosting.md`**.

Quick tunnel example (prints a `*.trycloudflare.com` URL):

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

Share that URL + an invite code. Host setup code is printed on first boot (`data/HOST_CODE.txt` or `DATA_DIR/HOST_CODE.txt`).

## Repo layout

| Path | Role |
| --- | --- |
| `server/` | Stage 1 signaling + REST API (SQLite) |
| `web/` | Parent PWA / softphone UI |
| `docs/` | Specs: Digits fork, portal, mesh, Hub, BT, provisioning, prior art |
| `hardware/` | Stage 2 HW stubs (hub, satellite, bt-landline) |
| `hub-os/` | Future appliance image notes |
| `bridged/` | Future SIP↔WebRTC / FXS gateway notes |
| `digits-fork/` | Soft-fork scope vs upstream Digits |
| `lab/` | Lab runbook (softphone + later HT801) |
| `deploy/` | Docker Compose for always-on host |

## Product model

- **Trunk** = this server (you host on Proxmox/VPS/Pi).
- **Leaves** = softphones now; ATA / BT / Hub later.
- **Voice** = WebRTC (DTLS-SRTP); server brokers ring/setup only.
- **GitHub:** [trevlars](https://github.com/trevlars)

## License

AGPL-3.0-or-later (Digits-compatible ethos). Upstream Digits: `justinlindh/digits` (AGPL-3.0).
