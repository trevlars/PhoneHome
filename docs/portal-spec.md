# Parent portal / web app spec (Stage 1)

Mobile-first web app (PWA). Native iOS/Android later wraps the same APIs.

## Competitor research → Stage 1 parity

| Feature | Ring Ring | Tin Can | Pinwheel Home | Digits | PhoneHome Stage 1 |
| --- | --- | --- | --- | --- | --- |
| Household + invites | Club | Share number / app | Caregiver portal | Yes | Yes (code + URL) |
| Allowlist / safelist | Yes | Approved contacts | Safelist | Yes | Mutual allowlist |
| Speed dial (≤9) | Yes | Yes | Yes | HW | Yes + editable |
| Quiet Time / schedule | Yes | Quiet Time | Yes | — | Bedtime / School (Mon–Fri + skip US federal holidays) / Open / custom + TZ |
| Instant Quiet Time / Timeout | Kill switch adjacent | Quiet Time / Timeout | Pause-ish | — | **Timeout voice** on `dnd`; UI label Quiet Time |
| VIP / always-allow | Club VIP patterns | — | — | — | **`always_allow` bypasses DND/quiet** |
| Kill switch / Timeout | Yes | — | Yes | — | **Timeout (`kill_switch`)** — whole-household pause |
| Daily usage cap | Yes | — | — | — | Yes + **usage bar** |
| Call history + duration | Metadata | History | History | — | Activity + **durations** |
| Voicemail | In-club (+ paid external) | Yes | Yes | — | Audio inbox + **leave-a-message on miss** |
| Mutual approval visibility | — | Both approve | — | — | **Mutual / waiting badges** |
| Parent PIN / dashboard lock | App | Companion app | Portal | Self-host | PIN locks Controls |
| Outside PSTN / 911 | Paid | Party Line paid | Paid Circle | HW | Stage 3 |
| Hardware handset | Kits | Device | Device | First | Stage 2 |

## Screens (Stage 1)

1. **Sign in** — setup code / register parent  
2. **Create household** or **Redeem invite**  
3. **Phone** — speed dial, usage bar, approved contacts + badges  
4. **Activity** — highlights (talk / dial / inbound) + completed / missed / stopped-by-rules + talk duration  
5. **Messages** — answering-machine style panel (audio after miss; one greeting per line)  
6. **Controls** — search; Timeout / Quiet Time (top of Parent); Contacts → hours → PIN early; schedule modes, daily cap, Analog, Sounds, Help, Account  
7. **Contacts manager** — add / rename / speed dial / VIP / remove  
8. **Leave a message** — after miss / away / decline  
9. **Invite / quiet hours / settings**  
10. **Call UI** — full-screen softphone  

Quiet Time (instant + scheduled windows) is evaluated with VIP exceptions. Scheduled windows use the household’s stored IANA timezone (e.g. `America/Chicago`), not the server’s clock.

**School preset:** Mon–Fri only (`quiet_days=1,2,3,4,5`), default `skip_holidays=1` (US federal observed: New Year’s, MLK, Presidents’, Memorial, Juneteenth, Independence Day, Labor, Columbus/Indigenous Peoples’, Veterans, Thanksgiving, Christmas). Not a district school calendar.

**Unavailable voice (policy block):** caller hears a short spoken prompt (softphone speechSynthesis; ATA via bridge WAV), then the call ends — not the answering-machine leave path. Phrases by gate: Timeout (`dnd`), Bedtime / overnight window, School, generic Quiet Time, pause, daily cap. Rules patch also accepts `quiet_days` and `skip_holidays`.

## API surface (stable for native later)

- `POST /api/auth/login|register|logout`
- `GET /api/me` (households include `dnd`, `usage_today_minutes`, allowlist `always_allow` + `mutual`)
- `POST /api/households`
- `PATCH /api/households/:id/rules` (kill, dnd, quiet, quiet_days, skip_holidays, cap, preset, parent DND, PIN)
- `POST /api/households/:id/pin/verify`
- `POST /api/households/:id/lines`
- `POST /api/households/:id/invites`
- `POST /api/invites/redeem`
- `POST|PATCH|DELETE /api/households/:id/allowlist…` (`alwaysAllow` / `always_allow`)
- `POST /api/households/:id/allowlist/decline` — hide pending directory line from “Needs approval”
- `POST /api/households/:id/voicemails/:id/listen`
- `GET /api/households/:id/voicemails/:id/audio` — session-auth audio file (`X-Session-Id` / cookie / `?sid=`)
- `DELETE /api/households/:id/voicemails/:id` — remove message + audio file
- `POST /api/voicemails` — leave a message `{ fromLineId, toLineId, audioBase64, audioMime }` (audio required)
- `PATCH /api/households/:id/lines/:lineId` — `mode` parent|child, `child_label` (enabling child auto-adds actor as guardian)
- `GET|POST /api/lines/:lineId/guardians` — list / add by username
- `DELETE /api/lines/:lineId/guardians/:userId`
- `POST /api/lines/:lineId/guardian-invites` — shareable 6-digit guardian code
- `POST /api/guardian-invites/redeem`
- `POST /api/lines/:lineId/child-login` — create/update optional child username+password
- `POST /api/lines/:lineId/reset-child-password` — guardian/parent reset (audit log)
- `WS /ws` — `hello`, `call.offer|answer|ice|hangup|rejected|ringing`, `presence.call` (child live calls)

## Non-goals Stage 1

- SMTP magic links (optional later)
- App Store binary
- Recording / transcription
- Real PSTN / 911 (Stage 3)
- Unknown-caller NIS tone (needs PSTN)
- **Hidden parental listen-in** (landline parallel-pickup) — future; see [listen-in-future.md](./listen-in-future.md)
