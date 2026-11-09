# Hosting for parent testing

> **Self-host (anyone):** start with **[`self-host.md`](./self-host.md)** — run your **Mothership** as a background app on macOS/Windows/Linux.  
> **This page** documents the **example lab** Mothership layout (Proxmox, DuckDNS (mothership.example), specific CT IDs).

**PhoneHome** Stage 1 needs **HTTPS** so phones can use the microphone (secure context). Cousins only need the public URL + an invite — no VPN.

Repo / deploy **host paths** still use `kids-landline` (CT hostname, systemd unit, `/opt/kids-landline`) — intentional so lab boxes don’t need a migrate. The **product and GitHub repo** are **PhoneHome** (`https://github.com/trevlars/PhoneHome`).

## Lab / always-on (Proxmox LXC)

Typical layout used in the example lab:

| Piece | Value |
| --- | --- |
| CT | `kids-landline` (example id `122`) — product: **PhoneHome** |
| LAN | `http://192.168.2.106:8787` |
| Data | `/var/lib/kids-landline` (`DATA_DIR`) |
| Host code | `/var/lib/kids-landline/HOST_CODE.txt` |
| Unit | `kids-landline.service` inside the CT |

Deploy / refresh from a checkout:

```bash
./deploy/proxmox-rsync.sh root@192.168.2.31 122
```

## Public HTTPS (stable — DuckDNS `mothership.example`; each service on its own port)

| Service | URL | eero port forward |
| --- | --- | --- |
| **PhoneHome** | `https://mothership.example:8443` | **TCP 8443** → `192.168.2.31:8443` |
| **PhoneHome ASC listing URLs** | `https://mothership.example/{privacy,support}.html` · `/phonehome` | Same hostname **:443** — Caddy path-proxies to PhoneHome (ASC rejects `:8443`) |
| **Home Assistant** | `https://mothership.example:8123` | **TCP 8123** → `192.168.2.31:8123` (Caddy → HAOS `192.168.2.89:8123`) |


Also keep TURN: UDP/TCP **3478** + UDP **49160–49200** → 192.168.2.31.

### Public SIP (remote HT801 / analog adapters)

ATA configs default to SIP host **`mothership.example`** (not the LAN FreePBX IP), so other households can register over the internet.

**Encryption is a product pillar** ([`privacy-security.md`](./privacy-security.md)): SIP **TLS** on **TCP 5061** + **SRTP** (SDES) for media. Softphones stay on WebRTC (DTLS-SRTP). FreePBX custom files: `bridged/freepbx/pjsip.transports_custom.conf` + `pjsip.endpoint_custom_post.conf`.

**MITM protection (free path):** reuse Caddy’s Let’s Encrypt cert for `mothership.example` on FreePBX TLS (`deploy/sync-phonehome-sip-cert.sh` + daily timer on PVE). ATAs register to **`mothership.example:5061`** with **server cert validation on**. Do not use self-signed for parents.

**LAN hairpin / split-DNS:** eero hairpins well to **PVE** (`192.168.2.31`) but not reliably to FreePBX (`192.168.2.105`), and public `:5061` may be ISP-filtered. Lab uses:

1. `phonehome-sip-tls-proxy` on PVE (`:5061` → FreePBX)
2. AdGuard rewrite: `mothership.example` → `192.168.2.31` (LAN only)
3. eero **TCP 5061 → 192.168.2.31** for remote ATAs (and so WAN hairpin matches)

Then lab ATAs use the public FQDN with validation on. Raw `192.168.2.105` remains a lab escape hatch with validation off.

Cleartext UDP 5060 is not a supported production path.

Add eero port forwards → **PVE** `192.168.2.31` (SIP TLS via proxy) / FreePBX RTP:

| Port | Purpose | Forward to |
| --- | --- | --- |
| **TCP 5061** | SIP TLS signaling (**required** — privacy pillar) | **192.168.2.31:5061** (proxy → FreePBX) |
| **UDP 10000–10200** | SRTP audio (narrowed on FreePBX for easier forwarding) | **192.168.2.105** |

Do **not** forward UDP 5060 for PhoneHome ATAs. Cleartext SIP is not a supported production path (`docs/privacy-security.md`).

Confirm FreePBX live range with `rtp show settings` — **Port end must be 10200**. Deploy (`proxmox-rsync.sh`) and `phonehome-set-sip-secret` pin `rtp_additional.conf` **after** every `fwconsole reload` (FreePBX regenerates `rtpend=20000`; Asterisk reads that file before `rtp_custom.conf`, so custom alone never wins). A call that SDP-offers e.g. `m=audio 14842` will ring with **no audio** when eero only forwards 10000–10200.

