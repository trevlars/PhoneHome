import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  addAllowlist,
  addLine,
  canCall,
  createHousehold,
  createInvite,
  redeemInvite,
  registerParent,
  updateHouseholdRules,
} from "./api.js";
import { openDb } from "./db.js";

test("allowlist and kill switch gate calls", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const b = registerParent(db, "B");
  const hhA = createHousehold(db, a.user.id, "House A");
  const hhB = createHousehold(db, b.user.id, "House B");
  const lineA = addLine(db, hhA.id, a.user.id, "A phone");
  const lineB = addLine(db, hhB.id, b.user.id, "B phone");

  assert.equal(canCall(db, lineA.id, lineB.id).ok, false);
  addAllowlist(db, hhA.id, lineB.id, "B");
  assert.equal(canCall(db, lineA.id, lineB.id).ok, false);
  addAllowlist(db, hhB.id, lineA.id, "A");
  assert.equal(canCall(db, lineA.id, lineB.id).ok, true);

  updateHouseholdRules(db, hhB.id, { kill_switch: true });
  assert.equal(canCall(db, lineA.id, lineB.id).ok, false);
});

test("invite redeem creates household", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const b = registerParent(db, "B");
  const hhA = createHousehold(db, a.user.id, "House A");
  const invite = createInvite(db, hhA.id, a.user.id);
  const redeemed = redeemInvite(db, invite.code, b.user.id, "House B");
  assert.ok(redeemed.household.id);
  assert.throws(() => redeemInvite(db, invite.code, b.user.id, "X"));
});
