# Parent UX walkthrough

## Stage 1 onboarding

1. **Splash** — PhoneHome brand moment (tagline: *The home phone, remixed*; tap to skip). Shows a **preview of the parent setup order** (sign-in → child line → PIN → contacts/dial 1 → Quiet Time → analog optional → sounds). First-time users continue into tutorial.  
2. **Tutorial (v6)** — product walkthrough (brand, lines, analog, speed dial, sounds, messages, safety). Swipe or progress segments.
3. **Welcome** — host family network or join with invite.  
4. Host: setup code → household name → softphone line → home.  
5. **Parent setup board** (Night Watch–style) — after sign-in, if required steps are incomplete and not dismissed: progress % + ordered checklist with todo/done from **server household state** (not localStorage). Tap a step → Parent section for that setting. **Skip for now** keeps calling available; reopen via Parent → Help → **Finish setup**, or the home **Finish setup** banner.  
6. Invite family → both allowlist → Call.  

### Parent setup checklist (status from live data)

| Step | Done when | Parent jump |
| --- | --- | --- |
| Create / sign in | Username + password on account | Account |
| Add child line | Household has a `mode=child` line | Active line |
| Parent PIN | `has_parent_pin` | Parent PIN |
| Contacts / allowlist | Child appears on speed dial **1** (parent pad) | Contacts |
| Quiet Time / Bedtime / School | Schedule preset ≠ open, or Quiet Time window set | Quiet Time |
| Analog adapter | Optional — any kid line has an ATA binding | Analog Phone |

**Routing:** If a line has a registered analog adapter **and** a softphone on the same account, **inbound calls default to the wall phone** (FXS). The softphone stays usable for placing calls and shows a short notice; it only takes inbound if the adapter is offline.
| Sounds / greeting | Custom greeting, **or confirmed default**, or non-default ringer | Sounds |

Dismiss (`kl_setup_dismissed_v1`) only hides the board/banner preference — step status always re-derives from `/api/me`.

**Child / kid line accounts** (e.g. Gemma’s login): parent setup board, home **Finish setup** banner, and Help → **Finish setup** are hidden. Kids never see parent-only steps (PIN, add child, put child on speed dial 1, etc.).

No VPN. **Parent** (dock) is one scrollable panel.

**Top of page (always visible):** search bar → **Timeout** / **Quiet Time** quick actions (ex–Right now; not an accordion). Timeout is the household kill switch (`kill_switch`) — stops all calls for everyone, not Analog-only.

**Search:** filters modules + quick actions by keyword (contacts, pin, quiet, timeout, analog, adapter, hours, sounds, help, account, pause, etc.). Matching sections stay visible; the first matching accordion opens. Empty: “No matching settings.”

Accordion sections (parent-priority order):

1. **Active line** — which softphone this device uses, profile picture, **Lock this device** (Child mode). Analog setup uses its own line picker (see below) rather than relying on this alone.  
2. **Contacts & speed dials** — edit contacts / invite / kid photo shortcuts  
3. **Quiet Time & limits** — schedules, daily cap  
4. **Parent PIN** — set/remove PIN, optional layout lock  
5. **Analog Phone** — line picker + status first; when no adapter is saved, a **What is Analog Phone?** intro explains the HT801 (house phone → small adapter; PhoneHome talks to the box) with Amazon/eBay search CTAs (`rel="noopener noreferrer"`). Dismiss collapses to a compact “Need an adapter?” strip (`localStorage` `ph_ata_intro_dismissed`). After an adapter is saved, the explainer goes away and a quiet shop link lives under **Advanced** (also in Help → Analog Phone setup). Then adapter model, **Save connection**, setup / one-tap / download; **Advanced** for server/MAC/caller ID, Config Server Path, Disconnect. After a successful one-tap, the sticker admin password no longer works — use the new password you chose. Too many wrong logins lock the adapter web UI (~2 min).  
6. **Sounds** — ringer, greeting, speaker  
7. **Help** — tutorial replay + parent how-to guides (Analog setup, Quiet Time/PIN/kid lock, privacy & encryption, softphone mic / Add to Home Screen, contacts & speed dials). Curated copy only — no ops secrets.  
8. **Account** — credentials, sign out, **Delete my account** (type `DELETE`; last parent wipes the household)

Sticky jump chips: Line · Contacts · Quiet Time · PIN · Analog · Sounds · Help · Account.

### Deleting a kid line or parent account

- **Kid line:** Contacts → Kid profiles → **Delete**, or Active line (when Child mode) → **Delete kid line…**. Confirm by typing `DELETE` or the child’s name. Only that line is removed; other kids stay.
- **Parent account:** Account → **Delete my account…**. Confirm with `DELETE`.
  - **Only parent / last member** of the household → household is hard-wiped (all lines, allowlists, voicemails, greetings, ATA bindings).
  - **Another household member remains** → ownership transfers to them; your membership and account are removed; kids stay with the household.
  - Guardianship on other households is dropped (their kids are not deleted).
