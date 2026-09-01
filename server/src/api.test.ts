import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  addAllowlist,
  addGuardianByUsername,
  addLine,
  adminResetPassword,
  canCall,
  canManageChild,
  canManageHouseholdChildState,
  createGuardianInvite,
  createHousehold,
  createInvite,
  declineAllowlist,
  endCallLog,
  expireStaleRings,
  RING_TIMEOUT_MS,
  hashPassword,
  householdSnapshot,
  isInQuietWindow,
  linePresenceOnline,
  isChildOnlyAccount,
  leaveVoicemailForContact,
  deleteVoicemail,
  deleteVoicemails,
  MAX_VOICEMAILS_PER_HOUSEHOLD,
  listDeclinedLineIds,
  logCall,
  loginWithPassword,
  markCallAnswered,
  minutesUsedToday,
  formatTalkDuration,
  talkDurationMs,
  publicUser,
  redeemGuardianInvite,
  redeemInvite,
  registerParent,
  provisionGrandparent,
  resetProvisionedRelativePassword,
  updateProvisionedRelativeLogin,
  canViewerSeeLine,
  ensureSphereForParent,
  removeGuardian,
  resetChildPasswordByGuardian,
  setChildLineLogin,
  setLineGreeting,
  clearLineGreeting,
  confirmLineGreeting,
  canEditLineGreeting,
  canEditLineAvatar,
  setLineAvatar,
  clearLineAvatar,
  setUserCredentials,
  updateAllowlistEntry,
  updateHouseholdRules,
  updateLine,
  verifyParentPin,
  verifyPassword,
  hashPin,
  upsertAtaDevice,
  allocateNextSipExtension,
  getAtaByLineId,
  ataConfigXmlForDevice,
  resolveAtaDial,
  resolveAtaMailbox,
  listAtaMailboxMessages,
  routeCallTarget,
  createBridgeSession,
  householdHomeParentLine,
  householdAdminParentLine,
  householdSecondaryParentLine,
  updateUserProfile,
  parentDisplayLabel,
  peerLabelForHousehold,
  canJoinAdultFamilyRoom,
  addAdultFamilyRoomMember,
  listFamilyRoomChoicesForLine,
  deleteChildLine,
  deleteParentAccount,
  canJoinFamilyRoom,
  isFamilyRoomAdminAlwaysAllowed,
  listFamilyRoomAlwaysAllowedLineIds,
  addFamilyRoomMember,
  removeFamilyRoomMember,
  addFamilyRoomTalkPair,
  canTalkInFamilyRoom,
  wipeLineCascade,
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

test("cannot call own line; same-household contacts allowed except self-call", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const hh = createHousehold(db, a.user.id, "House");
  const lineA = addLine(db, hh.id, a.user.id, "A phone");
  const lineB = addLine(db, hh.id, a.user.id, "Kid phone");

  assert.equal(canCall(db, lineA.id, lineA.id).ok, false);
  // Parent ↔ child speed dial: other same-household lines may be allowlisted.
  const kid = addAllowlist(db, hh.id, lineB.id, "Kid");
  assert.equal(kid.target_line_id, lineB.id);
  assert.equal(canCall(db, lineA.id, lineB.id).ok, true);
  assert.equal(canCall(db, lineB.id, lineA.id).ok, true);

  // A line may also appear on the household allowlist (parent dialing kid); snapshot keeps it.
  // Softphones filter target === activeLineId; canCall still blocks self.
  const self = addAllowlist(db, hh.id, lineA.id, "Me", { speedDial: 9 });
  assert.equal(self.target_line_id, lineA.id);
  const snap = householdSnapshot(db, a.user.id);
  assert.equal(
    snap.households[0].allowlist.some((x: { target_line_id: string }) => x.target_line_id === lineB.id),
    true
  );
  assert.equal(
    snap.households[0].allowlist.some((x: { target_line_id: string }) => x.target_line_id === lineA.id),
    true
  );
  assert.equal(canCall(db, lineA.id, lineA.id).ok, false);
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
  updateLine(db, hhB.id, lineB.id, { mode: "child", child_label: "Kid B" }, { actorUserId: b.user.id });
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

test("ATA presence online outside quiet hours; softphone always counts", () => {
  const open = {
    dnd: 0,
    quiet_start: null as string | null,
    quiet_end: null as string | null,
    quiet_tz: null as string | null,
  };
  assert.equal(
    linePresenceOnline({ softphoneOnline: false, ataRegistered: true, household: open }),
    true
  );
  assert.equal(
    linePresenceOnline({ softphoneOnline: false, ataRegistered: false, household: open }),
    false
  );
  assert.equal(
    linePresenceOnline({ softphoneOnline: true, ataRegistered: false, household: open }),
    true
  );
  assert.equal(
    linePresenceOnline({
      softphoneOnline: false,
      ataRegistered: true,
      household: { ...open, dnd: 1 },
    }),
    false
  );
  // 03:00 UTC = 19:00 PST — outside 21:00–07:00 quiet
  const eveningPst = new Date("2026-01-15T03:00:00.000Z");
  assert.equal(
    linePresenceOnline({
      softphoneOnline: false,
      ataRegistered: true,
      household: {
        dnd: 0,
        quiet_start: "21:00",
        quiet_end: "07:00",
        quiet_tz: "America/Los_Angeles",
      },
      now: eveningPst,
    }),
    true
  );
  // 06:00 UTC = 22:00 PST — inside quiet
  const nightPst = new Date("2026-01-15T06:00:00.000Z");
  assert.equal(
    linePresenceOnline({
      softphoneOnline: false,
      ataRegistered: true,
      household: {
        dnd: 0,
        quiet_start: "21:00",
        quiet_end: "07:00",
        quiet_tz: "America/Los_Angeles",
      },
      now: nightPst,
    }),
    false
  );
  // Softphone tab still shows online during quiet hours
  assert.equal(
    linePresenceOnline({
      softphoneOnline: true,
      ataRegistered: true,
      household: {
        dnd: 0,
        quiet_start: "21:00",
        quiet_end: "07:00",
        quiet_tz: "America/Los_Angeles",
      },
      now: nightPst,
    }),
    true
  );
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

test("talkDurationMs uses answered→hangup only; formatTalkDuration is m:ss", () => {
  assert.equal(
    talkDurationMs({
      outcome: "completed",
      answered_at: "2026-08-14T18:02:00.000Z",
      ended_at: "2026-08-14T18:04:05.000Z",
    }),
    125_000
  );
  assert.equal(formatTalkDuration(125_000), "2:05");
  assert.equal(formatTalkDuration(5_000), "0:05");

  // Missed / blocked must not invent a duration from ring start→end
  assert.equal(
    talkDurationMs({
      outcome: "missed",
      answered_at: null,
      ended_at: "2026-08-14T18:00:40.000Z",
    }),
    null
  );
  assert.equal(
    talkDurationMs({
      outcome: "completed",
      answered_at: null,
      ended_at: "2026-08-14T18:03:00.000Z",
    }),
    null
  );

  // Live answered: answered → now
  const live = talkDurationMs(
    { outcome: "answered", answered_at: "2026-08-14T18:00:00.000Z", ended_at: null },
    new Date("2026-08-14T18:01:30.000Z").getTime()
  );
  assert.equal(live, 90_000);
  assert.equal(formatTalkDuration(live!), "1:30");
});

test("talk today counts connected time in household TZ, not ringing or orphan answered", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const b = registerParent(db, "B");
  const hhA = createHousehold(db, a.user.id, "House A");
  const hhB = createHousehold(db, b.user.id, "House B");
  updateHouseholdRules(db, hhA.id, { quiet_tz: "America/New_York" });
  const lineA = addLine(db, hhA.id, a.user.id, "A phone");
  const lineB = addLine(db, hhB.id, b.user.id, "B phone");

  // Ring for 2 minutes then connect for 90 seconds — usage should be ~2 min (90s rounded), not 3+.
  const call = logCall(db, lineA.id, lineB.id, "ringing");
  db.prepare(`UPDATE call_logs SET started_at = ? WHERE id = ?`).run(
    "2026-08-14T18:00:00.000Z",
    call.id
  );
  markCallAnswered(db, call.id);
  db.prepare(`UPDATE call_logs SET answered_at = ?, ended_at = ?, outcome = 'completed' WHERE id = ?`).run(
    "2026-08-14T18:02:00.000Z",
    "2026-08-14T18:03:30.000Z",
    call.id
  );

  // Missed ring must not count
  const missed = logCall(db, lineA.id, lineB.id, "ringing");
  db.prepare(
    `UPDATE call_logs SET started_at = ?, ended_at = ?, outcome = 'missed' WHERE id = ?`
  ).run("2026-08-14T19:00:00.000Z", "2026-08-14T19:00:40.000Z", missed.id);

  // Orphan answered without answered_at (pre-fix stuck) finalizes to 0 talk
  const orphan = logCall(db, lineA.id, lineB.id, "ringing");
  db.prepare(`UPDATE call_logs SET started_at = ?, outcome = 'answered', ended_at = NULL WHERE id = ?`).run(
    "2026-08-14T12:00:00.000Z",
    orphan.id
  );

  const now = new Date("2026-08-14T20:00:00.000Z"); // afternoon ET
  assert.equal(minutesUsedToday(db, hhA.id, now), 2);

  const orphanRow = db.prepare(`SELECT outcome, ended_at FROM call_logs WHERE id = ?`).get(orphan.id) as {
    outcome: string;
    ended_at: string;
  };
  assert.equal(orphanRow.outcome, "completed");
  assert.equal(orphanRow.ended_at, "2026-08-14T12:00:00.000Z");
});

test("ring timeout expires unanswered calls as missed (voicemail path)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const b = registerParent(db, "B");
  const hhA = createHousehold(db, a.user.id, "House A");
  const hhB = createHousehold(db, b.user.id, "House B");
  const lineA = addLine(db, hhA.id, a.user.id, "A phone");
  const lineB = addLine(db, hhB.id, b.user.id, "B phone");

  const fresh = logCall(db, lineA.id, lineB.id, "ringing");
  assert.equal(expireStaleRings(db, RING_TIMEOUT_MS).length, 0);

  const stale = logCall(db, lineA.id, lineB.id, "ringing");
  const old = new Date(Date.now() - RING_TIMEOUT_MS - 1000).toISOString();
  db.prepare(`UPDATE call_logs SET started_at = ? WHERE id = ?`).run(old, stale.id);

  const expired = expireStaleRings(db, RING_TIMEOUT_MS);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].id, stale.id);
  assert.equal(expired[0].from_line_id, lineA.id);
  assert.equal(expired[0].to_line_id, lineB.id);

  const row = db.prepare(`SELECT outcome, ended_at FROM call_logs WHERE id = ?`).get(stale.id) as {
    outcome: string;
    ended_at: string | null;
  };
  assert.equal(row.outcome, "missed");
  assert.ok(row.ended_at);

  const stillRinging = db.prepare(`SELECT outcome FROM call_logs WHERE id = ?`).get(fresh.id) as {
    outcome: string;
  };
  assert.equal(stillRinging.outcome, "ringing");

  // Client no-answer hangup also marks missed (not cancelled).
  const timedOut = logCall(db, lineA.id, lineB.id, "ringing");
  endCallLog(db, timedOut.id, "missed");
  const missed = db.prepare(`SELECT outcome FROM call_logs WHERE id = ?`).get(timedOut.id) as {
    outcome: string;
  };
  assert.equal(missed.outcome, "missed");
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

test("child accounts cannot create family invites", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const parent = registerParent(db, "Parent", { username: "paruser", password: "password1" });
  const kid = registerParent(db, "Kid", { username: "kiduser", password: "password1" });
  const hh = createHousehold(db, parent.user.id, "Family");
  addLine(db, hh.id, parent.user.id, "Parent phone");
  db.prepare(`INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'member')`).run(
    hh.id,
    kid.user.id
  );
  const kidLine = addLine(db, hh.id, kid.user.id, "Kid phone");
  updateLine(db, hh.id, kidLine.id, { mode: "child", child_label: "Kid" }, { actorUserId: parent.user.id });

  assert.ok(createInvite(db, hh.id, parent.user.id));
  assert.throws(() => createInvite(db, hh.id, kid.user.id), /only parents/i);

  const login = setChildLineLogin(db, parent.user.id, kidLine.id, {
    username: "kidlogin",
    password: "password1",
  });
  assert.throws(() => createInvite(db, hh.id, login.childUser.id), /only parents/i);
  assert.throws(() => createGuardianInvite(db, kid.user.id, kidLine.id), /only parents/i);

  // Child login must see the household even without household_members.
  const childSnap = householdSnapshot(db, login.childUser.id);
  assert.equal(childSnap.households.length, 1);
  assert.equal(childSnap.households[0].id, hh.id);
  assert.ok(
    childSnap.households[0].lines.some(
      (l: { id: string; child_user_id?: string | null }) =>
        l.id === kidLine.id && l.child_user_id === login.childUser.id
    )
  );
  assert.equal(isChildOnlyAccount(db, login.childUser.id), true);
  assert.equal(isChildOnlyAccount(db, kid.user.id), true);
  assert.equal(canManageHouseholdChildState(db, kid.user.id, hh.id), false);
  assert.equal(canManageHouseholdChildState(db, login.childUser.id, hh.id), false);
  assert.equal(canManageHouseholdChildState(db, parent.user.id, hh.id), true);
  assert.throws(
    () => addAllowlist(db, hh.id, parent.user.id, "Nope", { actorUserId: kid.user.id }),
    /only parents/i
  );
  assert.equal(publicUser(login.childUser, { isChildOnly: true }).is_child_only, true);
  assert.equal(publicUser(parent.user, { isChildOnly: false }).is_child_only, false);
});

