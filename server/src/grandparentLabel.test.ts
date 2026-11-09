import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  adultFacingGrandparentLabel,
  grandparentLabelsFromHints,
  inferGrandparentHonorific,
  kidFacingGrandparentLabel,
  lookupGrandparentPadLabels,
} from "./grandparentLabel.js";
import { addLine, attachExistingUserAsGrandparent, createHousehold, registerParent } from "./api.js";
import { openDb } from "./db.js";

test("inferGrandparentHonorific: Grandma vs Grandpa from name or username", () => {
  assert.equal(inferGrandparentHonorific("Avery", "Avery", "grandmanorth"), "Grandma");
  assert.equal(inferGrandparentHonorific("Nana"), "Grandma");
  assert.equal(inferGrandparentHonorific("Bob", "", "grandpanorth"), "Grandpa");
  assert.equal(inferGrandparentHonorific("Grandpa Joe"), "Grandpa");
  assert.equal(inferGrandparentHonorific("Avery"), "Grandma");
  assert.equal(inferGrandparentHonorific("Parker", "Dad", "parker"), "Grandpa");
  assert.equal(inferGrandparentHonorific("Sloan", "Mom", "sloan"), "Grandma");
});

test("kid-facing is Grandma/Grandpa + Pod; adults get the real name", () => {
  const avery = grandparentLabelsFromHints({
    podName: "North",
    displayName: "Avery",
    displayLabel: "Avery",
    username: "grandmanorth",
  });
  assert.equal(avery.kid, "Grandma North");
  assert.equal(avery.adult, "Avery");
  assert.equal(avery.honorific, "Grandma");

  const grandpa = grandparentLabelsFromHints({
    podName: "North",
    displayName: "Joe",
    displayLabel: "Grandpa",
    username: "grandpanorth",
  });
  assert.equal(grandpa.kid, "Grandpa North");
  assert.equal(grandpa.adult, "Joe");

  const sloan = grandparentLabelsFromHints({
    podName: "East",
    displayName: "Grandma East",
    displayLabel: "Grandma",
    username: "sloan",
  });
  assert.equal(sloan.kid, "Grandma East");
  assert.equal(sloan.adult, "Sloan");
  const parker = grandparentLabelsFromHints({
    podName: "East",
    displayName: "Parker",
    displayLabel: "Dad",
    username: "parker",
    kidNickname: "Grandpa",
  });
  assert.equal(parker.kid, "Grandpa East");
  assert.equal(parker.adult, "Parker");
  assert.equal(parker.honorific, "Grandpa");

  const parkerDefault = grandparentLabelsFromHints({
    podName: "East",
    displayName: "Parker",
    displayLabel: "Dad",
    username: "parker",
  });
  assert.equal(parkerDefault.kid, "Grandpa East");
  assert.equal(parkerDefault.adult, "Parker");

  assert.equal(kidFacingGrandparentLabel("East", "Nana"), "Nana East");
  assert.equal(kidFacingGrandparentLabel("North", "Meemaw"), "Meemaw North");
  assert.equal(kidFacingGrandparentLabel("East", "", "Grandpa East", "parker"), "Grandpa East");
  assert.equal(kidFacingGrandparentLabel("North", "  ", "Avery", "grandmanorth"), "Grandma North");
  assert.equal(adultFacingGrandparentLabel("Avery's phone", "Grandma"), "Avery");
  assert.equal(adultFacingGrandparentLabel("Grandma", "Avery"), "Avery");
});

test("lookupGrandparentPadLabels uses the Pod household name", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-gp-label-"));
  const db = openDb(path.join(dir, "t.db"));
  const casey = registerParent(db, "Casey", { username: "caseylbl", password: "password1" });
  const avery = registerParent(db, "Avery", { username: "grandmanorth", password: "password1!" });
  const hhNorth = createHousehold(db, casey.user.id, "North");
  addLine(db, hhNorth.id, casey.user.id, "Casey phone");
  const hhGp = createHousehold(db, avery.user.id, "Family");
  const gpLine = addLine(db, hhGp.id, avery.user.id, "Avery's phone");
  attachExistingUserAsGrandparent(db, casey.user.id, hhNorth.id, avery.user.id, {
    displayName: "Avery",
    label: "Avery",
  });
  const labels = lookupGrandparentPadLabels(db, gpLine.id);
  assert.ok(labels);
  assert.equal(labels.kid, "Grandma North");
  assert.equal(labels.adult, "Avery");
  db.prepare(`UPDATE provisioned_relatives SET kid_nickname = ? WHERE relative_line_id = ?`).run(
    "Meemaw",
    gpLine.id
  );
  assert.equal(lookupGrandparentPadLabels(db, gpLine.id)?.kid, "Meemaw North");
  db.prepare(`UPDATE provisioned_relatives SET kid_nickname = ? WHERE relative_line_id = ?`).run(
    "",
    gpLine.id
  );
  assert.equal(lookupGrandparentPadLabels(db, gpLine.id)?.kid, "Grandma North");
  assert.equal(lookupGrandparentPadLabels(db, "line_not_gp"), null);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
