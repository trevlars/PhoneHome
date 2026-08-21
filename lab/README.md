# Lab runbook — Stage 1 softphones

## Softphone pilot (required)

```bash
cd /Users/trevor/Projects/kids-landline
npm install
npm run build -w web
npm run start -w server
```

1. Note **HOST SETUP CODE** from console / `data/bootstrap.json`.
2. Browser A: `http://localhost:8787` → sign in with code → create household → add softphone → Invite.
3. Browser B (private window): Register parent → redeem invite → add softphone.
4. Both allowlist → Call (allow microphone).

### Two devices on LAN

Bind is `0.0.0.0:8787`. Open `http://<host-lan-ip>:8787` from phones on the same Wi‑Fi. For cousins off-LAN, put a reverse proxy / tunnel in front (Caddy) — still no VPN on their phone.

## Stage 2 — HT801 attach (lab)

See **`docs/ht801-lab.md`**.

1. FreePBX extension **2001** is provisioned on `10.0.5.105` for the HT801.  
2. Configure the HT801 via its **web UI** (no Grandstream app) — SIP server `10.0.5.105`, user/pass in that doc.  
3. Plug RJ11 phone into the HT801 FXS port.  
4. Softphone bridging (`bridged/` SIP↔WebRTC → PhoneHome) is still TODO.

FreePBX at `10.0.5.105` is the SIP registrar until `bridged/` lands.

## Automated checks

```bash
npm test -w server
```
