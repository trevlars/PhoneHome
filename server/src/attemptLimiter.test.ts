import assert from "node:assert/strict";
import test from "node:test";
import { createAttemptLimiter } from "./attemptLimiter.js";

test("attempt limiter blocks after max failures and reopens after the window", () => {
  let t = 1_000_000;
  const lim = createAttemptLimiter({ maxFailures: 3, windowMs: 60_000, now: () => t });
  const keys = ["u:1", "ip:a"];
  for (let i = 0; i < 3; i++) {
    assert.equal(lim.retryAfter(keys), null);
    lim.fail(keys);
    t += 1000;
  }
  const wait = lim.retryAfter(keys);
  assert.ok(wait && wait > 0 && wait <= 60, `blocked, got ${wait}`);
  assert.ok(lim.retryAfter(["ip:a"]), "shared IP bucket blocked too");
  assert.equal(lim.retryAfter(["u:2"]), null, "other users unaffected");
  t += 60_000;
  assert.equal(lim.retryAfter(keys), null, "window expired");
});

test("attempt limiter success clears only the given keys", () => {
  const t = 0;
  const lim = createAttemptLimiter({ maxFailures: 2, windowMs: 60_000, now: () => t });
  lim.fail(["u:1", "ip:a"]);
  lim.fail(["u:1", "ip:a"]);
  lim.succeed(["u:1"]);
  assert.equal(lim.retryAfter(["u:1"]), null);
  assert.ok(lim.retryAfter(["ip:a"]), "IP bucket keeps counting");
});