test("self-guardian on own child line still counts as child-only", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const parent = registerParent(db, "Parent", { username: "par3", password: "password1" });
  const kid = registerParent(db, "Gemma", { username: "gem3", password: "password1" });
  const hh = createHousehold(db, parent.user.id, "Larsen");
  addLine(db, hh.id, parent.user.id, "Parent phone");
  db.prepare(`INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'member')`).run(
    hh.id,
    kid.user.id
  );
  const kidLine = addLine(db, hh.id, kid.user.id, "Gemma phone");
  updateLine(db, hh.id, kidLine.id, { mode: "child", child_label: "Gemma" }, { actorUserId: parent.user.id });
  // Mis-linked: kid listed as guardian of their own line (lab bug).
  db.prepare(
    `INSERT OR IGNORE INTO child_guardians (line_id, user_id, role, created_at) VALUES (?, ?, 'guardian', ?)`
  ).run(kidLine.id, kid.user.id, new Date().toISOString());
  assert.equal(isChildOnlyAccount(db, kid.user.id), true);
  assert.equal(isChildOnlyAccount(db, parent.user.id), false);
});

test("Quiet Time blocks unless VIP always_allow", () => {
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

  updateHouseholdRules(db, hhB.id, { dnd: true });
  const blocked = canCall(db, lineA.id, lineB.id);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.voice, "quiet");
    assert.match(blocked.spoken, /Quiet Time/i);
  }

  const entry = db
    .prepare(`SELECT id FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
    .get(hhB.id, lineA.id) as { id: string };
  updateAllowlistEntry(db, hhB.id, entry.id, { always_allow: true });
  assert.equal(canCall(db, lineA.id, lineB.id).ok, true);
});

test("School preset sets weekdays + holiday skip; canCall voice is school", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const b = registerParent(db, "B");
  const hhA = createHousehold(db, a.user.id, "House A");
  const hhB = createHousehold(db, b.user.id, "House B");
  const lineA = addLine(db, hhA.id, a.user.id, "A phone");
  const lineB = addLine(db, hhB.id, b.user.id, "B phone");
  updateLine(db, hhB.id, lineB.id, { mode: "child", child_label: "Kid B" }, { actorUserId: b.user.id });
  addAllowlist(db, hhA.id, lineB.id, "B");
  addAllowlist(db, hhB.id, lineA.id, "A");

  const saved = updateHouseholdRules(db, hhB.id, {
    schedule_preset: "school",
    quiet_tz: "America/Chicago",
  });
  assert.equal(saved.quiet_days, "1,2,3,4,5");
  assert.equal(saved.skip_holidays, 1);
  assert.equal(saved.quiet_start, "08:00");

  const wedSchool = new Date("2026-08-19T15:00:00.000Z"); // Wed 10:00 CT
  const blocked = canCall(db, lineA.id, lineB.id, wedSchool);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.voice, "school");
    assert.match(blocked.spoken, /at school/i);
  }

  const sat = new Date("2026-08-22T15:00:00.000Z");
  assert.equal(canCall(db, lineA.id, lineB.id, sat).ok, true);
});

test("kid bedtime does not silence parent phones; parent DND is inbound only", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const b = registerParent(db, "B");
  const hhA = createHousehold(db, a.user.id, "House A");
  const hhB = createHousehold(db, b.user.id, "House B");
  const parentA = addLine(db, hhA.id, a.user.id, "Parent A");
  const parentB = addLine(db, hhB.id, b.user.id, "Parent B");
  const kidB = addLine(db, hhB.id, b.user.id, "Kid B");
  updateLine(db, hhB.id, kidB.id, { mode: "child", child_label: "Kid B" }, { actorUserId: b.user.id });
  addAllowlist(db, hhA.id, parentB.id, "Parent B");
  addAllowlist(db, hhA.id, kidB.id, "Kid B");
  addAllowlist(db, hhB.id, parentA.id, "Parent A");

  const night = new Date("2026-01-15T06:00:00.000Z"); // 22:00 PST
  updateHouseholdRules(db, hhB.id, {
    schedule_preset: "bedtime",
    quiet_tz: "America/Los_Angeles",
  });
  assert.equal(canCall(db, parentA.id, kidB.id, night).ok, false);
  assert.equal(canCall(db, parentA.id, parentB.id, night).ok, true);

  updateHouseholdRules(db, hhB.id, {
    parent_schedule_preset: "evenings",
    parent_quiet_tz: "America/Los_Angeles",
  });
  const toParent = canCall(db, parentA.id, parentB.id, night);
  assert.equal(toParent.ok, false);
  if (!toParent.ok) assert.match(toParent.reason, /Do Not Disturb/i);
  assert.equal(canCall(db, parentB.id, parentA.id, night).ok, true);
});

test("parent can leave voicemail for same-household kid without allowlist", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const parent = registerParent(db, "Trevor");
  const hh = createHousehold(db, parent.user.id, "Home");
  const parentLine = addLine(db, hh.id, parent.user.id, "Trevor's phone");
  const kidLine = addLine(db, hh.id, parent.user.id, "Gemma's phone");
  // No allowlist rows — canCall allows same household; deposit must too.
  assert.equal(canCall(db, parentLine.id, kidLine.id).ok, true);
  const vm = leaveVoicemailForContact(db, parent.user.id, parentLine.id, kidLine.id, "", {
    audioBase64: Buffer.alloc(128, 1).toString("base64"),
    audioMime: "audio/webm",
    dataDir: dir,
  });
  assert.equal(vm.household_id, hh.id);
  assert.equal(vm.from_line_id, parentLine.id);
  assert.equal(vm.to_line_id, kidLine.id);
  assert.ok(fs.existsSync(path.join(dir, vm.audio_path!)));
  // Same household: message is for the kid mailbox only — parent line must not list it as theirs.
  const snap = householdSnapshot(db, parent.user.id);
  const vms = snap.households[0].voicemails as { id: string; to_line_id: string }[];
  assert.equal(vms.length, 1);
  assert.equal(vms[0].to_line_id, kidLine.id);
  assert.equal(listAtaMailboxMessages(db, kidLine.id).length, 1);
  assert.equal(listAtaMailboxMessages(db, parentLine.id).length, 0);
});

test("cross-household leave voicemail still requires allowlist", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const b = registerParent(db, "B");
  const hhA = createHousehold(db, a.user.id, "House A");
  const hhB = createHousehold(db, b.user.id, "House B");
  const lineA = addLine(db, hhA.id, a.user.id, "A phone");
  const lineB = addLine(db, hhB.id, b.user.id, "B phone");
  assert.throws(
    () =>
      leaveVoicemailForContact(db, a.user.id, lineA.id, lineB.id, "", {
        audioBase64: Buffer.alloc(128, 1).toString("base64"),
        audioMime: "audio/webm",
        dataDir: dir,
      }),
    /Contact not approved/i
  );
  addAllowlist(db, hhA.id, lineB.id, "Cousin");
  const vm = leaveVoicemailForContact(db, a.user.id, lineA.id, lineB.id, "", {
    audioBase64: Buffer.alloc(128, 1).toString("base64"),
    audioMime: "audio/webm",
    dataDir: dir,
  });
  assert.equal(vm.household_id, hhB.id);
});

test("leave voicemail and mutual badge in snapshot", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const b = registerParent(db, "B");
  const hhA = createHousehold(db, a.user.id, "House A");
  const hhB = createHousehold(db, b.user.id, "House B");
  const lineA = addLine(db, hhA.id, a.user.id, "A phone");
  const lineB = addLine(db, hhB.id, b.user.id, "B phone");
  addAllowlist(db, hhA.id, lineB.id, "Cousin");
  addAllowlist(db, hhB.id, lineA.id, "A");

  const vm = leaveVoicemailForContact(db, a.user.id, lineA.id, lineB.id, "", {
    audioBase64: Buffer.alloc(128, 1).toString("base64"),
    audioMime: "audio/webm",
    dataDir: dir,
  });
  assert.equal(vm.household_id, hhB.id);
  assert.equal(vm.body, "(voicemail)");
  assert.ok(vm.audio_path);
  assert.equal(vm.from_line_id, lineA.id);
  assert.equal(vm.to_line_id, lineB.id);
  // Fanout (WS voicemail.new) must target to_line_id only (skip from_line_id);
  // see fanoutVoicemailNew in index.ts.
  const audioAbs = path.join(dir, vm.audio_path);
  assert.ok(fs.existsSync(audioAbs));

  assert.throws(
    () => leaveVoicemailForContact(db, a.user.id, lineA.id, lineB.id, "text only note"),
    /voice message/i
  );

  const deleted = deleteVoicemail(db, hhB.id, vm.id, dir);
  assert.equal(deleted.id, vm.id);
  assert.equal(fs.existsSync(audioAbs), false);
  const gone = db.prepare(`SELECT 1 FROM voicemails WHERE id = ?`).get(vm.id);
  assert.equal(gone, undefined);
  assert.throws(() => deleteVoicemail(db, hhB.id, vm.id, dir), /not found/i);

  const bulkIds: string[] = [];
  const paths: string[] = [];
  for (let i = 0; i < 3; i++) {
    const m = leaveVoicemailForContact(db, a.user.id, lineA.id, lineB.id, "", {
      audioBase64: Buffer.alloc(128, 1).toString("base64"),
      audioMime: "audio/webm",
      dataDir: dir,
    });
    bulkIds.push(m.id);
    paths.push(path.join(dir, m.audio_path!));
  }
  assert.throws(() => deleteVoicemails(db, hhB.id, [], dir), /at least one/i);
  assert.throws(() => deleteVoicemails(db, hhB.id, "nope" as unknown as string[], dir), /array/i);
  const bulk = deleteVoicemails(db, hhB.id, [bulkIds[0], bulkIds[1], "missing-id", bulkIds[0]], dir);
  assert.deepEqual(bulk.deleted, [bulkIds[0], bulkIds[1]]);
  assert.equal(fs.existsSync(paths[0]), false);
  assert.equal(fs.existsSync(paths[1]), false);
  assert.ok(fs.existsSync(paths[2]));
  assert.ok(db.prepare(`SELECT 1 FROM voicemails WHERE id = ?`).get(bulkIds[2]));
  deleteVoicemails(db, hhB.id, [bulkIds[2]], dir);

  const snap = householdSnapshot(db, a.user.id);
  const contact = snap.households[0].allowlist.find((x: { target_line_id: string }) => x.target_line_id === lineB.id);
  assert.ok(contact);
  assert.equal(contact.mutual, true);
});

test("answering machine caps stored messages", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const b = registerParent(db, "B");
  const hhA = createHousehold(db, a.user.id, "House A");
  const hhB = createHousehold(db, b.user.id, "House B");
  const lineA = addLine(db, hhA.id, a.user.id, "A phone");
  const lineB = addLine(db, hhB.id, b.user.id, "B phone");
  addAllowlist(db, hhA.id, lineB.id, "Cousin");

  const tiny = Buffer.alloc(128, 1).toString("base64");
  const ids: string[] = [];
  for (let i = 0; i < MAX_VOICEMAILS_PER_HOUSEHOLD; i++) {
    const vm = leaveVoicemailForContact(db, a.user.id, lineA.id, lineB.id, "", {
      audioBase64: tiny,
      audioMime: "audio/webm",
      dataDir: dir,
    });
    ids.push(vm.id);
  }
  // All new — machine full until something is erased or heard+overwritten.
  assert.throws(
    () =>
      leaveVoicemailForContact(db, a.user.id, lineA.id, lineB.id, "", {
        audioBase64: tiny,
        audioMime: "audio/webm",
        dataDir: dir,
      }),
    /full/i
  );
  // Mark oldest heard, then a new message should reclaim that slot.
  db.prepare(`UPDATE voicemails SET listened = 1 WHERE id = ?`).run(ids[0]);
  const next = leaveVoicemailForContact(db, a.user.id, lineA.id, lineB.id, "", {
    audioBase64: tiny,
    audioMime: "audio/webm",
    dataDir: dir,
  });
  assert.ok(next.id);
  const count = db
    .prepare(`SELECT COUNT(*) AS n FROM voicemails WHERE household_id = ?`)
    .get(hhB.id) as { n: number };
  assert.equal(count.n, MAX_VOICEMAILS_PER_HOUSEHOLD);
  assert.equal(db.prepare(`SELECT 1 FROM voicemails WHERE id = ?`).get(ids[0]), undefined);
});

test("register/login with username password and scrypt hash", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const reg = registerParent(db, "Trevor", { username: "Trevor", password: "secret123" });
  assert.equal(reg.user.username, "trevor");
  assert.ok(reg.user.password_hash?.startsWith("scrypt$"));
  assert.equal(verifyPassword("secret123", reg.user.password_hash), true);
  assert.equal(verifyPassword("wrong", reg.user.password_hash), false);

  const pub = publicUser(reg.user);
  assert.equal(pub.has_password, true);
  assert.equal(pub.username, "trevor");
  assert.equal((pub as { password_hash?: string }).password_hash, undefined);

  const login = loginWithPassword(db, "trevor", "secret123");
  assert.equal(login.user.id, reg.user.id);
  assert.equal(loginWithPassword(db, "Trevor", "secret123").user.id, reg.user.id);
  assert.equal(loginWithPassword(db, "TREVOR", "secret123").user.id, reg.user.id);
  assert.throws(() => loginWithPassword(db, "trevor", "nope"));
  assert.throws(() =>
    registerParent(db, "Other", { username: "trevor", password: "another12" })
  );
  assert.throws(() =>
    registerParent(db, "Other", { username: "TREVOR", password: "another12" })
  );
});

test("login matches legacy mixed-case username rows", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  // Simulate a pre-normalize row still in the DB (exact casing as stored before migrate).
  // openDb canonicalizes on open, so insert after open then force mixed case.
  const reg = registerParent(db, "Host Parent", { username: "legacyuser", password: "secret123" });
  db.prepare(`UPDATE users SET username = ? WHERE id = ?`).run("LegacyUser", reg.user.id);

  assert.equal(loginWithPassword(db, "legacyuser", "secret123").user.id, reg.user.id);
  assert.equal(loginWithPassword(db, "LegacyUser", "secret123").user.id, reg.user.id);
  assert.equal(loginWithPassword(db, "LEGACYUSER", "secret123").user.id, reg.user.id);
  assert.throws(() =>
    registerParent(db, "Clash", { username: "LegacyUser", password: "another12" })
  );

  adminResetPassword(db, "LEGACYUSER", "resetpass1");
  assert.equal(loginWithPassword(db, "legacyUser", "resetpass1").user.id, reg.user.id);
});

test("display_name stays separate from lowercase login key", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const reg = registerParent(db, "Trevor Lars", { username: "Trevor", password: "secret123" });
  assert.equal(reg.user.username, "trevor");
  assert.equal(reg.user.display_name, "Trevor Lars");
  const again = loginWithPassword(db, "TREVOR", "secret123");
  assert.equal(again.user.display_name, "Trevor Lars");
  assert.equal(again.user.username, "trevor");
});

test("set credentials and admin reset password", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const reg = registerParent(db, "Host");
  const updated = setUserCredentials(db, reg.user.id, {
    username: "hostparent",
    password: "newpass99",
  });
  assert.equal(updated.username, "hostparent");
  assert.equal(verifyPassword("newpass99", updated.password_hash), true);

  adminResetPassword(db, "hostparent", "resetpass1");
  const again = loginWithPassword(db, "hostparent", "resetpass1");
  assert.equal(again.user.id, reg.user.id);

  const hashed = hashPassword("plainplain");
  assert.ok(hashed.startsWith("scrypt$"));
  assert.equal(verifyPassword("plainplain", hashed), true);
});

test("parent PIN set verify clear and trim", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const hh = createHousehold(db, a.user.id, "House A");
  assert.equal(verifyParentPin(hh, "1234"), true); // no pin yet → open

  const withPin = updateHouseholdRules(db, hh.id, { parent_pin: " 2468 " });
  assert.ok(withPin.parent_pin_hash);
  assert.equal(withPin.parent_pin_hash, hashPin("2468"));
  assert.equal(verifyParentPin(withPin, "2468"), true);
  assert.equal(verifyParentPin(withPin, " 2468 "), true);
  assert.equal(verifyParentPin(withPin, "0000"), false);
  assert.equal(verifyParentPin(withPin, ""), false);

  assert.throws(() => updateHouseholdRules(db, hh.id, { parent_pin: "12" }));
  assert.throws(() => updateHouseholdRules(db, hh.id, { parent_pin: "abcdef" }));

  const cleared = updateHouseholdRules(db, hh.id, { parent_pin: null });
  assert.equal(cleared.parent_pin_hash, null);
  assert.equal(verifyParentPin(cleared, "anything"), true);

  const snap = householdSnapshot(db, a.user.id);
  assert.equal(snap.households[0].has_parent_pin, false);
  assert.equal((snap.households[0] as { parent_pin_hash?: string }).parent_pin_hash, undefined);
});

test("addLine can create a child line directly", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const hh = createHousehold(db, a.user.id, "House A");
  addLine(db, hh.id, a.user.id, "A phone");
  const kid = addLine(db, hh.id, a.user.id, "Maya", "softphone", {
    mode: "child",
    child_label: "Maya",
  });
  assert.equal(kid.mode, "child");
  assert.equal(kid.child_label, "Maya");
  assert.equal(kid.name, "Maya");

  const snap = householdSnapshot(db, a.user.id);
  const listed = snap.households[0].lines.find((l: { id: string }) => l.id === kid.id);
  assert.ok(listed);
  assert.equal(listed.mode, "child");
  assert.equal(listed.child_label, "Maya");
  assert.equal(listed.guardians.length, 1);
  assert.equal(listed.guardians[0].user_id, a.user.id);
  const parentStill = snap.households[0].lines.find((l: { name: string }) => l.name === "A phone");
  assert.equal(parentStill?.mode || "parent", "parent");
});

test("line child mode flag", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const hh = createHousehold(db, a.user.id, "House A");
  const line = addLine(db, hh.id, a.user.id, "Kitchen");
  assert.equal(line.mode || "parent", "parent");

  const child = updateLine(
    db,
    hh.id,
    line.id,
    { mode: "child", child_label: "Maya's phone" },
    { actorUserId: a.user.id }
  );
  assert.equal(child.mode, "child");
  assert.equal(child.child_label, "Maya's phone");

  const snap = householdSnapshot(db, a.user.id);
  const listed = snap.households[0].lines.find((l: { id: string }) => l.id === line.id);
  assert.ok(listed);
  assert.equal(listed.mode, "child");
  assert.equal(listed.child_label, "Maya's phone");
  assert.equal(listed.guardians.length, 1);
  assert.equal(listed.guardians[0].user_id, a.user.id);

  const back = updateLine(db, hh.id, line.id, { mode: "parent" });
  assert.equal(back.mode, "parent");
});

test("multi-parent guardianship add remove and permissions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const mom = registerParent(db, "Mom", { username: "momuser", password: "password1" });
  const dad = registerParent(db, "Dad", { username: "daduser", password: "password1" });
  const stranger = registerParent(db, "Stranger", { username: "stranger", password: "password1" });
  const hhMom = createHousehold(db, mom.user.id, "Mom House");
  createHousehold(db, dad.user.id, "Dad House");
  createHousehold(db, stranger.user.id, "Other");
  const childLine = addLine(db, hhMom.id, mom.user.id, "Maya phone");
  updateLine(db, hhMom.id, childLine.id, { mode: "child", child_label: "Maya" }, { actorUserId: mom.user.id });

  assert.equal(canManageChild(db, mom.user.id, childLine.id), true);
  assert.equal(canManageChild(db, dad.user.id, childLine.id), false);
  assert.equal(canManageChild(db, stranger.user.id, childLine.id), false);

  const g = addGuardianByUsername(db, mom.user.id, childLine.id, "daduser");
  assert.equal(g.username, "daduser");
  assert.equal(canManageChild(db, dad.user.id, childLine.id), true);
  assert.equal(canManageHouseholdChildState(db, dad.user.id, hhMom.id), true);
  assert.equal(canManageHouseholdChildState(db, stranger.user.id, hhMom.id), false);

  const dadSnap = householdSnapshot(db, dad.user.id);
  assert.ok(dadSnap.households.some((h: { id: string }) => h.id === hhMom.id));
  const guarded = dadSnap.households.find((h: { id: string }) => h.id === hhMom.id);
  assert.ok(guarded);
  assert.equal(guarded.access, "guardian");

  assert.throws(() => removeGuardian(db, stranger.user.id, childLine.id, dad.user.id));
  removeGuardian(db, mom.user.id, childLine.id, dad.user.id);
  assert.equal(canManageChild(db, dad.user.id, childLine.id), false);
  assert.throws(() => removeGuardian(db, mom.user.id, childLine.id, mom.user.id)); // last guardian
});

test("guardians and parents can edit child line avatar and greeting", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const mom = registerParent(db, "Mom", { username: "momav", password: "password1" });
  const dad = registerParent(db, "Dad", { username: "dadav", password: "password1" });
  const kid = registerParent(db, "Kid", { username: "kidav", password: "password1" });
  const hh = createHousehold(db, mom.user.id, "Home");
  createHousehold(db, dad.user.id, "Dad Home");
  const parentLine = addLine(db, hh.id, mom.user.id, "Mom phone");
  const childLine = addLine(db, hh.id, mom.user.id, "Maya phone");
  updateLine(db, hh.id, childLine.id, { mode: "child", child_label: "Maya" }, { actorUserId: mom.user.id });
  addGuardianByUsername(db, mom.user.id, childLine.id, "dadav");
  const { childUser } = setChildLineLogin(db, mom.user.id, childLine.id, {
    username: "maya.phone",
    password: "password1",
  });

  assert.equal(canEditLineGreeting(db, mom.user.id, childLine.id), true);
  assert.equal(canEditLineAvatar(db, mom.user.id, childLine.id), true);
  assert.equal(canEditLineGreeting(db, dad.user.id, childLine.id), true);
  assert.equal(canEditLineAvatar(db, dad.user.id, childLine.id), true);
  // Child login may personalize their own line; not the parent line.
  assert.equal(canEditLineGreeting(db, childUser.id, childLine.id), true);
  assert.equal(canEditLineAvatar(db, childUser.id, childLine.id), true);
  assert.equal(canEditLineGreeting(db, childUser.id, parentLine.id), false);
  assert.equal(canEditLineGreeting(db, kid.user.id, childLine.id), false);
});

test("guardian invite redeem and child password reset", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const mom = registerParent(db, "Mom", { username: "mom2", password: "password1" });
  const dad = registerParent(db, "Dad", { username: "dad2", password: "password1" });
  const hh = createHousehold(db, mom.user.id, "House");
  createHousehold(db, dad.user.id, "Dad House");
  const line = addLine(db, hh.id, mom.user.id, "Kid");
  updateLine(db, hh.id, line.id, { mode: "child" }, { actorUserId: mom.user.id });

  const invite = createGuardianInvite(db, mom.user.id, line.id);
  const redeemed = redeemGuardianInvite(db, dad.user.id, invite.code);
  assert.equal(redeemed.guardians.some((g) => g.user_id === dad.user.id), true);
  assert.throws(() => redeemGuardianInvite(db, dad.user.id, invite.code));
  // Co-parent also joins the child's household as a member.
  assert.ok(
    db
      .prepare(`SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?`)
      .get(hh.id, dad.user.id)
  );

  assert.throws(() =>
    resetChildPasswordByGuardian(db, mom.user.id, line.id, "newpass99")
  );

  const created = setChildLineLogin(db, mom.user.id, line.id, {
    username: "mayakid",
    password: "firstpass1",
  });
  assert.equal(created.childUser.username, "mayakid");
  assert.ok(created.line.child_user_id);

  const reset = resetChildPasswordByGuardian(db, dad.user.id, line.id, "secondpass2");
  assert.match(reset.message, /password reset by parent/i);
  const login = loginWithPassword(db, "mayakid", "secondpass2");
  assert.equal(login.user.id, created.childUser.id);

  assert.throws(() =>
    resetChildPasswordByGuardian(
      db,
      registerParent(db, "Nope", { username: "nopeuser", password: "password1" }).user.id,
      line.id,
      "hacked999"
    )
  );
});

test("parent provisions grandparent login and kid mutual allowlist", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const mom = registerParent(db, "Mom", { username: "momgp", password: "password1" });
  const hh = createHousehold(db, mom.user.id, "Larsen");
  addLine(db, hh.id, mom.user.id, "Mom phone");
  const kid = addLine(db, hh.id, mom.user.id, "Gemma", "softphone", { mode: "child" });
  updateLine(db, hh.id, kid.id, { mode: "child" }, { actorUserId: mom.user.id });

  const created = provisionGrandparent(db, mom.user.id, hh.id, {
    displayName: "Grandma Larsen",
    username: "rhonda2",
    password: "16Monkeys!",
    label: "Grandma",
    kidLineIds: [kid.id],
  });
  assert.equal(created.username, "rhonda2");
  assert.equal(created.relative.profile_role, "grandparent");
  assert.deepEqual(created.relative.kid_line_ids, [kid.id]);

  const login = loginWithPassword(db, "rhonda2", "16Monkeys!");
  assert.equal(login.user.profile_role, "grandparent");

  const ok = canCall(db, kid.id, created.line.id);
  assert.equal(ok.ok, true);
  const back = canCall(db, created.line.id, kid.id);
  assert.equal(back.ok, true);

  const snap = householdSnapshot(db, mom.user.id);
  assert.equal(snap.households[0].provisioned_relatives.length, 1);
  assert.equal(snap.households[0].provisioned_relatives[0].username, "rhonda2");

  const reset = resetProvisionedRelativePassword(
    db,
    mom.user.id,
    hh.id,
    created.relative.id,
    "NewPass99!"
  );
  assert.match(reset.message, /password updated/i);
  const again = loginWithPassword(db, "rhonda2", "NewPass99!");
  assert.equal(again.user.id, login.user.id);

  assert.throws(() =>
    provisionGrandparent(db, mom.user.id, hh.id, {
      displayName: "Dup",
      username: "rhonda2",
      password: "password99",
      kidLineIds: [kid.id],
    })
  );

  const kid2 = addLine(db, hh.id, mom.user.id, "Owen", "softphone", { mode: "child" });
  updateLine(db, hh.id, kid2.id, { mode: "child" }, { actorUserId: mom.user.id });
  const updated = updateProvisionedRelativeLogin(db, mom.user.id, hh.id, created.relative.id, {
    displayName: "Grandma Rhonda",
    label: "Nana",
    kidLineIds: [kid2.id],
  });
  assert.equal(updated.relative.display_name, "Grandma Rhonda");
  assert.equal(updated.relative.display_label, "Nana");
  assert.deepEqual(updated.relative.kid_line_ids, [kid2.id]);
  assert.equal(canCall(db, created.line.id, kid.id).ok, false);
  assert.equal(canCall(db, created.line.id, kid2.id).ok, true);
});

test("directory does not leak other invitees in the host circle to grandparents", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const mom = registerParent(db, "Mom", { username: "momdir", password: "password1" });
  const cousin = registerParent(db, "Cousin", { username: "cousindir", password: "password1" });
  const hh = createHousehold(db, mom.user.id, "Larsen");
  const momLine = addLine(db, hh.id, mom.user.id, "Mom phone");
  const kid = addLine(db, hh.id, mom.user.id, "Gemma", "softphone", { mode: "child" });
  updateLine(db, hh.id, kid.id, { mode: "child" }, { actorUserId: mom.user.id });

  // Cousin joins via invite → lands in Mom’s circle alongside future Grandma.
  const invCousin = createInvite(db, hh.id, mom.user.id);
  const cousinJoin = redeemInvite(db, invCousin.code, cousin.user.id, "Cousin house");
  const cousinLine = addLine(db, cousinJoin.household.id, cousin.user.id, "Cousin phone");

  const gp = provisionGrandparent(db, mom.user.id, hh.id, {
    displayName: "Grandma",
    username: "grandmadir",
    password: "password1!",
    label: "Grandma",
    kidLineIds: [kid.id],
  });
  const gpUser = loginWithPassword(db, "grandmadir", "password1!").user;

  assert.equal(canViewerSeeLine(db, gpUser.id, kid.id), true);
  assert.equal(canViewerSeeLine(db, gpUser.id, momLine.id), true);
  assert.equal(canViewerSeeLine(db, gpUser.id, cousinLine.id), false);
  assert.equal(canViewerSeeLine(db, mom.user.id, cousinLine.id), true);
  assert.equal(canViewerSeeLine(db, mom.user.id, gp.line.id), true);

  const snap = householdSnapshot(db, gpUser.id);
  const ids = new Set(snap.directory.map((d: { id: string }) => d.id));
  assert.equal(ids.has(kid.id), true);
  assert.equal(ids.has(momLine.id), true);
  assert.equal(ids.has(cousinLine.id), false);
});

test("decline pending contact hides from pending list", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const b = registerParent(db, "B");
  const hhA = createHousehold(db, a.user.id, "House A");
  const hhB = createHousehold(db, b.user.id, "House B");
  addLine(db, hhA.id, a.user.id, "A phone");
  const lineB = addLine(db, hhB.id, b.user.id, "B phone");

  declineAllowlist(db, hhA.id, lineB.id);
  assert.deepEqual(listDeclinedLineIds(db, hhA.id), [lineB.id]);
  const snap = householdSnapshot(db, a.user.id);
  assert.ok(snap.households[0].declined_line_ids.includes(lineB.id));

  // Approving clears the decline
  addAllowlist(db, hhA.id, lineB.id, "Cousin");
  assert.deepEqual(listDeclinedLineIds(db, hhA.id), []);
});

test("speed dial swap, ringer defaults, layout lock, greeting", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const b = registerParent(db, "B");
  const c = registerParent(db, "C");
  const hh = createHousehold(db, a.user.id, "House");
  assert.equal(hh.ringer_style, "classic");
  assert.equal(hh.ring_volume, 70);
  assert.equal(hh.layout_locked, 1);

  const lineA = addLine(db, hh.id, a.user.id, "A");
  const hhB = createHousehold(db, b.user.id, "B");
  const hhC = createHousehold(db, c.user.id, "C");
  const lineB = addLine(db, hhB.id, b.user.id, "B");
  const lineC = addLine(db, hhC.id, c.user.id, "C");
  const e1 = addAllowlist(db, hh.id, lineB.id, "B");
  const e2 = addAllowlist(db, hh.id, lineC.id, "C");
  updateAllowlistEntry(db, hh.id, e1.id, { speed_dial: 2 });
  updateAllowlistEntry(db, hh.id, e2.id, { speed_dial: 3 });
  updateAllowlistEntry(db, hh.id, e1.id, { speed_dial: 3 });
  const again1 = db.prepare(`SELECT speed_dial FROM allowlist WHERE id = ?`).get(e1.id) as {
    speed_dial: number;
  };
  const again2 = db.prepare(`SELECT speed_dial FROM allowlist WHERE id = ?`).get(e2.id) as {
    speed_dial: number;
  };
  assert.equal(again1.speed_dial, 3);
  assert.equal(again2.speed_dial, 2);

  const rules = updateHouseholdRules(db, hh.id, {
    ring_volume: 40,
    ringer_style: "chime",
    layout_locked: false,
  });
  assert.equal(rules.ring_volume, 40);
  assert.equal(rules.ringer_style, "chime");
  assert.equal(rules.layout_locked, 0);

  const tiny = Buffer.alloc(200, 1).toString("base64");
  const greeted = setLineGreeting(db, hh.id, lineA.id, {
    audioBase64: tiny,
    audioMime: "audio/webm",
    dataDir: dir,
  });
  assert.ok(greeted.greeting_path);
  assert.ok(greeted.greeting_confirmed_at);
  assert.equal(canEditLineGreeting(db, a.user.id, lineA.id), true);
  const snap = householdSnapshot(db, a.user.id);
  const pubLine = snap.households[0].lines.find((l: { id: string }) => l.id === lineA.id);
  assert.ok(pubLine);
  assert.equal(pubLine.has_greeting, true);
  assert.equal(pubLine.greeting_confirmed, true);
  assert.equal((pubLine as { greeting_path?: string }).greeting_path, undefined);

  clearLineGreeting(db, hh.id, lineA.id, dir);
  const cleared = db.prepare(`SELECT greeting_path, greeting_confirmed_at FROM lines WHERE id = ?`).get(lineA.id) as {
    greeting_path: string | null;
    greeting_confirmed_at: string | null;
  };
  assert.equal(cleared.greeting_path, null);
  assert.ok(cleared.greeting_confirmed_at);

  const confirmedOnly = confirmLineGreeting(db, hh.id, lineA.id);
  assert.ok(confirmedOnly.greeting_confirmed_at);
  const snapConfirm = householdSnapshot(db, a.user.id);
  const pubConfirm = snapConfirm.households[0].lines.find((l: { id: string }) => l.id === lineA.id);
  assert.equal(pubConfirm.has_greeting, false);
  assert.equal(pubConfirm.greeting_confirmed, true);

  const pngTiny = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  ).toString("base64");
  const withAvatar = setLineAvatar(db, hh.id, lineA.id, {
    imageBase64: pngTiny,
    imageMime: "image/png",
    dataDir: dir,
  });
  assert.ok(withAvatar.avatar_path);
  assert.ok(fs.existsSync(path.join(dir, withAvatar.avatar_path!)));
  const snap2 = householdSnapshot(db, a.user.id);
  const pubLine2 = snap2.households[0].lines.find((l: { id: string }) => l.id === lineA.id) as {
    has_avatar?: boolean;
    avatar_url?: string | null;
    avatar_path?: string;
  };
  assert.equal(pubLine2.has_avatar, true);
  assert.equal(pubLine2.avatar_url, `/api/lines/${lineA.id}/avatar`);
  assert.equal(pubLine2.avatar_path, undefined);
  const dirEntry = snap2.directory.find((d: { id: string }) => d.id === lineA.id) as {
    has_avatar?: boolean;
  };
  assert.equal(dirEntry.has_avatar, true);

  clearLineAvatar(db, hh.id, lineA.id, dir);
  const clearedAv = db.prepare(`SELECT avatar_path FROM lines WHERE id = ?`).get(lineA.id) as {
    avatar_path: string | null;
  };
  assert.equal(clearedAv.avatar_path, null);
});

test("allowlist auto-assign reserves speed dial 0 and 1", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const b = registerParent(db, "B");
  const hh = createHousehold(db, a.user.id, "House");
  const parentLine = addLine(db, hh.id, a.user.id, "Parent");
  const kidLine = addLine(db, hh.id, a.user.id, "Kid phone");
  updateLine(db, hh.id, kidLine.id, { mode: "child", child_label: "Gemma" }, { actorUserId: a.user.id });

  const hhB = createHousehold(db, b.user.id, "Cousins");
  const cousin = addLine(db, hhB.id, b.user.id, "Cousin");

  // Single parent: slot 2 is a normal contact slot — first external gets 2.
  const cousinAl = addAllowlist(db, hh.id, cousin.id, "Cousin");
  assert.equal(cousinAl.speed_dial, 2);

  const kidAl = addAllowlist(db, hh.id, kidLine.id, "Gemma");
  assert.equal(kidAl.speed_dial, 3);
  updateAllowlistEntry(db, hh.id, cousinAl.id, { speed_dial: 4 });
  updateAllowlistEntry(db, hh.id, kidAl.id, { speed_dial: 2 });
  const movedKid = db.prepare(`SELECT speed_dial FROM allowlist WHERE id = ?`).get(kidAl.id) as {
    speed_dial: number;
  };
  assert.equal(movedKid.speed_dial, 2);
  assert.throws(
    () => addAllowlist(db, hh.id, parentLine.id, "Parent", { speedDial: 1 }),
    /locked|TreeHouse|0/i
  );
  assert.throws(
    () => addAllowlist(db, hh.id, parentLine.id, "Parent", { speedDial: 0 }),
    /TreeHouse|locked/i
  );
  assert.ok(parentLine.id);
});

test("allowlist reserves speed dial 2 only when a second parent exists", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const b = registerParent(db, "B");
  const c = registerParent(db, "C");
  const hh = createHousehold(db, a.user.id, "House");
  addLine(db, hh.id, a.user.id, "Parent");
  addLine(db, hh.id, b.user.id, "Co-parent");
  const kidLine = addLine(db, hh.id, a.user.id, "Kid phone");
  updateLine(db, hh.id, kidLine.id, { mode: "child", child_label: "Gemma" }, { actorUserId: a.user.id });

  const hhC = createHousehold(db, c.user.id, "Cousins");
  const cousin = addLine(db, hhC.id, c.user.id, "Cousin");

  assert.ok(householdSecondaryParentLine(db, hh.id));
  const cousinAl = addAllowlist(db, hh.id, cousin.id, "Cousin");
  assert.equal(cousinAl.speed_dial, 3);
  assert.throws(
    () => addAllowlist(db, hh.id, kidLine.id, "Gemma", { speedDial: 2 }),
    /reserved|co-parent|2/i
  );
  assert.throws(
    () => updateAllowlistEntry(db, hh.id, cousinAl.id, { speed_dial: 2 }),
    /reserved|co-parent|2/i
  );
});

test("answering machine defaults off and is opt-in", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const hh = createHousehold(db, a.user.id, "House");
  const line = addLine(db, hh.id, a.user.id, "A phone");
  assert.equal(line.answering_machine ?? 0, 0);
  const row = db.prepare(`SELECT answering_machine FROM lines WHERE id = ?`).get(line.id) as {
    answering_machine: number;
  };
  assert.equal(row.answering_machine, 0);

  const on = updateLine(db, hh.id, line.id, { answering_machine: true });
  assert.equal(on.answering_machine, 1);
  const off = updateLine(db, hh.id, line.id, { answering_machine: false });
  assert.equal(off.answering_machine, 0);

  const snap = householdSnapshot(db, a.user.id);
  const pub = snap.households[0].lines.find((l: { id: string }) => l.id === line.id) as {
    answering_machine?: number;
  };
  assert.equal(pub.answering_machine, 0);
});

test("ATA binding, config XML, and speed-dial resolve", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const b = registerParent(db, "B");
  const hhA = createHousehold(db, a.user.id, "House A");
  const hhB = createHousehold(db, b.user.id, "House B");
  const hhAParent = addLine(db, hhA.id, a.user.id, "Mom");
  const kid = addLine(db, hhA.id, a.user.id, "Kid");
  updateLine(db, hhA.id, kid.id, { mode: "child", child_label: "Gemma" }, { actorUserId: a.user.id });
  const parentLine = addLine(db, hhB.id, b.user.id, "Trevor");

  const ata = upsertAtaDevice(
    db,
    kid.id,
    {
      sip_extension: "2001",
      sip_password: "PhoneHomeHt801!",
      sip_server: "10.0.5.105",
      display_name: "Gemma ATA",
    },
    { allowSipCredentialOverride: true }
  );
  assert.equal(ata.sip_extension, "2001");
  assert.ok(ata.provision_token.length >= 16);

  const xml = ataConfigXmlForDevice(ata, {
    publicBaseUrl: "https://example.test:8443",
    includeConfigServerPath: true,
  });
  assert.match(xml, /<P35>2001<\/P35>/);
  assert.match(xml, /<P34>PhoneHomeHt801!<\/P34>/);

  // Mutual allowlist with speed dial 2 (0 = TreeHouse, 1 = admin parent)
  addAllowlist(db, hhA.id, parentLine.id, "Trevor", { speedDial: 2 });
  addAllowlist(db, hhB.id, kid.id, "Gemma", { speedDial: 2 });

  const miss = resolveAtaDial(db, "2001", "9");
  assert.equal(miss.ok, false);

  const tree = resolveAtaDial(db, "2001", "0");
  assert.equal(tree.ok, true);
  if (tree.ok) {
    assert.equal(tree.treeHouse, true);
    assert.equal(tree.fromLineId, kid.id);
    assert.equal(tree.toLabel, "TreeHouse");
  }

  const admin = resolveAtaDial(db, "2001", "1");
  assert.equal(admin.ok, true);
  if (admin.ok && !("treeHouse" in admin && admin.treeHouse)) {
    assert.equal(admin.fromLineId, kid.id);
    assert.equal(admin.toLineId, hhAParent.id);
    assert.equal(admin.toSipExtension, null);
  }

  const hit = resolveAtaDial(db, "2001", "2");
  assert.equal(hit.ok, true);
  if (hit.ok && !("treeHouse" in hit && hit.treeHouse)) {
    assert.equal(hit.fromLineId, kid.id);
    assert.equal(hit.toLineId, parentLine.id);
    // Parent softphone has no ATA → softphone path
    assert.equal(hit.toSipExtension, null);
  }

  // Parent house links an ATA too → ATA→ATA resolve returns target extension
  upsertAtaDevice(
    db,
    parentLine.id,
    {
      sip_extension: "2002",
      sip_password: "PhoneHomeHt801!",
      sip_server: "10.0.5.105",
      display_name: "Trevor ATA",
    },
    { allowSipCredentialOverride: true }
  );
  const ataToAta = resolveAtaDial(db, "2001", "2");
  assert.equal(ataToAta.ok, true);
  if (ataToAta.ok) {
    assert.equal(ataToAta.toSipExtension, "2002");
    // Parent HH nickname for kid caller
    assert.equal(ataToAta.cidName, "Gemma");
    assert.equal(ataToAta.cidNumber, "2001");
  }

  const routeFxs = routeCallTarget(db, parentLine.id, kid.id);
  assert.equal(routeFxs.ok, true);
  if (routeFxs.ok) {
    assert.equal(routeFxs.preferFxs, true);
    assert.equal(routeFxs.toSipExtension, "2001");
    // Kid HH nickname for parent is "Trevor" (allowlist on hhB)
    assert.equal(routeFxs.cidName, "Trevor");
    assert.equal(routeFxs.cidNumber, "2002");
  }
  const routeSoft = routeCallTarget(db, kid.id, parentLine.id);
  // parentLine now has ATA too
  assert.equal(routeSoft.ok, true);
  if (routeSoft.ok) {
    assert.equal(routeSoft.toSipExtension, "2002");
    // Parent HH nickname for kid is "Gemma"
    assert.equal(routeSoft.cidName, "Gemma");
    assert.equal(routeSoft.cidNumber, "2001");
  }

  const snap = householdSnapshot(db, a.user.id);
  const pub = snap.households[0].lines.find((l: { id: string }) => l.id === kid.id) as {
    ata?: { sip_extension: string; has_sip_password: boolean; model?: string };
  };
  assert.equal(pub.ata?.sip_extension, "2001");
  assert.equal(pub.ata?.has_sip_password, true);
  assert.equal(pub.ata?.model, "ht801");

  const fanvil = upsertAtaDevice(db, kid.id, { model: "g100s" });
  assert.equal(fanvil.model, "g100s");

  const session = createBridgeSession(db, kid.id);
  assert.ok(session.sessionId);
});

test("dial 0 is TreeHouse; dial 1 is admin parent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "Mom");
  const hh = createHousehold(db, a.user.id, "Home");
  const parentLine = addLine(db, hh.id, a.user.id, "Mom phone");
  db.prepare(`UPDATE lines SET created_at = ? WHERE id = ?`).run("2026-01-01T00:00:00.000Z", parentLine.id);
  const laterParent = addLine(db, hh.id, a.user.id, "Dad phone");
  db.prepare(`UPDATE lines SET created_at = ? WHERE id = ?`).run("2026-01-02T00:00:00.000Z", laterParent.id);
  const kid = addLine(db, hh.id, a.user.id, "Kid");
  updateLine(db, hh.id, kid.id, { mode: "child", child_label: "Gemma" }, { actorUserId: a.user.id });

  const admin = householdAdminParentLine(db, hh.id);
  assert.equal(admin?.id, parentLine.id);
  assert.equal(householdHomeParentLine(db, hh.id)?.id, parentLine.id);
  const secondary = householdSecondaryParentLine(db, hh.id);
  assert.equal(secondary?.id, laterParent.id);

  upsertAtaDevice(
    db,
    kid.id,
    {
      sip_extension: "2001",
      sip_password: "PhoneHomeHt801!",
      sip_server: "10.0.5.105",
      display_name: "Gemma ATA",
    },
    { allowSipCredentialOverride: true }
  );

  const treeDial = resolveAtaDial(db, "2001", "0");
  assert.equal(treeDial.ok, true);
  if (treeDial.ok) {
    assert.equal(treeDial.treeHouse, true);
    assert.equal(treeDial.fromLineId, kid.id);
    assert.equal(treeDial.dialed, "0");
  }

  const parentDial = resolveAtaDial(db, "2001", "1");
  assert.equal(parentDial.ok, true);
  if (parentDial.ok && !("treeHouse" in parentDial && parentDial.treeHouse)) {
    assert.equal(parentDial.fromLineId, kid.id);
    assert.equal(parentDial.toLineId, parentLine.id);
    assert.equal(parentDial.dialed, "1");
  }

  // 911 / 933 → admin parent (interim E911; bypass pause)
  db.prepare(`UPDATE households SET kill_switch = 1 WHERE id = ?`).run(hh.id);
  const e911 = resolveAtaDial(db, "2001", "911");
  assert.equal(e911.ok, true);
  if (e911.ok && !("treeHouse" in e911 && e911.treeHouse)) {
    assert.equal(e911.toLineId, parentLine.id);
    assert.equal(e911.dialed, "911");
  }
  const e933 = resolveAtaDial(db, "2001", "933");
  assert.equal(e933.ok, true);
  if (e933.ok && !("treeHouse" in e933 && e933.treeHouse)) assert.equal(e933.toLineId, parentLine.id);
  db.prepare(`UPDATE households SET kill_switch = 0 WHERE id = ?`).run(hh.id);

  const al = addAllowlist(db, hh.id, laterParent.id, "Dad", { speedDial: 3 });
  assert.throws(
    () => updateAllowlistEntry(db, hh.id, al.id, { speed_dial: 0 }),
    /TreeHouse|locked/i
  );

  upsertAtaDevice(
    db,
    parentLine.id,
    {
      sip_extension: "2002",
      sip_password: "PhoneHomeHt801!",
      sip_server: "10.0.5.105",
    },
    { allowSipCredentialOverride: true }
  );
  const selfParent = resolveAtaDial(db, "2002", "1");
  assert.equal(selfParent.ok, false);

  const box = resolveAtaMailbox(db, "2001");
  assert.equal(box.ok, true);
  if (box.ok) {
    assert.equal(box.lineId, kid.id);
    assert.equal(box.householdId, hh.id);
    assert.equal(box.hasGreeting, false);
  }
  const wav = Buffer.alloc(200, 2).toString("base64");
  setLineGreeting(db, hh.id, kid.id, {
    audioBase64: wav,
    audioMime: "audio/wav",
    dataDir: dir,
  });
  const box2 = resolveAtaMailbox(db, "2001");
  assert.equal(box2.ok, true);
  if (box2.ok) assert.equal(box2.hasGreeting, true);
  assert.equal(listAtaMailboxMessages(db, kid.id).length, 0);
});

test("ATA auto-assigns unique SIP extensions and passwords", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const hh = createHousehold(db, a.user.id, "House A");
  const gemma = addLine(db, hh.id, a.user.id, "Gemma");
  const cousin = addLine(db, hh.id, a.user.id, "Cousin");

  const ata1 = upsertAtaDevice(db, gemma.id, { sip_server: "sip.example.test" });
  const ata2 = upsertAtaDevice(db, cousin.id, { sip_server: "sip.example.test" });

  assert.equal(ata1.sip_extension, "2001");
  assert.equal(ata2.sip_extension, "2002");
  assert.notEqual(ata1.sip_password, ata2.sip_password);
  assert.ok(ata1.sip_password.length >= 12);
  assert.ok(ata2.sip_password.length >= 12);

  // Second save keeps Gemma on 2001
  const again = upsertAtaDevice(db, gemma.id, { sip_server: "sip.example.test" });
  assert.equal(again.sip_extension, "2001");
  assert.equal(again.sip_password, ata1.sip_password);

  // Parent-style client cannot steal cousin's extension or reassign Gemma
  const steal = upsertAtaDevice(db, gemma.id, {
    sip_extension: "2002",
    sip_password: "hacked-password-xx",
    sip_server: "sip.example.test",
  });
  assert.equal(steal.sip_extension, "2001");
  assert.equal(steal.sip_password, ata1.sip_password);
  assert.equal(getAtaByLineId(db, cousin.id)?.sip_extension, "2002");

  // Explicit client extension on create is ignored (auto 2003, not 2100)
  const third = addLine(db, hh.id, a.user.id, "Third");
  const ata3 = upsertAtaDevice(db, third.id, {
    sip_extension: "2100",
    sip_password: "parent-typed-pass",
    sip_server: "sip.example.test",
  });
  assert.equal(ata3.sip_extension, "2003");
  assert.notEqual(ata3.sip_password, "parent-typed-pass");

  // Lab/admin override still allowed for fixtures
  const fourth = addLine(db, hh.id, a.user.id, "Fourth");
  const ata4 = upsertAtaDevice(
    db,
    fourth.id,
    { sip_extension: "2100", sip_password: "LabOnlyPass99", sip_server: "sip.example.test" },
    { allowSipCredentialOverride: true }
  );
  assert.equal(ata4.sip_extension, "2100");
  assert.equal(ata4.sip_password, "LabOnlyPass99");

  assert.equal(allocateNextSipExtension(db), "2004");
});

test("deleteChildLine wipes line media ATA login and cross-household allowlist", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const mom = registerParent(db, "Mom", { username: "delmom", password: "password1" });
  const cousin = registerParent(db, "Cousin", { username: "delcousin", password: "password1" });
  const hhMom = createHousehold(db, mom.user.id, "Mom House");
  const hhCousin = createHousehold(db, cousin.user.id, "Cousin House");
  const parentLine = addLine(db, hhMom.id, mom.user.id, "Mom phone");
  const kid = addLine(db, hhMom.id, mom.user.id, "Kid phone");
  updateLine(db, hhMom.id, kid.id, { mode: "child", child_label: "Maya" }, { actorUserId: mom.user.id });
  const otherKid = addLine(db, hhMom.id, mom.user.id, "Other kid");
  updateLine(db, hhMom.id, otherKid.id, { mode: "child", child_label: "Sam" }, { actorUserId: mom.user.id });
  const cousinLine = addLine(db, hhCousin.id, cousin.user.id, "Cousin phone");

  setChildLineLogin(db, mom.user.id, kid.id, { username: "maya.del", password: "password1" });
  const kidUserId = (db.prepare(`SELECT child_user_id FROM lines WHERE id = ?`).get(kid.id) as { child_user_id: string })
    .child_user_id;
  upsertAtaDevice(
    db,
    kid.id,
    { sip_extension: "2001", sip_password: "PhoneHomeHt801!", sip_server: "10.0.5.105" },
    { allowSipCredentialOverride: true }
  );
  setLineGreeting(db, hhMom.id, kid.id, {
    audioBase64: Buffer.alloc(128, 1).toString("base64"),
    audioMime: "audio/wav",
    dataDir: dir,
  });
  setLineAvatar(db, hhMom.id, kid.id, {
    imageBase64: Buffer.alloc(64, 2).toString("base64"),
    imageMime: "image/png",
    dataDir: dir,
  });

  addAllowlist(db, hhMom.id, cousinLine.id, "Cousin", { speedDial: 2 });
  addAllowlist(db, hhCousin.id, kid.id, "Maya", { speedDial: 2 });
  addAllowlist(db, hhCousin.id, otherKid.id, "Sam", { speedDial: 3 });
  logCall(db, kid.id, cousinLine.id, "completed");
  leaveVoicemailForContact(db, mom.user.id, kid.id, cousinLine.id, "hello from Maya", {
    dataDir: dir,
    audioBase64: Buffer.alloc(128, 3).toString("base64"),
    audioMime: "audio/webm",
  });

  assert.throws(() => deleteChildLine(db, mom.user.id, hhMom.id, kid.id, dir, { confirm: "nope" }));
  assert.throws(() => deleteChildLine(db, cousin.user.id, hhMom.id, kid.id, dir, { confirm: "DELETE" }));
  assert.throws(() => deleteChildLine(db, mom.user.id, hhMom.id, parentLine.id, dir, { confirm: "DELETE" }));

  const result = deleteChildLine(db, mom.user.id, hhMom.id, kid.id, dir, { confirm: "Maya" });
  assert.equal(result.deleted, true);
  assert.equal(db.prepare(`SELECT 1 FROM lines WHERE id = ?`).get(kid.id), undefined);
  assert.equal(db.prepare(`SELECT 1 FROM ata_devices WHERE line_id = ?`).get(kid.id), undefined);
  assert.equal(db.prepare(`SELECT 1 FROM allowlist WHERE target_line_id = ?`).get(kid.id), undefined);
  assert.ok(db.prepare(`SELECT 1 FROM allowlist WHERE target_line_id = ?`).get(otherKid.id));
  assert.ok(db.prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`).get(hhMom.id, cousinLine.id));
  assert.equal(db.prepare(`SELECT 1 FROM users WHERE id = ?`).get(kidUserId), undefined);
  assert.equal(db.prepare(`SELECT 1 FROM call_logs WHERE from_line_id = ? OR to_line_id = ?`).get(kid.id, kid.id), undefined);
  assert.ok(db.prepare(`SELECT 1 FROM lines WHERE id = ?`).get(otherKid.id));
  assert.ok(db.prepare(`SELECT 1 FROM lines WHERE id = ?`).get(parentLine.id));

  const again = deleteChildLine(db, mom.user.id, hhMom.id, kid.id, dir, { confirm: "DELETE" });
  assert.equal(again.deleted, false);
});