- **Cross-family:** allowlist / speed-dial rows in *other* households that pointed at deleted lines are removed. No soft-delete retention of content.
## Parent PIN gate (when it asks)

PIN exists to keep **kids** out of Parent controls — not as a parent login.

| Situation | Ask PIN for Parent dock / elevating? | Speed-dial rearrange (layout lock on)? |
| --- | --- | --- |
| Parent account on an **unlocked** device (not Child mode) | **No** — open Parent freely, even if a household PIN is set | **No** — rearrange freely |
| Device with **Lock this device** / Child mode (`kl_child_mode`) | **Yes** — exit / Parent unlock | **Hard lock** until Parent exit (no rearrange) |
| **Kid experience** (child login or child-only account) | **Yes** — when opening Parent | **Yes** — layout unlock PIN (session) |
| Profile (photo / greeting) | **No** for parents or kids on their own line | — |

Signals used: `kl_child_mode` (device lock), `isKidExperience()` / `needsParentPinGate()` (kid account / child-only), not “PIN is set.” Setting a PIN alone does not nag parents on their phone — including layout rearrange.

## Profile (line picture / greeting)

Opened from the topbar avatar (or kid photo shortcuts). Same accordion chrome as Parent — exclusive sections, 44px expand control, italic hints, section icons. Device lock / Child mode stays on Parent → Active line (not duplicated here).

**Parents:** search + jump chips → **Photo** (default open) · **Display name** (line picker + name / kid label) · **Greeting** · **Ringer & speaker** · **More** (link to Parent).

**Kids:** **Photo** · **Greeting** only (no search / jump chips).

## Child mode

- A **child** is a **line/device** (softphone identity), not a separate household. Multiple parents can be **guardians** of that line.
- Parent sets a PIN, then **Lock Child mode** / **Lock this device** on Active line in Parent — that parent (and the household owner) become guardians automatically.
- Device shows speed dial + Activity/Voicemail; Invite / Approve / Parent need PIN to exit.
- `localStorage` `kl_child_mode` + line `mode=child`. Exit: Parent PIN verify.
- Parents / guardians see live banners when a child line is ringing/talking (`live_calls` + WS `presence.call`).

### Authorized parents (guardians)

1. On Parent → Active line, lock Child mode first.  
2. **Authorized parents** → add by **username** of a parent already on the network, or **Invite code** / `?guardian=` link.  
3. The other parent accepts the code (or opens the link while signed in) → guardian row.  
4. Guardians can manage that child line’s mode/label, the household allowlist & rules (shared), live call visibility, and optional child login.  
5. Remove guardian: any remaining guardian or the household owner (must keep at least one).

### Child login & password reset

- Default Child mode uses the **parent session + PIN** (no separate kid login).  
- Optional: create a **child login** (username/password) linked to the line under Parent → Child login.  
- Any **guardian** (or household owner/member via `canManageChild`) can **reset that password**; the UI flashes “Password reset by parent…” and the server logs an audit line.  
- Server admin can reset **any** username (including child logins):

```bash
DATA_DIR=/var/lib/kids-landline node /opt/kids-landline/server/scripts/reset-password.mjs <username> '<newPassword>'
```

## Approvals

- Pending directory lines show Approve **and Decline**. Decline stores `allowlist_declined` so they stop nagging.  
- Home “How calling works” guide only when there is a new pending approval, or when there are no contacts yet (first-time empty). If mutual contacts exist and nothing is pending, the guide stays hidden.

## Calls / answering machine

- Outbound dial tone, Hold + local hold music, 30s silence → “Are you still there?” → hang up after 20s. Analog handset: **\#** toggles hold (peer hears MOH).  
- Softphone mic: browsers/iOS cannot auto-allow without a first **Allow**. PhoneHome reuses the mic stream between calls (parks tracks instead of stop()) so iOS should not re-prompt every call after that grant. Best persistence: open the **HTTPS** URL in Safari, tap Allow once, then **Share → Add to Home Screen** and launch from there. If it still asks every time: Safari **aA → Website Settings → Microphone → Allow**.  
- Missed call: short greeting → beep → record (max ~45s) → hang up. No typed notes.
- **Activity** top strip (active line): **Talks most** (answered talk time), **Dials most** (outbound attempts), optional **Calls you most** (inbound). Empty until there’s history.
- **Stopped** filter (was “Blocked”) only appears when a call was rejected by rules (Quiet Time, pause, daily cap, allowlist). Feed rows say “Stopped by rules.” No Activity dock badge for these.
- **Messages** tab: answering-machine panel — count + blinking new LED, Play (new messages in order), Skip, Delete. Not a chat inbox.
- Cap: 15 stored messages per household (erases oldest played when full; refuses if all are new).
- Optional **speaker / call screening** (default off): live play while caller records.

## Stage 2

Add line → ATA or BT — same allowlists.
