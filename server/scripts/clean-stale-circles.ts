/**
 * One-off: drop Circle (sphere) members that are no longer anyone’s contact — adults
 * the owner can’t call and has no family or friend-invite tie to. Those surface as
 * “Approve?” requests that can never work. Kids and grandparents are kept.
 *
 * Dry run:  cd /opt/kids-landline && npx tsx server/scripts/clean-stale-circles.ts
 * Apply:    … clean-stale-circles.ts --apply   (backup the DB first)
 */
import {
  isFriendInviteCircleLine,
  isGrandparentPeerLine,
  isTestReviewAccount,
  isTestReviewContactAccount,
  linesMayConnect,
  parentLineForUser,
} from "../src/api.js";
import { openDb } from "../src/db.js";

const apply = process.argv.includes("--apply");
const db = openDb(process.env.DB_PATH || "/var/lib/kids-landline/kids-landline.db");

const rows = db
  .prepare(
    `SELECT s.id AS sphere_id, s.owner_user_id AS owner, u.display_name AS owner_name,
            m.line_id, l.mode, l.owner_user_id AS line_owner, l.household_id,
            COALESCE(l.child_label, l.name) AS line_name
     FROM spheres s
     JOIN users u ON u.id = s.owner_user_id
     JOIN sphere_members m ON m.sphere_id = s.id
     JOIN lines l ON l.id = m.line_id`
  )
  .all() as {
  sphere_id: string;
  owner: string;
  owner_name: string;
  line_id: string;
  mode: string;
  line_owner: string;
  household_id: string;
  line_name: string;
}[];

const ownerPhones = new Map<string, string[]>();
const phonesOf = (uid: string) => {
  if (!ownerPhones.has(uid)) {
    const own = (
      db.prepare(`SELECT id FROM lines WHERE owner_user_id = ?`).all(uid) as { id: string }[]
    ).map((r) => r.id);
    const childLogin = (
      db.prepare(`SELECT id FROM lines WHERE child_user_id = ?`).all(uid) as { id: string }[]
    ).map((r) => r.id);
    const primary = parentLineForUser(db, uid);
    ownerPhones.set(uid, [...new Set([...own, ...childLogin, ...(primary ? [primary.id] : [])])]);
  }
  return ownerPhones.get(uid)!;
};

let removed = 0;
for (const r of rows) {
  if (r.mode === "child" || isGrandparentPeerLine(db, r.line_id)) continue;
  if (r.line_owner === r.owner) continue;
  // TestFlight review pairing (Test ↔ Cameron) has its own rules.
  if (isTestReviewAccount(db, r.owner) || isTestReviewAccount(db, r.line_owner)) continue;
  if (isTestReviewContactAccount(db, r.owner) && isTestReviewAccount(db, r.line_owner)) continue;
  const sharePod = db
    .prepare(
      `SELECT 1 FROM household_members a JOIN household_members b ON a.household_id = b.household_id
       WHERE a.user_id = ? AND b.user_id = ? LIMIT 1`
    )
    .get(r.owner, r.line_owner);
  if (sharePod) continue;
  if (isFriendInviteCircleLine(db, r.owner, r.line_id)) continue;
  if (phonesOf(r.owner).some((p) => linesMayConnect(db, p, r.line_id))) continue;
  console.log(`${apply ? "DELETE" : "would delete"} ${r.owner_name}’s Circle: ${r.line_name}`);
  if (apply) {
    db.prepare(`DELETE FROM sphere_members WHERE sphere_id = ? AND line_id = ?`).run(r.sphere_id, r.line_id);
  }
  removed += 1;
}
console.log(`${apply ? "Removed" : "Would remove"} ${removed} stale Circle member(s).${apply ? "" : " Re-run with --apply."}`);
db.close();
