/**
 * Mothership operator billing — Circle (child line) entitlements.
 * Operators charge siblings off-platform; PhoneHome does not process payments.
 */
import type Database from "better-sqlite3";
import { nowIso } from "./db.js";
import type { UnavailableVoice } from "./unavailableVoice.js";

export type MothershipOperatorRole = "owner" | "admin";
export type BillingEnforcement = "none" | "warn" | "soft" | "hard";
export type CircleBillingStatus = "comp" | "active" | "grace" | "suspended";

export type MothershipBillingSettings = {
  enabled: boolean;
  enforcement: BillingEnforcement;
  default_monthly_cents: number | null;
  grace_days: number;
  payment_instructions: string | null;
  updated_at: string;
};

export type CircleBillingRow = {
  line_id: string;
  household_id: string;
  status: CircleBillingStatus;
  monthly_cents: number | null;
  currency: string;
  billing_contact_user_id: string | null;
  note: string | null;
  last_paid_at: string | null;
  grace_until: string | null;
  updated_at: string;
};

export type PublicCircleBilling = {
  line_id: string;
  household_id: string;
  kid_name: string;
  pod_name: string;
  status: CircleBillingStatus;
  effective_status: CircleBillingStatus;
  monthly_cents: number | null;
  currency: string;
  note: string | null;
  last_paid_at: string | null;
  grace_until: string | null;
  billing_contact_display: string | null;
};

const ENFORCEMENT: BillingEnforcement[] = ["none", "warn", "soft", "hard"];
const STATUSES: CircleBillingStatus[] = ["comp", "active", "grace", "suspended"];

function parseEnforcement(raw: string): BillingEnforcement {
  return ENFORCEMENT.includes(raw as BillingEnforcement) ? (raw as BillingEnforcement) : "none";
}

function parseStatus(raw: string): CircleBillingStatus {
  return STATUSES.includes(raw as CircleBillingStatus) ? (raw as CircleBillingStatus) : "active";
}

export function isMothershipOperator(db: Database.Database, userId: string): boolean {
  const row = db.prepare(`SELECT 1 FROM mothership_operators WHERE user_id = ?`).get(userId);
  return Boolean(row);
}

export function getMothershipOperatorRole(
  db: Database.Database,
  userId: string
): MothershipOperatorRole | null {
  const row = db
    .prepare(`SELECT role FROM mothership_operators WHERE user_id = ?`)
    .get(userId) as { role: string } | undefined;
  if (!row) return null;
  return row.role === "owner" ? "owner" : "admin";
}

export function assertMothershipOperator(db: Database.Database, userId: string): void {
  if (!isMothershipOperator(db, userId)) {
    throw new Error("Mothership operator access required");
  }
}

export function ensureMothershipOperator(
  db: Database.Database,
  userId: string,
  role: MothershipOperatorRole = "admin"
): void {
  const existing = getMothershipOperatorRole(db, userId);
  if (existing) return;
  db.prepare(
    `INSERT INTO mothership_operators (user_id, role, created_at) VALUES (?, ?, ?)`
  ).run(userId, role, nowIso());
}

export function addMothershipOperator(
  db: Database.Database,
  actorUserId: string,
  targetUserId: string
): void {
  assertMothershipOperator(db, actorUserId);
  if (getMothershipOperatorRole(db, actorUserId) !== "owner") {
    throw new Error("Only the Mothership owner can add operators");
  }
  const user = db.prepare(`SELECT id FROM users WHERE id = ?`).get(targetUserId) as
    | { id: string }
    | undefined;
  if (!user) throw new Error("User not found");
  ensureMothershipOperator(db, targetUserId, "admin");
}

export function removeMothershipOperator(
  db: Database.Database,
  actorUserId: string,
  targetUserId: string
): void {
  assertMothershipOperator(db, actorUserId);
  if (getMothershipOperatorRole(db, actorUserId) !== "owner") {
    throw new Error("Only the Mothership owner can remove operators");
  }
  if (targetUserId === actorUserId) {
    throw new Error("Cannot remove yourself as owner");
  }
  db.prepare(`DELETE FROM mothership_operators WHERE user_id = ? AND role != 'owner'`).run(
    targetUserId
  );
}

export function listMothershipOperators(db: Database.Database) {
  return db
    .prepare(
      `SELECT o.user_id, o.role, o.created_at, u.display_name, u.username
       FROM mothership_operators o
       JOIN users u ON u.id = o.user_id
       ORDER BY o.role = 'owner' DESC, o.created_at ASC`
    )
    .all() as {
    user_id: string;
    role: MothershipOperatorRole;
    created_at: string;
    display_name: string;
    username: string | null;
  }[];
}

