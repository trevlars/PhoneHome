/**
 * Safe repair only:
 * - Remove same-household allowlist self-rows (GP / kid on own Pod book)
 * - Re-sync *private* GP houses (merged/shared Pods are no-ops in sync now)
 * - Re-ensure kids’ cross-Pod grandparent links + dial collapse
 * - Co-parents on each other’s Pods; Pod parents on their Pod grandparents’ books
 *
 * Does NOT strip cousin kids or cross-Pod parents from shared family books —
 * those are intentional; GP viewers are filtered at snapshot time.
 *
 * cd /opt/kids-landline && npx tsx server/scripts/repair-family-allowlists.ts
 */
import Database from "better-sqlite3";
import {
  podsForKid,
  scrubGrandparentPeerIsolation,
  syncKidFamilyLinks,
  syncProvisionedRelativePodBook,
} from "../src/api.js";
import {
  ensureKidMultiPodGrandparentAllowlists,
  syncGrandparentDialCollapse,
} from "../src/grandparentsMenu.js";

const dbPath = process.env.DB_PATH || "/var/lib/kids-landline/kids-landline.db";
const db = new Database(dbPath);

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function ensurePair(householdId: string, targetLineId: string, label: string): void {
  const existing = db
    .prepare(`SELECT id FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
    .get(householdId, targetLineId);
  if (existing) {
    db.prepare(`UPDATE allowlist SET label = ? WHERE household_id = ? AND target_line_id = ?`).run(
      label,
      householdId,
      targetLineId
    );
    return;
  }
  db.prepare(
    `INSERT INTO allowlist (id, household_id, target_line_id, label, speed_dial, favorite, always_allow, created_at)
     VALUES (?, ?, ?, ?, NULL, 1, 0, ?)`
  ).run(newId("al"), householdId, targetLineId, label, new Date().toISOString());
}

const polluted = db
  .prepare(
    `SELECT a.id, a.household_id, a.label, a.target_line_id, l.mode, h.name AS pod
     FROM allowlist a
     JOIN lines l ON l.id = a.target_line_id
     JOIN households h ON h.id = a.household_id
     WHERE l.household_id = a.household_id`
  )
  .all() as {
  id: string;
  household_id: string;
  label: string;
  target_line_id: string;
  mode: string | null;
  pod: string;
}[];

console.log(`Scanning ${polluted.length} same-household allowlist rows…`);
for (const row of polluted) {
  const isGp = db
    .prepare(`SELECT 1 FROM provisioned_relatives WHERE relative_line_id = ?`)
    .get(row.target_line_id);
  const isKid = (row.mode || "parent") === "child";
  if (!isGp && !isKid) {
    console.log(`  keep ${row.pod} ${row.label} (parent line)`);
    continue;
  }
  console.log(`  DELETE ${row.pod} ${row.label} (${isGp ? "gp" : "kid"} self-row)`);
  db.prepare(`DELETE FROM allowlist WHERE id = ?`).run(row.id);
}

const gps = db
  .prepare(`SELECT from_household_id, relative_user_id, display_label FROM provisioned_relatives`)
  .all() as { from_household_id: string; relative_user_id: string; display_label: string | null }[];
for (const gp of gps) {
  console.log(`Sync GP book ${gp.display_label || gp.relative_user_id}`);
  scrubGrandparentPeerIsolation(db, gp.relative_user_id);
  syncProvisionedRelativePodBook(db, gp.from_household_id, gp.relative_user_id);
}

const kids = db
  .prepare(`SELECT id, child_label, name, household_id FROM lines WHERE mode = 'child'`)
  .all() as { id: string; child_label: string | null; name: string; household_id: string }[];

for (const kid of kids) {
  const pods = podsForKid(db, kid.id);
  console.log(`Repair GPs for ${kid.child_label || kid.name} pods=${pods.length}`);
  // Co-parents both ways + every Pod grandparent (incl. ones set up before the co-parent joined).
  syncKidFamilyLinks(db, kid.id);
  ensureKidMultiPodGrandparentAllowlists(db, kid.id, pods, ensurePair);
  syncGrandparentDialCollapse(db, kid.household_id);
}

console.log("\n=== Allowlists after repair ===");
for (const h of db.prepare(`SELECT id, name FROM households ORDER BY name`).all() as {
  id: string;
  name: string;
}[]) {
  const rows = db
    .prepare(
      `SELECT label, speed_dial FROM allowlist WHERE household_id = ? ORDER BY speed_dial IS NULL, speed_dial`
    )
    .all(h.id) as { label: string; speed_dial: number | null }[];
  console.log(
    h.name,
    rows.map((r) => `${r.label}@${r.speed_dial ?? "—"}`).join(", ") || "(empty)"
  );
}

db.close();
console.log("Done.");
