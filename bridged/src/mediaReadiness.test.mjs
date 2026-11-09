import test from "node:test";
import assert from "node:assert/strict";
import { createMediaReadinessGate } from "./mediaReadiness.mjs";

test("media readiness wait resolves when RTP arrives", async () => {
  const gate = createMediaReadinessGate();
  const waiting = gate.wait(100);

  gate.markReady();

  assert.equal(await waiting, true);
  assert.equal(gate.ready, true);
  assert.equal(await gate.wait(1), true);
});

test("media readiness wait times out without RTP", async () => {
  const gate = createMediaReadinessGate();

  assert.equal(await gate.wait(5), false);
  assert.equal(gate.ready, false);
});
