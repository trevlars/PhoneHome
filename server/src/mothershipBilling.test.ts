import assert from "node:assert/strict";
import test from "node:test";
import { openDb } from "./db.js";
import {
  addAllowlist,
  addLine,
  bootstrapAdmin,
  canCall,
  createHousehold,
  registerParent,
} from "./api.js";
import {
  backfillCircleBillingRows,
  circleBillingRow,
  getMothershipBillingSettings,
  migrateMothershipBillingV1,
  updateMothershipBillingSettings,
  updateCircleBilling,
} from "./mothershipBilling.js";

test("billing is off by default — no circle rows until opt-in", () => {
  const db = openDb(":memory:");
  bootstrapAdmin(db);
  const parent = registerParent(db, "Host");
  const hh = createHousehold(db, parent.user.id, "East");
  const kid = addLine(db, hh.id, parent.user.id, "Sam", "softphone", {
    mode: "child",
    child_label: "Sam",
  });
  assert.equal(getMothershipBillingSettings(db).enabled, false);
  assert.equal(circleBillingRow(db, kid.id), null);
});

test("enabling billing backfills child lines", () => {
  const db = openDb(":memory:");
  bootstrapAdmin(db);
  const parent = registerParent(db, "Host");
  const hh = createHousehold(db, parent.user.id, "North");
  const kid = addLine(db, hh.id, parent.user.id, "Alex", "softphone", {
    mode: "child",
    child_label: "Alex",
  });
  assert.equal(backfillCircleBillingRows(db), 0);
  updateMothershipBillingSettings(db, { enabled: true, default_monthly_cents: 500 });
  assert.equal(backfillCircleBillingRows(db), 0);
  assert.equal(getMothershipBillingSettings(db).enabled, true);
  const row = circleBillingRow(db, kid.id);
  assert.ok(row);
  assert.equal(row?.monthly_cents, 500);
  assert.equal(row?.status, "active");
});

test("hard enforcement blocks suspended child cross-pod", () => {
  const db = openDb(":memory:");
  migrateMothershipBillingV1(db);
  const host = registerParent(db, "Host");
  const sister = registerParent(db, "Sister");
  const hhA = createHousehold(db, host.user.id, "East");
  const hhB = createHousehold(db, sister.user.id, "North");
  const kidA = addLine(db, hhA.id, host.user.id, "Kid A", "softphone", { mode: "child" });
  const kidB = addLine(db, hhB.id, sister.user.id, "Kid B", "softphone", { mode: "child" });
  updateMothershipBillingSettings(db, {
    enabled: true,
    enforcement: "hard",
    default_monthly_cents: 500,
  });
  updateCircleBilling(db, kidA.id, { status: "suspended" });
  addAllowlist(db, hhA.id, kidB.id, "Cousin");
  addAllowlist(db, hhB.id, kidA.id, "Cousin");
  const blocked = canCall(db, kidA.id, kidB.id);
  assert.equal(blocked.ok, false);
  const ok = canCall(db, kidB.id, kidA.id);
  assert.equal(ok.ok, false);
});
