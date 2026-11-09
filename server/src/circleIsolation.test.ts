import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  addAllowlist,
  addLine,
  allowlistTargetVisibleOnKidCircle,
  attachExistingUserAsGrandparent,
  canAdminProvisionedRelativeHousehold,
  canAdminPodGrandparents,
  canCall,
  canManageHouseholdSettings,
  canViewerSeeLine,
  createGuardianInvite,
  createHousehold,
  createInvite,
  ensureGuardian,
  ensureHouseholdParentMember,
  ensureSphereForParent,
  addLineToSphere,
  getSphereByOwner,
  householdSnapshot,
  householdKidPad2ParentLine,
  isGrandparentPeerLine,
  lineHasChildAccounts,
  listSphereMemberLineIds,
  peerLabelForCall,
  provisionGrandparent,
  provisionedRelativeAdminSnapshot,
  redeemGuardianInvite,
  updateProvisionedRelativeLogin,
  redeemInvite,
  registerParent,
  resolveAtaDial,
  updateHouseholdRules,
  updateLine,
  upsertAtaDevice,
  userCanOperateLine,
  canManageChild,
  userInHousehold,
} from "./api.js";
import { openDb } from "./db.js";

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-circle-"));
  return openDb(path.join(dir, "t.db"));
}

function pendingIds(snap: ReturnType<typeof householdSnapshot>) {
  const hh = snap.households[0];
  const approved = new Set((hh?.allowlist || []).map((a) => a.target_line_id));
  const declined = new Set(hh?.declined_line_ids || []);
  const mine = (hh?.spheres || []).find((s) => s.is_mine);
  const inMine = new Set(mine?.member_line_ids || []);
  return snap.directory
    .filter((d) => d.household_id !== hh?.id && !approved.has(d.id) && !declined.has(d.id))
    .filter((d) => !inMine.size || inMine.has(d.id))
    .map((d) => d.id);
}

test("sister joins Morgan’s Pod; East/Quinn stay isolated; sister manages West Grandma", () => {
  const db = tmpDb();

  const cameron = registerParent(db, "Cameron East", { username: "cameroniso", password: "password1" });
  const jordan = registerParent(db, "Jordan", { username: "jordaniso", password: "password1" });
  const quinnDad = registerParent(db, "Quinns Dad", { username: "quinndad", password: "password1" });
  const morgan = registerParent(db, "Morgan", { username: "morganiso", password: "password1" });
  const drew = registerParent(db, "Drew", { username: "drewiso", password: "password1" });
  const sister = registerParent(db, "Sister", { username: "sisteriso", password: "password1" });

  const hhEast = createHousehold(db, cameron.user.id, "East");
  const cameronLine = addLine(db, hhEast.id, cameron.user.id, "Cameron phone");
  const alex = addLine(db, hhEast.id, cameron.user.id, "Alex", "softphone", { mode: "child" });
  updateLine(db, hhEast.id, alex.id, { mode: "child", child_label: "Alex" }, { actorUserId: cameron.user.id });
  const riley = addLine(db, hhEast.id, cameron.user.id, "Riley", "softphone", { mode: "child" });
  updateLine(db, hhEast.id, riley.id, { mode: "child", child_label: "Riley" }, { actorUserId: cameron.user.id });
  ensureGuardian(db, alex.id, jordan.user.id);
  ensureGuardian(db, riley.id, jordan.user.id);

  // Friend invite: Quinn is Circle-only, not East Pod membership.
  const invQuinn = createInvite(db, hhEast.id, cameron.user.id, {
    kind: "friend",
    targetKidLineId: alex.id,
  });
  const quinnJoin = redeemInvite(db, invQuinn.code, quinnDad.user.id, "Quinn house");
  const quinn = addLine(db, quinnJoin.household.id, quinnDad.user.id, "Quinn", "softphone", {
    mode: "child",
  });
  updateLine(
    db,
    quinnJoin.household.id,
    quinn.id,
    { mode: "child", child_label: "Quinn" },
    { actorUserId: quinnDad.user.id }
  );

  // West is its own family-name Pod (not created by redeeming East).
  const hhHil = createHousehold(db, morgan.user.id, "West");
  addLine(db, hhHil.id, morgan.user.id, "Morgan phone");
  const sam = addLine(db, hhHil.id, morgan.user.id, "Sam", "softphone", { mode: "child" });
  updateLine(db, hhHil.id, sam.id, { mode: "child", child_label: "Sam" }, { actorUserId: morgan.user.id });

  // Drew keeps North — co-parent redeem does not join West.
  const hhNorthDrew = createHousehold(db, drew.user.id, "North");
  addLine(db, hhNorthDrew.id, drew.user.id, "Drew phone");
  const gInv = createGuardianInvite(db, morgan.user.id, sam.id);
  redeemGuardianInvite(db, drew.user.id, gInv.code);
  assert.equal(userInHousehold(db, hhHil.id, drew.user.id), false);
  assert.equal(userInHousehold(db, hhNorthDrew.id, drew.user.id), true);

  const grandmaEast = provisionGrandparent(db, cameron.user.id, hhEast.id, {
    displayName: "Grandma East",
    username: "grandmaeastiso",
    password: "password1!",
    label: "Grandma",
    kidLineIds: [alex.id],
  });

  const otherGrandma = provisionGrandparent(db, morgan.user.id, hhHil.id, {
    displayName: "Sam Other Grandma",
    username: "othergrandmaiso",
    password: "password1!",
    label: "Grandma",
    kidLineIds: [sam.id],
  });

  // Sibling invite → join West Pod (same family name), not a new Pod.
  const invSister = createInvite(db, hhHil.id, morgan.user.id, { kind: "family" });
  const sisterJoin = redeemInvite(db, invSister.code, sister.user.id, "Ignored");
  assert.equal(sisterJoin.created, false);
  assert.equal(sisterJoin.household.id, hhHil.id);
  assert.equal(userInHousehold(db, hhHil.id, sister.user.id), true);
  const sisterLine = addLine(db, hhHil.id, sister.user.id, "Sister phone");
  const cousinA = addLine(db, hhHil.id, sister.user.id, "CousinA", "softphone", {
    mode: "child",
  });
  updateLine(
    db,
    hhHil.id,
    cousinA.id,
    { mode: "child", child_label: "CousinA" },
    { actorUserId: sister.user.id }
  );
  const cousinB = addLine(db, hhHil.id, sister.user.id, "CousinB", "softphone", {
    mode: "child",
  });
  updateLine(
    db,
    hhHil.id,
    cousinB.id,
    { mode: "child", child_label: "CousinB" },
    { actorUserId: sister.user.id }
  );

  // Already on the Pod — cannot redeem again.
  assert.throws(
    () => redeemInvite(db, createInvite(db, hhHil.id, morgan.user.id).code, sister.user.id, "X"),
    /own invite|already/i
  );

  assert.equal(canViewerSeeLine(db, morgan.user.id, cousinA.id), true);
  // Drew co-parents Sam but is not a West Pod parent — no cousin book.
  assert.equal(canViewerSeeLine(db, drew.user.id, cousinA.id), false);
  assert.equal(canViewerSeeLine(db, sister.user.id, sam.id), true);

  // Sister + Morgan both Manage Grandma West.
  assert.equal(canAdminProvisionedRelativeHousehold(db, sister.user.id, otherGrandma.household.id), true);
  assert.equal(canAdminProvisionedRelativeHousehold(db, morgan.user.id, otherGrandma.household.id), true);

  for (const viewer of [cameron.user.id, jordan.user.id, quinnDad.user.id]) {
    assert.equal(canViewerSeeLine(db, viewer, cousinA.id), false, `viewer ${viewer} saw cousin`);
    assert.equal(canViewerSeeLine(db, viewer, cousinB.id), false);
    assert.equal(canViewerSeeLine(db, viewer, sisterLine.id), false);
  }

  assert.equal(canViewerSeeLine(db, sister.user.id, alex.id), false);
  assert.equal(canViewerSeeLine(db, sister.user.id, riley.id), false);
  assert.equal(canViewerSeeLine(db, sister.user.id, quinn.id), false);
  assert.equal(canViewerSeeLine(db, sister.user.id, grandmaEast.line.id), false);
  assert.equal(canViewerSeeLine(db, sister.user.id, cameronLine.id), false);

  const cameronSnap = householdSnapshot(db, cameron.user.id);
  assert.equal(
    cameronSnap.directory.some((d) => d.id === cousinA.id),
    false
  );
  const jordanSnap = householdSnapshot(db, jordan.user.id);
  assert.equal(jordanSnap.directory.some((d) => d.id === cousinA.id), false);
  const quinnSnap = householdSnapshot(db, quinnDad.user.id);
  assert.equal(quinnSnap.directory.some((d) => d.id === cousinA.id), false);

  // Same-Pod kids can call after allowlist (both already on West).
  addAllowlist(db, hhHil.id, cousinA.id, "CousinA", { actorUserId: morgan.user.id });
  assert.equal(canCall(db, cousinA.id, sam.id).ok, true);
  assert.equal(canCall(db, cousinA.id, alex.id).ok, false);
  assert.equal(canCall(db, cousinA.id, quinn.id).ok, false);

  upsertAtaDevice(
    db,
    cousinA.id,
    {
      sip_extension: "2010",
      sip_password: "example-sip-pass",
      sip_server: "mothership.example",
      display_name: "CousinA ATA",
    },
    { allowSipCredentialOverride: true }
  );
  upsertAtaDevice(
    db,
    alex.id,
    {
      sip_extension: "2001",
      sip_password: "example-sip-pass",
      sip_server: "mothership.example",
      display_name: "Alex ATA",
    },
    { allowSipCredentialOverride: true }
  );
  const fish = resolveAtaDial(db, "2010", "2001");
  assert.equal(fish.ok, false);
  assert.match(String((fish as { reason?: string }).reason || ""), /speed-dial|extension/i);
  const fish2 = resolveAtaDial(db, "2010", "2002");
  assert.equal(fish2.ok, false);

  assert.equal(canAdminProvisionedRelativeHousehold(db, cameron.user.id, grandmaEast.household.id), true);
  assert.equal(canAdminProvisionedRelativeHousehold(db, jordan.user.id, grandmaEast.household.id), false);
  assert.equal(canAdminProvisionedRelativeHousehold(db, morgan.user.id, grandmaEast.household.id), false);
  // Drew is North-only co-parent — not a West Pod parent who manages Grandma West.
  assert.equal(canAdminProvisionedRelativeHousehold(db, drew.user.id, otherGrandma.household.id), false);
  assert.equal(canAdminProvisionedRelativeHousehold(db, cameron.user.id, otherGrandma.household.id), false);
  assert.equal(canAdminProvisionedRelativeHousehold(db, sister.user.id, grandmaEast.household.id), false);
  assert.equal(canManageHouseholdSettings(db, cameron.user.id, grandmaEast.household.id), true);
  assert.equal(canManageHouseholdSettings(db, jordan.user.id, grandmaEast.household.id), false);
  assert.equal(canManageHouseholdSettings(db, morgan.user.id, grandmaEast.household.id), false);

  assert.throws(
    () => provisionedRelativeAdminSnapshot(db, jordan.user.id, hhEast.id, grandmaEast.relative.id),
    /not found|only parents/i
  );

  const gpAdmin = provisionedRelativeAdminSnapshot(db, cameron.user.id, hhEast.id, grandmaEast.relative.id);
  assert.equal(gpAdmin.household.id, grandmaEast.household.id);
  assert.equal(
    gpAdmin.directory.some((d) => d.id === cousinA.id),
    false
  );
  assert.equal(
    gpAdmin.directory.some((d) => d.id === alex.id),
    true
  );
  assert.throws(
    () => provisionedRelativeAdminSnapshot(db, morgan.user.id, hhHil.id, grandmaEast.relative.id),
    /not found|only parents/i
  );

  updateHouseholdRules(db, grandmaEast.household.id, { dnd: 1 });
  assert.equal(canCall(db, grandmaEast.line.id, alex.id).ok, false);

  const sisterSphere = getSphereByOwner(db, sister.user.id);
  assert.ok(sisterSphere);
  assert.equal(listSphereMemberLineIds(db, sisterSphere.id).includes(alex.id), false);
  assert.equal(listSphereMemberLineIds(db, sisterSphere.id).includes(sam.id), true);

  db.close();
});

