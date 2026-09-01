import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import {
  AllowlistEntry,
  AtaDevice,
  CallLog,
  ChildGuardian,
  GuardianInvite,
  Household,
  Invite,
  Line,
  LineType,
  Sphere,
  User,
  createSession,
  getSessionUser,
  newId,
  nowIso,
  type AtaModel,
} from "./db.js";
import { buildHt801ConfigXml, formatConfigServerPath, normalizeAtaModel, normalizeMac } from "./ht801.js";
import { buildG100sConfigTxt, formatFanvilProvisionUrl } from "./g100s.js";
import { isUsFederalHoliday } from "./usHolidays.js";
import {
  spokenFor,
  type UnavailableVoice,
} from "./unavailableVoice.js";
import {
  assertMothershipCanAddLine,
  assertMothershipCanAddPod,
  getMothershipStats,
} from "./mothershipLimits.js";

const MIN_PASSWORD_LEN = 8;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function normalizeUsername(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase();
}

export function validateUsername(raw: string): string {
  const username = normalizeUsername(raw);
  if (username.length < 3 || username.length > 32) {
    throw new Error("Username must be 3–32 characters");
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(username)) {
    throw new Error("Username can use letters, numbers, ., _, and -");
  }
  return username;
}

/** Case-insensitive username lookup (login key is lowercase; legacy mixed-case rows still match). */
export function findUserByUsername(db: Database.Database, usernameRaw: string): User | undefined {
  const username = normalizeUsername(usernameRaw);
  if (!username) return undefined;
  return db
    .prepare(`SELECT * FROM users WHERE username IS NOT NULL AND lower(username) = ?`)
    .get(username) as User | undefined;
}

/** True if another account already owns this login key (case-insensitive). */
export function isUsernameTaken(
  db: Database.Database,
  usernameRaw: string,
  excludeUserId?: string
): boolean {
  const username = normalizeUsername(usernameRaw);
  if (!username) return false;
  if (excludeUserId) {
    const row = db
      .prepare(
        `SELECT id FROM users WHERE username IS NOT NULL AND lower(username) = ? AND id != ?`
      )
      .get(username, excludeUserId);
    return Boolean(row);
  }
  const row = db
    .prepare(`SELECT id FROM users WHERE username IS NOT NULL AND lower(username) = ?`)
    .get(username);
  return Boolean(row);
}

export function validatePassword(password: string): string {
  const pw = String(password || "");
  if (pw.length < MIN_PASSWORD_LEN) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LEN} characters`);
  }
  if (pw.length > 200) throw new Error("Password is too long");
  return pw;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  }).toString("hex");
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = String(stored).split("$");
  if (parts[0] !== "scrypt" || parts.length !== 6) return false;
  const [, n, r, p, salt, hash] = parts;
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  const expected = Buffer.from(hash, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export type PublicUser = {
  id: string;
  display_name: string;
  username: string | null;
  has_password: boolean;
  created_at: string;
  /** Mom / Dad label preference for parent lines; null = use display name. */
  parent_title?: string | null;
  /** parent | grandparent — drives Settings chrome for relatives. */
  profile_role?: string | null;
  /** Dedicated kid login / child-only account — never parent setup UX. */
  is_child_only?: boolean;
};

export function publicUser(user: User, opts?: { isChildOnly?: boolean }): PublicUser {
  const out: PublicUser = {
    id: user.id,
    display_name: user.display_name,
    username: user.username ?? null,
    has_password: Boolean(user.password_hash),
    created_at: user.created_at,
    parent_title: user.parent_title ?? null,
    profile_role: user.profile_role ?? null,
  };
  if (opts?.isChildOnly !== undefined) out.is_child_only = opts.isChildOnly;
  return out;
}

function insertUser(
  db: Database.Database,
  user: User
): void {
  db.prepare(
    `INSERT INTO users (id, display_name, username, password_hash, setup_code_hash, parent_title, profile_role, created_at)
     VALUES (@id, @display_name, @username, @password_hash, @setup_code_hash, @parent_title, @profile_role, @created_at)`
  ).run(user);
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
    username: null,
    password_hash: null,
    setup_code_hash: hashCode(setupCode),
    parent_title: null,
    profile_role: null,
    created_at: nowIso(),
  };
  insertUser(db, user);
  return { user, setupCode, fresh: true };
}

export function loginWithSetupCode(db: Database.Database, code: string, displayName?: string) {
  const users = db.prepare(`SELECT * FROM users`).all() as User[];
  let user = users.find((u) => u.setup_code_hash && safeEqualHex(u.setup_code_hash, hashCode(code)));
  if (!user) {
    throw new Error("Invalid setup code");
  }
  if (displayName && displayName.trim()) {
    db.prepare(`UPDATE users SET display_name = ? WHERE id = ?`).run(displayName.trim(), user.id);
    user = { ...user, display_name: displayName.trim() };
  }
  const session = createSession(db, user.id);
  return { user, session };
}

export function loginWithPassword(db: Database.Database, usernameRaw: string, passwordRaw: string) {
  const username = normalizeUsername(usernameRaw);
  if (!username || !passwordRaw) throw new Error("Username and password required");
  const user = findUserByUsername(db, username);
  if (!user?.password_hash || !verifyPassword(passwordRaw, user.password_hash)) {
    throw new Error("Invalid username or password");
  }
  const session = createSession(db, user.id);
  return { user, session };
}

/** Mint a fresh 6-digit login code for an existing parent (HTTPS move / lost code). */
export function reissueSetupCode(db: Database.Database, userId: string): string {
  const user = db.prepare(`SELECT id FROM users WHERE id = ?`).get(userId) as { id: string } | undefined;
  if (!user) throw new Error("User not found");
  const setupCode = String(randomInt(100000, 999999));
  db.prepare(`UPDATE users SET setup_code_hash = ? WHERE id = ?`).run(hashCode(setupCode), userId);
  return setupCode;
}

export function registerParent(
  db: Database.Database,
  displayName: string,
  opts: { username?: string; password?: string; profile_role?: ProfileRole } = {}
): { user: User; setupCode: string; sessionId: string } {
  const username = opts.username
    ? validateUsername(opts.username)
    : validateUsername(`u_${newId().replace(/[^a-z0-9]/gi, "").slice(0, 10)}`);
  const password = opts.password ? validatePassword(opts.password) : validatePassword(`Pw_${newId()}9a`);
  if (isUsernameTaken(db, username)) throw new Error("That username is taken");

  const setupCode = String(randomInt(100000, 999999));
  const user: User = {
    id: newId("user"),
    display_name: displayName.trim() || "Parent",
    username,
    password_hash: hashPassword(password),
    setup_code_hash: hashCode(setupCode),
    parent_title: null,
    profile_role: opts.profile_role ?? null,
    created_at: nowIso(),
  };
  insertUser(db, user);
  const session = createSession(db, user.id);
  return { user, setupCode, sessionId: session.id };
}

/** Logged-in parent sets or updates username + password (migration from code-only accounts). */
export function setUserCredentials(
  db: Database.Database,
  userId: string,
  opts: { username?: string; password: string }
): User {
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as User | undefined;
  if (!user) throw new Error("User not found");
  const password = validatePassword(opts.password);
  let username = user.username;
  if (opts.username != null && String(opts.username).trim()) {
    username = validateUsername(opts.username);
    if (isUsernameTaken(db, username, userId)) throw new Error("That username is taken");
  }
  if (!username) throw new Error("Username required");
  // Always store the login key as lowercase; display_name stays separate.
  const loginKey = validateUsername(username);
  db.prepare(`UPDATE users SET username = ?, password_hash = ? WHERE id = ?`).run(
    loginKey,
    hashPassword(password),
    userId
  );
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as User;
}

/** Admin/CLI: set a new password for a username (creates hash only; username must exist). */
export function adminResetPassword(db: Database.Database, usernameRaw: string, newPassword: string): User {
  const username = normalizeUsername(usernameRaw);
  const user = findUserByUsername(db, username);
  if (!user) throw new Error(`No user with username “${username}”`);
  const password = validatePassword(newPassword);
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(password), user.id);
  console.log(
    `[audit] password reset by admin for username=${user.username} user_id=${user.id} at ${nowIso()}`
  );
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id) as User;
}

export type PublicGuardian = {
  user_id: string;
  display_name: string;
  username: string | null;
  role: "guardian";
  created_at: string;
};

export function isGuardian(db: Database.Database, userId: string, lineId: string): boolean {
  return Boolean(
    db.prepare(`SELECT 1 FROM child_guardians WHERE line_id = ? AND user_id = ?`).get(lineId, userId)
  );
}

export function isHouseholdOwner(db: Database.Database, householdId: string, userId: string): boolean {
  const hh = db.prepare(`SELECT owner_user_id FROM households WHERE id = ?`).get(householdId) as
    | { owner_user_id: string }
    | undefined;
  return Boolean(hh && hh.owner_user_id === userId);
}

/**
 * Dedicated kid account: child login on a line, or owns only child-mode line(s)
 * (no parent-mode line) and is not a household owner / guardian of someone else’s
 * line. Self-guardianship of your own child line does not make you a parent.
 * These accounts must not create family or guardian invites.
 */
export function isChildOnlyAccount(db: Database.Database, userId: string): boolean {
  if (db.prepare(`SELECT 1 FROM lines WHERE child_user_id = ? LIMIT 1`).get(userId)) return true;
  // Parents who created a household (even if their only line is Child mode) stay parents.
  if (db.prepare(`SELECT 1 FROM households WHERE owner_user_id = ? LIMIT 1`).get(userId)) return false;
  // Guardian of another user’s line → parent/guardian chrome (not the kid).
  const guardianOfOther = db
    .prepare(
      `SELECT 1 FROM child_guardians g
       JOIN lines l ON l.id = g.line_id
       WHERE g.user_id = ?
         AND IFNULL(l.owner_user_id, '') != ?
         AND IFNULL(l.child_user_id, '') != ?
       LIMIT 1`
    )
    .get(userId, userId, userId);
  if (guardianOfOther) return false;
  const ownsChild = db
    .prepare(`SELECT 1 FROM lines WHERE owner_user_id = ? AND mode = 'child' LIMIT 1`)
    .get(userId);
  if (!ownsChild) return false;
  const ownsParent = db
    .prepare(
      `SELECT 1 FROM lines WHERE owner_user_id = ? AND IFNULL(mode, 'parent') != 'child' LIMIT 1`
    )
    .get(userId);
  return !ownsParent;
}

/** App Store / TestFlight review login — hard-locked to one contact forever. */
export const TEST_REVIEW_USERNAME = "test";
/** Only contact the review account may see or call — and the only person who may see Test. */
export const TEST_REVIEW_CONTACT_USERNAME = "trevor";

export function isTestReviewAccount(db: Database.Database, userId: string): boolean {
  const u = db.prepare(`SELECT username FROM users WHERE id = ?`).get(userId) as
    | { username: string | null }
    | undefined;
  return Boolean(u?.username && u.username.toLowerCase() === TEST_REVIEW_USERNAME);
}

export function isTestReviewContactAccount(db: Database.Database, userId: string): boolean {
  const u = db.prepare(`SELECT username FROM users WHERE id = ?`).get(userId) as
    | { username: string | null }
    | undefined;
  return Boolean(u?.username && u.username.toLowerCase() === TEST_REVIEW_CONTACT_USERNAME);
}

function testReviewUserIdForLine(db: Database.Database, line: Line): string | null {
  if (line.owner_user_id && isTestReviewAccount(db, line.owner_user_id)) return line.owner_user_id;
  if (line.child_user_id && isTestReviewAccount(db, line.child_user_id)) return line.child_user_id;
  return null;
}

export function isTestReviewLineId(db: Database.Database, lineId: string): boolean {
  const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line | undefined;
  return Boolean(line && testReviewUserIdForLine(db, line));
}

/** Own lines + every line owned by username `trevor`. Nothing else — ever. */
export function testReviewAllowedLineIds(db: Database.Database, testUserId: string): Set<string> {
  const ids = new Set<string>();
  for (const row of db
    .prepare(`SELECT id FROM lines WHERE owner_user_id = ? OR child_user_id = ?`)
    .all(testUserId, testUserId) as { id: string }[]) {
    ids.add(row.id);
  }
  const trevor = db
    .prepare(`SELECT id FROM users WHERE lower(IFNULL(username, '')) = ?`)
    .get(TEST_REVIEW_CONTACT_USERNAME) as { id: string } | undefined;
  if (trevor) {
    for (const row of db
      .prepare(`SELECT id FROM lines WHERE owner_user_id = ?`)
      .all(trevor.id) as { id: string }[]) {
      ids.add(row.id);
    }
  }
  return ids;
}

function listTestReviewLineIds(db: Database.Database): string[] {
  const testUsers = db
    .prepare(`SELECT id FROM users WHERE lower(IFNULL(username, '')) = ?`)
    .all(TEST_REVIEW_USERNAME) as { id: string }[];
  const ids: string[] = [];
  for (const u of testUsers) {
    for (const row of db
      .prepare(`SELECT id FROM lines WHERE owner_user_id = ? OR child_user_id = ?`)
      .all(u.id, u.id) as { id: string }[]) {
      ids.push(row.id);
    }
  }
  return ids;
}

/** Review softphone is invisible to everyone except Test and Trevor. */
export function canViewerAccessTestReviewLine(
  db: Database.Database,
  viewerUserId: string,
  targetLineId: string
): boolean {
  if (!isTestReviewLineId(db, targetLineId)) return true;
  return isTestReviewAccount(db, viewerUserId) || isTestReviewContactAccount(db, viewerUserId);
}

export function assertTestReviewMayContactLine(
  db: Database.Database,
  userId: string,
  lineId: string
): void {
  if (isTestReviewAccount(db, userId)) {
    if (!testReviewAllowedLineIds(db, userId).has(lineId)) {
      throw new Error("Test account may only contact Trevor");
    }
    return;
  }
  if (isTestReviewLineId(db, lineId) && !isTestReviewContactAccount(db, userId)) {
    throw new Error("Test account is only available to Trevor");
  }
}

/**
 * Self-heal bidirectional isolation:
 * - Test’s allowlist/circle → Trevor + self only
 * - Test’s line stripped from every other family’s allowlist/circle (Trevor kept)
 */
export function scrubTestReviewVisibility(db: Database.Database, userId: string): void {
  if (isTestReviewAccount(db, userId)) {
    const allowed = testReviewAllowedLineIds(db, userId);
    const hhs = db
      .prepare(`SELECT household_id FROM household_members WHERE user_id = ?`)
      .all(userId) as { household_id: string }[];
    for (const { household_id } of hhs) {
      const rows = db
        .prepare(`SELECT id, target_line_id FROM allowlist WHERE household_id = ?`)
        .all(household_id) as { id: string; target_line_id: string }[];
      for (const r of rows) {
        if (!allowed.has(r.target_line_id)) {
          db.prepare(`DELETE FROM allowlist WHERE id = ?`).run(r.id);
        }
      }
    }
    const sphere = getSphereByOwner(db, userId);
    if (sphere) {
      const members = db
        .prepare(`SELECT line_id FROM sphere_members WHERE sphere_id = ?`)
        .all(sphere.id) as { line_id: string }[];
      for (const m of members) {
        if (!allowed.has(m.line_id)) {
          db.prepare(`DELETE FROM sphere_members WHERE sphere_id = ? AND line_id = ?`).run(
            sphere.id,
            m.line_id
          );
        }
      }
    }
  }

  for (const testLineId of listTestReviewLineIds(db)) {
    const sphereRows = db
      .prepare(
        `SELECT sm.sphere_id, s.owner_user_id
         FROM sphere_members sm
         JOIN spheres s ON s.id = sm.sphere_id
         WHERE sm.line_id = ?`
      )
      .all(testLineId) as { sphere_id: string; owner_user_id: string }[];
    for (const row of sphereRows) {
      // Never attach the review softphone to a parent circle (kids inherit those).
      // Only Test’s own circle may list it.
      if (isTestReviewAccount(db, row.owner_user_id)) continue;
      db.prepare(`DELETE FROM sphere_members WHERE sphere_id = ? AND line_id = ?`).run(
        row.sphere_id,
        testLineId
      );
    }

    const allowRows = db
      .prepare(
        `SELECT a.id, h.owner_user_id
         FROM allowlist a
         JOIN households h ON h.id = a.household_id
         WHERE a.target_line_id = ?`
      )
      .all(testLineId) as { id: string; owner_user_id: string }[];
    for (const row of allowRows) {
      if (
        isTestReviewAccount(db, row.owner_user_id) ||
        isTestReviewContactAccount(db, row.owner_user_id)
      ) {
        continue;
      }
      db.prepare(`DELETE FROM allowlist WHERE id = ?`).run(row.id);
    }
  }
}

/** Parents/guardians on the household — never child-only accounts. */
export function canCreateHouseholdInvite(
  db: Database.Database,
  userId: string,
  householdId: string
): boolean {
  if (isChildOnlyAccount(db, userId)) return false;
  return userInHousehold(db, householdId, userId);
}

/** True if user is a guardian of the child line OR a household member for that line’s household. */
export function canManageChild(db: Database.Database, userId: string, lineId: string): boolean {
  const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line | undefined;
  if (!line) return false;
  if (isGuardian(db, userId, lineId)) return true;
  return userInHousehold(db, line.household_id, userId);
}

/** Household allowlist/rules/circles: parents & co-parent guardians — never kid accounts. */
export function canManageHouseholdChildState(
  db: Database.Database,
  userId: string,
  householdId: string
): boolean {
  if (isChildOnlyAccount(db, userId)) return false;
  if (userInHousehold(db, householdId, userId)) return true;
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM child_guardians g
         JOIN lines l ON l.id = g.line_id
         WHERE l.household_id = ? AND g.user_id = ? AND l.mode = 'child'`
      )
      .get(householdId, userId)
  );
}

/**
 * Parent-only gate for invite / approve / circle membership mutations.
 * Throws if the actor is a kid softphone / child-login account.
 */
export function assertParentContactAdmin(db: Database.Database, userId: string): void {
  if (isChildOnlyAccount(db, userId)) {
    throw new Error("Only parents can manage contacts and circles");
  }
}

export function ensureGuardian(db: Database.Database, lineId: string, userId: string): ChildGuardian {
  const existing = db
    .prepare(`SELECT * FROM child_guardians WHERE line_id = ? AND user_id = ?`)
    .get(lineId, userId) as ChildGuardian | undefined;
  if (existing) return existing;
  const row: ChildGuardian = {
    line_id: lineId,
    user_id: userId,
    role: "guardian",
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO child_guardians (line_id, user_id, role, created_at) VALUES (@line_id, @user_id, @role, @created_at)`
  ).run(row);
  return row;
}

export function listGuardians(db: Database.Database, lineId: string): PublicGuardian[] {
  return db
    .prepare(
      `SELECT g.user_id, g.role, g.created_at, u.display_name, u.username
       FROM child_guardians g JOIN users u ON u.id = g.user_id
       WHERE g.line_id = ?
       ORDER BY g.created_at`
    )
    .all(lineId) as PublicGuardian[];
}

export function addGuardianByUsername(
  db: Database.Database,
  actorUserId: string,
  lineId: string,
  usernameRaw: string
): PublicGuardian {
  if (!canManageChild(db, actorUserId, lineId)) throw new Error("Not authorized to manage this child line");
  const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line | undefined;
  if (!line) throw new Error("Line not found");
  if ((line.mode || "parent") !== "child") throw new Error("Pick a kid line — add a kid under Kids first");

  const username = validateUsername(usernameRaw);
  const target = findUserByUsername(db, username);
  if (!target) throw new Error("No parent with that username");
  // Must be an existing parent on the network (has a household membership)
  const onNetwork = db
    .prepare(`SELECT 1 FROM household_members WHERE user_id = ? LIMIT 1`)
    .get(target.id);
  if (!onNetwork) throw new Error("That account is not on the family network yet");

  ensureGuardian(db, lineId, target.id);
  const listed = listGuardians(db, lineId).find((g) => g.user_id === target.id);
  if (!listed) throw new Error("Could not add guardian");
  return listed;
}

export function removeGuardian(
  db: Database.Database,
  actorUserId: string,
  lineId: string,
  targetUserId: string
): void {
  const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line | undefined;
  if (!line) throw new Error("Line not found");
  const actorOk =
    isGuardian(db, actorUserId, lineId) || isHouseholdOwner(db, line.household_id, actorUserId);
  if (!actorOk) throw new Error("Not authorized to remove guardians");
  if (!isGuardian(db, targetUserId, lineId)) throw new Error("That parent is not a guardian");

  const guardians = listGuardians(db, lineId);
  if (guardians.length <= 1) throw new Error("Keep at least one guardian on a child line");

  db.prepare(`DELETE FROM child_guardians WHERE line_id = ? AND user_id = ?`).run(lineId, targetUserId);
}

export function createGuardianInvite(
  db: Database.Database,
  actorUserId: string,
  lineId: string
): GuardianInvite {
  if (isChildOnlyAccount(db, actorUserId)) throw new Error("Only parents can invite guardians");
  if (!canManageChild(db, actorUserId, lineId)) throw new Error("Not authorized to manage this child line");
  const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line | undefined;
  if (!line) throw new Error("Line not found");
  if ((line.mode || "parent") !== "child") throw new Error("Pick a kid line — add a kid under Kids first");

  const invite: GuardianInvite = {
    id: newId("ginv"),
    code: String(randomInt(100000, 999999)),
    line_id: lineId,
    created_by: actorUserId,
    expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
    redeemed_by_user_id: null,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO guardian_invites (id, code, line_id, created_by, expires_at, redeemed_by_user_id, created_at)
     VALUES (@id, @code, @line_id, @created_by, @expires_at, @redeemed_by_user_id, @created_at)`
  ).run(invite);
  return invite;
}

export function redeemGuardianInvite(
  db: Database.Database,
  userId: string,
  codeRaw: string
): { line: Line; guardians: PublicGuardian[] } {
  assertParentContactAdmin(db, userId);
  const code = String(codeRaw || "").trim();
  if (!/^\d{6}$/.test(code)) throw new Error("Enter the 6-digit guardian invite code");
  const invite = db.prepare(`SELECT * FROM guardian_invites WHERE code = ?`).get(code) as
    | GuardianInvite
    | undefined;
  if (!invite) throw new Error("Invite not found");
  if (invite.redeemed_by_user_id) throw new Error("Invite already used");
  if (new Date(invite.expires_at).getTime() < Date.now()) throw new Error("Invite expired");

  const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(invite.line_id) as Line | undefined;
  if (!line) throw new Error("Child line not found");
  if ((line.mode || "parent") !== "child") throw new Error("Line is no longer in Child mode");

  ensureGuardian(db, line.id, userId);
  // Co-parents should share the same household UI (contacts, Quiet Time, etc.).
  if (!userInHousehold(db, line.household_id, userId)) {
    db.prepare(
      `INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'member')`
    ).run(line.household_id, userId);
  }
  const coSphere = ensureSphereForParent(db, userId);
  // New co-parent’s circle is available on this kid’s pad until parents narrow it.
  grantLineSphereAccess(db, line.id, coSphere.id);
  db.prepare(`UPDATE guardian_invites SET redeemed_by_user_id = ? WHERE id = ?`).run(userId, invite.id);
  return { line: normalizeLine(line), guardians: listGuardians(db, line.id) };
}

