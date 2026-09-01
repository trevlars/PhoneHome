# HT801 ↔ PhoneHome (lab)

## Honest status

| Layer | Status |
| --- | --- |
| HT801 ↔ FreePBX (SIP register / dial) | **Ready** — extension `2001`; public SIP host `y5876647.eero.online` (LAN `10.0.5.105` still works on-site) |
| Easy ATA config from PhoneHome | **Ready** — Parent → Analog Phone (Download config; Config Server Path optional) |
| FreePBX ↔ PhoneHome softphones | **Ready** — `bridged/` ARI Stasis + WebRTC (see `bridged/README.md`) |
| Softphone → kid FXS | **Ready** — bridge claims line, originates `PJSIP/<ext>` with CID; Flite announce on answer |
| ATA → ATA (no softphones) | **Ready** — resolve returns `toSipExtension` + `cidName`/`cidNumber`; announce then SIP↔SIP bridge |
| Parent Home ATA health chip | **Ready** — above dial; setup / offline / can't-check; hides when registered. Status is honest when FreePBX has no usable Contact (not merely a stale Unavail registration). |

## Super-easy parent flow (preferred)

In the app: **Parent → Analog Phone**. The parent phone app can be anywhere. **One-tap / Set up adapter** only works when the **Mothership** at your house shares Wi‑Fi with the HT801 — not because the parent’s phone is on that LAN. Otherwise: plug Ethernet, open the adapter’s web page by IP, **Download config** from the app, upload on the HT801 (from any device that can reach the adapter’s local UI), reboot, plug a phone, dial **0** (TreeHouse), **1** (Home/parent), or **2–9** (speed dial). Contacts stay in PhoneHome (changing a speed dial in the app updates the handset; no re-upload). Config Server Path is optional/advanced.

**SIP extensions are auto-assigned** unique per ATA/line (starting at `2001`) when you save the connection — Gemma and cousins never share a number. PhoneHome also auto-generates the SIP password. Parents cannot edit or override the extension (anti-takeover). On Save (and before Download/push), PhoneHome **creates or updates the matching FreePBX PJSIP extension** via `phonehome-freepbx-syncd` → `phonehome-set-sip-secret` (TLS + SRTP; `rewrite_contact=yes` for remote public SIP hosts, `no` for lab LAN). Manual FreePBX clicking is no longer required for new ATAs.

Lab: child line Gemma / `line_yfGcRwQbNr`; server **`y5876647.eero.online`** (public; requires eero **TCP 5061** + **UDP 10000–10200** → FreePBX — see `docs/hosting.md`).

1. Open PhoneHome → **Parent** → **Analog Phone**.
2. Select the child line (lab: Gemma / `line_yfGcRwQbNr`).
3. **Save connection** (Advanced: server/MAC/caller ID only — extension is read-only after assign). FreePBX gets the extension + secret automatically.
4. **Download config** / **Set up adapter** → reboot when asked.
5. Plug RJ11 phone into FXS. Dial **0** (TreeHouse), **1** (Home/parent), or **2–9** (speed dial).

## Manual SIP settings (if you skip PhoneHome config)

FreePBX public: **y5876647.eero.online:5061** TLS (LAN `10.0.5.105:5061`)  
Extension / Auth ID: **2001**  
Password: **PhoneHomeHt801!**  

| HT801 field | Value |
| --- | --- |
| Account Active | Yes |
| Primary SIP Server | `y5876647.eero.online:5061` (or `10.0.5.105:5061` on LAN) |
| SIP User ID | `2001` |
| Authenticate ID | `2001` |
| Authenticate Password | `PhoneHomeHt801!` |
| Name | `Kid ATA` |
| Local SIP Port | `5060` |
| SIP Transport | TLS |
| Use Random SIP Port | **No** (PhoneHome sets `P20501=0` — V2 firmware defaults Yes and breaks FreePBX re-INVITE) |
| SRTP Mode | Enabled and forced |
| Validate Server Certificates | **Yes** for `y5876647.eero.online` (Let’s Encrypt). **No** only if using LAN IP `10.0.5.105` |
| NAT Traversal | Keep-Alive |

