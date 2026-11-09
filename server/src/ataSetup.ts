import type Database from "better-sqlite3";
import type { AtaDevice } from "./db.js";

/** One-tap HT801 push needs PhoneHome on the same LAN as the adapter. */
export function ataLanPushEnabled(): boolean {
  const raw = String(process.env.ATA_LAN_PUSH ?? "1").trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "no" || raw === "off");
}

export type AtaSetupMode = "lan" | "download";

function lanPushOkFromRow(raw: unknown): 0 | 1 | null {
  if (raw === 0 || raw === 1) return raw;
  if (raw == null || raw === "") return null;
  return Number(raw) === 1 ? 1 : 0;
}

/** Oldest household on this Mothership — typically the host family, not invited pods. */
export function mothershipHomeHouseholdId(db: Database.Database): string | null {
  const row = db
    .prepare(`SELECT id FROM households ORDER BY created_at ASC, rowid ASC LIMIT 1`)
    .get() as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * LAN one-tap is only the default for the Mothership's own house (or an explicit
 * allowlist). Invited cousin pods always start on Download config.
 */
export function householdUsesLanAtaSetup(db: Database.Database, householdId: string): boolean {
  const raw = (process.env.ATA_LAN_HOUSEHOLD_IDS || "").trim();
  if (raw) {
    return raw
      .split(/[,\s]+/)
      .filter(Boolean)
      .includes(householdId);
  }
  const home = mothershipHomeHouseholdId(db);
  return Boolean(home && home === householdId);
}

/**
 * Which setup card to lead with. `ATA_LAN_PUSH=0` (cloud) always download.
 * A successful one-tap on this adapter wins; a failed reachability check
 * pins Download even for the home household.
 */
export function ataSetupMode(opts: {
  lanPushEnabled: boolean;
  householdIsHome: boolean;
  lanPushOk: 0 | 1 | null;
}): AtaSetupMode {
  if (!opts.lanPushEnabled) return "download";
  if (opts.lanPushOk === 1) return "lan";
  if (opts.lanPushOk === 0) return "download";
  return opts.householdIsHome ? "lan" : "download";
}

export function ataSetupModeForDevice(db: Database.Database, ata: AtaDevice): AtaSetupMode {
  const line = db.prepare(`SELECT household_id FROM lines WHERE id = ?`).get(ata.line_id) as
    | { household_id: string }
    | undefined;
  return ataSetupMode({
    lanPushEnabled: ataLanPushEnabled(),
    householdIsHome: line ? householdUsesLanAtaSetup(db, line.household_id) : false,
    lanPushOk: lanPushOkFromRow(ata.lan_push_ok),
  });
}

/** True only when one-tap is the lead path for this adapter (never invited-only). */
export function ataLanPushAvailableForDevice(db: Database.Database, ata: AtaDevice): boolean {
  return ataSetupModeForDevice(db, ata) === "lan";
}
