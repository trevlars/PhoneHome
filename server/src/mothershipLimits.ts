/**
 * Mothership scale limits — keeps self-hosted instances family-sized.
 * Pod = household row; line = softphone/ATA line on this server.
 * Lines are what load the server, so self-hosted caps lines only; a Pod cap
 * applies only when MOTHERSHIP_MAX_PODS or a managed plan sets one.
 */
import type Database from "better-sqlite3";
import { getManagedEntitlements } from "./managedEntitlements.js";

export const DEFAULT_MAX_LINES = 50;
export const DEFAULT_WARN_LINES = 40;

export type MothershipLimits = {
  maxPods: number | null;
  warnPods: number | null;
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

function readLimit<T extends number | null>(name: string, fallback: T): number | T {
  const raw = (process.env[name] || "").trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getMothershipLimits(): MothershipLimits {
  const managed = getManagedEntitlements();
  const maxPods = readLimit("MOTHERSHIP_MAX_PODS", managed?.maxPods ?? null);
  const warnPodsRaw = readLimit("MOTHERSHIP_WARN_PODS", managed?.warnPods ?? null);
  const warnPods =
    warnPodsRaw == null ? null : maxPods == null ? warnPodsRaw : Math.min(maxPods, warnPodsRaw);
  const maxLines = readLimit("MOTHERSHIP_MAX_LINES", managed?.maxLines ?? DEFAULT_MAX_LINES);
  const warnLines = Math.min(
    maxLines,
    readLimit("MOTHERSHIP_WARN_LINES", managed?.warnLines ?? DEFAULT_WARN_LINES)
  );
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
    atPodLimit: limits.maxPods != null && podCount >= limits.maxPods,
    atLineLimit: lineCount >= limits.maxLines,
    warnPodsReached: limits.warnPods != null && podCount >= limits.warnPods,
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
