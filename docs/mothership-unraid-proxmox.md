# Mothership on Unraid & Proxmox VE

Run PhoneHome **Mothership** on a homelab NAS or hypervisor — same hub + bridge stack as the Mac/Linux download bundles, packaged for Docker (Unraid) or LXC (Proxmox).

**Terms:** [`glossary.md`](./glossary.md) · **Full self-host:** [`self-host.md`](./self-host.md)

---

## Unraid (Docker)

### Quick install — Community Apps template

1. In Unraid **Apps**, add a custom template URL (or paste from repo):
   `https://raw.githubusercontent.com/trevlars/PhoneHome/master/deploy/unraid/phonehome-mothership.xml`
2. Install **phonehome-mothership** from the template.
3. Set **Appdata** to `/mnt/user/appdata/phonehome-mothership` (default).
4. Set **PUBLIC_BASE_URL** to your **HTTPS** URL (phones need TLS for the mic).
5. Start the container → open `http://<unraid-ip>:8787` on LAN for first setup.
6. Mothership setup code: `appdata/phonehome-mothership/HOST_CODE.txt`

Image: `ghcr.io/trevlars/phonehome-mothership:latest` (built on each `v*` release tag).

### Docker Compose on Unraid

```bash
mkdir -p /mnt/user/appdata/phonehome-mothership
cp deploy/phonehome.env.example /mnt/user/appdata/phonehome-mothership/phonehome.env
# edit phonehome.env — PUBLIC_BASE_URL, TURN_*, optional FreePBX ARI_*
docker compose -f deploy/docker-compose.unraid.yml up -d
```

Compose file: [`deploy/docker-compose.unraid.yml`](../deploy/docker-compose.unraid.yml)

### HTTPS in front of Unraid

The container listens on **8787** (HTTP). Parents off-LAN need **HTTPS**:

| Option | Notes |
| --- | --- |
| **Nginx Proxy Manager** | Proxy `https://phonehome.example.com` → `http://<unraid-ip>:8787` |
| **SWAG / Caddy** | Same pattern on another container |
| **Cloudflare Tunnel** | `cloudflared` container → `http://phonehome-mothership:8787` |

Set `PUBLIC_BASE_URL` to that HTTPS origin.

### Analog (HT801) with Unraid

FreePBX does **not** run inside the Mothership container. Run FreePBX in another VM/LXC/container, then set:

| Variable | Example |
| --- | --- |
| `SIP_SERVER` | `10.0.0.50` (FreePBX LAN IP) |
| `ARI_URL` | `http://10.0.0.50:8088` |
| `EXT_MEDIA_HOST` | Unraid server LAN IP (bridge RTP) |
| `ATA_LAN_PUSH` | `1` if HT801 is on the same LAN as Unraid; `0` for remote-only |

Use **host.docker.internal** or the Unraid IP so the bridge can reach FreePBX on the LAN (`extra_hosts` is already in the compose file).

### Ports (Unraid)

| Port | Protocol | Purpose |
| --- | --- | --- |
| 8787 | TCP | Hub / parent UI |
| 8790 | TCP | Bridge health |
| 14000–14050 | UDP | Bridge media |

Also forward **TURN** (3478 + relays) and **SIP TLS 5061** + **RTP 10000–10200** on your router when cousins or analog adapters are remote — see [`self-host.md`](./self-host.md).

---

## Proxmox VE (LXC helper script)

One-liner on the **Proxmox host** (as root):

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/trevlars/PhoneHome/master/deploy/proxmox-ve-install.sh)"
```

The script:

1. Creates an **unprivileged Debian 12** LXC (DHCP on `vmbr0`).
2. Installs Mothership from the latest **GitHub release bundle** (falls back to git clone).
3. Enables `kids-landline` + `phonehome-bridge` systemd units.
4. Writes root password to `/root/phonehome-<ctid>.creds` on the PVE host.

### Unattended / lab

```bash
PHONEHOME_CTID=122 \
PHONEHOME_HOSTNAME=phonehome \
PHONEHOME_STORAGE=local-lvm \
PHONEHOME_BRIDGE=vmbr0 \
PHONEHOME_CORES=2 \
PHONEHOME_RAM=2048 \
PHONEHOME_DISK=8 \
bash deploy/proxmox-ve-install.sh
```

### After install

```bash
pct enter 122
nano /var/lib/kids-landline/phonehome.env   # PUBLIC_BASE_URL, TURN_*, SIP_*
systemctl restart kids-landline phonehome-bridge
cat /var/lib/kids-landline/HOST_CODE.txt
```

Put **HTTPS** on the PVE host (Caddy) or use Cloudflare Tunnel → `http://<ct-lan-ip>:8787`.

### Updates (existing CT)

From your dev machine or the PVE host:

```bash
./deploy/proxmox-rsync.sh root@192.168.2.31 122
```

### Community Scripts

The helper script is standalone today. To list in [Proxmox VE Helper Scripts](https://community-scripts.org/), open a PR adding `ct/phonehome.sh` that wraps `proxmox-ve-install.sh` — same pattern as other apps in [community-scripts/ProxmoxVE](https://github.com/community-scripts/ProxmoxVE).

---

## Docker image (any host)

Build locally:

```bash
docker build -f Dockerfile.mothership -t phonehome-mothership:local .
docker run -d --name phonehome \
  -p 8787:8787 -p 8790:8790 -p 14000-14050:14000-14050/udp \
  -v phonehome-data:/app/data \
  -e PUBLIC_BASE_URL=https://phonehome.example.com:8443 \
  --add-host=host.docker.internal:host-gateway \
  phonehome-mothership:local
```

Full stack with separate bridge container: [`deploy/docker-compose.full.yml`](../deploy/docker-compose.full.yml).

---

## Related

| Doc | Topic |
| --- | --- |
| [`self-host.md`](./self-host.md) | HTTPS, TURN, FreePBX, env reference |
| [`hosting.md`](./hosting.md) | example lab Proxmox layout |
| [`download-mothership.md`](./download-mothership.md) | Mac / Windows / bare-metal Linux bundles |
