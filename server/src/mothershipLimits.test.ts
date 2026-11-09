import assert from "node:assert/strict";
import test from "node:test";
import { openDb } from "./db.js";
import { addLine, createHousehold, registerParent } from "./api.js";
import {
  assertMothershipCanAddPod,
  getMothershipLimits,
  getMothershipStats,
} from "./mothershipLimits.js";
import { setManagedEntitlements } from "./managedEntitlements.js";

test("getMothershipStats counts pods", () => {
  const db = openDb(":memory:");
  const { user } = registerParent(db, "Parent A", { username: "parenta", password: "secretpass1" });
  createHousehold(db, user.id, "Pod A");
  const stats = getMothershipStats(db);
  assert.equal(stats.podCount, 1);
  assert.equal(stats.atPodLimit, false);
});

test("self-hosted defaults cap lines at 50 with no Pod cap", () => {
  const keys = [
    "MOTHERSHIP_MAX_PODS",
    "MOTHERSHIP_WARN_PODS",
    "MOTHERSHIP_MAX_LINES",
    "MOTHERSHIP_WARN_LINES",
  ] as const;
  const prev = keys.map((k) => process.env[k]);
  for (const k of keys) delete process.env[k];
  try {
    assert.deepEqual(getMothershipLimits(), {
      maxPods: null,
      warnPods: null,
      maxLines: 50,
      warnLines: 40,
    });
    const db = openDb(":memory:");
    const { user } = registerParent(db, "Parent A", { username: "parenta", password: "secretpass1" });
    for (let i = 0; i < 60; i++) createHousehold(db, user.id, `Pod ${i}`);
    const stats = getMothershipStats(db);
    assert.equal(stats.atPodLimit, false);
    assert.equal(stats.warnPodsReached, false);
    assert.doesNotThrow(() => assertMothershipCanAddPod(db));
  } finally {
    keys.forEach((k, i) => {
      if (prev[i] === undefined) delete process.env[k];
      else process.env[k] = prev[i];
    });
  }
});

test("assertMothershipCanAddLine blocks at max", () => {
  const prev = process.env.MOTHERSHIP_MAX_LINES;
  process.env.MOTHERSHIP_MAX_LINES = "1";
  try {
    const db = openDb(":memory:");
    const { user } = registerParent(db, "Parent A", { username: "parenta", password: "secretpass1" });
    const hh = createHousehold(db, user.id, "Pod A");
    addLine(db, hh.id, user.id, "Kitchen");
    assert.throws(() => addLine(db, hh.id, user.id, "Den"), /line limit/);
  } finally {
    if (prev === undefined) delete process.env.MOTHERSHIP_MAX_LINES;
    else process.env.MOTHERSHIP_MAX_LINES = prev;
  }
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

test("managed entitlements supply limits while explicit host env still wins", () => {
  const maxPods = process.env.MOTHERSHIP_MAX_PODS;
  delete process.env.MOTHERSHIP_MAX_PODS;
  setManagedEntitlements({
    plan: "family",
    maxPods: 12,
    warnPods: 8,
    maxLines: 60,
    warnLines: 40,
    iosPush: true,
    graceDays: 7,
    instanceStatus: "active",
    subscriptionStatus: "active",
    refreshedAt: new Date().toISOString(),
  });
  try {
    assert.equal(getMothershipLimits().maxPods, 12);
    process.env.MOTHERSHIP_MAX_PODS = "9";
    assert.equal(getMothershipLimits().maxPods, 9);
  } finally {
    setManagedEntitlements(null);
    if (maxPods === undefined) delete process.env.MOTHERSHIP_MAX_PODS;
    else process.env.MOTHERSHIP_MAX_PODS = maxPods;
  }
});
