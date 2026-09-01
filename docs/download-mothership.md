# Download Mothership

**Mothership** = the always-on PhoneHome server. Download a bundle — no Git, no Node.js install.

**Releases:** [github.com/trevlars/PhoneHome/releases](https://github.com/trevlars/PhoneHome/releases)

## macOS (Apple Silicon)

This is the annoying part on Mac — here's the exact sequence:

### 1. Download & unzip

- Download `phonehome-mothership-*-darwin-arm64.zip` from Releases
- **Double-click the `.zip`** in Downloads — Finder creates a folder `phonehome-mothership`
- Open that folder

> **Don't** try to run anything inside the `.zip` without unzipping first.

### 2. Run the installer

Double-click **`Install PhoneHome Mothership.command`**

If macOS says *"can't be opened"* or *"unidentified developer"*:

1. **Right-click** (or Control-click) the file
2. Choose **Open**
3. Click **Open** in the dialog

Still blocked? **System Settings → Privacy & Security** → scroll down → **Open Anyway**

The installer clears macOS quarantine automatically, but Gatekeeper may still ask once.

### 3. Terminal — two questions

- **HTTPS URL** — paste your public URL, or press **Enter** to skip (add later)
- **Analog landline?** — press **Enter** for No (softphones only)

Browser opens **http://127.0.0.1:8787** when finished. Use the setup code on that page.

### HTTPS for phones (when ready)

In Terminal:

```bash
brew install cloudflared
cloudflared tunnel --url http://127.0.0.1:8787
```

Copy the `https://….trycloudflare.com` URL, then:

```bash
nano ~/.phonehome/phonehome.env
# Set PUBLIC_BASE_URL=https://your-url
launchctl kickstart -k gui/$(id -u)/com.phonehome.server
```

Parents open that HTTPS URL on their phones.

---

## Linux

```bash
unzip phonehome-mothership-*-linux-x64.zip
cd phonehome-mothership
./install-mothership.sh
sudo loginctl enable-linger "$USER"
```

## Windows

Unzip, then double-click **`install-mothership.ps1`** (or right-click → Run with PowerShell).

---

## Pick the right download

| Computer | File |
| --- | --- |
| Mac (M1/M2/M3/M4) | `*-darwin-arm64.zip` |
| Mac (Intel) | Build from source — [git path](#from-source) |
| Linux PC / NUC | `*-linux-x64.zip` or `.tar.gz` |
| Raspberry Pi / ARM | `*-linux-arm64.zip` or `.tar.gz` |
| Windows | `*-win-x64.zip` |

## From source

```bash
git clone https://github.com/trevlars/PhoneHome.git
cd PhoneHome && npm install && npm run build
./deploy/phonehome-init.sh && ./deploy/install-service.sh
```

Full stack (analog, TURN, FreePBX): [`self-host.md`](./self-host.md).
