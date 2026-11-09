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
  type InviteKind,
  type Session,
} from "./db.js";
import { buildHt801ConfigXml, formatConfigServerPath, normalizeAtaModel, normalizeMac } from "./ht801.js";
import { ataSetupModeForDevice, householdUsesLanAtaSetup } from "./ataSetup.js";
import { ataFreepbxSyncMode } from "./freepbxSync.js";
import { buildG100sConfigTxt, formatFanvilProvisionUrl } from "./g100s.js";
import { isUsFederalHoliday } from "./usHolidays.js";
import {
  spokenFor,
  type UnavailableVoice,
} from "./unavailableVoice.js";
import {
  adultFacingGrandparentLabel,
  grandparentLabelsFromHints,
  inferGrandparentHonorific,
  lookupGrandparentPadLabels,
  normalizeKidNickname,
} from "./grandparentLabel.js";
import {
  buildGrandparentsMenuPrompt,
  ensureKidMultiPodGrandparentAllowlists,
  listKidGrandparentMenuChoices,
  peekGrandparentDialCollapse,
  syncGrandparentDialCollapse,
} from "./grandparentsMenu.js";
import {
  assertMothershipCanAddLine,
  assertMothershipCanAddPod,
  getMothershipStats,
} from "./mothershipLimits.js";
import {
  circleBillingCallBlock,
  deleteCircleBillingRow,
  ensureCircleBillingRow,
  ensureMothershipOperator,
  getMothershipBillingSettings,
  listCircleBillingForParent,
  mothershipOperatorMeta,
} from "./mothershipBilling.js";

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
  ensureMothershipOperator(db, user.id, "owner");
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
  ensureProvisionedRelativeProfileRole(db, user.id);
  const session = createSession(db, user.id);
  const fresh = db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id) as User;
  return { user: fresh, session };
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
    profile_role: opts.profile_role ?? "parent",
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
  parent_title: string | null;
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
  // Joined a Pod as a parent (sibling invite) — stay a parent even before adding a phone line.
  if (
    db
      .prepare(`SELECT 1 FROM household_members WHERE user_id = ? AND role = 'parent' LIMIT 1`)
      .get(userId)
  ) {
    return false;
  }
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
export const TEST_REVIEW_CONTACT_USERNAME = "cameron";

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

/** Own lines + every line owned by username `cameron`. Nothing else — ever. */
export function testReviewAllowedLineIds(db: Database.Database, testUserId: string): Set<string> {
  const ids = new Set<string>();
  for (const row of db
    .prepare(`SELECT id FROM lines WHERE owner_user_id = ? OR child_user_id = ?`)
    .all(testUserId, testUserId) as { id: string }[]) {
    ids.add(row.id);
  }
  const cameron = db
    .prepare(`SELECT id FROM users WHERE lower(IFNULL(username, '')) = ?`)
    .get(TEST_REVIEW_CONTACT_USERNAME) as { id: string } | undefined;
  if (cameron) {
    // Cameron’s own phone only — never kid lines he owns (Alex + Riley).
    for (const row of db
      .prepare(`SELECT id FROM lines WHERE owner_user_id = ? AND IFNULL(mode, 'parent') = 'parent'`)
      .all(cameron.id) as { id: string }[]) {
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

/** Review softphone is invisible to everyone except Test and Cameron. */
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
      throw new Error("Test account may only contact Cameron");
    }
    return;
  }
  if (isTestReviewLineId(db, lineId) && !isTestReviewContactAccount(db, userId)) {
    throw new Error("Test account is only available to Cameron");
  }
}

/**
 * Self-heal bidirectional isolation:
 * - Test’s allowlist/circle → Cameron + self only
 * - Test’s line stripped from every other family’s allowlist/circle (Cameron kept)
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

/** Parents/co-parents on a Pod — never kid-only logins. */
export function householdParentUserIds(db: Database.Database, householdId: string): string[] {
  const members = db
    .prepare(`SELECT user_id FROM household_members WHERE household_id = ?`)
    .all(householdId) as { user_id: string }[];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const m of members) {
    if (!m.user_id || seen.has(m.user_id) || isChildOnlyAccount(db, m.user_id)) continue;
    seen.add(m.user_id);
    ids.push(m.user_id);
  }
  return ids;
}

/**
 * Pods a child belongs to: their line’s household plus every Pod where any
 * guardian is a parent/member. All kids are multi-Pod when parents span family names
 * (Sam → North via Drew + West via Morgan; Alex → North + East).
 */
export function podsForKid(db: Database.Database, kidLineId: string): string[] {
  const kid = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(kidLineId) as Line | undefined;
  if (!kid || (kid.mode || "parent") !== "child") return [];
  const out = new Set<string>([kid.household_id]);
  const guardians = db
    .prepare(`SELECT user_id FROM child_guardians WHERE line_id = ?`)
    .all(kidLineId) as { user_id: string }[];
  for (const g of guardians) {
    if (!g.user_id || isChildOnlyAccount(db, g.user_id)) continue;
    const pods = db
      .prepare(`SELECT household_id FROM household_members WHERE user_id = ?`)
      .all(g.user_id) as { household_id: string }[];
    for (const p of pods) {
      if (p.household_id) out.add(p.household_id);
    }
  }
  return [...out];
}

export function kidBelongsToPod(
  db: Database.Database,
  kidLineId: string,
  householdId: string
): boolean {
  if (!householdId) return false;
  return podsForKid(db, kidLineId).includes(householdId);
}

/** Child lines that belong to this Pod (canonical home or via a guardian on the Pod). */
export function kidsBelongingToPod(db: Database.Database, householdId: string): Line[] {
  const seen = new Set<string>();
  const out: Line[] = [];
  const add = (line: Line | undefined) => {
    if (!line || (line.mode || "parent") !== "child" || seen.has(line.id)) return;
    if (!kidBelongsToPod(db, line.id, householdId)) return;
    seen.add(line.id);
    out.push(normalizeLine(line));
  };
  for (const l of db.prepare(`SELECT * FROM lines WHERE household_id = ?`).all(householdId) as Line[]) {
    add(l);
  }
  for (const parentId of householdParentUserIds(db, householdId)) {
    const guarded = db
      .prepare(
        `SELECT l.* FROM lines l
         JOIN child_guardians g ON g.line_id = l.id
         WHERE g.user_id = ? AND IFNULL(l.mode, 'parent') = 'child'`
      )
      .all(parentId) as Line[];
    for (const kid of guarded) add(kid);
  }
  return out;
}

/** Pods for a line: kids use podsForKid; adults use households they belong to. */
export function podsForLine(db: Database.Database, lineId: string): string[] {
  const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line | undefined;
  if (!line) return [];
  if ((line.mode || "parent") === "child") return podsForKid(db, lineId);
  if (!line.owner_user_id) return [line.household_id];
  const pods = db
    .prepare(`SELECT household_id FROM household_members WHERE user_id = ?`)
    .all(line.owner_user_id) as { household_id: string }[];
  const out = new Set<string>([line.household_id]);
  for (const p of pods) {
    if (p.household_id) out.add(p.household_id);
  }
  return [...out];
}

/** True when two lines share any family-name Pod (multi-Pod kids included). */
export function linesShareFamilyPod(
  db: Database.Database,
  lineAId: string,
  lineBId: string
): boolean {
  if (!lineAId || !lineBId || lineAId === lineBId) return false;
  const a = new Set(podsForLine(db, lineAId));
  if (!a.size) return false;
  for (const id of podsForLine(db, lineBId)) {
    if (a.has(id)) return true;
  }
  return false;
}

export type KidAuntUncleOption = {
  id: string;
  label: string;
  name: string;
  household_id: string;
  on: boolean;
  has_avatar: boolean;
  avatar_updated_at: string | null;
};

/**
 * Aunts/uncles a kid’s parents may put on that kid’s pad: parents in any Pod the kid
 * belongs to who aren’t the kid’s own guardians. `on` = a guardian added them.
 */
