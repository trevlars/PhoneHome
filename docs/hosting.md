# Hosting for parent testing

> **Self-host (anyone):** start with **[`self-host.md`](./self-host.md)** — background app on macOS/Windows/Linux, Docker, env-based URLs.  
> **This page** documents the **trevlars lab** layout (Proxmox, eero DDNS, specific CT IDs).

**PhoneHome** Stage 1 needs **HTTPS** so phones can use the microphone (secure context). Cousins only need the public URL + an invite — no VPN.

Repo / deploy **host paths** still use `kids-landline` (CT hostname, systemd unit, `/opt/kids-landline`) — intentional so lab boxes don’t need a migrate. The **product and GitHub repo** are **PhoneHome** (`https://github.com/trevlars/PhoneHome`).

## Lab / always-on (Proxmox LXC)

Typical layout used in the trevlars lab:

| Piece | Value |
| --- | --- |
| CT | `kids-landline` (example id `122`) — product: **PhoneHome** |
| LAN | `http://10.0.5.106:8787` |
| Data | `/var/lib/kids-landline` (`DATA_DIR`) |
| Host code | `/var/lib/kids-landline/HOST_CODE.txt` |
| Unit | `kids-landline.service` inside the CT |

Deploy / refresh from a checkout:

```bash
./deploy/proxmox-rsync.sh root@10.0.5.31 122
```

## Public HTTPS (stable — eero DDNS ports; Night Watch :80 on LAN via Caddy too)

| Service | URL | eero forward |
| --- | --- | --- |
| **Night Watch HTTP** | `http://y5876647.eero.online` | **TCP 80** → `10.0.5.80:3080` (WAN). LAN AdGuard rewrite → PVE; Caddy `:80` → Night Watch |
| **Night Watch HTTPS** | `https://y5876647.eero.online` | **TCP 443** → `10.0.5.31:443` (Caddy → CT 110) |
| **PhoneHome** | `https://y5876647.eero.online:8443` | **TCP 8443** → `10.0.5.31:8443` |
| **Jellyfin HTTPS** | `https://y5876647.eero.online:8920` | **TCP 8920** → `10.0.5.31:8920` |
| Jellyfin HTTP (existing) | `http://y5876647.eero.online:8096` | unchanged |

Caddy on PVE (`/etc/caddy/Caddyfile`, `deploy/Caddyfile.eero-ddns`). `PUBLIC_BASE_URL` = `https://y5876647.eero.online:8443`. Browsers that auto-upgrade HTTP still get Night Watch on `:443`.

Also keep TURN: UDP/TCP **3478** + UDP **49160–49200** → 10.0.5.31.

### Public SIP (remote HT801 / analog adapters)

ATA configs default to SIP host **`y5876647.eero.online`** (not the LAN FreePBX IP), so other households can register over the internet.

**Encryption is a product pillar** ([`privacy-security.md`](./privacy-security.md)): SIP **TLS** on **TCP 5061** + **SRTP** (SDES) for media. Softphones stay on WebRTC (DTLS-SRTP). FreePBX custom files: `bridged/freepbx/pjsip.transports_custom.conf` + `pjsip.endpoint_custom_post.conf`.

**MITM protection (free path):** reuse Caddy’s Let’s Encrypt cert for `y5876647.eero.online` on FreePBX TLS (`deploy/sync-phonehome-sip-cert.sh` + daily timer on PVE). ATAs register to **`y5876647.eero.online:5061`** with **server cert validation on**. Do not use self-signed for parents.

**LAN hairpin / split-DNS:** eero hairpins well to **PVE** (`10.0.5.31`) but not reliably to FreePBX (`10.0.5.105`), and public `:5061` may be ISP-filtered. Lab uses:

1. `phonehome-sip-tls-proxy` on PVE (`:5061` → FreePBX)
2. AdGuard rewrite: `y5876647.eero.online` → `10.0.5.31` (LAN only)
3. Caddy also serves Night Watch on `:80` for that split-DNS case
4. eero **TCP 5061 → 10.0.5.31** for remote ATAs (and so WAN hairpin matches)

