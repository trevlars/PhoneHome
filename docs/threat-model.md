# Threat model (short)

**Pillar:** [`privacy-security.md`](./privacy-security.md) — encryption and kids’ privacy are release-critical.

| Threat | Mitigation |
| --- | --- |
| Random internet caller | No open dialtone; **allowlist** only |
| Stolen invite | Short TTL (48h, co-parent codes too), single-use |
| Guessing 6-digit invite / guardian / setup codes | Failed-try limits: 10 per account + 30 per IP per 15 min on invite peek/redeem and co-parent redeem; setup-code login 10 per IP; password login 10 per username + 50 per IP (`attemptLimiter.ts`, in-memory, resets on restart) |
| Circle (sphere) drift permits a polluted cross-Pod allowlist | **Mitigated:** cross-Pod calls and voicemail require both mutual allowlist policy and a shared Circle. `spheres_backfill_v2` repairs legacy owner-Circle bridges without fanning contacts across co-parents; `sphereGate.test.ts` verifies deny-by-default behavior |
| ISP / Wi‑Fi snooping | Softphone: **TLS signaling + DTLS-SRTP**. Analog: **SIP TLS + SRTP**. App: **HTTPS** |
| Passive SIP scanners on public IP | TLS on **5061** (not cleartext 5060); strong ext passwords; fail2ban; narrow RTP |
| eero still forwards **UDP 5060** to FreePBX (found Sep 2026: scanners hit the `0.0.0.0-udp` transport at ~2 pkt/s, 27k fail2ban bans) | **Mitigated on the CT:** `phonehome-sip-lanonly.service` drops UDP 5060 from non-RFC1918 sources (`bridged/freepbx/phonehome-sip-lanonly.sh`, installed by `deploy/proxmox-rsync.sh`). Nothing uses cleartext SIP: ATAs are TLS 5061 via the proxy, softphones are WebRTC. **Still to do:** delete the UDP 5060 forward in the eero app |
| Server / FreePBX operator | Softphone media not stored; no audio archive by default. FXS bridge **does** terminate media — harden that host |
| Compromised managed Mothership steals the Apple push credential | Managed tenants never receive the APNs `.p8`; a rate-limited gateway accepts short-lived per-instance tokens and minimal wake metadata only. Device tokens remain in the tenant database |
| Stolen ATA / Hub | Physical access ≈ landline risk; rotate SIP secret; change admin password on setup |
| Stolen / unlocked iPhone | Session + saved password live in the **device Keychain** (not iCloud). Face ID is required to read the password. Treat a stolen unlocked phone like a stolen house key. |
| Invited family abuse | Per-line allowlist; revoke; quiet hours; kill switch |
| Bad-actor adult harvesting kids’ friends | **Circles = children**; invite-first add; no global kid directory; directory/presence scoped to **viewer’s own discovery** (not everyone on the Mothership); kids cannot approve/add contacts; **friend invites** stay on one child’s Circle (not Pod membership) |
| Soft-hub phone away | Explicit offline state |
| Silent surveillance feature creep | TreeHouse parent listen-only is **announced room-wide** + child-mirrored mix (`docs/family-mesh.md`, `listen-in-future.md`). No silent god-mix. 1:1 parallel pickup still future/opt-in/audited |
| Weak or factory ATA passwords | Push-provision sets strong admin + generated SIP secret |
| Self-signed / unvalidated SIP TLS | **Mitigated:** Let’s Encrypt on SIP FQDN + ATA cert validate on. LAN-IP-only configs still skip validate (documented escape hatch) |
| ATA admin push over self-signed HTTPS | **Accepted, scoped:** one-tap setup skips cert validation for RFC1918 hosts only (`ht801Remote.ts`); LAN attacker during setup could capture admin + SIP secrets. Manual "Download config" avoids it |
| SIP secret drift (PhoneHome vs FreePBX) | **Open:** re-running setup can mint a new SIP secret the PBX never learns; adapter then fails auth and shows only "Offline" |
| SIP TLS proxy masks client IPs → fail2ban self-ban (availability) | **Partly mitigated:** every analog REGISTER reaches Asterisk from the socat proxy `192.168.2.31`, so a handful of failed auths banned the proxy and killed *all* analog SIP at once. `jail.d/zz-phonehome-trusted.local` now whitelists `192.168.1.0/24` + `192.168.2.0/24`; `deploy/phonehome-doctor.sh` detects a recurrence |

**Residual risk of that whitelist:** fail2ban can no longer ban real attackers who arrive over TLS 5061 through the proxy, because their source IP is rewritten to `192.168.2.31` before Asterisk sees it. Brute-force protection on the public SIP path is effectively off; strong per-extension secrets and TLS are what is left.

**Recommended follow-up (not implemented):** forward eero **TCP 5061 → FreePBX `192.168.2.105`** directly and retire the socat proxy, so Asterisk sees real client IPs. fail2ban then bans attackers again, the LAN whitelist stops hiding anything, and one bad adapter can no longer take the whole analog path down.

Physical phone / Hub access = landline-equivalent risk for that handset.

## Explicit non-goals (Stage 1)

- PSTN anonymity / anti-subpoena theater
- Protecting a household from its own consented parent controls
- Claiming “E2E” for softphone↔analog when FreePBX bridges codecs/crypto

## Regression checklist

Before shipping crypto-related changes:

- [ ] Softphone calls still DTLS-SRTP on HTTPS origin
- [ ] HT801 XML still TLS+SRTP forced for public SIP
- [ ] No new logging of secrets or media
- [ ] `docs/privacy-security.md` updated if a hop decrypts media
