/**
 * Mothership operator admin snapshot — pods, lines, health, operators, billing.
 * No secrets (SIP passwords, provision tokens, password hashes).
 */
import type Database from "better-sqlite3";
import {
  defaultSipServer,
  findUserByUsername,
  isChildOnlyAccount,
  publicAta,
  sipHostKind,
} from "./api.js";
import { ataLanPushEnabled } from "./ataSetup.js";
import type { AtaDevice } from "./db.js";
import { freepbxSyncConfigured } from "./freepbxSync.js";
import {
  getMothershipBillingAdminSnapshot,
  getMothershipOperatorRole,
  type AdminCircleKid,
} from "./mothershipBilling.js";
import { getMothershipStats, type MothershipStats } from "./mothershipLimits.js";

export type AdminAtaSipHealth = {
  status: "not_configured" | "online" | "offline" | "unknown" | "waiting";
  registered: boolean;
  reason?: string | null;
  checked_at?: string;
  cached?: boolean;
};

export type AdminLineRow = {
  id: string;
  name: string;
  child_label: string | null;
  mode: string;
  type: string;
  owner_user_id: string;
  owner_display_name: string | null;
  softphone_online: boolean;
  has_ata: boolean;
  ios_push: boolean;
  child_user: { user_id: string; username: string | null; display_name: string } | null;
  ata: {
    sip_extension: string;
    sip_server: string;
    sip_host_kind: "public" | "lan";
    setup_mode: "lan" | "download";
    config_seen: boolean;
    config_downloaded: boolean;
    config_pulled: boolean;
    download_ready: boolean;
    last_provision_at: string | null;
    last_config_download_at: string | null;
    sip?: AdminAtaSipHealth | null;
  } | null;
};

export type AdminParentRow = {
  user_id: string;
  role: string;
  display_name: string;
  username: string | null;
  profile_role: string | null;
  is_operator: boolean;
  operator_role: "owner" | "admin" | null;
};

export type AdminPodRow = {
  id: string;
  name: string;
  owner_user_id: string;
  owner_display_name: string | null;
  created_at: string;
  kill_switch: boolean;
  member_count: number;
  parent_count: number;
  kid_count: number;
  line_count: number;
  parents: AdminParentRow[];
  lines: AdminLineRow[];
  circles: AdminCircleKid[];
};

export type MothershipAdminSnapshot = {
  settings: ReturnType<typeof getMothershipBillingAdminSnapshot>["settings"];
  operators: ReturnType<typeof getMothershipBillingAdminSnapshot>["operators"];
  summary: ReturnType<typeof getMothershipBillingAdminSnapshot>["summary"];
  capacity: MothershipStats;
  server: {
    public_base_url: string | null;
    sip_public_host: string;
    ata_lan_push: boolean;
    bridge_configured: boolean;
    freepbx_sync_configured: boolean;
  };
  health: {
    softphone_online: number;
    softphone_total: number;
    ata_online: number;
    ata_offline: number;
    ata_waiting: number;
    ata_unknown: number;
    ata_not_configured: number;
    ata_total: number;
    ios_push_lines: number;
  };
  integrity: {
    orphan_guardians: number;
    orphan_allowlist_targets: number;
    duplicate_speed_dials: number;
  };
  pods: AdminPodRow[];
};

