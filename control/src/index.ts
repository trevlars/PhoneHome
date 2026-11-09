import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import {
  createCheckoutSession,
  createHostLicenseCheckout,
  processStripeEvent,
  stripeClient,
} from "./billing.js";
import {
  activateHostLicenseRow,
  authenticateInstance,
  createHostLicenseCheckoutRow,
  createInstance,
  getInstanceEntitlements,
  hostLicenseByCheckoutSession,
  hostReferrerByCode,
  hostReferrerByInstance,
  ensureHostReferrerForInstance,
  backfillHostReferrers,
  latestHostLicenseForInstance,
  latestOrganizationSubscription,
  listInstances,
  openControlDb,
  setInstanceEntitlements,
  updateInstanceProvisioning,
  upsertHostReferrer,
  type ControlDb,
} from "./db.js";
import {
  hostLicenseAnnualPriceId,
  hostLicensePrivateKey,
  issueAnnualLicensePayload,
  referralCreditCents,
  signHostLicense,
  spinoffPromoCode,
} from "./hostLicenseSign.js";
import { isPlanId, PLAN_LIST_PRICES_USD, PLANS, planForPrice, priceIdForPlan } from "./plans.js";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = String(process.env.CONTROL_ADMIN_TOKEN || "");
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (expected.length < 24 || !safeEqual(supplied, expected)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

function instanceAuth(db: ControlDb) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const instanceId = String(req.headers["x-phonehome-instance-id"] || req.params.id || "").trim();
    const secret = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!instanceId || !secret || !authenticateInstance(db, instanceId, secret)) {
      res.status(401).json({ error: "Invalid instance credentials" });
      return;
    }
    next();
  };
}

