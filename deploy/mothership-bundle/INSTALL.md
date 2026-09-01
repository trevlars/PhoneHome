# Install PhoneHome Mothership (download bundle)

## macOS — 3 steps

1. **Unzip** the `.zip` from [GitHub Releases](https://github.com/trevlars/PhoneHome/releases)  
   (Double-click the download. You get a folder named `phonehome-mothership`.)

2. **Open that folder** and double-click **`Install PhoneHome Mothership.command`**

   macOS may block it the first time:
   - **Right-click** the file → **Open** → **Open** again  
   - Or: **System Settings → Privacy & Security → Open Anyway**

3. **Terminal opens** — answer 2 questions (HTTPS URL is optional; you can add it later).  
   Browser opens **http://127.0.0.1:8787** when done.

**Setup code** is on that page (also in `~/.phonehome/HOST_CODE.txt`).

### Add HTTPS later (for phones)

```bash
cloudflared tunnel --url http://127.0.0.1:8787
# Copy the https://….trycloudflare.com URL
nano ~/.phonehome/phonehome.env   # set PUBLIC_BASE_URL=...
launchctl kickstart -k gui/$(id -u)/com.phonehome.server
```

## Linux

```bash
unzip phonehome-mothership-*.zip   # or tar -xzf for .tar.gz
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
