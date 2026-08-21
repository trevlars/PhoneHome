import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";

export type LineType = "softphone" | "ata" | "bt_handset" | "hub_fxs" | "wifi_handset";

export interface User {
  id: string;
  display_name: string;
  username: string | null;
  password_hash: string | null;
  setup_code_hash: string | null;
  created_at: string;
}

export interface Household {
  id: string;
  name: string;
  owner_user_id: string;
  kill_switch: number;
  quiet_start: string | null;
  quiet_end: string | null;
  /** IANA timezone for Quiet Time windows, e.g. America/Chicago */
  quiet_tz: string | null;
  /**
   * Quiet-window weekdays as comma-separated ISO Mon=1 … Sun=7.
   * Null/empty = every day. School preset defaults to "1,2,3,4,5".
   */
  quiet_days: string | null;
  /** When 1, School (and any schedule with this flag) skips US federal holidays. */
  skip_holidays: number;
  daily_cap_minutes: number | null;
  parent_pin_hash: string | null;
  schedule_preset: string;
  /** Instant Quiet Time (manual); Timeout is kill_switch */
  dnd: number;
  /** When 1 and a parent PIN exists, speed-dial drag-reorder is locked */
  layout_locked: number;
  /** Incoming/outbound phone UI gain 0–100 */
  ring_volume: number;
  /** classic = 90s electromechanical bell (default); chirp | modern | chime | urgent */
  ringer_style: string;
  created_at: string;
}

export type LineMode = "parent" | "child";

export interface Line {
  id: string;
  household_id: string;
  name: string;
  type: LineType;
  owner_user_id: string;
  online: number;
  /** parent = full UI; child = limited kid UI on that device/line */
  mode: LineMode;
  /** Display label when mode=child, e.g. "Maya's phone" */
  child_label: string | null;
  /** Optional login user for this child line (username/password) */
  child_user_id: string | null;
  /** Relative path under DATA_DIR, e.g. greetings/<lineId>.webm */
  greeting_path: string | null;
  greeting_updated_at: string | null;
  /** Parent confirmed greeting choice (custom or default) for setup checklist. */
  greeting_confirmed_at: string | null;
  /** Relative path under DATA_DIR, e.g. avatars/<lineId>.jpg */
  avatar_path: string | null;
  avatar_updated_at: string | null;
  /**
   * Opt-in 90s answering machine: when 1, recipient softphone plays
   * leave-a-message audio live while the caller records. Default 0 (off).
   */
  answering_machine: number;
  created_at: string;
}

export interface ChildGuardian {
  line_id: string;
  user_id: string;
  role: "guardian";
  created_at: string;
}

export interface GuardianInvite {
  id: string;
  code: string;
  line_id: string;
  created_by: string;
  expires_at: string;
  redeemed_by_user_id: string | null;
  created_at: string;
}

export interface Invite {
  id: string;
  code: string;
  from_household_id: string;
  created_by: string;
  expires_at: string;
  redeemed_by_household_id: string | null;
  created_at: string;
}

export interface AllowlistEntry {
  id: string;
  household_id: string;
  target_line_id: string;
  label: string;
  speed_dial: number | null;
  favorite: number;
  /** Bypass quiet hours / DND (VIP grandma pattern) */
  always_allow: number;
  created_at: string;
}

export interface CallLog {
  id: string;
  from_line_id: string;
  to_line_id: string;
  started_at: string;
  /** When the call connected; talk time starts here (null until answered). */
  answered_at: string | null;
  ended_at: string | null;
  outcome: string;
}

/** Analog ATA vendor/model for provisioning file format. */
export type AtaModel = "ht801" | "g100s";

/** Analog ATA (HT801 / Fanvil G100S) binding for a PhoneHome line. */
export interface AtaDevice {
  id: string;
  line_id: string;
  sip_extension: string;
  sip_password: string;
  sip_server: string;
  /** 12 lowercase hex digits, or null */
  mac: string | null;
  provision_token: string;
  display_name: string | null;
  /** ht801 = Grandstream XML; g100s = Fanvil txt/cfg */
  model: AtaModel;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
}

