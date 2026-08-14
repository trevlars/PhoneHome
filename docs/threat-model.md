# Threat model (short)

| Threat | Mitigation |
| --- | --- |
| Random internet caller | No open SIP; allowlist |
| Stolen invite | 48h TTL, single-use |
| ISP snooping | TLS signaling; DTLS-SRTP media |
| Server operator | No clear audio; metadata only |
| Invited family abuse | Per-line allowlist; revoke |
| Soft-hub phone away | Explicit offline state |

Physical phone/Hub access = landline-equivalent risk.
