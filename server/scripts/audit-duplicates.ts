/**
 * Live audit: duplicate kids / lines across Pods and UI surfaces.
 * Multi-Pod kids appearing once per Pod in the snapshot is expected;
 * Active line uses operableLines() which dedupes by id.
 * cd /opt/kids-landline && npx tsx server/scripts/audit-duplicates.ts
 */
import Database from "better-sqlite3";
import { householdSnapshot } from "../src/api.js";

const dbPath = process.env.DB_PATH || "/var/lib/kids-landline/kids-landline.db";
const db = new Database(dbPath);
const bugs: string[] = [];
const expected: string[] = [];

function bug(msg: string) {
  bugs.push(msg);
  console.log("BUG:", msg);
}
function expectMulti(msg: string) {
  expected.push(msg);
  console.log("OK (multi-Pod):", msg);
}

const parents = db
  .prepare(
    `SELECT id, display_name, username, profile_role
     FROM users WHERE COALESCE(profile_role, '') != 'child'
     ORDER BY display_name`
  )
  .all() as { id: string; display_name: string; username: string }[];

console.log("=== Per-user surfaces ===\n");

for (const u of parents) {
  const snap = householdSnapshot(db, u.id);
  const allLines = (snap.households || []).flatMap((h) =>
    (h.lines || []).map((l) => ({ ...l, pod: h.name }))
  );

  const operableRaw = allLines.filter((l) => l.can_operate === true);
  const operableById = new Map<string, typeof operableRaw>();
  for (const l of operableRaw) {
    const arr = operableById.get(l.id) || [];
    arr.push(l);
    operableById.set(l.id, arr);
  }
  for (const [, copies] of operableById) {
    if (copies.length < 2) continue;
    const label = copies[0].child_label || copies[0].name;
    const pods = copies.map((c) => `${c.pod}${c.multi_pod ? "*" : ""}`).join(", ");
    const id = copies[0].id;
    if (copies.some((c) => c.multi_pod) || copies.length === 2) {
      expectMulti(`${u.display_name}: "${label}" (${id}) in [${pods}] — Active line must dedupe`);
    } else {
      bug(`${u.display_name}: unexpected operable duplicate "${label}" (${id}) in [${pods}]`);
    }
  }

  const byId = new Map<string, (typeof operableRaw)[0]>();
  for (const line of operableRaw) {
    const prev = byId.get(line.id);
    if (!prev) byId.set(line.id, line);
    else if (prev.multi_pod && !line.multi_pod) byId.set(line.id, line);
  }
  if ([...operableById.keys()].some((id) => !byId.has(id))) {
    bug(`${u.display_name}: operable dedupe lost a line`);
  }

  for (const hh of snap.households || []) {
    const kids = (hh.lines || []).filter((l) => (l.mode || "parent") === "child" && l.can_manage);
    if (new Set(kids.map((k) => k.id)).size !== kids.length) {
      bug(`${u.display_name} @ ${hh.name}: manageKidLines duplicate ids inside one Pod`);
    }

    const lineIds = new Set((hh.lines || []).map((l) => l.id));
    for (const a of hh.allowlist || []) {
      if (a.target_line_id && lineIds.has(a.target_line_id) && a.speed_dial != null) {
        expectMulti(
          `${u.display_name} @ ${hh.name}: allowlist "${a.label}"@${a.speed_dial} overlaps household line (pad filters it)`
        );
      }
    }

    const byTarget = new Map<string, number>();
    for (const a of hh.allowlist || []) {
      if (!a.target_line_id) continue;
      byTarget.set(a.target_line_id, (byTarget.get(a.target_line_id) || 0) + 1);
    }
    for (const [tid, n] of byTarget) {
      if (n > 1) bug(`${u.display_name} @ ${hh.name}: allowlist target ${tid} listed ${n}×`);
    }

    const byDial = new Map<number, string[]>();
    for (const a of hh.allowlist || []) {
      if (a.speed_dial == null) continue;
      const d = Number(a.speed_dial);
      byDial.set(d, [...(byDial.get(d) || []), String(a.label)]);
    }
    for (const [d, labels] of byDial) {
      if (labels.length > 1) bug(`${u.display_name} @ ${hh.name}: speed_dial ${d} → ${labels.join(" + ")}`);
    }
  }

  const dirIds = (snap.directory || []).map((d) => d.id);
  if (new Set(dirIds).size !== dirIds.length) {
    bug(`${u.display_name}: directory has duplicate line ids`);
  }
}