test("grandparents who share a kid never see or call each other (softphone + analog)", () => {
  const db = tmpDb();

  const mom = registerParent(db, "Mom", { username: "momgpiso", password: "password1" });
  const hh = createHousehold(db, mom.user.id, "East");
  const momLine = addLine(db, hh.id, mom.user.id, "Mom phone");
  const kid = addLine(db, hh.id, mom.user.id, "Alex", "softphone", { mode: "child" });
  updateLine(db, hh.id, kid.id, { mode: "child", child_label: "Alex" }, { actorUserId: mom.user.id });

  const gp1 = provisionGrandparent(db, mom.user.id, hh.id, {
    displayName: "Grandma East",
    username: "grandmaeastpeer",
    password: "password1!",
    label: "Grandma",
    kidLineIds: [kid.id],
  });
  const gp2 = provisionGrandparent(db, mom.user.id, hh.id, {
    displayName: "Other Grandma",
    username: "othergrandmapeer",
    password: "password1!",
    label: "Nana",
    kidLineIds: [kid.id],
  });

  const gp1UserId = gp1.line.owner_user_id;
  const gp2UserId = gp2.line.owner_user_id;

  assert.equal(canViewerSeeLine(db, gp1UserId, gp2.line.id), false);
  assert.equal(canViewerSeeLine(db, gp2UserId, gp1.line.id), false);
  assert.equal(canViewerSeeLine(db, gp1UserId, kid.id), true);
  assert.equal(canViewerSeeLine(db, gp1UserId, momLine.id), true, "GP sees this Pod’s parents");
  assert.equal(canCall(db, gp1.line.id, kid.id).ok, true);
  assert.equal(canCall(db, gp1.line.id, momLine.id).ok, true);
  assert.equal(canCall(db, gp1.line.id, gp2.line.id).ok, false);
  assert.equal(canCall(db, gp2.line.id, gp1.line.id).ok, false);

  // Even polluted allowlist / sphere must not stick after snapshot scrub.
  db.prepare(
    `INSERT OR REPLACE INTO allowlist (id, household_id, target_line_id, label, speed_dial, favorite, always_allow, created_at)
     VALUES ('al_pollute_gp', ?, ?, 'Nana', 4, 1, 0, datetime('now'))`
  ).run(gp1.household.id, gp2.line.id);
  const gp1Sphere = getSphereByOwner(db, gp1UserId);
  assert.ok(gp1Sphere);
  db.prepare(
    `INSERT OR IGNORE INTO sphere_members (sphere_id, line_id, added_by_user_id, created_at)
     VALUES (?, ?, ?, datetime('now'))`
  ).run(gp1Sphere.id, gp2.line.id, gp1UserId);

  const snap = householdSnapshot(db, gp1UserId);
  assert.equal(
    snap.households[0].allowlist.some((a: { target_line_id: string }) => a.target_line_id === gp2.line.id),
    false
  );
  assert.equal(
    snap.directory.some((d: { id: string }) => d.id === gp2.line.id),
    false
  );
  assert.equal(
    snap.directory.some((d: { id: string }) => d.id === kid.id),
    true
  );
  assert.equal(canCall(db, gp1.line.id, gp2.line.id).ok, false);
  assert.throws(
    () => addAllowlist(db, gp1.household.id, gp2.line.id, "Nana", { actorUserId: gp1UserId }),
    /cannot add other grandparents/i
  );

  // Drifted profile_role=parent still gets simple grandparent chrome after scrub.
  db.prepare(`UPDATE users SET profile_role = 'parent' WHERE id = ?`).run(gp1UserId);
  householdSnapshot(db, gp1UserId);
  const role = db.prepare(`SELECT profile_role FROM users WHERE id = ?`).get(gp1UserId) as {
    profile_role: string;
  };
  assert.equal(role.profile_role, "grandparent");

  upsertAtaDevice(
    db,
    gp1.line.id,
    {
      sip_extension: "2101",
      sip_password: "example-sip-pass",
      sip_server: "mothership.example",
      display_name: "Grandma ATA",
    },
    { allowSipCredentialOverride: true }
  );
  upsertAtaDevice(
    db,
    gp2.line.id,
    {
      sip_extension: "2102",
      sip_password: "example-sip-pass",
      sip_server: "mothership.example",
      display_name: "Nana ATA",
    },
    { allowSipCredentialOverride: true }
  );
  // Pollute digit map then confirm analog cannot resolve GP→GP.
  db.prepare(
    `INSERT OR REPLACE INTO allowlist (id, household_id, target_line_id, label, speed_dial, favorite, always_allow, created_at)
     VALUES ('al_ata_gp', ?, ?, 'Nana', 5, 1, 0, datetime('now'))`
  ).run(gp1.household.id, gp2.line.id);
  const dial = resolveAtaDial(db, "2101", "5");
  assert.equal(dial.ok, false);
  assert.match(
    String((dial as { reason?: string }).reason || ""),
    /approved|contact|grandchild/i
  );

  // Kid remains on grandma’s speed-dial slot 1 (analog + softphone).
  const kidSlot = resolveAtaDial(db, "2101", "1");
  assert.equal(kidSlot.ok, true);
  if (kidSlot.ok && !("treeHouse" in kidSlot && kidSlot.treeHouse)) {
    assert.equal(kidSlot.toLineId, kid.id);
  }

  db.close();
});

