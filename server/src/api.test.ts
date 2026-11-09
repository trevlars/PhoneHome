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
  issueInviteClaimToken,
  issueGuardianClaimToken,
  peekJoinToken,
  redeemJoinToken,
  familyJoinShareText,
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
  lineIsBusy,
  busyCallRejection,
  setLiveCall,
  clearLiveCall,
  loginWithPassword,
  markCallAnswered,
  minutesUsedToday,
  formatTalkDuration,
  talkDurationMs,
  publicUser,
  redeemGuardianInvite,
  redeemInvite,
  peekInvite,
  listSphereMemberLineIds,
  getSphereByOwner,
  registerParent,
  provisionGrandparent,
  issueGrandparentSetupToken,
  redeemGrandparentSetupToken,
  grandparentSetupShareText,
  resetProvisionedRelativePassword,
  updateProvisionedRelativeLogin,
  canViewerSeeLine,
  canAdminPodGrandparents,
  syncProvisionedRelativePodBook,
  ensureSphereForParent,
  addLineToSphere,
  podBookLines,
  podsForKid,
  kidBelongsToPod,
  userInHousehold,
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
  quietPolicyForLine,
  updateLine,
  verifyParentPin,
  verifyPassword,
  hashPin,
  upsertAtaDevice,
  allocateNextSipExtension,
  getAtaByLineId,
  publicAta,
  recordAtaLanPushResult,
  recordAtaConfigDownload,
  recordAtaProvisionHit,
  resolveAtaSipServer,
  syncAtaPublicSipHostsFromEnv,
  ataConfigXmlForDevice,
  resolveAtaDial,
  resolveAtaMailbox,
  listAtaMailboxMessages,
  routeCallTarget,
  createBridgeSession,
  householdHomeParentLine,
  householdAdminParentLine,
  householdSecondaryParentLine,
  householdKidPad1ParentLine,
  householdKidPad2ParentLine,
  listGrandparentDialKids,
  secondaryParentOwnsDial2,
  listKidPodFamilyPeers,
  userCanOperateLine,
  ensureHouseholdParentMember,
  ensureGuardian,
  setHouseholdParentTitle,
  syncGuardianCoParentAllowlist,
  updateUserProfile,
  parentDisplayLabel,
  kidFacingAdultLabel,
  kidPadParentLinesForChild,
  peerLabelForHousehold,
  peerLabelForCall,
  canJoinAdultFamilyRoom,
  addAdultFamilyRoomMember,
  listFamilyRoomChoicesForLine,
  deleteChildLine,
  deleteParentAccount,
  canJoinFamilyRoom,
  canJoinTreeHouse,
  isFamilyRoomAdminAlwaysAllowed,
  listFamilyRoomAlwaysAllowedLineIds,
  addFamilyRoomMember,
  removeFamilyRoomMember,
  addFamilyRoomTalkPair,
  canTalkInFamilyRoom,
  canTalkInTreeHouse,
  treeHouseTalkPeers,
  wipeLineCascade,
} from "./api.js";
import { openDb, type Household } from "./db.js";
import { listKidPodGrandparents } from "./grandparentsMenu.js";

test("new households default to evening Quiet Time for kids and parents", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const hh = createHousehold(db, a.user.id, "House A");
  assert.equal(hh.schedule_preset, "bedtime");
  assert.equal(hh.quiet_start, "20:00");
  assert.equal(hh.quiet_end, "07:00");
  assert.equal(hh.parent_schedule_preset, "evenings");
  assert.equal(hh.parent_quiet_start, "21:00");
  assert.equal(hh.parent_quiet_end, "07:00");
  assert.ok(hh.quiet_tz);
  assert.ok(hh.parent_quiet_tz);
});

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
  addLine(db, hhA.id, a.user.id, "A phone");
  const lineB = addLine(db, hhB.id, b.user.id, "B phone");
  updateLine(db, hhB.id, lineB.id, { mode: "child", child_label: "Kid B" }, { actorUserId: b.user.id });
  // Cousin kids call each other — not parent A dialing kid B.
  const kidA = addLine(db, hhA.id, a.user.id, "Kid A", "softphone", { mode: "child" });
  updateLine(db, hhA.id, kidA.id, { mode: "child", child_label: "Kid A" }, { actorUserId: a.user.id });
  addAllowlist(db, hhA.id, lineB.id, "B");
  addAllowlist(db, hhB.id, kidA.id, "A");
  updateHouseholdRules(db, hhA.id, { schedule_preset: "open", parent_schedule_preset: "open" });

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
  assert.equal(canCall(db, kidA.id, lineB.id, atUtc0300).ok, false);

  // Same instant in Tokyo is noon — outside evening quiet window
  assert.equal(isInQuietWindow("21:00", "07:00", "Asia/Tokyo", atUtc0300), false);

  updateHouseholdRules(db, hhB.id, {
    quiet_start: null,
    quiet_end: null,
    schedule_preset: "open",
  });
  assert.equal(canCall(db, kidA.id, lineB.id, atUtc0300).ok, true);
});

