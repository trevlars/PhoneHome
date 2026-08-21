# Future: parental listen-in (not Stage 1)

**Status:** Non-goal for Stage 1. Spec only — do not implement until child mode, live call visibility, and parent PIN gating are solid in production.

**Privacy pillar:** Any listen-in design must satisfy [`privacy-security.md`](./privacy-security.md) — audited, household-policy, never silent adult spyware, no call-audio archive by default. Legal review before ship.

## Product idea

Landline-style **parallel pickup**: a parent on another household softphone can silently join a child’s active call as **receive-only** (hear both sides, no mic injected unless they “pick up” later). Hidden from the child’s UI beyond normal “parent can see activity” expectations.

## Constraints

- **Parent-only, PIN-gated** — same household owner/parent role; verify parent PIN before arming listen-in.
- **Never exposed to other families** — same household mesh only.
- **Audit** — log listen-in start/stop on the household activity feed (who, which child line, when). Optional on-device parent confirmation.
- **Consent framing** — household policy / onboarding copy that parents may monitor calls on child devices; not silent spyware for adult peers.

## Tech sketch (later)

1. **Hidden receive-only mesh peer (MVP candidate)**  
   Parent softphone joins the existing 1:1 (or group) WebRTC mesh as a third peer with mic muted / no send tracks; subscribe to both remote streams. Works on current mesh without an SFU; scales poorly past ~3–4.

2. **SFU path (Stage 2+)**  
   If mesh hold/listen-in gets fragile, route child calls through a selective-forwarding unit so parent can subscribe as a viewer without renegotiating the kid’s peer connection.

## Prerequisites (ship first)

- Child mode + parent PIN exit  
- Live “who is the child talking to” presence for household parents  
- Unified parent panel  

Only after those should listen-in be designed end-to-end.
