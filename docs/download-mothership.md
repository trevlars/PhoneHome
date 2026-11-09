# Download Mothership

**Mothership** = the always-on PhoneHome server.

## macOS — use the menu bar app (recommended)

Download **`PhoneHome-Mothership-*-macos.dmg`** from [GitHub Releases](https://github.com/trevlars/PhoneHome/releases).

1. Open the DMG
2. Drag **PhoneHome Mothership** to **Applications**
3. Launch it — look for the **UFO icon** in the menu bar (top right)
4. **Preferences** → **DuckDNS** subdomain + token → **Test & apply** → **Save & restart**

If macOS says it can’t verify the developer, **right-click the app → Open** (one time only). Releases built with our Developer ID are notarized and skip that prompt.

Full details: [`macos-mothership.md`](./macos-mothership.md)

### HTTPS for phones

**Recommended — DuckDNS:** create a free name at [duckdns.org](https://www.duckdns.org), paste subdomain + token in Preferences. Mothership keeps DNS updated. Put HTTPS (Caddy / Let’s Encrypt) on that hostname and forward the port to this Mac `:8787`.

**Alternative — Cloudflare Tunnel** (no port forward):

```bash
brew install cloudflared
cloudflared tunnel --url http://127.0.0.1:8787
```

Paste the `https://….trycloudflare.com` URL under **Other HTTPS URL** in Preferences.

---

## Linux

```bash
tar -xzf phonehome-mothership-*-linux-x64.tar.gz   # or *-linux-arm64.tar.gz on a Pi
cd phonehome-mothership
./install-mothership.sh
sudo loginctl enable-linger "$USER"
```

## Windows

Unzip `*-win-x64.zip`, then run **`install-mothership.ps1`**.

---

## Homelab — Unraid & Proxmox VE

| Platform | Install |
| --- | --- |
| **Unraid** | Docker template — [`docs/mothership-unraid-proxmox.md`](./mothership-unraid-proxmox.md) |
| **Proxmox VE** | `bash -c "$(curl -fsSL https://raw.githubusercontent.com/trevlars/PhoneHome/master/deploy/proxmox-ve-install.sh)"` |

Image: `ghcr.io/trevlars/phonehome-mothership:latest` (published on release tags).

## Pick the right download

| Computer | File |
| --- | --- |
| **Mac (Apple Silicon)** | `PhoneHome-Mothership-*-macos.dmg` (menu bar app) — or `*-darwin-arm64.zip` + `Install PhoneHome Mothership.command` |
| Mac (Intel) | Coming soon — build from source |
| Linux PC / NUC | `*-linux-x64.tar.gz` |
| Raspberry Pi / ARM | `*-linux-arm64.tar.gz` |
| Windows | `*-win-x64.zip` |
| **Unraid / Docker** | `ghcr.io/trevlars/phonehome-mothership` |
| **Proxmox LXC** | VE helper script (see homelab table above) |

Every bundle includes Node.js 22 — nothing else to install.

## From source

```bash
git clone https://github.com/trevlars/PhoneHome.git
cd PhoneHome && npm install && npm run build
./deploy/phonehome-init.sh && ./deploy/install-service.sh
```

Analog / FreePBX: [`self-host.md`](./self-host.md).
