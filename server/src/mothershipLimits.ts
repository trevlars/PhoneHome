/**
 * Mothership scale limits — keeps self-hosted instances family-sized.
 * Pod = household row; line = softphone/ATA line on this server.
 */
import type Database from "better-sqlite3";

export type MothershipLimits = {
  maxPods: number;
  warnPods: number;
  maxLines: number;
  warnLines: number;
};

export type MothershipStats = MothershipLimits & {
  podCount: number;
  lineCount: number;
  atPodLimit: boolean;
  atLineLimit: boolean;
  warnPodsReached: boolean;
  warnLinesReached: boolean;
};

function readLimit(name: string, fallback: number): number {
  const raw = (process.env[name] || "").trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getMothershipLimits(): MothershipLimits {
  const maxPods = readLimit("MOTHERSHIP_MAX_PODS", 50);
  const warnPods = Math.min(maxPods, readLimit("MOTHERSHIP_WARN_PODS", 25));
  const maxLines = readLimit("MOTHERSHIP_MAX_LINES", 250);
  const warnLines = Math.min(maxLines, readLimit("MOTHERSHIP_WARN_LINES", 150));
  return { maxPods, warnPods, maxLines, warnLines };
}

export function countPods(db: Database.Database): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM households`).get() as { n: number };
  return row.n;
}

export function countLines(db: Database.Database): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM lines`).get() as { n: number };
  return row.n;
}

export function getMothershipStats(db: Database.Database): MothershipStats {
  const limits = getMothershipLimits();
  const podCount = countPods(db);
  const lineCount = countLines(db);
  return {
    ...limits,
    podCount,
    lineCount,
    atPodLimit: podCount >= limits.maxPods,
    atLineLimit: lineCount >= limits.maxLines,
    warnPodsReached: podCount >= limits.warnPods,
    warnLinesReached: lineCount >= limits.warnLines,
  };
}

export function assertMothershipCanAddPod(db: Database.Database): void {
  const stats = getMothershipStats(db);
  if (stats.atPodLimit) {
    throw new Error(
      `This Mothership is full (${stats.podCount}/${stats.maxPods} Pods). Start another Mothership for a new branch of the family.`
    );
  }
}

export function assertMothershipCanAddLine(db: Database.Database): void {
  const stats = getMothershipStats(db);
  if (stats.atLineLimit) {
    throw new Error(
      `This Mothership has reached its line limit (${stats.lineCount}/${stats.maxLines}). Add a new Mothership or raise MOTHERSHIP_MAX_LINES on the host.`
    );
  }
}
