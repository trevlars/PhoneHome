# Family mesh / invites (Stage 1 + future)

Parent-facing structures (Pod vs Circle vs co-parent): [`family-structures.md`](./family-structures.md). Term definitions: [`glossary.md`](./glossary.md).

## Stage 1 (one Mothership) — shipped

One **Mothership** hosts many **Pods** (family names). Each Pod’s parents manage **Circles** (each **child** — who that kid may call). See [`glossary.md`](./glossary.md).

### Invite types

| Invite | Creates | Discovery |
| --- | --- | --- |
| **Family** (sister / in-laws) | Joins **your Pod** as a **parent** (shared grandparents). Never a child-only account — they add their kids under Kids. | Same Pod membership — Morgan + sister both Manage Mom |
| **Friend** (non-family) | Friend’s **parent** account/house if needed — **not** membership in your Pod | Only the **chosen child’s Circle** (e.g. Sam). Not North Pod, not West Pod |
| **Co-parent / guardian** | Manages that kid; does **not** join the other parent’s Pod | Separate `?guardian=` flow — invitee names their Pod if new |
| **Grandparent** | Pod-shared Grandparent phone (`?grandparent=` or Parent → Grandparents). Not a new Pod, not a parent Circles login | Only that Pod’s parents Manage/Open (North ≠ East). Auto-sees that Pod’s grandchildren and parents; other adults may be added manually; never GP↔GP across Pods |

**Hard rule:** invites are always **parent → parent** (or parent → Grandma setup). There is no “invite this cousin kid” path. Every child line has a parent/guardian who creates and approves for them. **Kids are multi-Pod:** they belong to every Pod those guardians belong to.

1. Parent creates invite → 6-digit code (48h, single-use). Redeem / peek allow 10 failed tries per account and 30 per IP every 15 minutes (co-parent codes share the budget).  
2. Family redeem → join the inviter’s **Pod** on the **same** Mothership (**parent** member). Child-only accounts cannot redeem.  
3. Friend redeem → Circle-scoped bridge to one kid only (redeemer is still a parent).  
4. Both sides allowlist lines within Circles (friends / cross-Pod).  
5. Call: WebRTC offer via `/ws`; STUN; media peer-to-peer.  
6. **No VPN** for Parent B.

**Pods do not cross-see each other** as phone books. Cousin **kids** (sharing a Pod through a Family invite) are on each other’s pads automatically — the adults were invited first. Friends still need both parents to approve.

Peer server federation (Mothership↔Mothership) is implemented for 1.x — see **Stage 3** below. Split households: [`migrate-mothership.md`](./migrate-mothership.md).

## TreeHouse (softphone-first)

