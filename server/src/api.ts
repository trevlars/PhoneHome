import type Database from "better-sqlite3";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import {
  AllowlistEntry,
  CallLog,
  Household,
  Invite,
  Line,
  LineType,
  User,
  createSession,
  getSessionUser,
  newId,
  nowIso,
} from "./db.js";

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function bootstrapAdmin(db: Database.Database): { user: User; setupCode: string; fresh: boolean } {
  const existing = db.prepare(`SELECT * FROM users LIMIT 1`).get() as User | undefined;
  if (existing) {
    return {
      user: existing,
      setupCode: "",
      fresh: false,
    };
  }
  const setupCode = String(randomInt(100000, 999999));
  const user: User = {
    id: newId("user"),
    display_name: "Host parent",
    setup_code_hash: hashCode(setupCode),
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO users (id, display_name, setup_code_hash, created_at) VALUES (@id, @display_name, @setup_code_hash, @created_at)`
  ).run(user);
  return { user, setupCode, fresh: true };
}

export function loginWithSetupCode(db: Database.Database, code: string, displayName?: string) {
  const users = db.prepare(`SELECT * FROM users`).all() as User[];
  let user = users.find((u) => u.setup_code_hash && safeEqualHex(u.setup_code_hash, hashCode(code)));
  if (!user) {
    // First redeem creates additional parents with invite flow; for lab also allow creating via host code only
    throw new Error("Invalid setup code");
  }
  if (displayName && displayName.trim()) {
    db.prepare(`UPDATE users SET display_name = ? WHERE id = ?`).run(displayName.trim(), user.id);
    user = { ...user, display_name: displayName.trim() };
  }
  const session = createSession(db, user.id);
  return { user, session };
}

export function registerParent(
  db: Database.Database,
  displayName: string
): { user: User; setupCode: string; sessionId: string } {
  const setupCode = String(randomInt(100000, 999999));
  const user: User = {
    id: newId("user"),
    display_name: displayName.trim() || "Parent",
    setup_code_hash: hashCode(setupCode),
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO users (id, display_name, setup_code_hash, created_at) VALUES (@id, @display_name, @setup_code_hash, @created_at)`
  ).run(user);
  const session = createSession(db, user.id);
  return { user, setupCode, sessionId: session.id };
}

export function createHousehold(db: Database.Database, userId: string, name: string): Household {
  const household: Household = {
    id: newId("hh"),
    name: name.trim() || "Family",
    owner_user_id: userId,
    kill_switch: 0,
    quiet_start: null,
    quiet_end: null,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO households (id, name, owner_user_id, kill_switch, quiet_start, quiet_end, created_at)
     VALUES (@id, @name, @owner_user_id, @kill_switch, @quiet_start, @quiet_end, @created_at)`
  ).run(household);
  db.prepare(
    `INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'owner')`
  ).run(household.id, userId);
  return household;
}

export function addLine(
  db: Database.Database,
  householdId: string,
  userId: string,
  name: string,
  type: LineType = "softphone"
): Line {
  const line: Line = {
    id: newId("line"),
    household_id: householdId,
    name: name.trim() || "Softphone",
    type,
    owner_user_id: userId,
    online: 0,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO lines (id, household_id, name, type, owner_user_id, online, created_at)
     VALUES (@id, @household_id, @name, @type, @owner_user_id, @online, @created_at)`
  ).run(line);
  return line;
}

export function createInvite(db: Database.Database, householdId: string, userId: string): Invite {
  const code = String(randomInt(100000, 999999));
  const invite: Invite = {
    id: newId("inv"),
    code,
    from_household_id: householdId,
    created_by: userId,
    expires_at: new Date(Date.now() + 48 * 3600e3).toISOString(),
    redeemed_by_household_id: null,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO invites (id, code, from_household_id, created_by, expires_at, redeemed_by_household_id, created_at)
     VALUES (@id, @code, @from_household_id, @created_by, @expires_at, @redeemed_by_household_id, @created_at)`
  ).run(invite);
  return invite;
}

export function redeemInvite(
  db: Database.Database,
  code: string,
  userId: string,
  householdName: string
): { invite: Invite; household: Household } {
  const invite = db.prepare(`SELECT * FROM invites WHERE code = ?`).get(code.trim()) as Invite | undefined;
  if (!invite) throw new Error("Invite not found");
  if (invite.redeemed_by_household_id) throw new Error("Invite already used");
  if (invite.expires_at < nowIso()) throw new Error("Invite expired");

  const household = createHousehold(db, userId, householdName);
  db.prepare(`UPDATE invites SET redeemed_by_household_id = ? WHERE id = ?`).run(household.id, invite.id);

  // Auto-allowlist: each side can see the other's lines once they exist — caller adds lines after
  return { invite: { ...invite, redeemed_by_household_id: household.id }, household };
}

export function addAllowlist(
  db: Database.Database,
  householdId: string,
  targetLineId: string,
  label: string
): AllowlistEntry {
  const entry: AllowlistEntry = {
    id: newId("al"),
    household_id: householdId,
    target_line_id: targetLineId,
    label: label.trim() || "Contact",
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT OR REPLACE INTO allowlist (id, household_id, target_line_id, label, created_at)
     VALUES (@id, @household_id, @target_line_id, @label, @created_at)`
  ).run(entry);
  return entry;
}

