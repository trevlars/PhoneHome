# Managed Mothership

> **Not the primary product SKU.** Most families should **self-host** (HAOS / Docker)
> with a **30-day trial → $25/year** signed host license — see [`host-license.md`](./host-license.md).
> This doc describes an optional PhoneHome-operated VPS path (higher price, ops-heavy).
> Reuse the control plane for host-license Stripe signing; do not market managed VPS as the default story.

One managed customer gets one isolated cloud VPS and one PhoneHome database.
Pods are households inside that customer’s extended-family network; unrelated
customers never share a Mothership process, SQLite database, TURN credentials,
SIP credentials, or backup.

## Commercial boundary

- The Mothership operator pays PhoneHome for managed infrastructure.
- The free iOS/PWA client connects to that operator’s HTTPS URL.
- Optional Circle billing remains between the operator and their relatives.
  PhoneHome does not process or take a cut of those payments.
- Stage 1 has no PSTN or emergency calling. PhoneHome must not be presented as a
  911-capable telephone replacement.

## Subscription and provisioning flow

1. The operator selects a configured Stripe price and completes hosted Checkout.
2. The control plane verifies the signed Stripe webhook and records only billing
   identity, subscription, instance, and entitlement metadata.
3. A new instance receives a one-time 32-byte secret. The database stores only
   a scrypt verifier.
4. The control plane dispatches a signed provisioning webhook. Cloud automation
   creates the tenant VPS, writes its instance credentials, and returns the
   public URL through the admin status endpoint.
5. The Mothership polls its entitlements. Explicit host environment limits
   override managed limits; a temporary control-plane outage never interrupts
   existing calls.

Circle billing stays in the tenant database and never enters Stripe or the
central control database.

Central services run from
[`deploy/managed-services/docker-compose.yml`](../deploy/managed-services/docker-compose.yml).
The APNs key is mounted only into the push gateway.

## Tenant topology

The first managed deployment uses one Ubuntu/Debian VPS:

| Service | Exposure |
| --- | --- |
| Caddy → PhoneHome hub | TCP/UDP 443 |
| coturn | TCP/UDP 3478, UDP 49160–49200 |
| Asterisk/FreePBX SIP TLS | TCP 5061 |
| Asterisk SRTP | UDP 10000–10200 |
| WebRTC/SIP bridge RTP | UDP 14000–14050 |

Hub and bridge run in Docker from
[`deploy/managed/docker-compose.yml`](../deploy/managed/docker-compose.yml).
FreePBX/Asterisk runs on the host so it can bind SIP TLS directly and retain
real client IPs for fail2ban. Public UDP 5060 is never opened.

## Bootstrap

```bash
sudo ./deploy/managed/bootstrap-vps.sh
```

Then:

1. Install FreePBX/Asterisk on the VPS.
2. Point DNS `family.example.com` at the VPS.
3. Set `SIP_HOST=family.example.com` and run
   `sudo ./deploy/managed/install-freepbx-overlays.sh`.
4. Edit `deploy/managed/.env`.
5. Start the tenant:

```bash
docker compose \
  -f deploy/managed/docker-compose.yml \
  --env-file deploy/managed/.env \
  up -d --build
```

6. After Caddy obtains the HTTPS certificate:

```bash
sudo SIP_HOST=family.example.com ./deploy/managed/sync-sip-cert.sh
```

Install the existing certificate-sync systemd timer or schedule that command
daily so Asterisk follows Caddy renewals.

## Analog phones

Managed cloud tenants always use `ATA_LAN_PUSH=0`. The Mothership cannot safely
log into an HT801 on a customer’s private LAN. Parents:

1. Create/save the Analog Phone in PhoneHome.
2. Download the generated configuration.
3. Upload it to the HT801 locally and reboot.

The generated profile requires SIP TLS and SRTP (`P130=2`, `P183=2`) and
validates the public certificate for the configured hostname.

## Validation

```bash
curl -fsS https://family.example.com/api/health
openssl s_client \
  -connect family.example.com:5061 \
  -servername family.example.com </dev/null
sudo asterisk -rx "pjsip show contacts"
sudo asterisk -rx "rtp show settings"
docker compose -f deploy/managed/docker-compose.yml ps
```

Cross-network acceptance must cover:

- iPhone ↔ iPhone on Wi-Fi and cellular
- HT801 ↔ iPhone in both directions
- HT801 ↔ HT801
- Hold/resume and first-party hangup from each endpoint
- Service restart, TURN relay, missed call, and voicemail

## Backups, monitoring, and upgrades

Managed backups use restic so tenant data and credentials are encrypted before
leaving the VPS.

```bash
cp deploy/managed/restic.env.example deploy/managed/restic.env
chmod 600 deploy/managed/restic.env
sudo ./deploy/managed/install-ops.sh
sudo ./deploy/managed/backup.sh
```

The backup job makes a consistent SQLite snapshot, includes the tenant runtime
configuration and Asterisk overlays, applies daily/weekly/monthly retention,
prunes old data, and verifies a repository subset. A restore stops the tenant,
preserves a local rollback copy, restores, starts the stack, and requires the
public health endpoint to pass:

```bash
sudo ./deploy/managed/restore.sh
```

Versioned upgrades require a clean checkout, take an encrypted backup, switch
to a release tag, rebuild, and run the health gate. A failed gate automatically
returns to the prior commit:

```bash
sudo ./deploy/managed/upgrade.sh vX.Y.Z
```

`monitor.sh` checks HTTPS, SIP TLS certificate expiry, containers, and disk
capacity every five minutes. Optional success/failure ping URLs integrate with
an external uptime service.

For support, generate a redacted bundle:

```bash
sudo ./deploy/managed/support-bundle.sh
```

It intentionally excludes env files, passwords, device tokens, SDP, voicemail,
call content, and full SIP contact addresses.

## Incident and deletion procedure

1. Suspend new provisioning in the control plane; do not interrupt an active
   family call solely because billing or control services are unavailable.
2. Preserve an encrypted tenant backup and record the deployed commit.
3. Rotate the instance secret, TURN credential, bridge secret, FreePBX sync
   token, SIP credentials, and any exposed provider credentials.
4. Restore to a clean VPS and verify the complete softphone/analog matrix.
5. For cancellation, provide the operator’s encrypted export, revoke central
   push/control credentials, delete cloud snapshots after the retention window,
   then mark the instance `deleted`. Never recycle its hostname or secrets.

## Security invariants

- Family databases and secrets stay on their tenant VPS.
- The central control plane stores subscription and instance metadata only.
- The push gateway receives minimal wake metadata, never SDP or media.
- SIP passwords, APNs credentials, SRTP material, and SDP crypto lines are
  never included in support logs or backups outside the encrypted tenant set.
- Direct SIP TLS is preferred over the lab’s source-IP-masking proxy.

See [`privacy-security.md`](./privacy-security.md),
[`threat-model.md`](./threat-model.md), and [`ht801-lab.md`](./ht801-lab.md).
