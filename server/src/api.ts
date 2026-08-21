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
  };
  if (opts?.isChildOnly !== undefined) out.is_child_only = opts.isChildOnly;
  return out;
}

function insertUser(
  db: Database.Database,
  user: User
): void {
  db.prepare(
    `INSERT INTO users (id, display_name, username, password_hash, setup_code_hash, created_at)
     VALUES (@id, @display_name, @username, @password_hash, @setup_code_hash, @created_at)`
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
  opts: { username?: string; password?: string } = {}
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

/** Household allowlist/rules: members OR any guardian of a child line in that household. */
export function canManageHouseholdChildState(
  db: Database.Database,
  userId: string,
  householdId: string
): boolean {
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
  if ((line.mode || "parent") !== "child") throw new Error("Line must be in Child mode first");

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
  if ((line.mode || "parent") !== "child") throw new Error("Line must be in Child mode first");

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
  if ((line.mode || "parent") !== "child") throw new Error("Line must be in Child mode first");

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

export function createHousehold(db: Database.Database, userId: string, name: string): Household {
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
    layout_locked: 1,
    ring_volume: 70,
    ringer_style: "classic",
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO households (id, name, owner_user_id, kill_switch, quiet_start, quiet_end, quiet_tz, quiet_days, skip_holidays, daily_cap_minutes, parent_pin_hash, schedule_preset, dnd, layout_locked, ring_volume, ringer_style, created_at)
     VALUES (@id, @name, @owner_user_id, @kill_switch, @quiet_start, @quiet_end, @quiet_tz, @quiet_days, @skip_holidays, @daily_cap_minutes, @parent_pin_hash, @schedule_preset, @dnd, @layout_locked, @ring_volume, @ringer_style, @created_at)`
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
    mode: "parent",
    child_label: null,
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
  return normalizeLine(db.prepare(`SELECT * FROM lines WHERE id = ?`).get(lineId) as Line);
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
  opts: { speedDial?: number | null; favorite?: boolean; alwaysAllow?: boolean } = {}
): AllowlistEntry {
  const target = db
    .prepare(`SELECT id, household_id, name, mode FROM lines WHERE id = ?`)
    .get(targetLineId) as
    | { id: string; household_id: string; name: string; mode: string | null }
    | undefined;
  if (!target) throw new Error("Unknown line");
  // Same-household lines (parent ↔ child) may be on the allowlist for speed dial.
  // Softphones must still hide/reject the active line itself (UI + canCall).
  const used = db
    .prepare(`SELECT speed_dial FROM allowlist WHERE household_id = ? AND speed_dial IS NOT NULL`)
    .all(householdId) as { speed_dial: number }[];
  const taken = new Set(used.map((u) => u.speed_dial));
  let speed = opts.speedDial ?? null;
  if (speed != null && (speed < 1 || speed > 9)) {
    throw new Error("Speed dial must be 1–9 (0 is reserved for Home / parent)");
  }
  if (speed == null) {
    const sameHhChild =
      target.household_id === householdId && (target.mode || "parent") === "child";
    // Parent pad synthesizes household kids onto slot 1 — prefer that for allowlist
    // rows too, and leave 1 free when auto-placing everyone else.
    if (sameHhChild && !taken.has(1)) {
      speed = 1;
    } else {
      const hhHasChild = Boolean(
        db
          .prepare(
            `SELECT 1 FROM lines WHERE household_id = ? AND IFNULL(mode, 'parent') = 'child' LIMIT 1`
          )
          .get(householdId)
      );
      const start = hhHasChild && !taken.has(1) ? 2 : 1;
      for (let i = start; i <= 9; i++) {
        if (!taken.has(i)) {
          speed = i;
          break;
        }
      }
      if (speed == null) {
        for (let i = 1; i <= 9; i++) {
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
  // Slot 0 is reserved for the designated Home parent (synthesized; not assignable).
  if (next.speed_dial != null && (next.speed_dial < 1 || next.speed_dial > 9)) {
    throw new Error("Speed dial must be 1–9 (0 is reserved for Home / parent)");
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
export function minutesUsedToday(db: Database.Database, householdId: string, now = new Date()): number {
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

  const lines = db.prepare(`SELECT id FROM lines WHERE household_id = ?`).all(householdId) as {
    id: string;
  }[];
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
    layout_locked,
    ring_volume,
    ringer_style,
  };
  db.prepare(
    `UPDATE households SET kill_switch = @kill_switch, quiet_start = @quiet_start, quiet_end = @quiet_end,
     quiet_tz = @quiet_tz, quiet_days = @quiet_days, skip_holidays = @skip_holidays,
     daily_cap_minutes = @daily_cap_minutes, parent_pin_hash = @parent_pin_hash,
     schedule_preset = @schedule_preset, dnd = @dnd, layout_locked = @layout_locked,
     ring_volume = @ring_volume, ringer_style = @ringer_style WHERE id = @id`
  ).run(next);
  return next;
}

export function inQuietHours(hh: Household, date = new Date()): boolean {
  return isQuietHoursActive(hh, date);
}

/**
 * Pad presence: softphone tab OR a registered ATA outside Quiet Time / quiet hours.
 * (FXS handset plug state isn't visible over SIP — registration is the signal.)
 */
export function linePresenceOnline(opts: {
  softphoneOnline: boolean;
  ataRegistered: boolean;
  household: Pick<
    Household,
    "dnd" | "quiet_start" | "quiet_end" | "quiet_tz" | "quiet_days" | "skip_holidays" | "schedule_preset"
  >;
  now?: Date;
}): boolean {
  if (opts.softphoneOnline) return true;
  if (!opts.ataRegistered) return false;
  const hh = opts.household;
  if (hh.dnd) return false;
  if (isQuietHoursActive(hh, opts.now)) return false;
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

  if (inQuietHours(fromHh, now) && !fromVip) {
    const voice = quietHoursVoice(fromHh);
    const reason =
      voice === "school"
        ? "School hours — try again later"
        : voice === "bedtime"
          ? "Bedtime — try again tomorrow"
          : "Quiet Time — try again later";
    return block(reason, voice, "caller");
  }
  if (inQuietHours(toHh, now) && !toVip) {
    const voice = quietHoursVoice(toHh);
    const reason =
      voice === "school"
        ? "They’re at school"
        : voice === "bedtime"
          ? "They’re not available until tomorrow"
          : "They’re in Quiet Time";
    return block(reason, voice, "callee");
  }

  if (fromHh.daily_cap_minutes != null) {
    const used = minutesUsedToday(db, fromHh.id, now);
    if (used >= fromHh.daily_cap_minutes) {
      return block("Daily talk time limit reached", "cap", "caller");
    }
  }
  if (toHh.daily_cap_minutes != null) {
    const used = minutesUsedToday(db, toHh.id, now);
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
  const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm";
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
    from_label: fromLabel?.trim() || fromLine?.name?.replace(/'s phone$/i, "").trim() || "Family",
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
  }
  return leaveVoicemail(db, to.household_id, fromLineId, toLineId, body, undefined, opts);
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
      return { ...a, always_allow: a.always_allow || 0, mutual };
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
      };
    });
    return {
      ...pub,
      dnd: hh.dnd || 0,
      quiet_days: hh.quiet_days ?? null,
      skip_holidays: hh.skip_holidays || 0,
      access: isMember ? "member" : "guardian",
      lines: enrichedLines,
      allowlist: enrichedAllowlist,
      call_logs: logs,
      voicemails,
      usage_today_minutes: used,
      daily_cap_minutes: hh.daily_cap_minutes ?? null,
      schedule_preset: hh.schedule_preset || "open",
      live_calls: liveCallsForViewer(db, hh.id, userId),
      declined_line_ids: listDeclinedLineIds(db, hh.id),
    };
  });

  const directory = (
    db
      .prepare(
        `SELECT l.id, l.name, l.type, l.household_id, l.online, l.avatar_path, l.avatar_updated_at,
                h.name AS household_name
         FROM lines l JOIN households h ON h.id = l.household_id`
      )
      .all() as {
      id: string;
      name: string;
      type: string;
      household_id: string;
      online: number;
      avatar_path: string | null;
      avatar_updated_at: string | null;
      household_name: string;
    }[]
  ).map(({ avatar_path, avatar_updated_at, ...row }) => ({
    ...row,
    ...publicLineAvatar({
      id: row.id,
      avatar_path,
      avatar_updated_at,
    }),
  }));

  households.sort((a, b) => {
    if (a.access === b.access) return 0;
    return a.access === "member" ? -1 : 1;
  });

  return { households, directory };
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
  return "y5876647.eero.online";
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
 * Designated Home / dial-0 parent for a household.
 * Rule: first line with mode parent (IFNULL(mode,'parent') != 'child'),
 * ordered by created_at ASC, then id ASC. Slot 0 is synthesized — never stored
 * as allowlist.speed_dial=0.
 */
export function householdHomeParentLine(
  db: Database.Database,
  householdId: string
): Line | null {
  const row = db
    .prepare(
      `SELECT * FROM lines
       WHERE household_id = ?
         AND IFNULL(mode, 'parent') != 'child'
       ORDER BY created_at ASC, id ASC
       LIMIT 1`
    )
    .get(householdId) as Line | undefined;
  return row ? normalizeLine(row) : null;
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
 * Digit "0" → designated household parent (Home). Digits "1"–"9" → speed_dial slots.
 * Digits "911" / "933" → same parent (interim E911 until PSTN trunk).
 * Longer digit strings may match speed_dial later.
 * When the target line has an `ata_devices` row, `toSipExtension` is set so the bridge can
 * ring FXS (ATA→ATA) without a softphone.
 */
export function resolveAtaDial(
  db: Database.Database,
  sipExtension: string,
  dialedRaw: string
):
  | {
      ok: true;
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

  // Dial 0 = Home / designated parent (not an allowlist slot).
  // 911 / 933 = same parent until real PSTN E911 (bypass Quiet Time / pause).
  if (dialed === "0" || isEmergencyDial(dialed)) {
    const parent = householdHomeParentLine(db, hhId);
    if (!parent) {
      return {
        ok: false,
        reason: isEmergencyDial(dialed)
          ? "No parent line for emergency dial"
          : "No parent line for Home (0)",
      };
    }
    if (from.id === parent.id) {
      return { ok: false, reason: isEmergencyDial(dialed) ? "Can't emergency-dial yourself" : "Can't call your own line" };
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
      ? `Emergency → ${parent.child_label || parent.name || "Home"}`
      : parent.child_label || parent.name || "Home";
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
  const al = db
    .prepare(`SELECT label FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
    .get(householdId, peerLineId) as { label: string } | undefined;
  if (al?.label?.trim()) return al.label.trim();
  const line = db.prepare(`SELECT name, child_label FROM lines WHERE id = ?`).get(peerLineId) as
    | { name: string; child_label: string | null }
    | undefined;
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
