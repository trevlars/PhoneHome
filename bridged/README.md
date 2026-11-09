# bridged — FreePBX ↔ PhoneHome softphones / HT801 FXS

Lab path: Grandstream **HT801** → FreePBX (CT 121, `192.168.2.105`) → **ARI Stasis** → this process on PhoneHome (CT 122, `192.168.2.106`) → PhoneHome WebSocket / WebRTC **or** another SIP FXS.

## What it does

| Direction | Path |
| --- | --- |
| **ATA → softphone** | Speed-dial → Stasis → `POST /api/bridge/resolve` → WS `call.offer` → ExternalMedia ↔ WebRTC |
| **ATA → ATA** | Same resolve; if target has `ata_devices`, originate `PJSIP/<ext>` and mix SIP↔SIP (no softphone) |
| **Softphone → ATA** | Softphone `call.offer` → PhoneHome claims via `POST bridged:/claim` → originate FXS with CID → Flite “Call from {name}” on answer → WebRTC + ExternalMedia |

1. ATA dials **0** (Home / parent), **1** (TreeHouse), or **2–9** (same contact slots as PhoneHome Home), or **\*98** / bare **\*** for Messages / greeting IVR.
2. FreePBX `extensions_custom.conf` sends the call to `Stasis(phonehome,<digits|vm>)`.
3. Bridge rings the FXS until the softphone answers (ringback), calls resolve (allowlist + `canCall`) — or runs the PhoneHome-backed *98 IVR for `vm`. Then answers + ExternalMedia ↔ WebRTC.
4. If `toSipExtension` is set → originate that FreePBX extension (FXS rings). Else → claim the ATA’s PhoneHome line on `/ws` and place a normal `call.offer`.
5. Softphone calling a line with an HT801: PhoneHome prefers FXS (bridge claims the line, kicks any softphone on that line for v1 clarity).

### *98 Messages / greeting IVR

| Direction | Path |
| --- | --- |
| **ATA → *98** | Stasis `vm` → `POST /api/bridge/mailbox` → play/record via ARI + PhoneHome greeting/VM APIs |

Spoken flow (Piper amy WAVs in `bridged/sounds/`): count first (“You have N new messages” / “no messages”) → **“Press 1 for messages. Press 2 for greetings.”** (once). Does **not** play the personal greeting on entry. Greeting submenu: record / play / clear. Message keys: **4** replay · **7** delete · **9** keep. FreePBX needs `/var/cache/asterisk` writable by `asterisk` so ARI can play PhoneHome WAVs over HTTP. Flite remains only as a missing-clip fallback.

## Prerequisites

- FreePBX ARI enabled (`ari show status` → Enabled: Yes). Lab fix: do **not** redeclare `[general]` in `ari_general_custom.conf`.
- ARI user `phonehome` / password in `/var/lib/kids-landline/bridge.env`.
- PhoneHome `BRIDGE_SECRET` set on both the API (PhoneHome hub / env) and bridge.
- `BRIDGE_URL=http://127.0.0.1:8790` on the PhoneHome hub (softphone→ATA claim).
- HT801 linked in Parent → **Analog Phone / HT801** (extension `2001` in lab).

## FreePBX (CT 121)

```bash
# Merge dialplan (or copy if you have no custom dialplan yet)
pct exec 121 -- bash -lc 'cp /path/to/extensions_custom.conf /etc/asterisk/extensions_custom.conf'
# From PhoneHome host after rsync (files live on CT 122; pull via PVE):
#   pct exec 121 -- bash -lc 'cp /opt/kids-landline/bridged/freepbx/extensions_custom.conf /etc/asterisk/extensions_custom.conf'
# Or from PVE after syncing repo onto 122:
#   pct pull 122 /opt/kids-landline/bridged/freepbx/extensions_custom.conf /tmp/ && pct push 121 /tmp/extensions_custom.conf /etc/asterisk/
# Flite US English voice for phonehome-announce / *98 menus (voice=slt):
#   pct exec 121 -- bash -lc 'cp …/flite.conf /etc/asterisk/flite.conf && asterisk -rx "module reload app_flite.so"'
# Required for *98 message WAV playback (HTTP media cache):
#   pct exec 121 -- bash -lc 'mkdir -p /var/cache/asterisk && chown asterisk:asterisk /var/cache/asterisk && chmod 775 /var/cache/asterisk'
fwconsole reload   # inside CT 121
```

Normal extension dial (e.g. originate `PJSIP/2001`) already rings the HT801 FXS — no extra inbound dialplan beyond stock FreePBX extensions.

Confirm ARI from PhoneHome CT:

```bash
curl -u phonehome:PASSWORD http://192.168.2.105:8088/ari/asterisk/info
# Registration (same signal Home uses):
curl -sS -H "Authorization: Bearer $BRIDGE_SECRET" \
  'http://127.0.0.1:8790/sip-status?ext=2001'
```

HTTP must listen on LAN (`bindaddr=0.0.0.0` in `http_custom.conf` — lab already set).

## PhoneHome CT 122