Pad **0** is **TreeHouse** (house glyph + “0” + presence crown) — a **mothership-wide** kid hangout (any Pod’s kids may enter). Unlike FamilyRoom (**#**), there is **no Pod picker**.

### Join vs hear (Circles)

- **Join:** Any **child** line on this Mothership may enter the shared TreeHouse. Parents are **not** auto-talkers — they use listen-only.
- **Hear graph:** A↔B hear each other **only if both are allowed** (never one-way kid audio):
  - Same-Pod siblings: always hear each other.
  - Cross-Pod / cousins / friends: mutual allowlist **or** shared Circle (sphere), or a legacy explicit talk pair.
  - Other kids may be **present** in the room (presence chips) but stay **silent** and are not mesh peers if outside your Circles.
- Softphones tap **0** to join (WebRTC mesh, max 8). Mesh offers only follow Circle talk edges. Analog FXS (dial **0**) joins the same mothership presence; Asterisk uses per-child hear-bridges + ChannelSnoop so ATA kids only hear Circle peers (not a household-wide mix). Softphone↔analog TreeHouse audio is still separate (presence + enter TTS only).
- Presence chips: **green** = talk-connected with you; **grey** = present but not talk-connected; house gold when anyone is in the room.
- Enter TTS: “{Name} has joined the TreeHouse” — only to Circle talk peers (and parent listeners mirroring those peers).

### Parent listen-only

- Parent → TreeHouse → **Listen only** on a kid who is currently in the room.
- Parent hears the **same Circle-filtered mix as that child** (recvonly mesh to child + child’s talk peers). Cannot speak. Does **not** hear every kid on the mothership.
- **Never silent:** when listen starts, kids in that child’s Circle hear “{Child}’s parent is listening”. Distinct parent-listening chip on the pad.
- WS: `treehouse.listen.start` / `stop` (aliases `playroom.listen.*`, `familyroom.listen.*`).

### Analog / ATA

- Softphone kids stay on the WebRTC mesh. Analog FXS 1:1 stays on ExternalMedia.
- Analog TreeHouse (dial **0**) joins mothership **presence** and uses **Circle-filtered** Asterisk hearing (per-leg mix + snoops among FXS Circle peers). Softphone↔analog media in TreeHouse remains separate for now.
- Parent listen-in to an analog kid taps that child’s Circle hear-bridge (recvonly ExternalMedia) — same peers the child hears on FXS.
- Analog Circle peers hear Flite “{Child}’s parent is listening” on their hear-bridges when a parent listens (never silent).
- Mesh SDP never routes to an HT801 inbound-claim socket — that stole listen-in when an ATA was registered.

### Compatibility aliases

| Surface | Canonical | Legacy aliases |
| --- | --- | --- |
| Product name | TreeHouse | PlayRoom, FamilyRoom |
| WS events | `treehouse.*` | `playroom.*`, `familyroom.*` (accepted + multi-emitted) |
| HTTP API | `/tree-house` | `/play-room`, `/family-room` |
| DB tables | `family_room_members`, `family_room_talk_pairs` | kept (optional legacy edges; Circles are primary) |
| CSS / DOM | `pad-familyroom`, `data-familyroom` | kept for now |

## FamilyRoom (softphone # pad)

Pad **#** is **FamilyRoom** — mixed family talk (kids **and** adult family accounts), **pod-scoped**.

- **Join:** The household **admin** approves each person (household kids, household parents, and allowlisted family). API `/adult-family-room` (internal name kept; product copy is FamilyRoom).
- **Talk:** Full mesh among whoever is in **that Pod’s** room (unlike TreeHouse’s Circle-filtered hearing).
- **# pick:** Softphones tap **#** when not in a call. If the line is approved for **more than one Pod** (e.g. East and North via co-parents), the app asks which Family Room (Pod names). One Pod → join that room immediately. Each room only admits that Pod’s admin-approved members. **Analog** house-phone **#** FamilyRoom is not wired yet (in-call **#** remains hold).
- Parents set Mom / Dad in **Parent → Account** (or Profile). Speed dial and the house use that label.
- TreeHouse on **0** stays the mothership kid hangout (Circles filter hearing; parents listen-only). FamilyRoom is the opt-in **Pod** room.

> Historical: TreeHouse was also nicknamed FamilyRoom. That alias still works for TreeHouse APIs. The **# pad** is the mixed family room.

## Stage 3 — Mothership↔Mothership (1.x)

```
Household A tree                Household B tree
leaves → Mothership A  ←invite peer→  Mothership B ← leaves
              \                    /
               WebRTC leaf↔leaf when possible
```

**API (operator):**

1. On A: `POST /api/peers/invite` → invite URL (peer id + token + signaling base).  
2. On B: `POST /api/peers/join` with that URL → B records A; A marks B trusted via `accept-remote`.  
3. Cross-mothership call signal: `POST /api/peers/:peerId/signal` (local Circle/allowlist checked; remote ref `peer:<peerId>:<lineId>`).  
4. Remote delivers into `peer_signal_inbox`; clients poll `GET /api/peers/:peerId/signals`.  
5. Each mothership keeps its own SQLite — no DB merge.

Still required: HTTPS reachability both ways (tunnel / DDNS). Optional pinned `public_key` on `peer_servers`. TURN only if ICE fails.

Marketing: do not promise “leave friend’s mothership and keep calling cousins” until both sides complete a peer invite.

## Parent copy

- **Invite family** — sister / in-laws → join **your Pod** as parents (they add their kids).  
- **Invite a friend’s parent** — one **child’s Circle** only.  
- Never invite a child alone; never “join VPN” or “port forward.”
