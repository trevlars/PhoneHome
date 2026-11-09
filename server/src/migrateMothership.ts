import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import {
  addAllowlist,
  addLine,
  createHousehold,
  ensureParentSoftphoneLine,
} from "./api.js";
import type { LineType } from "./db.js";

export type MigrateExport = {
  version: 1 | 2;
  exportedAt: string;
  fromMothershipHint: string | null;
  household: {
    id: string;
    name: string;
    quiet_start: string | null;
    quiet_end: string | null;
    quiet_tz: string | null;
  };
  parents: Array<{ display_name: string; username: string | null; role: string }>;
  lines: Array<{
    id: string;
    name: string;
    type: string;
    /** v2: parent | child | grandparent — v1 may omit (infer child from child_label). */
    mode?: string | null;
    child_label: string | null;
  }>;
  allowlist: Array<{
    target_line_id: string;
    label: string;
    speed_dial: number | null;
    favorite?: number | boolean | null;
    always_allow?: number | boolean | null;
  }>;
  ataChecklist: string[];
  appChecklist: string[];
  peeringNote: string;
};

const LINE_TYPES = new Set<string>([
  "softphone",
  "ata",
  "bt_handset",
  "hub_fxs",
  "wifi_handset",
]);

function normalizeLineType(raw: string): LineType {
  const t = String(raw || "").trim().toLowerCase();
  if (LINE_TYPES.has(t)) return t as LineType;
  // Legacy / mistaken exports used type=child
  if (t === "child" || t === "kid") return "softphone";
  return "softphone";
}

function lineMode(line: MigrateExport["lines"][number]): "parent" | "child" | "grandparent" {
  const m = String(line.mode || "").trim().toLowerCase();
  if (m === "child" || m === "parent" || m === "grandparent") return m;
  if (line.child_label) return "child";
  if (String(line.type || "").toLowerCase() === "child") return "child";
  return "parent";
}

export function exportHouseholdForMigrate(
  db: Database.Database,
  householdId: string,
  opts?: { publicBaseUrl?: string | null }
): MigrateExport | { error: string } {
  const hh = db
    .prepare(
      `SELECT id, name, quiet_start, quiet_end, quiet_tz FROM households WHERE id = ?`
    )
    .get(householdId) as
    | {
        id: string;
        name: string;
        quiet_start: string | null;
        quiet_end: string | null;
        quiet_tz: string | null;
      }
    | undefined;
  if (!hh) return { error: "Household not found" };

  const parents = db
    .prepare(
      `SELECT u.display_name, u.username, hm.role
       FROM household_members hm
       JOIN users u ON u.id = hm.user_id
       WHERE hm.household_id = ?`
    )
    .all(householdId) as Array<{
    display_name: string;
    username: string | null;
    role: string;
  }>;

  const lines = db
    .prepare(
      `SELECT id, name, type,
              IFNULL(mode, 'parent') AS mode,
              COALESCE(child_label, CASE WHEN IFNULL(mode, 'parent') = 'child' THEN name ELSE NULL END) AS child_label
       FROM lines WHERE household_id = ?`
    )
    .all(householdId) as Array<{
    id: string;
    name: string;
    type: string;
    mode: string;
    child_label: string | null;
  }>;

  const allowlist = db
    .prepare(
      `SELECT target_line_id, label, speed_dial,
              IFNULL(favorite, 1) AS favorite,
              IFNULL(always_allow, 0) AS always_allow
       FROM allowlist WHERE household_id = ?`
    )
    .all(householdId) as Array<{
    target_line_id: string;
    label: string;
    speed_dial: number | null;
    favorite: number;
    always_allow: number;
  }>;

  const base = (opts?.publicBaseUrl || "").replace(/\/$/, "") || null;

  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    fromMothershipHint: base,
    household: {
      id: hh.id,
      name: hh.name,
      quiet_start: hh.quiet_start,
      quiet_end: hh.quiet_end,
      quiet_tz: hh.quiet_tz,
    },
    parents: parents.map((p) => ({
      display_name: p.display_name,
      username: p.username,
      role: p.role,
    })),
    lines: lines.map((l) => ({
      id: l.id,
      name: l.name,
      type: l.type,
      mode: l.mode,
      child_label: l.child_label,
    })),
    allowlist: allowlist.map((a) => ({
      target_line_id: a.target_line_id,
      label: a.label,
      speed_dial: a.speed_dial,
      favorite: a.favorite,
      always_allow: a.always_allow,
    })),
    ataChecklist: [
      "Start your own Mothership (trial or licensed) and note its HTTPS / SIP host.",
      "Restore your Pod in Parent → Start your own Mothership (or import the transfer).",
      "For ATA kids: download HT801 config on the NEW hub, upload on the box, reboot.",
      "Confirm SIP TLS + SRTP still forced (PhoneHome defaults).",
    ],
    appChecklist: [
      "Pack my Pod on the old hub (saves a transfer on this phone).",
      "Change Mothership address to your new HTTPS URL, then Restore my Pod.",
      "Depart the old hub when restore looks good.",
      "Peer motherships if you still need Circles to family who stayed behind.",
    ],
    peeringNote:
      "Cross-mothership calling needs a trusted peer link (Stage 3). Restore alone does not keep calls to the old host.",
  };
}

export type MigrateImportResult = {
  ok: true;
  householdId: string;
  lineIdMap: Record<string, string>;
  restoredAllowlist: number;
  pendingExternalContacts: Array<{ label: string; oldTargetLineId: string }>;
  ataLineIds: string[];
  createdHousehold: boolean;
};

/**
 * Recreate a Pod from a migrate export on this mothership.
 * Remaps kid↔kid allowlist rows; contacts outside the export stay pending for peering.
 */
