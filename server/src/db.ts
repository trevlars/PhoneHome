import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";

export type LineType = "softphone" | "ata" | "bt_handset" | "hub_fxs" | "wifi_handset";

export interface User {
  id: string;
  display_name: string;
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
  /** IANA timezone for quiet hours, e.g. America/Chicago */
  quiet_tz: string | null;
  daily_cap_minutes: number | null;
  parent_pin_hash: string | null;
  schedule_preset: string;
  /** Tin Can–style instant Quiet Time */
  dnd: number;
  created_at: string;
}

export interface Line {
  id: string;
  household_id: string;
  name: string;
  type: LineType;
  owner_user_id: string;
  online: number;
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
  ended_at: string | null;
  outcome: string;
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
  `);
  migrateSchema(db);
  return db;
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
  if (!hhNames.has("dnd")) db.exec(`ALTER TABLE households ADD COLUMN dnd INTEGER NOT NULL DEFAULT 0`);

  const alCols = db.prepare(`PRAGMA table_info(allowlist)`).all() as { name: string }[];
  const alNames = new Set(alCols.map((c) => c.name));
  if (!alNames.has("speed_dial")) db.exec(`ALTER TABLE allowlist ADD COLUMN speed_dial INTEGER`);
  if (!alNames.has("favorite")) db.exec(`ALTER TABLE allowlist ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0`);
  if (!alNames.has("always_allow")) {
    db.exec(`ALTER TABLE allowlist ADD COLUMN always_allow INTEGER NOT NULL DEFAULT 0`);
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