```bash
cd /opt/kids-landline/bridged && npm install
# /var/lib/kids-landline/bridge.env:
#   BRIDGE_SECRET=long-random
#   ARI_PASS=...
#   BRIDGE_HTTP_PORT=8790
cp /opt/kids-landline/deploy/phonehome-bridge.service /etc/systemd/system/
# Also set BRIDGE_SECRET + BRIDGE_URL on kids-landline.service (EnvironmentFile or drop-in)
systemctl daemon-reload
systemctl enable --now phonehome-bridge
journalctl -u phonehome-bridge -f
```

## Dial tests

### Softphone → kid HT801

1. Parent softphone open (allowlisted to kid line).
2. Kid HT801 registered on FreePBX (`pjsip show contacts` → 2001 Available).
3. Parent dials kid from PhoneHome Home → **FXS rings** → answer → talk.
4. Softphone for the kid does **not** need to be open.

### ATA → ATA (two households)

1. Both HT801s linked + mutual allowlist speed-dial.
2. Household A RJ11 dials speed-dial for household B’s line.
3. Household B FXS rings with **no** softphones open.

### ATA → softphone (no ATA on target)

1. Softphone for the **target** contact open.
2. RJ11 on HT801 → dial `1` → softphone rings.

## Env reference

| Variable | Default | Meaning |
| --- | --- | --- |
| `PHONEHOME_URL` | `http://127.0.0.1:8787` | API base |
| `BRIDGE_SECRET` | (required) | Shared with PhoneHome API |
| `BRIDGE_HTTP_PORT` | `8790` | Local claim API for softphone→ATA |
| `ARI_URL` | `http://192.168.2.105:8088` | FreePBX ARI |
| `ARI_USER` / `ARI_PASS` | phonehome / … | ARI login |
| `EXT_MEDIA_HOST` | `192.168.2.106` | Address FreePBX uses for ExternalMedia RTP |
| `EXT_MEDIA_PORT_BASE` | `14000` | UDP RTP listen base on CT 122 |
| `SIP_ENDPOINT_PREFIX` | `PJSIP` | Originate as `PJSIP/<ext>` |
| `AMI_USER` / `AMI_PASSWORD` | unset | Optional AMI login used **only** to read AOR contacts. Unset → `/sip-status` falls back to ARI endpoint state |
| `AMI_HOST` | ARI host | AMI host, defaults to the same PBX as `ARI_URL` |
| `AMI_PORT` | `5038` | AMI port |
| `AMI_TIMEOUT_MS` | `4000` | Give up on the contact lookup |

## How `/sip-status` decides "registered"

```json
{"ok":true,"registered":true,"callable":true,"state":"online",
 "confidence":"high","method":"ami-contacts","contacts":1,"extension":"2001"}
```

| Field | Meaning |
| --- | --- |
| `registered` | Evidence of a **usable Contact**. Drives the parent "Working" chip and directory presence |
| `callable` | Worth attempting an originate. Drives `/claim`, so an unverifiable check degrades the chip without blocking calls |
| `confidence` | `high` = real contact detail (AMI); `low` = ARI endpoint state only; `none` = inconclusive |
| `method` | `ami-contacts`, `ari-endpoint-state`, or `originate-failure` (the negative cache) |

ARI has no way to list AOR contacts — `endpoints.get` returns only a `state`, and with `qualify_frequency=0` Asterisk reports that state as `online` even when the AOR is **empty**. That is how a fail2ban ban of the SIP TLS proxy hid behind a green "Working" chip (see `docs/ht801-lab.md`). Anything inconclusive — ARI down, AMI error, timeout — returns `registered: false` with `state: "unknown"` so the app says "Can't check" instead of guessing.

AMI is off by default because FreePBX binds AMI to `127.0.0.1` and its generated manager user only permits localhost. To enable it, add a read-only user in `/etc/asterisk/manager_custom.conf` on CT 121, set `bindaddr` to the LAN, reload, then set `AMI_USER`/`AMI_PASSWORD` here. Without it, keep **qualify on the AOR** (`qualify_frequency=60`) so ARI's `online` still means something — `deploy/phonehome-doctor.sh` checks both.

## Audio caveats

**Doctrine:** [`docs/analog-media-invariants.md`](../docs/analog-media-invariants.md) — enforced by `analogMedia.mjs`, `npm test`, and `./deploy/phonehome-media-smoke.sh` (runs automatically before `proxmox-rsync.sh`).

- Softphone ↔ ATA ExternalMedia uses **UDP UnicastRTP** (`EXTERNAL_MEDIA_TRANSPORT` in `analogMedia.mjs`). Do not reintroduce `chan_websocket`.
- Softphone→ATA preps ExternalMedia **while the handset rings**, joins on pickup, answers FXS **after** join.
- ATA ↔ ATA uses `createOneToOneBridge()` (plain `mixing`), `addLegsToBridge()`, then `answerChannelsAfterBridgeJoin()` — never `proxy_media`.
- FreePBX ships with verbosity 0, which hides `SRTP unprotect failed` and per-call bridge technology lines. `bridged/freepbx/logger_logfiles_custom.conf` adds `/var/log/asterisk/phonehome-verbose` (verbose 3) on CT 121 for exactly that evidence.
- Softphone→ATA does not play local ringback over WebRTC while the FXS rings (v1).
