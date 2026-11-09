import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { addLine, createHousehold, registerParent } from "./api.js";
import { openDb } from "./db.js";
import {
  filterIosWakeTokensExcludingCallerLine,
  listAndroidTokensForLine,
  listIosAlertTokensForLine,
  listIosVoipReceivingLineIds,
  replaceAndroidTokenLines,
  replaceIosAlertTokenLines,
  replaceIosVoipTokenLines,
  upsertIosAlertToken,
  upsertIosVoipToken,
} from "./pushDevices.js";

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "phonehome-push-"));
  return openDb(path.join(dir, "test.db"));
}

test("parent PushKit token follows personal line, not active managed child line", () => {
  const db = tmpDb();
  const parent = registerParent(db, "Parent");
  const child = registerParent(db, "Child");
  const household = createHousehold(db, parent.user.id, "Family");
  const parentLine = addLine(db, household.id, parent.user.id, "Parent phone");
  const childLine = addLine(db, household.id, parent.user.id, "Kid", "softphone", {
    mode: "child",
  });
  db.prepare(`UPDATE lines SET child_user_id = ? WHERE id = ?`).run(child.user.id, childLine.id);

  assert.deepEqual(listIosVoipReceivingLineIds(db, parent.user.id), [parentLine.id]);
  assert.deepEqual(listIosVoipReceivingLineIds(db, child.user.id), [childLine.id]);

  const token = "a".repeat(64);
  // Simulate the old active-line bug, then register again as the parent.
  upsertIosVoipToken(db, {
    userId: parent.user.id,
    lineId: childLine.id,
    voipToken: token,
  });
  replaceIosVoipTokenLines(db, {
    userId: parent.user.id,
    lineIds: listIosVoipReceivingLineIds(db, parent.user.id),
    voipToken: token,
  });

  const rows = db
    .prepare(
      `SELECT user_id, line_id FROM push_devices
       WHERE platform = 'ios' AND voip_token = ? ORDER BY line_id`
    )
    .all(token) as { user_id: string; line_id: string }[];
  assert.deepEqual(rows, [{ user_id: parent.user.id, line_id: parentLine.id }]);
});

test("one PushKit token can wake multiple personal parent identities", () => {
  const db = tmpDb();
  const parent = registerParent(db, "Parent");
  const first = createHousehold(db, parent.user.id, "One");
  const second = createHousehold(db, parent.user.id, "Two");
  const lineA = addLine(db, first.id, parent.user.id, "Phone A");
  const lineB = addLine(db, second.id, parent.user.id, "Phone B");
  const lineIds = listIosVoipReceivingLineIds(db, parent.user.id);

  assert.deepEqual(lineIds, [lineA.id, lineB.id]);
  const rows = replaceIosVoipTokenLines(db, {
    userId: parent.user.id,
    lineIds,
    voipToken: "b".repeat(64),
  });
  assert.deepEqual(
    rows.map((row) => row.line_id),
    [lineA.id, lineB.id]
  );
});

test("parent alert APNs token follows personal line, not managed child line", () => {
  const db = tmpDb();
  const parent = registerParent(db, "Parent");
  const child = registerParent(db, "Child");
  const household = createHousehold(db, parent.user.id, "Family");
  const parentLine = addLine(db, household.id, parent.user.id, "Parent phone");
  const childLine = addLine(db, household.id, parent.user.id, "Kid", "softphone", {
    mode: "child",
  });
  db.prepare(`UPDATE lines SET child_user_id = ? WHERE id = ?`).run(child.user.id, childLine.id);

  const token = "c".repeat(64);
  upsertIosAlertToken(db, {
    userId: parent.user.id,
    lineId: childLine.id,
    apnsToken: token,
  });
  replaceIosAlertTokenLines(db, {
    userId: parent.user.id,
    lineIds: listIosVoipReceivingLineIds(db, parent.user.id),
    apnsToken: token,
  });

  assert.deepEqual(listIosAlertTokensForLine(db, childLine.id), []);
  assert.equal(listIosAlertTokensForLine(db, parentLine.id).length, 1);
});

test("callee wake skips tokens that also ring the caller line", () => {
  const db = tmpDb();
  const parent = registerParent(db, "Parent");
  const household = createHousehold(db, parent.user.id, "Family");
  const parentLine = addLine(db, household.id, parent.user.id, "Parent phone");
  const childLine = addLine(db, household.id, parent.user.id, "Kid", "softphone", {
    mode: "child",
  });
  const token = "d".repeat(64);
  upsertIosAlertToken(db, { userId: parent.user.id, lineId: parentLine.id, apnsToken: token });
  upsertIosAlertToken(db, { userId: parent.user.id, lineId: childLine.id, apnsToken: token });
  const calleeTokens = listIosAlertTokensForLine(db, childLine.id);
  const filtered = filterIosWakeTokensExcludingCallerLine(db, calleeTokens, parentLine.id);
  assert.equal(filtered.length, 0);
});

test("android FCM token keeps case and colon and follows the personal line", () => {
  const db = tmpDb();
  const parent = registerParent(db, "Parent");
  const household = createHousehold(db, parent.user.id, "Family");
  const parentLine = addLine(db, household.id, parent.user.id, "Parent phone");
  const token = "dEaDbEeF:android_token.example-1";
  const rows = replaceAndroidTokenLines(db, {
    userId: parent.user.id,
    lineIds: listIosVoipReceivingLineIds(db, parent.user.id),
    fcmToken: token,
  });
  assert.equal(rows[0]?.voip_token, token);
  assert.equal(listAndroidTokensForLine(db, parentLine.id)[0]?.voip_token, token);
  const shared = listAndroidTokensForLine(db, parentLine.id);
  upsertAndroidOnChild(db, parent.user.id, parentLine.id, token);
  const filtered = filterIosWakeTokensExcludingCallerLine(
    db,
    listAndroidTokensForLine(db, parentLine.id),
    parentLine.id
  );
  assert.equal(shared.length, 1);
  assert.equal(filtered.length, 0);
});

function upsertAndroidOnChild(
  db: ReturnType<typeof tmpDb>,
  userId: string,
  lineId: string,
  token: string
) {
  replaceAndroidTokenLines(db, { userId, lineIds: [lineId], fcmToken: token });
}