## Check it registered

```bash
ssh root@10.0.5.31
pct exec 121 -- asterisk -rx 'pjsip show contacts'
# expect 2001/... Available
```

Or run the doctor, which checks this plus fail2ban, TLS and secret drift in one shot:

```bash
./deploy/phonehome-doctor.sh          # EXT=2002 / PVE_SSH=… to override
```

PhoneHome Home (parent view) also shows a glanceable chip above the dial pad: **Set up Analog Phone** (no SIP password), **Analog Phone offline** (FreePBX says not registered), or **Can't check Analog Phone** (bridge/ARI unreachable, or the check could not be completed). When the ATA is online the chip hides. Child mode never shows it. Status comes from `GET /api/lines/:id/ata-status` → bridged `GET /sip-status` (cached ~20s).

**"Working" now requires a check that finished and found a registration.** `/sip-status` returns `confidence`: `high` when the bridge read real AOR contacts over AMI, `low` when all it has is the ARI endpoint state. ARI cannot list contacts, and with `qualify_frequency=0` Asterisk calls an endpoint "online" even when the AOR is empty — that is exactly how the fail2ban outage below stayed invisible. Any inconclusive answer (ARI down, bridge timeout, missing `BRIDGE_SECRET`) is `unknown` → "Can't check", never a green chip.

To get `confidence: high`, set `AMI_USER` / `AMI_PASSWORD` (optional `AMI_HOST`, `AMI_PORT`, `AMI_TIMEOUT_MS`) on the bridge — see `bridged/README.md`. Leaving them unset keeps today's ARI-only behaviour. Either way, keep **qualify on the AOR** (`qualify_frequency=60` on ext 2001) so Asterisk actually probes the adapter.

## Troubleshooting: adapter won't register / no REGISTER attempts in the log at all

Symptom: the HT801 shows "Not registered", `pjsip show contacts` is empty, and `asterisk -rx 'pjsip set logger on'` (or `/var/log/asterisk/full`) shows **no inbound REGISTER whatsoever** — not even a 401 or 403. Nothing arrives, so nothing is logged.

**Check fail2ban first, before touching the adapter.** Analog SIP goes HT801 → **socat SIP TLS proxy on the Proxmox host `10.0.5.31`** → FreePBX `10.0.5.105:5061`. Asterisk therefore sees *every* analog REGISTER as coming from `10.0.5.31`. A few failed auths (e.g. a SIP secret mismatch after re-provisioning) are enough for the `asterisk-iptables` jail to ban the proxy — which silently kills analog SIP for the whole household.

### Download config must match FreePBX (remote parents)

Remote households cannot use one-tap — they **Download config** and import it on the adapter. That file is only useful if FreePBX already holds the same SIP secret. PhoneHome now syncs the secret into FreePBX (via `phonehome-freepbx-syncd` on the Proxmox host) on ATA create/update and **again immediately before every Download**. If sync is configured and fails, Download returns an error instead of a file that cannot REGISTER.

Verify with `./deploy/phonehome-doctor.sh` ("SIP secret agreement"). Manual ops escape hatch: `./deploy/rotate-ata-sip-secret.sh` (writes both sides).

**Check fail2ban first, before touching the adapter.** Analog SIP goes HT801 → **socat SIP TLS proxy on the Proxmox host `10.0.5.31`** → FreePBX `10.0.5.105:5061`. Asterisk therefore sees *every* analog REGISTER as coming from `10.0.5.31`. A few failed auths (e.g. a SIP secret mismatch after re-provisioning) are enough for the `asterisk-iptables` jail to ban the proxy — which silently kills analog SIP for the whole household.

```bash
ssh root@10.0.5.31
pct exec 121 -- fail2ban-client status asterisk-iptables
pct exec 121 -- fail2ban-client get asterisk-iptables banned      # look for 10.0.5.31
pct exec 121 -- iptables -S | grep -E 'REJECT|DROP'               # offending rule
```

Unban and verify:

