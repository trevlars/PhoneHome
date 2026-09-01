# Download Mothership

**Mothership** = the always-on PhoneHome server.

## macOS — use the menu bar app (recommended)

Download **`PhoneHome-Mothership-*-macos.dmg`** from [GitHub Releases](https://github.com/trevlars/PhoneHome/releases).

1. Open the DMG
2. Drag **PhoneHome Mothership** to **Applications**
3. Launch it — look for the **phone icon** in the menu bar (top right)
4. **Preferences** → optional HTTPS URL → **Save & restart**

Signed builds install like any normal Mac app — no Terminal, no quarantine hacks, no `.command` scripts.

Full details: [`macos-mothership.md`](./macos-mothership.md)

### HTTPS for phones

```bash
brew install cloudflared
cloudflared tunnel --url http://127.0.0.1:8787
```

Paste the `https://….trycloudflare.com` URL in the app’s Preferences.

---

## Linux

```bash
unzip phonehome-mothership-*-linux-x64.zip
cd phonehome-mothership
./install-mothership.sh
sudo loginctl enable-linger "$USER"
```

## Windows

Unzip, then run **`install-mothership.ps1`**.

---

## Pick the right download

| Computer | File |
| --- | --- |
| **Mac (Apple Silicon)** | `PhoneHome-Mothership-*-macos.dmg` |
| Mac (Intel) | Coming soon — build from source |
| Linux PC / NUC | `*-linux-x64.zip` |
| Raspberry Pi / ARM | `*-linux-arm64.zip` |
| Windows | `*-win-x64.zip` |

## From source

```bash
git clone https://github.com/trevlars/PhoneHome.git
cd PhoneHome && npm install && npm run build
./deploy/phonehome-init.sh && ./deploy/install-service.sh
```

Analog / FreePBX: [`self-host.md`](./self-host.md).