If the eero app says the external port is already in use when widening the range, **edit is blocked by the existing rule** — keep **UDP 10000–10200 → 192.168.2.105** and rely on the post-reload pin. To widen instead: delete the old RTP forward, then create **UDP 10000–20000 → 192.168.2.105** (optional).

TLS transport `local_net` must stay narrow (`192.168.1.0/24` for the lab ATA LAN). A wide `10.0.0.0/8` makes remote ATAs (Contact rewritten to the PVE SIP proxy) look local, so Asterisk puts private RTP in SDP — **ring, no audio**. Remote endpoints also get `media_address=<public IP>` via `phonehome-set-sip-secret`.

That public `media_address` is mandatory for cousin/remote houses. Resolve it with a public DNS server. The mothership's own DNS (AdGuard, split-horizon, hairpin) often answers the SIP hostname with the LAN address of the SIP proxy; writing that address makes every new cousin ATA ring with no audio. Home one-tap ATAs still use the FreePBX LAN address. The doctor fails a remote block whose `media_address` is private. Home/mothership ATAs use `rewrite_contact=yes` **plus** `media_address=<FreePBX LAN IP>` so SDP `c=` is reachable on-LAN (Contact is the PVE proxy outside `local_net`; omitting media advertises the public WAN and home uplink hairpins to silence). Sync used to omit media for remotes when `pct exec` dropped host env — Quinn↔Owen registered and rang with no sound. Deploy now installs syncd with `SIP_PUBLIC_HOST` + public media IP, and remote sync **errors** instead of shipping a silent endpoint. A second footgun: managing `rewrite_contact=yes` on every ATA meant an old parser re-tagged home as remote on the next cousin sync — fixed by `(home)`/`(remote)` labels in `pjsip.endpoint_custom_post.conf`. Doctor: `./deploy/phonehome-doctor.sh` → “remote ATA media_address”.

**Cert sync (PVE, once):**

```bash
# from a checkout on a machine that can ssh to PVE, or copy scripts onto PVE:
install -m 755 deploy/sync-phonehome-sip-cert.sh /usr/local/sbin/sync-phonehome-sip-cert.sh
cp deploy/phonehome-sip-cert-sync.service deploy/phonehome-sip-cert-sync.timer /etc/systemd/system/
cp deploy/phonehome-sip-tls-proxy.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now phonehome-sip-tls-proxy
systemctl enable --now phonehome-sip-cert-sync.timer
/usr/local/sbin/sync-phonehome-sip-cert.sh
```

Verify LE on FreePBX: `pct exec 121 -- openssl x509 -in /etc/asterisk/keys/phonehome-sip.crt -noout -issuer -ext subjectAltName` should show Let’s Encrypt + `DNS:mothership.example`.

**Security:** Public SIP attracts scanners. TLS + SRTP are mandatory for PhoneHome ATAs; still use strong extension passwords (PhoneHome generates them), keep FreePBX/fail2ban updated, and do not reuse weak defaults. Prefer regenerating ATA configs after changing `SIP_PUBLIC_HOST`. After switching to LE + validation, run **Analog Phone → Set up adapter** (or Download config) once more so `P8463=1` lands on the HT801. See the privacy pillar before weakening crypto for “lab convenience.”

PhoneHome CT env: `SIP_PUBLIC_HOST=mothership.example` (see `deploy/kids-landline.service`). Existing ATA rows may still have `192.168.2.105` — open **Analog Phone → Advanced**, set server to the public host, **Save**, then push/download config again. Escape hatch: `SIP_TLS_VALIDATE_CERT=0` forces validation off in generated XML.

**Analog one-tap vs download:** One-tap “Set up adapter” only works when the **Mothership** shares a LAN with that HT801. Invited cousin pods always lead with **Download config**; the host household still gets one-tap. A failed one-tap is remembered **per adapter** (it does not hide LAN setup for other houses). Set `ATA_LAN_PUSH=0` on cloud/VPS Motherships to disable one-tap for everyone. Override home-household detection with `ATA_LAN_HOUSEHOLD_IDS`.

After forwards are in:

```bash
curl -sS https://mothership.example:8443/api/health
curl -sS -o /dev/null -w "%{http_code}\n" https://mothership.example:3080/login
curl -sS -o /dev/null -w "%{http_code}\n" https://mothership.example:8123/
```

Cloudflare quick tunnel is disabled; invites use the `:8443` HTTPS URL.

### Signing back in after switching to HTTPS

Sessions don’t carry from the LAN URL to the public hostname (different site). Parents use **Sign in** with their **username and password**.

Forgot a password?

