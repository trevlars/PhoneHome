# Parent UX walkthrough

Family structures (Pod / Circle / co-parent, worked examples): [`family-structures.md`](./family-structures.md).

## Stage 1 onboarding

1. **Splash** — compact brand lockup plus the kid-on-a-house-phone photo, How it works copy (kicker / title / body), and “what’s next” (How it works → Sign in → Finish family setup). Optional Add to Home Screen tip on mobile browsers. **No theme picker here** — **How it works** always opens the tutorial (Skip still goes to Sign in on a browser tab). **New app install** (native or home-screen PWA) must finish How it works before Sign in or the Phone tab — Skip and “Already have an account?” stay hidden until the last slide. Already-have-an-account jumps to Sign in on returning installs. HT801 v2 product shots live in Analog Phone / Help.  
   **Native iOS:** first launch shows the **same splash → How it works** as the website, then **Connect** (paste Mothership HTTPS or a share link) as the last beat. Completion is stored on-device so the hub does not replay the walkthrough after Connect. Change Mothership later under Parent → This phone. The iOS app is free; Safari still works.  
2. **Tutorial (v10)** — product walkthrough (brand, phone, **Mothership → Pod → Parent → Circle**, invite family vs friend, TreeHouse, parent controls + privacy, themes, you’re ready). Nesting slide: Mothership hosts Pods; Pod = family name; Parents manage that Pod; Circle = the child. Invite slide: sibling → join your Pod (shared grandparents); friend → one child’s Circle. Parent-controls slide: encrypted calls, you’re always in control (Quiet Time, PIN, Timeout, Activity). Swipe or progress segments; Skip anytime except first app install (Help replay can still Skip). Splash already covers the brand beat, so **How it works** from splash starts at tap-a-face. **Themes** is a tap-to-try slide (same picker as Parent, marked **Beta**).  
3. **Welcome** — Sign in / Join with invite / Create account.  
4. Host or join: auth → household → softphone line → **Phone** (speed dial).  
5. **Parent setup board** — not shown automatically after sign-in. Incomplete required steps get a home **Finish setup** banner; full board is Parent → Help → **Finish setup**. Progress from **server household state**; tap any step (including done). When required steps are done: **Go to phone** up top, optional house-phone CTA, compact finished list. **Skip for now** keeps calling available.  
6. Invite family (join this Pod) or invite a friend onto a kid’s Circle → both allowlist → Call.  

### Pods vs Circles (parent language)

| Term | Means | Example |
| --- | --- | --- |
| **Pod** | Family name on the Mothership | **North** (Jordan, Casey, Drew) or **East** (Cameron) or **West** (Morgan + sister) |
| **Kids** | Belong to **every Pod** their parents/guardians are in | Sam → North (Drew) + West (Morgan); Alex → North + East |
| **Circle** | **The child** — who that kid may call (guardians curate) | Sam’s Circle |
| **Grandparents** | Belong to the **Pod**; auto grandchildren + that Pod’s parents on their phone; other adults optional manual add | North → Avery (Casey, Drew, Jordan on her phone); West → Mom. Morgan + sister both Manage Mom. |
| **Family invite** | Sister / in-laws → **join your Pod** as **parents** (they add their own kids; never invite a child alone) | Morgan → sister joins West |
| **Friend invite** | Friend’s **parent** → **one child’s Circle only** — not North or West Pod membership | School friend’s parent → Sam only |

Pods do **not** browse each other as phone books. Grandma North never sees Grandma West. Multi-Pod kids show on each parent’s Pod for family + grandparents; Circles stay guardian-curated.

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

**Child / kid line accounts** (e.g. Alex’s login): parent setup board, home **Finish setup** banner, and Help → **Finish setup** are hidden. Kids never see parent-only steps (PIN, add child, put child on speed dial 1, etc.).

### Grandparent / relative UX

Invite-only adults (no kid lines in their household, or `profile_role=grandparent`) get a focused Grandparent phone chrome aimed at older adults:

