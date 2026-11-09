#!/usr/bin/env node
/**
 * Create Stripe Product + $25/year Price for self-host host license.
 *
 * Usage (test — free):
 *   STRIPE_SECRET_KEY=sk_test_... node control/scripts/create-host-license-price.mjs
 *
 * Usage (live — real money):
 *   STRIPE_SECRET_KEY=sk_live_... node control/scripts/create-host-license-price.mjs
 *
 * If an existing lookup-key price has a different unit_amount, creates a new
 * $25 price, moves the lookup key, and deactivates the old price.
 *
 * Prints STRIPE_PRICE_HOST_ANNUAL=price_… to paste into control.env
 */
import Stripe from "stripe";

const key = String(process.env.STRIPE_SECRET_KEY || "").trim();
if (!key) {
  console.error("STRIPE_SECRET_KEY is required (sk_test_… or sk_live_…)");
  process.exit(1);
}

const usd = Number(process.env.HOST_LICENSE_USD || 25);
const wantCents = Math.round(usd * 100);
const lookupKey = "phonehome_host_license_annual";
const stripe = new Stripe(key);

const existing = await stripe.prices.list({
  lookup_keys: [lookupKey],
  expand: ["data.product"],
  limit: 1,
});
let price = existing.data[0];

const productDescription =
  `Annual host license for one self-hosted PhoneHome Mothership ($${usd}/year after a 30-day trial; $5 off first year with OWNMS5). Free iOS/PWA clients. Sold by the operator.`;
const nickname = `Host license — $${usd}/year flat`;
const pricingMeta = `flat_${usd}_inclusive`;

async function ensureProduct() {
  if (price) {
    const productId = typeof price.product === "string" ? price.product : price.product?.id;
    if (productId) {
      await stripe.products.update(productId, {
        description: productDescription,
        statement_descriptor: "PHONEHOME",
        tax_code: "txcd_10000000",
        images: ["https://phonehome.pages.dev/icon-512.png"],
        metadata: {
          phonehome_sku: "host_license",
          seller_of_record: "the operator",
          brand: "PhoneHome",
        },
      });
      return productId;
    }
  }
  const product = await stripe.products.create({
    name: "PhoneHome Mothership — Host license",
    description: productDescription,
    statement_descriptor: "PHONEHOME",
    tax_code: "txcd_10000000",
    images: ["https://phonehome.pages.dev/icon-512.png"],
    metadata: {
      phonehome_sku: "host_license",
      seller_of_record: "the operator",
      brand: "PhoneHome",
    },
  });
  return product.id;
}

if (!price) {
  const productId = await ensureProduct();
  price = await stripe.prices.create({
    product: productId,
    currency: "usd",
    unit_amount: wantCents,
    recurring: { interval: "year" },
    lookup_key: lookupKey,
    tax_behavior: "inclusive",
    nickname,
    metadata: {
      phonehome_sku: "host_license",
      seller_of_record: "the operator",
      pricing: pricingMeta,
    },
  });
} else if (price.unit_amount !== wantCents) {
  const productId = await ensureProduct();
  // unit_amount is immutable — move lookup_key to a new price.
  await stripe.prices.update(price.id, {
    lookup_key: null,
    active: false,
  });
  const oldId = price.id;
  price = await stripe.prices.create({
    product: productId,
    currency: "usd",
    unit_amount: wantCents,
    recurring: { interval: "year" },
    lookup_key: lookupKey,
    tax_behavior: "inclusive",
    nickname,
    metadata: {
      phonehome_sku: "host_license",
      seller_of_record: "the operator",
      pricing: pricingMeta,
      replaces_price: oldId,
    },
  });
  console.log(`# replaced ${oldId} (was ${existing.data[0].unit_amount}¢) with ${price.id} (${wantCents}¢)`);
} else {
  await ensureProduct();
  try {
    await stripe.prices.update(price.id, {
      nickname,
      metadata: {
        phonehome_sku: "host_license",
        seller_of_record: "the operator",
        pricing: pricingMeta,
      },
    });
  } catch (e) {
    console.warn(`# price metadata update skipped: ${e.message || e}`);
  }
  if (price.tax_behavior !== "inclusive") {
    console.warn(
      `# existing price ${price.id} tax_behavior=${price.tax_behavior} (immutable) — create a new inclusive price if customer total must stay flat $${usd}`
    );
  }
}

const mode = key.startsWith("sk_live_") || key.startsWith("rk_live_")
  ? "live"
  : key.startsWith("sk_test_") || key.startsWith("rk_test_")
    ? "test"
    : "unknown";
console.log(`# Stripe mode: ${mode}`);
console.log(`STRIPE_PRICE_HOST_ANNUAL=${price.id}`);
console.log(
  `# $${usd}/year → ${price.id} (product ${typeof price.product === "string" ? price.product : price.product?.id})`
);
