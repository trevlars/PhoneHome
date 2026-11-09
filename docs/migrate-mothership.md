# Move my household to a new Mothership

Common path: Parent B joins **Friend A’s** mothership (account + kid + maybe HT801). Later B wants **their own** mothership ($25/year or trial) but still needs to call A’s family.

**In-app:** every signed-in parent gets **Parent → Start your own Mothership** — a stateful stepper (pack → get hub → connect → restore → house phones → leave → cousins). Operators keep peering under **Parent → Mothership** as well.

**Pitch:** your own hub is ~$25/yr (or $20 year one with `OWNMS5`) for the whole mesh — softphones free, any thrift/vintage/cordless RJ11 via HT801 — vs Tin Can’s ~$135 device + Party Line, or kid-watch monthly plans. Storefront: [`/compare.html`](https://phonehome.pages.dev/compare.html).

**Peering** ([`family-mesh.md`](./family-mesh.md) Stage 3) is still required for cross-hub Circles after the split. Restore alone does **not** invent `peer:` allowlist rows until a peer exists.

## Pricing (spinoff)

- First year **$20** via promo code **`OWNMS5`** (or a friend’s `?ref=` link — same $5 off from $25 list).
- Referring host gets a **$3 Stripe customer credit** toward their next renewal when the referred checkout completes.
- Storefront: `https://phonehome.pages.dev/buy.html?promo=OWNMS5&source=spinoff` or `?ref=PHXXXX`.

## Automagic path (happy)

1. **Pack my Pod** on hub A — `POST /api/households/:id/migrate/export` (export **v2**). The app saves a **device transfer** (`ph_migrate_transfer_v1`: export + `fromUrl` + household id) in iOS UserDefaults / web `localStorage` so **Change Mothership** does not lose it.
2. **Get your Mothership** — trial / buy (`OWNMS5`). Softphones free; ATA kids get **fresh** config on B (no SIP password migration).
3. **Connect** — Change Mothership to B’s HTTPS URL; transfer stays on the device.
4. **Restore my Pod** on B — `POST /api/migrate/import` with `{ export }`:
   - Creates / uses the acting parent’s owned household
   - Recreates **child** lines (type + label), remaps kid↔kid allowlist
   - Ensures parent softphone
   - Returns `{ householdId, lineIdMap, restoredAllowlist, pendingExternalContacts[], ataLineIds[] }`
   - Contacts that lived only on A stay in `pendingExternalContacts` until peering
5. **House phones** — one-tap HT801 config download per restored ATA line on B.
6. **Leave the old hub** — guided bounce: switch back to A (cookies are origin-scoped), **Depart**, then return to B.
7. **Keep calling cousins** — operators create a peer invite; non-operators ask their hub host. Peering still required for cross-hub Circles.

## APIs

| Action | Endpoint |
|--------|----------|
| Export (v2) | `POST /api/households/:id/migrate/export` |
| Import / restore | `POST /api/migrate/import` body `{ export }` (auth; parent only) |
| Soft depart | `POST /api/households/:id/migrate/depart` |

Export includes: Pod quiet fields, parent display names, lines (`id`, `name`, `type`, `mode`, `child_label`), allowlist (`target_line_id`, `label`, `speed_dial`, `favorite`, `always_allow`), ATA/app checklists. **Not** passwords, SIP secrets, voicemail, or other Pods’ graphs.

Legacy **v1** exports (e.g. `type: "child"`) still import.

## Privacy

Each host keeps their own database. Export/import are minimization: roster + Circle edges for the leaving Pod, not voicemail audio or other families’ data.

## Marketing note

Do not promise “leave and keep calling cousins” until mothership peering is enabled on both sides.