```bash
pct exec 121 -- fail2ban-client set asterisk-iptables unbanip 10.0.5.31
pct exec 121 -- fail2ban-client get asterisk-iptables banned      # 10.0.5.31 gone
pct exec 121 -- asterisk -rx 'pjsip show contacts'                # 2001/... Avail within ~1 register cycle
```

Durable fix (already in place): `/etc/fail2ban/jail.d/zz-phonehome-trusted.local` with

```ini
[DEFAULT]
ignoreip = 127.0.0.1/8 ::1 10.0.4.0/24 10.0.5.0/24
```

`jail.d/*.local` is read after FreePBX's generated `jail.local`, so it survives FreePBX regenerating its own config. Confirm it is loaded with `fail2ban-client get asterisk-iptables ignoreip`. The trade-off (fail2ban can no longer ban real attackers coming through the proxy) and the recommended fix are in `docs/threat-model.md`.

If REGISTERs *do* arrive but get 401/403, it's secret drift instead — compare hashes, don't print secrets:

```bash
./deploy/phonehome-doctor.sh     # "SIP secret agreement" section does this for you
```

Other quick causes: `qualify_frequency=0` on the AOR (adapter looks online forever), the SIP TLS proxy or its cert being down (`openssl s_client -connect 10.0.5.31:5061`), or the bridge being unable to reach ARI. `deploy/phonehome-doctor.sh` covers all of them and exits non-zero on the first real failure.

## Call paths

```
# Softphone → kid HT801
Parent app → WS call.offer → PhoneHome → bridged /claim
  → originate PJSIP/2001 with CID name+number → FXS ring
  → on answer: Flite “Call from {nickname}” (screening) → then WebRTC + ExternalMedia

# ATA → ATA (two households, mutual allowlist)
RJ11 → HT801 A → Stasis → resolve (toSipExtension=B, cidName/cidNumber)
  → originate PJSIP/B with CID → on answer: announce → mixing bridge

# ATA → softphone (target has no ata_devices)
RJ11 → HT801 → Stasis → resolve → bridged WS call.offer → softphone WebRTC
```

### Inbound FXS: screening announce + Caller ID

On **answer** of the HT801 leg (before parties are bridged), FreePBX `app_flite` plays **“Call from {name}”** via dialplan context `phonehome-announce`, then re-enters Stasis (`post-announce`). Softphone callers stay on ringing until announce finishes.

| Field | Source |
| --- | --- |
| **CID / announce name** | Callee household’s allowlist **nickname** for the caller (`peerLabelForHousehold`); else `child_label` / line name |
| **CID number** | Caller’s SIP extension if they have an ATA; else a stable 4-digit pseudo-ext (not a PSTN number) |
| **SIP INVITE** | ARI `callerId`: `"Name" <number>` on `originate` to `PJSIP/<ext>` |

Grandstream FXS often paints CID after the first ring (FSK between rings) — that is ATA behavior, not missing From headers.

Announce uses Flite TTS for the full phrase **“Call from {name}”** (natural speech). Do **not** use `SayAlpha` — it spells letter-by-letter. `asterisk22-flite` does not set `FLITESTATUS`; gating on it caused a false fallback to spelling. Voice is set in `/etc/asterisk/flite.conf` (`voice=slt`, US English female) — not via `Flite()` args (`Flite(text[,intkeys])` only). Default without conf was `kal` (robotic US male diphone).

## Lab smoke (API)

```bash
# On CT 122 — resolve should include toSipExtension + cidName/cidNumber when target has ATA
curl -sS -H "Authorization: Bearer $BRIDGE_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"sipExtension":"2001","dialed":"1"}' \
  http://127.0.0.1:8787/api/bridge/resolve

curl -sS -H "Authorization: Bearer $BRIDGE_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"fromLineId":"<parent>","toLineId":"line_yfGcRwQbNr"}' \
  http://127.0.0.1:8787/api/bridge/route
# expect cidName (allowlist nickname) + cidNumber

curl -sS http://127.0.0.1:8790/health
```

