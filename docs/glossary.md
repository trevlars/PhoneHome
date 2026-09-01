# PhoneHome glossary

**PhoneHome** is the product — the app, the brand, the family voice network.

These three layers help parents and hosts talk about how it works:

```
Mothership (one server)
  └── Pods (parent clusters / families)
        └── Circles (each parent’s approved contacts for their kids)
```

## Mothership

The **always-on PhoneHome server** — one physical or virtual box running the hub.

- Runs on a home PC, Mac, Linux box, Pi, or lab VM.
- Holds all Pods, signaling, invites, and metadata (not softphone call audio).
- Cousins join **your** Mothership with your HTTPS URL + invite code.

> “We run the Mothership on an old Mac in the closet. Everyone in the family joins that link.”

**One Mothership per extended-family network** is the sweet spot. If a branch wants autonomy, start a **second** Mothership and peer them later (Stage 3).

Technical names (`kids-landline.service`, `DATA_DIR`) stay in deploy docs.

### How big?

| | Default |
| --- | --- |
| **Sweet spot** | ~5–25 Pods, ~50–150 lines |
| **Soft warn** | 25 Pods / 150 lines (`MOTHERSHIP_WARN_*`) |
| **Hard cap** | 50 Pods / 250 lines (`MOTHERSHIP_MAX_*`) |

Caps keep the Mothership family-sized — not a thousand-person server farm. Override in `phonehome.env` if you know what you’re doing.

## Pod

A **Pod** is one family’s parent cluster on a Mothership — Mom/Dad (and co-parents) managing their kids’ lines together.

- Maps to one **household** in the database.
- Each invited cousin family becomes **their own Pod** on the same Mothership.
- Parents in a Pod share household rules (quiet hours, kill switch, analog setup).

> “The Smith Pod and the Jones Pod both live on Grandma’s Mothership.”

**Not every parent runs a Mothership.** Most parents only join someone else’s Mothership as a new Pod.

## Circle

A **Circle** is a **parent’s** approved contact sphere — who their kids may see and call.

- Each parent has **their own** Circle (not a shared phone book).
- You choose which Circles attach to each kid’s speed dial.
- Kids only reach people parents have approved into Circles + mutual allowlist.

> “Trevor’s Circle has cousins; Layla’s Circle has school friends’ parents.”

Circles are the social watchdog layer — they stay small and parent-curated even when many Pods share one Mothership.

## Leaves

Phones on the network — softphones today; analog handsets (HT801), Bluetooth, or Home Hub hardware later. Leaves connect **to** a Mothership; they are not the Mothership.

## TreeHouse / FamilyRoom

In-app voice rooms (pad **0** and **#**). Features on the same Mothership — not separate servers.

## Trunk (technical)

Engineering term for the signaling server. Same as **Mothership**; use **Mothership** in parent-facing copy.

## Federation (future)

Two Motherships, trusted peering — see [`family-mesh.md`](./family-mesh.md) Stage 3.

## Related

| Doc | Topic |
| --- | --- |
| [`self-host.md`](./self-host.md) | Run your own Mothership |
| [`family-mesh.md`](./family-mesh.md) | Pods, invites, federation |
| [`privacy-security.md`](./privacy-security.md) | Encryption pillar |