export function openDb(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      setup_code_hash TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS households (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      kill_switch INTEGER NOT NULL DEFAULT 0,
      quiet_start TEXT,
      quiet_end TEXT,
      quiet_tz TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(owner_user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS household_members (
      household_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'parent',
      PRIMARY KEY (household_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS lines (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      online INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      from_household_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      redeemed_by_household_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS allowlist (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      target_line_id TEXT NOT NULL,
      label TEXT NOT NULL,
      speed_dial INTEGER,
      favorite INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE(household_id, target_line_id)
    );
    CREATE TABLE IF NOT EXISTS call_logs (
      id TEXT PRIMARY KEY,
      from_line_id TEXT NOT NULL,
      to_line_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      answered_at TEXT,
      ended_at TEXT,
      outcome TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS voicemails (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      from_line_id TEXT,
      from_label TEXT,
      body TEXT NOT NULL,
      listened INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS peer_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      signaling_url TEXT NOT NULL,
      public_key TEXT,
      trusted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS allowlist_declined (
      household_id TEXT NOT NULL,
      target_line_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (household_id, target_line_id)
    );
  `);
  migrateSchema(db);
  return db;
}

/**
 * Store usernames as lowercase login keys. display_name stays untouched.
 * If two rows collide under lower(username), keep the earliest created_at and
 * clear the duplicate username so the unique CI index can be created.
 */
function canonicalizeUsernames(db: Database.Database): void {
  const rows = db
    .prepare(
      `SELECT id, username, created_at FROM users WHERE username IS NOT NULL AND username != ''`
    )
    .all() as { id: string; username: string; created_at: string }[];
  if (!rows.length) return;

  const byKey = new Map<string, { id: string; username: string; created_at: string }[]>();
  for (const row of rows) {
    const key = String(row.username).trim().toLowerCase();
    if (!key) continue;
    const list = byKey.get(key) || [];
    list.push(row);
    byKey.set(key, list);
  }

  const clearUsername = db.prepare(`UPDATE users SET username = NULL WHERE id = ?`);
  const setUsername = db.prepare(`UPDATE users SET username = ? WHERE id = ?`);

  for (const [key, group] of byKey) {
    group.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const keep = group[0];
    for (let i = 1; i < group.length; i++) {
      clearUsername.run(group[i].id);
    }
    if (keep.username !== key) {
      setUsername.run(key, keep.id);
    }
  }
}

function migrateSchema(db: Database.Database): void {
  const hhCols = db.prepare(`PRAGMA table_info(households)`).all() as { name: string }[];
  const hhNames = new Set(hhCols.map((c) => c.name));
  if (!hhNames.has("quiet_tz")) db.exec(`ALTER TABLE households ADD COLUMN quiet_tz TEXT`);
  if (!hhNames.has("daily_cap_minutes")) db.exec(`ALTER TABLE households ADD COLUMN daily_cap_minutes INTEGER`);
  if (!hhNames.has("parent_pin_hash")) db.exec(`ALTER TABLE households ADD COLUMN parent_pin_hash TEXT`);
  if (!hhNames.has("schedule_preset")) {
    db.exec(`ALTER TABLE households ADD COLUMN schedule_preset TEXT NOT NULL DEFAULT 'open'`);
  }
  if (!hhNames.has("quiet_days")) db.exec(`ALTER TABLE households ADD COLUMN quiet_days TEXT`);
  if (!hhNames.has("skip_holidays")) {
    db.exec(`ALTER TABLE households ADD COLUMN skip_holidays INTEGER NOT NULL DEFAULT 0`);
  }
  if (!hhNames.has("dnd")) db.exec(`ALTER TABLE households ADD COLUMN dnd INTEGER NOT NULL DEFAULT 0`);
  if (!hhNames.has("layout_locked")) {
    db.exec(`ALTER TABLE households ADD COLUMN layout_locked INTEGER NOT NULL DEFAULT 1`);
  }
  if (!hhNames.has("ring_volume")) {
    db.exec(`ALTER TABLE households ADD COLUMN ring_volume INTEGER NOT NULL DEFAULT 70`);
  }
  if (!hhNames.has("ringer_style")) {
    db.exec(`ALTER TABLE households ADD COLUMN ringer_style TEXT NOT NULL DEFAULT 'classic'`);
  }

  const userCols = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[];
  const userNames = new Set(userCols.map((c) => c.name));
  if (!userNames.has("username")) db.exec(`ALTER TABLE users ADD COLUMN username TEXT`);
  if (!userNames.has("password_hash")) db.exec(`ALTER TABLE users ADD COLUMN password_hash TEXT`);
  // Login keys are stored lowercase; keep lookups case-insensitive for legacy mixed-case rows.
  canonicalizeUsernames(db);
  db.exec(`DROP INDEX IF EXISTS idx_users_username`);
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_ci ON users(lower(username)) WHERE username IS NOT NULL`
  );

  const alCols = db.prepare(`PRAGMA table_info(allowlist)`).all() as { name: string }[];
  const alNames = new Set(alCols.map((c) => c.name));
  if (!alNames.has("speed_dial")) db.exec(`ALTER TABLE allowlist ADD COLUMN speed_dial INTEGER`);
  if (!alNames.has("favorite")) db.exec(`ALTER TABLE allowlist ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0`);
  if (!alNames.has("always_allow")) {
    db.exec(`ALTER TABLE allowlist ADD COLUMN always_allow INTEGER NOT NULL DEFAULT 0`);
  }
  // Same-household allowlist rows are intentional (parent ↔ child speed dial).
  // Softphones filter target === active line; canCall rejects self-calls.

  const lineCols = db.prepare(`PRAGMA table_info(lines)`).all() as { name: string }[];
  const lineNames = new Set(lineCols.map((c) => c.name));
  if (!lineNames.has("mode")) {
    db.exec(`ALTER TABLE lines ADD COLUMN mode TEXT NOT NULL DEFAULT 'parent'`);
  }
  if (!lineNames.has("child_label")) {
    db.exec(`ALTER TABLE lines ADD COLUMN child_label TEXT`);
  }
  if (!lineNames.has("child_user_id")) {
    db.exec(`ALTER TABLE lines ADD COLUMN child_user_id TEXT`);
  }
  if (!lineNames.has("greeting_path")) {
    db.exec(`ALTER TABLE lines ADD COLUMN greeting_path TEXT`);
  }
  if (!lineNames.has("greeting_updated_at")) {
    db.exec(`ALTER TABLE lines ADD COLUMN greeting_updated_at TEXT`);
  }
  if (!lineNames.has("greeting_confirmed_at")) {
    db.exec(`ALTER TABLE lines ADD COLUMN greeting_confirmed_at TEXT`);
  }
  if (!lineNames.has("avatar_path")) {
    db.exec(`ALTER TABLE lines ADD COLUMN avatar_path TEXT`);
  }
  if (!lineNames.has("avatar_updated_at")) {
    db.exec(`ALTER TABLE lines ADD COLUMN avatar_updated_at TEXT`);
  }
  // Opt-in only — existing rows and new lines default OFF.
  if (!lineNames.has("answering_machine")) {
    db.exec(`ALTER TABLE lines ADD COLUMN answering_machine INTEGER NOT NULL DEFAULT 0`);
  }

  const callCols = db.prepare(`PRAGMA table_info(call_logs)`).all() as { name: string }[];
  const callNames = new Set(callCols.map((c) => c.name));
  if (!callNames.has("answered_at")) {
    db.exec(`ALTER TABLE call_logs ADD COLUMN answered_at TEXT`);
  }

  const vmCols = db.prepare(`PRAGMA table_info(voicemails)`).all() as { name: string }[];
  const vmNames = new Set(vmCols.map((c) => c.name));
  if (!vmNames.has("audio_path")) {
    db.exec(`ALTER TABLE voicemails ADD COLUMN audio_path TEXT`);
  }
  // Recipient line mailbox (messages left *for* this line). Without this, same-household
  // leave-a-message appeared in every softphone inbox under the shared household_id.
  if (!vmNames.has("to_line_id")) {
    db.exec(`ALTER TABLE voicemails ADD COLUMN to_line_id TEXT`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS push_devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      line_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      voip_token TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(line_id, platform, voip_token)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_push_devices_line ON push_devices(line_id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS allowlist_declined (
      household_id TEXT NOT NULL,
      target_line_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (household_id, target_line_id)
    );
    CREATE TABLE IF NOT EXISTS child_guardians (
      line_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'guardian',
      created_at TEXT NOT NULL,
      PRIMARY KEY (line_id, user_id),
      FOREIGN KEY(line_id) REFERENCES lines(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS guardian_invites (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      line_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      redeemed_by_user_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(line_id) REFERENCES lines(id),
      FOREIGN KEY(created_by) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS ata_devices (
      id TEXT PRIMARY KEY,
      line_id TEXT NOT NULL UNIQUE,
      sip_extension TEXT NOT NULL,
      sip_password TEXT NOT NULL,
      sip_server TEXT NOT NULL,
      mac TEXT,
      provision_token TEXT NOT NULL UNIQUE,
      display_name TEXT,
      model TEXT NOT NULL DEFAULT 'ht801',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(line_id) REFERENCES lines(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ata_sip_extension ON ata_devices(sip_extension);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ata_mac ON ata_devices(mac) WHERE mac IS NOT NULL;
  `);

  const ataCols = db.prepare(`PRAGMA table_info(ata_devices)`).all() as { name: string }[];
  const ataNames = new Set(ataCols.map((c) => c.name));
  if (!ataNames.has("model")) {
    db.exec(`ALTER TABLE ata_devices ADD COLUMN model TEXT NOT NULL DEFAULT 'ht801'`);
  }

  // Backfill: household owner + line owner become guardians of existing child lines
  const childLines = db
    .prepare(`SELECT id, household_id, owner_user_id FROM lines WHERE mode = 'child'`)
    .all() as { id: string; household_id: string; owner_user_id: string }[];
  const insertGuardian = db.prepare(
    `INSERT OR IGNORE INTO child_guardians (line_id, user_id, role, created_at) VALUES (?, ?, 'guardian', ?)`
  );
  const now = nowIso();
  for (const line of childLines) {
    const hh = db.prepare(`SELECT owner_user_id FROM households WHERE id = ?`).get(line.household_id) as
      | { owner_user_id: string }
      | undefined;
    if (hh?.owner_user_id) insertGuardian.run(line.id, hh.owner_user_id, now);
    if (line.owner_user_id) insertGuardian.run(line.id, line.owner_user_id, now);
  }

  // Backfill speed-dial slots for existing contacts
  const households = db.prepare(`SELECT id FROM households`).all() as { id: string }[];
  for (const h of households) {
    const rows = db
      .prepare(`SELECT id, speed_dial FROM allowlist WHERE household_id = ? ORDER BY created_at`)
      .all(h.id) as { id: string; speed_dial: number | null }[];
    const taken = new Set(rows.map((r) => r.speed_dial).filter((n) => n != null));
    let next = 1;
    for (const row of rows) {
      if (row.speed_dial != null) continue;
      while (taken.has(next) && next <= 9) next += 1;
      if (next > 9) break;
      db.prepare(`UPDATE allowlist SET speed_dial = ?, favorite = 1 WHERE id = ?`).run(next, row.id);
      taken.add(next);
      next += 1;
    }
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix = ""): string {
  return prefix ? `${prefix}_${nanoid(10)}` : nanoid(12);
}

export function createSession(db: Database.Database, userId: string, days = 30): Session {
  const session: Session = {
    id: newId("sess"),
    user_id: userId,
    created_at: nowIso(),
    expires_at: new Date(Date.now() + days * 864e5).toISOString(),
  };
  db.prepare(
    `INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (@id, @user_id, @created_at, @expires_at)`
  ).run(session);
  return session;
}

export function getSessionUser(db: Database.Database, sessionId: string | undefined): User | null {
  if (!sessionId) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`
    )
    .get(sessionId, nowIso()) as User | undefined;
  return row ?? null;
}