Then lab ATAs use the public FQDN with validation on. Raw `10.0.5.105` remains a lab escape hatch with validation off.

Cleartext UDP 5060 is not a supported production path.

Add eero port forwards → **PVE** `10.0.5.31` (SIP TLS via proxy) / FreePBX RTP:

| Port | Purpose | Forward to |
| --- | --- | --- |
| **TCP 5061** | SIP TLS signaling (**required** — privacy pillar) | **10.0.5.31:5061** (proxy → FreePBX) |
| **UDP 10000–10200** | SRTP audio (narrowed on FreePBX for easier forwarding) | **10.0.5.105** |

Do **not** forward UDP 5060 for PhoneHome ATAs. Cleartext SIP is not a supported production path (`docs/privacy-security.md`).

Confirm FreePBX live range with `rtp show settings` — **Port end must be 10200**. Deploy (`proxmox-rsync.sh`) and `phonehome-set-sip-secret` pin `rtp_additional.conf` **after** every `fwconsole reload` (FreePBX regenerates `rtpend=20000`; Asterisk reads that file before `rtp_custom.conf`, so custom alone never wins). A call that SDP-offers e.g. `m=audio 14842` will ring with **no audio** when eero only forwards 10000–10200.

If the eero app says the external port is already in use when widening the range, **edit is blocked by the existing rule** — keep **UDP 10000–10200 → 10.0.5.105** and rely on the post-reload pin. To widen instead: delete the old RTP forward, then create **UDP 10000–20000 → 10.0.5.105** (optional).

TLS transport `local_net` must stay narrow (`10.0.4.0/24` for the lab ATA LAN). A wide `10.0.0.0/8` makes remote ATAs (Contact rewritten to the PVE SIP proxy) look local, so Asterisk puts private RTP in SDP — **ring, no audio**. Remote endpoints also get `media_address=<public IP>` via `phonehome-set-sip-secret`.

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

Verify LE on FreePBX: `pct exec 121 -- openssl x509 -in /etc/asterisk/keys/phonehome-sip.crt -noout -issuer -ext subjectAltName` should show Let’s Encrypt + `DNS:y5876647.eero.online`.

**Security:** Public SIP attracts scanners. TLS + SRTP are mandatory for PhoneHome ATAs; still use strong extension passwords (PhoneHome generates them), keep FreePBX/fail2ban updated, and do not reuse weak defaults. Prefer regenerating ATA configs after changing `SIP_PUBLIC_HOST`. After switching to LE + validation, run **Analog Phone → Set up adapter** (or Download config) once more so `P8463=1` lands on the HT801. See the privacy pillar before weakening crypto for “lab convenience.”

PhoneHome CT env: `SIP_PUBLIC_HOST=y5876647.eero.online` (see `deploy/kids-landline.service`). Existing ATA rows may still have `10.0.5.105` — open **Analog Phone → Advanced**, set server to the public host, **Save**, then push/download config again. Escape hatch: `SIP_TLS_VALIDATE_CERT=0` forces validation off in generated XML.

**Analog one-tap vs download:** One-tap “Set up adapter” only works when **PhoneHome at your house** (this CT / home hub) shares a LAN with the HT801 — not when the parent’s phone app is merely on that Wi‑Fi. Set `ATA_LAN_PUSH=0` on shared/cloud hosts so the Parent UI leads with **Download config**. If a push can’t reach the adapter, the UI flips to download-first automatically.

After forwards are in:

```bash
curl -sS https://y5876647.eero.online:8443/api/health
curl -sS -o /dev/null -w "%{http_code}\n" https://y5876647.eero.online:8920/
curl -sS -o /dev/null -w "%{http_code}\n" https://y5876647.eero.online/login
curl -sS -o /dev/null -w "%{http_code}\n" http://y5876647.eero.online/
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
DATA_DIR=/var/lib/kids-landline node /opt/kids-landline/server/scripts/reset-password.mjs trevor 'correct-horse'
```

Tell them the new password privately. The UI also says “Forgot password? Ask the host.”