export function getMothershipBillingSettings(db: Database.Database): MothershipBillingSettings {
  const row = db
    .prepare(
      `SELECT enabled, enforcement, default_monthly_cents, grace_days, payment_instructions, updated_at
       FROM mothership_billing_settings WHERE id = 1`
    )
    .get() as
    | {
        enabled: number;
        enforcement: string;
        default_monthly_cents: number | null;
        grace_days: number;
        payment_instructions: string | null;
        updated_at: string;
      }
    | undefined;
  if (!row) {
    return {
      enabled: false,
      enforcement: "none",
      default_monthly_cents: null,
      grace_days: 7,
      payment_instructions: null,
      updated_at: nowIso(),
    };
  }
  return {
    enabled: Boolean(row.enabled),
    enforcement: parseEnforcement(row.enforcement),
    default_monthly_cents: row.default_monthly_cents,
    grace_days: Math.max(0, Number(row.grace_days) || 7),
    payment_instructions: row.payment_instructions,
    updated_at: row.updated_at,
  };
}

export function updateMothershipBillingSettings(
  db: Database.Database,
  patch: Partial<{
    enabled: boolean;
    enforcement: BillingEnforcement;
    default_monthly_cents: number | null;
    grace_days: number;
    payment_instructions: string | null;
  }>
): MothershipBillingSettings {
  const cur = getMothershipBillingSettings(db);
  const next: MothershipBillingSettings = {
    enabled: patch.enabled === undefined ? cur.enabled : Boolean(patch.enabled),
    enforcement:
      patch.enforcement === undefined ? cur.enforcement : parseEnforcement(patch.enforcement),
    default_monthly_cents:
      patch.default_monthly_cents === undefined
        ? cur.default_monthly_cents
        : patch.default_monthly_cents,
    grace_days:
      patch.grace_days === undefined
        ? cur.grace_days
        : Math.max(0, Math.min(90, Math.floor(Number(patch.grace_days) || 0))),
    payment_instructions:
      patch.payment_instructions === undefined
        ? cur.payment_instructions
        : patch.payment_instructions?.trim() || null,
    updated_at: nowIso(),
  };
  const wasEnabled = cur.enabled;
  db.prepare(
    `INSERT INTO mothership_billing_settings
       (id, enabled, enforcement, default_monthly_cents, grace_days, payment_instructions, updated_at)
     VALUES (1, @enabled, @enforcement, @default_monthly_cents, @grace_days, @payment_instructions, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
       enabled = excluded.enabled,
       enforcement = excluded.enforcement,
       default_monthly_cents = excluded.default_monthly_cents,
       grace_days = excluded.grace_days,
       payment_instructions = excluded.payment_instructions,
       updated_at = excluded.updated_at`
  ).run({
    enabled: next.enabled ? 1 : 0,
    enforcement: next.enforcement,
    default_monthly_cents: next.default_monthly_cents,
    grace_days: next.grace_days,
    payment_instructions: next.payment_instructions,
    updated_at: next.updated_at,
  });
  if (!wasEnabled && next.enabled) {
    backfillCircleBillingRows(db);
  }
  return next;
}

/** Create billing rows for every child line — only when billing is enabled. */
export function backfillCircleBillingRows(db: Database.Database): number {
  if (!getMothershipBillingSettings(db).enabled) return 0;
  const kids = db
    .prepare(`SELECT id, household_id FROM lines WHERE IFNULL(mode, 'parent') = 'child'`)
    .all() as { id: string; household_id: string }[];
  let n = 0;
  for (const kid of kids) {
    if (!circleBillingRow(db, kid.id)) {
      ensureCircleBillingRow(db, kid.id, kid.household_id);
      n++;
    }
  }
  return n;
}

function kidDisplayName(line: { child_label: string | null; name: string }): string {
  return (line.child_label || line.name || "Kid").trim();
}

