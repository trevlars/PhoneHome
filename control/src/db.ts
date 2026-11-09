import Database from "better-sqlite3";
import crypto from "node:crypto";
import { nanoid } from "nanoid";
import type { PlanEntitlements } from "./plans.js";

export type ControlDb = Database.Database;

export function openControlDb(path: string): ControlDb {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      stripe_customer_id TEXT UNIQUE,
      owner_email TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mothership_instances (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      public_base_url TEXT,
      instance_secret_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(organization_id) REFERENCES organizations(id)
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      stripe_subscription_id TEXT UNIQUE NOT NULL,
      stripe_price_id TEXT NOT NULL,
      status TEXT NOT NULL,
      current_period_end TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(organization_id) REFERENCES organizations(id)
    );
    CREATE TABLE IF NOT EXISTS entitlements (
      instance_id TEXT PRIMARY KEY,
      plan TEXT NOT NULL,
      max_pods INTEGER NOT NULL,
      warn_pods INTEGER NOT NULL,
      max_lines INTEGER NOT NULL,
      warn_lines INTEGER NOT NULL,
      ios_push INTEGER NOT NULL,
      grace_days INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(instance_id) REFERENCES mothership_instances(id)
    );
    CREATE TABLE IF NOT EXISTS stripe_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      processed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS host_licenses (
      id TEXT PRIMARY KEY,
      mothership_instance_id TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      stripe_checkout_session_id TEXT UNIQUE,
      license_blob TEXT,
      expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS host_referrers (
      referral_code TEXT PRIMARY KEY,
      mothership_instance_id TEXT NOT NULL UNIQUE,
      stripe_customer_id TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS referral_redemptions (
      id TEXT PRIMARY KEY,
      referred_instance_id TEXT NOT NULL UNIQUE,
      referrer_code TEXT NOT NULL,
      checkout_session_id TEXT,
      credited_cents INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(referrer_code) REFERENCES host_referrers(referral_code)
    );
    CREATE INDEX IF NOT EXISTS idx_instances_org ON mothership_instances(organization_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_org ON subscriptions(organization_id);
    CREATE INDEX IF NOT EXISTS idx_host_licenses_instance ON host_licenses(mothership_instance_id);
    CREATE INDEX IF NOT EXISTS idx_host_licenses_email ON host_licenses(owner_email);
    CREATE INDEX IF NOT EXISTS idx_host_referrers_customer ON host_referrers(stripe_customer_id);
  `);
  return db;
}

function nowIso(): string {
  return new Date().toISOString();
}

function secretHash(secret: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(secret, salt, 32);
  return `scrypt:${salt.toString("base64")}:${hash.toString("base64")}`;
}

export function verifySecret(secret: string, encoded: string): boolean {
  const [, salt64, hash64] = encoded.split(":");
  if (!salt64 || !hash64) return false;
  const expected = Buffer.from(hash64, "base64");
  const actual = crypto.scryptSync(secret, Buffer.from(salt64, "base64"), expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function ensureOrganization(
  db: ControlDb,
  opts: { stripeCustomerId: string; ownerEmail: string }
): string {
  const existing = db
    .prepare(`SELECT id FROM organizations WHERE stripe_customer_id = ?`)
    .get(opts.stripeCustomerId) as { id: string } | undefined;
  const now = nowIso();
  if (existing) {
    db.prepare(`UPDATE organizations SET owner_email = ?, updated_at = ? WHERE id = ?`).run(
      opts.ownerEmail.toLowerCase(),
      now,
      existing.id
    );
    return existing.id;
  }
  const id = `org_${nanoid(16)}`;
  db.prepare(
    `INSERT INTO organizations
       (id, stripe_customer_id, owner_email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, opts.stripeCustomerId, opts.ownerEmail.toLowerCase(), now, now);
  return id;
}

export function createInstance(
  db: ControlDb,
  opts: { organizationId: string; name: string; publicBaseUrl?: string | null }
): { id: string; secret: string } {
  const id = `inst_${nanoid(18)}`;
  const secret = crypto.randomBytes(32).toString("base64url");
  const now = nowIso();
  db.prepare(
    `INSERT INTO mothership_instances
       (id, organization_id, name, public_base_url, instance_secret_hash, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).run(
    id,
    opts.organizationId,
    opts.name.trim().slice(0, 80) || "Mothership",
    opts.publicBaseUrl?.trim() || null,
    secretHash(secret),
    now,
    now
  );
  return { id, secret };
}

export function authenticateInstance(db: ControlDb, instanceId: string, secret: string): boolean {
  const row = db
    .prepare(`SELECT instance_secret_hash FROM mothership_instances WHERE id = ? AND status != 'deleted'`)
    .get(instanceId) as { instance_secret_hash: string } | undefined;
  return Boolean(row && verifySecret(secret, row.instance_secret_hash));
}

export function updateInstanceProvisioning(
  db: ControlDb,
  instanceId: string,
  patch: { status: "pending" | "active" | "suspended" | "deleted"; publicBaseUrl?: string | null }
): boolean {
  const info = db
    .prepare(
      `UPDATE mothership_instances
       SET status = ?, public_base_url = COALESCE(?, public_base_url), updated_at = ?
       WHERE id = ?`
    )
    .run(patch.status, patch.publicBaseUrl?.trim() || null, nowIso(), instanceId);
  return Number(info.changes) === 1;
}

export function setInstanceEntitlements(
  db: ControlDb,
  instanceId: string,
  plan: PlanEntitlements
): void {
  db.prepare(
    `INSERT INTO entitlements
       (instance_id, plan, max_pods, warn_pods, max_lines, warn_lines, ios_push, grace_days, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(instance_id) DO UPDATE SET
       plan = excluded.plan,
       max_pods = excluded.max_pods,
       warn_pods = excluded.warn_pods,
       max_lines = excluded.max_lines,
       warn_lines = excluded.warn_lines,
       ios_push = excluded.ios_push,
       grace_days = excluded.grace_days,
       updated_at = excluded.updated_at`
  ).run(
    instanceId,
    plan.plan,
    plan.maxPods,
    plan.warnPods,
    plan.maxLines,
    plan.warnLines,
    plan.iosPush ? 1 : 0,
    plan.graceDays,
    nowIso()
  );
}

export function organizationForCustomer(db: ControlDb, customerId: string): string | null {
  const row = db
    .prepare(`SELECT id FROM organizations WHERE stripe_customer_id = ?`)
    .get(customerId) as { id: string } | undefined;
  return row?.id || null;
}

export function listOrganizationInstanceIds(db: ControlDb, organizationId: string): string[] {
  return (
    db
      .prepare(`SELECT id FROM mothership_instances WHERE organization_id = ? AND status != 'deleted'`)
      .all(organizationId) as { id: string }[]
  ).map((row) => row.id);
}

export function latestOrganizationSubscription(
  db: ControlDb,
  organizationId: string
): { stripe_price_id: string; status: string; stripe_customer_id: string | null } | null {
  const row = db
    .prepare(
      `SELECT s.stripe_price_id, s.status, o.stripe_customer_id
       FROM organizations o
       JOIN subscriptions s ON s.organization_id = o.id
       WHERE o.id = ?
       ORDER BY s.updated_at DESC
       LIMIT 1`
    )
    .get(organizationId) as
    | { stripe_price_id: string; status: string; stripe_customer_id: string | null }
    | undefined;
  return row || null;
}

export function upsertSubscription(
  db: ControlDb,
  opts: {
    organizationId: string;
    stripeSubscriptionId: string;
    stripePriceId: string;
    status: string;
    currentPeriodEnd?: string | null;
  }
): void {
  const now = nowIso();
  db.prepare(
    `INSERT INTO subscriptions
       (id, organization_id, stripe_subscription_id, stripe_price_id, status,
        current_period_end, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(stripe_subscription_id) DO UPDATE SET
       stripe_price_id = excluded.stripe_price_id,
       status = excluded.status,
       current_period_end = excluded.current_period_end,
       updated_at = excluded.updated_at`
  ).run(
    `sub_${nanoid(16)}`,
    opts.organizationId,
    opts.stripeSubscriptionId,
    opts.stripePriceId,
    opts.status,
    opts.currentPeriodEnd || null,
    now,
    now
  );
  // Billing may suspend or unsuspend; never mark a tenant active here — that
  // happens only after the VPS is provisioned (admin PATCH or provisioner).
  if (!["active", "trialing", "past_due"].includes(opts.status)) {
    db.prepare(
      `UPDATE mothership_instances
       SET status = 'suspended', updated_at = ?
       WHERE organization_id = ? AND status != 'deleted'`
    ).run(now, opts.organizationId);
  } else {
    db.prepare(
      `UPDATE mothership_instances
       SET status = 'pending', updated_at = ?
       WHERE organization_id = ? AND status = 'suspended'`
    ).run(now, opts.organizationId);
  }
}

export function listInstances(
  db: ControlDb,
  status?: string
): Array<{
  id: string;
  organization_id: string;
  name: string;
  public_base_url: string | null;
  status: string;
  owner_email: string;
  plan: string | null;
  subscription_status: string | null;
  created_at: string;
  updated_at: string;
}> {
  const rows = db
    .prepare(
      `SELECT i.id, i.organization_id, i.name, i.public_base_url, i.status,
              i.created_at, i.updated_at, o.owner_email,
              e.plan, s.status AS subscription_status
       FROM mothership_instances i
       JOIN organizations o ON o.id = i.organization_id
       LEFT JOIN entitlements e ON e.instance_id = i.id
       LEFT JOIN subscriptions s ON s.organization_id = i.organization_id
       WHERE (? IS NULL OR i.status = ?)
       GROUP BY i.id
       ORDER BY i.created_at DESC`
    )
    .all(status || null, status || null) as Array<{
    id: string;
    organization_id: string;
    name: string;
    public_base_url: string | null;
    status: string;
    owner_email: string;
    plan: string | null;
    subscription_status: string | null;
    created_at: string;
    updated_at: string;
  }>;
  return rows;
}

export function getInstanceEntitlements(db: ControlDb, instanceId: string) {
  return db
    .prepare(
      `SELECT i.id AS instance_id, i.status, e.plan, e.max_pods, e.warn_pods,
              e.max_lines, e.warn_lines, e.ios_push, e.grace_days, e.updated_at,
              s.status AS subscription_status, s.current_period_end
       FROM mothership_instances i
       LEFT JOIN entitlements e ON e.instance_id = i.id
       LEFT JOIN subscriptions s ON s.organization_id = i.organization_id
       WHERE i.id = ?
       ORDER BY s.updated_at DESC
       LIMIT 1`
    )
    .get(instanceId) as Record<string, unknown> | undefined;
}

export function recordStripeEvent(db: ControlDb, eventId: string, type: string): boolean {
  const info = db
    .prepare(`INSERT OR IGNORE INTO stripe_events (id, type, processed_at) VALUES (?, ?, ?)`)
    .run(eventId, type, nowIso());
  return Number(info.changes) === 1;
}

export function stripeEventProcessed(db: ControlDb, eventId: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM stripe_events WHERE id = ?`).get(eventId));
}

export type HostLicenseRow = {
  id: string;
  mothership_instance_id: string;
  owner_email: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_checkout_session_id: string | null;
  license_blob: string | null;
  expires_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export function createHostLicenseCheckoutRow(
  db: ControlDb,
  opts: {
    mothershipInstanceId: string;
    ownerEmail: string;
    stripeCheckoutSessionId: string;
  }
): string {
  const id = `hlic_${nanoid(16)}`;
  const now = nowIso();
  db.prepare(
    `INSERT INTO host_licenses
       (id, mothership_instance_id, owner_email, stripe_checkout_session_id,
        status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`
  ).run(
    id,
    opts.mothershipInstanceId,
    opts.ownerEmail.toLowerCase(),
    opts.stripeCheckoutSessionId,
    now,
    now
  );
  return id;
}

export function latestHostLicenseForInstance(
  db: ControlDb,
  mothershipInstanceId: string
): HostLicenseRow | null {
  return (
    (db
      .prepare(
        `SELECT * FROM host_licenses
         WHERE mothership_instance_id = ? AND license_blob IS NOT NULL
         ORDER BY updated_at DESC LIMIT 1`
      )
      .get(mothershipInstanceId) as HostLicenseRow | undefined) || null
  );
}

export function hostLicenseByCheckoutSession(
  db: ControlDb,
  sessionId: string
): HostLicenseRow | null {
  return (
    (db
      .prepare(`SELECT * FROM host_licenses WHERE stripe_checkout_session_id = ?`)
      .get(sessionId) as HostLicenseRow | undefined) || null
  );
}

export function activateHostLicenseRow(
  db: ControlDb,
  opts: {
    checkoutSessionId: string;
    stripeCustomerId: string;
    stripeSubscriptionId: string | null;
    licenseBlob: string;
    expiresAt: string;
  }
): void {
  const now = nowIso();
  db.prepare(
    `UPDATE host_licenses
     SET stripe_customer_id = ?,
         stripe_subscription_id = ?,
         license_blob = ?,
         expires_at = ?,
         status = 'active',
         updated_at = ?
     WHERE stripe_checkout_session_id = ?`
  ).run(
    opts.stripeCustomerId,
    opts.stripeSubscriptionId,
    opts.licenseBlob,
    opts.expiresAt,
    now,
    opts.checkoutSessionId
  );
}

export type HostReferrerRow = {
  referral_code: string;
  mothership_instance_id: string;
  stripe_customer_id: string;
  owner_email: string;
  created_at: string;
  updated_at: string;
};

function randomReferralCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "PH";
  for (let i = 0; i < 6; i++) {
    out += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return out;
}

/** Upsert a shareable referral code for a licensed mothership host. */
export function upsertHostReferrer(
  db: ControlDb,
  opts: {
    mothershipInstanceId: string;
    stripeCustomerId: string;
    ownerEmail: string;
  }
): HostReferrerRow {
  const existing = db
    .prepare(`SELECT * FROM host_referrers WHERE mothership_instance_id = ?`)
    .get(opts.mothershipInstanceId) as HostReferrerRow | undefined;
  const now = nowIso();
  if (existing) {
    db.prepare(
      `UPDATE host_referrers
       SET stripe_customer_id = ?, owner_email = ?, updated_at = ?
       WHERE mothership_instance_id = ?`
    ).run(opts.stripeCustomerId, opts.ownerEmail.toLowerCase(), now, opts.mothershipInstanceId);
    return {
      ...existing,
      stripe_customer_id: opts.stripeCustomerId,
      owner_email: opts.ownerEmail.toLowerCase(),
      updated_at: now,
    };
  }
  let code = randomReferralCode();
  for (let attempt = 0; attempt < 8; attempt++) {
    const clash = db
      .prepare(`SELECT 1 FROM host_referrers WHERE referral_code = ?`)
      .get(code);
    if (!clash) break;
    code = randomReferralCode();
  }
  db.prepare(
    `INSERT INTO host_referrers
       (referral_code, mothership_instance_id, stripe_customer_id, owner_email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    code,
    opts.mothershipInstanceId,
    opts.stripeCustomerId,
    opts.ownerEmail.toLowerCase(),
    now,
    now
  );
  return {
    referral_code: code,
    mothership_instance_id: opts.mothershipInstanceId,
    stripe_customer_id: opts.stripeCustomerId,
    owner_email: opts.ownerEmail.toLowerCase(),
    created_at: now,
    updated_at: now,
  };
}

export function hostReferrerByCode(db: ControlDb, code: string): HostReferrerRow | null {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return null;
  return (
    (db
      .prepare(`SELECT * FROM host_referrers WHERE referral_code = ?`)
      .get(normalized) as HostReferrerRow | undefined) || null
  );
}

export function hostReferrerByInstance(db: ControlDb, instanceId: string): HostReferrerRow | null {
  return (
    (db
      .prepare(`SELECT * FROM host_referrers WHERE mothership_instance_id = ?`)
      .get(instanceId) as HostReferrerRow | undefined) || null
  );
}

/**
 * If this instance already has an active host license but no referral row yet
 * (licenses issued before referral codes), create one from the license row.
 */
export function ensureHostReferrerForInstance(
  db: ControlDb,
  mothershipInstanceId: string
): HostReferrerRow | null {
  const existing = hostReferrerByInstance(db, mothershipInstanceId);
  if (existing) return existing;
  const lic = latestHostLicenseForInstance(db, mothershipInstanceId);
  if (!lic?.stripe_customer_id || !lic.owner_email) return null;
  if (lic.status !== "active" && !lic.license_blob) return null;
  return upsertHostReferrer(db, {
    mothershipInstanceId,
    stripeCustomerId: lic.stripe_customer_id,
    ownerEmail: lic.owner_email,
  });
}

/** Backfill referral codes for every active licensed instance missing a row. */
export function backfillHostReferrers(db: ControlDb): { created: number; codes: string[] } {
  const ids = db
    .prepare(
      `SELECT DISTINCT mothership_instance_id AS id
       FROM host_licenses
       WHERE status = 'active' AND license_blob IS NOT NULL AND stripe_customer_id IS NOT NULL`
    )
    .all() as Array<{ id: string }>;
  const codes: string[] = [];
  for (const { id } of ids) {
    if (hostReferrerByInstance(db, id)) continue;
    const row = ensureHostReferrerForInstance(db, id);
    if (row) codes.push(row.referral_code);
  }
  return { created: codes.length, codes };
}

export function referralAlreadyRedeemed(db: ControlDb, referredInstanceId: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM referral_redemptions WHERE referred_instance_id = ?`)
    .get(referredInstanceId);
  return Boolean(row);
}

export function recordReferralRedemption(
  db: ControlDb,
  opts: {
    referredInstanceId: string;
    referrerCode: string;
    checkoutSessionId: string | null;
    creditedCents: number;
  }
): boolean {
  if (referralAlreadyRedeemed(db, opts.referredInstanceId)) return false;
  const id = `rref_${nanoid(12)}`;
  try {
    db.prepare(
      `INSERT INTO referral_redemptions
         (id, referred_instance_id, referrer_code, checkout_session_id, credited_cents, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      opts.referredInstanceId,
      opts.referrerCode.toUpperCase(),
      opts.checkoutSessionId,
      opts.creditedCents,
      nowIso()
    );
    return true;
  } catch {
    return false;
  }
}
