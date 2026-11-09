/**
 * Live family health check after multi-Pod GP sync.
 * cd /opt/kids-landline && npx tsx server/scripts/audit-families.ts
 *
 * Not read-only: householdSnapshot runs the same self-heal scrubs as /api/me.
 * Point DB_PATH at a backup copy for a true dry run.
 */
import Database from "better-sqlite3";
import { canCall, householdSnapshot, podsForKid } from "../src/api.js";
import { listKidGrandparentMenuChoices } from "../src/grandparentsMenu.js";

const db = new Database(process.env.DB_PATH || "/var/lib/kids-landline/kids-landline.db");

console.log("=== ALLOWLIST BY POD ===");
for (const h of db.prepare(`SELECT id, name FROM households ORDER BY name`).all() as {
  id: string;
  name: string;
}[]) {
  const rows = db
    .prepare(
      `SELECT label, speed_dial, target_line_id FROM allowlist WHERE household_id = ? ORDER BY speed_dial IS NULL, speed_dial, label`
    )
    .all(h.id) as { label: string; speed_dial: number | null; target_line_id: string }[];
  console.log(
    h.name,
    `(${rows.length})`,
    rows.map((r) => `${r.label}@${r.speed_dial ?? "—"}`).join(", ") || "(empty)"
  );
}

console.log("\n=== PER PARENT ===");
const parents = db
  .prepare(
    `SELECT id, display_name, username, profile_role FROM users
     WHERE COALESCE(profile_role, '') != 'child' ORDER BY display_name`
  )
  .all() as { id: string; display_name: string; username: string; profile_role: string }[];

for (const u of parents) {
  let snap;
  try {
    snap = householdSnapshot(db, u.id);
  } catch (e) {
    console.log(u.display_name, "SNAP FAIL", (e as Error).message);
    continue;
  }
  for (const hh of snap.households || []) {
    const kids = (hh.lines || []).filter((l) => (l.mode || "parent") === "child");
    const manage = kids.filter((k) => k.can_manage).map((k) => k.child_label || k.name);
    const see = kids.filter((k) => !k.can_manage).map((k) => k.child_label || k.name);
    const allow = (hh.allowlist || []).map(
      (a) =>
        `${a.label}@${a.speed_dial ?? "—"}${a.grandparents_menu ? "[MENU]" : ""}${a.is_grandparent ? "*" : ""}`
    );
    const lines = (hh.lines || []).map((l) => {
      const n = l.child_label || l.name;
      const flags = [
        l.mode,
        l.can_operate ? "op" : null,
        l.can_manage ? "mgr" : null,
        l.is_grandparent ? "gp" : null,
        l.multi_pod ? "multi" : null,
      ]
        .filter(Boolean)
        .join(",");
      return `${n}(${flags})`;
    });
    console.log(
      `${u.display_name} @ ${hh.name} [${hh.access}] role=${u.profile_role || "parent"}`
    );
    console.log(`  manage=[${manage.join(", ") || "—"}] see-only=[${see.join(", ") || "—"}]`);
    console.log(`  allow=[${allow.join("; ") || "—"}]`);
    console.log(`  lines=[${lines.join("; ")}]`);
  }
}

console.log("\n=== KID GP MENUS ===");
const kids = db
  .prepare(`SELECT id, child_label, name FROM lines WHERE mode = 'child'`)
  .all() as { id: string; child_label: string | null; name: string }[];
const gps = db
  .prepare(`SELECT relative_line_id, display_label FROM provisioned_relatives`)
  .all() as { relative_line_id: string; display_label: string }[];

for (const k of kids) {
  console.log(`\n${k.child_label || k.name} pods=${JSON.stringify(podsForKid(db, k.id))}`);
  console.log(
    "  menu=",
    listKidGrandparentMenuChoices(db, k.id).map((c) => c.label)
  );
  for (const g of gps) {
    const r = canCall(db, k.id, g.relative_line_id);
    if (!r.ok) console.log(`  NO CALL ${g.display_label}: ${r.reason}`);
  }
}

console.log("\n=== SUSPICIOUS: allowlist target = household line (dup risk) ===");
for (const h of db.prepare(`SELECT id, name FROM households`).all() as { id: string; name: string }[]) {
  const dups = db
    .prepare(
      `SELECT a.label, a.target_line_id, l.name FROM allowlist a
       JOIN lines l ON l.id = a.target_line_id AND l.household_id = a.household_id
       WHERE a.household_id = ?`
    )
    .all(h.id) as { label: string; target_line_id: string; name: string }[];
  if (dups.length) console.log(h.name, dups.map((d) => `${d.label}→${d.name}`).join(", "));
}

db.close();