/** Create or update the optional login for a child line (separate from parent accounts). */
export function setChildLineLogin(
  db: Database.Database,
  actorUserId: string,
  lineId: string,
  opts: { username: string; password: string; displayName?: string }
): { line: Line; childUser: PublicUser } {
  if (!canManageChild(db, actorUserId, lineId)) throw new Error("Not authorized to manage this child line");
  const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line | undefined;
  if (!line) throw new Error("Line not found");
  if ((line.mode || "parent") !== "child") throw new Error("Pick a kid line — add a kid under Kids first");

  const username = validateUsername(opts.username);
  const password = validatePassword(opts.password);
  const displayName =
    (opts.displayName && String(opts.displayName).trim()) ||
    line.child_label ||
    line.name ||
    "Child";

  let childUser: User;
  if (line.child_user_id) {
    const existing = db.prepare(`SELECT * FROM users WHERE id = ?`).get(line.child_user_id) as
      | User
      | undefined;
    if (!existing) throw new Error("Child login missing — create it again");
    if (isUsernameTaken(db, username, existing.id)) throw new Error("That username is taken");
    db.prepare(`UPDATE users SET username = ?, password_hash = ?, display_name = ? WHERE id = ?`).run(
      username,
      hashPassword(password),
      displayName.slice(0, 64),
      existing.id
    );
    childUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(existing.id) as User;
    console.log(
      `[audit] child login updated by parent user_id=${actorUserId} for child_user=${childUser.username} line_id=${lineId} at ${nowIso()}`
    );
  } else {
    if (isUsernameTaken(db, username)) throw new Error("That username is taken");
    childUser = {
      id: newId("user"),
      display_name: displayName.slice(0, 64),
      username,
      password_hash: hashPassword(password),
      setup_code_hash: null,
      parent_title: null,
      profile_role: null,
      created_at: nowIso(),
    };
    insertUser(db, childUser);
    db.prepare(`UPDATE lines SET child_user_id = ? WHERE id = ?`).run(childUser.id, lineId);
    console.log(
      `[audit] child login created by parent user_id=${actorUserId} for child_user=${childUser.username} line_id=${lineId} at ${nowIso()}`
    );
  }

  const updated = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line;
  return { line: normalizeLine(updated), childUser: publicUser(childUser) };
}

/** Guardian/parent resets password for the child login linked to a line. */
export function resetChildPasswordByGuardian(
  db: Database.Database,
  actorUserId: string,
  lineId: string,
  newPassword: string
): { childUser: PublicUser; message: string } {
  if (!canManageChild(db, actorUserId, lineId)) throw new Error("Not authorized to manage this child line");
  const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line | undefined;
  if (!line) throw new Error("Line not found");
  if (!line.child_user_id) {
    throw new Error(
      "This child line has no login yet — create a child username first (Child mode uses the parent session + PIN until then)"
    );
  }
  const child = db.prepare(`SELECT * FROM users WHERE id = ?`).get(line.child_user_id) as User | undefined;
  if (!child) throw new Error("Child login not found");
  const password = validatePassword(newPassword);
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(password), child.id);
  const actor = db.prepare(`SELECT username, display_name FROM users WHERE id = ?`).get(actorUserId) as
    | { username: string | null; display_name: string }
    | undefined;
  const who = actor?.username || actor?.display_name || actorUserId;
  console.log(
    `[audit] password reset by parent “${who}” (user_id=${actorUserId}) for child_user=${child.username} line_id=${lineId} at ${nowIso()}`
  );
  const refreshed = db.prepare(`SELECT * FROM users WHERE id = ?`).get(child.id) as User;
  return {
    childUser: publicUser(refreshed),
    message: `Password reset by parent for ${refreshed.username}`,
  };
}

export type ProvisionedRelativeRow = {
  id: string;
  from_household_id: string;
  relative_user_id: string;
  relative_line_id: string;
  relative_household_id: string;
  display_label: string | null;
  created_by: string;
  created_at: string;
};

export type PublicProvisionedRelative = {
  id: string;
  display_name: string;
  username: string | null;
  display_label: string | null;
  household_name: string;
  line_id: string;
  household_id: string;
  profile_role: ProfileRole;
  created_at: string;
  kid_line_ids: string[];
};

function publicProvisionedRelative(
  db: Database.Database,
  row: ProvisionedRelativeRow,
  fromHouseholdId: string
): PublicProvisionedRelative | null {
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(row.relative_user_id) as
    | User
    | undefined;
  const hh = db.prepare(`SELECT * FROM households WHERE id = ?`).get(row.relative_household_id) as
    | Household
    | undefined;
  if (!user || !hh) return null;
  const kidRows = db
    .prepare(
      `SELECT l.id FROM lines l
       JOIN allowlist a ON a.target_line_id = l.id
       WHERE l.household_id = ? AND l.mode = 'child' AND a.household_id = ?`
    )
    .all(fromHouseholdId, row.relative_household_id) as { id: string }[];
  return {
    id: row.id,
    display_name: user.display_name,
    username: user.username,
    display_label: row.display_label,
    household_name: hh.name,
    line_id: row.relative_line_id,
    household_id: row.relative_household_id,
    profile_role: normalizeProfileRole(user.profile_role),
    created_at: row.created_at,
    kid_line_ids: kidRows.map((k) => k.id),
  };
}

export function listProvisionedRelatives(
  db: Database.Database,
  fromHouseholdId: string
): PublicProvisionedRelative[] {
  const rows = db
    .prepare(
      `SELECT * FROM provisioned_relatives WHERE from_household_id = ? ORDER BY created_at DESC`
    )
    .all(fromHouseholdId) as ProvisionedRelativeRow[];
  return rows
    .map((r) => publicProvisionedRelative(db, r, fromHouseholdId))
    .filter((r): r is PublicProvisionedRelative => Boolean(r));
}

/**
 * Parent creates a grandparent (or relative) account with username/password,
 * bridges circles like a family invite, and optionally mutual-allowlists kids.
 * Password is returned once so the parent can write it down / tell Grandma.
 */
export function provisionGrandparent(
  db: Database.Database,
  actorUserId: string,
  fromHouseholdId: string,
  opts: {
    displayName: string;
    username: string;
    password: string;
    householdName?: string;
    label?: string;
    kidLineIds?: string[];
  }
): {
  relative: PublicProvisionedRelative;
  username: string;
  password: string;
  line: Line;
  household: Household;
} {
  assertParentContactAdmin(db, actorUserId);
  if (!canCreateHouseholdInvite(db, actorUserId, fromHouseholdId)) {
    throw new Error("Only parents can set up grandparents for this household");
  }

  const displayName = String(opts.displayName || "").trim().slice(0, 64) || "Grandparent";
  const username = validateUsername(opts.username);
  const password = validatePassword(opts.password);
  if (isUsernameTaken(db, username)) throw new Error("That username is taken");

  const label =
    String(opts.label || "").trim().slice(0, 64) ||
    displayName.replace(/\s+phone$/i, "").trim() ||
    "Grandparent";

  const user: User = {
    id: newId("user"),
    display_name: displayName,
    username,
    password_hash: hashPassword(password),
    setup_code_hash: null,
    parent_title: null,
    profile_role: "grandparent",
    created_at: nowIso(),
  };
  insertUser(db, user);

  const hhName =
    String(opts.householdName || "").trim().slice(0, 64) || `${displayName}'s house`;
  const household = createHousehold(db, user.id, hhName);

  // Same bridge as redeemInvite: GP household “redeemed” an invite from the parent house.
  const invite: Invite = {
    id: newId("inv"),
    code: String(randomInt(100000, 999999)),
    from_household_id: fromHouseholdId,
    created_by: actorUserId,
    expires_at: new Date(Date.now() + 48 * 3600e3).toISOString(),
    redeemed_by_household_id: household.id,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO invites (id, code, from_household_id, created_by, expires_at, redeemed_by_household_id, created_at)
     VALUES (@id, @code, @from_household_id, @created_by, @expires_at, @redeemed_by_household_id, @created_at)`
  ).run(invite);

  const line = addLine(db, household.id, user.id, `${displayName}'s phone`, "softphone", {
    mode: "parent",
  });

  const kidIds = [...new Set((opts.kidLineIds || []).filter((id) => typeof id === "string" && id))];
  addAllowlist(db, fromHouseholdId, line.id, label, {
    actorUserId,
    favorite: true,
  });
  for (const kidLineId of kidIds) {
    const kid = db
      .prepare(`SELECT * FROM lines WHERE id = ? AND household_id = ?`)
      .get(kidLineId, fromHouseholdId) as Line | undefined;
    if (!kid || (kid.mode || "parent") !== "child") {
      throw new Error("Pick a kid from this household");
    }
    const kidLabel = kid.child_label || kid.name || "Grandchild";
    addAllowlist(db, household.id, kid.id, kidLabel, {
      actorUserId: user.id,
      favorite: true,
    });
  }

  const row: ProvisionedRelativeRow = {
    id: newId("prov"),
    from_household_id: fromHouseholdId,
    relative_user_id: user.id,
    relative_line_id: line.id,
    relative_household_id: household.id,
    display_label: label,
    created_by: actorUserId,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO provisioned_relatives (id, from_household_id, relative_user_id, relative_line_id, relative_household_id, display_label, created_by, created_at)
     VALUES (@id, @from_household_id, @relative_user_id, @relative_line_id, @relative_household_id, @display_label, @created_by, @created_at)`
  ).run(row);

  console.log(
    `[audit] grandparent provisioned by user_id=${actorUserId} relative_user=${username} from_hh=${fromHouseholdId} at ${nowIso()}`
  );

  const relative = publicProvisionedRelative(db, row, fromHouseholdId);
  if (!relative) throw new Error("Could not create grandparent account");

  return {
    relative,
    username,
    password,
    line: normalizeLine(line),
    household,
  };
}

/** Parent resets login password for a relative they provisioned. */
export function resetProvisionedRelativePassword(
  db: Database.Database,
  actorUserId: string,
  fromHouseholdId: string,
  relativeId: string,
  newPassword: string
): { relative: PublicProvisionedRelative; message: string } {
  assertParentContactAdmin(db, actorUserId);
  if (!canCreateHouseholdInvite(db, actorUserId, fromHouseholdId)) {
    throw new Error("Only parents can reset this login");
  }
  const row = db
    .prepare(`SELECT * FROM provisioned_relatives WHERE id = ? AND from_household_id = ?`)
    .get(relativeId, fromHouseholdId) as ProvisionedRelativeRow | undefined;
  if (!row) throw new Error("Grandparent setup not found");
  const password = validatePassword(newPassword);
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(
    hashPassword(password),
    row.relative_user_id
  );
  const relative = publicProvisionedRelative(db, row, fromHouseholdId);
  if (!relative) throw new Error("Grandparent account missing");
  console.log(
    `[audit] grandparent password reset by user_id=${actorUserId} relative_user=${relative.username} at ${nowIso()}`
  );
  return {
    relative,
    message: `Password updated for ${relative.username || relative.display_name}`,
  };
}

/** Parent can rename display / nickname / username for a provisioned relative. */
export function updateProvisionedRelativeLogin(
  db: Database.Database,
  actorUserId: string,
  fromHouseholdId: string,
  relativeId: string,
  opts: {
    displayName?: string;
    username?: string;
    label?: string;
    password?: string;
    /** Replace which kids this grandparent can call (mutual allowlist on their house). */
    kidLineIds?: string[];
  }
): { relative: PublicProvisionedRelative; password?: string } {
  assertParentContactAdmin(db, actorUserId);
  if (!canCreateHouseholdInvite(db, actorUserId, fromHouseholdId)) {
    throw new Error("Only parents can update this login");
  }
  const row = db
    .prepare(`SELECT * FROM provisioned_relatives WHERE id = ? AND from_household_id = ?`)
    .get(relativeId, fromHouseholdId) as ProvisionedRelativeRow | undefined;
  if (!row) throw new Error("Grandparent setup not found");
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(row.relative_user_id) as
    | User
    | undefined;
  if (!user) throw new Error("Grandparent account missing");

  let username = user.username;
  if (opts.username !== undefined) {
    username = validateUsername(opts.username);
    if (isUsernameTaken(db, username, user.id)) throw new Error("That username is taken");
  }
  const displayName =
    opts.displayName !== undefined
      ? String(opts.displayName || "").trim().slice(0, 64) || user.display_name
      : user.display_name;
  let passwordOut: string | undefined;
  if (opts.password !== undefined && String(opts.password).length > 0) {
    passwordOut = validatePassword(opts.password);
    db.prepare(`UPDATE users SET username = ?, password_hash = ?, display_name = ? WHERE id = ?`).run(
      username,
      hashPassword(passwordOut),
      displayName,
      user.id
    );
  } else {
    db.prepare(`UPDATE users SET username = ?, display_name = ? WHERE id = ?`).run(
      username,
      displayName,
      user.id
    );
  }

  if (opts.label !== undefined) {
    const label = String(opts.label || "").trim().slice(0, 64) || null;
    db.prepare(`UPDATE provisioned_relatives SET display_label = ? WHERE id = ?`).run(label, row.id);
    if (label) {
      db.prepare(
        `UPDATE allowlist SET label = ? WHERE household_id = ? AND target_line_id = ?`
      ).run(label, fromHouseholdId, row.relative_line_id);
    }
  }

  if (opts.kidLineIds !== undefined) {
    const wanted = [
      ...new Set(
        (opts.kidLineIds || []).filter((id) => typeof id === "string" && id)
      ),
    ];
    if (!wanted.length) throw new Error("Pick at least one kid they can call");
    for (const kidLineId of wanted) {
      const kid = db
        .prepare(`SELECT * FROM lines WHERE id = ? AND household_id = ?`)
        .get(kidLineId, fromHouseholdId) as Line | undefined;
      if (!kid || (kid.mode || "parent") !== "child") {
        throw new Error("Pick a kid from this household");
      }
    }
    const current = db
      .prepare(
        `SELECT a.id AS entry_id, a.target_line_id AS id FROM allowlist a
         JOIN lines l ON l.id = a.target_line_id
         WHERE a.household_id = ? AND l.household_id = ? AND l.mode = 'child'`
      )
      .all(row.relative_household_id, fromHouseholdId) as { entry_id: string; id: string }[];
    const currentIds = new Set(current.map((c) => c.id));
    const wantedSet = new Set(wanted);
    for (const rowCur of current) {
      if (!wantedSet.has(rowCur.id)) {
        db.prepare(`DELETE FROM allowlist WHERE id = ? AND household_id = ?`).run(
          rowCur.entry_id,
          row.relative_household_id
        );
      }
    }
    for (const kidLineId of wanted) {
      if (currentIds.has(kidLineId)) continue;
      const kid = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(kidLineId) as Line;
      const kidLabel = kid.child_label || kid.name || "Grandchild";
      addAllowlist(db, row.relative_household_id, kid.id, kidLabel, {
        actorUserId: user.id,
        favorite: true,
      });
    }
  }

  const refreshed = db
    .prepare(`SELECT * FROM provisioned_relatives WHERE id = ?`)
    .get(row.id) as ProvisionedRelativeRow;
  const relative = publicProvisionedRelative(db, refreshed, fromHouseholdId);
  if (!relative) throw new Error("Grandparent account missing");
  return passwordOut ? { relative, password: passwordOut } : { relative };
}

function normalizeLine(line: Line): Line {
  return {
    ...line,
    mode: (line.mode as Line["mode"]) || "parent",
    child_label: line.child_label ?? null,
    child_user_id: line.child_user_id ?? null,
    greeting_path: line.greeting_path ?? null,
    greeting_updated_at: line.greeting_updated_at ?? null,
    greeting_confirmed_at: line.greeting_confirmed_at ?? null,
    avatar_path: line.avatar_path ?? null,
    avatar_updated_at: line.avatar_updated_at ?? null,
    answering_machine: line.answering_machine ? 1 : 0,
  };
}

/** Public line fields for snapshot (never leak absolute paths). */
export function publicLineGreeting(line: Line): {
  has_greeting: boolean;
  greeting_confirmed: boolean;
  greeting_updated_at: string | null;
} {
  return {
    has_greeting: Boolean(line.greeting_path),
    greeting_confirmed: Boolean(line.greeting_confirmed_at) || Boolean(line.greeting_path),
    greeting_updated_at: line.greeting_updated_at ?? null,
  };
}

/** Public avatar fields (never leak storage paths). */
export function publicLineAvatar(line: Pick<Line, "id" | "avatar_path" | "avatar_updated_at">): {
  has_avatar: boolean;
  avatar_url: string | null;
  avatar_updated_at: string | null;
} {
  const has = Boolean(line.avatar_path);
  return {
    has_avatar: has,
    avatar_url: has ? `/api/lines/${line.id}/avatar` : null,
    avatar_updated_at: line.avatar_updated_at ?? null,
  };
}

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function setLineAvatar(
  db: Database.Database,
  householdId: string,
  lineId: string,
  opts: { imageBase64: string; imageMime?: string; dataDir: string }
): Line {
  const line = db.prepare(`SELECT * FROM lines WHERE id = ? AND household_id = ?`).get(lineId, householdId) as
    | Line
    | undefined;
  if (!line) throw new Error("Line not found");
  const mimeRaw = String(opts.imageMime || "image/jpeg").toLowerCase().split(";")[0].trim();
  const mime = mimeRaw === "image/jpg" ? "image/jpeg" : mimeRaw;
  const ext = AVATAR_MIME_EXT[mime];
  if (!ext) throw new Error("Use JPG, PNG, WebP, or GIF");
  const raw = opts.imageBase64.includes(",") ? opts.imageBase64.split(",").pop()! : opts.imageBase64;
  const buf = Buffer.from(raw, "base64");
  if (buf.length < 32) throw new Error("Image too small");
  if (buf.length > AVATAR_MAX_BYTES) throw new Error("Image must be under 2MB");
  const dir = path.join(opts.dataDir, "avatars");
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(`${lineId}.`)) {
      try {
        fs.unlinkSync(path.join(dir, f));
      } catch {}
    }
  }
  const rel = `avatars/${lineId}.${ext}`;
  fs.writeFileSync(path.join(opts.dataDir, rel), buf);
  const updated_at = nowIso();
  db.prepare(`UPDATE lines SET avatar_path = ?, avatar_updated_at = ? WHERE id = ?`).run(
    rel,
    updated_at,
    lineId
  );
  return normalizeLine(db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line);
}

export function clearLineAvatar(
  db: Database.Database,
  householdId: string,
  lineId: string,
  dataDir: string
): Line {
  const line = db.prepare(`SELECT * FROM lines WHERE id = ? AND household_id = ?`).get(lineId, householdId) as
    | Line
    | undefined;
  if (!line) throw new Error("Line not found");
  if (line.avatar_path) {
    const abs = path.resolve(dataDir, line.avatar_path);
    if (abs.startsWith(path.resolve(dataDir) + path.sep) && fs.existsSync(abs)) {
      try {
        fs.unlinkSync(abs);
      } catch {}
    }
  }
  db.prepare(`UPDATE lines SET avatar_path = NULL, avatar_updated_at = NULL WHERE id = ?`).run(lineId);
  return normalizeLine(db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line);
}

/** Same guardianship rules as voicemail greeting personalization. */
export function canEditLineAvatar(db: Database.Database, userId: string, lineId: string): boolean {
  return canEditLineGreeting(db, userId, lineId);
}

/** Any signed-in family member may load avatars for contacts/call UI. */
export function canViewLineAvatar(db: Database.Database, userId: string, _lineId: string): boolean {
  const membership = db
    .prepare(`SELECT 1 FROM household_members WHERE user_id = ? LIMIT 1`)
    .get(userId);
  if (membership) return true;
  const guardian = db.prepare(`SELECT 1 FROM child_guardians WHERE user_id = ? LIMIT 1`).get(userId);
  if (guardian) return true;
  return Boolean(db.prepare(`SELECT 1 FROM lines WHERE child_user_id = ? LIMIT 1`).get(userId));
}

export function setLineGreeting(
  db: Database.Database,
  householdId: string,
  lineId: string,
  opts: { audioBase64: string; audioMime?: string; dataDir: string }
): Line {
  const line = db.prepare(`SELECT * FROM lines WHERE id = ? AND household_id = ?`).get(lineId, householdId) as
    | Line
    | undefined;
  if (!line) throw new Error("Line not found");
  const mime = String(opts.audioMime || "audio/webm").toLowerCase();
  const ext = mime.includes("wav") || mime.includes("wave")
    ? "wav"
    : mime.includes("ogg")
      ? "ogg"
      : mime.includes("mp4") || mime.includes("m4a")
        ? "m4a"
        : "webm";
  const raw = opts.audioBase64.includes(",") ? opts.audioBase64.split(",").pop()! : opts.audioBase64;
  const buf = Buffer.from(raw, "base64");
  if (buf.length < 64) throw new Error("Recording too short");
  if (buf.length > 3_500_000) throw new Error("Recording too long (keep under ~60s)");
  const dir = path.join(opts.dataDir, "greetings");
  fs.mkdirSync(dir, { recursive: true });
  // Remove prior greeting files for this line (any extension).
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(`${lineId}.`)) {
      try {
        fs.unlinkSync(path.join(dir, f));
      } catch {}
    }
  }
  const rel = `greetings/${lineId}.${ext}`;
  fs.writeFileSync(path.join(opts.dataDir, rel), buf);
  const updated_at = nowIso();
  db.prepare(
    `UPDATE lines SET greeting_path = ?, greeting_updated_at = ?, greeting_confirmed_at = ? WHERE id = ?`
  ).run(rel, updated_at, updated_at, lineId);
  return normalizeLine(db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line);
}

export function clearLineGreeting(
  db: Database.Database,
  householdId: string,
  lineId: string,
  dataDir: string
): Line {
  const line = db.prepare(`SELECT * FROM lines WHERE id = ? AND household_id = ?`).get(lineId, householdId) as
    | Line
    | undefined;
  if (!line) throw new Error("Line not found");
  if (line.greeting_path) {
    const abs = path.resolve(dataDir, line.greeting_path);
    if (abs.startsWith(path.resolve(dataDir) + path.sep) && fs.existsSync(abs)) {
      try {
        fs.unlinkSync(abs);
      } catch {}
    }
  }
  const confirmed = nowIso();
  db.prepare(
    `UPDATE lines SET greeting_path = NULL, greeting_updated_at = NULL, greeting_confirmed_at = ? WHERE id = ?`
  ).run(confirmed, lineId);
  return normalizeLine(db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line);
}

/** Confirm default (or keep current) greeting — completes parent setup Sounds step. */
export function confirmLineGreeting(db: Database.Database, householdId: string, lineId: string): Line {
  const line = db.prepare(`SELECT * FROM lines WHERE id = ? AND household_id = ?`).get(lineId, householdId) as
    | Line
    | undefined;
  if (!line) throw new Error("Line not found");
  const confirmed = nowIso();
  db.prepare(`UPDATE lines SET greeting_confirmed_at = ? WHERE id = ?`).run(confirmed, lineId);
  return normalizeLine(db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line);
}

/**
 * True if user may record/clear this line's voicemail greeting.
 * Guardians / household parents (canManageChild) and the line's child login.
 */
export function canEditLineGreeting(db: Database.Database, userId: string, lineId: string): boolean {
  if (canManageChild(db, userId, lineId)) return true;
  const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line | undefined;
  if (!line) return false;
  // Child login tied to this line may personalize their own greeting.
  if (line.child_user_id && line.child_user_id === userId) return true;
  return false;
}

/** Caller may hear greeting if they have the line allowlisted, or own/manage the line. */
export function canHearLineGreeting(
  db: Database.Database,
  userId: string,
  lineId: string,
  fromLineId?: string
): boolean {
  if (canEditLineGreeting(db, userId, lineId)) return true;
  if (fromLineId) {
    const from = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(fromLineId) as Line | undefined;
    if (!from) return false;
    const member = db
      .prepare(`SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?`)
      .get(from.household_id, userId);
    if (!member && from.child_user_id !== userId) return false;
    const approved = db
      .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
      .get(from.household_id, lineId);
    return Boolean(approved);
  }
  return false;
}

function publicChildUserForLine(db: Database.Database, line: Line): PublicUser | null {
  if (!line.child_user_id) return null;
  const u = db.prepare(`SELECT * FROM users WHERE id = ?`).get(line.child_user_id) as User | undefined;
  return u ? publicUser(u) : null;
}

const RINGER_STYLES = new Set(["classic", "chirp", "modern", "chime", "urgent"]);

// —— Spheres (parent Circles — one per parent in a Pod) ————————————————————

/** Create the parent’s sphere if missing (idempotent). */
export function ensureSphereForParent(db: Database.Database, userId: string): Sphere {
  const existing = db.prepare(`SELECT * FROM spheres WHERE owner_user_id = ?`).get(userId) as
    | Sphere
    | undefined;
  if (existing) return existing;
  const user = db.prepare(`SELECT display_name FROM users WHERE id = ?`).get(userId) as
    | { display_name: string }
    | undefined;
  const label = (user?.display_name || "Parent").trim() || "Parent";
  const sphere: Sphere = {
    id: newId("sph"),
    owner_user_id: userId,
    name: `${label}'s circle`,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO spheres (id, owner_user_id, name, created_at) VALUES (@id, @owner_user_id, @name, @created_at)`
  ).run(sphere);
  return sphere;
}

