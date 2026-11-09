import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  managedRelativeIdFromPickerValue,
  managedRelativePickerEntries,
  managedRelativePickerValue,
  profilePickerSelection,
} from "./profilePicker.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(path.join(here, "app.js"), "utf8");

test("Jordan picker adds separate Ellis preview once and dedupes merged Avery", () => {
  const lines = [
    { id: "line_jordan", owner_user_id: "user_jordan", mode: "parent" },
    { id: "line_avery", owner_user_id: "user_avery", mode: "grandparent" },
  ];
  const households = [
    {
      id: "hh_north",
      provisioned_relatives: [
        {
          id: "prov_ellis",
          line_id: "line_ellis",
          display_name: "Ellis",
        },
        {
          id: "prov_avery",
          line_id: "line_avery",
          display_name: "Avery",
        },
      ],
    },
    {
      id: "hh_guardian_copy",
      provisioned_relatives: [
        {
          id: "prov_ellis",
          line_id: "line_ellis",
          display_name: "Ellis",
        },
      ],
    },
  ];

  const entries = managedRelativePickerEntries(lines, households);
  assert.deepEqual(entries.map((entry) => entry.relativeId), ["prov_ellis"]);
  assert.equal(entries[0].label, "Ellis · managed grandparent settings");
  assert.equal(entries[0].value, managedRelativePickerValue("prov_ellis"));
  assert.equal(managedRelativeIdFromPickerValue(entries[0].value), "prov_ellis");
  assert.deepEqual(profilePickerSelection(entries[0].value), {
    kind: "managed-relative-preview",
    relativeId: "prov_ellis",
  });
});

test("ordinary line values never parse as managed-relative preview", () => {
  assert.equal(managedRelativeIdFromPickerValue("line_jordan"), null);
  assert.equal(managedRelativeIdFromPickerValue(""), null);
  assert.deepEqual(profilePickerSelection("line_jordan"), {
    kind: "line",
    lineId: "line_jordan",
  });
});

test("persistent top-right picker dispatches managed previews and invalidates on relative changes", () => {
  assert.match(
    appSource,
    /shell\.addEventListener\("change"[\s\S]*?sel\.id !== "home-active-line"[\s\S]*?openManagedRelativePickerValue\(next\)[\s\S]*?selectActiveLine\(next\)/
  );
  assert.match(
    appSource,
    /function chromeTopbarEndSignature\(\)[\s\S]*?managedRelativePickerEntries\([\s\S]*?entry\.relativeId[\s\S]*?return `pill:\$\{lineIds\}:\$\{managedRelativeIds\}/
  );
});
