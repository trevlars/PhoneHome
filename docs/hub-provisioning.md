# Hub / ATA provisioning (Stage 2+)

## Goals

Non-technical parent: power on → WiFi/Ethernet → pair line in under 10 minutes. Never open Grandstream admin.

## Hub first-boot

1. Captive portal or `http://hub.local` setup wizard.  
2. Claim Hub with setup code (same parent account model as Stage 1).  
3. Create/select household.  
4. **Add line** → ATA or built-in FXS.  
5. Optional: join existing softphone trunk URL if Hub is leaf (rare) vs Hub-as-trunk (default).

## Grandstream HT801 auto-provision

1. Hub DHCP + option 66 / TR-069 / Grandstream zero-config XML.  
2. Push SIP credentials pointing at Hub `bridged` SIP realm (LAN only).  
3. Dialplan: allowlist enforced on Hub, not ATA.  
4. Admin password randomized; UI not exposed to parent.  
5. Status LEDs documented in parent guide.

## Security

- No public UDP 5060.  
- ATA only talks to Hub on LAN.  
- Softphones / remote parents use TLS/WSS to trunk.  
- OTA signed Hub images (`hub-os/`).
