import type Database from "better-sqlite3";
import {
  grandparentLabelsFromHints,
  kidFacingGrandparentLabel,
  lookupGrandparentPadLabels,
} from "./grandparentLabel.js";

/** Allowlist row joined to a provisioned grandparent. */
export type GrandparentAllowlistRow = {
  id: string;
  household_id: string;
  target_line_id: string;
  label: string;
  speed_dial: number | null;
  favorite: number;
  always_allow: number;
  created_at: string;
  gp_created_at: string;
  kid_nickname: string | null;
  display_label: string | null;
  display_name: string;
  username: string | null;
  pod_name: string;
};

export type GrandparentMenuChoice = {
  digit: number;
  lineId: string;
  label: string;
  entryId: string;
};

export type GrandparentDialSync = {
  mode: "none" | "direct" | "menu";
  slot: number | null;
  anchorEntryId: string | null;
  anchorLineId: string | null;
};

function assignedSlot(value: number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 2 || n > 9) return null;
  return n;
}

/** Pods a kid belongs to (home + guardians’ family names). Kept local to avoid api↔menu cycles. */
function podsForKidLine(db: Database.Database, kidLineId: string): string[] {
  const kid = db
    .prepare(`SELECT household_id, mode FROM lines WHERE id = ?`)
    .get(kidLineId) as { household_id: string; mode: string | null } | undefined;
  if (!kid || (kid.mode || "parent") !== "child") return [];
  const out = new Set<string>([kid.household_id]);
  const guardians = db
    .prepare(`SELECT user_id FROM child_guardians WHERE line_id = ?`)
    .all(kidLineId) as { user_id: string }[];
  for (const g of guardians) {
    if (!g.user_id) continue;
    const childOnly = db
      .prepare(
        `SELECT 1 FROM lines WHERE child_user_id = ? AND IFNULL(mode, 'parent') = 'child' LIMIT 1`
      )
      .get(g.user_id);
    if (childOnly) continue;
    for (const p of db
      .prepare(`SELECT household_id FROM household_members WHERE user_id = ?`)
      .all(g.user_id) as { household_id: string }[]) {
      if (p.household_id) out.add(p.household_id);
    }
  }
  return [...out];
}