## ARI note (lab)

ARI was broken by a duplicate `[general]` in `ari_general_custom.conf` (“Error getting ARI configuration”, no `/ari` routes). That file must **not** reopen `[general]`. After fix: `ari show status` → Enabled: Yes; HTTP `bindaddr=0.0.0.0` for LAN access from CT 122.

## Does the HT801 have an app?

**No.** Configure via its web UI, or use PhoneHome’s **Download config** (preferred) / optional Config Server Path above.

## Public SIP (other households)

Configs use **`SIP_PUBLIC_HOST`** / `y5876647.eero.online` as the SIP server so an HT801 off-LAN can register to FreePBX.

**Encryption:** PhoneHome XML sets **SIP Transport = TLS**, server `host:5061`, **SRTP = Enabled and forced**, and **Validate Server Certificates = Yes** when the server is a DNS name (Let’s Encrypt on FreePBX). FreePBX listens on **TCP 5061** (`0.0.0.0-tls`) with `media_encryption=sdes` on ext `2001`.

Required eero forwards: **TCP 5061 → 10.0.5.31** (PVE SIP TLS proxy → FreePBX), **UDP 10000–10200 → 10.0.5.105**. See `docs/hosting.md`.

**Remote audio gotcha:** `rewrite_contact=yes` makes the PJSIP Contact the PVE proxy (`10.0.5.31`). Transport `local_net` must **not** be `10.0.0.0/8` (that IP looks “local”), or Asterisk advertises private RTP to the remote HT801 — ring works, **no audio**. Use `local_net=10.0.4.0/24` (lab ATA LAN) and set `media_address=<public IP>` on remote endpoints (`phonehome-set-sip-secret`).

**Remote “cannot be completed as dialed” after a good call:** FreePBX→ATA originates need a live TLS Contact through the PVE socat proxy. After some calls that Contact goes Unavail until the HT801 re-REGISTERs (Beckett can often still *place* calls). Mitigations in PhoneHome HT801 XML: **SIP OPTIONS Keep-Alive** (`P2397=1`, 15s), **1-minute register** (`P32=1`), NAT keep-alive (`P84=20`), plus Asterisk TLS `tcp_keepalive_*`, AOR `max_contacts=1` + `remove_unavailable=yes` (`(+type=aor)`). After changing XML: Parent → Analog → **Download config** → upload on the box → reboot once.

Lab ATA: prefer public hostname (hairpin via PVE proxy). Advanced → server `10.0.5.105` still works on-site but keeps cert validation **off** (IP / no free LE IP cert).

## Softphone vs ATA keypad (* / # / 0)

On the PhoneHome **softphone** Home pad, bottom row is **\* · 0 · \#**:

| Key | Softphone |
| --- | --- |
| **\*** | Messages — opens Messages and starts Play (new first) |
| **0** | **TreeHouse** — kid hangout voice room (house pad; parents listen-only in app) |
| **1** | **Home** — calls the household’s designated parent line (locked slot). On a parent’s own pad, 1 targets the household child slot. |
| **\#** | Redial last placeable outbound target (else “Nothing to redial”). In-call hold uses the **Hold** button. |

**ATA / FreePBX:** HT801 dials **0–9** via Stasis — **0 = TreeHouse**, **1 = Home/parent** (same as softphone pads 0 and 1). Dial **\*98** (or bare **\*** after the ATA’s No Key Timeout) for the PhoneHome Messages / greeting assistant (shared softphone inbox — not FreePBX Comedian Mail). Softphone **\#** redial is not wired on the ATA.

**During an analog call:** press **\#** to put the other party on hold (they hear music on hold); press **\#** again to resume. Works softphone↔analog and analog↔analog.

### Analog *98 (Messages + greetings)

From the HT801 handset (same line’s SIP extension):