test("deleteParentAccount wipes household and cleans other families’ contacts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const mom = registerParent(db, "Mom", { username: "accmom", password: "password1" });
  const cousin = registerParent(db, "Cousin", { username: "acccousin", password: "password1" });
  const hhMom = createHousehold(db, mom.user.id, "Mom House");
  const hhCousin = createHousehold(db, cousin.user.id, "Cousin House");
  const momLine = addLine(db, hhMom.id, mom.user.id, "Mom");
  const kid = addLine(db, hhMom.id, mom.user.id, "Kid");
  updateLine(db, hhMom.id, kid.id, { mode: "child", child_label: "Maya" }, { actorUserId: mom.user.id });
  const cousinLine = addLine(db, hhCousin.id, cousin.user.id, "Cousin");
  addAllowlist(db, hhCousin.id, kid.id, "Maya");
  addAllowlist(db, hhCousin.id, momLine.id, "Mom");
  addAllowlist(db, hhMom.id, cousinLine.id, "Cousin");

  assert.throws(() => deleteParentAccount(db, mom.user.id, dir, { confirm: "please" }));

  const result = deleteParentAccount(db, mom.user.id, dir, { confirm: "DELETE" });
  assert.equal(result.deleted, true);
  assert.deepEqual(result.householdsWiped, [hhMom.id]);
  assert.equal(db.prepare(`SELECT 1 FROM users WHERE id = ?`).get(mom.user.id), undefined);
  assert.equal(db.prepare(`SELECT 1 FROM households WHERE id = ?`).get(hhMom.id), undefined);
  assert.equal(db.prepare(`SELECT 1 FROM lines WHERE id = ?`).get(kid.id), undefined);
  assert.equal(db.prepare(`SELECT 1 FROM allowlist WHERE target_line_id = ?`).get(kid.id), undefined);
  assert.equal(db.prepare(`SELECT 1 FROM allowlist WHERE target_line_id = ?`).get(momLine.id), undefined);
  assert.ok(db.prepare(`SELECT 1 FROM households WHERE id = ?`).get(hhCousin.id));
  assert.ok(db.prepare(`SELECT 1 FROM users WHERE id = ?`).get(cousin.user.id));
  const remaining = db
    .prepare(`SELECT COUNT(*) AS n FROM allowlist WHERE household_id = ?`)
    .get(hhCousin.id) as { n: number };
  assert.equal(remaining.n, 0);

  const again = deleteParentAccount(db, mom.user.id, dir, { confirm: "DELETE" });
  assert.equal(again.deleted, false);
});

