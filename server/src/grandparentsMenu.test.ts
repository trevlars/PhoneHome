import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "./db.js";
import {
  addAllowlist,
  addLine,
  createHousehold,
  ensureGuardian,
  ensureHouseholdParentMember,
  householdSnapshot,
  podsForKid,
  provisionGrandparent,
  registerParent,
  resolveAtaDial,
  updateLine,
  upsertAtaDevice,
} from "./api.js";
import {
  buildGrandparentsMenuPrompt,
  ensureKidMultiPodGrandparentAllowlists,
  listKidGrandparentMenuChoices,
  syncGrandparentDialCollapse,
} from "./grandparentsMenu.js";
import { kidFacingGrandparentLabel } from "./grandparentLabel.js";

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ph-gp-menu-"));
  const db = openDb(path.join(dir, "t.db"));
  return { dir, db };
}

test("kid-facing labels are nickname + Pod, never Parker", () => {
  assert.equal(kidFacingGrandparentLabel("East", "Papa", "Parker"), "Papa East");
  assert.equal(kidFacingGrandparentLabel("North", "Grandma", "Avery"), "Grandma North");
  assert.equal(kidFacingGrandparentLabel("East", "Gramma", "Sloan"), "Gramma East");
});

test("first GP keeps a direct speed-dial; second converts that key to a menu", () => {
  const { dir, db } = tmpDb();
  const mom = registerParent(db, "Cameron", { username: "gpmenudad", password: "password1" });
  const hh = createHousehold(db, mom.user.id, "East");
  const kid = addLine(db, hh.id, mom.user.id, "Alex + Riley");
  updateLine(db, hh.id, kid.id, { mode: "child", child_label: "Alex + Riley" }, { actorUserId: mom.user.id });
  db.prepare(
    `UPDATE households SET schedule_preset = 'open', quiet_start = NULL, quiet_end = NULL, dnd = 0, kill_switch = 0 WHERE id = ?`
  ).run(hh.id);
  upsertAtaDevice(
    db,
    kid.id,
    { sip_extension: "2101", sip_password: "example-sip-pass", sip_server: "192.168.2.105" },
    { allowSipCredentialOverride: true }
  );

  const sloan = provisionGrandparent(db, mom.user.id, hh.id, {
    displayName: "Sloan",
    username: "gpsloan",
    password: "password1",
    kidNickname: "Gramma",
    kidLineIds: [kid.id],
  });
  const slotAfterFirst = db
    .prepare(`SELECT speed_dial FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
    .get(hh.id, sloan.line.id) as { speed_dial: number };
  assert.ok(slotAfterFirst.speed_dial >= 2 && slotAfterFirst.speed_dial <= 9);

  const direct = resolveAtaDial(db, "2101", String(slotAfterFirst.speed_dial));
  assert.equal(direct.ok, true);
  assert.equal("grandparentsMenu" in direct && (direct as { grandparentsMenu?: boolean }).grandparentsMenu, false);
  if (direct.ok && !("treeHouse" in direct && direct.treeHouse) && !("grandparentsMenu" in direct && direct.grandparentsMenu)) {
    assert.equal(direct.toLineId, sloan.line.id);
    assert.equal(direct.toLabel, "Gramma East");
  }

  const parker = provisionGrandparent(db, mom.user.id, hh.id, {
    displayName: "Parker",
    username: "gpparker",
    password: "password1",
    kidNickname: "Papa",
    kidLineIds: [kid.id],
  });
  void parker;
  const sync = syncGrandparentDialCollapse(db, hh.id);
  assert.equal(sync.mode, "menu");
  assert.equal(sync.slot, slotAfterFirst.speed_dial);

  const parkerSlot = db
    .prepare(`SELECT speed_dial FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
    .get(hh.id, parker.line.id) as { speed_dial: number | null };
  assert.equal(parkerSlot.speed_dial, null, "second GP must leave the first key as the only pad button");

  const menu = resolveAtaDial(db, "2101", String(slotAfterFirst.speed_dial));
  assert.equal(menu.ok, true);
  assert.ok(menu.ok && "grandparentsMenu" in menu && menu.grandparentsMenu);
  if (menu.ok && "grandparentsMenu" in menu && menu.grandparentsMenu) {
    assert.match(menu.prompt, /Gramma East/i);
    assert.match(menu.prompt, /Papa East/i);
    assert.equal(menu.choices.length, 2);
    assert.deepEqual(
      menu.choices.map((c) => c.toLabel).sort(),
      ["Gramma East", "Papa East"].sort()
    );
  }

  const choices = listKidGrandparentMenuChoices(db, kid.id);
  assert.equal(buildGrandparentsMenuPrompt(choices), menu.ok && "prompt" in menu ? menu.prompt : "");

  // Drop back to one GP → direct call again on the same key.
  db.prepare(`DELETE FROM allowlist WHERE household_id = ? AND target_line_id = ?`).run(hh.id, parker.line.id);
  db.prepare(`DELETE FROM allowlist WHERE household_id = ? AND target_line_id = ?`).run(
    parker.household.id,
    kid.id
  );
  db.prepare(
    `DELETE FROM grandparent_setup_tokens WHERE provisioned_relative_id IN
      (SELECT id FROM provisioned_relatives WHERE relative_line_id = ?)`
  ).run(parker.line.id);
  db.prepare(`DELETE FROM provisioned_relatives WHERE relative_line_id = ?`).run(parker.line.id);
  const back = syncGrandparentDialCollapse(db, hh.id);
  assert.equal(back.mode, "direct");
  assert.equal(back.slot, slotAfterFirst.speed_dial);
  const again = resolveAtaDial(db, "2101", String(slotAfterFirst.speed_dial));
  assert.equal(again.ok, true);
  assert.equal("grandparentsMenu" in again && (again as { grandparentsMenu?: boolean }).grandparentsMenu, false);

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("three grandparents speak a full press-digit IVR prompt", () => {
  const { dir, db } = tmpDb();
  const mom = registerParent(db, "Cameron", { username: "gpmenuthree", password: "password1" });
  const hh = createHousehold(db, mom.user.id, "East");
  const kid = addLine(db, hh.id, mom.user.id, "Alex + Riley");
  updateLine(db, hh.id, kid.id, { mode: "child", child_label: "Alex + Riley" }, { actorUserId: mom.user.id });
  db.prepare(
    `UPDATE households SET schedule_preset = 'open', quiet_start = NULL, quiet_end = NULL, dnd = 0, kill_switch = 0 WHERE id = ?`
  ).run(hh.id);
  upsertAtaDevice(
    db,
    kid.id,
    { sip_extension: "2001", sip_password: "example-sip-pass", sip_server: "192.168.2.105" },
    { allowSipCredentialOverride: true }
  );

  provisionGrandparent(db, mom.user.id, hh.id, {
    displayName: "Sloan",
    username: "gpsloan3",
    password: "password1",
    kidNickname: "Gramma",
    kidLineIds: [kid.id],
  });
  provisionGrandparent(db, mom.user.id, hh.id, {
    displayName: "Parker",
    username: "gpparker3",
    password: "password1",
    kidNickname: "Papa",
    kidLineIds: [kid.id],
  });

  // North Pod GP also reachable from East kid (mutual allowlist).
  const northMom = registerParent(db, "Jordan", { username: "gpmenukiby", password: "password1" });
  const northHh = createHousehold(db, northMom.user.id, "North");
  const northKid = addLine(db, northHh.id, northMom.user.id, "Alex + Riley");
  updateLine(
    db,
    northHh.id,
    northKid.id,
    { mode: "child", child_label: "Alex + Riley" },
    { actorUserId: northMom.user.id }
  );
  const avery = provisionGrandparent(db, northMom.user.id, northHh.id, {
    displayName: "Avery",
    username: "gpavery3",
    password: "password1",
    kidNickname: "Grandma",
    kidLineIds: [northKid.id],
  });
  addAllowlist(db, hh.id, avery.line.id, "Avery", { actorUserId: mom.user.id, favorite: true });
  const gpUserId = (
    db
      .prepare(`SELECT relative_user_id AS id FROM provisioned_relatives WHERE relative_line_id = ?`)
      .get(avery.line.id) as { id: string }
  ).id;
  addAllowlist(db, avery.household.id, kid.id, "Alex + Riley", {
    actorUserId: gpUserId,
    favorite: true,
  });

  const sync = syncGrandparentDialCollapse(db, hh.id);
  assert.equal(sync.mode, "menu");
  assert.ok(sync.slot != null);

  const menu = resolveAtaDial(db, "2001", String(sync.slot));
  assert.ok(menu.ok && "grandparentsMenu" in menu && menu.grandparentsMenu);
  if (menu.ok && "grandparentsMenu" in menu && menu.grandparentsMenu) {
    assert.equal(
      menu.prompt,
      "To call Gramma East, press 1. To call Grandma North, press 2. To call Papa East, press 3."
    );
    assert.equal(menu.choices.length, 3);
    assert.deepEqual(
      menu.choices.map((c) => ({ digit: c.digit, label: c.toLabel })),
      [
        { digit: 1, label: "Gramma East" },
        { digit: 2, label: "Grandma North" },
        { digit: 3, label: "Papa East" },
      ]
    );
  }

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("menu membership is only grandparents the kid can call", () => {
  const { dir, db } = tmpDb();
  const mom = registerParent(db, "Jordan", { username: "gpmenumom", password: "password1" });
  const hh = createHousehold(db, mom.user.id, "North");
  const kid = addLine(db, hh.id, mom.user.id, "Alex + Riley");
  updateLine(db, hh.id, kid.id, { mode: "child", child_label: "Alex + Riley" }, { actorUserId: mom.user.id });

  const avery = provisionGrandparent(db, mom.user.id, hh.id, {
    displayName: "Avery",
    username: "gpavery",
    password: "password1",
    kidNickname: "Grandma",
    kidLineIds: [kid.id],
  });
  const other = registerParent(db, "OtherGP", { username: "gpother", password: "password1" });
  const oh = createHousehold(db, other.user.id, "Other");
  const otherLine = addLine(db, oh.id, other.user.id, "Other GP");
  // Polluted allowlist on kid house without mutual return path.
  addAllowlist(db, hh.id, otherLine.id, "Stranger", { actorUserId: mom.user.id });

  const choices = listKidGrandparentMenuChoices(db, kid.id);
  assert.equal(choices.length, 1);
  assert.equal(choices[0].lineId, avery.line.id);
  assert.equal(choices[0].label, "Grandma North");

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("multi-Pod kid pad includes grandparents from every Pod (East + North)", () => {
  const { dir, db } = tmpDb();

  const cameron = registerParent(db, "Cameron", { username: "mpgpcameron", password: "password1" });
  const jordan = registerParent(db, "Jordan", { username: "mpgpjordan", password: "password1" });
  const casey = registerParent(db, "Casey", { username: "mpgpcasey", password: "password1" });

  const hhEast = createHousehold(db, cameron.user.id, "East");
  const alex = addLine(db, hhEast.id, cameron.user.id, "Alex + Riley");
  updateLine(
    db,
    hhEast.id,
    alex.id,
    { mode: "child", child_label: "Alex + Riley" },
    { actorUserId: cameron.user.id }
  );
  ensureGuardian(db, alex.id, jordan.user.id);

  const sloan = provisionGrandparent(db, cameron.user.id, hhEast.id, {
    displayName: "Sloan",
    username: "mpgpsloan",
    password: "password1",
    kidNickname: "Gramma",
    kidLineIds: [alex.id],
  });
  const parker = provisionGrandparent(db, cameron.user.id, hhEast.id, {
    displayName: "Parker",
    username: "mpgpparker",
    password: "password1",
    kidNickname: "Papa",
    kidLineIds: [alex.id],
  });

  const hhNorth = createHousehold(db, casey.user.id, "North");
  ensureHouseholdParentMember(db, hhNorth.id, jordan.user.id);
  const avery = provisionGrandparent(db, casey.user.id, hhNorth.id, {
    displayName: "Avery",
    username: "mpgpavery",
    password: "password1",
    kidNickname: "Grandma",
    kidLineIds: [],
  });
  assert.ok(podsForKid(db, alex.id).includes(hhNorth.id));
  assert.ok(podsForKid(db, alex.id).includes(hhEast.id));

  // Cross-Pod GP sync is explicit (not on /api/me).
  ensureKidMultiPodGrandparentAllowlists(
    db,
    alex.id,
    podsForKid(db, alex.id),
    (hhId, targetId, label) => {
      const existing = db
        .prepare(`SELECT id FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
        .get(hhId, targetId);
      if (existing) return;
      db.prepare(
        `INSERT INTO allowlist (id, household_id, target_line_id, label, speed_dial, favorite, always_allow, created_at)
         VALUES (?, ?, ?, ?, NULL, 1, 0, ?)`
      ).run(`al_${Math.random().toString(36).slice(2, 10)}`, hhId, targetId, label, new Date().toISOString());
    }
  );

  const choices = listKidGrandparentMenuChoices(db, alex.id);
  const ids = new Set(choices.map((c) => c.lineId));
  assert.ok(ids.has(sloan.line.id), "Sloan");
  assert.ok(ids.has(parker.line.id), "Parker");
  assert.ok(ids.has(avery.line.id), "Avery from North");
  assert.ok(choices.length >= 3, `expected 3+ GPs, got ${choices.length}`);

  const sync = syncGrandparentDialCollapse(db, hhEast.id);
  assert.equal(sync.mode, "menu");

  // GP /api/me must not wipe the kids’ cross-Pod GP book on the family Pod.
  const before = db
    .prepare(`SELECT COUNT(*) AS n FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
    .get(hhEast.id, avery.line.id) as { n: number };
  assert.ok(before.n >= 1, "Avery on East allowlist before GP snapshot");
  householdSnapshot(db, sloan.line.owner_user_id!);
  householdSnapshot(db, parker.line.owner_user_id!);
  householdSnapshot(db, avery.line.owner_user_id!);
  const after = db
    .prepare(`SELECT COUNT(*) AS n FROM allowlist WHERE household_id = ? AND target_line_id = ?`)
    .get(hhEast.id, avery.line.id) as { n: number };
  assert.equal(after.n, before.n, "GP snapshot must not delete Avery from East");
  assert.ok(
    listKidGrandparentMenuChoices(db, alex.id).some((c) => c.lineId === avery.line.id),
    "Avery still on Alex menu after GP snapshot"
  );

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
