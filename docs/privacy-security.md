# Privacy & security pillar

**PhoneHome exists so kids and families can talk privately.** Encryption and security are not features bolted on later — they are a product pillar, equal to “it rings” and “parents can set rules.” Children’s conversations are a **legal and ethical** sensitivity zone. When tradeoffs appear, **protect the call** first.

This is an engineering / product commitment, not legal advice. Treat counsel as required before claiming compliance (COPPA, state privacy laws, wiretap rules, school/district policies, etc.).

## Non‑negotiables

1. **Encrypt voice in transit end-to-end where the architecture allows; otherwise encrypt every hop.**
   - Softphones: **WebRTC (DTLS-SRTP)** — media is peer-encrypted; the server brokers signaling only.
   - Analog (HT801 / FXS): **SIP TLS + SRTP (SDES)** between ATA and FreePBX. No public cleartext SIP/RTP as a supported path.
2. **HTTPS for the parent app and APIs** in any remote / multi-household deployment (secure context + session cookies).
3. **No call audio stored by default.** Do not record, archive, or upload call media unless a future feature is explicitly designed, parent-visible, audited, and legally reviewed.
4. **Allowlist-first calling.** Random internet dialing is out of scope; stolen invites expire and are single-use.
5. **Parents control kids’ lines; adults are not silently surveilled.** Future listen-in / parallel pickup (see `listen-in-future.md`) must be opt-in household policy, audited, and never marketed as invisible spyware between consenting adults.
6. **Minimize what we keep.** Prefer presence + allowlist metadata over transcripts, recordings, or third-party analytics on call content. Parent-initiated **hard delete** of a kid line or parent account erases credentials, sessions, allowlist rows (including other households’ contacts pointing at that line), call logs for that line, voicemails/greetings/avatars/ATA bindings, and invites — no soft-delete retention of content.
7. **Strong secrets by default.** Generated SIP passwords, no weak factory defaults on ATAs after setup, rotate on compromise.
## Why this is a pillar

| Concern | Product response |
| --- | --- |
| Child talking to grandma / cousin | Encrypted media; only invited, allowlisted parties |
| ISP / café Wi‑Fi snooping | TLS / DTLS-SRTP / SIP TLS+SRTP — not “trust the LAN” |
| Shared Stage‑1 server operator | Softphone media not in clear on the server; avoid logging SDP guts / passwords |
| Analog over the public internet | TLS 5061 + SRTP required; UDP 5060 is not a product path |
| Legal / privacy expectations | Design for privacy-by-default; document limits honestly; no overclaiming |

## Current architecture (honest)

| Path | Signaling | Media | Notes |
| --- | --- | --- | --- |
| Softphone ↔ softphone | WSS / HTTPS | DTLS-SRTP | Preferred; strongest story |
| Softphone ↔ analog | Via FreePBX / bridge | SRTP ↔ DTLS as Asterisk bridges | Server is in the media path for FXS — treat FreePBX host as sensitive |
| Analog ↔ FreePBX (remote) | SIP TLS `:5061` | SRTP | HT801 XML: `P130=2`, `P183=2`, `P8463=1` on FQDN |
| App / portal | HTTPS | n/a | Required off-LAN |

**Encryption debt (narrowed):**

- **Resolved (lab):** FreePBX SIP TLS uses the same **Let’s Encrypt** leaf Caddy already issues for `y5876647.eero.online` (`deploy/sync-phonehome-sip-cert.sh` → `/etc/asterisk/keys/phonehome-sip.*`). HT801 XML sets **Validate Server Certificates = Yes** (`P8463=1`) when the SIP server is a **DNS name**.
- **Remaining escape hatch:** If an ATA is pointed at a **raw LAN IP** (`10.0.5.105`), validation stays **off** (LE does not mint free IP certs). Prefer FQDN + hairpin/DNS so validation stays on.
- **ATA web push (`server/src/ht801Remote.ts`):** the HT801 admin UI redirects to HTTPS with a **self-signed device cert**, so one-tap setup talks to it through an undici agent with `rejectUnauthorized: false`. Scoped to that push only — never a global dispatcher — and the host must pass `assertPrivateAtaHost` (RFC1918 / CGNAT / link-local), so it cannot reach the public internet. Trust here is "same LAN as the adapter," not certificate identity; a LAN attacker could MITM the admin password and SIP secret during setup. Do not reuse this agent for any other outbound call.
- Opening SIP TLS to the internet still attracts scanners — fail2ban, strong passwords, narrow RTP, no unused UDP 5060.
- Soft-hub / per-home Hub (future) should prefer local media and encrypted uplink, not long-lived cleartext.

## Design rules for contributors

- **Do not** add a “dev convenience” public UDP SIP / plain RTP path that parents can enable in production UI.
- **Do not** log SIP auth passwords, SRTP keys, or full SDP with crypto lines.
- **Do not** ship call recording, cloud transcription, or ad/analytics SDKs that touch call content without an explicit product + legal review.
- **Do not** soft-delete or retain kid/parent content after an explicit account/line wipe — hard delete (or anonymize only if a FK truly requires it).
- **Do** default new transports to TLS/WSS/HTTPS.- **Do** document any hop where media is decrypted (e.g. FreePBX bridging WebRTC↔SIP) in this file.
- **Do** prefer regenerating ATA configs after crypto or hostname changes.

## Parent-facing promise (copy north star)

> PhoneHome is built so family calls stay private. Softphone calls use encrypted WebRTC. Analog adapters use encrypted SIP and SRTP. We don’t keep your call audio. Parents set who kids can reach — that’s safety, not selling data.

Refine with counsel before marketing sites go live.

## Related docs

| Doc | Role |
| --- | --- |
| [`threat-model.md`](./threat-model.md) | Concrete threats ↔ mitigations |
| [`hosting.md`](./hosting.md) | HTTPS, public SIP TLS ports, ops |
| [`ht801-lab.md`](./ht801-lab.md) | ATA TLS/SRTP lab procedure |
| [`listen-in-future.md`](./listen-in-future.md) | Future parent listen-in constraints |
| [`../SECURITY.md`](../SECURITY.md) | How to report issues |

When a PR or lab change weakens encryption, **stop and fix** — or document a time-boxed exception in the threat model with an owner and expiry. Privacy regressions are release blockers.
