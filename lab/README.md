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

## Stage 2 — HT801 attach (when ready)

1. Keep Stage 1 trunk running (or Digits/`bridged` SIP gateway).  
2. Factory HT801 → LAN.  
3. Provision SIP toward Hub SIP realm (see `docs/hub-provisioning.md`).  
4. Add line type `ata` in parent app.  
5. Allowlist kitchen line ↔ cousin softphone.

FreePBX at `10.0.5.105` remains optional SIP glue until `bridged/` lands.

## Automated checks

```bash
npm test -w server
```
