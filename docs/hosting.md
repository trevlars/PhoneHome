# Hosting for parent testing

Stage 1 needs **HTTPS** so phones can use the microphone (secure context). Cousins only need the public URL + an invite — no VPN.

## Lab / always-on (Proxmox LXC)

Typical layout used in the trevlars lab:

| Piece | Value |
| --- | --- |
| CT | `kids-landline` (example id `122`) |
| LAN | `http://10.0.5.106:8787` |
| Data | `/var/lib/kids-landline` (`DATA_DIR`) |
| Host code | `/var/lib/kids-landline/HOST_CODE.txt` |
| Unit | `kids-landline.service` inside the CT |

Deploy / refresh from a checkout:

```bash
./deploy/proxmox-rsync.sh root@10.0.5.31 122
```

## Public HTTPS (Cloudflare quick tunnel)

Browsers on the internet cannot use raw LAN HTTP. For testing, run a **quick tunnel** on the Proxmox host (stays up when your laptop sleeps):

```bash
# on Proxmox host
cloudflared tunnel --url http://10.0.5.106:8787
```

Or as a systemd unit (see `deploy/cloudflared-quick.service`):

```bash
systemctl enable --now cloudflared-kids-landline
journalctl -u cloudflared-kids-landline -n 40 | grep trycloudflare
```

Quick tunnels get a random `*.trycloudflare.com` URL each restart. Fine for a weekend test; for a stable hostname, create a **named** Cloudflare tunnel and point a DNS record at it.

**Note:** Some networks block `api.trycloudflare.com` from inside LXCs. Running `cloudflared` on the Proxmox host (or a Mac on the LAN) avoids that.

## Parent invite flow

1. Open the public HTTPS URL on your phone.
2. First parent: enter the **HOST SETUP CODE** from the server (printed on boot / `HOST_CODE.txt`).
3. Create household → softphone → **Invite family** → share invite code.
4. Other parents: open the same URL → **I was invited** → redeem → add their softphone.
5. Both sides allowlist each other → **Call**.

LAN-only friends can use `http://10.0.5.106:8787` on Wi‑Fi; remote parents need the tunnel URL.

## Docker alternative

```bash
cd deploy && docker compose up -d --build
```

Then put HTTPS in front (Caddy, Traefik, or Cloudflare Tunnel) the same way.

## Optional TURN (hard NATs)

Signaling goes through your HTTPS URL; **voice is peer-to-peer WebRTC**. Some phone networks need a TURN relay. Set on the server:

```bash
TURN_URLS=turn:turn.example.com:3478
TURN_USERNAME=kids
TURN_CREDENTIAL=secret
```

The client loads these from `GET /api/ice`. Without TURN, many home/mobile calls still work via STUN alone.
