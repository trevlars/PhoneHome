/**
 * iOS VoIP push device tokens (PushKit).
 * One row per (line_id, voip_token) — rotating tokens upsert.
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

export function upsertIosVoipToken(
  db: Database.Database,
  opts: { userId: string; lineId: string; voipToken: string }
): PushDevice {
  const token = String(opts.voipToken || "")
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "");
  if (token.length < 16) throw new Error("Invalid VoIP token");
  const lineId = String(opts.lineId || "").trim();
  if (!lineId) throw new Error("lineId required");
  const now = new Date().toISOString();
  const existing = db
    .prepare(
      `SELECT * FROM push_devices WHERE line_id = ? AND platform = 'ios' AND voip_token = ?`
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
    platform: "ios",
    voip_token: token,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO push_devices (id, user_id, line_id, platform, voip_token, updated_at)
     VALUES (@id, @user_id, @line_id, @platform, @voip_token, @updated_at)`
  ).run(row);
  return row;
}

export function listIosVoipTokensForLine(db: Database.Database, lineId: string): PushDevice[] {
  return db
    .prepare(
      `SELECT * FROM push_devices WHERE line_id = ? AND platform = 'ios' ORDER BY updated_at DESC`
    )
    .all(lineId) as PushDevice[];
}

export function deleteVoipToken(db: Database.Database, lineId: string, voipToken: string): void {
  const token = String(voipToken || "")
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "");
  db.prepare(`DELETE FROM push_devices WHERE line_id = ? AND voip_token = ?`).run(lineId, token);
}
