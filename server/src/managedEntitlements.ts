import type { MothershipLimits } from "./mothershipLimits.js";

export type ManagedEntitlements = MothershipLimits & {
  plan: string;
  iosPush: boolean;
  graceDays: number;
  instanceStatus: string;
  subscriptionStatus: string;
  refreshedAt: string;
};

let cached: ManagedEntitlements | null = null;

export function getManagedEntitlements(): ManagedEntitlements | null {
  return cached;
}

export function setManagedEntitlements(value: ManagedEntitlements | null): void {
  cached = value;
}

export async function refreshManagedEntitlements(): Promise<ManagedEntitlements | null> {
  const base = String(process.env.CONTROL_PLANE_URL || "").trim().replace(/\/+$/, "");
  const instanceId = String(process.env.MOTHERSHIP_INSTANCE_ID || "").trim();
  const secret = String(process.env.MOTHERSHIP_INSTANCE_SECRET || "");
  if (!base || !instanceId || secret.length < 24) return cached;
  if (!/^https:\/\//i.test(base) && process.env.NODE_ENV === "production") {
    throw new Error("CONTROL_PLANE_URL must use HTTPS in production");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(
      `${base}/v1/instances/${encodeURIComponent(instanceId)}/entitlements`,
      {
        headers: {
          authorization: `Bearer ${secret}`,
          "x-phonehome-instance-id": instanceId,
        },
        signal: controller.signal,
      }
    );
    if (!response.ok) throw new Error(`control-plane-http-${response.status}`);
    const body = (await response.json()) as {
      status?: string;
      subscription_status?: string;
      entitlements?: Record<string, unknown>;
    };
    const e = body.entitlements || {};
    const next: ManagedEntitlements = {
      plan: String(e.plan || "managed"),
      maxPods: positiveInt(e.max_pods, null),
      warnPods: positiveInt(e.warn_pods, null),
      maxLines: positiveInt(e.max_lines, 50),
      warnLines: positiveInt(e.warn_lines, 40),
      iosPush: Boolean(e.ios_push),
      graceDays: Math.max(0, Math.min(90, Number(e.grace_days) || 7)),
      instanceStatus: String(body.status || "unknown"),
      subscriptionStatus: String(body.subscription_status || "unknown"),
      refreshedAt: new Date().toISOString(),
    };
    if (next.warnPods != null && next.maxPods != null) {
      next.warnPods = Math.min(next.warnPods, next.maxPods);
    }
    next.warnLines = Math.min(next.warnLines, next.maxLines);
    cached = next;
    return next;
  } finally {
    clearTimeout(timer);
  }
}

function positiveInt<T extends number | null>(value: unknown, fallback: T): number | T {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
