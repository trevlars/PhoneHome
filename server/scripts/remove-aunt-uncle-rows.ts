/**
 * One-off: drop aunt/uncle rows from kid-facing Pod books. Aunts/uncles now reach a
 * kid only when that kid’s parent adds them (kid_adult_contacts), never via the book.
 *
 * Dry run:  cd /opt/kids-landline && npx tsx server/scripts/remove-aunt-uncle-rows.ts
 * Apply:    … remove-aunt-uncle-rows.ts --apply   (backup the DB first)
 */
import {
  householdParentUserIds,
  isGrandparentPeerLine,
  isGuardian,
  kidsBelongingToPod,
  podsForKid,
} from "../src/api.js";
import { openDb } from "../src/db.js";

const apply = process.argv.includes("--apply");
const db = openDb(process.env.DB_PATH || "/var/lib/kids-landline/kids-landline.db");

const households = db.prepare(`SELECT id, name FROM households ORDER BY name`).all() as {
  id: string;
  name: string;
}[];
let removed = 0;
for (const hh of households) {
  const kids = kidsBelongingToPod(db, hh.id);
  if (!kids.length) continue;
  const relativeUsers = new Set<string>();
  for (const kid of kids) {
    for (const pod of podsForKid(db, kid.id)) {
      for (const uid of householdParentUserIds(db, pod)) relativeUsers.add(uid);
    }
  }
  const rows = db
    .prepare(
      `SELECT a.id, a.label, l.id AS line_id, l.household_id, l.owner_user_id, l.mode
       FROM allowlist a JOIN lines l ON l.id = a.target_line_id
       WHERE a.household_id = ?`
    )
    .all(hh.id) as {
    id: string;
    label: string;
    line_id: string;
    household_id: string;
    owner_user_id: string;
    mode: string;
  }[];
  for (const r of rows) {
    if (r.mode !== "parent" || r.household_id === hh.id) continue;
    if (isGrandparentPeerLine(db, r.line_id)) continue;
    // A parent’s own approval (Cameron approved Casey on his dialpad) is not a kid row.
    const ownApproval = db
      .prepare(
        `SELECT 1 FROM parent_contacts pc JOIN household_members m ON m.user_id = pc.owner_user_id
         WHERE m.household_id = ? AND pc.target_line_id = ? LIMIT 1`
      )
      .get(hh.id, r.line_id);
    if (ownApproval) continue;
    if (kids.some((k) => isGuardian(db, r.owner_user_id, k.id))) continue;
    if (!relativeUsers.has(r.owner_user_id)) continue;
    console.log(`${apply ? "DELETE" : "would delete"} ${hh.name}: ${r.label}`);
    if (apply) db.prepare(`DELETE FROM allowlist WHERE id = ?`).run(r.id);
    removed += 1;
  }
}
console.log(`${apply ? "Removed" : "Would remove"} ${removed} aunt/uncle row(s).${apply ? "" : " Re-run with --apply."}`);
db.close();