- Dock label **Settings** (not Parent). Home stays Phone · Activity · Messages.
- **No auto-trap** into Approve contacts — a large home banner (Approve / Review / Later) instead. Contacts screens keep dock + a clear **Done** button.
- Speed dial **1** = primary grandchild (child-mode contact in their circle). TreeHouse / FamilyRoom pads are hidden.
- Settings: Quiet Time / Timeout, approve family, optional Analog phone, This phone / Account. Can switch to full Parent settings via “I’m using PhoneHome as → Parent”.
- **How it looks:** curated theme picker (Modern, Wood Panel, Flat, **High Contrast**, **High Contrast Dark**) — age-friendly subset only, not the full Parent Themes grid. High Contrast is ADA black-on-white; Dark is the inverted white-on-black option for bright-screen sensitivity.
- Parents set these up under Parent → **Grandparents** (username/password + which kids), so older adults never hunt for an invite code. Parents can **Manage** that account later (login, kids) and **See their phone** to preview the Grandparent phone without signing in as Grandma.
- **Setup is not the parent checklist.** Grandparents never see “Add a kid / Parent PIN / Quiet Time schedule.” Their board is **Get ready to call** only: (1) Your sign-in, (2) Add your family (Done only when call-ready / mutual). Silence and house phone live in **Settings**, not on the board. Themes are Settings-only. Home banner says the same (or the Approve banner if someone is waiting). **Skip / Use phone** dismisses both the board and the home nag until they reopen from Settings. When family is already approved, setup is done — no nag to finish parent chores.
- **How it works:** Grandma setup links (`?gp=` / `?grandparent=`) and signed-in grandparent chrome get a **2-slide** walkthrough (sign in → tap once). They do **not** see the parent Pod/Circle/TreeHouse tour. Fresh installs that sign in as a grandparent auto-complete How it works.
- **One next action on Phone:** never stack setup banner + approve banner + call coach. Approve wins when someone is waiting; coach shows only when ready to call.
- **Large text:** GP setup/sheets wrap on word boundaries (`overflow-wrap: break-word`), step rows stack (no mid-word shred from `anywhere` + nowrap OPTIONAL), CTAs are full-width and not sticky over the list. QA at iOS Larger Text / Accessibility sizes.
- **Plain wording (late Gen X / Boomer / Silent Gen):** no “speed dial / VIP / circle / analog / Timeout / Quiet Time” jargon on GP surfaces. Phone title **Your phone**; coach says **tap the big button with a 1**; hints say **Tap once to call**; buttons say **Yes, add them**; Settings explains **How do I make a call?** in numbered steps; dock uses **Recent** instead of Activity.

Age-friendly patterns: few choices, large tap targets (~48px), plain language, linear approve → call path.

No VPN. **Parent** (dock) is one scrollable panel.

**Top of page (always visible):** search bar → **Timeout** / **Quiet Time** quick actions (ex–Right now; not an accordion). Timeout is the household kill switch (`kill_switch`) — stops all calls for everyone, not Analog-only.

**Search:** filters modules + quick actions by keyword (contacts, pin, quiet, timeout, analog, adapter, hours, sounds, help, account, pause, etc.). Matching sections stay visible; the first matching accordion opens. Empty: “No matching settings.”

Accordion sections, grouped:

**This family (Pod)** — family name is in the group label (e.g. North).
1. **Co-parents** — invite the other parent for a kid. They name their Pod if new; they don’t join yours. Guardianship + Circle is the kid’s family unit. Kid buttons 1 and 2 (Mom/Dad labels), add by username / household member, redeem invite. Does **not** require locking your phone into Child mode.  
2. **Grandparents** — **{family} grandparents — any parent in this family can edit.** Parent sets Grandma/Grandpa’s **username + password**, picks which kids they can call, then **Manage** anytime: edit name/login, change who they can call, reset password, or **Open their phone**. Creates a `profile_role=grandparent` account. **Any parent in this Pod** can Manage / Open — not only the parent who created them. No invite code required for them. Their dial pad **auto-fills grandchildren** on this Pod (including multi-Pod kids) and **this Pod’s parents**; other adults are optional via Approve on Grandma’s phone.
3. **Analog Phone** — house phone for kids in this Pod. Kid-first: belongs to a child line, not the parent app. No kids → prominent **Add a kid** empty state. With kids, picker is **Whose house phone?** (calm when that line is Working). Product photos + intro only until an adapter is saved. After Save: one recommended path. **Working** lines show a green status plus **Download settings file** (always visible by that name) and upload steps behind **How to put the file on the box**; same-house **Send settings from this house** is tucked under a details (home household / HT801 only). Invited pods never see one-tap. **Download settings file** click-path: find IP (`***` then `02` on the handset) → `https://<IP>` → `admin` + sticker password → left menu **Maintenance → Upgrade → Upload Configuration**. HT801 v2 firmware (1.0.11.4 or newer v2) is recommended in Analog setup / Download settings and Help → House phone — **Status → System Info**, then **Maintenance → Upgrade**; compact **Adapter software** only when the line is already Working. **Advanced** for server/MAC/caller ID, Config Server Path, Disconnect. After a successful same-house send, the sticker admin password no longer works — use the new password you chose. Too many wrong logins lock the adapter web UI (~2 min).

**Kids & Circles**
4. **Kids** — **Add a kid** (first name creates their phone; yours stays yours). Most families use one kid line even with more than one child. Kid list with photo/greeting shortcuts and delete.  
5. **This child’s Circle** — pick a child, who they can call (not a shared Pod phone book). **Invite family** (another parent → join this Pod) and **Invite a friend’s parent** (that child’s Circle only) stay on this panel. Edit nicknames / speed dials. Existing accounts type a code via **Type their code**, or under Requests.  
6. **Requests** — inbound: “you’ve been invited” (accept / type a code) and people waiting for this child’s Circle (approve / decline). Home banner + Parent dock badge when something is waiting; no nag when empty. Opening an invite link stores the 6-digit code in sessionStorage and autofills it here (and on Join) after sign-in; it is cleared after accept. Shared `/?invite=` links use the inviting parent’s first name in Messages (“You're invited to Cameron's PhoneHome”), falling back to generic family copy if the name isn’t available — not the homepage “home phone, reborn” tagline.

