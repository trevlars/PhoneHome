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
  endCallLog,
  isInQuietWindow,
  logCall,
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

test("quiet hours use household timezone not server clock", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const b = registerParent(db, "B");
  const hhA = createHousehold(db, a.user.id, "House A");
  const hhB = createHousehold(db, b.user.id, "House B");
  const lineA = addLine(db, hhA.id, a.user.id, "A phone");
  const lineB = addLine(db, hhB.id, b.user.id, "B phone");
  addAllowlist(db, hhA.id, lineB.id, "B");
  addAllowlist(db, hhB.id, lineA.id, "A");

  // 03:00 UTC is still evening previous day in US Pacific
  const atUtc0300 = new Date("2026-01-15T03:00:00.000Z");

  updateHouseholdRules(db, hhB.id, {
    quiet_start: "21:00",
    quiet_end: "07:00",
    quiet_tz: "America/Los_Angeles",
  });
  // 03:00 UTC = 19:00 PST → outside quiet
  assert.equal(isInQuietWindow("21:00", "07:00", "America/Los_Angeles", atUtc0300), false);

  updateHouseholdRules(db, hhB.id, {
    quiet_start: "18:00",
    quiet_end: "07:00",
    quiet_tz: "America/Los_Angeles",
  });
  // 03:00 UTC = 19:00 PST → inside 18:00–07:00
  assert.equal(isInQuietWindow("18:00", "07:00", "America/Los_Angeles", atUtc0300), true);
  assert.equal(canCall(db, lineA.id, lineB.id, atUtc0300).ok, false);

  // Same instant in Tokyo is noon — outside evening quiet window
  assert.equal(isInQuietWindow("21:00", "07:00", "Asia/Tokyo", atUtc0300), false);

  updateHouseholdRules(db, hhB.id, { quiet_start: null, quiet_end: null });
  assert.equal(canCall(db, lineA.id, lineB.id, atUtc0300).ok, true);
});

test("quiet hours require custom times and timezone", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const hh = createHousehold(db, a.user.id, "House A");
  assert.throws(() => updateHouseholdRules(db, hh.id, { quiet_start: "21:00", quiet_end: "07:00" }));
  const saved = updateHouseholdRules(db, hh.id, {
    quiet_start: "20:30",
    quiet_end: "06:15",
    quiet_tz: "America/Chicago",
  });
  assert.equal(saved.quiet_start, "20:30");
  assert.equal(saved.quiet_end, "06:15");
  assert.equal(saved.quiet_tz, "America/Chicago");
});

test("hangup after answer marks completed; cancel marks cancelled", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const b = registerParent(db, "B");
  const hhA = createHousehold(db, a.user.id, "House A");
  const hhB = createHousehold(db, b.user.id, "House B");
  const lineA = addLine(db, hhA.id, a.user.id, "A phone");
  const lineB = addLine(db, hhB.id, b.user.id, "B phone");
  const ringing = logCall(db, lineA.id, lineB.id, "ringing");
  endCallLog(db, ringing.id, "ended");
  const cancelled = db.prepare(`SELECT outcome FROM call_logs WHERE id = ?`).get(ringing.id) as {
    outcome: string;
  };
  assert.equal(cancelled.outcome, "cancelled");

  const answered = logCall(db, lineA.id, lineB.id, "ringing");
  db.prepare(`UPDATE call_logs SET outcome = 'answered' WHERE id = ?`).run(answered.id);
  endCallLog(db, answered.id, "ended");
  const done = db.prepare(`SELECT outcome FROM call_logs WHERE id = ?`).get(answered.id) as {
    outcome: string;
  };
  assert.equal(done.outcome, "completed");
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
