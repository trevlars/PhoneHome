/**
 * Audit grandparent dial books vs product rules:
 * - Auto: grandchildren on provisioning Pod(s) only
 * - Manual adults: gp_manual=1 only
 * - Never: other Pods' parents, peer GPs, cousin-only kids
 *
 * cd /opt/kids-landline && npx tsx server/scripts/audit-gp-books.ts
 */
import { openDb } from "../src/db.js";
import {
  canCall,
  canViewerSeeLine,
  grandparentMaySeeLine,
  householdSnapshot,
  listGrandparentDialKids,
} from "../src/api.js";

const db = openDb(process.env.DB_PATH || "/var/lib/kids-landline/kids-landline.db");

type Prov = {
  relative_user_id: string;
  relative_line_id: string;
  relative_household_id: string;
  from_household_id: string;
  display_name: string;
  from_pod: string;
  rel_pod: string;
};

const gps = db
  .prepare(
    `SELECT pr.relative_user_id, pr.relative_line_id, pr.relative_household_id, pr.from_household_id,
            u.display_name, fh.name AS from_pod, rh.name AS rel_pod
     FROM provisioned_relatives pr
     JOIN users u ON u.id = pr.relative_user_id
     JOIN households fh ON fh.id = pr.from_household_id
     JOIN households rh ON rh.id = pr.relative_household_id
     ORDER BY fh.name, u.display_name`
  )
  .all() as Prov[];

const parents = db
  .prepare(
    `SELECT l.id, l.name, l.household_id, IFNULL(l.mode,'parent') AS mode,
            u.display_name, h.name AS pod
     FROM lines l
     JOIN users u ON u.id = l.owner_user_id
     JOIN households h ON h.id = l.household_id
     WHERE IFNULL(l.mode,'parent') != 'child'
       AND NOT EXISTS (SELECT 1 FROM provisioned_relatives pr WHERE pr.relative_line_id = l.id)
     ORDER BY u.display_name`
  )
  .all() as {
  id: string;
  name: string;
  household_id: string;
  mode: string;
  display_name: string;
  pod: string;
}[];

console.log("=== PROVISIONED GPs ===");
for (const g of gps) {
  console.log(
    `  ${g.display_name}: from=${g.from_pod} rel=${g.rel_pod} merged=${g.from_household_id === g.relative_household_id}`
  );
}

const problems: string[] = [];

