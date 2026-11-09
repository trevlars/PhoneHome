# HT801 ↔ PhoneHome (lab)

## Honest status

| Layer | Status |
| --- | --- |
| HT801 ↔ FreePBX (SIP register / dial) | **Ready** — extension `2001`; public SIP host `mothership.example` (LAN `192.168.2.105` still works on-site) |
| Easy ATA config from PhoneHome | **Ready** — Parent → Analog Phone (Download config; Config Server Path optional) |
| FreePBX ↔ PhoneHome softphones | **Ready** — `bridged/` ARI Stasis + WebRTC (see `bridged/README.md`) |
| Softphone → kid FXS | **Ready** — bridge claims line, originates `PJSIP/<ext>` with CID; Flite announce on answer |
| ATA → ATA (no softphones) | **Ready** — resolve returns `toSipExtension` + `cidName`/`cidNumber`; announce then SIP↔SIP bridge |
| Parent Home ATA health chip | **Ready** — above dial; setup / connecting / offline / can't-check; hides when registered. Status is honest when FreePBX has no usable Contact (not merely a stale Unavail registration). |

## Super-easy parent flow (preferred)

In the app: **Parent → Analog Phone**. The parent phone app can be anywhere. **One-tap / Set up adapter** only works when the **Mothership** at your house shares Wi‑Fi with the HT801 — not because the parent’s phone is on that LAN. Otherwise: plug Ethernet, open the adapter’s web page by IP, **Download config** from the app, upload on the HT801 (from any device that can reach the adapter’s local UI), reboot, plug a phone, dial **0** (TreeHouse), **1** (Home/parent), or **2–9** (speed dial). Contacts stay in PhoneHome (changing a speed dial in the app updates the handset; no re-upload). Config Server Path is optional/advanced.

**SIP extensions are auto-assigned** unique per ATA/line (starting at `2001`) when you save the connection — Alex and cousins never share a number. PhoneHome also auto-generates the SIP password. Parents cannot edit or override the extension (anti-takeover). On Save (and before Download/push), PhoneHome **creates or updates the matching FreePBX PJSIP extension** via `phonehome-freepbx-syncd` → `phonehome-set-sip-secret` (TLS + SRTP). Mode matrix:

| ATA | FreePBX mode | `rewrite_contact` | `media_address` |
| --- | --- | --- | --- |
| Mothership / one-tap (home) | `lan` | **yes** (SIP TLS proxy) | **FreePBX LAN IP** |
| Cousin / Download | `remote` | **yes** | **public WAN IP** |

