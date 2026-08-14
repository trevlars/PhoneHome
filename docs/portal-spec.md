# Parent portal / web app spec (Stage 1)

Mobile-first web app (PWA). Native iOS/Android later wraps the same APIs.

## Parity checklist

| Feature | Ring Ring / Pinwheel / Tin Can / Digits | Stage 1 |
| --- | --- | --- |
| Household | Yes | Yes |
| Softphone / line | Digits handset; commercials HW | Softphone line |
| Invite family | Digits / commercials | 6-digit + share URL |
| Allowlist / safelist | All | Mutual allowlist required |
| Speed dial (≤9) | Ring Ring | Yes (auto-assigned slots) |
| Quiet hours / schedules | All | Bedtime / School / Open / custom + timezone |
| Kill switch / pause | Ring Ring et al. | Yes |
| Daily usage cap | Ring Ring | Yes (minutes/day) |
| Parent PIN | Common | Yes (locks Controls) |
| Call activity log | Most | Yes + blocked attempts |
| Voicemail inbox | Club plans | Softphone notes inbox (HW audio Stage 2) |
| VPN for cousins | No | No |
| Outside PSTN / 911 | Paid tier | Stage 3+ (called out in Controls) |
| Hardware pair | Yes | Stage 2 |

## Screens (Stage 1)

1. **Sign in** — setup code / register parent  
2. **Create household** or **Redeem invite**  
3. **Phone** — speed dial + approved contacts  
4. **Activity** — completed / missed / blocked  
5. **Voicemail** — family inbox  
6. **Controls** — pause, schedule modes, daily cap, PIN  
7. **Invite / allowlist / quiet hours / settings**  
8. **Call UI** — full-screen softphone  

Quiet hours are evaluated in the household’s stored IANA timezone (e.g. `America/Chicago`), not the server’s clock.

## API surface (stable for native later)

- `POST /api/auth/login|register|logout`
- `GET /api/me`
- `POST /api/households`
- `PATCH /api/households/:id/rules` (kill, quiet, cap, preset, PIN)
- `POST /api/households/:id/pin/verify`
- `POST /api/households/:id/lines`
- `POST /api/households/:id/invites`
- `POST /api/invites/redeem`
- `POST|PATCH|DELETE /api/households/:id/allowlist…`
- `POST /api/households/:id/voicemails/:id/listen`
- `WS /ws` — `hello`, `call.offer|answer|ice|hangup|rejected|ringing`

## Non-goals Stage 1

- SMTP magic links (optional later)
- App Store binary
- Recording / transcription
- Real PSTN / 911 (Stage 3)