test("deleteParentAccount transfers ownership when another member remains", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const mom = registerParent(db, "Mom", { username: "xfermom", password: "password1" });
  const dad = registerParent(db, "Dad", { username: "xferdad", password: "password1" });
  const hh = createHousehold(db, mom.user.id, "Shared");
  db.prepare(`INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'parent')`).run(
    hh.id,
    dad.user.id
  );
  const kid = addLine(db, hh.id, mom.user.id, "Kid");
  updateLine(db, hh.id, kid.id, { mode: "child", child_label: "Maya" }, { actorUserId: mom.user.id });

  const result = deleteParentAccount(db, mom.user.id, dir, { confirm: "DELETE" });
  assert.equal(result.deleted, true);
  assert.deepEqual(result.householdsWiped, []);
  const hh2 = db.prepare(`SELECT owner_user_id FROM households WHERE id = ?`).get(hh.id) as {
    owner_user_id: string;
  };
  assert.equal(hh2.owner_user_id, dad.user.id);
  assert.ok(db.prepare(`SELECT 1 FROM lines WHERE id = ?`).get(kid.id));
  assert.equal(db.prepare(`SELECT 1 FROM users WHERE id = ?`).get(mom.user.id), undefined);
});

test("wipeLineCascade is idempotent for unknown line ids", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const hh = createHousehold(db, a.user.id, "H");
  const line = addLine(db, hh.id, a.user.id, "L");
  addAllowlist(db, hh.id, line.id, "Self?"); // won't happen in UI but ok
  // Point allowlist at a fake deleted id
  const fakeId = "line_gone";
  db.prepare(
    `INSERT INTO allowlist (id, household_id, target_line_id, label, speed_dial, favorite, created_at)
     VALUES (?, ?, ?, 'Ghost', NULL, 0, ?)`
  ).run("al_ghost", hh.id, fakeId, new Date().toISOString());
  const r = wipeLineCascade(db, fakeId, dir);
  assert.equal(r.wiped, false);
  assert.equal(db.prepare(`SELECT 1 FROM allowlist WHERE target_line_id = ?`).get(fakeId), undefined);
});

