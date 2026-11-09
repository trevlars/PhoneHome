import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openDb } from "./db.js";
import {
  departHousehold,
  exportHouseholdForMigrate,
  importHouseholdFromMigrate,
} from "./migrateMothership.js";
import {
  acceptInboundPeer,
  createPeerInvite,
  ensurePeerServerSchema,
  listPeerServers,
  localAllowlistAllows,
} from "./peerServers.js";

test("migrate export v2 includes mode and allowlist flags", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ph-migrate-"));
  const db = openDb(path.join(dir, "t.db"));
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, display_name, username, created_at) VALUES (?, ?, ?, ?)`
  ).run("u1", "Parent B", "parentb", now);
  db.prepare(
    `INSERT INTO households (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)`
  ).run("hh1", "West", "u1", now);
  db.prepare(
    `INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, ?)`
  ).run("hh1", "u1", "parent");
  db.prepare(
    `INSERT INTO lines (id, household_id, name, type, mode, child_label, owner_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("line1", "hh1", "Kid", "softphone", "child", "Kid", "u1", now);
  db.prepare(
    `INSERT INTO lines (id, household_id, name, type, mode, child_label, owner_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("line_ata", "hh1", "Hall", "ata", "child", "Hall", "u1", now);
  db.prepare(
    `INSERT INTO allowlist (id, household_id, target_line_id, label, favorite, always_allow, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("al1", "hh1", "line_remote", "Cousin", 1, 0, now);
  db.prepare(
    `INSERT INTO allowlist (id, household_id, target_line_id, label, favorite, always_allow, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("al2", "hh1", "line_ata", "Hall phone", 1, 1, now);

  const exp = exportHouseholdForMigrate(db, "hh1", { publicBaseUrl: "https://a.example" });
  assert.ok(!("error" in exp));
  if ("error" in exp) return;
  assert.equal(exp.version, 2);
  assert.equal(exp.household.name, "West");
  assert.equal(exp.fromMothershipHint, "https://a.example");
  assert.equal(exp.lines.length, 2);
  const kid = exp.lines.find((l) => l.id === "line1");
  assert.equal(kid?.mode, "child");
  assert.equal(kid?.type, "softphone");
  assert.equal(kid?.child_label, "Kid");
  const cousin = exp.allowlist.find((a) => a.label === "Cousin");
  assert.equal(cousin?.favorite, 1);
  assert.equal(cousin?.always_allow, 0);
  assert.ok(exp.ataChecklist.length > 0);

  const departed = departHousehold(db, "hh1", { actingUserId: "u1" });
  assert.equal(departed.ok, true);
  const members = db
    .prepare(`SELECT COUNT(*) AS c FROM household_members WHERE household_id = ?`)
    .get("hh1") as { c: number };
  assert.equal(members.c, 0);
});

test("migrate import remaps kids and pending external contacts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ph-migrate-imp-"));
  const dbA = openDb(path.join(dir, "a.db"));
  const now = new Date().toISOString();
  dbA.prepare(
    `INSERT INTO users (id, display_name, username, created_at) VALUES (?, ?, ?, ?)`
  ).run("u1", "Parent B", "parentb", now);
  dbA.prepare(
    `INSERT INTO households (id, name, owner_user_id, quiet_start, quiet_end, quiet_tz, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("hh1", "West", "u1", "21:00", "07:00", "America/Chicago", now);
  dbA.prepare(
    `INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, ?)`
  ).run("hh1", "u1", "parent");
  dbA.prepare(
    `INSERT INTO lines (id, household_id, name, type, mode, child_label, owner_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("line_kid", "hh1", "Sam", "softphone", "child", "Sam", "u1", now);
  dbA.prepare(
    `INSERT INTO lines (id, household_id, name, type, mode, child_label, owner_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("line_ata", "hh1", "Kitchen", "ata", "child", "Kitchen", "u1", now);
  dbA.prepare(
    `INSERT INTO allowlist (id, household_id, target_line_id, label, favorite, always_allow, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("al_int", "hh1", "line_ata", "Kitchen", 1, 0, now);
  dbA.prepare(
    `INSERT INTO allowlist (id, household_id, target_line_id, label, favorite, always_allow, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run("al_ext", "hh1", "line_cousin", "Cousin Maya", 1, 0, now);

  const exp = exportHouseholdForMigrate(dbA, "hh1", { publicBaseUrl: "https://a.example" });
  assert.ok(!("error" in exp));
  if ("error" in exp) return;

  // Fresh mothership B — same user id shape as a new account on B.
  const dbB = openDb(path.join(dir, "b.db"));
  dbB.prepare(
    `INSERT INTO users (id, display_name, username, created_at) VALUES (?, ?, ?, ?)`
  ).run("u_b", "Parent B", "parentb", now);

  const result = importHouseholdFromMigrate(dbB, "u_b", exp);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.createdHousehold, true);
  assert.ok(result.lineIdMap.line_kid);
  assert.ok(result.lineIdMap.line_ata);
  assert.equal(result.restoredAllowlist, 1);
  assert.equal(result.pendingExternalContacts.length, 1);
  assert.equal(result.pendingExternalContacts[0]?.label, "Cousin Maya");
  assert.deepEqual(result.ataLineIds, [result.lineIdMap.line_ata]);

  const kids = dbB
    .prepare(
      `SELECT child_label, type FROM lines
       WHERE household_id = ? AND IFNULL(mode, 'parent') = 'child'
       ORDER BY child_label`
    )
    .all(result.householdId) as Array<{ child_label: string; type: string }>;
  assert.equal(kids.length, 2);
  assert.equal(kids[0]?.child_label, "Kitchen");
  assert.equal(kids[0]?.type, "ata");
  assert.equal(kids[1]?.child_label, "Sam");

  const hh = dbB
    .prepare(`SELECT quiet_start, quiet_end FROM households WHERE id = ?`)
    .get(result.householdId) as { quiet_start: string; quiet_end: string };
  assert.equal(hh.quiet_start, "21:00");
  assert.equal(hh.quiet_end, "07:00");

  // Re-import is idempotent for same labels.
  const again = importHouseholdFromMigrate(dbB, "u_b", exp);
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.createdHousehold, false);
  assert.equal(again.lineIdMap.line_kid, result.lineIdMap.line_kid);
});

test("migrate import accepts legacy v1 type=child", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ph-migrate-v1-"));
  const db = openDb(path.join(dir, "t.db"));
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, display_name, username, created_at) VALUES (?, ?, ?, ?)`
  ).run("u1", "Parent", "p", now);

  const result = importHouseholdFromMigrate(db, "u1", {
    version: 1,
    exportedAt: now,
    fromMothershipHint: null,
    household: {
      id: "old",
      name: "Legacy Pod",
      quiet_start: null,
      quiet_end: null,
      quiet_tz: null,
    },
    parents: [],
    lines: [{ id: "old_kid", name: "Rae", type: "child", child_label: "Rae" }],
    allowlist: [],
    ataChecklist: [],
    appChecklist: [],
    peeringNote: "",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const line = db
    .prepare(`SELECT type, mode, child_label FROM lines WHERE id = ?`)
    .get(result.lineIdMap.old_kid) as { type: string; mode: string; child_label: string };
  assert.equal(line.type, "softphone");
  assert.equal(line.mode, "child");
  assert.equal(line.child_label, "Rae");
});

test("peer invite accept trusts remote signaling url", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ph-peer-"));
  const db = openDb(path.join(dir, "t.db"));
  ensurePeerServerSchema(db);
  const invite = createPeerInvite(db, {
    name: "B's box",
    localSignalingUrl: "https://a.example",
    localInstanceId: "phinst_aaaa",
  });
  assert.match(invite.inviteUrl, /peer=/);
  const accepted = acceptInboundPeer(db, {
    peerId: invite.peerId,
    inviteToken: invite.inviteToken,
    remoteSignalingUrl: "https://b.example",
    remoteInstanceId: "phinst_bbbb",
  });
  assert.equal(accepted.ok, true);
  const peers = listPeerServers(db);
  assert.equal(peers[0]?.trusted, 1);
  assert.equal(peers[0]?.signaling_url, "https://b.example");

  db.prepare(
    `INSERT INTO allowlist (id, household_id, target_line_id, label, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run("al2", "hhx", "peer:p1:line9", "Remote kid", new Date().toISOString());
  assert.equal(localAllowlistAllows(db, "hhx", "peer:p1:line9"), true);
  assert.equal(localAllowlistAllows(db, "hhx", "other"), false);
});
