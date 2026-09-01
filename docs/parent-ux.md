# Parent UX walkthrough

## Stage 1 onboarding

1. **Splash** — compact brand lockup plus the kid-on-a-house-phone photo, How it works copy (kicker / title / body), and “what’s next” (How it works → Sign in → Finish family setup). Optional Add to Home Screen tip on mobile browsers. **No theme picker here** — **How it works** always opens the tutorial (Skip still goes to Sign in on a browser tab). **New app install** (native or home-screen PWA) must finish How it works before Sign in or the Phone tab — Skip and “Already have an account?” stay hidden until the last slide. Already-have-an-account jumps to Sign in on returning installs. HT801 v2 product shots live in Analog Phone / Help.  
2. **Tutorial (v10)** — product walkthrough (brand, phone, your people, invite, TreeHouse, parent controls + privacy, themes, you’re ready). Parent-controls slide: encrypted calls, you’re always in control (Quiet Time, PIN, Timeout, Activity). Swipe or progress segments; Skip anytime except first app install (Help replay can still Skip). Splash already covers the brand beat, so **How it works** from splash starts at tap-a-face. **Themes** is a tap-to-try slide (same picker as Parent, marked **Beta**).  
3. **Welcome** — Sign in / Join with invite / Create account.  
4. Host or join: auth → household → softphone line → **Phone** (speed dial).  
5. **Parent setup board** — not shown automatically after sign-in. Incomplete required steps get a home **Finish setup** banner; full board is Parent → Help → **Finish setup**. Progress from **server household state**; tap any step (including done). When required steps are done: **Go to phone** up top, optional house-phone CTA, compact finished list. **Skip for now** keeps calling available.  
6. Invite family → both allowlist → Call.  

### Parent setup checklist (status from live data)

| Step | Done when | Parent jump |
| --- | --- | --- |
| Create your sign-in | Username + password on account | Account |
| Add a kid | Household has a kid line | Kids |
| Parent PIN | `has_parent_pin` | Parent PIN |
| Kid on speed dial | Child appears on speed dial **1** (parent pad) | Contacts |
| Quiet Time schedule | Kid schedule preset ≠ open, or Quiet Time window set | Quiet Time |
| House phone | Optional — any kid line has an ATA binding | Analog Phone |

**Routing:** If a line has a registered analog adapter **and** a softphone on the same account, **inbound calls default to the wall phone** (FXS). The softphone stays usable for placing calls and shows a short notice; it only takes inbound if the adapter is offline.
| Ringer & greeting | Custom greeting, **or confirmed default**, or non-default ringer | This phone |

Dismiss (`kl_setup_dismissed_v1`) only hides the board/banner preference — step status always re-derives from `/api/me`.

**Child / kid line accounts** (e.g. Gemma’s login): parent setup board, home **Finish setup** banner, and Help → **Finish setup** are hidden. Kids never see parent-only steps (PIN, add child, put child on speed dial 1, etc.).

### Grandparent / relative UX

Invite-only adults (no kid lines in their household, or `profile_role=grandparent`) get a simpler chrome aimed at older adults:

- Dock label **Settings** (not Parent). Home stays Phone · Activity · Messages.
- **No auto-trap** into Approve contacts — a large home banner (Approve / Review / Later) instead. Contacts screens keep dock + a clear **Done** button.
- Speed dial **1** = primary grandchild (child-mode contact in their circle). TreeHouse / FamilyRoom pads are hidden.
- Settings: Quiet Time / Timeout, approve family, optional Analog phone, This phone / Account. Can switch to full Parent settings via “I’m using PhoneHome as → Parent”.
- **How it looks:** curated theme picker (Modern, Wood Panel, Flat, **High Contrast**, **High Contrast Dark**) — age-friendly subset only, not the full Parent Themes grid. High Contrast is ADA black-on-white; Dark is the inverted white-on-black option for bright-screen sensitivity.
- Parents set these up under Parent → **Grandparents** (username/password + which kids), so older adults never hunt for an invite code. Parents can **Manage** that account later (login, kids) and **See their phone** to preview the simple chrome without signing in as Grandma.
- **Setup is not the parent checklist.** Grandparents never see “Add a kid / Parent PIN / Quiet Time schedule.” Their board is **Get ready to call**: (1) Your sign-in, (2) Family on dial 1 — plus optional Quiet Time and house phone. Home banner says the same (or the Approve banner if someone is waiting). When family is already approved, setup is done — no nag to finish parent chores.
- **Plain wording (late Gen X / Boomer / Silent Gen):** no “speed dial / VIP / circle / analog / Timeout / Quiet Time” jargon on GP surfaces. Phone title **Your phone**; coach says **tap the big button with a 1**; hints say **Tap once to call**; buttons say **Yes, add them**; Settings explains **How do I make a call?** in numbered steps; dock uses **Recent** instead of Activity.

Age-friendly patterns: few choices, large tap targets (~48px), plain language, linear approve → call path.

No VPN. **Parent** (dock) is one scrollable panel.

**Top of page (always visible):** search bar → **Timeout** / **Quiet Time** quick actions (ex–Right now; not an accordion). Timeout is the household kill switch (`kill_switch`) — stops all calls for everyone, not Analog-only.

**Search:** filters modules + quick actions by keyword (contacts, pin, quiet, timeout, analog, adapter, hours, sounds, help, account, pause, etc.). Matching sections stay visible; the first matching accordion opens. Empty: “No matching settings.”

Accordion sections, grouped:

**Look**
1. **Themes** — how PhoneHome looks on this device (Modern default; 90s, wood, playground, **High Contrast** / **High Contrast Dark**, and more). Grandparent accounts only offer a short age-friendly subset.

**People**
2. **Kids** — **Add a kid** (first name creates their phone; yours stays yours). Kid list with photo/greeting shortcuts and delete.  
3. **Contacts & speed dials** — **Your circle** (rename; invite-first), which parent circles appear on each kid’s speed dial, edit contacts / invite  
4. **Co-parents** — needs a kid first (from **Kids**). Share-first co-parent invite (code + copy/share), guardian list, add by household member / username, redeem invite. Does **not** require locking your phone into Child mode.  
5. **Grandparents** — parent sets Grandma/Grandpa’s **username + password**, picks which kids they can call, then **Manage** anytime: edit name/login, change who they can call, reset password, or **See their phone** (session preview of the simple dial pad + Settings chrome — calls and household toggles stay off). Creates a `profile_role=grandparent` account (simple Settings chrome). No invite code required for them.

**Rooms**
6. **TreeHouse** — kid hangout on pad #0  
7. **FamilyRoom** — mixed family talk on # (household admin approves kids and adult family). In the **app**, tap # and pick the family from a popup. On a **house phone**, a voice asks: **1** = this household name (e.g. Larsen), **2** = the other parent’s last name (or Mom/Dad if they share that name). Parents pick Mom or Dad in Account.

**Household rules**
8. **Quiet Time & limits** — per-kid Bedtime / School / custom hours and daily talk cap, plus the parent’s own Do Not Disturb (does not change kid hours)  
9. **Parent PIN** — set/remove PIN, optional layout lock  

**This phone** (this device only)
10. **This phone** — active line, profile picture, **Lock this device** (Child mode), optional child login, ringer, **Lock-screen Answer** (iOS CallKit, off by default, marked **Beta**), greeting, call-screening speaker.

