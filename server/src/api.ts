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
    quiet_tz: null,
    daily_cap_minutes: null,
    parent_pin_hash: null,
    schedule_preset: "open",
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO households (id, name, owner_user_id, kill_switch, quiet_start, quiet_end, quiet_tz, daily_cap_minutes, parent_pin_hash, schedule_preset, created_at)
     VALUES (@id, @name, @owner_user_id, @kill_switch, @quiet_start, @quiet_end, @quiet_tz, @daily_cap_minutes, @parent_pin_hash, @schedule_preset, @created_at)`
  ).run(household);
  db.prepare(
    `INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'owner')`
  ).run(household.id, userId);
  db.prepare(
    `INSERT INTO voicemails (id, household_id, from_line_id, from_label, body, listened, created_at)
     VALUES (?, ?, NULL, 'Kids Landline', ?, 0, ?)`
  ).run(
    newId("vm"),
    household.id,
    "Welcome! Approved contacts only, quiet hours, daily limits, and a parent pause switch — just like the big kids-phone clubs, on your own private network.",
    nowIso()
  );
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
  label: string,
  opts: { speedDial?: number | null; favorite?: boolean } = {}
): AllowlistEntry {
  const used = db
    .prepare(`SELECT speed_dial FROM allowlist WHERE household_id = ? AND speed_dial IS NOT NULL`)
    .all(householdId) as { speed_dial: number }[];
  const taken = new Set(used.map((u) => u.speed_dial));
  let speed = opts.speedDial ?? null;
  if (speed == null) {
    for (let i = 1; i <= 9; i++) {
      if (!taken.has(i)) {
        speed = i;
        break;
      }
    }
  }
  let cleanLabel = label.trim() || "Friend";
  if (/^contact$/i.test(cleanLabel)) {
    const line = db.prepare(`SELECT name FROM lines WHERE id = ?`).get(targetLineId) as
      | { name: string }
      | undefined;
    cleanLabel = (line?.name || "Friend").replace(/'s phone$/i, "").replace(/\s+phone$/i, "").trim() || "Friend";
  }
  const entry: AllowlistEntry = {
    id: newId("al"),
    household_id: householdId,
    target_line_id: targetLineId,
    label: cleanLabel,
    speed_dial: speed,
    favorite: opts.favorite === false ? 0 : 1,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT OR REPLACE INTO allowlist (id, household_id, target_line_id, label, speed_dial, favorite, created_at)
     VALUES (@id, @household_id, @target_line_id, @label, @speed_dial, @favorite, @created_at)`
  ).run(entry);
  return entry;
}

export function updateAllowlistEntry(
  db: Database.Database,
  householdId: string,
  entryId: string,
  patch: { label?: string; speed_dial?: number | null; favorite?: boolean }
): AllowlistEntry {
  const entry = db
    .prepare(`SELECT * FROM allowlist WHERE id = ? AND household_id = ?`)
    .get(entryId, householdId) as AllowlistEntry | undefined;
  if (!entry) throw new Error("Contact not found");
  const next = {
    ...entry,
    label: patch.label === undefined ? entry.label : patch.label.trim() || entry.label,
    speed_dial: patch.speed_dial === undefined ? entry.speed_dial : patch.speed_dial,
    favorite: patch.favorite === undefined ? entry.favorite : patch.favorite ? 1 : 0,
  };
  if (next.speed_dial != null && (next.speed_dial < 1 || next.speed_dial > 9)) {
    throw new Error("Speed dial must be 1–9");
  }
  db.prepare(
    `UPDATE allowlist SET label = @label, speed_dial = @speed_dial, favorite = @favorite WHERE id = @id`
  ).run(next);
  return next;
}