export function ensureCircleBillingRow(
  db: Database.Database,
  lineId: string,
  householdId: string
): CircleBillingRow {
  const existing = db
    .prepare(`SELECT * FROM circle_billing WHERE line_id = ?`)
    .get(lineId) as CircleBillingRow | undefined;
  if (existing) return existing;

  const hh = db.prepare(`SELECT owner_user_id FROM households WHERE id = ?`).get(householdId) as
    | { owner_user_id: string }
    | undefined;
  const settings = getMothershipBillingSettings(db);
  const status: CircleBillingStatus = settings.enabled ? "active" : "comp";
  const row: CircleBillingRow = {
    line_id: lineId,
    household_id: householdId,
    status,
    monthly_cents: settings.default_monthly_cents,
    currency: "USD",
    billing_contact_user_id: hh?.owner_user_id ?? null,
    note: null,
    last_paid_at: null,
    grace_until: null,
    updated_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO circle_billing
       (line_id, household_id, status, monthly_cents, currency, billing_contact_user_id, note, last_paid_at, grace_until, updated_at)
     VALUES (@line_id, @household_id, @status, @monthly_cents, @currency, @billing_contact_user_id, @note, @last_paid_at, @grace_until, @updated_at)`
  ).run(row);
  return row;
}

export function deleteCircleBillingRow(db: Database.Database, lineId: string): void {
  db.prepare(`DELETE FROM circle_billing WHERE line_id = ?`).run(lineId);
}

export function effectiveCircleBillingStatus(
  row: CircleBillingRow,
  now = new Date()
): CircleBillingStatus {
  if (row.status === "comp" || row.status === "active" || row.status === "suspended") {
    return row.status;
  }
  if (row.status === "grace") {
    if (!row.grace_until) return "grace";
    return new Date(row.grace_until).getTime() > now.getTime() ? "grace" : "suspended";
  }
  return row.status;
}

export function circleBillingRow(db: Database.Database, lineId: string): CircleBillingRow | null {
  const row = db.prepare(`SELECT * FROM circle_billing WHERE line_id = ?`).get(lineId) as
    | CircleBillingRow
    | undefined;
  return row ?? null;
}

export function updateCircleBilling(
  db: Database.Database,
  lineId: string,
  patch: Partial<{
    status: CircleBillingStatus;
    monthly_cents: number | null;
    note: string | null;
    billing_contact_user_id: string | null;
    grace_until: string | null;
    last_paid_at: string | null;
  }>
): CircleBillingRow {
  const row = circleBillingRow(db, lineId);
  if (!row) throw new Error("Circle billing row not found");

  const line = db
    .prepare(`SELECT id, household_id FROM lines WHERE id = ? AND IFNULL(mode, 'parent') = 'child'`)
    .get(lineId) as { id: string; household_id: string } | undefined;
  if (!line) throw new Error("Child line not found");

  let status = patch.status === undefined ? row.status : parseStatus(patch.status);
  let grace_until =
    patch.grace_until === undefined ? row.grace_until : patch.grace_until?.trim() || null;
  if (patch.status === "grace" && grace_until === null) {
    const settings = getMothershipBillingSettings(db);
    grace_until = new Date(
      Date.now() + settings.grace_days * 864e5
    ).toISOString();
  }

  const next: CircleBillingRow = {
    ...row,
    status,
    monthly_cents:
      patch.monthly_cents === undefined ? row.monthly_cents : patch.monthly_cents,
    note: patch.note === undefined ? row.note : patch.note?.trim() || null,
    billing_contact_user_id:
      patch.billing_contact_user_id === undefined
        ? row.billing_contact_user_id
        : patch.billing_contact_user_id,
    grace_until,
    last_paid_at:
      patch.last_paid_at === undefined ? row.last_paid_at : patch.last_paid_at,
    updated_at: nowIso(),
  };

  db.prepare(
    `UPDATE circle_billing SET
       status = @status,
       monthly_cents = @monthly_cents,
       note = @note,
       billing_contact_user_id = @billing_contact_user_id,
       grace_until = @grace_until,
       last_paid_at = @last_paid_at,
       updated_at = @updated_at
     WHERE line_id = @line_id`
  ).run(next);
  return next;
}

export function markCirclePaid(db: Database.Database, lineId: string): CircleBillingRow {
  return updateCircleBilling(db, lineId, {
    status: "active",
    last_paid_at: nowIso(),
    grace_until: null,
  });
}

function billingContactDisplay(db: Database.Database, userId: string | null): string | null {
  if (!userId) return null;
  const u = db
    .prepare(`SELECT display_name, username, parent_title FROM users WHERE id = ?`)
    .get(userId) as { display_name: string; username: string | null; parent_title: string | null };
  if (!u) return null;
  return (u.parent_title && u.parent_title.trim()) || u.display_name || u.username;
}

function publicCircleBilling(
  db: Database.Database,
  row: CircleBillingRow,
  line: { child_label: string | null; name: string },
  podName: string,
  now = new Date()
): PublicCircleBilling {
  return {
    line_id: row.line_id,
    household_id: row.household_id,
    kid_name: kidDisplayName(line),
    pod_name: podName,
    status: row.status,
    effective_status: effectiveCircleBillingStatus(row, now),
    monthly_cents: row.monthly_cents,
    currency: row.currency,
    note: row.note,
    last_paid_at: row.last_paid_at,
    grace_until: row.grace_until,
    billing_contact_display: billingContactDisplay(db, row.billing_contact_user_id),
  };
}

export function mothershipOperatorMeta(db: Database.Database, userId: string) {
  const settings = getMothershipBillingSettings(db);
  const role = getMothershipOperatorRole(db, userId);
  return {
    is_operator: Boolean(role),
    operator_role: role,
    billing_enabled: settings.enabled,
  };
}

export function listCircleBillingForParent(
  db: Database.Database,
  userId: string,
  now = new Date()
): PublicCircleBilling[] {
  const settings = getMothershipBillingSettings(db);
  if (!settings.enabled) return [];

  const hhIds = db
    .prepare(
      `SELECT household_id FROM household_members WHERE user_id = ?
       UNION
       SELECT DISTINCT l.household_id FROM child_guardians g
         JOIN lines l ON l.id = g.line_id WHERE g.user_id = ?`
    )
    .all(userId, userId) as { household_id: string }[];

  const out: PublicCircleBilling[] = [];
  for (const { household_id } of hhIds) {
    if (!canManageHouseholdBilling(db, userId, household_id)) continue;
    const hh = db.prepare(`SELECT name FROM households WHERE id = ?`).get(household_id) as
      | { name: string }
      | undefined;
    if (!hh) continue;
    const kids = db
      .prepare(
        `SELECT id, child_label, name FROM lines
         WHERE household_id = ? AND IFNULL(mode, 'parent') = 'child'
         ORDER BY created_at ASC`
      )
      .all(household_id) as { id: string; child_label: string | null; name: string }[];
    for (const kid of kids) {
      const row = circleBillingRow(db, kid.id);
      if (!row) continue;
      out.push(publicCircleBilling(db, row, kid, hh.name, now));
    }
  }
  return out;
}

function canManageHouseholdBilling(
  db: Database.Database,
  userId: string,
  householdId: string
): boolean {
  const hh = db.prepare(`SELECT owner_user_id FROM households WHERE id = ?`).get(householdId) as
    | { owner_user_id: string }
    | undefined;
  if (!hh) return false;
  if (hh.owner_user_id === userId) return true;
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM household_members
         WHERE household_id = ? AND user_id = ? AND role IN ('owner', 'parent')`
      )
      .get(householdId, userId)
  );
}

