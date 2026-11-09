/**
 * Live audit: every parent's can_manage on child lines must equal isGuardian.
 * Run on CT122: cd /opt/kids-landline && npx tsx server/scripts/audit-can-manage.ts
 */
import Database from "better-sqlite3";
import { canManageChild, householdSnapshot, isGuardian } from "../src/api.js";

const dbPath = process.env.DB_PATH || "/var/lib/kids-landline/kids-landline.db";
const db = new Database(dbPath);

const parents = db
  .prepare(
    `SELECT id, display_name, username, profile_role
     FROM users
     WHERE COALESCE(profile_role, '') != 'child'
     ORDER BY display_name`
  )
  .all() as { id: string; display_name: string; username: string; profile_role: string }[];

const bad: object[] = [];
const ok: string[] = [];

for (const u of parents) {
  const snap = householdSnapshot(db, u.id);
  for (const hh of snap.households || []) {
    const childLines = (hh.lines || []).filter((l) => (l.mode || "parent") === "child");
    if (!childLines.length) continue;
    const manage: string[] = [];
    const seeOnly: string[] = [];
    for (const line of childLines) {
      const expect = isGuardian(db, u.id, line.id);
      const got = Boolean(line.can_manage);
      const server = canManageChild(db, u.id, line.id);
      const label = String(line.child_label || line.name);
      if (got !== expect || server !== expect) {
        bad.push({
          user: u.display_name || u.username,
          pod: hh.name,
          kid: label,
          expect,
          snap_can_manage: got,
          server_can_manage: server,
        });
      } else if (expect) {
        ok.push(`${u.display_name} → ${label} (${hh.name}${line.multi_pod ? " multi" : ""})`);
      }
      if (got) manage.push(label);
      else seeOnly.push(label);
    }
    console.log(
      `${u.display_name} @ ${hh.name} [${hh.access}]: manage=[${manage.join(", ") || "—"}] see-only=[${seeOnly.join(", ") || "—"}]`
    );
  }
}

console.log("\n=== Guardians OK ===");
for (const line of ok) console.log(" ", line);
console.log("\n=== MISMATCHES ===");
if (!bad.length) console.log("  none");
else for (const row of bad) console.log(JSON.stringify(row));

db.close();
process.exit(bad.length ? 1 : 0);