test("co-parent parent lines never share a Circle; snapshot scrubs legacy pollution", () => {
  const db = tmpDb();

  const casey = registerParent(db, "Casey", { username: "caseypeer", password: "password1" });
  const jordan = registerParent(db, "Jordan", { username: "jordanpeer", password: "password1" });
  const hhNorth = createHousehold(db, casey.user.id, "North");
  const caseyLine = addLine(db, hhNorth.id, casey.user.id, "Casey phone");
  ensureHouseholdParentMember(db, hhNorth.id, jordan.user.id);
  const jordanLine = addLine(db, hhNorth.id, jordan.user.id, "Jordan's phone");

  const caseySphere = getSphereByOwner(db, casey.user.id);
  assert.ok(caseySphere);
  db.prepare(
    `INSERT OR IGNORE INTO sphere_members (sphere_id, line_id, added_by_user_id, created_at)
     VALUES (?, ?, ?, datetime('now'))`
  ).run(caseySphere.id, jordanLine.id, casey.user.id);

  const snap = householdSnapshot(db, casey.user.id);
  const north = snap.households.find((h) => h.id === hhNorth.id);
  const mine = north?.spheres?.find((s) => s.is_mine);
  assert.equal(mine?.member_line_ids?.includes(jordanLine.id), false);
  assert.equal(mine?.member_line_ids?.includes(caseyLine.id), true);
  assert.equal(listSphereMemberLineIds(db, caseySphere.id).includes(jordanLine.id), false);

  const quinn = addLine(db, hhNorth.id, casey.user.id, "Quinn", "softphone", { mode: "child" });
  updateLine(db, hhNorth.id, quinn.id, { mode: "child", child_label: "Quinn" }, { actorUserId: casey.user.id });
  const jordanSphere = getSphereByOwner(db, jordan.user.id);
  assert.ok(jordanSphere);
  db.prepare(`INSERT OR IGNORE INTO line_sphere_access (line_id, sphere_id, created_at) VALUES (?, ?, datetime('now'))`).run(
    quinn.id,
    jordanSphere.id
  );
  householdSnapshot(db, casey.user.id);
  const access = db
    .prepare(`SELECT sphere_id FROM line_sphere_access WHERE line_id = ?`)
    .all(quinn.id) as { sphere_id: string }[];
  assert.equal(
    access.some((r) => r.sphere_id === jordanSphere.id),
    false,
    "Quinn must not keep Jordan's Circle access"
  );

  db.close();
});

