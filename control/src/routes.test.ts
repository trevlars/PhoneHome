import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { ensureOrganization, openControlDb, upsertSubscription } from "./db.js";
import { createControlApp } from "./index.js";

test("admin provisions an instance and the one-time secret reads entitlements", async () => {
  const db = openControlDb(":memory:");
  const organizationId = ensureOrganization(db, {
    stripeCustomerId: "cus_routes",
    ownerEmail: "parent@example.com",
  });
  upsertSubscription(db, {
    organizationId,
    stripeSubscriptionId: "sub_routes",
    stripePriceId: "price_family",
    status: "active",
  });
  const previous = {
    admin: process.env.CONTROL_ADMIN_TOKEN,
    family: process.env.STRIPE_PRICE_FAMILY,
  };
  process.env.CONTROL_ADMIN_TOKEN = "control-admin-test-token-long-enough";
  process.env.STRIPE_PRICE_FAMILY = "price_family";
  const server = createControlApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const port = (server.address() as AddressInfo).port;
    const provision = await fetch(`http://127.0.0.1:${port}/v1/admin/instances`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.CONTROL_ADMIN_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ organizationId, name: "Route family" }),
    });
    assert.equal(provision.status, 201);
    const instance = (await provision.json()) as { id: string; secret: string };
    assert.match(instance.id, /^inst_/);
    assert.ok(instance.secret.length >= 32);

    const entitlements = await fetch(
      `http://127.0.0.1:${port}/v1/instances/${instance.id}/entitlements`,
      {
        headers: {
          authorization: `Bearer ${instance.secret}`,
          "x-phonehome-instance-id": instance.id,
        },
      }
    );
    assert.equal(entitlements.status, 200);
    const body = (await entitlements.json()) as {
      entitlements: { plan: string; max_pods: number; ios_push: boolean };
    };
    assert.equal(body.entitlements.plan, "family");
    assert.equal(body.entitlements.max_pods, 25);
    assert.equal(body.entitlements.ios_push, true);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    if (previous.admin === undefined) delete process.env.CONTROL_ADMIN_TOKEN;
    else process.env.CONTROL_ADMIN_TOKEN = previous.admin;
    if (previous.family === undefined) delete process.env.STRIPE_PRICE_FAMILY;
    else process.env.STRIPE_PRICE_FAMILY = previous.family;
  }
});