test("quiet hours require custom times and timezone", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const hh = createHousehold(db, a.user.id, "House A");
  // Clear factory Quiet Time so custom hours without a timezone must fail.
  updateHouseholdRules(db, hh.id, {
    schedule_preset: "open",
    parent_schedule_preset: "open",
    quiet_tz: null,
    parent_quiet_tz: null,
  });
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
  // Web softphone tab still shows online during quiet hours (no CallKit token)
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

test("iOS CallKit presence follows quiet hours like analog", () => {
  const nightPst = new Date("2026-01-15T06:00:00.000Z");
  const quietKid = {
    dnd: 0,
    quiet_start: "21:00",
    quiet_end: "07:00",
    quiet_tz: "America/Los_Angeles",
  };
  const quietParent = {
    ...quietKid,
    parent_quiet_start: "21:00",
    parent_quiet_end: "07:00",
    parent_quiet_tz: "America/Los_Angeles",
  };

  // Foreground app does not override quiet when lock-screen Answer is on.
  assert.equal(
    linePresenceOnline({
      softphoneOnline: true,
      ataRegistered: false,
      iosLockscreenReady: true,
      household: quietKid,
      lineMode: "child",
      now: nightPst,
    }),
    false
  );

  // VoIP token counts as reachable outside quiet even without WS.
  assert.equal(
    linePresenceOnline({
      softphoneOnline: false,
      ataRegistered: false,
      iosLockscreenReady: true,
      household: quietKid,
      lineMode: "child",
      now: new Date("2026-01-15T03:00:00.000Z"),
    }),
    true
  );

  // Parent DND window applies to parent lines.
  assert.equal(
    linePresenceOnline({
      softphoneOnline: true,
      ataRegistered: false,
      iosLockscreenReady: true,
      household: quietParent,
      lineMode: "parent",
      now: nightPst,
    }),
    false
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

test("duplicate terminal updates preserve completed and no-answer outcomes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const b = registerParent(db, "B");
  const hhA = createHousehold(db, a.user.id, "House A");
  const hhB = createHousehold(db, b.user.id, "House B");
  const lineA = addLine(db, hhA.id, a.user.id, "A phone");
  const lineB = addLine(db, hhB.id, b.user.id, "B phone");
  const endedAt = "2026-09-26T16:00:00.000Z";

  const answered = logCall(db, lineA.id, lineB.id, "ringing");
  db.prepare(`UPDATE call_logs SET outcome = 'answered' WHERE id = ?`).run(answered.id);
  endCallLog(db, answered.id, "ended");
  db.prepare(`UPDATE call_logs SET ended_at = ? WHERE id = ?`).run(endedAt, answered.id);
  endCallLog(db, answered.id, "ended");

  const noAnswer = logCall(db, lineA.id, lineB.id, "ringing");
  endCallLog(db, noAnswer.id, "missed");
  db.prepare(`UPDATE call_logs SET ended_at = ? WHERE id = ?`).run(endedAt, noAnswer.id);
  endCallLog(db, noAnswer.id, "ended");

  const rows = db
    .prepare(`SELECT id, outcome, ended_at FROM call_logs WHERE id IN (?, ?) ORDER BY id`)
    .all(answered.id, noAnswer.id) as { id: string; outcome: string; ended_at: string }[];
  const byId = new Map(rows.map((row) => [row.id, row]));
  assert.deepEqual(byId.get(answered.id), {
    id: answered.id,
    outcome: "completed",
    ended_at: endedAt,
  });
  assert.deepEqual(byId.get(noAnswer.id), {
    id: noAnswer.id,
    outcome: "missed",
    ended_at: endedAt,
  });
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

test("lineIsBusy when live call or open ringing log", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const b = registerParent(db, "B");
  const hhA = createHousehold(db, a.user.id, "House A");
  const hhB = createHousehold(db, b.user.id, "House B");
  const lineA = addLine(db, hhA.id, a.user.id, "A phone");
  const lineB = addLine(db, hhB.id, b.user.id, "B phone");

  assert.equal(lineIsBusy(db, lineB.id), false);
  const ringing = logCall(db, lineA.id, lineB.id, "ringing");
  assert.equal(lineIsBusy(db, lineB.id), true);
  assert.equal(lineIsBusy(db, lineA.id), true);
  endCallLog(db, ringing.id, "cancelled");
  assert.equal(lineIsBusy(db, lineB.id), false);

  setLiveCall({
    callId: "call_live_busy",
    fromLineId: lineA.id,
    toLineId: lineB.id,
    status: "active",
  });
  assert.equal(lineIsBusy(db, lineB.id), true);
  clearLiveCall("call_live_busy");
  assert.equal(lineIsBusy(db, lineB.id), false);

  const busy = busyCallRejection("callee");
  assert.equal(busy.voice, "busy");
  assert.match(busy.reason, /another call/i);
  assert.match(busy.spoken, /another call/i);
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

test("family invite joins the inviter Pod", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const b = registerParent(db, "B");
  const hhA = createHousehold(db, a.user.id, "House A");
  const invite = createInvite(db, hhA.id, a.user.id);
  const peek = peekInvite(db, invite.code);
  assert.equal(peek.fromHouseholdName, "House A");
  const redeemed = redeemInvite(db, invite.code, b.user.id, "Ignored");
  assert.equal(redeemed.household.id, hhA.id);
  assert.equal(redeemed.household.name, "House A");
  assert.equal(redeemed.created, false);
  assert.equal(userInHousehold(db, hhA.id, b.user.id), true);
  assert.throws(() => redeemInvite(db, invite.code, b.user.id, "X"));
  assert.throws(() => peekInvite(db, invite.code), /already used/i);
});

test("one-tap join token redeems family and guardian invites", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const mom = registerParent(db, "Mom", { username: "momjoin", password: "password1" });
  const sister = registerParent(db, "Sister", { username: "sisjoin", password: "password1" });
  const dad = registerParent(db, "Dad", { username: "dadjoin", password: "password1" });
  const hh = createHousehold(db, mom.user.id, "East");
  addLine(db, hh.id, mom.user.id, "Mom phone");
  const kid = addLine(db, hh.id, mom.user.id, "Alex", "softphone", { mode: "child" });
  updateLine(db, hh.id, kid.id, { mode: "child", child_label: "Alex" }, { actorUserId: mom.user.id });

  const fam = createInvite(db, hh.id, mom.user.id, { kind: "family" });
  const famTok = issueInviteClaimToken(db, fam, mom.user.id);
  const famPeek = peekJoinToken(db, famTok);
  assert.equal(famPeek.kind, "family");
  assert.equal(famPeek.fromHouseholdName, "East");
  assert.match(familyJoinShareText({ kind: "family", joinUrl: "https://h/?join=x", fromHouseholdName: "East" }), /Tap once/);
  const famOut = redeemJoinToken(db, sister.user.id, famTok);
  assert.equal(famOut.channel, "invite");
  assert.equal(famOut.household?.id, hh.id);
  assert.equal(userInHousehold(db, hh.id, sister.user.id), true);
  assert.throws(() => redeemJoinToken(db, sister.user.id, famTok), /already used/i);

  const ginv = createGuardianInvite(db, mom.user.id, kid.id);
  const gTok = issueGuardianClaimToken(db, ginv, mom.user.id);
  const gPeek = peekJoinToken(db, gTok);
  assert.equal(gPeek.channel, "guardian");
  assert.equal(gPeek.targetKidLabel, "Alex");
  const gOut = redeemJoinToken(db, dad.user.id, gTok, { householdName: "North" });
  assert.equal(gOut.channel, "guardian");
  assert.equal(gOut.line?.id, kid.id);
  assert.throws(() => redeemJoinToken(db, dad.user.id, gTok), /already used|not valid/i);
});

test("existing household redeems friend invite without a second Pod", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "Host");
  const b = registerParent(db, "Friend");
  const hhA = createHousehold(db, a.user.id, "House A");
  const hhB = createHousehold(db, b.user.id, "House B");
  const lineA = addLine(db, hhA.id, a.user.id, "A phone");
  const kid = addLine(db, hhA.id, a.user.id, "Sam", "softphone", { mode: "child" });
  updateLine(db, hhA.id, kid.id, { mode: "child", child_label: "Sam" }, { actorUserId: a.user.id });
  const lineB = addLine(db, hhB.id, b.user.id, "B phone");
  const invite = createInvite(db, hhA.id, a.user.id, { kind: "friend", targetKidLineId: kid.id });
  const redeemed = redeemInvite(db, invite.code, b.user.id, "Ignored name");
  assert.equal(redeemed.household.id, hhB.id);
  assert.equal(redeemed.created, false);
  const houses = db.prepare(`SELECT COUNT(*) AS n FROM households`).get() as { n: number };
  assert.equal(houses.n, 2);
  assert.throws(() => redeemInvite(db, createInvite(db, hhA.id, a.user.id).code, a.user.id, "X"), /own invite/i);
  const hostSphere = getSphereByOwner(db, a.user.id);
  const friendSphere = getSphereByOwner(db, b.user.id);
  assert.ok(hostSphere && friendSphere);
  assert.ok(listSphereMemberLineIds(db, hostSphere.id).includes(lineB.id));
  assert.ok(listSphereMemberLineIds(db, friendSphere.id).includes(kid.id));
  // Redeeming approves the inviting parent both ways — and nobody else on the host Pod.
  assert.equal(listSphereMemberLineIds(db, friendSphere.id).includes(lineA.id), true);
  const hostOther = addLine(db, hhA.id, a.user.id, "Spare phone");
  assert.equal(listSphereMemberLineIds(db, friendSphere.id).includes(hostOther.id), false);
  assert.equal(canCall(db, lineB.id, lineA.id).ok, true, "friend parent ↔ inviting parent");
});

test("family invite joins the inviter Pod; friend invite stays on one kid Circle", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const morgan = registerParent(db, "Morgan", { username: "hilfam", password: "password1" });
  const sister = registerParent(db, "Sister", { username: "sisfam", password: "password1" });
  const friend = registerParent(db, "Friend", { username: "frfam", password: "password1" });
  const otherParent = registerParent(db, "OtherWest", { username: "omill", password: "password1" });

  const hhWest = createHousehold(db, morgan.user.id, "West");
  addLine(db, hhWest.id, morgan.user.id, "Morgan phone");
  const sam = addLine(db, hhWest.id, morgan.user.id, "Sam", "softphone", { mode: "child" });
  updateLine(db, hhWest.id, sam.id, { mode: "child", child_label: "Sam" }, { actorUserId: morgan.user.id });
  const sibling = addLine(db, hhWest.id, morgan.user.id, "Sibling", "softphone", { mode: "child" });
  updateLine(db, hhWest.id, sibling.id, { mode: "child", child_label: "Sibling" }, { actorUserId: morgan.user.id });
  db.prepare(`INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'parent')`).run(
    hhWest.id,
    otherParent.user.id
  );
  addLine(db, hhWest.id, otherParent.user.id, "Other phone");

  const famInvite = createInvite(db, hhWest.id, morgan.user.id, { kind: "family" });
  const sisterJoin = redeemInvite(db, famInvite.code, sister.user.id, "IgnoredName");
  assert.equal(sisterJoin.created, false);
  assert.equal(sisterJoin.household.id, hhWest.id);
  assert.equal(sisterJoin.household.name, "West");
  assert.equal(userInHousehold(db, hhWest.id, sister.user.id), true);
  const sisterLine = addLine(db, hhWest.id, sister.user.id, "Sister phone");
  assert.equal(canViewerSeeLine(db, morgan.user.id, sisterLine.id), true);
  assert.equal(canViewerSeeLine(db, otherParent.user.id, sisterLine.id), true);

  // Sibling on the same Pod can Manage / Open shared Grandma.
  const grandma = provisionGrandparent(db, morgan.user.id, hhWest.id, {
    displayName: "Mom",
    username: "millegp",
    password: "password1",
    kidNickname: "Grandma",
    kidLineIds: [sam.id],
  });
  assert.equal(canAdminPodGrandparents(db, sister.user.id, hhWest.id), true);
  assert.equal(canAdminPodGrandparents(db, morgan.user.id, hhWest.id), true);
  assert.ok(grandma.relative);

  const friendInvite = createInvite(db, hhWest.id, morgan.user.id, {
    kind: "friend",
    targetKidLineId: sam.id,
  });
  const friendJoin = redeemInvite(db, friendInvite.code, friend.user.id, "Friend house");
  assert.equal(friendJoin.created, true);
  const friendLine = addLine(db, friendJoin.household.id, friend.user.id, "Friend phone");

  assert.equal(canViewerSeeLine(db, morgan.user.id, friendLine.id), true);
  assert.equal(canViewerSeeLine(db, friend.user.id, sam.id), true);
  assert.equal(canViewerSeeLine(db, friend.user.id, sibling.id), false);
  assert.equal(canViewerSeeLine(db, friend.user.id, sisterLine.id), false);

  // Sister / other Pod parents are NOT Sam’s guardians — they must not inherit his Circle friends.
  assert.equal(canViewerSeeLine(db, sister.user.id, friendLine.id), false);
  assert.equal(canViewerSeeLine(db, otherParent.user.id, friendLine.id), false);
  assert.equal(canViewerSeeLine(db, sister.user.id, sam.id), true); // same Pod kid
  const sisterSphere = getSphereByOwner(db, sister.user.id);
  if (sisterSphere) {
    assert.equal(listSphereMemberLineIds(db, sisterSphere.id).includes(friendLine.id), false);
  }

  // Sister’s own kid Circle is hers — Sam’s friend stays off it.
  const cousin = addLine(db, hhWest.id, sister.user.id, "Cousin", "softphone", { mode: "child" });
  updateLine(
    db,
    hhWest.id,
    cousin.id,
    { mode: "child", child_label: "Cousin" },
    { actorUserId: sister.user.id }
  );
  const cousinFriend = registerParent(db, "CousinFriend", { username: "cffam", password: "password1" });
  const cfInvite = createInvite(db, hhWest.id, sister.user.id, {
    kind: "friend",
    targetKidLineId: cousin.id,
  });
  const cfJoin = redeemInvite(db, cfInvite.code, cousinFriend.user.id, "CF house");
  const cfLine = addLine(db, cfJoin.household.id, cousinFriend.user.id, "CF phone");
  assert.equal(canViewerSeeLine(db, sister.user.id, cfLine.id), true);
  // Household owner is auto-guardian of new kids — may see niece Circles; aunt still must not see Sam’s.
  assert.equal(canViewerSeeLine(db, sister.user.id, friendLine.id), false);

  // Grandma West: grandchildren + West parents — never Circle friends.
  const gpUserId = grandma.line.owner_user_id;
  assert.equal(canViewerSeeLine(db, gpUserId, sisterLine.id), true, "GP sees this Pod’s parents");
  assert.equal(canViewerSeeLine(db, gpUserId, sam.id), true);
  assert.equal(canViewerSeeLine(db, gpUserId, cousin.id), true);
  assert.equal(canViewerSeeLine(db, gpUserId, friendLine.id), false);
  assert.equal(canViewerSeeLine(db, gpUserId, cfLine.id), false);
  const bookIds = new Set(podBookLines(db, hhWest.id).map((l) => l.id));
  assert.equal(bookIds.has(sisterLine.id), false);
  assert.equal(bookIds.has(sam.id), true);
  assert.equal(bookIds.has(cousin.id), true);
  assert.equal(bookIds.has(friendLine.id), false);
  assert.equal(bookIds.has(cfLine.id), false);

  // Friend is not a West Pod member.
  assert.equal(userInHousehold(db, hhWest.id, friend.user.id), false);
  assert.equal(canAdminPodGrandparents(db, friend.user.id, hhWest.id), false);

  const friendSphere = getSphereByOwner(db, friend.user.id);
  assert.ok(friendSphere);
  assert.equal(listSphereMemberLineIds(db, friendSphere.id).includes(sam.id), true);
  assert.equal(listSphereMemberLineIds(db, friendSphere.id).includes(sibling.id), false);
  assert.equal(listSphereMemberLineIds(db, friendSphere.id).includes(sisterLine.id), false);

  assert.throws(
    () => createInvite(db, hhWest.id, morgan.user.id, { kind: "friend" }),
    /which kid/i
  );
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
  // Child-only accounts cannot redeem parent→parent invites either.
  const other = registerParent(db, "Other", { username: "othpar", password: "password1" });
  const hhOther = createHousehold(db, other.user.id, "Other");
  addLine(db, hhOther.id, other.user.id, "Other phone");
  const famCode = createInvite(db, hhOther.id, other.user.id, { kind: "family" }).code;
  assert.throws(() => redeemInvite(db, famCode, login.childUser.id, "Nope"), /only parents/i);
  assert.throws(() => redeemInvite(db, famCode, kid.user.id, "Nope"), /only parents/i);

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
  const kid = registerParent(db, "Alex", { username: "gem3", password: "password1" });
  const hh = createHousehold(db, parent.user.id, "East");
  addLine(db, hh.id, parent.user.id, "Parent phone");
  db.prepare(`INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'member')`).run(
    hh.id,
    kid.user.id
  );
  const kidLine = addLine(db, hh.id, kid.user.id, "Alex phone");
  updateLine(db, hh.id, kidLine.id, { mode: "child", child_label: "Alex" }, { actorUserId: parent.user.id });
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

test("kid → provisioned grandparent rings through GP evening Do Not Disturb", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const mom = registerParent(db, "Mom", { username: "momgp_dnd", password: "password1" });
  const hh = createHousehold(db, mom.user.id, "East");
  addLine(db, hh.id, mom.user.id, "Mom phone");
  const kid = addLine(db, hh.id, mom.user.id, "Alex", "softphone", { mode: "child" });
  updateLine(db, hh.id, kid.id, { mode: "child", child_label: "Alex" }, { actorUserId: mom.user.id });
  db.prepare(
    `UPDATE households SET schedule_preset = 'open', quiet_start = NULL, quiet_end = NULL, dnd = 0 WHERE id = ?`
  ).run(hh.id);

  const created = provisionGrandparent(db, mom.user.id, hh.id, {
    displayName: "Parker",
    username: "parker_dnd_test",
    password: "16Monkeys!",
    label: "Papa",
    kidNickname: "Papa",
    kidLineIds: [kid.id],
  });

  // Factory evenings on the GP household — same as live Parker.
  updateHouseholdRules(db, created.household.id, {
    parent_schedule_preset: "evenings",
    parent_quiet_tz: "America/New_York",
  });
  db.prepare(`UPDATE households SET dnd = 1 WHERE id = ?`).run(created.household.id);

  const evening = new Date("2026-09-15T02:30:00Z"); // 22:30 America/New_York
  const ok = canCall(db, kid.id, created.line.id, evening);
  assert.equal(ok.ok, true, "grandchild must reach Papa through evening Quiet Time");

  // Adult→GP still blocked by GP DND when not VIP.
  const dad = registerParent(db, "Dad", { username: "dad_dnd_test", password: "password1" });
  const hhDad = createHousehold(db, dad.user.id, "Other");
  const dadLine = addLine(db, hhDad.id, dad.user.id, "Dad phone");
  addAllowlist(db, hhDad.id, created.line.id, "Papa");
  addAllowlist(db, created.household.id, dadLine.id, "Dad");
  const adultBlocked = canCall(db, dadLine.id, created.line.id, evening);
  assert.equal(adultBlocked.ok, false);
});

test("School preset sets weekdays + holiday skip; canCall voice is school", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const b = registerParent(db, "B");
  const hhA = createHousehold(db, a.user.id, "House A");
  const hhB = createHousehold(db, b.user.id, "House B");
  addLine(db, hhA.id, a.user.id, "A phone");
  const lineB = addLine(db, hhB.id, b.user.id, "B phone");
  updateLine(db, hhB.id, lineB.id, { mode: "child", child_label: "Kid B" }, { actorUserId: b.user.id });
  const kidA = addLine(db, hhA.id, a.user.id, "Kid A", "softphone", { mode: "child" });
  updateLine(db, hhA.id, kidA.id, { mode: "child", child_label: "Kid A" }, { actorUserId: a.user.id });
  addAllowlist(db, hhA.id, lineB.id, "B");
  addAllowlist(db, hhB.id, kidA.id, "A");
  updateHouseholdRules(db, hhA.id, { schedule_preset: "open", parent_schedule_preset: "open" });

  const saved = updateHouseholdRules(db, hhB.id, {
    schedule_preset: "school",
    quiet_tz: "America/Chicago",
  });
  assert.equal(saved.quiet_days, "1,2,3,4,5");
  assert.equal(saved.skip_holidays, 1);
  assert.equal(saved.quiet_start, "08:00");

  const wedSchool = new Date("2026-08-19T15:00:00.000Z"); // Wed 10:00 CT
  const blocked = canCall(db, kidA.id, lineB.id, wedSchool);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.voice, "school");
    assert.match(blocked.spoken, /at school/i);
  }

  const sat = new Date("2026-08-22T15:00:00.000Z");
  assert.equal(canCall(db, kidA.id, lineB.id, sat).ok, true);
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
  // Open parent DND on both houses so this test isolates kid bedtime vs parent inbound DND.
  updateHouseholdRules(db, hhA.id, { parent_schedule_preset: "open" });
  updateHouseholdRules(db, hhB.id, {
    schedule_preset: "bedtime",
    quiet_tz: "America/Los_Angeles",
    parent_schedule_preset: "open",
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

test("adult DND timezone is per phone — not shared across co-parents on a Pod", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const cameron = registerParent(db, "Cameron", { username: "cameron_tz", password: "password1" });
  const dad = registerParent(db, "Dad", { username: "dad_tz", password: "password1" });
  const hh = createHousehold(db, cameron.user.id, "East");
  db.prepare(`INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'member')`).run(
    hh.id,
    dad.user.id
  );
  const cameronLine = addLine(db, hh.id, cameron.user.id, "Cameron phone");
  const dadLine = addLine(db, hh.id, dad.user.id, "Dad phone");
  addAllowlist(db, hh.id, cameronLine.id, "Cameron");
  // Same-house adults can reach each other without allowlist, but keep mutual for clarity.
  addAllowlist(db, hh.id, dadLine.id, "Dad");

  updateHouseholdRules(
    db,
    hh.id,
    {
      parent_schedule_preset: "evenings",
      parent_quiet_tz: "America/Denver",
      adult_line_id: dadLine.id,
    },
    { actorUserId: cameron.user.id }
  );
  updateHouseholdRules(
    db,
    hh.id,
    {
      parent_schedule_preset: "evenings",
      parent_quiet_tz: "America/New_York",
      adult_line_id: cameronLine.id,
    },
    { actorUserId: cameron.user.id }
  );

  const dadRow = db.prepare(`SELECT parent_quiet_tz FROM lines WHERE id = ?`).get(dadLine.id) as {
    parent_quiet_tz: string;
  };
  const cameronRow = db.prepare(`SELECT parent_quiet_tz FROM lines WHERE id = ?`).get(cameronLine.id) as {
    parent_quiet_tz: string;
  };
  assert.equal(dadRow.parent_quiet_tz, "America/Denver");
  assert.equal(cameronRow.parent_quiet_tz, "America/New_York");

  const snapCameron = householdSnapshot(db, cameron.user.id);
  const snapDad = householdSnapshot(db, dad.user.id);
  assert.equal(snapCameron.households[0].parent_quiet_tz, "America/New_York");
  assert.equal(snapDad.households[0].parent_quiet_tz, "America/Denver");

  // 03:00 UTC = 21:00 Denver (in evenings) and 23:00 New York (also in evenings).
  const eveningBoth = new Date("2026-01-15T04:00:00.000Z"); // 21:00 MT / 23:00 ET
  assert.equal(canCall(db, cameronLine.id, dadLine.id, eveningBoth).ok, false);

  // 02:00 UTC = 19:00 Denver (outside) / 21:00 New York (inside evenings).
  const denverOpenNyQuiet = new Date("2026-01-15T02:00:00.000Z");
  assert.equal(canCall(db, cameronLine.id, dadLine.id, denverOpenNyQuiet).ok, true);
  assert.equal(canCall(db, dadLine.id, cameronLine.id, denverOpenNyQuiet).ok, false);
});

test("kids Quiet Time timezone inherits from the owning parent’s phone", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const cameron = registerParent(db, "Cameron", { username: "cameron_kid_tz", password: "password1" });
  const cousin = registerParent(db, "Cousin", { username: "cousin_kid_tz", password: "password1" });
  const hh = createHousehold(db, cameron.user.id, "East");
  const hhCousin = createHousehold(db, cousin.user.id, "Cousin");
  const cameronLine = addLine(db, hh.id, cameron.user.id, "Cameron phone");
  const cousinKid = addLine(db, hhCousin.id, cousin.user.id, "Cousin kid", "softphone", { mode: "child" });
  updateLine(db, hhCousin.id, cousinKid.id, { mode: "child", child_label: "Cousin kid" }, {
    actorUserId: cousin.user.id,
  });
  const kid = addLine(db, hh.id, cameron.user.id, "Alex", "softphone", { mode: "child" });
  updateLine(db, hh.id, kid.id, { mode: "child", child_label: "Alex" }, { actorUserId: cameron.user.id });
  addAllowlist(db, hhCousin.id, kid.id, "Alex");
  addAllowlist(db, hh.id, cousinKid.id, "Cousin kid");

  updateHouseholdRules(db, hh.id, { schedule_preset: "open", parent_schedule_preset: "open" });
  updateHouseholdRules(db, hhCousin.id, { schedule_preset: "open", parent_schedule_preset: "open" });

  // Parent in Denver; kid bedtime 20:00–07:00 — no separate kids TZ.
  updateHouseholdRules(
    db,
    hh.id,
    {
      parent_schedule_preset: "evenings",
      parent_quiet_tz: "America/Denver",
      adult_line_id: cameronLine.id,
    },
    { actorUserId: cameron.user.id }
  );
  updateHouseholdRules(db, hh.id, {
    schedule_preset: "bedtime",
    quiet_start: "20:00",
    quiet_end: "07:00",
    // Stale East Coast value must not win over the parent’s Denver TZ.
    quiet_tz: "America/New_York",
  });

  const policy = quietPolicyForLine(
    kid,
    db.prepare(`SELECT * FROM households WHERE id = ?`).get(hh.id) as Household,
    db
  );
  assert.equal(policy.quiet_tz, "America/Denver");

  // 02:00 UTC = 19:00 Denver (outside bedtime) / 21:00 New York (inside).
  const denverOpen = new Date("2026-01-15T02:00:00.000Z");
  assert.equal(canCall(db, cousinKid.id, kid.id, denverOpen).ok, true);

  // 03:30 UTC = 20:30 Denver (inside bedtime).
  const denverQuiet = new Date("2026-01-15T03:30:00.000Z");
  assert.equal(canCall(db, cousinKid.id, kid.id, denverQuiet).ok, false);
});

test("parent can leave voicemail for same-household kid without allowlist", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const parent = registerParent(db, "Cameron");
  const hh = createHousehold(db, parent.user.id, "Home");
  const parentLine = addLine(db, hh.id, parent.user.id, "Cameron's phone");
  const kidLine = addLine(db, hh.id, parent.user.id, "Alex's phone");
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
  const reg = registerParent(db, "Cameron", { username: "Cameron", password: "secret123" });
  assert.equal(reg.user.username, "cameron");
  assert.ok(reg.user.password_hash?.startsWith("scrypt$"));
  assert.equal(verifyPassword("secret123", reg.user.password_hash), true);
  assert.equal(verifyPassword("wrong", reg.user.password_hash), false);

  const pub = publicUser(reg.user);
  assert.equal(pub.has_password, true);
  assert.equal(pub.username, "cameron");
  assert.equal((pub as { password_hash?: string }).password_hash, undefined);

  const login = loginWithPassword(db, "cameron", "secret123");
  assert.equal(login.user.id, reg.user.id);
  assert.equal(loginWithPassword(db, "Cameron", "secret123").user.id, reg.user.id);
  assert.equal(loginWithPassword(db, "CAMERON", "secret123").user.id, reg.user.id);
  assert.throws(() => loginWithPassword(db, "cameron", "nope"));
  assert.throws(() =>
    registerParent(db, "Other", { username: "cameron", password: "another12" })
  );
  assert.throws(() =>
    registerParent(db, "Other", { username: "CAMERON", password: "another12" })
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
  const reg = registerParent(db, "Cameron Lars", { username: "Cameron", password: "secret123" });
  assert.equal(reg.user.username, "cameron");
  assert.equal(reg.user.display_name, "Cameron Lars");
  const again = loginWithPassword(db, "CAMERON", "secret123");
  assert.equal(again.user.display_name, "Cameron Lars");
  assert.equal(again.user.username, "cameron");
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
  // Co-parent keeps their own Pod — does not join the kid’s household.
  assert.equal(userInHousehold(db, hhMom.id, dad.user.id), false);

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
  // Co-parent keeps Dad House — does not join the kid’s household.
  assert.equal(
    Boolean(
      db
        .prepare(`SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?`)
        .get(hh.id, dad.user.id)
    ),
    false
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

test("guardian redeem creates own family Pod when missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const mom = registerParent(db, "Mom", { username: "momnewpod", password: "password1" });
  const dad = registerParent(db, "Dad", { username: "dadnewpod", password: "password1" });
  const hh = createHousehold(db, mom.user.id, "West");
  const line = addLine(db, hh.id, mom.user.id, "Kid");
  updateLine(db, hh.id, line.id, { mode: "child", child_label: "Sam" }, { actorUserId: mom.user.id });

  const invite = createGuardianInvite(db, mom.user.id, line.id);
  assert.throws(() => redeemGuardianInvite(db, dad.user.id, invite.code), /family/i);

  const fresh = createGuardianInvite(db, mom.user.id, line.id);
  redeemGuardianInvite(db, dad.user.id, fresh.code, { householdName: "North" });
  assert.equal(userInHousehold(db, hh.id, dad.user.id), false);
  const dadPods = db
    .prepare(`SELECT h.name FROM household_members hm JOIN households h ON h.id = hm.household_id WHERE hm.user_id = ?`)
    .all(dad.user.id) as { name: string }[];
  assert.deepEqual(
    dadPods.map((p) => p.name),
    ["North"]
  );
});

test("guardian co-parent in another household gets dial 2 and mutual allowlist", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const mom = registerParent(db, "Mom", { username: "momcp", password: "password1" });
  const dad = registerParent(db, "Dad", { username: "dadcp", password: "password1" });
  const hhKid = createHousehold(db, mom.user.id, "East");
  const hhDad = createHousehold(db, dad.user.id, "Drew House");
  const momLine = addLine(db, hhKid.id, mom.user.id, "Mom phone");
  const dadLine = addLine(db, hhDad.id, dad.user.id, "Drew phone");
  const kid = addLine(db, hhKid.id, mom.user.id, "Sam phone");
  updateLine(db, hhKid.id, kid.id, { mode: "child", child_label: "Sam" }, { actorUserId: mom.user.id });
  upsertAtaDevice(
    db,
    kid.id,
    {
      sip_extension: "2001",
      sip_password: "example-sip-pass",
      sip_server: "192.168.2.105",
    },
    { allowSipCredentialOverride: true }
  );

  addGuardianByUsername(db, mom.user.id, kid.id, "dadcp");

  const secondary = householdSecondaryParentLine(db, hhKid.id);
  assert.ok(secondary);
  assert.equal(secondary?.id, dadLine.id);

  const dial2 = resolveAtaDial(db, "2001", "2");
  assert.equal(dial2.ok, true);
  if (dial2.ok && !("treeHouse" in dial2 && dial2.treeHouse)) {
    assert.equal(dial2.toLineId, dadLine.id);
  }

  assert.equal(canCall(db, kid.id, dadLine.id).ok, true);
  assert.equal(canCall(db, dadLine.id, kid.id).ok, true);

  const kidAl = db
    .prepare(`SELECT speed_dial FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
    .get(hhKid.id, dadLine.id) as { speed_dial: number | null };
  assert.equal(kidAl.speed_dial, 2);
  assert.ok(
    db.prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`).get(hhDad.id, kid.id)
  );
  assert.ok(momLine.id);
});

test("kid pads 1/2 use real co-parent, not a second Dad allowlist row", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const dad = registerParent(db, "Cameron", { username: "pad1dad", password: "password1" });
  const mom = registerParent(db, "Jordan", { username: "pad2mom", password: "password1" });
  const hhDad = createHousehold(db, dad.user.id, "East");
  const hhMom = createHousehold(db, mom.user.id, "East");
  const dadLine = addLine(db, hhDad.id, dad.user.id, "Cameron's phone");
  const momLine = addLine(db, hhMom.id, mom.user.id, "Jordan's phone");
  const kid = addLine(db, hhDad.id, dad.user.id, "Alex phone");
  updateLine(db, hhDad.id, kid.id, { mode: "child", child_label: "Alex" }, { actorUserId: dad.user.id });
  upsertAtaDevice(
    db,
    kid.id,
    {
      sip_extension: "2008",
      sip_password: "example-sip-pass",
      sip_server: "192.168.2.105",
    },
    { allowSipCredentialOverride: true }
  );
  addGuardianByUsername(db, dad.user.id, kid.id, "pad2mom");
  updateUserProfile(db, dad.user.id, { parent_title: "dad" });

  // Live bug: leftover "Dad" on speed dial 2 pointed at the home parent’s own line.
  db.prepare(`UPDATE allowlist SET speed_dial = 6, label = 'Jordan' WHERE household_id = ? AND target_line_id = ?`).run(
    hhDad.id,
    momLine.id
  );
  db.prepare(
    `INSERT OR REPLACE INTO allowlist (id, household_id, target_line_id, label, speed_dial, favorite, always_allow, created_at)
     VALUES ('al_self_dad', ?, ?, 'Dad', 2, 1, 1, ?)`
  ).run(hhDad.id, dadLine.id, new Date().toISOString());

  assert.equal(householdAdminParentLine(db, hhDad.id)?.id, dadLine.id);
  assert.equal(householdSecondaryParentLine(db, hhDad.id)?.id, momLine.id);
  assert.equal(householdKidPad1ParentLine(db, hhDad.id)?.id, dadLine.id);
  assert.equal(householdKidPad2ParentLine(db, hhDad.id)?.id, momLine.id);

  const dial2 = resolveAtaDial(db, "2008", "2");
  assert.equal(dial2.ok, true);
  if (dial2.ok && !("treeHouse" in dial2 && dial2.treeHouse)) {
    assert.equal(dial2.toLineId, momLine.id);
    assert.match(dial2.toLabel, /Jordan/i);
  }

  setHouseholdParentTitle(db, dad.user.id, hhDad.id, mom.user.id, "mom");
  assert.equal(parentDisplayLabel(db, momLine.id), "Mom");
  const afterTitle = resolveAtaDial(db, "2008", "2");
  if (afterTitle.ok && !("treeHouse" in afterTitle && afterTitle.treeHouse)) {
    assert.equal(afterTitle.toLabel, "Mom");
  }

  syncGuardianCoParentAllowlist(db, kid.id, mom.user.id);
  const selfRow = db
    .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
    .get(hhDad.id, dadLine.id);
  assert.equal(selfRow, undefined);
  const momAl = db
    .prepare(`SELECT speed_dial, label FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
    .get(hhDad.id, momLine.id) as { speed_dial: number; label: string };
  assert.equal(momAl.speed_dial, 2);
  assert.equal(momAl.label, "Mom");

  updateHouseholdRules(db, hhDad.id, { pad1_parent_line_id: momLine.id });
  assert.equal(householdKidPad1ParentLine(db, hhDad.id)?.id, momLine.id);
  assert.equal(householdKidPad2ParentLine(db, hhDad.id)?.id, dadLine.id);
  const swapped1 = resolveAtaDial(db, "2008", "1");
  if (swapped1.ok && !("treeHouse" in swapped1 && swapped1.treeHouse)) {
    assert.equal(swapped1.toLineId, momLine.id);
  }

  const snap = householdSnapshot(db, dad.user.id);
  const pod = snap.households.find((h: { id: string }) => h.id === hhDad.id) as {
    admin_parent?: { line_id: string; parent_title: string | null };
    secondary_parent?: { line_id: string; parent_title: string | null; label: string };
    pad1_parent?: { line_id: string };
    pad2_parent?: { line_id: string };
    members: { user_id: string; parent_title: string | null }[];
  };
  assert.equal(pod.admin_parent?.line_id, dadLine.id);
  assert.equal(pod.secondary_parent?.line_id, momLine.id);
  assert.equal(pod.secondary_parent?.parent_title, "mom");
  assert.equal(pod.pad1_parent?.line_id, momLine.id);
  assert.equal(pod.pad2_parent?.line_id, dadLine.id);
  // Co-parent is guardian only — not a East household member.
  assert.equal(userInHousehold(db, hhDad.id, mom.user.id), false);

  const stranger = registerParent(db, "Stranger", { username: "pad2nope", password: "password1" });
  assert.throws(
    () => setHouseholdParentTitle(db, dad.user.id, hhDad.id, stranger.user.id, "mom"),
    /not a parent/i
  );
});

test("Alex+Riley on allowlist 2 blocks co-parent pad synthesis; North parents only operate guarded kids", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const casey = registerParent(db, "Casey North", { username: "northcasey", password: "password1" });
  const jordan = registerParent(db, "Jordan North", { username: "northjordan2", password: "password1" });
  const cameron = registerParent(db, "Cameron", { username: "northcameron", password: "password1" });
  const hh = createHousehold(db, casey.user.id, "North");
  const caseyLine = addLine(db, hh.id, casey.user.id, "Casey phone");
  const jordanLine = addLine(db, hh.id, jordan.user.id, "Jordan phone");
  const quinn = addLine(db, hh.id, casey.user.id, "Quinn");
  updateLine(db, hh.id, quinn.id, { mode: "child", child_label: "Quinn" }, { actorUserId: casey.user.id });
  ensureHouseholdParentMember(db, hh.id, jordan.user.id);
  const hhEast = createHousehold(db, cameron.user.id, "East");
  const cameronLine = addLine(db, hhEast.id, cameron.user.id, "Cameron phone");
  const alex = addLine(db, hhEast.id, cameron.user.id, "Alex + Riley");
  updateLine(
    db,
    hhEast.id,
    alex.id,
    { mode: "child", child_label: "Alex + Riley" },
    { actorUserId: cameron.user.id }
  );
  ensureGuardian(db, alex.id, jordan.user.id);
  upsertAtaDevice(
    db,
    alex.id,
    {
      sip_extension: "2022",
      sip_password: "example-sip-pass",
      sip_server: "192.168.2.105",
    },
    { allowSipCredentialOverride: true }
  );
  addAllowlist(db, hh.id, alex.id, "Alex + Riley", { speedDial: 2 });

  assert.equal(householdKidPad2ParentLine(db, hh.id), null);
  assert.equal(userCanOperateLine(db, casey.user.id, caseyLine.id), true);
  assert.equal(userCanOperateLine(db, casey.user.id, jordanLine.id), false);
  assert.equal(userCanOperateLine(db, casey.user.id, quinn.id), true);
  assert.equal(userCanOperateLine(db, casey.user.id, alex.id), false);
  assert.equal(userCanOperateLine(db, jordan.user.id, jordanLine.id), true);
  assert.equal(userCanOperateLine(db, jordan.user.id, caseyLine.id), false);
  assert.equal(userCanOperateLine(db, jordan.user.id, quinn.id), false);
  assert.equal(userCanOperateLine(db, jordan.user.id, alex.id), true);

  // Alex’s ATA dial 2 → co-parent Jordan (multi-Pod / guardian), not blocked.
  const dial2 = resolveAtaDial(db, "2022", "2");
  assert.equal(dial2.ok, true);
  if (dial2.ok && "toLineId" in dial2) {
    assert.equal(dial2.toLineId, jordanLine.id);
  }

  const caseySnap = householdSnapshot(db, casey.user.id);
  const pod = caseySnap.households.find((h) => h.id === hh.id)!;
  assert.equal(pod.pad2_parent, null);
  const jordanRow = pod.lines.find((l) => l.id === jordanLine.id)!;
  assert.equal(jordanRow.can_operate, false);
  const quinnRow = pod.lines.find((l) => l.id === quinn.id)!;
  assert.equal(quinnRow.can_operate, true);

  const jordanSnap = householdSnapshot(db, jordan.user.id);
  const north = jordanSnap.households.find((h) => h.id === hh.id)!;
  const quinnForJordan = north.lines.find((l) => l.id === quinn.id)!;
  assert.equal(quinnForJordan.can_operate, false);
  const east = jordanSnap.households.find((h) => h.id === hhEast.id)!;
  const alexForJordan = east.lines.find((l) => l.id === alex.id)!;
  assert.equal(alexForJordan.can_operate, true);
});

test("multi-Pod kid snapshot lists family peers for the kid pad only", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-pod-peers-"));
  const db = openDb(path.join(dir, "t.db"));
  const cameron = registerParent(db, "Cameron", { username: "podpeerst", password: "password1" });
  const jordan = registerParent(db, "Jordan", { username: "podpeersk", password: "password1" });
  const casey = registerParent(db, "Casey", { username: "podpeersm", password: "password1" });
  const drew = registerParent(db, "Drew", { username: "podpeersty", password: "password1" });
  const hhEast = createHousehold(db, cameron.user.id, "East");
  const hhNorth = createHousehold(db, casey.user.id, "North");
  ensureHouseholdParentMember(db, hhNorth.id, jordan.user.id);
  ensureHouseholdParentMember(db, hhNorth.id, drew.user.id);
  addLine(db, hhEast.id, cameron.user.id, "Cameron's phone");
  addLine(db, hhNorth.id, jordan.user.id, "Jordan's phone");
  addLine(db, hhNorth.id, casey.user.id, "Casey's phone");
  addLine(db, hhNorth.id, drew.user.id, "Drew's phone");
  const alex = addLine(db, hhEast.id, cameron.user.id, "Alex + Riley");
  updateLine(
    db,
    hhEast.id,
    alex.id,
    { mode: "child", child_label: "Alex + Riley" },
    { actorUserId: cameron.user.id }
  );
  ensureGuardian(db, alex.id, jordan.user.id);
  const quinn = addLine(db, hhNorth.id, casey.user.id, "Quinn");
  updateLine(
    db,
    hhNorth.id,
    quinn.id,
    { mode: "child", child_label: "Quinn" },
    { actorUserId: casey.user.id }
  );
  const sam = addLine(db, hhNorth.id, drew.user.id, "Sam");
  updateLine(
    db,
    hhNorth.id,
    sam.id,
    { mode: "child", child_label: "Sam & Blake" },
    { actorUserId: drew.user.id }
  );

  const peers = listKidPodFamilyPeers(db, alex.id);
  const peerIds = new Set(peers.map((p) => p.id));
  assert.ok(peerIds.has(quinn.id));
  assert.ok(peerIds.has(sam.id));
  assert.equal(peerIds.has(alex.id), false);

  const snap = householdSnapshot(db, cameron.user.id);
  const east = snap.households.find((h) => h.id === hhEast.id)!;
  const alexLine = east.lines.find((l) => l.id === alex.id) as {
    pod_family_kids?: { id: string }[];
  };
  const snapIds = new Set((alexLine.pod_family_kids || []).map((p) => p.id));
  assert.ok(snapIds.has(quinn.id), "Cameron sees Quinn on Alex’s Circle payload");
  assert.ok(snapIds.has(sam.id), "Cameron sees Sam on Alex’s Circle payload");

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("merged grandparents never steal kid pad 2 from the guardian co-parent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-gp-pad2-"));
  const db = openDb(path.join(dir, "t.db"));
  const dad = registerParent(db, "Cameron", { username: "gpstealpad2t", password: "password1" });
  const mom = registerParent(db, "Jordan", { username: "gpstealpad2k", password: "password1" });
  const hhEast = createHousehold(db, dad.user.id, "East");
  const hhNorth = createHousehold(db, mom.user.id, "North");
  const dadLine = addLine(db, hhEast.id, dad.user.id, "Cameron's phone");
  const momLine = addLine(db, hhNorth.id, mom.user.id, "Jordan's phone");
  const kid = addLine(db, hhEast.id, dad.user.id, "Alex + Riley");
  updateLine(
    db,
    hhEast.id,
    kid.id,
    { mode: "child", child_label: "Alex + Riley" },
    { actorUserId: dad.user.id }
  );
  ensureGuardian(db, kid.id, mom.user.id);
  const gp = provisionGrandparent(db, dad.user.id, hhEast.id, {
    displayName: "Sloan",
    username: "gpstealpad2sloan",
    password: "password1",
    kidNickname: "Gramma",
    kidLineIds: [kid.id],
  });

  assert.equal(householdAdminParentLine(db, hhEast.id)?.id, dadLine.id);
  assert.equal(
    householdSecondaryParentLine(db, hhEast.id)?.id,
    momLine.id,
    "co-parent is Jordan, not Gramma"
  );
  assert.equal(householdKidPad2ParentLine(db, hhEast.id)?.id, momLine.id);
  assert.notEqual(householdSecondaryParentLine(db, hhEast.id)?.id, gp.line.id);

  const snap = householdSnapshot(db, dad.user.id);
  const pod = snap.households.find((h) => h.id === hhEast.id)!;
  assert.equal(pod.pad2_parent?.line_id, momLine.id);
  assert.equal(pod.secondary_parent?.line_id, momLine.id);

  // East GP softphone / ATA must never inherit North co-parent as Mom on dial 2.
  const gpSnap = householdSnapshot(db, gp.line.owner_user_id);
  const gpPod = gpSnap.households.find((h) => h.id === gp.household.id)!;
  assert.equal(gpPod.pad2_parent, null);
  assert.equal(gpPod.secondary_parent, null);
  assert.equal(gpPod.pad1_parent, null);
  // East GP sees East’s parent (Cameron) — never North co-parent Jordan.
  // Grandchild may appear as a line (merged onto family Pod) or allowlist row (private GP house).
  const allGpLines = (gpSnap.households || []).flatMap((h: { lines?: { id: string }[] }) => h.lines || []);
  const allGpAllow = (gpSnap.households || []).flatMap(
    (h: { allowlist?: { target_line_id: string }[] }) => h.allowlist || []
  );
  const gpLineIds = new Set(allGpLines.map((l) => l.id));
  const gpAllowIds = new Set(allGpAllow.map((a) => a.target_line_id));
  assert.equal(gpLineIds.has(gp.line.id) || gpAllowIds.has(gp.line.id), true);
  assert.equal(
    gpLineIds.has(kid.id) || gpAllowIds.has(kid.id),
    true,
    "grandchild on GP lines or allowlist"
  );
  assert.equal(
    gpLineIds.has(dadLine.id) || gpAllowIds.has(dadLine.id),
    true,
    "East GP sees Cameron (East parent)"
  );
  assert.equal(gpLineIds.has(momLine.id), false, "GP must not see Jordan on lines");
  assert.equal(gpAllowIds.has(momLine.id), false, "GP must not see Jordan on allowlist");
  assert.equal(
    canViewerSeeLine(db, gp.line.owner_user_id, momLine.id),
    false,
    "East GP must not discover North co-parent"
  );
  // Drift Jordan onto the GP Circle — scrub must remove her.
  const gpSphere = ensureSphereForParent(db, gp.line.owner_user_id);
  addLineToSphere(db, gpSphere.id, momLine.id, dad.user.id);
  householdSnapshot(db, gp.line.owner_user_id);
  assert.equal(
    canViewerSeeLine(db, gp.line.owner_user_id, momLine.id),
    false,
    "scrub clears North co-parent from GP Circle"
  );
  assert.equal(
    listSphereMemberLineIds(db, gpSphere.id).includes(momLine.id),
    false
  );
  assert.equal(
    gpSnap.directory.some((d) => d.id === momLine.id),
    false
  );
  assert.deepEqual(
    listGrandparentDialKids(db, gp.line.owner_user_id).map((l) => l.id),
    [kid.id]
  );

  upsertAtaDevice(
    db,
    gp.line.id,
    {
      sip_extension: "2188",
      sip_password: "example-sip-pass",
      sip_server: "mothership.example",
      display_name: "Sloan ATA",
    },
    { allowSipCredentialOverride: true }
  );
  const gpDial1 = resolveAtaDial(db, "2188", "1");
  assert.equal(gpDial1.ok, true);
  if (gpDial1.ok && !("treeHouse" in gpDial1) && !("grandparentsMenu" in gpDial1)) {
    assert.equal(gpDial1.toLineId, kid.id, "GP dial 1 = grandchild");
  }
  const gpDial2 = resolveAtaDial(db, "2188", "2");
  assert.ok(gpDial2.ok && "toLineId" in gpDial2, "GP dial 2 = East parent");
  if (gpDial2.ok && "toLineId" in gpDial2) {
    assert.equal(gpDial2.toLineId, dadLine.id, "GP dial 2 = Cameron, never Jordan");
  }

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("clearing a cousin speed dial drops analog resolve without touching locked 1/2", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const dad = registerParent(db, "Cameron", { username: "sdremdad", password: "password1" });
  const mom = registerParent(db, "Jordan", { username: "sdremmom", password: "password1" });
  const cousin = registerParent(db, "Quinns Dad", { username: "sdremquinn", password: "password1" });
  const hhDad = createHousehold(db, dad.user.id, "East");
  const hhMom = createHousehold(db, mom.user.id, "East");
  const hhCousin = createHousehold(db, cousin.user.id, "North");
  const dadLine = addLine(db, hhDad.id, dad.user.id, "Cameron's phone");
  const momLine = addLine(db, hhMom.id, mom.user.id, "Jordan's phone");
  const cousinLine = addLine(db, hhCousin.id, cousin.user.id, "Quinns Dads phone");
  const quinn = addLine(db, hhCousin.id, cousin.user.id, "Quinn", "softphone", { mode: "child" });
  updateLine(
    db,
    hhCousin.id,
    quinn.id,
    { mode: "child", child_label: "Quinn" },
    { actorUserId: cousin.user.id }
  );
  const kid = addLine(db, hhDad.id, dad.user.id, "Alex phone");
  updateLine(db, hhDad.id, kid.id, { mode: "child", child_label: "Alex" }, { actorUserId: dad.user.id });
  upsertAtaDevice(
    db,
    kid.id,
    {
      sip_extension: "2018",
      sip_password: "example-sip-pass",
      sip_server: "192.168.2.105",
    },
    { allowSipCredentialOverride: true }
  );
  addGuardianByUsername(db, dad.user.id, kid.id, "sdremmom");
  addAllowlist(db, hhCousin.id, kid.id, "Alex");
  // Kid pad dials the cousin *kid*, not Quinns Dad (other adults stay off Circles).
  const cousinAl = addAllowlist(db, hhDad.id, quinn.id, "Quinn", { speedDial: 5 });

  const before = resolveAtaDial(db, "2018", "5");
  assert.equal(before.ok, true);
  if (before.ok && !("treeHouse" in before && before.treeHouse)) {
    assert.equal(before.toLineId, quinn.id);
  }

  updateAllowlistEntry(db, hhDad.id, cousinAl.id, { speed_dial: null });
  const gone = resolveAtaDial(db, "2018", "5");
  assert.equal(gone.ok, false);

  const dial1 = resolveAtaDial(db, "2018", "1");
  assert.equal(dial1.ok, true);
  if (dial1.ok && !("treeHouse" in dial1 && dial1.treeHouse)) {
    assert.equal(dial1.toLineId, dadLine.id);
  }
  const dial2 = resolveAtaDial(db, "2018", "2");
  assert.equal(dial2.ok, true);
  if (dial2.ok && !("treeHouse" in dial2 && dial2.treeHouse)) {
    assert.equal(dial2.toLineId, momLine.id);
  }
});

test("parent provisions grandparent login and kid mutual allowlist", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const mom = registerParent(db, "Mom", { username: "momgp", password: "password1" });
  const hh = createHousehold(db, mom.user.id, "East");
  addLine(db, hh.id, mom.user.id, "Mom phone");
  const kid = addLine(db, hh.id, mom.user.id, "Alex", "softphone", { mode: "child" });
  updateLine(db, hh.id, kid.id, { mode: "child" }, { actorUserId: mom.user.id });

  const created = provisionGrandparent(db, mom.user.id, hh.id, {
    displayName: "Grandma East",
    username: "sloan2",
    password: "16Monkeys!",
    label: "Grandma",
    kidLineIds: [kid.id],
  });
  assert.equal(created.username, "sloan2");
  assert.equal(created.relative.profile_role, "grandparent");
  assert.deepEqual(created.relative.kid_line_ids, [kid.id]);
  assert.ok(created.setupToken);
  assert.match(created.setupToken, /^[A-Za-z0-9_-]{20,}$/);

  const claimed = redeemGrandparentSetupToken(db, created.setupToken);
  assert.equal(claimed.user.username, "sloan2");
  assert.equal(claimed.user.profile_role, "grandparent");
  assert.ok(claimed.session.id);
  assert.throws(() => redeemGrandparentSetupToken(db, created.setupToken), /already used/i);

  const reissue = issueGrandparentSetupToken(db, mom.user.id, hh.id, created.relative.id);
  assert.notEqual(reissue.token, created.setupToken);
  const claimed2 = redeemGrandparentSetupToken(db, reissue.token);
  assert.equal(claimed2.user.id, claimed.user.id);
  assert.match(grandparentSetupShareText("Grandma", "https://hub.example/?gp=abc"), /Tap this link once/);

  const login = loginWithPassword(db, "sloan2", "16Monkeys!");
  assert.equal(login.user.profile_role, "grandparent");
  assert.equal(mom.user.profile_role, "parent");

  const ok = canCall(db, kid.id, created.line.id);
  assert.equal(ok.ok, true);
  const back = canCall(db, created.line.id, kid.id);
  assert.equal(back.ok, true);

  const snap = householdSnapshot(db, mom.user.id);
  assert.equal(snap.households[0].provisioned_relatives.length, 1);
  assert.equal(snap.households[0].provisioned_relatives[0].username, "sloan2");

  const reset = resetProvisionedRelativePassword(
    db,
    mom.user.id,
    hh.id,
    created.relative.id,
    "NewPass99!"
  );
  assert.match(reset.message, /password updated/i);
  const again = loginWithPassword(db, "sloan2", "NewPass99!");
  assert.equal(again.user.id, login.user.id);

  assert.throws(() =>
    provisionGrandparent(db, mom.user.id, hh.id, {
      displayName: "Dup",
      username: "sloan2",
      password: "password99",
      kidLineIds: [kid.id],
    })
  );

  const kid2 = addLine(db, hh.id, mom.user.id, "Owen", "softphone", { mode: "child" });
  updateLine(db, hh.id, kid2.id, { mode: "child" }, { actorUserId: mom.user.id });
  const updated = updateProvisionedRelativeLogin(db, mom.user.id, hh.id, created.relative.id, {
    displayName: "Grandma Sloan",
    label: "Nana",
    kidLineIds: [kid2.id],
  });
  assert.equal(updated.relative.display_name, "Grandma Sloan");
  assert.equal(updated.relative.display_label, "Nana");
  assert.deepEqual(updated.relative.kid_line_ids, [kid2.id]);
  assert.equal(canCall(db, created.line.id, kid.id).ok, false);
  assert.equal(canCall(db, created.line.id, kid2.id).ok, true);
});

test("directory does not leak Circle-only friends to grandparents", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const mom = registerParent(db, "Mom", { username: "momdir", password: "password1" });
  const friend = registerParent(db, "Friend", { username: "frienddir", password: "password1" });
  const hh = createHousehold(db, mom.user.id, "East");
  const momLine = addLine(db, hh.id, mom.user.id, "Mom phone");
  const kid = addLine(db, hh.id, mom.user.id, "Alex", "softphone", { mode: "child" });
  updateLine(db, hh.id, kid.id, { mode: "child" }, { actorUserId: mom.user.id });

  // Friend joins via friend invite → Sam/Alex’s Circle only, not Pod membership.
  const invFriend = createInvite(db, hh.id, mom.user.id, { kind: "friend", targetKidLineId: kid.id });
  const friendJoin = redeemInvite(db, invFriend.code, friend.user.id, "Friend house");
  const friendLine = addLine(db, friendJoin.household.id, friend.user.id, "Friend phone");

  const gp = provisionGrandparent(db, mom.user.id, hh.id, {
    displayName: "Grandma",
    username: "grandmadir",
    password: "password1!",
    label: "Grandma",
    kidLineIds: [kid.id],
  });
  const gpUser = loginWithPassword(db, "grandmadir", "password1!").user;

  assert.equal(canViewerSeeLine(db, gpUser.id, kid.id), true);
  assert.equal(canViewerSeeLine(db, gpUser.id, momLine.id), true, "GP sees this Pod’s parents");
  assert.equal(canViewerSeeLine(db, gpUser.id, friendLine.id), false);
  assert.equal(canViewerSeeLine(db, mom.user.id, friendLine.id), true);
  assert.equal(canViewerSeeLine(db, mom.user.id, gp.line.id), true);
  assert.equal(userInHousehold(db, hh.id, friend.user.id), false);

  const snap = householdSnapshot(db, gpUser.id);
  const ids = new Set(snap.directory.map((d: { id: string }) => d.id));
  assert.equal(ids.has(kid.id), true);
  assert.equal(ids.has(momLine.id), true);
  assert.equal(ids.has(friendLine.id), false);
});

test("GP auto grandchildren; manual adults stay on GP book only", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const mom = registerParent(db, "Mom", { username: "momgpman", password: "password1" });
  const uncle = registerParent(db, "Uncle", { username: "unclegpman", password: "password1" });
  const hh = createHousehold(db, mom.user.id, "East");
  const momLine = addLine(db, hh.id, mom.user.id, "Mom phone");
  const kid = addLine(db, hh.id, mom.user.id, "Alex", "softphone", { mode: "child" });
  updateLine(db, hh.id, kid.id, { mode: "child" }, { actorUserId: mom.user.id });
  const hhUncle = createHousehold(db, uncle.user.id, "Uncle house");
  const uncleLine = addLine(db, hhUncle.id, uncle.user.id, "Uncle phone");

  const gp = provisionGrandparent(db, mom.user.id, hh.id, {
    displayName: "Grandma",
    username: "grandmagpman",
    password: "password1!",
    label: "Grandma",
    kidLineIds: [kid.id],
  });
  const gpUser = loginWithPassword(db, "grandmagpman", "password1!").user;

  // Auto: grandchild and Pod parent; outside adults need a manual add.
  assert.equal(canViewerSeeLine(db, gpUser.id, kid.id), true);
  assert.equal(canViewerSeeLine(db, gpUser.id, momLine.id), true);
  assert.equal(canCall(db, gp.line.id, kid.id).ok, true);
  assert.equal(canCall(db, gp.line.id, momLine.id).ok, true);
  assert.equal(canCall(db, momLine.id, gp.line.id).ok, true);
  assert.equal(canViewerSeeLine(db, gpUser.id, uncleLine.id), false);

  // Manual adult on Grandma’s phone (mutual).
  addAllowlist(db, gp.household.id, uncleLine.id, "Uncle", { actorUserId: gpUser.id });
  addAllowlist(db, hhUncle.id, gp.line.id, "Grandma", { actorUserId: uncle.user.id });
  assert.equal(canViewerSeeLine(db, gpUser.id, uncleLine.id), true);
  assert.equal(canCall(db, gp.line.id, uncleLine.id).ok, true);

  // Sync must not wipe the manual adult.
  syncProvisionedRelativePodBook(db, hh.id, gpUser.id);
  assert.equal(canViewerSeeLine(db, gpUser.id, uncleLine.id), true);
  assert.equal(canCall(db, gp.line.id, uncleLine.id).ok, true);

  // Parent pad must not inherit Grandma-only contacts.
  const momSnap = householdSnapshot(db, mom.user.id);
  const momAl = new Set(
    (momSnap.households[0].allowlist || []).map((a: { target_line_id: string }) => a.target_line_id)
  );
  assert.equal(momAl.has(uncleLine.id), false);

  const gpSnap = householdSnapshot(db, gpUser.id);
  const gpHh = gpSnap.households.find((h: { id: string }) => h.id === gp.household.id) || gpSnap.households[0];
  const gpAl = new Set(
    (gpHh.allowlist || []).map((a: { target_line_id: string }) => a.target_line_id)
  );
  assert.equal(gpAl.has(kid.id), true);
  assert.equal(gpAl.has(uncleLine.id), true);
  assert.equal(gpAl.has(momLine.id), true, "Pod parent on Grandma’s book");
});

test("kid inherits grandparents only from Pods they belong to", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const parentA = registerParent(db, "ParentA", { username: "pa_pods", password: "password1" });
  const parentB = registerParent(db, "ParentB", { username: "pb_pods", password: "password1" });
  const parentE = registerParent(db, "ParentE", { username: "pe_pods", password: "password1" });
  const hhB = createHousehold(db, parentA.user.id, "PodB");
  const hhC = createHousehold(db, parentB.user.id, "PodC");
  const hhA = createHousehold(db, parentE.user.id, "PodA");
  addLine(db, hhB.id, parentA.user.id, "A phone");
  addLine(db, hhC.id, parentB.user.id, "B phone");
  addLine(db, hhA.id, parentE.user.id, "E phone");

  const childA = addLine(db, hhB.id, parentA.user.id, "ChildA", "softphone", { mode: "child" });
  updateLine(db, hhB.id, childA.id, { mode: "child", child_label: "ChildA" }, { actorUserId: parentA.user.id });
  ensureGuardian(db, childA.id, parentB.user.id);

  const gpB = provisionGrandparent(db, parentA.user.id, hhB.id, {
    displayName: "GrandparentB",
    username: "gpb_pods",
    password: "password1!",
    label: "Grandparent B",
  });
  const gpC = provisionGrandparent(db, parentB.user.id, hhC.id, {
    displayName: "GrandparentC",
    username: "gpc_pods",
    password: "password1!",
    label: "Grandparent C",
  });
  const gpA = provisionGrandparent(db, parentE.user.id, hhA.id, {
    displayName: "GrandparentA",
    username: "gpa_pods",
    password: "password1!",
    label: "Grandparent A",
  });

  const pods = new Set(podsForKid(db, childA.id));
  assert.equal(pods.has(hhB.id), true);
  assert.equal(pods.has(hhC.id), true);
  assert.equal(pods.has(hhA.id), false, "cousin Pod A is not this kid’s Pod");

  // Child A may reach GPs from B+C only — not cousin Pod A’s GP.
  const gpIds = new Set(listKidPodGrandparents(db, childA.id).map((g) => g.target_line_id));
  assert.equal(gpIds.has(gpB.line.id), true);
  assert.equal(gpIds.has(gpC.line.id), true);
  assert.equal(gpIds.has(gpA.line.id), false);
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
  updateLine(db, hh.id, kidLine.id, { mode: "child", child_label: "Alex" }, { actorUserId: a.user.id });

  const hhB = createHousehold(db, b.user.id, "Cousins");
  const cousin = addLine(db, hhB.id, b.user.id, "Cousin");

  // Single parent: slot 2 is a normal contact slot — first external gets 2.
  const cousinAl = addAllowlist(db, hh.id, cousin.id, "Cousin");
  assert.equal(cousinAl.speed_dial, 2);

  const kidAl = addAllowlist(db, hh.id, kidLine.id, "Alex");
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

test("cleared speed_dial stays null across openDb (no Quinns Dad reclaim)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-reclaim-"));
  const dbPath = path.join(dir, "t.db");
  const db = openDb(dbPath);
  const a = registerParent(db, "A");
  const b = registerParent(db, "B");
  const hh = createHousehold(db, a.user.id, "East");
  addLine(db, hh.id, a.user.id, "Parent");
  const hhB = createHousehold(db, b.user.id, "North");
  const quinnDad = addLine(db, hhB.id, b.user.id, "Quinns Dads phone");
  const al = addAllowlist(db, hh.id, quinnDad.id, "Quinns Dads");
  assert.ok(al.speed_dial != null);
  updateAllowlistEntry(db, hh.id, al.id, { speed_dial: null });
  const cleared = db.prepare(`SELECT speed_dial FROM allowlist WHERE id = ?`).get(al.id) as {
    speed_dial: number | null;
  };
  assert.equal(cleared.speed_dial, null);
  db.close();

  const again = openDb(dbPath);
  const still = again.prepare(`SELECT speed_dial FROM allowlist WHERE id = ?`).get(al.id) as {
    speed_dial: number | null;
  };
  assert.equal(still.speed_dial, null, "restart/migrate must not put deleted contacts back on the pad");
  again.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("parent-placed dial 2 beats co-parent tile (North Alex+Riley vs Jordan)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const casey = registerParent(db, "Casey", { username: "casey2", password: "password1" });
  const jordan = registerParent(db, "Jordan", { username: "jordan2", password: "password1" });
  const cameron = registerParent(db, "Cameron", { username: "cameron2", password: "password1" });
  const hhNorth = createHousehold(db, casey.user.id, "North");
  const caseyLine = addLine(db, hhNorth.id, casey.user.id, "Casey phone");
  const jordanLine = addLine(db, hhNorth.id, jordan.user.id, "Jordan phone");
  ensureHouseholdParentMember(db, hhNorth.id, jordan.user.id);
  const quinn = addLine(db, hhNorth.id, casey.user.id, "Quinn");
  updateLine(db, hhNorth.id, quinn.id, { mode: "child", child_label: "Quinn" }, { actorUserId: casey.user.id });
  upsertAtaDevice(
    db,
    quinn.id,
    {
      sip_extension: "2011",
      sip_password: "example-sip-pass",
      sip_server: "192.168.2.105",
    },
    { allowSipCredentialOverride: true }
  );

  const hhEast = createHousehold(db, cameron.user.id, "East");
  const kids = addLine(db, hhEast.id, cameron.user.id, "Alex + Riley phone");
  updateLine(
    db,
    hhEast.id,
    kids.id,
    { mode: "child", child_label: "Alex + Riley" },
    { actorUserId: cameron.user.id }
  );
  ensureGuardian(db, kids.id, jordan.user.id);

  assert.equal(
    householdSecondaryParentLine(db, hhNorth.id),
    null,
    "Jordan is Casey’s sister on the Pod, not Quinn’s co-parent"
  );
  // Empty slot 2 → no co-parent synthesis for Quinn.
  assert.equal(householdKidPad2ParentLine(db, hhNorth.id), null);

  // Parents place Alex+Riley on 2 — settings win over Jordan synthesis.
  const kidsAl = addAllowlist(db, hhNorth.id, kids.id, "Alex + Riley", { speedDial: 2 });
  addAllowlist(db, hhEast.id, quinn.id, "Quinn");
  assert.equal(kidsAl.speed_dial, 2);
  assert.equal(secondaryParentOwnsDial2(db, hhNorth.id), false);
  assert.equal(householdKidPad2ParentLine(db, hhNorth.id), null);

  const dial2 = resolveAtaDial(db, "2011", "2");
  assert.equal(dial2.ok, true);
  if (dial2.ok && !("treeHouse" in dial2 && dial2.treeHouse) && !("grandparentsMenu" in dial2)) {
    assert.equal(dial2.toLineId, kids.id);
  }

  // Casey can softphone his line + Quinn, not Jordan's phone or Alex+Riley.
  assert.equal(userCanOperateLine(db, casey.user.id, caseyLine.id), true);
  assert.equal(userCanOperateLine(db, casey.user.id, quinn.id), true);
  assert.equal(userCanOperateLine(db, casey.user.id, jordanLine.id), false);
  assert.equal(userCanOperateLine(db, casey.user.id, kids.id), false);
  assert.equal(userCanOperateLine(db, jordan.user.id, jordanLine.id), true);
  assert.equal(userCanOperateLine(db, jordan.user.id, caseyLine.id), false);
  assert.equal(userCanOperateLine(db, jordan.user.id, quinn.id), false);
  assert.equal(userCanOperateLine(db, jordan.user.id, kids.id), true);

  const caseySnap = householdSnapshot(db, casey.user.id);
  const north = caseySnap.households.find((h) => h.id === hhNorth.id);
  const jordanPub = north?.lines.find((l: { id: string }) => l.id === jordanLine.id) as
    | { can_operate?: boolean }
    | undefined;
  assert.equal(jordanPub?.can_operate, false);
  assert.equal(
    (north?.lines.find((l: { id: string }) => l.id === caseyLine.id) as { can_operate?: boolean })
      ?.can_operate,
    true
  );
  assert.equal(north?.pad2_parent, null);

  const jordanSnap = householdSnapshot(db, jordan.user.id);
  const northForJordan = jordanSnap.households.find((h) => h.id === hhNorth.id);
  const quinnForJordan = northForJordan?.lines.find((l: { id: string }) => l.id === quinn.id) as
    | { can_operate?: boolean }
    | undefined;
  assert.equal(quinnForJordan?.can_operate, false);
  const eastForJordan = jordanSnap.households.find((h) => h.id === hhEast.id);
  const kidsForJordan = eastForJordan?.lines.find((l: { id: string }) => l.id === kids.id) as
    | { can_operate?: boolean }
    | undefined;
  assert.equal(kidsForJordan?.can_operate, true);
});

test("allowlist may place contacts on dial 2 even when a co-parent exists", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const a = registerParent(db, "A");
  const b = registerParent(db, "B");
  const c = registerParent(db, "C");
  const hh = createHousehold(db, a.user.id, "House");
  addLine(db, hh.id, a.user.id, "Parent");
  const coLine = addLine(db, hh.id, b.user.id, "Co-parent");
  ensureHouseholdParentMember(db, hh.id, b.user.id);
  const kidLine = addLine(db, hh.id, a.user.id, "Kid phone");
  updateLine(db, hh.id, kidLine.id, { mode: "child", child_label: "Alex" }, { actorUserId: a.user.id });
  ensureGuardian(db, kidLine.id, b.user.id);

  const hhC = createHousehold(db, c.user.id, "Cousins");
  const cousin = addLine(db, hhC.id, c.user.id, "Cousin");

  assert.equal(householdSecondaryParentLine(db, hh.id)?.id, coLine.id);
  const cousinAl = addAllowlist(db, hh.id, cousin.id, "Cousin");
  assert.equal(cousinAl.speed_dial, 3);
  // Parent-placed tiles may claim 2; co-parent synthesis yields.
  updateAllowlistEntry(db, hh.id, cousinAl.id, { speed_dial: 2 });
  const moved = db.prepare(`SELECT speed_dial FROM allowlist WHERE id = ?`).get(cousinAl.id) as {
    speed_dial: number;
  };
  assert.equal(moved.speed_dial, 2);
  assert.equal(householdKidPad2ParentLine(db, hh.id), null);
  const kidAl = addAllowlist(db, hh.id, kidLine.id, "Alex", { speedDial: 4 });
  assert.ok(kidAl.speed_dial != null && kidAl.speed_dial !== 2);
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
  updateLine(db, hhA.id, kid.id, { mode: "child", child_label: "Alex" }, { actorUserId: a.user.id });
  addLine(db, hhB.id, b.user.id, "Cameron");
  // Cousin kid on pad 2 — not the other parent’s adult line.
  const cousinKid = addLine(db, hhB.id, b.user.id, "Quinn", "softphone", { mode: "child" });
  updateLine(
    db,
    hhB.id,
    cousinKid.id,
    { mode: "child", child_label: "Quinn" },
    { actorUserId: b.user.id }
  );

  const ata = upsertAtaDevice(
    db,
    kid.id,
    {
      sip_extension: "2001",
      sip_password: "example-sip-pass",
      sip_server: "192.168.2.105",
      display_name: "Alex ATA",
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
  assert.match(xml, /<P34>example-sip-pass<\/P34>/);

  // Mutual allowlist with speed dial 2 (0 = TreeHouse, 1 = admin parent)
  addAllowlist(db, hhA.id, cousinKid.id, "Quinn", { speedDial: 2 });
  addAllowlist(db, hhB.id, kid.id, "Alex", { speedDial: 2 });

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
    assert.equal(hit.toLineId, cousinKid.id);
    assert.equal(hit.toSipExtension, null);
  }

  // Cousin house links an ATA too → ATA→ATA resolve returns target extension
  upsertAtaDevice(
    db,
    cousinKid.id,
    {
      sip_extension: "2002",
      sip_password: "example-sip-pass",
      sip_server: "192.168.2.105",
      display_name: "Quinn ATA",
    },
    { allowSipCredentialOverride: true }
  );
  const ataToAta = resolveAtaDial(db, "2001", "2");
  assert.equal(ataToAta.ok, true);
  if (ataToAta.ok) {
    assert.equal(ataToAta.toSipExtension, "2002");
    // Parent HH nickname for kid caller
    assert.equal(ataToAta.cidName, "Alex");
    assert.equal(ataToAta.cidNumber, "2001");
  }

  const routeFxs = routeCallTarget(db, hhAParent.id, kid.id);
  assert.equal(routeFxs.ok, true);
  if (routeFxs.ok) {
    assert.equal(routeFxs.preferFxs, true);
    assert.equal(routeFxs.toSipExtension, "2001");
  }
  const routeSoft = routeCallTarget(db, kid.id, cousinKid.id);
  assert.equal(routeSoft.ok, true);
  if (routeSoft.ok) {
    assert.equal(routeSoft.toSipExtension, "2002");
    assert.equal(routeSoft.cidName, "Alex");
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
  updateLine(db, hh.id, kid.id, { mode: "child", child_label: "Alex" }, { actorUserId: a.user.id });

  const admin = householdAdminParentLine(db, hh.id);
  assert.equal(admin?.id, parentLine.id);
  assert.equal(householdHomeParentLine(db, hh.id)?.id, parentLine.id);
  // Same owner on two parent lines is not a co-parent — secondary stays null.
  assert.equal(householdSecondaryParentLine(db, hh.id), null);

  upsertAtaDevice(
    db,
    kid.id,
    {
      sip_extension: "2001",
      sip_password: "example-sip-pass",
      sip_server: "192.168.2.105",
      display_name: "Alex ATA",
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
      sip_password: "example-sip-pass",
      sip_server: "192.168.2.105",
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
  const alex = addLine(db, hh.id, a.user.id, "Alex");
  const cousin = addLine(db, hh.id, a.user.id, "Cousin");

  const ata1 = upsertAtaDevice(db, alex.id, { sip_server: "sip.example.test" });
  const ata2 = upsertAtaDevice(db, cousin.id, { sip_server: "sip.example.test" });

  assert.equal(ata1.sip_extension, "2001");
  assert.equal(ata2.sip_extension, "2002");
  assert.notEqual(ata1.sip_password, ata2.sip_password);
  assert.ok(ata1.sip_password.length >= 12);
  assert.ok(ata2.sip_password.length >= 12);

  // Second save keeps Alex on 2001
  const again = upsertAtaDevice(db, alex.id, { sip_server: "sip.example.test" });
  assert.equal(again.sip_extension, "2001");
  assert.equal(again.sip_password, ata1.sip_password);

  // Parent-style client cannot steal cousin's extension or reassign Alex
  const steal = upsertAtaDevice(db, alex.id, {
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

test("Analog setup is Download-first for invited pods, LAN-first for the mothership home household", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const prevPush = process.env.ATA_LAN_PUSH;
  const prevIds = process.env.ATA_LAN_HOUSEHOLD_IDS;
  delete process.env.ATA_LAN_PUSH;
  delete process.env.ATA_LAN_HOUSEHOLD_IDS;
  try {
    const host = registerParent(db, "Cameron");
    const cousin = registerParent(db, "Quinn dad");
    const hhHome = createHousehold(db, host.user.id, "East");
    const hhCousin = createHousehold(db, cousin.user.id, "North");
    const alex = addLine(db, hhHome.id, host.user.id, "Alex");
    updateLine(db, hhHome.id, alex.id, { mode: "child", child_label: "Alex" }, { actorUserId: host.user.id });
    const quinn = addLine(db, hhCousin.id, cousin.user.id, "Quinn");
    updateLine(db, hhCousin.id, quinn.id, { mode: "child", child_label: "Quinn" }, { actorUserId: cousin.user.id });

    const homeAta = upsertAtaDevice(db, alex.id, { sip_server: "sip.example.test" });
    const cousinAta = upsertAtaDevice(db, quinn.id, { sip_server: "sip.example.test" });
    const homePub = publicAta(homeAta, db);
    const cousinPub = publicAta(cousinAta, db);
    assert.equal(homePub.setup_mode, "lan");
    assert.equal(homePub.lan_push_available, true);
    assert.equal(homePub.download_ready, true);
    assert.equal(cousinPub.setup_mode, "download");
    assert.equal(cousinPub.lan_push_available, false);
    assert.equal(cousinPub.download_ready, true);
    assert.equal(cousinPub.config_seen, false);
    assert.equal(cousinPub.config_downloaded, false);
    assert.equal(cousinPub.config_pulled, false);

    recordAtaLanPushResult(db, quinn.id, false);
    const afterFail = getAtaByLineId(db, quinn.id);
    assert.equal(publicAta(afterFail!, db).setup_mode, "download");

    recordAtaLanPushResult(db, quinn.id, true);
    const afterOk = getAtaByLineId(db, quinn.id);
    assert.equal(publicAta(afterOk!, db).setup_mode, "lan");
  } finally {
    if (prevPush === undefined) delete process.env.ATA_LAN_PUSH;
    else process.env.ATA_LAN_PUSH = prevPush;
    if (prevIds === undefined) delete process.env.ATA_LAN_HOUSEHOLD_IDS;
    else process.env.ATA_LAN_HOUSEHOLD_IDS = prevIds;
  }
});

test("invited ATA rows rewrite a mothership LAN SIP host to SIP_PUBLIC_HOST", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const prevHost = process.env.SIP_PUBLIC_HOST;
  const prevSip = process.env.SIP_SERVER;
  const prevPush = process.env.ATA_LAN_PUSH;
  const prevIds = process.env.ATA_LAN_HOUSEHOLD_IDS;
  process.env.SIP_PUBLIC_HOST = "mothership.example";
  delete process.env.SIP_SERVER;
  delete process.env.ATA_LAN_PUSH;
  delete process.env.ATA_LAN_HOUSEHOLD_IDS;
  try {
    const host = registerParent(db, "Cameron");
    const cousin = registerParent(db, "Quinn dad");
    const hhHome = createHousehold(db, host.user.id, "East");
    const hhCousin = createHousehold(db, cousin.user.id, "North");
    process.env.ATA_LAN_HOUSEHOLD_IDS = hhHome.id;
    const alex = addLine(db, hhHome.id, host.user.id, "Alex");
    const quinn = addLine(db, hhCousin.id, cousin.user.id, "Quinn");

    const homeAta = upsertAtaDevice(db, alex.id, { sip_server: "192.168.2.105" });
    assert.equal(homeAta.sip_server, "192.168.2.105");
    assert.equal(publicAta(homeAta, db).sip_host_kind, "lan");

    const cousinAta = upsertAtaDevice(db, quinn.id, { sip_server: "192.168.2.105" });
    assert.equal(cousinAta.sip_server, "mothership.example");
    const cousinPub = publicAta(cousinAta, db);
    assert.equal(cousinPub.sip_server, "mothership.example");
    assert.equal(cousinPub.sip_host_kind, "public");
    assert.equal(cousinPub.setup_mode, "download");
    assert.equal(cousinPub.lan_push_available, false);
    assert.equal(cousinPub.download_ready, true);
    assert.equal(resolveAtaSipServer(cousinAta, db), "mothership.example");

    const xml = ataConfigXmlForDevice(cousinAta, {
      publicBaseUrl: "https://mothership.example:8443",
      includeConfigServerPath: true,
      db,
    });
    assert.match(xml, /<P47>mothership\.example:5061<\/P47>/);
    assert.match(xml, /<P8463>1<\/P8463>/);
    assert.match(xml, /<P2311>1<\/P2311>/);
    assert.match(xml, /<P2367>1<\/P2367>/);
    assert.match(xml, /<P31>1<\/P31>/);
    assert.match(xml, /<P90>\{/);
    assert.match(xml, /<P4200>\{/);
    assert.doesNotMatch(xml, /10\.0\.5\.105/);

    recordAtaConfigDownload(db, quinn.id);
    const afterDl = getAtaByLineId(db, quinn.id)!;
    assert.ok(afterDl.last_config_download_at);
    assert.equal(afterDl.last_provision_at, null);
    assert.equal(publicAta(afterDl, db).config_downloaded, true);
    assert.equal(publicAta(afterDl, db).config_pulled, false);
    assert.equal(publicAta(afterDl, db).config_seen, true);

    recordAtaProvisionHit(db, quinn.id);
    const afterPull = getAtaByLineId(db, quinn.id)!;
    assert.ok(afterPull.last_provision_at);
    assert.equal(publicAta(afterPull, db).config_pulled, true);
  } finally {
    if (prevHost === undefined) delete process.env.SIP_PUBLIC_HOST;
    else process.env.SIP_PUBLIC_HOST = prevHost;
    if (prevSip === undefined) delete process.env.SIP_SERVER;
    else process.env.SIP_SERVER = prevSip;
    if (prevPush === undefined) delete process.env.ATA_LAN_PUSH;
    else process.env.ATA_LAN_PUSH = prevPush;
    if (prevIds === undefined) delete process.env.ATA_LAN_HOUSEHOLD_IDS;
    else process.env.ATA_LAN_HOUSEHOLD_IDS = prevIds;
  }
});

test("ATA provision SIP host and Config Server Path follow mothership DDNS changes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const prevHost = process.env.SIP_PUBLIC_HOST;
  const prevBase = process.env.PUBLIC_BASE_URL;
  const prevSip = process.env.SIP_SERVER;
  const prevIds = process.env.ATA_LAN_HOUSEHOLD_IDS;
  process.env.SIP_PUBLIC_HOST = "old-ddns.example.test";
  delete process.env.SIP_SERVER;
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.ATA_LAN_HOUSEHOLD_IDS;
  try {
    const host = registerParent(db, "Cameron");
    const hh = createHousehold(db, host.user.id, "East");
    process.env.ATA_LAN_HOUSEHOLD_IDS = hh.id;
    const alex = addLine(db, hh.id, host.user.id, "Alex");

    const ata = upsertAtaDevice(db, alex.id, { sip_server: "old-ddns.example.test" });
    assert.equal(ata.sip_server, "old-ddns.example.test");

    // Mothership hostname cut over (DuckDNS, etc.)
    process.env.SIP_PUBLIC_HOST = "mothership.example";
    assert.equal(resolveAtaSipServer(ata, db), "mothership.example");
    assert.equal(publicAta(ata, db).sip_server, "mothership.example");

    const xml = ataConfigXmlForDevice(ata, {
      publicBaseUrl: "https://mothership.example:8443",
      includeConfigServerPath: true,
      db,
    });
    assert.match(xml, /<P47>mothership\.example:5061<\/P47>/);
    assert.match(xml, /mothership\.example:8443\/provision\//);
    assert.doesNotMatch(xml, /old-ddns\.example\.test/);

    // Home LAN escape hatch still wins when intentionally stored
    const lanAta = upsertAtaDevice(db, alex.id, { sip_server: "192.168.2.105" });
    assert.equal(resolveAtaSipServer(lanAta, db), "192.168.2.105");

    // Boot sync rewrites stale public rows; leaves LAN alone
    const cousin = registerParent(db, "Quinn dad");
    const hhCousin = createHousehold(db, cousin.user.id, "North");
    const quinn = addLine(db, hhCousin.id, cousin.user.id, "Quinn");
    upsertAtaDevice(db, quinn.id, { sip_server: "stale.eero.example" });
    const n = syncAtaPublicSipHostsFromEnv(db);
    assert.ok(n >= 1);
    assert.equal(getAtaByLineId(db, quinn.id)?.sip_server, "mothership.example");
    assert.equal(getAtaByLineId(db, alex.id)?.sip_server, "192.168.2.105");
  } finally {
    if (prevHost === undefined) delete process.env.SIP_PUBLIC_HOST;
    else process.env.SIP_PUBLIC_HOST = prevHost;
    if (prevBase === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = prevBase;
    if (prevSip === undefined) delete process.env.SIP_SERVER;
    else process.env.SIP_SERVER = prevSip;
    if (prevIds === undefined) delete process.env.ATA_LAN_HOUSEHOLD_IDS;
    else process.env.ATA_LAN_HOUSEHOLD_IDS = prevIds;
  }
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
    { sip_extension: "2001", sip_password: "example-sip-pass", sip_server: "192.168.2.105" },
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

test("TreeHouse: mothership kids join; hearing is Circle-filtered", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-fr-"));
  const db = openDb(path.join(dir, "t.db"));
  const mom = registerParent(db, "Mom", { username: "frmom", password: "password1" });
  const other = registerParent(db, "Other", { username: "frother", password: "password1" });
  const stranger = registerParent(db, "Stranger", { username: "frstranger", password: "password1" });
  const hh = createHousehold(db, mom.user.id, "Home");
  const hhOther = createHousehold(db, other.user.id, "Elsewhere");
  const hhStranger = createHousehold(db, stranger.user.id, "OtherPod");
  const parentLine = addLine(db, hh.id, mom.user.id, "Mom phone");
  const kid = addLine(db, hh.id, mom.user.id, "Kid");
  updateLine(db, hh.id, kid.id, { mode: "child", child_label: "Maya" }, { actorUserId: mom.user.id });
  const kid2 = addLine(db, hh.id, mom.user.id, "Kid2");
  updateLine(db, hh.id, kid2.id, { mode: "child", child_label: "Sam" }, { actorUserId: mom.user.id });
  const cousin = addLine(db, hhOther.id, other.user.id, "Cousin");
  updateLine(
    db,
    hhOther.id,
    cousin.id,
    { mode: "child", child_label: "Quinn" },
    { actorUserId: other.user.id }
  );
  const outsider = addLine(db, hhStranger.id, stranger.user.id, "Outsider");
  updateLine(
    db,
    hhStranger.id,
    outsider.id,
    { mode: "child", child_label: "SamCousin" },
    { actorUserId: stranger.user.id }
  );

  assert.equal(isFamilyRoomAdminAlwaysAllowed(db, hh.id, parentLine.id), false);
  assert.equal(isFamilyRoomAdminAlwaysAllowed(db, hh.id, kid.id), true);
  // Parents never talk-join; any kid on the mothership may enter TreeHouse.
  assert.equal(canJoinTreeHouse(db, parentLine.id), false);
  assert.equal(canJoinTreeHouse(db, kid.id), true);
  assert.equal(canJoinTreeHouse(db, cousin.id), true);
  assert.equal(canJoinTreeHouse(db, outsider.id), true);
  assert.equal(canJoinFamilyRoom(db, hh.id, kid.id), true);
  assert.equal(canJoinFamilyRoom(db, hh.id, cousin.id), true);

  const always = listFamilyRoomAlwaysAllowedLineIds(db, hh.id);
  assert.ok(always.includes(kid.id));
  assert.ok(always.includes(kid2.id));
  assert.equal(always.includes(parentLine.id), false);
  assert.equal(always.includes(cousin.id), false);

  assert.throws(() => addFamilyRoomMember(db, hh.id, kid.id, mom.user.id));
  assert.throws(() => removeFamilyRoomMember(db, hh.id, kid.id, mom.user.id));

  // Same-Pod siblings hear each other without Circles plumbing.
  assert.equal(canTalkInTreeHouse(db, kid.id, kid2.id), true);
  // Cousin not on Circles / allowlist yet — present-but-silent.
  assert.equal(canTalkInTreeHouse(db, kid.id, cousin.id), false);
  assert.equal(canTalkInTreeHouse(db, kid.id, outsider.id), false);

  // Mutual allowlist = Circle-approved contact → hear in TreeHouse.
  addAllowlist(db, hh.id, cousin.id, "Quinn", { actorUserId: mom.user.id });
  addAllowlist(db, hhOther.id, kid.id, "Maya", { actorUserId: other.user.id });
  assert.equal(canTalkInTreeHouse(db, kid.id, cousin.id), true);
  assert.equal(canTalkInTreeHouse(db, cousin.id, kid.id), true);
  // Outsider still silent (never Circles / allowlist).
  assert.equal(canTalkInTreeHouse(db, kid.id, outsider.id), false);
  // Sibling also hears cousin once Mom’s Circle lists them (kids share parent Circles).
  assert.equal(canTalkInTreeHouse(db, kid2.id, cousin.id), true);

  const peers = treeHouseTalkPeers(db, kid.id, [kid.id, kid2.id, cousin.id, outsider.id]);
  assert.deepEqual(peers.sort(), [cousin.id, kid2.id].sort());
  assert.equal(peers.includes(outsider.id), false);
});

test("parent_title and FamilyRoom approvals include kids and adults", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const mom = registerParent(db, "Cameron East");
  const other = registerParent(db, "Grandma");
  const hh = createHousehold(db, mom.user.id, "East");
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

  // Allowlist nickname must not override Mom/Dad for FXS / voice CID (adult / household view).
  addAllowlist(db, hh.id, momLine.id, "Cameron");
  assert.equal(peerLabelForHousehold(db, hh.id, momLine.id), "Mom");
  // Saving Mom/Dad rewrites stale personal-name nicknames to the first name
  // (kid UI applies Mom/Dad vs Aunt/Uncle from guardianship).
  updateUserProfile(db, mom.user.id, { parent_title: "mom" });
  const al = db.prepare(`SELECT label FROM allowlist WHERE target_line_id = ?`).get(momLine.id) as {
    label: string;
  };
  assert.equal(al.label, "Cameron");
  assert.equal(kidFacingAdultLabel(db, momLine.id, kidLine.id), "Mom");
  assert.equal(peerLabelForCall(db, momLine.id, kidLine.id), "Mom");

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
  assert.match(choices[0].label, /East/i);

  const kidChoices = listFamilyRoomChoicesForLine(db, kidLine.id);
  assert.ok(kidChoices.length >= 1);
  assert.equal(kidChoices[0].slot, 1);
});

test("FamilyRoom # skips menu when only one Pod is approved", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const mom = registerParent(db, "Cameron East");
  const dad = registerParent(db, "Mike Smith", { username: "frdad", password: "password1" });
  const hh = createHousehold(db, mom.user.id, "East");
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

  // Same Pod with two parents → one FamilyRoom, join directly (no fake slot 2).
  const choices = listFamilyRoomChoicesForLine(db, momLine.id);
  assert.equal(choices.length, 1);
  assert.equal(choices[0].slot, 1);
  assert.equal(choices[0].label, "East");
  assert.equal(choices[0].householdId, hh.id);
});

test("FamilyRoom # multi-Pod kid menus East vs North with Pod names", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));
  const cameron = registerParent(db, "Cameron East", { username: "frcameron", password: "password1" });
  const jordan = registerParent(db, "Jordan North", { username: "frjordan", password: "password1" });
  const hhEast = createHousehold(db, cameron.user.id, "East");
  const hhNorth = createHousehold(db, jordan.user.id, "North");
  const cameronLine = addLine(db, hhEast.id, cameron.user.id, "Cameron phone");
  const jordanLine = addLine(db, hhNorth.id, jordan.user.id, "Jordan phone");
  const alex = addLine(db, hhEast.id, cameron.user.id, "Alex phone");
  updateLine(
    db,
    hhEast.id,
    alex.id,
    { mode: "child", child_label: "Alex" },
    { actorUserId: cameron.user.id }
  );
  addGuardianByUsername(db, cameron.user.id, alex.id, "frjordan");

  addAdultFamilyRoomMember(db, hhEast.id, cameronLine.id, cameron.user.id);
  addAdultFamilyRoomMember(db, hhEast.id, alex.id, cameron.user.id);
  addAdultFamilyRoomMember(db, hhNorth.id, jordanLine.id, jordan.user.id);
  addAdultFamilyRoomMember(db, hhNorth.id, alex.id, jordan.user.id);

  const choices = listFamilyRoomChoicesForLine(db, alex.id);
  assert.equal(choices.length, 2);
  assert.equal(choices[0].slot, 1);
  assert.equal(choices[0].householdId, hhEast.id);
  assert.equal(choices[0].label, "East");
  assert.equal(choices[1].slot, 2);
  assert.equal(choices[1].householdId, hhNorth.id);
  assert.equal(choices[1].label, "North");

  // Isolation: North approval does not grant East room membership for Jordan.
  assert.equal(canJoinAdultFamilyRoom(db, hhEast.id, jordanLine.id), false);
  assert.equal(canJoinAdultFamilyRoom(db, hhNorth.id, cameronLine.id), false);
});

test("Drew (North) invites Morgan → West Pod; Sam multi-Pod; Circles stay guardian-only", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));

  const casey = registerParent(db, "Casey", { username: "masmultipod", password: "password1" });
  const drew = registerParent(db, "Drew", { username: "tylmultipod", password: "password1" });
  const morgan = registerParent(db, "Morgan", { username: "hilmultipod", password: "password1" });
  const sister = registerParent(db, "Sister", { username: "sismultipod", password: "password1" });
  const friend = registerParent(db, "Friend", { username: "frmultipod", password: "password1" });

  // Drew (North) creates Sam, invites Morgan → she forms West; she does not join North.
  // Sam’s “family” is guardianship + Circle; multi-Pod follows both parents’ family names.
  const hhNorth = createHousehold(db, casey.user.id, "North");
  ensureHouseholdParentMember(db, hhNorth.id, drew.user.id);
  addLine(db, hhNorth.id, drew.user.id, "Drew phone");
  addLine(db, hhNorth.id, casey.user.id, "Casey phone");
  const quinn = addLine(db, hhNorth.id, casey.user.id, "Quinn", "softphone", { mode: "child" });
  updateLine(db, hhNorth.id, quinn.id, { mode: "child", child_label: "Quinn" }, { actorUserId: casey.user.id });

  const sam = addLine(db, hhNorth.id, drew.user.id, "Sam", "softphone", { mode: "child" });
  updateLine(
    db,
    hhNorth.id,
    sam.id,
    { mode: "child", child_label: "Sam" },
    { actorUserId: drew.user.id }
  );

  const gInv = createGuardianInvite(db, drew.user.id, sam.id);
  assert.throws(() => redeemGuardianInvite(db, morgan.user.id, gInv.code), /family/i);
  const gInv2 = createGuardianInvite(db, drew.user.id, sam.id);
  redeemGuardianInvite(db, morgan.user.id, gInv2.code, { householdName: "West" });
  const hhWest = db
    .prepare(`SELECT id FROM households WHERE owner_user_id = ? AND name = ?`)
    .get(morgan.user.id, "West") as { id: string };
  assert.ok(hhWest);
  addLine(db, hhWest.id, morgan.user.id, "Morgan phone");
  assert.equal(userInHousehold(db, hhNorth.id, morgan.user.id), false);
  assert.equal(userInHousehold(db, hhWest.id, morgan.user.id), true);
  assert.equal(userInHousehold(db, hhNorth.id, drew.user.id), true);

  assert.deepEqual(new Set(podsForKid(db, sam.id)), new Set([hhNorth.id, hhWest.id]));
  assert.equal(kidBelongsToPod(db, sam.id, hhNorth.id), true);
  assert.equal(kidBelongsToPod(db, sam.id, hhWest.id), true);

  // North Pod adults see Sam; Casey can call Sam ↔ Quinn as shared-Pod kids.
  assert.equal(canViewerSeeLine(db, casey.user.id, sam.id), true);
  assert.equal(canCall(db, sam.id, quinn.id).ok, true);

  const caseySnap = householdSnapshot(db, casey.user.id);
  const northSnap = caseySnap.households.find((h) => h.id === hhNorth.id);
  assert.ok(northSnap?.lines.some((l) => l.id === sam.id), "Sam on North Kids list");
  assert.equal(
    (northSnap?.lines.find((l) => l.id === sam.id) as { multi_pod?: boolean } | undefined)?.multi_pod,
    false,
    "Sam’s home Pod is North — multi_pod flag is for foreign home"
  );

  // Sister joins West — sees Sam (via Morgan’s Pod) but not his Circle friend.
  redeemInvite(db, createInvite(db, hhWest.id, morgan.user.id, { kind: "family" }).code, sister.user.id, "X");
  // Friend invite is on the kid’s home Pod (North); Circle-only — not West membership.
  const fj = redeemInvite(
    db,
    createInvite(db, hhNorth.id, drew.user.id, { kind: "friend", targetKidLineId: sam.id }).code,
    friend.user.id,
    "Friend house"
  );
  const friendLine = addLine(db, fj.household.id, friend.user.id, "Friend phone");
  assert.equal(canViewerSeeLine(db, sister.user.id, sam.id), true);
  assert.equal(canViewerSeeLine(db, sister.user.id, friendLine.id), false);
  // Aunt on West never inherits Sam’s school-friend Circle edge.
  assert.equal(canCall(db, sam.id, friendLine.id).ok, false);

  const grandma = provisionGrandparent(db, casey.user.id, hhNorth.id, {
    displayName: "Avery",
    username: "melmultipod",
    password: "password1!",
    label: "Grandma",
    kidLineIds: [quinn.id, sam.id],
  });
  const bookIds = new Set(podBookLines(db, hhNorth.id).map((l) => l.id));
  assert.equal(bookIds.has(sam.id), true);
  assert.equal(bookIds.has(quinn.id), true);
  assert.equal(bookIds.has(friendLine.id), false);
  assert.equal(canViewerSeeLine(db, grandma.line.owner_user_id, sam.id), true);
  assert.equal(canViewerSeeLine(db, grandma.line.owner_user_id, friendLine.id), false);

  // FamilyRoom: home Pod + co-parent Pod after each admin approves (allowlist for cross-Pod).
  addAdultFamilyRoomMember(db, hhNorth.id, sam.id, casey.user.id);
  addAllowlist(db, hhWest.id, sam.id, "Sam", { actorUserId: morgan.user.id });
  addAdultFamilyRoomMember(db, hhWest.id, sam.id, morgan.user.id);
  const frChoices = listFamilyRoomChoicesForLine(db, sam.id);
  assert.equal(
    frChoices.some((c) => c.householdId === hhWest.id),
    true,
    "West FamilyRoom"
  );
  assert.equal(
    frChoices.some((c) => c.householdId === hhNorth.id),
    true,
    "North FamilyRoom"
  );
});

test("test review account only ever sees and calls Cameron", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-"));
  const db = openDb(path.join(dir, "t.db"));

  const cameron = registerParent(db, "Cameron", { username: "cameron", password: "password1" });
  const stranger = registerParent(db, "Stranger", { username: "stranger", password: "password1" });
  const tester = registerParent(db, "Test", { username: "test", password: "password1" });

  const hhT = createHousehold(db, cameron.user.id, "East");
  const hhS = createHousehold(db, stranger.user.id, "Other");
  const hhTest = createHousehold(db, tester.user.id, "Tester");

  const cameronLine = addLine(db, hhT.id, cameron.user.id, "Cameron's phone");
  const strangerLine = addLine(db, hhS.id, stranger.user.id, "Stranger phone");
  const testLine = addLine(db, hhTest.id, tester.user.id, "Test's phone");

  // Allowlist Cameron (ok) — stranger must be rejected by hard gate.
  addAllowlist(db, hhTest.id, cameronLine.id, "Cameron", { actorUserId: tester.user.id });
  assert.throws(
    () => addAllowlist(db, hhTest.id, strangerLine.id, "Nope", { actorUserId: tester.user.id }),
    /only contact Cameron/i
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

  assert.equal(canViewerSeeLine(db, tester.user.id, cameronLine.id), true);
  assert.equal(canViewerSeeLine(db, tester.user.id, testLine.id), true);
  assert.equal(canViewerSeeLine(db, tester.user.id, strangerLine.id), false);

  const snap = householdSnapshot(db, tester.user.id);
  const dirIds = new Set(snap.directory.map((d: { id: string }) => d.id));
  assert.equal(dirIds.has(cameronLine.id), true);
  assert.equal(dirIds.has(testLine.id), true);
  assert.equal(dirIds.has(strangerLine.id), false);
  assert.equal(snap.households[0].allowlist.length, 1);
  assert.equal(snap.households[0].allowlist[0].target_line_id, cameronLine.id);
  const mine = snap.households[0].spheres.find((s: { is_mine: boolean }) => s.is_mine);
  assert.ok(mine);
  assert.equal(mine.member_line_ids.includes(strangerLine.id), false);
  assert.ok(mine.member_line_ids.includes(cameronLine.id) || mine.member_line_ids.includes(testLine.id));

  addAllowlist(db, hhT.id, testLine.id, "Test");
  assert.equal(canCall(db, testLine.id, cameronLine.id).ok, true);
  assert.equal(canCall(db, cameronLine.id, testLine.id).ok, true);
  assert.equal(canCall(db, testLine.id, strangerLine.id).ok, false);

  // Bidirectional: other families must never see Test, even with polluted allowlist/circle.
  assert.throws(
    () => addAllowlist(db, hhS.id, testLine.id, "Test", { actorUserId: stranger.user.id }),
    /only available to Cameron/i
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
  assert.equal(canViewerSeeLine(db, cameron.user.id, testLine.id), true);

  const strangerSnap = householdSnapshot(db, stranger.user.id);
  assert.equal(
    strangerSnap.households[0].allowlist.some((a: { target_line_id: string }) => a.target_line_id === testLine.id),
    false
  );
  assert.equal(
    strangerSnap.directory.some((d: { id: string }) => d.id === testLine.id),
    false
  );

  const kid = addLine(db, hhT.id, cameron.user.id, "Alex", "softphone", { mode: "child" });
  updateLine(db, hhT.id, kid.id, { mode: "child" }, { actorUserId: cameron.user.id });
  const kidLogin = setChildLineLogin(db, cameron.user.id, kid.id, {
    username: "alexkid",
    password: "password1!",
  });
  // Household still has Test for Cameron; kid softphone must not see it.
  const kidSnap = householdSnapshot(db, kidLogin.childUser.id);
  assert.equal(
    kidSnap.households[0].allowlist.some((a: { target_line_id: string }) => a.target_line_id === testLine.id),
    false
  );
  assert.equal(
    kidSnap.directory.some((d: { id: string }) => d.id === testLine.id),
    false
  );

  const cameronSnap = householdSnapshot(db, cameron.user.id);
  assert.equal(
    cameronSnap.households[0].allowlist.some((a: { target_line_id: string }) => a.target_line_id === testLine.id),
    true
  );
  // Review softphone must not sit in Cameron’s circle (kids inherit that list).
  const cameronSphere = cameronSnap.households[0].spheres.find((s: { is_mine: boolean }) => s.is_mine);
  assert.ok(cameronSphere);
  assert.equal(cameronSphere.member_line_ids.includes(testLine.id), false);
  assert.equal(
    cameronSnap.households[0].allowlist.find((a: { target_line_id: string }) => a.target_line_id === testLine.id)
      ?.is_test_review,
    true
  );
});

test("kids see Mom/Dad only for guardians; Pod adults are Aunt/Uncle + first name", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-aunt-"));
  const db = openDb(path.join(dir, "t.db"));
  const casey = registerParent(db, "Casey", { username: "caseylbl2", password: "password1" });
  const drew = registerParent(db, "Drew", { username: "drewlbl2", password: "password1" });
  const jordan = registerParent(db, "Jordan", { username: "jordanlbl2", password: "password1" });
  const cameron = registerParent(db, "Cameron", { username: "cameronlbl2", password: "password1" });
  const morgan = registerParent(db, "Morgan", { username: "morganlbl2", password: "password1" });

  updateUserProfile(db, casey.user.id, { parent_title: "dad" });
  updateUserProfile(db, drew.user.id, { parent_title: "dad" });
  updateUserProfile(db, jordan.user.id, { parent_title: "mom" });
  updateUserProfile(db, cameron.user.id, { parent_title: "dad" });
  updateUserProfile(db, morgan.user.id, { parent_title: "mom" });

  const hhNorth = createHousehold(db, casey.user.id, "North");
  ensureHouseholdParentMember(db, hhNorth.id, drew.user.id);
  ensureHouseholdParentMember(db, hhNorth.id, jordan.user.id);
  const caseyLine = addLine(db, hhNorth.id, casey.user.id, "Quinns Dads phone");
  const drewLine = addLine(db, hhNorth.id, drew.user.id, "Drew’s Phone");
  const jordanLine = addLine(db, hhNorth.id, jordan.user.id, "Jordan's phone");
  const quinn = addLine(db, hhNorth.id, casey.user.id, "Quinn", "softphone", { mode: "child" });
  updateLine(db, hhNorth.id, quinn.id, { mode: "child", child_label: "Quinn" }, { actorUserId: casey.user.id });
  const sam = addLine(db, hhNorth.id, drew.user.id, "Sam", "softphone", { mode: "child" });
  updateLine(
    db,
    hhNorth.id,
    sam.id,
    { mode: "child", child_label: "Sam" },
    { actorUserId: drew.user.id }
  );
  ensureGuardian(db, sam.id, morgan.user.id);

  const hhEast = createHousehold(db, cameron.user.id, "East");
  const cameronLine = addLine(db, hhEast.id, cameron.user.id, "Cameron's phone");
  const alex = addLine(db, hhEast.id, cameron.user.id, "Alex", "softphone", { mode: "child" });
  updateLine(db, hhEast.id, alex.id, { mode: "child", child_label: "Alex" }, { actorUserId: cameron.user.id });
  ensureGuardian(db, alex.id, jordan.user.id);

  const hhMil = createHousehold(db, morgan.user.id, "West");
  const morganLine = addLine(db, hhMil.id, morgan.user.id, "Morgan's Phonr");

  // Quinn: only Casey is Dad; Drew/Jordan/Cameron/Morgan are Aunt/Uncle.
  assert.equal(kidFacingAdultLabel(db, caseyLine.id, quinn.id), "Dad");
  assert.equal(kidFacingAdultLabel(db, drewLine.id, quinn.id), "Uncle Drew");
  assert.equal(kidFacingAdultLabel(db, jordanLine.id, quinn.id), "Aunt Jordan");
  assert.equal(kidFacingAdultLabel(db, cameronLine.id, quinn.id), "Uncle Cameron");
  assert.equal(kidFacingAdultLabel(db, morganLine.id, quinn.id), "Aunt Morgan");
  assert.equal(peerLabelForCall(db, drewLine.id, quinn.id), "Uncle Drew");

  // Sam: Drew Dad, Morgan Mom; Casey/Jordan are Aunt/Uncle.
  assert.equal(kidFacingAdultLabel(db, drewLine.id, sam.id), "Dad");
  assert.equal(kidFacingAdultLabel(db, morganLine.id, sam.id), "Mom");
  assert.equal(kidFacingAdultLabel(db, caseyLine.id, sam.id), "Uncle Casey");
  assert.equal(kidFacingAdultLabel(db, jordanLine.id, sam.id), "Aunt Jordan");

  // Alex: Cameron Dad, Jordan Mom; Casey/Drew are uncles.
  assert.equal(kidFacingAdultLabel(db, cameronLine.id, alex.id), "Dad");
  assert.equal(kidFacingAdultLabel(db, jordanLine.id, alex.id), "Mom");
  assert.equal(kidFacingAdultLabel(db, caseyLine.id, alex.id), "Uncle Casey");
  assert.equal(kidFacingAdultLabel(db, drewLine.id, alex.id), "Uncle Drew");
  assert.equal(peerLabelForCall(db, caseyLine.id, alex.id), "Uncle Casey");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("Pod brother is not secondary Dad — Quinn’s pad 2 stays open", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-brother-"));
  const db = openDb(path.join(dir, "t.db"));
  const casey = registerParent(db, "Casey", { username: "brocasey", password: "password1" });
  const drew = registerParent(db, "Drew", { username: "brodrew", password: "password1" });
  updateUserProfile(db, casey.user.id, { parent_title: "dad" });
  updateUserProfile(db, drew.user.id, { parent_title: "dad" });

  const hh = createHousehold(db, casey.user.id, "North");
  ensureHouseholdParentMember(db, hh.id, drew.user.id);
  // Drew’s line is older — old bug picked him as household “Dad” #2.
  const drewLine = addLine(db, hh.id, drew.user.id, "Drew's phone");
  db.prepare(`UPDATE lines SET created_at = ? WHERE id = ?`).run("2026-01-01T00:00:00.000Z", drewLine.id);
  const caseyLine = addLine(db, hh.id, casey.user.id, "Casey's phone");
  db.prepare(`UPDATE lines SET created_at = ? WHERE id = ?`).run("2026-01-02T00:00:00.000Z", caseyLine.id);

  const quinn = addLine(db, hh.id, casey.user.id, "Quinn", "softphone", { mode: "child" });
  updateLine(db, hh.id, quinn.id, { mode: "child", child_label: "Quinn" }, { actorUserId: casey.user.id });
  const sam = addLine(db, hh.id, drew.user.id, "Sam", "softphone", { mode: "child" });
  updateLine(
    db,
    hh.id,
    sam.id,
    { mode: "child", child_label: "Sam" },
    { actorUserId: drew.user.id }
  );

  assert.equal(householdAdminParentLine(db, hh.id)?.id, caseyLine.id);
  assert.equal(householdSecondaryParentLine(db, hh.id), null, "Drew is Casey’s brother, not co-parent");
  assert.equal(householdKidPad2ParentLine(db, hh.id), null);

  const quinnPads = kidPadParentLinesForChild(db, quinn.id, hh.id);
  assert.equal(quinnPads.pad1?.id, caseyLine.id);
  assert.equal(quinnPads.pad2, null);
  assert.equal(kidFacingAdultLabel(db, drewLine.id, quinn.id), "Uncle Drew");
  assert.equal(kidFacingAdultLabel(db, caseyLine.id, quinn.id), "Dad");

  const samPads = kidPadParentLinesForChild(db, sam.id, hh.id);
  assert.equal(samPads.pad1?.id, drewLine.id);
  assert.equal(samPads.pad2, null);
  assert.equal(kidFacingAdultLabel(db, caseyLine.id, sam.id), "Uncle Casey");

  upsertAtaDevice(
    db,
    quinn.id,
    {
      sip_extension: "2099",
      sip_password: "example-sip-pass",
      sip_server: "192.168.2.105",
    },
    { allowSipCredentialOverride: true }
  );
  const dial1 = resolveAtaDial(db, "2099", "1");
  assert.equal(dial1.ok, true);
  if (dial1.ok && !("treeHouse" in dial1)) {
    assert.equal(dial1.toLineId, caseyLine.id);
    assert.equal(dial1.toLabel, "Dad");
  }
  // Dial 2 with no co-parent and empty allowlist → no contact.
  const dial2 = resolveAtaDial(db, "2099", "2");
  assert.equal(dial2.ok, false);

  fs.rmSync(dir, { recursive: true, force: true });
});