test("existing account attaches as North GP; pod book is grandchildren only; any North parent Opens", () => {
  const db = tmpDb();

  const casey = registerParent(db, "Casey", { username: "caseypod", password: "password1" });
  const jordan = registerParent(db, "Jordan", { username: "jordanpod", password: "password1" });
  const drew = registerParent(db, "Drew", { username: "drewpod", password: "password1" });
  const cameron = registerParent(db, "Cameron", { username: "cameronpod", password: "password1" });
  const morgan = registerParent(db, "Morgan", { username: "morganpod", password: "password1" });
  const avery = registerParent(db, "Grandma North", {
    username: "grandmanorth",
    password: "password1!",
  });

  const hhNorth = createHousehold(db, casey.user.id, "North");
  const caseyLine = addLine(db, hhNorth.id, casey.user.id, "Casey phone");
  const quinn = addLine(db, hhNorth.id, casey.user.id, "Quinn", "softphone", { mode: "child" });
  updateLine(db, hhNorth.id, quinn.id, { mode: "child", child_label: "Quinn" }, { actorUserId: casey.user.id });

  const hhJordan = createHousehold(db, jordan.user.id, "Jordan house");
  const jordanLine = addLine(db, hhJordan.id, jordan.user.id, "Jordan phone");

  const hhEast = createHousehold(db, cameron.user.id, "East");
  const cameronLine = addLine(db, hhEast.id, cameron.user.id, "Cameron phone");
  const alex = addLine(db, hhEast.id, cameron.user.id, "Alex", "softphone", { mode: "child" });
  updateLine(db, hhEast.id, alex.id, { mode: "child", child_label: "Alex" }, { actorUserId: cameron.user.id });
  const riley = addLine(db, hhEast.id, cameron.user.id, "Riley", "softphone", { mode: "child" });
  updateLine(db, hhEast.id, riley.id, { mode: "child", child_label: "Riley" }, { actorUserId: cameron.user.id });
  ensureGuardian(db, alex.id, jordan.user.id);
  ensureGuardian(db, riley.id, jordan.user.id);

  const hhDrew = createHousehold(db, drew.user.id, "Family");
  const drewLine = addLine(db, hhDrew.id, drew.user.id, "Drew phone");
  const sam = addLine(db, hhDrew.id, drew.user.id, "Sam", "softphone", { mode: "child" });
  updateLine(
    db,
    hhDrew.id,
    sam.id,
    { mode: "child", child_label: "Sam" },
    { actorUserId: drew.user.id }
  );

  const hhHil = createHousehold(db, morgan.user.id, "North (T)");
  const morganLine = addLine(db, hhHil.id, morgan.user.id, "Morgan phone");

  const hhAvery = createHousehold(db, avery.user.id, "Family");
  const averyLine = addLine(db, hhAvery.id, avery.user.id, "Grandma North's phone");
  const housesBefore = (db.prepare(`SELECT COUNT(*) AS n FROM households`).get() as { n: number }).n;

  ensureHouseholdParentMember(db, hhNorth.id, jordan.user.id);
  ensureHouseholdParentMember(db, hhNorth.id, drew.user.id);
  // Live North puts Jordan's softphone on the Pod — Casey must not claim it.
  const jordanNorthLine = addLine(db, hhNorth.id, jordan.user.id, "Jordan's phone");
  assert.equal(userCanOperateLine(db, casey.user.id, caseyLine.id), true);
  assert.equal(userCanOperateLine(db, casey.user.id, quinn.id), true);
  assert.equal(userCanOperateLine(db, casey.user.id, jordanNorthLine.id), false);
  assert.equal(userCanOperateLine(db, jordan.user.id, jordanNorthLine.id), true);
  assert.equal(userCanOperateLine(db, jordan.user.id, quinn.id), false);
  assert.equal(userCanOperateLine(db, jordan.user.id, caseyLine.id), false);
  assert.equal(userCanOperateLine(db, casey.user.id, alex.id), false);
  assert.equal(userCanOperateLine(db, jordan.user.id, alex.id), true);
  // Analog / Kids manage: guardians only — Pod siblings do not get Sam/Quinn ATAs.
  assert.equal(canManageChild(db, jordan.user.id, alex.id), true);
  assert.equal(canManageChild(db, jordan.user.id, quinn.id), false);
  assert.equal(canManageChild(db, casey.user.id, quinn.id), true);
  assert.equal(canManageChild(db, casey.user.id, alex.id), false);

  // Parent-placed kid on dial 2 beats co-parent synthesis (Casey bug).
  addAllowlist(db, hhNorth.id, alex.id, "Alex + Riley", { speedDial: 2 });
  assert.equal(householdKidPad2ParentLine(db, hhNorth.id), null);
  const caseyHh = householdSnapshot(db, casey.user.id).households.find((h) => h.id === hhNorth.id);
  assert.equal(caseyHh?.pad2_parent, null);
  assert.equal(
    (caseyHh?.lines.find((l) => l.id === jordanNorthLine.id) as { can_operate?: boolean } | undefined)
      ?.can_operate,
    false
  );

  const attached = attachExistingUserAsGrandparent(db, casey.user.id, hhNorth.id, avery.user.id, {
    displayName: "Avery",
    label: "Avery",
  });
  assert.equal(attached.createdHousehold, false);
  assert.equal(attached.household.id, hhAvery.id);
  assert.equal(attached.line.id, averyLine.id);
  assert.equal(attached.username, "grandmanorth");
  assert.equal(userCanOperateLine(db, casey.user.id, averyLine.id), true);
  assert.equal(userCanOperateLine(db, jordan.user.id, averyLine.id), true);
  const housesAfter = (db.prepare(`SELECT COUNT(*) AS n FROM households`).get() as { n: number }).n;
  assert.equal(housesAfter, housesBefore);

  const role = db.prepare(`SELECT profile_role, display_name FROM users WHERE id = ?`).get(avery.user.id) as {
    profile_role: string;
    display_name: string;
  };
  assert.equal(role.profile_role, "grandparent");
  assert.equal(role.display_name, "Avery");

  assert.equal(canViewerSeeLine(db, avery.user.id, quinn.id), true);
  // North GP pad includes North’s parents (their Pod phone), not other Pods’ adults.
  assert.equal(canViewerSeeLine(db, avery.user.id, caseyLine.id), true, "GP pad: Pod parents");
  assert.equal(canViewerSeeLine(db, avery.user.id, jordanNorthLine.id), true);
  assert.equal(canViewerSeeLine(db, avery.user.id, jordanLine.id), false, "only Jordan’s North phone");
  assert.equal(canViewerSeeLine(db, avery.user.id, drewLine.id), true);
  assert.equal(canViewerSeeLine(db, avery.user.id, sam.id), true);
  assert.equal(canViewerSeeLine(db, avery.user.id, alex.id), true);
  assert.equal(canViewerSeeLine(db, avery.user.id, riley.id), true);
  // Cameron is East-only — not a North Pod adult.
  assert.equal(canViewerSeeLine(db, avery.user.id, cameronLine.id), false);
  assert.equal(canViewerSeeLine(db, avery.user.id, morganLine.id), false);

  assert.equal(canCall(db, attached.line.id, quinn.id).ok, true);
  assert.equal(canCall(db, attached.line.id, caseyLine.id).ok, true, "Grandma dials her Pod’s parents");
  assert.equal(canCall(db, caseyLine.id, attached.line.id).ok, true);
  assert.equal(canCall(db, attached.line.id, jordanNorthLine.id).ok, true);
  assert.equal(canCall(db, attached.line.id, cameronLine.id).ok, false, "East-only adult");
  assert.equal(canCall(db, attached.line.id, morganLine.id).ok, false, "Sam’s other Pod");
  assert.equal(canCall(db, attached.line.id, sam.id).ok, true);
  assert.equal(canCall(db, attached.line.id, alex.id).ok, true);
  assert.equal(canCall(db, attached.line.id, riley.id).ok, true);

  assert.equal(peerLabelForCall(db, attached.line.id, quinn.id), "Grandma North");
  assert.equal(peerLabelForCall(db, attached.line.id, alex.id), "Grandma North");
  assert.equal(peerLabelForCall(db, attached.line.id, riley.id), "Grandma North");
  assert.equal(peerLabelForCall(db, attached.line.id, sam.id), "Grandma North");
  const caseySnap = householdSnapshot(db, casey.user.id);
  const northSnap = caseySnap.households.find((h) => h.id === hhNorth.id);
  const gpOnNorth = (northSnap?.allowlist || []).find((a) => a.target_line_id === attached.line.id);
  assert.equal(gpOnNorth?.label, "Avery");
  assert.equal(gpOnNorth?.kid_label, "Grandma North");
  const dirGp = caseySnap.directory.find((d) => d.id === attached.line.id);
  assert.equal(dirGp?.name, "Avery");
  assert.equal(dirGp?.kid_name, "Grandma North");

  for (const parent of [casey, jordan, drew]) {
    assert.equal(canAdminProvisionedRelativeHousehold(db, parent.user.id, attached.household.id), true);
    const admin = provisionedRelativeAdminSnapshot(db, parent.user.id, hhNorth.id, attached.relative.id);
    assert.equal(admin.household.id, attached.household.id);
    const fromDrewHouse = provisionedRelativeAdminSnapshot(
      db,
      parent.user.id,
      hhDrew.id,
      attached.relative.id
    );
    assert.equal(fromDrewHouse.relative.id, attached.relative.id);
  }
  assert.equal(canAdminProvisionedRelativeHousehold(db, cameron.user.id, attached.household.id), false);
  assert.equal(canAdminProvisionedRelativeHousehold(db, morgan.user.id, attached.household.id), false);

  const jordanSnap = householdSnapshot(db, jordan.user.id);
  const gpIds = jordanSnap.households.flatMap((h) => (h.provisioned_relatives || []).map((r) => r.id));
  assert.ok(gpIds.includes(attached.relative.id));

  db.prepare(`UPDATE users SET parent_title = 'dad' WHERE id = ?`).run(cameron.user.id);

  const grandmaEast = provisionGrandparent(db, cameron.user.id, hhEast.id, {
    displayName: "Sloan",
    username: "sloanpod",
    password: "password1!",
    label: "Grandma",
    kidLineIds: [alex.id, riley.id],
  });
  const grandpaEast = provisionGrandparent(db, cameron.user.id, hhEast.id, {
    displayName: "Parker",
    username: "parkerpod",
    password: "password1!",
    label: "Grandpa",
    kidLineIds: [alex.id, riley.id],
  });

  assert.equal(canViewerSeeLine(db, grandmaEast.line.owner_user_id, alex.id), true);
  assert.equal(canViewerSeeLine(db, grandmaEast.line.owner_user_id, riley.id), true);
  assert.equal(canViewerSeeLine(db, grandpaEast.line.owner_user_id, alex.id), true);
  assert.equal(canViewerSeeLine(db, grandmaEast.line.owner_user_id, quinn.id), false);
  assert.equal(canViewerSeeLine(db, grandpaEast.line.owner_user_id, quinn.id), false);
  assert.equal(canViewerSeeLine(db, attached.line.owner_user_id, quinn.id), true);

  assert.equal(peerLabelForCall(db, grandmaEast.line.id, alex.id), "Grandma East");
  assert.equal(peerLabelForCall(db, grandpaEast.line.id, alex.id), "Grandpa East");
  assert.equal(peerLabelForCall(db, grandmaEast.line.id, cameronLine.id), "Sloan");
  assert.equal(peerLabelForCall(db, grandpaEast.line.id, cameronLine.id), "Parker");
  assert.equal(peerLabelForCall(db, attached.line.id, alex.id), "Grandma North");

  const gpPad = db
    .prepare(
      `SELECT a.target_line_id, a.label, a.speed_dial FROM allowlist a
       WHERE a.household_id = ? ORDER BY a.speed_dial`
    )
    .all(grandpaEast.household.id) as { target_line_id: string; label: string; speed_dial: number }[];
  assert.equal(gpPad[0]?.target_line_id, alex.id);
  assert.equal(gpPad[0]?.speed_dial, 2);
  assert.equal(gpPad[1]?.target_line_id, riley.id);
  assert.equal(gpPad[1]?.speed_dial, 3);
  assert.equal(
    gpPad.find((r) => r.target_line_id === cameronLine.id)?.speed_dial,
    4,
    "East GP book: East parent after the grandchildren"
  );
  assert.equal(
    gpPad.some((r) => r.target_line_id === jordanLine.id),
    false,
    "North co-parent stays off the East GP book"
  );

  assert.equal(canAdminProvisionedRelativeHousehold(db, cameron.user.id, grandmaEast.household.id), true);
  assert.equal(canAdminProvisionedRelativeHousehold(db, jordan.user.id, grandmaEast.household.id), false);
  assert.equal(canAdminProvisionedRelativeHousehold(db, jordan.user.id, grandpaEast.household.id), false);
  assert.throws(
    () => provisionedRelativeAdminSnapshot(db, jordan.user.id, hhEast.id, grandmaEast.relative.id),
    /not found|only parents/i
  );
  assert.throws(
    () => provisionedRelativeAdminSnapshot(db, jordan.user.id, hhNorth.id, grandmaEast.relative.id),
    /not found|only parents/i
  );
  const cameronGpAdmin = provisionedRelativeAdminSnapshot(
    db,
    cameron.user.id,
    hhEast.id,
    grandmaEast.relative.id
  );
  assert.equal(cameronGpAdmin.household.id, grandmaEast.household.id);
  assert.equal(
    cameronGpAdmin.directory.some((d) => d.id === quinn.id),
    false
  );
  assert.equal(
    cameronGpAdmin.directory.some((d) => d.id === alex.id),
    true
  );

  const jordanAfter = householdSnapshot(db, jordan.user.id);
  const jordanGpIds = jordanAfter.households.flatMap((h) =>
    (h.provisioned_relatives || []).map((r) => r.id)
  );
  assert.ok(jordanGpIds.includes(attached.relative.id));
  assert.equal(jordanGpIds.includes(grandmaEast.relative.id), false);
  assert.equal(jordanGpIds.includes(grandpaEast.relative.id), false);

  const cameronAfter = householdSnapshot(db, cameron.user.id);
  const cameronGpIds = cameronAfter.households.flatMap((h) =>
    (h.provisioned_relatives || []).map((r) => r.id)
  );
  assert.ok(cameronGpIds.includes(grandmaEast.relative.id));
  assert.ok(cameronGpIds.includes(grandpaEast.relative.id));
  assert.equal(cameronGpIds.includes(attached.relative.id), false);

  const meemaw = updateProvisionedRelativeLogin(
    db,
    casey.user.id,
    hhNorth.id,
    attached.relative.id,
    { kidNickname: "Meemaw" }
  );
  assert.equal(meemaw.relative.kid_nickname, "Meemaw");
  assert.equal(meemaw.relative.kid_label, "Meemaw North");
  assert.equal(peerLabelForCall(db, attached.line.id, alex.id), "Meemaw North");
  assert.equal(peerLabelForCall(db, attached.line.id, caseyLine.id), "Avery");

  const jordanNick = updateProvisionedRelativeLogin(
    db,
    jordan.user.id,
    hhNorth.id,
    attached.relative.id,
    { kidNickname: "Nana" }
  );
  assert.equal(jordanNick.relative.kid_label, "Nana North");

  const blank = updateProvisionedRelativeLogin(
    db,
    casey.user.id,
    hhNorth.id,
    attached.relative.id,
    { kidNickname: "" }
  );
  assert.equal(blank.relative.kid_nickname, "Grandma");
  assert.equal(blank.relative.kid_label, "Grandma North");
  assert.equal(peerLabelForCall(db, attached.line.id, alex.id), "Grandma North");

  assert.throws(
    () =>
      updateProvisionedRelativeLogin(db, jordan.user.id, hhEast.id, grandmaEast.relative.id, {
        kidNickname: "Meemaw",
      }),
    /not found|only parents/i
  );

  const eastMembers = db
    .prepare(`SELECT user_id FROM household_members WHERE household_id = ?`)
    .all(hhEast.id) as { user_id: string }[];
  assert.equal(
    eastMembers.some((m) => m.user_id === jordan.user.id),
    false
  );

  db.close();
});