Legacy 6-digit **setup codes** still work for host bootstrap and old accounts (Sign in → “Use host setup code instead”). After a code login, parents should **Settings → Create username & password**. To mint fresh codes only:

```bash
DATA_DIR=/var/lib/kids-landline node /opt/kids-landline/server/scripts/reissue-codes.mjs
```

## Parent invite flow

1. Open the **public HTTPS** URL on your phone (not `http://10.0.5.x` — that breaks iPad mic and invite shares).
2. First parent (host): **Host bootstrap** with the **HOST SETUP CODE** from the server (`HOST_CODE.txt`), create household → softphone, then **Settings → Create username & password**.
3. Day-to-day: **Sign in** with username/password. **Invite family** → share the 6-digit invite code (invites are still codes; accounts are not).
4. Other parents: **I was invited** (or Create account) → username/password → redeem invite → add softphone.
5. Both sides approve each other → **Call**.

Invite links use `PUBLIC_BASE_URL` (`https://y5876647.eero.online:8443` on the lab). LAN `http://10.0.5.106:8787` is fine for browsing on Wi‑Fi, but **calls and invite shares need that HTTPS URL**.

### Bridged (ATA ↔ softphone)

The ARI bridge terminates WebRTC toward softphones. It must use the **same coturn** as `/api/ice`, or off-LAN softphones will **ring with no audio** while softphone↔softphone still works. `phonehome-bridge` reads `TURN_*` from `/var/lib/kids-landline/bridge.env` (also synced by `deploy/phonehome-sync-public-url.sh`). Lab LAN TURN should be **coturn on PVE** (`turn:10.0.5.31:3478`), not the PhoneHome CT IP.

## Docker alternative

```bash
cd deploy && docker compose up -d --build
```

Then put HTTPS in front (Caddy, Traefik, or Cloudflare Tunnel) the same way.

## TURN (required for many cross-home calls)

Signaling goes through your HTTPS URL. **Voice is peer-to-peer WebRTC** — Caddy/HTTPS does **not** relay RTP. When both callers are on different home/carrier NATs (especially symmetric NAT), STUN alone fails and you need **TURN**.

### Lab setup (coturn on Proxmox host)

On `root@10.0.5.31` (PVE):

| Piece | Value |
| --- | --- |
| Service | `coturn.service` |
| Config | `/etc/turnserver.conf` |
| Creds file | `/root/.kids-landline-turn-creds` |
| Listen | UDP/TCP **3478** |
| Relay ports | UDP **49160–49200** |
| Public WAN | Frontier IP (check with `curl -4 ifconfig.me` on PVE) |
| Bind / relay | `10.0.5.31` |

PhoneHome CT (`122`) must advertise the **public** TURN URL:

```bash
# in kids-landline.service on CT 122
Environment=TURN_URLS=turn:YOUR.PUBLIC.IP:3478
Environment=TURN_USERNAME=kidslandline
Environment=TURN_CREDENTIAL=...   # from /root/.kids-landline-turn-creds on PVE
```

Verify: `curl -sS http://10.0.5.106:8787/api/ice` should include a `turn:` entry (not only Google STUN).

### eero port forwards (required for internet callers)

On the eero app → **Settings → Network → Reservations & port forwarding** (wording varies), forward to **10.0.5.31**:

1. **UDP 3478** → 10.0.5.31:3478 (TURN/STUN)
2. **TCP 3478** → 10.0.5.31:3478 (fallback when UDP is blocked)
3. **UDP 49160–49200** → 10.0.5.31 (TURN media relays)

Without those forwards, `/api/ice` can list TURN but phones **outside** Trevor’s LAN cannot allocate a relay.

### How to test

1. Confirm `/api/ice` returns TURN.
2. Phone A on **cellular**, phone B on a **different home Wi‑Fi** (not Trevor’s LAN).
3. Both open the HTTPS trycloudflare URL, sign in, approve each other, Call.
4. If it fails, flash may say the network may need TURN — check eero forwards + `journalctl -u coturn -n 50` on PVE.

LAN-only friends can still call without public TURN when hairpin/host candidates work; cousins on other networks need the forwards above.
