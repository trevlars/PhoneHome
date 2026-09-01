# Self-host your Mothership

Run your circle’s **Mothership** — the always-on PhoneHome server at home (like a private Minecraft realm for family voice). You keep household data on your box; softphone call audio stays encrypted peer-to-peer (WebRTC). Analog (HT801) adds FreePBX on your LAN or a nearby VM.

**Terms:** [`glossary.md`](./glossary.md) — *PhoneHome* = product, *Mothership* = your server.

**Privacy pillar:** [`privacy-security.md`](./privacy-security.md) — no cleartext public SIP, HTTPS required off-LAN.

## Who should host?

| Host | Good for |
| --- | --- |
| **Always-on home PC / Mac / Linux** | Parents who want “install and forget” — background service |
| **Raspberry Pi / NUC / mini PC** | Low-power 24/7 Mothership |
| **Proxmox LXC / VPS** | Power users; see also [`hosting.md`](./hosting.md) (lab notes) |

Each family (or friend group) runs **one Mothership** per circle. Cousins join with your **HTTPS URL + invite code** — no VPN.

## What you install

| Piece | Role | Required? |
| --- | --- | --- |
| **PhoneHome hub** | Signaling on the Mothership | Yes |
| **Bridge** | FreePBX ARI ↔ WebRTC / HT801 | Yes for analog; runs with hub |
| **HTTPS** | Mic + sessions on phones | Yes for remote users |
| **coturn (TURN)** | Cross-NAT softphone calls | Strongly recommended |
| **FreePBX** | SIP registrar for HT801 | Only for analog landline |
| **Reverse proxy** | Caddy, Traefik, Cloudflare Tunnel | Yes (or tunnel URL) |

## Fast path — background app (macOS / Windows / Linux)

Best for parents: one setup, runs at login, no terminal after that.

### 1. Prerequisites

