# Hub / ATA provisioning (Stage 2+)

## Goals

Non-technical parent: power on → WiFi/Ethernet → pair line in under 10 minutes. Never open Grandstream admin.

## Hub first-boot

1. Captive portal or `http://hub.local` setup wizard.  
2. Claim Hub with setup code (same parent account model as Stage 1).  
3. Create/select household.  
4. **Add line** → ATA or built-in FXS.  
5. Optional: join an existing Mothership URL if Hub is leaf (rare) vs Hub-as-Mothership (default).

## Grandstream HT801 auto-provision

PhoneHome can generate HT801 `config.xml` (P-values) and serve it over HTTPS:

1. Parent → **Analog Phone / HT801** → save SIP extension/password → **Download config.xml** or copy **Config Server Path** (or **Set up adapter** one-tap when the Mothership is on the same LAN as the ATA — the parent app being on Wi‑Fi is not enough).
2. ATA: Maintenance → Upload Configuration, **or** set Config Server Path to  
   `host:port/provision/<token>` (device requests `cfg{mac}.xml` then `cfg.xml`).
3. SIP credentials point at household FreePBX / Hub SIP realm (lab: `10.0.5.105`).
4. Dialplan + `bridged/` enforce allowlist speed-dial; ATA does not store the family directory.

XML sets **Config Server Path** (`P237`) and **clears Firmware Server Path** (`P192`). Status **“Firmware server is not configured”** is expected and does **not** block SIP or config provision — see `docs/ht801-lab.md` § “Firmware server is not configured”.

See `docs/ht801-lab.md` and `bridged/README.md`.

## Security

- No public UDP 5060.  
- ATA only talks to Hub on LAN.  
- Softphones / remote parents use TLS/WSS to the Mothership.  
- OTA signed Hub images (`hub-os/`).
