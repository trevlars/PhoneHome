# PhoneHome glossary

**PhoneHome** is the product — the app, the brand, the family voice network.

For a parent-facing walkthrough of Pods, Circles, co-parents, and multi-Pod kids (with North / West / East examples), see [`family-structures.md`](./family-structures.md).

These three layers help parents and hosts talk about how it works:

```
Mothership (one server)
  └── Pods (family names — North, West)
        └── Circles (each child — who that kid may call)
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
| **Sweet spot** | ~10–35 lines |
| **Soft warn** | 40 lines (`MOTHERSHIP_WARN_LINES`) |
| **Hard cap** | 50 lines (`MOTHERSHIP_MAX_LINES`) |
| **Pods** | No cap by default (`MOTHERSHIP_MAX_PODS` is optional) |

Lines (softphones + ATAs) are what load the server, so they are the only default cap. It keeps the Mothership family-sized — not a thousand-person server farm. Override in `phonehome.env` if you know what you’re doing.

## Pod

A **Pod** is a **family name** on a Mothership — e.g. **North** (Jordan, Casey, Drew), **East** (Cameron), or **West** (Morgan and her sister).

- Maps to one **household** in the database.
- Parents in a Pod share household rules (kids’ Quiet Time hours, kill switch, analog setup) and **Pod grandparents**. Each adult’s Do Not Disturb timezone is per phone; kids inherit that parent’s timezone for bedtime/school.
- **Every child is multi-Pod:** they belong to every Pod their parents/guardians belong to (Sam → North via Drew and West via Morgan; Alex & Riley → North and East). One kid line; membership is derived from guardianship + parent Pods.
- **Pods do not cross-see each other** as phone books. Grandma North cannot see or call Grandma West (and vice versa).
- **Invite family** (sibling / in-laws) **joins your Pod** as a parent — same family name, shared grandparents (Morgan and her sister both Manage Mom).

> “The North Pod and the West Pod both live on our Mothership — they don’t share a phone book.”

**Not every parent runs a Mothership.** Most parents join someone else’s Mothership (create their own Pod, or redeem a family invite into an existing one).

## Circle

A **Circle** is **the child** — the approved people that kid may see and call.

- The traditional “family unit” around a kid (both parents, relatives, friends they’re allowed to call) lives here — **not** as one shared Pod both co-parents join.
- Each **guardian** controls who is on their kids’ Circles (invite + mutual approve). Pod aunts do not inherit another kid’s Circle.
- Most families keep **one child line** even when that child sits on multiple Pods.
- Same-Pod family kids (siblings and cousins, including multi-Pod peers on a shared family name) reach each other automatically; friends still need Circle approval.
- Adults on a kid’s Circle are **that kid’s own parents**, plus any aunt/uncle one of those parents added for that kid (“Uncle Casey”). Sharing a Pod never adds them automatically.
- **Invite a friend’s parent** (non-family) puts them on **one child’s Circle only** — not into the North or West Pod. That parent sets up their child. There is no invite-a-cousin-kid path.
- **Co-parent invite:** Drew (North) creates Sam, invites Morgan → she names **West** and becomes guardian. She does **not** join North. Sam’s multi-Pod membership follows both parents’ Pods.

> “Sam’s Circle has Grandma North, cousins, and one school friend. The friend is not in the North Pod.”

Circles stay small and parent-curated even when many Pods share one Mothership.

## Grandparents (Pod-shared)

Grandparents belong to the **Pod**, like a shared child account every parent in that Pod can manage.

- North parents (Jordan, Casey, Drew) **Manage / Open** Avery (Grandma North) only.
- East’s only parent (Cameron) **Manage / Opens** Grandma East and Grandpa East. Jordan does not.
- Kids see `{nickname} {Pod}` (Grandma North, Meemaw North, Grandpa East). Adults see the real name.
- Grandma’s book = **auto grandchildren** who belong to that Pod (including multi-Pod kids) **plus that Pod’s parents** (both ways — they have her too). Another Pod’s co-parents and parent dialpad contacts are **not** auto-added; other adults can still be added **manually** on Grandma’s phone.
- Grandparent pads never discover other grandparents across Pods.
- Kids only inherit grandparents from **Pods they belong to** — not from a cousin’s Pod.

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
| [`parent-ux.md`](./parent-ux.md) | Parent walkthrough copy |
| [`privacy-security.md`](./privacy-security.md) | Encryption pillar |
