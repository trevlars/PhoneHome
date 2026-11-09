#!/usr/bin/env node
/**
 * Create live (or test) Stripe Products + recurring Prices for Managed Mothership.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_... node control/scripts/create-stripe-prices.mjs
 *
 * Optional overrides:
 *   FAMILY_USD=39 EXTENDED_USD=69
 *
 * Prints env lines to paste into deploy/managed-services/.env
 */
import Stripe from "stripe";

const key = String(process.env.STRIPE_SECRET_KEY || "").trim();
if (!key) {
  console.error("STRIPE_SECRET_KEY is required");
  process.exit(1);
}

const familyUsd = Number(process.env.FAMILY_USD || 39);
const extendedUsd = Number(process.env.EXTENDED_USD || 69);
if (!Number.isFinite(familyUsd) || familyUsd < 1 || !Number.isFinite(extendedUsd) || extendedUsd < 1) {
  console.error("FAMILY_USD and EXTENDED_USD must be positive numbers");
  process.exit(1);
}

const stripe = new Stripe(key);

async function ensurePlan({ name, description, lookupKey, usd }) {
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], expand: ["data.product"], limit: 1 });
  if (existing.data[0]) {
    return existing.data[0];
  }
  const product = await stripe.products.create({
    name,
    description,
    metadata: { phonehome_plan: lookupKey.replace("phonehome_managed_", "") },
  });
  return stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: Math.round(usd * 100),
    recurring: { interval: "month" },
    lookup_key: lookupKey,
    metadata: { phonehome_plan: lookupKey.replace("phonehome_managed_", "") },
  });
}

const family = await ensurePlan({
  name: "PhoneHome Managed Mothership — Family",
  description: "Isolated cloud Mothership for one extended family (up to 25 pods / 150 lines).",
  lookupKey: "phonehome_managed_family",
  usd: familyUsd,
});
const extended = await ensurePlan({
  name: "PhoneHome Managed Mothership — Extended",
  description: "Isolated cloud Mothership for a larger family network (up to 50 pods / 250 lines).",
  lookupKey: "phonehome_managed_extended",
  usd: extendedUsd,
});

const mode = key.startsWith("sk_live_") ? "live" : key.startsWith("sk_test_") ? "test" : "unknown";
console.log(`# Stripe mode: ${mode}`);
console.log(`STRIPE_PRICE_FAMILY=${family.id}`);
console.log(`STRIPE_PRICE_EXTENDED=${extended.id}`);
console.log(`# Family $${familyUsd}/mo → ${family.id}`);
console.log(`# Extended $${extendedUsd}/mo → ${extended.id}`);
