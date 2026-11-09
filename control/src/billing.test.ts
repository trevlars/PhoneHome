import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import { processStripeEvent } from "./billing.js";
import { openControlDb } from "./db.js";

test("completed Checkout is idempotent and creates one pending tenant", async () => {
  const db = openControlDb(":memory:");
  const previousPrice = process.env.STRIPE_PRICE_FAMILY;
  const previousProvisioner = process.env.PROVISIONER_WEBHOOK_URL;
  process.env.STRIPE_PRICE_FAMILY = "price_family";
  delete process.env.PROVISIONER_WEBHOOK_URL;
  const subscription = {
    id: "sub_checkout",
    customer: "cus_checkout",
    status: "active",
    current_period_end: 1_800_000_000,
    items: { data: [{ price: { id: "price_family" } }] },
  } as unknown as Stripe.Subscription;
  const stripe = {
    subscriptions: { retrieve: async () => subscription },
    customers: { retrieve: async () => ({ id: "cus_checkout" }) },
  } as unknown as Stripe;
  const event = {
    id: "evt_checkout",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test",
        customer: "cus_checkout",
        customer_details: { email: "parent@example.com" },
        subscription: "sub_checkout",
        metadata: { instance_name: "Checkout family" },
      },
    },
  } as unknown as Stripe.Event;
  try {
    assert.equal(await processStripeEvent(db, stripe, event), true);
    assert.equal(await processStripeEvent(db, stripe, event), false);
    const counts = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM organizations) AS organizations,
           (SELECT COUNT(*) FROM subscriptions) AS subscriptions,
           (SELECT COUNT(*) FROM mothership_instances) AS instances,
           (SELECT COUNT(*) FROM stripe_events) AS events`
      )
      .get() as Record<string, number>;
    assert.deepEqual(counts, {
      organizations: 1,
      subscriptions: 1,
      instances: 1,
      events: 1,
    });
  } finally {
    if (previousPrice === undefined) delete process.env.STRIPE_PRICE_FAMILY;
    else process.env.STRIPE_PRICE_FAMILY = previousPrice;
    if (previousProvisioner === undefined) delete process.env.PROVISIONER_WEBHOOK_URL;
    else process.env.PROVISIONER_WEBHOOK_URL = previousProvisioner;
  }
});
