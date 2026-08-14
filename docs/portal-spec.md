# Parent portal / web app spec (Stage 1)

Mobile-first web app (PWA). Native iOS/Android later wraps the same APIs.

## Competitor research → Stage 1 parity

| Feature | Ring Ring | Tin Can | Pinwheel Home | Digits | Kids Landline Stage 1 |
| --- | --- | --- | --- | --- | --- |
| Household + invites | Club | Share number / app | Caregiver portal | Yes | Yes (code + URL) |
| Allowlist / safelist | Yes | Approved contacts | Safelist | Yes | Mutual allowlist |
| Speed dial (≤9) | Yes | Yes | Yes | HW | Yes + editable |
| Quiet hours / schedule | Yes | Quiet Hours | Yes | — | Bedtime / School / Open / custom + TZ |
| Instant Quiet Time / DND | Kill switch adjacent | Quiet Time / Shhhh | Pause-ish | — | **Quiet Time (`dnd`)** |
| VIP / always-allow | Club VIP patterns | — | — | — | **`always_allow` bypasses DND/quiet** |
| Kill switch / pause | Yes | — | Yes | — | Yes |
| Daily usage cap | Yes | — | — | — | Yes + **usage bar** |
| Call history + duration | Metadata | History | History | — | Activity + **durations** |
| Voicemail | In-club (+ paid external) | Yes | Yes | — | Notes inbox + **leave-a-message on miss** |
| Mutual approval visibility | — | Both approve | — | — | **Mutual / waiting badges** |
| Parent PIN / dashboard lock | App | Companion app | Portal | Self-host | PIN locks Controls |
| Outside PSTN / 911 | Paid | Party Line paid | Paid Circle | HW | Stage 3 |
| Hardware handset | Kits | Device | Device | First | Stage 2 |

## Screens (Stage 1)

1. **Sign in** — setup code / register parent  
2. **Create household** or **Redeem invite**  
3. **Phone** — speed dial, usage bar, approved contacts + badges  
4. **Activity** — completed / missed / blocked + talk duration  
5. **Voicemail** — family inbox (notes now; HW audio Stage 2)  
6. **Controls** — pause, Quiet Time, schedule modes, daily cap, PIN  
7. **Contacts manager** — add / rename / speed dial / VIP / remove  
8. **Leave a message** — after miss / away / decline  
9. **Invite / quiet hours / settings**  
10. **Call UI** — full-screen softphone  

Quiet hours and Quiet Time are evaluated with VIP exceptions. Quiet hours use the household’s stored IANA timezone (e.g. `America/Chicago`), not the server’s clock.

## API surface (stable for native later)

- `POST /api/auth/login|register|logout`
- `GET /api/me` (households include `dnd`, `usage_today_minutes`, allowlist `always_allow` + `mutual`)
- `POST /api/households`
- `PATCH /api/households/:id/rules` (kill, dnd, quiet, cap, preset, PIN)
- `POST /api/households/:id/pin/verify`
- `POST /api/households/:id/lines`
- `POST /api/households/:id/invites`
- `POST /api/invites/redeem`
- `POST|PATCH|DELETE /api/households/:id/allowlist…` (`alwaysAllow` / `always_allow`)
- `POST /api/households/:id/voicemails/:id/listen`
- `POST /api/voicemails` — leave a message `{ fromLineId, toLineId, body }`
- `WS /ws` — `hello`, `call.offer|answer|ice|hangup|rejected|ringing`

## Non-goals Stage 1

- SMTP magic links (optional later)
- App Store binary
- Recording / transcription
- Real PSTN / 911 (Stage 3)
- Unknown-caller NIS tone (needs PSTN)