**House phone**
11. **Analog Phone** — line picker + status first (needs a kid from **Kids** first); photos of a kid on a house phone plus official **Grandstream HT801 v2** product shots; when no adapter is saved, a **What is Analog Phone?** intro explains the HT801 v2 (house phone → small adapter; PhoneHome talks to the box) with Amazon/eBay search CTAs (`rel="noopener noreferrer"`). Dismiss collapses to a compact “Need an adapter?” strip (`localStorage` `ph_ata_intro_dismissed`). After an adapter is saved, the explainer goes away and a quiet shop link lives under **Advanced** (also in Help → Analog Phone setup). Then adapter model, **Save connection** (auto-creates/updates the FreePBX extension + secret; remote public SIP hosts get `rewrite_contact=yes`), setup / one-tap / download. **Download config** shows a click-path for the HT801 v2 admin: find IP (`***` then `02` on the handset) → `https://<IP>` → `admin` + sticker password → left menu **Maintenance → Upgrade → Upload Configuration**. **Advanced** for server/MAC/caller ID, Config Server Path (`Maintenance → Upgrade` → Config Upgrade via HTTPS → Config Server Path, Firmware blank), Disconnect. After a successful one-tap, the sticker admin password no longer works — use the new password you chose. Too many wrong logins lock the adapter web UI (~2 min).

**Help & account**
12. **Help** — tutorial replay + parent how-to guides (house phone, invite QR/text, Quiet Time/PIN/kid lock, privacy, app microphone, contacts & speed dials). Plain parent language — no ops secrets.  
13. **Account** — credentials, sign out, **Save for Face ID** (iOS Keychain, this device only — confirmed working), **Delete my account** (type `DELETE`; last parent wipes the household)

Sticky jump chips: Kids · Contacts · Co-parents · Grandparents · Analog · Themes · Rooms · Schedule · PIN · This phone · Help · Account.

### Deleting a kid line or parent account

- **Kid line:** Kids → **Delete**, or This phone (when Child mode) → **Delete kid line…**. Confirm by typing `DELETE` or the child’s name. Only that line is removed; other kids stay.
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

Opened from the topbar avatar (or kid photo shortcuts). Same accordion chrome as Parent — exclusive sections, 44px expand control, italic hints, section icons. Device lock / Child mode stays on Parent → This phone (not duplicated here).

**Parents:** search + jump chips → **Photo** (default open) · **Display name** (line picker + name / kid label) · **Greeting** · **Ringer & speaker** · **More** (link to Parent).

**Kids:** **Photo** · **Greeting** only (no search / jump chips).

## Child mode

- A **child** is a **line/device** (softphone identity), not a separate household. Multiple parents can be **guardians** of that line.
- **Add a kid** lives under Parent → **Kids** (first name). That creates a new child line; the parent phone stays a parent phone. Analog Phone and Quiet Time need this first.
- Parent sets a PIN, then **Lock this device** on This phone only if they want *this* handset in Child mode — that parent (and the household owner) become guardians automatically. Locking a still-parent line asks to confirm, so new users don’t convert their own phone by accident.
- Device shows speed dial + Activity/Voicemail; Invite / Approve / Parent need PIN to exit.
- `localStorage` `kl_child_mode` + line `mode=child`. Exit: Parent PIN verify.
- Parents / guardians see live banners when a child line is ringing/talking (`live_calls` + WS `presence.call`).

### Other parents / co-parents (guardians)

1. Add a kid under Parent → **Kids** (creates their line; your phone stays a parent phone).  
2. Open **Co-parents** (jump chip). Pick the kid if you have more than one.  
3. **Invite co-parent** → share the code / link (`?guardian=`). Or add by household member / username.  
4. The other parent accepts the code (or opens the link while signed in) → guardian row + household membership.  
5. Co-parents can manage that child line’s mode/label, the household allowlist & rules (shared), live call visibility, and optional child login.  
6. Remove co-parent: any remaining guardian or the household owner (must keep at least one).  
7. **Lock this device** (This phone) is separate — only if you want *this* handset in Child mode.

### Child login & password reset

- Default Child mode uses the **parent session + PIN** (no separate kid login).  
- Optional: create a **child login** (username/password) linked to the line under Parent → This phone.  
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