function publicBaseUrlFromEnv(): string | null {
  const raw = (process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  return raw || null;
}

function bridgeConfigured(): boolean {
  return Boolean((process.env.BRIDGE_SECRET || "").trim());
}

function integrityCounts(db: Database.Database) {
  const orphan_guardians = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM child_guardians g
         WHERE NOT EXISTS (SELECT 1 FROM lines l WHERE l.id = g.line_id)`
      )
      .get() as { n: number }
  ).n;
  const orphan_allowlist_targets = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM allowlist a
         WHERE NOT EXISTS (SELECT 1 FROM lines l WHERE l.id = a.target_line_id)`
      )
      .get() as { n: number }
  ).n;
  const duplicate_speed_dials = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT household_id, speed_dial FROM allowlist
           WHERE speed_dial IS NOT NULL AND TRIM(CAST(speed_dial AS TEXT)) != ''
           GROUP BY household_id, speed_dial
           HAVING COUNT(*) > 1
         )`
      )
      .get() as { n: number }
  ).n;
  return { orphan_guardians, orphan_allowlist_targets, duplicate_speed_dials };
}

function lineHasIosPush(db: Database.Database, lineId: string): boolean {
  return Boolean(
    db.prepare(`SELECT 1 FROM push_devices WHERE line_id = ? LIMIT 1`).get(lineId)
  );
}

function buildAdminLine(
  db: Database.Database,
  row: {
    id: string;
    name: string;
    child_label: string | null;
    mode: string;
    type: string;
    owner_user_id: string;
    owner_display_name: string | null;
    online: number;
    child_user_id: string | null;
  },
  ata: AtaDevice | null,
  sipByLine?: Map<string, AdminAtaSipHealth>
): AdminLineRow {
  let child_user: AdminLineRow["child_user"] = null;
  if (row.child_user_id) {
    const cu = db
      .prepare(`SELECT id, username, display_name FROM users WHERE id = ?`)
      .get(row.child_user_id) as
      | { id: string; username: string | null; display_name: string }
      | undefined;
    if (cu) {
      child_user = {
        user_id: cu.id,
        username: cu.username,
        display_name: cu.display_name,
      };
    }
  }

  let ataOut: AdminLineRow["ata"] = null;
  if (ata) {
    const pub = publicAta(ata, db);
    ataOut = {
      sip_extension: pub.sip_extension,
      sip_server: pub.sip_server,
      sip_host_kind: pub.sip_host_kind || sipHostKind(pub.sip_server),
      setup_mode: pub.setup_mode,
      config_seen: pub.config_seen,
      config_downloaded: pub.config_downloaded,
      config_pulled: pub.config_pulled,
      download_ready: pub.download_ready,
      last_provision_at: pub.last_provision_at,
      last_config_download_at: pub.last_config_download_at,
      sip: sipByLine?.get(row.id) ?? null,
    };
  }

  return {
    id: row.id,
    name: row.name,
    child_label: row.child_label,
    mode: row.mode || "parent",
    type: row.type,
    owner_user_id: row.owner_user_id,
    owner_display_name: row.owner_display_name,
    softphone_online: Boolean(row.online),
    has_ata: Boolean(ata),
    ios_push: lineHasIosPush(db, row.id),
    child_user,
    ata: ataOut,
  };
}

function buildAdminPod(
  db: Database.Database,
  pod: {
    id: string;
    name: string;
    owner_user_id: string;
    created_at?: string;
    kill_switch?: number;
  },
  circles: AdminCircleKid[],
  sipByLine?: Map<string, AdminAtaSipHealth>
): AdminPodRow {
  const owner = db
    .prepare(`SELECT display_name FROM users WHERE id = ?`)
    .get(pod.owner_user_id) as { display_name: string } | undefined;

  const members = db
    .prepare(
      `SELECT hm.user_id, hm.role, u.display_name, u.username, u.profile_role
       FROM household_members hm
       JOIN users u ON u.id = hm.user_id
       WHERE hm.household_id = ?
       ORDER BY hm.role = 'owner' DESC, u.display_name ASC`
    )
    .all(pod.id) as {
    user_id: string;
    role: string;
    display_name: string;
    username: string | null;
    profile_role: string | null;
  }[];

  const parents: AdminParentRow[] = members
    .filter((m) => !isChildOnlyAccount(db, m.user_id))
    .map((m) => {
      const opRole = getMothershipOperatorRole(db, m.user_id);
      return {
        user_id: m.user_id,
        role: m.role,
        display_name: m.display_name,
        username: m.username,
        profile_role: m.profile_role,
        is_operator: Boolean(opRole),
        operator_role: opRole,
      };
    });

  const lineRows = db
    .prepare(
      `SELECT l.id, l.name, l.child_label, IFNULL(l.mode, 'parent') AS mode, l.type,
              l.owner_user_id, l.online, l.child_user_id, u.display_name AS owner_display_name
       FROM lines l
       LEFT JOIN users u ON u.id = l.owner_user_id
       WHERE l.household_id = ?
       ORDER BY
         CASE IFNULL(l.mode, 'parent')
           WHEN 'child' THEN 0
           WHEN 'parent' THEN 1
           ELSE 2
         END,
         l.created_at ASC`
    )
    .all(pod.id) as {
    id: string;
    name: string;
    child_label: string | null;
    mode: string;
    type: string;
    owner_user_id: string;
    owner_display_name: string | null;
    online: number;
    child_user_id: string | null;
  }[];

  const atas = db
    .prepare(`SELECT * FROM ata_devices WHERE line_id IN (SELECT id FROM lines WHERE household_id = ?)`)
    .all(pod.id) as AtaDevice[];
  const ataByLine = new Map(atas.map((a) => [a.line_id, a]));

  const lines = lineRows.map((r) => buildAdminLine(db, r, ataByLine.get(r.id) || null, sipByLine));
  const kid_count = lines.filter((l) => l.mode === "child").length;

  const hh = db
    .prepare(`SELECT created_at, kill_switch FROM households WHERE id = ?`)
    .get(pod.id) as { created_at: string; kill_switch: number } | undefined;

  return {
    id: pod.id,
    name: pod.name,
    owner_user_id: pod.owner_user_id,
    owner_display_name: owner?.display_name ?? null,
    created_at: hh?.created_at || pod.created_at || "",
    kill_switch: Boolean(hh?.kill_switch ?? pod.kill_switch),
    member_count: members.length,
    parent_count: parents.length,
    kid_count,
    line_count: lines.length,
    parents,
    lines,
    circles,
  };
}

function summarizeHealth(pods: AdminPodRow[]) {
  let softphone_online = 0;
  let softphone_total = 0;
  let ata_online = 0;
  let ata_offline = 0;
  let ata_waiting = 0;
  let ata_unknown = 0;
  let ata_not_configured = 0;
  let ata_total = 0;
  let ios_push_lines = 0;

  for (const pod of pods) {
    for (const line of pod.lines) {
      softphone_total += 1;
      if (line.softphone_online) softphone_online += 1;
      if (line.ios_push) ios_push_lines += 1;
      if (!line.has_ata) continue;
      ata_total += 1;
      const st = line.ata?.sip?.status;
      if (st === "online") ata_online += 1;
      else if (st === "offline") ata_offline += 1;
      else if (st === "waiting") ata_waiting += 1;
      else if (st === "not_configured") ata_not_configured += 1;
      else ata_unknown += 1;
    }
  }

  return {
    softphone_online,
    softphone_total,
    ata_online,
    ata_offline,
    ata_waiting,
    ata_unknown,
    ata_not_configured,
    ata_total,
    ios_push_lines,
  };
}

/** List ATA line ids + extensions for live SIP health enrichment. */
export function listAdminAtaTargets(db: Database.Database): { line_id: string; sip_extension: string }[] {
  return db
    .prepare(
      `SELECT line_id, sip_extension FROM ata_devices
       WHERE sip_extension IS NOT NULL AND TRIM(sip_extension) != ''
         AND sip_password IS NOT NULL AND TRIM(sip_password) != ''`
    )
    .all() as { line_id: string; sip_extension: string }[];
}

export function getMothershipAdminSnapshot(
  db: Database.Database,
  opts?: { ataSipByLineId?: Map<string, AdminAtaSipHealth> }
): MothershipAdminSnapshot {
  const billing = getMothershipBillingAdminSnapshot(db);
  const sipByLine = opts?.ataSipByLineId;

  const householdRows = db
    .prepare(
      `SELECT id, name, owner_user_id, created_at, kill_switch
       FROM households ORDER BY name ASC, created_at ASC`
    )
    .all() as {
    id: string;
    name: string;
    owner_user_id: string;
    created_at: string;
    kill_switch: number;
  }[];

  const circlesByPod = new Map<string, AdminCircleKid[]>();
  for (const p of billing.pods) {
    circlesByPod.set(p.id, p.circles || []);
  }

  const pods = householdRows.map((h) =>
    buildAdminPod(db, h, circlesByPod.get(h.id) || [], sipByLine)
  );

  return {
    settings: billing.settings,
    operators: billing.operators,
    summary: billing.summary,
    capacity: getMothershipStats(db),
    server: {
      public_base_url: publicBaseUrlFromEnv(),
      sip_public_host: defaultSipServer(),
      ata_lan_push: ataLanPushEnabled(),
      bridge_configured: bridgeConfigured(),
      freepbx_sync_configured: freepbxSyncConfigured(),
    },
    health: summarizeHealth(pods),
    integrity: integrityCounts(db),
    pods,
  };
}

/** Resolve a parent username to user id for operator add / password reset. */
export function resolveUserIdForAdmin(
  db: Database.Database,
  opts: { userId?: string; username?: string }
): string {
  if (opts.userId) {
    const row = db.prepare(`SELECT id FROM users WHERE id = ?`).get(opts.userId) as
      | { id: string }
      | undefined;
    if (!row) throw new Error("User not found");
    return row.id;
  }
  const username = String(opts.username || "").trim();
  if (!username) throw new Error("username or userId required");
  const user = findUserByUsername(db, username);
  if (!user) throw new Error(`No user with username “${username}”`);
  return user.id;
}