export function getSphereByOwner(db: Database.Database, userId: string): Sphere | undefined {
  return db.prepare(`SELECT * FROM spheres WHERE owner_user_id = ?`).get(userId) as Sphere | undefined;
}

export function renameSphere(
  db: Database.Database,
  userId: string,
  name: string
): Sphere {
  const sphere = ensureSphereForParent(db, userId);
  const clean = String(name || "").trim().slice(0, 64);
  if (!clean) throw new Error("Circle name required");
  db.prepare(`UPDATE spheres SET name = ? WHERE id = ?`).run(clean, sphere.id);
  return db.prepare(`SELECT * FROM spheres WHERE id = ?`).get(sphere.id) as Sphere;
}

export function addLineToSphere(
  db: Database.Database,
  sphereId: string,
  lineId: string,
  addedByUserId?: string | null
): void {
  const sphere = db.prepare(`SELECT id, owner_user_id FROM spheres WHERE id = ?`).get(sphereId) as
    | { id: string; owner_user_id: string }
    | undefined;
  if (!sphere) throw new Error("Circle not found");
  const line = db.prepare(`SELECT id FROM lines WHERE id = ?`).get(lineId);
  if (!line) throw new Error("Unknown line");
  // Silent skip for invite/sync paths — review account circle stays Trevor-only.
  if (
    isTestReviewAccount(db, sphere.owner_user_id) &&
    !testReviewAllowedLineIds(db, sphere.owner_user_id).has(lineId)
  ) {
    return;
  }
  // Review softphone must never join a parent circle (kids inherit those lists).
  // Only the test account’s own circle may contain it; Trevor keeps it on allowlist only.
  if (isTestReviewLineId(db, lineId) && !isTestReviewAccount(db, sphere.owner_user_id)) {
    return;
  }
  db.prepare(
    `INSERT OR IGNORE INTO sphere_members (sphere_id, line_id, added_by_user_id, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(sphereId, lineId, addedByUserId ?? null, nowIso());
}

export function removeLineFromSphere(db: Database.Database, sphereId: string, lineId: string): void {
  db.prepare(`DELETE FROM sphere_members WHERE sphere_id = ? AND line_id = ?`).run(sphereId, lineId);
}

/** Add a contact line into a parent’s circle (their sphere). Parent-only. */
export function addContactToParentSphere(
  db: Database.Database,
  parentUserId: string,
  lineId: string
): Sphere {
  assertParentContactAdmin(db, parentUserId);
  assertTestReviewMayContactLine(db, parentUserId, lineId);
  const sphere = ensureSphereForParent(db, parentUserId);
  addLineToSphere(db, sphere.id, lineId, parentUserId);
  return sphere;
}

/**
 * Link an existing identity into this parent’s circle — only if already visible
 * to them (invite bridge / already in circle). Never a global search oracle.
 */
export function linkVisibleContactToParentSphere(
  db: Database.Database,
  parentUserId: string,
  lineId: string
): Sphere {
  assertParentContactAdmin(db, parentUserId);
  if (!canViewerSeeLine(db, parentUserId, lineId)) {
    // Same message whether missing or out-of-sphere — no existence oracle.
    throw new Error("Contact not found");
  }
  return addContactToParentSphere(db, parentUserId, lineId);
}

/**
 * After a line is created: put parent lines in the owner’s sphere; bridge invite
 * households so both sides can discover each other for mutual approve.
 */
export function syncLineIntoSpheres(db: Database.Database, line: Line): void {
  const mode = line.mode || "parent";
  if (mode !== "child") {
    const sphere = ensureSphereForParent(db, line.owner_user_id);
    addLineToSphere(db, sphere.id, line.id, line.owner_user_id);
  }

  // This household redeemed an invite → add line to inviter’s circle; mirror inviter lines here.
  const asRedeemer = db
    .prepare(
      `SELECT created_by, from_household_id FROM invites WHERE redeemed_by_household_id = ?`
    )
    .get(line.household_id) as { created_by: string; from_household_id: string } | undefined;
  if (asRedeemer) {
    const inviterSphere = ensureSphereForParent(db, asRedeemer.created_by);
    addLineToSphere(db, inviterSphere.id, line.id, asRedeemer.created_by);
    const redeemerSphere = ensureSphereForParent(db, line.owner_user_id);
    const inviterLines = db
      .prepare(`SELECT id FROM lines WHERE household_id = ?`)
      .all(asRedeemer.from_household_id) as { id: string }[];
    for (const l of inviterLines) {
      addLineToSphere(db, redeemerSphere.id, l.id, line.owner_user_id);
    }
  }

  // This household sent invites that were redeemed → add this new line into redeemers’ circles.
  const asInviter = db
    .prepare(
      `SELECT redeemed_by_household_id, created_by FROM invites
       WHERE from_household_id = ? AND redeemed_by_household_id IS NOT NULL`
    )
    .all(line.household_id) as { redeemed_by_household_id: string; created_by: string }[];
  for (const inv of asInviter) {
    const redeemedOwner = db
      .prepare(`SELECT owner_user_id FROM households WHERE id = ?`)
      .get(inv.redeemed_by_household_id) as { owner_user_id: string } | undefined;
    if (!redeemedOwner) continue;
    const redeemerSphere = ensureSphereForParent(db, redeemedOwner.owner_user_id);
    addLineToSphere(db, redeemerSphere.id, line.id, inv.created_by);
  }

  // New child line: default access to every household parent’s circle (host can narrow later).
  if (mode === "child") {
    const parents = db
      .prepare(`SELECT user_id FROM household_members WHERE household_id = ?`)
      .all(line.household_id) as { user_id: string }[];
    for (const p of parents) {
      const sph = ensureSphereForParent(db, p.user_id);
      grantLineSphereAccess(db, line.id, sph.id);
    }
  }
}

export function grantLineSphereAccess(db: Database.Database, lineId: string, sphereId: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO line_sphere_access (line_id, sphere_id, created_at) VALUES (?, ?, ?)`
  ).run(lineId, sphereId, nowIso());
}

export function revokeLineSphereAccess(db: Database.Database, lineId: string, sphereId: string): void {
  db.prepare(`DELETE FROM line_sphere_access WHERE line_id = ? AND sphere_id = ?`).run(
    lineId,
    sphereId
  );
}

/** Replace which parent circles appear on a kid line’s speed dial. */
export function setLineSphereAccess(
  db: Database.Database,
  householdId: string,
  lineId: string,
  sphereIds: string[]
): string[] {
  const line = db.prepare(`SELECT * FROM lines WHERE id = ? AND household_id = ?`).get(lineId, householdId) as
    | Line
    | undefined;
  if (!line) throw new Error("Line not found");
  if ((line.mode || "parent") !== "child") {
    throw new Error("Only kid lines use circle speed-dial assignment");
  }
  const allowed = new Set(
    listHouseholdParentSpheres(db, householdId).map((s) => s.id)
  );
  const unique = [
    ...new Set(
      (sphereIds || []).filter((id) => typeof id === "string" && id.length > 0 && allowed.has(id))
    ),
  ];
  db.prepare(`DELETE FROM line_sphere_access WHERE line_id = ?`).run(lineId);
  for (const id of unique) grantLineSphereAccess(db, lineId, id);
  return unique;
}

export function listHouseholdParentSpheres(db: Database.Database, householdId: string): Array<
  Sphere & { owner_display_name: string }
> {
  const members = db
    .prepare(
      `SELECT hm.user_id, u.display_name
       FROM household_members hm
       JOIN users u ON u.id = hm.user_id
       WHERE hm.household_id = ?
       ORDER BY CASE hm.role WHEN 'owner' THEN 0 ELSE 1 END, lower(u.display_name)`
    )
    .all(householdId) as { user_id: string; display_name: string }[];
  const out: Array<Sphere & { owner_display_name: string }> = [];
  for (const m of members) {
    const sph = ensureSphereForParent(db, m.user_id);
    out.push({ ...sph, owner_display_name: m.display_name });
  }
  return out;
}

export function listSphereMemberLineIds(db: Database.Database, sphereId: string): string[] {
  return (
    db.prepare(`SELECT line_id FROM sphere_members WHERE sphere_id = ?`).all(sphereId) as {
      line_id: string;
    }[]
  ).map((r) => r.line_id);
}

export function listLineSphereAccessIds(db: Database.Database, lineId: string): string[] {
  return (
    db.prepare(`SELECT sphere_id FROM line_sphere_access WHERE line_id = ?`).all(lineId) as {
      sphere_id: string;
    }[]
  ).map((r) => r.sphere_id);
}

/**
 * Sphere IDs that “count” for a line: explicit membership, kid speed-dial access,
 * and (for parent lines) the owner’s own circle.
 */
export function sphereIdsForLine(db: Database.Database, lineId: string): Set<string> {
  const ids = new Set<string>();
  const memberRows = db
    .prepare(`SELECT sphere_id FROM sphere_members WHERE line_id = ?`)
    .all(lineId) as { sphere_id: string }[];
  for (const r of memberRows) ids.add(r.sphere_id);
  for (const id of listLineSphereAccessIds(db, lineId)) ids.add(id);

  const line = db.prepare(`SELECT owner_user_id, mode FROM lines WHERE id = ?`).get(lineId) as
    | { owner_user_id: string; mode: string | null }
    | undefined;
  if (line && (line.mode || "parent") !== "child") {
    const owned = getSphereByOwner(db, line.owner_user_id);
    if (owned) ids.add(owned.id);
  }
  return ids;
}

/** True when two lines share at least one circle (membership and/or kid access). */
export function linesShareSphere(db: Database.Database, lineA: string, lineB: string): boolean {
  const a = sphereIdsForLine(db, lineA);
  if (!a.size) return false;
  const b = sphereIdsForLine(db, lineB);
  for (const id of a) {
    if (b.has(id)) return true;
  }
  return false;
}

/** Sphere IDs that currently list this line as a member (not counting kid access alone). */
export function sphereIdsContainingLine(db: Database.Database, lineId: string): string[] {
  return (
    db.prepare(`SELECT sphere_id FROM sphere_members WHERE line_id = ?`).all(lineId) as {
      sphere_id: string;
    }[]
  ).map((r) => r.sphere_id);
}

/**
 * Directory / discovery: a viewer may see a line if same household, they guard
 * that line, the line is in **their own** circle, or it’s already on their
 * household allowlist (presence for approved contacts).
 *
 * Never grant visibility just because two lines co-exist in someone else’s
 * circle — that leaked cousins to grandparents (and other invitees).
 */
export function canViewerSeeLine(
  db: Database.Database,
  viewerUserId: string,
  targetLineId: string
): boolean {
  const target = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(targetLineId) as Line | undefined;
  if (!target) return false;

  // Review account: Trevor + self only — never transitive circle / invite discovery.
  if (isTestReviewAccount(db, viewerUserId)) {
    return testReviewAllowedLineIds(db, viewerUserId).has(targetLineId);
  }
  // Everyone except Trevor: Test’s softphone does not exist.
  if (testReviewUserIdForLine(db, target)) {
    return isTestReviewContactAccount(db, viewerUserId);
  }

  if (userInHousehold(db, target.household_id, viewerUserId)) return true;
  if (isGuardian(db, viewerUserId, targetLineId)) return true;

  // Own circle only — not transitive co-membership in a host parent’s circle.
  const owned = getSphereByOwner(db, viewerUserId);
  if (owned) {
    const inMine = db
      .prepare(`SELECT 1 FROM sphere_members WHERE sphere_id = ? AND line_id = ?`)
      .get(owned.id, targetLineId);
    if (inMine) return true;
  }

  // Already approved on a household this viewer belongs to (labels / presence).
  const onMyAllowlist = db
    .prepare(
      `SELECT 1 FROM allowlist a
       JOIN household_members hm ON hm.household_id = a.household_id
       WHERE hm.user_id = ? AND a.target_line_id = ?
       LIMIT 1`
    )
    .get(viewerUserId, targetLineId);
  if (onMyAllowlist) return true;

  // Child login: same allowlist enrichment for their linked household.
  const childLoginAllow = db
    .prepare(
      `SELECT 1 FROM allowlist a
       JOIN lines cl ON cl.household_id = a.household_id AND cl.child_user_id = ?
       WHERE a.target_line_id = ?
       LIMIT 1`
    )
    .get(viewerUserId, targetLineId);
  if (childLoginAllow) return true;

  // Guardian-only co-parent: see contacts already approved on the kid’s household.
  const guardianAllow = db
    .prepare(
      `SELECT 1 FROM allowlist a
       JOIN lines kid ON kid.household_id = a.household_id AND IFNULL(kid.mode, 'parent') = 'child'
       JOIN child_guardians g ON g.line_id = kid.id
       WHERE g.user_id = ? AND a.target_line_id = ?
       LIMIT 1`
    )
    .get(viewerUserId, targetLineId);
  if (guardianAllow) return true;

  return false;
}

export function createHousehold(db: Database.Database, userId: string, name: string): Household {
  assertMothershipCanAddPod(db);
  const household: Household = {
    id: newId("hh"),
    name: name.trim() || "Family",
    owner_user_id: userId,
    kill_switch: 0,
    quiet_start: null,
    quiet_end: null,
    quiet_tz: null,
    quiet_days: null,
    skip_holidays: 0,
    daily_cap_minutes: null,
    parent_pin_hash: null,
    schedule_preset: "open",
    dnd: 0,
    parent_quiet_start: null,
    parent_quiet_end: null,
    parent_quiet_tz: null,
    parent_quiet_days: null,
    parent_schedule_preset: "open",
    layout_locked: 1,
    ring_volume: 70,
    ringer_style: "classic",
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO households (id, name, owner_user_id, kill_switch, quiet_start, quiet_end, quiet_tz, quiet_days, skip_holidays, daily_cap_minutes, parent_pin_hash, schedule_preset, dnd, parent_quiet_start, parent_quiet_end, parent_quiet_tz, parent_quiet_days, parent_schedule_preset, layout_locked, ring_volume, ringer_style, created_at)
     VALUES (@id, @name, @owner_user_id, @kill_switch, @quiet_start, @quiet_end, @quiet_tz, @quiet_days, @skip_holidays, @daily_cap_minutes, @parent_pin_hash, @schedule_preset, @dnd, @parent_quiet_start, @parent_quiet_end, @parent_quiet_tz, @parent_quiet_days, @parent_schedule_preset, @layout_locked, @ring_volume, @ringer_style, @created_at)`
  ).run(household);
  db.prepare(
    `INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'owner')`
  ).run(household.id, userId);
  ensureSphereForParent(db, userId);
  return household;
}

export function addLine(
  db: Database.Database,
  householdId: string,
  userId: string,
  name: string,
  type: LineType = "softphone",
  opts?: { mode?: "parent" | "child"; child_label?: string | null }
): Line {
  assertMothershipCanAddLine(db);
  const mode = opts?.mode === "child" ? "child" : "parent";
  let child_label = opts?.child_label === undefined ? null : opts.child_label;
  if (child_label === "") child_label = null;
  if (child_label != null) child_label = String(child_label).trim().slice(0, 64) || null;
  const trimmedName = name.trim() || (mode === "child" ? "Kid" : "App");
  if (mode === "child" && !child_label) child_label = trimmedName.slice(0, 64);
  const line: Line = {
    id: newId("line"),
    household_id: householdId,
    name: trimmedName,
    type,
    owner_user_id: userId,
    online: 0,
    mode,
    child_label,
    child_user_id: null,
    greeting_path: null,
    greeting_updated_at: null,
    greeting_confirmed_at: null,
    avatar_path: null,
    avatar_updated_at: null,
    answering_machine: 0,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO lines (id, household_id, name, type, owner_user_id, online, mode, child_label, child_user_id, answering_machine, created_at)
     VALUES (@id, @household_id, @name, @type, @owner_user_id, @online, @mode, @child_label, @child_user_id, @answering_machine, @created_at)`
  ).run(line);
  if (mode === "child") {
    ensureGuardian(db, line.id, userId);
    const hh = db.prepare(`SELECT owner_user_id FROM households WHERE id = ?`).get(householdId) as
      | { owner_user_id: string }
      | undefined;
    if (hh?.owner_user_id) ensureGuardian(db, line.id, hh.owner_user_id);
  }
  syncLineIntoSpheres(db, line);
  return line;
}

export function updateLine(
  db: Database.Database,
  householdId: string,
  lineId: string,
  patch: {
    mode?: "parent" | "child";
    child_label?: string | null;
    name?: string;
    /** Opt-in; omit to leave unchanged. Never default-on. */
    answering_machine?: boolean | number;
  },
  opts?: { actorUserId?: string }
): Line {
  const line = db.prepare(`SELECT * FROM lines WHERE id = ? AND household_id = ?`).get(lineId, householdId) as
    | Line
    | undefined;
  if (!line) throw new Error("Line not found");
  let mode = patch.mode === undefined ? (line.mode || "parent") : patch.mode;
  if (mode !== "parent" && mode !== "child") throw new Error("mode must be parent or child");
  let child_label =
    patch.child_label === undefined ? line.child_label ?? null : patch.child_label;
  if (child_label === "") child_label = null;
  if (child_label != null) child_label = String(child_label).trim().slice(0, 64) || null;
  const name =
    patch.name === undefined ? line.name : String(patch.name || "").trim().slice(0, 64) || line.name;
  const answering_machine =
    patch.answering_machine === undefined
      ? line.answering_machine
        ? 1
        : 0
      : patch.answering_machine
        ? 1
        : 0;
  db.prepare(
    `UPDATE lines SET mode = ?, child_label = ?, name = ?, answering_machine = ? WHERE id = ?`
  ).run(mode, child_label, name, answering_machine, lineId);
  if (mode === "child" && opts?.actorUserId) {
    ensureGuardian(db, lineId, opts.actorUserId);
    const hh = db.prepare(`SELECT owner_user_id FROM households WHERE id = ?`).get(householdId) as
      | { owner_user_id: string }
      | undefined;
    if (hh?.owner_user_id) ensureGuardian(db, lineId, hh.owner_user_id);
  }
  const updated = normalizeLine(db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line);
  if (mode === "child" && (line.mode || "parent") !== "child") {
    // Newly flipped to kid: grant default circle access for household parents.
    syncLineIntoSpheres(db, updated);
  }
  return updated;
}

/** Best-effort unlink of a path under dataDir (never throws). */
function unlinkUnderDataDir(dataDir: string, relOrAbs: string | null | undefined): void {
  if (!relOrAbs) return;
  const root = path.resolve(dataDir);
  const abs = path.resolve(dataDir, relOrAbs);
  if (!abs.startsWith(root + path.sep) && abs !== root) return;
  if (!fs.existsSync(abs)) return;
  try {
    fs.unlinkSync(abs);
  } catch {
    /* best-effort */
  }
}