export type AdminCircleKid = PublicCircleBilling & {
  billing_configured: boolean;
};

export function getMothershipBillingAdminSnapshot(db: Database.Database, now = new Date()) {
  const settings = getMothershipBillingSettings(db);
  const pods = db
    .prepare(`SELECT id, name, owner_user_id FROM households ORDER BY name ASC, created_at ASC`)
    .all() as { id: string; name: string; owner_user_id: string }[];

  const circles: AdminCircleKid[] = [];
  let kidLineCount = 0;
  let suggestedMonthlyTotalCents = 0;
  let activeCount = 0;
  let compCount = 0;
  let overdueCount = 0;

  for (const pod of pods) {
    const kids = db
      .prepare(
        `SELECT id, child_label, name FROM lines
         WHERE household_id = ? AND IFNULL(mode, 'parent') = 'child'
         ORDER BY created_at ASC`
      )
      .all(pod.id) as { id: string; child_label: string | null; name: string }[];
    for (const kid of kids) {
      kidLineCount++;
      const row = circleBillingRow(db, kid.id);
      if (!row) {
        if (!settings.enabled) continue;
        circles.push({
          line_id: kid.id,
          household_id: pod.id,
          kid_name: kidDisplayName(kid),
          pod_name: pod.name,
          status: "active",
          effective_status: "active",
          monthly_cents: settings.default_monthly_cents,
          currency: "USD",
          note: null,
          last_paid_at: null,
          grace_until: null,
          billing_contact_display: null,
          billing_configured: false,
        });
        continue;
      }
      const pub = publicCircleBilling(db, row, kid, pod.name, now);
      circles.push({ ...pub, billing_configured: true });
      const eff = pub.effective_status;
      if (eff === "comp") compCount++;
      else if (eff === "active" || eff === "grace") {
        activeCount++;
        if (row.monthly_cents != null) suggestedMonthlyTotalCents += row.monthly_cents;
      } else overdueCount++;
    }
  }

  return {
    settings,
    operators: listMothershipOperators(db),
    pods: pods.map((p) => ({
      id: p.id,
      name: p.name,
      owner_user_id: p.owner_user_id,
      circles: circles.filter((c) => c.household_id === p.id),
    })),
    summary: {
      kid_line_count: kidLineCount,
      circle_count: circles.length,
      active_count: activeCount,
      comp_count: compCount,
      overdue_count: overdueCount,
      suggested_monthly_total_cents: suggestedMonthlyTotalCents,
    },
  };
}

