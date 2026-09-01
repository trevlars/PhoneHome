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
  /** Parent softphone label preference: Mom / Dad / use display name. */
  parent_title: string | null;
  /** parent = full household chrome; grandparent = simplified relative UX. */
  profile_role: string | null;
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
  /** Parent phone Do Not Disturb window (does not apply to child lines). */
  parent_quiet_start: string | null;
  parent_quiet_end: string | null;
  parent_quiet_tz: string | null;
  parent_quiet_days: string | null;
  parent_schedule_preset: string;
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

/** One circle per parent account — contacts they invite/approve. */
export interface Sphere {
  id: string;
  owner_user_id: string;
  name: string;
  created_at: string;
}

export interface SphereMember {
  sphere_id: string;
  line_id: string;
  added_by_user_id: string | null;
  created_at: string;
}

/** Kid (or any) line → parent spheres that appear on that line’s speed dial. */
export interface LineSphereAccess {
  line_id: string;
  sphere_id: string;
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
  if (!hhNames.has("parent_quiet_start")) db.exec(`ALTER TABLE households ADD COLUMN parent_quiet_start TEXT`);
  if (!hhNames.has("parent_quiet_end")) db.exec(`ALTER TABLE households ADD COLUMN parent_quiet_end TEXT`);
  if (!hhNames.has("parent_quiet_tz")) db.exec(`ALTER TABLE households ADD COLUMN parent_quiet_tz TEXT`);
  if (!hhNames.has("parent_quiet_days")) db.exec(`ALTER TABLE households ADD COLUMN parent_quiet_days TEXT`);
  if (!hhNames.has("parent_schedule_preset")) {
    db.exec(`ALTER TABLE households ADD COLUMN parent_schedule_preset TEXT NOT NULL DEFAULT 'open'`);
  }
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
  if (!userNames.has("parent_title")) db.exec(`ALTER TABLE users ADD COLUMN parent_title TEXT`);
  if (!userNames.has("profile_role")) db.exec(`ALTER TABLE users ADD COLUMN profile_role TEXT`);
  // Login keys are stored lowercase; keep lookups case-insensitive for legacy mixed-case rows.
  canonicalizeUsernames(db);
  db.exec(`DROP INDEX IF EXISTS idx_users_username`);
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_ci ON users(lower(username)) WHERE username IS NOT NULL`
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS provisioned_relatives (
      id TEXT PRIMARY KEY,
      from_household_id TEXT NOT NULL,
      relative_user_id TEXT NOT NULL,
      relative_line_id TEXT NOT NULL,
      relative_household_id TEXT NOT NULL,
      display_label TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(from_household_id) REFERENCES households(id),
      FOREIGN KEY(relative_user_id) REFERENCES users(id),
      FOREIGN KEY(relative_line_id) REFERENCES lines(id),
      FOREIGN KEY(relative_household_id) REFERENCES households(id),
      FOREIGN KEY(created_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_prov_rel_from_hh ON provisioned_relatives(from_household_id);
  `);

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
      apns_env TEXT,
      UNIQUE(line_id, platform, voip_token)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_push_devices_line ON push_devices(line_id)`);
  const pdCols = db.prepare(`PRAGMA table_info(push_devices)`).all() as { name: string }[];
  const pdNames = new Set(pdCols.map((c) => c.name));
  if (!pdNames.has("apns_env")) {
    db.exec(`ALTER TABLE push_devices ADD COLUMN apns_env TEXT`);
  }

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

  // Parent-owned spheres (one circle per parent) + kid speed-dial access
  db.exec(`
    CREATE TABLE IF NOT EXISTS spheres (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sphere_members (
      sphere_id TEXT NOT NULL,
      line_id TEXT NOT NULL,
      added_by_user_id TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (sphere_id, line_id)
    );
    CREATE TABLE IF NOT EXISTS line_sphere_access (
      line_id TEXT NOT NULL,
      sphere_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (line_id, sphere_id)
    );
    CREATE INDEX IF NOT EXISTS idx_sphere_members_line ON sphere_members(line_id);
    CREATE INDEX IF NOT EXISTS idx_line_sphere_access_sphere ON line_sphere_access(sphere_id);
  `);
  migrateSpheresBackfill(db);

  // FamilyRoom: explicit parent allowlist (separate from contacts) + pad #1 reserved.
  db.exec(`
    CREATE TABLE IF NOT EXISTS family_room_members (
      household_id TEXT NOT NULL,
      line_id TEXT NOT NULL,
      approved_by_user_id TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (household_id, line_id),
      FOREIGN KEY(household_id) REFERENCES households(id),
      FOREIGN KEY(line_id) REFERENCES lines(id)
    );
    CREATE INDEX IF NOT EXISTS idx_family_room_members_line ON family_room_members(line_id);
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  // Undirected talk edges: A↔B hear each other only when a pair row exists
  // (same-household kids also auto-talk — see canTalkInFamilyRoom).
  db.exec(`
    CREATE TABLE IF NOT EXISTS family_room_talk_pairs (
      household_id TEXT NOT NULL,
      line_a TEXT NOT NULL,
      line_b TEXT NOT NULL,
      approved_by_user_id TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (household_id, line_a, line_b),
      FOREIGN KEY(household_id) REFERENCES households(id),
      FOREIGN KEY(line_a) REFERENCES lines(id),
      FOREIGN KEY(line_b) REFERENCES lines(id),
      CHECK (line_a < line_b)
    );
    CREATE INDEX IF NOT EXISTS idx_family_room_talk_a ON family_room_talk_pairs(household_id, line_a);
    CREATE INDEX IF NOT EXISTS idx_family_room_talk_b ON family_room_talk_pairs(household_id, line_b);
  `);
  migrateFamilyRoomSlot1(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS adult_family_room_members (
      household_id TEXT NOT NULL,
      line_id TEXT NOT NULL,
      approved_by_user_id TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (household_id, line_id),
      FOREIGN KEY(household_id) REFERENCES households(id),
      FOREIGN KEY(line_id) REFERENCES lines(id)
    );
    CREATE INDEX IF NOT EXISTS idx_adult_family_room_members_line ON adult_family_room_members(line_id);
  `);
  migratePadLayoutV2(db);
}

/**
 * One-time: shift allowlist speed dials 1→2 … 8→9 (drop 9) so pad #1 is FamilyRoom.
 * Also clears any leftover speed_dial=1 rows (seeded after the first migration).
 */
function migrateFamilyRoomSlot1(db: Database.Database): void {
  const done = db.prepare(`SELECT 1 FROM schema_migrations WHERE id = ?`).get("familyroom_slot1");
  if (!done) {
    const households = db.prepare(`SELECT id FROM households`).all() as { id: string }[];
    const bump = db.prepare(`UPDATE allowlist SET speed_dial = ? WHERE id = ?`);
    const clear = db.prepare(`UPDATE allowlist SET speed_dial = NULL WHERE id = ?`);

    for (const h of households) {
      const rows = db
        .prepare(
          `SELECT id, speed_dial FROM allowlist
           WHERE household_id = ? AND speed_dial IS NOT NULL AND speed_dial BETWEEN 1 AND 9
           ORDER BY speed_dial DESC`
        )
        .all(h.id) as { id: string; speed_dial: number }[];
      for (const row of rows) {
        const n = Number(row.speed_dial);
        if (!Number.isInteger(n) || n < 1 || n > 9) continue;
        if (n === 9) clear.run(row.id);
        else bump.run(n + 1, row.id);
      }
    }

    db.prepare(`INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)`).run(
      "familyroom_slot1",
      nowIso()
    );
  }

  // Idempotent cleanup: pad #1 is TreeHouse — never keep contacts on speed_dial=1.
  const leftover = db
    .prepare(`SELECT id FROM allowlist WHERE speed_dial = 1`)
    .all() as { id: string }[];
  if (leftover.length) {
    const bumpOne = db.prepare(`UPDATE allowlist SET speed_dial = ? WHERE id = ?`);
    const clearOne = db.prepare(`UPDATE allowlist SET speed_dial = NULL WHERE id = ?`);
    for (const row of leftover) {
      const hh = db.prepare(`SELECT household_id FROM allowlist WHERE id = ?`).get(row.id) as
        | { household_id: string }
        | undefined;
      if (!hh) continue;
      const taken = new Set(
        (
          db
            .prepare(
              `SELECT speed_dial FROM allowlist WHERE household_id = ? AND speed_dial IS NOT NULL`
            )
            .all(hh.household_id) as { speed_dial: number }[]
        ).map((r) => Number(r.speed_dial))
      );
      let slot: number | null = null;
      for (let i = 2; i <= 9; i++) {
        if (!taken.has(i)) {
          slot = i;
          break;
        }
      }
      if (slot == null) clearOne.run(row.id);
      else bumpOne.run(slot, row.id);
    }
  }
}

/**
 * Pad layout v2: 0 = TreeHouse, 1 = locked parent/child, 2 = secondary parent or contact.
 * Clear legacy allowlist rows on speed_dial 0/1 (Home parent / old TreeHouse slot).
 */
function migratePadLayoutV2(db: Database.Database): void {
  const done = db.prepare(`SELECT 1 FROM schema_migrations WHERE id = ?`).get("pad_layout_v2");
  if (!done) {
    const households = db.prepare(`SELECT id FROM households`).all() as { id: string }[];
    const clear = db.prepare(`UPDATE allowlist SET speed_dial = NULL WHERE id = ?`);
    const bump = db.prepare(`UPDATE allowlist SET speed_dial = ? WHERE id = ?`);

    for (const h of households) {
      const taken = new Set(
        (
          db
            .prepare(
              `SELECT speed_dial FROM allowlist WHERE household_id = ? AND speed_dial IS NOT NULL`
            )
            .all(h.id) as { speed_dial: number }[]
        ).map((r) => Number(r.speed_dial))
      );
      const conflicts = db
        .prepare(
          `SELECT id, speed_dial FROM allowlist
           WHERE household_id = ? AND speed_dial IN (0, 1)
           ORDER BY speed_dial, created_at`
        )
        .all(h.id) as { id: string; speed_dial: number }[];
      for (const row of conflicts) {
        taken.delete(Number(row.speed_dial));
        let slot: number | null = null;
        for (let i = 2; i <= 9; i++) {
          if (!taken.has(i)) {
            slot = i;
            break;
          }
        }
        if (slot == null) clear.run(row.id);
        else {
          bump.run(slot, row.id);
          taken.add(slot);
        }
      }
    }

    db.prepare(`INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)`).run(
      "pad_layout_v2",
      nowIso()
    );
  }

  const leftover = db
    .prepare(`SELECT id, household_id FROM allowlist WHERE speed_dial IN (0, 1)`)
    .all() as { id: string; household_id: string }[];
  if (leftover.length) {
    const clearOne = db.prepare(`UPDATE allowlist SET speed_dial = NULL WHERE id = ?`);
    const bumpOne = db.prepare(`UPDATE allowlist SET speed_dial = ? WHERE id = ?`);
    for (const row of leftover) {
      const taken = new Set(
        (
          db
            .prepare(
              `SELECT speed_dial FROM allowlist WHERE household_id = ? AND speed_dial IS NOT NULL AND id != ?`
            )
            .all(row.household_id, row.id) as { speed_dial: number }[]
        ).map((r) => Number(r.speed_dial))
      );
      let slot: number | null = null;
      for (let i = 2; i <= 9; i++) {
        if (!taken.has(i)) {
          slot = i;
          break;
        }
      }
      if (slot == null) clearOne.run(row.id);
      else bumpOne.run(slot, row.id);
    }
  }
}

/**
 * Ensure every parent has a sphere; put existing allowlist + invite-linked lines
 * into household parents’ spheres; grant kid lines access to those spheres so
 * nothing breaks until parents narrow speed-dial circles.
 */
function migrateSpheresBackfill(db: Database.Database): void {
  const parentUsers = db
    .prepare(
      `SELECT DISTINCT u.id, u.display_name
       FROM users u
       WHERE EXISTS (SELECT 1 FROM households h WHERE h.owner_user_id = u.id)
          OR EXISTS (SELECT 1 FROM household_members hm WHERE hm.user_id = u.id)
          OR EXISTS (
            SELECT 1 FROM child_guardians g
            JOIN lines l ON l.id = g.line_id
            WHERE g.user_id = u.id AND l.owner_user_id != u.id
          )`
    )
    .all() as { id: string; display_name: string }[];

  const insertSphere = db.prepare(
    `INSERT OR IGNORE INTO spheres (id, owner_user_id, name, created_at) VALUES (?, ?, ?, ?)`
  );
  const insertMember = db.prepare(
    `INSERT OR IGNORE INTO sphere_members (sphere_id, line_id, added_by_user_id, created_at)
     VALUES (?, ?, ?, ?)`
  );
  const insertAccess = db.prepare(
    `INSERT OR IGNORE INTO line_sphere_access (line_id, sphere_id, created_at) VALUES (?, ?, ?)`
  );
  const now = nowIso();

  const sphereByOwner = new Map<string, string>();
  for (const u of parentUsers) {
    // Skip dedicated kid logins (child_user_id only, not household members/owners).
    const childOnly =
      Boolean(db.prepare(`SELECT 1 FROM lines WHERE child_user_id = ? LIMIT 1`).get(u.id)) &&
      !db.prepare(`SELECT 1 FROM households WHERE owner_user_id = ? LIMIT 1`).get(u.id) &&
      !db.prepare(`SELECT 1 FROM household_members WHERE user_id = ? LIMIT 1`).get(u.id);
    if (childOnly) continue;

    const existing = db
      .prepare(`SELECT id FROM spheres WHERE owner_user_id = ?`)
      .get(u.id) as { id: string } | undefined;
    if (existing) {
      sphereByOwner.set(u.id, existing.id);
      continue;
    }
    const id = newId("sph");
    const name = `${(u.display_name || "Parent").trim() || "Parent"}'s circle`;
    insertSphere.run(id, u.id, name, now);
    sphereByOwner.set(u.id, id);
  }

  // Parent lines → their owner's sphere
  const parentLines = db
    .prepare(`SELECT id, owner_user_id FROM lines WHERE IFNULL(mode, 'parent') != 'child'`)
    .all() as { id: string; owner_user_id: string }[];
  for (const line of parentLines) {
    const sph = sphereByOwner.get(line.owner_user_id);
    if (sph) insertMember.run(sph, line.id, line.owner_user_id, now);
  }

  // Allowlist targets → every parent sphere in that household
  const allowRows = db
    .prepare(`SELECT household_id, target_line_id FROM allowlist`)
    .all() as { household_id: string; target_line_id: string }[];
  for (const row of allowRows) {
    const members = db
      .prepare(`SELECT user_id FROM household_members WHERE household_id = ?`)
      .all(row.household_id) as { user_id: string }[];
    for (const m of members) {
      const sph = sphereByOwner.get(m.user_id);
      if (sph) insertMember.run(sph, row.target_line_id, m.user_id, now);
    }
  }

  // Redeemed invites: bridge both households’ lines into inviter + redeemer spheres
  const invites = db
    .prepare(
      `SELECT created_by, from_household_id, redeemed_by_household_id FROM invites
       WHERE redeemed_by_household_id IS NOT NULL`
    )
    .all() as {
    created_by: string;
    from_household_id: string;
    redeemed_by_household_id: string;
  }[];
  for (const inv of invites) {
    const inviterSph = sphereByOwner.get(inv.created_by);
    const redeemerOwner = db
      .prepare(`SELECT owner_user_id FROM households WHERE id = ?`)
      .get(inv.redeemed_by_household_id) as { owner_user_id: string } | undefined;
    const redeemerSph = redeemerOwner ? sphereByOwner.get(redeemerOwner.owner_user_id) : undefined;
    const fromLines = db
      .prepare(`SELECT id FROM lines WHERE household_id = ?`)
      .all(inv.from_household_id) as { id: string }[];
    const toLines = db
      .prepare(`SELECT id FROM lines WHERE household_id = ?`)
      .all(inv.redeemed_by_household_id) as { id: string }[];
    for (const l of toLines) {
      if (inviterSph) insertMember.run(inviterSph, l.id, inv.created_by, now);
    }
    for (const l of fromLines) {
      if (redeemerSph) insertMember.run(redeemerSph, l.id, redeemerOwner?.owner_user_id ?? null, now);
    }
  }

  // Kid lines: access to all parent spheres in their household (preserve existing dial pads)
  const childLines = db
    .prepare(
      `SELECT id, household_id FROM lines WHERE IFNULL(mode, 'parent') = 'child'`
    )
    .all() as { id: string; household_id: string }[];
  for (const kid of childLines) {
    const members = db
      .prepare(`SELECT user_id FROM household_members WHERE household_id = ?`)
      .all(kid.household_id) as { user_id: string }[];
    for (const m of members) {
      const sph = sphereByOwner.get(m.user_id);
      if (sph) insertAccess.run(kid.id, sph, now);
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
