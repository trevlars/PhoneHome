# Download Mothership

**Mothership** = the always-on PhoneHome server. These downloads are for parents who want **install and forget** — no Git, no separate Node.js install.

## Get a release

1. Open **[GitHub Releases](https://github.com/trevlars/PhoneHome/releases)** (tag `v0.1.0` or newer).
2. Download the file for your computer:

| Your computer | Download |
| --- | --- |
| Mac (M1/M2/M3/M4) | `phonehome-mothership-v*-darwin-arm64.tar.gz` |
| Mac (Intel) | `phonehome-mothership-v*-darwin-x64.tar.gz` |
| Linux PC / NUC (64-bit) | `phonehome-mothership-v*-linux-x64.tar.gz` |
| Raspberry Pi / ARM Linux | `phonehome-mothership-v*-linux-arm64.tar.gz` |
| Windows 10/11 | `phonehome-mothership-v*-win-x64.zip` |

Each bundle includes **Node.js**, the hub, bridge, and web UI — built and ready to run.

## Install

### macOS

```bash
tar -xzf phonehome-mothership-v*-darwin-arm64.tar.gz
cd phonehome-mothership
```

Double-click **`Install PhoneHome Mothership.command`**, or run `./install-mothership.sh`.

### Linux

```bash
tar -xzf phonehome-mothership-v*-linux-x64.tar.gz
cd phonehome-mothership
./install-mothership.sh
sudo loginctl enable-linger "$USER"   # keep running after logout
```

### Windows

Unzip, then in PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install-mothership.ps1
```

## After install

1. Set a **public HTTPS URL** during setup (e.g. [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) → `https://….trycloudflare.com`).
2. Open that URL on your phone → enter the **Mothership setup code** (also in `~/.phonehome` / `%USERPROFILE%\.phonehome` logs on first boot).
3. Create your **Pod** (household), invite cousins, add **Circles**.

Full stack (analog HT801, TURN, FreePBX): **[`self-host.md`](./self-host.md)**.

## Developer / git path

If you are hacking on PhoneHome or need the latest `master` without waiting for a release:

```bash
git clone https://github.com/trevlars/PhoneHome.git
cd PhoneHome && npm install && npm run build
./deploy/phonehome-init.sh && ./deploy/install-service.sh
```

## Building bundles yourself

```bash
npm ci && npm run build
./deploy/build-mothership-bundle.sh
# → dist/phonehome-mothership-v0.1.0-<platform>.tar.gz|.zip
```

CI builds all five platforms on every `v*` tag (see `.github/workflows/mothership-release.yml`).
