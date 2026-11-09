# Install PhoneHome Mothership (download bundle)

> **Mac users:** the easier path is the **`PhoneHome-Mothership-*-macos.dmg`** menu bar app from the same
> release — drag to Applications and launch. Use this zip bundle only if you prefer a Terminal install.

## macOS — 3 steps

1. **Unzip** the `.zip` from [GitHub Releases](https://github.com/trevlars/PhoneHome/releases)  
   (Double-click the download. You get a folder named `phonehome-mothership`.)

2. **Open that folder** and double-click **`Install PhoneHome Mothership.command`**

   macOS may block it the first time:
   - **Right-click** the file → **Open** → **Open** again  
   - Or: **System Settings → Privacy & Security → Open Anyway**

3. **Terminal opens** — DuckDNS subdomain + token (recommended), or skip and add later.  
   Browser opens **http://127.0.0.1:8787** when done.

**Setup code** is on that page (also in `~/.phonehome/HOST_CODE.txt`).

### DuckDNS (recommended)

1. Create a free hostname at [duckdns.org](https://www.duckdns.org) — pick a subdomain, copy the **token**.
2. Enter both during install (or later in `~/.phonehome/phonehome.env`).
3. Mothership keeps the IP updated automatically while it runs.
4. Put **HTTPS** in front of PhoneHome (`:8787`) and forward that port on your router  
   (e.g. Caddy + Let’s Encrypt on `https://yourname.duckdns.org:8443`).

Env keys: `DUCKDNS_DOMAIN`, `DUCKDNS_TOKEN`, `DUCKDNS_HTTPS_PORT` (default `8443`).

### Other HTTPS options

```bash
# Cloudflare quick tunnel (no port forward; URL changes unless you use a named tunnel)
cloudflared tunnel --url http://127.0.0.1:8787
# Copy the https://….trycloudflare.com URL → PUBLIC_BASE_URL in phonehome.env
launchctl kickstart -k gui/$(id -u)/com.phonehome.server
```

Or set `PUBLIC_BASE_URL` to your own domain’s HTTPS URL.

## Linux

```bash
tar -xzf phonehome-mothership-*-linux-*.tar.gz
cd phonehome-mothership
./install-mothership.sh
sudo loginctl enable-linger "$USER"
```

## Windows

1. Unzip the `.zip`
2. Double-click **`install-mothership.ps1`**  
   If blocked: right-click → **Run with PowerShell**

## Files

| File | Purpose |
| --- | --- |
| `START HERE.txt` | Plain-English steps |
| `Install PhoneHome Mothership.command` | macOS installer |
| `install-mothership.sh` / `.ps1` | Linux / Windows installer |
| `~/.phonehome/` | Config and logs after install |

## Analog (HT801)

Say **yes** when asked about a house phone adapter, then see `docs/self-host.md`.