for (const gp of gps) {
  console.log(`\n######## ${gp.display_name} (${gp.from_pod}) ########`);
  // Read-only audit — never scrub/sync (that wiped shared Pod books).

  const dialKids = listGrandparentDialKids(db, gp.relative_user_id);
  console.log(
    "  expected dial kids:",
    dialKids.map((k) => k.child_label || k.name).join(", ") || "(none)"
  );

  const al = db
    .prepare(
      `SELECT a.id, a.label, a.speed_dial, IFNULL(a.gp_manual,0) AS gp_manual,
              tl.id AS target_id, tl.name, tl.child_label, IFNULL(tl.mode,'parent') AS mode,
              u.display_name AS owner, th.name AS target_pod
       FROM allowlist a
       JOIN lines tl ON tl.id = a.target_line_id
       LEFT JOIN users u ON u.id = tl.owner_user_id
       LEFT JOIN households th ON th.id = tl.household_id
       WHERE a.household_id = ?
       ORDER BY a.speed_dial IS NULL, a.speed_dial, a.label`
    )
    .all(gp.relative_household_id) as {
    id: string;
    label: string;
    speed_dial: number | null;
    gp_manual: number;
    target_id: string;
    name: string;
    child_label: string | null;
    mode: string;
    owner: string | null;
    target_pod: string | null;
  }[];

  const sharedBook = gp.from_household_id === gp.relative_household_id;
  console.log("  allowlist on relative_hh:");
  for (const r of al) {
    const kidOk = dialKids.some((k) => k.id === r.target_id);
    let flag: string;
    if (r.mode === "child") {
      flag = kidOk ? "OK-kid" : sharedBook ? "SHARED-cousin-kid" : "BAD-kid-not-grandchild";
    } else if (r.gp_manual) {
      flag = "OK-manual-adult";
    } else {
      flag = sharedBook ? "SHARED-family-adult" : "BAD-auto-adult";
    }
    // Only private GP houses must be grandchildren + gp_manual in the raw table.
    if (flag.startsWith("BAD")) {
      problems.push(`${gp.display_name}/${gp.from_pod}: allow ${r.label} (${r.owner}@${r.target_pod}) → ${flag}`);
    }
    console.log(
      `    [${flag}] ${r.label}@${r.speed_dial ?? "—"} mode=${r.mode} gp_manual=${r.gp_manual} owner=${r.owner} pod=${r.target_pod}`
    );
  }

  // Also scan from_household if different (shouldn't for merged)
  if (gp.from_household_id !== gp.relative_household_id) {
    const al2 = db
      .prepare(
        `SELECT a.label, IFNULL(a.gp_manual,0) AS gp_manual, IFNULL(tl.mode,'parent') AS mode, u.display_name AS owner
         FROM allowlist a JOIN lines tl ON tl.id = a.target_line_id
         LEFT JOIN users u ON u.id = tl.owner_user_id
         WHERE a.household_id = ?`
      )
      .all(gp.from_household_id);
    console.log("  allowlist on from_hh:", al2);
  }

  const snap = householdSnapshot(db, gp.relative_user_id);
  for (const h of snap.households) {
    const allow = (h.allowlist || []).map(
      (a: { label: string; speed_dial: number | null; target_mode?: string; target_line_id: string }) => {
        const kidOk = dialKids.some((k) => k.id === a.target_line_id);
        if (a.target_mode === "child" && !kidOk) {
          problems.push(`${gp.display_name} SNAP ${h.name}: ${a.label} not a dial grandchild`);
        }
        if (a.target_mode !== "child") {
          const row = al.find((x) => x.target_id === a.target_line_id);
          if (!row?.gp_manual) {
            problems.push(`${gp.display_name} SNAP ${h.name}: adult ${a.label} without gp_manual`);
          }
        }
        return `${a.label}@${a.speed_dial ?? "—"}(${a.target_mode || "?"})`;
      }
    );
    console.log(`  SNAP ${h.name} allow=[${allow.join("; ") || "—"}]`);
    const lines = (h.lines || []).map(
      (l: { child_label?: string; name: string; mode?: string; is_grandparent?: boolean }) =>
        `${l.child_label || l.name}(${l.mode || "?"}${l.is_grandparent ? ",gp" : ""})`
    );
    console.log(`  SNAP ${h.name} lines=[${lines.join("; ") || "—"}]`);
  }

  console.log("  visibility vs Pod parents:");
  for (const p of parents) {
    const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(p.id) as Parameters<
      typeof grandparentMaySeeLine
    >[2];
    const may = grandparentMaySeeLine(db, gp.relative_user_id, line);
    const see = canViewerSeeLine(db, gp.relative_user_id, p.id);
    const call = canCall(db, gp.relative_line_id, p.id);
    if (may || see || call.ok) {
      problems.push(
        `${gp.display_name} can reach parent ${p.display_name}@${p.pod}: may=${may} see=${see} call=${call.ok}`
      );
      console.log(`    LEAK ${p.display_name}@${p.pod} may=${may} see=${see} call=${call.ok} (${call.reason || "ok"})`);
    }
  }

  // Peer GPs
  for (const other of gps) {
    if (other.relative_user_id === gp.relative_user_id) continue;
    const see = canViewerSeeLine(db, gp.relative_user_id, other.relative_line_id);
    const call = canCall(db, gp.relative_line_id, other.relative_line_id);
    if (see || call.ok) {
      problems.push(`${gp.display_name} ↔ ${other.display_name}: see=${see} call=${call.ok}`);
      console.log(`    PEER LEAK ${other.display_name} see=${see} call=${call.ok}`);
    }
  }
}

console.log("\n=== EAST RAW ALLOWLIST (shared book) ===");
const east = db.prepare(`SELECT id FROM households WHERE name = 'East'`).get() as
  | { id: string }
  | undefined;
if (east) {
  const rows = db
    .prepare(
      `SELECT a.label, a.speed_dial, IFNULL(a.gp_manual,0) AS gp_manual,
              IFNULL(tl.mode,'parent') AS mode, u.display_name AS owner, th.name AS pod
       FROM allowlist a
       JOIN lines tl ON tl.id = a.target_line_id
       LEFT JOIN users u ON u.id = tl.owner_user_id
       LEFT JOIN households th ON th.id = tl.household_id
       WHERE a.household_id = ?
       ORDER BY a.speed_dial IS NULL, a.speed_dial, a.label`
    )
    .all(east.id);
  console.log(rows);
}

console.log("\n=== PROBLEM SUMMARY ===");
if (!problems.length) console.log("(none)");
else for (const p of problems) console.log(" •", p);

db.close();
process.exit(problems.length ? 1 : 0);