/** All grandparents provisioned on any Pod this kid belongs to. */
export function listKidPodGrandparents(
  db: Database.Database,
  kidLineId: string
): GrandparentAllowlistRow[] {
  const pods = podsForKidLine(db, kidLineId);
  if (!pods.length) return [];
  const placeholders = pods.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT a.id, a.household_id, pr.relative_line_id AS target_line_id, a.label, a.speed_dial,
              a.favorite, a.always_allow, a.created_at, pr.created_at AS gp_created_at, pr.kid_nickname,
              pr.display_label, u.display_name, u.username, h.name AS pod_name
       FROM provisioned_relatives pr
       JOIN users u ON u.id = pr.relative_user_id
       JOIN households h ON h.id = pr.from_household_id
       LEFT JOIN allowlist a
         ON a.target_line_id = pr.relative_line_id AND a.household_id = pr.from_household_id
       WHERE pr.from_household_id IN (${placeholders})
       ORDER BY pr.created_at ASC`
    )
    .all(...pods) as GrandparentAllowlistRow[];
}

/**
 * Multi-Pod kids need cross-Pod grandparents on their *home* allowlist
 * (Alex → Avery/Ellis from North while Sloan/Parker already live on East).
 *
 * Never write:
 * - home → GP when the GP line already lives on the home Pod (sibling tile)
 * - home → kid (self) when the GP’s line household equals the kid’s home
 * Those polluted Pod pads (self-rows, GP-MENU stealing dials for every parent).
 */
export function ensureKidMultiPodGrandparentAllowlists(
  db: Database.Database,
  kidLineId: string,
  podIds: string[],
  insertAllowlist: (
    householdId: string,
    targetLineId: string,
    label: string
  ) => void
): void {
  const kid = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(kidLineId) as
    | {
        id: string;
        household_id: string;
        mode: string | null;
        child_label: string | null;
        name: string;
      }
    | undefined;
  if (!kid || (kid.mode || "parent") !== "child") return;
  if (!podIds.length) return;
  const homeHh = kid.household_id;
  const kidLabel = kid.child_label || kid.name || "Grandchild";
  const placeholders = podIds.map(() => "?").join(",");
  const gps = db
    .prepare(
      `SELECT pr.relative_line_id AS target_line_id, pr.relative_household_id,
              pr.display_label, u.display_name, u.username
       FROM provisioned_relatives pr
       JOIN users u ON u.id = pr.relative_user_id
       WHERE pr.from_household_id IN (${placeholders})`
    )
    .all(...podIds) as {
    target_line_id: string;
    relative_household_id: string;
    display_label: string | null;
    display_name: string;
    username: string | null;
  }[];

  let wroteCrossPod = false;
  for (const gp of gps) {
    const gpLine = db
      .prepare(`SELECT id, household_id FROM lines WHERE id = ?`)
      .get(gp.target_line_id) as { id: string; household_id: string } | undefined;
    if (!gpLine) continue;
    const labels = lookupGrandparentPadLabels(db, gpLine.id);
    const gpLabel = labels?.adult || gp.display_label || gp.display_name || "Grandparent";

    // GP already a household line on the kid’s home Pod — pad shows them as siblings.
    if (gpLine.household_id === homeHh) continue;

    insertAllowlist(homeHh, gpLine.id, gpLabel);
    wroteCrossPod = true;

    // Reverse book on the GP’s own house only (never the kid’s home Pod).
    const bookHh = gp.relative_household_id || gpLine.household_id;
    if (bookHh && bookHh !== homeHh) {
      insertAllowlist(bookHh, kid.id, kidLabel);
    }
  }
  if (wroteCrossPod) syncGrandparentDialCollapse(db, homeHh);
}

/** All grandparents on this household’s allowlist (provision order). */
export function listHouseholdGrandparentAllowlist(
  db: Database.Database,
  householdId: string
): GrandparentAllowlistRow[] {
  return db
    .prepare(
      `SELECT a.id, a.household_id, a.target_line_id, a.label, a.speed_dial, a.favorite,
              a.always_allow, a.created_at, pr.created_at AS gp_created_at, pr.kid_nickname,
              pr.display_label, u.display_name, u.username, h.name AS pod_name
       FROM allowlist a
       JOIN provisioned_relatives pr ON pr.relative_line_id = a.target_line_id
       JOIN users u ON u.id = pr.relative_user_id
       JOIN households h ON h.id = pr.from_household_id
       WHERE a.household_id = ?
       ORDER BY pr.created_at ASC, a.created_at ASC`
    )
    .all(householdId) as GrandparentAllowlistRow[];
}


function claimFreeSpeedDial(db: Database.Database, householdId: string): number | null {
  const used = db
    .prepare(`SELECT speed_dial FROM allowlist WHERE household_id = ? AND speed_dial IS NOT NULL`)
    .all(householdId) as { speed_dial: number }[];
  const taken = new Set(used.map((u) => Number(u.speed_dial)));
  for (const start of [3, 2]) {
    for (let s = start; s <= 9; s++) {
      if (!taken.has(s)) return s;
    }
  }
  return null;
}

function kidLabelForRow(row: GrandparentAllowlistRow): string {
  return (
    kidFacingGrandparentLabel(
      row.pod_name,
      row.kid_nickname,
      row.display_name,
      row.display_label,
      row.username
    ) || "Grandparent"
  );
}

/**
 * Grandparents this kid may call — every Pod they belong to (home allowlist
 * cross-Pod rows + same-Pod GP lines), stable nickname order.
 */
export function listKidGrandparentMenuChoices(
  db: Database.Database,
  fromLineId: string
): GrandparentMenuChoice[] {
  const from = db.prepare(`SELECT id, household_id, mode FROM lines WHERE id = ?`).get(fromLineId) as
    | { id: string; household_id: string; mode: string | null }
    | undefined;
  if (!from || (from.mode || "parent") !== "child") return [];

  const byLine = new Map<string, { row: GrandparentAllowlistRow; label: string }>();

  const consider = (row: GrandparentAllowlistRow) => {
    if (!row?.target_line_id || byLine.has(row.target_line_id)) return;
    const gpHh = db
      .prepare(`SELECT household_id FROM lines WHERE id = ?`)
      .get(row.target_line_id) as { household_id: string } | undefined;
    if (!gpHh) return;
    // Same Pod as the kid (merged GP line) — always reachable.
    const samePod = gpHh.household_id === from.household_id;
    const out = db
      .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
      .get(from.household_id, row.target_line_id);
    const inn = db
      .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
      .get(gpHh.household_id, from.id);
    if (!samePod && !(out && inn)) return;
    byLine.set(row.target_line_id, { row, label: kidLabelForRow(row) });
  };

  // Cross-Pod GPs synced onto the home allowlist.
  for (const row of listHouseholdGrandparentAllowlist(db, from.household_id)) consider(row);

  // Same-Pod / other-Pod provisioned GPs (merged lines may not be on allowlist).
  const pods = podsForKidLine(db, from.id);
  if (pods.length) {
    const placeholders = pods.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT COALESCE(a.id, pr.id) AS id, COALESCE(a.household_id, pr.from_household_id) AS household_id,
                pr.relative_line_id AS target_line_id, COALESCE(a.label, pr.display_label, u.display_name) AS label,
                a.speed_dial, COALESCE(a.favorite, 1) AS favorite, COALESCE(a.always_allow, 0) AS always_allow,
                COALESCE(a.created_at, pr.created_at) AS created_at, pr.created_at AS gp_created_at,
                pr.kid_nickname, pr.display_label, u.display_name, u.username, h.name AS pod_name
         FROM provisioned_relatives pr
         JOIN users u ON u.id = pr.relative_user_id
         JOIN households h ON h.id = pr.from_household_id
         LEFT JOIN allowlist a
           ON a.target_line_id = pr.relative_line_id AND a.household_id = ?
         WHERE pr.from_household_id IN (${placeholders})
         ORDER BY pr.created_at ASC`
      )
      .all(from.household_id, ...pods) as GrandparentAllowlistRow[];
    for (const row of rows) consider(row);
  }

  const labeled = [...byLine.values()];
  labeled.sort((a, b) => {
    const byName = a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
    if (byName) return byName;
    return String(a.row.gp_created_at).localeCompare(String(b.row.gp_created_at));
  });

  return labeled.slice(0, 9).map((item, i) => ({
    digit: i + 1,
    lineId: item.row.target_line_id,
    label: item.label,
    entryId: item.row.id,
  }));
}

