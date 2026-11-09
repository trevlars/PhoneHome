export type PlanId = "family" | "extended";

export type PlanEntitlements = {
  plan: PlanId;
  maxPods: number;
  warnPods: number;
  maxLines: number;
  warnLines: number;
  iosPush: boolean;
  graceDays: number;
};

/** Pilot list prices (USD). Stripe is source of truth after create-stripe-prices. */
export const PLAN_LIST_PRICES_USD: Record<PlanId, number> = {
  family: 39,
  extended: 69,
};

export const PLANS: Record<PlanId, PlanEntitlements> = {
  family: {
    plan: "family",
    maxPods: 25,
    warnPods: 15,
    maxLines: 150,
    warnLines: 100,
    iosPush: true,
    graceDays: 7,
  },
  extended: {
    plan: "extended",
    maxPods: 50,
    warnPods: 25,
    maxLines: 250,
    warnLines: 150,
    iosPush: true,
    graceDays: 7,
  },
};

export function isPlanId(value: string): value is PlanId {
  return value === "family" || value === "extended";
}

export function priceIdForPlan(plan: PlanId): string | null {
  const envKey = plan === "family" ? "STRIPE_PRICE_FAMILY" : "STRIPE_PRICE_EXTENDED";
  const priceId = String(process.env[envKey] || "").trim();
  return priceId || null;
}

export function planForPrice(priceId: string): PlanEntitlements | null {
  const family = String(process.env.STRIPE_PRICE_FAMILY || "").trim();
  const extended = String(process.env.STRIPE_PRICE_EXTENDED || "").trim();
  if (priceId && priceId === family) return PLANS.family;
  if (priceId && priceId === extended) return PLANS.extended;
  return null;
}