test("TreeHouse always-allows household kids only; talk pairs are symmetric", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-fr-"));
  const db = openDb(path.join(dir, "t.db"));
  const mom = registerParent(db, "Mom", { username: "frmom", password: "password1" });
  const other = registerParent(db, "Other", { username: "frother", password: "password1" });
  const hh = createHousehold(db, mom.user.id, "Home");
  const hhOther = createHousehold(db, other.user.id, "Elsewhere");
  const parentLine = addLine(db, hh.id, mom.user.id, "Mom phone");
  const kid = addLine(db, hh.id, mom.user.id, "Kid");
  updateLine(db, hh.id, kid.id, { mode: "child", child_label: "Maya" }, { actorUserId: mom.user.id });
  const kid2 = addLine(db, hh.id, mom.user.id, "Kid2");
  updateLine(db, hh.id, kid2.id, { mode: "child", child_label: "Sam" }, { actorUserId: mom.user.id });
  const cousin = addLine(db, hhOther.id, other.user.id, "Cousin");
  addAllowlist(db, hh.id, cousin.id, "Cousin");

  assert.equal(isFamilyRoomAdminAlwaysAllowed(db, hh.id, parentLine.id), false);
  assert.equal(isFamilyRoomAdminAlwaysAllowed(db, hh.id, kid.id), true);
  assert.equal(canJoinFamilyRoom(db, hh.id, parentLine.id), false);
  assert.equal(canJoinFamilyRoom(db, hh.id, kid.id), true);
  assert.equal(isFamilyRoomAdminAlwaysAllowed(db, hh.id, cousin.id), false);
  assert.equal(canJoinFamilyRoom(db, hh.id, cousin.id), false);
  assert.equal(isFamilyRoomAdminAlwaysAllowed(db, hhOther.id, parentLine.id), false);
  assert.equal(canJoinFamilyRoom(db, hhOther.id, parentLine.id), false);

  const always = listFamilyRoomAlwaysAllowedLineIds(db, hh.id);
  assert.ok(always.includes(kid.id));
  assert.ok(always.includes(kid2.id));
  assert.equal(always.includes(parentLine.id), false);
  assert.equal(always.includes(cousin.id), false);

  assert.throws(() => addFamilyRoomMember(db, hh.id, kid.id, mom.user.id));
  assert.throws(() => removeFamilyRoomMember(db, hh.id, kid.id, mom.user.id));

  addFamilyRoomMember(db, hh.id, cousin.id, mom.user.id);
  assert.equal(canJoinFamilyRoom(db, hh.id, cousin.id), true);

  // Household kids auto-talk; cousin needs explicit pair.
  assert.equal(canTalkInFamilyRoom(db, hh.id, kid.id, kid2.id), true);
  assert.equal(canTalkInFamilyRoom(db, hh.id, kid.id, cousin.id), false);
  addFamilyRoomTalkPair(db, hh.id, kid.id, cousin.id, mom.user.id);
  assert.equal(canTalkInFamilyRoom(db, hh.id, kid.id, cousin.id), true);
  assert.equal(canTalkInFamilyRoom(db, hh.id, cousin.id, kid.id), true);
  assert.equal(canTalkInFamilyRoom(db, hh.id, kid2.id, cousin.id), false);
});

