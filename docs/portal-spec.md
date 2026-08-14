# Parent portal / web app spec (Stage 1)

Mobile-first web app (PWA). Native iOS/Android later wraps the same APIs.

## Parity checklist

| Feature | Ring Ring / Pinwheel / Tin Can / Digits | Stage 1 |
| --- | --- | --- |
| Household | Yes | Yes |
| Softphone / line | Digits handset; commercials HW | Softphone line |
| Invite family | Digits / commercials | 6-digit + share URL |
| Allowlist contacts | All | Mutual allowlist required cross-household |
| Quiet hours | All | Yes (custom start/end + IANA timezone per household) |
| Kill switch | Ring Ring et al. | Yes |
| Call metadata log | Most | Yes (no recording) |
| VPN for cousins | No | No |
| PSTN | Paid tier | Stage 3+ |
| Hardware pair | Yes | Stage 2 |

## Screens (Stage 1)

1. **Sign in** — setup code / register parent  
2. **Create household** or **Redeem invite**  
3. **Lines** — add softphone, select active line  
4. **Invite** — code + URL  
5. **Allowlist** — pick from directory, label, call / remove  
6. **Rules** — kill switch; quiet hours (start, end, timezone)  
7. **Call UI** — incoming banner, answer / hang up  

Quiet hours are evaluated in the household’s stored IANA timezone (e.g. `America/Chicago`), not the server’s clock. Each parent sets their own window.

## API surface (stable for native later)

- `POST /api/auth/login|register|logout`
- `GET /api/me`
- `POST /api/households`
- `PATCH /api/households/:id/rules`
- `POST /api/households/:id/lines`
- `POST /api/households/:id/invites`
- `POST /api/invites/redeem`
- `POST|DELETE /api/households/:id/allowlist…`
- `WS /ws` — `hello`, `call.offer|answer|ice|hangup|rejected|ringing`

## Non-goals Stage 1

- SMTP magic links (optional later)
- App Store binary
- Recording / transcription
