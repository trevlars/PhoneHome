import assert from "node:assert/strict";
import test from "node:test";
import {
  authenticateInstance,
  createInstance,
  ensureOrganization,
  ensureHostReferrerForInstance,
  getInstanceEntitlements,
  hostReferrerByInstance,
  openControlDb,
  recordReferralRedemption,
  referralAlreadyRedeemed,
  setInstanceEntitlements,
} from "./db.js";
import { PLANS } from "./plans.js";

test("instance secret is returned once and stored as a verifier", () => {
  const db = openControlDb(":memory:");
  const organizationId = ensureOrganization(db, {
    stripeCustomerId: "cus_test",
    ownerEmail: "parent@example.com",
  });
  const instance = createInstance(db, { organizationId, name: "Test family" });
  assert.equal(authenticateInstance(db, instance.id, instance.secret), true);
  assert.equal(authenticateInstance(db, instance.id, `${instance.secret}x`), false);
  const stored = db
    .prepare(`SELECT instance_secret_hash FROM mothership_instances WHERE id = ?`)
    .get(instance.id) as { instance_secret_hash: string };
  assert.equal(stored.instance_secret_hash.includes(instance.secret), false);
});

test("entitlements contain no household or child data", () => {
  const db = openControlDb(":memory:");
  const organizationId = ensureOrganization(db, {
    stripeCustomerId: "cus_entitlements",
    ownerEmail: "parent@example.com",
  });
  const instance = createInstance(db, { organizationId, name: "Family" });
  setInstanceEntitlements(db, instance.id, PLANS.family);
  const entitlements = getInstanceEntitlements(db, instance.id);
  assert.equal(entitlements?.plan, "family");
  assert.equal(entitlements?.max_pods, 25);
  assert.equal(JSON.stringify(entitlements).includes("child"), false);
});

test("host referral codes upsert and backfill from active licenses", () => {
  const db = openControlDb(":memory:");
  const instanceId = "phinst_abcdef0123456789abcd";
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO host_licenses
       (id, mothership_instance_id, owner_email, stripe_customer_id, stripe_checkout_session_id,
        license_blob, expires_at, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  ).run(
    "hl_1",
    instanceId,
    "host@example.com",
    "cus_referrer",
    "cs_test_1",
    "blob.sig",
    now,
    now,
    now
  );
  assert.equal(hostReferrerByInstance(db, instanceId), null);
  const ensured = ensureHostReferrerForInstance(db, instanceId);
  assert.ok(ensured);
  assert.match(ensured.referral_code, /^PH[A-Z0-9]{6}$/);
  assert.equal(ensured.stripe_customer_id, "cus_referrer");
  const again = ensureHostReferrerForInstance(db, instanceId);
  assert.equal(again?.referral_code, ensured.referral_code);
  assert.equal(referralAlreadyRedeemed(db, "phinst_newinstance0001"), false);
  assert.equal(
    recordReferralRedemption(db, {
      referredInstanceId: "phinst_newinstance0001",
      referrerCode: ensured.referral_code,
      checkoutSessionId: "cs_ref",
      creditedCents: 300,
    }),
    true
  );
  assert.equal(referralAlreadyRedeemed(db, "phinst_newinstance0001"), true);
  assert.equal(
    recordReferralRedemption(db, {
      referredInstanceId: "phinst_newinstance0001",
      referrerCode: ensured.referral_code,
      checkoutSessionId: "cs_ref2",
      creditedCents: 300,
    }),
    false
  );
});
