# Family mesh / invites (Stage 1 + future)

## Stage 1 (one trunk) — shipped

Minecraft model: one **PhoneHome** server; all softphones are clients.

1. Parent A creates invite → 6-digit code (48h, single-use).  
2. Parent B redeems → new household on **same** server.  
3. Both allowlist lines.  
4. Call: WebRTC offer via `/ws`; STUN; media peer-to-peer.  
5. **No VPN** for Parent B.

Peer server table `peer_servers` is reserved for Stage 3 federation.

## TreeHouse (softphone-first)

Pad **#1** is **TreeHouse** (house glyph + “1” + presence crown) — a shared kid hangout voice room.

### Join vs talk (symmetric)

- **Join:** Household **kids** always may enter this household’s TreeHouse. Outside contacts need explicit TreeHouse join approve (`family_room_members` table; API `/tree-house` with `/play-room` + `/family-room` aliases). Parents are **not** auto-talkers.
- **Talk graph:** A↔B hear each other **only if both are allowed** (never one-way kid audio).
  - Household kids ↔ household kids: auto talk.
  - Contacts / cross edges: parent sets undirected talk pairs (`family_room_talk_pairs`).
- Softphones tap **1** to join (WebRTC mesh, max 8). Mesh offers only follow talk edges.
- Presence chips: **green** = talk-connected with you; **grey** = present but not talk-connected; house gold when anyone is in the room.
- Enter TTS: “{Name} has joined the TreeHouse” — only to talk-approved peers (and parent listeners mirroring those peers).

### Parent listen-only

- Parent → TreeHouse → **Listen only** on a kid who is currently in the room.
- Parent hears the **same filtered mix as that child** (recvonly mesh to child + child’s talk peers). Cannot speak.
- **Never silent:** when listen starts, **everyone currently in the room** hears “{Child}’s parent is listening”. Distinct parent-listening chip on the pad.
- WS: `treehouse.listen.start` / `stop` (aliases `playroom.listen.*`, `familyroom.listen.*`).

### Analog / ATA

- Softphone kids stay on the WebRTC mesh. Analog FXS 1:1 stays on ExternalMedia.
- Analog TreeHouse (dial **0**) is a household Asterisk mix — presence only for softphones, not N-party WebRTC.
- Parent listen-in to an analog kid taps that Asterisk mix (recvonly ExternalMedia). Parent hears the analog room, not a secret god-mix of app kids.
- Analog kids hear Flite “{Child}’s parent is listening” on the mix (never silent).
- Mesh SDP never routes to an HT801 inbound-claim socket — that stole listen-in when an ATA was registered.

### Compatibility aliases

| Surface | Canonical | Legacy aliases |
| --- | --- | --- |
| Product name | TreeHouse | PlayRoom, FamilyRoom |
| WS events | `treehouse.*` | `playroom.*`, `familyroom.*` (accepted + multi-emitted) |
| HTTP API | `/tree-house` | `/play-room`, `/family-room` |
| DB tables | `family_room_members`, `family_room_talk_pairs` | kept (no rename migration) |
| CSS / DOM | `pad-familyroom`, `data-familyroom` | kept for now |

## FamilyRoom (softphone # pad)

Pad **#** is **FamilyRoom** — mixed family talk (kids **and** adult family accounts), not an adults-only lounge.

- **Join:** The household **admin** approves each person (household kids, household parents, and allowlisted family). API `/adult-family-room` (internal name kept; product copy is FamilyRoom).
- **Talk:** Full mesh among whoever is in the room (unlike TreeHouse’s filtered talk pairs).
- **# pick:** Softphones tap **#** when not in a call. If two families are available, the app shows a popup to pick one (no keypad). A single family joins immediately. **Analog** still uses the voice menu: “Press **1** for {household name}, or **2** for {the other parent’s last name}.” If both parents share that last name, **2** is **Mom** or **Dad** when they chose that label.
- Parents set Mom / Dad in **Parent → Account** (or Profile). Speed dial and the house use that label.
- TreeHouse on **0** stays the kid hangout (kids always in; parents listen-only). FamilyRoom is the opt-in family room.

> Historical: TreeHouse was also nicknamed FamilyRoom. That alias still works for TreeHouse APIs. The **# pad** is the mixed family room.

## Stage 3 — trunk↔trunk (planned)

```
Household A tree                Household B tree
leaves → Trunk A  ←invite peer→  Trunk B ← leaves
              \                    /
               WebRTC leaf↔leaf when possible
```

1. Invite encodes trust material + signaling URL (via outbound tunnel / DDNS).  
2. Mutual TLS / pinned keys in `peer_servers`.  
3. Cross-allowlist still enforced on each trunk.  
4. TURN only if ICE fails.  
5. Optional connectivity helper = intro + TURN only — not household DB.

## Parent copy

“Invite family” / “Accept invite” — never “join VPN” or “port forward.”