console.log("\n=== DB integrity ===\n");

const childLines = db
  .prepare(`SELECT id, name, child_label, household_id, child_user_id FROM lines WHERE mode = 'child'`)
  .all() as {
  id: string;
  name: string;
  child_label: string | null;
  household_id: string;
  child_user_id: string | null;
}[];

const hhName = Object.fromEntries(
  (db.prepare(`SELECT id, name FROM households`).all() as { id: string; name: string }[]).map((h) => [
    h.id,
    h.name,
  ])
);

const byChildUser = new Map<string, typeof childLines>();
for (const l of childLines) {
  if (!l.child_user_id) continue;
  byChildUser.set(l.child_user_id, [...(byChildUser.get(l.child_user_id) || []), l]);
}
for (const [uid, lines] of byChildUser) {
  if (lines.length > 1) {
    bug(
      `child_user ${uid} on ${lines.length} kid lines: ${lines.map((l) => l.child_label || l.name).join(", ")}`
    );
  }
}

const byHh = new Map<string, typeof childLines>();
for (const l of childLines) byHh.set(l.household_id, [...(byHh.get(l.household_id) || []), l]);
for (const [hid, lines] of byHh) {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/['']/g, "")
      .replace(/\s+/g, " ")
      .replace(/\+|&|and/g, " ")
      .replace(/\b(phone|s phone)\b/g, "")
      .trim();
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = norm(lines[i].child_label || lines[i].name);
      const b = norm(lines[j].child_label || lines[j].name);
      if (a && b && (a === b || a.includes(b) || b.includes(a))) {
        bug(
          `Pod ${hhName[hid]}: similar kid labels "${lines[i].child_label || lines[i].name}" vs "${lines[j].child_label || lines[j].name}"`
        );
      }
    }
  }
}

for (const g of db
  .prepare(
    `SELECT g.user_id, g.line_id FROM child_guardians g LEFT JOIN lines l ON l.id = g.line_id WHERE l.id IS NULL`
  )
  .all() as { user_id: string; line_id: string }[]) {
  bug(`orphan guardian user=${g.user_id} line=${g.line_id}`);
}

for (const a of db
  .prepare(
    `SELECT a.household_id, a.label, a.target_line_id FROM allowlist a
     LEFT JOIN lines l ON l.id = a.target_line_id WHERE l.id IS NULL`
  )
  .all() as { household_id: string; label: string; target_line_id: string }[]) {
  bug(`orphan allowlist "${a.label}" in ${hhName[a.household_id] || a.household_id}`);
}

console.log("\n=== Multi-Pod kids (one line, many Pods) ===");
for (const l of childLines) {
  const pods = db
    .prepare(
      `SELECT DISTINCT h.name FROM households h
       JOIN household_members hm ON hm.household_id = h.id
       JOIN child_guardians g ON g.user_id = hm.user_id
       WHERE g.line_id = ?`
    )
    .all(l.id) as { name: string }[];
  const names = [...new Set([hhName[l.household_id], ...pods.map((p) => p.name)])];
  if (names.length > 1) console.log(`  ${l.child_label || l.name}: ${names.join(" + ")}`);
}

console.log(`\n=== Summary: ${bugs.length} bug(s), ${expected.length} expected multi-Pod note(s) ===`);
db.close();
process.exit(bugs.length ? 1 : 0);
