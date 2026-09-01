import assert from "node:assert/strict";
import test from "node:test";
import { openDb } from "./db.js";
import { createHousehold, registerParent } from "./api.js";
import {
  assertMothershipCanAddPod,
  getMothershipLimits,
  getMothershipStats,
} from "./mothershipLimits.js";

test("getMothershipStats counts pods", () => {
  const db = openDb(":memory:");
  const { user } = registerParent(db, "Parent A", { username: "parenta", password: "secretpass1" });
  createHousehold(db, user.id, "Pod A");
  const stats = getMothershipStats(db);
  assert.equal(stats.podCount, 1);
  assert.equal(stats.atPodLimit, false);
});

test("assertMothershipCanAddPod blocks at max", () => {
  const prev = process.env.MOTHERSHIP_MAX_PODS;
  process.env.MOTHERSHIP_MAX_PODS = "1";
  try {
    const db = openDb(":memory:");
    const { user } = registerParent(db, "Parent A", { username: "parenta", password: "secretpass1" });
    createHousehold(db, user.id, "Only Pod");
    assert.throws(() => assertMothershipCanAddPod(db), /Mothership is full/);
  } finally {
    if (prev === undefined) delete process.env.MOTHERSHIP_MAX_PODS;
    else process.env.MOTHERSHIP_MAX_PODS = prev;
    void getMothershipLimits();
  }
});