- **Child login** (optional username on a child line): any **authorized parent/guardian** can reset it in Parent → Child login.
- **Any account** (including child): on the CT (host/admin):

```bash
DATA_DIR=/var/lib/kids-landline node /opt/kids-landline/server/scripts/reset-password.mjs <username> '<newPassword>'
```

Example:

```bash
DATA_DIR=/var/lib/kids-landline node /opt/kids-landline/server/scripts/reset-password.mjs cameron 'correct-horse'
```

Tell them the new password privately. The UI also says “Forgot password? Ask whoever runs the Mothership.”

Legacy 6-digit **setup codes** still work for Mothership bootstrap and old accounts (Sign in → “Use Mothership setup code instead”). After a code login, parents should **Settings → Create username & password**. To mint fresh codes only:

```bash
DATA_DIR=/var/lib/kids-landline node /opt/kids-landline/server/scripts/reissue-codes.mjs
```

## Parent invite flow

1. Open the **public HTTPS** URL on your phone (not a raw LAN address — that breaks iPad mic and invite shares).
2. First parent: **Mothership setup** with the **setup code** from the Mothership (`HOST_CODE.txt`), create household → softphone, then **Settings → Create username & password**.
3. Day-to-day: **Sign in** with username/password. **Invite family** → share the 6-digit invite code (invites are still codes; accounts are not).
4. Other parents: **I was invited** (or Create account) → username/password → redeem invite → add softphone.
5. Both sides approve each other → **Call**.

Invite links use `PUBLIC_BASE_URL` (`https://mothership.example:8443` on the lab). LAN `http://192.168.2.106:8787` is fine for browsing on Wi‑Fi, but **calls and invite shares need that HTTPS URL**.

### Bridged (ATA ↔ softphone)

The ARI bridge terminates WebRTC toward softphones. It must use the **same coturn** as `/api/ice`, or off-LAN softphones will **ring with no audio** while softphone↔softphone still works. `phonehome-bridge` reads `TURN_*` from `/var/lib/kids-landline/bridge.env` (also synced by `deploy/phonehome-sync-public-url.sh`). Lab LAN TURN should be **coturn on PVE** (`turn:192.168.2.31:3478`), not the PhoneHome CT IP.

## Docker alternative

```bash
cd deploy && docker compose up -d --build
```

Then put HTTPS in front (Caddy, Traefik, or Cloudflare Tunnel) the same way.

## TURN (required for many cross-home calls)

Signaling goes through your HTTPS URL. **Voice is peer-to-peer WebRTC** — Caddy/HTTPS does **not** relay RTP. When both callers are on different home/carrier NATs (especially symmetric NAT), STUN alone fails and you need **TURN**.

### Lab setup (coturn on Proxmox host)

On `root@192.168.2.31` (PVE):

| Piece | Value |
| --- | --- |
| Service | `coturn.service` |
| Config | `/etc/turnserver.conf` |
| Creds file | `/root/.kids-landline-turn-creds` |
| Listen | UDP/TCP **3478** |
| Relay ports | UDP **49160–49200** |
| Public WAN | Frontier IP (check with `curl -4 ifconfig.me` on PVE) |
| Bind / relay | `192.168.2.31` |

PhoneHome CT (`122`) must advertise the **public** TURN URL:

```bash
# in kids-landline.service on CT 122
Environment=TURN_URLS=turn:YOUR.PUBLIC.IP:3478
Environment=TURN_USERNAME=kidslandline
Environment=TURN_CREDENTIAL=...   # from /root/.kids-landline-turn-creds on PVE
```

Verify: `curl -sS http://192.168.2.106:8787/api/ice` should include a `turn:` entry (not only Google STUN).

### eero port forwards (required for internet callers)

On the eero app → **Settings → Network → Reservations & port forwarding** (wording varies), forward to **192.168.2.31**:

1. **UDP 3478** → 192.168.2.31:3478 (TURN/STUN)
2. **TCP 3478** → 192.168.2.31:3478 (fallback when UDP is blocked)
3. **UDP 49160–49200** → 192.168.2.31 (TURN media relays)

Without those forwards, `/api/ice` can list TURN but phones **outside** Cameron’s LAN cannot allocate a relay.

### How to test

1. Confirm `/api/ice` returns TURN.
2. Phone A on **cellular**, phone B on a **different home Wi‑Fi** (not Cameron’s LAN).
3. Both open the HTTPS trycloudflare URL, sign in, approve each other, Call.
4. If it fails, flash may say the network may need TURN — check eero forwards + `journalctl -u coturn -n 50` on PVE.

LAN-only friends can still call without public TURN when hairpin/host candidates work; cousins on other networks need the forwards above.