function unlinkLineMediaFiles(
  dataDir: string,
  lineId: string,
  greetingPath?: string | null,
  avatarPath?: string | null
): void {
  unlinkUnderDataDir(dataDir, greetingPath);
  unlinkUnderDataDir(dataDir, avatarPath);
  for (const sub of ["greetings", "avatars"] as const) {
    const dir = path.join(dataDir, sub);
    if (!fs.existsSync(dir)) continue;
    try {
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(`${lineId}.`)) unlinkUnderDataDir(dataDir, path.join(sub, f));
      }
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Hard-delete one line and every row/file that references it (including other
 * households’ allowlist / speed-dial entries pointing at this line).
 * Idempotent if the line row is already gone.
 */
export function wipeLineCascade(
  db: Database.Database,
  lineId: string,
  dataDir: string
): { wiped: boolean; childUserId: string | null } {
  const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line | undefined;
  if (!line) {
    // Still scrub dangling refs (cross-hh allowlist, etc.) for idempotency.
    db.prepare(`DELETE FROM allowlist WHERE target_line_id = ?`).run(lineId);
    db.prepare(`DELETE FROM allowlist_declined WHERE target_line_id = ?`).run(lineId);
    db.prepare(`DELETE FROM family_room_members WHERE line_id = ?`).run(lineId);
    db.prepare(
      `DELETE FROM family_room_talk_pairs WHERE line_a = ? OR line_b = ?`
    ).run(lineId, lineId);
    db.prepare(`DELETE FROM sphere_members WHERE line_id = ?`).run(lineId);
    db.prepare(`DELETE FROM line_sphere_access WHERE line_id = ?`).run(lineId);
    db.prepare(`DELETE FROM child_guardians WHERE line_id = ?`).run(lineId);
    db.prepare(`DELETE FROM guardian_invites WHERE line_id = ?`).run(lineId);
    db.prepare(`DELETE FROM ata_devices WHERE line_id = ?`).run(lineId);
    db.prepare(`DELETE FROM call_logs WHERE from_line_id = ? OR to_line_id = ?`).run(lineId, lineId);
    return { wiped: false, childUserId: null };
  }

  clearLiveCallsForLine(lineId);

  const vmRows = db
    .prepare(
      `SELECT id, audio_path FROM voicemails WHERE from_line_id = ? OR to_line_id = ?`
    )
    .all(lineId, lineId) as { id: string; audio_path: string | null }[];
  for (const vm of vmRows) {
    unlinkUnderDataDir(dataDir, vm.audio_path);
  }
  db.prepare(`DELETE FROM voicemails WHERE from_line_id = ? OR to_line_id = ?`).run(
    lineId,
    lineId
  );

  db.prepare(`DELETE FROM allowlist WHERE target_line_id = ?`).run(lineId);
  db.prepare(`DELETE FROM allowlist_declined WHERE target_line_id = ?`).run(lineId);
  db.prepare(`DELETE FROM family_room_members WHERE line_id = ?`).run(lineId);
  db.prepare(
    `DELETE FROM family_room_talk_pairs WHERE line_a = ? OR line_b = ?`
  ).run(lineId, lineId);
  db.prepare(`DELETE FROM sphere_members WHERE line_id = ?`).run(lineId);
  db.prepare(`DELETE FROM line_sphere_access WHERE line_id = ?`).run(lineId);
  db.prepare(`DELETE FROM child_guardians WHERE line_id = ?`).run(lineId);
  db.prepare(`DELETE FROM guardian_invites WHERE line_id = ?`).run(lineId);
  db.prepare(`DELETE FROM ata_devices WHERE line_id = ?`).run(lineId);
  db.prepare(`DELETE FROM call_logs WHERE from_line_id = ? OR to_line_id = ?`).run(lineId, lineId);

  unlinkLineMediaFiles(dataDir, lineId, line.greeting_path, line.avatar_path);

  const childUserId = line.child_user_id ?? null;
  db.prepare(`DELETE FROM lines WHERE id = ?`).run(lineId);
  return { wiped: true, childUserId };
}

/** Delete a user row if nothing else still references it. */
function maybeDeleteOrphanUser(db: Database.Database, userId: string | null | undefined): boolean {
  if (!userId) return false;
  if (db.prepare(`SELECT 1 FROM lines WHERE child_user_id = ? OR owner_user_id = ? LIMIT 1`).get(userId, userId)) {
    return false;
  }
  if (db.prepare(`SELECT 1 FROM households WHERE owner_user_id = ? LIMIT 1`).get(userId)) return false;
  if (db.prepare(`SELECT 1 FROM household_members WHERE user_id = ? LIMIT 1`).get(userId)) return false;
  if (db.prepare(`SELECT 1 FROM child_guardians WHERE user_id = ? LIMIT 1`).get(userId)) return false;
  db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
  const r = db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
  return r.changes > 0;
}

function normalizeDeleteConfirm(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function confirmMatchesDeleteToken(confirm: string, ...names: Array<string | null | undefined>): boolean {
  if (!confirm) return false;
  if (confirm.toUpperCase() === "DELETE") return true;
  const needle = confirm.toLowerCase();
  return names.some((n) => n && String(n).trim().toLowerCase() === needle);
}

/**
 * Parent hard-deletes one child line (and its login, ATA, media, call history,
 * and every allowlist/speed-dial entry pointing at it — including other households).
 * Requires household membership (not guardian-only from another house).
 * Confirm with "DELETE" or the child’s label/name. Idempotent if already gone.
 */
export function deleteChildLine(
  db: Database.Database,
  actorUserId: string,
  householdId: string,
  lineId: string,
  dataDir: string,
  opts?: { confirm?: unknown }
): { ok: true; deleted: boolean; lineId: string } {
  if (!userInHousehold(db, householdId, actorUserId)) {
    throw new Error("Only household parents can delete a child line");
  }
  const line = db.prepare(`SELECT * FROM lines WHERE id = ? AND household_id = ?`).get(lineId, householdId) as
    | Line
    | undefined;
  if (!line) {
    // Idempotent: scrub any dangling cross-hh refs for this id.
    wipeLineCascade(db, lineId, dataDir);
    return { ok: true, deleted: false, lineId };
  }
  if ((line.mode || "parent") !== "child") {
    throw new Error("Only child lines can be deleted here — switch Active line or use Account to leave");
  }
  const confirm = normalizeDeleteConfirm(opts?.confirm);
  if (!confirmMatchesDeleteToken(confirm, line.child_label, line.name)) {
    throw new Error("Type DELETE or the child’s name to confirm");
  }

  const { childUserId } = wipeLineCascade(db, lineId, dataDir);
  maybeDeleteOrphanUser(db, childUserId);
  console.log(
    `[audit] child line deleted by parent user_id=${actorUserId} line_id=${lineId} household_id=${householdId} at ${nowIso()}`
  );
  return { ok: true, deleted: true, lineId };
}

/**
 * Wipe an entire household: lines, allowlists, voicemails, invites, members, rules.
 * Does not delete parent user accounts (caller decides).
 */
export function wipeHouseholdCascade(
  db: Database.Database,
  householdId: string,
  dataDir: string
): { linesWiped: number } {
  const lines = db.prepare(`SELECT id FROM lines WHERE household_id = ?`).all(householdId) as { id: string }[];
  const childUserIds: string[] = [];
  for (const { id } of lines) {
    const { childUserId } = wipeLineCascade(db, id, dataDir);
    if (childUserId) childUserIds.push(childUserId);
  }

  const hhVms = db
    .prepare(`SELECT id, audio_path FROM voicemails WHERE household_id = ?`)
    .all(householdId) as { id: string; audio_path: string | null }[];
  for (const vm of hhVms) unlinkUnderDataDir(dataDir, vm.audio_path);
  db.prepare(`DELETE FROM voicemails WHERE household_id = ?`).run(householdId);

  db.prepare(`DELETE FROM allowlist WHERE household_id = ?`).run(householdId);
  db.prepare(`DELETE FROM allowlist_declined WHERE household_id = ?`).run(householdId);
  db.prepare(`DELETE FROM family_room_members WHERE household_id = ?`).run(householdId);
  db.prepare(`DELETE FROM family_room_talk_pairs WHERE household_id = ?`).run(householdId);
  db.prepare(`DELETE FROM invites WHERE from_household_id = ? OR redeemed_by_household_id = ?`).run(
    householdId,
    householdId
  );
  db.prepare(`DELETE FROM household_members WHERE household_id = ?`).run(householdId);
  db.prepare(`DELETE FROM households WHERE id = ?`).run(householdId);

  for (const uid of childUserIds) maybeDeleteOrphanUser(db, uid);
  return { linesWiped: lines.length };
}

/**
 * Parent deletes their own account. Hard delete — no soft retention.
 *
 * Household policy:
 * - Owned household with no other members → wipe household (all kids/lines/data).
 * - Owned household with other members → transfer ownership to another member, then leave.
 * - Member (non-owner) → leave household only.
 * - Guardian-only on other houses → drop guardianship rows.
 * Then delete sessions + user row.
 *
 * Confirm with "DELETE". Idempotent if the user row is already gone.
 */
export function deleteParentAccount(
  db: Database.Database,
  userId: string,
  dataDir: string,
  opts?: { confirm?: unknown }
): { ok: true; deleted: boolean; householdsWiped: string[] } {
  const confirm = normalizeDeleteConfirm(opts?.confirm);
  if (confirm.toUpperCase() !== "DELETE") {
    throw new Error("Type DELETE to confirm account deletion");
  }

  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as User | undefined;
  if (!user) {
    return { ok: true, deleted: false, householdsWiped: [] };
  }
  if (isChildOnlyAccount(db, userId)) {
    throw new Error("Child logins are removed when a parent deletes that kid’s line");
  }

  const householdsWiped: string[] = [];

  // Drop guardianship everywhere first (does not wipe other families’ kids).
  db.prepare(`DELETE FROM child_guardians WHERE user_id = ?`).run(userId);
  db.prepare(`DELETE FROM guardian_invites WHERE created_by = ? AND redeemed_by_user_id IS NULL`).run(userId);

  const owned = db
    .prepare(`SELECT id FROM households WHERE owner_user_id = ?`)
    .all(userId) as { id: string }[];
  for (const { id: hhId } of owned) {
    const others = db
      .prepare(`SELECT user_id FROM household_members WHERE household_id = ? AND user_id != ?`)
      .all(hhId, userId) as { user_id: string }[];
    if (others.length === 0) {
      wipeHouseholdCascade(db, hhId, dataDir);
      householdsWiped.push(hhId);
    } else {
      const nextOwner = others[0].user_id;
      db.prepare(`UPDATE households SET owner_user_id = ? WHERE id = ?`).run(nextOwner, hhId);
      db.prepare(
        `UPDATE household_members SET role = 'owner' WHERE household_id = ? AND user_id = ?`
      ).run(hhId, nextOwner);
      db.prepare(`DELETE FROM household_members WHERE household_id = ? AND user_id = ?`).run(hhId, userId);
    }
  }

  // Leave any remaining memberships (non-owned).
  db.prepare(`DELETE FROM household_members WHERE user_id = ?`).run(userId);

  // Orphan lines whose household is gone.
  const orphanLines = db
    .prepare(
      `SELECT id FROM lines WHERE owner_user_id = ? AND household_id NOT IN (SELECT id FROM households)`
    )
    .all(userId) as { id: string }[];
  for (const { id } of orphanLines) wipeLineCascade(db, id, dataDir);

  // Remaining lines owned inside a living household: reassign to household owner.
  const leftover = db.prepare(`SELECT id, household_id FROM lines WHERE owner_user_id = ?`).all(userId) as {
    id: string;
    household_id: string;
  }[];
  for (const row of leftover) {
    const hh = db.prepare(`SELECT owner_user_id FROM households WHERE id = ?`).get(row.household_id) as
      | { owner_user_id: string }
      | undefined;
    if (hh?.owner_user_id) {
      db.prepare(`UPDATE lines SET owner_user_id = ? WHERE id = ?`).run(hh.owner_user_id, row.id);
    }
  }

  db.prepare(`UPDATE lines SET child_user_id = NULL WHERE child_user_id = ?`).run(userId);

  // Drop this parent’s circle (members/access rows for the sphere id).
  const mySphere = db.prepare(`SELECT id FROM spheres WHERE owner_user_id = ?`).get(userId) as
    | { id: string }
    | undefined;
  if (mySphere) {
    db.prepare(`DELETE FROM line_sphere_access WHERE sphere_id = ?`).run(mySphere.id);
    db.prepare(`DELETE FROM sphere_members WHERE sphere_id = ?`).run(mySphere.id);
    db.prepare(`DELETE FROM spheres WHERE id = ?`).run(mySphere.id);
  }

  db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
  db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);

  console.log(
    `[audit] parent account deleted user_id=${userId} households_wiped=${householdsWiped.length} at ${nowIso()}`
  );
  return { ok: true, deleted: true, householdsWiped };
}

/** True when the recipient line has opt-in answering machine enabled. */
export function lineAnsweringMachineOn(db: Database.Database, lineId: string): boolean {
  const row = db.prepare(`SELECT answering_machine FROM lines WHERE id = ?`).get(lineId) as
    | { answering_machine: number }
    | undefined;
  return Boolean(row?.answering_machine);
}

export function createInvite(db: Database.Database, householdId: string, userId: string): Invite {
  if (!canCreateHouseholdInvite(db, userId, householdId)) {
    throw new Error("Only parents can invite family");
  }
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
  assertParentContactAdmin(db, userId);
  const invite = db.prepare(`SELECT * FROM invites WHERE code = ?`).get(code.trim()) as Invite | undefined;
  if (!invite) throw new Error("Invite not found");
  if (invite.redeemed_by_household_id) throw new Error("Invite already used");
  if (invite.expires_at < nowIso()) throw new Error("Invite expired");

  const household = createHousehold(db, userId, householdName);
  db.prepare(`UPDATE invites SET redeemed_by_household_id = ? WHERE id = ?`).run(household.id, invite.id);

  // Lines appear later; syncLineIntoSpheres bridges both circles when softphones are created.
  return { invite: { ...invite, redeemed_by_household_id: household.id }, household };
}

export function addAllowlist(
  db: Database.Database,
  householdId: string,
  targetLineId: string,
  label: string,
  opts: {
    speedDial?: number | null;
    favorite?: boolean;
    alwaysAllow?: boolean;
    /** Parent whose circle receives this contact (defaults to household owner). */
    actorUserId?: string;
  } = {}
): AllowlistEntry {
  if (opts.actorUserId) assertParentContactAdmin(db, opts.actorUserId);
  const target = db
    .prepare(`SELECT id, household_id, name, mode FROM lines WHERE id = ?`)
    .get(targetLineId) as
    | { id: string; household_id: string; name: string; mode: string | null }
    | undefined;
  if (!target) throw new Error("Unknown line");
  const hhOwner = db
    .prepare(`SELECT owner_user_id FROM households WHERE id = ?`)
    .get(householdId) as { owner_user_id: string } | undefined;
  const reviewActor = opts.actorUserId || hhOwner?.owner_user_id;
  if (reviewActor) assertTestReviewMayContactLine(db, reviewActor, targetLineId);
  // Same-household lines (parent ↔ child) may be on the allowlist for speed dial.
  // Softphones must still hide/reject the active line itself (UI + canCall).
  const used = db
    .prepare(`SELECT speed_dial FROM allowlist WHERE household_id = ? AND speed_dial IS NOT NULL`)
    .all(householdId) as { speed_dial: number }[];
  const taken = new Set(used.map((u) => u.speed_dial));
  let speed = opts.speedDial ?? null;
  const secondary = householdSecondaryParentLine(db, householdId);
  // Pads 0–1 are reserved (TreeHouse + locked parent/child). Slot 2 is reserved
  // only when a second parent-mode line exists. Contacts otherwise use 2–9.
  if (speed === 0 || speed === 1) {
    throw new Error("Speed dial 0 is TreeHouse and 1 is locked — pick 2–9 for contacts");
  }
  if (speed != null && (speed < 2 || speed > 9)) {
    throw new Error("Speed dial must be 2–9 (0 is TreeHouse; 1 is locked parent/child)");
  }
  if (speed === 2 && secondary) {
    throw new Error("Speed dial 2 is reserved for the co-parent — pick 3–9");
  }
  if (speed == null) {
    const sameHhChild =
      target.household_id === householdId && (target.mode || "parent") === "child";
    // Prefer slot 2 for a household kid when no co-parent is reserving it.
    if (sameHhChild && !taken.has(2) && !secondary) {
      speed = 2;
    } else {
      const start = secondary ? 3 : 2;
      for (let i = start; i <= 9; i++) {
        if (!taken.has(i)) {
          speed = i;
          break;
        }
      }
      if (speed == null) {
        for (let i = 2; i <= 9; i++) {
          if (!taken.has(i)) {
            speed = i;
            break;
          }
        }
      }
    }
  }
  let cleanLabel = label.trim() || "Friend";
  if (/^contact$/i.test(cleanLabel)) {
    cleanLabel =
      (target.name || "Friend").replace(/'s phone$/i, "").replace(/\s+phone$/i, "").trim() || "Friend";
  }
  const entry: AllowlistEntry = {
    id: newId("al"),
    household_id: householdId,
    target_line_id: targetLineId,
    label: cleanLabel,
    speed_dial: speed,
    favorite: opts.favorite === false ? 0 : 1,
    always_allow: opts.alwaysAllow ? 1 : 0,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT OR REPLACE INTO allowlist (id, household_id, target_line_id, label, speed_dial, favorite, always_allow, created_at)
     VALUES (@id, @household_id, @target_line_id, @label, @speed_dial, @favorite, @always_allow, @created_at)`
  ).run(entry);
  db.prepare(`DELETE FROM allowlist_declined WHERE household_id = ? AND target_line_id = ?`).run(
    householdId,
    targetLineId
  );

  // Approving a contact puts them in the acting parent’s circle (not a global directory).
  const hh = db.prepare(`SELECT owner_user_id FROM households WHERE id = ?`).get(householdId) as
    | { owner_user_id: string }
    | undefined;
  const actor = opts.actorUserId || hh?.owner_user_id;
  if (actor) {
    assertParentContactAdmin(db, actor);
    addContactToParentSphere(db, actor, targetLineId);
  }
  return entry;
}

export function declineAllowlist(
  db: Database.Database,
  householdId: string,
  targetLineId: string
): { ok: true } {
  if (!targetLineId) throw new Error("targetLineId required");
  const line = db.prepare(`SELECT id FROM lines WHERE id = ?`).get(targetLineId);
  if (!line) throw new Error("Unknown line");
  // Don't leave them on the allowlist if somehow present
  db.prepare(`DELETE FROM allowlist WHERE household_id = ? AND target_line_id = ?`).run(
    householdId,
    targetLineId
  );
  db.prepare(
    `INSERT OR REPLACE INTO allowlist_declined (household_id, target_line_id, created_at)
     VALUES (?, ?, ?)`
  ).run(householdId, targetLineId, nowIso());
  return { ok: true };
}

export function listDeclinedLineIds(db: Database.Database, householdId: string): string[] {
  const rows = db
    .prepare(`SELECT target_line_id FROM allowlist_declined WHERE household_id = ?`)
    .all(householdId) as { target_line_id: string }[];
  return rows.map((r) => r.target_line_id);
}

export type FamilyRoomMemberRow = {
  line_id: string;
  approved_by_user_id: string | null;
  created_at: string;
  name: string;
  child_label: string | null;
  mode: string;
  online: number;
  household_id: string;
};

/** Softphone mesh cap for FamilyRoom (analog FXS not in the mesh yet). */
export const MAX_FAMILY_ROOM = 8;

export function listFamilyRoomMembers(
  db: Database.Database,
  householdId: string
): FamilyRoomMemberRow[] {
  return db
    .prepare(
      `SELECT frm.line_id, frm.approved_by_user_id, frm.created_at,
              l.name, l.child_label, IFNULL(l.mode, 'parent') AS mode, l.online, l.household_id
       FROM family_room_members frm
       JOIN lines l ON l.id = frm.line_id
       WHERE frm.household_id = ?
       ORDER BY lower(COALESCE(NULLIF(l.child_label, ''), l.name))`
    )
    .all(householdId) as FamilyRoomMemberRow[];
}

/** Explicit allowlist row only (not admin always-allow). */
export function isFamilyRoomMember(
  db: Database.Database,
  householdId: string,
  lineId: string
): boolean {
  return Boolean(
    db
      .prepare(`SELECT 1 FROM family_room_members WHERE household_id = ? AND line_id = ?`)
      .get(householdId, lineId)
  );
}

/**
 * Always allowed to *join* this household’s FamilyRoom (no allowlist row):
 * - Child lines that live in this household (kid hangout)
 * Parents are not auto-talkers — they use listen-only (see familyroom.listen.*).
 * Does NOT grant entry into other households’ FamilyRooms (external contacts still need approve).
 */
export function isFamilyRoomAdminAlwaysAllowed(
  db: Database.Database,
  householdId: string,
  lineId: string
): boolean {
  const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line | undefined;
  if (!line || line.household_id !== householdId) return false;
  return (line.mode || "parent") === "child";
}

/** Join / pad gate: explicit member OR household kid always-allow. */
export function canJoinFamilyRoom(
  db: Database.Database,
  householdId: string,
  lineId: string
): boolean {
  return (
    isFamilyRoomMember(db, householdId, lineId) ||
    isFamilyRoomAdminAlwaysAllowed(db, householdId, lineId)
  );
}

/** Household kid lines that are always allowed to join this FamilyRoom. */
export function listFamilyRoomAlwaysAllowedLineIds(
  db: Database.Database,
  householdId: string
): string[] {
  const rows = db
    .prepare(
      `SELECT id FROM lines
       WHERE household_id = ? AND IFNULL(mode, 'parent') = 'child'
       ORDER BY created_at ASC, id ASC`
    )
    .all(householdId) as { id: string }[];
  return rows.map((r) => r.id);
}

function orderedTalkPair(lineA: string, lineB: string): [string, string] | null {
  if (!lineA || !lineB || lineA === lineB) return null;
  return lineA < lineB ? [lineA, lineB] : [lineB, lineA];
}

export type FamilyRoomTalkPairRow = {
  line_a: string;
  line_b: string;
  approved_by_user_id: string | null;
  created_at: string;
};

export function listFamilyRoomTalkPairs(
  db: Database.Database,
  householdId: string
): FamilyRoomTalkPairRow[] {
  return db
    .prepare(
      `SELECT line_a, line_b, approved_by_user_id, created_at
       FROM family_room_talk_pairs WHERE household_id = ?
       ORDER BY line_a, line_b`
    )
    .all(householdId) as FamilyRoomTalkPairRow[];
}

function hasExplicitTalkPair(
  db: Database.Database,
  householdId: string,
  lineA: string,
  lineB: string
): boolean {
  const ordered = orderedTalkPair(lineA, lineB);
  if (!ordered) return false;
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM family_room_talk_pairs
         WHERE household_id = ? AND line_a = ? AND line_b = ?`
      )
      .get(householdId, ordered[0], ordered[1])
  );
}

/** Both ends are kid lines that live in this household (default sibling hangout). */
function bothHouseholdKids(
  db: Database.Database,
  householdId: string,
  lineA: string,
  lineB: string
): boolean {
  const rows = db
    .prepare(
      `SELECT id FROM lines
       WHERE household_id = ? AND IFNULL(mode, 'parent') = 'child' AND id IN (?, ?)`
    )
    .all(householdId, lineA, lineB) as { id: string }[];
  return rows.length === 2;
}

/**
 * Symmetric talk gate for FamilyRoom audio: A hears B iff B hears A.
 * - Explicit undirected pair, OR
 * - Both are kids of this household (default hangout; parents wire externals explicitly)
 */
export function canTalkInFamilyRoom(
  db: Database.Database,
  householdId: string,
  lineA: string,
  lineB: string
): boolean {
  if (!lineA || !lineB || lineA === lineB) return false;
  if (!canJoinFamilyRoom(db, householdId, lineA) || !canJoinFamilyRoom(db, householdId, lineB)) {
    return false;
  }
  if (hasExplicitTalkPair(db, householdId, lineA, lineB)) return true;
  return bothHouseholdKids(db, householdId, lineA, lineB);
}

/** Line ids in the room this line may exchange audio with (symmetric). */
export function familyRoomTalkPeers(
  db: Database.Database,
  householdId: string,
  lineId: string,
  memberIds: string[]
): string[] {
  return memberIds.filter((other) => canTalkInFamilyRoom(db, householdId, lineId, other));
}

/**
 * Parent-only: create undirected talk edge (A↔B). Both lines must be join-eligible.
 * Same-household kids already talk by default — explicit pairs are for externals / overrides.
 */
export function addFamilyRoomTalkPair(
  db: Database.Database,
  householdId: string,
  lineA: string,
  lineB: string,
  actorUserId: string
): FamilyRoomTalkPairRow {
  assertParentContactAdmin(db, actorUserId);
  if (!canManageHouseholdChildState(db, actorUserId, householdId)) {
    throw new Error("Only parents can manage TreeHouse talk");
  }
  const ordered = orderedTalkPair(lineA, lineB);
  if (!ordered) throw new Error("Pick two different lines");
  if (!canJoinFamilyRoom(db, householdId, ordered[0])) {
    throw new Error("Approve both people for TreeHouse before linking talk");
  }
  if (!canJoinFamilyRoom(db, householdId, ordered[1])) {
    throw new Error("Approve both people for TreeHouse before linking talk");
  }
  db.prepare(
    `INSERT OR REPLACE INTO family_room_talk_pairs
       (household_id, line_a, line_b, approved_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(householdId, ordered[0], ordered[1], actorUserId, nowIso());
  const row = listFamilyRoomTalkPairs(db, householdId).find(
    (p) => p.line_a === ordered[0] && p.line_b === ordered[1]
  );
  if (!row) throw new Error("Could not save talk pair");
  return row;
}

export function removeFamilyRoomTalkPair(
  db: Database.Database,
  householdId: string,
  lineA: string,
  lineB: string,
  actorUserId: string
): { ok: true } {
  assertParentContactAdmin(db, actorUserId);
  if (!canManageHouseholdChildState(db, actorUserId, householdId)) {
    throw new Error("Only parents can manage TreeHouse talk");
  }
  const ordered = orderedTalkPair(lineA, lineB);
  if (!ordered) throw new Error("Pick two different lines");
  if (bothHouseholdKids(db, householdId, ordered[0], ordered[1])) {
    throw new Error("Household kids can always talk in TreeHouse — no pair to remove");
  }
  db.prepare(
    `DELETE FROM family_room_talk_pairs WHERE household_id = ? AND line_a = ? AND line_b = ?`
  ).run(householdId, ordered[0], ordered[1]);
  return { ok: true };
}

/**
 * Parent-only: approve a line for FamilyRoom (explicit — not the same as contact approve).
 * Same-household softphones, or already-allowlisted contacts.
 */
export function addFamilyRoomMember(
  db: Database.Database,
  householdId: string,
  lineId: string,
  actorUserId: string
): FamilyRoomMemberRow {
  assertParentContactAdmin(db, actorUserId);
  if (!canManageHouseholdChildState(db, actorUserId, householdId)) {
    throw new Error("Only parents can manage TreeHouse");
  }
  const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line | undefined;
  if (!line) throw new Error("Unknown line");

  if (isFamilyRoomAdminAlwaysAllowed(db, householdId, lineId)) {
    throw new Error("Household kids are always in TreeHouse — no need to approve");
  }

  if (line.household_id !== householdId) {
    const onAllowlist = db
      .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
      .get(householdId, lineId);
    if (!onAllowlist) {
      throw new Error("Approve them as a contact before adding to TreeHouse");
    }
  }

  const existing = listFamilyRoomMembers(db, householdId);
  if (existing.length >= MAX_FAMILY_ROOM && !existing.some((m) => m.line_id === lineId)) {
    throw new Error(`TreeHouse is limited to ${MAX_FAMILY_ROOM} people`);
  }

  db.prepare(
    `INSERT OR REPLACE INTO family_room_members (household_id, line_id, approved_by_user_id, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(householdId, lineId, actorUserId, nowIso());

  const row = listFamilyRoomMembers(db, householdId).find((m) => m.line_id === lineId);
  if (!row) throw new Error("Could not add to TreeHouse");
  return row;
}

export function removeFamilyRoomMember(
  db: Database.Database,
  householdId: string,
  lineId: string,
  actorUserId: string
): { ok: true } {
  assertParentContactAdmin(db, actorUserId);
  if (!canManageHouseholdChildState(db, actorUserId, householdId)) {
    throw new Error("Only parents can manage TreeHouse");
  }
  if (isFamilyRoomAdminAlwaysAllowed(db, householdId, lineId)) {
    throw new Error("Household kids stay in TreeHouse — cannot remove");
  }
  db.prepare(`DELETE FROM family_room_members WHERE household_id = ? AND line_id = ?`).run(
    householdId,
    lineId
  );
  db.prepare(
    `DELETE FROM family_room_talk_pairs
     WHERE household_id = ? AND (line_a = ? OR line_b = ?)`
  ).run(householdId, lineId, lineId);
  return { ok: true };
}

/** Lines a parent can toggle into FamilyRoom (household softphones + allowlisted contacts). */
export function familyRoomCandidateLines(
  db: Database.Database,
  householdId: string
): { line_id: string; name: string; child_label: string | null; mode: string; kind: string }[] {
  const hhLines = db
    .prepare(
      `SELECT id AS line_id, name, child_label, IFNULL(mode, 'parent') AS mode, 'household' AS kind
       FROM lines WHERE household_id = ? ORDER BY created_at`
    )
    .all(householdId) as {
    line_id: string;
    name: string;
    child_label: string | null;
    mode: string;
    kind: string;
  }[];
  const external = db
    .prepare(
      `SELECT a.target_line_id AS line_id, COALESCE(NULLIF(a.label, ''), l.name) AS name,
              l.child_label, IFNULL(l.mode, 'parent') AS mode, 'contact' AS kind
       FROM allowlist a
       JOIN lines l ON l.id = a.target_line_id
       WHERE a.household_id = ? AND l.household_id != ?
       ORDER BY lower(COALESCE(NULLIF(a.label, ''), l.name))`
    )
    .all(householdId, householdId) as {
    line_id: string;
    name: string;
    child_label: string | null;
    mode: string;
    kind: string;
  }[];
  const seen = new Set<string>();
  const out: typeof hhLines = [];
  for (const row of [...hhLines, ...external]) {
    if (seen.has(row.line_id)) continue;
    seen.add(row.line_id);
    out.push(row);
  }
  return out;
}

export type ParentTitle = "mom" | "dad" | null;
export type ProfileRole = "parent" | "grandparent" | null;

export function normalizeParentTitle(raw: unknown): ParentTitle {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v === "mom" || v === "dad") return v;
  return null;
}

export function normalizeProfileRole(raw: unknown): ProfileRole {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v === "parent" || v === "grandparent") return v;
  return null;
}

export function updateUserProfile(
  db: Database.Database,
  userId: string,
  patch: {
    parent_title?: ParentTitle | "" | null;
    profile_role?: ProfileRole | "" | null;
  }
): User {
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as User | undefined;
  if (!user) throw new Error("User not found");
  if (patch.parent_title !== undefined) {
    const title =
      patch.parent_title === "" || patch.parent_title === null
        ? null
        : normalizeParentTitle(patch.parent_title);
    db.prepare(`UPDATE users SET parent_title = ? WHERE id = ?`).run(title, userId);
    syncParentTitleAllowlistLabels(db, userId);
  }
  if (patch.profile_role !== undefined) {
    const role =
      patch.profile_role === "" || patch.profile_role === null
        ? null
        : normalizeProfileRole(patch.profile_role);
    db.prepare(`UPDATE users SET profile_role = ? WHERE id = ?`).run(role, userId);
  }
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as User;
}

/**
 * When a parent picks Mom/Dad, rewrite allowlist nicknames that still show their
 * personal name so kids’ pads / FXS CID match the title.
 */
function syncParentTitleAllowlistLabels(db: Database.Database, userId: string): void {
  const parentLines = db
    .prepare(
      `SELECT id, household_id, name, child_label FROM lines
       WHERE owner_user_id = ? AND IFNULL(mode, 'parent') != 'child'`
    )
    .all(userId) as { id: string; household_id: string; name: string; child_label: string | null }[];
  if (!parentLines.length) return;
  const titled = parentDisplayLabel(db, parentLines[0]!.id);
  if (titled !== "Mom" && titled !== "Dad") return;
  const user = db.prepare(`SELECT display_name FROM users WHERE id = ?`).get(userId) as
    | { display_name: string }
    | undefined;
  const aliases = new Set<string>();
  const addAlias = (raw: string | null | undefined) => {
    const cleaned = String(raw || "")
      .replace(/'s phone$/i, "")
      .replace(/\s+phone$/i, "")
      .trim()
      .toLowerCase();
    if (!cleaned) return;
    aliases.add(cleaned);
    const first = cleaned.split(/\s+/)[0];
    if (first) aliases.add(first);
  };
  addAlias(user?.display_name);
  for (const l of parentLines) {
    addAlias(l.name);
    addAlias(l.child_label);
  }
  const upd = db.prepare(`UPDATE allowlist SET label = ? WHERE id = ?`);
  for (const line of parentLines) {
    const rows = db
      .prepare(`SELECT id, label FROM allowlist WHERE target_line_id = ?`)
      .all(line.id) as { id: string; label: string }[];
    for (const row of rows) {
      const cur = String(row.label || "")
        .replace(/'s phone$/i, "")
        .replace(/\s+phone$/i, "")
        .trim()
        .toLowerCase();
      if (!cur || cur === titled.toLowerCase()) continue;
      if (aliases.has(cur) || cur === "contact") upd.run(titled, row.id);
    }
  }
}

function lastNameFromDisplay(displayName: string | null | undefined): string {
  const parts = String(displayName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : "";
}

function userLastName(db: Database.Database, userId: string): string {
  const user = db.prepare(`SELECT display_name FROM users WHERE id = ?`).get(userId) as
    | { display_name: string }
    | undefined;
  return lastNameFromDisplay(user?.display_name);
}

/** Slot 2: other parent’s last name; Mom/Dad if they share the household name and chose a title. */
function familyRoomOtherParentLabel(
  db: Database.Database,
  parentLine: Line,
  slot1Label: string
): string {
  const last = userLastName(db, parentLine.owner_user_id);
  const slot1 = String(slot1Label || "").trim().toLowerCase();
  if (last && last.toLowerCase() !== slot1) return last;
  const title = parentDisplayLabel(db, parentLine.id);
  if (title === "Mom" || title === "Dad") return title;
  return last || title || "Family";
}

function householdNameLabel(db: Database.Database, householdId: string): string {
  const hh = db.prepare(`SELECT name FROM households WHERE id = ?`).get(householdId) as
    | { name: string }
    | undefined;
  return (hh?.name || "Family").trim() || "Family";
}

/** Mom / Dad / line label for parent-mode lines. */
export function parentDisplayLabel(
  db: Database.Database,
  lineId: string,
  fallback?: string
): string {
  const line = db.prepare(`SELECT owner_user_id, child_label, name FROM lines WHERE id = ?`).get(lineId) as
    | { owner_user_id: string; child_label: string | null; name: string }
    | undefined;
  if (!line) return fallback || "Parent";
  const user = db.prepare(`SELECT display_name, parent_title FROM users WHERE id = ?`).get(line.owner_user_id) as
    | { display_name: string; parent_title: string | null }
    | undefined;
  if (user?.parent_title === "mom") return "Mom";
  if (user?.parent_title === "dad") return "Dad";
  return fallback || line.child_label || line.name || user?.display_name || "Parent";
}

/** Parent-mode lines in a household, oldest first. */
export function listHouseholdParentLines(db: Database.Database, householdId: string): Line[] {
  const rows = db
    .prepare(
      `SELECT * FROM lines
       WHERE household_id = ?
         AND IFNULL(mode, 'parent') != 'child'
       ORDER BY created_at ASC, id ASC`
    )
    .all(householdId) as Line[];
  return rows.map(normalizeLine);
}

/** Household admin parent line: owner’s parent line, else first parent line. */
export function householdAdminParentLine(
  db: Database.Database,
  householdId: string
): Line | null {
  const parents = listHouseholdParentLines(db, householdId);
  if (!parents.length) return null;
  const hh = db.prepare(`SELECT owner_user_id FROM households WHERE id = ?`).get(householdId) as
    | { owner_user_id: string }
    | undefined;
  if (hh?.owner_user_id) {
    const ownerLine = parents.find((l) => l.owner_user_id === hh.owner_user_id);
    if (ownerLine) return ownerLine;
  }
  return parents[0] ?? null;
}

/** Second parent-mode line in the household (by created_at), excluding admin. */
export function householdSecondaryParentLine(
  db: Database.Database,
  householdId: string
): Line | null {
  const admin = householdAdminParentLine(db, householdId);
  const parents = listHouseholdParentLines(db, householdId);
  return parents.find((l) => l.id !== admin?.id) ?? null;
}

export type AdultFamilyRoomMemberRow = {
  line_id: string;
  approved_by_user_id: string | null;
  created_at: string;
  name: string;
  child_label: string | null;
  mode: string;
  online: number;
  household_id: string;
};

export function listAdultFamilyRoomMembers(
  db: Database.Database,
  householdId: string
): AdultFamilyRoomMemberRow[] {
  return db
    .prepare(
      `SELECT afrm.line_id, afrm.approved_by_user_id, afrm.created_at,
              l.name, l.child_label, IFNULL(l.mode, 'parent') AS mode, l.online, l.household_id
       FROM adult_family_room_members afrm
       JOIN lines l ON l.id = afrm.line_id
       WHERE afrm.household_id = ?
       ORDER BY lower(COALESCE(NULLIF(l.child_label, ''), l.name))`
    )
    .all(householdId) as AdultFamilyRoomMemberRow[];
}

/** FamilyRoom has no auto-members — kids and adults both need household-admin approve. */
export function isAdultFamilyRoomAlwaysAllowed(
  _db: Database.Database,
  _householdId: string,
  _lineId: string
): boolean {
  return false;
}

export function canJoinAdultFamilyRoom(
  db: Database.Database,
  householdId: string,
  lineId: string
): boolean {
  const line = db.prepare(`SELECT 1 FROM lines WHERE id = ?`).get(lineId);
  if (!line) return false;
  return Boolean(
    db
      .prepare(`SELECT 1 FROM adult_family_room_members WHERE household_id = ? AND line_id = ?`)
      .get(householdId, lineId)
  );
}

export function adultFamilyRoomCandidateLines(
  db: Database.Database,
  householdId: string
): { line_id: string; name: string; child_label: string | null; mode: string; kind: string }[] {
  const hhLines = db
    .prepare(
      `SELECT id AS line_id, name, child_label, IFNULL(mode, 'parent') AS mode, 'household' AS kind
       FROM lines
       WHERE household_id = ?
       ORDER BY created_at`
    )
    .all(householdId) as {
    line_id: string;
    name: string;
    child_label: string | null;
    mode: string;
    kind: string;
  }[];
  const external = db
    .prepare(
      `SELECT a.target_line_id AS line_id, COALESCE(NULLIF(a.label, ''), l.name) AS name,
              l.child_label, IFNULL(l.mode, 'parent') AS mode, 'contact' AS kind
       FROM allowlist a
       JOIN lines l ON l.id = a.target_line_id
       WHERE a.household_id = ? AND l.household_id != ?
       ORDER BY lower(COALESCE(NULLIF(a.label, ''), l.name))`
    )
    .all(householdId, householdId) as {
    line_id: string;
    name: string;
    child_label: string | null;
    mode: string;
    kind: string;
  }[];
  const seen = new Set<string>();
  const out: typeof hhLines = [];
  for (const row of [...hhLines, ...external]) {
    if (seen.has(row.line_id)) continue;
    seen.add(row.line_id);
    out.push(row);
  }
  return out;
}

export function addAdultFamilyRoomMember(
  db: Database.Database,
  householdId: string,
  lineId: string,
  actorUserId: string
): AdultFamilyRoomMemberRow {
  if (!isHouseholdOwner(db, householdId, actorUserId)) {
    throw new Error("Only the household admin can manage FamilyRoom");
  }
  const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line | undefined;
  if (!line) throw new Error("Unknown line");
  if (line.household_id !== householdId) {
    const onAllowlist = db
      .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
      .get(householdId, lineId);
    if (!onAllowlist) {
      throw new Error("Approve them as a contact before adding to FamilyRoom");
    }
  }
  db.prepare(
    `INSERT OR REPLACE INTO adult_family_room_members (household_id, line_id, approved_by_user_id, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(householdId, lineId, actorUserId, nowIso());
  const row = listAdultFamilyRoomMembers(db, householdId).find((m) => m.line_id === lineId);
  if (!row) throw new Error("Could not add to FamilyRoom");
  return row;
}

export function removeAdultFamilyRoomMember(
  db: Database.Database,
  householdId: string,
  lineId: string,
  actorUserId: string
): { ok: true } {
  if (!isHouseholdOwner(db, householdId, actorUserId)) {
    throw new Error("Only the household admin can manage FamilyRoom");
  }
  db.prepare(`DELETE FROM adult_family_room_members WHERE household_id = ? AND line_id = ?`).run(
    householdId,
    lineId
  );
  return { ok: true };
}

export type FamilyRoomChoice = {
  slot: 1 | 2;
  householdId: string;
  label: string;
};

/**
 * Up to two FamilyRoom targets for # IVR.
 * 1 = default parent household name (e.g. Larsen).
 * 2 = other parent’s last name, or another household this line is approved for.
 */
export function listFamilyRoomChoicesForLine(
  db: Database.Database,
  lineId: string
): FamilyRoomChoice[] {
  const line = db.prepare(`SELECT household_id FROM lines WHERE id = ?`).get(lineId) as
    | { household_id: string }
    | undefined;
  if (!line) return [];

  const ownHhId = line.household_id;
  const choices: FamilyRoomChoice[] = [];
  if (canJoinAdultFamilyRoom(db, ownHhId, lineId)) {
    choices.push({ slot: 1, householdId: ownHhId, label: householdNameLabel(db, ownHhId) });
  }

  const otherApproved = (
    db
      .prepare(
        `SELECT household_id FROM adult_family_room_members
         WHERE line_id = ? AND household_id != ?
         ORDER BY created_at ASC`
      )
      .all(lineId, ownHhId) as { household_id: string }[]
  ).filter((row) => canJoinAdultFamilyRoom(db, row.household_id, lineId));

  if (otherApproved[0]) {
    const otherId = otherApproved[0].household_id;
    const slot1 = choices[0]?.label || householdNameLabel(db, otherId);
    const admin = householdAdminParentLine(db, otherId);
    const label = admin
      ? familyRoomOtherParentLabel(db, admin, slot1)
      : householdNameLabel(db, otherId);
    if (!choices.length) {
      choices.push({ slot: 1, householdId: otherId, label: householdNameLabel(db, otherId) });
    } else {
      choices.push({ slot: 2, householdId: otherId, label });
    }
  } else if (choices.length === 1) {
    const secondary = householdSecondaryParentLine(db, ownHhId);
    if (secondary) {
      choices.push({
        slot: 2,
        householdId: ownHhId,
        label: familyRoomOtherParentLabel(db, secondary, choices[0].label),
      });
    }
  }
  return choices.slice(0, 2);
}

export function updateAllowlistEntry(
  db: Database.Database,
  householdId: string,
  entryId: string,
  patch: {
    label?: string;
    speed_dial?: number | null;
    favorite?: boolean;
    always_allow?: boolean;
  }
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
    always_allow: patch.always_allow === undefined ? entry.always_allow || 0 : patch.always_allow ? 1 : 0,
  };
  // Slots 0–1 reserved (TreeHouse + locked parent/child). Slot 2 is reserved
  // only when a second parent exists. Contacts otherwise use 2–9.
  if (next.speed_dial != null && (next.speed_dial < 2 || next.speed_dial > 9 || next.speed_dial === 0 || next.speed_dial === 1)) {
    throw new Error("Speed dial must be 2–9 (0 is TreeHouse; 1 is locked parent/child)");
  }
  if (patch.speed_dial === 2 && householdSecondaryParentLine(db, householdId)) {
    throw new Error("Speed dial 2 is reserved for the co-parent — pick 3–9");
  }
  const tx = db.transaction(() => {
    if (patch.speed_dial !== undefined && next.speed_dial != null) {
      const occupant = db
        .prepare(
          `SELECT * FROM allowlist WHERE household_id = ? AND speed_dial = ? AND id != ?`
        )
        .get(householdId, next.speed_dial, entryId) as AllowlistEntry | undefined;
      if (occupant) {
        // Swap: destination contact takes the mover's previous slot (or clears).
        db.prepare(`UPDATE allowlist SET speed_dial = ? WHERE id = ?`).run(
          entry.speed_dial,
          occupant.id
        );
      }
    }
    db.prepare(
      `UPDATE allowlist SET label = @label, speed_dial = @speed_dial, favorite = @favorite, always_allow = @always_allow WHERE id = @id`
    ).run(next);
  });
  tx();
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
  if (!HHMM.test(value)) throw new Error("Quiet Time must be HH:MM (24-hour)");
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
  {
    quiet_start: string | null;
    quiet_end: string | null;
    label: string;
    quiet_days?: string | null;
    skip_holidays?: number;
  }
> = {
  open: { quiet_start: null, quiet_end: null, label: "Open", quiet_days: null, skip_holidays: 0 },
  bedtime: {
    quiet_start: "20:00",
    quiet_end: "07:00",
    label: "Bedtime",
    quiet_days: null,
    skip_holidays: 0,
  },
  school: {
    quiet_start: "08:00",
    quiet_end: "15:30",
    label: "School",
    quiet_days: "1,2,3,4,5",
    skip_holidays: 1,
  },
  custom: { quiet_start: null, quiet_end: null, label: "Custom" },
};

const PARENT_SCHEDULE_PRESETS: Record<
  string,
  {
    quiet_start: string | null;
    quiet_end: string | null;
    label: string;
    quiet_days?: string | null;
  }
> = {
  open: { quiet_start: null, quiet_end: null, label: "Ring anytime", quiet_days: null },
  evenings: {
    quiet_start: "21:00",
    quiet_end: "07:00",
    label: "Evenings",
    quiet_days: null,
  },
  custom: { quiet_start: null, quiet_end: null, label: "Custom" },
};

export type QuietPolicy = Pick<
  Household,
  "quiet_start" | "quiet_end" | "quiet_tz" | "quiet_days" | "skip_holidays" | "schedule_preset"
>;

export function lineModeOf(line: { mode?: string | null }): "parent" | "child" {
  return line.mode === "child" ? "child" : "parent";
}

/** Kid lines use household bedtime/school; parent lines use parent DND only. */
export function quietPolicyForLine(line: { mode?: string | null }, hh: Household): QuietPolicy {
  if (lineModeOf(line) === "child") {
    return {
      quiet_start: hh.quiet_start,
      quiet_end: hh.quiet_end,
      quiet_tz: hh.quiet_tz,
      quiet_days: hh.quiet_days,
      skip_holidays: hh.skip_holidays,
      schedule_preset: hh.schedule_preset,
    };
  }
  return {
    quiet_start: hh.parent_quiet_start,
    quiet_end: hh.parent_quiet_end,
    quiet_tz: hh.parent_quiet_tz || hh.quiet_tz,
    quiet_days: hh.parent_quiet_days,
    skip_holidays: 0,
    schedule_preset: hh.parent_schedule_preset || "open",
  };
}

/** Parse quiet_days "1,2,3,4,5" → Set of ISO weekdays Mon=1 … Sun=7. Empty = all days. */
export function parseQuietDays(raw: string | null | undefined): Set<number> | null {
  if (raw == null || String(raw).trim() === "") return null;
  const days = new Set<number>();
  for (const part of String(raw).split(",")) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n >= 1 && n <= 7) days.add(n);
  }
  return days.size ? days : null;
}

export function normalizeQuietDays(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (Array.isArray(raw)) {
    const days = [
      ...new Set(
        raw
          .map((x) => Number(x))
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
      ),
    ].sort((a, b) => a - b);
    return days.length ? days.join(",") : null;
  }
  const parsed = parseQuietDays(String(raw));
  if (!parsed) return null;
  return [...parsed].sort((a, b) => a - b).join(",");
}

/** Local ISO weekday Mon=1 … Sun=7 in an IANA timezone. */
export function localIsoWeekday(date: Date, timeZone: string): number {
  const dayKey = calendarDayKey(date, timeZone);
  const [y, m, d] = dayKey.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
  return dow === 0 ? 7 : dow;
}

/**
 * Full quiet-hours gate: time window + optional Mon–Fri days + US federal holiday skip.
 */
export function isQuietHoursActive(
  hh: Pick<
    Household,
    "quiet_start" | "quiet_end" | "quiet_tz" | "quiet_days" | "skip_holidays" | "schedule_preset"
  >,
  date = new Date()
): boolean {
  if (!isInQuietWindow(hh.quiet_start, hh.quiet_end, hh.quiet_tz, date)) return false;
  const tz = hh.quiet_tz!;
  const days = parseQuietDays(hh.quiet_days);
  if (days) {
    const wd = localIsoWeekday(date, tz);
    if (!days.has(wd)) return false;
  }
  if (hh.skip_holidays) {
    const dayKey = calendarDayKey(date, tz);
    if (isUsFederalHoliday(dayKey)) return false;
  }
  return true;
}

/** Classify which spoken prompt to use for an active quiet-hours block. */
export function quietHoursVoice(
  hh: Pick<Household, "schedule_preset" | "quiet_start" | "quiet_end">
): UnavailableVoice {
  const preset = String(hh.schedule_preset || "");
  if (preset === "school") return "school";
  if (preset === "bedtime") return "bedtime";
  // Overnight custom window (e.g. 21:00–07:00) → “until tomorrow”
  if (hh.quiet_start && hh.quiet_end) {
    try {
      const start = parseHhMm(hh.quiet_start);
      const end = parseHhMm(hh.quiet_end);
      const startM = start.h * 60 + start.m;
      const endM = end.h * 60 + end.m;
      if (startM > endM) return "bedtime";
    } catch {
      /* fall through */
    }
  }
  return "quiet";
}

export function hashPin(pin: string): string {
  return createHash("sha256").update(`kl-pin:${String(pin).trim()}`).digest("hex");
}

export function normalizePin(pin: unknown): string {
  return String(pin ?? "").trim();
}

export function verifyParentPin(hh: Household, pin: string): boolean {
  if (!hh?.parent_pin_hash) return true;
  const cleaned = normalizePin(pin);
  if (!cleaned) return false;
  return safeEqualHex(hh.parent_pin_hash, hashPin(cleaned));
}

export function userInHousehold(db: Database.Database, householdId: string, userId: string): boolean {
  return Boolean(
    db
      .prepare(`SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?`)
      .get(householdId, userId)
  );
}

export function publicHousehold(hh: Household): Omit<Household, "parent_pin_hash"> & {
  has_parent_pin: boolean;
} {
  const { parent_pin_hash, ...safe } = hh;
  return { ...safe, has_parent_pin: Boolean(parent_pin_hash) };
}

/** Calendar YYYY-MM-DD in an IANA timezone. */
export function calendarDayKey(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** UTC ms for local midnight at the start of `dayKey` (YYYY-MM-DD) in `tz`. */
export function zonedDayStartMs(dayKey: string, tz: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  let guess = Date.UTC(y, m - 1, d, 12, 0, 0);
  for (let i = 0; i < 4; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
    const asIfUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second")
    );
    const want = Date.UTC(y, m - 1, d, 0, 0, 0);
    guess += want - asIfUtc;
  }
  return guess;
}

/**
 * Connected talk duration in ms from answered_at → ended_at (or → now for live answered).
 * Returns null when there is no real talk segment (missed/blocked/ringing/no answered_at).
 */
export function talkDurationMs(
  log: {
    outcome: string;
    answered_at?: string | null;
    ended_at?: string | null;
  },
  nowMs = Date.now()
): number | null {
  if (log.outcome !== "completed" && log.outcome !== "answered") return null;
  if (!log.answered_at) return null;
  const start = new Date(log.answered_at).getTime();
  if (!Number.isFinite(start)) return null;
  let end: number;
  if (log.ended_at) {
    end = new Date(log.ended_at).getTime();
  } else if (log.outcome === "answered") {
    end = nowMs;
  } else {
    return null;
  }
  if (!Number.isFinite(end)) return null;
  const ms = end - start;
  if (ms < 1000) return null;
  return ms;
}

/** Format talk ms as m:ss (e.g. "2:05"). */
export function formatTalkDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/**
 * Connected talk minutes today in the household timezone.
 * Counts only answered→ended (or →now for live calls); excludes ringing/missed/cancelled.
 */
export function minutesUsedToday(
  db: Database.Database,
  householdId: string,
  now = new Date(),
  opts?: { lineId?: string }
): number {
  // Close answered rows that are no longer live so they stop accruing forever.
  // Never let orphan cleanup take down /api/me (that looked like “sign-in broken”).
  try {
    finalizeOrphanAnsweredCalls(db);
  } catch (e) {
    console.warn("[usage] orphan finalize failed", e);
  }

  const hh = db.prepare(`SELECT * FROM households WHERE id = ?`).get(householdId) as Household;
  const tz = hh?.quiet_tz && isValidTimeZone(hh.quiet_tz) ? hh.quiet_tz : "UTC";
  const dayKey = calendarDayKey(now, tz);
  const dayStart = zonedDayStartMs(dayKey, tz);
  // Next local midnight: walk forward hour-by-hour until the calendar day changes.
  let probe = dayStart + 12 * 3600e3;
  let tomorrowKey = dayKey;
  for (let i = 0; i < 36; i++) {
    const k = calendarDayKey(new Date(probe), tz);
    if (k !== dayKey) {
      tomorrowKey = k;
      break;
    }
    probe += 3600e3;
  }
  if (tomorrowKey === dayKey) {
    tomorrowKey = calendarDayKey(new Date(dayStart + 26 * 3600e3), tz);
  }
  const dayEndMs = zonedDayStartMs(tomorrowKey, tz);

  const lines = opts?.lineId
    ? [{ id: opts.lineId }]
    : (db.prepare(`SELECT id FROM lines WHERE household_id = ?`).all(householdId) as {
        id: string;
      }[]);
  if (!lines.length) return 0;
  const ids = lines.map((l) => l.id);
  const placeholders = ids.map(() => "?").join(",");
  const logs = db
    .prepare(
      `SELECT started_at, answered_at, ended_at, outcome, id FROM call_logs
       WHERE outcome IN ('completed', 'answered')
         AND (from_line_id IN (${placeholders}) OR to_line_id IN (${placeholders}))`
    )
    .all(...ids, ...ids) as {
    id: string;
    started_at: string;
    answered_at: string | null;
    ended_at: string | null;
    outcome: string;
  }[];

  let totalSec = 0;
  for (const log of logs) {
    // Only count connected talk. Ringing-only / pre-answered_at legacy rows are excluded
    // so abandoned "answered" logs can't inflate the daily total.
    const talkStartIso = log.answered_at;
    if (!talkStartIso) continue;
    const startMs = new Date(talkStartIso).getTime();
    const endMs = log.ended_at ? new Date(log.ended_at).getTime() : now.getTime();
    // Open answered: only accrue if still tracked as a live call
    if (!log.ended_at && log.outcome === "answered" && !liveCalls.has(log.id)) {
      continue;
    }
    const overlapStart = Math.max(startMs, dayStart);
    const overlapEnd = Math.min(endMs, dayEndMs);
    if (overlapEnd > overlapStart) totalSec += (overlapEnd - overlapStart) / 1000;
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
    quiet_days?: string | number[] | null;
    skip_holidays?: boolean;
    daily_cap_minutes?: number | null;
    schedule_preset?: string;
    parent_quiet_start?: string | null;
    parent_quiet_end?: string | null;
    parent_quiet_tz?: string | null;
    parent_quiet_days?: string | number[] | null;
    parent_schedule_preset?: string;
    parent_pin?: string | null;
    dnd?: boolean;
    layout_locked?: boolean;
    ring_volume?: number;
    ringer_style?: string;
  }
): Household {
  const hh = db.prepare(`SELECT * FROM households WHERE id = ?`).get(householdId) as Household;
  if (!hh) throw new Error("Household not found");

  let quiet_start = patch.quiet_start === undefined ? hh.quiet_start : patch.quiet_start;
  let quiet_end = patch.quiet_end === undefined ? hh.quiet_end : patch.quiet_end;
  let quiet_tz = patch.quiet_tz === undefined ? hh.quiet_tz : patch.quiet_tz;
  let quiet_days =
    patch.quiet_days === undefined ? hh.quiet_days ?? null : normalizeQuietDays(patch.quiet_days);
  let skip_holidays =
    patch.skip_holidays === undefined ? hh.skip_holidays || 0 : patch.skip_holidays ? 1 : 0;
  let schedule_preset = patch.schedule_preset === undefined ? hh.schedule_preset || "open" : patch.schedule_preset;
  let daily_cap_minutes =
    patch.daily_cap_minutes === undefined ? hh.daily_cap_minutes ?? null : patch.daily_cap_minutes;
  let parent_pin_hash = hh.parent_pin_hash;
  let dnd = patch.dnd === undefined ? hh.dnd || 0 : patch.dnd ? 1 : 0;
  let parent_quiet_start =
    patch.parent_quiet_start === undefined ? hh.parent_quiet_start : patch.parent_quiet_start;
  let parent_quiet_end =
    patch.parent_quiet_end === undefined ? hh.parent_quiet_end : patch.parent_quiet_end;
  let parent_quiet_tz =
    patch.parent_quiet_tz === undefined ? hh.parent_quiet_tz : patch.parent_quiet_tz;
  let parent_quiet_days =
    patch.parent_quiet_days === undefined
      ? hh.parent_quiet_days ?? null
      : normalizeQuietDays(patch.parent_quiet_days);
  let parent_schedule_preset =
    patch.parent_schedule_preset === undefined
      ? hh.parent_schedule_preset || "open"
      : patch.parent_schedule_preset;
  let layout_locked =
    patch.layout_locked === undefined ? hh.layout_locked ?? 1 : patch.layout_locked ? 1 : 0;
  let ring_volume = patch.ring_volume === undefined ? hh.ring_volume ?? 70 : Number(patch.ring_volume);
  let ringer_style =
    patch.ringer_style === undefined ? hh.ringer_style || "classic" : String(patch.ringer_style);

  if (patch.schedule_preset && patch.schedule_preset !== "custom") {
    const preset = SCHEDULE_PRESETS[patch.schedule_preset];
    if (!preset) throw new Error("Unknown schedule preset");
    if (patch.schedule_preset !== "open") {
      quiet_start = preset.quiet_start;
      quiet_end = preset.quiet_end;
      if (!quiet_tz) quiet_tz = "America/New_York";
      if (preset.quiet_days !== undefined && patch.quiet_days === undefined) {
        quiet_days = preset.quiet_days ?? null;
      }
      if (preset.skip_holidays !== undefined && patch.skip_holidays === undefined) {
        skip_holidays = preset.skip_holidays;
      }
    } else {
      quiet_start = null;
      quiet_end = null;
      quiet_days = null;
      skip_holidays = 0;
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
      throw new Error("Quiet Time needs a valid timezone (e.g. America/Chicago)");
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

  if (patch.parent_schedule_preset && patch.parent_schedule_preset !== "custom") {
    const preset = PARENT_SCHEDULE_PRESETS[patch.parent_schedule_preset];
    if (!preset) throw new Error("Unknown parent schedule");
    if (patch.parent_schedule_preset !== "open") {
      parent_quiet_start = preset.quiet_start;
      parent_quiet_end = preset.quiet_end;
      if (!parent_quiet_tz) parent_quiet_tz = quiet_tz || "America/New_York";
      if (preset.quiet_days !== undefined && patch.parent_quiet_days === undefined) {
        parent_quiet_days = preset.quiet_days ?? null;
      }
    } else {
      parent_quiet_start = null;
      parent_quiet_end = null;
      parent_quiet_days = null;
    }
    parent_schedule_preset = patch.parent_schedule_preset;
  }

  if (parent_quiet_start === "") parent_quiet_start = null;
  if (parent_quiet_end === "") parent_quiet_end = null;
  if (parent_quiet_tz === "") parent_quiet_tz = null;

  if (parent_quiet_start && parent_quiet_end) {
    parseHhMm(parent_quiet_start);
    parseHhMm(parent_quiet_end);
    if (!parent_quiet_tz || !isValidTimeZone(parent_quiet_tz)) {
      throw new Error("Do Not Disturb needs a valid timezone (e.g. America/Chicago)");
    }
    if (!patch.parent_schedule_preset) parent_schedule_preset = "custom";
  } else if (parent_quiet_start || parent_quiet_end) {
    throw new Error("Set both Do Not Disturb start and end, or clear both");
  } else if (patch.parent_quiet_start !== undefined || patch.parent_quiet_end !== undefined) {
    parent_quiet_start = null;
    parent_quiet_end = null;
    if (!patch.parent_schedule_preset) parent_schedule_preset = "open";
  }

  if (parent_quiet_tz && !isValidTimeZone(parent_quiet_tz)) {
    throw new Error("Invalid timezone");
  }

  if (daily_cap_minutes !== null && daily_cap_minutes !== undefined) {
    const n = Number(daily_cap_minutes);
    if (!Number.isFinite(n) || n < 0) throw new Error("Daily cap must be 0+ minutes");
    daily_cap_minutes = Math.round(n) || null;
  }

  if (patch.parent_pin !== undefined) {
    const raw = patch.parent_pin === null ? "" : normalizePin(patch.parent_pin);
    if (raw === "") parent_pin_hash = null;
    else {
      if (!/^\d{4,6}$/.test(raw)) throw new Error("PIN must be 4–6 digits");
      parent_pin_hash = hashPin(raw);
      // New PIN → lock speed-dial layout by default unless explicitly overridden in same patch.
      if (patch.layout_locked === undefined) layout_locked = 1;
    }
  }

  if (!Number.isFinite(ring_volume)) throw new Error("Ring volume must be 0–100");
  ring_volume = Math.max(0, Math.min(100, Math.round(ring_volume)));
  if (!RINGER_STYLES.has(ringer_style)) throw new Error("Unknown ringer style");

  const next = {
    ...hh,
    kill_switch: patch.kill_switch === undefined ? hh.kill_switch : patch.kill_switch ? 1 : 0,
    quiet_start,
    quiet_end,
    quiet_tz,
    quiet_days,
    skip_holidays,
    daily_cap_minutes,
    parent_pin_hash,
    schedule_preset: schedule_preset || "open",
    dnd,
    parent_quiet_start,
    parent_quiet_end,
    parent_quiet_tz,
    parent_quiet_days,
    parent_schedule_preset: parent_schedule_preset || "open",
    layout_locked,
    ring_volume,
    ringer_style,
  };
  db.prepare(
    `UPDATE households SET kill_switch = @kill_switch, quiet_start = @quiet_start, quiet_end = @quiet_end,
     quiet_tz = @quiet_tz, quiet_days = @quiet_days, skip_holidays = @skip_holidays,
     daily_cap_minutes = @daily_cap_minutes, parent_pin_hash = @parent_pin_hash,
     schedule_preset = @schedule_preset, dnd = @dnd,
     parent_quiet_start = @parent_quiet_start, parent_quiet_end = @parent_quiet_end,
     parent_quiet_tz = @parent_quiet_tz, parent_quiet_days = @parent_quiet_days,
     parent_schedule_preset = @parent_schedule_preset,
     layout_locked = @layout_locked,
     ring_volume = @ring_volume, ringer_style = @ringer_style WHERE id = @id`
  ).run(next);
  return next;
}

export function inQuietHours(hh: QuietPolicy, date = new Date()): boolean {
  return isQuietHoursActive(hh, date);
}

/**
 * Pad presence: softphone tab OR a registered ATA outside Quiet Time / quiet hours.
 * (FXS handset plug state isn't visible over SIP — registration is the signal.)
 */
export function linePresenceOnline(opts: {
  softphoneOnline: boolean;
  ataRegistered: boolean;
  household: Household | (QuietPolicy & { dnd: number } & Partial<Household>);
  lineMode?: "parent" | "child";
  now?: Date;
}): boolean {
  if (opts.softphoneOnline) return true;
  if (!opts.ataRegistered) return false;
  const hh = opts.household as Household;
  if (hh.dnd) return false;
  const policy =
    opts.lineMode === "parent" && "parent_quiet_start" in hh
      ? quietPolicyForLine({ mode: "parent" }, hh)
      : opts.lineMode === "child"
        ? quietPolicyForLine({ mode: "child" }, hh)
        : hh;
  if (isQuietHoursActive(policy, opts.now)) return false;
  return true;
}

export function listAtaDevices(db: Database.Database): AtaDevice[] {
  return db.prepare(`SELECT * FROM ata_devices`).all() as AtaDevice[];
}

export type CanCallResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      voice: UnavailableVoice;
      spoken: string;
      /** Which side’s policy blocked the call (for ATA prompt selection). */
      side: "caller" | "callee" | "both";
    };

function block(
  reason: string,
  voice: UnavailableVoice,
  side: "caller" | "callee" | "both"
): CanCallResult {
  const spokenSide = side === "caller" ? "caller" : "callee";
  return { ok: false, reason, voice, spoken: spokenFor(voice, spokenSide), side };
}

export function canCall(
  db: Database.Database,
  fromLineId: string,
  toLineId: string,
  now = new Date()
): CanCallResult {
  if (fromLineId === toLineId) return block("Can't call your own line", "self", "both");

  const from = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(fromLineId) as Line | undefined;
  const to = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(toLineId) as Line | undefined;
  if (!from || !to) return block("Unknown line", "unknown", "both");

  // Review softphone: only Trevor ↔ test, never anyone else (even if allowlist drifts).
  const testUserId = testReviewUserIdForLine(db, from) || testReviewUserIdForLine(db, to);
  if (testUserId) {
    const allowed = testReviewAllowedLineIds(db, testUserId);
    if (!allowed.has(fromLineId) || !allowed.has(toLineId)) {
      return block("Not on your approved contacts", "allowlist", "caller");
    }
  }

  const fromHh = db.prepare(`SELECT * FROM households WHERE id = ?`).get(from.household_id) as Household;
  const toHh = db.prepare(`SELECT * FROM households WHERE id = ?`).get(to.household_id) as Household;

  // Parent-induced Timeout (kill switch) — stops all calls
  if (fromHh.kill_switch) return block("Timeout is on", "timeout", "caller");
  if (toHh.kill_switch) return block("They’re in Timeout", "timeout", "callee");

  const fromVip = Boolean(
    db
      .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ? AND always_allow = 1`)
      .get(from.household_id, toLineId)
  );
  const toVip = Boolean(
    db
      .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ? AND always_allow = 1`)
      .get(to.household_id, fromLineId)
  );

  // Instant Quiet Time — VIP always_allow can still ring through
  if (fromHh.dnd && !fromVip) return block("Quiet Time is on", "quiet", "caller");
  if (toHh.dnd && !toVip) return block("They’re in Quiet Time", "quiet", "callee");

  const fromPolicy = quietPolicyForLine(from, fromHh);
  const toPolicy = quietPolicyForLine(to, toHh);
  const fromIsKid = lineModeOf(from) === "child";
  const toIsKid = lineModeOf(to) === "child";

  // Kid schedule blocks both directions. Parent DND only stops inbound rings.
  if (fromIsKid && inQuietHours(fromPolicy, now) && !fromVip) {
    const voice = quietHoursVoice(fromPolicy);
    const reason =
      voice === "school"
        ? "School hours — try again later"
        : voice === "bedtime"
          ? "Bedtime — try again tomorrow"
          : "Quiet Time — try again later";
    return block(reason, voice, "caller");
  }
  if (inQuietHours(toPolicy, now) && !toVip) {
    const voice = quietHoursVoice(toPolicy);
    const reason = toIsKid
      ? voice === "school"
        ? "They’re at school"
        : voice === "bedtime"
          ? "They’re not available until tomorrow"
          : "They’re in Quiet Time"
      : "They’re on Do Not Disturb";
    return block(reason, toIsKid ? voice : "quiet", "callee");
  }

  if (fromIsKid && fromHh.daily_cap_minutes != null) {
    const used = minutesUsedToday(db, fromHh.id, now, { lineId: from.id });
    if (used >= fromHh.daily_cap_minutes) {
      return block("Daily talk time limit reached", "cap", "caller");
    }
  }
  if (toIsKid && toHh.daily_cap_minutes != null) {
    const used = minutesUsedToday(db, toHh.id, now, { lineId: to.id });
    if (used >= toHh.daily_cap_minutes) {
      return block("Their daily talk time limit is full", "cap", "callee");
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

  if (!allowedOut) return block("Not on your approved contacts", "allowlist", "caller");
  if (!allowedIn) return block("You’re not on their approved contacts", "allowlist", "callee");

  // TEMP fail-open: sphere enforcement paused while call-path is restored.
  // Re-enable shared-circle check after migration + calling are verified.
  // if (!linesShareSphere(db, fromLineId, toLineId)) {
  //   return block("Not in the same circle", "sphere", "caller");
  // }
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
    answered_at: null,
    ended_at: outcome === "ringing" ? null : nowIso(),
    outcome,
  };
  db.prepare(
    `INSERT INTO call_logs (id, from_line_id, to_line_id, started_at, answered_at, ended_at, outcome)
     VALUES (@id, @from_line_id, @to_line_id, @started_at, @answered_at, @ended_at, @outcome)`
  ).run(log);
  return log;
}

/** Mark a ringing call as connected; talk time starts at answered_at. */
export function markCallAnswered(db: Database.Database, callId: string): void {
  db.prepare(
    `UPDATE call_logs
     SET outcome = 'answered', ended_at = NULL, answered_at = COALESCE(answered_at, ?)
     WHERE id = ? AND outcome IN ('ringing', 'answered')`
  ).run(nowIso(), callId);
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

/** Default ring time before no-answer → missed / voicemail (~6 classic rings). */
export const RING_TIMEOUT_MS = 40_000;

/** Safety cap for a single connected call (kids landline; prevents runaway usage). */
export const MAX_ACTIVE_CALL_MS = 3 * 60 * 60 * 1000;

/**
 * Close answered call_logs that are no longer in the in-memory live map
 * (disconnect without hangup, server restart, etc.).
 */
export function finalizeOrphanAnsweredCalls(db: Database.Database): number {
  const open = db
    .prepare(
      `SELECT id, answered_at, started_at FROM call_logs
       WHERE outcome = 'answered' AND ended_at IS NULL`
    )
    .all() as { id: string; answered_at: string | null; started_at: string }[];
  let n = 0;
  for (const row of open) {
    if (liveCalls.has(row.id)) continue;
    if (row.answered_at) {
      // Server restart mid-call: end at now (approx. talk until process died).
      endCallLog(db, row.id, "ended");
    } else {
      // Pre-answered_at stuck rows: never recorded connect time — don't invent talk minutes.
      db.prepare(
        `UPDATE call_logs SET ended_at = started_at, outcome = 'completed' WHERE id = ?`
      ).run(row.id);
    }
    n++;
  }
  return n;
}

/** Mark very long open answered calls as completed (even if still "live"). */
export function expireStaleAnswered(
  db: Database.Database,
  maxAgeMs = MAX_ACTIVE_CALL_MS
): { id: string; from_line_id: string; to_line_id: string }[] {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const rows = db
    .prepare(
      `SELECT id, from_line_id, to_line_id FROM call_logs
       WHERE outcome = 'answered' AND ended_at IS NULL
         AND COALESCE(answered_at, started_at) < ?`
    )
    .all(cutoff) as { id: string; from_line_id: string; to_line_id: string }[];
  if (!rows.length) return [];
  for (const row of rows) {
    endCallLog(db, row.id, "ended");
    liveCalls.delete(row.id);
  }
  return rows;
}

/** Mark unanswered ringing calls older than `maxAgeMs` as missed; returns expired rows. */
export function expireStaleRings(
  db: Database.Database,
  maxAgeMs = RING_TIMEOUT_MS
): { id: string; from_line_id: string; to_line_id: string }[] {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const rows = db
    .prepare(
      `SELECT id, from_line_id, to_line_id FROM call_logs
       WHERE outcome = 'ringing' AND ended_at IS NULL AND started_at < ?`
    )
    .all(cutoff) as { id: string; from_line_id: string; to_line_id: string }[];
  if (!rows.length) return [];
  const ended = nowIso();
  const upd = db.prepare(
    `UPDATE call_logs SET ended_at = ?, outcome = 'missed' WHERE id = ? AND outcome = 'ringing'`
  );
  for (const row of rows) upd.run(ended, row.id);
  return rows;
}

/** Max stored messages per recipient line mailbox (classic limited memory / tape). */
export const MAX_VOICEMAILS_PER_HOUSEHOLD = 15;

export function leaveVoicemail(
  db: Database.Database,
  toHouseholdId: string,
  fromLineId: string,
  toLineId: string,
  _body: string,
  fromLabel?: string,
  opts?: { audioBase64?: string; audioMime?: string; dataDir?: string }
) {
  const audioBase64 = opts?.audioBase64 ? String(opts.audioBase64) : "";
  if (!audioBase64) throw new Error("Record a voice message");
  if (!toLineId) throw new Error("Unknown line");
  const fromLine = db.prepare(`SELECT name FROM lines WHERE id = ?`).get(fromLineId) as
    | { name: string }
    | undefined;
  const id = newId("vm");
  const dataDir = opts?.dataDir;
  if (!dataDir) throw new Error("Audio storage unavailable");
  const mime = String(opts?.audioMime || "audio/webm");
  const ext = mime.includes("wav") || mime.includes("wave")
    ? "wav"
    : mime.includes("ogg")
      ? "ogg"
      : mime.includes("mp4") || mime.includes("m4a")
        ? "m4a"
        : "webm";
  const raw = audioBase64.includes(",") ? audioBase64.split(",").pop()! : audioBase64;
  const buf = Buffer.from(raw, "base64");
  if (buf.length < 64) throw new Error("Recording too short");
  // ~45s at typical softphone bitrates; keep headroom under ~2.8MB.
  if (buf.length > 2_800_000) throw new Error("Recording too long (keep under ~45s)");

  // Free a slot like a full tape: erase oldest already-played recording first (this mailbox).
  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS n FROM voicemails WHERE to_line_id = ? AND audio_path IS NOT NULL`
    )
    .get(toLineId) as { n: number };
  if (countRow.n >= MAX_VOICEMAILS_PER_HOUSEHOLD) {
    const oldestHeard = db
      .prepare(
        `SELECT id FROM voicemails WHERE to_line_id = ? AND listened = 1 AND audio_path IS NOT NULL
         ORDER BY created_at ASC LIMIT 1`
      )
      .get(toLineId) as { id: string } | undefined;
    if (oldestHeard) {
      deleteVoicemail(db, toHouseholdId, oldestHeard.id, dataDir);
    } else {
      throw new Error("Answering machine is full — erase a message first");
    }
  }

  const dir = path.join(dataDir, "voicemails");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.${ext}`);
  fs.writeFileSync(file, buf);
  const audio_path = `voicemails/${id}.${ext}`;
  const row = {
    id,
    household_id: toHouseholdId,
    from_line_id: fromLineId,
    to_line_id: toLineId,
    from_label:
      fromLabel?.trim() ||
      peerLabelForHousehold(db, toHouseholdId, fromLineId) ||
      fromLine?.name?.replace(/'s phone$/i, "").trim() ||
      "Family",
    body: "(voicemail)",
    audio_path,
    listened: 0,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO voicemails (id, household_id, from_line_id, to_line_id, from_label, body, audio_path, listened, created_at)
     VALUES (@id, @household_id, @from_line_id, @to_line_id, @from_label, @body, @audio_path, @listened, @created_at)`
  ).run(row);
  return row;
}

/**
 * Club-style leave-a-message after miss/away.
 * Caller must own the from line; destination must match canCall’s contact gate:
 * same household always, otherwise on the caller household’s allowlist.
 * (Quiet Time / caps still apply at dial time — deposit is not re-gated by those.)
 */
export function leaveVoicemailForContact(
  db: Database.Database,
  userId: string,
  fromLineId: string,
  toLineId: string,
  body: string,
  opts?: { audioBase64?: string; audioMime?: string; dataDir?: string }
) {
  const from = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(fromLineId) as Line | undefined;
  const to = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(toLineId) as Line | undefined;
  if (!from || !to) throw new Error("Unknown line");
  const member = db
    .prepare(`SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?`)
    .get(from.household_id, userId);
  if (!member && from.child_user_id !== userId) throw new Error("Not your line");
  // Match canCall: household lines can always reach each other without an allowlist row.
  if (from.household_id !== to.household_id) {
    const approved = db
      .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
      .get(from.household_id, toLineId);
    if (!approved) throw new Error("Contact not approved");
    // TEMP fail-open: sphere gate paused (same as canCall) during call-path restore.
  }
  return leaveVoicemail(db, to.household_id, fromLineId, toLineId, body, undefined, opts);
}

/**
 * Bridge/ATA no-answer deposit — no softphone user session.
 * Same contact gate as leaveVoicemailForContact (household or allowlist).
 */
export function leaveVoicemailFromBridge(
  db: Database.Database,
  fromLineId: string,
  toLineId: string,
  opts?: { audioBase64?: string; audioMime?: string; dataDir?: string }
) {
  const from = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(fromLineId) as Line | undefined;
  const to = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(toLineId) as Line | undefined;
  if (!from || !to) throw new Error("Unknown line");
  if (from.household_id !== to.household_id) {
    const approved = db
      .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
      .get(from.household_id, toLineId);
    if (!approved) throw new Error("Contact not approved");
  }
  return leaveVoicemail(db, to.household_id, fromLineId, toLineId, "", undefined, opts);
}

/** Remove a voicemail row and its audio file (if any). */
export function deleteVoicemail(
  db: Database.Database,
  householdId: string,
  vmId: string,
  dataDir: string
): { ok: true; id: string } {
  const row = db
    .prepare(`SELECT id, audio_path FROM voicemails WHERE id = ? AND household_id = ?`)
    .get(vmId, householdId) as { id: string; audio_path: string | null } | undefined;
  if (!row) throw new Error("Voicemail not found");
  if (row.audio_path) {
    const abs = path.resolve(dataDir, row.audio_path);
    if (abs.startsWith(path.resolve(dataDir) + path.sep) && fs.existsSync(abs)) {
      try {
        fs.unlinkSync(abs);
      } catch {
        /* best-effort file cleanup */
      }
    }
  }
  db.prepare(`DELETE FROM voicemails WHERE id = ? AND household_id = ?`).run(vmId, householdId);
  return { ok: true, id: vmId };
}

/** Bulk-remove voicemails in a household (same membership gate as single delete). */
export function deleteVoicemails(
  db: Database.Database,
  householdId: string,
  vmIds: unknown,
  dataDir: string
): { ok: true; deleted: string[] } {
  if (!Array.isArray(vmIds)) throw new Error("ids must be an array");
  const ids = [
    ...new Set(
      vmIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
  if (!ids.length) throw new Error("Select at least one voicemail");
  if (ids.length > MAX_VOICEMAILS_PER_HOUSEHOLD) {
    throw new Error("Too many voicemails selected");
  }
  const deleted: string[] = [];
  for (const id of ids) {
    try {
      deleteVoicemail(db, householdId, id, dataDir);
      deleted.push(id);
    } catch (e) {
      if (!/not found/i.test((e as Error).message)) throw e;
    }
  }
  return { ok: true, deleted };
}

export function householdSnapshot(db: Database.Database, userId: string) {
  scrubTestReviewVisibility(db, userId);

  const memberships = db
    .prepare(`SELECT household_id FROM household_members WHERE user_id = ?`)
    .all(userId) as { household_id: string }[];

  const guardedHhIds = db
    .prepare(
      `SELECT DISTINCT l.household_id FROM child_guardians g
       JOIN lines l ON l.id = g.line_id
       WHERE g.user_id = ?`
    )
    .all(userId) as { household_id: string }[];

  // Optional child login (lines.child_user_id) — not always a household_members row.
  const childLoginHhIds = db
    .prepare(`SELECT DISTINCT household_id FROM lines WHERE child_user_id = ?`)
    .all(userId) as { household_id: string }[];

  const hhIdSet = new Set([
    ...memberships.map((m) => m.household_id),
    ...guardedHhIds.map((g) => g.household_id),
    ...childLoginHhIds.map((c) => c.household_id),
  ]);

  const households = [...hhIdSet].map((householdId) => {
    const hh = db.prepare(`SELECT * FROM households WHERE id = ?`).get(householdId) as Household;
    const isMember = userInHousehold(db, householdId, userId);
    const lines = db.prepare(`SELECT * FROM lines WHERE household_id = ?`).all(hh.id) as Line[];
    const ourLineIds = lines.map((l) => l.id);
    const allowlist = db
      .prepare(`SELECT * FROM allowlist WHERE household_id = ? ORDER BY speed_dial IS NULL, speed_dial, label`)
      .all(hh.id) as AllowlistEntry[];
    // Keep same-household contacts (parent ↔ child speed dial). Softphones filter
    // target_line_id === activeLineId client-side; canCall rejects self.
    const enrichedAllowlist = allowlist.map((a) => {
      const theirHh = db
        .prepare(`SELECT household_id FROM lines WHERE id = ?`)
        .get(a.target_line_id) as { household_id: string } | undefined;
      const mutual = Boolean(
        theirHh &&
          ourLineIds.some((lid) =>
            db
              .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
              .get(theirHh.household_id, lid)
          )
      );
      return {
        ...a,
        always_allow: a.always_allow || 0,
        mutual,
        sphere_ids: sphereIdsContainingLine(db, a.target_line_id),
        is_test_review: isTestReviewLineId(db, a.target_line_id),
      };
    });
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
        `SELECT * FROM voicemails WHERE household_id = ? ORDER BY created_at ASC LIMIT 40`
      )
      .all(hh.id);
    const used = minutesUsedToday(db, hh.id);
    const pub = publicHousehold(hh);
    const parentSpheres = isMember ? listHouseholdParentSpheres(db, hh.id) : [];
    const enrichedLines = lines.map((l) => {
      const norm = normalizeLine(l);
      const guardians =
        norm.mode === "child" || isGuardian(db, userId, norm.id) ? listGuardians(db, norm.id) : [];
      const { greeting_path: _gp, greeting_confirmed_at: _gc, avatar_path: _ap, ...safeLine } = norm;
      const ata = getAtaByLineId(db, norm.id);
      return {
        ...safeLine,
        ...publicLineGreeting(norm),
        ...publicLineAvatar(norm),
        guardians,
        child_user: publicChildUserForLine(db, norm),
        can_manage: canManageChild(db, userId, norm.id),
        ata: ata ? publicAta(ata) : null,
        sphere_access:
          (norm.mode || "parent") === "child" ? listLineSphereAccessIds(db, norm.id) : [],
        usage_today_minutes:
          (norm.mode || "parent") === "child"
            ? minutesUsedToday(db, hh.id, new Date(), { lineId: norm.id })
            : undefined,
      };
    });
    const mySphere = isMember ? ensureSphereForParent(db, userId) : getSphereByOwner(db, userId);
    // TEMP fail-open: incomplete sphere membership must not empty pads / hide contacts
    // while calling is restored. Re-enable kid/parent circle filters after migration.
    const childOnly = isChildOnlyAccount(db, userId);
    void childOnly;
    const visibleAllowlist = enrichedAllowlist.filter((a) =>
      canViewerAccessTestReviewLine(db, userId, a.target_line_id)
    );

    return {
      ...pub,
      dnd: hh.dnd || 0,
      quiet_days: hh.quiet_days ?? null,
      skip_holidays: hh.skip_holidays || 0,
      access: isMember ? "member" : "guardian",
      members: db
        .prepare(
          `SELECT u.id AS user_id, u.display_name, u.username, u.parent_title, hm.role
           FROM household_members hm
           JOIN users u ON u.id = hm.user_id
           WHERE hm.household_id = ?
           ORDER BY CASE hm.role WHEN 'owner' THEN 0 ELSE 1 END, lower(u.display_name)`
        )
        .all(hh.id) as {
        user_id: string;
        display_name: string;
        username: string | null;
        parent_title: string | null;
        role: string;
      }[],
      lines: enrichedLines,
      allowlist: visibleAllowlist,
      family_room_members: listFamilyRoomMembers(db, hh.id).map((m) => ({
        line_id: m.line_id,
        name: m.child_label || m.name,
        mode: m.mode,
        online: m.online,
        household_id: m.household_id,
      })),
      family_room_always: listFamilyRoomAlwaysAllowedLineIds(db, hh.id),
      family_room_approved: [
        ...new Set([
          ...listFamilyRoomAlwaysAllowedLineIds(db, hh.id),
          ...listFamilyRoomMembers(db, hh.id).map((m) => m.line_id),
        ]),
      ],
      family_room_talk_pairs: listFamilyRoomTalkPairs(db, hh.id).map((p) => ({
        line_a: p.line_a,
        line_b: p.line_b,
      })),
      adult_family_room_members: listAdultFamilyRoomMembers(db, hh.id).map((m) => ({
        line_id: m.line_id,
        name: m.child_label || m.name,
        mode: m.mode,
        online: m.online,
        household_id: m.household_id,
      })),
      adult_family_room_approved: [
        ...new Set(listAdultFamilyRoomMembers(db, hh.id).map((m) => m.line_id)),
      ],
      family_room_choices_by_line: Object.fromEntries(
        enrichedLines.map((l) => [l.id, listFamilyRoomChoicesForLine(db, l.id)])
      ),
      spheres: parentSpheres.map((s) => ({
        id: s.id,
        owner_user_id: s.owner_user_id,
        owner_display_name: s.owner_display_name,
        name: s.name,
        is_mine: s.owner_user_id === userId,
        member_line_ids: listSphereMemberLineIds(db, s.id).filter((lineId) =>
          canViewerAccessTestReviewLine(db, userId, lineId)
        ),
      })),
      my_sphere_id: mySphere?.id ?? null,
      call_logs: logs,
      voicemails,
      usage_today_minutes: used,
      daily_cap_minutes: hh.daily_cap_minutes ?? null,
      schedule_preset: hh.schedule_preset || "open",
      live_calls: liveCallsForViewer(db, hh.id, userId),
      declined_line_ids: listDeclinedLineIds(db, hh.id),
      provisioned_relatives: isMember ? listProvisionedRelatives(db, hh.id) : [],
    };
  });

  const directory = (
    db
      .prepare(
        `SELECT l.id, l.name, l.type, l.household_id, l.online, IFNULL(l.mode, 'parent') AS mode,
                l.avatar_path, l.avatar_updated_at, h.name AS household_name
         FROM lines l JOIN households h ON h.id = l.household_id`
      )
      .all() as {
      id: string;
      name: string;
      type: string;
      household_id: string;
      online: number;
      mode: string;
      avatar_path: string | null;
      avatar_updated_at: string | null;
      household_name: string;
    }[]
  )
    .filter((row) => canViewerSeeLine(db, userId, row.id))
    .map(({ avatar_path, avatar_updated_at, ...row }) => ({
      ...row,
      ...publicLineAvatar({
        id: row.id,
        avatar_path,
        avatar_updated_at,
      }),
      is_test_review: isTestReviewLineId(db, row.id),
    }));

  households.sort((a, b) => {
    if (a.access === b.access) return 0;
    return a.access === "member" ? -1 : 1;
  });

  return { households, directory, mothership: getMothershipStats(db) };
}

// —— ATA / HT801 bindings ————————————————————————————————————————————————

/** First extension PhoneHome assigns for analog adapters (override with SIP_EXT_START). */
export const SIP_EXT_START = Math.max(
  100,
  Number.parseInt(String(process.env.SIP_EXT_START || "2001"), 10) || 2001
);
/** Inclusive upper bound for auto-assigned extensions. */
export const SIP_EXT_END = Math.max(
  SIP_EXT_START,
  Number.parseInt(String(process.env.SIP_EXT_END || "2899"), 10) || 2899
);

/**
 * Next free SIP extension not already bound to an ATA line.
 * Parents never pick this — PhoneHome assigns so Gemma ≠ cousin.
 */
export function allocateNextSipExtension(db: Database.Database): string {
  const used = new Set(
    (
      db.prepare(`SELECT sip_extension FROM ata_devices`).all() as { sip_extension: string }[]
    ).map((r) => String(r.sip_extension))
  );
  for (let n = SIP_EXT_START; n <= SIP_EXT_END; n++) {
    const ext = String(n);
    if (!used.has(ext)) return ext;
  }
  throw new Error(`No free SIP extensions left (${SIP_EXT_START}–${SIP_EXT_END})`);
}

/** Strong SIP auth secret for FreePBX / HT801 (letters + digits, no symbols). */
export function generateAtaSipPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(18);
  let out = "";
  for (let i = 0; i < 18; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}

export type PublicAtaDevice = {
  id: string;
  line_id: string;
  sip_extension: string;
  sip_server: string;
  mac: string | null;
  display_name: string | null;
  provision_token: string;
  model: AtaModel;
  /** Password present (never echo plaintext in snapshots). */
  has_sip_password: boolean;
  created_at: string;
  updated_at: string;
};

export function publicAta(ata: AtaDevice): PublicAtaDevice {
  return {
    id: ata.id,
    line_id: ata.line_id,
    sip_extension: ata.sip_extension,
    sip_server: ata.sip_server,
    mac: ata.mac,
    display_name: ata.display_name,
    provision_token: ata.provision_token,
    model: normalizeAtaModel(ata.model),
    has_sip_password: Boolean(ata.sip_password),
    created_at: ata.created_at,
    updated_at: ata.updated_at,
  };
}

/**
 * SIP registrar hostname written into ATA configs.
 * Prefer a public name so remote households can register; LAN IP only works on-site.
 * Override with SIP_PUBLIC_HOST or SIP_SERVER.
 */
export function defaultSipServer(): string {
  const explicit = (process.env.SIP_PUBLIC_HOST || process.env.SIP_SERVER || "").trim();
  if (explicit) return explicit;
  const pub = (process.env.PUBLIC_BASE_URL || "").trim();
  if (pub) {
    try {
      return new URL(pub.includes("://") ? pub : `https://${pub}`).hostname;
    } catch {
      /* fall through */
    }
  }
  return "";
}

export function getAtaByLineId(db: Database.Database, lineId: string): AtaDevice | null {
  return (
    (db.prepare(`SELECT * FROM ata_devices WHERE line_id = ?`).get(lineId) as AtaDevice | undefined) ??
    null
  );
}

export function getAtaByProvisionToken(db: Database.Database, token: string): AtaDevice | null {
  const t = String(token || "").trim();
  if (!t || t.length < 16) return null;
  return (
    (db.prepare(`SELECT * FROM ata_devices WHERE provision_token = ?`).get(t) as AtaDevice | undefined) ??
    null
  );
}

export function getAtaBySipExtension(db: Database.Database, ext: string): AtaDevice | null {
  const e = String(ext || "").trim();
  if (!e) return null;
  return (
    (db.prepare(`SELECT * FROM ata_devices WHERE sip_extension = ?`).get(e) as AtaDevice | undefined) ??
    null
  );
}

export function getAtaByMac(db: Database.Database, macRaw: string): AtaDevice | null {
  const mac = normalizeMac(macRaw);
  if (!mac) return null;
  return (
    (db.prepare(`SELECT * FROM ata_devices WHERE mac = ?`).get(mac) as AtaDevice | undefined) ?? null
  );
}

export function upsertAtaDevice(
  db: Database.Database,
  lineId: string,
  patch: {
    /**
     * Ignored unless opts.allowSipCredentialOverride (lab/admin only).
     * Parents never pick or change SIP extensions — PhoneHome assigns unique ones.
     */
    sip_extension?: string;
    /** Ignored unless opts.allowSipCredentialOverride. Auto-generated on create. */
    sip_password?: string;
    sip_server?: string;
    mac?: string | null;
    display_name?: string | null;
    model?: string | null;
    rotate_provision_token?: boolean;
  },
  opts?: { allowSipCredentialOverride?: boolean }
): AtaDevice {
  const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line | undefined;
  if (!line) throw new Error("Line not found");

  const existing = getAtaByLineId(db, lineId);
  const now = nowIso();
  const allowOverride = Boolean(opts?.allowSipCredentialOverride);

  // Hard lock: keep existing extension forever; otherwise auto-allocate (ignore client).
  let sip_extension: string;
  if (existing?.sip_extension) {
    sip_extension = existing.sip_extension;
  } else if (allowOverride) {
    const rawExt = patch.sip_extension !== undefined ? String(patch.sip_extension).trim() : "";
    sip_extension =
      rawExt && rawExt.toLowerCase() !== "auto" ? rawExt : allocateNextSipExtension(db);
  } else {
    sip_extension = allocateNextSipExtension(db);
  }
  if (!/^\d{2,8}$/.test(sip_extension)) {
    throw new Error("SIP extension must be 2–8 digits (e.g. 2001)");
  }

  // Password: keep existing unless lab/admin override; else generate on create.
  let sip_password: string;
  if (existing?.sip_password && existing.sip_password.length >= 4) {
    sip_password =
      allowOverride && patch.sip_password !== undefined && String(patch.sip_password).length >= 4
        ? String(patch.sip_password)
        : existing.sip_password;
  } else if (allowOverride && patch.sip_password !== undefined && String(patch.sip_password).length >= 4) {
    sip_password = String(patch.sip_password);
  } else {
    sip_password = generateAtaSipPassword();
  }
  if (sip_password.length < 4) throw new Error("SIP password required");

  const sip_server = String(
    patch.sip_server !== undefined ? patch.sip_server : existing?.sip_server || defaultSipServer()
  )
    .trim()
    .slice(0, 128);
  if (!sip_server) throw new Error("SIP server required");

  let mac: string | null =
    patch.mac === undefined
      ? existing?.mac ?? null
      : patch.mac === null || patch.mac === ""
        ? null
        : normalizeMac(patch.mac);
  if (patch.mac !== undefined && patch.mac !== null && patch.mac !== "" && !mac) {
    throw new Error("MAC must be 12 hex digits (e.g. 000b82aabbcc)");
  }

  let display_name =
    patch.display_name === undefined
      ? existing?.display_name ?? line.child_label ?? line.name
      : patch.display_name;
  if (display_name === "") display_name = null;
  if (display_name != null) display_name = String(display_name).trim().slice(0, 64) || null;

  const model = normalizeAtaModel(patch.model !== undefined ? patch.model : existing?.model);

  // Unique extension / MAC across other lines
  const extClash = db
    .prepare(`SELECT line_id FROM ata_devices WHERE sip_extension = ? AND line_id != ?`)
    .get(sip_extension, lineId) as { line_id: string } | undefined;
  if (extClash) throw new Error("That SIP extension is already linked to another line");
  if (mac) {
    const macClash = db
      .prepare(`SELECT line_id FROM ata_devices WHERE mac = ? AND line_id != ?`)
      .get(mac, lineId) as { line_id: string } | undefined;
    if (macClash) throw new Error("That MAC is already linked to another line");
  }

  const provision_token =
    existing && !patch.rotate_provision_token
      ? existing.provision_token
      : randomBytes(24).toString("base64url");

  if (existing) {
    db.prepare(
      `UPDATE ata_devices SET sip_extension = ?, sip_password = ?, sip_server = ?, mac = ?,
       provision_token = ?, display_name = ?, model = ?, updated_at = ? WHERE line_id = ?`
    ).run(sip_extension, sip_password, sip_server, mac, provision_token, display_name, model, now, lineId);
  } else {
    db.prepare(
      `INSERT INTO ata_devices (id, line_id, sip_extension, sip_password, sip_server, mac,
        provision_token, display_name, model, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      newId("ata"),
      lineId,
      sip_extension,
      sip_password,
      sip_server,
      mac,
      provision_token,
      display_name,
      model,
      now,
      now
    );
  }

  // Mark line type as ATA when binding (keeps softphone usable; type is informational).
  if (line.type === "softphone") {
    db.prepare(`UPDATE lines SET type = 'ata' WHERE id = ?`).run(lineId);
  }

  return getAtaByLineId(db, lineId)!;
}

export function deleteAtaDevice(db: Database.Database, lineId: string): boolean {
  const r = db.prepare(`DELETE FROM ata_devices WHERE line_id = ?`).run(lineId);
  return r.changes > 0;
}

export function ataConfigXmlForDevice(
  ata: AtaDevice,
  opts: {
    publicBaseUrl?: string;
    includeConfigServerPath?: boolean;
    /** HT801 web admin password to embed as P2 (LAN push). */
    adminPassword?: string | null;
  } = {}
): string {
  const includePath = opts.includeConfigServerPath !== false && opts.publicBaseUrl;
  const configServerPath = includePath
    ? formatConfigServerPath(opts.publicBaseUrl!, ata.provision_token)
    : null;
  const viaHttps = opts.publicBaseUrl?.startsWith("https:") ? 2 : 1;
  return buildHt801ConfigXml({
    mac: ata.mac,
    sipServer: ata.sip_server,
    sipUserId: ata.sip_extension,
    sipAuthId: ata.sip_extension,
    sipPassword: ata.sip_password,
    displayName: ata.display_name || undefined,
    accountName: ata.display_name || undefined,
    configServerPath,
    upgradeVia: configServerPath ? (viaHttps as 1 | 2) : undefined,
    adminPassword: opts.adminPassword || undefined,
  });
}

export function ataConfigTxtForDevice(
  ata: AtaDevice,
  opts: { publicBaseUrl?: string; includeConfigServerPath?: boolean } = {}
): string {
  const includePath = opts.includeConfigServerPath !== false && opts.publicBaseUrl;
  const provisionUrl = includePath
    ? formatFanvilProvisionUrl(opts.publicBaseUrl!, ata.provision_token)
    : null;
  return buildG100sConfigTxt({
    sipServer: ata.sip_server,
    sipUserId: ata.sip_extension,
    sipAuthId: ata.sip_extension,
    sipPassword: ata.sip_password,
    displayName: ata.display_name || undefined,
    provisionUrl,
  });
}

export function ataConfigForDevice(
  ata: AtaDevice,
  opts: { publicBaseUrl?: string; includeConfigServerPath?: boolean } = {}
): { body: string; contentType: string; filename: string; ext: "xml" | "txt" } {
  const model = normalizeAtaModel(ata.model);
  if (model === "g100s") {
    const mac = ata.mac || "config";
    return {
      body: ataConfigTxtForDevice(ata, opts),
      contentType: "text/plain; charset=utf-8",
      filename: `${mac}.txt`,
      ext: "txt",
    };
  }
  const fname = ata.mac ? `cfg${ata.mac}.xml` : `config-ht801-${ata.sip_extension}.xml`;
  return {
    body: ataConfigXmlForDevice(ata, opts),
    contentType: "application/xml; charset=utf-8",
    filename: fname,
    ext: "xml",
  };
}

/**
 * Designated admin parent for dial-1 / Home on kid pads and ATA.
 * Alias: householdHomeParentLine.
 */
export function householdHomeParentLine(
  db: Database.Database,
  householdId: string
): Line | null {
  return householdAdminParentLine(db, householdId);
}

/** US emergency + common VoIP test code (matches HT801 P8597). */
export function isEmergencyDial(dialed: string): boolean {
  return dialed === "911" || dialed === "933";
}

/**
 * ATA *98 / Messages IVR: map SIP CallerID extension → this line’s PhoneHome mailbox.
 * Same household inbox softphone Messages uses (not FreePBX Comedian Mail).
 */
export function resolveAtaMailbox(
  db: Database.Database,
  sipExtension: string
):
  | {
      ok: true;
      lineId: string;
      householdId: string;
      label: string;
      hasGreeting: boolean;
      greetingUpdatedAt: string | null;
      unreadCount: number;
      messageCount: number;
    }
  | { ok: false; reason: string } {
  const ata = getAtaBySipExtension(db, sipExtension);
  if (!ata) return { ok: false, reason: "Unknown ATA extension — link it in PhoneHome first" };
  const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(ata.line_id) as Line | undefined;
  if (!line) return { ok: false, reason: "ATA line missing" };
  const unread = db
    .prepare(
      `SELECT COUNT(*) AS n FROM voicemails
       WHERE to_line_id = ? AND listened = 0 AND audio_path IS NOT NULL`
    )
    .get(line.id) as { n: number };
  const total = db
    .prepare(
      `SELECT COUNT(*) AS n FROM voicemails
       WHERE to_line_id = ? AND audio_path IS NOT NULL`
    )
    .get(line.id) as { n: number };
  return {
    ok: true,
    lineId: line.id,
    householdId: line.household_id,
    label: ata.display_name || line.child_label || line.name,
    hasGreeting: Boolean(line.greeting_path),
    greetingUpdatedAt: line.greeting_updated_at ?? null,
    unreadCount: Number(unread?.n || 0),
    messageCount: Number(total?.n || 0),
  };
}

/** Recipient-line voicemails with audio for ATA IVR playback (new first, then older). */
export function listAtaMailboxMessages(
  db: Database.Database,
  lineId: string
): Array<{
  id: string;
  from_label: string;
  listened: number;
  created_at: string;
  audio_path: string;
}> {
  return db
    .prepare(
      `SELECT id, from_label, listened, created_at, audio_path FROM voicemails
       WHERE to_line_id = ? AND audio_path IS NOT NULL
       ORDER BY listened ASC, created_at ASC
       LIMIT 40`
    )
    .all(lineId) as Array<{
    id: string;
    from_label: string;
    listened: number;
    created_at: string;
    audio_path: string;
  }>;
}

/**
 * Stable 4-digit FXS CID number for softphone-only callers (not a PSTN number).
 * Prefer the caller's SIP extension when they have an ATA.
 */
export function softphoneCidNumber(lineId: string): string {
  let h = 2166136261;
  for (let i = 0; i < lineId.length; i++) {
    h ^= lineId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return String(1000 + ((h >>> 0) % 9000));
}

/**
 * Caller-ID name + number for an INVITE to an FXS (HT801).
 * Name = callee household’s allowlist nickname for the caller (privacy-friendly display).
 * Number = caller’s SIP extension if linked, else a stable pseudo-extension.
 */
export function fxsCallerIdentity(
  db: Database.Database,
  fromLineId: string,
  toLineId: string
): { cidName: string; cidNumber: string } {
  const to = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(toLineId) as Line | undefined;
  const cidName = to ? peerLabelForHousehold(db, to.household_id, fromLineId) : "Someone";
  const fromAta = getAtaByLineId(db, fromLineId);
  const cidNumber = fromAta?.sip_extension || softphoneCidNumber(fromLineId);
  return { cidName, cidNumber };
}

/**
 * Map ATA CallerID extension + dialed digits → PhoneHome lines using allowlist speed dial.
 * Digit "0" → TreeHouse (pad #0).
 * Digit "1" → admin parent (kid pad locked slot).
 * Digit "2" → secondary parent when present, else allowlist speed_dial 2.
 * Digits "3"–"9" → speed_dial slots.
 * Digits "911" / "933" → admin parent (interim E911 until PSTN trunk).
 */
export function resolveAtaDial(
  db: Database.Database,
  sipExtension: string,
  dialedRaw: string
):
  | {
      ok: true;
      treeHouse?: false;
      fromLineId: string;
      toLineId: string;
      fromLabel: string;
      toLabel: string;
      /** Callee-facing CID / screening name (allowlist nickname). */
      cidName: string;
      /** Numeric CID for FXS display (caller SIP ext or stable pseudo). */
      cidNumber: string;
      dialed: string;
      /** FreePBX SIP extension for target ATA, if linked. */
      toSipExtension: string | null;
    }
  | {
      ok: true;
      treeHouse: true;
      fromLineId: string;
      householdId: string;
      fromLabel: string;
      toLabel: string;
      dialed: string;
    }
  | {
      ok: false;
      reason: string;
      voice?: UnavailableVoice;
      spoken?: string;
      side?: "caller" | "callee" | "both";
    } {
  const ata = getAtaBySipExtension(db, sipExtension);
  if (!ata) return { ok: false, reason: "Unknown ATA extension — link it in PhoneHome first" };
  const from = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(ata.line_id) as Line | undefined;
  if (!from) return { ok: false, reason: "ATA line missing" };

  const dialed = String(dialedRaw || "").replace(/\D/g, "");
  if (!dialed) return { ok: false, reason: "No digits dialed" };

  const hhId = from.household_id;
  const fromLabel = ata.display_name || from.child_label || from.name;

  // Dial 0 = TreeHouse (pad #0). Never resolve allowlist.speed_dial=0 leftovers.
  if (dialed === "0") {
    const hh = db.prepare(`SELECT kill_switch FROM households WHERE id = ?`).get(hhId) as
      | { kill_switch: number }
      | undefined;
    if (hh?.kill_switch) {
      return { ok: false, reason: "Timeout is on" };
    }
    if (!canJoinFamilyRoom(db, hhId, from.id)) {
      const mode = (from.mode || "parent") as string;
      return {
        ok: false,
        reason:
          mode === "child"
            ? "Ask a parent to approve you for TreeHouse"
            : "Parents use listen-only in the app — TreeHouse pad is for kids",
      };
    }
    return {
      ok: true,
      treeHouse: true,
      fromLineId: from.id,
      householdId: hhId,
      fromLabel,
      toLabel: "TreeHouse",
      dialed,
    };
  }

  // Dial 1 = admin parent (kid pad locked slot). 911 / 933 = same parent until real PSTN E911.
  if (dialed === "1" || isEmergencyDial(dialed)) {
    const parent = householdAdminParentLine(db, hhId);
    if (!parent) {
      return {
        ok: false,
        reason: isEmergencyDial(dialed)
          ? "No parent line for emergency dial"
          : "No parent line for Home (1)",
      };
    }
    if (from.id === parent.id) {
      return {
        ok: false,
        reason: isEmergencyDial(dialed) ? "Can't emergency-dial yourself" : "Can't call your own line",
      };
    }
    if (!isEmergencyDial(dialed)) {
      const check = canCall(db, from.id, parent.id);
      if (!check.ok) {
        return {
          ok: false,
          reason: check.reason,
          voice: check.voice,
          spoken: check.spoken,
          side: check.side,
        };
      }
    }
    const toAta = getAtaByLineId(db, parent.id);
    const toLabel = isEmergencyDial(dialed)
      ? `Emergency → ${parentDisplayLabel(db, parent.id)}`
      : parentDisplayLabel(db, parent.id);
    const { cidName, cidNumber } = fxsCallerIdentity(db, from.id, parent.id);
    return {
      ok: true,
      fromLineId: from.id,
      toLineId: parent.id,
      fromLabel,
      toLabel,
      cidName,
      cidNumber,
      dialed,
      toSipExtension: toAta?.sip_extension ?? null,
    };
  }

  // Dial 2 = secondary parent when present, else allowlist slot 2.
  if (dialed === "2") {
    const secondary = householdSecondaryParentLine(db, hhId);
    if (secondary && secondary.id !== from.id) {
      const check = canCall(db, from.id, secondary.id);
      if (!check.ok) {
        return {
          ok: false,
          reason: check.reason,
          voice: check.voice,
          spoken: check.spoken,
          side: check.side,
        };
      }
      const toAta = getAtaByLineId(db, secondary.id);
      const { cidName, cidNumber } = fxsCallerIdentity(db, from.id, secondary.id);
      return {
        ok: true,
        fromLineId: from.id,
        toLineId: secondary.id,
        fromLabel,
        toLabel: parentDisplayLabel(db, secondary.id),
        cidName,
        cidNumber,
        dialed,
        toSipExtension: toAta?.sip_extension ?? null,
      };
    }
  }

  let entry = db
    .prepare(
      `SELECT * FROM allowlist WHERE household_id = ? AND speed_dial = ?`
    )
    .get(hhId, Number(dialed)) as AllowlistEntry | undefined;

  // Same-household sibling by speed dial on synthetic contacts: also allow matching
  // other household lines when dialed equals their assigned allowlist slot from this HH.
  if (!entry && dialed.length === 1) {
    entry = db
      .prepare(
        `SELECT * FROM allowlist WHERE household_id = ? AND CAST(speed_dial AS TEXT) = ?`
      )
      .get(hhId, dialed) as AllowlistEntry | undefined;
  }

  if (!entry) {
    return { ok: false, reason: `No speed-dial contact for ${dialed}` };
  }

  const check = canCall(db, from.id, entry.target_line_id);
  if (!check.ok) {
    return {
      ok: false,
      reason: check.reason,
      voice: check.voice,
      spoken: check.spoken,
      side: check.side,
    };
  }

  const to = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(entry.target_line_id) as Line | undefined;
  const toAta = getAtaByLineId(db, entry.target_line_id);
  const toLabel = entry.label || to?.child_label || to?.name || "Contact";
  const { cidName, cidNumber } = fxsCallerIdentity(db, from.id, entry.target_line_id);
  return {
    ok: true,
    fromLineId: from.id,
    toLineId: entry.target_line_id,
    fromLabel,
    toLabel,
    cidName,
    cidNumber,
    dialed,
    toSipExtension: toAta?.sip_extension ?? null,
  };
}

/**
 * Softphone / bridge: choose WebRTC peer vs FXS for an allowlisted call.
 * Lines with `ata_devices` prefer the kid ATA (FXS-first). When a softphone
 * is also online on that line, inbound still defaults to the analog phone.
 */
export function routeCallTarget(
  db: Database.Database,
  fromLineId: string,
  toLineId: string
):
  | {
      ok: true;
      fromLineId: string;
      toLineId: string;
      toSipExtension: string | null;
      preferFxs: boolean;
      cidName: string;
      cidNumber: string;
    }
  | { ok: false; reason: string } {
  const check = canCall(db, fromLineId, toLineId);
  if (!check.ok) return { ok: false, reason: check.reason };
  const ata = getAtaByLineId(db, toLineId);
  const { cidName, cidNumber } = fxsCallerIdentity(db, fromLineId, toLineId);
  return {
    ok: true,
    fromLineId,
    toLineId,
    toSipExtension: ata?.sip_extension ?? null,
    preferFxs: Boolean(ata),
    cidName,
    cidNumber,
  };
}

/** Mint a short-lived session so the SIP bridge can claim a line on the WS. */
export function createBridgeSession(
  db: Database.Database,
  lineId: string,
  hours = 12
): { sessionId: string; userId: string; lineId: string } {
  const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line | undefined;
  if (!line) throw new Error("Line not found");
  const userId = line.child_user_id || line.owner_user_id;
  const session = createSession(db, userId, Math.max(1, Math.ceil(hours / 24)) || 1);
  // Tighten expiry for bridge use
  const expires = new Date(Date.now() + hours * 3600e3).toISOString();
  db.prepare(`UPDATE sessions SET expires_at = ? WHERE id = ?`).run(expires, session.id);
  return { sessionId: session.id, userId, lineId };
}

/** In-memory live 1:1 calls (for parent visibility of child lines). */
export type LiveCallEntry = {
  callId: string;
  fromLineId: string;
  toLineId: string;
  status: "ringing" | "active";
};

const liveCalls = new Map<string, LiveCallEntry>();

export function setLiveCall(entry: LiveCallEntry): void {
  liveCalls.set(entry.callId, entry);
}

export function clearLiveCall(callId: string): void {
  if (callId) liveCalls.delete(callId);
}

export function clearLiveCallsForLine(lineId: string): string[] {
  const removed: string[] = [];
  for (const [id, c] of liveCalls) {
    if (c.fromLineId === lineId || c.toLineId === lineId) {
      liveCalls.delete(id);
      removed.push(id);
    }
  }
  return removed;
}

export function peerLabelForHousehold(
  db: Database.Database,
  householdId: string,
  peerLineId: string
): string {
  const line = db.prepare(`SELECT name, child_label, IFNULL(mode, 'parent') AS mode FROM lines WHERE id = ?`).get(
    peerLineId
  ) as { name: string; child_label: string | null; mode: string } | undefined;
  // Mom / Dad title beats allowlist nicknames (e.g. leftover "Trevor") for parent lines.
  if (line && line.mode !== "child") {
    const titled = parentDisplayLabel(db, peerLineId);
    if (titled === "Mom" || titled === "Dad") return titled;
  }
  const al = db
    .prepare(`SELECT label FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
    .get(householdId, peerLineId) as { label: string } | undefined;
  if (al?.label?.trim()) return al.label.trim();
  if (line && line.mode !== "child") return parentDisplayLabel(db, peerLineId);
  if (line?.child_label?.trim()) return line.child_label.trim();
  return line?.name?.replace(/'s phone$/i, "").trim() || "Someone";
}

export function liveCallsForHousehold(db: Database.Database, householdId: string) {
  return liveCallsForViewer(db, householdId, null);
}

/** Live child-line calls visible to household parents or guardians of those lines. */
export function liveCallsForViewer(
  db: Database.Database,
  householdId: string,
  viewerUserId: string | null
) {
  const lines = db.prepare(`SELECT * FROM lines WHERE household_id = ?`).all(householdId) as Line[];
  const byId = new Map(lines.map((l) => [l.id, l]));
  const childIds = new Set(
    lines.filter((l) => (l.mode || "parent") === "child").map((l) => l.id)
  );
  if (!childIds.size) return [];

  const out: {
    callId: string;
    lineId: string;
    lineName: string;
    peerLineId: string;
    peerLabel: string;
    direction: "outbound" | "inbound";
    status: "ringing" | "active";
  }[] = [];

  const viewerIsMember = viewerUserId ? userInHousehold(db, householdId, viewerUserId) : true;

  for (const c of liveCalls.values()) {
    const childIsFrom = childIds.has(c.fromLineId);
    const childIsTo = childIds.has(c.toLineId);
    if (!childIsFrom && !childIsTo) continue;
    const childId = childIsFrom ? c.fromLineId : c.toLineId;
    const child = byId.get(childId);
    if (!child) continue;
    if (
      viewerUserId &&
      !viewerIsMember &&
      !isGuardian(db, viewerUserId, childId)
    ) {
      continue;
    }
    const peerLineId = childIsFrom ? c.toLineId : c.fromLineId;
    out.push({
      callId: c.callId,
      lineId: childId,
      lineName: child.child_label || child.name,
      peerLineId,
      peerLabel: peerLabelForHousehold(db, householdId, peerLineId),
      direction: childIsFrom ? "outbound" : "inbound",
      status: c.status,
    });
  }
  return out;
}

export { getSessionUser, createSession, hashCode };
