# Family structures (for parents)

How PhoneHome models real families. Short definitions also live in [`glossary.md`](./glossary.md); invite plumbing in [`family-mesh.md`](./family-mesh.md); Parent UI flows in [`parent-ux.md`](./parent-ux.md).

## The nesting

```
Mothership (one server — your family’s hub)
  └── Pods (family names — North, West, East)
        └── Circles (each child — who that kid may call)
```

| Structure | What it is | What it is not |
| --- | --- | --- |
| **Mothership** | The always-on server everyone joins | A second “family” |
| **Pod** | A **family name** on that server (North, West) | Mom+Dad+kids as one shared login |
| **Circle** | **One child** — approved people they may see and call | A Pod; joining someone else’s family name |
| **Co-parent / guardian** | An adult who manages that kid | Automatic membership in the other parent’s Pod |

The traditional “family unit” around a kid (both parents, grandparents, cousins, a school friend) lives mostly in **guardianship + that kid’s Circle**, not as one Pod both co-parents join.

---

## Pod (family name)

A Pod is a surname / household brand on the Mothership.

**Examples on our lab Mothership**

| Pod | Parents (members) |
| --- | --- |
| **North** | Jordan, Casey, Drew |
| **West** | Morgan (and her sister, if invited as family) |
| **East** | Cameron only |
| **South** | Reese (Quinn’s mom) |

**Rules**

- Parents in a Pod share house rules (Quiet Time, Timeout, analog setup) and **Pod grandparents**.
- Pods do **not** browse each other as phone books. Grandma North never sees Grandma West.
- **Invite family** (sister / brother / in-laws) **joins your Pod** as a parent — same family name, shared grandparents.
- Co-parenting a kid does **not** move you into the other parent’s Pod.

---

## Circle (the child)

A Circle is **the child** — their speed-dial world.

**Who curates it**

Only that kid’s **guardians** (co-parents). Pod aunts/uncles do not inherit another kid’s Circle.

**Example — Sam**

- Guardians: **Drew** and **Morgan**
- Jordan / Casey (North) and Morgan’s sister (West) do **not** manage Sam’s Circle unless they are also guardians

**Who can appear on Sam’s pad**

| Source | Examples |
| --- | --- |
| Circle invites from his guardians | School friend’s parent → their kid (after mutual approve) |
| North Pod family | Quinn, Avery (Grandma North) |
| West Pod family | Morgan’s sister’s kids; Grandma West if she sets one up |

Friend invites put someone on **one child’s Circle only** — never into North or West as a Pod member.

---

## Co-parents (guardians)

Co-parent = manage this kid (Quiet Time, Circle invites, Child mode, optional child login). **Not** “join my Pod.”

### Worked example

1. **Drew** is on **North**. He adds **Sam** under Kids (Sam’s home line lives on North).
2. He invites **Morgan** as co-parent (`?guardian=`).
3. Morgan names **West** (her family name). She becomes Sam’s guardian.
4. She does **not** join North. Drew does **not** join West.
5. Sam belongs to **both** Pods (see multi-Pod below). His “family unit” is guardianship + Circle.

Same pattern the other way: Morgan creates a kid on West, invites Drew → Drew stays North-only, becomes guardian, kid becomes multi-Pod.

**Jordan** is North only (she does not join East when co-parenting Alex/Riley). **Cameron** is East only.

---

## Multi-Pod kids

Every child belongs to **every Pod their guardians belong to**. One kid line; membership is derived.

| Kid | Pods | Why |
| --- | --- | --- |
| **Sam** | North + West | Drew (North) + Morgan (West) |
| **Alex / Riley** | East + North | Cameron (East) + Jordan (North) |
| **Quinn** | North + South | Casey (North) + Reese (South) |

They show on each parent’s Pod for family + grandparents. Circles stay guardian-curated.

---

## Who is on whose pad

Source diagram: `Sample.pdf` (South / North / West + a friend family). `server/src/familyDiagram.test.ts` builds that exact family and checks every call both ways.

| Pad | Auto | Never |
| --- | --- | --- |
| **Kid** | Their own parents (guardians); grandparents from every Pod they belong to; siblings and cousins who share a Pod | Aunts/uncles unless one of **this kid’s** parents adds them (Parent → Circle → “Aunts & uncles”, shown as “Uncle Casey”); other Pods’ grandparents; friends of a sibling |
| **Parent** | Their Pod’s grandparents; the other adults in their Pod (Casey ↔ Drew ↔ Jordan); their co-parent(s), both ways; their own kids | Co-parent’s Pod grandparents; nieces/nephews |
| **Grandparent** | Grandchildren on their Pod (incl. multi-Pod kids); that Pod’s parents | Other grandparents; another Pod’s co-parents (Morgan is not on Grandma North’s phone) |

Friends are added by approval, not automatically: friend kid ↔ one child (mutual), friend parent ↔ inviting parent (mutual). Approving a friend’s parent brings **their own kids** onto your book — never every kid in their household.

---

## Invite types (parent → parent only)

There is no “invite this cousin kid” path. Adults are invited first; they add their own kids under Kids.

| Invite | What the other adult gets | Pod effect |
| --- | --- | --- |
| **Family** (sibling / in-laws) | Parent on **your** Pod | Joins your family name; shared grandparents |
| **Friend** | Parent account if needed | **One child’s Circle only** — not your Pod |
| **Co-parent** | Guardian of that kid | Names **their** Pod if new; does **not** join yours |
| **Grandparent** | Grandparent phone on **your** Pod | Pod-shared; not a full parent Circles login |

---

## Grandparents (Pod-shared)

