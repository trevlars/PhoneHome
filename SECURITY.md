# Security

PhoneHome treats **children’s private conversations** as a first-class trust boundary. See **[`docs/privacy-security.md`](docs/privacy-security.md)** (product pillar) and **[`docs/threat-model.md`](docs/threat-model.md)**.

## Report a vulnerability

If you find a security or privacy issue (auth bypass, cleartext media on a supported path, invite abuse, SSRF to ATAs, session fixation, etc.):

1. **Do not** open a public GitHub issue with exploit detail.
2. Email the maintainer (repo owner) with: affected version/commit, impact, and steps to reproduce.
3. Allow reasonable time for a fix before public disclosure.

We care especially about:

- Anything that exposes **call audio** or **SIP credentials**
- Bypass of **allowlists**, **quiet hours**, or **parent PIN / child mode**
- Remote config push to ATAs outside the household LAN assumptions

## Supported crypto (product baseline)

| Surface | Baseline |
| --- | --- |
| Softphone media | WebRTC DTLS-SRTP |
| Softphone / API | HTTPS + secure cookies |
| Analog ATA ↔ PBX | SIP TLS + SRTP |
| Call recording | Off by default; not in Stage 1 |

Cleartext public SIP/RTP is **not** a supported production configuration.