export function removeAllowlist(db: Database.Database, householdId: string, entryId: string): void {
  db.prepare(`DELETE FROM allowlist WHERE id = ? AND household_id = ?`).run(entryId, householdId);
}

export function updateHouseholdRules(
  db: Database.Database,
  householdId: string,
  patch: { kill_switch?: boolean; quiet_start?: string | null; quiet_end?: string | null }
): Household {
  const hh = db.prepare(`SELECT * FROM households WHERE id = ?`).get(householdId) as Household;
  if (!hh) throw new Error("Household not found");
  const next = {
    ...hh,
    kill_switch: patch.kill_switch === undefined ? hh.kill_switch : patch.kill_switch ? 1 : 0,
    quiet_start: patch.quiet_start === undefined ? hh.quiet_start : patch.quiet_start,
    quiet_end: patch.quiet_end === undefined ? hh.quiet_end : patch.quiet_end,
  };
  db.prepare(
    `UPDATE households SET kill_switch = @kill_switch, quiet_start = @quiet_start, quiet_end = @quiet_end WHERE id = @id`
  ).run(next);
  return next;
}

function inQuietHours(hh: Household, date = new Date()): boolean {
  if (!hh.quiet_start || !hh.quiet_end) return false;
  const [sh, sm] = hh.quiet_start.split(":").map(Number);
  const [eh, em] = hh.quiet_end.split(":").map(Number);
  const mins = date.getHours() * 60 + date.getMinutes();
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  if (start === end) return false;
  if (start < end) return mins >= start && mins < end;
  return mins >= start || mins < end;
}

export function canCall(
  db: Database.Database,
  fromLineId: string,
  toLineId: string
): { ok: true } | { ok: false; reason: string } {
  const from = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(fromLineId) as Line | undefined;
  const to = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(toLineId) as Line | undefined;
  if (!from || !to) return { ok: false, reason: "Unknown line" };

  const fromHh = db.prepare(`SELECT * FROM households WHERE id = ?`).get(from.household_id) as Household;
  const toHh = db.prepare(`SELECT * FROM households WHERE id = ?`).get(to.household_id) as Household;

  if (fromHh.kill_switch) return { ok: false, reason: "Caller household kill switch is on" };
  if (toHh.kill_switch) return { ok: false, reason: "Callee household kill switch is on" };
  if (inQuietHours(fromHh)) return { ok: false, reason: "Caller quiet hours" };
  if (inQuietHours(toHh)) return { ok: false, reason: "Callee quiet hours" };

  const allowedOut = db
    .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
    .get(from.household_id, toLineId);
  const allowedIn = db
    .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
    .get(to.household_id, fromLineId);

  // Same household can always call
  if (from.household_id === to.household_id) return { ok: true };

  if (!allowedOut) return { ok: false, reason: "Destination not on your allowlist" };
  if (!allowedIn) return { ok: false, reason: "You are not on their allowlist" };
  return { ok: true };
}

export function logCall(
  db: Database.Database,
  fromLineId: string,
  toLineId: string,
  outcome: string
): CallLog {
  const log: CallLog = {
    id: newId("call"),
    from_line_id: fromLineId,
    to_line_id: toLineId,
    started_at: nowIso(),
    ended_at: outcome === "ringing" ? null : nowIso(),
    outcome,
  };
  db.prepare(
    `INSERT INTO call_logs (id, from_line_id, to_line_id, started_at, ended_at, outcome)
     VALUES (@id, @from_line_id, @to_line_id, @started_at, @ended_at, @outcome)`
  ).run(log);
  return log;
}

export function endCallLog(db: Database.Database, callId: string, outcome: string): void {
  db.prepare(`UPDATE call_logs SET ended_at = ?, outcome = ? WHERE id = ?`).run(nowIso(), outcome, callId);
}

export function householdSnapshot(db: Database.Database, userId: string) {
  const memberships = db
    .prepare(`SELECT household_id FROM household_members WHERE user_id = ?`)
    .all(userId) as { household_id: string }[];
  const households = memberships.map((m) => {
    const hh = db.prepare(`SELECT * FROM households WHERE id = ?`).get(m.household_id) as Household;
    const lines = db.prepare(`SELECT * FROM lines WHERE household_id = ?`).all(hh.id) as Line[];
    const allowlist = db.prepare(`SELECT * FROM allowlist WHERE household_id = ?`).all(hh.id) as AllowlistEntry[];
    const logs = db
      .prepare(
        `SELECT cl.* FROM call_logs cl
         JOIN lines l ON l.id = cl.from_line_id OR l.id = cl.to_line_id
         WHERE l.household_id = ?
         ORDER BY cl.started_at DESC LIMIT 50`
      )
      .all(hh.id) as CallLog[];
    return { ...hh, lines, allowlist, call_logs: logs };
  });

  const directory = db
    .prepare(
      `SELECT l.id, l.name, l.type, l.household_id, l.online, h.name AS household_name
       FROM lines l JOIN households h ON h.id = l.household_id`
    )
    .all();

  return { households, directory };
}

export { getSessionUser, createSession, hashCode };
