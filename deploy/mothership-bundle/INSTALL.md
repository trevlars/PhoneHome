# Install PhoneHome Mothership (download bundle)

You downloaded a **Mothership** — the always-on PhoneHome server. No Git required; Node.js is included in this folder.

## Quick start

### macOS

1. Unzip the `.tar.gz`
2. Double-click **`Install PhoneHome Mothership.command`**  
   — or in Terminal: `./install-mothership.sh`
3. Follow prompts (HTTPS URL, FreePBX if analog)
4. Open your **PUBLIC_BASE_URL** on a phone → Mothership setup code → create your **Pod**

### Linux

```bash
tar -xzf phonehome-mothership-v*.tar.gz
cd phonehome-mothership
./install-mothership.sh
```

Enable linger so it stays up after logout:

```bash
sudo loginctl enable-linger "$USER"
```

### Windows

1. Unzip the `.zip`
2. Right-click **PowerShell → Run as Administrator** (optional; user task works too)
3. `cd` to the folder, then:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install-mothership.ps1
```

## What gets installed

- Background service (LaunchAgent / systemd / Scheduled Task)
- Hub + bridge via `deploy/phonehome-supervisor.mjs`
- Config in `%USERPROFILE%\.phonehome` (Windows) or `~/.phonehome` (Mac/Linux)

## HTTPS required

Phones need **https://** for microphone access. Easiest: [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) pointing at port 8787, then set that URL in setup.

## Analog (HT801)

See `docs/self-host.md` and run `./deploy/setup-analog.sh` after install.

## Terms

- **Mothership** = this server  
- **Pod** = your family on it  
- **Circle** = each parent’s approved contacts  

Full glossary: `docs/glossary.md`