test("grandparent invite attaches existing user instead of creating a parent Pod", () => {
  const db = tmpDb();
  const casey = registerParent(db, "Casey", { username: "caseygpinv", password: "password1" });
  const nana = registerParent(db, "Nana", { username: "nanaexist", password: "password1" });
  const hhNorth = createHousehold(db, casey.user.id, "North");
  const caseyLine = addLine(db, hhNorth.id, casey.user.id, "Casey phone");
  const kid = addLine(db, hhNorth.id, casey.user.id, "Quinn", "softphone", { mode: "child" });
  updateLine(db, hhNorth.id, kid.id, { mode: "child", child_label: "Quinn" }, { actorUserId: casey.user.id });
  const hhNana = createHousehold(db, nana.user.id, "Nana house");
  addLine(db, hhNana.id, nana.user.id, "Nana phone");

  const inv = createInvite(db, hhNorth.id, casey.user.id, { kind: "grandparent" });
  assert.equal(inv.kind, "grandparent");
  const redeemed = redeemInvite(db, inv.code, nana.user.id, "ShouldNotBecomeNewPod");
  assert.equal(redeemed.created, false);
  assert.equal(redeemed.household.id, hhNana.id);
  const role = db.prepare(`SELECT profile_role FROM users WHERE id = ?`).get(nana.user.id) as {
    profile_role: string;
  };
  assert.equal(role.profile_role, "grandparent");
  assert.equal(canViewerSeeLine(db, nana.user.id, kid.id), true);
  assert.equal(canViewerSeeLine(db, nana.user.id, caseyLine.id), true, "GP sees this Pod’s parents");
  const houses = (db.prepare(`SELECT COUNT(*) AS n FROM households`).get() as { n: number }).n;
  assert.equal(houses, 2);

  db.close();
});