test("parent_title and FamilyRoom approvals include kids and adults", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const mom = registerParent(db, "Trevor Larsen");
  const other = registerParent(db, "Grandma");
  const hh = createHousehold(db, mom.user.id, "Larsen");
  const hhOther = createHousehold(db, other.user.id, "Grandma house");
  const momLine = addLine(db, hh.id, mom.user.id, "Mom phone");
  const kidLine = addLine(db, hh.id, mom.user.id, "Kid phone");
  updateLine(
    db,
    hh.id,
    kidLine.id,
    { mode: "child", child_label: "Maya" },
    { actorUserId: mom.user.id }
  );
  const grandmaLine = addLine(db, hhOther.id, other.user.id, "Grandma");

  updateUserProfile(db, mom.user.id, { parent_title: "mom" });
  assert.equal(parentDisplayLabel(db, momLine.id), "Mom");

  // Allowlist nickname must not override Mom/Dad for FXS / voice CID.
  addAllowlist(db, hh.id, momLine.id, "Trevor");
  assert.equal(peerLabelForHousehold(db, hh.id, momLine.id), "Mom");
  // Saving Mom/Dad rewrites stale personal-name nicknames on the allowlist.
  updateUserProfile(db, mom.user.id, { parent_title: "mom" });
  const al = db.prepare(`SELECT label FROM allowlist WHERE target_line_id = ?`).get(momLine.id) as {
    label: string;
  };
  assert.equal(al.label, "Mom");

  assert.equal(canJoinAdultFamilyRoom(db, hh.id, momLine.id), false);
  assert.equal(canJoinAdultFamilyRoom(db, hh.id, kidLine.id), false);
  assert.equal(canJoinAdultFamilyRoom(db, hh.id, grandmaLine.id), false);

  addAdultFamilyRoomMember(db, hh.id, momLine.id, mom.user.id);
  addAdultFamilyRoomMember(db, hh.id, kidLine.id, mom.user.id);
  assert.equal(canJoinAdultFamilyRoom(db, hh.id, momLine.id), true);
  assert.equal(canJoinAdultFamilyRoom(db, hh.id, kidLine.id), true);

  addAllowlist(db, hh.id, grandmaLine.id, "Grandma");
  addAdultFamilyRoomMember(db, hh.id, grandmaLine.id, mom.user.id);
  assert.equal(canJoinAdultFamilyRoom(db, hh.id, grandmaLine.id), true);

  const choices = listFamilyRoomChoicesForLine(db, momLine.id);
  assert.ok(choices.length >= 1);
  assert.equal(choices[0].slot, 1);
  assert.match(choices[0].label, /Larsen/i);

  const kidChoices = listFamilyRoomChoicesForLine(db, kidLine.id);
  assert.ok(kidChoices.length >= 1);
  assert.equal(kidChoices[0].slot, 1);
});