export function importHouseholdFromMigrate(
  db: Database.Database,
  actingUserId: string,
  raw: unknown
): MigrateImportResult | { ok: false; error: string } {
  const exp = raw as MigrateExport;
  if (!exp || (exp.version !== 1 && exp.version !== 2) || !exp.household?.name) {
    return { ok: false, error: "Invalid migrate export" };
  }
  if (!Array.isArray(exp.lines)) return { ok: false, error: "Migrate export missing lines" };

  const existingOwned = db
    .prepare(`SELECT id FROM households WHERE owner_user_id = ? LIMIT 1`)
    .get(actingUserId) as { id: string } | undefined;

  let householdId: string;
  let createdHousehold = false;
  try {
    if (existingOwned) {
      householdId = existingOwned.id;
    } else {
      const hh = createHousehold(db, actingUserId, exp.household.name || "Family");
      householdId = hh.id;
      createdHousehold = true;
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create Pod" };
  }

  // Apply quiet hours from export when present.
  if (exp.household.quiet_start || exp.household.quiet_end || exp.household.quiet_tz) {
    db.prepare(
      `UPDATE households
       SET quiet_start = COALESCE(?, quiet_start),
           quiet_end = COALESCE(?, quiet_end),
           quiet_tz = COALESCE(?, quiet_tz)
       WHERE id = ?`
    ).run(
      exp.household.quiet_start || null,
      exp.household.quiet_end || null,
      exp.household.quiet_tz || null,
      householdId
    );
  }

  ensureParentSoftphoneLine(db, householdId, actingUserId);

  const lineIdMap: Record<string, string> = {};
  const ataLineIds: string[] = [];
  const childLines = exp.lines.filter((l) => lineMode(l) === "child");

  for (const line of childLines) {
    const label = (line.child_label || line.name || "Kid").trim().slice(0, 64) || "Kid";
    // Skip if a kid with the same label already exists on this Pod (re-run safe).
    const already = db
      .prepare(
        `SELECT id FROM lines
         WHERE household_id = ? AND IFNULL(mode, 'parent') = 'child'
           AND LOWER(COALESCE(child_label, name)) = LOWER(?)
         LIMIT 1`
      )
      .get(householdId, label) as { id: string } | undefined;
    if (already) {
      lineIdMap[line.id] = already.id;
      continue;
    }
    try {
      const type = normalizeLineType(line.type);
      const created = addLine(db, householdId, actingUserId, label, type, {
        mode: "child",
        child_label: label,
      });
      lineIdMap[line.id] = created.id;
      if (type === "ata" || type === "hub_fxs") ataLineIds.push(created.id);
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : `Could not create line ${label}`,
      };
    }
  }

  let restoredAllowlist = 0;
  const pendingExternalContacts: Array<{ label: string; oldTargetLineId: string }> = [];
  const allow = Array.isArray(exp.allowlist) ? exp.allowlist : [];

  for (const row of allow) {
    const newTarget = lineIdMap[row.target_line_id];
    if (!newTarget) {
      pendingExternalContacts.push({
        label: row.label || "Contact",
        oldTargetLineId: row.target_line_id,
      });
      continue;
    }
    const exists = db
      .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
      .get(householdId, newTarget);
    if (exists) continue;
    try {
      const fav = row.favorite;
      const always = row.always_allow;
      addAllowlist(db, householdId, newTarget, row.label || "Friend", {
        speedDial: row.speed_dial != null && row.speed_dial >= 2 && row.speed_dial <= 9 ? row.speed_dial : null,
        favorite: fav === 0 || fav === false ? false : true,
        alwaysAllow: always === 1 || always === true,
        actorUserId: actingUserId,
        skipKidFanout: true,
      });
      restoredAllowlist += 1;
    } catch {
      pendingExternalContacts.push({
        label: row.label || "Contact",
        oldTargetLineId: row.target_line_id,
      });
    }
  }

  console.log(
    `[audit] migrate import household_id=${householdId} by user_id=${actingUserId} kids=${Object.keys(lineIdMap).length} allowlist=${restoredAllowlist} pending=${pendingExternalContacts.length}`
  );

  return {
    ok: true,
    householdId,
    lineIdMap,
    restoredAllowlist,
    pendingExternalContacts,
    ataLineIds,
    createdHousehold,
  };
}

/** Soft-depart: rename Pod and strip membership for the leaving user (or flag whole Pod). */
export function departHousehold(
  db: Database.Database,
  householdId: string,
  opts: { actingUserId: string; removeAllMembers?: boolean }
): { ok: true; departedTag: string } | { ok: false; error: string } {
  const hh = db.prepare(`SELECT id, name FROM households WHERE id = ?`).get(householdId) as
    | { id: string; name: string }
    | undefined;
  if (!hh) return { ok: false, error: "Household not found" };

  const member = db
    .prepare(`SELECT role FROM household_members WHERE household_id = ? AND user_id = ?`)
    .get(householdId, opts.actingUserId) as { role: string } | undefined;
  if (!member) return { ok: false, error: "Not a member of this Pod" };

  const tag = `departed_${nanoid(8)}`;
  const newName = `${hh.name} (departed)`;
  db.prepare(`UPDATE households SET name = ? WHERE id = ?`).run(newName, householdId);

  if (opts.removeAllMembers) {
    db.prepare(`DELETE FROM household_members WHERE household_id = ?`).run(householdId);
  } else {
    db.prepare(`DELETE FROM household_members WHERE household_id = ? AND user_id = ?`).run(
      householdId,
      opts.actingUserId
    );
  }

  console.log(
    `[audit] migrate depart household_id=${householdId} by user_id=${opts.actingUserId} tag=${tag}`
  );
  return { ok: true, departedTag: tag };
}