Grandparents belong to the **Pod**, not to one co-parent’s private book across Pods.

- Every **parent in that Pod** can Manage / Open that Grandma/Grandpa.
- Co-parents who are **not** members of that Pod do not Manage it (Morgan does not Manage Grandma North; Jordan does not Manage Grandma East).
- Kids see `{nickname} {Pod}` (e.g. Grandma North). Adults see the real name.
- **Grandparent dial pad = auto grandchildren + that Pod’s parents** (kids on that Pod, including multi-Pod kids; then the Pod’s parent phones). Analog digits: grandchildren first, manual adults, then Pod parents, so existing digits don’t shift.
- **Other adults may be added manually** to a Grandparent phone (`gp_manual`) — Approve / add contact on Grandma’s pad. Those adults stay off parent pads when the GP line is merged onto a family Pod.
- Co-parent pad 2 (e.g. Jordan as Mom on **Cameron’s** East phone) is a **parent/kid** slot — Jordan isn’t a East parent, so she stays off Sloan/Parker’s GP phone unless Grandma adds her herself.
- Grandparent pads never discover other grandparents across Pods, and never auto-discover another Pod’s parents (North adults stay off East GP books).
- A kid’s Grandparents on their Circle are only from **Pods that kid belongs to** (guardians’ family names) — not a cousin Pod’s GPs.
- Links are made when the family changes (co-parent joins, sibling joins the Pod, a kid or phone is added) — including grandparents set up **before** that. Removing a guardian drops that Pod’s grandparents from the kid.

---

## Logic paths (Pod → GP phone → Circle)

How the pieces connect. Abstract labels **Pod A / B / C** are the same shape as lab **West / North / East** — logic, not a literal 1:1 map.

```
POD A ──► GP A ──┬──► Child Circle(s) on A
                 └──► Friend branch (Circle-only adult + their kid)

POD B ──► GP B ──┬──► (with A) cousin mesh ──► Circles
                 └──► (with C) co-parent mesh ──► sibling Circles

POD C ──► GP C ──► Child Circle(s) on C (+ their own extra GPs)
```

### Layer 1 — Pod membership

| On a Pod | Who |
| --- | --- |
| Parents | Members of that family name (Family invite joins **this** Pod) |
| Grandparents | Provisioned on that Pod; shared Manage among Pod parents |
| Kids | Home line and/or multi-Pod via guardians |
| Cousins (label) | Another parent’s kid on a Pod this kid shares — on the pad automatically; **not** Pod membership of the other house |

### Layer 2 — Grandparent phones

| Auto on the pad | Not auto |
| --- | --- |
| Grandchildren who **belong to that Pod** (including multi-Pod kids) | Another Pod’s co-parents, Circle friends |
| That Pod’s **parents** | Other Pods’ grandparents |

Other adults can still be **added manually** on Grandma’s phone.

### Layer 3 — Child Circles

| On the kid’s pad | How they get there |
| --- | --- |
| **Parents** (Mom/Dad) | Guardians of that child |
| **Grandparents** | Only GPs on Pods **this kid belongs to** (e.g. Child C on Pods C+D → GPs C, D, and D’s extras — **not** Pod B’s GPs) |
| **Sibling** | Same guardians / same multi-Pod pair |
| **Cousin** | Kids of different parents who share a Pod (Family) — automatic, no approve step |
| **Aunt / Uncle** | Only when this kid’s parent adds them for this kid (`kid_adult_contacts`); never automatic from sharing a Pod |
| **Friend** | Friend invite → **this Circle only**; dashed link in the mesh, no Pod join |

Extra Circles (more kids on a Pod) can branch the same way without drawing every node — same rules, more pads.

### Relationship cheat sheet

| Relationship | Invite / structure | Discovery |
| --- | --- | --- |
| Co-parents | `?guardian=` | Shared kid; separate Pods; kid multi-Pod; each on the other’s parent pad |
| Pod family (aunt/uncle) | Family invite | Same Pod + shared GPs; on each other’s parent pads; not on the other’s kid pads; not a Circle curator |
| Cousins | Share a Pod (via Family invite) | Automatic on kid pads; not Pod members of the other house |
| Friends | Friend invite | One child’s Circle only (mutual approve) |
| Grandchild ↔ Grandma | Pod provision | Auto on GP pad; kid sees GPs from **their** Pods only |
| Pod parent ↔ Grandma | Pod provision / Family invite | Auto both ways |

---

## Quick myths

| Myth | Reality |
| --- | --- |
| Co-parents share one Pod | No — each keeps their family name; the kid is multi-Pod |
| “Family” = the household both parents join | No — that unit is **guardianship + Circle** |
| Aunt on my Pod manages my kid’s Circle | No — guardians only |
| Friend invite joins my Pod | No — Circle only |
| Family invite creates a new Pod | No — they join **yours** |
| Grandma auto-sees Mom/Dad | Yes, if they’re parents **in her Pod** — never another Pod’s co-parent |
| Cousin Pod’s Grandma appears on my kid’s Circle | No — only GPs from Pods that kid belongs to |
| My kid can call my brother (their uncle) because we share a Pod | Not automatically — add him on your kid’s Circle and he shows as “Uncle …” |
| Two kids on one Pod share the house phone’s “2” | No — 2 is each kid’s own co-parent |

---

## Related docs

- [`glossary.md`](./glossary.md) — term definitions  
- [`family-mesh.md`](./family-mesh.md) — invite mechanics, TreeHouse, federation  
- [`parent-ux.md`](./parent-ux.md) — Parent panel steps  
- [`privacy-security.md`](./privacy-security.md) — encryption & data minimization  