export function removeAllowlist(db: Database.Database, householdId: string, entryId: string): void {
  db.prepare(`DELETE FROM allowlist WHERE id = ? AND household_id = ?`).run(entryId, householdId);
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function parseHhMm(value: string): { h: number; m: number } {
  if (!HHMM.test(value)) throw new Error("Quiet hours must be HH:MM (24-hour)");
  const [h, m] = value.split(":").map(Number);
  return { h, m };
}

/** Local minutes-since-midnight in an IANA timezone (not the server clock). */
export function localMinutesInTimeZone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

export function isInQuietWindow(
  quietStart: string | null | undefined,
  quietEnd: string | null | undefined,
  quietTz: string | null | undefined,
  date = new Date()
): boolean {
  if (!quietStart || !quietEnd || !quietTz) return false;
  if (!isValidTimeZone(quietTz)) return false;
  const start = parseHhMm(quietStart);
  const end = parseHhMm(quietEnd);
  const mins = localMinutesInTimeZone(date, quietTz);
  const startM = start.h * 60 + start.m;
  const endM = end.h * 60 + end.m;
  if (startM === endM) return false;
  if (startM < endM) return mins >= startM && mins < endM;
  return mins >= startM || mins < endM;
}

const SCHEDULE_PRESETS: Record<
  string,
  { quiet_start: string | null; quiet_end: string | null; label: string }
> = {
  open: { quiet_start: null, quiet_end: null, label: "Open" },
  bedtime: { quiet_start: "20:00", quiet_end: "07:00", label: "Bedtime" },
  school: { quiet_start: "08:00", quiet_end: "15:30", label: "School hours" },
  custom: { quiet_start: null, quiet_end: null, label: "Custom" },
};

export function hashPin(pin: string): string {
  return createHash("sha256").update(`kl-pin:${pin}`).digest("hex");
}

export function verifyParentPin(hh: Household, pin: string): boolean {
  if (!hh.parent_pin_hash) return true;
  const a = Buffer.from(hh.parent_pin_hash, "hex");
  const b = Buffer.from(hashPin(pin), "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function minutesUsedToday(db: Database.Database, householdId: string, now = new Date()): number {
  const hh = db.prepare(`SELECT * FROM households WHERE id = ?`).get(householdId) as Household;
  const tz = hh?.quiet_tz && isValidTimeZone(hh.quiet_tz) ? hh.quiet_tz : "UTC";
  const dayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const lines = db.prepare(`SELECT id FROM lines WHERE household_id = ?`).all(householdId) as {
    id: string;
  }[];
  if (!lines.length) return 0;
  const ids = lines.map((l) => l.id);
  const placeholders = ids.map(() => "?").join(",");
  const logs = db
    .prepare(
      `SELECT started_at, ended_at, outcome FROM call_logs
       WHERE outcome IN ('completed', 'answered')
         AND (from_line_id IN (${placeholders}) OR to_line_id IN (${placeholders}))`
    )
    .all(...ids, ...ids) as { started_at: string; ended_at: string | null; outcome: string }[];

  let totalSec = 0;
  for (const log of logs) {
    const start = new Date(log.started_at);
    const startDay = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(start);
    if (startDay !== dayKey) continue;
    const end = log.ended_at ? new Date(log.ended_at) : now;
    totalSec += Math.max(0, (end.getTime() - start.getTime()) / 1000);
  }
  return Math.round(totalSec / 60);
}

export function updateHouseholdRules(
  db: Database.Database,
  householdId: string,
  patch: {
    kill_switch?: boolean;
    quiet_start?: string | null;
    quiet_end?: string | null;
    quiet_tz?: string | null;
    daily_cap_minutes?: number | null;
    schedule_preset?: string;
    parent_pin?: string | null;
  }
): Household {
  const hh = db.prepare(`SELECT * FROM households WHERE id = ?`).get(householdId) as Household;
  if (!hh) throw new Error("Household not found");

  let quiet_start = patch.quiet_start === undefined ? hh.quiet_start : patch.quiet_start;
  let quiet_end = patch.quiet_end === undefined ? hh.quiet_end : patch.quiet_end;
  let quiet_tz = patch.quiet_tz === undefined ? hh.quiet_tz : patch.quiet_tz;
  let schedule_preset = patch.schedule_preset === undefined ? hh.schedule_preset || "open" : patch.schedule_preset;
  let daily_cap_minutes =
    patch.daily_cap_minutes === undefined ? hh.daily_cap_minutes ?? null : patch.daily_cap_minutes;
  let parent_pin_hash = hh.parent_pin_hash;

  if (patch.schedule_preset && patch.schedule_preset !== "custom") {
    const preset = SCHEDULE_PRESETS[patch.schedule_preset];
    if (!preset) throw new Error("Unknown schedule preset");
    if (patch.schedule_preset !== "open") {
      quiet_start = preset.quiet_start;
      quiet_end = preset.quiet_end;
      if (!quiet_tz) quiet_tz = "America/New_York";
    } else {
      quiet_start = null;
      quiet_end = null;
    }
    schedule_preset = patch.schedule_preset;
  }

  if (quiet_start === "") quiet_start = null;
  if (quiet_end === "") quiet_end = null;
  if (quiet_tz === "") quiet_tz = null;

  if (quiet_start && quiet_end) {
    parseHhMm(quiet_start);
    parseHhMm(quiet_end);
    if (!quiet_tz || !isValidTimeZone(quiet_tz)) {
      throw new Error("Quiet hours need a valid timezone (e.g. America/Chicago)");
    }
    if (!patch.schedule_preset) schedule_preset = "custom";
  } else if (quiet_start || quiet_end) {
    throw new Error("Set both quiet start and end, or clear both");
  } else if (patch.quiet_start !== undefined || patch.quiet_end !== undefined) {
    quiet_start = null;
    quiet_end = null;
    if (!patch.schedule_preset) schedule_preset = "open";
  }

  if (quiet_tz && !isValidTimeZone(quiet_tz)) {
    throw new Error("Invalid timezone");
  }

  if (daily_cap_minutes !== null && daily_cap_minutes !== undefined) {
    const n = Number(daily_cap_minutes);
    if (!Number.isFinite(n) || n < 0) throw new Error("Daily cap must be 0+ minutes");
    daily_cap_minutes = Math.round(n) || null;
  }

  if (patch.parent_pin !== undefined) {
    if (patch.parent_pin === null || patch.parent_pin === "") parent_pin_hash = null;
    else {
      if (!/^\d{4,6}$/.test(patch.parent_pin)) throw new Error("PIN must be 4–6 digits");
      parent_pin_hash = hashPin(patch.parent_pin);
    }
  }

  const next = {
    ...hh,
    kill_switch: patch.kill_switch === undefined ? hh.kill_switch : patch.kill_switch ? 1 : 0,
    quiet_start,
    quiet_end,
    quiet_tz,
    daily_cap_minutes,
    parent_pin_hash,
    schedule_preset: schedule_preset || "open",
  };
  db.prepare(
    `UPDATE households SET kill_switch = @kill_switch, quiet_start = @quiet_start, quiet_end = @quiet_end,
     quiet_tz = @quiet_tz, daily_cap_minutes = @daily_cap_minutes, parent_pin_hash = @parent_pin_hash,
     schedule_preset = @schedule_preset WHERE id = @id`
  ).run(next);
  return next;
}

function inQuietHours(hh: Household, date = new Date()): boolean {
  return isInQuietWindow(hh.quiet_start, hh.quiet_end, hh.quiet_tz, date);
}

export function canCall(
  db: Database.Database,
  fromLineId: string,
  toLineId: string,
  now = new Date()
): { ok: true } | { ok: false; reason: string } {
  const from = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(fromLineId) as Line | undefined;
  const to = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(toLineId) as Line | undefined;
  if (!from || !to) return { ok: false, reason: "Unknown line" };

  const fromHh = db.prepare(`SELECT * FROM households WHERE id = ?`).get(from.household_id) as Household;
  const toHh = db.prepare(`SELECT * FROM households WHERE id = ?`).get(to.household_id) as Household;

  if (fromHh.kill_switch) return { ok: false, reason: "Phone is paused by a parent" };
  if (toHh.kill_switch) return { ok: false, reason: "Their phone is paused by a parent" };
  if (inQuietHours(fromHh, now)) return { ok: false, reason: "Quiet hours — try again later" };
  if (inQuietHours(toHh, now)) return { ok: false, reason: "They’re in quiet hours" };

  if (fromHh.daily_cap_minutes != null) {
    const used = minutesUsedToday(db, fromHh.id, now);
    if (used >= fromHh.daily_cap_minutes) {
      return { ok: false, reason: "Daily talk time limit reached" };
    }
  }
  if (toHh.daily_cap_minutes != null) {
    const used = minutesUsedToday(db, toHh.id, now);
    if (used >= toHh.daily_cap_minutes) {
      return { ok: false, reason: "Their daily talk time limit is full" };
    }
  }

  const allowedOut = db
    .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
    .get(from.household_id, toLineId);
  const allowedIn = db
    .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
    .get(to.household_id, fromLineId);

  // Same household can always call
  if (from.household_id === to.household_id) return { ok: true };

  if (!allowedOut) return { ok: false, reason: "Not on your approved contacts" };
  if (!allowedIn) return { ok: false, reason: "You’re not on their approved contacts" };
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
  const existing = db.prepare(`SELECT outcome FROM call_logs WHERE id = ?`).get(callId) as
    | { outcome: string }
    | undefined;
  let final = outcome;
  if (outcome === "ended") {
    if (existing?.outcome === "answered") final = "completed";
    else if (existing?.outcome === "ringing") final = "cancelled";
  }
  db.prepare(`UPDATE call_logs SET ended_at = ?, outcome = ? WHERE id = ?`).run(nowIso(), final, callId);
}

/** Mark unanswered ringing calls older than `maxAgeMs` as missed. */
export function expireStaleRings(db: Database.Database, maxAgeMs = 45_000): number {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const result = db
    .prepare(
      `UPDATE call_logs
       SET ended_at = ?, outcome = 'missed'
       WHERE outcome = 'ringing' AND ended_at IS NULL AND started_at < ?`
    )
    .run(nowIso(), cutoff);
  return result.changes;
}

export function householdSnapshot(db: Database.Database, userId: string) {
  const memberships = db
    .prepare(`SELECT household_id FROM household_members WHERE user_id = ?`)
    .all(userId) as { household_id: string }[];
  const households = memberships.map((m) => {
    const hh = db.prepare(`SELECT * FROM households WHERE id = ?`).get(m.household_id) as Household;
    const lines = db.prepare(`SELECT * FROM lines WHERE household_id = ?`).all(hh.id) as Line[];
    const allowlist = db
      .prepare(`SELECT * FROM allowlist WHERE household_id = ? ORDER BY speed_dial IS NULL, speed_dial, label`)
      .all(hh.id) as AllowlistEntry[];
    const logs = db
      .prepare(
        `SELECT cl.* FROM call_logs cl
         JOIN lines l ON l.id = cl.from_line_id OR l.id = cl.to_line_id
         WHERE l.household_id = ?
         ORDER BY cl.started_at DESC LIMIT 80`
      )
      .all(hh.id) as CallLog[];
    const voicemails = db
      .prepare(
        `SELECT * FROM voicemails WHERE household_id = ? ORDER BY created_at DESC LIMIT 40`
      )
      .all(hh.id);
    const used = minutesUsedToday(db, hh.id);
    const { parent_pin_hash, ...safe } = hh as Household & { parent_pin_hash: string | null };
    return {
      ...safe,
      has_parent_pin: Boolean(parent_pin_hash),
      parent_pin_hash: undefined,
      lines,
      allowlist,
      call_logs: logs,
      voicemails,
      usage_today_minutes: used,
      daily_cap_minutes: hh.daily_cap_minutes ?? null,
      schedule_preset: hh.schedule_preset || "open",
    };
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
