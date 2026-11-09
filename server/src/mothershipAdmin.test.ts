import assert from "node:assert/strict";
import test from "node:test";
import { openDb } from "./db.js";
import {
  addLine,
  adminResetPassword,
  bootstrapAdmin,
  createHousehold,
  registerParent,
  setUserCredentials,
} from "./api.js";
import {
  addMothershipOperator,
  ensureMothershipOperator,
  getMothershipOperatorRole,
  updateMothershipBillingSettings,
} from "./mothershipBilling.js";
import {
  getMothershipAdminSnapshot,
  resolveUserIdForAdmin,
} from "./mothershipAdmin.js";

test("admin snapshot includes pods, parents, lines, server, health", () => {
  const db = openDb(":memory:");
  const boot = bootstrapAdmin(db);
  setUserCredentials(db, boot.user.id, { username: "hostop", password: "hostpass1" });

  const sister = registerParent(db, "Sister");
  setUserCredentials(db, sister.user.id, { username: "sister", password: "sister99" });
  const hh = createHousehold(db, sister.user.id, "North");
  addLine(db, hh.id, sister.user.id, "Alex", "softphone", {
    mode: "child",
    child_label: "Alex",
  });

  const snap = getMothershipAdminSnapshot(db);
  assert.ok(snap.capacity.podCount >= 1);
  assert.equal(typeof snap.server.ata_lan_push, "boolean");
  assert.ok(Array.isArray(snap.operators));
  assert.ok(snap.operators.some((o) => o.role === "owner"));

  const north = snap.pods.find((p) => p.name === "North");
  assert.ok(north);
  assert.equal(north!.kid_count, 1);
  assert.ok(north!.parents.some((p) => p.username === "sister"));
  assert.equal(north!.lines.some((l) => l.mode === "child" && l.child_label === "Alex"), true);
  assert.equal(snap.health.softphone_total >= 1, true);
  assert.equal(typeof snap.integrity.orphan_guardians, "number");
});

test("resolveUserIdForAdmin by username + operator add", () => {
  const db = openDb(":memory:");
  const boot = bootstrapAdmin(db);
  setUserCredentials(db, boot.user.id, { username: "owner1", password: "ownerpass1" });
  const helper = registerParent(db, "Helper");
  setUserCredentials(db, helper.user.id, { username: "helper", password: "helper99" });

  const id = resolveUserIdForAdmin(db, { username: "helper" });
  assert.equal(id, helper.user.id);
  addMothershipOperator(db, boot.user.id, id);
  assert.equal(getMothershipOperatorRole(db, helper.user.id), "admin");
});

test("adminResetPassword works for operator support flow", () => {
  const db = openDb(":memory:");
  bootstrapAdmin(db);
  const parent = registerParent(db, "Mom");
  setUserCredentials(db, parent.user.id, { username: "momuser", password: "oldpass99" });
  adminResetPassword(db, "momuser", "newpass99");
  // username lookup still works after reset
  assert.equal(resolveUserIdForAdmin(db, { username: "MomUser" }), parent.user.id);
});

test("billing circles nest under enriched pods when enabled", () => {
  const db = openDb(":memory:");
  bootstrapAdmin(db);
  const parent = registerParent(db, "Dad");
  const hh = createHousehold(db, parent.user.id, "East");
  addLine(db, hh.id, parent.user.id, "Sam", "softphone", {
    mode: "child",
    child_label: "Sam",
  });
  updateMothershipBillingSettings(db, { enabled: true, default_monthly_cents: 500 });
  ensureMothershipOperator(db, parent.user.id, "admin");
  const snap = getMothershipAdminSnapshot(db);
  const pod = snap.pods.find((p) => p.name === "East");
  assert.ok(pod);
  assert.equal(pod!.circles.length, 1);
  assert.equal(pod!.circles[0].kid_name, "Sam");
});