**Rooms**
7. **TreeHouse** — kid hangout on pad #0  
8. **FamilyRoom** — mixed family talk on # (household admin approves kids and adult family). Softphone: if approved for more than one Pod, pick which Family Room (Pod names); one Pod joins directly. Only that Pod’s approved members are in the room. Analog **#** FamilyRoom not wired yet.

**Household rules**
9. **Quiet Time & limits** — per-kid Bedtime / School / custom hours and daily talk cap, plus the parent’s own Do Not Disturb (does not change kid hours)  
10. **Parent PIN** — set/remove PIN, optional layout lock  

**This phone** (this device only)
11. **This phone** — active line, profile picture, **Lock this device** (Child mode), optional child login, ringer, greeting, call-screening speaker. (iOS Cap apps always use **Lock-screen Answer** / CallKit — no toggle.)

**Look**
12. **Themes** — how PhoneHome looks on this device (Modern default; 90s, wood, playground, **High Contrast** / **High Contrast Dark**, and more). Grandparent accounts only offer a short age-friendly subset.

**Help & account**
13. **Help** — tutorial replay + parent how-to guides (house phone including HT801 v2 firmware links, invite QR/text, Quiet Time/PIN/kid lock, privacy, app microphone, this child’s Circle). Plain parent language — no ops secrets.  
14. **Mothership** (operators only) — own accordion with UFO mark; opens **Mothership admin** (server connection + health / App URL, Pod map, password reset, co-operators, optional sibling Circle billing). Hidden for parents who don’t run this server.
15. **Account** — credentials, sign out, **Save for Face ID** (iOS Keychain, this device only — confirmed working), **Mom or Dad** (how kids name *you*), **Delete my account** (type `DELETE`; last parent wipes the household). Legal footer links to `/privacy.html` and `/support.html`.

Sticky jump chips: This family · Kids · Circle · Invite · Requests · Grandparents · Analog · Themes · Rooms · Schedule · PIN · This phone · Help · Account.

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
4. The other parent accepts → **guardian** of that kid. If they’re new, they **name their family** (Pod). They do **not** join your Pod (Morgan ≠ North when co-parenting Sam).  
5. The kid’s “family unit” is guardianship + **Circle**, not a shared household. Multi-Pod follows each parent’s family name.  
6. Co-parents can manage that child line’s mode/label, Quiet Time / rules for kids they guard, live call visibility, and optional child login.  
7. Remove co-parent: any remaining guardian or the household owner (must keep at least one).  
8. **Lock this device** (This phone) is separate — only if you want *this* handset in Child mode.

### Child login & password reset

- Default Child mode uses the **parent session + PIN** (no separate kid login).  
- Optional: create a **child login** (username/password) linked to the line under Parent → This phone.  
- Any **guardian** (`canManageChild` — not Pod siblings) can **reset that password**; the UI flashes “Password reset by parent…” and the server logs an audit line.  
- Server admin can reset **any** username (including child logins):

```bash
DATA_DIR=/var/lib/kids-landline node /opt/kids-landline/server/scripts/reset-password.mjs <username> '<newPassword>'
```

## Approvals

- Pending directory lines show Approve **and Decline**. Decline stores `allowlist_declined` so they stop nagging.  
- Home “How calling works” guide only when there is a new pending approval, or when there are no contacts yet (first-time empty). If mutual contacts exist and nothing is pending, the guide stays hidden.

## Calls / answering machine

- Outbound dial tone, Hold + local hold music, 30s silence → “Are you still there?” → hang up after 20s. Analog handset: **\#** toggles hold (peer hears MOH); Flash / hook-flash is a pulse-phone fallback only. 
- Softphone mic: browsers/iOS cannot auto-allow without a first **Allow**. PhoneHome reuses the mic stream between calls (parks tracks instead of stop()) so iOS should not re-prompt every call after that grant. Best persistence: open the **HTTPS** URL in Safari, tap Allow once, then **Share → Add to Home Screen** and launch from there. If it still asks every time: Safari **aA → Website Settings → Microphone → Allow**.  
- Missed call: short greeting → beep → record (max ~45s) → hang up. No typed notes.
- **Activity** top strip (active line): **Talks most** (answered talk time), **Dials most** (outbound attempts), optional **Calls you most** (inbound). Empty until there’s history.
- **Stopped** filter (was “Blocked”) only appears when a call was rejected by rules (Quiet Time, pause, daily cap, allowlist). Feed rows say “Stopped by rules.” No Activity dock badge for these.
- **Messages** tab: answering-machine panel — count + blinking new LED, Play (new messages in order), Skip, Delete. Not a chat inbox.
- Cap: 15 stored messages per household (erases oldest played when full; refuses if all are new).
- Optional **speaker / call screening** (default off): live play while caller records.

## Stage 2

Add line → ATA or BT — same allowlists.
