#!/usr/bin/env node
/**
 * Configure Stripe business branding + seller-of-record for PhoneHome.
 *
 * Legal seller: the operator
 *
 * Test mode (sk_test_…): Product, Price, Portal, webhook tighten, file uploads.
 * Live mode (sk_live_…): also Account business_profile, branding logo/colors, statement descriptor.
 *
 * Optional env for Tax (needs LLC address — do not invent):
 *   STRIPE_HEAD_OFFICE_LINE1=…
 *   STRIPE_HEAD_OFFICE_CITY=…
 *   STRIPE_HEAD_OFFICE_STATE=…
 *   STRIPE_HEAD_OFFICE_POSTAL=…
 *   STRIPE_HEAD_OFFICE_COUNTRY=US
 *   STRIPE_SUPPORT_EMAIL=support@example.com
 *   STRIPE_BUSINESS_URL=https://phonehome.pages.dev
 *   STRIPE_LOGO_PATH=web/public/icon-512.png
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_… node control/scripts/configure-stripe-business.mjs
 *   STRIPE_SECRET_KEY=sk_live_… node control/scripts/configure-stripe-business.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const key = String(process.env.STRIPE_SECRET_KEY || "").trim();
if (!key) {
  console.error("STRIPE_SECRET_KEY is required");
  process.exit(1);
}

const mode = key.startsWith("sk_live_") || key.startsWith("rk_live_")
  ? "live"
  : key.startsWith("sk_test_") || key.startsWith("rk_test_")
    ? "test"
    : "unknown";
const stripe = new Stripe(key);

const SELLER = String(process.env.STRIPE_SELLER_NAME || "").trim();
const BRAND = "PhoneHome";
const SUPPORT_EMAIL = String(process.env.STRIPE_SUPPORT_EMAIL || "").trim();
if (!SELLER || !SUPPORT_EMAIL) {
  console.error("Set STRIPE_SELLER_NAME and STRIPE_SUPPORT_EMAIL before configuring Stripe.");
  process.exit(1);
}
const BUSINESS_URL = String(process.env.STRIPE_BUSINESS_URL || "https://phonehome.pages.dev").trim();
const SUPPORT_URL = String(process.env.STRIPE_SUPPORT_URL || `${BUSINESS_URL.replace(/\/$/, "")}/support.html`).trim();
const PRIVACY_URL = String(process.env.STRIPE_PRIVACY_URL || `${BUSINESS_URL.replace(/\/$/, "")}/privacy.html`).trim();
const PRODUCT_IMAGE = `${BUSINESS_URL.replace(/\/$/, "")}/icon-512.png`;
const PRODUCT_DESCRIPTION =
  "Annual host license for one self-hosted PhoneHome Mothership ($25/year after a 30-day trial; $5 off first year with OWNMS5). Free iOS/PWA clients. Sold by the operator.";
const LOGO_PATH = path.resolve(
  process.env.STRIPE_LOGO_PATH || path.join(repoRoot, "web/public/icon-512.png")
);

const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "customer.updated",
];

console.log(`# Stripe configure-stripe-business (${mode})`);
console.log(`# Seller of record: ${SELLER}`);

async function uploadBrandingFile(purpose, name) {
  if (!fs.existsSync(LOGO_PATH)) throw new Error(`Logo not found: ${LOGO_PATH}`);
  const file = await stripe.files.create({
    purpose,
    file: {
      data: fs.readFileSync(LOGO_PATH),
      name,
      type: "image/png",
    },
  });
  console.log(`# uploaded ${purpose} → ${file.id}`);
  return file.id;
}

let logoId = "";
let iconId = "";
try {
  logoId = await uploadBrandingFile("business_logo", "phonehome-logo.png");
  iconId = await uploadBrandingFile("business_icon", "phonehome-icon.png");
} catch (e) {
  console.error("# branding file upload failed:", e.message || e);
}

const products = await stripe.products.list({ limit: 100, active: true });
const hostProducts = products.data.filter(
  (p) =>
    p.metadata?.phonehome_sku === "host_license" ||
    /host license/i.test(p.name) ||
    /mothership/i.test(p.name)
);
if (!hostProducts.length) {
  console.warn("# No PhoneHome products found — run create-host-license-price.mjs first");
} else {
  for (const p of hostProducts) {
    const updated = await stripe.products.update(p.id, {
      name: p.name.includes("Host license") ? p.name : "PhoneHome Mothership — Host license",
      description: PRODUCT_DESCRIPTION,
      statement_descriptor: "PHONEHOME",
      tax_code: "txcd_10000000",
      images: [PRODUCT_IMAGE],
      metadata: {
        ...p.metadata,
        phonehome_sku: p.metadata?.phonehome_sku || "host_license",
        seller_of_record: SELLER,
        brand: BRAND,
      },
    });
    console.log(`# product ${updated.id} tax_code=${updated.tax_code} image=${updated.images?.[0] || ""}`);
  }
}

const prices = await stripe.prices.list({
  lookup_keys: ["phonehome_host_license_annual"],
  limit: 1,
});
if (prices.data[0]) {
  const existing = prices.data[0];
  try {
    const price = await stripe.prices.update(existing.id, {
      nickname: "Host license — $25/year flat",
      metadata: {
        phonehome_sku: "host_license",
        seller_of_record: SELLER,
        pricing: "flat_25_inclusive",
      },
    });
    console.log(`# price ${price.id} unit_amount=${price.unit_amount} tax_behavior=${price.tax_behavior}`);
    if (price.unit_amount !== 2500) {
      console.log("# note: unit_amount is not $25 — run create-host-license-price.mjs to replace the price");
    }
    if (price.tax_behavior !== "inclusive") {
      console.log("# note: tax_behavior is locked on this price; create a new inclusive $25 price if needed");
    }
  } catch (e) {
    console.error("# price metadata update failed:", e.message || e);
  }
}

// Account-level: disable BNPL payment methods
try {
  const pmcs = await stripe.paymentMethodConfigurations.list({ limit: 10 });
  for (const pmc of pmcs.data) {
    await stripe.paymentMethodConfigurations.update(pmc.id, {
      klarna: { display_preference: { preference: "off" } },
      affirm: { display_preference: { preference: "off" } },
      afterpay_clearpay: { display_preference: { preference: "off" } },
      amazon_pay: { display_preference: { preference: "off" } },
      card: { display_preference: { preference: "on" } },
    });
    console.log(`# payment methods ${pmc.id}: BNPL off (Klarna/Affirm/Afterpay/Amazon Pay)`);
  }
} catch (e) {
  console.error("# payment method config update failed:", e.message || e);
}

const configs = await stripe.billingPortal.configurations.list({ limit: 10 });
let portal = configs.data.find((c) => c.is_default) || configs.data[0];
const portalBody = {
  business_profile: {
    headline: `${BRAND} by ${SELLER}`,
    privacy_policy_url: PRIVACY_URL,
    terms_of_service_url: SUPPORT_URL,
  },
  features: {
    customer_update: { enabled: true, allowed_updates: ["email", "address", "tax_id", "name"] },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: {
      enabled: true,
      mode: "at_period_end",
      cancellation_reason: {
        enabled: true,
        options: ["too_expensive", "missing_features", "unused", "switched_service", "other"],
      },
    },
  },
};
portal = portal
  ? await stripe.billingPortal.configurations.update(portal.id, portalBody)
  : await stripe.billingPortal.configurations.create(portalBody);
console.log(`# portal ${portal.id} (default=${portal.is_default})`);

const hooks = await stripe.webhookEndpoints.list({ limit: 20 });
for (const h of hooks.data) {
  if (!/trevlars|phonehome|8443|8791/.test(h.url)) continue;
  const updatedHook = await stripe.webhookEndpoints.update(h.id, {
    enabled_events: WEBHOOK_EVENTS,
    description: "PhoneHome control — host license + renewals",
  });
  console.log(`# webhook ${updatedHook.id} events=${updatedHook.enabled_events.length}`);
}

if (mode === "live") {
  // Standard (non-Connect) accounts: Stripe rejects POST /v1/account on your own
  // account ("only use it on connected accounts"). Set Customer-facing support
  // email in Dashboard → Settings → Public details / Business settings:
  //   https://dashboard.stripe.com/settings/public
  // Expected: support_email=support@example.com
  const body = new URLSearchParams({
    "business_profile[name]": BRAND,
    "business_profile[product_description]":
      "PhoneHome Mothership host licenses — private family calling software sold by the operator.",
    "business_profile[support_email]": SUPPORT_EMAIL,
    "business_profile[url]": BUSINESS_URL,
    "business_profile[support_url]": SUPPORT_URL,
    "business_profile[privacy_policy_url]": PRIVACY_URL,
    "settings[payments][statement_descriptor]": "PHONEHOME",
    "settings[payouts][statement_descriptor]": "PHONEHOME",
    "settings[dashboard][display_name]": BRAND,
    "settings[branding][primary_color]": "#1f6b4a",
    "settings[branding][secondary_color]": "#14201a",
    "company[name]": SELLER,
    business_type: "company",
  });
  if (logoId) body.set("settings[branding][logo]", logoId);
  if (iconId) body.set("settings[branding][icon]", iconId);

  const res = await fetch("https://api.stripe.com/v1/account", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const acct = await res.json();
  if (acct.error) {
    console.error("# account update failed:", acct.error.message);
    console.error(
      `# set support email in Dashboard instead: https://dashboard.stripe.com/settings/public → ${SUPPORT_EMAIL}`
    );
  } else {
    console.log("# account business_profile + branding + company name updated");
    console.log(`# statement_descriptor=${acct.settings?.payments?.statement_descriptor}`);
    console.log(`# branding.logo=${acct.settings?.branding?.logo || "(none)"}`);
    console.log(`# branding.primary_color=${acct.settings?.branding?.primary_color || "(none)"}`);
    console.log(`# support_email=${acct.business_profile?.support_email || "(none)"}`);
  }
} else {
  console.log("# skip Account branding attach (Stripe requires sk_live_ for /v1/account updates)");
  if (logoId || iconId) {
    console.log(`# uploaded files ready — re-run with sk_live_ to attach logo=${logoId} icon=${iconId}`);
  }
  console.log("# or paste logo in Dashboard → Settings → Branding (test/live toggle)");
  console.log("#   https://dashboard.stripe.com/settings/branding");
}

const line1 = String(process.env.STRIPE_HEAD_OFFICE_LINE1 || "").trim();
const city = String(process.env.STRIPE_HEAD_OFFICE_CITY || "").trim();
const state = String(process.env.STRIPE_HEAD_OFFICE_STATE || "").trim();
const postal = String(process.env.STRIPE_HEAD_OFFICE_POSTAL || "").trim();
const country = String(process.env.STRIPE_HEAD_OFFICE_COUNTRY || "US").trim();
if (line1 && city && postal) {
  try {
    const tax = await stripe.tax.settings.update({
      head_office: {
        address: {
          line1,
          city,
          state: state || undefined,
          postal_code: postal,
          country,
        },
      },
      // Inclusive so list price stays a flat $25 to the customer when Tax is on.
      defaults: { tax_behavior: "inclusive" },
    });
    console.log(`# tax settings status=${tax.status}`);
  } catch (e) {
    console.error("# tax settings update failed:", e.message || e);
  }
} else {
  console.log("# tax: head_office not set — export STRIPE_HEAD_OFFICE_* to enable Stripe Tax");
}

console.log("# done");