export function createControlApp(db: ControlDb) {
  const app = express();
  app.disable("x-powered-by");
  // Storefront (Pages / mothership) may call from another origin.
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });

  app.post(
    "/v1/webhooks/stripe",
    express.raw({ type: "application/json", limit: "256kb" }),
    async (req, res) => {
      try {
        const signature = String(req.headers["stripe-signature"] || "");
        const secret = String(process.env.STRIPE_WEBHOOK_SECRET || "");
        if (!signature || !secret) return res.status(400).json({ error: "Webhook not configured" });
        const stripe = stripeClient();
        const event = stripe.webhooks.constructEvent(req.body, signature, secret);
        const processed = await processStripeEvent(db, stripe, event);
        res.json({ received: true, processed });
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : "Webhook failed" });
      }
    }
  );

  app.use(express.json({ limit: "64kb" }));
  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "phonehome-control" });
  });

  app.get("/v1/plans", (_req, res) => {
    res.json({
      plans: (Object.keys(PLANS) as Array<keyof typeof PLANS>).map((id) => ({
        id,
        ...PLANS[id],
        list_price_usd: PLAN_LIST_PRICES_USD[id],
        checkout_ready: Boolean(priceIdForPlan(id)),
      })),
      invite_required: Boolean(String(process.env.CHECKOUT_INVITE_TOKEN || "").trim()),
    });
  });

  app.post("/v1/checkout/session", async (req, res) => {
    try {
      const inviteExpected = String(process.env.CHECKOUT_INVITE_TOKEN || "").trim();
      if (inviteExpected) {
        const invite = String(req.body?.invite || req.headers["x-phonehome-invite"] || "").trim();
        if (!invite || !safeEqual(invite, inviteExpected)) {
          return res.status(403).json({ error: "Valid pilot invite required" });
        }
      }
      const email = String(req.body?.email || "").trim();
      const planRaw = String(req.body?.plan || "").trim().toLowerCase();
      let priceId = String(req.body?.priceId || "").trim();
      if (!priceId && isPlanId(planRaw)) {
        priceId = priceIdForPlan(planRaw) || "";
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return res.status(400).json({ error: "Valid email required" });
      }
      if (!priceId) return res.status(400).json({ error: "plan or priceId required" });
      const url = await createCheckoutSession(stripeClient(), {
        email,
        priceId,
        instanceName: String(req.body?.instanceName || ""),
      });
      res.json({ url });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Checkout failed" });
    }
  });

  app.post("/v1/host-license/checkout", async (req, res) => {
    try {
      const email = String(req.body?.email || "").trim();
      const instanceId = String(req.body?.instanceId || req.body?.instance_id || "").trim();
      const promoCode = String(req.body?.promoCode || req.body?.promo || "").trim();
      const referralCode = String(req.body?.referralCode || req.body?.ref || "").trim();
      const source = String(req.body?.source || "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return res.status(400).json({ error: "Valid email required" });
      }
      if (!instanceId) return res.status(400).json({ error: "instanceId required" });
      const url = await createHostLicenseCheckout(db, stripeClient(), {
        email,
        instanceId,
        promoCode,
        referralCode,
        source,
      });
      res.json({ url });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Checkout failed" });
    }
  });

  app.get("/v1/host-license/session/:sessionId", (req, res) => {
    const row = hostLicenseByCheckoutSession(db, String(req.params.sessionId));
    if (!row?.license_blob) {
      return res.status(404).json({ error: "License not ready yet" });
    }
    const referrer = hostReferrerByInstance(db, row.mothership_instance_id);
    res.json({
      license: row.license_blob,
      expires_at: row.expires_at,
      instance_id: row.mothership_instance_id,
      email: row.owner_email,
      referral_code: referrer?.referral_code || null,
    });
  });

  /** Public lookup of a host's shareable referral code (no secrets). */
  app.get("/v1/host-license/referral", (req, res) => {
    const instanceId = String(req.query.instanceId || req.query.instance_id || "").trim();
    const code = String(req.query.code || req.query.ref || "").trim().toUpperCase();
    if (instanceId) {
      const row =
        hostReferrerByInstance(db, instanceId) || ensureHostReferrerForInstance(db, instanceId);
      if (!row) return res.status(404).json({ error: "No referral code for this instance yet" });
      return res.json({
        referral_code: row.referral_code,
        instance_id: row.mothership_instance_id,
        share_path: `/buy.html?ref=${encodeURIComponent(row.referral_code)}`,
        share_url: `https://phonehome.pages.dev/buy.html?ref=${encodeURIComponent(row.referral_code)}`,
        referral_credit_usd: referralCreditCents() / 100,
        guest_promo: spinoffPromoCode(),
      });
    }
    if (code) {
      const row = hostReferrerByCode(db, code);
      if (!row) return res.status(404).json({ error: "Unknown referral code" });
      return res.json({
        referral_code: row.referral_code,
        valid: true,
        guest_promo: spinoffPromoCode(),
        referral_credit_usd: referralCreditCents() / 100,
      });
    }
    return res.status(400).json({ error: "instanceId or code required" });
  });

  app.get("/v1/host-license/product", (_req, res) => {
    res.json({
      sku: "host_license",
      list_price_usd: 25,
      spinoff_promo: spinoffPromoCode(),
      spinoff_first_year_usd: 20,
      referral_credit_usd: referralCreditCents() / 100,
      interval: "year",
      trial_days: 30,
      checkout_ready: Boolean(hostLicenseAnnualPriceId() && process.env.HOST_LICENSE_PRIVATE_KEY),
    });
  });

  /**
   * Free / ops path: issue a signed host license without Stripe (admin token).
   * Use for lab soak + until Stripe test keys are pasted.
   */
  app.post("/v1/admin/host-license/issue", adminAuth, (req, res) => {
    try {
      const pem = hostLicensePrivateKey();
      if (!pem) return res.status(503).json({ error: "HOST_LICENSE_PRIVATE_KEY not configured" });
      const instanceId = String(req.body?.instanceId || req.body?.instance_id || "").trim();
      const email = String(req.body?.email || "ops@phonehome.local").trim().toLowerCase();
      if (!instanceId) return res.status(400).json({ error: "instanceId required" });
      if (!/^phinst_[a-f0-9]{16,}$/i.test(instanceId) && instanceId !== "*") {
        return res.status(400).json({ error: "Valid mothership instance id required (phinst_…)" });
      }
      const prior = latestHostLicenseForInstance(db, instanceId);
      const extendFromExpMs = prior?.expires_at ? Date.parse(prior.expires_at) : null;
      const stripeCustomerId =
        prior?.stripe_customer_id && !prior.stripe_customer_id.startsWith("admin_")
          ? prior.stripe_customer_id
          : `admin_${instanceId}`;
      const referrer = upsertHostReferrer(db, {
        mothershipInstanceId: instanceId,
        stripeCustomerId,
        ownerEmail: email || prior?.owner_email || "ops@phonehome.local",
      });
      const payload = issueAnnualLicensePayload({
        instanceId,
        email: email || prior?.owner_email || "ops@phonehome.local",
        referralCode: referrer.referral_code,
        extendFromExpMs: Number.isFinite(extendFromExpMs as number) ? extendFromExpMs : null,
      });
      const blob = signHostLicense(payload, pem);
      const sessionId = `admin_${crypto.randomBytes(12).toString("hex")}`;
      createHostLicenseCheckoutRow(db, {
        mothershipInstanceId: instanceId,
        ownerEmail: email || prior?.owner_email || "ops@phonehome.local",
        stripeCheckoutSessionId: sessionId,
      });
      activateHostLicenseRow(db, {
        checkoutSessionId: sessionId,
        stripeCustomerId,
        stripeSubscriptionId: prior?.stripe_subscription_id || null,
        licenseBlob: blob,
        expiresAt: new Date(payload.exp * 1000).toISOString(),
      });
      res.json({
        license: blob,
        expires_at: new Date(payload.exp * 1000).toISOString(),
        instance_id: instanceId,
        email: email || prior?.owner_email || "ops@phonehome.local",
        session_id: sessionId,
        referral_code: referrer.referral_code,
      });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Issue failed" });
    }
  });

  /** Create missing referral codes for already-active host licenses. */
  app.post("/v1/admin/host-license/backfill-referrals", adminAuth, (_req, res) => {
    const result = backfillHostReferrers(db);
    res.json(result);
  });

  app.get("/v1/admin/instances", adminAuth, (req, res) => {
    const status = String(req.query.status || "").trim() || undefined;
    res.json({ instances: listInstances(db, status) });
  });

  app.post("/v1/admin/instances", adminAuth, (req, res) => {
    try {
      const organizationId = String(req.body?.organizationId || "").trim();
      const subscription = latestOrganizationSubscription(db, organizationId);
      if (!subscription || !["active", "trialing", "past_due"].includes(subscription.status)) {
        return res.status(409).json({ error: "Organization has no provisionable subscription" });
      }
      const plan = planForPrice(subscription.stripe_price_id);
      if (!plan) return res.status(409).json({ error: "Subscription plan is not configured" });
      const instance = createInstance(db, {
        organizationId,
        name: String(req.body?.name || "Family Mothership"),
        publicBaseUrl: String(req.body?.publicBaseUrl || "") || null,
      });
      setInstanceEntitlements(db, instance.id, plan);
      // Secret is deliberately returned once for the VPS secret store.
      res.status(201).json(instance);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Provisioning failed" });
    }
  });

  app.patch("/v1/admin/instances/:id", adminAuth, (req, res) => {
    const status = String(req.body?.status || "");
    if (!["pending", "active", "suspended", "deleted"].includes(status)) {
      return res.status(400).json({ error: "Invalid instance status" });
    }
    const updated = updateInstanceProvisioning(db, String(req.params.id), {
      status: status as "pending" | "active" | "suspended" | "deleted",
      publicBaseUrl: String(req.body?.publicBaseUrl || "") || null,
    });
    if (!updated) return res.status(404).json({ error: "Instance not found" });
    res.json({ ok: true });
  });

  app.get("/v1/instances/:id/entitlements", instanceAuth(db), (req, res) => {
    const row = getInstanceEntitlements(db, String(req.params.id));
    if (!row) return res.status(404).json({ error: "Instance not found" });
    res.json({
      instance_id: row.instance_id,
      status: row.status,
      subscription_status: row.subscription_status,
      entitlements: {
        plan: row.plan,
        max_pods: row.max_pods,
        warn_pods: row.warn_pods,
        max_lines: row.max_lines,
        warn_lines: row.warn_lines,
        ios_push: Boolean(row.ios_push),
        grace_days: row.grace_days,
      },
      current_period_end: row.current_period_end,
      updated_at: row.updated_at,
    });
  });

  app.post("/v1/admin/portal", adminAuth, async (req, res) => {
    try {
      const organizationId = String(req.body?.organizationId || "").trim();
      const subscription = latestOrganizationSubscription(db, organizationId);
      if (!subscription?.stripe_customer_id) return res.status(404).json({ error: "Customer not found" });
      const returnUrl = String(process.env.STRIPE_PORTAL_RETURN_URL || "").trim();
      const session = await stripeClient().billingPortal.sessions.create({
        customer: subscription.stripe_customer_id,
        return_url: returnUrl,
      });
      res.json({ url: session.url });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Portal failed" });
    }
  });

  return app;
}

const isMain = Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
if (isMain) {
  const dataDir = String(process.env.CONTROL_DATA_DIR || path.resolve("control-data"));
  fs.mkdirSync(dataDir, { recursive: true });
  const db = openControlDb(path.join(dataDir, "control.db"));
  const port = Number(process.env.PORT || 8791);
  createControlApp(db).listen(port, "0.0.0.0", () => {
    console.log(`[control] listening on :${port}`);
  });
}
