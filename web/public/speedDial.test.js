import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_PARENT_SLOT,
  SECONDARY_PARENT_SLOT,
  TREEHOUSE_SLOT,
  assignedSpeedDialSlot,
  allowlistLooksLikeCoParent,
  collapseGrandparentsForKidPad,
  dedupeSpeedDialTargets,
  grandparentPadEntries,
  isGrandparentKidContact,
  isLockedSpeedDialContact,
  parentTitlePadLabel,
  reservedPadTargetIds,
  reservedSpeedDialLeftover,
  speedDialForExternalContact,
  secondaryParentOwnsDial2,
  splitSharedGrandchildNames,
  withExternalSpeedDial,
} from "./speedDial.js";

test("assignedSpeedDialSlot does not treat null as TreeHouse 0", () => {
  assert.equal(Number(null), TREEHOUSE_SLOT);
  assert.equal(assignedSpeedDialSlot(null), null);
  assert.equal(assignedSpeedDialSlot(""), null);
  assert.equal(assignedSpeedDialSlot(undefined), null);
  assert.equal(assignedSpeedDialSlot(0), null);
  assert.equal(assignedSpeedDialSlot(1), null);
  assert.equal(assignedSpeedDialSlot(5), 5);
  assert.equal(assignedSpeedDialSlot("7"), 7);
});

test("reservedSpeedDialLeftover remaps 0/1 only, not a cleared contact", () => {
  assert.equal(reservedSpeedDialLeftover(null), null);
  assert.equal(reservedSpeedDialLeftover(""), null);
  assert.equal(reservedSpeedDialLeftover(0), TREEHOUSE_SLOT);
  assert.equal(reservedSpeedDialLeftover(1), ADMIN_PARENT_SLOT);
  assert.equal(reservedSpeedDialLeftover(2), null);
});

test("cleared cousin stays off a kid pad (live Quinns Dads bug)", () => {
  const taken = new Set([TREEHOUSE_SLOT, ADMIN_PARENT_SLOT, SECONDARY_PARENT_SLOT, 3, 4, 5, 9]);
  const contactMin = 3;
  const opts = { taken, contactMin, secondaryReserved: true, keepAssignedEvenIfTaken: true };
  for (const n of [3, 4, 5, 9]) {
    // Pre-mark assigned contacts the way the kid pad does.
    taken.add(n);
  }
  const quinnDad = withExternalSpeedDial({ id: "al_quinn_dad", speed_dial: null, label: "Quinns Dads" }, opts);
  const quinnKid = withExternalSpeedDial({ id: "al_quinn", speed_dial: 5, label: "Quinn" }, opts);
  const leftover = withExternalSpeedDial({ id: "al_old", speed_dial: 0, label: "Old Home" }, opts);

  assert.equal(quinnDad.speed_dial, null, "null speed_dial must not reclaim a pad key");
  assert.equal(quinnKid.speed_dial, 5);
  assert.equal(leftover.speed_dial, 6, "real leftover 0 remaps to the next free key");
});

test("parent pad does not auto-place unassigned contacts either", () => {
  const taken = new Set([TREEHOUSE_SLOT, ADMIN_PARENT_SLOT, SECONDARY_PARENT_SLOT]);
  const speed = speedDialForExternalContact(
    { id: "al_quinn_dad", speed_dial: null },
    { taken, contactMin: 3, secondaryReserved: true, keepAssignedEvenIfTaken: false }
  );
  assert.equal(speed, null);
  assert.equal(taken.has(3), false);
});

test("Jordan parent pad reserves Alex identity, keeps Casey, and final-dedupes targets", () => {
  const reserved = reservedPadTargetIds({
    parentPad: true,
    activeLineId: "line_jordan",
    primaryChildId: "line_alex_riley",
    adminParentId: "line_casey",
    secondaryParentId: null,
  });
  assert.equal(reserved.has("line_alex_riley"), true);
  assert.equal(reserved.has("line_casey"), false, "adult parent pad must not hide the Pod admin");

  const candidates = [
    { id: "al_alex", target_line_id: "line_alex_riley", label: "Alex + Riley", speed_dial: 2 },
    { id: "hh-line-avery", target_line_id: "line_avery", label: "Mom", speed_dial: 2 },
    { id: "hh-line-drew", target_line_id: "line_drew", label: "Drew", speed_dial: 3 },
    { id: "hh-line-casey", target_line_id: "line_casey", label: "Casey", speed_dial: 4 },
  ].filter((entry) => !reserved.has(entry.target_line_id));
  candidates.unshift({
    id: "hh-home-1-line_alex_riley",
    target_line_id: "line_alex_riley",
    label: "Alex + Riley",
    speed_dial: ADMIN_PARENT_SLOT,
    home_child: true,
    locked_slot: true,
  });

  const pad = dedupeSpeedDialTargets(candidates);
  assert.equal(pad.filter((entry) => entry.target_line_id === "line_alex_riley").length, 1);
  assert.equal(
    pad.find((entry) => entry.target_line_id === "line_alex_riley")?.speed_dial,
    ADMIN_PARENT_SLOT
  );
  assert.ok(pad.some((entry) => entry.target_line_id === "line_casey"));
});

