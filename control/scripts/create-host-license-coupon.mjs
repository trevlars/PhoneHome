#!/usr/bin/env node
/**
 * Create Stripe $5-off-once coupon + OWNMS5 promotion code for host-license spin-off.
 *
 *   STRIPE_SECRET_KEY=sk_live_… node control/scripts/create-host-license-coupon.mjs
 */
import Stripe from "stripe";

const key = String(process.env.STRIPE_SECRET_KEY || "").trim();
if (!key) {
  console.error("STRIPE_SECRET_KEY is required");
  process.exit(1);
}

const CODE = String(process.env.HOST_LICENSE_SPINOFF_PROMO || "OWNMS5").trim().toUpperCase();
const stripe = new Stripe(key);
const mode = key.startsWith("sk_live_") || key.startsWith("rk_live_") ? "live" : "test";

const existing = await stripe.promotionCodes.list({ code: CODE, limit: 1 });
if (existing.data[0]) {
  console.log(`# Stripe mode: ${mode}`);
  console.log(`# promo already exists: ${existing.data[0].id} code=${CODE}`);
  console.log(`HOST_LICENSE_SPINOFF_PROMO=${CODE}`);
  process.exit(0);
}

const coupon = await stripe.coupons.create({
  amount_off: 500,
  currency: "usd",
  duration: "once",
  name: "PhoneHome — $5 off first year",
  metadata: {
    phonehome_offer: "spinoff_first_year",
    seller_of_record: "the operator",
  },
});

const promo = await stripe.promotionCodes.create({
  promotion: { type: "coupon", coupon: coupon.id },
  code: CODE,
  active: true,
  metadata: {
    phonehome_offer: "spinoff_first_year",
  },
});

console.log(`# Stripe mode: ${mode}`);
console.log(`# coupon ${coupon.id} → promo ${promo.id}`);
console.log(`HOST_LICENSE_SPINOFF_PROMO=${CODE}`);