test("FamilyRoom IVR slot 1 is household name and slot 2 is other parent last name", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const mom = registerParent(db, "Trevor Larsen");
  const dad = registerParent(db, "Mike Smith", { username: "frdad", password: "password1" });
  const hh = createHousehold(db, mom.user.id, "Larsen");
  const momLine = addLine(db, hh.id, mom.user.id, "Mom phone");
  const dadLine = addLine(db, hh.id, dad.user.id, "Dad phone");
  db.prepare(`INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'parent')`).run(
    hh.id,
    dad.user.id
  );
  updateUserProfile(db, mom.user.id, { parent_title: "mom" });
  updateUserProfile(db, dad.user.id, { parent_title: "dad" });
  addAdultFamilyRoomMember(db, hh.id, momLine.id, mom.user.id);
  addAdultFamilyRoomMember(db, hh.id, dadLine.id, mom.user.id);

  assert.equal(parentDisplayLabel(db, momLine.id), "Mom");
  assert.equal(parentDisplayLabel(db, dadLine.id), "Dad");

  const choices = listFamilyRoomChoicesForLine(db, momLine.id);
  assert.equal(choices.length, 2);
  assert.equal(choices[0].slot, 1);
  assert.equal(choices[0].label, "Larsen");
  assert.equal(choices[1].slot, 2);
  assert.equal(choices[1].label, "Smith");
  assert.equal(choices[1].householdId, hh.id);
});