| Keys | Action |
| --- | --- |
| **\*98** | Enter Messages assistant (immediate on HT801 dial plan) |
| **\*** | Same Messages assistant (after No Key Timeout unless more digits follow) |
| *(entry)* | Speaks **“You have N new messages”** (or no messages) — does **not** play the personal greeting |
| *(menu)* | **“Press 1 for messages. Press 2 for greetings.”** (once) |
| **1** | Listen to messages (household inbox) |
| **2** | Greetings menu |
| **#** / **\*** | Exit |

**While a message plays / after it:** **4** replay · **7** delete · **9** keep · **#** next

**Greetings menu (after 2):**

| Keys | Action |
| --- | --- |
| **1** | Record greeting (beep → speak → **#** to finish) |
| **2** | Play current greeting |
| **3** | Clear greeting (use default) |
| **\*** | Back to main |

**After recording:** **1** save · **2** listen · **3** re-record (Asterisk `vm-review` prompts)

Greeting audio is stored in PhoneHome `greetings/<lineId>.*` — same source softphone Profile / Sounds uses.

## One-tap setup (no Grandstream UI)

Parent → Analog Phone → pick **Adapter for this line** (kid) → **Set up adapter** (requires Mothership ↔ HT801 on the same LAN):

If login fails with “tries left” / “locked”, wait ~2 minutes. After a successful setup, the sticker password no longer works — use the new admin password you chose.

1. Save SIP connection once (extension + password auto-assigned and locked; FreePBX extension is created via `freepbx-sync` on Save).
2. Enter adapter LAN IP, password printed on the box, and a new admin password (8–30 chars, upper+lower+digit, **no symbols**).
3. **PhoneHome at your house** (the hub/host process — not the parent’s phone browser) logs into the HT801 (`/cgi-bin/dologin`), sets the new password, uploads config XML (`/cgi-bin/upload_cfg`), and reboots.

The browser/app never talks to the ATA (CORS / HTTPS→HTTP). Only the Mothership on the ATA’s LAN does. Public IPs are rejected (SSRF guard). Parent phone can be remote; the Mothership cannot.

**Download config** is the path when the hub is shared, cloud, or not next to the ATA — parent still needs some device that can open the adapter’s local web UI to upload.

## HT801 dashboard: “Firmware server is not configured”

**Do not worry.** That **Provision** line on the HT801 Status page is about **Grandstream firmware auto-upgrade**, not PhoneHome SIP/TLS or config.

| Field | PhoneHome sets? | What to do |
| --- | --- | --- |
| **Config Server Path** | Yes (`P237`) when using auto path / push with path | Paste PhoneHome path (no `https://`) or leave blank if you only Upload Configuration once |
| **Firmware Server Path** | Cleared on purpose (`P192=""`) | **Leave blank** — PhoneHome does not host ATA firmware |
| **Upgrade Via** | HTTPS (`P212=2`) when config path is set | HTTPS for Config Server Path |
| Account / SIP / SRTP | Yes (`P47`, `P130=2`, `P183=2`, …) | Check **Status → Account** for Registered, not Provision |

Exact UI (HT8xx firmware varies slightly):

1. **Status** (home) → **Provision**: “Not running … Firmware server is not configured” = expected when Firmware Server Path is empty.
2. **Maintenance → Upgrade** (or **Advanced Settings → Firmware Upgrade and Provisioning**):
   - **Firmware Server Path** — blank (ignore the status message).
   - **Config Server Path** — PhoneHome path from Parent → Analog Phone → Advanced → Copy Config Server Path, *or* empty if you used Download config / Set up adapter only.
3. **Account** / **Status → Account** — Primary SIP Server, TLS, SRTP, Registered = the thing that matters for calls.

SIP/TLS config still applies whether you downloaded XML, used one-tap push, or Config Server Path. Empty firmware path only skips GS firmware OTA.

## E911 (provisioned)

PhoneHome’s HT801 XML enables Grandstream **E911** (`P8565=1`, numbers `911;933`, Priority header). Dial plan allows those plus speed-dial `0–9`.

Until a PSTN/SIP trunk with real PSAP routing exists, dialing **911** or **933** on the ATA resolves to the household **Home parent** (same as `0`), and bypasses Quiet Time / Pause. This is not a substitute for carrier emergency service.