export function listKidAuntUncleOptions(db: Database.Database, kidLineId: string): KidAuntUncleOption[] {
  const kid = db.prepare(`SELECT id, mode FROM lines WHERE id = ?`).get(kidLineId) as
    | { id: string; mode: string | null }
    | undefined;
  if (!kid || kid.mode !== "child") return [];
  const approved = new Set(
    (
      db.prepare(`SELECT adult_line_id FROM kid_adult_contacts WHERE kid_line_id = ?`).all(kidLineId) as {
        adult_line_id: string;
      }[]
    ).map((r) => r.adult_line_id)
  );
  const seenUsers = new Set<string>();
  const out: KidAuntUncleOption[] = [];
  for (const podId of podsForKid(db, kidLineId)) {
    for (const userId of householdParentUserIds(db, podId)) {
      if (seenUsers.has(userId) || isGuardian(db, userId, kidLineId)) continue;
      if (isGrandparentPeerAccount(db, userId)) continue;
      seenUsers.add(userId);
      const onPod = db
        .prepare(
          `SELECT * FROM lines WHERE household_id = ? AND owner_user_id = ? AND mode = 'parent'
           ORDER BY created_at LIMIT 1`
        )
        .get(podId, userId) as Line | undefined;
      const line = onPod ? normalizeLine(onPod) : parentLineForUser(db, userId);
      if (!line || line.mode !== "parent") continue;
      const pub = publicLineAvatar(line);
      out.push({
        id: line.id,
        label: kidFacingAdultLabel(db, line.id, kidLineId),
        name: firstGivenName(line.name) || line.name,
        household_id: line.household_id,
        on: approved.has(line.id),
        has_avatar: Boolean(pub.has_avatar),
        avatar_updated_at: pub.avatar_updated_at ?? null,
      });
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

/** True when this kid’s parent put this aunt/uncle on the kid’s pad and they still share a Pod. */
export function kidHasApprovedAuntUncle(db: Database.Database, kidLineId: string, adultLineId: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM kid_adult_contacts WHERE kid_line_id = ? AND adult_line_id = ?`)
    .get(kidLineId, adultLineId);
  if (!row) return false;
  return listKidAuntUncleOptions(db, kidLineId).some((o) => o.id === adultLineId);
}

/** A kid’s guardian adds / removes an aunt or uncle on that kid’s pad. */
export function setKidAuntUncle(
  db: Database.Database,
  actorUserId: string,
  kidLineId: string,
  adultLineId: string,
  on: boolean
): KidAuntUncleOption[] {
  if (!canManageChild(db, actorUserId, kidLineId)) throw new Error("Only this child’s parents can change that");
  if (on) {
    if (!listKidAuntUncleOptions(db, kidLineId).some((o) => o.id === adultLineId)) {
      throw new Error("Only aunts and uncles in this child’s family can be added");
    }
    db.prepare(
      `INSERT OR IGNORE INTO kid_adult_contacts (kid_line_id, adult_line_id, added_by_user_id, created_at)
       VALUES (?, ?, ?, ?)`
    ).run(kidLineId, adultLineId, actorUserId, nowIso());
  } else {
    db.prepare(`DELETE FROM kid_adult_contacts WHERE kid_line_id = ? AND adult_line_id = ?`).run(
      kidLineId,
      adultLineId
    );
  }
  return listKidAuntUncleOptions(db, kidLineId);
}

/**
 * Other kids this child can call as same-family Pod peers (Quinn/Sam for Alex
 * via North). Read-only for snapshots — never put these on a parent’s softphone pad.
 */
export function listKidPodFamilyPeers(
  db: Database.Database,
  kidLineId: string
): {
  id: string;
  child_label: string | null;
  name: string;
  household_id: string;
  has_avatar: boolean;
  avatar_updated_at: string | null;
}[] {
  const kid = db.prepare(`SELECT id, mode FROM lines WHERE id = ?`).get(kidLineId) as
    | { id: string; mode: string | null }
    | undefined;
  if (!kid || (kid.mode || "parent") !== "child") return [];
  const seen = new Set<string>([kidLineId]);
  const out: {
    id: string;
    child_label: string | null;
    name: string;
    household_id: string;
    has_avatar: boolean;
    avatar_updated_at: string | null;
  }[] = [];
  for (const podId of podsForKid(db, kidLineId)) {
    for (const peer of kidsBelongingToPod(db, podId)) {
      if (seen.has(peer.id)) continue;
      seen.add(peer.id);
      const pub = publicLineAvatar(peer);
      out.push({
        id: peer.id,
        child_label: peer.child_label,
        name: peer.name,
        household_id: peer.household_id,
        has_avatar: Boolean(pub.has_avatar),
        avatar_updated_at: pub.avatar_updated_at ?? null,
      });
    }
  }
  out.sort((a, b) =>
    String(a.child_label || a.name).localeCompare(String(b.child_label || b.name), undefined, {
      sensitivity: "base",
    })
  );
  return out;
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

/**
 * Analog / Kids / Circles / ATA for a child line — guardians only.
 * Pod membership alone must not let Jordan manage Sam/Quinn (or Casey manage Alex).
 */
export function canManageChild(db: Database.Database, userId: string, lineId: string): boolean {
  const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line | undefined;
  if (!line) return false;
  if ((line.mode || "parent") === "child") {
    return isGuardian(db, userId, lineId);
  }
  // Non-child lines: keep prior household gate for rare callers.
  if (isGuardian(db, userId, lineId)) return true;
  return userInHousehold(db, line.household_id, userId);
}

/**
 * Softphone / WS claim: own parent line, child lines you guard, child login, or
 * Open-their-phone for a provisioned grandparent. Pod membership alone must not
 * grant another parent’s line (Casey ≠ Jordan) or a co-parent’s kid line
 * (Casey ≠ Alex+Riley, Jordan ≠ Quinn).
 */
export function userCanOperateLine(
  db: Database.Database,
  userId: string,
  lineId: string
): boolean {
  const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line | undefined;
  if (!line) return false;
  if (line.owner_user_id === userId) return true;
  if (line.child_user_id === userId) return true;
  if (canAdminProvisionedRelativeLine(db, userId, lineId)) return true;
  if ((line.mode || "parent") === "child") {
    return isGuardian(db, userId, lineId);
  }
  return false;
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
      `SELECT g.user_id, g.role, g.created_at, u.display_name, u.username, u.parent_title
       FROM child_guardians g JOIN users u ON u.id = g.user_id
       WHERE g.line_id = ?
       ORDER BY g.created_at`
    )
    .all(lineId) as PublicGuardian[];
}

/**
 * Co-parent redeem: never join the kid’s Pod (Morgan ≠ North).
 * If they have no Pod yet, create one from their family name (West).
 */
export function ensureFamilyNamePod(
  db: Database.Database,
  userId: string,
  familyName?: string
): string {
  const existing = primaryHouseholdIdForUser(db, userId);
  if (existing) return existing;
  const name = String(familyName || "").trim().slice(0, 64);
  if (!name) {
    throw new Error("Name your family first (e.g. North or West)");
  }
  return createHousehold(db, userId, name).id;
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
  // Must already have a family-name Pod — co-parents do not join the kid’s Pod.
  if (!primaryHouseholdIdForUser(db, target.id)) {
    throw new Error("That parent needs a family name Pod first (e.g. West)");
  }

  ensureGuardian(db, lineId, target.id);
  const coSphere = ensureSphereForParent(db, target.id);
  grantLineSphereAccess(db, lineId, coSphere.id);
  syncGuardianCoParentAllowlist(db, lineId, target.id);
  syncKidFamilyLinks(db, lineId);
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
  unlinkRemovedGuardian(db, line, targetUserId);

  const stillGuardian = db
    .prepare(
      `SELECT 1 FROM child_guardians g
       JOIN lines l ON l.id = g.line_id
       WHERE l.household_id = ? AND g.user_id = ?
       LIMIT 1`
    )
    .get(line.household_id, targetUserId);
  if (!stillGuardian) {
    const ownsLine = db
      .prepare(`SELECT 1 FROM lines WHERE household_id = ? AND owner_user_id = ? LIMIT 1`)
      .get(line.household_id, targetUserId);
    if (!ownsLine && !isHouseholdOwner(db, line.household_id, targetUserId)) {
      db.prepare(`DELETE FROM household_members WHERE household_id = ? AND user_id = ?`).run(
        line.household_id,
        targetUserId
      );
    }
  }
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
    expires_at: new Date(Date.now() + 48 * 3600e3).toISOString(),
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
  codeRaw: string,
  opts: { householdName?: string } = {}
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

  // Family name Pod only — never join the kid’s Pod (Morgan ≠ North when co-parenting Sam).
  ensureFamilyNamePod(db, userId, opts.householdName);
  ensureGuardian(db, line.id, userId);
  const coSphere = ensureSphereForParent(db, userId);
  // New co-parent’s circle is available on this kid’s pad until parents narrow it.
  grantLineSphereAccess(db, line.id, coSphere.id);
  syncGuardianCoParentAllowlist(db, line.id, userId);
  syncKidFamilyLinks(db, line.id);
  db.prepare(`UPDATE guardian_invites SET redeemed_by_user_id = ? WHERE id = ?`).run(userId, invite.id);
  return { line: normalizeLine(line), guardians: listGuardians(db, line.id) };
}

/**
 * After a guardian is removed: drop the co-parent rows, the kid on their Pod book,
 * their Circle access to the kid, and grandparents from Pods the kid no longer
 * belongs to. Rows still justified by another shared kid stay.
 */
function unlinkRemovedGuardian(db: Database.Database, kid: Line, removedUserId: string): void {
  const removedLines = db
    .prepare(
      `SELECT * FROM lines WHERE owner_user_id = ? AND IFNULL(mode, 'parent') = 'parent'`
    )
    .all(removedUserId) as Line[];
  const removedLineIds = new Set(removedLines.map((l) => l.id));
  const removedHhs = new Set(removedLines.map((l) => l.household_id));
  const remaining = guardianParentLinesForChild(db, kid.id);
  const sharesAnotherKid = (userA: string, userB: string) =>
    Boolean(
      db
        .prepare(
          `SELECT 1 FROM child_guardians a JOIN child_guardians b ON a.line_id = b.line_id
           WHERE a.user_id = ? AND b.user_id = ? LIMIT 1`
        )
        .get(userA, userB)
    );
  const del = db.prepare(`DELETE FROM allowlist WHERE household_id = ? AND target_line_id = ?`);

  // Removed parent off the kid’s home Pod + remaining guardians’ Pods (and vice versa).
  const theirSideHhs = new Set([kid.household_id, ...remaining.map((l) => l.household_id)]);
  for (const hhId of theirSideHhs) {
    if (removedHhs.has(hhId)) continue;
    const owners = new Set([
      ...remaining.filter((l) => l.household_id === hhId).map((l) => l.owner_user_id),
      ...householdParentUserIds(db, hhId),
    ]);
    const stillLinked = [...owners].some((o) => sharesAnotherKid(removedUserId, o));
    if (stillLinked) continue;
    for (const lineId of removedLineIds) del.run(hhId, lineId);
  }
  const kidPods = new Set(podsForKid(db, kid.id));
  for (const hhId of removedHhs) {
    if (!kidPods.has(hhId)) del.run(hhId, kid.id);
    for (const g of remaining) {
      if (g.household_id === hhId || sharesAnotherKid(removedUserId, g.owner_user_id)) continue;
      del.run(hhId, g.id);
    }
  }

  const sphere = getSphereByOwner(db, removedUserId);
  if (sphere) {
    db.prepare(`DELETE FROM line_sphere_access WHERE line_id = ? AND sphere_id = ?`).run(kid.id, sphere.id);
    db.prepare(`DELETE FROM sphere_members WHERE sphere_id = ? AND line_id = ?`).run(sphere.id, kid.id);
  }

  // Grandparents from Pods this kid left (Grandma South after Reese is removed).
  const gps = db
    .prepare(`SELECT from_household_id, relative_line_id, relative_household_id FROM provisioned_relatives`)
    .all() as { from_household_id: string; relative_line_id: string; relative_household_id: string }[];
  const keptGpLines = new Set(
    gps.filter((g) => kidPods.has(g.from_household_id)).map((g) => g.relative_line_id)
  );
  const homeKids = db
    .prepare(`SELECT id FROM lines WHERE household_id = ? AND IFNULL(mode, 'parent') = 'child' AND id != ?`)
    .all(kid.household_id, kid.id) as { id: string }[];
  for (const g of gps) {
    if (keptGpLines.has(g.relative_line_id)) continue;
    const homeStillNeedsGp = homeKids.some((k) => kidBelongsToPod(db, k.id, g.from_household_id));
    if (!homeStillNeedsGp) del.run(kid.household_id, g.relative_line_id);
    if (!isSharedFamilyPodAllowlist(db, g.relative_household_id)) {
      del.run(g.relative_household_id, kid.id);
    }
  }
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
  kid_nickname: string | null;
  created_by: string;
  created_at: string;
};

export type PublicProvisionedRelative = {
  id: string;
  display_name: string;
  username: string | null;
  display_label: string | null;
  kid_nickname: string;
  kid_label: string;
  pod_name: string;
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
  const pod = db
    .prepare(`SELECT name FROM households WHERE id = ?`)
    .get(fromHouseholdId) as { name: string } | undefined;
  if (!user || !hh) return null;
  const labels = grandparentLabelsFromHints({
    podName: pod?.name,
    displayName: user.display_name,
    displayLabel: row.display_label,
    username: user.username,
    kidNickname: row.kid_nickname,
  });
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
    kid_nickname: labels.nickname,
    kid_label: labels.kid,
    pod_name: pod?.name || "Family",
    household_name: hh.name,
    line_id: row.relative_line_id,
    household_id: row.relative_household_id,
    profile_role: "grandparent",
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

export function getProvisionedRelativeRow(
  db: Database.Database,
  fromHouseholdId: string,
  relativeId: string
): ProvisionedRelativeRow | undefined {
  return db
    .prepare(`SELECT * FROM provisioned_relatives WHERE id = ? AND from_household_id = ?`)
    .get(relativeId, fromHouseholdId) as ProvisionedRelativeRow | undefined;
}

/** Parent-provisioned grandparent login (table row), regardless of profile_role drift. */
export function isProvisionedRelativeUser(
  db: Database.Database,
  userId: string
): boolean {
  return Boolean(
    db
      .prepare(`SELECT 1 FROM provisioned_relatives WHERE relative_user_id = ? LIMIT 1`)
      .get(userId)
  );
}

export function isProvisionedRelativeLine(
  db: Database.Database,
  lineId: string
): boolean {
  return Boolean(
    db
      .prepare(`SELECT 1 FROM provisioned_relatives WHERE relative_line_id = ? LIMIT 1`)
      .get(lineId)
  );
}

/**
 * Grandparent “peer” accounts: provisioned relatives and profile_role=grandparent.
 * These pads must never see or call each other, even when they share a grandchild.
 */
export function isGrandparentPeerAccount(
  db: Database.Database,
  userId: string
): boolean {
  if (!userId) return false;
  if (isProvisionedRelativeUser(db, userId)) return true;
  const user = db.prepare(`SELECT profile_role FROM users WHERE id = ?`).get(userId) as
    | { profile_role: string | null }
    | undefined;
  return normalizeProfileRole(user?.profile_role) === "grandparent";
}

export function isGrandparentPeerLine(db: Database.Database, lineId: string): boolean {
  if (!lineId) return false;
  const line = db.prepare(`SELECT mode, owner_user_id FROM lines WHERE id = ?`).get(lineId) as
    | { mode: string | null; owner_user_id: string }
    | undefined;
  if (!line) return false;
  if (line.mode === "grandparent") return true;
  if (line.mode === "child") return false;
  // Not yet stamped (older rows / merged GP accounts) — same answer as before mode existed.
  if (isProvisionedRelativeLine(db, lineId)) return true;
  return isGrandparentPeerAccount(db, line.owner_user_id);
}

/** Stamp a provisioned relative’s phone as a grandparent line (never a kid line). */
function markGrandparentLine(db: Database.Database, lineId: string): void {
  db.prepare(
    `UPDATE lines SET mode = 'grandparent' WHERE id = ? AND IFNULL(mode, 'parent') != 'child'`
  ).run(lineId);
}

/**
 * Grandchildren a GP may dial — kids on Pods they were provisioned from only.
 * Never co-parents from another Pod (Jordan on North ≠ East GP dial 2).
 */
export function listGrandparentDialKids(db: Database.Database, relativeUserId: string): Line[] {
  if (!relativeUserId) return [];
  const pods = db
    .prepare(
      `SELECT DISTINCT from_household_id FROM provisioned_relatives WHERE relative_user_id = ?`
    )
    .all(relativeUserId) as { from_household_id: string }[];
  const seen = new Set<string>();
  const out: Line[] = [];
  for (const { from_household_id } of pods) {
    if (!from_household_id) continue;
    for (const kid of kidsBelongingToPod(db, from_household_id)) {
      if (!kid?.id || seen.has(kid.id)) continue;
      if ((kid.mode || "parent") !== "child") continue;
      seen.add(kid.id);
      out.push(normalizeLine(kid));
    }
  }
  out.sort((a, b) => {
    const an = String(a.child_label || a.name || "");
    const bn = String(b.child_label || b.name || "");
    const cmp = an.localeCompare(bn, undefined, { sensitivity: "base" });
    if (cmp) return cmp;
    return String(a.created_at || a.id).localeCompare(String(b.created_at || b.id));
  });
  return out;
}

/**
 * Parent phones of the parents *in* a GP’s provisioning Pod(s) (North GPs ↔ Casey,
 * Drew, Jordan). Never co-parents who live on another Pod (Morgan ≠ North GP book).
 */
export function listGrandparentPodParentLines(
  db: Database.Database,
  relativeUserId: string
): Line[] {
  if (!relativeUserId) return [];
  const pods = db
    .prepare(
      `SELECT DISTINCT from_household_id FROM provisioned_relatives WHERE relative_user_id = ?`
    )
    .all(relativeUserId) as { from_household_id: string }[];
  const seen = new Set<string>();
  const out: Line[] = [];
  for (const { from_household_id } of pods) {
    if (!from_household_id) continue;
    for (const parentId of householdParentUserIds(db, from_household_id)) {
      if (parentId === relativeUserId || isGrandparentPeerAccount(db, parentId)) continue;
      const onPod = db
        .prepare(
          `SELECT * FROM lines WHERE household_id = ? AND owner_user_id = ?
             AND IFNULL(mode, 'parent') = 'parent' ORDER BY created_at LIMIT 1`
        )
        .get(from_household_id, parentId) as Line | undefined;
      const line = onPod ? normalizeLine(onPod) : parentLineForUser(db, parentId);
      if (!line || seen.has(line.id) || isGrandparentPeerLine(db, line.id)) continue;
      seen.add(line.id);
      out.push(line);
    }
  }
  return out;
}

/**
 * What a Pod grandparent may discover: auto grandchildren and that Pod’s parents,
 * plus adults they (or a parent managing their phone) added manually
 * (`allowlist.gp_manual`). Never other grandparents or another Pod’s co-parents.
 */
export function grandparentMaySeeLine(
  db: Database.Database,
  relativeUserId: string,
  target: Line
): boolean {
  if (!relativeUserId || !target?.id) return false;
  if (target.owner_user_id === relativeUserId) return true;
  if ((target.mode || "parent") === "child") {
    return listGrandparentDialKids(db, relativeUserId).some((k) => k.id === target.id);
  }
  // Peer GPs stay isolated even if a drifted allowlist row exists.
  if (isGrandparentPeerLine(db, target.id)) return false;
  if (listGrandparentPodParentLines(db, relativeUserId).some((l) => l.id === target.id)) return true;
  return grandparentManualAdultLineIds(db, relativeUserId).has(target.id);
}

/** Adult line ids on a GP book marked `gp_manual` (explicit add, not auto sync). */
export function grandparentManualAdultLineIds(
  db: Database.Database,
  relativeUserId: string
): Set<string> {
  const out = new Set<string>();
  if (!relativeUserId) return out;
  const houses = db
    .prepare(
      `SELECT DISTINCT relative_household_id FROM provisioned_relatives WHERE relative_user_id = ?`
    )
    .all(relativeUserId) as { relative_household_id: string }[];
  for (const { relative_household_id } of houses) {
    if (!relative_household_id) continue;
    const rows = db
      .prepare(
        `SELECT a.target_line_id FROM allowlist a
         JOIN lines l ON l.id = a.target_line_id
         WHERE a.household_id = ? AND IFNULL(a.gp_manual, 0) = 1
           AND IFNULL(l.mode, 'parent') != 'child'`
      )
      .all(relative_household_id) as { target_line_id: string }[];
    for (const r of rows) {
      if (r.target_line_id) out.add(r.target_line_id);
    }
  }
  return out;
}

/**
 * Analog digit map for a GP handset: grandchildren first (stable name order),
 * then manually added adults (speed-dial / label order). Caps at 9 slots.
 */
export function listGrandparentAtaDialTargets(
  db: Database.Database,
  relativeUserId: string
): Line[] {
  const kids = listGrandparentDialKids(db, relativeUserId);
  const seen = new Set(kids.map((k) => k.id));
  const adults: Line[] = [];
  const houses = db
    .prepare(
      `SELECT DISTINCT relative_household_id FROM provisioned_relatives WHERE relative_user_id = ?`
    )
    .all(relativeUserId) as { relative_household_id: string }[];
  const adultRows: { target_line_id: string; speed_dial: number | null; label: string }[] = [];
  for (const { relative_household_id } of houses) {
    if (!relative_household_id) continue;
    const rows = db
      .prepare(
        `SELECT a.target_line_id, a.speed_dial, a.label FROM allowlist a
         JOIN lines l ON l.id = a.target_line_id
         WHERE a.household_id = ? AND IFNULL(a.gp_manual, 0) = 1
           AND IFNULL(l.mode, 'parent') != 'child'
         ORDER BY a.speed_dial IS NULL, a.speed_dial, a.label`
      )
      .all(relative_household_id) as {
      target_line_id: string;
      speed_dial: number | null;
      label: string;
    }[];
    adultRows.push(...rows);
  }
  adultRows.sort((a, b) => {
    const as = a.speed_dial == null ? 99 : a.speed_dial;
    const bs = b.speed_dial == null ? 99 : b.speed_dial;
    if (as !== bs) return as - bs;
    return String(a.label || "").localeCompare(String(b.label || ""), undefined, {
      sensitivity: "base",
    });
  });
  for (const row of adultRows) {
    if (!row.target_line_id || seen.has(row.target_line_id)) continue;
    const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(row.target_line_id) as
      | Line
      | undefined;
    if (!line) continue;
    seen.add(line.id);
    adults.push(normalizeLine(line));
  }
  // Pod parents go last so existing handset digits (kids, manual adults) don’t shift.
  for (const line of listGrandparentPodParentLines(db, relativeUserId)) {
    if (seen.has(line.id)) continue;
    seen.add(line.id);
    adults.push(line);
  }
  return [...kids, ...adults].slice(0, 9);
}

/** Keep provisioned grandma/grandpa accounts on the simple pad chrome. */
export function ensureProvisionedRelativeProfileRole(
  db: Database.Database,
  userId: string
): void {
  if (!isProvisionedRelativeUser(db, userId)) return;
  db.prepare(
    `UPDATE users SET profile_role = 'grandparent'
     WHERE id = ? AND IFNULL(profile_role, '') != 'grandparent'`
  ).run(userId);
}

/**
 * True when `targetLineId` is another parent’s line in a Pod the viewer also belongs to.
 * Co-parents share household rules but never each other’s Circle (Casey ≠ Jordan).
 */
export function isPodPeerParentLine(
  db: Database.Database,
  sphereOwnerUserId: string,
  targetLineId: string
): boolean {
  if (!sphereOwnerUserId || !targetLineId) return false;
  const target = db
    .prepare(
      `SELECT household_id, owner_user_id, IFNULL(mode, 'parent') AS mode FROM lines WHERE id = ?`
    )
    .get(targetLineId) as
    | { household_id: string; owner_user_id: string; mode: string }
    | undefined;
  if (!target || target.mode === "child") return false;
  if (target.owner_user_id === sphereOwnerUserId) return false;
  if (isChildOnlyAccount(db, sphereOwnerUserId)) return false;
  const shared = db
    .prepare(
      `SELECT 1 FROM household_members hm_viewer
       JOIN household_members hm_owner ON hm_owner.household_id = hm_viewer.household_id
       WHERE hm_viewer.user_id = ? AND hm_owner.user_id = ? AND hm_viewer.household_id = ?`
    )
    .get(sphereOwnerUserId, target.owner_user_id, target.household_id);
  return Boolean(shared);
}

/**
 * True when `lineId` belongs on this parent’s Circle via a friend invite
 * (Casey ↔ Ken/Owen for Quinn; Ken ↔ Quinn) — not Pod allowlist pollution.
 */
export function isFriendInviteCircleLine(
  db: Database.Database,
  sphereOwnerUserId: string,
  lineId: string
): boolean {
  if (!sphereOwnerUserId || !lineId) return false;
  const line = db
    .prepare(`SELECT household_id FROM lines WHERE id = ?`)
    .get(lineId) as { household_id: string } | undefined;
  if (!line) return false;

  // Inviter / Circle manager: friend Pod lines after redeeming for a guarded kid.
  const asManager = db
    .prepare(
      `SELECT 1 FROM invites i
       JOIN child_guardians g ON g.line_id = i.target_kid_line_id AND g.user_id = ?
       WHERE i.kind = 'friend'
         AND i.redeemed_by_household_id = ?
         AND i.target_kid_line_id IS NOT NULL
       LIMIT 1`
    )
    .get(sphereOwnerUserId, line.household_id);
  if (asManager) return true;

  // Redeemer: the invited kid line stays on the friend’s Circle after mutual approve.
  const asFriend = db
    .prepare(
      `SELECT 1 FROM invites i
       JOIN household_members hm
         ON hm.household_id = i.redeemed_by_household_id AND hm.user_id = ?
       WHERE i.kind = 'friend' AND i.target_kid_line_id = ?
       LIMIT 1`
    )
    .get(sphereOwnerUserId, lineId);
  return Boolean(asFriend);
}

/**
 * Friend Pods must keep a parent softphone so the inviting parent can approve them
 * (Ken on Casey’s pad) — even if they only created a kid line first.
 */
export function ensureParentSoftphoneLine(
  db: Database.Database,
  householdId: string,
  userId: string
): Line | null {
  const existing = db
    .prepare(
      `SELECT * FROM lines
       WHERE household_id = ? AND owner_user_id = ?
         AND IFNULL(mode, 'parent') IN ('parent', 'grandparent')
       LIMIT 1`
    )
    .get(householdId, userId) as Line | undefined;
  if (existing) return normalizeLine(existing);
  const user = db
    .prepare(`SELECT display_name FROM users WHERE id = ?`)
    .get(userId) as { display_name: string } | undefined;
  if (!user || isChildOnlyAccount(db, userId)) return null;
  const first = firstGivenName(user.display_name) || "Parent";
  return addLine(db, householdId, userId, `${first}'s phone`);
}

/**
 * Self-heal: re-bridge friend-invite Circles and ensure the friend has a parent line.
 * Runs before peer-parent scrub so approve-then-scrub cannot empty Ken’s Circle.
 */
export function repairFriendInviteSphereMembers(
  db: Database.Database,
  userId: string
): void {
  if (isChildOnlyAccount(db, userId)) return;

  const managed = (
    db
      .prepare(
        `SELECT i.* FROM invites i
         JOIN child_guardians g ON g.line_id = i.target_kid_line_id AND g.user_id = ?
         WHERE i.kind = 'friend' AND i.redeemed_by_household_id IS NOT NULL`
      )
      .all(userId) as Invite[]
  ).map(normalizeInvite);

  for (const inv of managed) {
    const friendHh = inv.redeemed_by_household_id!;
    for (const parentId of householdParentUserIds(db, friendHh)) {
      ensureParentSoftphoneLine(db, friendHh, parentId);
    }
    const friendLines = db
      .prepare(`SELECT id FROM lines WHERE household_id = ?`)
      .all(friendHh) as { id: string }[];
    const sph = ensureSphereForParent(db, userId);
    for (const l of friendLines) {
      addLineToSphere(db, sph.id, l.id, userId);
    }
  }

  const myHhs = db
    .prepare(`SELECT household_id FROM household_members WHERE user_id = ?`)
    .all(userId) as { household_id: string }[];
  for (const { household_id } of myHhs) {
    const invites = (
      db
        .prepare(
          `SELECT * FROM invites
           WHERE kind = 'friend' AND redeemed_by_household_id = ?`
        )
        .all(household_id) as Invite[]
    ).map(normalizeInvite);
    for (const inv of invites) {
      if (!inv.target_kid_line_id) continue;
      ensureParentSoftphoneLine(db, household_id, userId);
      const sph = ensureSphereForParent(db, userId);
      addLineToSphere(db, sph.id, inv.target_kid_line_id, userId);
    }
  }
}

/**
 * Self-heal: strip co-parent lines from another parent’s Circle (migration / legacy fan-out).
 */
export function scrubPodPeerParentCircleIsolation(
  db: Database.Database,
  userId: string
): void {
  if (isChildOnlyAccount(db, userId)) return;
  const sphere = getSphereByOwner(db, userId);
  if (!sphere) return;
  const members = db
    .prepare(`SELECT line_id FROM sphere_members WHERE sphere_id = ?`)
    .all(sphere.id) as { line_id: string }[];
  for (const m of members) {
    if (isPodPeerParentLine(db, userId, m.line_id)) {
      db.prepare(`DELETE FROM sphere_members WHERE sphere_id = ? AND line_id = ?`).run(
        sphere.id,
        m.line_id
      );
      continue;
    }
    const line = db
      .prepare(`SELECT IFNULL(mode, 'parent') AS mode FROM lines WHERE id = ?`)
      .get(m.line_id) as { mode: string } | undefined;
    // Shared-Pod allowlist rows must not fan a co-parent’s kid into this Circle (Casey ≠ Alex+Riley).
    // Friend-invite kids (Quinn on Ken’s Circle after Shorts approved) must stay.
    if (
      line?.mode === "child" &&
      !isGuardian(db, userId, m.line_id) &&
      !isFriendInviteCircleLine(db, userId, m.line_id)
    ) {
      const allowlistPollution = db
        .prepare(
          `SELECT 1 FROM allowlist a
           JOIN household_members hm ON hm.household_id = a.household_id
           WHERE hm.user_id = ? AND a.target_line_id = ?
           LIMIT 1`
        )
        .get(userId, m.line_id);
      if (allowlistPollution) {
        db.prepare(`DELETE FROM sphere_members WHERE sphere_id = ? AND line_id = ?`).run(
          sphere.id,
          m.line_id
        );
      }
    }
  }
}

/**
 * Kid pads default to the creating parent’s Circle only — not every co-parent’s list (Casey ≠ Jordan).
 */
export function scrubPodCoParentKidSphereAccess(db: Database.Database): void {
  const kids = db
    .prepare(`SELECT id, household_id, owner_user_id FROM lines WHERE IFNULL(mode, 'parent') = 'child'`)
    .all() as { id: string; household_id: string; owner_user_id: string }[];
  for (const kid of kids) {
    for (const parentId of householdParentUserIds(db, kid.household_id)) {
      if (parentId === kid.owner_user_id) continue;
      const sph = getSphereByOwner(db, parentId);
      if (!sph) continue;
      db.prepare(`DELETE FROM line_sphere_access WHERE line_id = ? AND sphere_id = ?`).run(
        kid.id,
        sph.id
      );
    }
  }
}

/**
 * Self-heal: grandparents never keep each other on a *private* GP-house allowlist
 * or their own Circle. Never mutate a shared family Pod allowlist (East/North) —
 * those rows are the kids’ cross-Pod grandparent book; GP↔GP stays blocked by canCall.
 */
export function scrubGrandparentPeerIsolation(
  db: Database.Database,
  userId: string
): void {
  ensureProvisionedRelativeProfileRole(db, userId);
  if (!isGrandparentPeerAccount(db, userId)) return;

  const hhs = db
    .prepare(`SELECT household_id FROM household_members WHERE user_id = ?`)
    .all(userId) as { household_id: string }[];
  for (const { household_id } of hhs) {
    if (isSharedFamilyPodAllowlist(db, household_id)) continue;
    const rows = db
      .prepare(`SELECT id, target_line_id FROM allowlist WHERE household_id = ?`)
      .all(household_id) as { id: string; target_line_id: string }[];
    for (const r of rows) {
      if (!isGrandparentPeerLine(db, r.target_line_id)) continue;
      const target = db
        .prepare(`SELECT owner_user_id FROM lines WHERE id = ?`)
        .get(r.target_line_id) as { owner_user_id: string } | undefined;
      if (target && target.owner_user_id === userId) continue;
      db.prepare(`DELETE FROM allowlist WHERE id = ?`).run(r.id);
    }
  }

  const sphere = getSphereByOwner(db, userId);
  if (!sphere) return;
  const allowedKids = new Set(listGrandparentDialKids(db, userId).map((k) => k.id));
  const manualAdults = grandparentManualAdultLineIds(db, userId);
  const podParents = new Set(listGrandparentPodParentLines(db, userId).map((l) => l.id));
  const members = db
    .prepare(`SELECT line_id FROM sphere_members WHERE sphere_id = ?`)
    .all(sphere.id) as { line_id: string }[];
  for (const m of members) {
    // Keep grandchildren, this Pod’s parents, manual adults; drop other adults / peer GPs.
    if (allowedKids.has(m.line_id) || manualAdults.has(m.line_id) || podParents.has(m.line_id)) {
      continue;
    }
    const target = db
      .prepare(`SELECT owner_user_id FROM lines WHERE id = ?`)
      .get(m.line_id) as { owner_user_id: string } | undefined;
    if (target && target.owner_user_id === userId) continue;
    db.prepare(`DELETE FROM sphere_members WHERE sphere_id = ? AND line_id = ?`).run(
      sphere.id,
      m.line_id
    );
  }

  // Private Grandma houses: drop Pod parents (Drew/Casey) left from older pod books.
  // Never mutate a shared family Pod allowlist (kids’ cross-Pod GP rows live there).
  const prov = db
    .prepare(`SELECT from_household_id, relative_household_id FROM provisioned_relatives WHERE relative_user_id = ?`)
    .all(userId) as { from_household_id: string; relative_household_id: string }[];
  for (const row of prov) {
    if (isSharedFamilyPodAllowlist(db, row.relative_household_id)) continue;
    syncProvisionedRelativePodBook(db, row.from_household_id, userId);
  }
}

/** True when this Pod’s allowlist is shared with kids / co-parents (not a GP-only house). */
function isSharedFamilyPodAllowlist(db: Database.Database, householdId: string): boolean {
  const kid = db
    .prepare(
      `SELECT 1 FROM lines WHERE household_id = ? AND IFNULL(mode, 'parent') = 'child' LIMIT 1`
    )
    .get(householdId);
  if (kid) return true;
  const members = db
    .prepare(`SELECT user_id FROM household_members WHERE household_id = ?`)
    .all(householdId) as { user_id: string }[];
  for (const m of members) {
    if (!m.user_id || isChildOnlyAccount(db, m.user_id)) continue;
    if (!isGrandparentPeerAccount(db, m.user_id)) return true;
  }
  // Merged GP line lives on the inviting family Pod (from === relative).
  const merged = db
    .prepare(
      `SELECT 1 FROM provisioned_relatives
       WHERE relative_household_id = ? AND from_household_id = ? LIMIT 1`
    )
    .get(householdId, householdId);
  return Boolean(merged);
}

/**
 * Manage / Open grandparents for a Pod: household members of that Pod only.
 * Jordan is North — guardian of Alex/Riley is not East membership.
 */
export function canAdminPodGrandparents(
  db: Database.Database,
  userId: string,
  fromHouseholdId: string
): boolean {
  if (!userId || !fromHouseholdId || isChildOnlyAccount(db, userId)) return false;
  return userInHousehold(db, fromHouseholdId, userId);
}

/** True when this actor’s Pod provisioned the household (Grandma’s house). */
export function canAdminProvisionedRelativeHousehold(
  db: Database.Database,
  actorUserId: string,
  householdId: string
): boolean {
  if (isChildOnlyAccount(db, actorUserId)) return false;
  const row = db
    .prepare(`SELECT * FROM provisioned_relatives WHERE relative_household_id = ?`)
    .get(householdId) as ProvisionedRelativeRow | undefined;
  if (!row) return false;
  return canAdminPodGrandparents(db, actorUserId, row.from_household_id);
}

/**
 * Settings/ATA/greeting on a provisioned grandparent’s own line only.
 * Must not unlock peer parents/kids who share the same Pod after a GP merge
 * (e.g. Avery on North must not give Casey admin of Drew/Jordan/Sam).
 */
export function canAdminProvisionedRelativeLine(
  db: Database.Database,
  actorUserId: string,
  lineId: string
): boolean {
  if (!actorUserId || !lineId || isChildOnlyAccount(db, actorUserId)) return false;
  const row = db
    .prepare(`SELECT * FROM provisioned_relatives WHERE relative_line_id = ?`)
    .get(lineId) as ProvisionedRelativeRow | undefined;
  if (!row) return false;
  return canAdminPodGrandparents(db, actorUserId, row.from_household_id);
}

/**
 * Rules, speed-dial edits, analog — household members/guardians OR the parent
 * who provisioned this grandparent Pod. Does not grant a global directory.
 */
export function canManageHouseholdSettings(
  db: Database.Database,
  userId: string,
  householdId: string
): boolean {
  return (
    canManageHouseholdChildState(db, userId, householdId) ||
    canAdminProvisionedRelativeHousehold(db, userId, householdId)
  );
}

export function getProvisionedRelativeRowById(
  db: Database.Database,
  relativeId: string
): ProvisionedRelativeRow | undefined {
  return db
    .prepare(`SELECT * FROM provisioned_relatives WHERE id = ?`)
    .get(relativeId) as ProvisionedRelativeRow | undefined;
}

export function assertCanAdminProvisionedRelative(
  db: Database.Database,
  actorUserId: string,
  fromHouseholdId: string,
  relativeId: string
): ProvisionedRelativeRow {
  assertParentContactAdmin(db, actorUserId);
  const row =
    getProvisionedRelativeRow(db, fromHouseholdId, relativeId) ||
    getProvisionedRelativeRowById(db, relativeId);
  if (!row) throw new Error("Grandparent setup not found");
  if (!canAdminPodGrandparents(db, actorUserId, row.from_household_id)) {
    throw new Error("Only parents can manage this grandparent");
  }
  return row;
}

/**
 * What Grandma’s phone actually has — scoped to her Pod. Used so the parent
 * who set her up can troubleshoot without signing in as her. Not listen-in.
 */
export function provisionedRelativeAdminSnapshot(
  db: Database.Database,
  actorUserId: string,
  fromHouseholdId: string,
  relativeId: string
): {
  relative: PublicProvisionedRelative;
  household: ReturnType<typeof householdSnapshot>["households"][number];
  directory: ReturnType<typeof householdSnapshot>["directory"];
} {
  const row = assertCanAdminProvisionedRelative(db, actorUserId, fromHouseholdId, relativeId);
  syncProvisionedRelativePodBook(db, row.from_household_id, row.relative_user_id);
  const snap = householdSnapshot(db, row.relative_user_id);
  const household = snap.households.find((h) => h.id === row.relative_household_id);
  if (!household) throw new Error("Grandparent phone not found");
  const relative = publicProvisionedRelative(db, row, fromHouseholdId);
  if (!relative) throw new Error("Grandparent account missing");
  const allowedIds = new Set(snap.directory.map((d) => d.id));
  return {
    relative,
    household,
    directory: snap.directory.filter((d) => allowedIds.has(d.id)),
  };
}

export function isProvisionedRelativeHousehold(
  db: Database.Database,
  householdId: string
): boolean {
  return Boolean(
    db
      .prepare(`SELECT 1 FROM provisioned_relatives WHERE relative_household_id = ? LIMIT 1`)
      .get(householdId)
  );
}

/**
 * Grandchildren a Pod grandparent auto-sees (kids who belong to this Pod, including
 * multi-Pod kids). Pod parents are synced separately via `listGrandparentPodParentLines`.
 */
export function podBookLines(db: Database.Database, fromHouseholdId: string): Line[] {
  const seen = new Set<string>();
  const out: Line[] = [];
  for (const kid of kidsBelongingToPod(db, fromHouseholdId)) {
    if (!kid?.id || seen.has(kid.id)) continue;
    if ((kid.mode || "parent") !== "child") continue;
    if (isGrandparentPeerLine(db, kid.id)) continue;
    seen.add(kid.id);
    out.push(normalizeLine(kid));
  }
  out.sort((a, b) => {
    const an = String(a.child_label || a.name || "");
    const bn = String(b.child_label || b.name || "");
    const cmp = an.localeCompare(bn, undefined, { sensitivity: "base" });
    if (cmp) return cmp;
    return String(a.created_at || a.id).localeCompare(String(b.created_at || b.id));
  });
  return out;
}

function ensureAllowlistPair(
  db: Database.Database,
  householdId: string,
  targetLineId: string,
  label: string,
  actorUserId?: string
): void {
  const existing = db
    .prepare(`SELECT id FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
    .get(householdId, targetLineId);
  if (existing) return;
  addAllowlist(db, householdId, targetLineId, label, { actorUserId, favorite: true });
}

/**
 * Mutual allowlist + pad book for a provisioned GP.
 *
 * Private GP house (Ellis’s house): auto grandchildren only; drop drifted adults
 * unless `gp_manual`. Assign speed dials on that private book.
 *
 * Merged onto a shared family Pod (Sloan on East): never mutate that Pod’s
 * allowlist — kids/parents own Drew/Jordan/cousins there. GP viewers are filtered
 * at snapshot time (grandchildren + gp_manual only). Still ensure reverse
 * kid-home → GP links for cross-Pod grandchildren.
 */
export function syncProvisionedRelativePodBook(
  db: Database.Database,
  fromHouseholdId: string,
  relativeUserId: string
): void {
  const row = db
    .prepare(`SELECT * FROM provisioned_relatives WHERE from_household_id = ? AND relative_user_id = ?`)
    .get(fromHouseholdId, relativeUserId) as ProvisionedRelativeRow | undefined;
  if (!row) return;
  const user = db
    .prepare(`SELECT display_name, username FROM users WHERE id = ?`)
    .get(relativeUserId) as { display_name: string; username: string | null } | undefined;
  const gpLabel = adultFacingGrandparentLabel(user?.display_name, row.display_label, user?.username);
  const book = podBookLines(db, fromHouseholdId)
    .filter((line) => line.id !== row.relative_line_id)
    .slice();
  const sharedFamilyBook = isSharedFamilyPodAllowlist(db, row.relative_household_id);

  for (const line of book) {
    const theirLabel = line.child_label || line.name || "Grandchild";
    // Private GP house only — never write/delete on a shared family Pod book.
    if (!sharedFamilyBook) {
      ensureAllowlistPair(db, row.relative_household_id, line.id, theirLabel, relativeUserId);
      db.prepare(`UPDATE allowlist SET label = ? WHERE household_id = ? AND target_line_id = ?`).run(
        theirLabel,
        row.relative_household_id,
        line.id
      );
    }
    // Reverse: grandchild’s home Pod keeps the GP (Alex → Avery on East).
    if (line.household_id !== row.relative_household_id) {
      const parentActor =
        householdParentUserIds(db, line.household_id)[0] || row.created_by || relativeUserId;
      ensureAllowlistPair(db, line.household_id, row.relative_line_id, gpLabel, parentActor);
    }
  }

  if (sharedFamilyBook) return;

  // Pod parents (Casey/Drew/Jordan on North Grandma’s phone) — auto, not gp_manual.
  const podParents = listGrandparentPodParentLines(db, relativeUserId);
  for (const parent of podParents) {
    // Grandma sees her kids by name — “Mom/Dad” is the grandchildren’s word, not hers.
    const owner = db.prepare(`SELECT display_name FROM users WHERE id = ?`).get(parent.owner_user_id) as
      | { display_name: string }
      | undefined;
    const name = firstGivenName(owner?.display_name) || firstGivenName(parent.name) || "Family";
    const existing = db
      .prepare(`SELECT id, IFNULL(gp_manual, 0) AS gp_manual FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
      .get(row.relative_household_id, parent.id) as { id: string; gp_manual: number } | undefined;
    if (existing) {
      if (!existing.gp_manual) db.prepare(`UPDATE allowlist SET label = ? WHERE id = ?`).run(name, existing.id);
      continue;
    }
    const added = addAllowlist(db, row.relative_household_id, parent.id, name, {
      actorUserId: relativeUserId,
      favorite: true,
      skipKidFanout: true,
    });
    db.prepare(`UPDATE allowlist SET gp_manual = 0, speed_dial = NULL WHERE id = ?`).run(added.id);
  }

  // One GP house can serve several Pods — keep every Pod’s grandchildren, not just this one.
  const siblingPods = db
    .prepare(
      `SELECT DISTINCT from_household_id FROM provisioned_relatives
       WHERE relative_household_id = ? AND relative_user_id = ?`
    )
    .all(row.relative_household_id, relativeUserId) as { from_household_id: string }[];
  const fullBook: Line[] = [];
  const fullIds = new Set<string>();
  for (const { from_household_id } of siblingPods) {
    for (const line of podBookLines(db, from_household_id)) {
      if (line.id === row.relative_line_id || fullIds.has(line.id)) continue;
      fullIds.add(line.id);
      fullBook.push(line);
    }
  }
  const keepIds = new Set([...fullIds, ...podParents.map((l) => l.id)]);
  const extras = db
    .prepare(`SELECT id, target_line_id, IFNULL(gp_manual, 0) AS gp_manual FROM allowlist WHERE household_id = ?`)
    .all(row.relative_household_id) as { id: string; target_line_id: string; gp_manual: number }[];
  for (const extra of extras) {
    if (keepIds.has(extra.target_line_id)) continue;
    if (extra.gp_manual) continue;
    db.prepare(`DELETE FROM allowlist WHERE id = ? AND household_id = ?`).run(
      extra.id,
      row.relative_household_id
    );
  }
  let slot = 2;
  for (const line of fullBook) {
    if (slot > 9) break;
    db.prepare(`UPDATE allowlist SET speed_dial = ? WHERE household_id = ? AND target_line_id = ?`).run(
      slot,
      row.relative_household_id,
      line.id
    );
    slot += 1;
  }
  // Pod parents after grandchildren; never take a slot Grandma set for a manual adult.
  const manualSlots = new Set(
    (
      db
        .prepare(
          `SELECT speed_dial FROM allowlist
           WHERE household_id = ? AND IFNULL(gp_manual, 0) = 1 AND speed_dial IS NOT NULL`
        )
        .all(row.relative_household_id) as { speed_dial: number }[]
    ).map((r) => r.speed_dial)
  );
  for (const parent of podParents) {
    while (slot <= 9 && manualSlots.has(slot)) slot += 1;
    const dial = slot <= 9 ? slot : null;
    db.prepare(`UPDATE allowlist SET speed_dial = ? WHERE household_id = ? AND target_line_id = ?`).run(
      dial,
      row.relative_household_id,
      parent.id
    );
    if (dial != null) slot += 1;
  }
}

/**
 * Attach an existing login as this Pod’s grandparent. Reuses their household
 * and line — never a second password or a second house.
 */
export function finishGrandparentOnPod(
  db: Database.Database,
  fromHouseholdId: string,
  relativeUserId: string,
  opts: { label?: string; createdBy?: string; displayName?: string } = {}
): {
  relative: PublicProvisionedRelative;
  username: string | null;
  line: Line;
  household: Household;
  createdHousehold: boolean;
} {
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(relativeUserId) as User | undefined;
  if (!user) throw new Error("Account not found");
  if (opts.displayName) {
    const name = String(opts.displayName).trim().slice(0, 64) || user.display_name;
    db.prepare(`UPDATE users SET display_name = ? WHERE id = ?`).run(name, relativeUserId);
    user.display_name = name;
  }
  db.prepare(`UPDATE users SET profile_role = 'grandparent' WHERE id = ?`).run(relativeUserId);

  const already = db
    .prepare(`SELECT * FROM provisioned_relatives WHERE relative_user_id = ?`)
    .get(relativeUserId) as ProvisionedRelativeRow | undefined;
  if (already && already.from_household_id !== fromHouseholdId) {
    throw new Error("This account is already a grandparent for another family");
  }

  let createdHousehold = false;
  let householdId = primaryHouseholdIdForUser(db, relativeUserId);
  let household: Household;
  if (householdId) {
    household = db.prepare(`SELECT * FROM households WHERE id = ?`).get(householdId) as Household;
  } else {
    household = createHousehold(db, relativeUserId, `${user.display_name}'s house`);
    createdHousehold = true;
    householdId = household.id;
  }

  let line = db
    .prepare(
      `SELECT * FROM lines WHERE household_id = ? AND owner_user_id = ? ORDER BY created_at LIMIT 1`
    )
    .get(householdId, relativeUserId) as Line | undefined;
  if (!line) {
    line = addLine(db, householdId, relativeUserId, `${user.display_name}'s phone`, "softphone", {
      mode: "parent",
    });
  }

  const label =
    String(opts.label || "").trim().slice(0, 64) ||
    user.display_name.replace(/\s+phone$/i, "").trim() ||
    "Grandparent";
  const createdBy = opts.createdBy || householdParentUserIds(db, fromHouseholdId)[0] || relativeUserId;

  let row = already;
  if (!row) {
    row = {
      id: newId("prov"),
      from_household_id: fromHouseholdId,
      relative_user_id: relativeUserId,
      relative_line_id: line.id,
      relative_household_id: household.id,
      display_label: label,
      kid_nickname: null,
      created_by: createdBy,
      created_at: nowIso(),
    };
    db.prepare(
      `INSERT INTO provisioned_relatives (id, from_household_id, relative_user_id, relative_line_id, relative_household_id, display_label, created_by, created_at)
       VALUES (@id, @from_household_id, @relative_user_id, @relative_line_id, @relative_household_id, @display_label, @created_by, @created_at)`
    ).run(row);
  } else if (opts.label) {
    db.prepare(`UPDATE provisioned_relatives SET display_label = ? WHERE id = ?`).run(label, row.id);
    row = { ...row, display_label: label };
  }
  if (!row.kid_nickname) {
    const nick = normalizeKidNickname(
      null,
      inferGrandparentHonorific(user.display_name, row.display_label, user.username)
    );
    db.prepare(`UPDATE provisioned_relatives SET kid_nickname = ? WHERE id = ?`).run(nick, row.id);
    row = { ...row, kid_nickname: nick };
  }

  markGrandparentLine(db, line.id);
  ensureAllowlistPair(db, fromHouseholdId, line.id, row.display_label || label, createdBy);
  syncProvisionedRelativePodBook(db, fromHouseholdId, relativeUserId);
  syncGrandparentDialCollapse(db, fromHouseholdId);

  const relative = publicProvisionedRelative(db, row, fromHouseholdId);
  if (!relative) throw new Error("Could not attach grandparent account");
  return {
    relative,
    username: user.username,
    line: normalizeLine(line),
    household,
    createdHousehold,
  };
}

export function attachExistingUserAsGrandparent(
  db: Database.Database,
  actorUserId: string,
  fromHouseholdId: string,
  relativeUserId: string,
  opts: { label?: string; displayName?: string } = {}
): ReturnType<typeof finishGrandparentOnPod> {
  assertParentContactAdmin(db, actorUserId);
  if (!canCreateHouseholdInvite(db, actorUserId, fromHouseholdId)) {
    throw new Error("Only parents can set up grandparents for this household");
  }
  return finishGrandparentOnPod(db, fromHouseholdId, relativeUserId, {
    ...opts,
    createdBy: actorUserId,
  });
}

export function listProvisionedRelativesVisibleTo(
  db: Database.Database,
  userId: string,
  householdId: string
): PublicProvisionedRelative[] {
  if (!canManageHouseholdChildState(db, userId, householdId)) return [];
  const fromIds = new Set<string>();
  const rows = db
    .prepare(`SELECT DISTINCT from_household_id FROM provisioned_relatives`)
    .all() as { from_household_id: string }[];
  for (const r of rows) {
    if (canAdminPodGrandparents(db, userId, r.from_household_id)) {
      fromIds.add(r.from_household_id);
    }
  }
  const seen = new Set<string>();
  const out: PublicProvisionedRelative[] = [];
  for (const hhId of fromIds) {
    for (const rel of listProvisionedRelatives(db, hhId)) {
      if (seen.has(rel.id)) continue;
      seen.add(rel.id);
      out.push(rel);
    }
  }
  return out;
}

export function ensureHouseholdParentMember(
  db: Database.Database,
  householdId: string,
  userId: string
): void {
  if (!userId || userInHousehold(db, householdId, userId)) return;
  if (isChildOnlyAccount(db, userId)) return;
  db.prepare(
    `INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'parent')`
  ).run(householdId, userId);
}

/** New allowlist rows on a provisioned Grandma Pod: auto kids, or manual adults. */
export function assertProvisionedRelativeAllowlistTarget(
  db: Database.Database,
  actorUserId: string,
  householdId: string,
  targetLineId: string
): void {
  if (!canAdminProvisionedRelativeHousehold(db, actorUserId, householdId)) return;
  if (canManageHouseholdChildState(db, actorUserId, householdId)) return;
  const row = db
    .prepare(`SELECT * FROM provisioned_relatives WHERE relative_household_id = ?`)
    .get(householdId) as ProvisionedRelativeRow | undefined;
  if (!row) throw new Error("Grandparent setup not found");
  const target = db
    .prepare(`SELECT id, IFNULL(mode, 'parent') AS mode, owner_user_id FROM lines WHERE id = ?`)
    .get(targetLineId) as { id: string; mode: string; owner_user_id: string } | undefined;
  if (!target) throw new Error("Unknown line");
  if (isGrandparentPeerLine(db, targetLineId) && target.owner_user_id !== row.relative_user_id) {
    throw new Error("Grandparents cannot add other grandparents");
  }
  // Adults may be linked manually to Grandma’s phone (gp_manual on insert).
  if (target.mode !== "child") return;
  const allowed = new Set(podBookLines(db, row.from_household_id).map((l) => l.id));
  if (!allowed.has(targetLineId)) {
    throw new Error("Grandparents can only be linked to people in the family that set them up");
  }
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
    kidNickname?: string;
    kidLineIds?: string[];
  }
): {
  relative: PublicProvisionedRelative;
  username: string;
  password: string;
  line: Line;
  household: Household;
  setupToken: string;
  setupExpiresAt: string;
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
    kind: "family",
    target_kid_line_id: null,
  };
  db.prepare(
    `INSERT INTO invites (id, code, from_household_id, created_by, expires_at, redeemed_by_household_id, created_at, kind, target_kid_line_id)
     VALUES (@id, @code, @from_household_id, @created_by, @expires_at, @redeemed_by_household_id, @created_at, @kind, @target_kid_line_id)`
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
    const kid = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(kidLineId) as Line | undefined;
    if (!kid || (kid.mode || "parent") !== "child" || !kidBelongsToPod(db, kidLineId, fromHouseholdId)) {
      throw new Error("Pick a kid from this family");
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
    kid_nickname: null,
    created_by: actorUserId,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO provisioned_relatives (id, from_household_id, relative_user_id, relative_line_id, relative_household_id, display_label, created_by, created_at)
     VALUES (@id, @from_household_id, @relative_user_id, @relative_line_id, @relative_household_id, @display_label, @created_by, @created_at)`
  ).run(row);
  const nick = normalizeKidNickname(
    opts.kidNickname,
    inferGrandparentHonorific(displayName, label, username)
  );
  db.prepare(`UPDATE provisioned_relatives SET kid_nickname = ? WHERE id = ?`).run(nick, row.id);
  row.kid_nickname = nick;

  console.log(
    `[audit] grandparent provisioned by user_id=${actorUserId} relative_user=${username} from_hh=${fromHouseholdId} at ${nowIso()}`
  );

  markGrandparentLine(db, row.relative_line_id);
  syncProvisionedRelativePodBook(db, fromHouseholdId, user.id);
  syncGrandparentDialCollapse(db, fromHouseholdId);

  const relative = publicProvisionedRelative(db, row, fromHouseholdId);
  if (!relative) throw new Error("Could not create grandparent account");

  const setup = issueGrandparentSetupToken(db, actorUserId, fromHouseholdId, row.id);

  return {
    relative,
    username,
    password,
    line: normalizeLine(line),
    household,
    setupToken: setup.token,
    setupExpiresAt: setup.expiresAt,
  };
}

const GP_SETUP_TOKEN_TTL_MS = 14 * 24 * 3600e3;

export type GrandparentSetupIssue = {
  token: string;
  expiresAt: string;
  relative: PublicProvisionedRelative;
  displayName: string;
};

/** Mint a one-time `/?gp=` claim token for a provisioned grandparent (SMS / share sheet). */
export function issueGrandparentSetupToken(
  db: Database.Database,
  actorUserId: string,
  fromHouseholdId: string,
  relativeId: string
): GrandparentSetupIssue {
  const row = assertCanAdminProvisionedRelative(db, actorUserId, fromHouseholdId, relativeId);
  const relative = publicProvisionedRelative(db, row, row.from_household_id);
  if (!relative) throw new Error("Grandparent account missing");

  // One live link at a time — drop unused prior tokens for this relative.
  db.prepare(
    `DELETE FROM grandparent_setup_tokens
     WHERE provisioned_relative_id = ? AND redeemed_at IS NULL`
  ).run(row.id);

  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + GP_SETUP_TOKEN_TTL_MS).toISOString();
  db.prepare(
    `INSERT INTO grandparent_setup_tokens
      (id, token_hash, provisioned_relative_id, relative_user_id, from_household_id, created_by, expires_at, redeemed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`
  ).run(
    newId("gpsetup"),
    hashCode(token),
    row.id,
    row.relative_user_id,
    row.from_household_id,
    actorUserId,
    expiresAt,
    nowIso()
  );

  console.log(
    `[audit] grandparent setup link issued by user_id=${actorUserId} relative_id=${row.id} expires=${expiresAt}`
  );

  return {
    token,
    expiresAt,
    relative,
    displayName: relative.display_label || relative.display_name || "Grandparent",
  };
}

/**
 * Redeem a one-tap Grandma link — creates a session, never echoes password.
 * Token is single-use; expired / unknown tokens fail closed.
 */
export function redeemGrandparentSetupToken(
  db: Database.Database,
  tokenRaw: string
): { user: User; session: Session; displayName: string } {
  const token = String(tokenRaw || "").trim();
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
    throw new Error("That setup link is not valid");
  }
  const tokenHash = hashCode(token);
  const row = db
    .prepare(`SELECT * FROM grandparent_setup_tokens WHERE token_hash = ?`)
    .get(tokenHash) as
    | {
        id: string;
        relative_user_id: string;
        expires_at: string;
        redeemed_at: string | null;
        provisioned_relative_id: string;
      }
    | undefined;
  if (!row) throw new Error("That setup link is not valid");
  if (row.redeemed_at) throw new Error("That setup link was already used");
  if (row.expires_at < nowIso()) throw new Error("That setup link expired — ask for a new one");

  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(row.relative_user_id) as
    | User
    | undefined;
  if (!user) throw new Error("Grandparent account missing");
  ensureProvisionedRelativeProfileRole(db, user.id);

  db.prepare(`UPDATE grandparent_setup_tokens SET redeemed_at = ? WHERE id = ?`).run(
    nowIso(),
    row.id
  );
  // Invalidate any other unused links for the same relative.
  db.prepare(
    `DELETE FROM grandparent_setup_tokens
     WHERE provisioned_relative_id = ? AND redeemed_at IS NULL AND id != ?`
  ).run(row.provisioned_relative_id, row.id);

  const session = createSession(db, user.id);
  const fresh = db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id) as User;
  console.log(
    `[audit] grandparent setup link redeemed relative_user_id=${user.id} token_id=${row.id} at ${nowIso()}`
  );
  return {
    user: fresh,
    session,
    displayName: fresh.display_name || "Grandparent",
  };
}

/** Share-sheet copy for a one-tap Grandma link (password stays off the SMS). */
export function grandparentSetupShareText(displayName: string, setupUrl: string): string {
  const who = String(displayName || "Grandparent").trim() || "Grandparent";
  return `Your PhoneHome is ready (${who})

Tap this link once to open and sign in:
${setupUrl}

(Link works one time. Ask for a new one if it expires.)`;
}

export type InviteClaimChannel = "invite" | "guardian";

function normalizeOpaqueJoinToken(raw: string): string {
  const t = String(raw || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "");
  if (t.length < 20 || t.length > 64) throw new Error("That join link is not valid");
  return t;
}

function mintOpaqueJoinToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Attach a one-tap `/?join=` claim token to a family/friend invite. */
export function issueInviteClaimToken(
  db: Database.Database,
  invite: Invite,
  createdBy: string
): string {
  db.prepare(
    `DELETE FROM invite_claim_tokens WHERE invite_id = ? AND redeemed_at IS NULL`
  ).run(invite.id);
  const token = mintOpaqueJoinToken();
  db.prepare(
    `INSERT INTO invite_claim_tokens
      (id, token_hash, channel, invite_id, guardian_invite_id, created_by, expires_at, redeemed_at, created_at)
     VALUES (?, ?, 'invite', ?, NULL, ?, ?, NULL, ?)`
  ).run(newId("join"), hashCode(token), invite.id, createdBy, invite.expires_at, nowIso());
  return token;
}

/** Attach a one-tap `/?join=` claim token to a co-parent (guardian) invite. */
export function issueGuardianClaimToken(
  db: Database.Database,
  invite: GuardianInvite,
  createdBy: string
): string {
  db.prepare(
    `DELETE FROM invite_claim_tokens WHERE guardian_invite_id = ? AND redeemed_at IS NULL`
  ).run(invite.id);
  const token = mintOpaqueJoinToken();
  db.prepare(
    `INSERT INTO invite_claim_tokens
      (id, token_hash, channel, invite_id, guardian_invite_id, created_by, expires_at, redeemed_at, created_at)
     VALUES (?, ?, 'guardian', NULL, ?, ?, ?, NULL, ?)`
  ).run(newId("join"), hashCode(token), invite.id, createdBy, invite.expires_at, nowIso());
  return token;
}

export type JoinTokenPeek = {
  channel: InviteClaimChannel;
  kind: InviteKind | "guardian";
  fromHouseholdName: string;
  targetKidLabel: string | null;
  inviterGivenName: string;
  expiresAt: string;
  /** 6-digit backup for typing — never put in the share URL. */
  code: string;
};

type InviteClaimRow = {
  id: string;
  channel: string;
  invite_id: string | null;
  guardian_invite_id: string | null;
  expires_at: string;
  redeemed_at: string | null;
};

function loadInviteClaimRow(db: Database.Database, tokenRaw: string): InviteClaimRow {
  const token = normalizeOpaqueJoinToken(tokenRaw);
  const row = db
    .prepare(`SELECT * FROM invite_claim_tokens WHERE token_hash = ?`)
    .get(hashCode(token)) as InviteClaimRow | undefined;
  if (!row) throw new Error("That join link is not valid");
  if (row.redeemed_at) throw new Error("That join link was already used");
  if (row.expires_at < nowIso()) throw new Error("That join link expired — ask for a new one");
  return row;
}

/** Safe preview for a `/?join=` link — family name only, never SIP secrets. */
export function peekJoinToken(db: Database.Database, tokenRaw: string): JoinTokenPeek {
  const row = loadInviteClaimRow(db, tokenRaw);
  if (row.channel === "guardian" && row.guardian_invite_id) {
    const ginv = db
      .prepare(`SELECT * FROM guardian_invites WHERE id = ?`)
      .get(row.guardian_invite_id) as GuardianInvite | undefined;
    if (!ginv) throw new Error("That join link is not valid");
    if (ginv.redeemed_by_user_id) throw new Error("That join link was already used");
    if (ginv.expires_at < nowIso()) throw new Error("That join link expired — ask for a new one");
    const line = db.prepare(`SELECT child_label, name, household_id FROM lines WHERE id = ?`).get(
      ginv.line_id
    ) as { child_label: string | null; name: string; household_id: string } | undefined;
    const hh = line
      ? (db.prepare(`SELECT name FROM households WHERE id = ?`).get(line.household_id) as
          | { name: string }
          | undefined)
      : undefined;
    const inviter = db.prepare(`SELECT display_name FROM users WHERE id = ?`).get(ginv.created_by) as
      | { display_name: string | null }
      | undefined;
    const given = String(inviter?.display_name || "")
      .trim()
      .split(/\s+/)[0] || "";
    return {
      channel: "guardian",
      kind: "guardian",
      fromHouseholdName: String(hh?.name || "A family").trim() || "A family",
      targetKidLabel: String(line?.child_label || line?.name || "a child").trim() || "a child",
      inviterGivenName: given.length >= 2 && given.length <= 24 ? given : "",
      expiresAt: ginv.expires_at,
      code: ginv.code,
    };
  }

  if (!row.invite_id) throw new Error("That join link is not valid");
  const peek = peekInvite(
    db,
    (
      db.prepare(`SELECT code FROM invites WHERE id = ?`).get(row.invite_id) as
        | { code: string }
        | undefined
    )?.code || ""
  );
  const inviter = db
    .prepare(
      `SELECT u.display_name AS display_name FROM invites i JOIN users u ON u.id = i.created_by WHERE i.id = ?`
    )
    .get(row.invite_id) as { display_name: string | null } | undefined;
  const given = String(inviter?.display_name || "")
    .trim()
    .split(/\s+/)[0] || "";
  return {
    channel: "invite",
    kind: peek.kind,
    fromHouseholdName: peek.fromHouseholdName,
    targetKidLabel: peek.targetKidLabel,
    inviterGivenName: given.length >= 2 && given.length <= 24 ? given : "",
    expiresAt: peek.expiresAt,
    code: peek.code,
  };
}

/**
 * Redeem a one-tap join link after the invitee has signed in / created an account.
 * Marks the claim token used; underlying 6-digit invite is redeemed as usual.
 */
export function redeemJoinToken(
  db: Database.Database,
  userId: string,
  tokenRaw: string,
  opts: { householdName?: string } = {}
): {
  channel: InviteClaimChannel;
  kind: InviteKind | "guardian";
  invite?: Invite;
  household?: Household;
  created?: boolean;
  line?: Line;
  guardians?: ReturnType<typeof listGuardians>;
} {
  const row = loadInviteClaimRow(db, tokenRaw);
  if (row.channel === "guardian" && row.guardian_invite_id) {
    const ginv = db
      .prepare(`SELECT * FROM guardian_invites WHERE id = ?`)
      .get(row.guardian_invite_id) as GuardianInvite | undefined;
    if (!ginv) throw new Error("That join link is not valid");
    const result = redeemGuardianInvite(db, userId, ginv.code, opts);
    db.prepare(`UPDATE invite_claim_tokens SET redeemed_at = ? WHERE id = ?`).run(nowIso(), row.id);
    db.prepare(
      `DELETE FROM invite_claim_tokens WHERE guardian_invite_id = ? AND redeemed_at IS NULL AND id != ?`
    ).run(row.guardian_invite_id, row.id);
    return { channel: "guardian", kind: "guardian", ...result };
  }

  if (!row.invite_id) throw new Error("That join link is not valid");
  const inv = db.prepare(`SELECT * FROM invites WHERE id = ?`).get(row.invite_id) as
    | Invite
    | undefined;
  if (!inv) throw new Error("That join link is not valid");
  const result = redeemInvite(
    db,
    inv.code,
    userId,
    opts.householdName || "Family"
  );
  db.prepare(`UPDATE invite_claim_tokens SET redeemed_at = ? WHERE id = ?`).run(nowIso(), row.id);
  db.prepare(
    `DELETE FROM invite_claim_tokens WHERE invite_id = ? AND redeemed_at IS NULL AND id != ?`
  ).run(row.invite_id, row.id);
  return {
    channel: "invite",
    kind: normalizeInvite(result.invite).kind,
    invite: result.invite,
    household: result.household,
    created: result.created,
  };
}

export function familyJoinShareText(opts: {
  kind: InviteKind | string;
  joinUrl: string;
  fromHouseholdName?: string;
  inviterGivenName?: string;
  targetKidLabel?: string | null;
}): string {
  const url = String(opts.joinUrl || "").trim();
  const who = String(opts.inviterGivenName || "").trim();
  const pod = String(opts.fromHouseholdName || "our family").trim() || "our family";
  const kid = String(opts.targetKidLabel || "our kid").trim() || "our kid";
  if (opts.kind === "friend") {
    return `${who || "A parent"} invited you onto ${kid}'s PhoneHome Circle.

Tap once to join:
${url}

After that you each approve so the kids can call.`;
  }
  if (opts.kind === "grandparent") {
    return `${who || "A parent"} invited you as Grandma/Grandpa on PhoneHome (${pod}).

Tap once to join:
${url}`;
  }
  return `${who || "A parent"} invited you to ${pod}'s PhoneHome.

Tap once to join:
${url}

After that you each approve so the kids can call.`;
}

export function guardianJoinShareText(opts: {
  joinUrl: string;
  kidLabel?: string;
  inviterGivenName?: string;
}): string {
  const url = String(opts.joinUrl || "").trim();
  const kid = String(opts.kidLabel || "our kid").trim() || "our kid";
  const who = String(opts.inviterGivenName || "").trim();
  return `${who || "A parent"} invited you as a co-parent on PhoneHome for ${kid}.

Tap once to join:
${url}

Sign in or create a parent account — the link finishes the rest.`;
}

/** Parent resets login password for a relative they provisioned. */
export function resetProvisionedRelativePassword(
  db: Database.Database,
  actorUserId: string,
  fromHouseholdId: string,
  relativeId: string,
  newPassword: string
): { relative: PublicProvisionedRelative; message: string } {
  const row = assertCanAdminProvisionedRelative(db, actorUserId, fromHouseholdId, relativeId);
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
    kidNickname?: string;
    /** Replace which kids this grandparent can call (mutual allowlist on their house). */
    kidLineIds?: string[];
  }
): { relative: PublicProvisionedRelative; password?: string } {
  const row = assertCanAdminProvisionedRelative(db, actorUserId, fromHouseholdId, relativeId);
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

  if (opts.kidNickname !== undefined) {
    const userHints = db
      .prepare(`SELECT display_name, username FROM users WHERE id = ?`)
      .get(row.relative_user_id) as { display_name: string; username: string | null } | undefined;
    const nick = normalizeKidNickname(
      opts.kidNickname,
      inferGrandparentHonorific(userHints?.display_name, row.display_label, userHints?.username)
    );
    db.prepare(`UPDATE provisioned_relatives SET kid_nickname = ? WHERE id = ?`).run(nick, row.id);
  }

  if (opts.kidLineIds !== undefined) {
    const wanted = [
      ...new Set(
        (opts.kidLineIds || []).filter((id) => typeof id === "string" && id)
      ),
    ];
    if (!wanted.length) throw new Error("Pick at least one kid they can call");
    for (const kidLineId of wanted) {
      const kid = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(kidLineId) as Line | undefined;
      if (!kid || (kid.mode || "parent") !== "child" || !kidBelongsToPod(db, kidLineId, fromHouseholdId)) {
        throw new Error("Pick a kid from this family");
      }
    }
    const current = db
      .prepare(
        `SELECT a.id AS entry_id, a.target_line_id AS id FROM allowlist a
         JOIN lines l ON l.id = a.target_line_id
         WHERE a.household_id = ? AND l.mode = 'child'`
      )
      .all(row.relative_household_id) as { entry_id: string; id: string }[];
    const currentIds = new Set(current.map((c) => c.id));
    const wantedSet = new Set(wanted);
    for (const rowCur of current) {
      if (!wantedSet.has(rowCur.id) && kidBelongsToPod(db, rowCur.id, fromHouseholdId)) {
        db.prepare(`DELETE FROM allowlist WHERE id = ? AND household_id = ?`).run(
          rowCur.entry_id,
          row.relative_household_id
        );
      }
    }
    for (const kidLineId of wanted) {
      if (currentIds.has(kidLineId)) continue;
      const kid = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(kidLineId) as Line | undefined;
      if (!kid) continue;
      const kidLabel = kid.child_label || kid.name || "Grandchild";
      addAllowlist(db, row.relative_household_id, kid.id, kidLabel, {
        actorUserId: row.relative_user_id,
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

/** Signed-in grandparent changing the nickname grandkids see. */
export function updateOwnGrandparentKidNickname(
  db: Database.Database,
  userId: string,
  rawNickname: string
): { kid_nickname: string; kid_label: string; pod_name: string } {
  const row = db
    .prepare(`SELECT * FROM provisioned_relatives WHERE relative_user_id = ? LIMIT 1`)
    .get(userId) as ProvisionedRelativeRow | undefined;
  if (!row) throw new Error("Only grandparents can set this nickname");
  const user = db
    .prepare(`SELECT display_name, username FROM users WHERE id = ?`)
    .get(userId) as { display_name: string; username: string | null } | undefined;
  const nick = normalizeKidNickname(
    rawNickname,
    inferGrandparentHonorific(user?.display_name, row.display_label, user?.username)
  );
  db.prepare(`UPDATE provisioned_relatives SET kid_nickname = ? WHERE id = ?`).run(nick, row.id);
  const pod = db
    .prepare(`SELECT name FROM households WHERE id = ?`)
    .get(row.from_household_id) as { name: string } | undefined;
  return {
    kid_nickname: nick,
    kid_label: kidFacingLabel(pod?.name || "Family", nick),
    pod_name: pod?.name || "Family",
  };
}

function kidFacingLabel(podName: string, nickname: string): string {
  return `${nickname} ${podName}`.trim();
}

export function grandparentPadForUser(
  db: Database.Database,
  userId: string
): { kid_nickname: string; kid_label: string; pod_name: string } | null {
  const row = db
    .prepare(`SELECT * FROM provisioned_relatives WHERE relative_user_id = ? LIMIT 1`)
    .get(userId) as ProvisionedRelativeRow | undefined;
  if (!row) return null;
  const rel = publicProvisionedRelative(db, row, row.from_household_id);
  if (!rel) return null;
  return { kid_nickname: rel.kid_nickname, kid_label: rel.kid_label, pod_name: rel.pod_name };
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
    parent_quiet_start: line.parent_quiet_start ?? null,
    parent_quiet_end: line.parent_quiet_end ?? null,
    parent_quiet_tz: line.parent_quiet_tz ?? null,
    parent_quiet_days: line.parent_quiet_days ?? null,
    parent_schedule_preset: line.parent_schedule_preset ?? null,
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
 * Guardians (canManageChild) / Open-their-phone admins, and the line's child login.
 */
export function canEditLineGreeting(db: Database.Database, userId: string, lineId: string): boolean {
  if (canManageChild(db, userId, lineId)) return true;
  if (canAdminProvisionedRelativeLine(db, userId, lineId)) return true;
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
  // Silent skip for invite/sync paths — review account circle stays Cameron-only.
  if (
    isTestReviewAccount(db, sphere.owner_user_id) &&
    !testReviewAllowedLineIds(db, sphere.owner_user_id).has(lineId)
  ) {
    return;
  }
  // Review softphone must never join a parent circle (kids inherit those lists).
  // Only the test account’s own circle may contain it; Cameron keeps it on allowlist only.
  if (isTestReviewLineId(db, lineId) && !isTestReviewAccount(db, sphere.owner_user_id)) {
    return;
  }
  // Grandparent pads never receive other grandparents in their Circle (shared kid ≠ shared book).
  if (isGrandparentPeerAccount(db, sphere.owner_user_id) && isGrandparentPeerLine(db, lineId)) {
    const line = db.prepare(`SELECT owner_user_id FROM lines WHERE id = ?`).get(lineId) as
      | { owner_user_id: string }
      | undefined;
    if (!line || line.owner_user_id !== sphere.owner_user_id) return;
  }
  // Co-parent parent lines stay in the owner’s Circle only (Casey ≠ Jordan).
  if (isPodPeerParentLine(db, sphere.owner_user_id, lineId)) return;
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

function inviteKindFrom(raw: unknown): InviteKind {
  if (raw === "friend") return "friend";
  if (raw === "grandparent") return "grandparent";
  return "family";
}

/** Normalize invite row (legacy DBs may omit kind / target kid). */
export function normalizeInvite(row: Invite | Record<string, unknown>): Invite {
  const r = row as Invite;
  return {
    ...r,
    kind: inviteKindFrom(r.kind),
    target_kid_line_id: r.target_kid_line_id ? String(r.target_kid_line_id) : null,
  };
}

/**
 * After a line is created: put parent lines in the owner’s sphere; bridge invite
 * households so both sides can discover each other for mutual approve.
 * Friend invites stay scoped to one child’s Circle — never whole-Pod fan-out.
 */
export function syncLineIntoSpheres(db: Database.Database, line: Line): void {
  const mode = line.mode || "parent";
  if (mode !== "child") {
    const sphere = ensureSphereForParent(db, line.owner_user_id);
    addLineToSphere(db, sphere.id, line.id, line.owner_user_id);
  }

  const redeemedInvites = (
    db
      .prepare(`SELECT * FROM invites WHERE redeemed_by_household_id = ?`)
      .all(line.household_id) as Invite[]
  ).map(normalizeInvite);

  for (const inv of redeemedInvites) {
    if (inv.kind === "friend" && inv.target_kid_line_id) {
      // Friend Pod grew a line → only the target kid’s managers discover it.
      for (const parentId of circleManagersForKid(db, inv.from_household_id, inv.target_kid_line_id)) {
        const inviterSphere = ensureSphereForParent(db, parentId);
        addLineToSphere(db, inviterSphere.id, line.id, parentId);
      }
      // Friend parents only ever see that kid — not the rest of the inviting Pod.
      for (const parentId of householdParentUserIds(db, line.household_id)) {
        const redeemerSphere = ensureSphereForParent(db, parentId);
        addLineToSphere(db, redeemerSphere.id, inv.target_kid_line_id, parentId);
      }
      continue;
    }
    // Family invite: co-parents on both Pods share discovery.
    for (const parentId of householdParentUserIds(db, inv.from_household_id)) {
      const inviterSphere = ensureSphereForParent(db, parentId);
      addLineToSphere(db, inviterSphere.id, line.id, parentId);
    }
    const inviterLines = db
      .prepare(`SELECT id FROM lines WHERE household_id = ?`)
      .all(inv.from_household_id) as { id: string }[];
    for (const parentId of householdParentUserIds(db, line.household_id)) {
      const redeemerSphere = ensureSphereForParent(db, parentId);
      for (const l of inviterLines) {
        addLineToSphere(db, redeemerSphere.id, l.id, parentId);
      }
    }
  }

  // This household sent invites that were redeemed → add this new line into every
  // redeemed Pod (family) or only when the line is the friend-target kid.
  const asInviter = (
    db
      .prepare(
        `SELECT * FROM invites
         WHERE from_household_id = ? AND redeemed_by_household_id IS NOT NULL`
      )
      .all(line.household_id) as Invite[]
  ).map(normalizeInvite);
  for (const inv of asInviter) {
    if (inv.kind === "friend" && inv.target_kid_line_id) {
      if (line.id !== inv.target_kid_line_id) continue;
      for (const parentId of householdParentUserIds(db, inv.redeemed_by_household_id!)) {
        const redeemerSphere = ensureSphereForParent(db, parentId);
        addLineToSphere(db, redeemerSphere.id, line.id, parentId);
      }
      continue;
    }
    for (const parentId of householdParentUserIds(db, inv.redeemed_by_household_id!)) {
      const redeemerSphere = ensureSphereForParent(db, parentId);
      addLineToSphere(db, redeemerSphere.id, line.id, parentId);
    }
  }

  // New child line: default to the creating parent’s Circle only (co-parents opt in later).
  if (mode === "child") {
    const sph = ensureSphereForParent(db, line.owner_user_id);
    grantLineSphereAccess(db, line.id, sph.id);
  }
}

/**
 * If `lineHouseholdId` joined via a friend invite for one of the viewer’s guarded kids,
 * return that kid. Those lines are the kid’s friends (Owen → Quinn), not the parent’s contacts.
 */
export function friendInviteKidForViewer(
  db: Database.Database,
  viewerUserId: string,
  lineHouseholdId: string
): { id: string; label: string } | null {
  const row = db
    .prepare(
      `SELECT l.id, COALESCE(NULLIF(l.child_label, ''), l.name) AS label
       FROM invites i
       JOIN lines l ON l.id = i.target_kid_line_id
       JOIN child_guardians g ON g.line_id = l.id AND g.user_id = ?
       WHERE i.kind = 'friend' AND i.redeemed_by_household_id = ?
       ORDER BY i.created_at ASC
       LIMIT 1`
    )
    .get(viewerUserId, lineHouseholdId) as { id: string; label: string } | undefined;
  return row ?? null;
}

/** Guardians who may curate a kid’s Circle (invite friends onto it).
 * Pod aunts/uncles who join the family name are NOT automatic Circle managers —
 * only guardians of that child (Morgan for Sam; sister for her own kids).
 */
export function circleManagersForKid(
  db: Database.Database,
  householdId: string,
  kidLineId: string
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const kid = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(kidLineId) as Line | undefined;
  if (!kid || kid.household_id !== householdId) return out;
  const guardians = db
    .prepare(`SELECT user_id FROM child_guardians WHERE line_id = ?`)
    .all(kidLineId) as { user_id: string }[];
  for (const g of guardians) {
    if (!g.user_id || seen.has(g.user_id) || isChildOnlyAccount(db, g.user_id)) continue;
    seen.add(g.user_id);
    out.push(g.user_id);
  }
  return out;
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

  // Review account: Cameron + self only — never transitive circle / invite discovery.
  if (isTestReviewAccount(db, viewerUserId)) {
    return testReviewAllowedLineIds(db, viewerUserId).has(targetLineId);
  }
  // Everyone except Cameron: Test’s softphone does not exist.
  if (testReviewUserIdForLine(db, target)) {
    return isTestReviewContactAccount(db, viewerUserId);
  }

  if (userInHousehold(db, target.household_id, viewerUserId)) {
    // Merged GPs on a family Pod must not inherit every Pod adult (Drew/Casey)
    // just because they share the household membership row.
    if (isGrandparentPeerAccount(db, viewerUserId)) {
      if (target.owner_user_id === viewerUserId) return true;
      return grandparentMaySeeLine(db, viewerUserId, target);
    }
    return true;
  }
  if (isGuardian(db, viewerUserId, targetLineId)) return true;

  // Pod adults see kids who belong to that Pod (multi-Pod kids via guardians’ family names).
  // Does not grant Circle friends — only the child lines themselves.
  if ((target.mode || "parent") === "child" && !isChildOnlyAccount(db, viewerUserId)) {
    for (const podId of podsForKid(db, targetLineId)) {
      if (userInHousehold(db, podId, viewerUserId)) return true;
    }
  }

  // Grandparents who share a grandchild still must not discover each other.
  if (
    isGrandparentPeerAccount(db, viewerUserId) &&
    isGrandparentPeerLine(db, targetLineId) &&
    target.owner_user_id !== viewerUserId
  ) {
    return false;
  }

  // Own circle only — not transitive co-membership in a host parent’s circle.
  // Grandparents: Circles are scrubbed to grandchildren; never treat drifted
  // North co-parents as discoverable via sphere membership.
  const owned = getSphereByOwner(db, viewerUserId);
  if (owned) {
    const inMine = db
      .prepare(`SELECT 1 FROM sphere_members WHERE sphere_id = ? AND line_id = ?`)
      .get(owned.id, targetLineId);
    if (inMine) {
      if (isGrandparentPeerAccount(db, viewerUserId)) {
        return grandparentMaySeeLine(db, viewerUserId, target);
      }
      return true;
    }
  }

  // Pod-shared allowlist (GP book, household contacts): any parent *member* of that
  // Pod — not only the household owner. Sibling on East must see Grandma when her
  // line lives in a separate relative household. Still not other parents’ private
  // Circles (those are sphere_members, not allowlist).
  //
  // Grandparents: shared family allowlists may hold a cross-Pod co-parent (Jordan @
  // East slot 2 for Cameron). That row is for parents/kids — GPs only see their
  // Pod’s adults + grandchildren from those rows.
  // Another kid’s co-parent row (Cameron on North for Alex) is not Casey’s contact.
  const podRows = db
    .prepare(
      `SELECT a.household_id FROM allowlist a
       JOIN household_members hm ON hm.household_id = a.household_id AND hm.user_id = ?
       WHERE a.target_line_id = ?`
    )
    .all(viewerUserId, targetLineId) as { household_id: string }[];
  const approvedByViewer = Boolean(
    db
      .prepare(`SELECT 1 FROM parent_contacts WHERE owner_user_id = ? AND target_line_id = ?`)
      .get(viewerUserId, targetLineId)
  );
  const onPodAllowlist = podRows.some((r) => {
    const kids = podKidsGuardedByLineOwner(db, r.household_id, targetLineId);
    return !kids.length || kids.some((kidId) => isGuardian(db, viewerUserId, kidId)) || approvedByViewer;
  });
  if (onPodAllowlist) {
    if (isGrandparentPeerAccount(db, viewerUserId)) {
      return grandparentMaySeeLine(db, viewerUserId, target);
    }
    return true;
  }

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

  return false;
}

/** Factory Quiet Time: kids Bedtime 8pm–7am; parents/GPs Evenings 9pm–7am. */
const DEFAULT_QUIET_TZ = "America/New_York";
const DEFAULT_KID_SCHEDULE_PRESET = "bedtime";
const DEFAULT_PARENT_SCHEDULE_PRESET = "evenings";

export function createHousehold(db: Database.Database, userId: string, name: string): Household {
  assertMothershipCanAddPod(db);
  const household: Household = {
    id: newId("hh"),
    name: name.trim() || "Family",
    owner_user_id: userId,
    kill_switch: 0,
    quiet_start: "20:00",
    quiet_end: "07:00",
    quiet_tz: DEFAULT_QUIET_TZ,
    quiet_days: null,
    skip_holidays: 0,
    daily_cap_minutes: null,
    parent_pin_hash: null,
    schedule_preset: DEFAULT_KID_SCHEDULE_PRESET,
    dnd: 0,
    parent_quiet_start: "21:00",
    parent_quiet_end: "07:00",
    parent_quiet_tz: DEFAULT_QUIET_TZ,
    parent_quiet_days: null,
    parent_schedule_preset: DEFAULT_PARENT_SCHEDULE_PRESET,
    layout_locked: 1,
    ring_volume: 70,
    ringer_style: "classic",
    pad1_parent_line_id: null,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO households (id, name, owner_user_id, kill_switch, quiet_start, quiet_end, quiet_tz, quiet_days, skip_holidays, daily_cap_minutes, parent_pin_hash, schedule_preset, dnd, parent_quiet_start, parent_quiet_end, parent_quiet_tz, parent_quiet_days, parent_schedule_preset, layout_locked, ring_volume, ringer_style, pad1_parent_line_id, created_at)
     VALUES (@id, @name, @owner_user_id, @kill_switch, @quiet_start, @quiet_end, @quiet_tz, @quiet_days, @skip_holidays, @daily_cap_minutes, @parent_pin_hash, @schedule_preset, @dnd, @parent_quiet_start, @parent_quiet_end, @parent_quiet_tz, @parent_quiet_days, @parent_schedule_preset, @layout_locked, @ring_volume, @ringer_style, @pad1_parent_line_id, @created_at)`
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
  const hh = db.prepare(`SELECT * FROM households WHERE id = ?`).get(householdId) as
    | Household
    | undefined;
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
    parent_quiet_start: mode === "child" ? null : hh?.parent_quiet_start ?? "21:00",
    parent_quiet_end: mode === "child" ? null : hh?.parent_quiet_end ?? "07:00",
    parent_quiet_tz: mode === "child" ? null : hh?.parent_quiet_tz ?? DEFAULT_QUIET_TZ,
    parent_quiet_days: mode === "child" ? null : hh?.parent_quiet_days ?? null,
    parent_schedule_preset:
      mode === "child" ? null : hh?.parent_schedule_preset ?? DEFAULT_PARENT_SCHEDULE_PRESET,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO lines (id, household_id, name, type, owner_user_id, online, mode, child_label, child_user_id, answering_machine, parent_quiet_start, parent_quiet_end, parent_quiet_tz, parent_quiet_days, parent_schedule_preset, created_at)
     VALUES (@id, @household_id, @name, @type, @owner_user_id, @online, @mode, @child_label, @child_user_id, @answering_machine, @parent_quiet_start, @parent_quiet_end, @parent_quiet_tz, @parent_quiet_days, @parent_schedule_preset, @created_at)`
  ).run(line);
  if (mode === "child") {
    ensureGuardian(db, line.id, userId);
    // Do not auto-add the Pod owner as guardian of another parent's kid
    // (shared North: Casey owns Quinn; Drew owns Sam — peer parents stay out).
    if (getMothershipBillingSettings(db).enabled) {
      ensureCircleBillingRow(db, line.id, householdId);
    }
  }
  syncLineIntoSpheres(db, line);
  if (mode === "child") {
    syncKidFamilyLinks(db, line.id);
  } else if (!isProvisionedRelativeLine(db, line.id)) {
    // Co-parent / Pod parent who got a phone after joining.
    syncFamilyLinksForGuardian(db, userId);
  }
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
  // Grandparent phones stay grandparent — set by provisioning, never flipped from the Parent UI.
  const isGpLine = line.mode === "grandparent";
  let mode: Line["mode"] = isGpLine
    ? "grandparent"
    : patch.mode === undefined
      ? line.mode || "parent"
      : patch.mode;
  if (!isGpLine && mode !== "parent" && mode !== "child") {
    throw new Error("mode must be parent or child");
  }
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
    // Same rule as addLine: Pod owner is not silently made guardian of peer kids.
  }
  const updated = normalizeLine(db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line);
  if (mode === "child" && (line.mode || "parent") !== "child") {
    // Newly flipped to kid: grant default circle access for household parents.
    syncLineIntoSpheres(db, updated);
    syncKidFamilyLinks(db, lineId);
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
    db.prepare(`DELETE FROM adult_family_room_members WHERE line_id = ?`).run(lineId);
    db.prepare(
      `DELETE FROM family_room_talk_pairs WHERE line_a = ? OR line_b = ?`
    ).run(lineId, lineId);
    db.prepare(`DELETE FROM sphere_members WHERE line_id = ?`).run(lineId);
    db.prepare(`DELETE FROM line_sphere_access WHERE line_id = ?`).run(lineId);
    db.prepare(`DELETE FROM child_guardians WHERE line_id = ?`).run(lineId);
    db.prepare(`DELETE FROM guardian_invites WHERE line_id = ?`).run(lineId);
    db.prepare(`DELETE FROM ata_devices WHERE line_id = ?`).run(lineId);
    db.prepare(`DELETE FROM call_logs WHERE from_line_id = ? OR to_line_id = ?`).run(lineId, lineId);
    deleteCircleBillingRow(db, lineId);
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
  db.prepare(`DELETE FROM adult_family_room_members WHERE line_id = ?`).run(lineId);
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
  deleteCircleBillingRow(db, lineId);
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

export function createInvite(
  db: Database.Database,
  householdId: string,
  userId: string,
  opts: { kind?: InviteKind | string; targetKidLineId?: string | null } = {}
): Invite {
  if (!canCreateHouseholdInvite(db, userId, householdId)) {
    throw new Error("Only parents can invite family");
  }
  const kind: InviteKind = inviteKindFrom(opts.kind);
  let targetKidLineId: string | null = null;
  if (kind === "friend") {
    const kidId = String(opts.targetKidLineId || "").trim();
    if (!kidId) throw new Error("Pick which kid this friend can call");
    const kid = db
      .prepare(`SELECT * FROM lines WHERE id = ? AND household_id = ?`)
      .get(kidId, householdId) as Line | undefined;
    if (!kid || (kid.mode || "parent") !== "child") {
      throw new Error("Pick a kid from this family");
    }
    if (!canManageChild(db, userId, kidId)) {
      throw new Error("Only that kid’s parents can invite a friend to their Circle");
    }
    targetKidLineId = kidId;
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
    kind,
    target_kid_line_id: targetKidLineId,
  };
  db.prepare(
    `INSERT INTO invites (id, code, from_household_id, created_by, expires_at, redeemed_by_household_id, created_at, kind, target_kid_line_id)
     VALUES (@id, @code, @from_household_id, @created_by, @expires_at, @redeemed_by_household_id, @created_at, @kind, @target_kid_line_id)`
  ).run(invite);
  return invite;
}

/** Owner household first, then any membership — existing Pods redeem into this. */
export function primaryHouseholdIdForUser(db: Database.Database, userId: string): string | null {
  const owned = db
    .prepare(`SELECT id FROM households WHERE owner_user_id = ? ORDER BY created_at LIMIT 1`)
    .get(userId) as { id: string } | undefined;
  if (owned) return owned.id;
  const member = db
    .prepare(`SELECT household_id FROM household_members WHERE user_id = ? LIMIT 1`)
    .get(userId) as { household_id: string } | undefined;
  return member?.household_id || null;
}

/** Safe preview for “you’ve been invited” — family name only, never SIP secrets. */
export function peekInvite(
  db: Database.Database,
  code: string
): {
  code: string;
  fromHouseholdName: string;
  expiresAt: string;
  kind: InviteKind;
  targetKidLabel: string | null;
} {
  const raw = db.prepare(`SELECT * FROM invites WHERE code = ?`).get(String(code || "").trim()) as
    | Invite
    | undefined;
  if (!raw) throw new Error("Invite not found");
  const invite = normalizeInvite(raw);
  if (invite.redeemed_by_household_id) throw new Error("Invite already used");
  if (invite.expires_at < nowIso()) throw new Error("Invite expired");
  const hh = db.prepare(`SELECT name FROM households WHERE id = ?`).get(invite.from_household_id) as
    | { name: string }
    | undefined;
  const name = String(hh?.name || "A family").trim() || "A family";
  let targetKidLabel: string | null = null;
  if (invite.kind === "friend" && invite.target_kid_line_id) {
    const kid = db.prepare(`SELECT child_label, name FROM lines WHERE id = ?`).get(invite.target_kid_line_id) as
      | { child_label: string | null; name: string }
      | undefined;
    targetKidLabel = String(kid?.child_label || kid?.name || "a child").trim() || "a child";
  }
  return {
    code: invite.code,
    fromHouseholdName: name,
    expiresAt: invite.expires_at,
    kind: invite.kind,
    targetKidLabel,
  };
}

/** Family invite: bridge both Pods’ lines into each parent’s discovery sphere. */
function bridgeFamilyInviteHouseholds(
  db: Database.Database,
  invite: Invite,
  redeemedHouseholdId: string
): void {
  const fromLines = db
    .prepare(`SELECT id FROM lines WHERE household_id = ?`)
    .all(invite.from_household_id) as { id: string }[];
  const toLines = db
    .prepare(`SELECT id FROM lines WHERE household_id = ?`)
    .all(redeemedHouseholdId) as { id: string }[];
  for (const parentId of householdParentUserIds(db, invite.from_household_id)) {
    const inviterSphere = ensureSphereForParent(db, parentId);
    for (const l of toLines) {
      addLineToSphere(db, inviterSphere.id, l.id, parentId);
    }
  }
  for (const parentId of householdParentUserIds(db, redeemedHouseholdId)) {
    const redeemerSphere = ensureSphereForParent(db, parentId);
    for (const l of fromLines) {
      addLineToSphere(db, redeemerSphere.id, l.id, parentId);
    }
  }
}

/**
 * Friend invite: friend sees only the target kid; kid’s Circle managers see the friend.
 * Never grants North/West Pod membership or whole-Pod directories.
 */
function bridgeFriendInviteToKidCircle(
  db: Database.Database,
  invite: Invite,
  redeemedHouseholdId: string
): void {
  const kidLineId = invite.target_kid_line_id;
  if (!kidLineId) throw new Error("Friend invite is missing which kid");
  const kid = db
    .prepare(`SELECT * FROM lines WHERE id = ? AND household_id = ?`)
    .get(kidLineId, invite.from_household_id) as Line | undefined;
  if (!kid || (kid.mode || "parent") !== "child") {
    throw new Error("Friend invite kid not found");
  }
  const friendLines = db
    .prepare(`SELECT id FROM lines WHERE household_id = ?`)
    .all(redeemedHouseholdId) as { id: string }[];
  for (const parentId of circleManagersForKid(db, invite.from_household_id, kidLineId)) {
    const sph = ensureSphereForParent(db, parentId);
    for (const l of friendLines) {
      addLineToSphere(db, sph.id, l.id, parentId);
    }
  }
  for (const parentId of householdParentUserIds(db, redeemedHouseholdId)) {
    const sph = ensureSphereForParent(db, parentId);
    addLineToSphere(db, sph.id, kidLineId, parentId);
  }
}

/**
 * A redeemed friend invite *is* the approval: friend’s kids ↔ the invited kid only,
 * friend’s parent ↔ the inviting parent. Adult rows take no Pod-wide speed dial.
 */
export function ensureFriendInviteLinks(db: Database.Database, inviteRaw: Invite): void {
  const invite = normalizeInvite(inviteRaw);
  if (invite.kind !== "friend" || !invite.target_kid_line_id || !invite.redeemed_by_household_id) return;
  const kid = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(invite.target_kid_line_id) as Line | undefined;
  if (!kid || kid.mode !== "child") return;
  const friendHh = invite.redeemed_by_household_id;
  const friendParents = householdParentUserIds(db, friendHh);
  const friendKids = friendParents.flatMap(
    (uid) =>
      db
        .prepare(
          `SELECT l.* FROM lines l JOIN child_guardians g ON g.line_id = l.id
           WHERE g.user_id = ? AND l.mode = 'child'`
        )
        .all(uid) as Line[]
  );
  const friendPhones = friendParents
    .map((uid) => parentLineForUser(db, uid))
    .filter((l): l is Line => Boolean(l) && l!.mode === "parent");
  const inviterPhone = parentLineForUser(db, invite.created_by);

  const ensure = (hhId: string, target: Line, actor: string, adult: boolean) => {
    if (target.household_id === hhId) return;
    const exists = db
      .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
      .get(hhId, target.id);
    if (exists) return;
    const label = adult
      ? firstGivenName(
          (db.prepare(`SELECT display_name FROM users WHERE id = ?`).get(target.owner_user_id) as
            | { display_name: string }
            | undefined)?.display_name
        ) || target.name
      : target.child_label || target.name;
    const added = addAllowlist(db, hhId, target.id, label, { actorUserId: actor, skipKidFanout: true });
    // Adults: no Pod-wide digit. Kids: a digit from 3 up — 2 stays each kid’s co-parent.
    let dial: number | null = null;
    if (!adult) {
      const used = new Set(
        (
          db
            .prepare(`SELECT speed_dial FROM allowlist WHERE household_id = ? AND speed_dial IS NOT NULL AND id != ?`)
            .all(hhId, added.id) as { speed_dial: number }[]
        ).map((r) => r.speed_dial)
      );
      for (let s = 3; s <= 9; s++) {
        if (!used.has(s)) {
          dial = s;
          break;
        }
      }
    }
    db.prepare(`UPDATE allowlist SET speed_dial = ? WHERE id = ?`).run(dial, added.id);
  };

  const friendOwner = friendParents[0];
  for (const fk of friendKids) ensure(kid.household_id, fk, invite.created_by, false);
  for (const fp of friendPhones) ensure(kid.household_id, fp, invite.created_by, true);
  if (friendOwner) {
    ensure(friendHh, kid, friendOwner, false);
    if (inviterPhone && inviterPhone.mode === "parent") ensure(friendHh, inviterPhone, friendOwner, true);
  }
}

/** Friend invites that touch this kid (invited kid, or a kid in the friend’s family). */
function syncFriendInviteLinksForKid(db: Database.Database, kidLineId: string): void {
  const pods = podsForKid(db, kidLineId);
  const invites = db
    .prepare(
      `SELECT * FROM invites WHERE kind = 'friend' AND redeemed_by_household_id IS NOT NULL
         AND (target_kid_line_id = ? OR redeemed_by_household_id IN (${pods.map(() => "?").join(",") || "''"}))`
    )
    .all(kidLineId, ...pods) as Invite[];
  for (const inv of invites) ensureFriendInviteLinks(db, inv);
}

function bridgeRedeemedInviteHouseholds(
  db: Database.Database,
  invite: Invite,
  redeemedHouseholdId: string
): void {
  const inv = normalizeInvite(invite);
  if (inv.kind === "friend") {
    bridgeFriendInviteToKidCircle(db, inv, redeemedHouseholdId);
    return;
  }
  if (inv.kind === "grandparent") return;
  bridgeFamilyInviteHouseholds(db, inv, redeemedHouseholdId);
}

export function redeemInvite(
  db: Database.Database,
  code: string,
  userId: string,
  householdName: string
): { invite: Invite; household: Household; created: boolean } {
  assertParentContactAdmin(db, userId);
  const raw = db.prepare(`SELECT * FROM invites WHERE code = ?`).get(code.trim()) as Invite | undefined;
  if (!raw) throw new Error("Invite not found");
  const invite = normalizeInvite(raw);
  if (invite.redeemed_by_household_id) throw new Error("Invite already used");
  if (invite.expires_at < nowIso()) throw new Error("Invite expired");
  if (userInHousehold(db, invite.from_household_id, userId)) {
    throw new Error("That's your own invite — send it to a friend");
  }

  if (invite.kind === "grandparent") {
    const attached = finishGrandparentOnPod(db, invite.from_household_id, userId, {
      createdBy: invite.created_by,
    });
    db.prepare(`UPDATE invites SET redeemed_by_household_id = ? WHERE id = ?`).run(
      attached.household.id,
      invite.id
    );
    return {
      invite: { ...invite, redeemed_by_household_id: attached.household.id },
      household: attached.household,
      created: attached.createdHousehold,
    };
  }

  /**
   * Family / sibling invite: join the inviter’s Pod as a parent (never a child-only account).
   * Parent → parent only; they add their own kids under Kids.
   * Friend invites stay Circle-only below (redeemer is still a parent).
   */
  if (invite.kind === "family") {
    const household = db
      .prepare(`SELECT * FROM households WHERE id = ?`)
      .get(invite.from_household_id) as Household | undefined;
    if (!household) throw new Error("Family not found");
    ensureHouseholdParentMember(db, household.id, userId);
    // Their kids now belong to this Pod too — link this Pod’s grandparents both ways.
    syncFamilyLinksForGuardian(db, userId);
    db.prepare(`UPDATE invites SET redeemed_by_household_id = ? WHERE id = ?`).run(household.id, invite.id);
    return {
      invite: { ...invite, redeemed_by_household_id: household.id },
      household,
      created: false,
    };
  }

  const existingId = primaryHouseholdIdForUser(db, userId);
  let household: Household;
  let created = false;
  if (existingId) {
    household = db.prepare(`SELECT * FROM households WHERE id = ?`).get(existingId) as Household;
  } else {
    household = createHousehold(db, userId, householdName);
    created = true;
  }

  db.prepare(`UPDATE invites SET redeemed_by_household_id = ? WHERE id = ?`).run(household.id, invite.id);
  // Friend’s parent needs a phone now so the inviting parent can approve them (Ken on Casey’s pad).
  if (invite.kind === "friend") ensureParentSoftphoneLine(db, household.id, userId);
  bridgeRedeemedInviteHouseholds(db, invite, household.id);
  if (invite.kind === "friend") {
    ensureFriendInviteLinks(db, { ...invite, redeemed_by_household_id: household.id });
  }

  return { invite: { ...invite, redeemed_by_household_id: household.id }, household, created };
}

/**
 * True when this line’s household (or its owner as guardian) has at least one
 * child-mode line — used to decide whether approving an adult should also bridge
 * *their kids* onto a family Pod book (never to put that adult on a kid Circle).
 */
export function lineHasChildAccounts(db: Database.Database, lineId: string): boolean {
  const line = db
    .prepare(`SELECT household_id, owner_user_id, IFNULL(mode, 'parent') AS mode FROM lines WHERE id = ?`)
    .get(lineId) as { household_id: string; owner_user_id: string; mode: string } | undefined;
  if (!line) return false;
  if (line.mode === "child") return false;
  const inHouse = db
    .prepare(
      `SELECT 1 FROM lines WHERE household_id = ? AND IFNULL(mode, 'parent') = 'child' LIMIT 1`
    )
    .get(line.household_id);
  if (inHouse) return true;
  const guards = db
    .prepare(
      `SELECT 1 FROM child_guardians g
       JOIN lines l ON l.id = g.line_id
       WHERE g.user_id = ? AND IFNULL(l.mode, 'parent') = 'child' LIMIT 1`
    )
    .get(line.owner_user_id);
  return Boolean(guards);
}

/**
 * Kid Circle allowlist rows: **kids, grandparents, and that child’s own parents**.
 * Never other adults — even parents who have kids of their own (Ken ≠ Alex’s Circle).
 *
 * @param forKidLineId when set, parent-mode contacts must guard *this* kid (Mom/Dad).
 */
export function allowlistTargetVisibleOnKidCircle(
  db: Database.Database,
  targetLineId: string,
  forKidLineId?: string | null
): boolean {
  if (!targetLineId) return false;
  if (isGrandparentPeerLine(db, targetLineId)) {
    return Boolean(
      db
        .prepare(`SELECT 1 FROM provisioned_relatives WHERE relative_line_id = ? LIMIT 1`)
        .get(targetLineId)
    );
  }
  const line = db
    .prepare(
      `SELECT household_id, owner_user_id, IFNULL(mode, 'parent') AS mode FROM lines WHERE id = ?`
    )
    .get(targetLineId) as
    | { household_id: string; owner_user_id: string; mode: string }
    | undefined;
  if (!line) return false;
  if (line.mode === "child") return true;

  // Parent-mode: only Mom/Dad (guardians) for this kid — never “adults who have kids.”
  if (forKidLineId) {
    const kid = db
      .prepare(`SELECT id, IFNULL(mode, 'parent') AS mode FROM lines WHERE id = ?`)
      .get(forKidLineId) as { id: string; mode: string } | undefined;
    if (!kid || kid.mode !== "child") return false;
    return isGuardian(db, line.owner_user_id, forKidLineId);
  }
  return false;
}

/**
 * Household allowlist tag: visible on *some* kid Circle in this Pod
 * (child / provisioned GP / guardian of a kid who belongs here).
 */
export function allowlistTargetVisibleOnHouseholdKidCircles(
  db: Database.Database,
  householdId: string,
  targetLineId: string
): boolean {
  if (!targetLineId || !householdId) return false;
  if (isGrandparentPeerLine(db, targetLineId)) {
    return Boolean(
      db
        .prepare(`SELECT 1 FROM provisioned_relatives WHERE relative_line_id = ? LIMIT 1`)
        .get(targetLineId)
    );
  }
  const line = db
    .prepare(`SELECT IFNULL(mode, 'parent') AS mode, owner_user_id FROM lines WHERE id = ?`)
    .get(targetLineId) as { mode: string; owner_user_id: string } | undefined;
  if (!line) return false;
  if (line.mode === "child") return true;
  for (const kid of kidsBelongingToPod(db, householdId)) {
    if (isGuardian(db, line.owner_user_id, kid.id)) return true;
  }
  // Same-house parent line for a kid who lives on this household row.
  const homeKid = db
    .prepare(
      `SELECT id FROM lines
       WHERE household_id = ? AND IFNULL(mode, 'parent') = 'child'
         AND owner_user_id = ?
       LIMIT 1`
    )
    .get(householdId, line.owner_user_id);
  return Boolean(homeKid);
}

/**
 * The contact parent’s own kids (they guard them). Never every kid on their household —
 * approving Casey must not bring his nephews Sam & Blake onto a friend’s book.
 */
function childLinesForContactHousehold(
  db: Database.Database,
  contactLineId: string
): Line[] {
  const contact = db
    .prepare(`SELECT household_id, owner_user_id FROM lines WHERE id = ?`)
    .get(contactLineId) as { household_id: string; owner_user_id: string } | undefined;
  if (!contact) return [];
  return (
    db
      .prepare(
        `SELECT DISTINCT l.* FROM lines l
         LEFT JOIN child_guardians g ON g.line_id = l.id AND g.user_id = ?
         WHERE IFNULL(l.mode, 'parent') = 'child'
           AND (g.user_id IS NOT NULL OR (l.household_id = ? AND l.owner_user_id = ?))
         ORDER BY l.created_at ASC`
      )
      .all(contact.owner_user_id, contact.household_id, contact.owner_user_id) as Line[]
  ).map(normalizeLine);
}

/**
 * Parent approved an adult who has kids → put those kids on this Pod’s book so
 * Circles can call after mutual approve. Never fans grandparents (provision owns that).
 * Only runs on family Pods that already have kids (not a childless adult’s personal pad).
 */
function fanoutContactKidsOntoHouseholdAllowlist(
  db: Database.Database,
  householdId: string,
  contactLineId: string,
  actorUserId: string | undefined
): void {
  if (isGrandparentPeerLine(db, contactLineId)) return;
  if (!lineHasChildAccounts(db, contactLineId)) return;
  const ourKids = db
    .prepare(
      `SELECT 1 FROM lines WHERE household_id = ? AND IFNULL(mode, 'parent') = 'child' LIMIT 1`
    )
    .get(householdId);
  if (!ourKids) return;
  for (const kid of childLinesForContactHousehold(db, contactLineId)) {
    if (kid.id === contactLineId) continue;
    const exists = db
      .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
      .get(householdId, kid.id);
    if (exists) continue;
    const kidLabel = kid.child_label || kid.name || "Friend";
    addAllowlist(db, householdId, kid.id, kidLabel, {
      actorUserId,
      favorite: true,
      skipKidFanout: true,
    });
  }
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
    /**
     * Internal: skip “also add their kids” when this row is itself a fan-out
     * from approving a parent-with-kids on the parent dialpad.
     */
    skipKidFanout?: boolean;
  } = {}
): AllowlistEntry {
  if (opts.actorUserId) assertParentContactAdmin(db, opts.actorUserId);
  const target = db
    .prepare(`SELECT id, household_id, name, mode, owner_user_id FROM lines WHERE id = ?`)
    .get(targetLineId) as
    | {
        id: string;
        household_id: string;
        name: string;
        mode: string | null;
        owner_user_id: string;
      }
    | undefined;
  if (!target) throw new Error("Unknown line");
  const hhOwner = db
    .prepare(`SELECT owner_user_id FROM households WHERE id = ?`)
    .get(householdId) as { owner_user_id: string } | undefined;
  const reviewActor = opts.actorUserId || hhOwner?.owner_user_id;
  if (reviewActor) assertTestReviewMayContactLine(db, reviewActor, targetLineId);
  // Grandparent pods cannot add other grandparents (softphone pad + analog digit map).
  if (
    hhOwner &&
    isGrandparentPeerAccount(db, hhOwner.owner_user_id) &&
    isGrandparentPeerLine(db, targetLineId) &&
    target.owner_user_id !== hhOwner.owner_user_id
  ) {
    throw new Error("Grandparents cannot add other grandparents");
  }
  // Same-household lines (parent ↔ child) may be on the allowlist for speed dial.
  // Softphones must still hide/reject the active line itself (UI + canCall).
  const used = db
    .prepare(`SELECT speed_dial FROM allowlist WHERE household_id = ? AND speed_dial IS NOT NULL`)
    .all(householdId) as { speed_dial: number }[];
  const taken = new Set(used.map((u) => u.speed_dial));
  let speed = opts.speedDial ?? null;
  const secondary = householdSecondaryParentLine(db, householdId);
  // Pads 0–1 are reserved (TreeHouse + locked parent/child). Slot 2 is free for
  // parent-placed contacts; when empty, kid pads synthesize the co-parent there.
  if (speed === 0 || speed === 1) {
    throw new Error("Speed dial 0 is TreeHouse and 1 is locked — pick 2–9 for contacts");
  }
  if (speed != null && (speed < 2 || speed > 9)) {
    throw new Error("Speed dial must be 2–9 (0 is TreeHouse; 1 is locked parent/child)");
  }
  if (speed == null) {
    const sameHhChild =
      target.household_id === householdId && (target.mode || "parent") === "child";
    // Prefer slot 2 for a household kid when co-parent is not already claiming dial 2.
    const dial2Free = !taken.has(2) && (!secondary || !secondaryParentOwnsDial2(db, householdId, secondary.id));
    if (sameHhChild && dial2Free) {
      speed = 2;
    } else {
      const start =
        secondary && secondaryParentOwnsDial2(db, householdId, secondary.id) && !taken.has(2)
          ? 3
          : 2;
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

  // Grandma’s phone: adults added by a GP (or onto a private GP house) are dial-book
  // only — not auto Pod parents. Never flag ordinary parent-pad rows on a shared Pod.
  const actorIsGp = Boolean(opts.actorUserId && isGrandparentPeerAccount(db, opts.actorUserId));
  const privateGpHouse = Boolean(
    hhOwner &&
      isGrandparentPeerAccount(db, hhOwner.owner_user_id) &&
      !isSharedFamilyPodAllowlist(db, householdId)
  );
  const targetIsChild = (target.mode || "parent") === "child";
  const gpManual =
    !targetIsChild && !isGrandparentPeerLine(db, targetLineId) && (actorIsGp || privateGpHouse)
      ? 1
      : 0;

  const entry: AllowlistEntry = {
    id: newId("al"),
    household_id: householdId,
    target_line_id: targetLineId,
    label: cleanLabel,
    speed_dial: speed,
    favorite: opts.favorite === false ? 0 : 1,
    always_allow: opts.alwaysAllow ? 1 : 0,
    gp_manual: gpManual,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT OR REPLACE INTO allowlist (id, household_id, target_line_id, label, speed_dial, favorite, always_allow, gp_manual, created_at)
     VALUES (@id, @household_id, @target_line_id, @label, @speed_dial, @favorite, @always_allow, @gp_manual, @created_at)`
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

  // A parent approving another adult: that parent’s own contact (both ways if family).
  if (opts.actorUserId) recordParentContactApproval(db, opts.actorUserId, targetLineId);

  // Parent dialpad ≠ kid Circle. Adults without kids (and grandparents) stay on
  // the parent pad only. Parents-with-kids also bridge their kids onto the book.
  // Grandparent pads skip fan-out — only auto grandchildren + explicit adults.
  if (!opts.skipKidFanout && !(opts.actorUserId && isGrandparentPeerAccount(db, opts.actorUserId))) {
    fanoutContactKidsOntoHouseholdAllowlist(db, householdId, targetLineId, actor);
  }
  return entry;
}

/** The two adults are family: one belongs to a Pod that the other’s kid belongs to. */
function adultsAreFamily(db: Database.Database, userA: string, userB: string): boolean {
  const kidsOf = (uid: string) =>
    (
      db
        .prepare(
          `SELECT l.id FROM child_guardians g JOIN lines l ON l.id = g.line_id
           WHERE g.user_id = ? AND l.mode = 'child'`
        )
        .all(uid) as { id: string }[]
    ).map((r) => r.id);
  const podsOf = (uid: string) =>
    new Set(
      (db.prepare(`SELECT household_id FROM household_members WHERE user_id = ?`).all(uid) as {
        household_id: string;
      }[]).map((r) => r.household_id)
    );
  const aPods = podsOf(userA);
  const bPods = podsOf(userB);
  return (
    kidsOf(userA).some((k) => podsForKid(db, k).some((p) => bPods.has(p))) ||
    kidsOf(userB).some((k) => podsForKid(db, k).some((p) => aPods.has(p)))
  );
}

/**
 * Parent approved another parent’s phone on their own dialpad. Family (in-laws,
 * a kid’s uncle) is mutual right away; anyone else waits for the other side.
 */
export function recordParentContactApproval(
  db: Database.Database,
  actorUserId: string,
  targetLineId: string
): void {
  if (isChildOnlyAccount(db, actorUserId) || isGrandparentPeerAccount(db, actorUserId)) return;
  const target = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(targetLineId) as Line | undefined;
  if (!target || target.mode !== "parent" || target.owner_user_id === actorUserId) return;
  if (isGrandparentPeerLine(db, targetLineId)) return;
  const ins = db.prepare(
    `INSERT OR IGNORE INTO parent_contacts (owner_user_id, target_line_id, created_at) VALUES (?, ?, ?)`
  );
  ins.run(actorUserId, targetLineId, nowIso());
  if (adultsAreFamily(db, actorUserId, target.owner_user_id)) {
    const mine = parentLineForUser(db, actorUserId);
    if (mine && mine.mode === "parent") ins.run(target.owner_user_id, mine.id, nowIso());
  }
}

/** Both adults approved each other on their own dialpads. */
function parentContactsMutual(db: Database.Database, a: Line, b: Line): boolean {
  const has = db.prepare(`SELECT 1 FROM parent_contacts WHERE owner_user_id = ? AND target_line_id = ?`);
  return Boolean(has.get(a.owner_user_id, b.id) && has.get(b.owner_user_id, a.id));
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
 * Pod kids are always TreeHouse-eligible (legacy “always allowed” chip).
 * Parents are not auto-talkers — they use listen-only (see treehouse.listen.*).
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

/**
 * TreeHouse (pad 0) join: any **child** line on this Mothership.
 * Not pod-scoped — cousins from other Pods may enter; hearing is Circle-filtered.
 * Parents never talk-join (listen-only).
 */
export function canJoinTreeHouse(db: Database.Database, lineId: string): boolean {
  const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line | undefined;
  if (!line) return false;
  return (line.mode || "parent") === "child";
}

/**
 * @deprecated Prefer canJoinTreeHouse — TreeHouse is mothership-wide for kids.
 * Kept for older callers; householdId is ignored.
 */
export function canJoinFamilyRoom(
  db: Database.Database,
  _householdId: string,
  lineId: string
): boolean {
  return canJoinTreeHouse(db, lineId);
}

/** All kid lines on this Mothership (TreeHouse join pool). */
export function listTreeHouseKidLineIds(db: Database.Database): string[] {
  const rows = db
    .prepare(
      `SELECT id FROM lines
       WHERE IFNULL(mode, 'parent') = 'child'
       ORDER BY created_at ASC, id ASC`
    )
    .all() as { id: string }[];
  return rows.map((r) => r.id);
}

/** Household kid lines (parent UI “always on” list for this Pod). */
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

/** Mutual allowlist (each Pod lists the other) — Circle-approved contact. */
export function linesMutuallyAllowlisted(
  db: Database.Database,
  lineA: string,
  lineB: string
): boolean {
  const a = db.prepare(`SELECT household_id FROM lines WHERE id = ?`).get(lineA) as
    | { household_id: string }
    | undefined;
  const b = db.prepare(`SELECT household_id FROM lines WHERE id = ?`).get(lineB) as
    | { household_id: string }
    | undefined;
  if (!a || !b) return false;
  const aHasB = db
    .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
    .get(a.household_id, lineB);
  const bHasA = db
    .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
    .get(b.household_id, lineA);
  return Boolean(aHasB && bHasA);
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
 * Symmetric TreeHouse hearing: A hears B iff B hears A.
 * Mothership room may hold kids from every Pod; each child only hears
 * people in **their Circles** (mutual allowlist / shared sphere) plus
 * same-Pod siblings. Legacy talk pairs still count as an explicit edge.
 */
export function canTalkInTreeHouse(
  db: Database.Database,
  lineA: string,
  lineB: string
): boolean {
  if (!lineA || !lineB || lineA === lineB) return false;
  if (!canJoinTreeHouse(db, lineA) || !canJoinTreeHouse(db, lineB)) return false;

  const a = db.prepare(`SELECT household_id FROM lines WHERE id = ?`).get(lineA) as
    | { household_id: string }
    | undefined;
  const b = db.prepare(`SELECT household_id FROM lines WHERE id = ?`).get(lineB) as
    | { household_id: string }
    | undefined;
  if (!a || !b) return false;

  // Same-Pod siblings always hear each other in TreeHouse (multi-Pod kids included).
  if (a.household_id === b.household_id || linesShareFamilyPod(db, lineA, lineB)) return true;

  // Circle-approved contact (mutual allowlist).
  if (linesMutuallyAllowlisted(db, lineA, lineB)) return true;

  // Shared parent Circle (sphere membership / kid access).
  if (linesShareSphere(db, lineA, lineB)) return true;

  // Legacy explicit TreeHouse talk pairs on either Pod.
  if (hasExplicitTalkPair(db, a.household_id, lineA, lineB)) return true;
  if (hasExplicitTalkPair(db, b.household_id, lineA, lineB)) return true;

  return false;
}

/**
 * @deprecated Prefer canTalkInTreeHouse — householdId ignored (mothership Circles).
 */
export function canTalkInFamilyRoom(
  db: Database.Database,
  _householdId: string,
  lineA: string,
  lineB: string
): boolean {
  return canTalkInTreeHouse(db, lineA, lineB);
}

/** Line ids in the room this line may exchange audio with (symmetric Circles). */
export function treeHouseTalkPeers(
  db: Database.Database,
  lineId: string,
  memberIds: string[]
): string[] {
  return memberIds.filter((other) => canTalkInTreeHouse(db, lineId, other));
}

/** @deprecated Prefer treeHouseTalkPeers */
export function familyRoomTalkPeers(
  db: Database.Database,
  _householdId: string,
  lineId: string,
  memberIds: string[]
): string[] {
  return treeHouseTalkPeers(db, lineId, memberIds);
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
    // Provisioned grandparents stay on the simple pad — parents manage them via Open their phone.
    if (isProvisionedRelativeUser(db, userId)) {
      db.prepare(`UPDATE users SET profile_role = 'grandparent' WHERE id = ?`).run(userId);
    } else {
      const role =
        patch.profile_role === "" || patch.profile_role === null
          ? null
          : normalizeProfileRole(patch.profile_role);
      db.prepare(`UPDATE users SET profile_role = ? WHERE id = ?`).run(role, userId);
    }
  }
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as User;
}

/**
 * When a parent picks Mom/Dad, rewrite stale personal-name allowlist nicknames
 * to their first name. Shared Pods host kids with different guardians — never
 * stamp a global "Dad" on every household. Kid UI uses {@link kidFacingAdultLabel}.
 */
function syncParentTitleAllowlistLabels(db: Database.Database, userId: string): void {
  const parentLines = db
    .prepare(
      `SELECT id, household_id, name, child_label FROM lines
       WHERE owner_user_id = ? AND IFNULL(mode, 'parent') != 'child'`
    )
    .all(userId) as { id: string; household_id: string; name: string; child_label: string | null }[];
  if (!parentLines.length) return;
  const user = db.prepare(`SELECT display_name, parent_title FROM users WHERE id = ?`).get(userId) as
    | { display_name: string; parent_title: string | null }
    | undefined;
  if (user?.parent_title !== "mom" && user?.parent_title !== "dad") return;
  const first =
    firstGivenName(user.display_name) ||
    firstGivenName(parentLines[0]!.child_label) ||
    firstGivenName(parentLines[0]!.name);
  if (!first) return;
  const aliases = new Set<string>();
  const addAlias = (raw: string | null | undefined) => {
    const cleaned = String(raw || "")
      .replace(/'s phone$/i, "")
      .replace(/\s+phone$/i, "")
      .trim()
      .toLowerCase();
    if (!cleaned) return;
    aliases.add(cleaned);
    const token = cleaned.split(/\s+/)[0];
    if (token) aliases.add(token);
  };
  addAlias(user.display_name);
  addAlias(`aunt ${first}`);
  addAlias(`uncle ${first}`);
  addAlias("mom");
  addAlias("dad");
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
      if (!cur || cur === first.toLowerCase()) continue;
      if (aliases.has(cur) || cur === "contact") upd.run(first, row.id);
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

/** First given name from a display / line label (strips “'s phone”, Aunt/Uncle/Mom/Dad). */
export function firstGivenName(raw: string | null | undefined): string {
  let s = String(raw || "")
    .replace(/'s phone$/i, "")
    .replace(/\s+phone$/i, "")
    .trim();
  s = s.replace(/^(aunt|uncle|mom|dad|grandma|grandpa|gramma|papa|nana|meemaw)\s+/i, "").trim();
  const first = s.split(/\s+/).filter(Boolean)[0] || "";
  return first;
}

/** Aunt / Uncle honorific from a parent_title (mom→Aunt, dad→Uncle). */
export function auntOrUncleHonorific(parentTitle: string | null | undefined): "Aunt" | "Uncle" | null {
  const t = String(parentTitle || "")
    .trim()
    .toLowerCase();
  if (t === "mom") return "Aunt";
  if (t === "dad") return "Uncle";
  return null;
}

/**
 * Mom / Dad / line label for parent-mode lines (adult / generic view).
 * Kid pads and kid call CID must use {@link kidFacingAdultLabel} so only real
 * guardians appear as Mom/Dad; Pod aunts/uncles get Aunt/Uncle + first name.
 */
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

/**
 * How a child should see a parent-mode contact.
 * Guardians → Mom/Dad (from parent_title); other parents → Aunt/Uncle FirstName.
 */
export function kidFacingAdultLabel(
  db: Database.Database,
  adultLineId: string,
  childLineId: string,
  fallback?: string
): string {
  const gp = lookupGrandparentPadLabels(db, adultLineId);
  if (gp) return gp.kid;

  const line = db
    .prepare(
      `SELECT owner_user_id, child_label, name, IFNULL(mode, 'parent') AS mode FROM lines WHERE id = ?`
    )
    .get(adultLineId) as
    | { owner_user_id: string; child_label: string | null; name: string; mode: string }
    | undefined;
  if (!line) return fallback || "Parent";
  if (line.mode === "child") {
    return line.child_label || firstGivenName(line.name) || fallback || "Friend";
  }

  const user = db.prepare(`SELECT display_name, parent_title FROM users WHERE id = ?`).get(line.owner_user_id) as
    | { display_name: string; parent_title: string | null }
    | undefined;
  const first =
    firstGivenName(user?.display_name) ||
    firstGivenName(line.child_label) ||
    firstGivenName(line.name) ||
    "Friend";

  if (isGuardian(db, line.owner_user_id, childLineId)) {
    if (user?.parent_title === "mom") return "Mom";
    if (user?.parent_title === "dad") return "Dad";
    return first;
  }

  const honorific = auntOrUncleHonorific(user?.parent_title);
  if (honorific) return `${honorific} ${first}`;
  // Untitled friend / other adult: keep the allowlist nickname when present.
  const preferred = String(fallback || "")
    .replace(/'s phone$/i, "")
    .replace(/\s+phone$/i, "")
    .trim();
  if (preferred && !/^contact$/i.test(preferred)) return preferred;
  return first;
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
  // Grandparents are parent-mode lines on the Pod, but never Mom/Dad pad 1/2.
  return rows.map(normalizeLine).filter((l) => !isGrandparentPeerLine(db, l.id));
}

/** A parent’s primary softphone line (oldest parent-mode line they own). */
export function parentLineForUser(db: Database.Database, userId: string): Line | null {
  const row = db
    .prepare(
      `SELECT * FROM lines
       WHERE owner_user_id = ? AND IFNULL(mode, 'parent') != 'child'
       ORDER BY created_at ASC, id ASC
       LIMIT 1`
    )
    .get(userId) as Line | undefined;
  return row ? normalizeLine(row) : null;
}

/**
 * Co-parent guardian whose parent line lives in another household (typical invite flow).
 * Skips guardians who already have a parent line in this household.
 */
export function guardianCoParentLineForHousehold(
  db: Database.Database,
  householdId: string,
  excludeLineIds: Set<string> = new Set()
): Line | null {
  const inHouseParentUserIds = new Set(
    listHouseholdParentLines(db, householdId).map((l) => l.owner_user_id)
  );
  const childLines = db
    .prepare(
      `SELECT id FROM lines
       WHERE household_id = ? AND IFNULL(mode, 'parent') = 'child'
       ORDER BY created_at ASC, id ASC`
    )
    .all(householdId) as { id: string }[];
  for (const { id: childLineId } of childLines) {
    const guardians = db
      .prepare(
        `SELECT user_id FROM child_guardians WHERE line_id = ? ORDER BY created_at ASC`
      )
      .all(childLineId) as { user_id: string }[];
    for (const { user_id } of guardians) {
      if (inHouseParentUserIds.has(user_id)) continue;
      const line = parentLineForUser(db, user_id);
      if (line && line.household_id !== householdId && !excludeLineIds.has(line.id)) {
        return line;
      }
    }
  }
  return null;
}

/**
 * Ensure a guardian co-parent (parent line in another household) can call the kid
 * and appears on dial 2 / speed-dial slot 2 for analog + softphone pads.
 */
export function syncGuardianCoParentAllowlist(
  db: Database.Database,
  childLineId: string,
  guardianUserId: string
): void {
  const child = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(childLineId) as Line | undefined;
  if (!child || (child.mode || "parent") !== "child") return;

  const guardianLine = parentLineForUser(db, guardianUserId);
  if (!guardianLine || guardianLine.household_id === child.household_id) return;

  const kidHh = child.household_id;
  const gpHh = guardianLine.household_id;
  const kidLabel = child.child_label || child.name || "Kid";
  const gpLabel = parentDisplayLabel(db, guardianLine.id);

  const admin = householdAdminParentLine(db, kidHh);
  if (admin) {
    db.prepare(`DELETE FROM allowlist WHERE household_id = ? AND target_line_id = ?`).run(
      kidHh,
      admin.id
    );
  }

  const onKidHh = db
    .prepare(`SELECT id, speed_dial FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
    .get(kidHh, guardianLine.id) as { id: string; speed_dial: number | null } | undefined;
  if (!onKidHh) {
    // Adult auto-placed on 2 before this co-parent joined (Grandma) moves to the next free slot.
    // Kids parents put on 2 and other kids’ co-parents keep it.
    const occupants = db
      .prepare(`SELECT id, target_line_id FROM allowlist WHERE household_id = ? AND speed_dial = 2`)
      .all(kidHh) as { id: string; target_line_id: string }[];
    const kidOnTwo = occupants.some(
      (o) =>
        (db.prepare(`SELECT IFNULL(mode, 'parent') AS mode FROM lines WHERE id = ?`).get(o.target_line_id) as
          | { mode: string }
          | undefined)?.mode === "child"
    );
    if (!kidOnTwo) {
      for (const o of occupants) {
        if (podKidsGuardedByLineOwner(db, kidHh, o.target_line_id).length) continue;
        const used = new Set(
          (
            db
              .prepare(`SELECT speed_dial FROM allowlist WHERE household_id = ? AND speed_dial IS NOT NULL`)
              .all(kidHh) as { speed_dial: number }[]
          ).map((r) => r.speed_dial)
        );
        let free: number | null = null;
        for (let s = 3; s <= 9; s++) {
          if (!used.has(s)) {
            free = s;
            break;
          }
        }
        db.prepare(`UPDATE allowlist SET speed_dial = ? WHERE id = ?`).run(free, o.id);
      }
    }
    try {
      addAllowlist(db, kidHh, guardianLine.id, gpLabel, { speedDial: 2, actorUserId: guardianUserId });
    } catch {
      addAllowlist(db, kidHh, guardianLine.id, gpLabel, { actorUserId: guardianUserId });
    }
  } else if (onKidHh.speed_dial !== 2) {
    const occupant = db
      .prepare(`SELECT id, target_line_id FROM allowlist WHERE household_id = ? AND speed_dial = 2`)
      .get(kidHh) as { id: string; target_line_id: string } | undefined;
    const occupantIsOtherKidsCoParent =
      occupant && podKidsGuardedByLineOwner(db, kidHh, occupant.target_line_id).length > 0;
    if (occupant && occupant.target_line_id !== guardianLine.id && !occupantIsOtherKidsCoParent) {
      try {
        updateAllowlistEntry(db, kidHh, occupant.id, { speed_dial: null });
      } catch {
        /* keep going — still try to claim 2 */
      }
    }
    try {
      updateAllowlistEntry(db, kidHh, onKidHh.id, { speed_dial: 2, label: gpLabel });
    } catch {
      db.prepare(`UPDATE allowlist SET label = ? WHERE id = ?`).run(gpLabel, onKidHh.id);
    }
  } else {
    db.prepare(`UPDATE allowlist SET label = ? WHERE id = ?`).run(gpLabel, onKidHh.id);
  }

  const onGpHh = db
    .prepare(`SELECT id FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
    .get(gpHh, child.id) as { id: string } | undefined;
  if (!onGpHh) {
    addAllowlist(db, gpHh, child.id, kidLabel, { actorUserId: guardianUserId });
  }

  ensureCoParentLinks(db, childLineId);
}

/**
 * Co-parents see each other both ways (Drew on West as well as Morgan on North),
 * and the kid sits on each guardian’s Pod book. Rows only — never moves speed dials.
 */
export function ensureCoParentLinks(db: Database.Database, childLineId: string): void {
  const child = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(childLineId) as Line | undefined;
  if (!child || (child.mode || "parent") !== "child") return;
  const guardianLines = guardianParentLinesForChild(db, childLineId);
  const ensure = (hhId: string, line: Line, label: string, actor: string, skipKidFanout: boolean) => {
    const exists = db
      .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
      .get(hhId, line.id);
    if (exists) return;
    const added = addAllowlist(db, hhId, line.id, label, { actorUserId: actor, skipKidFanout });
    // Co-parent rows on a shared Pod never take a Pod-wide speed dial (Quinn’s 2 ≠ Cameron).
    if ((line.mode || "parent") !== "child") {
      db.prepare(`UPDATE allowlist SET speed_dial = NULL WHERE id = ?`).run(added.id);
    }
  };
  for (const a of guardianLines) {
    if (a.household_id !== child.household_id) {
      ensure(a.household_id, child, child.child_label || child.name || "Kid", a.owner_user_id, false);
    }
    for (const b of guardianLines) {
      if (a.id === b.id || a.household_id === b.household_id) continue;
      ensure(a.household_id, b, parentDisplayLabel(db, b.id), a.owner_user_id, true);
    }
  }
}

/**
 * Write-time family links for one kid: co-parents on each other’s Pods, and every
 * grandparent on every Pod the kid belongs to (Grandma set up before the co-parent joined).
 */
export function syncKidFamilyLinks(db: Database.Database, kidLineId: string): void {
  const kid = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(kidLineId) as Line | undefined;
  if (!kid || (kid.mode || "parent") !== "child") return;
  ensureCoParentLinks(db, kidLineId);
  for (const podId of podsForKid(db, kidLineId)) syncPodGrandparentBooks(db, podId);
  syncFriendInviteLinksForKid(db, kidLineId);
}

/** Re-sync every grandparent provisioned from this Pod (grandchildren + Pod parents). */
export function syncPodGrandparentBooks(db: Database.Database, householdId: string): void {
  const gps = db
    .prepare(`SELECT relative_user_id FROM provisioned_relatives WHERE from_household_id = ?`)
    .all(householdId) as { relative_user_id: string }[];
  for (const { relative_user_id } of gps) {
    syncProvisionedRelativePodBook(db, householdId, relative_user_id);
  }
}

/**
 * A parent’s Pods or phone changed: re-link every kid they guard, and every
 * grandparent on the Pods they belong to (new Pod parent on Grandma’s book).
 */
export function syncFamilyLinksForGuardian(db: Database.Database, userId: string): void {
  if (isChildOnlyAccount(db, userId) || isGrandparentPeerAccount(db, userId)) return;
  const kids = db
    .prepare(
      `SELECT l.id FROM child_guardians g JOIN lines l ON l.id = g.line_id
       WHERE g.user_id = ? AND IFNULL(l.mode, 'parent') = 'child'`
    )
    .all(userId) as { id: string }[];
  for (const { id } of kids) syncKidFamilyLinks(db, id);
  const pods = db
    .prepare(`SELECT household_id FROM household_members WHERE user_id = ?`)
    .all(userId) as { household_id: string }[];
  for (const { household_id } of pods) syncPodGrandparentBooks(db, household_id);
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

/** Parent-mode lines for a child’s guardians (excludes grandparents / child lines). */
export function guardianParentLinesForChild(db: Database.Database, childLineId: string): Line[] {
  const guardians = listGuardians(db, childLineId);
  const out: Line[] = [];
  const seen = new Set<string>();
  for (const g of guardians) {
    const line = parentLineForUser(db, g.user_id);
    if (!line || seen.has(line.id)) continue;
    if (isProvisionedRelativeLine(db, line.id)) continue;
    if ((line.mode || "parent") === "child") continue;
    seen.add(line.id);
    out.push(line);
  }
  return out;
}

/**
 * Second parent on a Pod — only a true co-parent of the household admin’s kids.
 * Shared Pods (North: Casey + Drew + Jordan) must not treat a brother/sister as Dad/Mom.
 */
export function householdSecondaryParentLine(
  db: Database.Database,
  householdId: string
): Line | null {
  const admin = householdAdminParentLine(db, householdId);

  if (admin) {
    const adminKidLines = db
      .prepare(
        `SELECT l.id FROM child_guardians g
         JOIN lines l ON l.id = g.line_id
         WHERE g.user_id = ? AND IFNULL(l.mode, 'parent') = 'child'`
      )
      .all(admin.owner_user_id) as { id: string }[];

    for (const { id: childId } of adminKidLines) {
      for (const line of guardianParentLinesForChild(db, childId)) {
        if (line.id === admin.id) continue;
        return line;
      }
    }
    // No co-parent on the admin’s kids — do not invent Pod siblings as secondary Dad/Mom.
    return null;
  }

  // Child-only Pod edge case (no parent softphone line yet) — co-parent living elsewhere.
  return guardianCoParentLineForHousehold(db, householdId);
}

export type PublicParentPad = {
  line_id: string;
  owner_user_id: string;
  parent_title: string | null;
  label: string;
  name: string;
  child_label: string | null;
};

export function publicParentPad(db: Database.Database, line: Line | null): PublicParentPad | null {
  if (!line) return null;
  const user = db.prepare(`SELECT parent_title FROM users WHERE id = ?`).get(line.owner_user_id) as
    | { parent_title: string | null }
    | undefined;
  return {
    line_id: line.id,
    owner_user_id: line.owner_user_id,
    parent_title: user?.parent_title ?? null,
    label: parentDisplayLabel(db, line.id),
    name: line.name,
    child_label: line.child_label,
  };
}

/**
 * Kid pad locked slots for a specific child — their guardians only.
 * Shared Pods must not put Uncle Drew on Quinn’s dial 2 as “Dad”.
 */
export function kidPadParentLinesForChild(
  db: Database.Database,
  childLineId: string,
  householdId: string
): { pad1: Line | null; pad2: Line | null } {
  const guardians = guardianParentLinesForChild(db, childLineId);
  if (!guardians.length) {
    return {
      pad1: householdKidPad1ParentLine(db, householdId),
      pad2: householdKidPad2ParentLine(db, householdId),
    };
  }

  const hh = db.prepare(`SELECT pad1_parent_line_id FROM households WHERE id = ?`).get(householdId) as
    | { pad1_parent_line_id: string | null }
    | undefined;
  const override = hh?.pad1_parent_line_id || null;
  const admin = householdAdminParentLine(db, householdId);

  let pad1: Line | null = null;
  if (override && guardians.some((g) => g.id === override)) {
    pad1 = guardians.find((g) => g.id === override) ?? null;
  } else if (admin && guardians.some((g) => g.id === admin.id)) {
    pad1 = admin;
  } else {
    pad1 = guardians[0] ?? null;
  }
  const pad2 = guardians.find((g) => g.id !== pad1?.id) ?? null;
  return { pad1, pad2 };
}

/** Kid pad / analog 1 — household admin unless parents swapped pads. */
export function householdKidPad1ParentLine(
  db: Database.Database,
  householdId: string
): Line | null {
  const admin = householdAdminParentLine(db, householdId);
  const secondary = householdSecondaryParentLine(db, householdId);
  const hh = db.prepare(`SELECT pad1_parent_line_id FROM households WHERE id = ?`).get(householdId) as
    | { pad1_parent_line_id: string | null }
    | undefined;
  const override = hh?.pad1_parent_line_id || null;
  if (override && (override === admin?.id || override === secondary?.id)) {
    const line = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(override) as Line | undefined;
    return line ? normalizeLine(line) : admin;
  }
  return admin;
}

/**
 * Allowlist speed_dial=2 when parents placed someone other than the co-parent.
 * Parent-placed tiles win — North put Alex+Riley on 2; do not synthesize Jordan over them.
 */
export function allowlistSlot2Contact(
  db: Database.Database,
  householdId: string
): AllowlistEntry | null {
  const row = db
    .prepare(`SELECT * FROM allowlist WHERE household_id = ? AND speed_dial = 2`)
    .get(householdId) as AllowlistEntry | undefined;
  return row || null;
}

/** True when dial/pad 2 should stay the locked co-parent (Mom/Dad), not an allowlist contact. */
export function secondaryParentOwnsDial2(
  db: Database.Database,
  householdId: string,
  secondaryLineId?: string | null
): boolean {
  const secondaryId =
    secondaryLineId ?? householdSecondaryParentLine(db, householdId)?.id ?? null;
  if (!secondaryId) return false;
  // A shared Pod can hold several co-parent rows on 2 (Morgan for Sam, Reese for Quinn).
  const slot2Rows = db
    .prepare(`SELECT target_line_id FROM allowlist WHERE household_id = ? AND speed_dial = 2`)
    .all(householdId) as { target_line_id: string }[];
  if (!slot2Rows.length) return true;
  const slot2Targets = slot2Rows.map((r) => {
    const t = db
      .prepare(`SELECT IFNULL(mode, 'parent') AS mode, owner_user_id FROM lines WHERE id = ?`)
      .get(r.target_line_id) as { mode: string; owner_user_id: string } | undefined;
    return { id: r.target_line_id, mode: t?.mode || "parent", owner: t?.owner_user_id || "" };
  });
  // Parent-placed kid on 2 (Alex+Riley) — co-parent must not steal the slot.
  if (slot2Targets.some((t) => t.mode === "child")) return false;
  // Co-parent row itself on 2 beats an adult auto-placed there earlier (Grandma before Mom joined).
  if (slot2Targets.some((t) => t.id === secondaryId)) return true;
  const pad1 = householdKidPad1ParentLine(db, householdId);
  let podKidIds: string[] | null = null;
  for (const { id: targetId, owner } of slot2Targets) {
    if (!targetId) continue;
    // Bogus self-row on 2 (home parent calling themselves) — still synthesize co-parent.
    if (pad1 && targetId === pad1.id) continue;
    podKidIds ??= kidsBelongingToPod(db, householdId).map((k) => k.id);
    if (owner && podKidIds.some((kidId) => isGuardian(db, owner, kidId))) continue;
    return false;
  }
  return true;
}

/** Pod kids whose own guardian owns this parent-mode line (their Mom/Dad, not an aunt/uncle). */
export function podKidsGuardedByLineOwner(
  db: Database.Database,
  householdId: string,
  targetLineId: string
): string[] {
  const target = db
    .prepare(`SELECT IFNULL(mode, 'parent') AS mode, owner_user_id FROM lines WHERE id = ?`)
    .get(targetLineId) as { mode: string; owner_user_id: string } | undefined;
  if (!target || target.mode === "child" || isGrandparentPeerLine(db, targetLineId)) return [];
  return kidsBelongingToPod(db, householdId)
    .filter((kid) => isGuardian(db, target.owner_user_id, kid.id))
    .map((kid) => kid.id);
}

/** Kid pad / analog 2 — the other parent (not whoever sits on 1), unless settings put a contact on 2. */
export function householdKidPad2ParentLine(
  db: Database.Database,
  householdId: string
): Line | null {
  const admin = householdAdminParentLine(db, householdId);
  const secondary = householdSecondaryParentLine(db, householdId);
  const pad1 = householdKidPad1ParentLine(db, householdId);
  if (pad1 && secondary && pad1.id === secondary.id) {
    return secondaryParentOwnsDial2(db, householdId, admin?.id) ? admin : null;
  }
  if (!secondary || secondary.id === pad1?.id) return null;
  if (!secondaryParentOwnsDial2(db, householdId, secondary.id)) return null;
  return secondary;
}

/** Household admin or co-parent may set Mom/Dad for either parent on this kid’s pads. */
export function setHouseholdParentTitle(
  db: Database.Database,
  actorUserId: string,
  householdId: string,
  targetUserId: string,
  parentTitle: ParentTitle | "" | null
): User {
  if (!canManageHouseholdChildState(db, actorUserId, householdId)) {
    throw new Error("Not authorized to change parent labels for this household");
  }
  const admin = householdAdminParentLine(db, householdId);
  const secondary = householdSecondaryParentLine(db, householdId);
  const allowed = new Set(
    [admin?.owner_user_id, secondary?.owner_user_id].filter((id): id is string => Boolean(id))
  );
  if (!allowed.has(targetUserId)) {
    throw new Error("That person is not a parent on this kid’s phone");
  }
  return updateUserProfile(db, targetUserId, { parent_title: parentTitle });
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
 * Distinct Pod FamilyRooms this line may enter (admin-approved).
 * Own household first, then co-parent/guardian Pods, then any other approvals.
 * Labels are Pod names (East, North). One choice → softphone joins directly;
 * two → “Which Family Room?” menu. Same-Pod co-parents do not invent a second slot.
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
  const ordered: string[] = [];
  const seen = new Set<string>();

  const pushIfApproved = (householdId: string) => {
    if (!householdId || seen.has(householdId)) return;
    if (!canJoinAdultFamilyRoom(db, householdId, lineId)) return;
    seen.add(householdId);
    ordered.push(householdId);
  };

  pushIfApproved(ownHhId);

  // Every Pod the child belongs to (guardians’ family-name Pods).
  for (const podId of podsForKid(db, lineId)) {
    pushIfApproved(podId);
  }

  const otherApproved = db
    .prepare(
      `SELECT household_id FROM adult_family_room_members
       WHERE line_id = ?
       ORDER BY created_at ASC`
    )
    .all(lineId) as { household_id: string }[];
  for (const row of otherApproved) pushIfApproved(row.household_id);

  return ordered.slice(0, 2).map((householdId, i) => ({
    slot: (i + 1) as 1 | 2,
    householdId,
    label: householdNameLabel(db, householdId),
  }));
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
  // Slots 0–1 reserved (TreeHouse + locked parent/child). Slot 2 follows parent placement.
  if (next.speed_dial != null && (next.speed_dial < 2 || next.speed_dial > 9 || next.speed_dial === 0 || next.speed_dial === 1)) {
    throw new Error("Speed dial must be 2–9 (0 is TreeHouse; 1 is locked parent/child)");
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

export function lineModeOf(line: { mode?: string | null }): Line["mode"] {
  if (line.mode === "child") return "child";
  if (line.mode === "grandparent") return "grandparent";
  return "parent";
}

/** Kid lines use household bedtime/school times; timezone inherits from the parent who owns them. */
export function quietPolicyForLine(
  line: { mode?: string | null; id?: string; owner_user_id?: string } & Partial<Line>,
  hh: Household,
  db?: Database.Database
): QuietPolicy {
  if (lineModeOf(line) === "child") {
    const quiet_tz =
      db && line.id && line.owner_user_id
        ? kidInheritedQuietTz(db, line as Line, hh)
        : hh.quiet_tz;
    return {
      quiet_start: hh.quiet_start,
      quiet_end: hh.quiet_end,
      quiet_tz,
      quiet_days: hh.quiet_days,
      skip_holidays: hh.skip_holidays,
      schedule_preset: hh.schedule_preset,
    };
  }
  const fromLine = lineHasAdultQuiet(line);
  return {
    quiet_start: fromLine ? line.parent_quiet_start ?? null : hh.parent_quiet_start,
    quiet_end: fromLine ? line.parent_quiet_end ?? null : hh.parent_quiet_end,
    quiet_tz: (fromLine ? line.parent_quiet_tz : null) || hh.parent_quiet_tz || hh.quiet_tz,
    quiet_days: fromLine ? line.parent_quiet_days ?? null : hh.parent_quiet_days,
    skip_holidays: 0,
    schedule_preset:
      (fromLine ? line.parent_schedule_preset : null) ||
      hh.parent_schedule_preset ||
      DEFAULT_PARENT_SCHEDULE_PRESET,
  };
}

/** IANA TZ from any adult phone owned by this user. */
export function adultQuietTzForUser(db: Database.Database, userId: string): string | null {
  const row = db
    .prepare(
      `SELECT parent_quiet_tz FROM lines
       WHERE owner_user_id = ? AND IFNULL(mode, 'parent') != 'child'
         AND parent_quiet_tz IS NOT NULL AND trim(parent_quiet_tz) != ''
       ORDER BY created_at LIMIT 1`
    )
    .get(userId) as { parent_quiet_tz: string } | undefined;
  if (!row?.parent_quiet_tz || !isValidTimeZone(row.parent_quiet_tz)) return null;
  return row.parent_quiet_tz;
}

/**
 * Kid Quiet Time clock: owner parent’s TZ, else a guardian’s, else Pod owner, else household.
 */
export function kidInheritedQuietTz(db: Database.Database, kid: Line, hh: Household): string {
  const fromOwner = adultQuietTzForUser(db, kid.owner_user_id);
  if (fromOwner) return fromOwner;
  const guardians = db
    .prepare(`SELECT user_id FROM child_guardians WHERE line_id = ? ORDER BY created_at`)
    .all(kid.id) as { user_id: string }[];
  for (const g of guardians) {
    const tz = adultQuietTzForUser(db, g.user_id);
    if (tz) return tz;
  }
  const fromPodOwner = adultQuietTzForUser(db, hh.owner_user_id);
  if (fromPodOwner) return fromPodOwner;
  if (hh.quiet_tz && isValidTimeZone(hh.quiet_tz)) return hh.quiet_tz;
  return DEFAULT_QUIET_TZ;
}

/** True when this adult line has its own DND fields (not relying solely on Pod defaults). */
export function lineHasAdultQuiet(line: Partial<Line> | null | undefined): boolean {
  if (!line) return false;
  return (
    line.parent_quiet_tz != null ||
    line.parent_quiet_start != null ||
    line.parent_quiet_end != null ||
    line.parent_schedule_preset != null
  );
}

/** Overlay a viewer's adult-line DND (+ kid TZ inheritance) onto household fields for API/UI. */
export function householdWithAdultQuiet(
  hh: Household,
  adultLine: Partial<Line> | null | undefined
): Household {
  if (!adultLine || !lineHasAdultQuiet(adultLine)) return hh;
  const adultTz =
    adultLine.parent_quiet_tz && isValidTimeZone(adultLine.parent_quiet_tz)
      ? adultLine.parent_quiet_tz
      : null;
  return {
    ...hh,
    // Kids on this parent’s phone follow their timezone.
    quiet_tz: adultTz || hh.quiet_tz,
    parent_quiet_start:
      adultLine.parent_quiet_start !== undefined
        ? adultLine.parent_quiet_start
        : hh.parent_quiet_start,
    parent_quiet_end:
      adultLine.parent_quiet_end !== undefined ? adultLine.parent_quiet_end : hh.parent_quiet_end,
    parent_quiet_tz: adultTz || hh.parent_quiet_tz,
    parent_quiet_days:
      adultLine.parent_quiet_days !== undefined
        ? adultLine.parent_quiet_days
        : hh.parent_quiet_days,
    parent_schedule_preset:
      adultLine.parent_schedule_preset || hh.parent_schedule_preset || DEFAULT_PARENT_SCHEDULE_PRESET,
  };
}

/**
 * Pick which adult phone's DND to edit / show for a Pod.
 * Prefer explicit line id, then the actor's adult line, then the sole adult line.
 */
export function resolveAdultQuietLine(
  db: Database.Database,
  householdId: string,
  opts?: { adultLineId?: string | null; actorUserId?: string | null }
): Line | null {
  const adults = (
    db
      .prepare(
        `SELECT * FROM lines WHERE household_id = ? AND IFNULL(mode, 'parent') != 'child' ORDER BY created_at`
      )
      .all(householdId) as Line[]
  ).map(normalizeLine);
  if (!adults.length) return null;
  const wantId = opts?.adultLineId ? String(opts.adultLineId) : "";
  if (wantId) {
    const hit = adults.find((l) => l.id === wantId);
    if (hit) return hit;
  }
  const actor = opts?.actorUserId ? String(opts.actorUserId) : "";
  if (actor) {
    const mine = adults.find((l) => l.owner_user_id === actor);
    if (mine) return mine;
  }
  if (adults.length === 1) return adults[0]!;
  return null;
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
    pad1_parent_line_id?: string | null;
    /** Adult phone whose DND/timezone is being edited (required when Pod has multiple adults). */
    adult_line_id?: string | null;
  },
  opts?: { actorUserId?: string | null }
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
  let schedule_preset =
    patch.schedule_preset === undefined
      ? hh.schedule_preset || DEFAULT_KID_SCHEDULE_PRESET
      : patch.schedule_preset;
  let daily_cap_minutes =
    patch.daily_cap_minutes === undefined ? hh.daily_cap_minutes ?? null : patch.daily_cap_minutes;
  let parent_pin_hash = hh.parent_pin_hash;
  let dnd = patch.dnd === undefined ? hh.dnd || 0 : patch.dnd ? 1 : 0;
  // Household parent_quiet_* stays as factory defaults / legacy fallback — never overwrite
  // from one adult's edit (that made Dad's Denver TZ change Cameron's phone too).
  let parent_quiet_start = hh.parent_quiet_start;
  let parent_quiet_end = hh.parent_quiet_end;
  let parent_quiet_tz = hh.parent_quiet_tz;
  let parent_quiet_days = hh.parent_quiet_days ?? null;
  let parent_schedule_preset = hh.parent_schedule_preset || DEFAULT_PARENT_SCHEDULE_PRESET;
  let layout_locked =
    patch.layout_locked === undefined ? hh.layout_locked ?? 1 : patch.layout_locked ? 1 : 0;
  let ring_volume = patch.ring_volume === undefined ? hh.ring_volume ?? 70 : Number(patch.ring_volume);
  let ringer_style =
    patch.ringer_style === undefined ? hh.ringer_style || "classic" : String(patch.ringer_style);
  let pad1_parent_line_id =
    patch.pad1_parent_line_id === undefined ? hh.pad1_parent_line_id ?? null : patch.pad1_parent_line_id;

  const adultQuietPatched =
    patch.parent_quiet_start !== undefined ||
    patch.parent_quiet_end !== undefined ||
    patch.parent_quiet_tz !== undefined ||
    patch.parent_quiet_days !== undefined ||
    patch.parent_schedule_preset !== undefined;

  let adultLine = adultQuietPatched
    ? resolveAdultQuietLine(db, householdId, {
        adultLineId: patch.adult_line_id,
        actorUserId: opts?.actorUserId,
      })
    : null;

  // Working copy for the adult phone being edited (or sole adult / actor).
  let line_parent_quiet_start = adultLine?.parent_quiet_start ?? hh.parent_quiet_start;
  let line_parent_quiet_end = adultLine?.parent_quiet_end ?? hh.parent_quiet_end;
  let line_parent_quiet_tz = adultLine?.parent_quiet_tz ?? hh.parent_quiet_tz;
  let line_parent_quiet_days = adultLine?.parent_quiet_days ?? hh.parent_quiet_days ?? null;
  let line_parent_schedule_preset =
    adultLine?.parent_schedule_preset || hh.parent_schedule_preset || DEFAULT_PARENT_SCHEDULE_PRESET;

  if (patch.parent_quiet_start !== undefined) line_parent_quiet_start = patch.parent_quiet_start;
  if (patch.parent_quiet_end !== undefined) line_parent_quiet_end = patch.parent_quiet_end;
  if (patch.parent_quiet_tz !== undefined) line_parent_quiet_tz = patch.parent_quiet_tz;
  if (patch.parent_quiet_days !== undefined) {
    line_parent_quiet_days = normalizeQuietDays(patch.parent_quiet_days);
  }
  if (patch.parent_schedule_preset !== undefined) {
    line_parent_schedule_preset = patch.parent_schedule_preset;
  }

  if (patch.schedule_preset && patch.schedule_preset !== "custom") {
    const preset = SCHEDULE_PRESETS[patch.schedule_preset];
    if (!preset) throw new Error("Unknown schedule preset");
    if (patch.schedule_preset !== "open") {
      quiet_start = preset.quiet_start;
      quiet_end = preset.quiet_end;
      if (!quiet_tz) quiet_tz = DEFAULT_QUIET_TZ;
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
      line_parent_quiet_start = preset.quiet_start;
      line_parent_quiet_end = preset.quiet_end;
      if (!line_parent_quiet_tz) line_parent_quiet_tz = quiet_tz || DEFAULT_QUIET_TZ;
      if (preset.quiet_days !== undefined && patch.parent_quiet_days === undefined) {
        line_parent_quiet_days = preset.quiet_days ?? null;
      }
    } else {
      line_parent_quiet_start = null;
      line_parent_quiet_end = null;
      line_parent_quiet_days = null;
    }
    line_parent_schedule_preset = patch.parent_schedule_preset;
  }

  if (line_parent_quiet_start === "") line_parent_quiet_start = null;
  if (line_parent_quiet_end === "") line_parent_quiet_end = null;
  if (line_parent_quiet_tz === "") line_parent_quiet_tz = null;

  if (line_parent_quiet_start && line_parent_quiet_end) {
    parseHhMm(line_parent_quiet_start);
    parseHhMm(line_parent_quiet_end);
    if (!line_parent_quiet_tz || !isValidTimeZone(line_parent_quiet_tz)) {
      throw new Error("Do Not Disturb needs a valid timezone (e.g. America/Chicago)");
    }
    if (!patch.parent_schedule_preset) line_parent_schedule_preset = "custom";
  } else if (line_parent_quiet_start || line_parent_quiet_end) {
    throw new Error("Set both Do Not Disturb start and end, or clear both");
  } else if (patch.parent_quiet_start !== undefined || patch.parent_quiet_end !== undefined) {
    line_parent_quiet_start = null;
    line_parent_quiet_end = null;
    if (!patch.parent_schedule_preset) line_parent_schedule_preset = "open";
  }

  if (line_parent_quiet_tz && !isValidTimeZone(line_parent_quiet_tz)) {
    throw new Error("Invalid timezone");
  }

  if (adultQuietPatched) {
    if (!adultLine) {
      // No adult line yet (brand-new Pod) — keep writing Pod defaults so addLine can seed.
      parent_quiet_start = line_parent_quiet_start;
      parent_quiet_end = line_parent_quiet_end;
      parent_quiet_tz = line_parent_quiet_tz;
      parent_quiet_days = line_parent_quiet_days;
      parent_schedule_preset = line_parent_schedule_preset;
    } else {
      db.prepare(
        `UPDATE lines SET
           parent_quiet_start = ?, parent_quiet_end = ?, parent_quiet_tz = ?,
           parent_quiet_days = ?, parent_schedule_preset = ?
         WHERE id = ?`
      ).run(
        line_parent_quiet_start,
        line_parent_quiet_end,
        line_parent_quiet_tz,
        line_parent_quiet_days,
        line_parent_schedule_preset,
        adultLine.id
      );
      adultLine = {
        ...adultLine,
        parent_quiet_start: line_parent_quiet_start,
        parent_quiet_end: line_parent_quiet_end,
        parent_quiet_tz: line_parent_quiet_tz,
        parent_quiet_days: line_parent_quiet_days,
        parent_schedule_preset: line_parent_schedule_preset,
      };
    }
    // Kids on this Pod inherit the adult’s timezone for bedtime / school.
    if (line_parent_quiet_tz && isValidTimeZone(line_parent_quiet_tz)) {
      quiet_tz = line_parent_quiet_tz;
    }
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

  if (patch.pad1_parent_line_id !== undefined) {
    if (pad1_parent_line_id === "" || pad1_parent_line_id === null) {
      pad1_parent_line_id = null;
    } else {
      const admin = householdAdminParentLine(db, householdId);
      const secondary = householdSecondaryParentLine(db, householdId);
      if (pad1_parent_line_id !== admin?.id && pad1_parent_line_id !== secondary?.id) {
        throw new Error("Button 1 must be one of the two parents");
      }
    }
  }

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
    schedule_preset: schedule_preset || DEFAULT_KID_SCHEDULE_PRESET,
    dnd,
    parent_quiet_start,
    parent_quiet_end,
    parent_quiet_tz,
    parent_quiet_days,
    parent_schedule_preset: parent_schedule_preset || DEFAULT_PARENT_SCHEDULE_PRESET,
    layout_locked,
    ring_volume,
    ringer_style,
    pad1_parent_line_id,
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
     ring_volume = @ring_volume, ringer_style = @ringer_style,
     pad1_parent_line_id = @pad1_parent_line_id WHERE id = @id`
  ).run(next);
  // Return the edited adult's DND overlaid so PATCH responses match the UI for that phone.
  return householdWithAdultQuiet(next, adultLine);
}

export function inQuietHours(hh: QuietPolicy, date = new Date()): boolean {
  return isQuietHoursActive(hh, date);
}

/**
 * Pad presence: softphone tab OR a registered ATA outside Quiet Time / quiet hours.
 * (FXS handset plug state isn't visible over SIP — registration is the signal.)
 *
 * iOS CallKit (VoIP push token): same schedule rules as analog — a foreground WS tab
 * does not override quiet hours. Outside quiet, a registered VoIP token counts as
 * reachable even when the app is backgrounded.
 */
export function linePresenceOnline(opts: {
  softphoneOnline: boolean;
  ataRegistered: boolean;
  /** PushKit VoIP token on file — lock-screen Answer enabled on a native iPhone. */
  iosLockscreenReady?: boolean;
  household: Household | (QuietPolicy & { dnd: number } & Partial<Household>);
  /** Adult line — required for per-adult DND timezone. */
  line?: { mode?: string | null } & Partial<Line>;
  lineMode?: "parent" | "child";
  db?: Database.Database;
  now?: Date;
}): boolean {
  const hh = opts.household as Household;
  const mode =
    opts.lineMode ||
    (opts.line ? (lineModeOf(opts.line) === "child" ? "child" : "parent") : undefined);
  const policy =
    mode === "parent"
      ? quietPolicyForLine(opts.line || { mode: "parent" }, hh, opts.db)
      : mode === "child"
        ? quietPolicyForLine(opts.line || { mode: "child" }, hh, opts.db)
        : hh;
  const inQuiet = Boolean(hh.dnd) || isQuietHoursActive(policy, opts.now);

  if (opts.iosLockscreenReady) {
    return !inQuiet;
  }

  if (opts.softphoneOnline) return true;
  if (!opts.ataRegistered) return false;
  if (inQuiet) return false;
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

/**
 * Shared-Pod calls skip the allowlist for adults, kid↔kid (siblings/cousins), and a kid
 * with their own guardians or grandparents. Other Pod adults fall through to the
 * allowlist + kid Circle checks, which keep aunts/uncles off kid pads.
 */
/**
 * A co-parent row on a shared Pod book (Morgan on North for Sam) speaks for that
 * kid’s guardians only — not every adult in the Pod (Casey, Jordan).
 */
function coParentRowNotForLine(db: Database.Database, bookSide: Line, other: Line): boolean {
  if (lineModeOf(bookSide) === "child" || other.household_id === bookSide.household_id) return false;
  const kids = podKidsGuardedByLineOwner(db, bookSide.household_id, other.id);
  if (!kids.length) return false;
  return !kids.some((kidId) => isGuardian(db, bookSide.owner_user_id, kidId));
}

function sharedPodPairMayCall(db: Database.Database, a: Line, b: Line): boolean {
  const aKid = lineModeOf(a) === "child";
  const bKid = lineModeOf(b) === "child";
  if (!aKid && !bKid) return true;
  if (aKid && bKid) return true;
  const kid = aKid ? a : b;
  const adult = aKid ? b : a;
  if (isGrandparentPeerLine(db, adult.id)) return true;
  if (adult.owner_user_id === kid.owner_user_id) return true;
  if (isGuardian(db, adult.owner_user_id, kid.id)) return true;
  // Aunt/uncle only when this kid’s parent added them to this kid’s pad.
  return kidHasApprovedAuntUncle(db, kid.id, adult.id);
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

  const billingBlock = circleBillingCallBlock(db, fromLineId, toLineId, now);
  if (!billingBlock.ok) {
    return block(
      billingBlock.reason || "This line isn’t available right now",
      billingBlock.voice || "paused",
      billingBlock.side || "both"
    );
  }

  const pre = contactGatePre(db, from, to);
  if (!pre.ok) return pre;

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

  // Instant Quiet Time — VIP always_allow can still ring through.
  // Kid → provisioned grandparent also rings through (grandchild is the product).
  const kidToProvisionedGp =
    lineModeOf(from) === "child" && isProvisionedRelativeLine(db, toLineId);
  if (fromHh.dnd && !fromVip) return block("Quiet Time is on", "quiet", "caller");
  if (toHh.dnd && !toVip && !kidToProvisionedGp) {
    return block("They’re in Quiet Time", "quiet", "callee");
  }

  const fromPolicy = quietPolicyForLine(from, fromHh, db);
  const toPolicy = quietPolicyForLine(to, toHh, db);
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
  if (inQuietHours(toPolicy, now) && !toVip && !kidToProvisionedGp) {
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

  return contactGateTail(db, from, to);
}

/** Review-account and grandparent rules — who may ever reach whom (no clocks). */
function contactGatePre(db: Database.Database, from: Line, to: Line): CanCallResult {
  // Review softphone: only Cameron ↔ test, never anyone else (even if allowlist drifts).
  const testUserId = testReviewUserIdForLine(db, from) || testReviewUserIdForLine(db, to);
  if (testUserId) {
    const allowed = testReviewAllowedLineIds(db, testUserId);
    if (!allowed.has(from.id) || !allowed.has(to.id)) {
      return block("Not on your approved contacts", "allowlist", "caller");
    }
  }

  // Grandparent ↔ grandparent: never, even with a shared grandchild / polluted allowlist.
  if (
    isGrandparentPeerLine(db, from.id) &&
    isGrandparentPeerLine(db, to.id) &&
    from.owner_user_id !== to.owner_user_id
  ) {
    return block("Not on your approved contacts", "allowlist", "caller");
  }

  // Grandparent softphones / ATA: grandchildren, their Pod’s parents, manually added adults.
  if (
    isGrandparentPeerLine(db, from.id) &&
    from.owner_user_id !== to.owner_user_id &&
    !grandparentMaySeeLine(db, from.owner_user_id, to)
  ) {
    return block("Not on your approved contacts", "allowlist", "caller");
  }
  return { ok: true };
}

/** Family / allowlist / Circle rules — who may ever reach whom (no clocks). */
function contactGateTail(db: Database.Database, from: Line, to: Line): CanCallResult {
  // Review account ↔ Cameron’s phone: the pre-gate already limited it to exactly that pair.
  if (testReviewUserIdForLine(db, from) || testReviewUserIdForLine(db, to)) return { ok: true };
  const fromIsKid = lineModeOf(from) === "child";
  const toIsKid = lineModeOf(to) === "child";
  const allowedOut = db
    .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
    .get(from.household_id, to.id);
  const allowedIn = db
    .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
    .get(to.household_id, from.id);

  // Same household / shared family-name Pod (multi-Pod kids) can always call —
  // except a kid and a Pod adult who isn’t their parent (aunts/uncles).
  const sharesPod = from.household_id === to.household_id || linesShareFamilyPod(db, from.id, to.id);
  if (sharesPod && sharedPodPairMayCall(db, from, to)) return { ok: true };
  // Two adults who approved each other on their own dialpads (Cameron ↔ Casey).
  if (lineModeOf(from) === "parent" && lineModeOf(to) === "parent" && parentContactsMutual(db, from, to)) {
    return { ok: true };
  }

  if (!allowedOut) return block("Not on your approved contacts", "allowlist", "caller");
  if (!allowedIn) return block("You’re not on their approved contacts", "allowlist", "callee");
  if (coParentRowNotForLine(db, from, to)) {
    return block("Not on your approved contacts", "allowlist", "caller");
  }
  if (coParentRowNotForLine(db, to, from)) {
    return block("You’re not on their approved contacts", "allowlist", "callee");
  }

  // Kid softphones: Circle = kids + grandparents + *their* parents only.
  // Parent dialpad adults (even ones with kids) stay parent-only.
  if (fromIsKid && !allowlistTargetVisibleOnKidCircle(db, to.id, from.id)) {
    return block("Not on your approved contacts", "allowlist", "caller");
  }
  if (toIsKid && !allowlistTargetVisibleOnKidCircle(db, from.id, to.id)) {
    return block("You’re not on their approved contacts", "allowlist", "callee");
  }

  // Provisioned grandparents are an explicit relationship, not an accidental
  // cross-Pod Circle overlap. Mutual allowlist + the strict GP visibility gate
  // above remain required; peer grandparents were already denied in pre-gate.
  if (
    (isGrandparentPeerLine(db, from.id) &&
      grandparentMaySeeLine(db, from.owner_user_id, to)) ||
    (isGrandparentPeerLine(db, to.id) &&
      grandparentMaySeeLine(db, to.owner_user_id, from))
  ) {
    return { ok: true };
  }

  if (!linesShareSphere(db, from.id, to.id)) {
    return block("Not in the same circle", "sphere", "caller");
  }
  return { ok: true };
}

/** For each pad on this Pod view (viewer’s phones + kids), the listed lines it may call. */
function householdReachMap(
  db: Database.Database,
  viewerUserId: string,
  lines: { id: string; mode?: string | null; owner_user_id?: string }[],
  allowlist: { target_line_id: string }[]
): Record<string, string[]> {
  const targets = [...new Set([...lines.map((l) => l.id), ...allowlist.map((a) => a.target_line_id)])];
  const pads = lines.filter((l) => l.owner_user_id === viewerUserId || l.mode === "child");
  const out: Record<string, string[]> = {};
  for (const pad of pads) {
    out[pad.id] = targets.filter((t) => t !== pad.id && linesMayConnect(db, pad.id, t));
  }
  return out;
}

/**
 * Whether two lines are contacts at all — the same rules as canCall minus clocks,
 * Timeout, caps and billing. Pads show exactly these (a tile never dials a dead end).
 */
export function linesMayConnect(db: Database.Database, fromLineId: string, toLineId: string): boolean {
  if (!fromLineId || !toLineId || fromLineId === toLineId) return false;
  const from = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(fromLineId) as Line | undefined;
  const to = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(toLineId) as Line | undefined;
  if (!from || !to) return false;
  return contactGatePre(db, from, to).ok && contactGateTail(db, from, to).ok;
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
  const existing = db.prepare(`SELECT outcome, ended_at FROM call_logs WHERE id = ?`).get(callId) as
    | { outcome: string; ended_at: string | null }
    | undefined;
  if (!existing) return;
  // Terminal signaling may arrive more than once (bridge cleanup, socket close,
  // native CallKit fallback). The first terminal result is authoritative.
  if (existing.outcome !== "ringing" && existing.outcome !== "answered") {
    if (!existing.ended_at) {
      db.prepare(`UPDATE call_logs SET ended_at = ? WHERE id = ?`).run(nowIso(), callId);
    }
    return;
  }
  let final = outcome;
  if (outcome === "ended") {
    if (existing.outcome === "answered") final = "completed";
    else if (existing.outcome === "ringing") final = "cancelled";
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
      peerLabelForCall(db, fromLineId, toLineId) ||
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
  if (from.household_id !== to.household_id) {
    const approved = db
      .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
      .get(from.household_id, toLineId);
    if (!approved || !linesShareSphere(db, fromLineId, toLineId)) {
      throw new Error("Contact not approved");
    }
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
    if (!approved || !linesShareSphere(db, fromLineId, toLineId)) {
      throw new Error("Contact not approved");
    }
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
  scrubPodCoParentKidSphereAccess(db);
  // Re-bridge friend Circles (Ken/Owen ↔ Casey/Quinn) before peer scrub.
  repairFriendInviteSphereMembers(db, userId);
  scrubPodPeerParentCircleIsolation(db, userId);
  scrubGrandparentPeerIsolation(db, userId);
  // Do NOT syncProvisionedRelativePodBook here — it deletes “extras” from the GP
  // house allowlist, which on merged family Pods (East/North) wiped the kids’
  // cross-Pod grandparent rows on every Grandma login. Resync on provision only.

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
    const housed = db.prepare(`SELECT * FROM lines WHERE household_id = ?`).all(hh.id) as Line[];
    const lineById = new Map(housed.map((l) => [l.id, l]));
    // Multi-Pod kids: show on every Pod they belong to (via guardians’ family names).
    if (isMember) {
      for (const kid of kidsBelongingToPod(db, hh.id)) {
        if (!lineById.has(kid.id)) lineById.set(kid.id, kid);
      }
    }
    const lines = [...lineById.values()];
    // Do not mutate allowlists here — /api/me must stay read-only. Cross-Pod GP
    // sync runs from ATA dial + repair-family-allowlists / provision paths only.
    const ourLineIds = lines.map((l) => l.id);
    const allowlist = db
      .prepare(`SELECT * FROM allowlist WHERE household_id = ? ORDER BY speed_dial IS NULL, speed_dial, label`)
      .all(hh.id) as AllowlistEntry[];
    // Keep same-household contacts (parent ↔ child speed dial). Softphones filter
    // target_line_id === activeLineId client-side; canCall rejects self.
    const enrichedAllowlist = allowlist.map((a) => {
      const target = db
        .prepare(
          `SELECT household_id, IFNULL(mode, 'parent') AS mode, owner_user_id FROM lines WHERE id = ?`
        )
        .get(a.target_line_id) as
        | { household_id: string; mode: string; owner_user_id: string }
        | undefined;
      const mutual = Boolean(
        target &&
          ourLineIds.some((lid) =>
            db
              .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
              .get(target.household_id, lid)
          )
      );
      const owner = target
        ? (db
            .prepare(`SELECT parent_title FROM users WHERE id = ?`)
            .get(target.owner_user_id) as { parent_title: string | null } | undefined)
        : undefined;
      return {
        ...a,
        always_allow: a.always_allow || 0,
        mutual,
        target_mode: target?.mode || null,
        // Only parent-mode contacts carry Mom/Dad titles — never stamp a kid line
        // with their owner’s title (Sam ≠ Uncle just because Drew is Dad).
        target_parent_title:
          target && target.mode !== "child" ? (owner?.parent_title ?? null) : null,
        sphere_ids: sphereIdsContainingLine(db, a.target_line_id),
        is_test_review: isTestReviewLineId(db, a.target_line_id),
        /** Parent dialpad may hold adults kids must not inherit (other parents, friends). */
        kid_circle: allowlistTargetVisibleOnHouseholdKidCircles(db, hh.id, a.target_line_id),
        /** Parent-mode contacts: only these kids’ pads (Reese is Quinn’s Mom, not Sam’s). */
        kid_circle_kid_ids:
          target && target.mode !== "child" && !isGrandparentPeerLine(db, a.target_line_id)
            ? podKidsGuardedByLineOwner(db, hh.id, a.target_line_id)
            : null,
      };
    });
    const logs = db
      .prepare(
        `SELECT cl.* FROM call_logs cl
         WHERE cl.from_line_id IN (SELECT id FROM lines WHERE household_id = ?)
            OR cl.to_line_id IN (SELECT id FROM lines WHERE household_id = ?)
         ORDER BY cl.started_at DESC LIMIT 80`
      )
      .all(hh.id, hh.id) as CallLog[];
    const voicemails = db
      .prepare(
        `SELECT * FROM voicemails WHERE household_id = ? ORDER BY created_at ASC LIMIT 40`
      )
      .all(hh.id);
    const used = minutesUsedToday(db, hh.id);
    const adultForViewer = resolveAdultQuietLine(db, hh.id, { actorUserId: userId });
    const pub = publicHousehold(householdWithAdultQuiet(hh, adultForViewer));
    const parentSpheres = isMember ? listHouseholdParentSpheres(db, hh.id) : [];
    const enrichedLines = lines.map((l) => {
      const norm = normalizeLine(l);
      const guardians =
        norm.mode === "child" || isGuardian(db, userId, norm.id) ? listGuardians(db, norm.id) : [];
      const { greeting_path: _gp, greeting_confirmed_at: _gc, avatar_path: _ap, ...safeLine } = norm;
      const ata = getAtaByLineId(db, norm.id);
      const homePod = (norm.mode || "parent") === "child" && norm.household_id !== hh.id;
      const gpLabels = lookupGrandparentPadLabels(db, norm.id);
      return {
        ...safeLine,
        ...publicLineGreeting(norm),
        ...publicLineAvatar(norm),
        guardians,
        child_user: publicChildUserForLine(db, norm),
        can_manage: canManageChild(db, userId, norm.id),
        /** Softphone / WS claim — false for peer parents’ lines in the same Pod. */
        can_operate: userCanOperateLine(db, userId, norm.id),
        ata: ata ? publicAta(ata, db) : null,
        /** Kid’s line lives on another Pod but belongs here via a guardian on this Pod. */
        multi_pod: homePod,
        pods: (norm.mode || "parent") === "child" ? podsForKid(db, norm.id) : undefined,
        sphere_access:
          (norm.mode || "parent") === "child" ? listLineSphereAccessIds(db, norm.id) : [],
        usage_today_minutes:
          (norm.mode || "parent") === "child"
            ? minutesUsedToday(db, norm.household_id, new Date(), { lineId: norm.id })
            : undefined,
        ...(gpLabels
          ? {
              is_grandparent: true as const,
              kid_label: gpLabels.kid,
              adult_label: gpLabels.adult,
              kid_nickname: gpLabels.nickname,
            }
          : {}),
        /** Other kids on every Pod this child belongs to — kid pad / Circle only. */
        pod_family_kids:
          (norm.mode || "parent") === "child" ? listKidPodFamilyPeers(db, norm.id) : undefined,
        /** Aunts/uncles on this kid’s pad (parent-added) + the options their parents can pick. */
        aunt_uncle_options:
          (norm.mode || "parent") === "child" ? listKidAuntUncleOptions(db, norm.id) : undefined,
      };
    });
    const mySphere = isMember ? ensureSphereForParent(db, userId) : getSphereByOwner(db, userId);
    // TEMP fail-open: incomplete sphere membership must not empty pads / hide contacts
    // while calling is restored. Re-enable kid/parent circle filters after migration.
    const childOnly = isChildOnlyAccount(db, userId);
    const viewerIsGp = isGrandparentPeerAccount(db, userId);
    const gpDialKids = viewerIsGp
      ? new Set(listGrandparentDialKids(db, userId).map((k) => k.id))
      : null;
    const gpPodParents = viewerIsGp
      ? new Set(listGrandparentPodParentLines(db, userId).map((l) => l.id))
      : null;
    const gpDial = isMember
      ? peekGrandparentDialCollapse(db, hh.id)
      : { mode: "none" as const, slot: null, anchorEntryId: null, anchorLineId: null };
    const visibleAllowlist = enrichedAllowlist
      .filter((a) => canViewerAccessTestReviewLine(db, userId, a.target_line_id))
      // Drop polluted same-household rows (GP living on this Pod listed on its own allowlist).
      // Same-house kids with a pinned speed_dial stay — client prefers that row over hh-line tiles.
      .filter((a) => {
        const target = db
          .prepare(`SELECT household_id FROM lines WHERE id = ?`)
          .get(a.target_line_id) as { household_id: string } | undefined;
        if (!target) return true;
        if (target.household_id !== hh.id) return true;
        if (lookupGrandparentPadLabels(db, a.target_line_id)) return false;
        const mode = db
          .prepare(`SELECT IFNULL(mode, 'parent') AS mode FROM lines WHERE id = ?`)
          .get(a.target_line_id) as { mode: string } | undefined;
        if (mode?.mode === "child") {
          return a.speed_dial != null;
        }
        return true;
      })
      // GP viewers must not see other grandparents on a shared Pod book.
      .filter((a) => {
        if (!viewerIsGp) return true;
        if (!isGrandparentPeerLine(db, a.target_line_id)) return true;
        const target = db
          .prepare(`SELECT owner_user_id FROM lines WHERE id = ?`)
          .get(a.target_line_id) as { owner_user_id: string } | undefined;
        return Boolean(target && target.owner_user_id === userId);
      })
      // GP dial book = auto grandchildren + gp_manual adults. Co-parent pad-2 rows
      // (Jordan on East) stay on the shared allowlist for parents/kids, not Grams.
      .filter((a) => {
        if (!viewerIsGp) {
          // Parent pads never show Grandma-only manual adults.
          return !a.gp_manual;
        }
        const mode = db
          .prepare(`SELECT IFNULL(mode, 'parent') AS mode FROM lines WHERE id = ?`)
          .get(a.target_line_id) as { mode: string } | undefined;
        if (mode?.mode === "child") {
          // Only real dial grandchildren — never cousin kids leaked onto the Pod book.
          return Boolean(gpDialKids?.has(a.target_line_id));
        }
        return Boolean(a.gp_manual) || Boolean(gpPodParents?.has(a.target_line_id));
      })
      // Another kid’s co-parent (Morgan / Cameron on North) is only on that kid’s parents’ pads.
      .filter((a) => {
        if (viewerIsGp || childOnly) return true;
        const kids = a.kid_circle_kid_ids;
        if (!Array.isArray(kids) || !kids.length) return true;
        const target = db
          .prepare(`SELECT household_id FROM lines WHERE id = ?`)
          .get(a.target_line_id) as { household_id: string } | undefined;
        if (!target || target.household_id === hh.id) return true;
        if (kids.some((kidId) => isGuardian(db, userId, kidId))) return true;
        // Still yours if you two approved each other (Casey ↔ Cameron on their own pads).
        return Boolean(
          db
            .prepare(`SELECT 1 FROM parent_contacts WHERE owner_user_id = ? AND target_line_id = ?`)
            .get(userId, a.target_line_id)
        );
      })
      .map((a) => {
        const gp = lookupGrandparentPadLabels(db, a.target_line_id);
        if (!gp) return a;
        const isAnchor = gpDial.anchorEntryId === a.id;
        const menuMode = gpDial.mode === "menu" && isAnchor;
        const fromPod = db
          .prepare(
            `SELECT from_household_id FROM provisioned_relatives WHERE relative_line_id = ?`
          )
          .get(a.target_line_id) as { from_household_id: string } | undefined;
        return {
          ...a,
          is_grandparent: true,
          label: childOnly ? gp.kid : gp.adult,
          kid_label: gp.kid,
          adult_label: gp.adult,
          kid_nickname: gp.nickname,
          grandparents_menu: menuMode,
          gp_from_household_id: fromPod?.from_household_id || null,
        };
      });

    // Merged GPs share the family Pod membership: own line, dial grandchildren, and
    // that Pod’s parents — never co-parents from another Pod or peer grandparents.
    const visibleLines = viewerIsGp
      ? enrichedLines.filter(
          (l) =>
            l.owner_user_id === userId ||
            (l.mode === "child" && gpDialKids?.has(l.id)) ||
            Boolean(gpPodParents?.has(l.id))
        )
      : enrichedLines;

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
      lines: visibleLines,
      allowlist: visibleAllowlist,
      /** Pad truth: for the viewer’s phones and this Pod’s kids, who each may call. */
      reach: householdReachMap(db, userId, visibleLines, visibleAllowlist),
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
        // Other parents’ Circles: names/ids only. Member lists stay private so
        // Morgan’s cousins never leak into Drew’s pending UI unless bridged
        // into *his* Circle (and never into Alex/Quinn).
        member_line_ids:
          s.owner_user_id === userId
            ? listSphereMemberLineIds(db, s.id).filter((lineId) =>
                canViewerAccessTestReviewLine(db, userId, lineId)
              )
            : [],
      })),
      my_sphere_id: mySphere?.id ?? null,
      // Mom/Dad pad slots are for parents + kids. Merged GPs live on the family Pod
      // but must never inherit the co-parent (Jordan on East) as dial 2.
      admin_parent: isGrandparentPeerAccount(db, userId)
        ? null
        : publicParentPad(db, householdAdminParentLine(db, hh.id)),
      secondary_parent: isGrandparentPeerAccount(db, userId)
        ? null
        : publicParentPad(db, householdSecondaryParentLine(db, hh.id)),
      pad1_parent: isGrandparentPeerAccount(db, userId)
        ? null
        : publicParentPad(db, householdKidPad1ParentLine(db, hh.id)),
      pad2_parent: isGrandparentPeerAccount(db, userId)
        ? null
        : publicParentPad(db, householdKidPad2ParentLine(db, hh.id)),
      call_logs: logs,
      voicemails,
      usage_today_minutes: used,
      daily_cap_minutes: hh.daily_cap_minutes ?? null,
      schedule_preset: hh.schedule_preset || DEFAULT_KID_SCHEDULE_PRESET,
      live_calls: liveCallsForViewer(db, hh.id, userId),
      declined_line_ids: listDeclinedLineIds(db, hh.id),
      provisioned_relatives: listProvisionedRelativesVisibleTo(db, userId, hh.id),
    };
  });

  const directory = (
    db
      .prepare(
        `SELECT l.id, l.name, l.type, l.household_id, l.owner_user_id, l.online, IFNULL(l.mode, 'parent') AS mode,
                l.avatar_path, l.avatar_updated_at, h.name AS household_name, u.parent_title
         FROM lines l
         JOIN households h ON h.id = l.household_id
         JOIN users u ON u.id = l.owner_user_id`
      )
      .all() as {
      id: string;
      name: string;
      type: string;
      household_id: string;
      owner_user_id: string;
      online: number;
      mode: string;
      avatar_path: string | null;
      avatar_updated_at: string | null;
      household_name: string;
      parent_title: string | null;
    }[]
  )
    .filter((row) => canViewerSeeLine(db, userId, row.id))
    .map(({ avatar_path, avatar_updated_at, ...row }) => {
      const gp = lookupGrandparentPadLabels(db, row.id);
      const childOnly = isChildOnlyAccount(db, userId);
      // Only kid lines are “Quinn’s friend” — friend parents (Ken) stay on Casey’s pad.
      const friendOf =
        (row.mode || "parent") === "child"
          ? friendInviteKidForViewer(db, userId, row.household_id)
          : null;
      return {
        ...row,
        name: gp ? (childOnly ? gp.kid : gp.adult) : row.name,
        kid_name: gp?.kid,
        friend_of_kid_line_id: friendOf?.id ?? null,
        friend_of_kid_label: friendOf?.label ?? null,
        ...publicLineAvatar({
          id: row.id,
          avatar_path,
          avatar_updated_at,
        }),
        is_test_review: isTestReviewLineId(db, row.id),
      };
    });

  households.sort((a, b) => {
    if (a.access === b.access) return 0;
    return a.access === "member" ? -1 : 1;
  });

  return {
    households,
    directory,
    mothership: {
      ...getMothershipStats(db),
      ...mothershipOperatorMeta(db, userId),
    },
    circle_billing: listCircleBillingForParent(db, userId),
    circle_billing_instructions: getMothershipBillingSettings(db).enabled
      ? getMothershipBillingSettings(db).payment_instructions
      : null,
    grandparent_pad: grandparentPadForUser(db, userId),
  };
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
 * Parents never pick this — PhoneHome assigns so Alex ≠ cousin.
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
  /** Lead with one-tap (lan) or Download config. Per adapter, not a global host flag. */
  setup_mode: "lan" | "download";
  /** True only when one-tap is the lead path (home household + reachability). */
  lan_push_available: boolean;
  /** Extension + secret + a registrar the household can actually reach. */
  download_ready: boolean;
  last_provision_at: string | null;
  last_config_download_at: string | null;
  /** Parent downloaded a file or ATA pulled HTTPS — not the same as REGISTER. */
  config_seen: boolean;
  /** Parent downloaded XML/txt (does not mean the box applied it). */
  config_downloaded: boolean;
  /** ATA actually fetched /provision (HTTPS). Never set by parent Download. */
  config_pulled: boolean;
  /** Registrar that will land in the next Download / provision file. */
  sip_host_kind: "public" | "lan";
  created_at: string;
  updated_at: string;
};

export function sipHostKind(sipServer: string | null | undefined): "public" | "lan" {
  return ataFreepbxSyncMode(sipServer) === "lan" ? "lan" : "public";
}

/**
 * SIP registrar written into ATA XML/txt and used for FreePBX sync mode.
 * Invited / cousin pods never get a mothership LAN IP — that only registers
 * on the host house. Home household may keep a lab LAN escape hatch.
 *
 * Public FQDNs always follow the live Mothership (`SIP_PUBLIC_HOST` /
 * `PUBLIC_BASE_URL`) so Grandstream / Fanvil configs track DDNS changes
 * without re-saving each adapter row.
 */
export function resolveAtaSipServer(
  ata: Pick<AtaDevice, "sip_server" | "line_id">,
  db?: Database.Database
): string {
  const stored = String(ata.sip_server || "").trim();
  const pub = defaultSipServer();
  if (sipHostKind(stored) === "lan") {
    if (db) {
      const line = db.prepare(`SELECT household_id FROM lines WHERE id = ?`).get(ata.line_id) as
        | { household_id: string }
        | undefined;
      const invited = Boolean(line && !householdUsesLanAtaSetup(db, line.household_id));
      if (invited && pub) return pub;
    }
    return stored || pub;
  }
  // Public or empty — prefer current mothership hostname when configured.
  return pub || stored;
}

/**
 * Rewrite stored public SIP hosts to the live mothership hostname.
 * Leaves intentional LAN IPs alone. Safe to run on every hub boot.
 */
export function syncAtaPublicSipHostsFromEnv(db: Database.Database): number {
  const pub = defaultSipServer();
  if (!pub) return 0;
  const rows = db.prepare(`SELECT id, line_id, sip_server FROM ata_devices`).all() as Array<{
    id: string;
    line_id: string;
    sip_server: string;
  }>;
  let n = 0;
  const now = nowIso();
  const upd = db.prepare(`UPDATE ata_devices SET sip_server = ?, updated_at = ? WHERE id = ?`);
  for (const row of rows) {
    const resolved = resolveAtaSipServer(row, db);
    if (resolved && resolved !== String(row.sip_server || "").trim()) {
      upd.run(resolved, now, row.id);
      n += 1;
    }
  }
  return n;
}

export function ataDownloadReady(ata: AtaDevice, db?: Database.Database): boolean {
  if (!ata.sip_password || !ata.sip_extension) return false;
  const host = resolveAtaSipServer(ata, db);
  if (!host) return false;
  if (db) {
    const line = db.prepare(`SELECT household_id FROM lines WHERE id = ?`).get(ata.line_id) as
      | { household_id: string }
      | undefined;
    if (line && !householdUsesLanAtaSetup(db, line.household_id) && sipHostKind(host) === "lan") {
      return false;
    }
  }
  return true;
}

export function publicAta(ata: AtaDevice, db?: Database.Database): PublicAtaDevice {
  const sip_server = db ? resolveAtaSipServer(ata, db) : ata.sip_server;
  const setup_mode = db ? ataSetupModeForDevice(db, ata) : "download";
  return {
    id: ata.id,
    line_id: ata.line_id,
    sip_extension: ata.sip_extension,
    sip_server,
    mac: ata.mac,
    display_name: ata.display_name,
    provision_token: ata.provision_token,
    model: normalizeAtaModel(ata.model),
    has_sip_password: Boolean(ata.sip_password),
    setup_mode,
    lan_push_available: setup_mode === "lan",
    download_ready: ataDownloadReady(ata, db),
    last_provision_at: ata.last_provision_at || null,
    last_config_download_at: ata.last_config_download_at || null,
    config_seen: Boolean(ata.mac || ata.last_provision_at || ata.last_config_download_at),
    config_downloaded: Boolean(ata.last_config_download_at),
    config_pulled: Boolean(ata.last_provision_at),
    sip_host_kind: sipHostKind(sip_server),
    created_at: ata.created_at,
    updated_at: ata.updated_at,
  };
}

export function recordAtaProvisionHit(db: Database.Database, lineId: string): void {
  const now = nowIso();
  db.prepare(`UPDATE ata_devices SET last_provision_at = ?, updated_at = ? WHERE line_id = ?`).run(
    now,
    now,
    lineId
  );
}

export function recordAtaConfigDownload(db: Database.Database, lineId: string): void {
  const now = nowIso();
  db.prepare(
    `UPDATE ata_devices SET last_config_download_at = ?, updated_at = ? WHERE line_id = ?`
  ).run(now, now, lineId);
}

export function recordAtaLanPushResult(db: Database.Database, lineId: string, ok: boolean): void {
  const now = nowIso();
  db.prepare(`UPDATE ata_devices SET lan_push_ok = ?, updated_at = ? WHERE line_id = ?`).run(
    ok ? 1 : 0,
    now,
    lineId
  );
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

  let sip_server = String(
    patch.sip_server !== undefined ? patch.sip_server : existing?.sip_server || defaultSipServer()
  )
    .trim()
    .slice(0, 128);
  if (!sip_server) throw new Error("SIP server required");
  // Invited pods cannot REGISTER to the mothership LAN. Persist the public
  // host so FreePBX sync uses remote mode (rewrite_contact + media_address).
  if (!householdUsesLanAtaSetup(db, line.household_id) && sipHostKind(sip_server) === "lan") {
    const pub = defaultSipServer();
    if (pub) sip_server = pub;
  }
  // Stale public FQDNs (old DDNS) are rewritten on hub boot via
  // syncAtaPublicSipHostsFromEnv; provision XML always uses resolveAtaSipServer.

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
    /** When set, invited pods get the public SIP host even if the row still has a LAN IP. */
    db?: Database.Database;
  } = {}
): string {
  const includePath = opts.includeConfigServerPath !== false && opts.publicBaseUrl;
  const configServerPath = includePath
    ? formatConfigServerPath(opts.publicBaseUrl!, ata.provision_token)
    : null;
  const viaHttps = opts.publicBaseUrl?.startsWith("https:") ? 2 : 1;
  return buildHt801ConfigXml({
    mac: ata.mac,
    sipServer: resolveAtaSipServer(ata, opts.db),
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
  opts: { publicBaseUrl?: string; includeConfigServerPath?: boolean; db?: Database.Database } = {}
): string {
  const includePath = opts.includeConfigServerPath !== false && opts.publicBaseUrl;
  const provisionUrl = includePath
    ? formatFanvilProvisionUrl(opts.publicBaseUrl!, ata.provision_token)
    : null;
  return buildG100sConfigTxt({
    sipServer: resolveAtaSipServer(ata, opts.db),
    sipUserId: ata.sip_extension,
    sipAuthId: ata.sip_extension,
    sipPassword: ata.sip_password,
    displayName: ata.display_name || undefined,
    provisionUrl,
  });
}

export function ataConfigForDevice(
  ata: AtaDevice,
  opts: { publicBaseUrl?: string; includeConfigServerPath?: boolean; db?: Database.Database } = {}
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
  const cidName = to ? peerLabelForCall(db, fromLineId, toLineId) : "Someone";
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
      grandparentsMenu?: false;
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
      grandparentsMenu: true;
      fromLineId: string;
      fromLabel: string;
      dialed: string;
      prompt: string;
      choices: Array<{
        digit: number;
        toLineId: string;
        toLabel: string;
        toSipExtension: string | null;
        cidName: string;
        cidNumber: string;
      }>;
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
  // Speed-dial 0–9 only. Raw SIP extensions (2001…) must never ring another
  // mothership ATA — that would skip Circle / mutual allowlist.
  if (dialed.length >= 3 && !isEmergencyDial(dialed)) {
    return {
      ok: false,
      reason: "Dial a speed-dial button 0–9 — not an extension number",
    };
  }

  const hhId = from.household_id;
  const fromLabel = ata.display_name || from.child_label || from.name;
  const fromIsGrandparent =
    isProvisionedRelativeLine(db, from.id) || isGrandparentPeerAccount(db, from.owner_user_id);

  // Grandparent ATA: dials 1–9 = auto grandchildren, then manually added adults.
  // Never Mom/Dad co-parent routing (Jordan on East pad 2 is for Cameron, not Sloan).
  if (fromIsGrandparent && dialed.length === 1 && dialed !== "0") {
    const targets = listGrandparentAtaDialTargets(db, from.owner_user_id);
    const targetLine = targets[Number(dialed) - 1];
    if (!targetLine) {
      return { ok: false, reason: "No approved contact on that button" };
    }
    if (targetLine.id === from.id) {
      return { ok: false, reason: "Can't call your own line" };
    }
    const check = canCall(db, from.id, targetLine.id);
    if (!check.ok) {
      return {
        ok: false,
        reason: check.reason,
        voice: check.voice,
        spoken: check.spoken,
        side: check.side,
      };
    }
    if (lineIsBusy(db, targetLine.id)) {
      const busy = busyCallRejection("callee");
      return { ok: false, ...busy };
    }
    const toAta = getAtaByLineId(db, targetLine.id);
    const toLabel =
      targetLine.child_label || targetLine.name || "Contact";
    const { cidName, cidNumber } = fxsCallerIdentity(db, from.id, targetLine.id);
    return {
      ok: true,
      fromLineId: from.id,
      toLineId: targetLine.id,
      fromLabel,
      toLabel,
      cidName,
      cidNumber,
      dialed,
      toSipExtension: toAta?.sip_extension ?? null,
    };
  }

  // Dial 0 = TreeHouse (pad #0). Never resolve allowlist.speed_dial=0 leftovers.
  if (dialed === "0") {
    const hh = db.prepare(`SELECT kill_switch FROM households WHERE id = ?`).get(hhId) as
      | { kill_switch: number }
      | undefined;
    if (hh?.kill_switch) {
      return { ok: false, reason: "Timeout is on" };
    }
    if (!canJoinTreeHouse(db, from.id)) {
      const mode = (from.mode || "parent") as string;
      return {
        ok: false,
        reason:
          mode === "child"
            ? "TreeHouse is for kid lines"
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

  // Dial 1 = kid pad 1 (this child’s guardian, or swapped). 911 / 933 = same parent until real PSTN E911.
  if (dialed === "1" || isEmergencyDial(dialed)) {
    const parent =
      (from.mode || "parent") === "child"
        ? kidPadParentLinesForChild(db, from.id, hhId).pad1
        : householdKidPad1ParentLine(db, hhId);
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
    if (lineIsBusy(db, parent.id)) {
      const busy = busyCallRejection("callee");
      return { ok: false, ...busy };
    }
    const toAta = getAtaByLineId(db, parent.id);
    const parentLabel =
      (from.mode || "parent") === "child"
        ? kidFacingAdultLabel(db, parent.id, from.id)
        : parentDisplayLabel(db, parent.id);
    const toLabel = isEmergencyDial(dialed)
      ? `Emergency → ${parentLabel}`
      : parentLabel;
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

  // Dial 2 = co-parent guardian when present; else allowlist speed_dial 2 (parent-placed).
  if (dialed === "2") {
    const secondary =
      (from.mode || "parent") === "child"
        ? kidPadParentLinesForChild(db, from.id, hhId).pad2
        : householdKidPad2ParentLine(db, hhId);
    if (secondary && secondary.id !== from.id) {
      // Parent-placed allowlist on 2 (e.g. Alex+Riley) wins over synthesizing co-parent.
      if (
        (from.mode || "parent") !== "child" ||
        secondaryParentOwnsDial2(db, hhId, secondary.id)
      ) {
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
        if (lineIsBusy(db, secondary.id)) {
          const busy = busyCallRejection("callee");
          return { ok: false, ...busy };
        }
        const toAta = getAtaByLineId(db, secondary.id);
        const { cidName, cidNumber } = fxsCallerIdentity(db, from.id, secondary.id);
        return {
          ok: true,
          fromLineId: from.id,
          toLineId: secondary.id,
          fromLabel,
          toLabel:
            (from.mode || "parent") === "child"
              ? kidFacingAdultLabel(db, secondary.id, from.id)
              : parentDisplayLabel(db, secondary.id),
          cidName,
          cidNumber,
          dialed,
          toSipExtension: toAta?.sip_extension ?? null,
        };
      }
    }
  }

  // Each kid’s house phone is their own pad: a Pod-shared slot that points at someone
  // this kid can’t call (Quinn’s friend Owen on Sam’s 5) is simply empty for them.
  const slotRows = db
    .prepare(
      `SELECT * FROM allowlist WHERE household_id = ? AND (speed_dial = ? OR CAST(speed_dial AS TEXT) = ?)`
    )
    .all(hhId, Number(dialed), dialed) as AllowlistEntry[];
  const kidDial = (from.mode || "parent") === "child";
  let entry = kidDial
    ? slotRows.find((r) => linesMayConnect(db, from.id, r.target_line_id))
    : slotRows[0];

  if (!entry) {
    return { ok: false, reason: `No speed-dial contact for ${dialed}` };
  }

  // Multi-Pod kid pads: pull grandparents from every Pod onto the home allowlist.
  if ((from.mode || "parent") === "child") {
    ensureKidMultiPodGrandparentAllowlists(db, from.id, podsForKid(db, from.id), (hh, tid, lab) =>
      ensureAllowlistPair(db, hh, tid, lab)
    );
    entry =
      (db
        .prepare(
          `SELECT * FROM allowlist WHERE household_id = ? AND CAST(speed_dial AS TEXT) = ?`
        )
        .get(hhId, dialed) as AllowlistEntry | undefined) || entry;
  }

  // 2+ grandparents on this pad: the first GP’s speed-dial key is an IVR menu.
  if (isProvisionedRelativeLine(db, entry.target_line_id)) {
    const gpSync = syncGrandparentDialCollapse(db, hhId);
    const menuChoices = listKidGrandparentMenuChoices(db, from.id);
    if (gpSync.mode === "menu" && menuChoices.length >= 2 && Number(dialed) === gpSync.slot) {
      const choices = menuChoices.map((c) => {
        const toAta = getAtaByLineId(db, c.lineId);
        const { cidName, cidNumber } = fxsCallerIdentity(db, from.id, c.lineId);
        return {
          digit: c.digit,
          toLineId: c.lineId,
          toLabel: c.label,
          toSipExtension: toAta?.sip_extension ?? null,
          cidName,
          cidNumber,
        };
      });
      return {
        ok: true,
        grandparentsMenu: true as const,
        fromLineId: from.id,
        fromLabel,
        dialed,
        prompt: buildGrandparentsMenuPrompt(menuChoices),
        choices,
      };
    }
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
  if (lineIsBusy(db, entry.target_line_id)) {
    const busy = busyCallRejection("callee");
    return { ok: false, ...busy };
  }

  const to = db.prepare(`SELECT * FROM lines WHERE id = ?`).get(entry.target_line_id) as Line | undefined;
  const toAta = getAtaByLineId(db, entry.target_line_id);
  // Kids hear Grandma/Grandpa + Pod, Mom/Dad for guardians, Aunt/Uncle for Pod adults.
  const gpLabels = lookupGrandparentPadLabels(db, entry.target_line_id);
  let toLabel: string;
  if ((from.mode || "parent") === "child") {
    if (gpLabels?.kid) toLabel = gpLabels.kid;
    else if (to && (to.mode || "parent") !== "child") {
      toLabel = kidFacingAdultLabel(db, entry.target_line_id, from.id, entry.label);
    } else {
      toLabel = entry.label || to?.child_label || to?.name || "Contact";
    }
  } else {
    toLabel = entry.label || to?.child_label || to?.name || "Contact";
  }
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

/** In-memory live call that includes this line (caller or callee). */
export function findLiveCallForLine(lineId: string): LiveCallEntry | undefined {
  const id = String(lineId || "").trim();
  if (!id) return undefined;
  for (const c of liveCalls.values()) {
    if (c.fromLineId === id || c.toLineId === id) return c;
  }
  return undefined;
}

/** Open call_logs row (ringing/answered, not ended) for this line. */
export function findOpenCallLogForLine(
  db: Database.Database,
  lineId: string
): { id: string; from_line_id: string; to_line_id: string; outcome: string } | undefined {
  const id = String(lineId || "").trim();
  if (!id) return undefined;
  return db
    .prepare(
      `SELECT id, from_line_id, to_line_id, outcome FROM call_logs
       WHERE ended_at IS NULL
         AND outcome IN ('ringing', 'answered')
         AND (from_line_id = ? OR to_line_id = ?)
       ORDER BY started_at DESC
       LIMIT 1`
    )
    .get(id, id) as
    | { id: string; from_line_id: string; to_line_id: string; outcome: string }
    | undefined;
}

/**
 * True when the line is already ringing or in a call.
 * Used so a new caller hears “they're on another call” instead of a silent fail.
 */
export function lineIsBusy(db: Database.Database, lineId: string): boolean {
  return Boolean(findLiveCallForLine(lineId) || findOpenCallLogForLine(db, lineId));
}

/** Rejection payload when dialing a busy line (callee busy from caller's POV). */
export function busyCallRejection(
  side: "callee" | "caller" = "callee"
): {
  reason: string;
  voice: "busy";
  spoken: string;
  side: "callee" | "caller";
} {
  return {
    reason:
      side === "caller"
        ? "You're already on a call."
        : "They're on another call right now.",
    voice: "busy",
    spoken: spokenFor("busy", side),
    side,
  };
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
  const gp = lookupGrandparentPadLabels(db, peerLineId);
  if (gp) return gp.adult;
  const line = db.prepare(`SELECT name, child_label, IFNULL(mode, 'parent') AS mode FROM lines WHERE id = ?`).get(
    peerLineId
  ) as { name: string; child_label: string | null; mode: string } | undefined;
  // Mom / Dad title beats allowlist nicknames (e.g. leftover "Cameron") for parent lines.
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

/** Incoming label: kids see Grandma/Grandpa + Pod or Aunt/Uncle; adults see the real name / Mom-Dad. */
export function peerLabelForCall(
  db: Database.Database,
  fromLineId: string,
  toLineId: string
): string {
  const to = db.prepare(`SELECT household_id, IFNULL(mode, 'parent') AS mode FROM lines WHERE id = ?`).get(
    toLineId
  ) as { household_id: string; mode: string } | undefined;
  const gp = lookupGrandparentPadLabels(db, fromLineId);
  if (gp) return to && to.mode === "child" ? gp.kid : gp.adult;
  if (to && to.mode === "child") {
    const al = db
      .prepare(`SELECT label FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
      .get(to.household_id, fromLineId) as { label: string } | undefined;
    return kidFacingAdultLabel(db, fromLineId, toLineId, al?.label);
  }
  if (to) return peerLabelForHousehold(db, to.household_id, fromLineId);
  return peerLabelForHousehold(db, "", fromLineId);
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
