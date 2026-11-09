import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  addLine,
  addLineToSphere,
  canCall,
  createHousehold,
  getSphereByOwner,
  leaveVoicemailFromBridge,
  linesMayConnect,
  registerParent,
} from "./api.js";
import { openDb } from "./db.js";

test("mutual allowlist drift stays blocked until the child lines share a Circle", () => {
  const db = openDb(":memory:");
  const a = registerParent(db, "Parent A");
  const b = registerParent(db, "Parent B");
  const hhA = createHousehold(db, a.user.id, "A");
  const hhB = createHousehold(db, b.user.id, "B");
  const kidA = addLine(db, hhA.id, a.user.id, "Kid A", "softphone", { mode: "child" });
  const kidB = addLine(db, hhB.id, b.user.id, "Kid B", "softphone", { mode: "child" });
  const now = new Date().toISOString();

  // Simulate legacy/manual allowlist pollution without the corresponding Circle bridge.
  db.prepare(
    `INSERT INTO allowlist (id, household_id, target_line_id, label, favorite, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`
  ).run("al_a_b", hhA.id, kidB.id, "Kid B", now);
  db.prepare(
    `INSERT INTO allowlist (id, household_id, target_line_id, label, favorite, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`
  ).run("al_b_a", hhB.id, kidA.id, "Kid A", now);

  const blocked = canCall(db, kidA.id, kidB.id);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.voice, "sphere");
  assert.equal(linesMayConnect(db, kidA.id, kidB.id), false);
  assert.throws(
    () => leaveVoicemailFromBridge(db, kidA.id, kidB.id),
    /Contact not approved/
  );

  const sphereA = getSphereByOwner(db, a.user.id);
  assert.ok(sphereA);
  addLineToSphere(db, sphereA.id, kidB.id, a.user.id);

  assert.equal(canCall(db, kidA.id, kidB.id).ok, true);
  assert.equal(linesMayConnect(db, kidA.id, kidB.id), true);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ph-sphere-vm-"));
  assert.doesNotThrow(() =>
    leaveVoicemailFromBridge(db, kidA.id, kidB.id, {
      audioBase64: Buffer.alloc(64, 1).toString("base64"),
      audioMime: "audio/wav",
      dataDir,
    })
  );
});
