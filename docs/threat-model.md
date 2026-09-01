# Threat model (short)

**Pillar:** [`privacy-security.md`](./privacy-security.md) — encryption and kids’ privacy are release-critical.

| Threat | Mitigation |
| --- | --- |
| Random internet caller | No open dialtone; **allowlist** only |
| Stolen invite | Short TTL, single-use |
| ISP / Wi‑Fi snooping | Softphone: **TLS signaling + DTLS-SRTP**. Analog: **SIP TLS + SRTP**. App: **HTTPS** |
| Passive SIP scanners on public IP | TLS on **5061** (not cleartext 5060); strong ext passwords; fail2ban; narrow RTP |
| Server / FreePBX operator | Softphone media not stored; no audio archive by default. FXS bridge **does** terminate media — harden that host |
| Stolen ATA / Hub | Physical access ≈ landline risk; rotate SIP secret; change admin password on setup |
| Stolen / unlocked iPhone | Session + saved password live in the **device Keychain** (not iCloud). Face ID is required to read the password. Treat a stolen unlocked phone like a stolen house key. |
| Invited family abuse | Per-line allowlist; revoke; quiet hours; kill switch |
| Bad-actor adult harvesting kids’ friends | **Parent Circles** (one per parent); invite-first add; no global kid directory; directory/presence scoped to **viewer’s own Circle** (not everyone on the Mothership); kids cannot approve/add contacts |
| Soft-hub phone away | Explicit offline state |
| Silent surveillance feature creep | TreeHouse parent listen-only is **announced room-wide** + child-mirrored mix (`docs/family-mesh.md`, `listen-in-future.md`). No silent god-mix. 1:1 parallel pickup still future/opt-in/audited |
| Weak or factory ATA passwords | Push-provision sets strong admin + generated SIP secret |
| Self-signed / unvalidated SIP TLS | **Mitigated:** Let’s Encrypt on SIP FQDN + ATA cert validate on. LAN-IP-only configs still skip validate (documented escape hatch) |
| ATA admin push over self-signed HTTPS | **Accepted, scoped:** one-tap setup skips cert validation for RFC1918 hosts only (`ht801Remote.ts`); LAN attacker during setup could capture admin + SIP secrets. Manual "Download config" avoids it |
| SIP secret drift (PhoneHome vs FreePBX) | **Open:** re-running setup can mint a new SIP secret the PBX never learns; adapter then fails auth and shows only "Offline" |
| SIP TLS proxy masks client IPs → fail2ban self-ban (availability) | **Partly mitigated:** every analog REGISTER reaches Asterisk from the socat proxy `10.0.5.31`, so a handful of failed auths banned the proxy and killed *all* analog SIP at once. `jail.d/zz-phonehome-trusted.local` now whitelists `10.0.4.0/24` + `10.0.5.0/24`; `deploy/phonehome-doctor.sh` detects a recurrence |

**Residual risk of that whitelist:** fail2ban can no longer ban real attackers who arrive over TLS 5061 through the proxy, because their source IP is rewritten to `10.0.5.31` before Asterisk sees it. Brute-force protection on the public SIP path is effectively off; strong per-extension secrets and TLS are what is left.

**Recommended follow-up (not implemented):** forward eero **TCP 5061 → FreePBX `10.0.5.105`** directly and retire the socat proxy, so Asterisk sees real client IPs. fail2ban then bans attackers again, the LAN whitelist stops hiding anything, and one bad adapter can no longer take the whole analog path down.

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