export function buildGrandparentsMenuPrompt(choices: GrandparentMenuChoice[]): string {
  if (!choices.length) return "There are no grandparents yet.";
  return choices.map((c) => `To call ${c.label}, press ${c.digit}.`).join(" ");
}

/** Read-only dial state for snapshots — never writes allowlist rows. */
export function peekGrandparentDialCollapse(
  db: Database.Database,
  householdId: string
): GrandparentDialSync {
  const rows = listHouseholdGrandparentAllowlist(db, householdId);
  if (!rows.length) {
    return { mode: "none", slot: null, anchorEntryId: null, anchorLineId: null };
  }
  const first = rows[0];
  const slot = rows.map((r) => assignedSlot(r.speed_dial)).find((s) => s != null) ?? null;
  return {
    mode: rows.length >= 2 ? "menu" : "direct",
    slot,
    anchorEntryId: first.id,
    anchorLineId: first.target_line_id,
  };
}

/**
 * First GP keeps a normal speed-dial key. At 2+ GPs that same key becomes the
 * Grandparents menu — other GP rows drop off the pad (speed_dial null).
 * Dropping back to one GP restores a direct call on that key.
 * Call from provision / ATA / repair only — not /api/me.
 */
export function syncGrandparentDialCollapse(
  db: Database.Database,
  householdId: string
): GrandparentDialSync {
  const rows = listHouseholdGrandparentAllowlist(db, householdId);
  if (!rows.length) {
    return { mode: "none", slot: null, anchorEntryId: null, anchorLineId: null };
  }

  const first = rows[0];
  const slotFromOrdered =
    rows.map((r) => assignedSlot(r.speed_dial)).find((s) => s != null) ?? null;
  let slot = slotFromOrdered;
  if (slot == null) {
    slot = claimFreeSpeedDial(db, householdId);
  }
  if (slot == null) {
    return {
      mode: rows.length >= 2 ? "menu" : "direct",
      slot: null,
      anchorEntryId: first.id,
      anchorLineId: first.target_line_id,
    };
  }

  const tx = db.transaction(() => {
    for (const row of rows) {
      if (row.id === first.id) {
        if (assignedSlot(row.speed_dial) !== slot) {
          const occupant = db
            .prepare(
              `SELECT id FROM allowlist WHERE household_id = ? AND speed_dial = ? AND id != ?`
            )
            .get(householdId, slot, first.id) as { id: string } | undefined;
          if (occupant) {
            const free = claimFreeSpeedDial(db, householdId);
            if (free != null) {
              db.prepare(`UPDATE allowlist SET speed_dial = ? WHERE id = ?`).run(free, occupant.id);
            } else {
              db.prepare(`UPDATE allowlist SET speed_dial = NULL WHERE id = ?`).run(occupant.id);
            }
          }
          db.prepare(`UPDATE allowlist SET speed_dial = ? WHERE id = ?`).run(slot, first.id);
        }
      } else if (rows.length >= 2 && row.speed_dial != null) {
        db.prepare(`UPDATE allowlist SET speed_dial = NULL WHERE id = ?`).run(row.id);
      }
    }
  });
  tx();

  return {
    mode: rows.length >= 2 ? "menu" : "direct",
    slot,
    anchorEntryId: first.id,
    anchorLineId: first.target_line_id,
  };
}

/** Kid-facing enrichment helpers for allowlist snapshots. */
export function enrichAllowlistGrandparentFields<T extends { target_line_id: string; label: string }>(
  db: Database.Database,
  entry: T,
  opts: { kidFacingLabel: boolean }
): T & {
  is_grandparent: true;
  kid_label: string;
  adult_label: string;
  kid_nickname: string;
  label: string;
} {
  const gp = lookupGrandparentPadLabels(db, entry.target_line_id);
  if (!gp) {
    return entry as T & {
      is_grandparent: true;
      kid_label: string;
      adult_label: string;
      kid_nickname: string;
      label: string;
    };
  }
  return {
    ...entry,
    is_grandparent: true as const,
    label: opts.kidFacingLabel ? gp.kid : gp.adult,
    kid_label: gp.kid,
    adult_label: gp.adult,
    kid_nickname: gp.nickname,
  };
}

/** Re-export for tests. */
export { grandparentLabelsFromHints, kidFacingGrandparentLabel, lookupGrandparentPadLabels };
