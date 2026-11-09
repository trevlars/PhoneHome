import assert from "node:assert/strict";
import test from "node:test";
import { planForPrice } from "./plans.js";

test("Stripe price ids map only to configured plans", () => {
  const family = process.env.STRIPE_PRICE_FAMILY;
  const extended = process.env.STRIPE_PRICE_EXTENDED;
  process.env.STRIPE_PRICE_FAMILY = "price_family";
  process.env.STRIPE_PRICE_EXTENDED = "price_extended";
  try {
    assert.equal(planForPrice("price_family")?.plan, "family");
    assert.equal(planForPrice("price_extended")?.plan, "extended");
    assert.equal(planForPrice("price_unknown"), null);
  } finally {
    if (family === undefined) delete process.env.STRIPE_PRICE_FAMILY;
    else process.env.STRIPE_PRICE_FAMILY = family;
    if (extended === undefined) delete process.env.STRIPE_PRICE_EXTENDED;
    else process.env.STRIPE_PRICE_EXTENDED = extended;
  }
});