- **Node.js 20+** ([nodejs.org](https://nodejs.org))
- **Git** clone of this repo
- A **public HTTPS URL** (pick one):
  - **Cloudflare Tunnel** (easiest, no port forward): `cloudflared tunnel --url http://127.0.0.1:8787`
  - **Your own domain** + Caddy/nginx on `:8443` → `127.0.0.1:8787`
  - Router DDNS + port forward (see [Ports](#ports-to-forward))

### 2. Build & configure

```bash
git clone https://github.com/trevlars/PhoneHome.git
cd PhoneHome
npm install
npm run build
chmod +x deploy/phonehome-init.sh deploy/install-service.sh
./deploy/phonehome-init.sh
```

`phonehome-init.sh` writes:

- `~/.phonehome/phonehome.env` — `PUBLIC_BASE_URL`, `SIP_PUBLIC_HOST`, TURN, etc.
- `~/.phonehome/bridge.env` — ARI + `BRIDGE_SECRET`

On Linux as root / server install, data defaults to `/var/lib/kids-landline`.

### 3. Install background service

```bash
./deploy/install-service.sh
```

| OS | What it installs |
| --- | --- |
| **macOS** | LaunchAgent `com.phonehome.server` — starts at login, restarts on crash |
| **Linux** | systemd **user** service `phonehome.service` |
| **Windows** | Scheduled Task **PhoneHome** at logon |

```powershell
# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File deploy\windows\install-service.ps1
```

Both hub and bridge run via `deploy/phonehome-supervisor.mjs` (one parent-friendly process).

**Linux tip:** `sudo loginctl enable-linger $USER` so PhoneHome keeps running after you log out.

### 4. HTTPS URL

Set `PUBLIC_BASE_URL` to whatever parents open on phones, e.g. `https://abc123.trycloudflare.com` or `https://phonehome.yourname.net:8443`.

If the URL changes (new tunnel), edit `phonehome.env` and restart the service.

### 5. First parent

1. Open **PUBLIC_BASE_URL** on your phone.
2. **Mothership setup** with code from `~/.phonehome/HOST_CODE.txt` (or log on first boot).
3. Create household → softphone → **Invite family**.

---

## Full stack — analog phone (HT801)

Softphones work after steps above. For a **real RJ11 handset** you need FreePBX + port forwards.

### FreePBX (separate VM recommended)

1. Install [FreePBX](https://www.freepbx.org/) on a VM, LXC, or second machine on your LAN.
2. Enable **ARI**: Settings → Asterisk REST Interface — user `phonehome`, app `phonehome` (password from `bridge.env`).
3. Deploy PhoneHome FreePBX overlays from `bridged/freepbx/` (see [`ht801-lab.md`](./ht801-lab.md)).
4. **Auto-provision extensions** (required — do not skip):

```bash
# On FreePBX as root (token from phonehome-init.sh):
FREEPBX_SYNC_TOKEN=<token> PHONEHOME_HOST_IP=<PhoneHome LAN IP> ./deploy/install-freepbx-sync.sh
```

This installs `phonehome-freepbx-syncd` on port **8797**. Parent → Analog Phone → **Save** creates the PJSIP extension automatically.

5. Run the checklist:

```bash
./deploy/setup-analog.sh
```

Set in `phonehome.env`:

```bash
SIP_PUBLIC_HOST=phonehome.yourname.net    # same hostname as HTTPS (Let's Encrypt on SIP TLS)
SIP_SERVER=10.0.0.50                      # FreePBX LAN IP
```

Set in `bridge.env`:

```bash
ARI_URL=http://10.0.0.50:8088
EXT_MEDIA_HOST=10.0.0.51                  # PhoneHome host LAN IP (where bridge listens)
```

### SIP TLS certificate

Reuse your HTTPS Let's Encrypt cert on FreePBX SIP TLS (`deploy/sync-phonehome-sip-cert.sh`). ATAs must register to your **FQDN** on **TCP 5061** with cert validation on.

### Ports to forward

Forward on your router to the correct internal host:

| Port | To | Purpose |
| --- | --- | --- |
| **TCP 8443** (or 443) | PhoneHome / Caddy | HTTPS app |
| **UDP+TCP 3478** | coturn host | TURN |
| **UDP 49160–49200** | coturn host | TURN media |
| **TCP 5061** | FreePBX (or SIP TLS proxy) | ATA signaling (TLS only) |
| **UDP 10000–10200** | FreePBX | SRTP audio |

Do **not** forward UDP 5060 (cleartext SIP) — not a supported production path.

### HT801 setup

- **Same LAN as PhoneHome:** Parent UI → Analog Phone → **Set up adapter** (one-tap).
- **Cloud / VPS host:** set `ATA_LAN_PUSH=0` — use **Download config** only.
- **Remote adapter:** must reach `SIP_PUBLIC_HOST:5061` through your forwards.
- **Kid handset keypad:** **0** = TreeHouse · **1** = Home/parent · **2–9** = speed dial · **\*98** = Messages

### Invite cousins

Open **`deploy/invite-card.html`** in a browser, enter your `PUBLIC_BASE_URL` + invite code, **Print / Save PDF**.

---

## Docker (full stack minus FreePBX)

FreePBX stays on a VM; Docker runs hub + bridge + optional TURN/Caddy.

```bash
cp deploy/phonehome.env.example deploy/.env
# Edit deploy/.env — set PUBLIC_BASE_URL, ARI_URL, BRIDGE_SECRET, TURN_*
docker compose -f deploy/docker-compose.full.yml --env-file deploy/.env up -d --build
docker compose -f deploy/docker-compose.full.yml --profile turn --profile https up -d
```

Generate `BRIDGE_SECRET` once and put it in `.env` and ensure the hub container sees it (copy `bridge.env` into the data volume or set in `.env`).

---

## Environment reference

| Variable | Meaning |
| --- | --- |
| `PUBLIC_BASE_URL` | HTTPS origin for invites and the app (required off-LAN) |
| `SIP_PUBLIC_HOST` | Hostname in HT801 configs (defaults from `PUBLIC_BASE_URL`) |
| `SIP_SERVER` | FreePBX LAN address |
| `DATA_DIR` | SQLite + `HOST_CODE.txt` |
| `TURN_URLS` / `TURN_USERNAME` / `TURN_CREDENTIAL` | coturn for cross-NAT calls |
| `ATA_LAN_PUSH` | `1` home LAN; `0` cloud/VPS |
| `BRIDGE_SECRET` | Shared by hub + bridge (auto-generated by init) |

Templates: `deploy/phonehome.env.example`, `deploy/bridge.env.example`.

---

## Changing your public URL

1. Update DNS / tunnel / Caddy.
2. Edit `phonehome.env`: `PUBLIC_BASE_URL` and usually `SIP_PUBLIC_HOST`.
3. Restart PhoneHome service.
4. Re-download or push HT801 configs if analog.
5. Re-share invites — old LAN-only bookmarks won’t carry sessions.

No hardcoded hostnames in the app — everything reads from your env files.

---

## Connecting two Motherships (future)

Stage 1: one Mothership, all households on it. **Stage 3** (planned): Mothership↔Mothership federation via `peer_servers` — each circle keeps its own database; see [`family-mesh.md`](./family-mesh.md).

Optional future **connectivity helper** = TURN/rendezvous only, not household data.

---

## Troubleshooting

```bash
# Health
curl -sS http://127.0.0.1:8787/api/health
curl -sS http://127.0.0.1:8790/health

# macOS logs
tail -f ~/.phonehome/phonehome.log

# Linux
journalctl --user -u phonehome -f

# Analog line (Proxmox lab)
./deploy/phonehome-doctor.sh
```

| Symptom | Check |
| --- | --- |
| Mic blocked | Must use **HTTPS** `PUBLIC_BASE_URL`, not `http://LAN:8787` |
| Ring, no audio (softphone) | TURN ports + `TURN_*` in `phonehome.env` |
| Ring, no audio (ATA) | RTP forwards 10000–10200; `rtp show settings` on FreePBX |
| ATA “Working” but dead | Run `phonehome-doctor.sh`; SIP secret drift |

---

## Related

| Doc | Topic |
| --- | --- |
| [`hosting.md`](./hosting.md) | trevlars lab topology (eero, Proxmox CTs) |
| [`ht801-lab.md`](./ht801-lab.md) | HT801 + FreePBX procedure |
| [`family-mesh.md`](./family-mesh.md) | Invites, TreeHouse, federation plan |
| [`privacy-security.md`](./privacy-security.md) | Encryption pillar |