test("merged grandparent on North: Casey admins Avery only — not Drew/Jordan/Sam", () => {
  const db = tmpDb();
  const casey = registerParent(db, "Quinns Dad", { username: "caseymergegp", password: "password1" });
  const drew = registerParent(db, "756837", { username: "drewmergegp", password: "password1" });
  const jordan = registerParent(db, "Jordan", { username: "jordanmergegp", password: "password1" });
  const avery = registerParent(db, "Avery", { username: "averymergegp", password: "password1" });

  const hhNorth = createHousehold(db, casey.user.id, "North");
  const caseyLine = addLine(db, hhNorth.id, casey.user.id, "Quinns Dads phone");
  const quinn = addLine(db, hhNorth.id, casey.user.id, "Quinn", "softphone", { mode: "child" });
  updateLine(
    db,
    hhNorth.id,
    quinn.id,
    { mode: "child", child_label: "Quinn" },
    { actorUserId: casey.user.id }
  );

  ensureHouseholdParentMember(db, hhNorth.id, drew.user.id);
  ensureHouseholdParentMember(db, hhNorth.id, jordan.user.id);
  const drewLine = addLine(db, hhNorth.id, drew.user.id, "Drew’s Phone");
  const jordanLine = addLine(db, hhNorth.id, jordan.user.id, "Jordan's phone");
  const sam = addLine(db, hhNorth.id, drew.user.id, "Sam & Blake", "softphone", {
    mode: "child",
  });
  updateLine(
    db,
    hhNorth.id,
    sam.id,
    { mode: "child", child_label: "Sam & Blake" },
    { actorUserId: drew.user.id }
  );

  // Live triage: Avery (GP) sits in North — provisioned_relatives.relative_household_id
  // points at North itself. Must not unlock peer parent/kid lines for Casey.
  ensureHouseholdParentMember(db, hhNorth.id, avery.user.id);
  db.prepare(`UPDATE users SET profile_role = 'grandparent' WHERE id = ?`).run(avery.user.id);
  const averyLine = addLine(db, hhNorth.id, avery.user.id, "Grandma North's phone");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO provisioned_relatives
      (id, from_household_id, relative_user_id, relative_line_id, relative_household_id,
       display_label, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, 'Avery', ?, ?)`
  ).run(
    "prov_test_avery",
    hhNorth.id,
    avery.user.id,
    averyLine.id,
    hhNorth.id,
    casey.user.id,
    now
  );

  assert.equal(userCanOperateLine(db, casey.user.id, caseyLine.id), true);
  assert.equal(userCanOperateLine(db, casey.user.id, quinn.id), true);
  assert.equal(userCanOperateLine(db, casey.user.id, averyLine.id), true);
  assert.equal(userCanOperateLine(db, casey.user.id, drewLine.id), false);
  assert.equal(userCanOperateLine(db, casey.user.id, jordanLine.id), false);
  assert.equal(userCanOperateLine(db, casey.user.id, sam.id), false);
  assert.equal(canManageChild(db, casey.user.id, sam.id), false);
  assert.equal(canManageChild(db, casey.user.id, quinn.id), true);
  assert.equal(canManageChild(db, drew.user.id, sam.id), true);
  assert.equal(canManageChild(db, jordan.user.id, sam.id), false);

  const snap = householdSnapshot(db, casey.user.id).households.find((h) => h.id === hhNorth.id)!;
  assert.equal(snap.lines.find((l) => l.id === drewLine.id)?.can_operate, false);
  assert.equal(snap.lines.find((l) => l.id === jordanLine.id)?.can_operate, false);
  assert.equal(snap.lines.find((l) => l.id === sam.id)?.can_operate, false);
  assert.equal(snap.lines.find((l) => l.id === averyLine.id)?.can_operate, true);

  db.close();
});

test("friend invite for Quinn tags Owen as Quinn’s friend for Casey only", () => {
  const db = tmpDb();
  const casey = registerParent(db, "Quinns Dad", { username: "caseyfriendtag", password: "password1" });
  const drew = registerParent(db, "756837", { username: "drewfriendtag", password: "password1" });
  const ken = registerParent(db, "Ken Short", { username: "kenfriendtag", password: "password1" });

  const hhNorth = createHousehold(db, casey.user.id, "North");
  addLine(db, hhNorth.id, casey.user.id, "Quinns Dads phone");
  const quinn = addLine(db, hhNorth.id, casey.user.id, "Quinn", "softphone", { mode: "child" });
  updateLine(db, hhNorth.id, quinn.id, { mode: "child", child_label: "Quinn" }, { actorUserId: casey.user.id });
  ensureHouseholdParentMember(db, hhNorth.id, drew.user.id);
  addLine(db, hhNorth.id, drew.user.id, "Drew’s Phone");

  const inv = createInvite(db, hhNorth.id, casey.user.id, { kind: "friend", targetKidLineId: quinn.id });
  const shorts = redeemInvite(db, inv.code, ken.user.id, "Shorts");
  // Snapshot repair creates Ken’s parent softphone so Casey can approve him on Circle.
  const kenParent = householdSnapshot(db, ken.user.id).households[0].lines.find(
    (l) => (l.mode || "parent") === "parent"
  );
  assert.ok(kenParent, "friend Circle repair must create Ken’s parent phone");
  const owen = addLine(db, shorts.household.id, ken.user.id, "Owen", "softphone", { mode: "child" });
  updateLine(db, shorts.household.id, owen.id, { mode: "child", child_label: "Owen" }, { actorUserId: ken.user.id });

  const caseySnap = householdSnapshot(db, casey.user.id);
  const caseyOwen = caseySnap.directory.find((d) => d.id === owen.id);
  assert.equal(caseyOwen?.friend_of_kid_line_id, quinn.id);
  assert.equal(caseyOwen?.friend_of_kid_label, "Quinn");
  const caseyKen = caseySnap.directory.find((d) => d.id === kenParent!.id);
  assert.ok(caseyKen, "Ken’s parent line must appear for Casey");
  assert.equal(caseyKen?.friend_of_kid_line_id ?? null, null, "Ken is not Quinn’s kid-friend tag");
  // Redeeming the friend invite is the approval — Ken is already on Casey’s pad.
  const caseyNorth = caseySnap.households.find((h) => h.id === hhNorth.id)!;
  assert.ok(caseyNorth.allowlist.some((a) => a.target_line_id === kenParent!.id), "Ken approved on Casey’s pad");
  assert.ok(caseyNorth.allowlist.some((a) => a.target_line_id === owen.id), "Owen approved for Quinn");

  const drewOwen = householdSnapshot(db, drew.user.id).directory.find((d) => d.id === owen.id);
  assert.equal(drewOwen?.friend_of_kid_line_id ?? null, null);

  // Ken approving Quinn must not scrub Quinn off Ken’s Circle (friend invite bridge).
  addAllowlist(db, shorts.household.id, quinn.id, "Quinn");
  const kenSphere = getSphereByOwner(db, ken.user.id)!;
  householdSnapshot(db, ken.user.id);
  assert.equal(listSphereMemberLineIds(db, kenSphere.id).includes(quinn.id), true);

  db.close();
});

test("friend Circle kid-only setup still surfaces Ken for Casey after repair", () => {
  const db = tmpDb();
  const casey = registerParent(db, "Casey", { username: "caseycirclerepair", password: "password1" });
  const ken = registerParent(db, "Ken Short", { username: "kencirclerepair", password: "password1" });

  const hhNorth = createHousehold(db, casey.user.id, "North");
  addLine(db, hhNorth.id, casey.user.id, "Casey's phone");
  const quinn = addLine(db, hhNorth.id, casey.user.id, "Quinn", "softphone", { mode: "child" });
  updateLine(db, hhNorth.id, quinn.id, { mode: "child", child_label: "Quinn" }, { actorUserId: casey.user.id });

  const inv = createInvite(db, hhNorth.id, casey.user.id, { kind: "friend", targetKidLineId: quinn.id });
  // Legacy: redeem + Owen only (no parent phone), then scrub emptied Ken’s Circle.
  const shorts = redeemInvite(db, inv.code, ken.user.id, "Shorts");
  const owen = addLine(db, shorts.household.id, ken.user.id, "Owen", "softphone", { mode: "child" });
  updateLine(db, shorts.household.id, owen.id, { mode: "child", child_label: "Owen" }, { actorUserId: ken.user.id });
  addAllowlist(db, shorts.household.id, quinn.id, "Quinn");
  const kenSphere = getSphereByOwner(db, ken.user.id)!;
  db.prepare(`DELETE FROM sphere_members WHERE sphere_id = ?`).run(kenSphere.id);

  const caseySnap = householdSnapshot(db, casey.user.id);
  const kenParent = caseySnap.directory.find(
    (d) =>
      d.household_id === shorts.household.id &&
      (d.mode || "parent") === "parent" &&
      d.owner_user_id === ken.user.id
  );
  assert.ok(kenParent, "repair recreates Ken’s parent phone into Casey’s Circle");
  assert.equal(kenParent?.friend_of_kid_line_id ?? null, null);
  assert.equal(canCall(db, kenParent!.id, caseySnap.households[0].lines.find((l) => l.owner_user_id === casey.user.id && l.mode === "parent")!.id).ok, true, "Ken ↔ Casey auto-approved");
  assert.equal(canCall(db, owen.id, quinn.id).ok, true, "Owen ↔ Quinn auto-approved");

  householdSnapshot(db, ken.user.id);
  assert.equal(listSphereMemberLineIds(db, kenSphere.id).includes(quinn.id), true);

  db.close();
});test("can_manage is guardian-only across North / East / West / Shorts — never Pod siblings", () => {
  const db = tmpDb();
  const cameron = registerParent(db, "Cameron", { username: "cameronmanageall", password: "password1" });
  const jordan = registerParent(db, "Jordan", { username: "jordanmanageall", password: "password1" });
  const casey = registerParent(db, "Quinns Dad", { username: "caseymanageall", password: "password1" });
  const drew = registerParent(db, "Drew", { username: "drewmanageall", password: "password1" });
  const morgan = registerParent(db, "Morgan", { username: "morganmanageall", password: "password1" });
  const ken = registerParent(db, "Ken", { username: "kenmanageall", password: "password1" });
  const avery = registerParent(db, "Avery", { username: "averymanageall", password: "password1" });

  const hhEast = createHousehold(db, cameron.user.id, "East");
  addLine(db, hhEast.id, cameron.user.id, "Cameron phone");
  const alex = addLine(db, hhEast.id, cameron.user.id, "Alex", "softphone", { mode: "child" });
  updateLine(db, hhEast.id, alex.id, { mode: "child", child_label: "Alex" }, { actorUserId: cameron.user.id });
  ensureGuardian(db, alex.id, jordan.user.id);

  const hhNorth = createHousehold(db, casey.user.id, "North");
  addLine(db, hhNorth.id, casey.user.id, "Casey phone");
  const quinn = addLine(db, hhNorth.id, casey.user.id, "Quinn", "softphone", { mode: "child" });
  updateLine(db, hhNorth.id, quinn.id, { mode: "child", child_label: "Quinn" }, { actorUserId: casey.user.id });
  ensureHouseholdParentMember(db, hhNorth.id, drew.user.id);
  ensureHouseholdParentMember(db, hhNorth.id, jordan.user.id);
  ensureHouseholdParentMember(db, hhNorth.id, avery.user.id);
  db.prepare(`UPDATE users SET profile_role = 'grandparent' WHERE id = ?`).run(avery.user.id);
  addLine(db, hhNorth.id, drew.user.id, "Drew phone");
  addLine(db, hhNorth.id, jordan.user.id, "Jordan phone");
  const sam = addLine(db, hhNorth.id, drew.user.id, "Sam", "softphone", { mode: "child" });
  updateLine(
    db,
    hhNorth.id,
    sam.id,
    { mode: "child", child_label: "Sam" },
    { actorUserId: drew.user.id }
  );

  const hhWest = createHousehold(db, morgan.user.id, "West");
  addLine(db, hhWest.id, morgan.user.id, "Morgan phone");
  ensureGuardian(db, sam.id, morgan.user.id);

  const hhShorts = createHousehold(db, ken.user.id, "Shorts");
  addLine(db, hhShorts.id, ken.user.id, "Ken phone");
  const owen = addLine(db, hhShorts.id, ken.user.id, "Owen", "softphone", { mode: "child" });
  updateLine(db, hhShorts.id, owen.id, { mode: "child", child_label: "Owen" }, { actorUserId: ken.user.id });

  const kids = [alex, quinn, sam, owen] as const;
  const expectManage: Record<string, Set<string>> = {
    [cameron.user.id]: new Set([alex.id]),
    [jordan.user.id]: new Set([alex.id]),
    [casey.user.id]: new Set([quinn.id]),
    [drew.user.id]: new Set([sam.id]),
    [morgan.user.id]: new Set([sam.id]),
    [ken.user.id]: new Set([owen.id]),
    [avery.user.id]: new Set(), // GP sees kids; does not manage Analog
  };

  for (const [userId, allowed] of Object.entries(expectManage)) {
    for (const kid of kids) {
      assert.equal(
        canManageChild(db, userId, kid.id),
        allowed.has(kid.id),
        `user ${userId} manage ${kid.id}`
      );
    }
  }

  // Snapshot can_manage must match (including multi-Pod Alex on North for Jordan).
  const jordanNorth = householdSnapshot(db, jordan.user.id).households.find((h) => h.id === hhNorth.id)!;
  const jordanKids = (jordanNorth.lines || []).filter((l) => (l.mode || "parent") === "child");
  assert.ok(jordanKids.some((l) => l.id === alex.id && l.can_manage === true));
  assert.ok(jordanKids.some((l) => l.id === quinn.id && l.can_manage === false));
  assert.ok(jordanKids.some((l) => l.id === sam.id && l.can_manage === false));

  const caseyNorth = householdSnapshot(db, casey.user.id).households.find((h) => h.id === hhNorth.id)!;
  assert.equal(caseyNorth.lines.find((l) => l.id === quinn.id)?.can_manage, true);
  assert.equal(caseyNorth.lines.find((l) => l.id === sam.id)?.can_manage, false);

  const morganSnap = householdSnapshot(db, morgan.user.id);
  const hilSam = morganSnap.households
    .flatMap((h) => h.lines || [])
    .find((l) => l.id === sam.id);
  assert.equal(hilSam?.can_manage, true);
  // Same kid in two Pod snapshots (West home + North multi) — client Active line dedupes by id.
  const hilPodsWithSam = morganSnap.households.filter((h) =>
    (h.lines || []).some((l) => l.id === sam.id)
  );
  assert.equal(hilPodsWithSam.length, 2);
  const jordanPodsWithAlex = householdSnapshot(db, jordan.user.id).households.filter((h) =>
    (h.lines || []).some((l) => l.id === alex.id)
  );
  assert.equal(jordanPodsWithAlex.length, 2);

  const kenSnap = householdSnapshot(db, ken.user.id).households.find((h) => h.id === hhShorts.id)!;
  assert.equal(kenSnap.lines.find((l) => l.id === owen.id)?.can_manage, true);
  assert.equal(canManageChild(db, ken.user.id, quinn.id), false);
  assert.equal(canManageChild(db, ken.user.id, alex.id), false);

  db.close();
});

test("Cameron family-invites sibling to East: Pod family yes, Circles/North no", () => {
  const db = tmpDb();
  const cameron = registerParent(db, "Cameron", { username: "cameronsibinv", password: "password1" });
  const sibling = registerParent(db, "Sibling", { username: "siblingsibinv", password: "password1" });
  const jordan = registerParent(db, "Jordan", { username: "jordansibinv", password: "password1" });
  const casey = registerParent(db, "Casey", { username: "caseysibinv", password: "password1" });

  const hhEast = createHousehold(db, cameron.user.id, "East");
  const cameronLine = addLine(db, hhEast.id, cameron.user.id, "Cameron phone");
  const alex = addLine(db, hhEast.id, cameron.user.id, "Alex", "softphone", { mode: "child" });
  updateLine(db, hhEast.id, alex.id, { mode: "child", child_label: "Alex" }, { actorUserId: cameron.user.id });
  ensureGuardian(db, alex.id, jordan.user.id);

  // Separate-household Grandma on East allowlist (classic provisionGrandparent shape).
  const grandma = provisionGrandparent(db, cameron.user.id, hhEast.id, {
    displayName: "Sloan",
    username: "sloansibinv",
    password: "password1",
    label: "Mom",
    kidLineIds: [alex.id],
  });

  const hhNorth = createHousehold(db, casey.user.id, "North");
  addLine(db, hhNorth.id, casey.user.id, "Casey phone");
  const quinn = addLine(db, hhNorth.id, casey.user.id, "Quinn", "softphone", { mode: "child" });
  updateLine(db, hhNorth.id, quinn.id, { mode: "child", child_label: "Quinn" }, { actorUserId: casey.user.id });

  const inv = createInvite(db, hhEast.id, cameron.user.id, { kind: "family" });
  const redeemed = redeemInvite(db, inv.code, sibling.user.id, "ShouldNotBecomePod");
  assert.equal(redeemed.household.id, hhEast.id);
  assert.equal(redeemed.created, false);
  assert.equal(userInHousehold(db, hhEast.id, sibling.user.id), true);

  // Not auto-guardian of Alex — Analog/Circle stay Cameron (+ Jordan).
  assert.equal(canManageChild(db, sibling.user.id, alex.id), false);
  assert.equal(canManageChild(db, cameron.user.id, alex.id), true);

  // Pod family visibility
  assert.equal(canViewerSeeLine(db, sibling.user.id, cameronLine.id), true);
  assert.equal(canViewerSeeLine(db, sibling.user.id, alex.id), true);
  assert.equal(canViewerSeeLine(db, sibling.user.id, grandma.line.id), true);
  assert.equal(canAdminPodGrandparents(db, sibling.user.id, hhEast.id), true);

  // Not North phone book
  assert.equal(canViewerSeeLine(db, sibling.user.id, quinn.id), false);

  // Sibling adds their kid on East — same-Pod call with Alex; no North.
  const cousin = addLine(db, hhEast.id, sibling.user.id, "Cousin", "softphone", { mode: "child" });
  updateLine(
    db,
    hhEast.id,
    cousin.id,
    { mode: "child", child_label: "Cousin" },
    { actorUserId: sibling.user.id }
  );
  assert.equal(canManageChild(db, sibling.user.id, cousin.id), true);
  assert.equal(canCall(db, cousin.id, alex.id).ok, true);
  assert.equal(canCall(db, cousin.id, quinn.id).ok, false);
  assert.equal(canViewerSeeLine(db, cameron.user.id, cousin.id), true);

  // Friend on Cameron’s private Circle does not become sibling directory via Pod allowlist.
  const friend = registerParent(db, "Friend", { username: "friendsibinv", password: "password1" });
  const hhFriend = createHousehold(db, friend.user.id, "Friend house");
  const friendLine = addLine(db, hhFriend.id, friend.user.id, "Friend phone");
  const cameronSphere = ensureSphereForParent(db, cameron.user.id);
  addLineToSphere(db, cameronSphere.id, friendLine.id, cameron.user.id);
  assert.equal(canViewerSeeLine(db, sibling.user.id, friendLine.id), false);

  db.close();
});

test("parent dialpad approve does not put other adults on the kid Circle", () => {
  const db = tmpDb();
  const cameron = registerParent(db, "Cameron", { username: "pddcameron", password: "password1" });
  const loner = registerParent(db, "Loner", { username: "pddloner", password: "password1" });
  const ken = registerParent(db, "Ken", { username: "pddken", password: "password1" });

  const hhEast = createHousehold(db, cameron.user.id, "East");
  const cameronLine = addLine(db, hhEast.id, cameron.user.id, "Cameron phone");
  const alex = addLine(db, hhEast.id, cameron.user.id, "Alex", "softphone", { mode: "child" });
  updateLine(db, hhEast.id, alex.id, { mode: "child", child_label: "Alex" }, { actorUserId: cameron.user.id });

  const hhLoner = createHousehold(db, loner.user.id, "Loner house");
  const lonerLine = addLine(db, hhLoner.id, loner.user.id, "Loner phone");

  const hhKen = createHousehold(db, ken.user.id, "Shorts");
  const kenLine = addLine(db, hhKen.id, ken.user.id, "Ken phone");
  const owen = addLine(db, hhKen.id, ken.user.id, "Owen", "softphone", { mode: "child" });
  updateLine(db, hhKen.id, owen.id, { mode: "child", child_label: "Owen" }, { actorUserId: ken.user.id });

  // Parent adds a childless adult to their dialpad — parent pad only.
  addAllowlist(db, hhEast.id, lonerLine.id, "Loner", { actorUserId: cameron.user.id });
  addAllowlist(db, hhLoner.id, cameronLine.id, "Cameron", { actorUserId: loner.user.id });
  assert.equal(allowlistTargetVisibleOnKidCircle(db, lonerLine.id, alex.id), false);
  assert.equal(canCall(db, cameronLine.id, lonerLine.id).ok, true, "parents may still call");
  assert.equal(canCall(db, alex.id, lonerLine.id).ok, false, "Alex must not inherit Loner");
  assert.equal(canCall(db, lonerLine.id, alex.id).ok, false, "Loner must not call Alex");

  const snap = householdSnapshot(db, cameron.user.id);
  const east = snap.households.find((h) => h.id === hhEast.id);
  const lonerEntry = east?.allowlist.find((a) => a.target_line_id === lonerLine.id);
  assert.equal(lonerEntry?.kid_circle, false);

  // Parent adds another parent who has kids — adult stays off kid Circle; their kids fan on.
  addAllowlist(db, hhEast.id, kenLine.id, "Ken", { actorUserId: cameron.user.id });
  addAllowlist(db, hhKen.id, cameronLine.id, "Cameron", { actorUserId: ken.user.id });
  assert.equal(lineHasChildAccounts(db, kenLine.id), true);
  assert.equal(
    allowlistTargetVisibleOnKidCircle(db, kenLine.id, alex.id),
    false,
    "Ken is not Alex’s parent — stay off her Circle"
  );
  assert.equal(allowlistTargetVisibleOnKidCircle(db, owen.id, alex.id), true);
  assert.equal(allowlistTargetVisibleOnKidCircle(db, cameronLine.id, alex.id), true, "Dad stays");
  const owenOnEast = db
    .prepare(`SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
    .get(hhEast.id, owen.id);
  assert.ok(owenOnEast, "Ken’s kid must fan onto East book for Circles");
  assert.equal(canCall(db, alex.id, kenLine.id).ok, false, "Alex must not dial Ken");
  assert.equal(canCall(db, alex.id, owen.id).ok, true, "Alex may dial Owen after fan-out + mutual");

  // Grandparent: provision puts Grandma on the kid book; parent dialpad must not fan GP kids.
  const gp = provisionGrandparent(db, cameron.user.id, hhEast.id, {
    displayName: "Grandma East",
    username: "pddgrandma",
    password: "password1!",
    label: "Grandma",
    kidLineIds: [alex.id],
  });
  assert.equal(isGrandparentPeerLine(db, gp.line.id), true);
  assert.equal(allowlistTargetVisibleOnKidCircle(db, gp.line.id, alex.id), true, "provisioned GP stays");
  assert.equal(canCall(db, alex.id, gp.line.id).ok, true);

  // Parent dialpad adults must never land on Grandma’s book.
  assert.equal(canViewerSeeLine(db, gp.line.owner_user_id, lonerLine.id), false);
  assert.equal(canViewerSeeLine(db, gp.line.owner_user_id, kenLine.id), false);
  assert.equal(canCall(db, gp.line.id, kenLine.id).ok, false);
  assert.equal(canCall(db, gp.line.id, lonerLine.id).ok, false);
  householdSnapshot(db, gp.line.owner_user_id);
  const gpAl = db
    .prepare(`SELECT target_line_id FROM allowlist WHERE household_id = ?`)
    .all(gp.household.id) as { target_line_id: string }[];
  assert.equal(
    gpAl.some((r) => r.target_line_id === kenLine.id || r.target_line_id === lonerLine.id),
    false,
    "GP private book stays grandchildren-only"
  );

  db.close();
});