export type CircleBillingCallBlock = {
  ok: boolean;
  reason?: string;
  voice?: UnavailableVoice;
  side?: "caller" | "callee" | "both";
};

export function circleBillingCallBlock(
  db: Database.Database,
  fromLineId: string,
  toLineId: string,
  now = new Date()
): CircleBillingCallBlock {
  const settings = getMothershipBillingSettings(db);
  if (!settings.enabled || settings.enforcement === "none" || settings.enforcement === "warn") {
    return { ok: true };
  }

  const from = db
    .prepare(`SELECT id, household_id, IFNULL(mode, 'parent') AS mode FROM lines WHERE id = ?`)
    .get(fromLineId) as { id: string; household_id: string; mode: string } | undefined;
  const to = db
    .prepare(`SELECT id, household_id, IFNULL(mode, 'parent') AS mode FROM lines WHERE id = ?`)
    .get(toLineId) as { id: string; household_id: string; mode: string } | undefined;
  if (!from || !to) return { ok: true };

  const checkLine = (
    line: { id: string; household_id: string; mode: string },
    peerHouseholdId: string,
    side: "caller" | "callee"
  ): CircleBillingCallBlock => {
    if (line.mode !== "child") return { ok: true };
    const row = circleBillingRow(db, line.id);
    if (!row) return { ok: true };
    const eff = effectiveCircleBillingStatus(row, now);
    if (eff === "comp" || eff === "active") return { ok: true };
    if (eff === "grace") return { ok: true };

    const crossPod = line.household_id !== peerHouseholdId;
    if (settings.enforcement === "soft" && !crossPod) return { ok: true };

    const reason =
      side === "caller"
        ? "This Circle is paused — contact the Mothership host"
        : "This line isn’t available right now";
    return { ok: false, reason, voice: "paused", side };
  };

  const fromBlock = checkLine(from, to.household_id, "caller");
  if (!fromBlock.ok) return fromBlock;
  const toBlock = checkLine(to, from.household_id, "callee");
  if (!toBlock.ok) return toBlock;
  return { ok: true };
}

/** Backfill operators + billing rows on existing databases. */
export function migrateMothershipBillingV1(db: Database.Database): void {
  const done = db.prepare(`SELECT 1 FROM schema_migrations WHERE id = ?`).get(
    "mothership_billing_v1"
  );
  if (done) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS mothership_operators (
      user_id TEXT PRIMARY KEY,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS mothership_billing_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      enforcement TEXT NOT NULL DEFAULT 'none',
      default_monthly_cents INTEGER,
      grace_days INTEGER NOT NULL DEFAULT 7,
      payment_instructions TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS circle_billing (
      line_id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      monthly_cents INTEGER,
      currency TEXT NOT NULL DEFAULT 'USD',
      billing_contact_user_id TEXT,
      note TEXT,
      last_paid_at TEXT,
      grace_until TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(line_id) REFERENCES lines(id),
      FOREIGN KEY(household_id) REFERENCES households(id)
    );
    CREATE INDEX IF NOT EXISTS idx_circle_billing_household ON circle_billing(household_id);
  `);

  const now = nowIso();
  db.prepare(
    `INSERT OR IGNORE INTO mothership_billing_settings
       (id, enabled, enforcement, default_monthly_cents, grace_days, payment_instructions, updated_at)
     VALUES (1, 0, 'none', NULL, 7, NULL, ?)`
  ).run(now);

  const firstUser = db
    .prepare(`SELECT id FROM users ORDER BY created_at ASC LIMIT 1`)
    .get() as { id: string } | undefined;
  if (firstUser) ensureMothershipOperator(db, firstUser.id, "owner");

  db.prepare(`INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)`).run(
    "mothership_billing_v1",
    now
  );
}