test("final target dedupe prefers a locked parent tile over a movable duplicate", () => {
  const pad = dedupeSpeedDialTargets([
    { id: "al_casey", target_line_id: "line_casey", speed_dial: 5 },
    {
      id: "hh-secondary-line_casey",
      target_line_id: "line_casey",
      speed_dial: SECONDARY_PARENT_SLOT,
      secondary_parent: true,
      locked_slot: true,
    },
  ]);
  assert.equal(pad.length, 1);
  assert.equal(pad[0].speed_dial, SECONDARY_PARENT_SLOT);
  assert.equal(pad[0].locked_slot, true);
});

test("locked parent/child tiles are not removable", () => {
  assert.equal(isLockedSpeedDialContact({ id: "hh-secondary-mom", secondary_parent: true, locked_slot: true }), true);
  assert.equal(isLockedSpeedDialContact({ id: "hh-home-1-dad", home_parent: true, locked_slot: true }), true);
  assert.equal(isLockedSpeedDialContact({ id: "gp-kid-al1-alex", gp_split_kid: true }), true);
  assert.equal(isLockedSpeedDialContact({ id: "al_quinn_dad", label: "Quinns Dads", speed_dial: null }), false);
});

test("splitSharedGrandchildNames turns Alex + Riley into two names", () => {
  assert.deepEqual(splitSharedGrandchildNames("Alex + Riley"), ["Alex", "Riley"]);
  assert.deepEqual(splitSharedGrandchildNames("Alex + Riley's phone"), ["Alex", "Riley"]);
  assert.deepEqual(splitSharedGrandchildNames("Sam & Blake"), ["Sam", "Blake"]);
  assert.equal(splitSharedGrandchildNames("Alex"), null);
  assert.equal(splitSharedGrandchildNames("Cameron"), null);
});

test("parentTitlePadLabel is Mom/Dad only", () => {
  assert.equal(parentTitlePadLabel("dad"), "Dad");
  assert.equal(parentTitlePadLabel("mom"), "Mom");
  assert.equal(parentTitlePadLabel("Cameron"), null);
});

test("grandparent pad: grandchild on 1, then their Pod parent by name (never “Dad”)", () => {
  const pad = grandparentPadEntries([
    { id: "al_cameron", target_line_id: "line_t", label: "Cameron's phone", speed_dial: 2, mode: "parent", parent_title: "dad" },
    { id: "al_kids", target_line_id: "line_gj", label: "Alex + Riley", speed_dial: 3, mode: "child" },
  ]);
  assert.equal(pad.length, 2);
  assert.equal(pad[0].label, "Alex + Riley");
  assert.equal(pad[0].speed_dial, 1);
  assert.equal(pad[0].home_grandchild, true);
  assert.equal(pad[1].label, "Cameron");
  assert.equal(pad[1].speed_dial, 2);
  assert.equal(pad.some((c) => c.label === "Dad"), false);
});

test("secondaryParentOwnsDial2 yields pad 2 to parent-placed kid contact", () => {
  const hh = {
    allowlist: [
      {
        target_line_id: "line_gj",
        label: "Alex + Riley",
        speed_dial: 2,
        mode: "child",
      },
    ],
  };
  assert.equal(secondaryParentOwnsDial2(hh, "line_jordan", "line_casey"), false);
  assert.equal(secondaryParentOwnsDial2(hh, "line_gj", "line_casey"), true);
  assert.equal(secondaryParentOwnsDial2({ allowlist: [] }, "line_jordan", "line_casey"), true);
});

