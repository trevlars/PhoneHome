/**
 * iOS push device tokens (PushKit VoIP and standard alert APNs).
 * One row per (line_id, platform, voip_token) — rotating tokens upsert.
 * platform: `ios` = VoIP (CallKit path); `ios-alert` = standard APNs (in-app UI);
 * `android` = FCM token stored in voip_token (case-sensitive, not hex).
 */
import type Database from "better-sqlite3";
import { nanoid } from "nanoid";

export type PushDevice = {
  id: string;
  user_id: string;
  line_id: string;
  platform: string;
  voip_token: string;
  updated_at: string;
  /** Last APNs host that accepted this token: sandbox | production. */
  apns_env: string | null;
};

export function ensurePushDevicesTable(db: Database.Database): void {
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
    CREATE INDEX IF NOT EXISTS idx_push_devices_line ON push_devices(line_id);
  `);
}

function normalizeToken(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "");
}

function upsertIosToken(
  db: Database.Database,
  opts: { userId: string; lineId: string; token: string; platform: "ios" | "ios-alert" }
): PushDevice {
  const token = normalizeToken(opts.token);
  if (token.length < 16) throw new Error("Invalid push token");
  const lineId = String(opts.lineId || "").trim();
  if (!lineId) throw new Error("lineId required");
  const now = new Date().toISOString();
  const existing = db
    .prepare(
      `SELECT * FROM push_devices WHERE line_id = ? AND platform = ? AND voip_token = ?`
    )
    .get(lineId, opts.platform, token) as PushDevice | undefined;
  if (existing) {
    db.prepare(`UPDATE push_devices SET user_id = ?, updated_at = ? WHERE id = ?`).run(
      opts.userId,
      now,
      existing.id
    );
    return { ...existing, user_id: opts.userId, updated_at: now };
  }
  const row: PushDevice = {
    id: nanoid(),
    user_id: opts.userId,
    line_id: lineId,
    platform: opts.platform,
    voip_token: token,
    updated_at: now,
    apns_env: null,
  };
  db.prepare(
    `INSERT INTO push_devices (id, user_id, line_id, platform, voip_token, updated_at)
     VALUES (@id, @user_id, @line_id, @platform, @voip_token, @updated_at)`
  ).run(row);
  return row;
}

export function upsertIosVoipToken(
  db: Database.Database,
  opts: { userId: string; lineId: string; voipToken: string }
): PushDevice {
  return upsertIosToken(db, {
    userId: opts.userId,
    lineId: opts.lineId,
    token: opts.voipToken,
    platform: "ios",
  });
}

/**
 * Lines whose calls should ring this signed-in person's iPhone.
 *
 * A parent's active UI may be a child line they manage. That does not make the
 * parent's iPhone the child's softphone. Parent-mode lines owned by the user and
 * child lines logged in as that child are the durable receiving identities.
 */
export function listIosVoipReceivingLineIds(
  db: Database.Database,
  userId: string
): string[] {
  const rows = db
    .prepare(
      `SELECT id
       FROM lines
       WHERE (COALESCE(mode, 'parent') != 'child' AND owner_user_id = ?)
          OR child_user_id = ?
       ORDER BY created_at ASC, rowid ASC`
    )
    .all(userId, userId) as { id: string }[];
  return rows.map((row) => row.id);
}

/**
 * Atomically bind one PushKit token to all of this user's receiving identities
 * and remove that token from stale active/managed child lines.
 */
export function replaceIosAlertTokenLines(
  db: Database.Database,
  opts: { userId: string; lineIds: string[]; apnsToken: string }
): PushDevice[] {
  const token = normalizeToken(opts.apnsToken);
  if (token.length < 16) throw new Error("Invalid push token");
  const lineIds = [...new Set(opts.lineIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!lineIds.length) throw new Error("No personal receiving line");

  return db.transaction(() => {
    const placeholders = lineIds.map(() => "?").join(",");
    db.prepare(
      `DELETE FROM push_devices
       WHERE platform = 'ios-alert' AND voip_token = ? AND line_id NOT IN (${placeholders})`
    ).run(token, ...lineIds);
    return lineIds.map((lineId) =>
      upsertIosAlertToken(db, {
        userId: opts.userId,
        lineId,
        apnsToken: token,
      })
    );
  })();
}

export function replaceIosVoipTokenLines(
  db: Database.Database,
  opts: { userId: string; lineIds: string[]; voipToken: string }
): PushDevice[] {
  const token = normalizeToken(opts.voipToken);
  if (token.length < 16) throw new Error("Invalid push token");
  const lineIds = [...new Set(opts.lineIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!lineIds.length) throw new Error("No personal receiving line");

  return db.transaction(() => {
    const placeholders = lineIds.map(() => "?").join(",");
    db.prepare(
      `DELETE FROM push_devices
       WHERE platform = 'ios' AND voip_token = ? AND line_id NOT IN (${placeholders})`
    ).run(token, ...lineIds);
    return lineIds.map((lineId) =>
      upsertIosVoipToken(db, {
        userId: opts.userId,
        lineId,
        voipToken: token,
      })
    );
  })();
}

/** Standard APNs device token for alert notifications (CallKit tabled path). */
export function upsertIosAlertToken(
  db: Database.Database,
  opts: { userId: string; lineId: string; apnsToken: string }
): PushDevice {
  return upsertIosToken(db, {
    userId: opts.userId,
    lineId: opts.lineId,
    token: opts.apnsToken,
    platform: "ios-alert",
  });
}

export function listIosVoipTokensForLine(db: Database.Database, lineId: string): PushDevice[] {
  return db
    .prepare(
      `SELECT * FROM push_devices WHERE line_id = ? AND platform = 'ios' ORDER BY updated_at DESC`
    )
    .all(lineId) as PushDevice[];
}

export function listIosAlertTokensForLine(db: Database.Database, lineId: string): PushDevice[] {
  return db
    .prepare(
      `SELECT * FROM push_devices WHERE line_id = ? AND platform = 'ios-alert' ORDER BY updated_at DESC`
    )
    .all(lineId) as PushDevice[];
}

/** Drop callee wake tokens that also ring the caller's line (shared parent iPhone). */
export function filterIosWakeTokensExcludingCallerLine(
  db: Database.Database,
  tokens: PushDevice[],
  fromLineId: string
): PushDevice[] {
  const callerLine = String(fromLineId || "").trim();
  if (!callerLine || !tokens.length) return tokens;
  const callerTokens = new Set(
    (
      db
        .prepare(
          `SELECT voip_token FROM push_devices
           WHERE line_id = ? AND platform IN ('ios', 'ios-alert', 'android')`
        )
        .all(callerLine) as { voip_token: string }[]
    ).map((row) => row.voip_token)
  );
  if (!callerTokens.size) return tokens;
  return tokens.filter((row) => !callerTokens.has(row.voip_token));
}

export function setPushDeviceApnsEnv(
  db: Database.Database,
  id: string,
  env: "sandbox" | "production"
): void {
  db.prepare(`UPDATE push_devices SET apns_env = ?, updated_at = ? WHERE id = ?`).run(
    env,
    new Date().toISOString(),
    id
  );
}

export function deletePushDevice(db: Database.Database, id: string): void {
  db.prepare(`DELETE FROM push_devices WHERE id = ?`).run(id);
}

export function deleteVoipToken(db: Database.Database, lineId: string, voipToken: string): void {
  const token = normalizeToken(voipToken);
  db.prepare(`DELETE FROM push_devices WHERE line_id = ? AND voip_token = ?`).run(lineId, token);
}

/** FCM registration tokens are case-sensitive and may contain ':' . */
export function normalizeAndroidToken(raw: string): string {
  const token = String(raw || "").trim();
  if (token.length < 20 || token.length > 4096) throw new Error("Invalid push token");
  if (!/^[\w:._-]+$/.test(token)) throw new Error("Invalid push token");
  return token;
}

export function listAndroidTokensForLine(db: Database.Database, lineId: string): PushDevice[] {
  return db
    .prepare(
      `SELECT * FROM push_devices WHERE line_id = ? AND platform = 'android' ORDER BY updated_at DESC`
    )
    .all(lineId) as PushDevice[];
}

export function replaceAndroidTokenLines(
  db: Database.Database,
  opts: { userId: string; lineIds: string[]; fcmToken: string }
): PushDevice[] {
  const token = normalizeAndroidToken(opts.fcmToken);
  const lineIds = [...new Set(opts.lineIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!lineIds.length) throw new Error("No personal receiving line");
  const now = new Date().toISOString();
  return db.transaction(() => {
    const placeholders = lineIds.map(() => "?").join(",");
    db.prepare(
      `DELETE FROM push_devices
       WHERE platform = 'android' AND voip_token = ? AND line_id NOT IN (${placeholders})`
    ).run(token, ...lineIds);
    return lineIds.map((lineId) => {
      const existing = db
        .prepare(
          `SELECT * FROM push_devices WHERE line_id = ? AND platform = 'android' AND voip_token = ?`
        )
        .get(lineId, token) as PushDevice | undefined;
      if (existing) {
        db.prepare(`UPDATE push_devices SET user_id = ?, updated_at = ? WHERE id = ?`).run(
          opts.userId,
          now,
          existing.id
        );
        return { ...existing, user_id: opts.userId, updated_at: now };
      }
      const row: PushDevice = {
        id: nanoid(),
        user_id: opts.userId,
        line_id: lineId,
        platform: "android",
        voip_token: token,
        updated_at: now,
        apns_env: null,
      };
      db.prepare(
        `INSERT INTO push_devices (id, user_id, line_id, platform, voip_token, updated_at)
         VALUES (@id, @user_id, @line_id, @platform, @voip_token, @updated_at)`
      ).run(row);
      return row;
    });
  })();
}

export function deleteAndroidTokensForLine(db: Database.Database, lineId: string): number {
  const info = db
    .prepare(`DELETE FROM push_devices WHERE line_id = ? AND platform = 'android'`)
    .run(lineId);
  return Number(info.changes || 0);
}

/** Drop VoIP (CallKit) tokens for a line so the hub falls back to alert APNs. */
export function deleteIosVoipTokensForLine(db: Database.Database, lineId: string): number {
  const info = db
    .prepare(`DELETE FROM push_devices WHERE line_id = ? AND platform = 'ios'`)
    .run(lineId);
  return Number(info.changes || 0);
}