Do **not** set `rewrite_contact=no` on home (Contact becomes the ATA LAN IP → Unavail / app offline). Do **not** put public `media_address` on home (WAN hairpin → softphone↔analog silence). Home pins `media_address=<FreePBX LAN IP>` instead — omitting it makes Asterisk advertise the public WAN (Contact is the PVE proxy outside `local_net`) and home uplink dies (Quinn can't hear Alex). Manual FreePBX clicking is no longer required for new ATAs.

Lab: child line Alex / `line_example`; server **`mothership.example`** (public; requires eero **TCP 5061** + **UDP 10000–10200** → FreePBX — see `docs/hosting.md`).

1. Open PhoneHome → **Parent** → **Analog Phone**.
2. Select the child line (lab: Alex / `line_example`).
3. **Save connection** (Advanced: server/MAC/caller ID only — extension is read-only after assign). FreePBX gets the extension + secret automatically.
4. **Download config** / **Set up adapter** → reboot when asked.
5. Plug RJ11 phone into FXS. Dial **0** (TreeHouse), **1** (Home/parent), or **2–9** (speed dial).

## Manual SIP settings (if you skip PhoneHome config)

FreePBX public: **mothership.example:5061** TLS (LAN `192.168.2.105:5061`)  
Extension / Auth ID: **2001**  
Password: **example-sip-pass**  

| HT801 field | Value |
| --- | --- |
| Account Active | Yes |
| Primary SIP Server | `mothership.example:5061` (or `192.168.2.105:5061` on LAN) |
| SIP User ID | `2001` |
| Authenticate ID | `2001` |
| Authenticate Password | `example-sip-pass` |
| Name | `Kid ATA` |
| Local SIP Port | `5060` |
| SIP Transport | TLS |
| Use Random SIP Port | **No** (PhoneHome sets `P20501=0` — V2 firmware defaults Yes and breaks FreePBX re-INVITE) |
| SRTP Mode | Enabled and forced |
| Validate Server Certificates | **Yes** for `mothership.example` (Let’s Encrypt). **No** only if using LAN IP `192.168.2.105` |
| NAT Traversal | Keep-Alive |

## Check it registered

```bash
ssh root@192.168.2.31
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

**Check fail2ban first, before touching the adapter.** Analog SIP goes HT801 → **socat SIP TLS proxy on the Proxmox host `192.168.2.31`** → FreePBX `192.168.2.105:5061`. Asterisk therefore sees *every* analog REGISTER as coming from `192.168.2.31`. A few failed auths (e.g. a SIP secret mismatch after re-provisioning) are enough for the `asterisk-iptables` jail to ban the proxy — which silently kills analog SIP for the whole household.

### Contacts stick `Unavail` while REGISTER still gets `200 OK`

Symptom: `pjsip show contacts` shows **Unavail** (nan RTT), parent chip says offline, but the SIP logger still shows authenticated REGISTER → `200 OK`. Secrets agree. fail2ban is clean.

Cause: the PJSIP endpoint had `transport=0.0.0.0-tls` pinned (older `phonehome-set-sip-secret`). That forces **new** TLS sockets for qualify/INVITE instead of reusing the ATA→socat→FreePBX registration connection.

Fix (current `deploy/phonehome-set-sip-secret.py` + `bridged/freepbx/pjsip.transports_custom.conf`):

1. No `transport=` on ATA endpoint blocks; delete FreePBX `sip.transport` rows for those exts  
2. `symmetric_transport=yes` on `[0.0.0.0-tls]`  
3. Re-sync / `fwconsole reload`, wait one register cycle — Contacts should show **Avail** with a real RTT

### Download config must match FreePBX (remote parents)

Remote households cannot use one-tap — they **Download config** and import it on the adapter. That file is only useful if FreePBX already holds the same SIP secret. PhoneHome now syncs the secret into FreePBX (via `phonehome-freepbx-syncd` on the Proxmox host) on ATA create/update and **again immediately before every Download**. If sync is configured and fails, Download returns an error instead of a file that cannot REGISTER.

Verify with `./deploy/phonehome-doctor.sh` ("SIP secret agreement"). Manual ops escape hatch: `./deploy/rotate-ata-sip-secret.sh` (writes both sides).

**Check fail2ban first, before touching the adapter.** Analog SIP goes HT801 → **socat SIP TLS proxy on the Proxmox host `192.168.2.31`** → FreePBX `192.168.2.105:5061`. Asterisk therefore sees *every* analog REGISTER as coming from `192.168.2.31`. A few failed auths (e.g. a SIP secret mismatch after re-provisioning) are enough for the `asterisk-iptables` jail to ban the proxy — which silently kills analog SIP for the whole household.

```bash
ssh root@192.168.2.31
pct exec 121 -- fail2ban-client status asterisk-iptables
pct exec 121 -- fail2ban-client get asterisk-iptables banned      # look for 192.168.2.31
pct exec 121 -- iptables -S | grep -E 'REJECT|DROP'               # offending rule
```

Unban and verify:

```bash
pct exec 121 -- fail2ban-client set asterisk-iptables unbanip 192.168.2.31
pct exec 121 -- fail2ban-client get asterisk-iptables banned      # 192.168.2.31 gone
pct exec 121 -- asterisk -rx 'pjsip show contacts'                # 2001/... Avail within ~1 register cycle
```

Durable fix (already in place): `/etc/fail2ban/jail.d/zz-phonehome-trusted.local` with

```ini
[DEFAULT]
ignoreip = 127.0.0.1/8 ::1 192.168.1.0/24 192.168.2.0/24
```

`jail.d/*.local` is read after FreePBX's generated `jail.local`, so it survives FreePBX regenerating its own config. Confirm it is loaded with `fail2ban-client get asterisk-iptables ignoreip`. The trade-off (fail2ban can no longer ban real attackers coming through the proxy) and the recommended fix are in `docs/threat-model.md`.

If REGISTERs *do* arrive but get 401/403, it's secret drift instead — compare hashes, don't print secrets:

```bash
./deploy/phonehome-doctor.sh     # "SIP secret agreement" section does this for you
```

Other quick causes: `qualify_frequency=0` on the AOR (adapter looks online forever), the SIP TLS proxy or its cert being down (`openssl s_client -connect 192.168.2.31:5061`), or the bridge being unable to reach ARI. `deploy/phonehome-doctor.sh` covers all of them and exits non-zero on the first real failure.

## Call paths

```
# Softphone → kid HT801
Parent app → WS call.offer → PhoneHome → bridged /claim
  → originate PJSIP/2001 with CID name+number → FXS ring
  → on answer: ExternalMedia (chan_websocket) + FXS joined atomically (no announce — CID carries the name)

# ATA → ATA (two households, mutual allowlist)
RJ11 → HT801 A → Stasis → resolve (toSipExtension=B, cidName/cidNumber)
  → originate PJSIP/B with CID → on answer: both legs into a mixing,proxy_media bridge → answer A

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
  -d '{"fromLineId":"<parent>","toLineId":"line_example"}' \
  http://127.0.0.1:8787/api/bridge/route
# expect cidName (allowlist nickname) + cidNumber

curl -sS http://127.0.0.1:8790/health
```

## ARI note (lab)

ARI was broken by a duplicate `[general]` in `ari_general_custom.conf` (“Error getting ARI configuration”, no `/ari` routes). That file must **not** reopen `[general]`. After fix: `ari show status` → Enabled: Yes; HTTP `bindaddr=0.0.0.0` for LAN access from CT 122.

## Does the HT801 have an app?

**No.** Configure via its web UI, or use PhoneHome’s **Download config** (preferred) / optional Config Server Path above.

## Public SIP (other households)

Configs use **`SIP_PUBLIC_HOST`** / `mothership.example` as the SIP server so an HT801 off-LAN can register to FreePBX.

**Encryption:** PhoneHome XML sets **SIP Transport = TLS**, server `host:5061`, **SRTP = Enabled and forced**, and **Validate Server Certificates = Yes** when the server is a DNS name (Let’s Encrypt on FreePBX). FreePBX listens on **TCP 5061** (`0.0.0.0-tls`) with `media_encryption=sdes` on ext `2001`.

Required eero forwards: **TCP 5061 → 192.168.2.31** (PVE SIP TLS proxy → FreePBX), **UDP 10000–10200 → 192.168.2.105**. See `docs/hosting.md`.

**Remote audio gotcha:** `rewrite_contact=yes` makes the PJSIP Contact the PVE proxy (`192.168.2.31`). Transport `local_net` must **not** be `10.0.0.0/8` (that IP looks “local”), or Asterisk advertises private RTP to the remote HT801 — ring works, **no audio**. Use `local_net=192.168.1.0/24` (lab ATA LAN) and set `media_address=<public IP>` on remote endpoints (`phonehome-set-sip-secret`). The AdGuard rewrite of `mothership.example` → `192.168.2.31` is for SIP signaling only. Remote `media_address` must be the public A record (resolved past that rewrite). Writing `192.168.2.31` there makes cousin ATAs ring with no audio.

**Mothership vs cousin:** Home-household one-tap ATAs sync as FreePBX **lan/home** (`rewrite_contact=yes`, `media_address=<FreePBX LAN>`) even when the SIP server is the public FQDN. Forcing a public `media_address` on the lab ATA makes it hairpin RTP to the WAN address and **breaks softphone↔analog**. Omitting `media_address` entirely is also wrong: Contact is the PVE proxy outside `local_net`, so Asterisk falls back to transport `external_media_address` (public WAN) and home→far-side audio dies. Invited/cousin Download ATAs stay **remote** with public `media_address`. Managed `pjsip.endpoint_custom_post.conf` labels each block `(home)` or `(remote)` — the next ATA sync must re-parse those labels, **not** infer mode from `rewrite_contact` (always yes) or from private `media_address=` (home LAN pin).

**Automation:** The hub resolves `SIP_PUBLIC_HOST` / `PUBLIC_BASE_URL` → public IPv4 and sends `media_address` in every FreePBX sync POST (Save, Download, and boot reconcile). FreePBX does not depend on syncd env surviving `pct exec`. Remote sync **errors** if DNS/public host is missing instead of shipping a silent phone. Home one-tap ATAs sync as **lan** (no public `media_address`). `./deploy/phonehome-doctor.sh` still audits remote blocks.

**Remote “cannot be completed as dialed” after a good call:** FreePBX→ATA originates need a live TLS Contact through the PVE socat proxy. After some calls that Contact goes Unavail until the HT801 re-REGISTERs (Sam can often still *place* calls). Mitigations in PhoneHome HT801 XML: **SIP OPTIONS Keep-Alive** (`P2397=1`, 15s), **1-minute register** (`P32=1`), NAT keep-alive (`P84=20`), plus Asterisk TLS `tcp_keepalive_*`, AOR `max_contacts=1` + `remove_unavailable=yes` (`(+type=aor)`). After changing XML: Parent → Analog → **Download config** → upload on the box → reboot once. Parents can also tap **Reboot adapter** in Analog Phone (SIP NOTIFY `phonehome-reboot` for *their* extension only).

Lab ATA: prefer public hostname (hairpin via PVE proxy). Advanced → server `192.168.2.105` still works on-site but keeps cert validation **off** (IP / no free LE IP cert).

## Softphone vs ATA keypad (* / # / 0)

On the PhoneHome **softphone** Home pad, bottom row is **\* · 0 · \#**:

| Key | Softphone |
| --- | --- |
| **\*** | Messages — opens Messages and starts Play (new first) |
| **0** | **TreeHouse** — kid hangout voice room (house pad; parents listen-only in app) |
| **1** | **Home** — calls the household’s designated parent line (locked slot). On a parent’s own pad, 1 targets the household child slot. |
| **\#** | Redial last placeable outbound target (else “Nothing to redial”). In-call hold uses the **Hold** button. |

**ATA / FreePBX:** HT801 dials **0–9** via Stasis — **0 = TreeHouse**, **1 = Home/parent** (same as softphone pads 0 and 1). Dial **\*98** (or bare **\*** after the ATA’s No Key Timeout) for the PhoneHome Messages / greeting assistant (shared softphone inbox — not FreePBX Comedian Mail). Softphone **\#** redial is not wired on the ATA.

**During an analog call:** press **\#** to hold / resume (RFC2833 DTMF → bridged). Almost every house phone has `#`; Flash is not. Grandstream requires `P72=1` for `P28147=1` to disable idle `#` redial; never set `P72=0`, which restores the built-in redial behavior. Softphone peers play local hold music when the ATA holds (Asterisk MOH on WebRTC is silent). **Pulse-only** handsets (no tone `#`, e.g. some rotary-style sets) can still use **Flash** / hook-flash as a fallback. Once the adapter has been set up, PhoneHome deployments send authenticated plain `check-sync` (`phonehome-check-sync`) and the HT801 also polls every 30 minutes (`P1414=1`, `P22296=1`, `P193=30`), so server-side hold/DTMF changes do **not** require another manual config upload. Do not substitute `check-sync;reboot=true`: this firmware can reboot without fetching the config.

### Analog *98 (Messages + greetings)

From the HT801 handset (same line’s SIP extension):

| Keys | Action |
| --- | --- |
| **\*98** | Enter Messages assistant (immediate on HT801 dial plan) |
| **98** | Same Messages assistant — **use this on pulse handsets** (no `*` key) |
| **\*** | Same Messages assistant (tone phones; after No Key Timeout unless more digits follow) |
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

**Invited / cousin pods (operator):** one-tap cannot reach another house. Download XML always uses `SIP_PUBLIC_HOST` (never the mothership LAN IP), FreePBX sync uses remote mode (`rewrite_contact` + `media_address`), and `setup_mode=download`. Their firewall must allow **outbound TCP 5061** (SIP TLS) plus SRTP UDP back. Status: `config_downloaded` / `config_pulled` ≠ REGISTER — wait for Home chip / `pjsip show contacts`.

## HT801 firmware (v1 vs v2)

PhoneHome XML is written for **HT801 v2** so **1.0.9.x still REGISTER** (SIP TLS + SRTP) as well as **1.0.11.x**. Do not require 1.0.11.4. Dual-write gen1 + v2 slots where both are valid (`P90` + `P4200` dial plan; `P191` Enable Call Features + `P26062=0` RFC2543 off; `P8463` + `P2311`/`P2367` cert checks).

- **1.0.9.3 is enough** after a good Download: public SIP host, `P30=pool.ntp.org` (DHCP Option 42 must not override), TLS `P130=2`, SRTP `P183=2`. Factory clocks often pass HTTPS provision and fail SIP TLS cert checks until NTP lands.
- **1.0.11.4 is recommended** only if REGISTER still fails after NTP + public SIP host. Grandstream’s V2 notes fix SIP registration after a 1.0.9.3 upgrade — that is a GS bug we cannot paper over with P-values.
- **Do not flash a v1 image on a v2 box** (or the reverse). Status → System shows the model. v2 files are `HT8xxV2_…` / `ht80xv2fw.bin`; gen1 is `ht801fw.bin` — never link or flash that on v2.
- Parents (in-app Analog Phone + Help → House phone): check **Status → System Info**, then **Maintenance → Upgrade**, upload firmware, reboot. Official links: [HT801 v2 image](https://firmware.grandstream.com/ht80xv2fw.bin) and [Grandstream firmware](https://www.grandstream.com/support/firmware) — pick **HT801 v2 / 1.0.11.x (or newer v2)**. Leave Firmware Server Path blank unless you intentionally host GS firmware. Do not factory-reset unless asked.

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