test("live Parker book: analog at stored 2 paints kids on 1, no Dad", () => {
  const analog = {
    id: "al_lPR7SuqoE1",
    target_line_id: "line_example",
    label: "Alex + Riley",
    speed_dial: 2,
    target_mode: "child",
    mode: "child",
  };
  const dad = {
    id: "al_GX35eZZYrN",
    target_line_id: "line_example_to",
    label: "Dad",
    speed_dial: 3,
    target_mode: "parent",
    parent_title: "dad",
  };
  assert.equal(allowlistLooksLikeCoParent(analog), false, "shared kid line on 2 is not a co-parent");
  assert.equal(isGrandparentKidContact(analog), true);
  const pad = grandparentPadEntries([analog, dad]);
  assert.equal(pad[0].label, "Alex + Riley");
  assert.equal(pad[0].speed_dial, 1);
  assert.equal(pad.some((c) => c.label === "Dad"), false, "adults by name, not Mom/Dad");
});

test("kid pad collapses 2+ grandparents onto one Grandparents menu key", () => {
  const one = collapseGrandparentsForKidPad([
    {
      id: "al_r",
      target_line_id: "line_r",
      label: "Sloan",
      kid_label: "Gramma East",
      speed_dial: 4,
      is_grandparent: true,
      created_at: "2026-01-01",
    },
  ]);
  assert.equal(one.length, 1);
  assert.equal(one[0].label, "Gramma East");
  assert.equal(one[0].grandparents_menu, undefined);

  const two = collapseGrandparentsForKidPad([
    {
      id: "al_r",
      target_line_id: "line_r",
      label: "Sloan",
      kid_label: "Gramma East",
      speed_dial: 4,
      is_grandparent: true,
      created_at: "2026-01-01",
    },
    {
      id: "al_c",
      target_line_id: "line_c",
      label: "Parker",
      kid_label: "Papa East",
      speed_dial: 5,
      is_grandparent: true,
      created_at: "2026-01-02",
    },
    {
      id: "al_friend",
      target_line_id: "line_f",
      label: "Friend",
      speed_dial: 6,
    },
  ]);
  assert.equal(two.length, 2);
  const menu = two.find((c) => c.grandparents_menu);
  assert.ok(menu);
  assert.equal(menu.label, "Grandparents");
  assert.equal(menu.speed_dial, 4);
  assert.equal(menu.menu_choices.length, 2);
  assert.ok(two.some((c) => c.id === "al_friend"));
  assert.equal(two.some((c) => c.id === "al_c"), false);
});

test("off-pad GP (null speed_dial) still builds Grandparents menu — Avery+Ellis", () => {
  const pad = collapseGrandparentsForKidPad([
    {
      id: "al_mel",
      target_line_id: "line_mel",
      label: "Avery",
      kid_label: "Grandma North",
      speed_dial: 4,
      is_grandparent: true,
      grandparents_menu: true,
      created_at: "2026-09-13",
    },
    {
      id: "al_lam",
      target_line_id: "line_lam",
      label: "Ellis",
      kid_label: "Grandpa North",
      speed_dial: null,
      is_grandparent: true,
      created_at: "2026-09-25",
    },
  ]);
  const menu = pad.find((c) => c.grandparents_menu);
  assert.ok(menu, "expected Grandparents menu tile");
  assert.equal(menu.label, "Grandparents");
  assert.equal(menu.speed_dial, 4);
  assert.equal(menu.menu_choices.length, 2);
  assert.ok(menu.menu_choices.some((c) => c.label === "Grandma North"));
  assert.ok(menu.menu_choices.some((c) => c.label === "Grandpa North"));
  assert.equal(pad.some((c) => c.id === "al_lam"), false);
});

test("stale grandparents_menu on a lone GP is cleared to direct nickname", () => {
  const pad = collapseGrandparentsForKidPad([
    {
      id: "al_mel",
      target_line_id: "line_mel",
      label: "Avery",
      kid_label: "Grandma North",
      speed_dial: 4,
      is_grandparent: true,
      grandparents_menu: true,
    },
  ]);
  assert.equal(pad.length, 1);
  assert.equal(pad[0].label, "Grandma North");
  assert.equal(pad[0].grandparents_menu, undefined);
});

test("Alex+Riley keep dial 2 when co-parent slot is not reserved", () => {
  const taken = new Set([TREEHOUSE_SLOT, ADMIN_PARENT_SLOT]);
  const kids = {
    speed_dial: SECONDARY_PARENT_SLOT,
    label: "Alex + Riley",
    mode: "child",
  };
  assert.equal(isGrandparentKidContact(kids), true);
  assert.equal(allowlistLooksLikeCoParent(kids), false);
  const speed = speedDialForExternalContact(kids, {
    taken,
    contactMin: 2,
    secondaryReserved: false,
    keepAssignedEvenIfTaken: true,
  });
  assert.equal(speed, SECONDARY_PARENT_SLOT);
});