test("FamilyRoom IVR slot 2 uses Mom/Dad when last names match the household", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const mom = registerParent(db, "Trevor Larsen");
  const dad = registerParent(db, "Chris Larsen", { username: "frdad2", password: "password1" });
  const hh = createHousehold(db, mom.user.id, "Larsen");
  const momLine = addLine(db, hh.id, mom.user.id, "Mom phone");
  const dadLine = addLine(db, hh.id, dad.user.id, "Dad phone");
  db.prepare(`INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'parent')`).run(
    hh.id,
    dad.user.id
  );
  updateUserProfile(db, dad.user.id, { parent_title: "dad" });
  addAdultFamilyRoomMember(db, hh.id, momLine.id, mom.user.id);
  addAdultFamilyRoomMember(db, hh.id, dadLine.id, mom.user.id);

  const choices = listFamilyRoomChoicesForLine(db, momLine.id);
  assert.equal(choices[0].label, "Larsen");
  assert.equal(choices[1].label, "Dad");
});

test("test review account only ever sees and calls Trevor", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));

  const trevor = registerParent(db, "Trevor", { username: "trevor", password: "password1" });
  const stranger = registerParent(db, "Stranger", { username: "stranger", password: "password1" });
  const tester = registerParent(db, "Test", { username: "test", password: "password1" });

  const hhT = createHousehold(db, trevor.user.id, "Larsen");
  const hhS = createHousehold(db, stranger.user.id, "Other");
  const hhTest = createHousehold(db, tester.user.id, "Tester");

  const trevorLine = addLine(db, hhT.id, trevor.user.id, "Trevor's phone");
  const strangerLine = addLine(db, hhS.id, stranger.user.id, "Stranger phone");
  const testLine = addLine(db, hhTest.id, tester.user.id, "Test's phone");

  // Allowlist Trevor (ok) — stranger must be rejected by hard gate.
  addAllowlist(db, hhTest.id, trevorLine.id, "Trevor", { actorUserId: tester.user.id });
  assert.throws(
    () => addAllowlist(db, hhTest.id, strangerLine.id, "Nope", { actorUserId: tester.user.id }),
    /only contact Trevor/i
  );

  // Pollute circle the way invite sync used to — scrub + canViewerSeeLine must hide them.
  const sphere = ensureSphereForParent(db, tester.user.id);
  // Bypass gate with raw insert to simulate legacy DB drift.
  db.prepare(
    `INSERT OR IGNORE INTO sphere_members (sphere_id, line_id, added_by_user_id, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(sphere.id, strangerLine.id, tester.user.id, new Date().toISOString());
  db.prepare(
    `INSERT OR REPLACE INTO allowlist (id, household_id, target_line_id, label, speed_dial, favorite, always_allow, created_at)
     VALUES (?, ?, ?, ?, ?, 1, 0, ?)`
  ).run("al_leak", hhTest.id, strangerLine.id, "Leak", 3, new Date().toISOString());

  assert.equal(canViewerSeeLine(db, tester.user.id, trevorLine.id), true);
  assert.equal(canViewerSeeLine(db, tester.user.id, testLine.id), true);
  assert.equal(canViewerSeeLine(db, tester.user.id, strangerLine.id), false);

  const snap = householdSnapshot(db, tester.user.id);
  const dirIds = new Set(snap.directory.map((d: { id: string }) => d.id));
  assert.equal(dirIds.has(trevorLine.id), true);
  assert.equal(dirIds.has(testLine.id), true);
  assert.equal(dirIds.has(strangerLine.id), false);
  assert.equal(snap.households[0].allowlist.length, 1);
  assert.equal(snap.households[0].allowlist[0].target_line_id, trevorLine.id);
  const mine = snap.households[0].spheres.find((s: { is_mine: boolean }) => s.is_mine);
  assert.ok(mine);
  assert.equal(mine.member_line_ids.includes(strangerLine.id), false);
  assert.ok(mine.member_line_ids.includes(trevorLine.id) || mine.member_line_ids.includes(testLine.id));

  addAllowlist(db, hhT.id, testLine.id, "Test");
  assert.equal(canCall(db, testLine.id, trevorLine.id).ok, true);
  assert.equal(canCall(db, trevorLine.id, testLine.id).ok, true);
  assert.equal(canCall(db, testLine.id, strangerLine.id).ok, false);

  // Bidirectional: other families must never see Test, even with polluted allowlist/circle.
  assert.throws(
    () => addAllowlist(db, hhS.id, testLine.id, "Test", { actorUserId: stranger.user.id }),
    /only available to Trevor/i
  );
  db.prepare(
    `INSERT OR REPLACE INTO allowlist (id, household_id, target_line_id, label, speed_dial, favorite, always_allow, created_at)
     VALUES (?, ?, ?, ?, ?, 1, 0, ?)`
  ).run("al_test_leak", hhS.id, testLine.id, "Test", 4, new Date().toISOString());
  const strangerSphere = ensureSphereForParent(db, stranger.user.id);
  db.prepare(
    `INSERT OR IGNORE INTO sphere_members (sphere_id, line_id, added_by_user_id, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(strangerSphere.id, testLine.id, stranger.user.id, new Date().toISOString());

  assert.equal(canViewerSeeLine(db, stranger.user.id, testLine.id), false);
  assert.equal(canViewerSeeLine(db, trevor.user.id, testLine.id), true);

  const strangerSnap = householdSnapshot(db, stranger.user.id);
  assert.equal(
    strangerSnap.households[0].allowlist.some((a: { target_line_id: string }) => a.target_line_id === testLine.id),
    false
  );
  assert.equal(
    strangerSnap.directory.some((d: { id: string }) => d.id === testLine.id),
    false
  );

  const kid = addLine(db, hhT.id, trevor.user.id, "Gemma", "softphone", { mode: "child" });
  updateLine(db, hhT.id, kid.id, { mode: "child" }, { actorUserId: trevor.user.id });
  const kidLogin = setChildLineLogin(db, trevor.user.id, kid.id, {
    username: "gemmakid",
    password: "password1!",
  });
  // Household still has Test for Trevor; kid softphone must not see it.
  const kidSnap = householdSnapshot(db, kidLogin.childUser.id);
  assert.equal(
    kidSnap.households[0].allowlist.some((a: { target_line_id: string }) => a.target_line_id === testLine.id),
    false
  );
  assert.equal(
    kidSnap.directory.some((d: { id: string }) => d.id === testLine.id),
    false
  );

  const trevorSnap = householdSnapshot(db, trevor.user.id);
  assert.equal(
    trevorSnap.households[0].allowlist.some((a: { target_line_id: string }) => a.target_line_id === testLine.id),
    true
  );
  // Review softphone must not sit in Trevor’s circle (kids inherit that list).
  const trevorSphere = trevorSnap.households[0].spheres.find((s: { is_mine: boolean }) => s.is_mine);
  assert.ok(trevorSphere);
  assert.equal(trevorSphere.member_line_ids.includes(testLine.id), false);
  assert.equal(
    trevorSnap.households[0].allowlist.find((a: { target_line_id: string }) => a.target_line_id === testLine.id)
      ?.is_test_review,
    true
  );
});
